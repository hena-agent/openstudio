import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Asset, Connection, DeviceAuthorization, MediaJob, RegisteredModel } from "@openstudio/shared/types";
import { database, StorageConflict, type JobIndex } from "@openstudio/database";
import type { WorkflowProject } from "@openstudio/shared/workflow";
import type { StoredWorkflowTask } from "./workflow-types";

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = "invalid_request", public upstreamStatus?: number) {
    super(message);
  }
}

export type StoredConnection = Connection & {
  secret: string; baseURL: string;
  refreshToken?: string; idToken?: string; expiresAt?: number; earliestRefreshAt?: number;
  clientId?: string; subject?: string; scopes?: string[];
};
export type OpenAIAttempt = {
  id: string; state: string; nonce: string; verifier: string; redirectUri: string;
  expiresAt: number; clientId: string; connectionId?: string;
  status: "pending" | "connected" | "failed" | "cancelled";
  error?: string;
};
export type OpenRouterAttempt = { id: string; state: string; verifier: string; expiresAt: number; consumed?: boolean; status: "pending" | "connected" | "failed" | "cancelled"; error?: string; connectionId?: string; exchangedKey?: string };
export type StoredJob = MediaJob & {
  runId: string; requestId: string; options: Record<string, unknown>; referenceIds: string[];
  modelSnapshot?: Connection["models"][number];
  providerBaseURL?: string;
  statusUrl?: string; resultUrl?: string; pendingOutputs?: { url?: string; base64?: string; mime?: string }[];
  submissionStartedAt?: string;
  queueVersion?: 1;
};
export type PendingDevice = DeviceAuthorization & {
  deviceCode: string;
  nextPollAt: number;
  processing?: boolean;
  accessToken?: string;
};
export type Workspace = { connections: StoredConnection[]; pending: PendingDevice[]; openaiAttempts?: OpenAIAttempt[]; routerAttempts?: OpenRouterAttempt[]; assets?: Asset[]; jobs?: StoredJob[]; registeredModels?: RegisteredModel[]; textRuns?: { id: string; model: string; prompt: string; text: string; createdAt: string }[]; projects?: WorkflowProject[]; workflowTasks?: StoredWorkflowTask[] };
export const dataRoot = () => process.env.OPENSTUDIO_DATA_DIR || path.join(process.cwd(), ".data");
const root = dataRoot;

export async function initializeStorage(local: boolean) {
  if (!process.env.OPENSTUDIO_ENCRYPTION_KEY && !local) throw new AppError("운영 환경에는 OPENSTUDIO_ENCRYPTION_KEY가 필요합니다.", 503);
  await mkdir(root(), { recursive: true, mode: 0o700 });
  if (!process.env.OPENSTUDIO_ENCRYPTION_KEY) {
    const file = path.join(root(), "master.key");
    try { await writeFile(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    process.env.OPENSTUDIO_ENCRYPTION_KEY = (await readFile(file, "utf8")).trim();
  }
  encryptionKey();
  // Import without modifying/deleting the legacy ciphertext or asset paths.
  for (const file of await readdir(root())) if (/^[a-f0-9]{64}\.enc$/.test(file)) await transaction(file.slice(0, -4), () => {});
  if (process.env.OPENSTUDIO_WORKSPACE_MODE === "local") {
    const db = database(root());
    const requested = process.env.OPENSTUDIO_LOCAL_WORKSPACE_ID;
    if (requested) {
      if (!/^[a-f0-9]{64}$/.test(requested) || !db.read(requested)) throw new AppError("지정한 로컬 워크스페이스를 찾을 수 없습니다.", 503);
      db.setMetadata("local-workspace", requested);
    }
    if (!db.getMetadata("local-workspace")) {
      let preferred = randomBytes(32).toString("hex"), score = -1;
      for (const id of db.workspaceIds()) {
        const data = JSON.parse(unseal(db.read(id)!.ciphertext)) as Workspace;
        const weight = data.connections.length * 100000 + (data.jobs?.length || 0) * 100 + (data.assets?.length || 0);
        if (weight > score) { score = weight; preferred = id; }
      }
      db.setMetadata("local-workspace", preferred);
    }
  }
}
export function localWorkspaceId() {
  if (process.env.OPENSTUDIO_WORKSPACE_MODE !== "local") return;
  const id = database(root()).getMetadata("local-workspace");
  if (!id) throw new AppError("로컬 워크스페이스 초기화가 필요합니다.", 503);
  return id;
}
export const workspaceIds = () => database(root()).workspaceIds();
export function jobIndex(data: Workspace): JobIndex[] { return [...(data.jobs || []).map((job) => ({ id: job.id, status: job.status, dueAt: job.nextPollAt || 0 })), ...(data.workflowTasks || []).map((task) => ({ id: `workflow:${task.id}`, status: task.status, dueAt: 0 }))]; }

export async function hostId() {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const file = path.join(root(), "host-id");
  try { await writeFile(file, `urn:uuid:${randomUUID()}`, { mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return (await readFile(file, "utf8")).trim();
}

export function encryptionKey() {
  const key = process.env.OPENSTUDIO_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) {
    throw new AppError("서버의 OPENSTUDIO_ENCRYPTION_KEY를 설정해 주세요. README의 시작 방법을 참고하세요.", 503, "configuration_required");
  }
  return Buffer.from(key, "hex");
}

export function seal(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function unseal(text: string) {
  const value = Buffer.from(text, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
}

const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
// Serialize read-modify-write transactions in this single-process validation server.
const globalStore = globalThis as unknown as { studioLocks?: Map<string, Promise<unknown>> };
const locks = globalStore.studioLocks ??= new Map();

export async function transaction<T>(id: string, work: (data: Workspace) => T | Promise<T>): Promise<T> {
  sessionId.parse(id);
  encryptionKey();
  const directory = root(), lockId = `${directory}:${id}`;
  const run = (locks.get(lockId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const db = database(directory), saved = db.read(id);
    let data: Workspace = { connections: [], pending: [] };
    if (saved) data = JSON.parse(unseal(saved.ciphertext));
    else {
      try { data = JSON.parse(unseal(await readFile(path.join(directory, `${id}.enc`), "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    // Network work stays outside SQLite transactions; local writes are serialized.
    const before = saved ? JSON.stringify(data) : undefined;
    const result = await work(data);
    const serialized = JSON.stringify(data);
    if (serialized === before) return result;
    try { db.write(id, seal(serialized), saved?.revision || 0, jobIndex(data)); }
    catch (error) { if (error instanceof StorageConflict) throw new AppError("다른 서버가 같은 데이터를 수정했습니다. 서버 실행 상태를 확인하세요.", 409); throw error; }
    return result;
  });
  locks.set(lockId, run);
  try { return await run; }
  finally { if (locks.get(lockId) === run) locks.delete(lockId); }
}

export function publicConnection(connection: StoredConnection): Connection {
  const { id, provider, label, method, createdAt, verifiedAt, models, modelsCheckedAt, status, planEnabled, credentialVerifiedAt, connectionIssue, modelSource, byteplus, fal } = connection;
  return { id, provider, label, method, createdAt, verifiedAt, models, modelsCheckedAt, status, planEnabled, credentialVerifiedAt, connectionIssue, modelSource, byteplus, fal };
}
