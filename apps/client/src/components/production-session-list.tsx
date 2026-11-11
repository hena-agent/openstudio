"use client";

import { useEffect, useRef, type Ref } from "react";
import { Plus, Search } from "lucide-react";
import type { ProductionSession, WorkflowTask } from "@openstudio/shared/workflow";
import { productionSessionStatus } from "@/lib/production-session-ui";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { HelpText } from "./studio/primitives";

export function ProductionSessionList({ sessions, tasks, selected, query, disabled, canCreate, dirtySessions, searchRef, onQuery, onSelect, onCreate }: {
  sessions: ProductionSession[]; tasks: WorkflowTask[]; selected: string; query: string; disabled: boolean; canCreate: boolean; dirtySessions: Set<string>;
  onQuery: (query: string) => void; onSelect: (id: string) => void; onCreate: () => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const selectedNode = useRef<HTMLButtonElement | null>(null);
  const filtered = [...sessions].reverse().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).filter((session) => session.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { selectedNode.current?.scrollIntoView({ block: "nearest" }); }, [selected, query]);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div data-slot="session-list-heading" className="flex shrink-0 flex-wrap items-center justify-between gap-2"><h2 className="m-0 flex items-center gap-2 text-sm font-semibold">제작 세션<Badge variant="outline">{sessions.length}</Badge></h2><Button variant="secondary" size="sm" disabled={disabled || !canCreate} onClick={onCreate}><Plus />새 제작</Button></div>
    <div className="relative shrink-0"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchRef} value={query} onChange={(event) => onQuery(event.target.value)} aria-label="제작 세션 검색" placeholder="이름 검색" className="pl-9" /></div>
    <ul aria-label="제작 세션 목록" className="m-0 min-h-0 flex-1 list-none space-y-2 overflow-y-auto overscroll-contain p-0">
      {filtered.map((session) => { const state = productionSessionStatus(session, tasks), date = new Date(session.createdAt), validDate = !Number.isNaN(date.getTime()); return <li key={session.id}><button ref={session.id === selected ? selectedNode : undefined} type="button" aria-current={session.id === selected ? "true" : undefined} disabled={disabled} onClick={() => onSelect(session.id)} className={cn("grid w-full min-w-0 cursor-pointer gap-2 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", session.id === selected ? "border-primary/50 bg-accent/60" : "border-border bg-background hover:bg-secondary")}>
        <span className="flex min-w-0 items-start gap-2"><strong className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 font-medium break-words">{session.name}</strong>{dirtySessions.has(session.id) && <span className="shrink-0 text-xs text-primary">편집 중</span>}</span>
        <span className="flex flex-wrap items-center gap-2"><Badge variant={state.tone} className="px-1.5 py-0.5">{state.label}</Badge><span className="text-xs text-muted-foreground">{state.completed}/{state.total}</span><time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toLocaleString("ko-KR") : undefined} className="ml-auto text-xs text-muted-foreground">{validDate ? date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "날짜 미상"}</time></span>
      </button></li>; })}
      {!filtered.length && <li className="p-2"><HelpText role="status">{sessions.length ? "검색한 제작이 없습니다." : "아직 제작한 영상이 없습니다. 새 제작으로 시작하세요."}</HelpText></li>}
    </ul>
  </div>;
}
