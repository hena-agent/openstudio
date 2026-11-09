export type ProviderId = "github-copilot" | "openai";
export type TokenPricing = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  tiers?: { contextAbove: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }[];
};
export type ModelMetadata = {
  context?: number;
  maxInput?: number;
  maxOutput?: number;
  input?: string[];
  output?: string[];
  reasoning?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  pricing?: TokenPricing;
  description?: string;
  family?: string;
  releaseDate?: string;
  knowledge?: string;
  openWeights?: boolean;
};
export type Model = {
  id: string;
  name: string;
  endpoints: string[];
  callable?: boolean;
  metadata?: ModelMetadata;
  metadataUpdatedAt?: string;
};
export type Connection = {
  id: string;
  provider: ProviderId;
  label: string;
  method: "oauth" | "api-key";
  createdAt: string;
  verifiedAt?: string;
  models: Model[];
  modelsCheckedAt?: string;
  status?: "connected" | "disconnected";
  planEnabled?: boolean;
};
export type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  input: string[];
  output: string[];
  providerId?: string;
  modelId?: string;
  canonicalId?: string;
  metadata?: ModelMetadata;
};
export type Catalog = { models: CatalogModel[]; updatedAt: string; stale: boolean; version?: number };
export type DeviceAuthorization = {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};
