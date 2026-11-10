"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import type { Connection, ProviderId } from "@/lib/types";
import { PROVIDERS } from "@/lib/provider-registry";
import { connectionStatus } from "@/lib/connection-status";

export function ConnectionBadge({ connection, checking = false }: { connection?: Connection; checking?: boolean }) {
  const state = connectionStatus(connection, checking);
  return <span className={`connection-badge ${state.tone}`}>{state.tone === "checking" ? <LoaderCircle size={14} className="spin" /> : state.tone === "connected" ? <CheckCircle2 size={14} /> : state.tone === "idle" ? <i /> : <CircleAlert size={14} />}{state.label}</span>;
}
const time = (value?: string) => value ? new Date(value).toLocaleString("ko-KR") : "미확인";
export function ProviderConnectionCard({ definition, connections, busy, checkingId, connecting, loaded, ready, onChoose, onRefresh, onUpdateKey, onOAuth, onDisconnect, onConnect }: {
  definition: typeof PROVIDERS[number]; connections: Connection[]; busy: boolean; checkingId: string; connecting: boolean; loaded: boolean; ready: boolean;
  onChoose: (connection: Connection) => void; onRefresh: (id: string) => void; onUpdateKey: (connection: Connection) => void;
  onOAuth: (connection: Connection) => void; onDisconnect: (id: string) => void; onConnect: (id: ProviderId) => void;
}) {
  const active = connections.filter((item) => item.status !== "disconnected");
  const primary = active.find((item) => !item.connectionIssue) || active[0] || connections[0];
  return <article className={`connection-setting-card ${active.length ? "has-connection" : ""}`} aria-label={`${definition.name} 연결 관리`}>
    <header><strong>{definition.name}</strong><ConnectionBadge connection={primary} checking={connecting || !!connections.find((item) => item.id === checkingId)} /></header>
    <p>{definition.description}</p>
    {connections.map((item) => <section className="provider-account" key={item.id}><h3>{item.label}<span>{item.method === "oauth" ? "OAuth" : "API 키"}</span></h3>
      <div className="account-connection-status"><ConnectionBadge connection={item} checking={checkingId === item.id} /><span>{item.status === "disconnected" ? "다시 로그인해 연결하세요." : item.credentialVerifiedAt ? `${item.method === "api-key" ? "API 키" : "인증"} 확인 완료` : "인증 정보 저장됨"}</span></div>
      {item.status !== "disconnected" && <div className="connection-evidence"><strong>{item.modelsCheckedAt ? `${item.connectionIssue ? "마지막 정상 조회 · " : ""}모델 ${item.models.length.toLocaleString()}개 조회` : "모델 목록 미조회"}</strong><span>마지막 인증 확인: {time(item.credentialVerifiedAt || item.modelsCheckedAt)}</span><span>모델 조회: {time(item.modelsCheckedAt)}</span><span>실제 실행: {item.verifiedAt ? `${time(item.verifiedAt)} 성공` : "아직 확인하지 않음"}</span>{item.modelSource === "public-catalog" && <span>공개 모델 목록 · 개별 모델 권한·잔액은 실행 시 확인</span>}</div>}
      {item.connectionIssue && <p className="account-issue" role="alert">{item.connectionIssue.message}<small>확인 시각: {time(item.connectionIssue.checkedAt)}</small></p>}
      <div className="toolbar-actions"><button className="button primary" disabled={busy || item.status === "disconnected" || item.connectionIssue?.kind === "authentication"} onClick={() => onChoose(item)}>모델 선택하기</button><button className="small-button" disabled={busy || item.status === "disconnected"} onClick={() => onRefresh(item.id)}><RefreshCw size={14} className={checkingId === item.id ? "spin" : ""} />연결 다시 확인</button>
        {item.method === "api-key" ? <button className="small-button" disabled={busy} onClick={() => onUpdateKey(item)}>API 키 갱신</button> : <button className="small-button" disabled={busy} onClick={() => onOAuth(item)}>다시 로그인</button>}
        {item.status !== "disconnected" && <button className="small-button" disabled={busy} onClick={() => onDisconnect(item.id)}>연결 해제</button>}
      </div>
    </section>)}
    <button className="button secondary" aria-label={`${definition.name} ${connections.length ? "다른 계정 추가" : "계정 연결"}`} disabled={busy || !loaded || !ready} onClick={() => onConnect(definition.id)}><Plus size={15} />{connections.length ? "다른 계정 추가" : "계정 연결"}</button>
  </article>;
}
