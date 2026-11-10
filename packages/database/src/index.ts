import { DatabaseSync } from "node:sqlite";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

export type JobIndex = { id: string; status: string; dueAt: number };
export type ClaimedJob = { workspaceId: string; id: string };
export class StorageConflict extends Error {}
const databases = new Map<string, StudioDatabase>();

export function database(directory: string) {
  const root = path.resolve(directory);
  let stored = databases.get(root);
  if (!stored) { stored = new StudioDatabase(root); databases.set(root, stored); }
  return stored;
}
export function closeDatabases() { for (const db of databases.values()) db.close(); databases.clear(); }

export class StudioDatabase {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "studio.sqlite");
    closeSync(openSync(file, "a", 0o600));
    this.db = new DatabaseSync(file);
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 1) { this.db.close(); throw new Error("이 앱보다 새로운 SQLite 스키마입니다. 앱 버전을 확인하세요."); }
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id), id TEXT NOT NULL, status TEXT NOT NULL,
        due_at INTEGER NOT NULL, generation INTEGER NOT NULL, lease_owner TEXT, lease_until INTEGER,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS due_jobs ON scheduled_jobs(status, due_at, lease_until);
      PRAGMA user_version=1;`);
  }
  private atomic<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  read(id: string) {
    return this.db.prepare("SELECT ciphertext, revision FROM workspaces WHERE id=?").get(id) as { ciphertext: string; revision: number } | undefined;
  }
  workspaceIds() { return (this.db.prepare("SELECT id FROM workspaces ORDER BY id").all() as { id: string }[]).map((row) => row.id); }
  getMetadata(key: string) { return (this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | undefined)?.value; }
  setMetadata(key: string, value: string) { this.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
  write(id: string, ciphertext: string, revision: number, jobs: JobIndex[]) {
    this.atomic(() => {
      if (!revision) {
        const inserted = this.db.prepare("INSERT OR IGNORE INTO workspaces(id,ciphertext,revision,updated_at) VALUES(?,?,1,?)").run(id, ciphertext, Date.now());
        if (!inserted.changes) throw new StorageConflict("Workspace was changed by another writer");
      } else {
        const updated = this.db.prepare("UPDATE workspaces SET ciphertext=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?").run(ciphertext, Date.now(), id, revision);
        if (!updated.changes) throw new StorageConflict("Workspace was changed by another writer");
      }
      const upsert = this.db.prepare(`INSERT INTO scheduled_jobs(workspace_id,id,status,due_at,generation) VALUES(?,?,?,?,?)
        ON CONFLICT(workspace_id,id) DO UPDATE SET status=excluded.status,due_at=excluded.due_at,generation=excluded.generation`);
      for (const job of jobs) upsert.run(id, job.id, job.status, job.dueAt, revision + 1);
      this.db.prepare("DELETE FROM scheduled_jobs WHERE workspace_id=? AND generation<>?").run(id, revision + 1);
    });
  }
  claim(owner: string, now = Date.now(), duration = 60_000): ClaimedJob | undefined {
    return this.atomic(() => {
      const job = this.db.prepare(`SELECT workspace_id AS workspaceId,id FROM scheduled_jobs
        WHERE status NOT IN ('completed','failed','unknown') AND due_at<=? AND (lease_until IS NULL OR lease_until<=?)
        ORDER BY due_at,workspace_id,id LIMIT 1`).get(now, now) as ClaimedJob | undefined;
      if (job) this.db.prepare("UPDATE scheduled_jobs SET lease_owner=?,lease_until=? WHERE workspace_id=? AND id=?").run(owner, now + duration, job.workspaceId, job.id);
      return job;
    });
  }
  renew(owner: string, job: ClaimedJob, until = Date.now() + 60_000) {
    return !!this.db.prepare("UPDATE scheduled_jobs SET lease_until=? WHERE workspace_id=? AND id=? AND lease_owner=?").run(until, job.workspaceId, job.id, owner).changes;
  }
  release(owner: string, job: ClaimedJob) { this.db.prepare("UPDATE scheduled_jobs SET lease_owner=NULL,lease_until=NULL WHERE workspace_id=? AND id=? AND lease_owner=?").run(job.workspaceId, job.id, owner); }
  resetLeases() { this.db.prepare("UPDATE scheduled_jobs SET lease_owner=NULL,lease_until=NULL").run(); }
  acquireServer(owner: string, alive: (pid: number) => boolean) {
    this.atomic(() => {
      const previous = this.getMetadata("server-owner");
      if (previous) {
        const lock = JSON.parse(previous) as { owner: string; pid: number };
        if (lock.owner !== owner && alive(lock.pid)) throw new Error("이 데이터 디렉터리를 사용하는 서버가 이미 실행 중입니다.");
      }
      this.setMetadata("server-owner", JSON.stringify({ owner, pid: process.pid }));
    });
  }
  releaseServer(owner: string) {
    this.atomic(() => {
      const lock = this.getMetadata("server-owner");
      if (lock && (JSON.parse(lock) as { owner: string }).owner === owner) this.db.prepare("DELETE FROM metadata WHERE key='server-owner'").run();
    });
  }
  close() { this.db.close(); }
}
