"use client";

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FileCode2, LoaderCircle, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import type { Connection } from "@openstudio/shared/types";
import { modelTasks, providerName } from "@openstudio/shared/provider-registry";
import { stepKinds, type AgentBinding, type PreparationArtifact, type WorkflowProject, type WorkflowStep, type WorkflowTask } from "@openstudio/shared/workflow";
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
import { AssetPreview } from "./asset-preview";

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

export function ProductionSteps({ steps, project, selected, editing, onSelect, onAdd, onMove }: {
  steps: WorkflowStep[]; project: WorkflowProject; selected: string; editing: boolean;
  onSelect: (id: string) => void; onAdd: () => void; onMove: (id: string, offset: number) => void;
}) {
  return <Panel role="complementary" className="production-steps gap-4 p-4 sm:p-4" aria-label={editing ? "스텝 구성 목록" : "제작·검수 스텝 목록"}>
    <SectionHeader title={<>스텝 <Badge variant="outline">{steps.length}</Badge></>} actions={editing && <IconButton label="스텝 추가" disabled={steps.length >= 30} onClick={onAdd}><Plus /></IconButton>} />
    <ol className="production-step-list m-0 list-none space-y-3 p-0">{steps.map((step, index) => <li key={step.id} className="rounded-md border border-border bg-background data-[selected=true]:border-ring/60 data-[selected=true]:bg-accent/50" data-selected={selected === step.id}>
      <Button variant="ghost" className="production-step-select h-auto min-h-14 w-full items-start justify-start px-3 py-3 text-left whitespace-normal" onClick={() => onSelect(step.id)} aria-current={selected === step.id ? "step" : undefined}>
        <span className="font-mono text-xs leading-6 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1 space-y-2"><strong className="block text-sm font-medium leading-6 break-words">{step.name}</strong><span className="block text-xs font-normal leading-5 text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : " · 자동"}</span><StatusBadge status={project.states[step.id]?.status} /></span><ChevronRight className="mt-1 text-muted-foreground" />
      </Button>
      {editing && <ActionBar className="justify-end gap-0 px-2 pb-2"><IconButton label={`${step.name} 위로`} disabled={!index} onClick={() => onMove(step.id, -1)}><ArrowUp /></IconButton><IconButton label={`${step.name} 아래로`} disabled={index === steps.length - 1} onClick={() => onMove(step.id, 1)}><ArrowDown /></IconButton></ActionBar>}
    </li>)}</ol>
    {editing && steps.length > 1 && <HelpText>입력 연결에 따라 순서대로 진행합니다.</HelpText>}
  </Panel>;
}

export function StepSettings({ step, steps, project, connections, disabled, onChange, onDelete, onReview }: {
  step: WorkflowStep; steps: WorkflowStep[]; project: WorkflowProject; connections: Connection[]; disabled?: boolean;
  onChange: (value: Partial<WorkflowStep>) => void; onDelete: () => void; onReview: () => void;
}) {
  return <>
    <SectionHeader title="스텝 설정" actions={<Button variant="ghost" size="sm" onClick={onReview}>제작으로<ChevronRight /></Button>} />
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
    <label className="flex items-start gap-3 text-sm leading-6"><Checkbox disabled={disabled} checked={!!step.finalOutput} onChange={(event) => onChange({ finalOutput: event.target.checked })} /><span>최종 결과물로 표시<HelpText>별도 지정이 없으면 마지막 스텝의 결과를 출력에 모읍니다.</HelpText></span></label>
    <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" className="group w-full justify-between">스텝별 모델 설정<ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="grid gap-6 pt-4">
      <BindingFields disabled={disabled} label="스텝 에이전트 · 미지정 시 프로젝트 기본값" value={step.agent} connections={connections} onChange={(agent) => onChange({ agent })} />
      {["image", "video", "audio"].includes(step.kind) && <><BindingFields disabled={disabled} label="실제 제작 모델 · 미지정 시 공통 기본값" value={step.generator || (step.kind === "image" ? project.settings?.imageModel : step.kind === "video" ? project.settings?.videoModel : project.settings?.audioModel)} connections={connections} kind={step.kind as "image" | "video" | "audio"} onChange={(generator) => onChange({ generator })} /><HelpText>제작용 참조 설정입니다. 지금 이 모델을 호출하지 않고 준비 명세만 생성합니다.</HelpText></>}
    </CollapsibleContent></Collapsible>
    <ActionBar separated className="justify-end"><Button variant="destructive" size="sm" disabled={disabled} onClick={onDelete}><Trash2 />스텝 삭제</Button></ActionBar>
  </>;
}

export function ResultReview({ step, project, artifact, latest, history, content, preview, previewDocument, busy, active, dirty, assets, fileId, onFile, onContent, onVersion, onSave, onPreview, onApprove }: {
  step: WorkflowStep; project: WorkflowProject; artifact?: PreparationArtifact; latest?: PreparationArtifact; history: PreparationArtifact[];
  content: string; preview: boolean; previewDocument: string; busy: boolean; active: boolean; dirty: boolean;
  onContent: (value: string) => void; onVersion: (id: string) => void; onSave: () => void; onPreview: () => void; onApprove: () => void;
  assets?: import("@openstudio/shared/types").Asset[]; fileId?: string; onFile?: (id: string) => void;
}) {
  const state = project.states[step.id];
  return <section className="grid gap-4 border-t border-border pt-6" aria-label="결과 검수">
    <SectionHeader level={3} title="준비 결과 · 검수" actions={history.length > 0 && <NativeSelect aria-label="결과 버전" value={artifact?.id || ""} className="max-w-56 text-sm" onChange={(event) => onVersion(event.target.value)}>{[...history].reverse().map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.source === "agent" ? "에이전트" : "직접 수정"}{item.stale ? " · 갱신 필요" : item.approvedAt ? " · 승인됨" : " · 미승인"}</option>)}</NativeSelect>} />
    {state?.question && <Notice variant="warning">에이전트 질문: {state.question}</Notice>}{state?.error && <Notice variant="error">{state.error}</Notice>}
    {artifact && <HelpText>v{artifact.version} · {timestamp(artifact.createdAt)} · {artifact.approvedAt ? "승인 기록 있음" : "검수 전"}{artifact.stale ? " · 현재 계획의 갱신이 필요합니다." : ""}</HelpText>}
    {assets && onFile && <FormField label="결과 파일 연결"><NativeSelect value={fileId || ""} disabled={active || busy} onChange={(event) => onFile(event.target.value)}><option value="">문서·코드 결과</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</NativeSelect></FormField>}
    {assets?.find((asset) => asset.id === fileId) && <AssetPreview asset={assets.find((asset) => asset.id === fileId)!} />}
    <FormField label={step.kind === "code" ? "SVG / HTML 소스" : "원고·설계·사용자 입력"}><Textarea disabled={active} className={step.kind === "code" ? "min-h-80 font-mono text-sm" : "min-h-64"} value={content} maxLength={40000} onChange={(event) => onContent(event.target.value)} placeholder={step.kind === "manual" ? "사용자가 준비한 결과를 입력하세요." : "결과를 확인하거나 내용을 직접 입력·수정할 수 있습니다."} /></FormField>
    <ActionBar><Button variant="secondary" disabled={!content.trim() || dirty || busy || active} onClick={onSave}><Save />수정본 저장</Button>{step.kind === "code" && <Button variant="outline" disabled={!content.trim()} onClick={onPreview}><FileCode2 />{preview ? "미리보기 닫기" : "코드 미리보기"}</Button>}{state?.status === "review" && <Button disabled={dirty || busy || artifact?.id !== latest?.id || content !== latest?.content || !!onFile && (fileId || "") !== (latest?.assetIds?.[0] || "")} onClick={onApprove}><Check />{project.autoRun ? "승인하고 다음 진행" : "결과 승인"}</Button>}</ActionBar>
    {preview && <><iframe className="min-h-72 w-full rounded-md border border-border bg-background" title="격리된 SVG HTML 준비 코드 미리보기" sandbox="allow-scripts" srcDoc={previewDocument} /><HelpText>격리된 브라우저 미리보기입니다. 외부 리소스와 상위 화면 접근을 제한하며 영상 파일은 생성하지 않습니다.</HelpText></>}
  </section>;
}

export function ProductionAgent({ mode, project, tasks, active, message, modelId, blockedReason, busy, dirty, canPlan, canFeedback, onMessage, onPlan, onFeedback, onNote, onApply, onNavigate }: {
  mode: "plan" | "review"; project: WorkflowProject; tasks: WorkflowTask[]; active?: WorkflowTask; message: string; modelId?: string; blockedReason?: string; busy: boolean; dirty: boolean; canPlan: boolean; canFeedback: boolean;
  onMessage: (value: string) => void; onPlan: () => void; onFeedback: () => void; onNote: () => void; onApply: (id: string) => void; onNavigate: (tab: "steps" | "review" | "setup") => void;
}) {
  const ownActive = active?.kind === (mode === "plan" ? "plan" : "step") ? active : undefined, otherActive = active && !ownActive;
  const ownTasks = tasks.filter((item) => item.sessionId ? item.sessionId === project.id : item.projectId === project.id);
  const planTasks = new Set(ownTasks.filter((item) => item.kind === "plan").map((item) => item.id));
  const messages = project.logs.filter((item) => mode === "plan" ? !!item.taskId && planTasks.has(item.taskId) : !item.taskId || !planTasks.has(item.taskId));
  const lastTask = ownTasks.at(-1);
  return <Panel role="complementary" className="production-agent gap-4" aria-label={mode === "plan" ? "계획 제안 대화" : "스텝 피드백 대화"}>
    <div className="grid shrink-0 gap-1"><SectionHeader title={<><MessageSquare />{mode === "plan" ? "제작 대화" : "수정 대화"}</>} actions={ownActive && <Badge variant="outline"><LoaderCircle className="animate-spin" />{ownActive.status === "queued" ? "대기" : "준비 중"}</Badge>} />{modelId && <HelpText className="truncate" title={modelId}>{modelId}</HelpText>}</div>
    <div className="production-agent-content">
      <Conversation conversationId={`${project.id}:${mode}`} messages={messages} emptyText={mode === "plan" ? "만들고 싶은 콘텐츠나 바꾸고 싶은 내용을 적어 주세요." : "수정할 내용이나 질문에 대한 답변을 적어 주세요."}>
      {mode === "plan" && project.proposals.length > 0 && <div className="production-proposals">{project.proposals.slice(-3).reverse().map((proposal, index) => <Plan key={proposal.id} title={proposal.name} description={proposal.summary} defaultOpen={!index && proposal.basedOnRevision === project.revision} meta={<>출력 {proposal.outputs.length}개 · 기반 계획 v{proposal.basedOnRevision}</>} actions={<div className="grid gap-3"><Button variant="secondary" size="sm" disabled={dirty || busy || proposal.basedOnRevision !== project.revision} onClick={() => onApply(proposal.id)}>이 제안 적용</Button>{proposal.basedOnRevision !== project.revision && <HelpText>계획이 변경됐습니다. 현재 계획으로 다시 제안받을 수 있습니다.</HelpText>}</div>}><ol className="m-0 list-none space-y-3 p-0">{proposal.steps.map((step, position) => <li key={step.id} className="flex items-start gap-3 text-sm leading-6"><span className="font-mono text-xs leading-6 text-muted-foreground">{position + 1}</span><span>{step.name}<span className="block text-xs text-muted-foreground">{stepKinds[step.kind]}{step.review ? " · 검수" : ""}</span></span></li>)}</ol></Plan>)}</div>}
      </Conversation>
    </div>
    <div className="grid shrink-0 gap-2">
      <PromptInput inputId={`production-message-${mode}`} label={ownActive ? "실행 중 피드백" : mode === "plan" ? "계획 변경 요청" : "선택한 스텝에 피드백"} value={message} onChange={onMessage} placeholder={mode === "plan" ? "어떤 콘텐츠를 만들까요?" : "어떻게 수정할까요?"} canSubmit={ownActive ? !!message.trim() : mode === "plan" ? canPlan : canFeedback && !!message.trim()} busy={busy} onSubmit={ownActive ? onNote : mode === "plan" ? onPlan : onFeedback} actionLabel={ownActive ? "전달" : mode === "plan" ? project.steps.length ? "다시 제안" : "제안받기" : "다시 준비"} />
      {otherActive && <HelpText>{active.kind === "plan" ? "계획 제안 중입니다." : "스텝 준비 중입니다."} <InlineAction onClick={() => onNavigate(active.kind === "plan" ? "steps" : "review")}>진행 화면으로</InlineAction></HelpText>}
      {!active && blockedReason && <HelpText>{blockedReason}{!dirty && !modelId && <> <InlineAction onClick={() => onNavigate("setup")}>모델 설정</InlineAction></>}</HelpText>}
      {lastTask && lastTask.kind === (mode === "plan" ? "plan" : "step") && ["failed", "unknown"].includes(lastTask.status) && <Notice variant="error">{lastTask.error}</Notice>}
    </div>
  </Panel>;
}
