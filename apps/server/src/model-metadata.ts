import { z } from "zod";
import type { ModelMetadata } from "@openstudio/shared/types";

const positiveLimit = z.number().finite().nonnegative().optional().transform((value) => value && value > 0 ? value : undefined);
const price = z.number().finite().nonnegative().optional();
const prices = { input: price, output: price, cacheRead: price, cacheWrite: price };
export const metadataSchema = z.object({
  context: positiveLimit, maxInput: positiveLimit, maxOutput: positiveLimit,
  input: z.array(z.string()).optional(), output: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(), tools: z.boolean().optional(), structuredOutput: z.boolean().optional(), temperature: z.boolean().optional(),
  pricing: z.object({ ...prices, tiers: z.array(z.object({ contextAbove: z.number().positive(), ...prices })).optional() }).optional(),
  description: z.string().optional(), family: z.string().optional(), releaseDate: z.string().optional(), knowledge: z.string().optional(), openWeights: z.boolean().optional(),
});

const rawPrices = { input: price, output: price, cache_read: price, cache_write: price };
export const catalogModelSchema = z.object({
  id: z.string(), name: z.string(), canonical_model_id: z.string().optional(),
  modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }).optional(),
  limit: z.object({ context: positiveLimit, input: positiveLimit, output: positiveLimit }).optional(),
  reasoning: z.boolean().optional(), tool_call: z.boolean().optional(), structured_output: z.boolean().optional(), temperature: z.boolean().optional(),
  description: z.string().optional(), family: z.string().optional(), release_date: z.string().optional(), knowledge: z.string().optional(), open_weights: z.boolean().optional(),
  cost: z.object({ ...rawPrices, tiers: z.array(z.object({ ...rawPrices, tier: z.object({ type: z.string(), size: z.number().positive() }) })).optional() }).optional(),
});

export function catalogMetadata(model: z.infer<typeof catalogModelSchema>): ModelMetadata {
  const cost = model.cost;
  return metadataSchema.parse({
    context: model.limit?.context, maxInput: model.limit?.input, maxOutput: model.limit?.output,
    input: model.modalities?.input, output: model.modalities?.output,
    reasoning: model.reasoning, tools: model.tool_call, structuredOutput: model.structured_output, temperature: model.temperature,
    description: model.description, family: model.family, releaseDate: model.release_date, knowledge: model.knowledge, openWeights: model.open_weights,
    pricing: cost ? {
      input: cost.input, output: cost.output, cacheRead: cost.cache_read, cacheWrite: cost.cache_write,
      tiers: cost.tiers?.filter((tier) => tier.tier.type === "context").map((tier) => ({ contextAbove: tier.tier.size, input: tier.input, output: tier.output, cacheRead: tier.cache_read, cacheWrite: tier.cache_write })),
    } : undefined,
  });
}

// Explicit account API fields only. Do not derive max input by subtracting output.
export const accountModelSchema = z.object({
  context_window: positiveLimit, max_output_tokens: positiveLimit,
  max_input_tokens: positiveLimit,
  input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional(),
  capabilities: z.object({
    limits: z.object({ max_context_window_tokens: positiveLimit, max_prompt_tokens: positiveLimit, max_output_tokens: positiveLimit }).optional(),
    supports: z.object({ tool_calls: z.boolean().optional(), structured_outputs: z.boolean().optional(), reasoning_effort: z.array(z.string()).optional() }).optional(),
  }).optional(),
});

export function accountMetadata(raw: unknown): ModelMetadata | undefined {
  const parsed = accountModelSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  const limits = data.capabilities?.limits, supports = data.capabilities?.supports;
  const values = {
    context: limits?.max_context_window_tokens ?? data.context_window,
    maxInput: limits?.max_prompt_tokens ?? data.max_input_tokens,
    maxOutput: limits?.max_output_tokens ?? data.max_output_tokens,
    input: data.input_modalities, output: data.output_modalities,
    tools: supports?.tool_calls, structuredOutput: supports?.structured_outputs,
    reasoning: data.supported_reasoning_levels?.length ? true : supports?.reasoning_effort?.length ? true : undefined,
  };
  return Object.values(values).some((value) => value !== undefined) ? metadataSchema.parse(values) : undefined;
}
