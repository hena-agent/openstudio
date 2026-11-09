import type { Catalog, CatalogModel, Model, ModelMetadata } from "./types";

export type MetadataSource = "provider" | "catalog";
export type ResolvedMetadata = {
  values: ModelMetadata;
  sources: Partial<Record<keyof ModelMetadata, MetadataSource>>;
  reference?: CatalogModel;
};

export function resolveModelMetadata(model: Model, providerId: string, catalog?: Catalog, reference?: CatalogModel): ResolvedMetadata {
  // Never use display-name/fuzzy matching or borrow limits/prices from another host.
  reference ??= catalog?.models.find((item) => item.id === `${providerId}/${model.id}`);
  if (!reference) {
    const canonicalMatches = catalog?.models.filter((item) => item.providerId === providerId && item.canonicalId === model.id) || [];
    if (canonicalMatches.length === 1) reference = canonicalMatches[0];
  }
  const values: ModelMetadata = {};
  const sources: ResolvedMetadata["sources"] = {};
  for (const [source, metadata] of [["catalog", reference?.metadata], ["provider", model.metadata]] as const) {
    for (const [field, value] of Object.entries(metadata || {})) {
      if (value === undefined || (Array.isArray(value) && !value.length)) continue;
      // Assign only known metadata fields; preserve explicit false and zero prices.
      Object.assign(values, { [field]: value });
      sources[field as keyof ModelMetadata] = source;
    }
  }
  return { values, sources, reference };
}

export function formatTokens(value: number | undefined, compact = false) {
  if (value === undefined || value <= 0 || !Number.isFinite(value)) return "미확인";
  if (!compact) return new Intl.NumberFormat("en-US").format(value);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function formatPrice(value: number | undefined) {
  return value === undefined ? "미확인" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
}

export function formatCapability(value: boolean | undefined) {
  return value === undefined ? "미확인" : value ? "지원" : "미지원";
}
