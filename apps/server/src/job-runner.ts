import { randomUUID } from "node:crypto";
import { database, type ClaimedJob } from "@openstudio/database";
import { dataRoot, transaction, workspaceIds } from "./storage";
import { processMediaJob, recoverStalledJobs } from "./media-jobs";

export async function startJobRunner({ interval = 1000, concurrency = 2 }: { interval?: number; concurrency?: number } = {}) {
  const db = database(dataRoot()), owner = randomUUID();
  // Production startup acquires the single-server lock before recovering leases.
  db.resetLeases();
  for (const id of workspaceIds()) await transaction(id, (data) => recoverStalledJobs(data.jobs || []));
  let stopped = false, scanning = false;
  const active = new Set<Promise<void>>();
  async function execute(job: ClaimedJob) {
    const heartbeat = setInterval(() => { try { db.renew(owner, job); } catch { /* Retry while retaining the durable task state. */ } }, 15_000); heartbeat.unref();
    try { await processMediaJob(job.workspaceId, job.id); }
    catch {
      await transaction(job.workspaceId, (data) => {
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
