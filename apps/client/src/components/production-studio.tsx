"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, LoaderCircle, Plus, RefreshCw, Save } from "lucide-react";
import type { Asset, Connection } from "@openstudio/shared/types";
import { agentBindingSchema, moveWorkflowStep, productionSettingsSchema, productionComplete, finalResultSteps, workflowDefinitionSchema, workflowIssues, type ProductionPreset, type ProductionSession, type WorkflowProject, type WorkflowStep, type WorkflowTask } from "@openstudio/shared/workflow";
import { studioApi } from "@/lib/client-api";
import { WorkspaceTabs } from "./workspace-tabs";
import { ProductionAgent, ProductionSteps, StepSettings } from "./production-panels";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ActionBar, EmptyState, FormField, FormSection, HelpText, IconButton, InlineAction, Notice, Panel, SectionHeader } from "./studio/primitives";
import { EditableTitle } from "./studio/editable-title";
import { ProjectSwitcher } from "./studio/project-switcher";
import { ProductionSetup } from "./production-setup";
import { ProductionWorkspace } from "./production-workspace";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";

type Tab = "setup" | "steps" | "review" | "outputs";
type Definition = Pick<WorkflowProject, "name" | "brief" | "agent" | "steps" | "outputs" | "revision" | "settings" | "video" | "references">;
const definitionOf = (project: WorkflowProject): Definition => structuredClone({ name: project.name, brief: project.brief, agent: project.agent, steps: project.steps, outputs: project.outputs, revision: project.revision, settings: project.settings, video: project.video, references: project.references });

export function ProductionStudio({ ready, active: visible = true, connections, onConnections }: { ready: boolean; active?: boolean; connections: Connection[]; onConnections: () => void }) {
  const [projects, setProjects] = useState<WorkflowProject[]>([]), [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [sessions, setSessions] = useState<ProductionSession[]>([]);
  const [resultDirty, setResultDirty] = useState(false);
  const [presets, setPresets] = useState<ProductionPreset[]>([]), [assets, setAssets] = useState<Asset[]>([]), [loadedPreset, setLoadedPreset] = useState<ProductionPreset>();
  const [presetDialog, setPresetDialog] = useState(false), [presetName, setPresetName] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState(""), [reuseSteps, setReuseSteps] = useState(false), [newPresetId, setNewPresetId] = useState("");
  const [selected, setSelected] = useState(""), [stepId, setStepId] = useState("");
  const [draft, setDraft] = useState<Definition>(), [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [pollError, setPollError] = useState("");
  const [planMessage, setPlanMessage] = useState(""), [liveMessage, setLiveMessage] = useState("");
  const [creating, setCreating] = useState(false), [newName, setNewName] = useState(""), [newBrief, setNewBrief] = useState("");
  const [focusTarget, setFocusTarget] = useState<"plan" | "step" | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const project = projects.find((item) => item.id === selected);
  const step = draft?.steps.find((item) => item.id === stepId);
  const latestTask = tasks.filter((item) => item.projectId === selected && !item.sessionId).at(-1);
  const operation = latestTask && ["queued", "running"].includes(latestTask.status) ? latestTask : undefined;
  const issues = draft ? workflowIssues(draft) : [];

  const reload = useCallback(async () => {
    const data = await studioApi<{ projects: WorkflowProject[]; sessions: ProductionSession[]; tasks: WorkflowTask[]; presets: ProductionPreset[]; assets: Asset[] }>("workflows");
    setProjects(data.projects); setTasks(data.tasks); setSessions(data.sessions || []); setPresets(data.presets || []); setAssets(data.assets || []); setPollError("");
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
    setDirty(false); setLoadedPreset(undefined); setPlanMessage(""); setLiveMessage(""); setError(""); setFocusTarget(null); requestIds.current.clear();
    if (project) { setDraft(definitionOf(project)); setStepId(project.steps[0]?.id || ""); }
    else { setDraft(undefined); setStepId(""); setTab("setup"); }
  }, [selected]);
  useEffect(() => {
    if (project && !dirty) { setDraft(definitionOf(project)); setStepId((old) => project.steps.some((item) => item.id === old) ? old : project.steps[0]?.id || ""); }
  }, [project?.revision, project?.id, dirty]);
  useEffect(() => {
    if (!focusTarget || tab !== "steps" || !visible) return;
    const input = document.getElementById(focusTarget === "plan" ? "production-message-plan" : "production-step-name") as HTMLInputElement | HTMLTextAreaElement | null;
    if (input) { input.focus({ preventScroll: true }); input.scrollIntoView({ block: "center", inline: "nearest" }); if (focusTarget === "step") input.select(); setFocusTarget(null); }
  }, [focusTarget, tab, visible, stepId]);

  function change(update: Partial<Definition>) { setDraft((old) => old ? { ...old, ...update } : old); setDirty(true); }
  function changeStep(update: Partial<WorkflowStep>) { if (step && draft) change({ steps: draft.steps.map((item) => item.id === step.id ? { ...item, ...update } : item) }); }
  function canLeaveProject() { return !(dirty || resultDirty) || window.confirm("저장하지 않은 구성·결과·대화 초안을 버리고 다른 프로젝트로 이동할까요?"); }
  async function action(name: string, work: () => Promise<void>) {
    if (busy || name === "create" && !canLeaveProject()) return; setBusy(name); setError("");
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function post(body: object) {
    const input = body as Record<string, unknown>;
    if (input.action === "save") {
      if (input.agent && !agentBindingSchema.safeParse(input.agent).success) throw new Error("프로젝트 에이전트의 계정과 모델을 모두 선택하세요.");
      for (const item of (input.steps || []) as WorkflowStep[]) if (item.agent && !agentBindingSchema.safeParse(item.agent).success) throw new Error(`${item.name}의 실행 계정과 모델을 모두 선택하세요.`);
      const checked = workflowDefinitionSchema.safeParse(input);
      if (!checked.success) throw new Error(`스텝·출력 설정을 확인하세요: ${checked.error.issues[0].path.join(" → ")} (${checked.error.issues[0].message})`);
      if (input.settings && !productionSettingsSchema.safeParse(input.settings).success) throw new Error("제작 기본값의 모델 선택과 입력 내용을 확인하세요.");
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
  async function aiAction() {
    if (!project) return;
    const key = JSON.stringify({ feedback: planMessage, revision: project.revision });
    await post({ action: "plan", id: project.id, requestId: requestId(key), feedback: planMessage.trim() || undefined, consent: true });
    requestIds.current.delete(key); setPlanMessage("");
  }
  async function sendNote() {
    if (!project || !operation) return;
    try { await post({ action: "note", id: project.id, taskId: operation.id, text: liveMessage }); setLiveMessage(""); }
    catch (error) { setPlanMessage(liveMessage); throw error; }
  }
  function move(id: string, offset: number) {
    if (!draft) return;
    const result = moveWorkflowStep(draft.steps, id, offset);
    if (result.reason) { setError(result.reason); return; }
    setError(""); change({ steps: result.steps });
  }
  function requestPlan() { setTab("steps"); setFocusTarget("plan"); }
  function addStep() {
    if (!draft) return;
    const id = crypto.randomUUID(); change({ steps: [...draft.steps, { id, name: "새 스텝", kind: "text", instruction: "", inputs: stepId && draft.steps.some((item) => item.id === stepId) ? [stepId] : [], review: true }] }); setStepId(id); setTab("steps"); setFocusTarget("step");
  }
  function createProject(next = false) { setNewName(""); setNewBrief(""); setSourceProjectId(next && project ? project.id : ""); setReuseSteps(next && project?.scope === "single-video"); setNewPresetId(loadedPreset?.id || ""); setCreating(true); }
  function applyPreset(id: string) {
    const preset = presets.find((item) => item.id === id); setLoadedPreset(preset ? structuredClone(preset) : undefined);
    if (preset) change({ settings: structuredClone(preset.settings), agent: structuredClone(preset.agent) });
  }
  async function savePreset() {
    if (!draft) return;
    const checked = productionSettingsSchema.safeParse(draft.settings || {});
    if (!checked.success || draft.agent && !agentBindingSchema.safeParse(draft.agent).success) throw new Error("공통 제작 설정과 기본 모델 선택을 확인하세요.");
    const data = await studioApi<{ preset: ProductionPreset }>("workflows", { action: "save-preset", id: loadedPreset?.id, revision: loadedPreset?.revision, name: presetName.trim(), settings: checked.data, agent: draft.agent });
    setLoadedPreset(data.preset); await reload(); setPresetDialog(false);
  }
  async function uploadImage(file: File) {
    if (busy) throw new Error("다른 작업이 끝난 뒤 이미지를 추가하세요.");
    setBusy("upload");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "이미지를 업로드하지 못했습니다.");
      setAssets((old) => [...old.filter((item) => item.id !== data.asset.id), data.asset]); return data.asset as Asset;
    } finally { setBusy(""); }
  }
  const runnable = !!project && !dirty && !operation && !busy;
  const hasModel = !!draft?.agent?.connectionId && !!draft.agent.modelId;
  const agentMessage = operation ? liveMessage : planMessage;
  const hasPlanContext = !!(draft?.brief.trim() || draft?.settings?.brand.trim() || planMessage.trim());
  const blockedReason = dirty ? "변경한 구성을 먼저 저장하세요." : !hasModel ? "목표·모델에서 모델을 선택하세요." : !hasPlanContext ? "제작 방향이나 요청을 입력하세요." : undefined;
  const outputCount = sessions.filter((item) => item.projectId === selected && productionComplete(item)).reduce((sum, item) => sum + finalResultSteps(item).length, 0);
  const editingConfiguration = tab === "setup" || tab === "steps";

  return <section className="production-studio">
    <WorkspaceTabs id="production" label="제작 스튜디오 작업" tabs={[{ id: "setup", label: "목표·모델" }, { id: "steps", label: "스텝 구성", disabled: !project }, { id: "review", label: "제작", count: sessions.filter((item) => item.projectId === selected).length, disabled: !project }, { id: "outputs", label: "출력", count: outputCount, disabled: !project }]} value={tab} onChange={(value) => setTab(value as Tab)} />
    <header className={`production-toolbar${!editingConfiguration ? " production-toolbar-compact" : ""}`}>
      <ProjectSwitcher projects={projects} selected={selected} disabled={!!busy} onSelect={(id) => { if (id === selected || canLeaveProject()) setSelected(id); }} />
      {project ? editingConfiguration ? <EditableTitle key={project.id} value={project.name} disabled={!!busy} onSave={rename} /> : <strong className="min-w-0 flex-1 truncate text-sm font-semibold">{project.name}</strong> : <strong className="text-base font-semibold">제작 프로젝트</strong>}
      {editingConfiguration && <><Button variant="secondary" disabled={!ready || !!busy} onClick={() => createProject()}><Plus />프로젝트</Button>{project && <Button variant="outline" disabled={dirty || !!busy} onClick={() => createProject(true)}>구성 복제</Button>}</>}
      <IconButton label="제작 상태 새로고침" size={editingConfiguration ? "icon" : "icon-sm"} disabled={!!busy} onClick={() => void action("refresh", reload)}><RefreshCw /></IconButton>
      {project && <>{editingConfiguration && <><Badge variant="outline">구성 v{project.revision} · {dirty ? "미저장" : "저장됨"}</Badge><Button variant="secondary" disabled={!dirty || !!busy} onClick={() => void action("save", save)}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}구성 저장</Button></>}<Badge className={`production-mode-badge${!editingConfiguration ? " max-sm:hidden" : ""}`} variant="outline" title="원고·명세·코드를 준비하며 영상 파일 생성과 렌더링은 실행하지 않습니다.">제작 준비 모드</Badge></>}
    </header>
    <div className="production-notices">
      {(pollError || editingConfiguration && error) && <Notice variant="error">{pollError || error}</Notice>}
      {operation && project && <Notice><LoaderCircle className="size-4 animate-spin" />{operation.kind === "plan" ? "제작 계획 제안" : project.steps.find((item) => item.id === operation.stepId)?.name || "스텝 준비"} · {operation.status === "queued" ? "실행 대기" : "실행 중"} · 기준 계획 v{operation.basedOnRevision || project.revision}<Button variant="ghost" size="sm" onClick={() => setTab(operation.kind === "plan" ? "steps" : "review")}>진행 화면으로</Button></Notice>}
      {dirty && project && <Notice variant="warning">원본 구성에 미저장 변경이 있습니다. 새 제작·계획 제안 전에는 저장하세요. 기존 제작은 자체 구성을 유지합니다. {project.revision !== draft?.revision && "다른 화면의 변경과 저장 충돌을 확인하세요."}<Button variant="ghost" size="sm" onClick={() => { setDraft(definitionOf(project)); setDirty(false); }}>편집 취소</Button></Notice>}
      {(tab === "setup" || tab === "steps") && issues.length > 0 && draft && <Notice variant="warning"><ul className="m-0 list-none space-y-1 p-0">{issues.map((issue, index) => <li key={index}>{draft.steps.find((item) => item.id === issue.stepId)?.name || draft.outputs.find((item) => item.id === issue.outputId)?.name || "계획"}: {issue.message}</li>)}</ul></Notice>}
    </div>
    <div id={`production-panel-${tab}`} role="tabpanel" aria-labelledby={`production-tab-${tab}`} className={`production-tab-panel production-tab-${tab}`}>
      {project && draft ? <>
        {tab === "setup" && <Panel role="region" className="production-setup" aria-label="목표와 기본 모델 설정">
          <SectionHeader level={1} title="목표·모델" description="새 제작에 사용할 공통 기본값입니다. 시작한 제작 세션은 자체 구성을 유지합니다." />
          <ProductionSetup value={draft} connections={connections} presets={presets} loadedPreset={loadedPreset} assets={assets.filter((asset) => asset.kind === "image")} disabled={!!busy} legacy={!project.scope} onChange={change} onPreset={applyPreset} onSavePreset={() => { setError(""); setPresetName(loadedPreset?.name || ""); setPresetDialog(true); }} onUpload={uploadImage} onConnections={onConnections} />
          <ActionBar separated className="justify-between"><HelpText className="max-w-xl flex-1">저장한 설정으로 이번 영상의 스텝만 제안합니다. 공통 설정 저장은 다른 영상의 기존 설정을 변경하지 않습니다.</HelpText><Button disabled={!!busy} onClick={() => void action("setup-next", async () => { if (dirty) await save(); setTab("steps"); })}>{dirty ? "저장하고 스텝 구성" : "스텝 구성으로"}<ChevronRight /></Button></ActionBar>
        </Panel>}

        {tab === "steps" && <div className={`production-layout${!draft.steps.length ? " production-layout-empty" : ""}`}>
          {!!draft.steps.length && <ProductionSteps steps={draft.steps} project={{ ...project, agent: draft.agent, states: {} }} connections={connections} selected={stepId} editing onSelect={setStepId} onAdd={addStep} onMove={move} />}
          <Panel key={stepId} role="region" className="production-editor" aria-label="스텝 설정">
            {step ? <StepSettings disabled={!!busy} step={step} steps={draft.steps} project={{ ...project, agent: draft.agent, states: {}, settings: draft.settings }} connections={connections} onChange={changeStep} onDelete={() => { change({ steps: draft.steps.filter((item) => item.id !== step.id), outputs: draft.outputs.filter((item) => item.sourceStepId !== step.id) }); setStepId(draft.steps.find((item) => item.id !== step.id)?.id || ""); }} onReview={() => setTab("review")} /> : <EmptyState className="min-h-0 p-0 sm:p-0" title="제작 과정을 구성하세요" description="대화로 스텝을 제안받거나 직접 추가하세요. 저장한 구성은 새 제작에 사용합니다." actions={<><InlineAction onClick={requestPlan}>계획 제안<ChevronRight /></InlineAction><Button variant="outline" size="sm" onClick={addStep}><Plus />스텝 직접 추가</Button></>} />}
          </Panel>
          <ProductionAgent mode="plan" project={project} tasks={tasks.filter((item) => !item.sessionId)} active={operation} message={agentMessage} modelId={draft.agent?.modelId} blockedReason={blockedReason} busy={!!busy} dirty={dirty} canPlan={runnable && hasModel && hasPlanContext} canFeedback={false} onMessage={operation ? setLiveMessage : setPlanMessage} onPlan={() => void action("plan", aiAction)} onFeedback={() => {}} onNote={() => void action("note", sendNote)} onApply={(id) => void action("apply", async () => { const saved = await post({ action: "apply-proposal", id: project.id, revision: project.revision, proposalId: id }); setDraft(definitionOf(saved)); setDirty(false); setStepId(saved.steps[0]?.id || ""); })} onNavigate={setTab} />
        </div>}
        <ProductionWorkspace key={project.id} project={project} sessions={sessions} tasks={tasks} assets={assets} active={visible && (tab === "review" || tab === "outputs")} view={tab === "outputs" ? "outputs" : "review"} templateDirty={dirty} onReload={reload} onUpload={uploadImage} onNavigate={setTab} onUnsavedChange={setResultDirty} />
      </> : <EmptyState className="m-4 flex-1 sm:m-6" title="제작 프로젝트 만들기" description="공통 설정과 스텝을 구성한 뒤, 제작 탭에서 영상별 세션을 시작합니다." actions={<Button disabled={!ready} onClick={() => createProject()}><Plus />프로젝트 만들기</Button>} />}
    </div>

    <Dialog open={creating} onOpenChange={(open) => { if (!busy) setCreating(open); }}><DialogContent closeDisabled={!!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle className="text-lg font-semibold">{sourceProjectId ? "제작 구성 복제" : "새 제작 프로젝트"}</DialogTitle><DialogDescription>공통 설정과 스텝의 원본을 만듭니다. 영상별 실행·검수는 제작 탭의 세션에서 진행합니다.</DialogDescription></DialogHeader>
      <form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void action("create", async () => { const data = await studioApi<{ project: WorkflowProject }>("workflows", { action: "create", name: newName.trim(), brief: newBrief.trim(), ...(sourceProjectId ? { sourceProjectId, reuseSteps } : newPresetId ? { presetId: newPresetId } : {}) }); await reload(); setSelected(data.project.id); setTab("setup"); setCreating(false); }); }}><FormSection title="프로젝트 정보" disabled={!!busy}><FormField label="프로젝트 이름"><Input required autoFocus value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></FormField><FormField label="기본 제작 안내"><Textarea value={newBrief} maxLength={4000} onChange={(event) => setNewBrief(event.target.value)} placeholder="공통 제작 방향과 기준" /></FormField>{sourceProjectId ? <label className="flex items-start gap-3 text-sm"><Checkbox checked={reuseSteps} onChange={(event) => setReuseSteps(event.target.checked)} />기존 스텝 구성도 복사</label> : <FormField label="공통 제작 설정"><NativeSelect value={newPresetId} onChange={(event) => setNewPresetId(event.target.value)}><option value="">새로 설정</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</NativeSelect></FormField>}</FormSection><DialogFooter><Button type="submit" disabled={!!busy || !newName.trim()}>{busy && <LoaderCircle className="animate-spin" />}프로젝트 만들기</Button></DialogFooter></form>
    </DialogContent></Dialog>
    <Dialog open={presetDialog} onOpenChange={(open) => { if (!busy) setPresetDialog(open); }}><DialogContent closeDisabled={!!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>공통 제작 설정 저장</DialogTitle><DialogDescription>{loadedPreset ? "불러온 설정을 갱신합니다. 이미 만들어진 다른 영상에는 자동 적용하지 않습니다." : "브랜드·제작 기본값·공통 이미지·기본 에이전트를 저장합니다. 이번 영상의 목표와 개별 자료는 제외합니다."}</DialogDescription></DialogHeader><form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void action("save-preset", savePreset); }}><FormField label="설정 이름"><Input autoFocus required value={presetName} maxLength={120} disabled={!!busy} onChange={(event) => setPresetName(event.target.value)} /></FormField>{error && <Notice variant="error">{error}</Notice>}<DialogFooter>{loadedPreset && <Button variant="outline" disabled={!!busy} onClick={() => { setLoadedPreset(undefined); setPresetName(""); }}>새 설정으로 저장</Button>}<Button type="submit" disabled={!!busy || !presetName.trim()}>설정 저장</Button></DialogFooter></form></DialogContent></Dialog>
  </section>;
}
