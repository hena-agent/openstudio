import type { Connection } from "./types";

export function connectionStatus(connection?: Connection, checking = false) {
  if (checking) return { tone: "checking", label: "연결 확인 중" };
  if (!connection || connection.status === "disconnected") return { tone: "idle", label: connection ? "연결 해제됨" : "연결 안 됨" };
  if (connection.connectionIssue?.kind === "authentication") return { tone: "error", label: "재인증 필요" };
  if (connection.connectionIssue?.kind === "permission") return { tone: "warning", label: "권한 확인 필요" };
  if (connection.connectionIssue) return { tone: "warning", label: "재확인 실패" };
  return { tone: "connected", label: "연결됨" };
}
