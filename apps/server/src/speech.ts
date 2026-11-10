import { z } from "zod";
import type { Model, Voice } from "@openstudio/shared/types";
import { AppError, type StoredConnection } from "./storage";
import { requestJSON } from "./providers";

const headers = (connection: StoredConnection) => ({ "xi-api-key": connection.secret, "Content-Type": "application/json" });
export async function discoverSpeechModels(connection: StoredConnection): Promise<Model[]> {
  const data = await requestJSON("https://api.elevenlabs.io/v1/models", { headers: headers(connection) });
  return z.array(z.object({ model_id: z.string(), name: z.string(), can_do_text_to_speech: z.boolean(), maximum_text_length_per_request: z.number().optional(), description: z.string().optional() })).parse(data)
    .filter((model) => model.can_do_text_to_speech).map((model) => ({ id: model.model_id, name: model.name, tasks: ["audio"], endpoints: ["/text-to-speech"], callable: true, speech: { maxCharacters: model.maximum_text_length_per_request }, metadata: { input: ["text"], output: ["audio"], description: model.description } }));
}
export async function speechVoices(connection: StoredConnection, search = "", cursor = ""): Promise<{ voices: Voice[]; nextCursor?: string }> {
  if (connection.provider !== "elevenlabs" || connection.status === "disconnected") throw new AppError("음성 계정을 연결하세요.");
  const query = new URLSearchParams({ page_size: "100", ...(search ? { search } : {}), ...(cursor ? { next_page_token: cursor } : {}) });
  const data = z.object({ voices: z.array(z.object({ voice_id: z.string(), name: z.string() })), has_more: z.boolean(), next_page_token: z.string().nullable().optional() }).parse(await requestJSON(`https://api.elevenlabs.io/v2/voices?${query}`, { headers: headers(connection) }));
  return { voices: data.voices.map((voice) => ({ id: voice.voice_id, name: voice.name })), nextCursor: data.has_more ? data.next_page_token || undefined : undefined };
}
export async function synthesizeSpeech(connection: StoredConnection, model: Model, text: string, options: Record<string, unknown>) {
  if (connection.provider !== "elevenlabs" || !model.tasks?.includes("audio")) throw new AppError("이 모델의 TTS 실행을 지원하지 않습니다.");
  const voice = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(options.voice);
  if (text.length > Math.min(model.speech?.maxCharacters || 4000, 4000)) throw new AppError("모델의 음성 입력 길이 제한을 초과했습니다.");
  let response: Response;
  try { response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, { method: "POST", headers: headers(connection), body: JSON.stringify({ text, model_id: model.id }), redirect: "error", signal: AbortSignal.timeout(180_000) }); }
  catch { throw new AppError("음성 생성의 응답을 확인하지 못했습니다. 작업 기록을 확인하세요.", 502, "provider_unreachable"); }
  if (!response.ok) {
    await response.body?.cancel();
    const code = response.status === 401 ? "authentication_failed" : response.status === 403 ? "permission_denied" : response.status === 429 ? "rate_limited" : "provider_error";
    throw new AppError(`ElevenLabs 음성 요청 실패 (HTTP ${response.status}). 키·보이스 권한과 사용량을 확인하세요.`, 502, code, response.status);
  }
  return response;
}
