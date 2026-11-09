import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicConnection, seal, transaction, unseal } from "./storage";

let directory: string;
const alice = "a".repeat(64);
const bob = "b".repeat(64);
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "openstudio-test-"));
  vi.stubEnv("OPENSTUDIO_DATA_DIR", directory);
  vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "f".repeat(64));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("credential storage", () => {
  it("encrypts with unique IVs and rejects modified ciphertext", () => {
    const value = seal("private-token");
    expect(value).not.toContain("private-token");
    expect(unseal(value)).toBe("private-token");
    expect(seal("private-token")).not.toBe(value);
    const tampered = Buffer.from(value, "base64");
    tampered[30] ^= 1;
    expect(() => unseal(tampered.toString("base64"))).toThrow();
  });

  it("isolates accounts by session and strips secret fields", async () => {
    await transaction(alice, (data) => data.connections.push({
      id: "connection", provider: "openai", label: "Alice", method: "api-key", createdAt: "now", models: [], secret: "private-token", baseURL: "https://api.openai.com/v1",
    }));
    expect(await transaction(bob, (data) => data.connections)).toEqual([]);
    const [connection] = await transaction(alice, (data) => data.connections.map(publicConnection));
    expect(connection.label).toBe("Alice");
    expect(connection).not.toHaveProperty("secret");
    expect(connection).not.toHaveProperty("baseURL");
    expect(await readFile(path.join(directory, `${alice}.enc`), "utf8")).not.toContain("private-token");
  });

  it("serializes concurrent mutations without losing connections", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => transaction(alice, (data) => {
      data.connections.push({ id: String(index), provider: "openai", label: "account", method: "api-key", createdAt: "now", models: [], secret: "token", baseURL: "https://api.openai.com/v1" });
    })));
    expect(await transaction(alice, (data) => data.connections.length)).toBe(8);
  });

  it("rejects path traversal and refuses to operate without an encryption key", async () => {
    await expect(transaction("../../other", () => {})).rejects.toThrow();
    vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "");
    const work = vi.fn();
    await expect(transaction(alice, work)).rejects.toThrow("OPENSTUDIO_ENCRYPTION_KEY");
    expect(work).not.toHaveBeenCalled();
  });
});
