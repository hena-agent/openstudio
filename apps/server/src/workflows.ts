import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentBindingSchema, preparationReady, readySteps, workflowDefinitionSchema, workflowIssues,
  type AgentBinding, type PreparationArtifact, type WorkflowProject, type WorkflowStep,
} from "@openstudio/shared/workflow";
import { modelTasks } from "@openstudio/shared/provider-registry";
import { AppError, transaction, type Workspace } from "./storage";
import type { AgentResult, StoredWorkflowTask } from "./workflow-types";

export const workflowRunId = randomUUID();
const now = () => new Date().toISOString();
export function projectIn(data: Workspace, id: string) {
  const project = data.projects?.find((item) => item.id === id);
  if (!project) throw new AppError("프로젝트를 찾을 수 없습니다.", 404);
  return project;
}
export function publicWorkflowTask(task: StoredWorkflowTask) {
  const { id, projectId, requestId, kind, stepId, status, createdAt, updatedAt, feedback, error } = task;
  return { id, projectId, requestId, kind, stepId, status, createdAt, updatedAt, feedback, error, basedOnRevision: task.snapshot.revision };
}
export function addLog(project: WorkflowProject, role: "user" | "assistant" | "tool" | "system", text: string, taskId?: string) {
  project.logs.push({ id: randomUUID(), role, text: text.slice(0, 6000), taskId, createdAt: now() });
  project.updatedAt = now();
}
export function stepHash(project: WorkflowProject, step: WorkflowStep) {
  return createHash("sha256").update(JSON.stringify({ step, agent: step.agent || project.agent, brief: project.brief, outputs: step.kind === "export" ? project.outputs : undefined })).digest("hex");
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
export function updateDefinition(project: WorkflowProject, input: { name: string; brief: string; agent?: AgentBinding; steps: WorkflowStep[]; outputs: WorkflowProject["outputs"] }) {
  const hashes = new Map(project.steps.map((step) => [step.id, stepHash(project, step)]));
  const oldIds = project.steps.map((step) => step.id);
  project.name = input.name; project.brief = input.brief; project.agent = input.agent; project.steps = input.steps; project.outputs = input.outputs;
  invalidateSteps(project, [...oldIds.filter((id) => !project.steps.some((step) => step.id === id)), ...project.steps.filter((step) => hashes.get(step.id) !== stepHash(project, step)).map((step) => step.id)]);
  project.revision++; project.autoRun = false; project.updatedAt = now();
}
function cancelObsoleteQueuedTasks(data: Workspace, project: WorkflowProject) {
  for (const task of data.workflowTasks || []) if (task.projectId === project.id && task.status === "queued") {
    const step = project.steps.find((item) => item.id === task.stepId);
    const obsolete = task.kind === "plan" || !step || task.definitionHash !== stepHash(project, step) || step.inputs.some((id) => project.states[id]?.status !== "complete" || project.states[id]?.artifactId !== task.inputArtifacts[id]);
    if (obsolete) { task.status = "failed"; task.error = "계획 변경으로 이전 설정의 대기 작업을 취소했습니다. 저장한 계획으로 다시 준비하세요."; task.updatedAt = now(); addLog(project, "system", task.error, task.id); }
  }
}
function assertDefinition(project: WorkflowProject) {
  const issues = workflowIssues(project); if (issues.length) throw new AppError(issues[0].message, 409, "invalid_workflow");
}
function activeTask(data: Workspace, projectId: string) { return data.workflowTasks?.some((task) => task.projectId === projectId && ["queued", "running"].includes(task.status)); }
function queueTask(data: Workspace, project: WorkflowProject, requestId: string, kind: "plan" | "step", stepId?: string, feedback?: string) {
  const existing = data.workflowTasks?.find((task) => task.requestId === requestId);
  if (existing) {
    if (existing.projectId !== project.id || existing.kind !== kind || existing.stepId !== stepId || existing.feedback !== feedback) throw new AppError("동일 요청 ID에 다른 실행을 사용할 수 없습니다.", 409);
    return existing;
  }
  if (activeTask(data, project.id)) throw new AppError("진행 중인 에이전트 작업이 있습니다. 실행 중 피드백을 보내거나 완료를 기다리세요.", 409);
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
  const model = connection?.models.find((item) => item.id === binding.modelId);
  if (!connection || !model || !modelTasks(model).includes("text") || model.callable === false || model.metadata?.tools === false) throw new AppError("이 계정에서 도구 호출 가능한 텍스트 모델을 선택하세요.");
  const inputs = step ? currentInputs(project, step) : [];
  const previous = step ? project.artifacts.find((item) => item.id === project.states[step.id]?.artifactId) : undefined;
  const question = step ? project.states[step.id]?.question : undefined;
  const feedbackHistory = (data.workflowTasks || []).filter((item) => item.projectId === project.id && item.kind === kind && item.stepId === stepId).slice(-4).flatMap((item) => [item.feedback || "", ...item.notes]).filter(Boolean).slice(-12);
  const task: StoredWorkflowTask = {
    id: randomUUID(), projectId: project.id, requestId, kind, stepId, feedback, status: "queued", createdAt: now(), updatedAt: now(),
    agent: structuredClone(binding), provider: connection.provider, providerBaseURL: connection.baseURL, modelSnapshot: structuredClone(model),
    snapshot: structuredClone({ name: project.name, brief: project.brief, revision: project.revision, steps: project.steps, outputs: project.outputs, step, inputs, previous, question, feedbackHistory }),
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
  if (!project.autoRun || activeTask(data, project.id) || project.steps.some((step) => ["review", "needs_input", "failed"].includes(project.states[step.id]?.status))) return;
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
  const project = projectIn(data, task.projectId), result = task.result;
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
      const project = data.projects?.find((item) => item.id === task.projectId);
      if (project) { project.autoRun = false; if (task.stepId && project.steps.some((step) => step.id === task.stepId)) project.states[task.stepId] = { ...project.states[task.stepId], status: "failed", error: task.error }; }
    }
  }
}

export const workflowOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(120), brief: z.string().trim().max(4000), agent: agentBindingSchema.optional() }),
  z.object({ action: z.literal("rename"), id: z.uuid(), previousName: z.string().min(1).max(120), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("save"), id: z.uuid(), revision: z.number().int(), name: z.string().trim().min(1).max(120), brief: z.string().max(4000), agent: agentBindingSchema.optional(), ...workflowDefinitionSchema.shape }),
  z.object({ action: z.literal("plan"), id: z.uuid(), requestId: z.uuid(), feedback: z.string().trim().max(4000).optional(), consent: z.literal(true) }),
  z.object({ action: z.literal("apply-proposal"), id: z.uuid(), revision: z.number().int(), proposalId: z.uuid() }),
  z.object({ action: z.literal("run"), id: z.uuid(), requestId: z.uuid(), stepId: z.string().optional(), feedback: z.string().trim().max(4000).optional(), all: z.boolean().default(false), consent: z.literal(true) }),
  z.object({ action: z.literal("approve"), id: z.uuid(), stepId: z.string(), artifactId: z.uuid() }),
  z.object({ action: z.literal("edit-result"), id: z.uuid(), revision: z.number().int(), stepId: z.string(), content: z.string().trim().min(1).max(40000) }),
  z.object({ action: z.literal("note"), id: z.uuid(), taskId: z.uuid(), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("pause"), id: z.uuid() }),
]);
export async function mutateWorkflow(workspaceId: string, raw: unknown) {
  const input = workflowOperation.parse(raw);
  return transaction(workspaceId, (data) => {
    if (input.action === "create") {
      const project: WorkflowProject = { id: randomUUID(), name: input.name, brief: input.brief, agent: input.agent, revision: 1, createdAt: now(), updatedAt: now(), steps: [], outputs: [], states: {}, artifacts: [], logs: [], proposals: [], autoRun: false };
      (data.projects ??= []).push(project); return { project };
    }
    const project = projectIn(data, input.id);
    if (input.action === "rename") {
      if (project.name === input.name) return { project };
      if (project.name !== input.previousName) throw new AppError("프로젝트 이름이 다른 화면에서 변경됐습니다. 현재 이름을 확인하고 다시 수정하세요.", 409, "name_conflict");
      project.name = input.name; addLog(project, "user", `프로젝트 이름을 '${input.name}'으로 변경했습니다.`); return { project };
    }
    if ("revision" in input && project.revision !== input.revision) throw new AppError("다른 화면에서 프로젝트가 변경됐습니다. 새로고침 후 다시 저장하세요.", 409, "revision_conflict");
    if (input.action === "save") { updateDefinition(project, { ...input, name: project.name }); cancelObsoleteQueuedTasks(data, project); return { project }; }
    if (input.action === "plan") return { task: publicWorkflowTask(queueTask(data, project, input.requestId, "plan", undefined, input.feedback)), project };
    if (input.action === "apply-proposal") {
      const proposal = project.proposals.find((item) => item.id === input.proposalId);
      if (!proposal) throw new AppError("계획 제안을 찾을 수 없습니다.", 404);
      if (proposal.basedOnRevision !== project.revision) throw new AppError("제안 이후 계획이 수정됐습니다. 현재 계획을 기준으로 다시 제안받으세요.", 409);
      updateDefinition(project, { ...project, steps: structuredClone(proposal.steps), outputs: structuredClone(proposal.outputs) });
      cancelObsoleteQueuedTasks(data, project);
      addLog(project, "user", "에이전트 제안을 제작 계획에 적용했습니다."); return { project };
    }
    if (input.action === "pause") { project.autoRun = false; addLog(project, "user", "현재 작업 뒤 자동 진행을 멈춥니다."); return { project }; }
    if (input.action === "note") {
      const task = data.workflowTasks?.find((item) => item.id === input.taskId && item.projectId === project.id);
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
      if (activeTask(data, project.id)) throw new AppError("현재 실행이 끝난 뒤 결과를 수정하세요.", 409);
      currentInputs(project, step); invalidateSteps(project, [step.id]); project.autoRun = false;
      appendArtifact(project, step, input.content, "user"); addLog(project, "user", `${step.name} 결과를 직접 수정했습니다.`); return { project };
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
}
export async function workflowManifest(workspaceId: string, id: string) {
  return transaction(workspaceId, (data) => {
    const project = projectIn(data, id);
    if (!preparationReady(project)) throw new AppError("출력 연결과 모든 스텝의 검수를 완료하세요.", 409);
    return { schemaVersion: 1, kind: "openstudio-preparation", generatedAt: now(), project: { id: project.id, name: project.name, brief: project.brief, revision: project.revision },
      steps: project.steps, outputs: project.outputs, artifacts: project.steps.map((step) => project.artifacts.find((item) => item.id === project.states[step.id]?.artifactId)), rendered: false };
  });
}
