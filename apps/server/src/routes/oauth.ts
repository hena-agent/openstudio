import { z } from "zod";
import { frontendOrigin, route } from "../http";
import { pollDevice, startDevice } from "../oauth";
import { transaction } from "../storage";
import { startOpenAI, openaiAttemptStatus } from "../openai-oauth";
import { startOpenRouter, openRouterStatus } from "../openrouter-oauth";

const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), id: z.uuid() }),
  z.object({ action: z.literal("cancel"), id: z.uuid() }),
  z.object({ action: z.literal("openai-start"), connectionId: z.uuid().optional() }),
  z.object({ action: z.literal("openai-status"), id: z.uuid() }),
  z.object({ action: z.literal("openai-cancel"), id: z.uuid() }),
  z.object({ action: z.literal("openrouter-start") }),
  z.object({ action: z.literal("openrouter-status"), id: z.uuid() }),
  z.object({ action: z.literal("openrouter-cancel"), id: z.uuid() }),
]);
export const POST = route(async (request, sessionId) => {
  const input = operation.parse(await request.json());
  const callbackHost = frontendOrigin(request).hostname === "localhost" ? "localhost" as const : undefined;
  if (input.action === "openrouter-start") return startOpenRouter(sessionId, callbackHost);
  if (input.action === "openrouter-status" || input.action === "openrouter-cancel") return openRouterStatus(sessionId, input.id, input.action === "openrouter-cancel");
  if (input.action === "openai-start") return startOpenAI(sessionId, input.connectionId, callbackHost);
  if (input.action === "openai-status" || input.action === "openai-cancel") return openaiAttemptStatus(sessionId, input.id, input.action === "openai-cancel");
  if (input.action === "start") return startDevice(sessionId);
  if (input.action === "poll") return pollDevice(sessionId, input.id);
  return transaction(sessionId, (data) => {
    data.pending = data.pending.filter((item) => item.id !== input.id);
    return { cancelled: true };
  });
}, true);
