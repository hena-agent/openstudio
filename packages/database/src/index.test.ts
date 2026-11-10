import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabases, database, StorageConflict, StudioDatabase } from "./index";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-sqlite-")); });
afterEach(async () => { closeDatabases(); await rm(directory, { recursive: true, force: true }); });
describe("SQLite durable job index", () => {
  it("commits workspace and queue together, rejects stale writes, and persists across reopen", () => {
    let db = database(directory); db.write("workspace", "encrypted-one", 0, [{ id: "job", status: "queued", dueAt: 10 }]);
    expect(() => db.write("workspace", "stale", 0, [])).toThrow(StorageConflict);
    expect(db.read("workspace")?.ciphertext).toBe("encrypted-one");
    expect(db.claim("owner", 10)).toEqual({ workspaceId: "workspace", id: "job" });
    closeDatabases(); db = database(directory); expect(db.read("workspace")?.revision).toBe(1);
    expect(db.claim("different", 11)).toBeUndefined();
  });
  it("atomically claims across connections and reclaims only expired leases", () => {
    const first = database(directory), second = new StudioDatabase(directory);
    try {
      first.write("workspace", "encrypted", 0, [{ id: "job", status: "queued", dueAt: 10 }]);
      const job = first.claim("first", 10, 100)!;
      expect(second.claim("second", 20)).toBeUndefined();
      expect(second.renew("second", job, 200)).toBe(false);
      first.write("workspace", "updated", 1, [{ id: "job", status: "running", dueAt: 10 }]);
      expect(second.claim("second", 20)).toBeUndefined();
      expect(first.renew("first", job, 200)).toBe(true);
      expect(second.claim("second", 199)).toBeUndefined();
      expect(second.claim("second", 201)).toEqual(job);
      first.release("first", job); expect(first.claim("third", 202)).toBeUndefined();
    } finally { second.close(); }
  });
  it("excludes completed work and fences a second live server", () => {
    const db = database(directory);
    db.write("workspace", "encrypted", 0, [{ id: "job", status: "completed", dueAt: 0 }]); expect(db.claim("owner")).toBeUndefined();
    db.acquireServer("first", () => true);
    expect(() => db.acquireServer("second", () => true)).toThrow("이미 실행 중");
    db.acquireServer("second", () => false); db.releaseServer("first");
    expect(() => db.acquireServer("third", () => true)).toThrow("이미 실행 중");
    db.releaseServer("second"); expect(() => db.acquireServer("third", () => true)).not.toThrow();
  });
});
