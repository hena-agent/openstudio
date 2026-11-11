import { productionComplete, type PreparationArtifact, type ProductionSession, type WorkflowLog, type WorkflowProject, type WorkflowTask } from "@openstudio/shared/workflow";

export type ResultDraft = { versionId: string; baseArtifactId: string; originalContent: string; originalFileId: string; content: string; fileId: string; editing?: boolean; source?: boolean };
export function resultDraftFor(artifact?: PreparationArtifact, latestId = artifact?.id || ""): ResultDraft {
  return { versionId: artifact?.id || "", baseArtifactId: latestId, originalContent: artifact?.content || "", originalFileId: artifact?.assetIds?.[0] || "", content: artifact?.content || "", fileId: artifact?.assetIds?.[0] || "", editing: false, source: false };
}
export function resultDraftDirty(draft: ResultDraft) { return draft.content !== draft.originalContent || draft.fileId !== draft.originalFileId; }
export function isProductionActivity(log: WorkflowLog, project: WorkflowProject, tasks: WorkflowTask[]) {
  if (log.kind) return log.kind === "activity";
  if (log.role === "tool" || log.role === "system") return true;
  const task = log.taskId ? tasks.find((item) => item.id === log.taskId) : undefined;
  const step = project.steps.find((item) => item.id === task?.stepId);
  if (task?.kind === "step" && step) {
    if (log.role === "user" && !task.feedback && log.text === `${step.name} 준비 실행` && project.logs.find((item) => item.role === "user" && item.taskId === task.id)?.id === log.id) return true;
    if (log.role === "assistant" && log.text === `${step.name} 준비 결과를 제출했습니다.`) return true;
  }
  if (!log.taskId && log.role === "user") return project.steps.some((item) => project.artifacts.some((artifact) => artifact.stepId === item.id && (log.text === `${item.name} v${artifact.version} 승인` && !!artifact.approvedAt || log.text === `${item.name} 결과를 직접 수정했습니다.` && artifact.source === "user")));
  return false;
}
export function resolveResultDraft(draft: ResultDraft | undefined, latest?: PreparationArtifact) {
  if (draft && latest && draft.baseArtifactId !== latest.id && draft.versionId === draft.baseArtifactId && draft.content === latest.content && draft.fileId === (latest.assetIds?.[0] || "")) return resultDraftFor(latest);
  if (!draft || !resultDraftDirty(draft) && draft.versionId === draft.baseArtifactId && draft.baseArtifactId !== (latest?.id || "")) return resultDraftFor(latest);
  return draft;
}
export function productionSessionStatus(session: ProductionSession, tasks: WorkflowTask[]) {
  const completed = session.steps.filter((step) => session.states[step.id]?.status === "complete").length, total = session.steps.length;
  const ownTasks = tasks.filter((task) => task.sessionId === session.id);
  const statuses = session.steps.map((step) => session.states[step.id]?.status);
  let label = "대기", tone: "success" | "warning" | "destructive" | "outline" = "outline";
  if (productionComplete(session)) { label = "완료"; tone = "success"; }
  else if (ownTasks.some((task) => task.status === "running")) label = "제작 중";
  else if (ownTasks.some((task) => task.status === "queued")) label = "실행 대기";
  else if (ownTasks.at(-1)?.status === "unknown" && session.states[ownTasks.at(-1)!.stepId || ""]?.status === "failed") { label = "확인 필요"; tone = "warning"; }
  else if (statuses.includes("failed")) { label = "실패"; tone = "destructive"; }
  else if (statuses.includes("needs_input")) { label = "답변 필요"; tone = "warning"; }
  else if (statuses.includes("review")) { label = "검수 대기"; tone = "warning"; }
  else if (statuses.includes("stale")) { label = "갱신 필요"; tone = "warning"; }
  else if (completed) label = "작업 대기";
  return { label, tone, completed, total };
}
