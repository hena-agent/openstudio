import { randomUUID } from "node:crypto";
import { database, type ClaimedJob } from "@openstudio/database";
import { dataRoot, transaction, workspaceIds } from "./storage";
import { processMediaJob, recoverStalledJobs } from "./media-jobs";
import { processWorkflowTask } from "./workflow-agent";
import { recoverWorkflowTasks, taskProjectIn } from "./workflows";

export async function startJobRunner({ interval = 1000, concurrency = 2 }: { interval?: number; concurrency?: number } = {}) {
  const db = database(dataRoot()), owner = randomUUID();
  // Production startup acquires the single-server lock before recovering leases.
  db.resetLeases();
  for (const id of workspaceIds()) await transaction(id, (data) => { recoverStalledJobs(data.jobs || []); recoverWorkflowTasks(data); });
  let stopped = false, scanning = false;
  const active = new Set<Promise<void>>();
  async function execute(job: ClaimedJob) {
    const heartbeat = setInterval(() => { try { db.renew(owner, job); } catch { /* Retry while retaining the durable task state. */ } }, 15_000); heartbeat.unref();
    try { if (job.id.startsWith("workflow:")) await processWorkflowTask(job.workspaceId, job.id.slice(9)); else await processMediaJob(job.workspaceId, job.id); }
    catch {
      await transaction(job.workspaceId, (data) => {
        if (job.id.startsWith("workflow:")) {
          const task = data.workflowTasks?.find((item) => item.id === job.id.slice(9));
          if (task && task.status !== "completed") {
            task.status = task.requestStartedAt && !task.result ? "unknown" : "failed"; task.error = "제작 준비 작업의 처리 상태를 확인하지 못했습니다. 기록을 확인하고 다시 실행하세요.";
            const project = taskProjectIn(data, task);
            if (project) { project.autoRun = false; if (task.stepId) project.states[task.stepId] = { ...project.states[task.stepId], status: "failed", error: task.error }; }
          }
          return;
        }
        const current = data.jobs?.find((item) => item.id === job.id); if (!current) return;
        if (current.status === "submitting" && current.submissionStartedAt && !current.externalId) current.status = "unknown";
        current.error = "작업 처리 상태를 확인하지 못했습니다. 저장한 단계에서 다시 확인합니다.";
        current.nextPollAt = Date.now() + 10_000;
      }).catch(() => {});
    } finally { clearInterval(heartbeat); db.release(owner, job); }
  }
  function tick() {
    if (stopped || scanning) return;
    scanning = true;
    try {
      while (active.size < concurrency) {
        const job = db.claim(owner); if (!job) break;
        const work = execute(job); active.add(work);
        void work.finally(() => active.delete(work)).catch(() => {});
      }
    } catch { console.error("작업 큐 조회에 실패했습니다. 다음 주기에 다시 확인합니다."); }
    finally { scanning = false; }
  }
  const timer = setInterval(tick, interval); timer.unref(); tick();
  return { tick, async stop() { stopped = true; clearInterval(timer); await Promise.allSettled([...active]); } };
}
