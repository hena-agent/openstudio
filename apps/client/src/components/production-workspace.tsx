"use client";

import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, Pause, Play, Plus } from "lucide-react";
import type { Asset } from "@openstudio/shared/types";
import { finalResultSteps, productionComplete, readySteps, stepKinds, workflowIssues, type PreparationArtifact, type ProductionReference, type ProductionSession, type WorkflowProject, type WorkflowTask } from "@openstudio/shared/workflow";
import { studioApi } from "@/lib/client-api";
import { ProductionAgent, ProductionSteps, ResultReview } from "./production-panels";
import { ReferenceFields } from "./production-setup";
import { MessageResponse } from "./ai-elements/message";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ActionBar, EmptyState, FormField, HelpText, Notice, Panel, SectionHeader } from "./studio/primitives";
import { StatusBadge } from "./studio/status-badge";
import { AssetPreview } from "./asset-preview";

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
  const [selected, setSelected] = useState(""), [filter, setFilter] = useState("all"), [stepId, setStepId] = useState("");
  const [creating, setCreating] = useState(false), [name, setName] = useState(""), [brief, setBrief] = useState(""), [references, setReferences] = useState<ProductionReference[]>([]);
  const [startRevision, setStartRevision] = useState(project.revision);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [content, setContent] = useState(""), [fileId, setFileId] = useState(""), [versionId, setVersionId] = useState(""), [preview, setPreview] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const requestIds = useRef(new Map<string, string>()), startRequest = useRef("");
  const session = own.find((item) => item.id === selected);
  const sessionTasks = tasks.filter((item) => item.sessionId === selected);
  const operation = sessionTasks.find((item) => ["queued", "running"].includes(item.status));
  const step = session?.steps.find((item) => item.id === stepId), state = session?.states[stepId];
  const latest = session?.artifacts.find((item) => item.id === state?.artifactId), artifact = session?.artifacts.find((item) => item.id === versionId) || latest;
  const messageKey = `${selected}:${operation ? "live" : stepId}`, message = messages[messageKey] || "";
  const resultDirty = !!session && (content !== (artifact?.content || "") || fileId !== (artifact?.assetIds?.[0] || ""));
  useEffect(() => { onUnsavedChange(resultDirty); }, [resultDirty, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange]);
  useEffect(() => { setSelected((old) => own.some((item) => item.id === old) ? old : own.at(-1)?.id || ""); }, [sessions, project.id]);
  useEffect(() => { setStepId(session?.steps[0]?.id || ""); setError(""); setPreview(false); }, [selected]);
  useEffect(() => { setVersionId(latest?.id || ""); setContent(latest?.content || ""); setFileId(latest?.assetIds?.[0] || ""); setPreview(false); }, [selected, stepId, latest?.id]);
  async function action(label: string, work: () => Promise<void>) {
    if (busy) return; setBusy(label); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function post(body: object) { if (!session) return; await studioApi("workflows", { ...body, id: project.id, sessionId: session.id }); await onReload(); }
  async function run(all = false) {
    if (!session) return;
    const key = JSON.stringify({ session: session.id, step: all ? null : stepId, all, message: all ? "" : message });
    let requestId = requestIds.current.get(key); if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(key, requestId); }
    await post({ action: "run", requestId, stepId: all ? undefined : stepId, all, feedback: all ? undefined : message.trim() || undefined, consent: true });
    requestIds.current.delete(key); setMessages((old) => ({ ...old, [messageKey]: "" }));
  }
  function selectSession(id: string) { if (id !== selected && resultDirty && !window.confirm("저장하지 않은 결과 편집을 버리고 다른 제작으로 이동할까요?")) return false; setSelected(id); return true; }
  function create() { if (resultDirty && !window.confirm("저장하지 않은 결과 편집이 있습니다. 새 제작으로 이동할까요?")) return; startRequest.current = crypto.randomUUID(); setStartRevision(project.revision); setName(""); setBrief(""); setReferences(structuredClone(project.references || [])); setError(""); setCreating(true); }
  async function upload(file: File) { if (busy) throw new Error("다른 작업이 끝난 뒤 자료를 추가하세요."); setBusy("upload"); try { return await onUpload(file); } finally { setBusy(""); } }
  const binding = step?.agent || session?.agent;
  const canRun = !!session && !busy && !operation && !!binding?.modelId && step?.kind !== "manual" && !workflowIssues(session).length && !!step && step.inputs.every((id) => session.states[id]?.status === "complete") && !session.steps.some((item) => item.id !== step.id && ["review", "needs_input"].includes(session.states[item.id]?.status));
  const next = session && readySteps(session)[0];
  const canNext = !!session && !busy && !operation && !!next && next.kind !== "manual" && !!(next.agent || session.agent)?.modelId && !session.steps.some((item) => ["review", "needs_input"].includes(session.states[item.id]?.status));
  const previewDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"></head><body style="background:#141517;color:#ededf0;margin:0">${content}</body></html>`;
  return <section className="production-workspace" hidden={!active} aria-label={view === "review" ? "제작 세션" : "제작 결과물"}>
    <ActionBar className="shrink-0 justify-between">
      {view === "review" ? <div className="flex min-w-0 flex-wrap items-center gap-3"><NativeSelect aria-label="제작 세션 선택" value={selected} disabled={!!busy || !own.length} className="max-w-80" onChange={(event) => selectSession(event.target.value)}>{!own.length && <option value="">아직 제작한 영상이 없습니다</option>}{[...own].reverse().map((item) => <option key={item.id} value={item.id}>{item.name} · {progress(item)}</option>)}</NativeSelect>{session && <Badge variant="outline">시작 구성 v{session.sourceRevision}</Badge>}</div> : <><SectionHeader level={1} title="출력물" /><NativeSelect aria-label="출력물 제작 필터" value={filter} className="max-w-80" onChange={(event) => setFilter(event.target.value)}><option value="all">모든 제작</option>{[...own].reverse().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></>}
      {view === "review" && <Button disabled={templateDirty || !!busy || !project.steps.length} title={templateDirty ? "새 제작에는 저장된 구성을 사용합니다. 먼저 구성을 저장하세요." : undefined} onClick={create}><Plus />새 제작</Button>}
    </ActionBar>
    {error && !creating && <Notice variant="error">{error}</Notice>}
    {view === "review" && (session ? <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-sm"><span>{session.brief}</span><HelpText>{progress(session)} · {session.steps.length}개 스텝 · {new Date(session.createdAt).toLocaleString("ko-KR")}{session.legacy ? " · 이전 제작 이력" : ""}</HelpText></div>
      {session.sourceRevision !== project.revision && <HelpText>원본 구성은 v{project.revision}입니다. 이 제작은 시작한 v{session.sourceRevision} 구성을 유지합니다.</HelpText>}
      <div className="production-layout">
        <ProductionSteps steps={session.steps} project={session} selected={stepId} editing={false} onSelect={(id) => { if (id === stepId || !resultDirty || window.confirm("저장하지 않은 결과 편집을 버리고 다른 스텝으로 이동할까요?")) setStepId(id); }} onAdd={() => {}} onMove={() => {}} />
        <Panel role="region" aria-label="세션 스텝 제작·검수" className="production-editor">{step ? <>
          <SectionHeader title={step.name} description={`${stepKinds[step.kind]} · ${step.review ? "검수 후 진행" : "자동 진행"}`} actions={<StatusBadge status={state?.status} />} />
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">고정된 작업 지시</summary><p className="mt-3 whitespace-pre-wrap break-words">{step.instruction}</p></details>
          <ActionBar><Button disabled={!canRun} onClick={() => void action("run", () => run())}><Play />이 스텝 실행</Button><Button variant="secondary" disabled={!canNext} onClick={() => void action("all", () => run(true))}>다음부터 자동 진행</Button>{(operation || session.autoRun) && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void action("pause", async () => { await post({ action: "pause" }); })}><Pause />현재 작업 뒤 멈춤</Button>}</ActionBar>
          <HelpText>{step.kind === "manual" ? "결과를 직접 입력하거나 제작한 파일을 연결하세요." : `실행 모델: ${binding?.modelId || "미지정"}`}</HelpText>
          <ResultReview step={step} project={session} artifact={artifact} latest={latest} history={session.artifacts.filter((item) => item.stepId === stepId)} content={content} preview={preview && active} previewDocument={previewDocument} busy={!!busy} active={!!operation} dirty={false} assets={assets} fileId={fileId} onFile={(id) => { setFileId(id); if (id && !content.trim()) setContent(assets.find((item) => item.id === id)?.name || "파일 결과"); }} onContent={setContent} onVersion={(id) => { const result = session.artifacts.find((item) => item.id === id); setVersionId(id); setContent(result?.content || ""); setFileId(result?.assetIds?.[0] || ""); setPreview(false); }} onSave={() => void action("edit", async () => { await post({ action: "edit-result", revision: session.revision, stepId, content, assetIds: fileId ? [fileId] : [] }); })} onPreview={() => setPreview((old) => !old)} onApprove={() => void action("approve", async () => { await post({ action: "approve", stepId, artifactId: latest!.id }); })} />
        </> : <HelpText>스텝을 선택하세요.</HelpText>}</Panel>
        <ProductionAgent mode="review" project={session} tasks={sessionTasks} active={operation} message={message} modelId={binding?.modelId} blockedReason={!binding?.modelId && step?.kind !== "manual" ? "이 제작을 시작할 때 지정된 모델이 없습니다. 결과를 직접 입력할 수 있습니다." : undefined} busy={!!busy} dirty={false} canPlan={false} canFeedback={canRun} onMessage={(value) => setMessages((old) => ({ ...old, [messageKey]: value }))} onPlan={() => {}} onApply={() => {}} onFeedback={() => void action("feedback", () => run())} onNote={() => void action("note", async () => { await post({ action: "note", taskId: operation!.id, text: message }); setMessages((old) => ({ ...old, [messageKey]: "" })); })} onNavigate={onNavigate} />
      </div>
    </> : <Panel className="flex-1"><EmptyState title="이 구성으로 첫 영상을 제작하세요" description="새 제작을 시작하면 현재 스텝과 설정이 고정됩니다. 이후 원본 구성을 바꿔도 진행 중인 제작은 그대로 유지됩니다." actions={!project.steps.length && <Button variant="secondary" onClick={() => onNavigate("steps")}>스텝 구성하기</Button>} /></Panel>)}
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
    <Dialog open={creating} onOpenChange={(open) => { if (!busy) setCreating(open); }}><DialogContent closeDisabled={!!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>새 제작</DialogTitle><DialogDescription>저장한 구성 v{startRevision}의 스텝·공통 설정·모델을 고정해 영상 한 편의 세션을 만듭니다. 모델 호출은 스텝 실행 시 요청합니다.</DialogDescription></DialogHeader><form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void action("start", async () => { const data = await studioApi<{ session: ProductionSession }>("workflows", { action: "start-session", id: project.id, revision: startRevision, requestId: startRequest.current, name, brief, references }); await onReload(); setSelected(data.session.id); setCreating(false); onNavigate("review"); }); }}>
      <FormField label="제작 이름"><Input autoFocus required maxLength={120} disabled={!!busy} value={name} onChange={(event) => { startRequest.current = crypto.randomUUID(); setName(event.target.value); }} placeholder="예: 약속을 지키는 태도" /></FormField><FormField label="이번 영상의 목표"><Textarea required maxLength={4000} disabled={!!busy} className="min-h-24" value={brief} onChange={(event) => { startRequest.current = crypto.randomUUID(); setBrief(event.target.value); }} placeholder="이번 한 편의 주제와 전달할 메시지" /></FormField><ReferenceFields title="이번 제작 자료" value={references} assets={assets.filter((asset) => asset.kind === "image")} disabled={!!busy} onChange={(value) => { startRequest.current = crypto.randomUUID(); setReferences(value); }} onUpload={upload} />
      {error && <Notice variant="error">{error}</Notice>}<DialogFooter><Button type="submit" disabled={!!busy || !name.trim() || !brief.trim()}>{busy && <LoaderCircle className="animate-spin" />}제작 세션 만들기</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>;
}
