import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "./api-server";
import { transaction } from "./storage";

const alice = "a".repeat(64), bob = "b".repeat(64), connectionId = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "studio-connection-models-"));
  vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3456");
  await transaction(alice, (data) => { data.connections.push({ id: connectionId, provider: "fal", method: "api-key", label: "fal", createdAt: "now", secret: "private-key", baseURL: "https://api.fal.ai/v1", models: [] }); });
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
function request(resource: string, body?: unknown, session = alice) { return new Request(`http://127.0.0.1:4567/api/${resource}`, { method: body ? "POST" : "GET", headers: { Origin: "http://127.0.0.1:3456", Cookie: `studio_session=${session}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
const search = { action: "search-models", id: connectionId, query: "test", category: "text-to-image" };
describe("provider-owned model selection", () => {
  it("searches with the connected key and caches returned models without separate registration", async () => {
    const send = vi.fn().mockImplementation(async () => Response.json({ models: [{ endpoint_id: "fal-ai/test-image", metadata: { display_name: "Image", category: "text-to-image" } }], next_cursor: "page-2" })); vi.stubGlobal("fetch", send);
    const response = await dispatch(request("connections", search)); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.models[0].id).toBe("fal-ai/test-image"); expect(data.nextCursor).toBe("page-2");
    expect(send.mock.calls[0][1].headers.Authorization).toBe("Key private-key");
    expect(data.connection.models[0].id).toBe("fal-ai/test-image"); expect(JSON.stringify(data)).not.toContain("private-key");
    await dispatch(request("connections", { ...search, cursor: "page-2" }));
    expect(String(send.mock.calls[1][0])).toContain("cursor=page-2");
    const workspace = await transaction(alice, (data) => data); expect(workspace.connections[0].models).toHaveLength(1); expect(workspace.registeredModels).toBeUndefined();
  });
  it("rejects foreign accounts, disconnected keys and unsupported providers before any search", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    expect((await dispatch(request("connections", search, bob))).status).toBe(404);
    await transaction(alice, (data) => { data.connections[0].status = "disconnected"; });
    expect((await dispatch(request("connections", search))).status).toBe(400);
    await transaction(alice, (data) => { data.connections[0].status = "connected"; data.connections[0].provider = "openai"; });
    expect((await dispatch(request("connections", search))).status).toBe(400); expect(send).not.toHaveBeenCalled();
  });
  it("connects BytePlus with only a key and returns selectable account models", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "image-model", modalities: { output_modalities: ["image"] } }] })); vi.stubGlobal("fetch", send);
    const response = await dispatch(request("connections", { action: "add-key", provider: "byteplus", label: "BytePlus", key: "test-private-key" }));
    expect(response.status).toBe(200); const data = await response.json(); expect(data.connection.models[0]).toMatchObject({ id: "image-model", tasks: ["image"] });
    expect(send).toHaveBeenCalledTimes(1); expect(String(send.mock.calls[0][0])).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/models");
  });
  it("executes a connected text model without a registration and isolates saved results", async () => {
    await transaction(alice, (data) => { data.connections[0] = { ...data.connections[0], provider: "deepseek", baseURL: "https://api.deepseek.com", models: [{ id: "text-model", name: "Text model", endpoints: ["/chat/completions"], tasks: ["text"] }] }; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "Text result" } }] })));
    const response = await dispatch(request("connections", { action: "invoke", id: connectionId, model: "text-model", prompt: "test", consent: true })); expect(response.status).toBe(200);
    expect((await (await dispatch(request("models"))).json()).textRuns[0].text).toBe("Text result");
    expect((await (await dispatch(request("models", undefined, bob))).json()).textRuns).toEqual([]);
    expect((await dispatch(request("models", { action: "add", connectionId, modelId: "text-model", kind: "text" }))).status).toBe(400);
  });
});
