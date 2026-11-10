import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabases, database } from "@openstudio/database";
import { initializeStorage, localWorkspaceId, seal, transaction, type Workspace } from "./storage";
import { readSession } from "./http";
import { referenceData } from "./assets";

let directory: string;
const alice = "a".repeat(64), bob = "b".repeat(64);
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-migration-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); });
afterEach(async () => { closeDatabases(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("legacy migration and local workspace identity", () => {
  it("imports encrypted records once, preserves the originals and old asset paths", async () => {
    const id = crypto.randomUUID(), png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const data: Workspace = { connections: [{ id: crypto.randomUUID(), provider: "openai", method: "api-key", label: "Original", createdAt: "now", models: [], baseURL: "https://api.openai.com/v1", secret: "private-token" }], pending: [], assets: [{ id, name: "reference.png", kind: "image", mime: "image/png", size: png.length, createdAt: "now" }] };
    const ciphertext = seal(JSON.stringify(data)), legacy = path.join(directory, `${alice}.enc`);
    await writeFile(legacy, ciphertext); await mkdir(path.join(directory, "assets", alice), { recursive: true }); await writeFile(path.join(directory, "assets", alice, id), png);
    await initializeStorage(true);
    expect((await transaction(alice, (data) => data.connections))[0].secret).toBe("private-token");
    expect(await referenceData(alice, id)).toBe(`data:image/png;base64,${png.toString("base64")}`);
    await transaction(alice, (data) => { data.connections[0].label = "Updated"; }); closeDatabases(); await initializeStorage(true);
    expect(await transaction(alice, (data) => data.connections[0].label)).toBe("Updated");
    expect(await readFile(legacy, "utf8")).toBe(ciphertext);
    expect((await readFile(path.join(directory, "studio.sqlite"))).includes(Buffer.from("private-token"))).toBe(false);
  });
  it("uses the existing local workspace on both hosts and after reopening the DB", async () => {
    await transaction(alice, (data) => { data.connections.push({ id: "account", provider: "openai", label: "Existing", method: "api-key", createdAt: "now", models: [], secret: "private", baseURL: "https://api.openai.com/v1" }); });
    await transaction(bob, () => {}); vi.stubEnv("OPENSTUDIO_WORKSPACE_MODE", "local"); await initializeStorage(true);
    expect(localWorkspaceId()).toBe(alice);
    for (const host of ["localhost", "127.0.0.1"]) expect(readSession(new Request(`http://${host}:3456/api/connections`, { headers: { Cookie: `studio_session=${bob}` } }))).toBe(alice);
    closeDatabases(); await initializeStorage(true); expect(localWorkspaceId()).toBe(alice);
    vi.stubEnv("OPENSTUDIO_WORKSPACE_MODE", "session"); expect(readSession(new Request("http://localhost/api", { headers: { Cookie: `studio_session=${bob}` } }))).toBe(bob);
  });
  it("rolls back failed mutations and does not enqueue phantom work", async () => {
    await transaction(alice, () => {});
    await expect(transaction(alice, (data) => { data.connections.push({} as never); throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await transaction(alice, (data) => data.connections)).toEqual([]); expect(database(directory).claim("owner")).toBeUndefined();
  });
});
