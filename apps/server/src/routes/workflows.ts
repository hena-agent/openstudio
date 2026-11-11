import { z } from "zod";
import { route } from "../http";
import { AppError, transaction } from "../storage";
import { migrateLegacyProductions, mutateWorkflow, publicProductionSession, publicWorkflowTask, saveProductionPreset, workflowManifest, workflowResult } from "../workflows";

export const GET = route(async (request, workspaceId) => {
  const url = new URL(request.url);
  if (url.searchParams.has("session") && url.searchParams.has("artifact")) return workflowResult(workspaceId, z.uuid().parse(url.searchParams.get("session")), z.uuid().parse(url.searchParams.get("artifact")));
  if (url.searchParams.get("manifest")) return workflowManifest(workspaceId, z.uuid().parse(url.searchParams.get("manifest")));
  return transaction(workspaceId, (data) => { migrateLegacyProductions(data); return { projects: data.projects || [], sessions: (data.productionSessions || []).map(publicProductionSession), tasks: (data.workflowTasks || []).map(publicWorkflowTask), presets: data.productionPresets || [], assets: data.assets || [] }; });
});
export const POST = route(async (request, workspaceId) => {
  const input = await request.json();
  const execution = ["run", "approve", "edit-result", "note", "pause"].includes(input?.action);
  if (execution && input.action !== "note" && !input.sessionId) throw new AppError("제작 세션을 선택하세요.", 400);
  if (input?.action === "note" && !input.sessionId && !await transaction(workspaceId, (data) => data.workflowTasks?.some((task) => task.id === input.taskId && task.projectId === input.id && task.kind === "plan" && !task.sessionId))) throw new AppError("계획 대화 또는 제작 세션을 확인하세요.", 409);
  if (input?.sessionId && !execution) throw new AppError("시작한 제작 세션의 스텝·설정은 변경할 수 없습니다.", 409);
  return input?.action === "save-preset" ? saveProductionPreset(workspaceId, input) : mutateWorkflow(workspaceId, input);
}, true);
