import { z } from "zod";
import { route } from "../http";
import { transaction } from "../storage";
import { mutateWorkflow, publicWorkflowTask, workflowManifest } from "../workflows";

export const GET = route(async (request, workspaceId) => {
  const url = new URL(request.url);
  if (url.searchParams.get("manifest")) return workflowManifest(workspaceId, z.uuid().parse(url.searchParams.get("manifest")));
  return transaction(workspaceId, (data) => ({ projects: data.projects || [], tasks: (data.workflowTasks || []).map(publicWorkflowTask) }));
});
export const POST = route(async (request, workspaceId) => mutateWorkflow(workspaceId, await request.json()), true);
