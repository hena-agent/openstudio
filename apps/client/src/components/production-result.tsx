"use client";

import { Check, Copy, FilePlus2, Pencil, Save } from "lucide-react";
import type { Asset } from "@openstudio/shared/types";
import type { PreparationArtifact, WorkflowStep } from "@openstudio/shared/workflow";
import { MessageResponse } from "./ai-elements/message";
import { AssetPreview } from "./asset-preview";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { ActionBar, EmptyState, FormField, HelpText, SectionHeader } from "./studio/primitives";

export function ProductionResult({ step, artifact, latest, history, assets, content, fileId, editing, source, dirty, active, busy, visible, review, autoRun, previewDocument, onMode, onContent, onFile, onVersion, onSave, onApprove }: {
  step: WorkflowStep; artifact?: PreparationArtifact; latest?: PreparationArtifact; history: PreparationArtifact[]; assets: Asset[];
  content: string; fileId: string; editing: boolean; source: boolean; dirty: boolean; active: boolean; busy: boolean; visible: boolean; review: boolean; autoRun: boolean; previewDocument: string;
  onMode: (editing: boolean, source: boolean) => void; onContent: (content: string) => void; onFile: (id: string) => void; onVersion: (id: string) => void; onSave: () => void; onApprove: () => void;
}) {
  const file = assets.find((item) => item.id === fileId), hasContent = !!content.trim() || !!file;
  const canApprove = review && !!latest && artifact?.id === latest.id && !dirty && content === latest.content && fileId === (latest.assetIds?.[0] || "") && !active && !busy;
  return <section className="production-result" aria-label="결과 검수">
    <div className="production-result-toolbar"><SectionHeader level={3} title="결과" actions={<>{dirty && <Badge variant="warning">미저장</Badge>}{artifact && <Badge variant="outline">v{artifact.version}{artifact.stale ? " · 갱신 필요" : artifact.approvedAt ? " · 승인됨" : " · 검수 전"}</Badge>}</>} />
      <ActionBar className="gap-2">{history.length > 1 && <NativeSelect aria-label="결과 버전" value={artifact?.id || ""} className="max-w-40 text-sm" onChange={(event) => onVersion(event.target.value)}>{[...history].reverse().map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.approvedAt ? "승인됨" : "미승인"}</option>)}</NativeSelect>}
        {hasContent && <><Button size="sm" variant={!editing && !source ? "secondary" : "ghost"} aria-pressed={!editing && !source} onClick={() => onMode(false, false)}>미리보기</Button>{step.kind === "code" && !file && <Button size="sm" variant={!editing && source ? "secondary" : "ghost"} aria-pressed={!editing && source} onClick={() => onMode(false, true)}>소스</Button>}<Button size="sm" variant={editing ? "secondary" : "ghost"} disabled={active || busy} aria-pressed={editing} onClick={() => onMode(true, false)}><Pencil />수정</Button></>}
        {!editing && assets.length > 0 && <Button variant="ghost" size="sm" disabled={active || busy} onClick={() => onMode(true, false)}><FilePlus2 />파일 연결</Button>}
      </ActionBar>
    </div>
    <div className="production-result-body">
      {editing ? <div className="grid gap-4">{assets.length > 0 && <FormField label="결과 파일 연결"><NativeSelect value={fileId} disabled={active || busy} onChange={(event) => onFile(event.target.value)}><option value="">문서·코드 결과</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></FormField>}
        <FormField label={file ? "결과 메모" : step.kind === "code" ? "SVG / HTML 소스" : "원고·설계·사용자 입력"}><Textarea disabled={active} value={content} maxLength={40000} className={step.kind === "code" && !file ? "min-h-96 font-mono text-sm" : "min-h-80"} onChange={(event) => onContent(event.target.value)} placeholder="결과를 입력하거나 수정하세요." /></FormField>
        <ActionBar><Button variant="secondary" disabled={!content.trim() || active || busy} onClick={onSave}><Save />수정본 저장</Button><Button variant="ghost" size="sm" onClick={() => onMode(false, false)}>미리보기로</Button></ActionBar>
      </div> : file ? <div className="grid gap-3"><AssetPreview asset={file} /><HelpText>{file.name}</HelpText></div> : hasContent ? step.kind === "code" ? source ? <div className="grid gap-3"><ActionBar className="justify-end"><Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(content)}><Copy />복사</Button></ActionBar><pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-6">{content}</pre></div> : visible ? <iframe className="production-code-preview" title="격리된 결과 미리보기" sandbox="allow-scripts" srcDoc={previewDocument} /> : null : <MessageResponse>{content}</MessageResponse> : <EmptyState className="min-h-48 p-0 sm:p-0" title={active ? "결과를 준비하고 있습니다" : "아직 결과가 없습니다"} description={active ? "작업이 끝나면 이곳에 결과가 표시됩니다." : step.kind === "manual" ? "위의 결과 입력으로 직접 준비한 결과를 등록하세요." : "스텝을 실행하면 이곳에서 결과를 확인하고 검수할 수 있습니다."} actions={!active && step.kind !== "manual" && <Button variant="secondary" disabled={busy} onClick={() => onMode(true, false)}><Pencil />결과 입력</Button>} />}
    </div>
    {review && latest && <div className="production-result-approval"><HelpText>{dirty ? "수정 내용을 저장한 뒤 승인하세요." : artifact?.id !== latest.id ? "승인하려면 최신 결과를 선택하세요." : "결과를 확인한 뒤 승인하면 다음 스텝에 사용할 수 있습니다."}</HelpText><Button disabled={!canApprove} onClick={onApprove}><Check />{autoRun ? "승인하고 다음 진행" : "결과 승인"}</Button></div>}
  </section>;
}
