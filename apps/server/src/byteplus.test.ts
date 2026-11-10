import { afterEach, describe, expect, it, vi } from "vitest";
import { BYTEPLUS_BASE_URL, byteplusSettingsSchema } from "@openstudio/shared/byteplus-config";
import { byteplusExecutionRestriction, byteplusImageOutputs, byteplusMediaPayload, byteplusVideoResult, discoverBytePlus, mapBytePlusModels } from "./byteplus";
import type { StoredConnection } from "./storage";

const settings = { region: "ap-southeast-1" as const, registrations: [] };
const catalog = { data: [
  { id: "image-fixture", name: "Image fixture", modalities: { input_modalities: ["text", "image"], output_modalities: ["image"] } },
  { id: "video-fixture", name: "Video fixture", modalities: { input_modalities: ["text", "image"], output_modalities: ["video"] } },
  { id: "text-fixture", task_type: ["TextGeneration"], token_limits: { context_window: 100000, max_input_token_length: 90000, max_output_token_length: 10000 }, features: { tools: { function_calling: true } } },
  { id: "dreamina-seedance-2-5-fixture", modalities: { output_modalities: ["video"] } },
] };
const connection: StoredConnection = { id: "id", provider: "byteplus", method: "api-key", label: "BytePlus", secret: "private-key", baseURL: BYTEPLUS_BASE_URL, byteplus: settings, createdAt: "now", models: [] };
afterEach(() => vi.unstubAllGlobals());
describe("BytePlus ModelArk protocol", () => {
  it("reads actual modalities/limits instead of classifying everything as text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(catalog)); vi.stubGlobal("fetch", fetchMock);
    const models = await discoverBytePlus(connection);
    expect(models[0]).toMatchObject({ tasks: ["image"], endpoints: ["/images/generations"] });
    expect(models[1]).toMatchObject({ tasks: ["video"], endpoints: ["/contents/generations/tasks"] });
    expect(models[2].metadata).toMatchObject({ context: 100000, maxInput: 90000, maxOutput: 10000, tools: true });
    expect(models[3].callable).toBe(false);
    expect(fetchMock.mock.calls[0]).toEqual([`${BYTEPLUS_BASE_URL}/models`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer private-key" }) })]);
  });
  it("preserves opaque image endpoint IDs without claiming the mapping is verified", () => {
    const custom = { ...settings, registrations: [{ id: "ep-image-unit", kind: "image" as const, baseModelId: "image-fixture", name: "Custom image" }] };
    const model = mapBytePlusModels(catalog, custom).find((model) => model.id === "ep-image-unit")!;
    expect(model.registration).toEqual({ baseModelId: "image-fixture", mappingVerified: false });
    const body = byteplusMediaPayload({ ...connection, byteplus: custom }, model, "image", "edit", { size: "2K", output_format: "png" }, ["data:image/png;base64,first", "data:image/png;base64,second"]);
    expect(body).toMatchObject({ model: "ep-image-unit", prompt: "edit", image: ["data:image/png;base64,first", "data:image/png;base64,second"], size: "2K", response_format: "url", stream: false });
    expect(body).not.toHaveProperty("input_references");
  });
  it("uses content/role and ratio for video, never OpenRouter frame_images", () => {
    const model = mapBytePlusModels(catalog, settings)[1];
    const body = byteplusMediaPayload(connection, model, "video", "move", { duration: 5, ratio: "9:16", generate_audio: true }, ["first", "last"]);
    expect(body).toEqual({ model: "video-fixture", content: [{ type: "text", text: "move" }, { type: "image_url", image_url: { url: "first" }, role: "first_frame" }, { type: "image_url", image_url: { url: "last" }, role: "last_frame" }], duration: 5, ratio: "9:16", generate_audio: true, output_format: "mp4" });
    expect(() => byteplusMediaPayload(connection, model, "video", "test", { aspect_ratio: "9:16" }, [])).toThrow("옵션");
  });
  it("does not bypass Seedance requirements through manually named opaque endpoints", () => {
    for (const baseModelId of [undefined, "dreamina-seedance-2-5-fixture", "seedance-5.0-unverified"]) {
      const models = mapBytePlusModels(catalog, { ...settings, registrations: [{ id: "ep-video-unit", kind: "video", baseModelId }] });
      const model = models.find((model) => model.id === "ep-video-unit")!;
      expect(model.callable).toBe(false); expect(byteplusExecutionRestriction(model)).toBeTruthy();
      expect(() => byteplusMediaPayload(connection, model, "video", "test", {}, [])).toThrow();
    }
  });
  it("rejects region, URL and ID injections before sending any credential", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(() => byteplusSettingsSchema.parse({ region: "other", registrations: [] })).toThrow();
    expect(() => byteplusSettingsSchema.parse({ registrations: [{ id: "../../private", kind: "image" }] })).toThrow();
    await expect(discoverBytePlus({ ...connection, baseURL: "https://evil.test/api/v3" })).rejects.toMatchObject({ code: "invalid_region" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires correct task identity and succeeded status before obtaining a video", () => {
    expect(byteplusVideoResult({ id: "task", status: "queued" }, "task").status).toBe("pending");
    expect(byteplusVideoResult({ id: "task", status: "running" }, "task").status).toBe("running");
    expect(byteplusVideoResult({ id: "task", status: "succeeded", content: { video_url: "https://output.bytepluses.com/video.mp4" } }, "task")).toMatchObject({ status: "completed" });
    expect(() => byteplusVideoResult({ id: "other", status: "succeeded", content: { video_url: "https://output.bytepluses.com/video.mp4" } }, "task")).toThrow("ID");
    expect(() => byteplusVideoResult({ id: "task", status: "succeeded" }, "task")).toThrow("URL");
    for (const status of ["failed", "cancelled", "expired"]) expect(() => byteplusVideoResult({ id: "task", status }, "task")).toThrow("실패");
  });
  it("separates failed image entries and accepts URL/base64 without exposing raw errors", () => {
    expect(byteplusImageOutputs({ data: [{ url: "https://output.bytepluses.com/image.png" }, { error: { message: "private detail" } }] })).toEqual({ outputs: [{ url: "https://output.bytepluses.com/image.png" }], partial: true });
    expect(byteplusImageOutputs({ data: [{ b64_json: "image-data" }] }).outputs).toEqual([{ base64: "image-data" }]);
    expect(() => byteplusImageOutputs({ error: { code: "failed", message: "private detail" } })).toThrow("BytePlus 이미지 생성이 실패");
  });
});
