import { z } from "zod";
import { BYTEPLUS_BASE_URL, byteplusSettingsSchema } from "../byteplus-config";
import { seedanceRestriction } from "../provider-registry";
import type { BytePlusSettings, Model, ModelMetadata, TaskKind } from "../types";
import { AppError, type StoredConnection } from "./storage";
import { requestJSON } from "./providers";

const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/);
const listedModelSchema = z.object({
  id: idSchema, name: z.string().optional(), task_type: z.array(z.string()).optional(),
  modalities: z.object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() }).optional(),
  token_limits: z.object({ context_window: z.number().optional(), max_output_token_length: z.number().optional(), max_input_token_length: z.number().optional() }).optional(),
  features: z.object({ tools: z.object({ function_calling: z.boolean().optional() }).optional(), structured_outputs: z.object({ json_schema: z.boolean().optional() }).optional() }).optional(),
});
const positive = (value: number | undefined) => value !== undefined && value > 0 && Number.isFinite(value) ? value : undefined;

export function assertBytePlusConnection(connection: Pick<StoredConnection, "baseURL" | "byteplus">) {
  const settings = byteplusSettingsSchema.parse(connection.byteplus || {});
  if (connection.baseURL !== BYTEPLUS_BASE_URL) throw new AppError("확인되지 않은 BytePlus 리전 또는 Base URL입니다.", 400, "invalid_region");
  return settings;
}
export function byteplusHeaders(connection: Pick<StoredConnection, "secret">) {
  return { Authorization: `Bearer ${connection.secret}`, "Content-Type": "application/json", Accept: "application/json" };
}

function withCapabilities(model: Model, kind?: TaskKind): Model {
  if (kind === "image") {
    model.media = { kind, reference: model.registration || model.metadata?.input?.includes("image") ? "optional" : "none", referenceArray: true, maxReferences: 3, parameters: {
      size: { type: "string" }, output_format: { type: "enum", values: ["jpeg", "png"] }, seed: { type: "range", min: -1, max: 2147483647 }, watermark: { type: "boolean" },
    } };
    model.endpoints = ["/images/generations"];
  } else if (kind === "video") {
    model.media = { kind, reference: model.metadata?.input?.includes("image") || model.registration ? "optional" : "none", referenceArray: true, maxReferences: 2,
      generateAudio: model.metadata?.output?.includes("audio") ? true : undefined,
      parameters: { resolution: { type: "string" }, ratio: { type: "string" }, duration: { type: "range", min: 1, max: 120 }, seed: { type: "range", min: -1, max: 2147483647 }, watermark: { type: "boolean" } },
    };
    model.endpoints = ["/contents/generations/tasks"];
  }
  const reason = byteplusExecutionRestriction(model);
  if (reason) { model.callable = false; model.unavailableReason = reason; }
  return model;
}

export function byteplusExecutionRestriction(model: Model) {
  const minimum = seedanceRestriction(model.id) || (model.registration?.baseModelId ? seedanceRestriction(model.registration.baseModelId) : undefined);
  if (minimum) return minimum;
  if (model.tasks?.includes("video") && (/^ep-/i.test(model.id) || model.registration?.mappingVerified === false)) {
    return "등록된 영상 endpoint의 실제 기반 모델·버전을 API 키만으로 확인할 수 없습니다. Seedance 5.0 조건 확인 전에는 실행하지 않습니다.";
  }
  return model.unavailableReason;
}

export function mapBytePlusModels(raw: unknown, settings: BytePlusSettings): Model[] {
  const response = z.object({ data: z.array(z.unknown()) }).parse(raw);
  const models = new Map<string, Model>();
  for (const rawModel of response.data) {
    const result = listedModelSchema.safeParse(rawModel); if (!result.success) continue;
    const data = result.data;
    const output = data.modalities?.output_modalities?.map((entry) => entry.toLowerCase());
    let tasks = (output || []).filter((entry): entry is TaskKind => ["text", "image", "video"].includes(entry));
    if (!tasks.length) {
      const names = new Set(data.task_type);
      if (names.has("ImageGeneration") || names.has("TextToImage")) tasks = ["image"];
      else if (names.has("VideoGeneration") || names.has("TextToVideo")) tasks = ["video"];
      else if (names.has("TextGeneration")) tasks = ["text"];
    }
    const metadata: ModelMetadata = { input: data.modalities?.input_modalities, output,
      context: positive(data.token_limits?.context_window), maxInput: positive(data.token_limits?.max_input_token_length), maxOutput: positive(data.token_limits?.max_output_token_length),
      tools: data.features?.tools?.function_calling, structuredOutput: data.features?.structured_outputs?.json_schema,
    };
    models.set(data.id, withCapabilities({ id: data.id, name: data.name || data.id, endpoints: ["/chat/completions"], tasks, metadata, metadataSource: "account", metadataUpdatedAt: new Date().toISOString(), ...(!tasks.length ? { callable: false, unavailableReason: "API에서 지원 작업 유형을 확인하지 못했습니다." } : {}) }, tasks.find((task) => task !== "text")));
  }
  for (const registration of settings.registrations) {
    const direct = models.get(registration.id);
    if (direct) {
      if (direct.tasks?.length && !direct.tasks.includes(registration.kind)) throw new AppError("등록한 작업 유형이 BytePlus API의 모델 정보와 다릅니다.");
      if (!direct.tasks?.length) models.set(direct.id, withCapabilities({ ...direct, name: registration.name || direct.name, tasks: [registration.kind], callable: undefined, unavailableReason: undefined, registration: { baseModelId: registration.baseModelId, mappingVerified: false } }, registration.kind));
      else if (registration.name) direct.name = registration.name;
      continue;
    }
    const base = registration.baseModelId ? models.get(registration.baseModelId) : undefined;
    if (base && !base.tasks?.includes(registration.kind)) throw new AppError("등록한 기반 모델이 해당 작업 유형을 지원하지 않습니다.");
    const configured = withCapabilities({ id: registration.id, name: registration.name || registration.id,
      tasks: [registration.kind], endpoints: registration.kind === "text" ? ["/chat/completions"] : [],
      registration: { baseModelId: registration.baseModelId || undefined, mappingVerified: false },
      // Never label caller-declared endpoint mapping as verified account metadata.
    }, registration.kind);
    models.set(configured.id, configured);
  }
  return [...models.values()];
}

export async function discoverBytePlus(connection: StoredConnection) {
  const settings = assertBytePlusConnection(connection);
  const payload = await requestJSON(`${connection.baseURL}/models`, { headers: byteplusHeaders(connection) });
  return mapBytePlusModels(payload, settings);
}

const imageOptions = z.object({
  size: z.string().trim().min(1).max(40).regex(/^(?:auto|[1-9]\d?K|[1-9]\d{1,4}x[1-9]\d{1,4})$/i).optional(),
  output_format: z.enum(["jpeg", "png"]).optional(),
  seed: z.number().int().min(-1).max(2147483647).optional(), watermark: z.boolean().optional(), background: z.enum(["opaque", "transparent"]).optional(),
}).strict();
const videoOptions = z.object({
  resolution: z.string().min(1).max(16).regex(/^(?:\d{3,4}p|[124]K)$/i).optional(),
  ratio: z.string().regex(/^(?:auto|\d{1,2}:\d{1,2})$/).optional(), duration: z.number().int().min(1).max(120).optional(),
  seed: z.number().int().min(-1).max(2147483647).optional(), generate_audio: z.boolean().optional(), watermark: z.boolean().optional(), camera_fixed: z.boolean().optional(), return_last_frame: z.boolean().optional(),
}).strict();

export function byteplusMediaPayload(connection: StoredConnection, model: Model, kind: "image" | "video", prompt: string, options: Record<string, unknown>, references: string[]) {
  assertBytePlusConnection(connection);
  idSchema.parse(model.id);
  const restriction = byteplusExecutionRestriction(model); if (restriction) throw new AppError(restriction);
  if (!model.tasks?.includes(kind) || model.media?.kind !== kind || model.callable === false) throw new AppError("선택한 BytePlus 모델의 작업 유형을 확인하세요.");
  if (references.length && model.media.reference === "none") throw new AppError("이 BytePlus 모델의 참조 이미지 입력을 확인할 수 없습니다.");
  if (kind === "image") {
    const parsed = imageOptions.safeParse(options); if (!parsed.success) throw new AppError("BytePlus 이미지 옵션(size/seed/watermark/output_format/background)을 확인하세요.");
    if (references.length > 3) throw new AppError("현재 BytePlus 이미지 참조는 최대 3장입니다.");
    return { model: model.id, prompt, ...parsed.data, ...(references.length ? { image: references.length === 1 ? references[0] : references } : {}), response_format: "url", stream: false, sequential_image_generation: "disabled" };
  }
  const parsed = videoOptions.safeParse(options); if (!parsed.success) throw new AppError("BytePlus 영상 옵션(resolution/ratio/duration/seed/generate_audio 등)을 확인하세요.");
  if (references.length > 2) throw new AppError("현재 BytePlus 영상 참조는 시작·끝 프레임 최대 2장입니다.");
  return { model: model.id, content: [{ type: "text", text: prompt }, ...references.map((url, index) => ({ type: "image_url", image_url: { url }, role: index === 0 ? "first_frame" : "last_frame" }))], ...parsed.data, output_format: "mp4" };
}

export function byteplusImageOutputs(raw: unknown) {
  const result = z.object({ data: z.array(z.object({ url: z.url().optional(), b64_json: z.string().min(1).optional(), error: z.unknown().optional() })).default([]), error: z.unknown().optional() }).parse(raw);
  if (result.error) throw new AppError("BytePlus 이미지 생성이 실패했습니다. 모델 권한과 입력을 확인하세요.", 502, "generation_failed");
  const successful = result.data.filter((entry) => !entry.error && (entry.url || entry.b64_json));
  if (!successful.length) throw new AppError("BytePlus가 성공한 이미지 결과를 반환하지 않았습니다.", 502, "generation_failed");
  if (successful.length > 10) throw new AppError("현재 저장 한도인 10개보다 많은 이미지가 반환됐습니다.", 502, "invalid_response");
  return { outputs: successful.map((entry) => entry.b64_json ? { base64: entry.b64_json } : { url: entry.url! }), partial: successful.length !== result.data.length };
}

export function byteplusVideoResult(raw: unknown, taskId: string) {
  const data = z.object({ id: z.string(), status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "expired"]), content: z.object({ video_url: z.url().optional() }).nullish(), error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullish() }).parse(raw);
  if (data.id !== taskId) throw new AppError("BytePlus 응답의 작업 ID가 일치하지 않습니다.", 502, "invalid_response");
  if (["failed", "cancelled", "expired"].includes(data.status) || data.error?.code || data.error?.message) throw new AppError("BytePlus 영상 작업이 실패·취소·만료되었습니다. 모델 권한과 입력·크레딧을 확인하세요.", 502, "generation_failed");
  if (data.status === "succeeded") {
    if (!data.content?.video_url) throw new AppError("완료된 BytePlus 작업에 영상 URL이 없습니다.", 502, "invalid_response");
    return { status: "completed" as const, outputs: [{ url: data.content.video_url }] };
  }
  return { status: data.status === "running" ? "running" as const : "pending" as const, outputs: undefined };
}
