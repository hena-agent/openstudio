import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Catalog } from "../types";
import { requestJSON } from "./providers";
import { catalogMetadata, catalogModelSchema, metadataSchema } from "./model-metadata";

const providerSchema = z.object({ name: z.string(), models: z.record(z.string(), z.unknown()) });
const snapshotSchema = z.object({
  updatedAt: z.string(), stale: z.boolean(), version: z.number().optional(),
  models: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string(), input: z.array(z.string()), output: z.array(z.string()),
    providerId: z.string().optional(), modelId: z.string().optional(), canonicalId: z.string().optional(), metadata: metadataSchema.optional(),
  })),
});
const cache = globalThis as unknown as { studioCatalog?: Catalog; studioCatalogLoading?: Promise<Catalog> };

export async function catalog(force = false): Promise<Catalog> {
  const directory = process.env.OPENSTUDIO_DATA_DIR || path.join(process.cwd(), ".data");
  const file = path.join(directory, "catalog.json");
  if (!cache.studioCatalog) {
    try { cache.studioCatalog = snapshotSchema.parse(JSON.parse(await readFile(file, "utf8"))); } catch { /* No valid previous snapshot. */ }
  }
  if (!force && cache.studioCatalog?.version === 2 && Date.now() - Date.parse(cache.studioCatalog.updatedAt) < 6 * 60 * 60 * 1000) return { ...cache.studioCatalog, stale: false };
  if (cache.studioCatalogLoading) return cache.studioCatalogLoading;
  cache.studioCatalogLoading = (async () => {
    try {
      const payload = z.record(z.string(), z.unknown()).parse(await requestJSON("https://models.dev/api.json?type=all"));
      const models: Catalog["models"] = [];
      for (const [providerId, raw] of Object.entries(payload)) {
        const provider = providerSchema.safeParse(raw);
        if (!provider.success) continue;
        for (const rawModel of Object.values(provider.data.models)) {
          const model = catalogModelSchema.safeParse(rawModel);
          if (!model.success) continue;
          models.push({ id: `${providerId}/${model.data.id}`, name: model.data.name, provider: provider.data.name,
            providerId, modelId: model.data.id, canonicalId: model.data.canonical_model_id,
            input: model.data.modalities?.input || [], output: model.data.modalities?.output || [], metadata: catalogMetadata(model.data),
          });
        }
      }
      if (!models.length) throw new Error("Empty catalog");
      const snapshot = { models, updatedAt: new Date().toISOString(), stale: false, version: 2 };
      cache.studioCatalog = snapshot;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot));
      await rename(temp, file);
      return snapshot;
    } catch (error) {
      if (cache.studioCatalog) return { ...cache.studioCatalog, stale: true };
      throw error;
    } finally { cache.studioCatalogLoading = undefined; }
  })();
  return cache.studioCatalogLoading;
}
