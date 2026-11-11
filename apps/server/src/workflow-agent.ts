import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple as responses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as completions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as anthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as google } from "@earendil-works/pi-ai/api/google-generative-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Model as PiModel } from "@earendil-works/pi-ai";
import { z } from "zod";
import { workflowDefinitionSchema, workflowIssues } from "@openstudio/shared/workflow";
import { AppError, transaction } from "./storage";
import { refreshOpenAI } from "./openai-oauth";
import { inferenceEndpoint, providerHeaders } from "./providers";
import { addLog, finalizeWorkflowTask, taskProjectIn, validateStepConfiguration, workflowRunId } from "./workflows";
import type { AgentResult, StoredWorkflowTask } from "./workflow-types";
import { piResponsesFetch } from "./pi-responses-fetch";
import { referenceData } from "./assets";

const proposalSchema = z.object({ scope: z.literal("single-video"), name: z.string().trim().min(1).max(120), summary: z.string().min(1).max(4000), ...workflowDefinitionSchema.shape, outputs: workflowDefinitionSchema.shape.outputs.default([]) });
const resultSchema = z.object({ content: z.string().trim().min(1).max(40000) });
const questionSchema = z.object({ question: z.string().trim().min(1).max(2000) });
const publicFailure = (message?: string) => /401|authentication|invalid.api.key|reconnect/i.test(message || "") ? "에이전트 계정 인증을 확인하고 다시 연결하세요." : /403|permission|scope/i.test(message || "") ? "이 계정에 에이전트 모델·도구 호출 권한이 없습니다." : /429|rate.limit|usage.limit/i.test(message || "") ? "에이전트 모델의 사용량 또는 요청 한도를 초과했습니다." : "에이전트가 응답을 완료하지 못했습니다. 계정·모델의 도구 호출 지원과 사용량을 확인하세요.";
function failedStream(model: PiModel<any>, message: string) {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, stopReason: "error", timestamp: Date.now(), errorMessage: message,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }); stream.end(); return stream;
}
export function agentModel(task: StoredWorkflowTask): PiModel<any> {
  const model = task.modelSnapshot, provider = task.provider;
  const endpoint = inferenceEndpoint(model, provider);
  const api = provider === "anthropic" || provider === "github-copilot" && endpoint === "/v1/messages" ? "anthropic-messages" : provider === "google" ? "google-generative-ai" : provider === "openai" || provider === "github-copilot" && endpoint === "/responses" ? "openai-responses" : "openai-completions";
  return { id: model.id, name: model.name, api, provider, baseUrl: task.providerBaseURL, input: model.metadata?.input?.includes("image") ? ["text", "image"] : ["text"], reasoning: model.metadata?.reasoning === true,
    contextWindow: model.metadata?.context || 128000, maxTokens: Math.min(model.metadata?.maxOutput || 8192, 8192),
    cost: { input: model.metadata?.pricing?.input || 0, output: model.metadata?.pricing?.output || 0, cacheRead: 0, cacheWrite: 0 } };
}
export function workflowStream(workspaceId: string, task: StoredWorkflowTask): StreamFn {
  return async (model, context, options) => {
    try {
      const resolved = await transaction(workspaceId, async (data) => {
        const connection = data.connections.find((item) => item.id === task.agent.connectionId && item.status !== "disconnected");
        if (!connection || connection.provider !== task.provider || !connection.secret) throw new AppError("연결 계정의 인증 정보를 확인하세요.", 401, "reconnect_required");
        try { await refreshOpenAI(connection); return { secret: connection.secret, headers: connection.provider === "github-copilot" ? providerHeaders(connection) : undefined }; }
        catch (error) { return { fault: error }; }
      });
      if ("fault" in resolved) throw resolved.fault;
      const settings = { ...options, apiKey: resolved.secret, headers: resolved.headers, maxTokens: model.maxTokens, maxRetries: 0, timeoutMs: 90_000, cacheRetention: "none" as const, ...(model.api === "openai-responses" ? { fetch: piResponsesFetch } : {}),
        onPayload: (raw: unknown) => {
          if (task.provider !== "openai") return raw;
          const payload = raw as Record<string, unknown>;
          payload.store = false;
          if (task.providerBaseURL === "https://api.openai.com/v1" && !resolved.secret.startsWith("sk-")) {
            delete payload.max_output_tokens; delete payload.temperature; delete payload.prompt_cache_key; delete payload.prompt_cache_retention;
          }
          return payload;
        } };
      if (model.api === "anthropic-messages") return anthropic({ ...model, api: "anthropic-messages", compat: undefined }, context, settings);
      if (model.api === "google-generative-ai") return google({ ...model, api: "google-generative-ai", compat: undefined }, context, settings);
      if (model.api === "openai-responses") return responses({ ...model, api: "openai-responses", compat: undefined }, context, settings);
      return completions({ ...model, api: "openai-completions", compat: undefined }, context, settings);
    } catch (error) { return failedStream(model, error instanceof AppError ? error.message : publicFailure()); }
  };
}
export async function runPreparationAgent(workspaceId: string, task: StoredWorkflowTask, streamOverride?: StreamFn) {
  const storeResult = async (result: AgentResult) => transaction(workspaceId, (data) => {
    const current = data.workflowTasks!.find((item) => item.id === task.id)!;
    if (current.result) throw new AppError("이미 결과가 제출됐습니다.", 409);
    if (current.notes.length > current.deliveredNotes) throw new AppError("새 사용자 피드백을 먼저 반영하고 다시 제출하세요.", 409);
    if (result.type === "proposal") validateStepConfiguration(data, result.steps);
    current.result = result;
  });
  function tool(name: string, description: string, schema: z.ZodType, parse: (args: unknown) => AgentResult): AgentTool {
    return { name, label: name, description, parameters: z.toJSONSchema(schema), executionMode: "sequential", replay: "never", execute: async (_id, args) => {
      await storeResult(parse(args)); return { content: [{ type: "text", text: "결과를 저장했습니다. 사용자 검수·단계 전환은 OpenStudio가 처리합니다." }], details: {}, terminate: true };
    } };
  }
  const tools = [
    task.kind === "plan" ? tool("propose_workflow", "영상 한 편의 제작 스텝을 제출한다. 단순 검수·승인은 별도 사용자 작업이 아니라 검토할 결과를 만드는 스텝의 review=true로 표현한다. manual은 사용자가 실제 원고·자료·파일 등 결과를 제공하는 작업에만 사용한다. 채널 브랜딩·편성표·주간 운영·여러 편 일괄 제작은 범위에 포함하지 않는다. 실제 에셋이나 영상은 생성하지 않는다.", proposalSchema, (args) => {
      const proposal = proposalSchema.parse(args);
      if (!proposal.steps.length) throw new AppError("최소 한 개의 스텝이 필요합니다.");
      const issues = workflowIssues(proposal); if (issues.length) throw new AppError(issues[0].message);
      return { type: "proposal", ...proposal };
    }) : tool("submit_result", "현재 스텝의 원고, 설계 명세 또는 SVG/HTML 소스 코드를 제출한다. 바이너리 생성·렌더링은 하지 않는다.", resultSchema, (args) => ({ type: "artifact", ...resultSchema.parse(args) })),
    tool("ask_user", "이번 영상 제작을 막는 필수 정보만 짧게 질문한다. 저장된 설정을 다시 묻거나 선택 사항을 필수 설문으로 만들지 않는다.", questionSchema, (args) => ({ type: "question", ...questionSchema.parse(args) })),
  ];
  let turns = 0;
  const agent = new Agent({
    initialState: { model: agentModel(task), thinkingLevel: "off", tools, systemPrompt: [
      "You are the OpenStudio production preparation agent. Respond in Korean unless asked otherwise.",
      "The unit of work is EXACTLY ONE VIDEO, not a channel, campaign, batch, publishing calendar or multi-week program. Output variants (aspect ratios, subtitles, thumbnail, cutdown) must derive from that same video.",
      "The project holds a reusable step configuration. Each production session freezes a copy for one video. Do not add a delivery-specification step merely to describe output formats. Actual final results come from producing steps. Mark those steps finalOutput=true when needed; otherwise terminal steps are final. Leave outputs empty: there is no separate output-routing form.",
      "settings are reusable production defaults: brand, audience, tone, visual style, production method, narration, budget, model references and shared assets. Treat them as established context. NEVER create brand definition, budget selection, account setup, editorial calendar, multiple episodes, community management or weekly analytics steps. These are not video production steps.",
      task.kind === "plan"
        ? "In planning mode, brief is reusable production guidance, NOT an episode topic. Design a reusable process that produces ONE video per future session using that session's topic and references. Do not require a specific episode topic just to configure reusable steps, and do not expand broad channel guidance into channel-launch or calendar tasks."
        : "In step mode, brief describes THIS SESSION'S VIDEO and guidance holds reusable project directions. If a concrete missing topic/message blocks this step, ask only that question. Do not expand the project into a channel launch or marketing strategy.",
      "Unspecified optional settings are not blockers. Do not repeatedly ask for branding, production budget or tools. Use a reasonable lightweight approach consistent with available settings, and state provisional choices briefly in the proposal. Ask only if a concrete missing decision blocks this video.",
      "Use the supplied chronological conversation to understand prior questions, answers and decisions. Do not interpret short answers without that context. Latest explicit user direction and saved settings override older assistant assumptions. Older plans may contain channel operations or multi-video steps: remove those when proposing this single video instead of preserving their scope.",
      "Plan only the necessary producing stages that lead from this video's idea to script, scenes, required assets/audio, composition and output, combining or skipping stages where appropriate. Reference images are supplied with their intended purpose. When delivery is descriptions-only, use the purpose/metadata without pretending to have seen the image.",
      "Review and approval are gates on a producing step, not standalone tasks. Do not create a manual step merely for user review, quality checks, approval or sign-off (for example 출력 전 사용자 검수). Set review=true on each step whose result needs inspection, and put concrete review criteria in that step's instruction. The user reviews that result and approves its exact version before dependent steps proceed. Reserve kind=manual for work where the user actually supplies a new result such as a script, reference material or a file, never an approval note.",
      "When revising an existing plan containing a review-only step, remove that step, enable review on its input producing steps and reconnect its downstream consumers directly to those inputs. Preserve the producing step IDs and valid dependency order. Do not remove manual steps that supply real content or files. Existing production sessions remain frozen; a revised plan applies to future sessions.",
      "Respect the supplied video width, height and duration for the main output; variants are optional. Do not invent a monthly or multi-video budget. A budget setting is a limit, not permission to spend or submit paid media jobs.",
      "Plan and prepare editable studio steps, not a fixed topic or pipeline. Support dependencies, review gates, image-based, direct-video and SVG/HTML strategies and multiple output variants.",
      "This is PREPARATION ONLY. Never claim to have generated images, audio, video or rendered exports. You have no media-generation, filesystem, browser, shell or rendering tools.",
      "For image/video/audio/compose/export steps write a usable production specification. For code steps return self-contained SVG or HTML code; no markdown fences, external assets or network. Use a render(t) time interface where useful.",
      "Use propose_workflow for a plan, submit_result for step work, or ask_user if necessary. A plain answer does not submit a result. Submit exactly one outcome.",
      "Preserve relevant existing step IDs when revising a plan. Use short unique IDs for new steps and real input references; never invent account/model bindings. Inherit the project agent by omitting step.agent. Review is user-configurable.",
      "List steps in execution order: every input must reference an earlier step in the array, never the same or a later step. Preserve valid explicit step.agent overrides unless the user asks to change them; unassigned steps inherit the project agent.",
      "You cannot approve results or advance steps. OpenStudio enforces user review. Use only approved input artifacts provided below. Incorporate the previous result and feedback when revising.",
      "Feedback history is chronological. If it conflicts with the latest instructions or feedback, follow the latest user direction.",
    ].join("\n") },
    streamFn: streamOverride || workflowStream(workspaceId, task), toolExecution: "sequential", identity: { attribution: null, userAgent: { custom: "OpenStudio/0.1" } },
    prepareRequest: async ({ context }) => {
      const notes = await transaction(workspaceId, (data) => {
        const current = data.workflowTasks!.find((item) => item.id === task.id)!;
        const pending = current.notes.slice(current.deliveredNotes); current.deliveredNotes = current.notes.length; return pending;
      });
      if (notes.length) return { context: { ...context, messages: [...context.messages, ...notes.map((content) => ({ role: "user" as const, content, timestamp: Date.now() }))] } };
    },
    beforeToolCall: async () => transaction(workspaceId, (data) => {
      const current = data.workflowTasks!.find((item) => item.id === task.id)!;
      if (current.result) return { block: true, reason: "이미 결과가 저장됐습니다.", terminate: true };
      if (current.notes.length > current.deliveredNotes) return { block: true, reason: "새 사용자 피드백이 도착했습니다. 다음 요청에서 이를 반영하세요." };
    }),
    finishTurn: () => { turns++; return turns >= 6 ? { action: "end" } : undefined; },
  });
  agent.subscribe(async (event) => {
    let text = "", role: "assistant" | "tool" = "assistant";
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason !== "error") text = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (event.type === "tool_execution_start") { role = "tool"; text = `작업 도구: ${event.toolName}`; }
    if (text) await transaction(workspaceId, (data) => addLog(taskProjectIn(data, task), role, text, task.id));
  });
  const context = task.kind === "plan" ? task.snapshot : { name: task.snapshot.name, brief: task.snapshot.brief, revision: task.snapshot.revision, step: task.snapshot.step,
    settings: task.snapshot.settings, video: task.snapshot.video, referenceImages: task.snapshot.referenceImages, conversation: task.snapshot.conversation, guidance: task.snapshot.guidance,
    inputs: task.snapshot.inputs, previous: task.snapshot.previous, question: task.snapshot.question, feedbackHistory: task.snapshot.feedbackHistory, outputs: task.snapshot.step?.kind === "export" ? task.snapshot.outputs : undefined };
  const attachImages = task.modelSnapshot.metadata?.input?.includes("image") === true;
  const prompt = JSON.stringify({ mode: task.kind, scope: "single-video", ...context, referenceImageDelivery: attachImages ? "attached" : "descriptions-only", feedback: task.feedback });
  if (prompt.length > 140000) throw new AppError("입력 자료가 준비 작업의 크기 제한을 넘었습니다. 입력 연결이나 원고를 줄여 주세요.");
  const timer = setTimeout(() => agent.abort(), 120_000); timer.unref();
  try {
    const images = attachImages ? await Promise.all((task.snapshot.referenceImages || []).map(async (image) => {
      const uri = await referenceData(workspaceId, image.id);
      return { type: "image" as const, data: uri.slice(uri.indexOf(",") + 1), mimeType: image.mime };
    })) : [];
    await agent.prompt(prompt, images);
    const completed = await transaction(workspaceId, (data) => data.workflowTasks!.find((item) => item.id === task.id)!.result);
    if (!completed) throw new AppError(agent.state.errorMessage ? publicFailure(agent.state.errorMessage) : "모델이 결과 제출 도구를 호출하지 않았습니다. 도구 호출 지원 모델인지 확인하거나 지시를 조정해 다시 실행하세요.", 502, "agent_incomplete");
  } finally { clearTimeout(timer); }
}
export async function processWorkflowTask(workspaceId: string, id: string, streamOverride?: StreamFn) {
  const task = await transaction(workspaceId, (data) => {
    const current = data.workflowTasks?.find((item) => item.id === id);
    if (!current || current.status !== "queued") return;
    current.status = "running"; current.runId = workflowRunId; current.requestStartedAt = new Date().toISOString(); current.updatedAt = current.requestStartedAt;
    const project = taskProjectIn(data, current); if (current.stepId) project.states[current.stepId] = { ...project.states[current.stepId], status: "running" };
    return structuredClone(current);
  });
  if (!task) return;
  try {
    if (!task.result) await runPreparationAgent(workspaceId, task, streamOverride);
    await transaction(workspaceId, (data) => {
      const current = data.workflowTasks!.find((item) => item.id === id)!; finalizeWorkflowTask(data, current);
      const account = data.connections.find((item) => item.id === task.agent.connectionId); if (account) account.verifiedAt = new Date().toISOString();
    });
  } catch (error) {
    await transaction(workspaceId, (data) => {
      const current = data.workflowTasks!.find((item) => item.id === id)!;
      if (current.result) { finalizeWorkflowTask(data, current); return; }
      current.status = "failed"; current.error = error instanceof AppError ? error.message : publicFailure(); current.updatedAt = new Date().toISOString();
      const project = taskProjectIn(data, current); project.autoRun = false;
      if (task.stepId && project.steps.some((step) => step.id === task.stepId)) project.states[task.stepId] = { ...project.states[task.stepId], status: "failed", error: current.error };
      addLog(project, "system", current.error, task.id);
    });
  }
}
