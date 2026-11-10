import { z } from "zod";
import { route } from "../http";
import { AppError, transaction } from "../storage";
import { speechVoices } from "../speech";

export const GET = route(async (_request, id) => transaction(id, (data) => ({ textRuns: data.textRuns || [] })));
const operation = z.object({ action: z.literal("voices"), connectionId: z.uuid(), search: z.string().max(200).default(""), cursor: z.string().max(2000).default("") });
export const POST = route(async (request, sessionId) => {
  const input = operation.parse(await request.json());
  return transaction(sessionId, async (data) => {
    const connection = data.connections.find((item) => item.id === input.connectionId && item.status !== "disconnected");
    if (!connection) throw new AppError("연결 계정을 찾을 수 없습니다.", 404);
    return speechVoices(connection, input.search, input.cursor);
  });
}, true);
