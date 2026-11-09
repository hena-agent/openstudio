import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clientId, copilotEndpoint, githubHeaders, requestJSON } from "./providers";
import { AppError, publicConnection, transaction } from "./storage";

const deviceResponse = z.object({
  device_code: z.string(), user_code: z.string(), verification_uri: z.url(),
  expires_in: z.number().positive(), interval: z.number().positive().default(5),
});
const tokenResponse = z.object({ access_token: z.string().optional(), error: z.string().optional(), interval: z.number().positive().optional() });

export async function startDevice(sessionId: string) {
  const id = clientId();
  return transaction(sessionId, async (data) => {
    // The lock also prevents double-clicks from issuing two device requests.
    const existing = data.pending.find((item) => item.expiresAt > Date.now());
    if (existing) {
      const { deviceCode: _, accessToken: __, nextPollAt: ___, processing: ____, ...safe } = existing;
      return safe;
    }
    const raw = await requestJSON("https://github.com/login/device/code", {
      method: "POST", headers: githubHeaders,
      body: JSON.stringify({ client_id: id, scope: "read:user" }),
    });
    if (raw.error) throw new AppError("OAuth 앱의 device flow 설정과 client ID를 확인해 주세요.", 502, "oauth_configuration");
    const device = deviceResponse.parse(raw);
    if (device.verification_uri !== "https://github.com/login/device") throw new AppError("GitHub 인증 주소가 올바르지 않습니다.", 502);
    const authorization = {
      id: randomUUID(), userCode: device.user_code, verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000, interval: device.interval * 1000,
    };
    data.pending = [{ ...authorization, deviceCode: device.device_code, nextPollAt: Date.now() + authorization.interval }];
    return authorization;
  });
}

export async function pollDevice(sessionId: string, id: string) {
  const oauthClient = clientId();
  return transaction(sessionId, async (data) => {
    const pending = data.pending.find((item) => item.id === id);
    if (!pending) throw new AppError("진행 중인 인증을 찾을 수 없습니다. 다시 시작해 주세요.", 404, "not_found");
    if (Date.now() >= pending.expiresAt) {
      data.pending = [];
      return { status: "expired" as const, error: "인증 코드가 만료되었습니다. 다시 연결해 주세요." };
    }
    if (Date.now() < pending.nextPollAt) return { status: "pending" as const, interval: pending.nextPollAt - Date.now() };
    pending.nextPollAt = Date.now() + pending.interval;
    try {
      if (!pending.accessToken) {
        const token = tokenResponse.parse(await requestJSON("https://github.com/login/oauth/access_token", {
          method: "POST", headers: githubHeaders,
          body: JSON.stringify({ client_id: oauthClient, device_code: pending.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
        }));
        if (token.error === "authorization_pending") return { status: "pending" as const, interval: pending.interval };
        if (token.error === "slow_down") {
          pending.interval = Math.max(pending.interval + 5000, (token.interval || 0) * 1000);
          pending.nextPollAt = Date.now() + pending.interval;
          return { status: "pending" as const, interval: pending.interval };
        }
        if (!token.access_token) {
          data.pending = [];
          return { status: "denied" as const, error: token.error === "expired_token" ? "인증 코드가 만료되었습니다." : "인증이 거절되거나 중단되었습니다. 다시 연결해 주세요." };
        }
        // Preserve a successfully exchanged token if subsequent account lookup fails.
        pending.accessToken = token.access_token;
      }
      const headers = { ...githubHeaders, Authorization: `Bearer ${pending.accessToken}` };
      const user = z.object({ login: z.string() }).parse(await requestJSON("https://api.github.com/user", { headers }));
      let baseURL = "https://api.githubcopilot.com";
      // A GitHub login is not proof of entitlement. Retain authentication separately.
      let entitlement: "available" | "denied" | "unknown" = "unknown";
      try {
        const account = z.object({ chat_enabled: z.boolean().optional(), endpoints: z.object({ api: z.string().optional() }).optional() }).parse(
          await requestJSON("https://api.github.com/copilot_internal/user", { headers: { ...headers, "X-GitHub-Api-Version": "2025-04-01" } }),
        );
        baseURL = copilotEndpoint(account.endpoints?.api);
        entitlement = account.chat_enabled === false ? "denied" : account.chat_enabled === true ? "available" : "unknown";
      } catch { /* The subsequent model lookup is the authoritative capability check. */ }
      const connection = {
        id: randomUUID(), provider: "github-copilot" as const, label: user.login, method: "oauth" as const,
        createdAt: new Date().toISOString(), models: [], secret: pending.accessToken, baseURL,
      };
      data.connections.push(connection);
      data.pending = [];
      return { status: "connected" as const, connection: publicConnection(connection), entitlement };
    } catch (error) {
      // Persist polling backoff and any exchanged token without leaking upstream bodies.
      return { status: "retry" as const, interval: pending.interval, error: error instanceof AppError ? error.message : "계정 확인에 실패했습니다. 다시 확인합니다." };
    }
  });
}
