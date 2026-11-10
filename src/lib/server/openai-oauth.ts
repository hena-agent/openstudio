import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { requestJSON } from "./providers";
import { AppError, hostId, publicConnection, transaction, type OpenAIAttempt, type StoredConnection } from "./storage";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const permission = "chatgpt.tokens.use.direct";
const scopes = `openid profile email offline_access resource.invoke ${permission}`;
const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), id_token: z.string().min(1),
  expires_in: z.number().positive(), scope: z.string(), token_type: z.string().refine((value) => value.toLowerCase() === "bearer"), earliest_refresh_at: z.number().optional(),
});
const discoverySchema = z.object({ issuer: z.literal(issuer), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(), revocation_endpoint: z.url() });
type Discovery = z.infer<typeof discoverySchema>;
let cached: { data: Discovery; expires: number } | undefined;
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function openaiConfiguration(): Promise<Discovery> {
  if (cached && cached.expires > Date.now()) return cached.data;
  const data = discoverySchema.parse(await requestJSON(`${issuer}/.well-known/openid-configuration`));
  for (const endpoint of [data.authorization_endpoint, data.token_endpoint, data.jwks_uri, data.revocation_endpoint]) {
    const url = new URL(endpoint);
    if (url.origin !== issuer || url.username || url.password) throw new AppError("OpenAI 인증 endpoint를 확인할 수 없습니다.", 502, "invalid_endpoint");
  }
  cached = { data, expires: Date.now() + 60 * 60 * 1000 };
  return data;
}

export async function verifyIdentity(token: string, clientId: string, nonce?: string, keySet?: JWTVerifyGetKey) {
  if (!keySet) {
    const { jwks_uri } = await openaiConfiguration();
    if (!keys.has(jwks_uri)) keys.set(jwks_uri, createRemoteJWKSet(new URL(jwks_uri), { timeoutDuration: 10_000 }));
    keySet = keys.get(jwks_uri)!;
  }
  const { payload } = await jwtVerify(token, keySet, { issuer, audience: clientId, requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5, algorithms: ["RS256", "ES256"] });
  if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new AppError("OpenAI 계정 검증에 실패했습니다. 다시 로그인하세요.", 401, "invalid_identity");
  return payload;
}

function publicAttempt(attempt: OpenAIAttempt, authorizationUrl?: string) {
  return { id: attempt.id, status: attempt.status, expiresAt: attempt.expiresAt, error: attempt.error, connectionId: attempt.connectionId, authorizationUrl };
}

export async function startOpenAI(sessionId: string, connectionId?: string, callbackHost?: "localhost") {
  const config = await openaiConfiguration();
  const backend = new URL(process.env.OPENSTUDIO_BACKEND_ORIGIN || "http://127.0.0.1:4001");
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || Number(backend.port) < 4001 || Number(backend.port) > 4999) {
    throw new AppError("ChatGPT 직접 등록은 127.0.0.1의 4xxx 백엔드에서 시작해야 합니다.", 503, "loopback_required");
  }
  if (callbackHost) backend.hostname = callbackHost;
  const host = await hostId();
  return transaction(sessionId, (data) => {
    const account = connectionId ? data.connections.find((item) => item.id === connectionId && item.provider === "openai" && item.method === "oauth") : undefined;
    if (connectionId && !account) throw new AppError("다시 연결할 계정을 찾을 수 없습니다.", 404);
    const clientId = account?.clientId || "dynamic_agent_client";
    const verifier = randomBytes(48).toString("base64url");
    const attempt: OpenAIAttempt = {
      id: randomUUID(), state: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"), verifier,
      redirectUri: `${backend.origin}/auth/callback`, expiresAt: Date.now() + 10 * 60 * 1000,
      clientId, connectionId, status: "pending",
    };
    // A new attempt invalidates an older pending flow for this browser, never another account's credentials.
    data.openaiAttempts = (data.openaiAttempts || []).filter((item) => item.status !== "pending" && item.expiresAt > Date.now());
    data.openaiAttempts.push(attempt);
    const url = new URL(config.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId, ...(clientId === "dynamic_agent_client" ? { agent_name_hint: "OpenStudio" } : {}),
      ext_agent_host_id: host, response_type: "code", redirect_uri: attempt.redirectUri,
      scope: scopes, resource, state: attempt.state, nonce: attempt.nonce,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    return publicAttempt(attempt, url.toString());
  });
}

function matchingState(expected: string, actual: string) {
  const left = Buffer.from(expected), right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function completeOpenAI(sessionId: string, callback: URL) {
  return transaction(sessionId, async (data) => {
    const state = callback.searchParams.get("state") || "";
    const attempt = data.openaiAttempts?.find((item) => matchingState(item.state, state));
    if (!attempt || attempt.status !== "pending" || attempt.expiresAt <= Date.now()) throw new AppError("인증 요청이 만료되었거나 이미 처리되었습니다. 앱에서 다시 로그인하세요.", 400, "invalid_state");
    attempt.status = "failed"; // Consume once, including denial and code-exchange failure.
    try {
      if (callback.searchParams.has("error")) throw new AppError("ChatGPT 인증이 거절되었습니다. 계정의 앱 권한 설정을 확인하세요.", 400, "access_denied");
      const code = callback.searchParams.get("code");
      const issuedClient = callback.searchParams.get("client_id");
      if (!code || (attempt.clientId === "dynamic_agent_client" && (!issuedClient || issuedClient === "dynamic_agent_client")) ||
        (attempt.clientId !== "dynamic_agent_client" && issuedClient && issuedClient !== attempt.clientId)) {
        throw new AppError("OpenAI 등록 결과의 code 또는 client ID가 유효하지 않습니다.", 400, "incomplete_registration");
      }
      const clientId = issuedClient || attempt.clientId;
      attempt.clientId = clientId;
      const config = await openaiConfiguration();
      const tokens = tokenSchema.parse(await requestJSON(config.token_endpoint, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource }).toString(),
      }));
      const identity = await verifyIdentity(tokens.id_token, clientId, attempt.nonce);
      const existing = attempt.connectionId ? data.connections.find((item) => item.id === attempt.connectionId) : undefined;
      if (existing && (existing.subject !== identity.sub || existing.clientId !== clientId)) throw new AppError("선택한 계정과 다른 계정입니다. 새 연결로 추가하세요.", 401, "account_mismatch");
      const grantedScopes = tokens.scope.split(/\s+/).filter(Boolean);
      const connection: StoredConnection = {
        id: existing?.id || randomUUID(), provider: "openai", method: "oauth",
        label: `${typeof identity.email === "string" ? identity.email : typeof identity.name === "string" ? identity.name : "ChatGPT"} · ${clientId.slice(-6)}`,
        createdAt: existing?.createdAt || new Date().toISOString(), status: "connected", models: [],
        secret: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
        expiresAt: Date.now() + tokens.expires_in * 1000, earliestRefreshAt: tokens.earliest_refresh_at ? tokens.earliest_refresh_at * 1000 : undefined,
        clientId, subject: identity.sub, scopes: grantedScopes, planEnabled: grantedScopes.includes(permission), baseURL: resource,
      };
      if (existing) Object.assign(existing, connection);
      else data.connections.push(connection);
      attempt.status = "connected";
      attempt.connectionId = connection.id;
      attempt.clientId = clientId;
      attempt.verifier = "";
      return { ok: true, connection: publicConnection(connection) };
    } catch (error) {
      attempt.verifier = "";
      attempt.error = error instanceof AppError ? error.message : "OpenAI 토큰 또는 계정 검증에 실패했습니다. 다시 로그인하세요.";
      return { ok: false, error: attempt.error };
    }
  });
}

export async function openaiAttemptStatus(sessionId: string, id: string, cancel = false) {
  return transaction(sessionId, (data) => {
    const attempt = data.openaiAttempts?.find((item) => item.id === id);
    if (!attempt) throw new AppError("이 브라우저의 인증 요청을 찾을 수 없습니다.", 404);
    if (cancel && attempt.status === "pending") { attempt.status = "cancelled"; attempt.verifier = ""; }
    if (attempt.status === "pending" && attempt.expiresAt <= Date.now()) { attempt.status = "failed"; attempt.error = "인증 요청이 만료되었습니다."; attempt.verifier = ""; }
    return publicAttempt(attempt);
  });
}

export async function refreshOpenAI(connection: StoredConnection) {
  if (connection.provider !== "openai" || connection.method !== "oauth") return;
  if (connection.status === "disconnected" || !connection.refreshToken || !connection.clientId) throw new AppError("ChatGPT 계정을 다시 연결하세요.", 401, "reconnect_required");
  if (!connection.planEnabled) throw new AppError("로그인은 완료됐지만 ChatGPT 구독 사용 권한이 허용되지 않았습니다. 다시 연결해 권한을 승인하세요.", 403, "plan_permission_required");
  if ((connection.expiresAt || 0) > Date.now() + 60_000) return;
  if (connection.earliestRefreshAt && Date.now() < connection.earliestRefreshAt) throw new AppError("제공자가 허용한 토큰 갱신 시간 전입니다. 잠시 후 다시 시도하세요.", 429, "refresh_too_early");
  const config = await openaiConfiguration();
  const raw = await requestJSON(config.token_endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.refreshToken, resource }).toString(),
  });
  const tokens = tokenSchema.omit({ id_token: true, scope: true }).extend({ id_token: z.string().optional(), scope: z.string().optional() }).parse(raw);
  if (tokens.id_token) {
    const identity = await verifyIdentity(tokens.id_token, connection.clientId);
    if (identity.sub !== connection.subject) throw new AppError("토큰 갱신 중 계정이 변경되었습니다. 다시 로그인하세요.", 401, "account_mismatch");
  }
  // Caller holds the session transaction lock; rotating refresh tokens are saved atomically.
  connection.secret = tokens.access_token;
  connection.refreshToken = tokens.refresh_token;
  connection.idToken = tokens.id_token || connection.idToken;
  connection.expiresAt = Date.now() + tokens.expires_in * 1000;
  connection.earliestRefreshAt = tokens.earliest_refresh_at ? tokens.earliest_refresh_at * 1000 : undefined;
  if (tokens.scope) connection.scopes = tokens.scope.split(/\s+/);
  connection.planEnabled = connection.scopes?.includes(permission) || false;
  if (!connection.planEnabled) throw new AppError("갱신된 토큰에 구독 사용 권한이 없습니다. 다시 연결하세요.", 403, "plan_permission_required");
}

export async function revokeOpenAI(connection: StoredConnection) {
  if (!connection.refreshToken || !connection.clientId) return true;
  try {
    const config = await openaiConfiguration();
    const response = await fetch(config.revocation_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ token: connection.refreshToken, token_type_hint: "refresh_token", client_id: connection.clientId }),
    });
    return response.ok;
  } catch { return false; }
}
