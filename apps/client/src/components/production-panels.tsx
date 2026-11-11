"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, LoaderCircle, MessageSquare, PanelRightClose, Plus, Trash2 } from "lucide-react";
import type { Connection } from "@openstudio/shared/types";
import { modelTasks, providerName } from "@openstudio/shared/provider-registry";
import { stepKinds, precedingSteps, moveWorkflowStep, type AgentBinding, type WorkflowProject, type WorkflowStep, type WorkflowTask } from "@openstudio/shared/workflow";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ActionBar, FormField, FormSection, HelpText, IconButton, InlineAction, Notice, Panel, SectionHeader } from "./studio/primitives";
import { StatusBadge } from "./studio/status-badge";
import { Conversation } from "./ai-elements/conversation";
import { Plan } from "./ai-elements/plan";
import { PromptInput } from "./ai-elements/prompt-input";
import { ModelPicker } from "./model-picker";
import { isProductionActivity } from "@/lib/production-session-ui";

function modelLabel(binding?: AgentBinding, connections?: Connection[]) {
  if (!binding) return "모델 미지정";
  if (!binding.modelId) return "계정·모델 선택 필요";
  return connections?.find((account) => account.id === binding.connectionId)?.models.find((model) => model.id === binding.modelId)?.name || binding.modelId;
}

export function BindingFields({ label, value, connections, kind = "text", onChange, disabled = false, emptyAccountLabel }: { label: string; value?: AgentBinding; connections: Connection[]; kind?: "text" | "image" | "video" | "audio"; onChange: (value?: AgentBinding) => void; disabled?: boolean; emptyAccountLabel?: string }) {
  const accounts = connections.filter((item) => item.status !== "disconnected" && item.models.some((model) => modelTasks(model).includes(kind)));
  const account = accounts.find((item) => item.id === value?.connectionId);
  const models = account?.models.filter((model) => modelTasks(model).includes(kind)) || [];
  return <FormSection title={label} disabled={disabled}>
    <FormField label="연결 계정"><NativeSelect value={value?.connectionId || ""} onChange={(event) => onChange(event.target.value ? { connectionId: event.target.value, modelId: "" } : undefined)}><option value="">{emptyAccountLabel || (kind === "text" ? "기본값 사용 / 미지정" : "제작 계정 미지정")}</option>{accounts.map((item) => <option key={item.id} value={item.id}>{providerName(item.provider)} · {item.label}</option>)}</NativeSelect></FormField>
    <FormField label="모델"><ModelPicker models={models} value={value?.modelId || ""} connection={account} requireTools={kind === "text"} disabled={disabled || !account} placeholder={value?.modelId && !models.some((model) => model.id === value.modelId) ? `${value.modelId} · 사용 가능 여부 확인 필요` : !account ? "계정을 먼저 선택하세요" : !models.length ? "조회된 모델이 없습니다" : "모델 검색·선택"} onChange={(modelId) => onChange({ connectionId: account!.id, modelId })} /></FormField>
  </FormSection>;
}

export function ProductionSteps({ steps, project, selected, editing, connections, onSelect, onAdd, onMove }: {
  steps: WorkflowStep[]; project: WorkflowProject; selected: string; editing: boolean;
  onSelect: (id: string) => void; onAdd: () => void; onMove: (id: string, offset: number) => void;
  connections?: Connection[];
}) {
  return <Panel role="complementary" className="production-steps gap-4 p-4 sm:p-4" aria-label={editing ? "스텝 구성 목록" : "제작·검수 스텝 목록"}>
    <SectionHeader title={<>스텝 <Badge variant="outline">{steps.length}</Badge></>} actions={editing && <IconButton label="스텝 추가" disabled={steps.length >= 30} onClick={onAdd}><Plus /></IconButton>} />
    <ol className="production-step-list m-0 list-none space-y-3 p-0">{steps.map((step, index) => <li key={step.id} className="rounded-md border border-border bg-background data-[selected=true]:border-ring/60 data-[selected=true]:bg-accent/50" data-selected={selected === step.id}>
      <Button variant="ghost" className="production-step-select h-auto min-h-14 w-full items-start justify-start px-3 py-3 text-left whitespace-normal" onClick={() => onSelect(step.id)} aria-current={selected === step.id ? "step" : undefined}>
        <span className="font-mono text-xs leading-6 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1 space-y-2"><strong className="block text-sm font-medium leading-6 break-words">{step.name}</strong><span className="block text-xs font-normal leading-5 text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : " · 자동"}</span>{step.kind !== "manual" && <span className="block truncate text-xs font-normal text-muted-foreground" title={modelLabel(step.agent || project.agent, connections)}>{step.agent ? "개별" : "기본"} · {modelLabel(step.agent || project.agent, connections)}</span>}{!editing && <StatusBadge status={project.states[step.id]?.status} />}</span><ChevronRight className="mt-1 text-muted-foreground" />
      </Button>
      {editing && <ActionBar className="justify-end gap-0 px-2 pb-2"><IconButton label={`${step.name} 위로`} disabled={!index || !!moveWorkflowStep(steps, step.id, -1).reason} title={moveWorkflowStep(steps, step.id, -1).reason} onClick={() => onMove(step.id, -1)}><ArrowUp /></IconButton><IconButton label={`${step.name} 아래로`} disabled={index === steps.length - 1 || !!moveWorkflowStep(steps, step.id, 1).reason} title={moveWorkflowStep(steps, step.id, 1).reason} onClick={() => onMove(step.id, 1)}><ArrowDown /></IconButton></ActionBar>}
    </li>)}</ol>
    {editing && steps.length > 1 && <HelpText>앞선 스텝의 결과만 연결할 수 있습니다. 입력 연결을 거스르는 이동은 제한됩니다.</HelpText>}
  </Panel>;
}

export function StepSettings({ step, steps, project, connections, disabled, onChange, onDelete, onReview }: {
  step: WorkflowStep; steps: WorkflowStep[]; project: WorkflowProject; connections: Connection[]; disabled?: boolean;
  onChange: (value: Partial<WorkflowStep>) => void; onDelete: () => void; onReview: () => void;
}) {
  const previous = precedingSteps(steps, step.id);
  const invalidInputs = step.inputs.filter((id) => !previous.some((item) => item.id === id));
  const inheritedAccount = connections.find((account) => account.id === project.agent?.connectionId);
  return <>
    <SectionHeader title="스텝 설정" actions={<Button variant="ghost" size="sm" onClick={onReview}>제작으로<ChevronRight /></Button>} />
    <FormSection title="기본 설정" disabled={disabled}>
      <FormField label="스텝 이름" id="production-step-name"><Input value={step.name} maxLength={120} onChange={(event) => onChange({ name: event.target.value })} /></FormField>
      <FormField label="제작 방식"><NativeSelect value={step.kind} onChange={(event) => onChange({ kind: event.target.value as WorkflowStep["kind"], generator: undefined, ...(event.target.value === "manual" ? { agent: undefined } : {}) })}>{Object.entries(stepKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</NativeSelect></FormField>
      {step.kind === "manual" ? <HelpText>사용자 작업은 모델을 호출하지 않습니다.{step.agent && <> <InlineAction onClick={() => onChange({ agent: undefined })}>사용하지 않는 모델 지정 해제</InlineAction></>}</HelpText> : <div className="grid gap-3"><FormField label="실행 모델"><NativeSelect value={step.agent ? "custom" : "inherit"} onChange={(event) => onChange({ agent: event.target.value === "inherit" ? undefined : { connectionId: "", modelId: "" } })}><option value="inherit">프로젝트 기본 모델 사용</option><option value="custom">이 스텝에서 별도 선택</option></NativeSelect></FormField>{step.agent ? <BindingFields label="이 스텝의 실행 모델" value={step.agent} connections={connections} disabled={disabled} emptyAccountLabel="연결 계정 선택" onChange={(agent) => onChange({ agent: agent || { connectionId: "", modelId: "" } })} /> : <HelpText>프로젝트 기본값 · {inheritedAccount && `${inheritedAccount.label} · `}{modelLabel(project.agent, connections)}</HelpText>}</div>}
      <FormField label="작업 지시"><Textarea value={step.instruction} maxLength={4000} onChange={(event) => onChange({ instruction: event.target.value })} placeholder="이 스텝에서 준비할 내용과 결과의 기준을 적으세요." /></FormField>
    </FormSection>
    <FormSection title="앞 스텝의 결과 연결" disabled={disabled}>
      {previous.map((item) => <label key={item.id} className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={step.inputs.includes(item.id)} onChange={(event) => onChange({ inputs: event.target.checked ? [...step.inputs, item.id] : step.inputs.filter((id) => id !== item.id) })} /><span className="min-w-0 flex-1 break-words">{item.name}</span></label>)}
      {invalidInputs.map((id) => <Notice key={id} variant="warning">{steps.some((item) => item.id === id) ? "앞선 스텝이 아닌 연결" : "없는 입력"}: {steps.find((item) => item.id === id)?.name || id}<Button variant="ghost" size="sm" onClick={() => onChange({ inputs: step.inputs.filter((item) => item !== id) })}>연결 제거</Button></Notice>)}
      {!previous.length && <HelpText>앞선 스텝이 없습니다.</HelpText>}
    </FormSection>
    <label className="flex items-start gap-3 rounded-md border border-border bg-background p-4 text-sm leading-6"><Checkbox disabled={disabled} checked={step.review} onChange={(event) => onChange({ review: event.target.checked })} /><span className="space-y-1"><strong className="block font-medium">완료 후 사용자 검수</strong><span className="block text-xs text-muted-foreground">켜면 승인한 결과로만 다음 스텝을 진행합니다.</span></span></label>
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox disabled={disabled} checked={!!step.finalOutput} onChange={(event) => onChange({ finalOutput: event.target.checked })} /><span>최종 결과물로 표시<HelpText>별도 지정이 없으면 마지막 스텝의 결과를 출력에 모읍니다.</HelpText></span></label>
    {["image", "video", "audio"].includes(step.kind) && <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" className="group w-full justify-between">실제 제작 모델 · 선택<ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="grid gap-6 pt-4"><BindingFields disabled={disabled} label="실제 제작 모델 · 미지정 시 공통 기본값" value={step.generator || (step.kind === "image" ? project.settings?.imageModel : step.kind === "video" ? project.settings?.videoModel : project.settings?.audioModel)} connections={connections} kind={step.kind as "image" | "video" | "audio"} onChange={(generator) => onChange({ generator })} /><HelpText>제작용 참조 설정입니다. 지금 이 모델을 호출하지 않고 준비 명세만 생성합니다.</HelpText></CollapsibleContent></Collapsible>}
    <ActionBar separated className="justify-end"><Button variant="destructive" size="sm" disabled={disabled} onClick={onDelete}><Trash2 />스텝 삭제</Button></ActionBar>
  </>;
}

export function ProductionAgent({ mode, project, tasks, active, message, modelId, blockedReason, busy, dirty, canPlan, canFeedback, onMessage, onPlan, onFeedback, onNote, onApply, onNavigate, showTaskErrors = true, onClose }: {
  mode: "plan" | "review"; project: WorkflowProject; tasks: WorkflowTask[]; active?: WorkflowTask; message: string; modelId?: string; blockedReason?: string; busy: boolean; dirty: boolean; canPlan: boolean; canFeedback: boolean;
  onMessage: (value: string) => void; onPlan: () => void; onFeedback: () => void; onNote: () => void; onApply: (id: string) => void; onNavigate: (tab: "steps" | "review" | "setup") => void;
  showTaskErrors?: boolean;
  onClose?: () => void;
}) {
  const ownActive = active?.kind === (mode === "plan" ? "plan" : "step") ? active : undefined, otherActive = active && !ownActive;
  const activeStep = ownActive?.stepId ? project.steps.find((step) => step.id === ownActive.stepId) : undefined;
  const ownTasks = tasks.filter((item) => item.sessionId ? item.sessionId === project.id : item.projectId === project.id);
  const planTasks = new Set(ownTasks.filter((item) => item.kind === "plan").map((item) => item.id));
  const messages = project.logs.filter((item) => mode === "plan" ? !!item.taskId && planTasks.has(item.taskId) : !item.taskId || !planTasks.has(item.taskId)).map((item) => isProductionActivity(item, project, ownTasks) ? { ...item, kind: "activity" as const } : item);
  const lastTask = ownTasks.at(-1);
  return <Panel role="complementary" className="production-agent gap-4" aria-label={mode === "plan" ? "계획 제안 대화" : "스텝 피드백 대화"}>
    <div className="grid shrink-0 gap-1"><SectionHeader title={<><MessageSquare />{mode === "plan" ? "제작 대화" : "수정 대화"}</>} actions={<>{ownActive && <Badge variant="outline"><LoaderCircle className="animate-spin" />{ownActive.status === "queued" ? "대기" : "준비 중"}</Badge>}{onClose && <IconButton label="대화 접기" onClick={onClose}><PanelRightClose /></IconButton>}</>} />{activeStep && <HelpText className="truncate" title={activeStep.name}>{activeStep.name} · 작업 중 피드백</HelpText>}{modelId && <HelpText className="truncate" title={modelId}>{modelId}</HelpText>}</div>
    <div className="production-agent-content">
      <Conversation conversationId={`${project.id}:${mode}`} messages={messages} emptyText={mode === "plan" ? "만들고 싶은 콘텐츠나 바꾸고 싶은 내용을 적어 주세요." : "수정할 내용이나 질문에 대한 답변을 적어 주세요."}>
      {mode === "plan" && project.proposals.length > 0 && <div className="production-proposals">{project.proposals.slice(-3).reverse().map((proposal, index) => <Plan key={proposal.id} title={proposal.name} description={proposal.summary} defaultOpen={!index && proposal.basedOnRevision === project.revision} meta={<>출력 {proposal.outputs.length}개 · 기반 계획 v{proposal.basedOnRevision}</>} actions={<div className="grid gap-3"><Button variant="secondary" size="sm" disabled={dirty || busy || proposal.basedOnRevision !== project.revision} onClick={() => onApply(proposal.id)}>이 제안 적용</Button>{proposal.basedOnRevision !== project.revision && <HelpText>계획이 변경됐습니다. 현재 계획으로 다시 제안받을 수 있습니다.</HelpText>}</div>}><ol className="m-0 list-none space-y-3 p-0">{proposal.steps.map((step, position) => <li key={step.id} className="flex items-start gap-3 text-sm leading-6"><span className="font-mono text-xs leading-6 text-muted-foreground">{position + 1}</span><span>{step.name}<span className="block text-xs text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : ""}</span></span></li>)}</ol></Plan>)}</div>}
      </Conversation>
    </div>
    <div className="grid shrink-0 gap-2">
      <PromptInput inputId={`production-message-${mode}`} label={ownActive ? "실행 중 피드백" : mode === "plan" ? "계획 변경 요청" : "선택한 스텝에 피드백"} value={message} onChange={onMessage} placeholder={mode === "plan" ? "어떤 콘텐츠를 만들까요?" : "어떻게 수정할까요?"} canSubmit={ownActive ? !!message.trim() : mode === "plan" ? canPlan : canFeedback && !!message.trim()} busy={busy} onSubmit={ownActive ? onNote : mode === "plan" ? onPlan : onFeedback} actionLabel={ownActive ? "전달" : mode === "plan" ? project.steps.length ? "다시 제안" : "제안받기" : "반영해 실행"} />
      {otherActive && <HelpText>{active.kind === "plan" ? "계획 제안 중입니다." : "스텝 준비 중입니다."} <InlineAction onClick={() => onNavigate(active.kind === "plan" ? "steps" : "review")}>진행 화면으로</InlineAction></HelpText>}
      {!active && blockedReason && <HelpText>{blockedReason}{!dirty && !modelId && <> <InlineAction onClick={() => onNavigate("setup")}>모델 설정</InlineAction></>}</HelpText>}
      {showTaskErrors && lastTask && lastTask.kind === (mode === "plan" ? "plan" : "step") && ["failed", "unknown"].includes(lastTask.status) && <Notice variant="error">{lastTask.error}</Notice>}
    </div>
  </Panel>;
}
