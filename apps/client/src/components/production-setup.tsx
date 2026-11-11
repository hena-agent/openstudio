"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus, Upload, X } from "lucide-react";
import type { Asset, Connection } from "@openstudio/shared/types";
import { productionMethods, productionSettingsSchema, videoTarget, type ProductionPreset, type ProductionReference, type ProductionSettings, type VideoTarget, type WorkflowProject } from "@openstudio/shared/workflow";
import { BindingFields } from "./production-panels";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ActionBar, FormField, FormSection, HelpText, IconButton, InlineAction, Notice } from "./studio/primitives";

type SetupValue = Pick<WorkflowProject, "brief" | "agent" | "settings" | "video" | "references" | "outputs">;
export function ReferenceFields({ title, value, assets, disabled, onChange, onUpload }: {
  title: string; value: ProductionReference[]; assets: Asset[]; disabled: boolean; onChange: (value: ProductionReference[]) => void; onUpload: (file: File) => Promise<Asset>;
}) {
  const input = useRef<HTMLInputElement>(null), [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    try { setError(""); if (file.size > 20 * 1024 * 1024) throw new Error("20MB 이하의 이미지를 선택하세요."); const asset = await onUpload(file); onChange([...value, { assetId: asset.id, purpose: "" }]); }
    catch (error) { setError((error as Error).message); }
    finally { if (input.current) input.current.value = ""; }
  }
  return <FormSection title={title} disabled={disabled}>
    {value.map((reference, index) => { const asset = assets.find((item) => item.id === reference.assetId); return <div key={reference.assetId} className="flex min-w-0 items-start gap-3">
      {asset && <img src={`/api/assets?id=${asset.id}`} alt={asset.name} className="size-11 shrink-0 rounded border border-border object-cover" loading="lazy" />}
      <div className="grid min-w-0 flex-1 gap-1"><span className="truncate text-xs text-muted-foreground">{asset?.name || "이미지를 찾을 수 없습니다"}</span><Input value={reference.purpose} maxLength={500} aria-label={`${asset?.name || index + 1} 사용 목적`} placeholder="사용 목적 · 예: 로고, 주인공, 장면 분위기" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, purpose: event.target.value } : item))} /></div>
      <IconButton label={`${asset?.name || index + 1} 참조 해제`} disabled={disabled} onClick={() => onChange(value.filter((item) => item.assetId !== reference.assetId))}><X /></IconButton>
    </div>; })}
    <ActionBar><NativeSelect className="min-w-0 flex-1" aria-label={`${title}에서 기존 이미지 선택`} value="" disabled={value.length >= 6} onChange={(event) => { if (event.target.value) onChange([...value, { assetId: event.target.value, purpose: "" }]); }}><option value="">보관한 이미지 선택</option>{assets.filter((item) => !value.some((reference) => reference.assetId === item.id)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</NativeSelect><Button variant="outline" disabled={disabled || value.length >= 6} onClick={() => input.current?.click()}><Upload />업로드</Button><input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label={`${title} 업로드`} onChange={(event) => void upload(event.target.files?.[0])} /></ActionBar>
    {value.length > 0 && <HelpText>공통·개별 자료를 합쳐 6개·20MB까지 사용합니다. 이미지 입력 지원 모델에는 파일도 전달됩니다.</HelpText>}
    {error && <Notice variant="error">{error}</Notice>}
  </FormSection>;
}

export function ProductionSetup({ value, connections, presets, loadedPreset, assets, disabled, legacy, onChange, onPreset, onSavePreset, onUpload, onConnections }: {
  value: SetupValue; connections: Connection[]; presets: ProductionPreset[]; loadedPreset?: ProductionPreset; assets: Asset[]; disabled: boolean; legacy: boolean;
  onChange: (update: Partial<SetupValue>) => void; onPreset: (id: string) => void; onSavePreset: () => void; onUpload: (file: File) => Promise<Asset>; onConnections: () => void;
}) {
  const settings = { ...productionSettingsSchema.parse({}), ...value.settings }, target = videoTarget(value);
  function changeSettings(update: Partial<ProductionSettings>) { onChange({ settings: { ...settings, ...update } }); }
  function changeTarget(update: Partial<VideoTarget>) {
    const next = { ...target, ...update }, primary = value.outputs.find((item) => ["mp4", "webm", "gif"].includes(item.format));
    onChange({ video: next, outputs: primary ? value.outputs.map((item) => item.id === primary.id ? { ...item, ...next } : item) : value.outputs });
  }
  const ratios = [{ label: "세로 9:16", width: 1080, height: 1920 }, { label: "가로 16:9", width: 1920, height: 1080 }, { label: "정사각 1:1", width: 1080, height: 1080 }, { label: "세로 4:5", width: 1080, height: 1350 }];
  const ratio = ratios.findIndex((item) => item.width / item.height === target.width / target.height);
  return <div className="production-settings-grid">
    <div className="grid content-start gap-6">
      <FormSection title="제작 기본값" description="새 제작에 복사할 기본 안내와 영상 규격입니다. 각 영상의 주제는 제작 세션에서 입력합니다." disabled={disabled}>
        <FormField label="기본 제작 안내" id="production-brief"><Textarea className="min-h-40" value={value.brief} maxLength={4000} onChange={(event) => onChange({ brief: event.target.value })} placeholder="여러 영상에서 공통으로 따를 제작 방향과 기준" /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField label="길이 · 초"><Input type="number" min={1} max={3600} value={target.durationSeconds} onChange={(event) => changeTarget({ durationSeconds: Number(event.target.value) })} /></FormField><FormField label="화면 비율"><NativeSelect value={ratio < 0 ? "custom" : String(ratio)} onChange={(event) => { const item = ratios[Number(event.target.value)]; changeTarget(item ? { width: item.width, height: item.height } : { width: 1280, height: 960 }); }}>{ratios.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}<option value="custom">직접 지정</option></NativeSelect></FormField></div>
        {ratio < 0 && <div className="grid grid-cols-2 gap-4"><FormField label="가로 px"><Input type="number" min={16} max={7680} value={target.width} onChange={(event) => changeTarget({ width: Number(event.target.value) })} /></FormField><FormField label="세로 px"><Input type="number" min={16} max={7680} value={target.height} onChange={(event) => changeTarget({ height: Number(event.target.value) })} /></FormField></div>}
        <HelpText>변경한 기본값은 이후 시작하는 제작에 적용됩니다.</HelpText>
      </FormSection>
      <ReferenceFields title="기본 참조 자료" value={value.references || []} assets={assets} disabled={disabled} onChange={(references) => onChange({ references })} onUpload={onUpload} />
      <BindingFields disabled={disabled} label="계획·원고 모델" connections={connections} value={value.agent} onChange={(agent) => onChange({ agent })} />
      <div><InlineAction onClick={onConnections}>연결 계정 관리</InlineAction></div>
    </div>
    <div className="grid content-start gap-6 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      <FormSection title="공통 제작 설정" description="브랜드와 제작 기본값을 저장해 다음 영상에도 불러올 수 있습니다." disabled={disabled}>
        <ActionBar><NativeSelect className="min-w-0 flex-1" aria-label="저장한 제작 설정" value={loadedPreset?.id || ""} onChange={(event) => onPreset(event.target.value)}><option value="">직접 설정</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</NativeSelect><Button variant="outline" onClick={onSavePreset}><Plus />설정 저장</Button></ActionBar>
        <FormField label="브랜드·채널 소개"><Textarea className="min-h-24" value={settings.brand} maxLength={3000} onChange={(event) => changeSettings({ brand: event.target.value })} placeholder="여러 영상에 공통으로 적용할 소개·방향" /></FormField>
        {legacy && !settings.brand && !!value.brief.trim() && <InlineAction onClick={() => changeSettings({ brand: value.brief })}>기존 목표를 공통 소개로 복사</InlineAction>}
        <FormField label="대상 시청자"><Input value={settings.audience} maxLength={1000} onChange={(event) => changeSettings({ audience: event.target.value })} placeholder="예: 첫 직장을 시작한 20–30대" /></FormField>
        <FormField label="말투·전달 방식"><Input value={settings.tone} maxLength={1000} onChange={(event) => changeSettings({ tone: event.target.value })} placeholder="예: 차분하고 직설적, 구체적인 사례 중심" /></FormField>
        <FormField label="기본 제작 방식"><NativeSelect value={settings.method} onChange={(event) => changeSettings({ method: event.target.value as ProductionSettings["method"] })}>{Object.entries(productionMethods).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</NativeSelect></FormField>
        <FormField label="시각 스타일"><Textarea className="min-h-24" value={settings.visualStyle} maxLength={2000} onChange={(event) => changeSettings({ visualStyle: event.target.value })} placeholder="색상·글꼴·장면 분위기·일관성 기준" /></FormField>
      </FormSection>
      <ReferenceFields title="공통 이미지·로고" value={settings.references} assets={assets} disabled={disabled} onChange={(references) => changeSettings({ references })} onUpload={onUpload} />
      <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" className="group w-full justify-between">음성·예산·제작 모델 · 선택<ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="grid gap-6 pt-4"><FormSection title="추가 기본값" disabled={disabled}>
        <FormField label="내레이션·보이스"><Input value={settings.narration} maxLength={1000} onChange={(event) => changeSettings({ narration: event.target.value })} placeholder="사용할 보이스 또는 무음·직접 녹음 등" /></FormField>
        <FormField label="예산 제한"><Input value={settings.budget} maxLength={1000} onChange={(event) => changeSettings({ budget: event.target.value })} placeholder="필요한 경우에만 지정 · 예: 편당 1만원 이내" /></FormField>
      </FormSection>{(["image", "video", "audio"] as const).map((kind) => { const key = `${kind}Model` as "imageModel" | "videoModel" | "audioModel"; return <BindingFields key={kind} label={`${kind === "image" ? "이미지" : kind === "video" ? "영상" : "음성"} 제작 모델`} kind={kind} disabled={disabled} connections={connections} value={settings[key]} onChange={(binding) => changeSettings({ [key]: binding })} />; })}<HelpText>제작용 기본 참조입니다. 준비 실행에서는 선택한 계획·원고 모델만 호출합니다.</HelpText></CollapsibleContent></Collapsible>
    </div>
  </div>;
}
