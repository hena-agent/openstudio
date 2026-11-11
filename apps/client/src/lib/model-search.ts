import type { Model } from "@openstudio/shared/types";

export type ReferenceFilter = "all" | "required" | "optional" | "none" | "unknown";
export const referenceLabels = { required: "참조 이미지 필수", optional: "참조 이미지 선택", none: "참조 이미지 미지원", unknown: "참조 조건 미확인" } as const;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export function normalizeModelQuery(value: string) { return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " "); }
export function modelDisabledReason(model: Model, requireTools = false) {
  if (model.callable === false) return model.unavailableReason || "현재 실행 어댑터에서 선택할 수 없는 모델입니다.";
  if (requireTools && model.metadata?.tools === false) return "이 작업에는 도구 호출을 지원하는 텍스트 모델이 필요합니다.";
}
export function modelTraits(model: Model): string[] {
  const traits: string[] = [];
  if (model.media?.reference) traits.push(referenceLabels[model.media.reference]);
  if (model.media?.generateAudio === true) traits.push("오디오 생성");
  if (model.media?.resolutions?.length) traits.push(model.media.resolutions.join(" · "));
  if (!model.media && model.metadata?.reasoning === true) traits.push("추론");
  if (!model.media && model.metadata?.tools === true) traits.push("도구 호출");
  if (model.speech?.maxCharacters) traits.push(`최대 ${model.speech.maxCharacters.toLocaleString("ko-KR")}자`);
  return traits;
}
export function searchModels(models: Model[], query: string, options: { reference?: ReferenceFilter; hideUnavailable?: boolean; requireTools?: boolean; selectedId?: string; context?: string } = {}) {
  const normalized = normalizeModelQuery(query), compactQuery = normalized.replaceAll(" ", ""), tokens = normalized.split(" ").filter(Boolean);
  return models.flatMap((model) => {
    const unavailable = !!modelDisabledReason(model, options.requireTools);
    if (options.hideUnavailable && unavailable) return [];
    if (options.reference && options.reference !== "all" && (model.media?.reference || "unknown") !== options.reference) return [];
    const name = normalizeModelQuery(model.name), id = normalizeModelQuery(model.id);
    // A namespaced/path query targets an ID, rather than matching its tokens
    // independently across a model name, family and provider label.
    if (query.includes("/") && !id.replaceAll(" ", "").includes(compactQuery)) return [];
    const text = normalizeModelQuery([model.name, model.id, model.metadata?.family || "", ...modelTraits(model), model.media?.reference || "", options.context || ""].join(" "));
    const compact = text.replaceAll(" ", "");
    if (tokens.some((token) => !text.includes(token) && !compact.includes(token))) return [];
    const score = !normalized ? model.id === options.selectedId ? 0 : 1 : model.id.toLowerCase() === query.trim().toLowerCase() ? 0 : id === normalized ? 1 : name === normalized ? 2 : id.replaceAll(" ", "") === compactQuery || name.replaceAll(" ", "") === compactQuery ? 3 : name.startsWith(normalized) || id.startsWith(normalized) ? 4 : 5;
    return [{ model, score, unavailable }];
  }).sort((a, b) => a.score - b.score || Number(a.unavailable) - Number(b.unavailable) || collator.compare(a.model.name, b.model.name) || collator.compare(a.model.id, b.model.id)).map((item) => item.model);
}
