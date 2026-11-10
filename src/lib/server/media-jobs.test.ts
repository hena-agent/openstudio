import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaJob, mediaPayload, mediaRunId, pollMediaJob, publicJob, recoverStalledJobs } from "./media-jobs";
import { transaction, type StoredConnection, type StoredJob } from "./storage";

const sessionId = "a".repeat(64), connectionId = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
let directory: string;
const videoModel = { id: "test/video", name: "Video", tasks: ["video" as const], endpoints: ["/videos"], media: { kind: "video" as const, durations: [5], resolutions: ["720p"], reference: "none" as const } };
const connection: StoredConnection = { id: connectionId, provider: "openrouter", method: "api-key", label: "Test", createdAt: "now", secret: "private-token", baseURL: "https://openrouter.ai/api/v1", models: [videoModel] };
const input = () => ({ action: "create", connectionId, requestId: crypto.randomUUID(), model: videoModel.id, kind: "video", prompt: "test", options: { duration: 5, resolution: "720p" }, consent: true });
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-jobs-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); await transaction(sessionId, (data) => { data.connections.push(structuredClone(connection)); }); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
const current = (id: string) => transaction(sessionId, (data) => data.jobs!.find((job) => job.id === id)!);
describe("durable media jobs", () => {
  it("submits one job for repeated request IDs and preserves external IDs across query failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ id: "remote-job" })).mockRejectedValueOnce(new Error("network")); vi.stubGlobal("fetch", fetchMock);
    const request = input(); const [first, second] = await Promise.all([createMediaJob(sessionId, request), createMediaJob(sessionId, request)]);
    expect(first.id).toBe(second.id);
    await vi.waitFor(async () => expect((await current(first.id)).externalId).toBe("remote-job"));
    await transaction(sessionId, (data) => { data.jobs![0].nextPollAt = 0; });
    await pollMediaJob(sessionId, first.id);
    const job = await current(first.id); expect(job.externalId).toBe("remote-job"); expect(job.status).toBe("pending");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(JSON.stringify(publicJob(job))).not.toContain("private-token"); expect(publicJob(job)).not.toHaveProperty("options");
    await expect(createMediaJob(sessionId, { ...request, prompt: "different" })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("downloads completed video and never generates again when polling after completion", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ id: "remote-job" })).mockResolvedValueOnce(Response.json({ status: "completed", unsigned_urls: ["private-output-url"] })).mockResolvedValueOnce(new Response(mp4)); vi.stubGlobal("fetch", fetchMock);
    const job = await createMediaJob(sessionId, input());
    await vi.waitFor(async () => expect((await current(job.id)).externalId).toBeTruthy());
    await transaction(sessionId, (data) => { data.jobs![0].nextPollAt = 0; });
    await pollMediaJob(sessionId, job.id);
    expect((await current(job.id)).status).toBe("completed"); expect((await current(job.id)).assets[0].mime).toBe("video/mp4");
    await pollMediaJob(sessionId, job.id); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not submit without consent and blocks Seedance below the required version", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(createMediaJob(sessionId, { ...input(), consent: false })).rejects.toThrow();
    await expect(mediaPayload(sessionId, connection, { ...videoModel, id: "bytedance/seedance-2.5" }, { kind: "video", prompt: "test", options: {}, referenceIds: [] })).rejects.toThrow("5.0");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates options before any upstream submission", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const job = await createMediaJob(sessionId, { ...input(), options: { resolution: "4K" } });
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe("failed"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("marks ambiguous submissions after restart without regenerating external jobs", () => {
    const jobs = [{ id: "one", status: "submitting", runId: "old" }, { id: "two", status: "running", runId: "old", externalId: "known" }, { id: "three", status: "submitting", runId: mediaRunId }] as StoredJob[];
    recoverStalledJobs(jobs); expect(jobs[0].status).toBe("unknown"); expect(jobs[1].status).toBe("running"); expect(jobs[2].status).toBe("submitting");
  });
  it("validates fal input schemas and required options", async () => {
    const fal = { ...connection, provider: "fal" as const };
    const model = { ...videoModel, media: { ...videoModel.media, inputSchema: { type: "object", properties: { prompt: { type: "string" }, duration: { type: "integer", enum: [5, 10] } }, required: ["prompt", "duration"], additionalProperties: false } } };
    await expect(mediaPayload(sessionId, fal, model, { kind: "video", prompt: "test", options: {}, referenceIds: [] })).rejects.toThrow("duration");
    expect(await mediaPayload(sessionId, fal, model, { kind: "video", prompt: "test", options: { duration: 5 }, referenceIds: [] })).toEqual({ prompt: "test", duration: 5 });
  });
  it("tracks fal's returned queue URLs and stores image outputs without resubmission", async () => {
    const falModel = { id: "fal-ai/test/text-to-image", name: "Image", tasks: ["image" as const], endpoints: ["queue"], media: { kind: "image" as const, reference: "none" as const, acceptsPrompt: true, inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } } };
    await transaction(sessionId, (data) => { data.connections[0] = { ...connection, provider: "fal", baseURL: "https://api.fal.ai/v1", models: [falModel] }; });
    const statusUrl = "https://queue.fal.run/fal-ai/test/requests/remote-id/status";
    const resultUrl = "https://queue.fal.run/fal-ai/test/requests/remote-id";
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ request_id: "remote-id", status_url: statusUrl, response_url: resultUrl })).mockResolvedValueOnce(Response.json({ status: "COMPLETED" })).mockResolvedValueOnce(Response.json({ images: [{ url: "https://v3.fal.media/output.png" }] })).mockResolvedValueOnce(new Response(png)); vi.stubGlobal("fetch", fetchMock);
    const job = await createMediaJob(sessionId, { ...input(), kind: "image", model: falModel.id, options: {} });
    await vi.waitFor(async () => expect((await current(job.id)).statusUrl).toBe(statusUrl));
    await transaction(sessionId, (data) => { data.jobs![0].nextPollAt = 0; });
    await pollMediaJob(sessionId, job.id);
    const result = await current(job.id);
    expect(result.status).toBe("completed"); expect(result.assets[0].mime).toBe("image/png");
    expect(fetchMock.mock.calls[1][0]).toBe(statusUrl); expect(fetchMock.mock.calls[2][0]).toBe(resultUrl);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
