import { randomUUID } from "node:crypto";
import { z } from "zod";
import { route } from "../http";
import { AppError, publicConnection, transaction } from "../storage";
import { discover, invoke } from "../providers";
import { refreshOpenAI, revokeOpenAI } from "../openai-oauth";
import { PROVIDERS } from "../../provider-registry";
import { connectionForKey, enrichMediaModel } from "../additional-providers";
import { byteplusSettingsSchema, BYTEPLUS_BASE_URL } from "../../byteplus-config";
import { falSettingsSchema } from "../../fal-config";
import { discoverFal, falSearchSchema, searchFalModels } from "../fal";

export const GET = route(async (_request, sessionId) => {
  const storageReady = /^[a-f0-9]{64}$/i.test(process.env.OPENSTUDIO_ENCRYPTION_KEY || "");
  const connections = storageReady ? await transaction(sessionId, (data) => data.connections.map(publicConnection)) : [];
  return { connections, storageReady, oauthReady: storageReady && !!process.env.GITHUB_COPILOT_CLIENT_ID,
    frontend: process.env.OPENSTUDIO_FRONTEND_ORIGIN, backend: process.env.OPENSTUDIO_BACKEND_ORIGIN,
    openaiOAuthReady: storageReady,
    providers: PROVIDERS,
  };
});

const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add-key"), provider: z.enum(["openai", "anthropic", "google", "openrouter", "fal", "byteplus", "xai", "deepseek", "groq", "mistral", "elevenlabs"]).default("openai"), key: z.string().trim().min(10).max(1000), label: z.string().trim().min(1).max(80), byteplus: byteplusSettingsSchema.optional(), fal: falSettingsSchema.optional() }),
  z.object({ action: z.literal("fal-settings"), id: z.uuid(), fal: falSettingsSchema }),
  z.object({ action: z.literal("byteplus-settings"), id: z.uuid(), byteplus: byteplusSettingsSchema }),
  z.object({ action: z.literal("disconnect"), id: z.uuid() }),
  z.object({ action: z.literal("models"), id: z.uuid() }),
  z.object({ action: z.literal("update-key"), id: z.uuid(), key: z.string().trim().min(10).max(1000) }),
  z.object({ action: z.literal("model-info"), id: z.uuid(), model: z.string().min(1).max(300) }),
  z.object({ action: z.literal("search-models"), id: z.uuid(), ...falSearchSchema.shape }),
  z.object({ action: z.literal("invoke"), id: z.uuid(), model: z.string().min(1).max(200), prompt: z.string().trim().min(1).max(4000), consent: z.literal(true) }),
]);

export const POST = route(async (request, sessionId) => {
  const input = operation.parse(await request.json());
  const result = await transaction(sessionId, async (data) => {
    const existing = "id" in input ? data.connections.find((item) => item.id === input.id) : undefined;
    try {
    if (input.action === "add-key") {
      const connection = connectionForKey(input.provider, input.key, input.label, randomUUID());
      if (input.provider === "byteplus") connection.byteplus = byteplusSettingsSchema.parse(input.byteplus || {});
      if (input.provider === "fal") connection.fal = falSettingsSchema.parse(input.fal || {});
      const models = await discover(connection);
      const saved = { ...connection, models, modelsCheckedAt: new Date().toISOString(), credentialVerifiedAt: new Date().toISOString(), modelSource: ["openrouter", "fal"].includes(connection.provider) ? "public-catalog" as const : "account" as const };
      data.connections.push(saved);
      return { connection: publicConnection(saved) };
    }
    const connection = data.connections.find((item) => item.id === input.id);
    if (!connection) throw new AppError("연결을 찾을 수 없습니다.", 404, "not_found");
    if (input.action === "search-models") {
      if (connection.provider !== "fal" || connection.status === "disconnected") throw new AppError("연결된 fal.ai 계정에서 모델을 검색하세요.");
      const page = await searchFalModels(input, connection);
      const inventory = new Map(connection.models.map((model) => [model.id, model]));
      for (const model of page.models) inventory.set(model.id, inventory.get(model.id) || model);
      connection.models = [...inventory.values()];
      return { ...page, connection: publicConnection(connection) };
    }
    if (input.action === "fal-settings") {
      if (connection.provider !== "fal") throw new AppError("fal.ai 계정에서만 사용할 수 있는 설정입니다.");
      const candidate = { ...connection, fal: input.fal };
      const models = await discoverFal(candidate, true);
      connection.fal = input.fal; connection.models = models; connection.modelsCheckedAt = new Date().toISOString();
      return { connection: publicConnection(connection) };
    }
    if (input.action === "byteplus-settings") {
      if (connection.provider !== "byteplus") throw new AppError("BytePlus 계정에서만 사용할 수 있는 설정입니다.");
      const candidate = { ...connection, byteplus: input.byteplus, baseURL: BYTEPLUS_BASE_URL };
      const models = await discover(candidate);
      connection.byteplus = input.byteplus; connection.baseURL = candidate.baseURL; connection.models = models; connection.modelsCheckedAt = new Date().toISOString();
      return { connection: publicConnection(connection) };
    }
    if (input.action === "update-key") {
      if (connection.method !== "api-key") throw new AppError("OAuth 계정은 제공자 로그인으로 다시 연결하세요.");
      const replacement = { ...connection, secret: input.key };
      const models = await discover(replacement);
      connection.secret = input.key; connection.models = models; connection.modelsCheckedAt = new Date().toISOString(); connection.credentialVerifiedAt = connection.modelsCheckedAt;
      delete connection.connectionIssue;
      return { connection: publicConnection(connection) };
    }
    if (input.action === "disconnect") {
      if (data.jobs?.some((job) => job.connectionId === connection.id && !["completed", "failed", "unknown"].includes(job.status))) throw new AppError("진행 중인 미디어 작업의 결과를 확보한 뒤 연결을 해제하세요.", 409, "active_jobs");
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
      connection.credentialVerifiedAt = connection.modelsCheckedAt; delete connection.connectionIssue;
      return { connection: publicConnection(connection) };
    }
    const model = connection.models.find((item) => item.id === input.model);
    if (!model) throw new AppError("먼저 계정의 모델 목록을 조회하고 모델을 선택해 주세요.");
    if (input.action === "model-info") {
      await enrichMediaModel(connection, model);
      return { connection: publicConnection(connection) };
    }
    const result = await invoke(connection, model, input.prompt);
    connection.verifiedAt = new Date().toISOString();
    delete connection.connectionIssue;
    (data.textRuns ??= []).unshift({ id: randomUUID(), model: model.name, prompt: input.prompt, text: result.text, createdAt: connection.verifiedAt });
    return { ...result, connection: publicConnection(connection) };
    } catch (error) {
      if (existing && ["models", "invoke", "model-info", "search-models"].includes(input.action) && error instanceof AppError) {
        existing.connectionIssue = { kind: ["authentication_failed", "reconnect_required"].includes(error.code) || error.upstreamStatus === 401 ? "authentication" : ["permission_denied", "plan_permission_required"].includes(error.code) || error.upstreamStatus === 403 ? "permission" : "temporary", message: error.message, checkedAt: new Date().toISOString() };
      }
      return { fault: error };
    }
  });
  // Commit a rotated refresh token even when the later provider call fails.
  if ("fault" in result) throw result.fault;
  return result;
}, true);
