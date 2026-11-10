import { afterEach, describe, expect, it, vi } from "vitest";
import { route, readSession, sessionCookie } from "./http";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("API boundary", () => {
  it("accepts only the configured frontend port on localhost and 127.0.0.1", async () => {
    vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3456");
    const handler = vi.fn().mockResolvedValue({ ok: true }), post = route(handler, true);
    for (const origin of ["http://localhost:3456", "http://127.0.0.1:3456"]) expect((await post(new Request("http://127.0.0.1:4567/api", { method: "POST", headers: { Origin: origin } }))).status).toBe(200);
    for (const origin of ["http://localhost:3457", "http://localhost.evil.test:3456", "http://127.0.0.2:3456", "https://localhost:3456", "null"]) expect((await post(new Request("http://127.0.0.1:4567/api", { method: "POST", headers: { Origin: origin } }))).status).toBe(403);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("does not add loopback aliases to a deployed non-loopback origin", async () => {
    vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "https://studio.example.test");
    const post = route(async () => ({}), true);
    expect((await post(new Request("https://studio.example.test/api", { method: "POST", headers: { Origin: "http://localhost" } }))).status).toBe(403);
  });
  it("blocks missing and cross-site Origin before running a mutation", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const post = route(handler, true);
    expect((await post(new Request("http://localhost:3000/api/oauth", { method: "POST" }))).status).toBe(403);
    expect((await post(new Request("http://localhost:3000/api/oauth", { method: "POST", headers: { Origin: "https://other.test" } }))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect((await post(new Request("http://localhost:3000/api/oauth", { method: "POST", headers: { Origin: "http://localhost:3000" } }))).status).toBe(200);
  });

  it("returns only a generic error for unexpected failures", async () => {
    const get = route(async () => { throw new Error("private-secret"); });
    const response = await get(new Request("http://localhost/api"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-secret");
  });

  it("creates an unguessable HttpOnly session and allows a top-level OAuth callback", async () => {
    const get = route(async (_request, id) => ({ id }));
    const response = await get(new Request("http://127.0.0.1:4001/api/connections", { headers: { Cookie: "studio_session=invalid" } }));
    const { id } = await response.json();
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    expect(readSession(new Request("http://127.0.0.1:4001/auth/callback", { headers: { Cookie: `studio_session=${id}` } }))).toBe(id);
    expect(sessionCookie(id)).not.toContain("Domain=");
  });
});
