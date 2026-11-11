import { randomUUID } from "node:crypto";
import { database, closeDatabases } from "@openstudio/database";
import { createApiServer } from "./api-server";
import { dataRoot, initializeStorage } from "./storage";
import { startJobRunner } from "./job-runner";
import { listenOnWorkspacePort, prepareEnvironment, publishRuntime, WorkspacePortError } from "../../../scripts/runtime";

async function main() {
  prepareEnvironment();
  const dev = !process.argv.includes("--production");
  Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });
  process.env.OPENSTUDIO_LOCAL_DEV = dev ? "1" : "0";
  process.env.OPENSTUDIO_WORKSPACE_MODE ||= "local";
  const db = database(dataRoot()), owner = randomUUID();
  db.acquireServer(owner, (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } });
  let runner: Awaited<ReturnType<typeof startJobRunner>> | undefined;
  let unpublish: (() => void) | undefined;
  const server = createApiServer(), ipv6 = createApiServer();
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    unpublish?.();
    server.close(); ipv6.close();
    // Bound shutdown: any unfinished submission is conservatively recovered on restart.
    let timer: NodeJS.Timeout;
    await Promise.race([runner?.stop(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 10_000); })]);
    clearTimeout(timer!);
    server.closeAllConnections(); ipv6.closeAllConnections(); db.releaseServer(owner); closeDatabases(); process.exit(0);
  }
  process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop());
  try {
    await initializeStorage(dev);
    const port = await listenOnWorkspacePort("server", server, ipv6);
    const origin = `http://127.0.0.1:${port}`; process.env.OPENSTUDIO_BACKEND_ORIGIN = origin;
    runner = await startJobRunner();
    unpublish = publishRuntime("server", origin);
    console.log(`Server: http://localhost:${port} · ${origin} · SQLite ${process.env.OPENSTUDIO_WORKSPACE_MODE}`);
  } catch (error) { db.releaseServer(owner); throw error; }
}
main().catch((error) => { console.error(error instanceof WorkspacePortError ? error.message : "서버 시작 실패. 데이터 디렉터리·암호화 키·실행 중인 서버를 확인하세요."); process.exit(1); });
