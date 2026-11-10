import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionForKey, discoverAdditional, invokeAdditional } from "./additional-providers";

afterEach(() => vi.unstubAllGlobals());
describe("additional provider adapters", () => {
  it("uses Claude models pagination and Messages rather than OpenAI requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "claude-test", display_name: "Claude" }], has_more: true, last_id: "next" })).mockResolvedValueOnce(Response.json({ data: [{ id: "claude-other" }], has_more: false })).mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: "hello" }] })); vi.stubGlobal("fetch", fetchMock);
    const connection = connectionForKey("anthropic", "private-token", "Claude", "id");
    const models = await discoverAdditional(connection); expect(models).toHaveLength(2);
    expect(await invokeAdditional(connection, models[0], "prompt")).toMatchObject({ text: "hello", endpoint: "/messages" });
    expect(fetchMock.mock.calls[1][0]).toContain("after_id=next");
    expect(fetchMock.mock.calls[2][1].headers["x-api-key"]).toBe("private-token");
  });
  it("keeps Gemini API keys in headers and reads model limits", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-test", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 64000 }] })).mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })); vi.stubGlobal("fetch", fetchMock);
    const connection = connectionForKey("google", "private-token", "Google", "id");
    const models = await discoverAdditional(connection); expect(models[0].metadata?.maxInput).toBe(64000);
    expect((await invokeAdditional(connection, models[0], "prompt")).text).toBe("hello");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("private-token"))).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("private-token");
  });
  it("validates OpenRouter credentials before accepting its public model inventory", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })); vi.stubGlobal("fetch", fetchMock);
    await expect(discoverAdditional(connectionForKey("openrouter", "bad-key", "Router", "id"))).rejects.toMatchObject({ code: "authentication_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/key");
  });
});
