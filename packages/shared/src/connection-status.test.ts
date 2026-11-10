import { describe, expect, it } from "vitest";
import type { Connection } from "./types";
import { connectionStatus } from "./connection-status";

const connection: Connection = { id: "account", provider: "fal", label: "fal", method: "api-key", createdAt: "now", models: [] };
describe("visible connection state", () => {
  it("distinguishes disconnected, checking and stored connections", () => {
    expect(connectionStatus().label).toBe("연결 안 됨");
    expect(connectionStatus(connection).label).toBe("연결됨");
    expect(connectionStatus(connection, true).label).toBe("연결 확인 중");
    expect(connectionStatus({ ...connection, status: "disconnected" }).label).toBe("연결 해제됨");
  });
  it("never treats a temporary failure as revoked credentials or a permission failure as success", () => {
    for (const [kind, label] of [["authentication", "재인증 필요"], ["permission", "권한 확인 필요"], ["temporary", "재확인 실패"]] as const) expect(connectionStatus({ ...connection, connectionIssue: { kind, message: "failure", checkedAt: "now" } }).label).toBe(label);
  });
});
