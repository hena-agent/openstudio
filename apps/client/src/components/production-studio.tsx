"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, GitBranch, LoaderCircle, Pause, Play, Plus, RefreshCw, Save } from "lucide-react";
import type { Connection } from "@openstudio/shared/types";
import { agentBindingSchema, readySteps, stepKinds, workflowDefinitionSchema, workflowIssues, type WorkflowProject, type WorkflowStep, type WorkflowTask } from "@openstudio/shared/workflow";
import { studioApi } from "@/lib/client-api";
import { WorkspaceTabs } from "./workspace-tabs";
import { BindingFields, OutputSettings, ProductionAgent, ProductionSteps, ResultReview, StepSettings, UsageConsent } from "./production-panels";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ActionBar, EmptyState, FormField, FormSection, HelpText, IconButton, InlineAction, Notice, Panel, SectionHeader } from "./studio/primitives";
import { EditableTitle } from "./studio/editable-title";
import { ProjectSwitcher } from "./studio/project-switcher";
import { StatusBadge } from "./studio/status-badge";

type Tab = "setup" | "steps" | "review" | "outputs";
type Definition = Pick<WorkflowProject, "name" | "brief" | "agent" | "steps" | "outputs" | "revision">;
const definitionOf = (project: WorkflowProject): Definition => structuredClone({ name: project.name, brief: project.brief, agent: project.agent, steps: project.steps, outputs: project.outputs, revision: project.revision });

export function ProductionStudio({ ready, active: visible = true, connections, onConnections }: { ready: boolean; active?: boolean; connections: Connection[]; onConnections: () => void }) {
  const [projects, setProjects] = useState<WorkflowProject[]>([]), [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [selected, setSelected] = useState(""), [stepId, setStepId] = useState("");
  const [draft, setDraft] = useState<Definition>(), [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [pollError, setPollError] = useState("");
  const [consent, setConsent] = useState(false), [planMessage, setPlanMessage] = useState(""), [feedback, setFeedback] = useState(""), [liveMessage, setLiveMessage] = useState("");
  const [content, setContent] = useState(""), [versionId, setVersionId] = useState(""), [preview, setPreview] = useState(false);
  const [creating, setCreating] = useState(false), [newName, setNewName] = useState(""), [newBrief, setNewBrief] = useState("");
  const [focusTarget, setFocusTarget] = useState<"plan" | "step" | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const project = projects.find((item) => item.id === selected);
  const step = draft?.steps.find((item) => item.id === stepId);
  const latestTask = tasks.filter((item) => item.projectId === selected).at(-1);
  const operation = latestTask && ["queued", "running"].includes(latestTask.status) ? latestTask : undefined;
  const history = project?.artifacts.filter((item) => item.stepId === stepId) || [];
  const latest = project?.artifacts.find((item) => item.id === project.states[stepId]?.artifactId);
  const artifact = project?.artifacts.find((item) => item.id === versionId) || latest;
  const state = project?.states[stepId];
  const issues = draft ? workflowIssues(draft) : [];

  const reload = useCallback(async () => {
    const data = await studioApi<{ projects: WorkflowProject[]; tasks: WorkflowTask[] }>("workflows");
    setProjects(data.projects); setTasks(data.tasks); setPollError("");
    setSelected((old) => data.projects.some((item) => item.id === old) ? old : data.projects[0]?.id || "");
  }, []);
  useEffect(() => {
    if (!ready || !visible) return;
    let stopped = false, running = false;
    const tick = async () => {
      if (running || stopped) return; running = true;
      try { await reload(); } catch (error) { if (!stopped) setPollError((error as Error).message); } finally { running = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [ready, visible, reload]);
  useEffect(() => {
    setDirty(false); setConsent(false); setPlanMessage(""); setFeedback(""); setLiveMessage(""); setError(""); setFocusTarget(null); requestIds.current.clear();
    if (project) { setDraft(definitionOf(project)); setStepId(project.steps[0]?.id || ""); }
    else { setDraft(undefined); setStepId(""); setTab("setup"); }
  }, [selected]);
  useEffect(() => {
    if (project && !dirty) { setDraft(definitionOf(project)); setStepId((old) => project.steps.some((item) => item.id === old) ? old : project.steps[0]?.id || ""); }
  }, [project?.revision, project?.id, dirty]);
  useEffect(() => { setVersionId(latest?.id || ""); setContent(latest?.content || ""); setPreview(false); }, [stepId, latest?.id]);
  useEffect(() => {
    if (!focusTarget || tab !== "steps" || !visible) return;
    const input = document.getElementById(focusTarget === "plan" ? "production-message-plan" : "production-step-name") as HTMLInputElement | HTMLTextAreaElement | null;
    if (input) { input.focus({ preventScroll: true }); input.scrollIntoView({ block: "center", inline: "nearest" }); if (focusTarget === "step") input.select(); setFocusTarget(null); }
  }, [focusTarget, tab, visible, stepId]);

  function change(update: Partial<Definition>) { setDraft((old) => old ? { ...old, ...update } : old); setDirty(true); setConsent(false); }
  function changeStep(update: Partial<WorkflowStep>) { if (step && draft) change({ steps: draft.steps.map((item) => item.id === step.id ? { ...item, ...update } : item) }); }
  async function action(name: string, work: () => Promise<void>) {
    if (busy) return; setBusy(name); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function post(body: object) {
    const input = body as Record<string, unknown>;
    if (input.action === "save") {
      if (input.agent && !agentBindingSchema.safeParse(input.agent).success) throw new Error("프로젝트 에이전트의 계정과 모델을 모두 선택하세요.");
      const checked = workflowDefinitionSchema.safeParse(input);
      if (!checked.success) throw new Error(`스텝·출력 설정을 확인하세요: ${checked.error.issues[0].path.join(" → ")} (${checked.error.issues[0].message})`);
    }
    const result = await studioApi<{ project: WorkflowProject }>("workflows", body); await reload(); return result.project;
  }
  async function save() {
    if (!project || !draft) return;
    const saved = await post({ action: "save", id: project.id, ...draft, name: project.name }); setDraft(definitionOf(saved)); setDirty(false);
  }
  async function rename(name: string, previousName: string) {
    if (!project || busy) throw new Error("다른 저장이 끝난 뒤 이름을 수정하세요.");
    const projectId = project.id; setBusy("rename");
    try {
      const result = await studioApi<{ project: WorkflowProject }>("workflows", { action: "rename", id: projectId, previousName, name });
      setProjects((old) => old.map((item) => item.id === projectId ? { ...item, name: result.project.name } : item));
      setDraft((old) => old ? { ...old, name: result.project.name } : old);
      await reload();
    } catch (error) { await reload().catch(() => {}); throw error; }
    finally { setBusy(""); }
  }
  function requestId(key: string) { let id = requestIds.current.get(key); if (!id) { id = crypto.randomUUID(); requestIds.current.set(key, id); } return id; }
  async function aiAction(kind: "plan" | "step", all = false) {
    if (!project) return;
    const message = kind === "plan" ? planMessage : all ? "" : feedback;
    const key = JSON.stringify({ kind, stepId: kind === "step" && !all ? stepId : undefined, all, feedback: message, revision: project.revision });
    await post({ action: kind === "plan" ? "plan" : "run", id: project.id, requestId: requestId(key), ...(kind === "step" ? { stepId: all ? undefined : stepId, all } : {}), feedback: message.trim() || undefined, consent: true });
    requestIds.current.delete(key); if (kind === "plan") setPlanMessage(""); else if (!all) setFeedback(""); setConsent(false);
  }
  async function sendNote() {
    if (!project || !operation) return;
    try { await post({ action: "note", id: project.id, taskId: operation.id, text: liveMessage }); setLiveMessage(""); }
    catch (error) { if (operation.kind === "plan") setPlanMessage(liveMessage); else setFeedback(liveMessage); throw error; }
  }
  function move(id: string, offset: number) {
    if (!draft) return;
    const steps = [...draft.steps], from = steps.findIndex((item) => item.id === id), to = from + offset;
    if (to < 0 || to >= steps.length) return; [steps[from], steps[to]] = [steps[to], steps[from]]; change({ steps });
  }
  function requestPlan() { setTab("steps"); setFocusTarget("plan"); }
  function addStep() {
    if (!draft) return;
    const id = crypto.randomUUID(); change({ steps: [...draft.steps, { id, name: "새 스텝", kind: "text", instruction: "", inputs: stepId && draft.steps.some((item) => item.id === stepId) ? [stepId] : [], review: true }] }); setStepId(id); setTab("steps"); setFocusTarget("step");
  }
  function createProject() { setNewName(""); setNewBrief(""); setCreating(true); }
  async function download() {
    if (!project) return;
    const manifest = await studioApi<unknown>(`workflows?manifest=${project.id}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}._-]/gu, "_")}-preparation.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const runnable = !!project && !dirty && !operation && !busy && consent;
  const binding = step?.agent || draft?.agent;
  const hasModel = !!draft?.agent?.connectionId && !!draft.agent.modelId;
  const canRunStep = runnable && !!binding?.modelId && step?.kind !== "manual" && !issues.length && !!project && !!step && step.inputs.every((id) => project.states[id]?.status === "complete");
  const canRunNext = runnable && hasModel && !!project && !!readySteps(project).length && !project.steps.some((item) => ["review", "needs_input"].includes(project.states[item.id]?.status));
  const mode = tab === "steps" ? "plan" : "review";
  const ownOperation = operation?.kind === (mode === "plan" ? "plan" : "step") ? operation : undefined;
  const agentMessage = ownOperation ? liveMessage : mode === "plan" ? planMessage : feedback;
  const previewDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;min-height:100%;background:#111;color:#eee}svg{max-width:100%;height:auto}</style></head><body>${content.replace(/^```(?:html|svg)?\s*\n([\s\S]*?)\n```\s*$/, "$1")}</body></html>`;

  return <section className="production-studio">
    <WorkspaceTabs id="production" label="제작 스튜디오 작업" tabs={[{ id: "setup", label: "목표·모델" }, { id: "steps", label: "스텝 구성", disabled: !project }, { id: "review", label: "제작·검수", disabled: !project }, { id: "outputs", label: "출력", count: draft?.outputs.length, disabled: !project }]} value={tab} onChange={(value) => setTab(value as Tab)} />
    <header className="production-toolbar">
      <ProjectSwitcher projects={projects} selected={selected} disabled={!!busy} onSelect={(id) => { if (!dirty || window.confirm("저장하지 않은 계획 편집을 버리고 이동할까요?")) setSelected(id); }} />
      {project ? <EditableTitle key={project.id} value={project.name} disabled={!!busy} onSave={rename} /> : <strong className="text-base font-semibold">제작 프로젝트</strong>}
      <Button variant="secondary" disabled={!ready || !!busy} onClick={createProject}><Plus />프로젝트</Button>
      <IconButton label="제작 상태 새로고침" size="icon" disabled={!!busy} onClick={() => void action("refresh", reload)}><RefreshCw /></IconButton>
      {project && <><Badge variant="outline">계획 v{project.revision} · {dirty ? "미저장" : "저장됨"}</Badge><Button variant="secondary" disabled={!dirty || !!busy} onClick={() => void action("save", save)}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}계획 저장</Button><Badge className="production-mode-badge" variant="outline" title="원고·명세·코드를 준비하며 영상 파일 생성과 렌더링은 실행하지 않습니다.">제작 준비 모드</Badge></>}
    </header>
    <div className="production-notices">
      {(error || pollError) && <Notice variant="error">{error || pollError}</Notice>}
      {operation && project && <Notice><LoaderCircle className="size-4 animate-spin" />{operation.kind === "plan" ? "제작 계획 제안" : project.steps.find((item) => item.id === operation.stepId)?.name || "스텝 준비"} · {operation.status === "queued" ? "실행 대기" : "Pi 실행 중"} · 기준 계획 v{operation.basedOnRevision || project.revision}<Button variant="ghost" size="sm" onClick={() => setTab(operation.kind === "plan" ? "steps" : "review")}>진행 화면으로</Button></Notice>}
      {dirty && project && <Notice variant="warning">탭을 이동해도 편집 내용은 유지됩니다. 실행·제안 전에는 계획을 저장하세요. {project.revision !== draft?.revision && "다른 화면의 변경과 저장 충돌을 확인하세요."}<Button variant="ghost" size="sm" onClick={() => { setDraft(definitionOf(project)); setDirty(false); }}>편집 취소</Button></Notice>}
      {issues.length > 0 && draft && <Notice variant="warning"><ul className="m-0 list-none space-y-1 p-0">{issues.map((issue, index) => <li key={index}>{draft.steps.find((item) => item.id === issue.stepId)?.name || draft.outputs.find((item) => item.id === issue.outputId)?.name || "계획"}: {issue.message}</li>)}</ul></Notice>}
    </div>
    <div id={`production-panel-${tab}`} role="tabpanel" aria-labelledby={`production-tab-${tab}`} className={`production-tab-panel production-tab-${tab}`}>
      {project && draft ? <>
        {tab === "setup" && <Panel role="region" className="production-setup" aria-label="목표와 기본 모델 설정">
          <SectionHeader level={1} title="목표·모델" description="제작 목표와 프로젝트 기본 에이전트를 설정합니다." />
          <div className="production-settings-grid"><FormSection title="콘텐츠 기획" disabled={!!busy}><FormField label="제작 목표" id="production-brief" description="콘텐츠·연출 방식·원하는 결과물을 함께 적어 주세요."><Textarea className="min-h-52" value={draft.brief} maxLength={4000} onChange={(event) => change({ brief: event.target.value })} placeholder="무엇을, 어떤 방식으로, 어떤 결과물로 만들지 설명하세요." /></FormField></FormSection><div className="grid content-start gap-4"><BindingFields disabled={!!busy} label="프로젝트 기본 에이전트" connections={connections} value={draft.agent} onChange={(agent) => change({ agent })} /><HelpText>연결된 계정의 도구 호출 지원 텍스트 모델을 사용합니다. 스텝별 예외는 스텝 구성에서 지정할 수 있습니다.</HelpText><div><InlineAction onClick={onConnections}>연결 계정 관리<ChevronRight /></InlineAction></div></div></div>
          <ActionBar separated className="justify-between"><HelpText className="max-w-xl flex-1">에이전트 제안과 직접 편집은 스텝 구성에서 진행합니다. 계정 없이도 수동으로 구성할 수 있습니다.</HelpText><Button disabled={!!busy} onClick={() => void action("setup-next", async () => { if (dirty) await save(); setTab("steps"); })}>{dirty ? "저장하고 스텝 구성" : "스텝 구성으로"}<ChevronRight /></Button></ActionBar>
        </Panel>}

        {(tab === "steps" || tab === "review") && <div className="production-layout">
          <ProductionSteps steps={draft.steps} project={project} selected={stepId} editing={tab === "steps"} onSelect={setStepId} onAdd={addStep} onMove={move} onRequestPlan={requestPlan} />
          <Panel key={`${tab}:${stepId}`} role="region" className="production-editor" aria-label={tab === "steps" ? "스텝 설정" : "스텝 제작·검수"}>
            {step ? tab === "steps" ? <StepSettings disabled={!!busy} step={step} steps={draft.steps} project={project} connections={connections} onChange={changeStep} onDelete={() => { change({ steps: draft.steps.filter((item) => item.id !== step.id) }); setStepId(draft.steps.find((item) => item.id !== step.id)?.id || ""); }} onReview={() => setTab("review")} /> : <>
              <SectionHeader title={step.name} description={<>{stepKinds[step.kind]} · {step.review ? "사용자 검수 후 진행" : "자동 진행"}</>} actions={<StatusBadge status={state?.status} />} />
              <div className="grid gap-4 rounded-md border border-border bg-background p-4"><UsageConsent checked={consent} onChange={setConsent} /><ActionBar><Button disabled={!canRunStep} onClick={() => void action("run-step", () => aiAction("step"))}>{operation?.stepId === step.id ? <LoaderCircle className="animate-spin" /> : <Play />}이 스텝 준비</Button><Button variant="secondary" disabled={!canRunNext} onClick={() => void action("run-all", () => aiAction("step", true))}>다음부터 자동 준비</Button>{(operation || project.autoRun) && <Button variant="ghost" size="sm" onClick={() => void action("pause", async () => { await post({ action: "pause", id: project.id }); })}><Pause />현재 작업 뒤 멈춤</Button>}</ActionBar><HelpText>{step.kind === "manual" ? "사용자 작업입니다. 아래에서 결과를 직접 입력해 저장하세요." : `실행 모델: ${binding?.modelId || "미지정"}`} <InlineAction onClick={() => setTab(binding?.modelId ? "steps" : "setup")}>설정 확인</InlineAction></HelpText></div>
              <ResultReview step={step} project={project} artifact={artifact} latest={latest} history={history} content={content} preview={preview && visible} previewDocument={previewDocument} busy={!!busy} active={!!operation} dirty={dirty} onContent={setContent} onVersion={(id) => { const result = project.artifacts.find((item) => item.id === id); setVersionId(id); setContent(result?.content || ""); setPreview(false); }} onSave={() => void action("edit-result", async () => { await post({ action: "edit-result", id: project.id, revision: project.revision, stepId: step.id, content }); })} onPreview={() => setPreview((old) => !old)} onApprove={() => void action("approve", async () => { await post({ action: "approve", id: project.id, stepId: step.id, artifactId: latest!.id }); })} />
            </> : <EmptyState className="flex-1 p-0 sm:p-0" icon={<GitBranch />} title={tab === "steps" ? "제작 과정을 구성하세요." : "스텝을 먼저 구성하세요."} description={<>에이전트에게 <InlineAction onClick={requestPlan}>계획 제안</InlineAction>을 받거나 스텝을 직접 추가하세요.</>} actions={<Button variant="secondary" onClick={addStep}><Plus />첫 스텝 추가</Button>} />}
          </Panel>
          <ProductionAgent mode={mode} project={project} tasks={tasks} active={operation} message={agentMessage} consent={consent} busy={!!busy} dirty={dirty} canPlan={runnable && hasModel && !!draft.brief.trim()} canFeedback={canRunStep} onMessage={ownOperation ? setLiveMessage : mode === "plan" ? setPlanMessage : setFeedback} onConsent={setConsent} onPlan={() => void action("plan", () => aiAction("plan"))} onFeedback={() => void action("feedback", () => aiAction("step"))} onNote={() => void action("note", sendNote)} onApply={(id) => void action("apply", async () => { const saved = await post({ action: "apply-proposal", id: project.id, revision: project.revision, proposalId: id }); setDraft(definitionOf(saved)); setDirty(false); setStepId(saved.steps[0]?.id || ""); })} onNavigate={setTab} />
        </div>}
        {tab === "outputs" && <OutputSettings outputs={draft.outputs} steps={draft.steps} project={project} dirty={dirty} busy={!!busy} onChange={(outputs) => change({ outputs })} onDownload={() => void action("manifest", download)} onReview={() => setTab(draft.steps.length ? "review" : "steps")} />}
      </> : <EmptyState className="m-4 flex-1 sm:m-6" title="제작 프로젝트" description="프로젝트를 만든 뒤 목표·모델, 스텝 구성, 제작·검수, 출력 탭에서 작업합니다." actions={<Button disabled={!ready} onClick={createProject}><Plus />프로젝트 만들기</Button>} />}
    </div>

    <Dialog open={creating} onOpenChange={(open) => { if (!busy) setCreating(open); }}><DialogContent closeDisabled={!!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle className="text-lg font-semibold">새 제작 프로젝트</DialogTitle><DialogDescription>이름과 제작 목표를 정하세요. 이름은 생성 후 제목을 클릭해 변경할 수 있습니다.</DialogDescription></DialogHeader>
      <form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void action("create", async () => { const data = await studioApi<{ project: WorkflowProject }>("workflows", { action: "create", name: newName.trim(), brief: newBrief.trim() }); await reload(); setSelected(data.project.id); setTab("setup"); setCreating(false); }); }}><FormSection title="프로젝트 정보" disabled={!!busy}><FormField label="프로젝트 이름"><Input required autoFocus value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></FormField><FormField label="제작 목표"><Textarea value={newBrief} maxLength={4000} onChange={(event) => setNewBrief(event.target.value)} placeholder="제작할 내용·연출 방식·원하는 결과물을 적으세요." /></FormField></FormSection><DialogFooter><Button type="submit" disabled={!!busy || !newName.trim()}>{busy && <LoaderCircle className="animate-spin" />}프로젝트 만들기</Button></DialogFooter></form>
    </DialogContent></Dialog>
  </section>;
}
