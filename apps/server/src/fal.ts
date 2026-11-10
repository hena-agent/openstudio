import { z } from "zod";
import type { FalCatalogPage, MediaCapabilities, Model } from "@openstudio/shared/types";
import { FAL_API_BASE, FAL_CATEGORIES, falSettingsSchema, normalizeFalEndpointId } from "@openstudio/shared/fal-config";
import { seedanceRestriction } from "@openstudio/shared/provider-registry";
import { AppError, type StoredConnection } from "./storage";
import { requestJSON } from "./providers";

type JsonObject = Record<string, any>;
const record = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const endpointSchema = z.object({
  endpoint_id: z.string(),
  metadata: z.object({ display_name: z.string().optional(), description: z.string().optional(), category: z.string().optional(), updated_at: z.string().optional() }).nullish(),
  openapi: z.record(z.string(), z.unknown()).nullish(),
});
const responseSchema = z.object({ models: z.array(endpointSchema), next_cursor: z.string().nullable().optional(), has_more: z.boolean().optional() });
const categoryKind: Record<string, "image" | "video"> = { "text-to-image": "image", "image-to-image": "image", "text-to-video": "video", "image-to-video": "video" };

function headers(connection?: StoredConnection): Record<string, string> {
  if (!connection) return { Accept: "application/json" };
  if (connection.provider !== "fal" || connection.baseURL !== FAL_API_BASE) throw new AppError("fal API 주소가 올바르지 않습니다.", 400, "invalid_endpoint");
  return { Accept: "application/json", Authorization: `Key ${connection.secret}` };
}
export function falModel(raw: z.infer<typeof endpointSchema>): Model {
  const id = normalizeFalEndpointId(raw.endpoint_id), metadata = raw.metadata;
  const kind = categoryKind[metadata?.category || ""];
  const restriction = seedanceRestriction(id);
  return { id, name: metadata?.display_name || id, tasks: kind ? [kind] : [], endpoints: ["queue"], metadataSource: "provider-catalog", metadataUpdatedAt: metadata?.updated_at,
    metadata: { description: metadata?.description, input: metadata?.category?.startsWith("image-") ? ["text", "image"] : ["text"], output: kind ? [kind] : undefined },
    ...(kind ? { media: { kind, reference: metadata?.category?.startsWith("image-") ? "required" : "none" } as MediaCapabilities } : {}),
    ...(!kind || restriction ? { callable: false, unavailableReason: restriction || "현재 이미지·영상 어댑터에서 지원하지 않는 fal 분류입니다." } : {}),
  };
}

export const falSearchSchema = z.object({ query: z.string().trim().max(160).default(""), category: z.enum(FAL_CATEGORIES).default("text-to-image"), cursor: z.string().max(1000).optional() });
export async function searchFalModels(input: z.infer<typeof falSearchSchema>, connection?: StoredConnection, limit = 20): Promise<FalCatalogPage> {
  const filters = falSearchSchema.parse(input);
  const params = new URLSearchParams({ category: filters.category, status: "active", sort: "recent", limit: String(limit) });
  if (filters.query) params.set("q", filters.query);
  if (filters.cursor) params.set("cursor", filters.cursor);
  const result = responseSchema.parse(await requestJSON(`${FAL_API_BASE}/models?${params}`, { headers: headers(connection) }));
  return { models: result.models.map(falModel), nextCursor: result.next_cursor || undefined, hasMore: !!result.next_cursor, source: "public-catalog" };
}

async function findEndpoints(connection: StoredConnection, ids: string[]): Promise<z.infer<typeof endpointSchema>[]> {
  if (!ids.length) return [];
  const params = new URLSearchParams(); ids.forEach((id) => params.append("endpoint_id", normalizeFalEndpointId(id)));
  try { return responseSchema.parse(await requestJSON(`${FAL_API_BASE}/models?${params}`, { headers: headers(connection) })).models; }
  catch (error) {
    if (!(error instanceof AppError) || error.upstreamStatus !== 404) throw error;
    if (ids.length === 1) return [];
    return (await Promise.all(ids.map((id) => findEndpoints(connection, [id])))).flat();
  }
}

export async function discoverFal(connection: StoredConnection, strictPins = !connection.credentialVerifiedAt): Promise<Model[]> {
  headers(connection);
  const settings = falSettingsSchema.parse(connection.fal || {});
  const models = new Map<string, Model>();
  for (const category of FAL_CATEGORIES) {
    const page = await searchFalModels({ query: "", category }, connection, 50);
    page.models.forEach((model) => models.set(model.id, model));
  }
  const pinned = await findEndpoints(connection, settings.endpoints);
  const found = new Map(pinned.map((item) => [normalizeFalEndpointId(item.endpoint_id), item]));
  for (const id of settings.endpoints) {
    const item = found.get(id);
    if (item) models.set(id, falModel(item));
    else {
      if (strictPins) throw new AppError("등록한 fal endpoint를 찾을 수 없습니다. ID와 해당 키의 접근 권한을 확인하세요.", 404, "model_not_found");
      const old = connection.models.find((model) => model.id === id);
      models.set(id, { ...(old || { id, name: id, endpoints: ["queue"], tasks: [] }), callable: false, unavailableReason: "이 fal endpoint를 다시 조회하지 못했습니다. 등록 ID는 유지되며 자동으로 다른 모델로 바꾸지 않습니다." });
    }
  }
  return [...models.values()];
}

function inputFields(schema: JsonObject, components: JsonObject, depth = 0): { properties: JsonObject; required: string[]; type?: string; maxItems?: number; minItems?: number } {
  if (depth > 20) throw new AppError("fal 입력 명세의 참조 깊이를 초과했습니다.", 502, "unsupported_schema");
  if (schema.$ref) {
    const ref = String(schema.$ref);
    if (!ref.startsWith("#/components/schemas/")) throw new AppError("지원하지 않는 fal 스키마 참조입니다.", 502, "unsupported_schema");
    const target = components.schemas?.[ref.slice("#/components/schemas/".length)];
    if (!target) throw new AppError("fal 스키마 참조를 찾을 수 없습니다.", 502, "unsupported_schema");
    return inputFields(record(target), components, depth + 1);
  }
  if (!schema.type && Array.isArray(schema.anyOf)) {
    const array = schema.anyOf.map((branch: unknown) => inputFields(record(branch), components, depth + 1)).find((branch: { type?: string }) => branch.type === "array");
    if (array) return array;
  }
  const result = { properties: { ...record(schema.properties) }, required: Array.isArray(schema.required) ? [...schema.required] as string[] : [], type: schema.type as string | undefined, maxItems: typeof schema.maxItems === "number" ? schema.maxItems : undefined, minItems: typeof schema.minItems === "number" ? schema.minItems : undefined };
  for (const branch of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const resolved = inputFields(record(branch), components, depth + 1);
    Object.assign(result.properties, resolved.properties); result.required.push(...resolved.required);
    result.type ||= resolved.type; result.maxItems ??= resolved.maxItems; result.minItems ??= resolved.minItems;
  }
  return result;
}

export async function enrichFalModel(connection: StoredConnection, model: Model) {
  const id = normalizeFalEndpointId(model.id);
  const params = new URLSearchParams({ endpoint_id: id, expand: "openapi-3.0" });
  const result = responseSchema.parse(await requestJSON(`${FAL_API_BASE}/models?${params}`, { headers: headers(connection) }));
  const item = result.models.find((item) => normalizeFalEndpointId(item.endpoint_id) === id);
  const openapi = record(item?.openapi), components = record(openapi.components);
  const post = Object.entries(record(openapi.paths)).filter(([path, entry]) => !path.includes("/requests/") && record(record(entry).post).requestBody).map(([, entry]) => record(record(entry).post));
  const root = post.length === 1 ? record(record(record(post[0].requestBody).content)["application/json"]).schema : undefined;
  if (!root || !model.media) throw new AppError("fal 생성 요청의 입력 명세를 확인할 수 없습니다.", 502, "schema_unavailable");
  const input = inputFields(record(root), components);
  const referenceField = ["image_url", "image_urls", "start_image_url", "first_frame_url"].find((name) => input.properties[name]);
  const reference = referenceField ? inputFields(record(input.properties[referenceField]), components) : undefined;
  const parameters: NonNullable<MediaCapabilities["parameters"]> = {};
  for (const [name, value] of Object.entries(input.properties)) {
    const prop = record(value);
    const enums = prop.enum || (Array.isArray(prop.anyOf) ? prop.anyOf.find((entry: JsonObject) => entry.enum)?.enum : undefined);
    if (Array.isArray(enums) && enums.every((item) => typeof item === "string" || typeof item === "number")) parameters[name] = { type: "enum", values: enums };
    else if (prop.type === "boolean") parameters[name] = { type: "boolean" };
    else if (prop.type === "integer" || prop.type === "number") parameters[name] = { type: "range", min: prop.minimum, max: prop.maximum };
  }
  model.media = { ...model.media, parameters, inputSchema: { ...record(root), components }, acceptsPrompt: !!input.properties.prompt,
    referenceField, referenceArray: reference?.type === "array", maxReferences: reference?.type === "array" ? Math.min(3, reference.maxItems ?? 3) : 1,
    reference: referenceField && reference?.maxItems !== 0 ? input.required.includes(referenceField) ? "required" : "optional" : "none",
  };
  const inputTypes = [...(model.media.acceptsPrompt ? ["text"] : []), ...(referenceField ? ["image"] : [])];
  if (inputTypes.length) model.metadata = { ...model.metadata, input: inputTypes };
  if (referenceField && input.required.includes(referenceField) && (reference?.minItems || 0) > 3) {
    model.callable = false; model.unavailableReason = "이 fal endpoint는 3장을 초과하는 필수 참조를 요구합니다. 현재 앱의 참조 입력 한도를 초과합니다.";
  }
  if (parameters.generate_audio?.type === "boolean") model.media.generateAudio = true;
  try {
    const pricing = await requestJSON(`${FAL_API_BASE}/models/pricing?endpoint_id=${encodeURIComponent(id)}`, { headers: headers(connection) });
    model.media.pricing = (pricing.prices || []).flatMap((price: JsonObject) => typeof price.unit_price === "number" && typeof price.unit === "string" ? [{ unit: price.unit, amount: price.unit_price, currency: price.currency || "USD" }] : []);
  } catch { /* Optional pricing permissions must not prevent schema validation. */ }
}
