import { describe, expect, it } from "vitest";
import type { Model } from "@openstudio/shared/types";
import { modelDisabledReason, modelTraits, searchModels } from "./model-search";

const model = (id: string, name = id, extra: Partial<Model> = {}): Model => ({ id, name, endpoints: [], ...extra });
const video = (id: string, reference?: "none" | "optional" | "required") => model(id, "Kling 4.0", { tasks: ["video"], media: { kind: "video", reference } });

describe("shared model search", () => {
  it("matches tokens in any order and normalizes case, full-width text and punctuation", () => {
    const models = [model("openai/gpt-6.1", "GPT 6.1"), model("fal/kling-4/image-to-video", "Kling 4 Image"), model("fal/kling-4/text-to-video", "Kling 4 Text")];
    expect(searchModels(models, "ｇｐｔ６１").map((item) => item.id)).toEqual(["openai/gpt-6.1"]);
    expect(searchModels(models, "IMAGE kling 4").map((item) => item.id)).toEqual(["fal/kling-4/image-to-video"]);
    expect(searchModels(models, "unrelated")).toEqual([]);
  });
  it("ranks exact IDs and names ahead of partial matches, retaining duplicate display-name variants", () => {
    const models = [model("vendor/alpha-extra", "Alpha"), model("vendor/alpha", "Alpha"), model("vendor/alphabet", "Alphabet")];
    expect(searchModels(models, "vendor/alpha")[0].id).toBe("vendor/alpha");
    expect(searchModels([...models, model("elsewhere/model", "Vendor Alpha")], "vendor/alpha").some((item) => item.id === "elsewhere/model")).toBe(false);
    expect(searchModels(models, "Alpha").map((item) => item.name)).toEqual(["Alpha", "Alpha", "Alphabet"]);
    expect(searchModels(models, "", { selectedId: "vendor/alphabet" })[0].id).toBe("vendor/alphabet");
    expect(models.map((item) => item.id)).toEqual(["vendor/alpha-extra", "vendor/alpha", "vendor/alphabet"]);
  });
  it("filters known reference requirements without treating unknown conditions as unsupported", () => {
    const models = [video("text", "none"), video("image", "required"), video("reference", "optional"), video("unknown")];
    expect(searchModels(models, "", { reference: "required" }).map((item) => item.id)).toEqual(["image"]);
    expect(searchModels(models, "", { reference: "unknown" }).map((item) => item.id)).toEqual(["unknown"]);
    expect(searchModels(models, "이미지 필수").map((item) => item.id)).toEqual(["image"]);
    expect(modelTraits(models[3])).toEqual([]);
  });
  it("separates adapter restrictions from tools-required tasks and preserves unavailable exact matches for inspection", () => {
    const blocked = model("alpha", "Alpha", { callable: false, unavailableReason: "지원하지 않는 endpoint" });
    const noTools = model("plain", "Plain", { metadata: { tools: false } });
    const models = [blocked, noTools, model("alpha-2", "Alpha 2", { metadata: { tools: true } })];
    expect(searchModels(models, "", { hideUnavailable: true }).map((item) => item.id)).toContain("plain");
    expect(searchModels(models, "", { hideUnavailable: true, requireTools: true }).map((item) => item.id)).toEqual(["alpha-2"]);
    expect(modelDisabledReason(blocked)).toBe(blocked.unavailableReason);
    expect(modelDisabledReason(noTools, true)).toContain("도구 호출");
    expect(searchModels(models, "alpha")[0].id).toBe("alpha");
  });
  it("exposes only declared traits and searches provider context and model family", () => {
    const known = model("voice", "Voice", { speech: { maxCharacters: 4000 }, metadata: { family: "Narrator" } });
    expect(modelTraits(known)).toEqual(["최대 4,000자"]);
    expect(modelTraits(model("Image Reference Pro"))).toEqual([]);
    expect(searchModels([known], "ElevenLabs narrator", { context: "ElevenLabs 연결 계정" })).toEqual([known]);
  });
});
