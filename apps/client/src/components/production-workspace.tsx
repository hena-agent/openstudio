"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, ListVideo, LoaderCircle, MessageSquare, Pause, Pencil, Play } from "lucide-react";
import type { Asset } from "@openstudio/shared/types";
import { finalResultSteps, productionComplete, readySteps, stepKinds, workflowIssues, type PreparationArtifact, type ProductionReference, type ProductionSession, type WorkflowProject, type WorkflowTask } from "@openstudio/shared/workflow";
import { studioApi } from "@/lib/client-api";
import { ProductionAgent } from "./production-panels";
import { ProductionStepStrip } from "./production-step-strip";
import { ProductionResult } from "./production-result";
import { ReferenceFields } from "./production-setup";
import { MessageResponse } from "./ai-elements/message";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ActionBar, EmptyState, FormField, HelpText, Notice, Panel, SectionHeader } from "./studio/primitives";
import { StatusBadge } from "./studio/status-badge";
import { AssetPreview } from "./asset-preview";
import { ProductionSessionList } from "./production-session-list";
import { resolveResultDraft, resultDraftDirty, resultDraftFor, type ResultDraft } from "@/lib/production-session-ui";

function progress(session: ProductionSession) { return `${session.steps.filter((step) => session.states[step.id]?.status === "complete").length}/${session.steps.length} 완료`; }
function documentDownload(content: string, name: string, kind: PreparationArtifact["kind"]) {
  const extension = kind === "code" ? content.trim().startsWith("<svg") ? "svg" : "html" : "md";
  const mime = extension === "svg" ? "image/svg+xml" : extension === "html" ? "text/html" : "text/markdown";
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` })), link = document.createElement("a");
  link.href = url; link.download = `${name.replace(/[^\p{L}\p{N}._ -]/gu, "_")}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProductionWorkspace({ project, sessions, tasks, assets, active, view, templateDirty, onReload, onUpload, onNavigate, onUnsavedChange }: {
  project: WorkflowProject; sessions: ProductionSession[]; tasks: WorkflowTask[]; assets: Asset[]; active: boolean; view: "review" | "outputs"; templateDirty: boolean;
  onReload: () => Promise<void>; onUpload: (file: File) => Promise<Asset>; onNavigate: (tab: "setup" | "steps" | "review" | "outputs") => void;
  onUnsavedChange: (dirty: boolean) => void;
}) {
  const own = sessions.filter((item) => item.projectId === project.id);
  const [selected, setSelected] = useState(""), [filter, setFilter] = useState("all"), [stepSelections, setStepSelections] = useState<Record<string, string>>({});
  const [sessionQuery, setSessionQuery] = useState(""), [sessionsOpen, setSessionsOpen] = useState(false);
  const [creating, setCreating] = useState(false), [name, setName] = useState(""), [brief, setBrief] = useState(""), [references, setReferences] = useState<ProductionReference[]>([]);
  const [startRevision, setStartRevision] = useState(project.revision);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ResultDraft>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [chatOpen, setChatOpen] = useState(true), [runOptions, setRunOptions] = useState(false);
  const chatToggle = useRef<HTMLButtonElement>(null), focusChat = useRef(false);
  const requestIds = useRef(new Map<string, string>()), startRequest = useRef("");
  const sessionSearch = useRef<HTMLInputElement>(null), sessionToggle = useRef<HTMLButtonElement>(null), sessionHeading = useRef<HTMLHeadingElement>(null), sessionSidebar = useRef<HTMLDivElement>(null), createdSession = useRef(false);
  const creationTrigger = useRef<HTMLElement | null>(null);
  const session = own.find((item) => item.id === selected);
  const stepId = session?.steps.some((item) => item.id === stepSelections[selected]) ? stepSelections[selected] : session?.steps.find((item) => session.states[item.id]?.status !== "complete")?.id || session?.steps[0]?.id || "";
  const sessionTasks = tasks.filter((item) => item.sessionId === selected);
  const operation = sessionTasks.find((item) => ["queued", "running"].includes(item.status));
  const step = session?.steps.find((item) => item.id === stepId), state = session?.states[stepId];
  const latest = session?.artifacts.find((item) => item.id === state?.artifactId), draftKey = `${selected}:${stepId}`;
  const draft = resolveResultDraft(drafts[draftKey], latest), { content, fileId } = draft;
  const artifact = session?.artifacts.find((item) => item.id === draft.versionId) || latest;
  const messageKey = `${selected}:${operation ? "live" : stepId}`, message = messages[messageKey] || "";
  const dirtySessions = new Set(Object.entries(drafts).filter(([key, value]) => {
    const [sessionId, stepId] = key.split(":"), owner = own.find((item) => item.id === sessionId);
    const current = owner?.artifacts.find((item) => item.id === owner.states[stepId]?.artifactId);
    return resultDraftDirty(resolveResultDraft(value, current));
  }).map(([key]) => key.split(":")[0]));
  for (const [key, value] of Object.entries(messages)) if (value.trim()) dirtySessions.add(key.split(":")[0]);
  const anyDirty = dirtySessions.size > 0;
  useEffect(() => { onUnsavedChange(anyDirty); }, [anyDirty, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange]);
  useEffect(() => { setSelected((old) => own.some((item) => item.id === old) ? old : own.at(-1)?.id || ""); }, [sessions, project.id]);
  useEffect(() => { if (window.matchMedia("(max-width: 899px)").matches) setChatOpen(false); }, []);
  useEffect(() => { if (chatOpen && focusChat.current) { const input = document.getElementById("production-message-review"); input?.focus(); input?.scrollIntoView({ block: "nearest" }); focusChat.current = false; } }, [chatOpen]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 80rem)");
    const close = () => { if (media.matches) setSessionsOpen(false); };
    media.addEventListener("change", close); return () => media.removeEventListener("change", close);
  }, []);
  function changeDraft(update: Partial<ResultDraft>) { setDrafts((old) => ({ ...old, [draftKey]: { ...resolveResultDraft(old[draftKey], latest), ...update } })); }
  async function saveResult() {
    if (!session) return;
    const submitted = draft, key = draftKey;
    await post({ action: "edit-result", revision: session.revision, stepId, content: submitted.content, assetIds: submitted.fileId ? [submitted.fileId] : [] });
    setDrafts((old) => { if (old[key] && old[key] !== submitted) return old; const next = { ...old }; delete next[key]; return next; });
  }
  async function action(label: string, work: () => Promise<void>) {
    if (busy) return; setBusy(label); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function post(body: object) { if (!session) return; await studioApi("workflows", { ...body, id: project.id, sessionId: session.id }); await onReload(); }
  async function run(all = false, includeFeedback = false) {
    if (!session) return;
    const feedback = !all && includeFeedback ? message.trim() : "";
    const key = JSON.stringify({ session: session.id, step: all ? null : stepId, all, feedback });
    let requestId = requestIds.current.get(key); if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(key, requestId); }
    await post({ action: "run", requestId, stepId: all ? undefined : stepId, all, feedback: feedback || undefined, consent: true });
    requestIds.current.delete(key); if (includeFeedback) setMessages((old) => ({ ...old, [messageKey]: "" }));
  }
  function selectSession(id: string) { if (busy) return false; setSelected(id); setSessionsOpen(false); setError(""); return true; }
  function create() { creationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; createdSession.current = false; startRequest.current = crypto.randomUUID(); setStartRevision(project.revision); setName(""); setBrief(""); setReferences(structuredClone(project.references || [])); setError(""); setSessionsOpen(false); setCreating(true); }
  async function upload(file: File) { if (busy) throw new Error("다른 작업이 끝난 뒤 자료를 추가하세요."); setBusy("upload"); try { return await onUpload(file); } finally { setBusy(""); } }
  function sessionNavigationTarget() {
    if (sessionToggle.current?.getClientRects().length) return sessionToggle.current;
    return sessionSidebar.current?.getClientRects().length ? sessionSidebar.current.querySelector<HTMLElement>("[aria-current=true]") || sessionSidebar.current.querySelector<HTMLInputElement>("input") : null;
  }
  const binding = step?.agent || session?.agent;
  const chatBinding = operation ? session?.steps.find((item) => item.id === operation.stepId)?.agent || session?.agent : binding;
  const canRun = !!session && !busy && !operation && !!binding?.modelId && step?.kind !== "manual" && !workflowIssues(session).length && !!step && step.inputs.every((id) => session.states[id]?.status === "complete") && !session.steps.some((item) => item.id !== step.id && ["review", "needs_input"].includes(session.states[item.id]?.status));
  const next = session && readySteps(session)[0];
  const canNext = !!session && !busy && !operation && !!next && next.kind !== "manual" && !!(next.agent || session.agent)?.modelId && !session.steps.some((item) => ["review", "needs_input"].includes(session.states[item.id]?.status));
  const canCreate = !templateDirty && project.steps.length > 0;
  const stepTask = sessionTasks.filter((item) => item.stepId === stepId).at(-1);
  const stepFailure = state?.error || (state?.status === "failed" ? stepTask?.error : undefined);
  const runReason = operation ? `${session?.steps.find((item) => item.id === operation.stepId)?.name || "다른 스텝"} 작업이 진행 중입니다.` : !binding?.modelId && step?.kind !== "manual" ? "시작할 때 지정한 실행 모델이 없습니다. 결과를 직접 입력할 수 있습니다." : step && session && !step.inputs.every((id) => session.states[id]?.status === "complete") ? "앞선 스텝의 결과를 먼저 준비·승인하세요." : session?.steps.some((item) => item.id !== stepId && ["review", "needs_input"].includes(session.states[item.id]?.status)) ? "대기 중인 다른 스텝의 검수·질문을 먼저 처리하세요." : undefined;
  function closeChat() { setChatOpen(false); chatToggle.current?.focus({ preventScroll: true }); }
  const sessionList = (mobile = false) => <ProductionSessionList sessions={own} tasks={tasks} selected={selected} query={sessionQuery} disabled={!!busy} canCreate={canCreate} dirtySessions={dirtySessions} searchRef={mobile ? sessionSearch : undefined} onQuery={setSessionQuery} onSelect={selectSession} onCreate={create} />;
  const previewDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{width:100%;height:100%;margin:0;background:#141517;color:#ededf0}body>svg{display:block;max-width:100%;max-height:100%;margin:auto}</style></head><body>${content}</body></html>`;
  return <section className="production-workspace" hidden={!active} aria-label={view === "review" ? "제작 세션" : "제작 결과물"}>
    {view === "outputs" && <ActionBar className="shrink-0 justify-between"><SectionHeader level={1} title="출력물" /><NativeSelect aria-label="출력물 제작 필터" value={filter} className="max-w-80" onChange={(event) => setFilter(event.target.value)}><option value="all">모든 제작</option>{[...own].reverse().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></ActionBar>}
    {view === "outputs" && error && !creating && <Notice variant="error">{error}</Notice>}
    {view === "review" && <div className="production-session-shell">
      <Panel ref={sessionSidebar} role="complementary" aria-label="제작 세션 탐색" className="production-session-sidebar hidden gap-3 p-3 sm:p-3 xl:flex">{sessionList()}</Panel>
      <section className="production-session-detail" aria-label="선택한 제작">
      <ActionBar className="shrink-0 justify-between"><Button ref={sessionToggle} variant="outline" className="production-session-toggle xl:hidden" disabled={!!busy} aria-haspopup="dialog" aria-expanded={sessionsOpen} onClick={() => setSessionsOpen(true)}><ListVideo />제작 목록<Badge variant="outline">{own.length}</Badge></Button>{session && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><h1 ref={sessionHeading} tabIndex={-1} className="m-0 line-clamp-2 min-w-0 text-lg font-semibold break-words outline-none" title={session.name}>{session.name}</h1><Badge variant="outline">{progress(session)}</Badge></div>}{session && <Button ref={chatToggle} variant="ghost" size="sm" aria-expanded={chatOpen} onClick={() => { if (chatOpen) closeChat(); else { focusChat.current = true; setChatOpen(true); } }}><MessageSquare />{chatOpen ? "대화 접기" : "대화 열기"}</Button>}</ActionBar>
      {session ? <>
       <details className="production-session-info text-sm"><summary className="flex min-w-0 cursor-pointer items-center gap-2 text-muted-foreground"><ChevronDown className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{session.brief}</span><span className="shrink-0 text-xs">제작 정보</span></summary><div className="grid gap-2 pt-3"><p className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{session.brief}</p><HelpText>시작 구성 v{session.sourceRevision} · 원본 v{project.revision} · {session.steps.length}개 스텝 · {new Date(session.createdAt).toLocaleString("ko-KR")}{session.legacy ? " · 이전 제작 이력" : ""}</HelpText><div><Button variant="ghost" size="sm" onClick={() => onNavigate("steps")}>원본 구성 보기</Button></div></div></details>
       <ProductionStepStrip session={session} selected={stepId} disabled={!!busy} onSelect={(id) => { setError(""); setRunOptions(false); setStepSelections((old) => ({ ...old, [selected]: id })); }} />
       <div className="production-task-layout" data-chat-open={chatOpen}>
         <Panel role="region" aria-label="세션 스텝 제작·검수" className="production-task gap-0 p-0 sm:p-0">{step ? <>
           <div className="production-task-header"><SectionHeader title={step.name} description={stepKinds[step.kind]} actions={<StatusBadge status={state?.status} />} />
             <ActionBar className="justify-between"><ActionBar className="gap-2">{step.kind === "manual" ? !content.trim() && !fileId && <Button disabled={!!busy || !!operation} onClick={() => changeDraft({ editing: true, source: false })}><Pencil />결과 입력</Button> : <Button disabled={!canRun} title={runReason} onClick={() => void action("run", () => run())}>{busy === "run" ? <LoaderCircle className="animate-spin" /> : <Play />}{state?.status === "failed" || latest ? "다시 실행" : operation?.stepId === stepId ? "실행 중" : "실행"}</Button>}
               <Popover open={runOptions} onOpenChange={setRunOptions}><PopoverTrigger asChild><Button variant="outline" size="sm">실행 옵션<ChevronDown /></Button></PopoverTrigger><PopoverContent className="grid w-72 gap-3"><Button variant="secondary" disabled={!canNext} onClick={() => { setRunOptions(false); void action("all", () => run(true)); }}>다음부터 자동 진행</Button>{!canNext && <HelpText>{runReason || "자동 진행할 준비된 스텝이 없습니다."}</HelpText>}{(operation || session.autoRun) && <Button variant="ghost" disabled={!!busy} onClick={() => { setRunOptions(false); void action("pause", async () => { await post({ action: "pause" }); }); }}><Pause />현재 작업 뒤 멈춤</Button>}</PopoverContent></Popover>
             </ActionBar><details className="production-execution-info text-sm"><summary className="cursor-pointer text-muted-foreground">실행 정보</summary><div className="grid gap-3 pt-3"><HelpText>실행 모델: {binding?.modelId || "지정 없음"} · 시작 구성 v{session.sourceRevision}</HelpText><p className="m-0 whitespace-pre-wrap break-words">{step.instruction || "별도 작업 지시가 없습니다."}</p></div></details></ActionBar>
             {runReason && !stepFailure && !operation && <HelpText>{runReason}</HelpText>}
           </div>
           {(error || stepFailure || state?.question || draft.baseArtifactId !== (latest?.id || "") && resultDraftDirty(draft)) && <div className="production-task-notices">{(error || stepFailure) && <Notice variant="error">{error || stepFailure}</Notice>}{state?.question && <Notice variant="warning">{state.question}</Notice>}{draft.baseArtifactId !== (latest?.id || "") && resultDraftDirty(draft) && <Notice>새 결과가 도착했습니다. 작성 중인 초안을 유지합니다.<Button variant="ghost" size="sm" onClick={() => { if (window.confirm("초안 대신 최신 결과를 불러올까요?")) changeDraft(resultDraftFor(latest)); }}>최신 결과 불러오기</Button></Notice>}</div>}
           <ProductionResult step={step} artifact={artifact} latest={latest} history={session.artifacts.filter((item) => item.stepId === stepId)} assets={assets} content={content} fileId={fileId} editing={!!draft.editing} source={!!draft.source} dirty={resultDraftDirty(draft)} active={!!operation} busy={!!busy} visible={active} review={state?.status === "review"} autoRun={session.autoRun} previewDocument={previewDocument} onMode={(editing, source) => changeDraft({ editing, source })} onContent={(content) => changeDraft({ content })} onFile={(id) => changeDraft({ fileId: id, ...(!content.trim() && id ? { content: assets.find((item) => item.id === id)?.name || "파일 결과" } : {}) })} onVersion={(id) => { if (!resultDraftDirty(draft) || window.confirm("초안 대신 선택한 버전을 불러올까요?")) changeDraft(resultDraftFor(session.artifacts.find((item) => item.id === id), latest?.id || "")); }} onSave={() => void action("edit", saveResult)} onApprove={() => void action("approve", async () => { await post({ action: "approve", stepId, artifactId: latest!.id }); })} />
         </> : <HelpText className="p-6">스텝을 선택하세요.</HelpText>}</Panel>
         <div className="production-chat-pane" hidden={!chatOpen} onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); closeChat(); } }}><ProductionAgent mode="review" project={session} tasks={sessionTasks} active={operation} message={message} modelId={chatBinding?.modelId} showTaskErrors={false} onClose={closeChat} blockedReason={!binding?.modelId && step?.kind !== "manual" ? "지정된 실행 모델이 없습니다." : undefined} busy={!!busy} dirty={false} canPlan={false} canFeedback={canRun} onMessage={(value) => setMessages((old) => ({ ...old, [messageKey]: value }))} onPlan={() => {}} onApply={() => {}} onFeedback={() => void action("feedback", () => run(false, true))} onNote={() => void action("note", async () => { await post({ action: "note", taskId: operation!.id, text: message }); setMessages((old) => ({ ...old, [messageKey]: "" })); })} onNavigate={onNavigate} /></div>
       </div>
    </> : <Panel className="flex-1"><EmptyState title="이 구성으로 첫 영상을 제작하세요" description="제작 목록에서 새 제작을 시작하세요. 시작한 스텝·설정·모델은 세션별로 고정됩니다." actions={!project.steps.length && <Button variant="secondary" onClick={() => onNavigate("steps")}>스텝 구성하기</Button>} /></Panel>}
      </section>
    </div>}
    {view === "outputs" && <div className="production-result-list">{!own.length && <EmptyState title="아직 출력물이 없습니다" description="제작 세션의 스텝 실행과 검수를 마치면 최종 결과가 여기에 모입니다." actions={<Button variant="secondary" onClick={() => onNavigate("review")}>제작으로 이동</Button>} />}{[...own].reverse().filter((item) => filter === "all" || item.id === filter).map((item) => <Panel key={item.id}>
      <SectionHeader title={item.name} description={`시작 구성 v${item.sourceRevision} · ${new Date(item.createdAt).toLocaleString("ko-KR")}`} actions={<Badge variant={productionComplete(item) ? "success" : "outline"}>{progress(item)}</Badge>} />
      {!productionComplete(item) ? <div className="flex flex-wrap items-center justify-between gap-3"><HelpText>{item.steps.filter((step) => item.states[step.id]?.status !== "complete").map((step) => `${step.name} (${item.states[step.id]?.status === "review" ? "검수 대기" : item.states[step.id]?.status === "running" ? "진행 중" : "대기"})`).join(" · ")}</HelpText><Button variant="secondary" size="sm" onClick={() => { if (selectSession(item.id)) onNavigate("review"); }}>제작 이어가기</Button></div> : <div className="production-outputs-grid">{finalResultSteps(item).map((finalStep) => {
        const result = item.artifacts.find((artifact) => artifact.id === item.states[finalStep.id]?.artifactId && artifact.approvedAt && !artifact.stale);
        if (!result) return <HelpText key={finalStep.id}>{finalStep.name}의 승인한 결과를 찾을 수 없습니다.</HelpText>;
        const files = (result.assetIds || []).map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => !!asset);
        return <section key={finalStep.id} className="grid min-w-0 content-start gap-3 rounded-md border border-border p-4"><SectionHeader level={3} title={finalStep.name} actions={<Badge variant="outline">{files.length ? "파일" : result.kind === "code" ? "코드" : "문서"} · v{result.version}</Badge>} />
          {files.map((file) => <div key={file.id} className="grid min-w-0 gap-3"><AssetPreview asset={file} /><Button variant="secondary" asChild><a href={`/api/assets?id=${file.id}&download=1`}><Download />{file.name}</a></Button></div>)}
          {!files.length && <><div className="max-h-80 overflow-auto">{result.kind === "code" ? <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm">{result.content}</pre> : <MessageResponse>{result.content}</MessageResponse>}</div><ActionBar><Button variant="secondary" disabled={!!busy} onClick={() => void action("download", async () => { const data = await studioApi<{ artifact: PreparationArtifact }>(`workflows?session=${item.id}&artifact=${result.id}`); documentDownload(data.artifact.content, `${item.name}-${finalStep.name}`, data.artifact.kind); })}><Download />{result.kind === "code" ? "소스 다운로드" : "문서 다운로드"}</Button></ActionBar></>}
        </section>;
      })}</div>}
    </Panel>)}</div>}
    <Dialog open={sessionsOpen && active && view === "review"} onOpenChange={setSessionsOpen}><DialogContent className="flex h-[min(720px,90dvh)] max-w-sm flex-col gap-0 overflow-hidden p-4 [&_[data-slot=session-list-heading]]:pr-10" onOpenAutoFocus={(event) => { event.preventDefault(); sessionSearch.current?.focus(); }} onCloseAutoFocus={(event) => { if (creating) { event.preventDefault(); return; } const target = sessionNavigationTarget(); if (target) { event.preventDefault(); target.focus({ preventScroll: true }); } }}><DialogTitle className="sr-only">제작 세션 선택</DialogTitle><DialogDescription className="sr-only">제작을 선택하면 해당 세션의 스텝과 결과가 표시됩니다.</DialogDescription>{sessionList(true)}</DialogContent></Dialog>
    <Dialog open={creating} onOpenChange={(open) => { if (!busy) setCreating(open); }}><DialogContent closeDisabled={!!busy} onCloseAutoFocus={(event) => { const target = createdSession.current ? sessionHeading.current : creationTrigger.current?.getClientRects().length ? creationTrigger.current : sessionNavigationTarget(); if (target?.getClientRects().length) { event.preventDefault(); target.focus({ preventScroll: true }); } }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>새 제작</DialogTitle><DialogDescription>저장한 구성 v{startRevision}의 스텝·공통 설정·모델을 고정해 영상 한 편의 세션을 만듭니다. 모델 호출은 스텝 실행 시 요청합니다.</DialogDescription></DialogHeader><form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void action("start", async () => { const data = await studioApi<{ session: ProductionSession }>("workflows", { action: "start-session", id: project.id, revision: startRevision, requestId: startRequest.current, name, brief, references }); await onReload(); createdSession.current = true; setSelected(data.session.id); setSessionQuery(""); setCreating(false); onNavigate("review"); }); }}>
      <FormField label="제작 이름"><Input autoFocus required maxLength={120} disabled={!!busy} value={name} onChange={(event) => { startRequest.current = crypto.randomUUID(); setName(event.target.value); }} placeholder="예: 약속을 지키는 태도" /></FormField><FormField label="이번 영상의 목표"><Textarea required maxLength={4000} disabled={!!busy} className="min-h-24" value={brief} onChange={(event) => { startRequest.current = crypto.randomUUID(); setBrief(event.target.value); }} placeholder="이번 한 편의 주제와 전달할 메시지" /></FormField><ReferenceFields title="이번 제작 자료" value={references} assets={assets.filter((asset) => asset.kind === "image")} disabled={!!busy} onChange={(value) => { startRequest.current = crypto.randomUUID(); setReferences(value); }} onUpload={upload} />
      {error && <Notice variant="error">{error}</Notice>}<DialogFooter><Button type="submit" disabled={!!busy || !name.trim() || !brief.trim()}>{busy && <LoaderCircle className="animate-spin" />}제작 세션 만들기</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>;
}
