import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAL_API_BASE, falSettingsSchema, normalizeFalEndpointId } from "../fal-config";
import { discoverFal, enrichFalModel, falModel, searchFalModels } from "./fal";
import { transaction, type StoredConnection } from "./storage";
import { mediaPayload } from "./media-jobs";
import { saveMedia } from "./assets";
import { POST as connections } from "./routes/connections";
import { GET as publicCatalog } from "./routes/fal-models";

let directory: string;
const sessionId = "a".repeat(64), otherSession = "b".repeat(64);
const accountId = "545fab01-9592-44ca-9d90-053f86b9b1c8";
const connection: StoredConnection = { id: accountId, provider: "fal", method: "api-key", label: "fal", secret: "private-fal-key", baseURL: FAL_API_BASE, createdAt: "now", models: [] };
const rawModel = (id: string, category = "text-to-image", openapi?: Record<string, unknown>) => ({ endpoint_id: id, metadata: { display_name: id, category }, ...(openapi ? { openapi } : {}) });
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "fal-adapter-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "d".repeat(64)); vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3548"); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("fal catalog and pinned endpoints", () => {
  it("accepts official model/API URLs but rejects traversal, foreign hosts and job URLs", () => {
    expect(normalizeFalEndpointId("https://fal.ai/models/fal-ai/flux/schnell/api?utm_source=test")).toBe("fal-ai/flux/schnell");
    expect(normalizeFalEndpointId("https://fal.run/bytedance/seedream/v5/pro/text-to-image")).toBe("bytedance/seedream/v5/pro/text-to-image");
    for (const id of ["fal-ai/../private", "https://evil.test/fal-ai/model", "https://user:pass@fal.ai/models/fal-ai/model", "fal-ai/model/requests/task/status", "one-part", "https://fal.ai.evil.test/models/a/b"]) expect(() => normalizeFalEndpointId(id)).toThrow();
    expect(() => falSettingsSchema.parse({ endpoints: ["fal-ai/flux", "https://fal.ai/models/fal-ai/flux"] })).toThrow();
  });
  it("preserves public pagination filters and does not forward application cookies or secrets", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ models: [rawModel("fal-ai/video", "text-to-video")], next_cursor: "next+/=", has_more: true })); vi.stubGlobal("fetch", send);
    const result = await searchFalModels({ query: "Veo", category: "text-to-video", cursor: "start+/=" });
    const url = new URL(send.mock.calls[0][0]);
    expect(url.searchParams.get("cursor")).toBe("start+/="); expect(url.searchParams.get("q")).toBe("Veo"); expect(url.searchParams.get("category")).toBe("text-to-video");
    expect(result).toMatchObject({ source: "public-catalog", nextCursor: "next+/=", models: [{ tasks: ["video"] }] });
    expect(send.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    const second = vi.fn().mockResolvedValue(Response.json({ models: [], has_more: false })); vi.stubGlobal("fetch", second);
    const response = await publicCatalog(new Request("http://127.0.0.1/api/fal/models?q=flux", { headers: { Cookie: `studio_session=${sessionId}`, Authorization: "private-app-secret" } }));
    expect(response.headers.has("set-cookie")).toBe(false); expect(JSON.stringify(second.mock.calls)).not.toContain("private-app-secret");
  });
  it("keeps chosen endpoints outside the latest 50 and authenticates with Key headers", async () => {
    const send = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      return Response.json({ models: url.searchParams.has("endpoint_id") ? [rawModel("bytedance/seedream/v5/pro/text-to-image")] : [], has_more: false });
    }); vi.stubGlobal("fetch", send);
    const result = await discoverFal({ ...connection, fal: { endpoints: ["https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image/api"] } });
    expect(result).toHaveLength(1); expect(result[0].id).toBe("bytedance/seedream/v5/pro/text-to-image");
    expect(send.mock.calls).toHaveLength(5);
    for (const call of send.mock.calls) expect(call[1]?.headers).toMatchObject({ Authorization: "Key private-fal-key" });
  });
  it("retains unavailable pinned IDs on refresh, but rejects missing IDs in a new configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ models: [], has_more: false }))));
    const old = falModel(rawModel("fal-ai/pinned"));
    const account = { ...connection, credentialVerifiedAt: "previous", fal: { endpoints: [old.id] }, models: [old] };
    expect(await discoverFal(account)).toMatchObject([{ id: old.id, callable: false }]);
    await expect(discoverFal(account, true)).rejects.toMatchObject({ code: "model_not_found" });
  });
  it("does not fall back to anonymous discovery when a supplied key is invalid", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({}, { status: 401 })); vi.stubGlobal("fetch", send);
    await expect(discoverFal(connection)).rejects.toMatchObject({ code: "authentication_failed" }); expect(send).toHaveBeenCalledTimes(1);
    expect(falModel(rawModel("bytedance/seedance-2.5", "text-to-video")).callable).toBe(false);
  });
  it("resolves referenced/allOf input definitions and array reference limits", async () => {
    const openapi = { paths: { "/canonical/image": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } } }, components: { schemas: {
      Input: { allOf: [{ $ref: "#/components/schemas/Prompt" }, { type: "object", properties: { image_urls: { $ref: "#/components/schemas/References" } }, required: ["image_urls"] }] },
      Prompt: { type: "object", properties: { prompt: { type: "string" }, resolution: { type: "string", enum: ["1K", "2K"] } }, required: ["prompt"] },
      References: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
    } } };
    const send = vi.fn().mockResolvedValueOnce(Response.json({ models: [rawModel("fal-ai/edit", "image-to-image", openapi)] })).mockResolvedValueOnce(Response.json({}, { status: 403 })); vi.stubGlobal("fetch", send);
    const model = falModel(rawModel("fal-ai/edit", "image-to-image")); await enrichFalModel(connection, model);
    expect(model.media).toMatchObject({ acceptsPrompt: true, reference: "required", referenceField: "image_urls", referenceArray: true, maxReferences: 2, parameters: { resolution: { values: ["1K", "2K"] } } });
    expect(JSON.stringify(model)).not.toContain("private-fal-key");
  });
  it("omits prompt for schema-defined prompt-free image processing", async () => {
    const openapi = { paths: { "/upscale": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { image_url: { type: "string" } }, required: ["image_url"], additionalProperties: false } } } } } } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ models: [rawModel("fal-ai/upscale", "image-to-image", openapi)] })).mockResolvedValueOnce(Response.json({ prices: [] })));
    const model = falModel(rawModel("fal-ai/upscale", "image-to-image")); await enrichFalModel(connection, model);
    const asset = await saveMedia(sessionId, new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])), "image", "reference.png");
    const payload = await mediaPayload(sessionId, connection, model, { kind: "image", prompt: "", options: {}, referenceIds: [asset.id] });
    expect(model.media?.acceptsPrompt).toBe(false); expect(payload).not.toHaveProperty("prompt"); expect((payload as Record<string, unknown>).image_url).toMatch(/^data:image\/png;base64,/);
    await expect(mediaPayload(sessionId, { ...connection, provider: "openrouter" }, model, { kind: "image", prompt: "", options: {}, referenceIds: [] })).rejects.toThrow("프롬프트");
  });
  it("isolates fal settings and preserves the previous configuration when lookup fails", async () => {
    await transaction(sessionId, (data) => { data.connections.push({ ...connection, fal: { endpoints: [] } }); });
    const body = { action: "fal-settings", id: accountId, fal: { endpoints: ["fal-ai/missing"] } };
    const request = (cookie: string) => new Request("http://127.0.0.1/api/connections", { method: "POST", headers: { Origin: "http://127.0.0.1:3548", Cookie: `studio_session=${cookie}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const send = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ models: [] }))); vi.stubGlobal("fetch", send);
    expect((await connections(request(otherSession))).status).toBe(404); expect(send).not.toHaveBeenCalled();
    expect((await connections(request(sessionId))).status).toBe(404);
    expect(await transaction(sessionId, (data) => data.connections[0].fal?.endpoints)).toEqual([]);
  });
  it("connects a key and persists normalized endpoints through the account API", async () => {
    const send = vi.fn(async (input: string) => {
      const ids = new URL(input).searchParams.getAll("endpoint_id");
      return Response.json({ models: ids.map((id) => rawModel(id)), has_more: false });
    }); vi.stubGlobal("fetch", send);
    const request = (body: unknown) => new Request("http://127.0.0.1/api/connections", { method: "POST", headers: { Origin: "http://127.0.0.1:3548", Cookie: `studio_session=${sessionId}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await connections(request({ action: "add-key", provider: "fal", key: "private-fal-key", label: "fal", fal: { endpoints: ["https://fal.ai/models/fal-ai/pinned/api"] } }));
    expect(response.status).toBe(200); const first = await response.json();
    expect(first.connection.fal.endpoints).toEqual(["fal-ai/pinned"]); expect(first.connection.models[0].id).toBe("fal-ai/pinned"); expect(JSON.stringify(first)).not.toContain("private-fal-key");
    const saved = await connections(request({ action: "fal-settings", id: first.connection.id, fal: { endpoints: ["fal-ai/another"] } }));
    expect(saved.status).toBe(200);
    expect(await transaction(sessionId, (data) => data.connections[0].fal?.endpoints)).toEqual(["fal-ai/another"]);
  });
});
