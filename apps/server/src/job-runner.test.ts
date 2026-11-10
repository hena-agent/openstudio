import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabases } from "@openstudio/database";
import { createMediaJob } from "./media-jobs";
import { startJobRunner } from "./job-runner";
import { transaction, type StoredConnection } from "./storage";

const workspace = "a".repeat(64), account = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
const model = { id: "test/video", name: "Video", tasks: ["video" as const], endpoints: ["/videos"], media: { kind: "video" as const, reference: "none" as const } };
const connection: StoredConnection = { id: account, provider: "openrouter", method: "api-key", label: "Test", createdAt: "now", secret: "private-key", baseURL: "https://openrouter.ai/api/v1", models: [model] };
const input = () => ({ action: "create", connectionId: account, requestId: crypto.randomUUID(), model: model.id, kind: "video", prompt: "test", consent: true });
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const current = (id: string) => transaction(workspace, (data) => data.jobs!.find((job) => job.id === id)!);
let directory: string, runner: Awaited<ReturnType<typeof startJobRunner>> | undefined;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-runner-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); await transaction(workspace, (data) => { data.connections.push(structuredClone(connection)); }); });
afterEach(async () => { await runner?.stop(); runner = undefined; closeDatabases(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

describe("server-owned durable execution", () => {
  it("persists the queue before submission and processes it without browser polling after reopening", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ id: "external-job" })); vi.stubGlobal("fetch", send);
    const job = await createMediaJob(workspace, input()); expect(job.status).toBe("queued"); expect(send).not.toHaveBeenCalled();
    closeDatabases(); runner = await startJobRunner({ interval: 10 });
    await vi.waitFor(async () => expect((await current(job.id)).externalId).toBe("external-job"));
    expect(send).toHaveBeenCalledTimes(1); expect((await current(job.id)).submissionStartedAt).toBeTruthy();
  });
  it("restarts tracking an existing external job and downloads its file without submitting again", async () => {
    const job = await createMediaJob(workspace, input());
    await transaction(workspace, (data) => { Object.assign(data.jobs![0], { status: "pending", externalId: "existing", runId: "old-process", nextPollAt: 0 }); }); closeDatabases();
    const send = vi.fn().mockResolvedValueOnce(Response.json({ status: "completed", unsigned_urls: ["result"] })).mockResolvedValueOnce(new Response(mp4)); vi.stubGlobal("fetch", send);
    runner = await startJobRunner({ interval: 10 });
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe("completed"));
    expect((await current(job.id)).assets[0].mime).toBe("video/mp4"); expect(send.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await runner.stop(); closeDatabases(); expect((await current(job.id)).assets).toHaveLength(1);
  });
  it("resumes only the download stage after a failed download and restart", async () => {
    const job = await createMediaJob(workspace, input());
    await transaction(workspace, (data) => { Object.assign(data.jobs![0], { status: "downloading", externalId: "existing", pendingOutputs: [{ url: "https://openrouter.ai/api/v1/videos/existing/content?index=0" }], nextPollAt: 0 }); });
    const send = vi.fn().mockRejectedValueOnce(new Error("download disconnected")).mockResolvedValueOnce(new Response(mp4)); vi.stubGlobal("fetch", send);
    runner = await startJobRunner({ interval: 10 });
    await vi.waitFor(async () => expect((await current(job.id)).error).toBeTruthy()); await runner.stop();
    await transaction(workspace, (data) => { data.jobs![0].nextPollAt = 0; }); closeDatabases(); runner = await startJobRunner({ interval: 10 });
    await vi.waitFor(async () => expect((await current(job.id)).status).toBe("completed"));
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls.every(([url]) => String(url).includes("/content?"))).toBe(true);
  });
  it("does not resubmit a possibly charged request after restart", async () => {
    const job = await createMediaJob(workspace, input());
    await transaction(workspace, (data) => { Object.assign(data.jobs![0], { status: "submitting", runId: "old-process", submissionStartedAt: new Date().toISOString() }); }); closeDatabases();
    const send = vi.fn(); vi.stubGlobal("fetch", send); runner = await startJobRunner({ interval: 10 });
    expect((await current(job.id)).status).toBe("unknown"); expect(send).not.toHaveBeenCalled();
  });
  it("recovers an interrupted pre-submission validation as queued work", async () => {
    const job = await createMediaJob(workspace, input());
    await transaction(workspace, (data) => { Object.assign(data.jobs![0], { status: "submitting", runId: "old-process" }); }); closeDatabases();
    const send = vi.fn().mockResolvedValue(Response.json({ id: "new-external" })); vi.stubGlobal("fetch", send);
    runner = await startJobRunner({ interval: 10 });
    await vi.waitFor(async () => expect((await current(job.id)).externalId).toBe("new-external")); expect(send).toHaveBeenCalledTimes(1);
  });
});
