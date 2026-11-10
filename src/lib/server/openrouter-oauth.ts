import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, transaction, type OpenRouterAttempt, type Workspace } from "./storage";
import { requestJSON } from "./providers";
import { connectionForKey, validateExtraKey } from "./additional-providers";

function publicAttempt(attempt: OpenRouterAttempt) {
  return { id: attempt.id, expiresAt: attempt.expiresAt, status: attempt.status, error: attempt.error, connectionId: attempt.connectionId };
}
async function finishKey(data: Workspace, attempt: OpenRouterAttempt) {
  const connection = connectionForKey("openrouter", attempt.exchangedKey!, `OpenRouter · ${attempt.id.slice(0, 6)}`, randomUUID());
  connection.method = "oauth";
  await validateExtraKey(connection);
  connection.credentialVerifiedAt = new Date().toISOString(); connection.modelSource = "public-catalog";
  data.connections.push(connection);
  attempt.connectionId = connection.id; attempt.status = "connected"; attempt.verifier = ""; delete attempt.exchangedKey; delete attempt.error;
}
export async function startOpenRouter(sessionId: string, callbackHost?: "localhost") {
  const configured = process.env.OPENSTUDIO_BACKEND_ORIGIN;
  if (!configured) throw new AppError("백엔드 주소를 확인할 수 없습니다.", 503);
  const backend = new URL(configured);
  if (callbackHost) backend.hostname = callbackHost;
  return transaction(sessionId, (data) => {
    const verifier = randomBytes(48).toString("base64url");
    const attempt: OpenRouterAttempt = { id: randomUUID(), verifier, state: randomBytes(32).toString("base64url"), status: "pending", expiresAt: Date.now() + 10 * 60_000 };
    data.routerAttempts = (data.routerAttempts || []).filter((old) => old.status !== "pending" && old.expiresAt > Date.now());
    data.routerAttempts.push(attempt);
    const url = new URL("https://openrouter.ai/auth");
    url.search = new URLSearchParams({ callback_url: `${backend.origin}/auth/openrouter/callback`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: attempt.state, key_label: "OpenStudio" }).toString();
    return { ...publicAttempt(attempt), authorizationUrl: url.toString() };
  });
}
export async function completeOpenRouter(sessionId: string, callback: URL) {
  return transaction(sessionId, async (data) => {
    const attempt = data.routerAttempts?.find((attempt) => attempt.state === callback.searchParams.get("state"));
    if (!attempt || attempt.consumed || attempt.status !== "pending" || attempt.expiresAt <= Date.now()) throw new AppError("OpenRouter 인증이 만료되었거나 이미 처리되었습니다.", 400, "invalid_state");
    attempt.consumed = true;
    attempt.status = "failed";
    try {
      if (callback.searchParams.has("error")) throw new AppError("OpenRouter 인증이 거절되었습니다.", 400, "access_denied");
      const code = callback.searchParams.get("code");
      if (!code) throw new AppError("OpenRouter 인증 코드가 없습니다.");
      const response = z.object({ key: z.string().min(1) }).parse(await requestJSON("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: attempt.verifier, code_challenge_method: "S256" }),
      }));
      // Save the minted key even if the subsequent account check is temporarily unavailable.
      attempt.exchangedKey = response.key;
      await finishKey(data, attempt);
      return { ok: true };
    } catch (error) {
      attempt.verifier = "";
      attempt.error = error instanceof AppError ? error.message : "OpenRouter 인증 결과를 확인하지 못했습니다.";
      if (attempt.exchangedKey) attempt.status = "pending";
      return { ok: false };
    }
  });
}
export async function openRouterStatus(sessionId: string, id: string, cancel = false) {
  return transaction(sessionId, async (data) => {
    const attempt = data.routerAttempts?.find((attempt) => attempt.id === id);
    if (!attempt) throw new AppError("이 브라우저의 OpenRouter 인증 요청을 찾을 수 없습니다.", 404);
    if (cancel && attempt.status === "pending") { attempt.status = "cancelled"; attempt.verifier = ""; }
    if (attempt.status === "pending" && attempt.expiresAt <= Date.now()) { attempt.status = "failed"; attempt.error = "OpenRouter 인증이 만료되었습니다."; attempt.verifier = ""; }
    if (attempt.status === "pending" && attempt.exchangedKey) {
      try { await finishKey(data, attempt); } catch { attempt.error = "키 교환은 완료됐지만 계정 확인을 기다리고 있습니다. 잠시 후 다시 확인합니다."; }
    }
    return publicAttempt(attempt);
  });
}
