import { randomUUID } from "node:crypto";
import { z } from "zod";
import { route } from "../http";
import { AppError, publicConnection, transaction } from "../storage";
import { discover, invoke } from "../providers";
import { refreshOpenAI, revokeOpenAI } from "../openai-oauth";

export const GET = route(async (_request, sessionId) => {
  const storageReady = /^[a-f0-9]{64}$/i.test(process.env.OPENSTUDIO_ENCRYPTION_KEY || "");
  const connections = storageReady ? await transaction(sessionId, (data) => data.connections.map(publicConnection)) : [];
  return { connections, storageReady, oauthReady: storageReady && !!process.env.GITHUB_COPILOT_CLIENT_ID,
    frontend: process.env.OPENSTUDIO_FRONTEND_ORIGIN, backend: process.env.OPENSTUDIO_BACKEND_ORIGIN,
    openaiOAuthReady: storageReady,
  };
});

const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add-key"), key: z.string().trim().min(10).max(1000), label: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("disconnect"), id: z.uuid() }),
  z.object({ action: z.literal("models"), id: z.uuid() }),
  z.object({ action: z.literal("invoke"), id: z.uuid(), model: z.string().min(1).max(200), prompt: z.string().trim().min(1).max(4000), consent: z.literal(true) }),
]);

export const POST = route(async (request, sessionId) => {
  const input = operation.parse(await request.json());
  const result = await transaction(sessionId, async (data) => {
    try {
    if (input.action === "add-key") {
      const connection = {
        id: randomUUID(), provider: "openai" as const, label: input.label, method: "api-key" as const,
        createdAt: new Date().toISOString(), models: [], secret: input.key, baseURL: "https://api.openai.com/v1",
      };
      const models = await discover(connection);
      const saved = { ...connection, models, modelsCheckedAt: new Date().toISOString() };
      data.connections.push(saved);
      return { connection: publicConnection(saved) };
    }
    const connection = data.connections.find((item) => item.id === input.id);
    if (!connection) throw new AppError("연결을 찾을 수 없습니다.", 404, "not_found");
    if (input.action === "disconnect") {
      const revoked = connection.provider === "openai" && connection.method === "oauth" ? await revokeOpenAI(connection) : false;
      if (connection.provider === "openai" && connection.method === "oauth") {
        // Retain the issued client/account registration for later reauthorization.
        connection.secret = ""; delete connection.refreshToken; delete connection.idToken;
        delete connection.expiresAt; delete connection.earliestRefreshAt; delete connection.verifiedAt;
        connection.models = []; delete connection.modelsCheckedAt; connection.status = "disconnected";
      } else data.connections = data.connections.filter((item) => item.id !== input.id);
      return { disconnected: true, revoked };
    }
    await refreshOpenAI(connection);
    if (input.action === "models") {
      connection.models = await discover(connection);
      connection.modelsCheckedAt = new Date().toISOString();
      return { connection: publicConnection(connection) };
    }
    const model = connection.models.find((item) => item.id === input.model);
    if (!model) throw new AppError("먼저 계정의 모델 목록을 조회하고 모델을 선택해 주세요.");
    const result = await invoke(connection, model, input.prompt);
    connection.verifiedAt = new Date().toISOString();
    return { ...result, connection: publicConnection(connection) };
    } catch (error) { return { fault: error }; }
  });
  // Commit a rotated refresh token even when the later provider call fails.
  if ("fault" in result) throw result.fault;
  return result;
}, true);
