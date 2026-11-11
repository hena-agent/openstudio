import { z } from "zod";

export const stepKinds = {
  text: "원고·텍스트", image: "이미지 설계", video: "영상 설계", audio: "음성 설계",
  code: "SVG·HTML 코드", compose: "합성 설계", export: "출력 설계", manual: "사용자 작업",
} as const;
const referenceId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine((id) => !["__proto__", "prototype", "constructor"].includes(id), "예약된 ID는 사용할 수 없습니다.");
export const agentBindingSchema = z.object({ connectionId: z.uuid(), modelId: z.string().min(1).max(300) });
export type AgentBinding = z.infer<typeof agentBindingSchema>;
export const workflowStepSchema = z.object({
  id: referenceId, name: z.string().trim().min(1).max(120), kind: z.enum(Object.keys(stepKinds) as [keyof typeof stepKinds, ...(keyof typeof stepKinds)[]]),
  instruction: z.string().max(4000).default(""), inputs: z.array(referenceId).max(30).default([]), review: z.boolean().default(true),
  agent: agentBindingSchema.optional(), generator: agentBindingSchema.optional(),
});
export const workflowOutputSchema = z.object({
  id: referenceId, name: z.string().trim().min(1).max(120), sourceStepId: referenceId,
  format: z.enum(["mp4", "webm", "gif", "png", "srt"]), width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680),
  durationSeconds: z.number().min(1).max(3600).default(30),
});
export const workflowDefinitionSchema = z.object({ steps: z.array(workflowStepSchema).max(30), outputs: z.array(workflowOutputSchema).max(8) });
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
export type StepStatus = "idle" | "queued" | "running" | "review" | "complete" | "stale" | "failed" | "needs_input";
export type StepState = { status: StepStatus; artifactId?: string; question?: string; error?: string };
export type PreparationArtifact = {
  id: string; stepId: string; version: number; content: string; kind: "text" | "code" | "specification";
  createdAt: string; source: "agent" | "user"; definitionHash: string; inputArtifacts: Record<string, string>;
  approvedAt?: string; stale?: boolean; feedback?: string; taskId?: string;
};
export type WorkflowLog = { id: string; role: "user" | "assistant" | "tool" | "system"; text: string; createdAt: string; taskId?: string };
export type WorkflowProposal = { id: string; name: string; summary: string; steps: WorkflowStep[]; outputs: WorkflowOutput[]; createdAt: string; taskId: string; basedOnRevision: number };
export type WorkflowTask = {
  id: string; projectId: string; requestId: string; kind: "plan" | "step"; stepId?: string;
  status: "queued" | "running" | "completed" | "failed" | "unknown"; createdAt: string; updatedAt: string;
  feedback?: string; error?: string;
  basedOnRevision?: number;
};
export type WorkflowProject = {
  id: string; name: string; brief: string; revision: number; createdAt: string; updatedAt: string;
  agent?: AgentBinding; steps: WorkflowStep[]; outputs: WorkflowOutput[]; states: Record<string, StepState>;
  artifacts: PreparationArtifact[]; proposals: WorkflowProposal[]; logs: WorkflowLog[]; autoRun: boolean;
};
export type WorkflowIssue = { stepId?: string; outputId?: string; message: string };
export function workflowIssues(definition: { steps: WorkflowStep[]; outputs: WorkflowOutput[] }): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [], ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id)) issues.push({ stepId: step.id, message: "스텝 ID가 중복됐습니다." });
    ids.add(step.id);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = (definition.steps.find((step) => step.id === id)?.inputs || []).some(visit);
    visiting.delete(id); visited.add(id); return cycle;
  };
  for (const step of definition.steps) {
    for (const input of step.inputs) if (!ids.has(input)) issues.push({ stepId: step.id, message: `삭제되거나 없는 입력 스텝: ${input}` });
    if (new Set(step.inputs).size !== step.inputs.length) issues.push({ stepId: step.id, message: "입력 연결이 중복됐습니다." });
    if (visit(step.id)) issues.push({ stepId: step.id, message: "스텝 연결에 순환이 있습니다." });
  }
  const outputIds = new Set<string>();
  for (const output of definition.outputs) {
    if (outputIds.has(output.id)) issues.push({ outputId: output.id, message: "출력 ID가 중복됐습니다." });
    outputIds.add(output.id);
    if (!ids.has(output.sourceStepId)) issues.push({ outputId: output.id, message: "출력의 입력 스텝을 선택하세요." });
  }
  return issues;
}
export function readySteps(project: WorkflowProject) {
  if (workflowIssues(project).length) return [];
  return project.steps.filter((step) => !["complete", "review", "queued", "running", "needs_input"].includes(project.states[step.id]?.status || "idle") && step.inputs.every((id) => project.states[id]?.status === "complete"));
}
export function preparationReady(project: WorkflowProject) {
  return project.outputs.length > 0 && project.steps.length > 0 && !workflowIssues(project).length && project.steps.every((step) => project.states[step.id]?.status === "complete");
}
export const stepStatusNames: Record<StepStatus, string> = { idle: "대기", queued: "실행 대기", running: "준비 중", review: "검수 필요", complete: "준비 완료", stale: "갱신 필요", failed: "실패", needs_input: "응답 필요" };
