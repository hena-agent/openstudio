import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Connection, DeviceAuthorization } from "../types";

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = "invalid_request") {
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
export type PendingDevice = DeviceAuthorization & {
  deviceCode: string;
  nextPollAt: number;
  processing?: boolean;
  accessToken?: string;
};
export type Workspace = { connections: StoredConnection[]; pending: PendingDevice[]; openaiAttempts?: OpenAIAttempt[] };
const root = () => process.env.OPENSTUDIO_DATA_DIR || path.join(process.cwd(), ".data");

export async function initializeStorage(local: boolean) {
  if (process.env.OPENSTUDIO_ENCRYPTION_KEY) { encryptionKey(); return; }
  if (!local) throw new AppError("운영 환경에는 OPENSTUDIO_ENCRYPTION_KEY가 필요합니다.", 503);
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const file = path.join(root(), "master.key");
  try { await writeFile(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  process.env.OPENSTUDIO_ENCRYPTION_KEY = (await readFile(file, "utf8")).trim();
  encryptionKey();
}

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
  const run = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const file = path.join(root(), `${id}.enc`);
    let data: Workspace = { connections: [], pending: [] };
    try {
      data = JSON.parse(unseal(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const result = await work(data);
    await mkdir(root(), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temp, seal(JSON.stringify(data)), { mode: 0o600 });
    await rename(temp, file);
    return result;
  });
  locks.set(id, run);
  try { return await run; }
  finally { if (locks.get(id) === run) locks.delete(id); }
}

export function publicConnection(connection: StoredConnection): Connection {
  const { id, provider, label, method, createdAt, verifiedAt, models, modelsCheckedAt, status, planEnabled } = connection;
  return { id, provider, label, method, createdAt, verifiedAt, models, modelsCheckedAt, status, planEnabled };
}
