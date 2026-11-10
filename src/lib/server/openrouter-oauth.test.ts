import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOpenRouter, openRouterStatus, startOpenRouter } from "./openrouter-oauth";
import { transaction } from "./storage";

const alice = "a".repeat(64), bob = "b".repeat(64);
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-router-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("OPENSTUDIO_BACKEND_ORIGIN", "http://127.0.0.1:4624"); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
async function begin() {
  const attempt = await startOpenRouter(alice); const url = new URL(attempt.authorizationUrl);
  const callback = new URL("http://127.0.0.1:4624/auth/openrouter/callback"); callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code" }).toString();
  return { attempt, url, callback };
}
describe("OpenRouter OAuth PKCE", () => {
  it("returns the OAuth callback to localhost for a localhost browser session", async () => {
    const attempt = await startOpenRouter(alice, "localhost"), url = new URL(attempt.authorizationUrl);
    expect(url.searchParams.get("callback_url")).toBe("http://localhost:4624/auth/openrouter/callback");
    const callback = new URL(url.searchParams.get("callback_url")!); callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code" }).toString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ key: "private-key" })).mockResolvedValueOnce(Response.json({ data: {} })));
    expect((await completeOpenRouter(alice, callback)).ok).toBe(true);
  });
  it("binds callback/state/PKCE to the browser session and consumes codes once", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ key: "private-router-key" })).mockResolvedValueOnce(Response.json({ data: {} })); vi.stubGlobal("fetch", fetchMock);
    const { attempt, url, callback } = await begin();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("callback_url")).toBe("http://127.0.0.1:4624/auth/openrouter/callback");
    expect(JSON.stringify(attempt)).not.toContain("verifier");
    await expect(completeOpenRouter(bob, callback)).rejects.toMatchObject({ code: "invalid_state" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await completeOpenRouter(alice, callback)).toEqual({ ok: true });
    await expect(completeOpenRouter(alice, callback)).rejects.toMatchObject({ code: "invalid_state" });
    const status = await openRouterStatus(alice, attempt.id);
    expect(status.status).toBe("connected"); expect(JSON.stringify(status)).not.toContain("private-router-key");
    expect(await transaction(alice, (data) => data.connections[0].method)).toBe("oauth");
  });
  it("retains a minted key on transient validation failure without exchanging again", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ key: "private-router-key" })).mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json({ data: {} })); vi.stubGlobal("fetch", fetchMock);
    const { attempt, callback } = await begin();
    expect(await completeOpenRouter(alice, callback)).toEqual({ ok: false });
    await expect(completeOpenRouter(alice, callback)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await openRouterStatus(alice, attempt.id)).status).toBe("connected");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("auth/keys"))).toHaveLength(1);
    expect(await transaction(alice, (data) => data.connections.length)).toBe(1);
  });
  it("rejects cancellation, denial and expired attempts without minting a key", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const first = await begin(); await openRouterStatus(alice, first.attempt.id, true);
    await expect(completeOpenRouter(alice, first.callback)).rejects.toMatchObject({ code: "invalid_state" });
    const second = await begin(); second.callback.searchParams.set("error", "access_denied"); expect((await completeOpenRouter(alice, second.callback)).ok).toBe(false);
    const third = await begin(); await transaction(alice, (data) => { data.routerAttempts!.find((item) => item.id === third.attempt.id)!.expiresAt = 0; });
    await expect(completeOpenRouter(alice, third.callback)).rejects.toMatchObject({ code: "invalid_state" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
