import { afterEach, describe, expect, it, vi } from "vitest";
import { copilotEndpoint, discover, inferenceEndpoint, invoke, readResponsesStream, requestJSON } from "./providers";

afterEach(() => vi.unstubAllGlobals());
describe("provider requests", () => {
  it("rejects endpoints outside GitHub Copilot before sending credentials", () => {
    expect(copilotEndpoint("https://api.business.githubcopilot.com")).toBe("https://api.business.githubcopilot.com");
    for (const input of ["http://127.0.0.1", "https://githubcopilot.com.evil.test", "https://api.githubcopilot.com@evil.test", "https://api.githubcopilot.com/path"]) {
      expect(() => copilotEndpoint(input)).toThrow();
    }
  });

  it("selects advertised endpoints before fallbacks", () => {
    expect(inferenceEndpoint({ id: "new-model", name: "new", endpoints: ["/v1/messages"] }, "github-copilot")).toBe("/v1/messages");
    expect(inferenceEndpoint({ id: "gpt-5", name: "new", endpoints: [] }, "github-copilot")).toBe("/responses");
  });

  it("filters disabled models and preserves unknown models with supported endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "new-model", name: "New", supported_endpoints: ["/responses"] },
      { id: "blocked", policy: { state: "disabled" } },
      { id: "hidden", model_picker_enabled: false }, { invalid: true },
    ] }))));
    expect(await discover({ provider: "github-copilot", secret: "token", baseURL: "https://api.githubcopilot.com" })).toEqual([{ id: "new-model", name: "New", endpoints: ["/responses"] }]);
  });

  it.each([[401, "authentication_failed"], [403, "permission_denied"], [429, "rate_limited"], [503, "provider_error"]])("classifies HTTP %i without exposing upstream secrets", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-token", { status })));
    await expect(requestJSON("https://api.openai.com/v1/models")).rejects.toMatchObject({ code });
  });

  it("sends real inference format and extracts text without exposing authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "response" }] }] })));
    vi.stubGlobal("fetch", fetchMock);
    const connection = { id: "id", provider: "openai" as const, secret: "private-token", baseURL: "https://api.openai.com/v1", models: [], createdAt: "now", method: "api-key" as const, label: "account" };
    const result = await invoke(connection, { id: "model", name: "Model", endpoints: [] }, "prompt");
    expect(result).toEqual({ text: "response", endpoint: "/responses", model: "model" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({ input: "prompt", store: false });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("uses the ChatGPT account model catalog rather than an API-key catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [
      { slug: "latest-model", display_name: "Latest", visibility: "list" },
      { slug: "internal", display_name: "Internal", visibility: "hidden" },
    ] })));
    expect(await discover({ provider: "openai", method: "oauth", secret: "token", baseURL: "https://api.openai.com/v1" })).toEqual([{ id: "latest-model", name: "Latest", endpoints: ["/responses"], callable: true }]);
  });

  it("preserves account-specific model capacities during discovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [{ slug: "latest-model", display_name: "Latest", visibility: "list", context_window: 256_000, max_output_tokens: 32_000 }] })));
    const models = await discover({ provider: "openai", method: "oauth", secret: "token", baseURL: "https://api.openai.com/v1" });
    expect(models[0].metadata).toMatchObject({ context: 256_000, maxOutput: 32_000 });
    expect(models[0].metadataUpdatedAt).toBeTruthy();
  });

  it("requires a completed SSE event, including when delimiters and UTF-8 cross chunks", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"type":"response.output_text.delta","delta":"안녕"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n');
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
    expect(await readResponsesStream(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))).toBe("안녕");
    await expect(readResponsesStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } }))).rejects.toMatchObject({ code: "interrupted_stream" });
  });

  it("does not count partial text followed by a usage-limit event as success", async () => {
    const stream = 'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n';
    await expect(readResponsesStream(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("omits API-only fields on ChatGPT subscription requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"response.output_text.delta","delta":"done"}\n\ndata: {"type":"response.completed"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    await invoke({ id: "id", provider: "openai", method: "oauth", label: "ChatGPT", createdAt: "now", secret: "token", baseURL: "https://api.openai.com/v1", models: [] }, { id: "model", name: "Model", endpoints: ["/responses"] }, "prompt");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ model: "model", input: [{ role: "user", content: "prompt" }], store: false, stream: true });
    expect(body).not.toHaveProperty("max_output_tokens");
  });
});
