import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollDevice, startDevice } from "./oauth";
import { transaction } from "./storage";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
let directory: string;
let now: number;
let fetchMock: ReturnType<typeof vi.fn>;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const device = { device_code: "private-device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 };

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "openstudio-oauth-"));
  vi.stubEnv("OPENSTUDIO_DATA_DIR", directory);
  vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "e".repeat(64));
  vi.stubEnv("GITHUB_COPILOT_CLIENT_ID", "our-app-id");
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("GitHub device authorization", () => {
  it("requires an explicit client ID before making a request", async () => {
    vi.stubEnv("GITHUB_COPILOT_CLIENT_ID", "");
    await expect(startDevice(alice)).rejects.toThrow("GITHUB_COPILOT_CLIENT_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares one pending request for concurrent starts and hides the device secret", async () => {
    fetchMock.mockResolvedValue(response(device));
    const [first, second] = await Promise.all([startDevice(alice), startDevice(alice)]);
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty("deviceCode");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(pollDevice(bob, first.id)).rejects.toThrow("찾을 수 없습니다");
  });

  it("enforces provider interval and increases backoff on slow_down", async () => {
    fetchMock.mockResolvedValueOnce(response(device));
    const authorization = await startDevice(alice);
    expect((await pollDevice(alice, authorization.id)).status).toBe("pending");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 5000;
    fetchMock.mockResolvedValueOnce(response({ error: "slow_down" }));
    const result = await pollDevice(alice, authorization.id);
    expect(result).toMatchObject({ status: "pending", interval: 10_000 });
    now += 5000;
    await pollDevice(alice, authorization.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now += 5000;
    fetchMock.mockResolvedValueOnce(response({ error: "authorization_pending" }));
    await Promise.all([pollDevice(alice, authorization.id), pollDevice(alice, authorization.id)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("cleans up expired or denied authorization", async () => {
    fetchMock.mockResolvedValueOnce(response(device));
    const authorization = await startDevice(alice);
    now += 901_000;
    expect((await pollDevice(alice, authorization.id)).status).toBe("expired");
    expect(await transaction(alice, (data) => data.pending)).toEqual([]);
    fetchMock.mockResolvedValueOnce(response(device));
    const next = await startDevice(alice);
    now += 5000;
    fetchMock.mockResolvedValueOnce(response({ error: "access_denied" }));
    expect((await pollDevice(alice, next.id)).status).toBe("denied");
    expect(await transaction(alice, (data) => data.pending)).toEqual([]);
  });

  it("retains exchanged tokens across account lookup failure, then records authentication without claiming model access", async () => {
    fetchMock.mockResolvedValueOnce(response(device));
    const authorization = await startDevice(alice);
    now += 5000;
    fetchMock.mockResolvedValueOnce(response({ access_token: "private-access-token" })).mockResolvedValueOnce(response({}, 503));
    expect((await pollDevice(alice, authorization.id)).status).toBe("retry");
    now += 5000;
    fetchMock.mockResolvedValueOnce(response({ login: "alice" })).mockResolvedValueOnce(response({ chat_enabled: false }));
    const result = await pollDevice(alice, authorization.id);
    expect(result).toMatchObject({ status: "connected", entitlement: "denied", connection: { label: "alice", models: [] } });
    expect(JSON.stringify(result)).not.toContain("private-access-token");
    expect(JSON.stringify(result)).not.toContain("verifiedAt");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("access_token"))).toHaveLength(1);
    expect(await transaction(alice, (data) => data.pending)).toEqual([]);
  });
});
