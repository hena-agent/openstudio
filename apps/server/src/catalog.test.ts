import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "./catalog";
import { accountMetadata, catalogMetadata, catalogModelSchema } from "./model-metadata";
import type { Catalog } from "@openstudio/shared/types";

const globals = globalThis as unknown as { studioCatalog?: Catalog; studioCatalogLoading?: Promise<Catalog> };
let directory: string;
const fixture = { openai: { name: "OpenAI", models: {
  "model-a": { id: "model-a", name: "Model A", canonical_model_id: "openai/model-a", limit: { context: 1_050_000, input: 922_000, output: 128_000 }, modalities: { input: ["text", "image"], output: ["text"] }, reasoning: true, tool_call: false, structured_output: true, temperature: false,
    cost: { input: 0, output: 50, cache_read: 1, tiers: [{ input: 20, output: 75, tier: { type: "context", size: 272_000 } }] } },
} } };
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-catalog-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); delete globals.studioCatalog; delete globals.studioCatalogLoading; });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete globals.studioCatalog; delete globals.studioCatalogLoading; await rm(directory, { recursive: true, force: true }); });

describe("catalog metadata", () => {
  it("preserves capacities, flags, modalities and conditional prices", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture)); vi.stubGlobal("fetch", fetchMock);
    const result = await catalog();
    expect(result.version).toBe(2);
    expect(result.models[0]).toMatchObject({ providerId: "openai", modelId: "model-a", canonicalId: "openai/model-a", metadata: { context: 1_050_000, maxInput: 922_000, maxOutput: 128_000, tools: false, temperature: false, pricing: { input: 0, tiers: [{ contextAbove: 272_000, input: 20, output: 75 }] } } });
    await catalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Disk re-read must preserve metadata, not strip it during cache validation.
    delete globals.studioCatalog;
    expect((await catalog()).models[0].metadata?.pricing?.tiers?.[0].contextAbove).toBe(272_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refreshes fresh legacy snapshots and keeps the last good catalog on failure", async () => {
    await writeFile(path.join(directory, "catalog.json"), JSON.stringify({ models: [{ id: "openai/old-model", name: "Old", provider: "OpenAI", input: [], output: [] }], updatedAt: new Date().toISOString(), stale: false }));
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(fixture)).mockRejectedValueOnce(new Error("offline")); vi.stubGlobal("fetch", fetchMock);
    const first = await catalog();
    expect(first.version).toBe(2);
    const stale = await catalog(true);
    expect(stale.stale).toBe(true);
    expect(stale.models).toEqual(first.models);
  });
  it("does not derive missing input limits or invent zero context for media models", () => {
    const model = catalogModelSchema.parse({ id: "video", name: "Video", limit: { context: 0, output: 0 }, modalities: { input: ["text", "image"], output: ["video"] } });
    const metadata = catalogMetadata(model);
    expect(metadata.context).toBeUndefined(); expect(metadata.maxInput).toBeUndefined(); expect(metadata.maxOutput).toBeUndefined(); expect(metadata.pricing).toBeUndefined();
    expect(metadata.output).toEqual(["video"]);
  });
  it("retains documented account limits and explicit unsupported capabilities only", () => {
    expect(accountMetadata({ context_window: 128_000, max_output_tokens: 8192, supported_reasoning_levels: [{ effort: "medium" }] })).toMatchObject({ context: 128_000, maxOutput: 8192, reasoning: true });
    expect(accountMetadata({ capabilities: { limits: { max_context_window_tokens: 64_000, max_prompt_tokens: 60_000 }, supports: { tool_calls: false } } })).toMatchObject({ context: 64_000, maxInput: 60_000, tools: false });
    expect(accountMetadata({ context_window: 128_000 })?.maxInput).toBeUndefined();
    expect(accountMetadata({})).toBeUndefined();
  });
});
