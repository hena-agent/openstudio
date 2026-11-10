import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishRuntime, readRuntime } from "./runtime";
import { frontendOrigin } from "../apps/server/src/http";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-runtime-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("independent app discovery", () => {
  it("publishes only execution metadata and discovers a restarted peer", () => {
    expect(readRuntime("server")).toBeUndefined();
    const clearFirst = publishRuntime("server", "http://127.0.0.1:4567");
    const first = readRuntime("server")!;
    expect(Object.keys(first).sort()).toEqual(["instance", "origin", "pid", "version"]);
    expect(first.origin).toBe("http://127.0.0.1:4567");
    const clearSecond = publishRuntime("server", "http://127.0.0.1:4568");
    clearFirst(); expect(readRuntime("server")?.origin).toBe("http://127.0.0.1:4568");
    expect(readRuntime("server")?.instance).not.toBe(first.instance);
    clearSecond(); expect(readRuntime("server")).toBeUndefined();
  });
  it("ignores a dead process and rejects unsafe or malformed discovery records", async () => {
    publishRuntime("server", "http://127.0.0.1:4567");
    const file = path.join(directory, "runtime", "server.json"), valid = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...valid, pid: 2_000_000_000 })); expect(readRuntime("server")).toBeUndefined();
    for (const origin of ["https://evil.test", "http://127.0.0.1:3456", "http://user:pass@127.0.0.1:4567", "http://127.0.0.1:4567/other", "http://127.0.0.1:4045"]) {
      await writeFile(file, JSON.stringify({ ...valid, origin })); expect(readRuntime("server")).toBeUndefined();
      expect(() => publishRuntime("server", origin)).toThrow("지원하지 않는");
    }
    await writeFile(file, "partial-json"); expect(readRuntime("server")).toBeUndefined();
    publishRuntime("server", "http://127.0.0.1:4569"); expect(readRuntime("server")?.origin).toBe("http://127.0.0.1:4569");
  });
  it("updates the trusted frontend origin without restarting the server and fails closed while absent", () => {
    vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", ""); vi.stubEnv("OPENSTUDIO_RUNTIME_DISCOVERY", "1");
    const request = (origin: string) => new Request("http://127.0.0.1:4567/api/connections", { headers: { Origin: origin } });
    expect(() => frontendOrigin(request("http://localhost:3456"))).toThrow("준비되지");
    const clear = publishRuntime("client", "http://127.0.0.1:3456");
    expect(frontendOrigin(request("http://localhost:3456")).origin).toBe("http://localhost:3456");
    clear(); publishRuntime("client", "http://127.0.0.1:3457");
    expect(frontendOrigin(request("http://localhost:3457")).origin).toBe("http://localhost:3457");
    expect(() => frontendOrigin(request("http://localhost:3456"))).toThrow("허용되지");
    expect(() => frontendOrigin(request("https://other.test"))).toThrow("허용되지");
  });
});
