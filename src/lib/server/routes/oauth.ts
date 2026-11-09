import { z } from "zod";
import { route } from "../http";
import { pollDevice, startDevice } from "../oauth";
import { transaction } from "../storage";
import { startOpenAI, openaiAttemptStatus } from "../openai-oauth";

const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), id: z.uuid() }),
  z.object({ action: z.literal("cancel"), id: z.uuid() }),
  z.object({ action: z.literal("openai-start"), connectionId: z.uuid().optional() }),
  z.object({ action: z.literal("openai-status"), id: z.uuid() }),
  z.object({ action: z.literal("openai-cancel"), id: z.uuid() }),
]);
export const POST = route(async (request, sessionId) => {
  const input = operation.parse(await request.json());
  if (input.action === "openai-start") return startOpenAI(sessionId, input.connectionId);
  if (input.action === "openai-status" || input.action === "openai-cancel") return openaiAttemptStatus(sessionId, input.id, input.action === "openai-cancel");
  if (input.action === "start") return startDevice(sessionId);
  if (input.action === "poll") return pollDevice(sessionId, input.id);
  return transaction(sessionId, (data) => {
    data.pending = data.pending.filter((item) => item.id !== input.id);
    return { cancelled: true };
  });
}, true);
