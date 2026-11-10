import { describe, expect, it } from "vitest";
import { formatCapability, formatPrice, formatTokens, resolveModelMetadata } from "./model-metadata";
import type { Catalog, Model } from "./types";

const catalog: Catalog = { updatedAt: "2026-11-09T00:00:00Z", stale: false, version: 2, models: [
  { id: "openai/model-a", providerId: "openai", modelId: "model-a", canonicalId: "openai/model-a", name: "Model A", provider: "OpenAI", input: ["text", "image"], output: ["text"], metadata: { context: 1_050_000, maxInput: 922_000, maxOutput: 128_000, reasoning: true, tools: true, input: ["text", "image"], pricing: { input: 10, output: 50 } } },
  { id: "github-copilot/model-a", providerId: "github-copilot", modelId: "model-a", canonicalId: "openai/model-a", name: "Model A", provider: "GitHub Copilot", input: ["text"], output: ["text"], metadata: { context: 128_000, pricing: { input: 0, output: 0 } } },
] };
const model: Model = { id: "model-a", name: "Model A", endpoints: ["/responses"] };
describe("model metadata resolution", () => {
  it("uses exact provider IDs rather than another host's limits or prices", () => {
    const result = resolveModelMetadata(model, "openai", catalog);
    expect(result.values.context).toBe(1_050_000);
    expect(result.values.pricing?.input).toBe(10);
    expect(result.sources.context).toBe("catalog");
    expect(resolveModelMetadata(model, "github-copilot", catalog).values.context).toBe(128_000);
  });
  it("prefers account facts per field, preserving explicit false and reference limits", () => {
    const result = resolveModelMetadata({ ...model, metadata: { context: 64_000, tools: false, input: [] } }, "openai", catalog);
    expect(result.values).toMatchObject({ context: 64_000, maxInput: 922_000, tools: false, input: ["text", "image"] });
    expect(result.sources.context).toBe("provider");
    expect(result.sources.maxInput).toBe("catalog");
    expect(result.reference?.metadata?.context).toBe(1_050_000);
  });
  it("does not fuzzy-match names, variants or unregistered providers", () => {
    expect(resolveModelMetadata({ ...model, id: "model-a-latest" }, "openai", catalog).reference).toBeUndefined();
    expect(resolveModelMetadata(model, "other-host", catalog).reference).toBeUndefined();
    expect(resolveModelMetadata(model, "other-host", catalog).values).toEqual({});
  });
  it("allows an explicit canonical ID only on the same provider", () => {
    expect(resolveModelMetadata({ ...model, id: "openai/model-a" }, "github-copilot", catalog).values.context).toBe(128_000);
    expect(resolveModelMetadata({ ...model, id: "openai/model-a" }, "other-host", catalog).reference).toBeUndefined();
  });
  it("keeps unknown, unsupported, and a zero price distinct", () => {
    expect(formatTokens(0)).toBe("미확인");
    expect(formatTokens(undefined)).toBe("미확인");
    expect(formatTokens(1_050_000)).toBe("1,050,000");
    expect(formatTokens(1_050_000, true)).toBe("1.05M");
    expect(formatPrice(0)).toBe("$0.00");
    expect(formatPrice(undefined)).toBe("미확인");
    expect(formatCapability(false)).toBe("미지원");
    expect(formatCapability(undefined)).toBe("미확인");
  });
});
