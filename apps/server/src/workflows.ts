import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentBindingSchema, preparationReady, readySteps, workflowDefinitionSchema, workflowIssues, productionSettingsSchema, productionReferenceSchema, videoTargetSchema, videoTarget, finalResultSteps, productionComplete,
  type AgentBinding, type PreparationArtifact, type ProductionSettings, type ProductionReference, type WorkflowProject, type WorkflowStep,
} from "@openstudio/shared/workflow";
import { modelTasks } from "@openstudio/shared/provider-registry";
import { AppError, transaction, type Workspace } from "./storage";
import type { AgentResult, SessionModel, StoredProductionSession, StoredWorkflowTask } from "./workflow-types";

export const workflowRunId = randomUUID();
const now = () => new Date().toISOString();
export function projectIn(data: Workspace, id: string) {
  const project = data.projects?.find((item) => item.id === id);
  if (!project) throw new AppError("프로젝트를 찾을 수 없습니다.", 404);
  return project;
}
export function sessionIn(data: Workspace, projectId: string, sessionId: string) {
  const session = data.productionSessions?.find((item) => item.id === sessionId && item.projectId === projectId);
  if (!session) throw new AppError("제작 세션을 찾을 수 없습니다.", 404);
  return session;
}
export function taskProjectIn(data: Workspace, task: StoredWorkflowTask): WorkflowProject {
  const stored = data.workflowTasks?.find((item) => item.id === task.id) || task;
  return stored.sessionId ? sessionIn(data, stored.projectId, stored.sessionId) : projectIn(data, stored.projectId);
}
function isSession(project: WorkflowProject): project is StoredProductionSession { return "projectId" in project && "sourceRevision" in project; }
function taskBelongs(task: StoredWorkflowTask, project: WorkflowProject) {
  return task.projectId === (isSession(project) ? project.projectId : project.id) && task.sessionId === (isSession(project) ? project.id : undefined);
}
export function publicProductionSession(session: StoredProductionSession) { const { runtimeModels: _, ...publicSession } = session; return publicSession; }
function snapshotModels(data: Workspace, project: WorkflowProject, strict: boolean): SessionModel[] {
  const models = new Map<string, SessionModel>();
  for (const binding of [project.agent, project.settings?.imageModel, project.settings?.videoModel, project.settings?.audioModel, ...project.steps.flatMap((step) => [step.agent, step.generator])].filter((item): item is AgentBinding => !!item)) {
    const connection = data.connections.find((item) => item.id === binding.connectionId && item.status !== "disconnected"), model = connection?.models.find((item) => item.id === binding.modelId);
    if (!connection || !model) { if (strict) throw new AppError("제작을 시작하기 전에 기본·스텝 모델을 확인하세요."); continue; }
    models.set(`${binding.connectionId}:${binding.modelId}`, { binding: structuredClone(binding), provider: connection.provider, providerBaseURL: connection.baseURL, modelSnapshot: structuredClone(model) });
  }
  return [...models.values()];
}
export function migrateLegacyProductions(data: Workspace) {
  for (const project of data.projects || []) {
    if (project.legacySessionId) continue;
    const tasks = (data.workflowTasks || []).filter((task) => task.projectId === project.id && task.kind === "step" && !task.sessionId);
    if (!tasks.length && !project.artifacts.length) continue;
    const session: StoredProductionSession = { ...structuredClone(project), id: randomUUID(), projectId: project.id, sourceRevision: project.revision, requestId: randomUUID(), name: `${project.name} · 기존 제작`, legacy: true, runtimeModels: snapshotModels(data, project, false) };
    for (const task of tasks) if (!session.runtimeModels.some((item) => item.binding.connectionId === task.agent.connectionId && item.binding.modelId === task.agent.modelId)) session.runtimeModels.push({ binding: structuredClone(task.agent), provider: task.provider, providerBaseURL: task.providerBaseURL, modelSnapshot: structuredClone(task.modelSnapshot) });
    (data.productionSessions ??= []).push(session); project.legacySessionId = session.id;
    for (const task of tasks) task.sessionId = session.id;
  }
}
export function publicWorkflowTask(task: StoredWorkflowTask) {
  const { id, projectId, sessionId, requestId, kind, stepId, status, createdAt, updatedAt, feedback, error } = task;
  return { id, projectId, sessionId, requestId, kind, stepId, status, createdAt, updatedAt, feedback, error, basedOnRevision: task.snapshot.revision };
}
export function addLog(project: WorkflowProject, role: "user" | "assistant" | "tool" | "system", text: string, taskId?: string) {
  project.logs.push({ id: randomUUID(), role, text: text.slice(0, 6000), taskId, createdAt: now() });
  project.updatedAt = now();
}
export function stepHash(project: WorkflowProject, step: WorkflowStep) {
  return createHash("sha256").update(JSON.stringify({ step, agent: step.agent || project.agent, brief: project.brief, outputs: step.kind === "export" ? project.outputs : undefined,
    ...(project.settings !== undefined ? { settings: project.settings } : {}), ...(project.video !== undefined ? { video: videoTarget(project) } : {}), ...(project.references !== undefined ? { references: project.references } : {}), ...(isSession(project) && project.productionGuidance ? { guidance: project.productionGuidance } : {}) })).digest("hex");
}
function referenceImages(data: Workspace, settings?: ProductionSettings, references: ProductionReference[] = []) {
  const combined = [...new Map([...(settings?.references || []), ...references].map((item) => [item.assetId, item])).values()];
  if (combined.length > 6) throw new AppError("공통 자료와 이번 영상 자료는 합쳐서 이미지 6개까지 선택하세요.");
  const images = combined.map((reference) => {
    const asset = data.assets?.find((item) => item.id === reference.assetId && item.kind === "image");
    if (!asset) throw new AppError("이 워크스페이스의 참조 이미지를 선택하세요.", 404);
    return { ...asset, purpose: reference.purpose };
  });
  if (images.reduce((sum, item) => sum + item.size, 0) > 20 * 1024 * 1024) throw new AppError("참조 이미지의 전체 크기는 20MB 이하여야 합니다.");
  return images;
}
function validateSettings(data: Workspace, settings?: ProductionSettings, references: ProductionReference[] = []) {
  referenceImages(data, settings, references);
  for (const [binding, kind] of [[settings?.imageModel, "image"], [settings?.videoModel, "video"], [settings?.audioModel, "audio"]] as const) {
    if (!binding) continue;
    const connection = data.connections.find((item) => item.id === binding.connectionId && item.status !== "disconnected");
    const model = connection?.models.find((item) => item.id === binding.modelId);
    if (!model || !modelTasks(model).includes(kind)) throw new AppError("제작 기본 모델의 연결 계정과 모델을 확인하세요.");
  }
}
const presetOperation = z.object({ name: z.string().trim().min(1).max(120), settings: productionSettingsSchema, agent: agentBindingSchema.optional(), id: z.uuid().optional(), revision: z.number().int().optional() });
export async function saveProductionPreset(workspaceId: string, raw: unknown) {
  const input = presetOperation.parse(raw);
  return transaction(workspaceId, (data) => {
    validateSettings(data, input.settings);
    if (input.agent && !data.connections.some((item) => item.id === input.agent!.connectionId && item.status !== "disconnected" && item.models.some((model) => model.id === input.agent!.modelId && modelTasks(model).includes("text")))) throw new AppError("기본 에이전트의 연결 계정과 모델을 확인하세요.");
    const presets = data.productionPresets ??= [];
    const existing = input.id ? presets.find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw new AppError("저장한 제작 설정을 찾을 수 없습니다.", 404);
    if (existing && existing.revision !== input.revision) throw new AppError("제작 설정이 다른 화면에서 변경됐습니다. 다시 불러온 뒤 저장하세요.", 409);
    if (presets.some((item) => item.id !== existing?.id && item.name === input.name)) throw new AppError("같은 이름의 제작 설정이 있습니다. 불러와서 갱신하거나 다른 이름을 사용하세요.", 409);
    if (!existing && presets.length >= 100) throw new AppError("제작 설정은 최대 100개까지 저장할 수 있습니다.");
    const preset = { id: existing?.id || randomUUID(), name: input.name, settings: input.settings, agent: input.agent, revision: (existing?.revision || 0) + 1, createdAt: existing?.createdAt || now(), updatedAt: now() };
    if (existing) presets[presets.indexOf(existing)] = preset; else presets.push(preset);
    return { preset };
  });
}
function currentInputs(project: WorkflowProject, step: WorkflowStep) {
  const artifacts: PreparationArtifact[] = [];
  for (const id of step.inputs) {
    const state = project.states[id], artifact = project.artifacts.find((item) => item.id === state?.artifactId);
    if (state?.status !== "complete" || !artifact || artifact.stale) throw new AppError("입력 스텝의 검수와 준비를 먼저 완료하세요.", 409);
    artifacts.push(artifact);
  }
  return artifacts;
}
export function invalidateSteps(project: WorkflowProject, roots: string[]) {
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of project.steps) if (!affected.has(step.id) && step.inputs.some((id) => affected.has(id))) { affected.add(step.id); changed = true; }
  }
  for (const id of affected) {
    const state = project.states[id];
    if (state?.artifactId) { const artifact = project.artifacts.find((item) => item.id === state.artifactId); if (artifact) artifact.stale = true; }
    project.states[id] = { status: state?.artifactId ? "stale" : "idle", artifactId: state?.artifactId };
  }
}
export function updateDefinition(project: WorkflowProject, input: { name: string; brief: string; agent?: AgentBinding; steps: WorkflowStep[]; outputs: WorkflowProject["outputs"]; settings?: ProductionSettings; video?: WorkflowProject["video"]; references?: ProductionReference[] }) {
  const hashes = new Map(project.steps.map((step) => [step.id, stepHash(project, step)]));
  const oldIds = project.steps.map((step) => step.id);
  project.name = input.name; project.brief = input.brief; project.agent = input.agent; project.steps = input.steps; project.outputs = input.outputs;
  if (input.settings !== undefined) project.settings = input.settings;
  if (input.video !== undefined) project.video = videoTarget({ outputs: input.outputs, video: input.video });
  if (input.references !== undefined) project.references = input.references;
  invalidateSteps(project, [...oldIds.filter((id) => !project.steps.some((step) => step.id === id)), ...project.steps.filter((step) => hashes.get(step.id) !== stepHash(project, step)).map((step) => step.id)]);
  project.revision++; project.autoRun = false; project.updatedAt = now();
}
function cancelObsoleteQueuedTasks(data: Workspace, project: WorkflowProject) {
  for (const task of data.workflowTasks || []) if (taskBelongs(task, project) && task.status === "queued") {
    const step = project.steps.find((item) => item.id === task.stepId);
    const obsolete = task.kind === "plan" || !step || task.definitionHash !== stepHash(project, step) || step.inputs.some((id) => project.states[id]?.status !== "complete" || project.states[id]?.artifactId !== task.inputArtifacts[id]);
    if (obsolete) { task.status = "failed"; task.error = "계획 변경으로 이전 설정의 대기 작업을 취소했습니다. 저장한 계획으로 다시 준비하세요."; task.updatedAt = now(); addLog(project, "system", task.error, task.id); }
  }
}
function assertDefinition(project: WorkflowProject) {
  const issues = workflowIssues(project); if (issues.length) throw new AppError(issues[0].message, 409, "invalid_workflow");
}
function activeTask(data: Workspace, project: WorkflowProject) { return data.workflowTasks?.some((task) => taskBelongs(task, project) && ["queued", "running"].includes(task.status)); }
function queueTask(data: Workspace, project: WorkflowProject, requestId: string, kind: "plan" | "step", stepId?: string, feedback?: string) {
  const existing = data.workflowTasks?.find((task) => task.requestId === requestId);
  if (existing) {
    if (!taskBelongs(existing, project) || existing.kind !== kind || existing.stepId !== stepId || existing.feedback !== feedback) throw new AppError("동일 요청 ID에 다른 실행을 사용할 수 없습니다.", 409);
    return existing;
  }
  if (activeTask(data, project)) throw new AppError("진행 중인 에이전트 작업이 있습니다. 실행 중 피드백을 보내거나 완료를 기다리세요.", 409);
  const step = kind === "step" ? project.steps.find((item) => item.id === stepId) : undefined;
  if (kind === "step") {
    assertDefinition(project);
    if (!step) throw new AppError("스텝을 찾을 수 없습니다.", 404);
    if (step.kind === "manual") throw new AppError("사용자 작업은 결과를 직접 입력해 주세요.");
    if (project.steps.some((item) => item.id !== stepId && ["review", "needs_input"].includes(project.states[item.id]?.status))) throw new AppError("대기 중인 검수·질문을 먼저 처리하세요.", 409);
  }
  const binding = step?.agent || project.agent;
  if (!binding) throw new AppError("텍스트 에이전트 계정과 모델을 선택하세요.");
  const connection = data.connections.find((item) => item.id === binding.connectionId && item.status !== "disconnected");
  const frozen = isSession(project) ? project.runtimeModels.find((item) => item.binding.connectionId === binding.connectionId && item.binding.modelId === binding.modelId) : undefined;
  const model = frozen?.modelSnapshot || (!isSession(project) ? connection?.models.find((item) => item.id === binding.modelId) : undefined);
  if (!connection || !model || !modelTasks(model).includes("text") || model.callable === false || model.metadata?.tools === false) throw new AppError("이 계정에서 도구 호출 가능한 텍스트 모델을 선택하세요.");
  const inputs = step ? currentInputs(project, step) : [];
  const previous = step ? project.artifacts.find((item) => item.id === project.states[step.id]?.artifactId) : undefined;
  const question = step ? project.states[step.id]?.question : undefined;
  const feedbackHistory = (data.workflowTasks || []).filter((item) => taskBelongs(item, project) && item.kind === kind && item.stepId === stepId).slice(-4).flatMap((item) => [item.feedback || "", ...item.notes]).filter(Boolean).slice(-12);
  const contextTasks = new Set((data.workflowTasks || []).filter((item) => taskBelongs(item, project) && (item.kind === "plan" || kind === "step" && item.stepId === stepId)).map((item) => item.id));
  const conversation: { role: "user" | "assistant"; text: string }[] = []; let characters = 0;
  for (const log of [...project.logs].reverse()) {
    if (!log.taskId || !contextTasks.has(log.taskId) || log.role !== "user" && log.role !== "assistant") continue;
    if (conversation.length >= 16 || characters + log.text.length > 48000) break;
    conversation.unshift({ role: log.role, text: log.text }); characters += log.text.length;
  }
  const task: StoredWorkflowTask = {
    id: randomUUID(), projectId: isSession(project) ? project.projectId : project.id, sessionId: isSession(project) ? project.id : undefined, requestId, kind, stepId, feedback, status: "queued", createdAt: now(), updatedAt: now(),
    agent: structuredClone(binding), provider: frozen?.provider || connection.provider, providerBaseURL: frozen?.providerBaseURL || connection.baseURL, modelSnapshot: structuredClone(model),
    snapshot: structuredClone({ name: project.name, brief: project.brief, revision: project.revision, steps: project.steps, outputs: project.outputs, step, inputs, previous, question, feedbackHistory,
      settings: project.settings, video: videoTarget(project), referenceImages: referenceImages(data, project.settings, project.references), conversation, guidance: isSession(project) ? project.productionGuidance : undefined }),
    definitionHash: step ? stepHash(project, step) : undefined, inputArtifacts: Object.fromEntries(inputs.map((item) => [item.stepId, item.id])), notes: [], deliveredNotes: 0,
  };
  if (step) {
    invalidateSteps(project, [step.id]);
    project.states[step.id] = { status: "queued", artifactId: previous?.id };
  }
  (data.workflowTasks ??= []).push(task);
  addLog(project, "user", feedback || (kind === "plan" ? "제작 계획을 제안해 주세요." : `${step!.name} 준비 실행`), task.id);
  return task;
}
function queueNext(data: Workspace, project: WorkflowProject) {
  if (!project.autoRun || activeTask(data, project) || project.steps.some((step) => ["review", "needs_input", "failed"].includes(project.states[step.id]?.status))) return;
  const next = readySteps(project)[0];
  if (next?.kind === "manual") { project.autoRun = false; addLog(project, "system", `${next.name}: 사용자 결과 입력을 기다립니다.`); return; }
  if (next) {
    try { queueTask(data, project, randomUUID(), "step", next.id); }
    catch (error) { project.autoRun = false; addLog(project, "system", error instanceof AppError ? error.message : "다음 준비 작업을 시작하지 못했습니다."); }
  } else project.autoRun = false;
}
function appendArtifact(project: WorkflowProject, step: WorkflowStep, content: string, source: "agent" | "user", task?: StoredWorkflowTask) {
  const inputs = task?.inputArtifacts || Object.fromEntries(currentInputs(project, step).map((item) => [item.stepId, item.id]));
  const hash = task?.definitionHash || stepHash(project, step);
  const stale = hash !== stepHash(project, step) || step.inputs.some((id) => project.states[id]?.status !== "complete" || project.states[id]?.artifactId !== inputs[id]);
  const artifact: PreparationArtifact = { id: randomUUID(), stepId: step.id, version: project.artifacts.filter((item) => item.stepId === step.id).length + 1, content,
    kind: step.kind === "code" ? "code" : ["manual", "text"].includes(step.kind) ? "text" : "specification", createdAt: now(), source, definitionHash: hash, inputArtifacts: inputs, stale, taskId: task?.id, feedback: task?.feedback };
  if (!stale && !step.review) artifact.approvedAt = now();
  project.artifacts.push(artifact);
  project.states[step.id] = { status: stale ? "stale" : step.review ? "review" : "complete", artifactId: artifact.id };
  if (stale) { project.autoRun = false; addLog(project, "system", "실행 중 설정 또는 입력이 변경됐습니다. 결과를 보존하고 갱신 필요로 표시했습니다.", task?.id); }
  return artifact;
}
export function finalizeWorkflowTask(data: Workspace, task: StoredWorkflowTask) {
  if (task.status === "completed") return;
  const project = taskProjectIn(data, task), result = task.result;
  if (!result) throw new AppError("에이전트 결과가 없습니다.", 502);
  if (result.type === "proposal") {
    if (!project.proposals.some((item) => item.taskId === task.id)) project.proposals.push({ ...result, id: randomUUID(), createdAt: now(), taskId: task.id, basedOnRevision: task.snapshot.revision });
    addLog(project, "assistant", result.summary, task.id);
  } else if (result.type === "question") {
    if (task.stepId && project.steps.some((step) => step.id === task.stepId)) project.states[task.stepId] = { ...project.states[task.stepId], status: "needs_input", question: result.question };
    addLog(project, "assistant", result.question, task.id);
  } else {
    const step = project.steps.find((item) => item.id === task.stepId);
    if (step) {
      if (!project.artifacts.some((item) => item.taskId === task.id)) appendArtifact(project, step, result.content, "agent", task);
      addLog(project, "assistant", `${step.name} 준비 결과를 제출했습니다.`, task.id);
    } else {
      project.artifacts.push({ id: randomUUID(), stepId: task.stepId!, version: 1, content: result.content, kind: task.snapshot.step?.kind === "code" ? "code" : "specification", createdAt: now(), source: "agent", definitionHash: task.definitionHash!, inputArtifacts: task.inputArtifacts, stale: true, taskId: task.id });
      addLog(project, "system", "삭제된 스텝의 실행 결과를 이력에 보존했습니다.", task.id);
    }
  }
  task.status = "completed"; task.updatedAt = now();
  if (task.kind === "step" && result.type === "artifact") queueNext(data, project);
}
export function recoverWorkflowTasks(data: Workspace) {
  for (const task of data.workflowTasks || []) if (task.status === "running" && task.runId !== workflowRunId) {
    if (task.result) finalizeWorkflowTask(data, task);
    else {
      task.status = "unknown"; task.error = "서버가 재시작되어 에이전트 응답을 확인할 수 없습니다. 자동 재요청하지 않았습니다."; task.updatedAt = now();
      const project = taskProjectIn(data, task);
      if (project) { project.autoRun = false; if (task.stepId && project.steps.some((step) => step.id === task.stepId)) project.states[task.stepId] = { ...project.states[task.stepId], status: "failed", error: task.error }; }
    }
  }
}

export const workflowOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(120), brief: z.string().trim().max(4000), agent: agentBindingSchema.optional(), presetId: z.uuid().optional(), sourceProjectId: z.uuid().optional(), reuseSteps: z.boolean().default(false) }),
  z.object({ action: z.literal("rename"), id: z.uuid(), previousName: z.string().min(1).max(120), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("save"), id: z.uuid(), revision: z.number().int(), name: z.string().trim().min(1).max(120), brief: z.string().max(4000), agent: agentBindingSchema.optional(), settings: productionSettingsSchema.optional(), video: videoTargetSchema.optional(), references: z.array(productionReferenceSchema).max(6).optional(), ...workflowDefinitionSchema.shape }),
  z.object({ action: z.literal("plan"), id: z.uuid(), requestId: z.uuid(), feedback: z.string().trim().max(4000).optional(), consent: z.literal(true) }),
  z.object({ action: z.literal("apply-proposal"), id: z.uuid(), revision: z.number().int(), proposalId: z.uuid() }),
  z.object({ action: z.literal("start-session"), id: z.uuid(), revision: z.number().int(), requestId: z.uuid(), name: z.string().trim().min(1).max(120), brief: z.string().trim().min(1).max(4000), references: z.array(productionReferenceSchema).max(6).default([]) }),
  z.object({ action: z.literal("run"), id: z.uuid(), sessionId: z.uuid().optional(), requestId: z.uuid(), stepId: z.string().optional(), feedback: z.string().trim().max(4000).optional(), all: z.boolean().default(false), consent: z.literal(true) }),
  z.object({ action: z.literal("approve"), id: z.uuid(), sessionId: z.uuid().optional(), stepId: z.string(), artifactId: z.uuid() }),
  z.object({ action: z.literal("edit-result"), id: z.uuid(), sessionId: z.uuid().optional(), revision: z.number().int(), stepId: z.string(), content: z.string().trim().min(1).max(40000), assetIds: z.array(z.uuid()).max(6).optional() }),
  z.object({ action: z.literal("note"), id: z.uuid(), sessionId: z.uuid().optional(), taskId: z.uuid(), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("pause"), id: z.uuid(), sessionId: z.uuid().optional() }),
]);
export async function mutateWorkflow(workspaceId: string, raw: unknown) {
  const input = workflowOperation.parse(raw);
  const result = await transaction(workspaceId, (data) => {
    if (input.action === "create") {
      if (input.presetId && input.sourceProjectId) throw new AppError("저장한 설정 또는 이전 영상 중 하나를 선택하세요.");
      const source = input.sourceProjectId ? projectIn(data, input.sourceProjectId) : undefined;
      const preset = input.presetId ? data.productionPresets?.find((item) => item.id === input.presetId) : undefined;
      if (input.presetId && !preset) throw new AppError("저장한 제작 설정을 찾을 수 없습니다.", 404);
      const settings = structuredClone(source?.settings || preset?.settings || productionSettingsSchema.parse({}));
      validateSettings(data, settings);
      const steps = source && input.reuseSteps ? structuredClone(source.steps) : [], outputs = source && input.reuseSteps ? structuredClone(source.outputs) : [];
      const project: WorkflowProject = { id: randomUUID(), name: input.name, brief: input.brief, agent: structuredClone(input.agent || source?.agent || preset?.agent), revision: 1, createdAt: now(), updatedAt: now(), steps, outputs, states: Object.fromEntries(steps.map((step) => [step.id, { status: "idle" as const }])), artifacts: [], logs: [], proposals: [], autoRun: false,
        settings, video: source ? videoTarget(source) : videoTarget({ outputs: [] }), references: [], scope: "single-video" };
      (data.projects ??= []).push(project); return { project };
    }
    const template = projectIn(data, input.id);
    if (input.action === "start-session") {
      const existing = data.productionSessions?.find((item) => item.requestId === input.requestId);
      if (existing) {
        if (existing.projectId !== template.id || existing.name !== input.name || existing.brief !== input.brief || JSON.stringify(existing.references) !== JSON.stringify(input.references)) throw new AppError("동일 요청 ID에 다른 제작을 사용할 수 없습니다.", 409);
        return { project: template, session: publicProductionSession(existing) };
      }
      if (template.revision !== input.revision) throw new AppError("스텝 구성이 변경됐습니다. 최신 구성을 확인하고 제작을 시작하세요.", 409);
      const definition = { ...template, outputs: [] }; assertDefinition(definition);
      if (!template.steps.length) throw new AppError("제작할 스텝을 먼저 구성하세요.", 409);
      validateSettings(data, template.settings, input.references);
      const session: StoredProductionSession = { ...structuredClone(template), id: randomUUID(), projectId: template.id, sourceRevision: template.revision, requestId: input.requestId, name: input.name, brief: input.brief, productionGuidance: template.brief, outputs: [], video: videoTarget(template), references: input.references,
        states: Object.fromEntries(template.steps.map((step) => [step.id, { status: "idle" as const }])), artifacts: [], logs: [], proposals: [], autoRun: false, createdAt: now(), updatedAt: now(), runtimeModels: snapshotModels(data, template, true) };
      delete session.legacySessionId;
      (data.productionSessions ??= []).push(session);
      return { project: template, session: publicProductionSession(session) };
    }
    const project: WorkflowProject = "sessionId" in input && input.sessionId ? sessionIn(data, template.id, input.sessionId) : template;
    if (input.action === "rename") {
      if (project.name === input.name) return { project };
      if (project.name !== input.previousName) throw new AppError("프로젝트 이름이 다른 화면에서 변경됐습니다. 현재 이름을 확인하고 다시 수정하세요.", 409, "name_conflict");
      project.name = input.name; addLog(project, "user", `프로젝트 이름을 '${input.name}'으로 변경했습니다.`); return { project };
    }
    if ("revision" in input && project.revision !== input.revision) throw new AppError("다른 화면에서 프로젝트가 변경됐습니다. 새로고침 후 다시 저장하세요.", 409, "revision_conflict");
    if (input.action === "save") { validateSettings(data, input.settings ?? project.settings, input.references ?? project.references); updateDefinition(project, { ...input, name: project.name }); cancelObsoleteQueuedTasks(data, project); return { project }; }
    if (input.action === "plan") return { task: publicWorkflowTask(queueTask(data, project, input.requestId, "plan", undefined, input.feedback)), project };
    if (input.action === "apply-proposal") {
      const proposal = project.proposals.find((item) => item.id === input.proposalId);
      if (!proposal) throw new AppError("계획 제안을 찾을 수 없습니다.", 404);
      if (proposal.basedOnRevision !== project.revision) throw new AppError("제안 이후 계획이 수정됐습니다. 현재 계획을 기준으로 다시 제안받으세요.", 409);
      updateDefinition(project, { ...project, steps: structuredClone(proposal.steps), outputs: structuredClone(proposal.outputs) });
      if (proposal.scope) project.scope = proposal.scope;
      cancelObsoleteQueuedTasks(data, project);
      addLog(project, "user", "에이전트 제안을 제작 계획에 적용했습니다."); return { project };
    }
    if (input.action === "pause") { project.autoRun = false; addLog(project, "user", "현재 작업 뒤 자동 진행을 멈춥니다."); return { project }; }
    if (input.action === "note") {
      const task = data.workflowTasks?.find((item) => item.id === input.taskId && taskBelongs(item, project));
      if (!task || !["queued", "running"].includes(task.status) || task.result) throw new AppError("결과가 이미 제출됐습니다. 결과 검수에서 피드백을 보내세요.", 409);
      task.notes.push(input.text); addLog(project, "user", input.text, task.id); return { project };
    }
    if (input.action === "run") {
      const existing = data.workflowTasks?.find((task) => task.requestId === input.requestId);
      if (existing) return { project, task: publicWorkflowTask(queueTask(data, project, input.requestId, "step", input.stepId || existing.stepId, input.feedback)) };
      assertDefinition(project);
      const stepId = input.stepId || readySteps(project)[0]?.id;
      if (!stepId) throw new AppError("실행할 준비 스텝이 없습니다. 검수·입력 연결·출력을 확인하세요.", 409);
      const task = queueTask(data, project, input.requestId, "step", stepId, input.feedback); project.autoRun = input.all;
      return { project, task: publicWorkflowTask(task) };
    }
    const step = project.steps.find((item) => item.id === input.stepId);
    if (!step) throw new AppError("스텝을 찾을 수 없습니다.", 404);
    assertDefinition(project);
    if (input.action === "edit-result") {
      if (activeTask(data, project)) throw new AppError("현재 실행이 끝난 뒤 결과를 수정하세요.", 409);
      if (input.assetIds?.some((id) => !data.assets?.some((asset) => asset.id === id))) throw new AppError("이 워크스페이스의 결과 파일을 선택하세요.", 404);
      currentInputs(project, step); invalidateSteps(project, [step.id]); project.autoRun = false;
      const artifact = appendArtifact(project, step, input.content, "user"); artifact.assetIds = input.assetIds || []; addLog(project, "user", `${step.name} 결과를 직접 수정했습니다.`); return { project };
    }
    const state = project.states[step.id], artifact = project.artifacts.find((item) => item.id === input.artifactId);
    if (!artifact || artifact.stepId !== step.id || state?.artifactId !== artifact.id || artifact.stale || artifact.definitionHash !== stepHash(project, step)) throw new AppError("현재 스텝의 최신 결과를 검수하세요.", 409);
    const inputs = currentInputs(project, step);
    if (inputs.some((item) => artifact.inputArtifacts[item.stepId] !== item.id)) throw new AppError("입력이 변경됐습니다. 결과를 갱신하세요.", 409);
    if (state.status === "complete") return { project };
    if (state.status !== "review") throw new AppError("검수 대기 중인 결과가 아닙니다.", 409);
    artifact.approvedAt = now(); project.states[step.id] = { status: "complete", artifactId: artifact.id };
    addLog(project, "user", `${step.name} v${artifact.version} 승인`); queueNext(data, project); return { project };
  });
  return isSession(result.project) ? { ...result, project: publicProductionSession(result.project) } : result;
}
export async function workflowResult(workspaceId: string, sessionId: string, artifactId: string) {
  return transaction(workspaceId, (data) => {
    const session = data.productionSessions?.find((item) => item.id === sessionId);
    if (!session) throw new AppError("제작 세션을 찾을 수 없습니다.", 404);
    if (!productionComplete(session)) throw new AppError("제작과 검수가 끝난 세션의 결과를 확인하세요.", 409);
    const artifact = session.artifacts.find((item) => item.id === artifactId && !item.stale && item.approvedAt && session.states[item.stepId]?.artifactId === item.id && finalResultSteps(session).some((step) => step.id === item.stepId));
    if (!artifact) throw new AppError("완료된 최종 결과를 찾을 수 없습니다.", 404);
    return { artifact };
  });
}
export async function workflowManifest(workspaceId: string, id: string) {
  return transaction(workspaceId, (data) => {
    const project = projectIn(data, id);
    if (!preparationReady(project)) throw new AppError("출력 연결과 모든 스텝의 검수를 완료하세요.", 409);
    return { schemaVersion: 1, kind: "openstudio-preparation", generatedAt: now(), project: { id: project.id, name: project.name, brief: project.brief, revision: project.revision, settings: project.settings, video: videoTarget(project), references: project.references, scope: project.scope },
      steps: project.steps, outputs: project.outputs, artifacts: project.steps.map((step) => project.artifacts.find((item) => item.id === project.states[step.id]?.artifactId)), rendered: false };
  });
}
