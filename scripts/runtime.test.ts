import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnWorkspacePort, publishRuntime, readRuntime } from "./runtime";
import { frontendOrigin } from "../apps/server/src/http";

let directory: string;
const listeners: ReturnType<typeof createServer>[] = [];
function listener() { const server = createServer(); listeners.push(server); return server; }
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve) => server.close(() => resolve()));
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-runtime-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_CLIENT_PORT", ""); vi.stubEnv("OPENSTUDIO_SERVER_PORT", ""); });
afterEach(async () => { await Promise.all(listeners.splice(0).map(close)); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("workspace port selection", () => {
  it("persists each app's first port and reuses it after runtime cleanup", async () => {
    for (const role of ["client", "server"] as const) {
      const first = listener(), ipv6 = listener(), port = await listenOnWorkspacePort(role, first, ipv6);
      const clear = publishRuntime(role, `http://127.0.0.1:${port}`);
      clear(); await Promise.all([close(first), close(ipv6)]);
      expect(readRuntime(role)).toBeUndefined();
      expect(JSON.parse(await readFile(path.join(directory, "runtime", `${role}-port.json`), "utf8"))).toEqual({ version: 1, port });
      expect(await listenOnWorkspacePort(role, listener(), listener())).toBe(port);
    }
  });
  it("does not silently replace a saved port when either loopback listener is occupied", async () => {
    const first = listener(), port = await listenOnWorkspacePort("server", first);
    const collision = listener();
    await expect(listenOnWorkspacePort("server", collision)).rejects.toThrow(`고정 포트 ${port}`);
    expect(collision.listening).toBe(false);
    await close(first);
    const occupied = listener();
    await new Promise<void>((resolve) => occupied.listen({ port, host: "::1", ipv6Only: true }, resolve));
    const ipv4 = listener();
    await expect(listenOnWorkspacePort("server", ipv4, listener())).rejects.toThrow(`고정 포트 ${port}`);
    expect(ipv4.listening).toBe(false);
    expect(JSON.parse(await readFile(path.join(directory, "runtime", "server-port.json"), "utf8")).port).toBe(port);
  });
  it("adopts a previous runtime port and validates explicit configuration", async () => {
    const first = listener(), port = await listenOnWorkspacePort("client", first);
    publishRuntime("client", `http://127.0.0.1:${port}`);
    await close(first);
    await rm(path.join(directory, "runtime", "client-port.json"));
    expect(await listenOnWorkspacePort("client", listener())).toBe(port);
    for (const value of ["3000", "3659", "3148.5", "invalid", "0"]) {
      vi.stubEnv("OPENSTUDIO_CLIENT_PORT", value);
      await expect(listenOnWorkspacePort("client", listener())).rejects.toThrow("정수여야");
    }
    vi.stubEnv("OPENSTUDIO_SERVER_PORT", "4045");
    await expect(listenOnWorkspacePort("server", listener())).rejects.toThrow("정수여야");
  });
  it("rejects corrupt saved configuration instead of choosing another port", async () => {
    const server = listener(); await listenOnWorkspacePort("server", server); await close(server);
    await writeFile(path.join(directory, "runtime", "server-port.json"), "partial-json");
    const replacement = listener();
    await expect(listenOnWorkspacePort("server", replacement)).rejects.toThrow("포트 설정을 확인");
    expect(replacement.listening).toBe(false);
  });
});
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
