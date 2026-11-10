import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BYTEPLUS_BASE_URL } from "../byteplus-config";
import { mapBytePlusModels } from "./byteplus";
import { createMediaJob, pollMediaJob, publicJob } from "./media-jobs";
import { transaction } from "./storage";
import { POST as connections } from "./routes/connections";

const session = "a".repeat(64), other = "b".repeat(64), accountId = "185a5c1c-f357-4b16-b887-cc3daf0a7ac9";
const settings = { region: "ap-southeast-1" as const, registrations: [] };
const catalog = { data: [{ id: "image-fixture", modalities: { input_modalities: ["text", "image"], output_modalities: ["image"] } }, { id: "video-fixture", modalities: { input_modalities: ["text", "image"], output_modalities: ["video"] } }] };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(24)]);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "byteplus-jobs-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "b".repeat(64)); vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3708");
  await transaction(session, (data) => { data.connections.push({ id: accountId, provider: "byteplus", method: "api-key", label: "Test", secret: "private-ark-key", baseURL: BYTEPLUS_BASE_URL, byteplus: settings, createdAt: "now", models: mapBytePlusModels(catalog, settings) }); });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const getJob = (id: string) => transaction(session, (data) => data.jobs!.find((job) => job.id === id)!);
const input = (kind: "image" | "video") => ({ action: "create", requestId: crypto.randomUUID(), connectionId: accountId, model: `${kind}-fixture`, kind, prompt: "test", options: {}, consent: true });
function settingsRequest(cookie = session) { return new Request("http://127.0.0.1:4332/api/connections", { method: "POST", headers: { Origin: "http://127.0.0.1:3708", Cookie: `studio_session=${cookie}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "byteplus-settings", id: accountId, byteplus: { ...settings, registrations: [{ id: "ep-image", kind: "image" }] } }) }); }
describe("BytePlus integration pipeline", () => {
  it("connects an API key with region and manual image endpoints through the public API", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json(catalog)); vi.stubGlobal("fetch", send);
    const response = await connections(new Request("http://127.0.0.1:4332/api/connections", { method: "POST", headers: { Origin: "http://127.0.0.1:3708", Cookie: `studio_session=${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "add-key", provider: "byteplus", key: "new-private-ark-key", label: "ModelArk", byteplus: { ...settings, registrations: [{ id: "ep-image-direct", kind: "image", baseModelId: "image-fixture" }] } }) }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.connection.byteplus.region).toBe("ap-southeast-1");
    expect(data.connection.models.find((model: { id: string }) => model.id === "ep-image-direct")).toMatchObject({ tasks: ["image"], registration: { mappingVerified: false } });
    expect(JSON.stringify(data)).not.toContain("new-private-ark-key");
    expect(send.mock.calls[0][0]).toBe(`${BYTEPLUS_BASE_URL}/models`);
  });
  it("calls images/generations and saves signed URL outputs without forwarding the API key", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ url: "https://ark-image.tos-ap-southeast-1.bytepluses.com/image.png?signature=private-signature" }] })).mockResolvedValueOnce(new Response(png)); vi.stubGlobal("fetch", send);
    const job = await createMediaJob(session, input("image"));
    await vi.waitFor(async () => expect((await getJob(job.id)).status).toBe("completed"));
    expect(send.mock.calls[0][0]).toBe(`${BYTEPLUS_BASE_URL}/images/generations`);
    expect(send.mock.calls[0][1].headers.Authorization).toBe("Bearer private-ark-key");
    expect(send.mock.calls[1][1].headers).toEqual({});
    const result = await getJob(job.id); expect(result.assets[0].mime).toBe("image/png"); expect(JSON.stringify(publicJob(result))).not.toContain("private-signature");
  });
  it("retains task IDs, resumes queued/running tasks and obtains content.video_url without resubmitting", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json({ id: "cgt-unit-task" })).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ id: "cgt-unit-task", status: "queued" })).mockResolvedValueOnce(Response.json({ id: "cgt-unit-task", status: "running" }))
      .mockResolvedValueOnce(Response.json({ id: "cgt-unit-task", status: "succeeded", content: { video_url: "https://ark-video.tos-ap-southeast-1.bytepluses.com/output.mp4" } })).mockResolvedValueOnce(new Response(mp4));
    vi.stubGlobal("fetch", send);
    const job = await createMediaJob(session, input("video"));
    await vi.waitFor(async () => expect((await getJob(job.id)).externalId).toBe("cgt-unit-task"));
    await transaction(session, (data) => { data.connections[0].models = []; });
    for (let i = 0; i < 4; i++) { await transaction(session, (data) => { data.jobs![0].nextPollAt = 0; }); await pollMediaJob(session, job.id); }
    const result = await getJob(job.id);
    expect(result.externalId).toBe("cgt-unit-task"); expect(result.status).toBe("completed"); expect(result.assets[0].mime).toBe("video/mp4");
    expect(send.mock.calls[0][0]).toBe(`${BYTEPLUS_BASE_URL}/contents/generations/tasks`);
    expect(send.mock.calls[1][0]).toBe(`${BYTEPLUS_BASE_URL}/contents/generations/tasks/cgt-unit-task`);
    expect(send.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("isolates settings changes and does not overwrite keys when model lookup fails", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json(catalog)); vi.stubGlobal("fetch", send);
    expect((await connections(settingsRequest(other))).status).toBe(404); expect(send).not.toHaveBeenCalled();
    expect((await connections(settingsRequest())).status).toBe(502);
    expect(await transaction(session, (data) => data.connections[0].byteplus?.registrations.length)).toBe(0);
    const response = await connections(settingsRequest()); expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private-ark-key");
    expect(await transaction(session, (data) => data.connections[0].byteplus?.registrations[0].id)).toBe("ep-image");
  });
});
