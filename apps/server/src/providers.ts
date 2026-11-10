import { z } from "zod";
import type { Model } from "@openstudio/shared/types";
import { AppError, type StoredConnection } from "./storage";
import { accountMetadata } from "./model-metadata";
import { discoverAdditional, invokeAdditional } from "./additional-providers";

export const githubHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": "OpenStudio/0.1",
};
const remoteModel = z.object({
  id: z.string(), name: z.string().optional(), supported_endpoints: z.array(z.string()).optional(),
  model_picker_enabled: z.boolean().optional(), policy: z.object({ state: z.string().optional() }).optional(),
});

export async function requestJSON(url: string, init: RequestInit = {}, timeoutMs = 45_000) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch {
    throw new AppError("제공자에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 502, "provider_unreachable");
  }
  if (!response.ok) {
    if (url === "https://auth.openai.com/api/accounts/oauth/token" && response.status === 400) {
      throw new AppError("OpenAI 인증 코드 또는 갱신 토큰이 만료·폐기되었습니다. 다시 로그인하세요.", 401, "reconnect_required");
    }
    const code = response.status === 401 ? "authentication_failed" : response.status === 403 ? "permission_denied" : response.status === 429 ? "rate_limited" : "provider_error";
    const message = response.status === 401 ? "인증이 만료되었거나 키가 유효하지 않습니다. 다시 연결해 주세요." : response.status === 403 ? "이 계정 또는 OAuth 앱에 모델 사용 권한이 없습니다." : response.status === 429 ? "제공자의 사용량 또는 요청 한도를 초과했습니다." : `제공자가 요청을 거절했습니다 (HTTP ${response.status}).`;
    throw new AppError(message, 502, code, response.status);
  }
  try { return await response.json(); }
  catch { throw new AppError("제공자의 응답 형식을 확인할 수 없습니다.", 502, "invalid_response"); }
}

export function clientId() {
  const id = process.env.GITHUB_COPILOT_CLIENT_ID;
  if (!id) throw new AppError("GITHUB_COPILOT_CLIENT_ID가 필요합니다. Device flow와 Copilot API 접근이 가능한 OAuth 앱을 설정해 주세요.", 503, "configuration_required");
  return id;
}

export function copilotEndpoint(input: string | undefined) {
  const url = new URL(input || "https://api.githubcopilot.com");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)*githubcopilot\.com$/.test(url.hostname) || url.pathname !== "/" || url.search || url.hash) {
    throw new AppError("제공자가 반환한 Copilot endpoint를 사용할 수 없습니다.", 502, "invalid_endpoint");
  }
  return url.origin;
}

export function providerHeaders(connection: Pick<StoredConnection, "provider" | "secret">) {
  return {
    ...githubHeaders,
    Authorization: `Bearer ${connection.secret}`,
    ...(connection.provider === "github-copilot" ? {
      "X-GitHub-Api-Version": "2026-08-01",
      "Openai-Intent": "conversation-edits",
      "X-Interaction-Type": "conversation-agent",
      "x-initiator": "user",
    } : {}),
  };
}

export async function discover(connection: Pick<StoredConnection, "provider" | "secret" | "baseURL"> & Partial<Pick<StoredConnection, "method">>): Promise<Model[]> {
  if (!["openai", "github-copilot"].includes(connection.provider)) return discoverAdditional(connection as StoredConnection);
  const payload = await requestJSON(`${connection.baseURL}/models`, { headers: providerHeaders(connection) });
  if (connection.provider === "openai" && connection.method === "oauth") {
    const response = z.object({ models: z.array(z.object({ slug: z.string(), display_name: z.string(), visibility: z.string() }).passthrough()) }).parse(payload);
    return response.models.filter((model) => model.visibility === "list").map((model) => {
      const metadata = accountMetadata(model);
      return { id: model.slug, name: model.display_name, endpoints: ["/responses"], callable: true,
        ...(metadata ? { metadata, metadataUpdatedAt: new Date().toISOString() } : {}),
      };
    });
  }
  const parsed = z.object({ data: z.array(z.unknown()) }).parse(payload);
  return parsed.data.flatMap((raw) => {
    const model = remoteModel.safeParse(raw);
    if (!model.success || model.data.policy?.state === "disabled" || model.data.model_picker_enabled === false) return [];
    const metadata = accountMetadata(raw);
    return [{ id: model.data.id, name: model.data.name || model.data.id, endpoints: model.data.supported_endpoints || [],
      ...(metadata ? { metadata, metadataUpdatedAt: new Date().toISOString() } : {}),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function inferenceEndpoint(model: Model, provider: StoredConnection["provider"]) {
  if (provider === "openai") return "/responses";
  if (model.endpoints.includes("/v1/messages")) return "/v1/messages";
  if (model.endpoints.includes("/responses")) return "/responses";
  if (model.endpoints.includes("/chat/completions")) return "/chat/completions";
  if (/^gpt-[5-9]/.test(model.id) || /^(grok-|mai-code-)/.test(model.id)) return "/responses";
  return "/chat/completions";
}

export async function invoke(connection: StoredConnection, model: Model, prompt: string) {
  if (model.tasks && !model.tasks.includes("text")) throw new AppError("이 모델은 텍스트 작업 대신 이미지·영상 작업에서 실행하세요.");
  if (!["openai", "github-copilot"].includes(connection.provider)) return invokeAdditional(connection, model, prompt);
  const endpoint = inferenceEndpoint(model, connection.provider);
  if (connection.provider === "openai" && connection.method === "oauth") return invokePlan(connection, model, prompt);
  const body = endpoint === "/responses"
    ? { model: model.id, input: prompt, max_output_tokens: 512, store: false }
    : { model: model.id, messages: [{ role: "user", content: prompt }], max_tokens: 512, stream: false };
  const result = await requestJSON(`${connection.baseURL}${endpoint}`, {
    method: "POST",
    headers: { ...providerHeaders(connection), ...(endpoint === "/v1/messages" ? { "anthropic-version": "2023-06-01" } : {}) },
    body: JSON.stringify(body),
  });
  const text = endpoint === "/responses"
    ? (result.output || []).flatMap((item: { content?: { text?: string }[] }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
    : endpoint === "/v1/messages"
      ? (result.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      : result.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AppError("텍스트 결과가 없습니다. 모델의 응답·출력 제한을 확인해 주세요.", 502, "empty_response");
  return { text, endpoint, model: model.id };
}

export async function readResponsesStream(response: Response) {
  if (!response.ok) {
    const code = response.status === 401 ? "reconnect_required" : response.status === 403 ? "plan_permission_required" : response.status === 429 ? "rate_limited" : "provider_error";
    throw new AppError(`OpenAI 요청 실패 (HTTP ${response.status}). ${response.status === 401 ? "다시 로그인하세요." : "구독 권한과 사용량을 확인하세요."}`, 502, code);
  }
  if (!response.body) throw new AppError("OpenAI가 빈 응답을 반환했습니다.", 502, "invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", completed = false;
  let format: "sse" | "json" | undefined;
  const declaredType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const mediaType = ["text/event-stream", "application/json", "text/html", "text/plain"].includes(declaredType || "") ? declaredType : "알 수 없는 Content-Type";
  const invalidFormat = () => new AppError(`OpenAI가 지원하지 않는 응답을 반환했습니다 (${mediaType}). SSE 이벤트나 완료된 Responses JSON이 아닙니다.`, 502, "invalid_response");
  const processEvent = (block: string) => {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { throw new AppError("OpenAI 스트림을 읽지 못했습니다.", 502, "invalid_response"); }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    if (event.type === "response.completed") {
      completed = true;
      if (!text) text = (event.response?.output || []).flatMap((item: { content?: { text?: string }[] }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n");
    }
    if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
      const code = event.response?.error?.code || event.error?.code || event.code;
      const limited = ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable", "rate_limit_exceeded"].includes(code);
      const knownMessages: Record<string, string> = {
        model_not_found: "이 계정에서 선택한 모델을 사용할 수 없습니다. 모델 목록을 다시 조회하세요.",
        unsupported_parameter: "선택한 모델이 요청 옵션을 지원하지 않습니다.",
        insufficient_permissions: "이 계정에 요청한 모델의 사용 권한이 없습니다.",
      };
      throw new AppError(limited ? "ChatGPT 구독 공유 사용량을 사용할 수 없거나 한도에 도달했습니다. ChatGPT 사용량 설정을 확인하세요." : knownMessages[code] || "OpenAI 응답이 완료되지 않았습니다. 모델 권한과 요청을 확인하세요.", 502, limited ? "rate_limited" : "incomplete_response");
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      if (buffer.length + text.length > 2_000_000) throw new AppError("모델 응답이 테스트 크기 제한을 초과했습니다.", 502, "response_too_large");
      if (!format) {
        const start = buffer.trimStart();
        if (start.startsWith("{")) format = "json";
        else if (/^(data:|event:|:)/.test(start)) format = "sse";
        else if (start && !["data:", "event:"].some((prefix) => prefix.startsWith(start))) throw invalidFormat();
      }
      if (format !== "sse") continue;
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        processEvent(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
      }
      if (completed) break;
    }
    if (format === "json") {
      let result;
      try { result = JSON.parse(buffer); } catch { throw invalidFormat(); }
      if (!result || typeof result !== "object" || Array.isArray(result)) throw invalidFormat();
      if (result.error) processEvent(`data: ${JSON.stringify({ type: "error", error: result.error })}`);
      else if (result.object === "response" && result.status === "completed") processEvent(`data: ${JSON.stringify({ type: "response.completed", response: result })}`);
      else if (result.object === "response" && ["failed", "incomplete"].includes(result.status)) processEvent(`data: ${JSON.stringify({ type: `response.${result.status}`, response: result })}`);
      else if (["response.completed", "response.failed", "response.incomplete", "error"].includes(result.type)) processEvent(`data: ${JSON.stringify(result)}`);
      else throw invalidFormat();
    } else if (buffer.trim() && !completed) processEvent(buffer);
  } finally { await reader.cancel().catch(() => {}); }
  if (!completed) throw new AppError("응답 스트림이 완료 전에 끊겼습니다. 성공으로 기록하지 않았습니다.", 502, "interrupted_stream");
  if (!text.trim()) throw new AppError("완료된 응답에 텍스트가 없습니다.", 502, "empty_response");
  return text;
}

async function invokePlan(connection: StoredConnection, model: Model, prompt: string) {
  let response: Response;
  try {
    response = await fetch(`${connection.baseURL}/responses`, {
      method: "POST", headers: { ...providerHeaders(connection), Accept: "text/event-stream" },
      body: JSON.stringify({ model: model.id, input: [{ role: "user", content: prompt }], store: false, stream: true }),
      redirect: "error", signal: AbortSignal.timeout(180_000),
    });
  } catch { throw new AppError("OpenAI에 연결할 수 없습니다.", 502, "provider_unreachable"); }
  return { text: await readResponsesStream(response), endpoint: "/responses · SSE", model: model.id };
}
