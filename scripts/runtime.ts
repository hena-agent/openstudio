import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { listenInRange } from "./ports";

type Role = "client" | "server";
type Runtime = { version: 1; pid: number; instance: string; origin: string };
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function prepareEnvironment() {
  for (const file of [".env.local", ".env"]) {
    try { process.loadEnvFile(path.join(repositoryRoot, file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  process.env.OPENSTUDIO_DATA_DIR = path.resolve(repositoryRoot, process.env.OPENSTUDIO_DATA_DIR || ".data");
  process.env.OPENSTUDIO_WORKSPACE_MODE ||= "local";
  process.env.OPENSTUDIO_RUNTIME_DISCOVERY = "1";
}
function runtimePath(role: Role) { return path.join(process.env.OPENSTUDIO_DATA_DIR || path.join(repositoryRoot, ".data"), "runtime", `${role}.json`); }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }
function validOrigin(role: Role, input: string) {
  try {
    const url = new URL(input), port = Number(url.port);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" && port >= (role === "client" ? 3001 : 4001) && port <= (role === "client" ? 3999 : 4999) && ![3659, 4045].includes(port);
  } catch { return false; }
}
export class WorkspacePortError extends Error {}

// Pick once per workspace. Runtime discovery is ephemeral; the port choice is not.
export async function listenOnWorkspacePort(role: Role, server: Server, ipv6?: Server) {
  const file = path.join(path.dirname(runtimePath(role)), `${role}-port.json`);
  const requested = process.env[`OPENSTUDIO_${role.toUpperCase()}_PORT`];
  let saved: number | undefined;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    if (record.version !== 1 || !Number.isInteger(record.port) || !validOrigin(role, `http://127.0.0.1:${record.port}`)) throw new Error("invalid port record");
    saved = record.port;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new WorkspacePortError(`${role} 포트 설정을 확인하세요: ${file}`);
  }
  const previous = storedRuntime(role);
  const preferred = requested ? Number(requested) : saved ?? (previous ? Number(new URL(previous.origin).port) : undefined);
  if (preferred !== undefined && (!Number.isInteger(preferred) || !validOrigin(role, `http://127.0.0.1:${preferred}`))) throw new WorkspacePortError(`${role} 포트는 ${role === "client" ? "3001–3999 (3659 제외)" : "4001–4999 (4045 제외)"}의 정수여야 합니다.`);
  let port: number;
  try { port = await listenInRange(server, preferred ?? (role === "client" ? 3001 : 4001), preferred ?? (role === "client" ? 3999 : 4999), ipv6); }
  catch (error) {
    if (preferred !== undefined) throw new WorkspacePortError(`${role}의 고정 포트 ${preferred}에 바인딩할 수 없습니다. 해당 포트를 사용하는 프로세스를 확인하세요.`);
    throw error;
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const record = JSON.stringify({ version: 1, port });
    if (saved === undefined) writeFileSync(file, record, { mode: 0o600, flag: "wx" });
    else if (saved !== port) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, record, { mode: 0o600 }); renameSync(temporary, file);
    }
  } catch (error) {
    await Promise.all([server, ipv6].filter((item): item is Server => !!item?.listening).map((item) => new Promise<void>((resolve) => item.close(() => resolve()))));
    throw error;
  }
  return port;
}
function storedRuntime(role: Role): Runtime | undefined {
  try {
    const value = JSON.parse(readFileSync(runtimePath(role), "utf8")) as Runtime;
    if (value.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.instance !== "string" || !/^[a-f0-9-]{36}$/.test(value.instance) || typeof value.origin !== "string" || !validOrigin(role, value.origin)) return;
    return value;
  } catch { return; }
}
export function readRuntime(role: Role) {
  const value = storedRuntime(role);
  return value && alive(value.pid) ? value : undefined;
}
export function publishRuntime(role: Role, origin: string) {
  if (!validOrigin(role, origin)) throw new Error("지원하지 않는 앱 실행 주소입니다.");
  const previous = readRuntime(role);
  if (previous && previous.pid !== process.pid) throw new Error(`${role} 앱이 이미 실행 중입니다.`);
  const value: Runtime = { version: 1, pid: process.pid, instance: randomUUID(), origin };
  const file = runtimePath(role), temporary = `${file}.${value.instance}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, file);
  return () => {
    if (storedRuntime(role)?.instance === value.instance) {
      try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  };
}
