import { z } from "zod";
import type { Model, TaskKind } from "../types";
import { providerDefinition, seedanceRestriction } from "../provider-registry";
import { AppError, type StoredConnection } from "./storage";
import { requestJSON } from "./providers";
import { discoverBytePlus } from "./byteplus";
import { discoverFal, enrichFalModel } from "./fal";
import { discoverSpeechModels } from "./speech";

type RecordValue = Record<string, any>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const strings = (value: unknown): string[] | undefined => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

export function extraHeaders(connection: Pick<StoredConnection, "provider" | "secret">): Record<string, string> {
  return { "Content-Type": "application/json", Accept: "application/json",
    ...(connection.provider === "google" ? { "x-goog-api-key": connection.secret } : connection.provider === "fal" ? { Authorization: `Key ${connection.secret}` } : { Authorization: `Bearer ${connection.secret}` }),
    ...(connection.provider === "anthropic" ? { "anthropic-version": "2023-06-01", "x-api-key": connection.secret } : {}),
  };
}

export function mediaModelAllowed(model: Model) {
  const reason = seedanceRestriction(model.id);
  return { ...model, ...(reason ? { callable: false, unavailableReason: reason } : {}) };
}

export async function validateExtraKey(connection: StoredConnection) {
  if (connection.provider === "openrouter") {
    const response = await requestJSON(`${connection.baseURL}/key`, { headers: extraHeaders(connection) });
    z.object({ data: z.object({}).passthrough() }).parse(response);
  }
  // Other providers authenticate their model endpoint. fal validates supplied keys
  // even though its model catalog can also be queried anonymously.
}

function normalizeRouterModel(raw: RecordValue): Model {
  const architecture = object(raw.architecture), limits = object(raw.top_provider);
  const outputs = strings(architecture.output_modalities) || ["text"];
  const tasks = outputs.filter((item): item is TaskKind => ["text", "image", "video"].includes(item));
  return { id: raw.id, name: raw.name || raw.id, endpoints: ["/chat/completions"], tasks, metadataSource: "provider-catalog",
    metadata: { context: Number(raw.context_length) > 0 ? Number(raw.context_length) : undefined, maxOutput: Number(limits.max_completion_tokens) > 0 ? Number(limits.max_completion_tokens) : undefined, input: strings(architecture.input_modalities), output: outputs, description: typeof raw.description === "string" ? raw.description : undefined }, metadataUpdatedAt: new Date().toISOString() };
}

export async function discoverAdditional(connection: StoredConnection): Promise<Model[]> {
  if (connection.provider === "elevenlabs") return discoverSpeechModels(connection);
  if (connection.provider === "byteplus") return discoverBytePlus(connection);
  if (connection.provider === "fal") return discoverFal(connection);
  const headers = extraHeaders(connection);
  if (connection.provider === "anthropic") {
    const all: Model[] = []; let after = "";
    for (let page = 0; page < 30; page++) {
      const data = await requestJSON(`${connection.baseURL}/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, { headers });
      for (const raw of z.array(z.object({ id: z.string(), display_name: z.string().optional(), max_input_tokens: z.number().optional(), max_tokens: z.number().optional() })).parse(data.data)) {
        all.push({ id: raw.id, name: raw.display_name || raw.id, tasks: ["text"], endpoints: ["/messages"], metadata: { maxInput: raw.max_input_tokens, maxOutput: raw.max_tokens }, metadataUpdatedAt: new Date().toISOString() });
      }
      if (!data.has_more) return all;
      if (typeof data.last_id !== "string" || data.last_id === after) throw new AppError("Claude 모델 목록의 페이지 정보를 확인할 수 없습니다.", 502);
      after = data.last_id;
    }
    throw new AppError("Claude 모델 목록이 페이지 제한을 초과했습니다.", 502);
  }
  if (connection.provider === "google") {
    const all: Model[] = []; let token = "";
    for (let page = 0; page < 30; page++) {
      const data = await requestJSON(`${connection.baseURL}/models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, { headers });
      for (const raw of z.array(z.object({ name: z.string().regex(/^models\/[a-zA-Z0-9._-]+$/), displayName: z.string().optional(), supportedGenerationMethods: z.array(z.string()).optional(), inputTokenLimit: z.number().optional(), outputTokenLimit: z.number().optional(), thinking: z.boolean().optional() })).parse(data.models)) {
        if (!raw.supportedGenerationMethods?.includes("generateContent")) continue;
        all.push({ id: raw.name.slice(7), name: raw.displayName || raw.name, tasks: ["text"], endpoints: [":generateContent"], metadata: { maxInput: raw.inputTokenLimit, maxOutput: raw.outputTokenLimit, reasoning: raw.thinking }, metadataUpdatedAt: new Date().toISOString() });
      }
      if (!data.nextPageToken) return all;
      if (typeof data.nextPageToken !== "string" || data.nextPageToken === token) throw new AppError("Google 모델 목록의 페이지 정보를 확인할 수 없습니다.", 502);
      token = data.nextPageToken;
    }
    throw new AppError("Google 모델 목록이 페이지 제한을 초과했습니다.", 502);
  }
  if (connection.provider === "openrouter") {
    await validateExtraKey(connection);
    const text = await requestJSON(`${connection.baseURL}/models`, { headers });
    const models = new Map<string, Model>();
    for (const raw of z.array(z.object({ id: z.string() }).passthrough()).parse(text.data)) models.set(raw.id, normalizeRouterModel(raw));
    for (const kind of ["image", "video"] as const) {
      const data = await requestJSON(`${connection.baseURL}/${kind === "image" ? "images" : "videos"}/models`, { headers });
      for (const raw of z.array(z.object({ id: z.string() }).passthrough()).parse(data.data)) {
        const current = models.get(raw.id) || normalizeRouterModel(raw);
        current.tasks = Array.from(new Set([...(current.tasks || []).filter((task) => task === "text" && object(raw.architecture).output_modalities?.includes("text")), kind]));
        current.media = kind === "video" ? {
          kind, aspectRatios: strings(raw.supported_aspect_ratios), resolutions: strings(raw.supported_resolutions),
          durations: Array.isArray(raw.supported_durations) ? raw.supported_durations.filter((value): value is number => typeof value === "number") : undefined,
          reference: Array.isArray(raw.supported_frame_images) && raw.supported_frame_images.includes("first_frame") ? "optional" : "none",
          generateAudio: typeof raw.generate_audio === "boolean" ? raw.generate_audio : undefined, seed: raw.seed === true,
          pricing: Object.entries(object(raw.pricing_skus)).flatMap(([sku, raw]) => {
            const amount = Number(raw);
            return raw !== null && raw !== "" && Number.isFinite(amount) && amount >= 0 ? [{ unit: sku.replace(/^cents_per_/, ""), amount: sku.startsWith("cents_per_") ? amount / 100 : amount, currency: "USD" }] : [];
          }),
        } : { kind, parameters: object(raw.supported_parameters), reference: (strings(object(raw.architecture).input_modalities) || []).includes("image") ? "optional" : "none" };
        current.metadata = { ...current.metadata, output: [kind] };
        current.endpoints = [kind === "image" ? "/images" : "/videos"];
        models.set(raw.id, mediaModelAllowed(current));
      }
    }
    return [...models.values()];
  }
  const data = await requestJSON(`${connection.baseURL}/models`, { headers });
  return z.array(z.object({ id: z.string(), name: z.string().optional() })).parse(data.data).map((model) => ({ id: model.id, name: model.name || model.id, endpoints: ["/chat/completions"], tasks: ["text"] }));
}

export async function enrichMediaModel(connection: StoredConnection, model: Model): Promise<Model> {
  if (!model.media) throw new AppError("이 모델은 미디어 실행을 지원하지 않습니다.");
  if (connection.provider === "fal") await enrichFalModel(connection, model);
  if (connection.provider === "openrouter" && model.media.kind === "image") {
    const data = await requestJSON(`${connection.baseURL}/images/models/${model.id.split("/").map(encodeURIComponent).join("/")}/endpoints`, { headers: extraHeaders(connection) });
    // Pin to this endpoint so union-of-capabilities options never reach an incompatible fallback.
    const endpoint = data.endpoints?.[0];
    if (!endpoint) throw new AppError("사용 가능한 이미지 endpoint가 없습니다.", 502);
    model.media = { ...model.media, parameters: object(endpoint.supported_parameters),
      reference: endpoint.supported_parameters?.input_references ? endpoint.supported_parameters.input_references.min > 0 ? "required" : "optional" : "none",
      pricing: (endpoint.pricing || []).flatMap((price: RecordValue) => typeof price.cost_usd === "number" ? [{ unit: price.unit, amount: price.cost_usd, currency: "USD", label: `${price.billable || price.unit}${price.variant ? ` (${price.variant})` : ""}` }] : []),
      inputSchema: { providerTag: endpoint.provider_tag || endpoint.provider_slug },
    };
  }
  const formats = model.media.parameters?.output_format?.values;
  if (model.media.kind === "image" && formats?.length && !formats.some((format) => ["png", "jpeg", "jpg", "webp", "gif"].includes(String(format)))) {
    model.callable = false;
    model.unavailableReason = "이 모델은 현재 저장 어댑터가 지원하지 않는 이미지 형식만 제공합니다.";
  }
  return model;
}

export async function invokeAdditional(connection: StoredConnection, model: Model, prompt: string) {
  const headers = extraHeaders(connection);
  let endpoint = "/chat/completions", body: unknown = { model: model.id, messages: [{ role: "user", content: prompt }], max_tokens: 512, stream: false };
  if (connection.provider === "anthropic") { endpoint = "/messages"; body = { model: model.id, messages: [{ role: "user", content: prompt }], max_tokens: 512 }; }
  if (connection.provider === "google") {
    endpoint = `/models/${encodeURIComponent(model.id)}:generateContent`;
    body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } };
  }
  const data = await requestJSON(`${connection.baseURL}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = connection.provider === "google" ? data.candidates?.[0]?.content?.parts?.map((part: RecordValue) => part.text || "").join("\n") : connection.provider === "anthropic" ? data.content?.map((part: RecordValue) => part.text || "").join("\n") : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AppError("제공자가 텍스트 결과를 반환하지 않았습니다. 모델의 출력 유형과 제한을 확인하세요.", 502, "empty_response");
  return { text, endpoint, model: model.id };
}

export function connectionForKey(provider: StoredConnection["provider"], secret: string, label: string, id: string): StoredConnection {
  const definition = providerDefinition(provider);
  if (!(definition.methods as readonly string[]).includes("api-key")) throw new AppError("API 키를 지원하지 않는 제공자입니다.");
  return { id, provider, label, method: "api-key", secret, baseURL: definition.baseURL, createdAt: new Date().toISOString(), models: [] };
}
