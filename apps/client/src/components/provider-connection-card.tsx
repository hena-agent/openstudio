"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import type { Connection, ProviderId } from "@/lib/types";
import { PROVIDERS } from "@/lib/provider-registry";
import { connectionStatus } from "@/lib/connection-status";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ActionBar, HelpText, Notice, Panel, SectionHeader } from "./studio/primitives";

export function ConnectionBadge({ connection, checking = false }: { connection?: Connection; checking?: boolean }) {
  const state = connectionStatus(connection, checking);
  return <Badge variant={state.tone === "connected" ? "success" : state.tone === "error" ? "destructive" : state.tone === "warning" ? "warning" : "outline"}>{state.tone === "checking" ? <LoaderCircle className="animate-spin" /> : state.tone === "connected" ? <CheckCircle2 /> : state.tone === "idle" ? <span className="size-1.5 rounded-full bg-current" /> : <CircleAlert />}{state.label}</Badge>;
}
const time = (value?: string) => value ? new Date(value).toLocaleString("ko-KR") : "미확인";
export function ProviderConnectionCard({ definition, connections, busy, checkingId, connecting, loaded, ready, onChoose, onRefresh, onUpdateKey, onOAuth, onDisconnect, onConnect }: {
  definition: typeof PROVIDERS[number]; connections: Connection[]; busy: boolean; checkingId: string; connecting: boolean; loaded: boolean; ready: boolean;
  onChoose: (connection: Connection) => void; onRefresh: (id: string) => void; onUpdateKey: (connection: Connection) => void;
  onOAuth: (connection: Connection) => void; onDisconnect: (id: string) => void; onConnect: (id: ProviderId) => void;
}) {
  const active = connections.filter((item) => item.status !== "disconnected");
  const primary = active.find((item) => !item.connectionIssue) || active[0] || connections[0];
  return <Panel role="article" className={active.length ? "border-emerald-400/30" : undefined} aria-label={`${definition.name} 연결 관리`}>
    <SectionHeader title={definition.name} description={definition.description} actions={<ConnectionBadge connection={primary} checking={connecting || !!connections.find((item) => item.id === checkingId)} />} />
    {connections.map((item) => <section className="grid gap-4 border-t border-border pt-6" key={item.id}>
      <div className="flex flex-wrap items-center gap-3"><h3 className="m-0 min-w-0 text-sm font-medium break-words">{item.label}</h3><Badge variant="outline">{item.method === "oauth" ? "OAuth" : "API 키"}</Badge></div>
      <div className="flex flex-wrap items-center gap-3"><ConnectionBadge connection={item} checking={checkingId === item.id} /><HelpText>{item.status === "disconnected" ? "다시 로그인해 연결하세요." : item.credentialVerifiedAt ? `${item.method === "api-key" ? "API 키" : "인증"} 확인 완료` : "인증 정보 저장됨"}</HelpText></div>
      {item.status !== "disconnected" && <div className="grid gap-2"><strong className="text-[15px] font-medium">{item.modelsCheckedAt ? `${item.connectionIssue ? "마지막 정상 조회 · " : ""}모델 ${item.models.length.toLocaleString()}개 조회` : "모델 목록 미조회"}</strong><HelpText>마지막 인증 확인: {time(item.credentialVerifiedAt || item.modelsCheckedAt)}<br />모델 조회: {time(item.modelsCheckedAt)}<br />실제 실행: {item.verifiedAt ? `${time(item.verifiedAt)} 성공` : "아직 확인하지 않음"}</HelpText>{item.modelSource === "public-catalog" && <HelpText>공개 모델 목록 · 개별 모델 권한·잔액은 실행 시 확인</HelpText>}</div>}
      {item.connectionIssue && <Notice variant="error"><span>{item.connectionIssue.message}<span className="block text-xs">확인 시각: {time(item.connectionIssue.checkedAt)}</span></span></Notice>}
      <ActionBar><Button disabled={busy || item.status === "disconnected" || item.connectionIssue?.kind === "authentication"} onClick={() => onChoose(item)}>모델 선택하기</Button><Button variant="secondary" disabled={busy || item.status === "disconnected"} onClick={() => onRefresh(item.id)}><RefreshCw className={checkingId === item.id ? "animate-spin" : undefined} />연결 다시 확인</Button></ActionBar>
      <ActionBar>{item.method === "api-key" ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUpdateKey(item)}>API 키 갱신</Button> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOAuth(item)}>다시 로그인</Button>}{item.status !== "disconnected" && <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDisconnect(item.id)}>연결 해제</Button>}</ActionBar>
    </section>)}
    <ActionBar><Button variant="outline" aria-label={`${definition.name} ${connections.length ? "다른 계정 추가" : "계정 연결"}`} disabled={busy || !loaded || !ready} onClick={() => onConnect(definition.id)}><Plus />{connections.length ? "다른 계정 추가" : "계정 연결"}</Button></ActionBar>
  </Panel>;
}
