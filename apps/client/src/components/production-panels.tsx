"use client";

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Download, FileCode2, GitBranch, LoaderCircle, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import type { Connection } from "@openstudio/shared/types";
import { modelTasks, providerName } from "@openstudio/shared/provider-registry";
import { preparationReady, stepKinds, stepStatusNames, type AgentBinding, type PreparationArtifact, type WorkflowOutput, type WorkflowProject, type WorkflowStep, type WorkflowTask } from "@openstudio/shared/workflow";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ActionBar, EmptyState, FormField, FormSection, HelpText, IconButton, InlineAction, Notice, Panel, SectionHeader } from "./studio/primitives";
import { StatusBadge } from "./studio/status-badge";
import { Conversation } from "./ai-elements/conversation";
import { Plan } from "./ai-elements/plan";
import { PromptInput } from "./ai-elements/prompt-input";

const timestamp = (value: string) => new Date(value).toLocaleString("ko-KR");

export function BindingFields({ label, value, connections, kind = "text", onChange, disabled = false }: { label: string; value?: AgentBinding; connections: Connection[]; kind?: "text" | "image" | "video" | "audio"; onChange: (value?: AgentBinding) => void; disabled?: boolean }) {
  const accounts = connections.filter((item) => item.status !== "disconnected" && item.models.some((model) => modelTasks(model).includes(kind)));
  const account = accounts.find((item) => item.id === value?.connectionId);
  const models = account?.models.filter((model) => modelTasks(model).includes(kind) && model.callable !== false && (kind !== "text" || model.metadata?.tools !== false)) || [];
  return <FormSection title={label} disabled={disabled}>
    <FormField label="연결 계정"><NativeSelect value={value?.connectionId || ""} onChange={(event) => onChange(event.target.value ? { connectionId: event.target.value, modelId: "" } : undefined)}><option value="">{kind === "text" ? "기본값 사용 / 미지정" : "제작 계정 미지정"}</option>{accounts.map((item) => <option key={item.id} value={item.id}>{providerName(item.provider)} · {item.label}</option>)}</NativeSelect></FormField>
    <FormField label="모델"><NativeSelect value={value?.modelId || ""} disabled={!account} onChange={(event) => onChange({ connectionId: account!.id, modelId: event.target.value })}><option value="">모델 선택</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></FormField>
  </FormSection>;
}

export function UsageConsent({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>선택한 텍스트 모델의 사용량·비용을 사용해 준비 실행</span></label>;
}

export function ProductionSteps({ steps, project, selected, editing, onSelect, onAdd, onMove, onRequestPlan }: {
  steps: WorkflowStep[]; project: WorkflowProject; selected: string; editing: boolean;
  onSelect: (id: string) => void; onAdd: () => void; onMove: (id: string, offset: number) => void; onRequestPlan: () => void;
}) {
  return <Panel role="complementary" className="production-steps" aria-label={editing ? "스텝 구성 목록" : "제작·검수 스텝 목록"}>
    <SectionHeader title={<>스텝 <Badge variant="outline">{steps.length}</Badge></>} actions={editing && <IconButton label="스텝 추가" disabled={steps.length >= 30} onClick={onAdd}><Plus /></IconButton>} />
    <ol className="production-step-list m-0 list-none space-y-3 p-0">{steps.map((step, index) => <li key={step.id} className="rounded-md border border-border bg-background data-[selected=true]:border-ring/60 data-[selected=true]:bg-accent/50" data-selected={selected === step.id}>
      <Button variant="ghost" className="production-step-select h-auto min-h-14 w-full items-start justify-start px-3 py-3 text-left whitespace-normal" onClick={() => onSelect(step.id)} aria-current={selected === step.id ? "step" : undefined}>
        <span className="font-mono text-xs leading-6 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1 space-y-2"><strong className="block text-sm font-medium leading-6 break-words">{step.name}</strong><span className="block text-xs font-normal leading-5 text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : " · 자동"}</span><StatusBadge status={project.states[step.id]?.status} /></span><ChevronRight className="mt-1 text-muted-foreground" />
      </Button>
      {editing && <ActionBar className="justify-end gap-0 px-2 pb-2"><IconButton label={`${step.name} 위로`} disabled={!index} onClick={() => onMove(step.id, -1)}><ArrowUp /></IconButton><IconButton label={`${step.name} 아래로`} disabled={index === steps.length - 1} onClick={() => onMove(step.id, 1)}><ArrowDown /></IconButton></ActionBar>}
    </li>)}</ol>
    {!steps.length && <HelpText><InlineAction onClick={onRequestPlan}>계획 제안</InlineAction>을 받거나 <InlineAction onClick={onAdd}>스텝을 직접 추가</InlineAction>하세요.</HelpText>}
    {editing && <><Button variant="outline" onClick={onAdd} disabled={steps.length >= 30}><Plus />스텝 추가</Button><HelpText>목록 순서는 대기 순서입니다. 선행 조건은 입력 연결로 정합니다.</HelpText></>}
  </Panel>;
}

export function StepSettings({ step, steps, project, connections, disabled, onChange, onDelete, onReview }: {
  step: WorkflowStep; steps: WorkflowStep[]; project: WorkflowProject; connections: Connection[]; disabled?: boolean;
  onChange: (value: Partial<WorkflowStep>) => void; onDelete: () => void; onReview: () => void;
}) {
  return <>
    <SectionHeader title="스텝 설정" actions={<Button variant="ghost" size="sm" onClick={onReview}>제작·검수로<ChevronRight /></Button>} />
    <FormSection title="기본 설정" disabled={disabled}>
      <FormField label="스텝 이름" id="production-step-name"><Input value={step.name} maxLength={120} onChange={(event) => onChange({ name: event.target.value })} /></FormField>
      <FormField label="제작 방식"><NativeSelect value={step.kind} onChange={(event) => onChange({ kind: event.target.value as WorkflowStep["kind"], generator: undefined })}>{Object.entries(stepKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</NativeSelect></FormField>
      <FormField label="작업 지시"><Textarea value={step.instruction} maxLength={4000} onChange={(event) => onChange({ instruction: event.target.value })} placeholder="이 스텝에서 준비할 내용과 결과의 기준을 적으세요." /></FormField>
    </FormSection>
    <FormSection title="앞 스텝의 결과 연결" disabled={disabled}>
      {steps.filter((item) => item.id !== step.id).map((item) => <label key={item.id} className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={step.inputs.includes(item.id)} onChange={(event) => onChange({ inputs: event.target.checked ? [...step.inputs, item.id] : step.inputs.filter((id) => id !== item.id) })} /><span className="min-w-0 flex-1 break-words">{item.name}</span><StatusBadge status={project.states[item.id]?.status} /></label>)}
      {step.inputs.filter((id) => !steps.some((item) => item.id === id)).map((id) => <Notice key={id} variant="warning">없는 입력: {id}<Button variant="ghost" size="sm" onClick={() => onChange({ inputs: step.inputs.filter((item) => item !== id) })}>연결 제거</Button></Notice>)}
      {steps.length === 1 && <HelpText>다른 스텝을 추가하면 결과를 연결할 수 있습니다.</HelpText>}
    </FormSection>
    <label className="flex items-start gap-3 rounded-md border border-border bg-background p-4 text-sm leading-6"><Checkbox disabled={disabled} checked={step.review} onChange={(event) => onChange({ review: event.target.checked })} /><span className="space-y-1"><strong className="block font-medium">완료 후 사용자 검수</strong><span className="block text-xs text-muted-foreground">켜면 승인한 결과로만 다음 스텝을 진행합니다.</span></span></label>
    <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" className="group w-full justify-between">스텝별 모델 설정<ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="grid gap-6 pt-4">
      <BindingFields disabled={disabled} label="Pi 에이전트 재정의 · 미지정 시 프로젝트 기본값" value={step.agent} connections={connections} onChange={(agent) => onChange({ agent })} />
      {["image", "video", "audio"].includes(step.kind) && <><BindingFields disabled={disabled} label="이후 실제 제작에 사용할 계정·모델" value={step.generator} connections={connections} kind={step.kind as "image" | "video" | "audio"} onChange={(generator) => onChange({ generator })} /><HelpText>제작용 참조 설정입니다. 지금 이 모델을 호출하지 않고 준비 명세만 생성합니다.</HelpText></>}
    </CollapsibleContent></Collapsible>
    <ActionBar separated className="justify-end"><Button variant="destructive" size="sm" disabled={disabled} onClick={onDelete}><Trash2 />스텝 삭제</Button></ActionBar>
  </>;
}

export function ResultReview({ step, project, artifact, latest, history, content, preview, previewDocument, busy, active, dirty, onContent, onVersion, onSave, onPreview, onApprove }: {
  step: WorkflowStep; project: WorkflowProject; artifact?: PreparationArtifact; latest?: PreparationArtifact; history: PreparationArtifact[];
  content: string; preview: boolean; previewDocument: string; busy: boolean; active: boolean; dirty: boolean;
  onContent: (value: string) => void; onVersion: (id: string) => void; onSave: () => void; onPreview: () => void; onApprove: () => void;
}) {
  const state = project.states[step.id];
  return <section className="grid gap-4 border-t border-border pt-6" aria-label="결과 검수">
    <SectionHeader level={3} title="준비 결과 · 검수" actions={history.length > 0 && <NativeSelect aria-label="결과 버전" value={artifact?.id || ""} className="max-w-56 text-sm" onChange={(event) => onVersion(event.target.value)}>{[...history].reverse().map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.source === "agent" ? "에이전트" : "직접 수정"}{item.stale ? " · 갱신 필요" : item.approvedAt ? " · 승인됨" : " · 미승인"}</option>)}</NativeSelect>} />
    {state?.question && <Notice variant="warning">에이전트 질문: {state.question}</Notice>}{state?.error && <Notice variant="error">{state.error}</Notice>}
    {artifact && <HelpText>v{artifact.version} · {timestamp(artifact.createdAt)} · {artifact.approvedAt ? "승인 기록 있음" : "검수 전"}{artifact.stale ? " · 현재 계획의 갱신이 필요합니다." : ""}</HelpText>}
    <FormField label={step.kind === "code" ? "SVG / HTML 소스" : "원고·설계·사용자 입력"}><Textarea disabled={active} className={step.kind === "code" ? "min-h-80 font-mono text-sm" : "min-h-64"} value={content} maxLength={40000} onChange={(event) => onContent(event.target.value)} placeholder={step.kind === "manual" ? "사용자가 준비한 결과를 입력하세요." : "결과를 확인하거나 내용을 직접 입력·수정할 수 있습니다."} /></FormField>
    <ActionBar><Button variant="secondary" disabled={!content.trim() || dirty || busy || active} onClick={onSave}><Save />수정본 저장</Button>{step.kind === "code" && <Button variant="outline" disabled={!content.trim()} onClick={onPreview}><FileCode2 />{preview ? "미리보기 닫기" : "코드 미리보기"}</Button>}{state?.status === "review" && <Button disabled={dirty || busy || artifact?.id !== latest?.id || content !== latest?.content} onClick={onApprove}><Check />{project.autoRun ? "승인하고 다음 진행" : "결과 승인"}</Button>}</ActionBar>
    {preview && <><iframe className="min-h-72 w-full rounded-md border border-border bg-background" title="격리된 SVG HTML 준비 코드 미리보기" sandbox="allow-scripts" srcDoc={previewDocument} /><HelpText>격리된 브라우저 미리보기입니다. 외부 리소스와 상위 화면 접근을 제한하며 영상 파일은 생성하지 않습니다.</HelpText></>}
  </section>;
}

export function OutputSettings({ outputs, steps, project, dirty, busy, onChange, onDownload, onReview }: {
  outputs: WorkflowOutput[]; steps: WorkflowStep[]; project: WorkflowProject; dirty: boolean; busy: boolean;
  onChange: (outputs: WorkflowOutput[]) => void; onDownload: () => void; onReview: () => void;
}) {
  function update(id: string, values: Partial<WorkflowOutput>) { onChange(outputs.map((item) => item.id === id ? { ...item, ...values } : item)); }
  return <section className="production-outputs-page">
    <SectionHeader level={1} title="최종 출력 구성" description="공통 준비 결과를 여러 출력 명세로 연결합니다." actions={<Button variant="secondary" disabled={!steps.length || outputs.length >= 8 || busy} onClick={() => onChange([...outputs, { id: crypto.randomUUID(), name: "새 출력", sourceStepId: steps.at(-1)!.id, format: "mp4", width: 1080, height: 1920, durationSeconds: 30 }])}><Plus />출력 추가</Button>} />
    <div className="production-outputs-grid">{outputs.map((output) => <Panel role="group" aria-label={output.name} key={output.id}><FormSection title={output.name} disabled={busy}>
      <FormField label="출력 이름"><Input value={output.name} maxLength={120} onChange={(event) => update(output.id, { name: event.target.value })} /></FormField>
      <FormField label="입력 스텝"><NativeSelect value={output.sourceStepId} onChange={(event) => update(output.id, { sourceStepId: event.target.value })}><option value="">스텝 선택</option>{!steps.some((item) => item.id === output.sourceStepId) && <option value={output.sourceStepId}>입력 스텝 없음</option>}{steps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField label="형식"><NativeSelect value={output.format} onChange={(event) => update(output.id, { format: event.target.value as WorkflowOutput["format"] })}>{["mp4", "webm", "gif", "png", "srt"].map((format) => <option key={format}>{format}</option>)}</NativeSelect></FormField>{(["width", "height", "durationSeconds"] as const).map((key) => <FormField key={key} label={key === "width" ? "가로 px" : key === "height" ? "세로 px" : "길이 초"}><Input type="number" min={key === "durationSeconds" ? 1 : 16} max={key === "durationSeconds" ? 3600 : 7680} value={output[key]} onChange={(event) => update(output.id, { [key]: Number(event.target.value) })} /></FormField>)}</div>
    </FormSection><ActionBar separated><Button variant="destructive" size="sm" disabled={busy} onClick={() => onChange(outputs.filter((item) => item.id !== output.id))}><Trash2 />출력 삭제</Button></ActionBar></Panel>)}</div>
    {!outputs.length && <Panel><EmptyState className="p-0 sm:p-0" icon={<GitBranch />} title="출력 명세를 추가하세요." description="세로·가로 영상처럼 같은 준비 결과에서 여러 결과물을 구성할 수 있습니다." actions={!steps.length && <Button variant="secondary" onClick={onReview}>먼저 스텝 구성하기<ChevronRight /></Button>} /></Panel>}
    <Panel><SectionHeader level={3} title={preparationReady(project) && !dirty ? "준비 패키지를 내려받을 수 있습니다." : "스텝 준비와 검수를 마치세요."} description="원고·명세·코드를 담은 JSON을 내보냅니다. 영상 파일은 렌더링하지 않습니다." /><ActionBar><Button variant="outline" onClick={onReview}>제작·검수 확인</Button><Button disabled={dirty || !preparationReady(project) || busy} onClick={onDownload}><Download />준비 패키지</Button></ActionBar></Panel>
  </section>;
}

export function ProductionAgent({ mode, project, tasks, active, message, consent, busy, dirty, canPlan, canFeedback, onMessage, onConsent, onPlan, onFeedback, onNote, onApply, onNavigate }: {
  mode: "plan" | "review"; project: WorkflowProject; tasks: WorkflowTask[]; active?: WorkflowTask; message: string; consent: boolean; busy: boolean; dirty: boolean; canPlan: boolean; canFeedback: boolean;
  onMessage: (value: string) => void; onConsent: (value: boolean) => void; onPlan: () => void; onFeedback: () => void; onNote: () => void; onApply: (id: string) => void; onNavigate: (tab: "steps" | "review" | "setup") => void;
}) {
  const ownActive = active?.kind === (mode === "plan" ? "plan" : "step") ? active : undefined, otherActive = active && !ownActive;
  const planTasks = new Set(tasks.filter((item) => item.projectId === project.id && item.kind === "plan").map((item) => item.id));
  const messages = project.logs.filter((item) => mode === "plan" ? !!item.taskId && planTasks.has(item.taskId) : !item.taskId || !planTasks.has(item.taskId));
  const lastTask = tasks.filter((item) => item.projectId === project.id).at(-1);
  return <Panel role="complementary" className="production-agent" aria-label={mode === "plan" ? "계획 제안 대화" : "스텝 피드백 대화"}>
    <SectionHeader title={<><MessageSquare />{mode === "plan" ? "Pi 계획 제안" : "Pi 피드백"}</>} actions={ownActive && <Badge variant="outline"><LoaderCircle className="animate-spin" />{ownActive.status === "queued" ? "대기" : "준비 중"}</Badge>} />
    <div className="production-agent-content">
      {mode === "plan" && project.proposals.length > 0 && <div className="production-proposals">{project.proposals.slice(-3).reverse().map((proposal, index) => <Plan key={proposal.id} title={proposal.name} description={proposal.summary} defaultOpen={!index && proposal.basedOnRevision === project.revision} meta={<>출력 {proposal.outputs.length}개 · 기반 계획 v{proposal.basedOnRevision}</>} actions={<div className="grid gap-3"><Button variant="secondary" size="sm" disabled={dirty || busy || proposal.basedOnRevision !== project.revision} onClick={() => onApply(proposal.id)}>이 제안 적용</Button>{proposal.basedOnRevision !== project.revision && <HelpText>계획이 변경됐습니다. 현재 계획으로 다시 제안받을 수 있습니다.</HelpText>}</div>}><ol className="m-0 list-none space-y-3 p-0">{proposal.steps.map((step, position) => <li key={step.id} className="flex items-start gap-3 text-sm leading-6"><span className="font-mono text-xs leading-6 text-muted-foreground">{position + 1}</span><span>{step.name}<span className="block text-xs text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : ""}</span></span></li>)}</ol></Plan>)}</div>}
      <Conversation conversationId={`${project.id}:${mode}`} messages={messages} emptyText={mode === "plan" ? "스텝 구성 제안을 받거나 추가·삭제·연결 변경을 요청하세요. 대화는 프로젝트에 저장됩니다." : "선택한 스텝의 수정 방향이나 질문에 대한 답변을 남기세요. 대화는 프로젝트에 저장됩니다."} />
    </div>
    <div className="grid shrink-0 gap-4 border-t border-border pt-6">
      <PromptInput inputId={`production-message-${mode}`} label={ownActive ? "실행 중 피드백" : mode === "plan" ? "계획 변경 요청" : "선택한 스텝에 피드백"} value={message} onChange={onMessage} placeholder={mode === "plan" ? "스텝을 추가·삭제하거나 제작 방식을 바꿔 달라고 요청하세요." : "수정 방향이나 에이전트 질문에 대한 답변을 입력하세요."} canSubmit={ownActive ? !!message.trim() : mode === "plan" ? canPlan : canFeedback && !!message.trim()} busy={busy} onSubmit={ownActive ? onNote : mode === "plan" ? onPlan : onFeedback} actionLabel={ownActive ? "피드백 전달" : mode === "plan" ? `제작 계획 ${project.steps.length ? "다시 제안받기" : "제안받기"}` : "피드백 반영해 다시 준비"} footer={mode === "plan" && <UsageConsent checked={consent} onChange={onConsent} />} />
      {otherActive && <HelpText>{active.kind === "plan" ? "계획 제안 중입니다." : "스텝 준비 중입니다."} <InlineAction onClick={() => onNavigate(active.kind === "plan" ? "steps" : "review")}>진행 화면으로</InlineAction></HelpText>}
      {mode === "plan" ? <HelpText>목표·모델을 저장한 뒤 사용량에 동의하면 제안을 요청할 수 있습니다. <InlineAction onClick={() => onNavigate("setup")}>목표·모델 설정</InlineAction></HelpText> : <HelpText>준비 실행 영역에서 사용량 동의 후 재실행합니다. 직접 수정·승인에는 모델을 호출하지 않습니다.</HelpText>}
      {lastTask && lastTask.kind === (mode === "plan" ? "plan" : "step") && ["failed", "unknown"].includes(lastTask.status) && <Notice variant="error">{lastTask.error}</Notice>}
    </div>
  </Panel>;
}
