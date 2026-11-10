import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "./api-server";
import { transaction } from "./storage";

let directory: string;
const id = "a".repeat(64);
const connectionId = "e8ba69b3-3c69-4325-b060-4995cd6485a0";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "studio-api-"));
  vi.stubEnv("OPENSTUDIO_DATA_DIR", directory);
  vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64));
  vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3456");
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
function request(body: unknown, session = id) {
  return new Request("http://127.0.0.1:4567/api/connections", { method: "POST", headers: { Origin: "http://127.0.0.1:3456", Cookie: `studio_session=${session}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
describe("backend application routes", () => {
  it.each([[401, "authentication"], [403, "permission"], [503, "temporary"]])("persists HTTP %s connection failures and clears them after a successful recheck", async (status, kind) => {
    await transaction(id, (data) => data.connections.push({ id: connectionId, provider: "openai", label: "account", method: "api-key", createdAt: "now", secret: "old-secret", baseURL: "https://api.openai.com/v1", models: [{ id: "old-model", name: "Old model", endpoints: [] }], modelsCheckedAt: "2026-11-10T00:00:00Z" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({}, { status: Number(status) })).mockResolvedValueOnce(Response.json({ data: [{ id: "new-model" }] })));
    expect((await dispatch(request({ action: "models", id: connectionId }))).status).toBe(502);
    const failed = await transaction(id, (data) => data.connections[0]);
    expect(failed.connectionIssue?.kind).toBe(kind); expect(failed.models[0].id).toBe("old-model"); expect(failed.secret).toBe("old-secret");
    const response = await dispatch(new Request("http://127.0.0.1:4567/api/connections", { headers: { Cookie: `studio_session=${id}` } }));
    expect((await response.json()).connections[0].connectionIssue.kind).toBe(kind);
    expect((await dispatch(request({ action: "models", id: connectionId }))).status).toBe(200);
    const recovered = await transaction(id, (data) => data.connections[0]); expect(recovered.connectionIssue).toBeUndefined(); expect(recovered.credentialVerifiedAt).toBeTruthy(); expect(recovered.verifiedAt).toBeUndefined();
  });
  it("requires explicit generation consent before calling any provider", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await dispatch(request({ action: "invoke", id: connectionId, model: "model", prompt: "test", consent: false }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("prevents another browser session from using or deleting a connection", async () => {
    await transaction(id, (data) => data.connections.push({ id: connectionId, provider: "openai", label: "account", method: "api-key", createdAt: "now", secret: "private-key", baseURL: "https://api.openai.com/v1", models: [] }));
    const response = await dispatch(request({ action: "disconnect", id: connectionId }, "b".repeat(64)));
    expect(response.status).toBe(404);
    expect(await transaction(id, (data) => data.connections.length)).toBe(1);
  });
  it("does not expose tokens in public account responses", async () => {
    await transaction(id, (data) => data.connections.push({ id: connectionId, provider: "openai", label: "account", method: "oauth", createdAt: "now", secret: "access-secret", refreshToken: "refresh-secret", idToken: "id-secret", clientId: "client-secret", subject: "subject-secret", baseURL: "https://api.openai.com/v1", models: [] }));
    const response = await dispatch(new Request("http://127.0.0.1:4567/api/connections", { headers: { Cookie: `studio_session=${id}` } }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("secret");
  });
  it("rejects OAuth callbacks without the initiating browser cookie", async () => {
    const response = await dispatch(new Request("http://127.0.0.1:4567/auth/callback?code=private-code&state=private-state"));
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("private-code"); expect(body).not.toContain("private-state");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("persists a rotating refresh token even if the following model request fails", async () => {
    await transaction(id, (data) => data.connections.push({
      id: connectionId, provider: "openai", label: "account", method: "oauth", createdAt: "now",
      secret: "old-access", refreshToken: "old-refresh", clientId: "app-issued", subject: "account-id",
      expiresAt: Date.now() - 1000, scopes: ["chatgpt.tokens.use.direct"], planEnabled: true,
      baseURL: "https://api.openai.com/v1", models: [],
    }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/api/accounts/authorize", token_endpoint: "https://auth.openai.com/api/accounts/oauth/token", jwks_uri: "https://auth.openai.com/.well-known/jwks.json", revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" });
      if (String(url).includes("oauth/token")) return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" });
      return Response.json({}, { status: 503 });
    }));
    expect((await dispatch(request({ action: "models", id: connectionId }))).status).toBe(502);
    const connection = await transaction(id, (data) => data.connections[0]);
    expect(connection.secret).toBe("new-access");
    expect(connection.refreshToken).toBe("new-refresh");
  });
  it("validates replacement API keys before updating an existing account", async () => {
    await transaction(id, (data) => data.connections.push({ id: connectionId, provider: "openai", method: "api-key", label: "account", createdAt: "now", secret: "old-secret", baseURL: "https://api.openai.com/v1", models: [] }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({ data: [{ id: "new-model" }] })));
    expect((await dispatch(request({ action: "update-key", id: connectionId, key: "invalid-new-secret" }))).status).toBe(502);
    expect(await transaction(id, (data) => data.connections[0].secret)).toBe("old-secret");
    expect(await transaction(id, (data) => data.connections[0].connectionIssue)).toBeUndefined();
    expect((await dispatch(request({ action: "update-key", id: connectionId, key: "valid-new-secret" }))).status).toBe(200);
    expect(await transaction(id, (data) => data.connections[0].secret)).toBe("valid-new-secret");
    expect(await transaction(id, (data) => data.connections[0].id)).toBe(connectionId);
  });
});
