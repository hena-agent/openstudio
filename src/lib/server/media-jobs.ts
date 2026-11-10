import { createHash, randomUUID } from "node:crypto";
import Ajv from "ajv";
import { z } from "zod";
import type { MediaJob, Model } from "../types";
import { modelTasks, seedanceRestriction } from "../provider-registry";
import { AppError, transaction, type StoredConnection, type StoredJob } from "./storage";
import { enrichMediaModel, extraHeaders } from "./additional-providers";
import { requestJSON } from "./providers";
import { downloadMedia, referenceData, saveMedia } from "./assets";
import { assertBytePlusConnection, byteplusExecutionRestriction, byteplusImageOutputs, byteplusMediaPayload, byteplusVideoResult } from "./byteplus";
import { synthesizeSpeech } from "./speech";

export const mediaRunId = randomUUID();
const working = new Set<string>();
const ajv = new Ajv({ strict: false, validateFormats: false, useDefaults: true, allErrors: true });
const schemas = new Map<string, ReturnType<typeof ajv.compile>>();
export const createJobSchema = z.object({
  action: z.literal("create"), connectionId: z.uuid(), requestId: z.uuid(), model: z.string().min(1).max(300),
  kind: z.enum(["image", "video", "audio"]), prompt: z.string().trim().max(4000).default(""),
  options: z.record(z.string(), z.unknown()).default({}), referenceIds: z.array(z.uuid()).max(3).default([]), consent: z.literal(true),
});
type CreateInput = z.infer<typeof createJobSchema>;
export function publicJob(job: StoredJob): MediaJob {
  const { id, connectionId, provider, model, modelName, kind, prompt, status, createdAt, updatedAt, externalId, assets, error, nextPollAt, warning } = job;
  return { id, connectionId, provider, model, modelName, kind, prompt, status, createdAt, updatedAt, externalId, assets, error, nextPollAt, warning };
}
export function recoverStalledJobs(jobs: StoredJob[]) {
  for (const job of jobs) {
    if (["submitting", "running"].includes(job.status) && !job.externalId && job.runId !== mediaRunId) {
      job.status = "unknown"; job.error = "서버가 재시작되어 제출 결과를 확인할 수 없습니다. 중복 생성을 방지하기 위해 다시 제출하지 않았습니다.";
    }
  }
}

export async function mediaPayload(sessionId: string, connection: StoredConnection, model: Model, input: Pick<CreateInput, "kind" | "prompt" | "options" | "referenceIds">) {
  if (input.kind === "audio") throw new AppError("음성은 TTS 어댑터로 실행하세요.");
  if (seedanceRestriction(model.id)) throw new AppError(seedanceRestriction(model.id)!);
  if (!(connection.provider === "fal" && model.media?.acceptsPrompt === false) && !input.prompt.trim()) throw new AppError("프롬프트를 입력하세요.");
  if (!modelTasks(model).includes(input.kind) || !model.media || model.media.kind !== input.kind || model.callable === false) throw new AppError("이 모델은 선택한 작업을 실행할 수 없습니다.");
  const references = await Promise.all(input.referenceIds.map((id) => referenceData(sessionId, id)));
  if (connection.provider === "byteplus") return byteplusMediaPayload(connection, model, input.kind, input.prompt, input.options, references);
  if (model.media.reference === "required" && !references.length) throw new AppError("이 모델은 참조 이미지가 필요합니다.");
  if (model.media.reference === "none" && references.length) throw new AppError("이 모델은 참조 이미지를 지원하지 않습니다.");
  const referenceLimit = model.media.parameters?.input_references?.max;
  if (referenceLimit !== undefined && references.length > referenceLimit) throw new AppError("이 endpoint의 참조 이미지 개수를 초과했습니다.");
  if (connection.provider === "fal") {
    if (!model.media.inputSchema) throw new AppError("먼저 모델의 입력 명세를 조회하세요.");
    const payload: Record<string, unknown> = { ...input.options, ...(model.media.acceptsPrompt === false ? {} : { prompt: input.prompt }) };
    if (references.length) {
      const field = model.media.referenceField;
      if (!field) throw new AppError("참조 이미지 필드를 확인할 수 없습니다.");
      if (!model.media.referenceArray && references.length > 1) throw new AppError("이 endpoint는 참조 이미지 한 장만 지원합니다.");
      payload[field] = model.media.referenceArray ? references : references[0];
    }
    const key = createHash("sha256").update(JSON.stringify(model.media.inputSchema)).digest("hex");
    let validate = schemas.get(key);
    if (!validate) {
      try { validate = ajv.compile(model.media.inputSchema); }
      catch { throw new AppError("이 fal 입력 스키마는 현재 검증기에서 지원하지 않습니다.", 502, "unsupported_schema"); }
      if (schemas.size > 100) schemas.clear(); schemas.set(key, validate);
    }
    if (!validate(payload)) {
      const missing = validate.errors?.find((error) => error.keyword === "required")?.params.missingProperty;
      throw new AppError(missing ? `필수 옵션 '${String(missing).slice(0, 80)}'을 추가 옵션 JSON에 입력하세요.` : "모델 입력 명세에 맞지 않는 옵션입니다. 선택값과 추가 옵션 JSON을 확인하세요.");
    }
    return payload;
  }
  if (connection.provider !== "openrouter") throw new AppError("이 제공자의 미디어 어댑터는 아직 없습니다.");
  const allowed = input.kind === "video" ? ["duration", "resolution", "aspect_ratio", "generate_audio", "seed"] : ["resolution", "aspect_ratio", "quality", "n", "seed", "output_format"];
  for (const [name, value] of Object.entries(input.options)) {
    if (!allowed.includes(name)) throw new AppError(`지원하지 않는 옵션입니다: ${name.slice(0, 80)}`);
    const descriptor = model.media.parameters?.[name];
    const validValues = name === "aspect_ratio" ? model.media.aspectRatios : name === "resolution" ? model.media.resolutions : name === "duration" ? model.media.durations : undefined;
    if (input.kind === "video" && ["aspect_ratio", "resolution", "duration"].includes(name) && !validValues?.length) throw new AppError(`${name}의 지원 옵션을 확인할 수 없습니다.`);
    if (validValues && !(validValues as unknown[]).includes(value)) throw new AppError(`모델이 지원하지 않는 ${name} 값입니다.`);
    if (input.kind === "image" && !descriptor) throw new AppError(`선택한 이미지 endpoint는 ${name} 옵션을 지원하지 않습니다.`);
    if (descriptor?.type === "enum" && !descriptor.values?.includes(value as string | number)) throw new AppError(`${name} 값을 확인하세요.`);
    if (descriptor?.type === "range" && (typeof value !== "number" || !Number.isInteger(value) || (descriptor.min !== undefined && value < descriptor.min) || (descriptor.max !== undefined && value > descriptor.max))) throw new AppError(`${name} 범위를 확인하세요.`);
    if (name === "generate_audio" && typeof value !== "boolean") throw new AppError(`${name}은 boolean이어야 합니다.`);
    if (name === "generate_audio" && model.media.generateAudio !== true) throw new AppError("이 모델의 오디오 생성을 확인할 수 없습니다.");
    if (name === "duration" && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 120)) throw new AppError("영상 길이를 확인하세요.");
    if (name === "seed" && (!Number.isInteger(value) || model.media.seed !== true && descriptor?.type !== "boolean")) throw new AppError("시드 설정을 확인하세요.");
    if (name === "n" && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4)) throw new AppError("한 번에 생성할 이미지는 1–4장으로 설정하세요.");
    if (name === "output_format" && !["png", "jpeg", "webp", "gif"].includes(String(value))) throw new AppError("PNG/JPEG/WebP/GIF 형식만 지원합니다.");
  }
  const payload: Record<string, unknown> = { model: model.id, prompt: input.prompt, ...input.options };
  if (references.length) payload[input.kind === "video" ? "frame_images" : "input_references"] = references.map((url, index) => ({ type: "image_url", image_url: { url }, ...(input.kind === "video" ? { frame_type: index === 0 ? "first_frame" : "last_frame" } : {}) }));
  if (input.kind === "video" && references.length > 1) throw new AppError("현재 영상 어댑터는 시작 프레임 한 장을 지원합니다.");
  const tag = model.media.inputSchema?.providerTag;
  if (input.kind === "image" && typeof tag === "string") payload.provider = { only: [tag], allow_fallbacks: false };
  return payload;
}

export async function createMediaJob(sessionId: string, raw: unknown) {
  const input = createJobSchema.parse(raw);
  if (JSON.stringify(input.options).length > 32_000) throw new AppError("추가 옵션이 너무 큽니다.", 413);
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, requestId: undefined })).digest("hex");
  const setup = await transaction(sessionId, async (data) => {
    const existing = data.jobs?.find((job) => job.requestId === input.requestId);
    if (existing) {
      if (existing.options.__requestFingerprint !== fingerprint) throw new AppError("동일 요청 ID에 다른 입력을 사용할 수 없습니다.", 409, "idempotency_conflict");
      return { job: publicJob(existing), existing: true };
    }
    const connection = data.connections.find((item) => item.id === input.connectionId && item.status !== "disconnected");
    if (!connection) throw new AppError("연결 계정을 찾을 수 없습니다.", 404);
    const model = connection.models.find((item) => item.id === input.model);
    if (!model || model.callable === false || seedanceRestriction(model.id) || !modelTasks(model).includes(input.kind) || (input.kind === "audio" ? connection.provider !== "elevenlabs" : !model.media)) throw new AppError(model?.unavailableReason || "먼저 이 계정의 미디어 모델을 조회하세요.");
    if (input.kind === "audio") {
      z.object({ voice: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict().parse(input.options);
      if (input.referenceIds.length) throw new AppError("TTS에는 참조 이미지를 사용할 수 없습니다.");
    }
    if (connection.provider === "byteplus") {
      assertBytePlusConnection(connection);
      const restriction = byteplusExecutionRestriction(model); if (restriction) throw new AppError(restriction);
    }
    if (connection.provider === "fal" && (!model.media?.inputSchema || model.media.acceptsPrompt === undefined) || connection.provider === "openrouter" && model.media?.kind === "image" && !model.media.inputSchema) await enrichMediaModel(connection, model);
    if (!(connection.provider === "fal" && model.media?.acceptsPrompt === false) && !input.prompt.trim()) throw new AppError("프롬프트를 입력하세요.");
    // References are verified outside this lock below; no generation is submitted here.
    const job: StoredJob = { id: randomUUID(), requestId: input.requestId, connectionId: connection.id, provider: connection.provider, model: model.id, modelName: model.name, kind: input.kind, prompt: input.prompt, status: "submitting", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assets: [], runId: mediaRunId, modelSnapshot: structuredClone(model), providerBaseURL: connection.baseURL, options: { ...input.options, __requestFingerprint: fingerprint }, referenceIds: input.referenceIds };
    (data.jobs ??= []).push(job);
    return { job: publicJob(job), existing: false };
  });
  if (!setup.existing) void submitJob(sessionId, setup.job.id);
  return setup.job;
}

function queueURL(input: string) {
  const url = new URL(input);
  if (url.origin !== "https://queue.fal.run" || url.username || url.password || url.hash) throw new AppError("fal 작업 주소가 올바르지 않습니다.", 502);
  return url.toString();
}
async function update(sessionId: string, id: string, mutate: (job: StoredJob) => void) {
  await transaction(sessionId, (data) => { const job = data.jobs?.find((job) => job.id === id); if (!job) return; mutate(job); job.updatedAt = new Date().toISOString(); });
}
async function snapshot(sessionId: string, id: string) {
  return transaction(sessionId, (data) => {
    const job = data.jobs?.find((job) => job.id === id); if (!job) throw new AppError("작업을 찾을 수 없습니다.", 404);
    const connection = data.connections.find((item) => item.id === job.connectionId);
    const model = job.modelSnapshot || connection?.models.find((model) => model.id === job.model);
    if (!connection || !model) throw new AppError("작업의 연결 계정 또는 모델이 없습니다.", 404);
    return { job, connection: { ...connection, baseURL: job.providerBaseURL || connection.baseURL }, model };
  });
}
async function submitJob(sessionId: string, id: string) {
  const key = `${sessionId}:${id}`; if (working.has(key)) return; working.add(key);
  let submitted = false;
  try {
    const { job, connection, model } = await snapshot(sessionId, id);
    const { __requestFingerprint: _, ...options } = job.options;
    if (job.kind === "audio") {
      submitted = true;
      const response = await synthesizeSpeech(connection, model, job.prompt, options);
      const asset = await saveMedia(sessionId, response, "audio", `speech-${id.slice(0, 8)}`);
      await transaction(sessionId, (data) => {
        const current = data.jobs!.find((item) => item.id === id)!;
        current.assets = [asset]; current.status = "completed"; current.updatedAt = new Date().toISOString();
        const account = data.connections.find((item) => item.id === connection.id); if (account) account.verifiedAt = current.updatedAt;
      });
      return;
    }
    const payload = await mediaPayload(sessionId, connection, model, { ...job, options });
    submitted = true;
    const url = connection.provider === "fal" ? `https://queue.fal.run/${model.id}` : connection.provider === "byteplus" ? `${connection.baseURL}/${job.kind === "image" ? "images/generations" : "contents/generations/tasks"}` : `${connection.baseURL}/${job.kind === "image" ? "images" : "videos"}`;
    const data = await requestJSON(url, { method: "POST", headers: extraHeaders(connection), body: JSON.stringify(payload) }, connection.provider === "byteplus" && job.kind === "image" ? 600_000 : 180_000);
    if (connection.provider === "fal") {
      const external = z.object({ request_id: z.string() }).parse(data);
      await update(sessionId, id, (job) => { job.externalId = external.request_id; job.status = "pending"; });
      const result = z.object({ request_id: z.string(), status_url: z.url(), response_url: z.url() }).parse(data);
      await update(sessionId, id, (job) => { job.externalId = result.request_id; job.statusUrl = queueURL(result.status_url); job.resultUrl = queueURL(result.response_url); job.status = "pending"; job.nextPollAt = Date.now() + 5000; });
    } else if (job.kind === "video") {
      const result = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).parse(data);
      await update(sessionId, id, (job) => { job.externalId = result.id; job.status = "pending"; job.nextPollAt = Date.now() + 15_000; });
    } else if (connection.provider === "byteplus") {
      const result = byteplusImageOutputs(data);
      await update(sessionId, id, (job) => { job.status = "downloading"; job.pendingOutputs = result.outputs; if (result.partial) job.warning = "일부 이미지 생성이 실패했습니다. 성공한 파일만 저장했습니다."; });
      await collectOutputs(sessionId, id);
    } else {
      const images = z.array(z.object({ b64_json: z.string(), media_type: z.string().optional() })).min(1).max(10).parse(data.data);
      await update(sessionId, id, (job) => { job.status = "downloading"; job.pendingOutputs = images.map((image) => ({ base64: image.b64_json, mime: image.media_type })); });
      await collectOutputs(sessionId, id);
    }
  } catch (error) {
    await update(sessionId, id, (job) => {
      const permanent = error instanceof AppError && (["invalid_media", "invalid_download_url"].includes(error.code) || error.status === 413);
      const ambiguous = !(error instanceof AppError) || ["provider_unreachable", "invalid_response"].includes(error.code) || (error.upstreamStatus || 0) >= 500;
      job.status = job.pendingOutputs && !permanent ? "downloading" : submitted && !job.externalId && ambiguous ? "unknown" : "failed";
      if (job.pendingOutputs) job.nextPollAt = Date.now() + 10_000;
      job.error = error instanceof AppError ? error.message : "제공자의 제출 결과를 해석할 수 없습니다. 중복 생성을 방지하기 위해 재제출하지 않았습니다.";
    }).catch(() => {});
  } finally { working.delete(key); }
}

async function collectOutputs(sessionId: string, id: string) {
  const { job, connection } = await snapshot(sessionId, id);
  if (!job.pendingOutputs?.length) throw new AppError("제공자가 결과 파일을 반환하지 않았습니다.", 502);
  for (let index = job.assets.length; index < job.pendingOutputs.length; index++) {
    const output = job.pendingOutputs[index];
    const name = `${job.kind}-${id.slice(0, 8)}-${index + 1}`;
    const asset = output.base64 ? await saveMedia(sessionId, new Response(Buffer.from(output.base64, "base64")), job.kind, name) : await downloadMedia(sessionId, output.url!, job.kind, name,
      connection.provider === "openrouter" && output.url?.startsWith(`${connection.baseURL}/videos/`) ? extraHeaders(connection) : {});
    await update(sessionId, id, (job) => { job.assets.push(asset); });
  }
  await transaction(sessionId, (data) => {
    const current = data.jobs!.find((job) => job.id === id)!;
    current.status = "completed"; current.updatedAt = new Date().toISOString(); delete current.error; delete current.pendingOutputs;
    const account = data.connections.find((account) => account.id === current.connectionId); if (account) account.verifiedAt = current.updatedAt;
  });
}

export async function pollMediaJob(sessionId: string, id: string) {
  const key = `${sessionId}:${id}`;
  if (working.has(key)) return;
  working.add(key);
  try {
    const { job, connection } = await snapshot(sessionId, id);
    if (["completed", "failed", "unknown"].includes(job.status) || job.nextPollAt && job.nextPollAt > Date.now()) return;
    await update(sessionId, id, (job) => { job.nextPollAt = Date.now() + (job.kind === "video" ? 15_000 : 5000); });
    if (job.pendingOutputs) { await collectOutputs(sessionId, id); return; }
    if (!job.externalId) return;
    if (connection.provider === "byteplus") {
      assertBytePlusConnection(connection);
      const data = await requestJSON(`${connection.baseURL}/contents/generations/tasks/${encodeURIComponent(job.externalId)}`, { headers: extraHeaders(connection) });
      const result = byteplusVideoResult(data, job.externalId);
      if (result.status !== "completed") { await update(sessionId, id, (job) => { job.status = result.status; delete job.error; }); return; }
      await update(sessionId, id, (job) => { job.status = "downloading"; job.pendingOutputs = result.outputs; });
      await collectOutputs(sessionId, id); return;
    }
    const data = await requestJSON(connection.provider === "fal" ? queueURL(job.statusUrl!) : `${connection.baseURL}/videos/${encodeURIComponent(job.externalId)}`, { headers: extraHeaders(connection) });
    const status = data.status;
    if (["failed", "cancelled", "expired"].includes(status) || data.error) throw new AppError("제공자의 생성 작업이 실패·취소·만료되었습니다. 입력과 계정 사용량을 확인하세요.", 502, "generation_failed");
    if (!["COMPLETED", "completed"].includes(status)) { await update(sessionId, id, (job) => { job.status = ["IN_PROGRESS", "in_progress"].includes(status) ? "running" : "pending"; delete job.error; }); return; }
    let outputs: NonNullable<StoredJob["pendingOutputs"]>;
    if (connection.provider === "fal") {
      const result = await requestJSON(queueURL(job.resultUrl!), { headers: extraHeaders(connection) });
      outputs = job.kind === "image" ? z.array(z.object({ url: z.url() })).min(1).max(10).parse(result.images) : [{ url: z.url().parse(result.video?.url) }];
    } else {
      const count = Array.isArray(data.unsigned_urls) ? data.unsigned_urls.length : 1;
      if (count < 1 || count > 10) throw new AppError("영상 출력 개수를 확인할 수 없습니다.", 502);
      outputs = Array.from({ length: count }, (_, index) => ({ url: `${connection.baseURL}/videos/${encodeURIComponent(job.externalId!)}/content?index=${index}` }));
    }
    await update(sessionId, id, (job) => { job.status = "downloading"; job.pendingOutputs = outputs; });
    await collectOutputs(sessionId, id);
  } catch (error) {
    await update(sessionId, id, (job) => {
      if (error instanceof AppError && (["generation_failed", "invalid_media", "invalid_download_url"].includes(error.code) || error.status === 413 || [400, 404, 422].includes(error.upstreamStatus || 0))) job.status = "failed";
      job.error = error instanceof AppError ? error.message : "상태 조회 또는 결과 저장에 실패했습니다. 기존 작업 ID로 다시 확인합니다.";
    }).catch(() => {});
  } finally { working.delete(key); }
}
