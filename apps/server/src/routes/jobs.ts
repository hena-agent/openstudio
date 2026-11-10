import { z } from "zod";
import { route } from "../http";
import { AppError, transaction } from "../storage";
import { createMediaJob, pollMediaJob, publicJob, recoverStalledJobs } from "../media-jobs";

export const GET = route(async (_request, sessionId) => transaction(sessionId, (data) => {
  recoverStalledJobs(data.jobs || []);
  return { jobs: (data.jobs || []).map(publicJob).reverse(), assets: data.assets || [] };
}));
export const POST = route(async (request, sessionId) => {
  const input = await request.json();
  if (input.action === "create") return { job: await createMediaJob(sessionId, input) };
  const { id } = z.object({ action: z.literal("poll"), id: z.uuid() }).parse(input);
  await transaction(sessionId, (data) => { if (!data.jobs?.some((job) => job.id === id)) throw new AppError("이 세션의 작업을 찾을 수 없습니다.", 404); recoverStalledJobs(data.jobs); });
  await pollMediaJob(sessionId, id);
  return transaction(sessionId, (data) => ({ job: publicJob(data.jobs!.find((job) => job.id === id)!) }));
}, true);
