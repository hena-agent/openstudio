import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOpenAI, openaiAttemptStatus, refreshOpenAI, startOpenAI, verifyIdentity } from "./openai-oauth";
import { publicConnection, transaction, type OpenAIAttempt, type StoredConnection } from "./storage";

const alice = "a".repeat(64), bob = "b".repeat(64);
const issuer = "https://auth.openai.com";
const client = "oaiapp_test";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const discovery = {
  issuer, authorization_endpoint: `${issuer}/api/accounts/authorize`, token_endpoint: `${issuer}/api/accounts/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/api/accounts/oauth/revoke`,
};
let directory: string;
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
let tokenReply: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  keyPair = await generateKeyPair("RS256");
  jwks = { keys: [{ ...await exportJWK(keyPair.publicKey), kid: "test-key", alg: "RS256", use: "sig" }] };
});
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "openstudio-openai-"));
  vi.stubEnv("OPENSTUDIO_DATA_DIR", directory);
  vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64));
  vi.stubEnv("OPENSTUDIO_BACKEND_ORIGIN", "http://127.0.0.1:4567");
  fetchMock = vi.fn(async (input: string) => {
    if (String(input).includes("openid-configuration")) return Response.json(discovery);
    if (String(input).includes("jwks.json")) return Response.json(jwks);
    if (String(input).includes("oauth/token")) return Response.json(tokenReply);
    throw new Error("Unexpected outbound request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

async function jwt(nonce: string, subject = "alice", audience = client) {
  return new SignJWT({ nonce, email: "alice@example.test" }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime("1h").sign(keyPair.privateKey);
}
async function begin() {
  const result = await startOpenAI(alice);
  const url = new URL(result.authorizationUrl!);
  tokenReply = { access_token: "secret-access", refresh_token: "secret-refresh", id_token: await jwt(url.searchParams.get("nonce")!), expires_in: 3600, scope, token_type: "Bearer" };
  const callback = new URL("http://127.0.0.1:4567/auth/callback");
  callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code", client_id: client }).toString();
  return { result, url, callback };
}

describe("ChatGPT dynamic OAuth", () => {
  it("keeps localhost through authorization and token exchange", async () => {
    const result = await startOpenAI(alice, undefined, "localhost"), url = new URL(result.authorizationUrl!);
    const redirect = "http://localhost:4567/auth/callback";
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    tokenReply = { access_token: "secret-access", refresh_token: "secret-refresh", id_token: await jwt(url.searchParams.get("nonce")!), expires_in: 3600, scope, token_type: "Bearer" };
    const callback = new URL(redirect); callback.search = new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code", client_id: client }).toString();
    expect((await completeOpenAI(alice, callback)).ok).toBe(true);
    const exchange = fetchMock.mock.calls.find(([url]) => String(url).includes("oauth/token"));
    expect(new URLSearchParams((exchange as unknown as [string, RequestInit])[1].body as string).get("redirect_uri")).toBe(redirect);
  });
  it("registers OpenStudio itself with PKCE, a stable host, and the actual 4xxx callback", async () => {
    const first = await begin();
    const next = new URL((await startOpenAI(alice)).authorizationUrl!);
    expect(first.url.origin).toBe(issuer);
    expect(first.url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(first.url.searchParams.get("agent_name_hint")).toBe("OpenStudio");
    expect(first.url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4567/auth/callback");
    expect(first.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.url.searchParams.get("ext_agent_host_id")).toBe(next.searchParams.get("ext_agent_host_id"));
    expect(first.url.searchParams.get("state")).not.toBe(next.searchParams.get("state"));
    expect(first.url.searchParams.has("code_verifier")).toBe(false);
    expect(JSON.stringify(first.result)).not.toContain("verifier");
  });

  it("rejects wrong-session, missing, expired and replayed state before exchanging codes", async () => {
    const { result, callback } = await begin();
    await expect(completeOpenAI(bob, callback)).rejects.toMatchObject({ code: "invalid_state" });
    const wrong = new URL(callback); wrong.searchParams.set("state", "wrong");
    await expect(completeOpenAI(alice, wrong)).rejects.toMatchObject({ code: "invalid_state" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth/token"))).toHaveLength(0);
    expect((await completeOpenAI(alice, callback)).ok).toBe(true);
    await expect(completeOpenAI(alice, callback)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await openaiAttemptStatus(alice, result.id)).status).toBe("connected");
    const second = await begin();
    await transaction(alice, (data) => { data.openaiAttempts!.find((item) => item.id === second.result.id)!.expiresAt = Date.now() - 1; });
    await expect(completeOpenAI(alice, second.callback)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("verifies signature, nonce and audience; stores issued client separately from credentials", async () => {
    const { callback, result } = await begin();
    expect((await completeOpenAI(alice, callback)).ok).toBe(true);
    const [connection] = await transaction(alice, (data) => data.connections);
    expect(connection).toMatchObject({ clientId: client, subject: "alice", secret: "secret-access", planEnabled: true, models: [] });
    const safe = JSON.stringify(publicConnection(connection));
    for (const value of ["secret-access", "secret-refresh", "idToken", "subject", "clientId"]) expect(safe).not.toContain(value);
    const status = JSON.stringify(await openaiAttemptStatus(alice, result.id));
    expect(status).not.toContain("verifier"); expect(status).not.toContain("secret");
    await expect(verifyIdentity(await jwt("right"), client, "wrong", createLocalJWKSet(jwks))).rejects.toThrow();
    await expect(verifyIdentity(await jwt("right", "alice", "other"), client, "right", createLocalJWKSet(jwks))).rejects.toThrow();
    const other = await generateKeyPair("RS256");
    const invalid = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience(client).setSubject("alice").setIssuedAt().setExpirationTime("1h").sign(other.privateKey);
    await expect(verifyIdentity(invalid, client, "right", createLocalJWKSet(jwks))).rejects.toThrow();
  });

  it("does not equate identity-only sign-in with plan permission", async () => {
    const { callback } = await begin();
    tokenReply.scope = "openid profile email";
    const result = await completeOpenAI(alice, callback);
    expect(result).toMatchObject({ ok: true, connection: { planEnabled: false } });
    const [connection] = await transaction(alice, (data) => data.connections);
    await expect(refreshOpenAI(connection)).rejects.toMatchObject({ code: "plan_permission_required" });
  });

  it("handles denial, cancellation and incomplete registration without token exchange", async () => {
    const { callback, result } = await begin();
    callback.searchParams.set("error", "access_denied");
    expect((await completeOpenAI(alice, callback)).ok).toBe(false);
    expect((await openaiAttemptStatus(alice, result.id)).status).toBe("failed");
    const second = await begin();
    await openaiAttemptStatus(alice, second.result.id, true);
    await expect(completeOpenAI(alice, second.callback)).rejects.toMatchObject({ code: "invalid_state" });
    const third = await begin(); third.callback.searchParams.delete("client_id");
    expect((await completeOpenAI(alice, third.callback)).ok).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth/token"))).toHaveLength(0);
  });

  it("refreshes once under the storage lock and rotates both tokens", async () => {
    const { callback } = await begin(); await completeOpenAI(alice, callback);
    await transaction(alice, (data) => { data.connections[0].expiresAt = Date.now() - 1; });
    tokenReply = { ...tokenReply, access_token: "rotated-access", refresh_token: "rotated-refresh" };
    await Promise.all([transaction(alice, async (data) => refreshOpenAI(data.connections[0])), transaction(alice, async (data) => refreshOpenAI(data.connections[0]))]);
    const [connection] = await transaction(alice, (data) => data.connections);
    expect(connection).toMatchObject({ secret: "rotated-access", refreshToken: "rotated-refresh" });
    const refreshes = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes("grant_type=refresh_token"));
    expect(refreshes).toHaveLength(1);
  });

  it("reuses a registration when reconnecting, and rejects another identity", async () => {
    const { callback } = await begin(); await completeOpenAI(alice, callback);
    const [connection] = await transaction(alice, (data) => data.connections);
    const start = await startOpenAI(alice, connection.id);
    const url = new URL(start.authorizationUrl!);
    expect(url.searchParams.get("client_id")).toBe(client);
    expect(url.searchParams.has("agent_name_hint")).toBe(false);
    tokenReply.id_token = await jwt(url.searchParams.get("nonce")!, "someone-else");
    const nextCallback = new URL(callback); nextCallback.searchParams.set("state", url.searchParams.get("state")!);
    expect((await completeOpenAI(alice, nextCallback)).ok).toBe(false);
    expect(await transaction(alice, (data) => data.connections[0].subject)).toBe("alice");
  });
});
