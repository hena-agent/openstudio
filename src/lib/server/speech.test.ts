import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverSpeechModels, speechVoices, synthesizeSpeech } from "./speech";
import { createMediaJob, pollMediaJob } from "./media-jobs";
import { serveAsset } from "./assets";
import { transaction, type StoredConnection } from "./storage";

let directory: string;
const session = "a".repeat(64), connectionId = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
const model = { id: "eleven_v3", name: "Eleven v3", tasks: ["audio" as const], endpoints: ["/text-to-speech"], metadata: { maxInput: 4000 } };
const connection: StoredConnection = { id: connectionId, provider: "elevenlabs", method: "api-key", label: "TTS", createdAt: "now", secret: "private-key", baseURL: "https://api.elevenlabs.io/v1", models: [model] };
const input = () => ({ action: "create", requestId: crypto.randomUUID(), connectionId, kind: "audio", model: model.id, prompt: "안녕하세요.", options: { voice: "voice123" }, consent: true });
const current = (id: string) => transaction(session, (data) => data.jobs!.find((job) => job.id === id)!);
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-speech-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); await transaction(session, (data) => { data.connections.push(structuredClone(connection)); }); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
describe("ElevenLabs TTS", () => {
  it("authenticates model discovery, excludes non-TTS models and paginates voices", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json([{ model_id: "eleven_v3", name: "v3", can_do_text_to_speech: true }, { model_id: "sts", name: "Speech to speech", can_do_text_to_speech: false }])).mockResolvedValueOnce(Response.json({ voices: [{ voice_id: "voice123", name: "Narrator" }], has_more: true, next_page_token: "page2" })); vi.stubGlobal("fetch", send);
    expect((await discoverSpeechModels(connection)).map((model) => model.id)).toEqual(["eleven_v3"]);
    expect(send.mock.calls[0][1].headers["xi-api-key"]).toBe("private-key");
    expect(await speechVoices(connection, "Narrator", "page1")).toEqual({ voices: [{ id: "voice123", name: "Narrator" }], nextCursor: "page2" });
    expect(String(send.mock.calls[1][0])).toContain("next_page_token=page1");
  });
  it("saves one MP3 for a repeated request, serves playback ranges and isolates audio files", async () => {
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32)]);
    const send = vi.fn().mockResolvedValue(new Response(mp3)); vi.stubGlobal("fetch", send);
    const request = input(); const first = await createMediaJob(session, request); const second = await createMediaJob(session, request);
    expect(first.id).toBe(second.id);
    await vi.waitFor(async () => expect((await current(first.id)).status).toBe("completed"));
    await pollMediaJob(session, first.id); expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ text: "안녕하세요.", model_id: "eleven_v3" });
    const asset = (await current(first.id)).assets[0]; expect(asset.mime).toBe("audio/mpeg");
    const own = await serveAsset(new Request(`http://127.0.0.1/api/assets?id=${asset.id}`, { headers: { Cookie: `studio_session=${session}`, Range: "bytes=0-2" } }));
    expect(own.status).toBe(206); expect(await own.text()).toBe("ID3");
    expect((await serveAsset(new Request(`http://127.0.0.1/api/assets?id=${asset.id}`, { headers: { Cookie: `studio_session=${"b".repeat(64)}` } }))).status).toBe(404);
  });
  it("requires consent and a valid voice before any provider call", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    await expect(createMediaJob(session, { ...input(), consent: false })).rejects.toThrow();
    await expect(createMediaJob(session, { ...input(), options: { voice: "../../other" } })).rejects.toThrow();
    await expect(createMediaJob("b".repeat(64), input())).rejects.toMatchObject({ status: 404 });
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves ambiguous network submissions without retrying generation", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network disconnected")); vi.stubGlobal("fetch", send);
    const request = input(), job = await createMediaJob(session, request);
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe("unknown"));
    await createMediaJob(session, request); await pollMediaJob(session, job.id);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects non-audio responses instead of marking a generated file successful", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream page</html>")));
    const job = await createMediaJob(session, input());
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe("failed"));
    expect((await current(job.id)).assets).toEqual([]);
    expect(await transaction(session, (data) => data.connections[0].verifiedAt)).toBeUndefined();
  });
  it.each([[401, "authentication_failed", "failed"], [403, "permission_denied", "failed"], [429, "rate_limited", "failed"], [503, "provider_error", "unknown"]])("handles HTTP %s without resubmission", async (status, code, expected) => {
    const send = vi.fn().mockResolvedValue(new Response("private provider response", { status: Number(status) })); vi.stubGlobal("fetch", send);
    const request = input(), job = await createMediaJob(session, request);
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe(expected));
    expect((await current(job.id)).error).not.toContain("private provider response");
    await createMediaJob(session, request); await pollMediaJob(session, job.id); expect(send).toHaveBeenCalledTimes(1);
    await expect(synthesizeSpeech(connection, model, "test", { voice: "voice123" })).rejects.toMatchObject({ code });
  });
});
