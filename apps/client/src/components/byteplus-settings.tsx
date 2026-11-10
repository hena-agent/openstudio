"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { BYTEPLUS_BASE_URL, BYTEPLUS_REGION } from "@/lib/byteplus-config";
import type { BytePlusRegistration, BytePlusSettings, Connection } from "@/lib/types";
import { studioApi } from "@/lib/client-api";

export function BytePlusSettingsFields({ value, onChange, disabled }: { value: BytePlusSettings; onChange: (value: BytePlusSettings) => void; disabled?: boolean }) {
  const prefix = useId();
  function patch(index: number, next: Partial<BytePlusRegistration>) {
    onChange({ ...value, registrations: value.registrations.map((item, position) => position === index ? { ...item, ...next } : item) });
  }
  return <fieldset className="byteplus-fields" disabled={disabled}><legend>BytePlus ModelArk 설정</legend>
    <label htmlFor={`${prefix}-region`} className="field-label">리전</label><select id={`${prefix}-region`} value={value.region} onChange={() => {}}><option value={BYTEPLUS_REGION}>Singapore · ap-southeast-1</option></select><p className="field-help">현재 공식 문서로 확인한 리전입니다. API 키는 이 데이터 플레인으로만 전송합니다.</p><code className="byteplus-base-url">{BYTEPLUS_BASE_URL}</code>
    <div className="form-label-row"><span>직접 등록한 모델 / 추론 endpoint</span><button type="button" className="small-button" disabled={value.registrations.length >= 20} onClick={() => onChange({ ...value, registrations: [...value.registrations, { id: "", kind: "image" }] })}><Plus size={14} />추가</button></div>
    <p className="field-help">API가 조회한 기반 모델은 자동 표시됩니다. 콘솔의 ep-... 추론 endpoint나 목록에 없는 모델 ID를 추가할 수 있습니다. 등록만으로 사용 권한이 확인되지는 않습니다.</p>
    {value.registrations.map((entry, index) => <div className="byteplus-registration" key={index}>
      <div className="form-label-row"><strong>등록 {index + 1}</strong><button type="button" className="icon-button" aria-label={`등록 ${index + 1} 삭제`} onClick={() => onChange({ ...value, registrations: value.registrations.filter((_, position) => position !== index) })}><X size={15} /></button></div>
      <label htmlFor={`${prefix}-id-${index}`} className="field-label">호출할 모델 / endpoint ID</label><input id={`${prefix}-id-${index}`} required maxLength={200} pattern="[a-zA-Z0-9][a-zA-Z0-9._:\-]*" placeholder="모델 ID 또는 ep-..." value={entry.id} onChange={(event) => patch(index, { id: event.target.value })} />
      <label htmlFor={`${prefix}-kind-${index}`} className="field-label">작업 유형</label><select id={`${prefix}-kind-${index}`} value={entry.kind} onChange={(event) => patch(index, { kind: event.target.value as BytePlusRegistration["kind"] })}><option value="image">이미지 생성·편집</option><option value="video">영상 생성</option><option value="text">텍스트</option></select>
      <label htmlFor={`${prefix}-name-${index}`} className="field-label">표시 이름 (선택)</label><input id={`${prefix}-name-${index}`} maxLength={100} value={entry.name || ""} onChange={(event) => patch(index, { name: event.target.value })} />
      <label htmlFor={`${prefix}-base-${index}`} className="field-label">기반 모델 ID (선택)</label><input id={`${prefix}-base-${index}`} maxLength={200} placeholder="콘솔에 표시된 실제 기반 모델 ID" value={entry.baseModelId || ""} onChange={(event) => patch(index, { baseModelId: event.target.value })} />
      {entry.kind === "video" && <p className="field-help">ep-...의 실제 기반 모델·버전은 API 키만으로 검증되지 않습니다. Seedance 5.0 확인 전에는 영상 endpoint 실행이 차단됩니다.</p>}
    </div>)}
  </fieldset>;
}

export function BytePlusSettingsDialog({ connection, onClose, onSaved }: { connection?: Connection; onClose: () => void; onSaved: () => Promise<void> }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<BytePlusSettings>({ region: BYTEPLUS_REGION, registrations: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (connection) { setValue(connection.byteplus || { region: BYTEPLUS_REGION, registrations: [] }); setError(""); if (!modal.current?.open) modal.current?.showModal(); }
    else modal.current?.close();
  }, [connection?.id]);
  async function save() {
    if (!connection) return;
    setBusy(true); setError("");
    try { await studioApi("connections", { action: "byteplus-settings", id: connection.id, byteplus: value }); await onSaved(); onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={modal} className="connection-dialog byteplus-settings-dialog" aria-label="BytePlus 모델 설정" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="dialog-heading"><h2>BytePlus 모델 설정</h2><button className="icon-button" aria-label="BytePlus 설정 닫기" disabled={busy} onClick={onClose}><X size={17} /></button></div><form className="dialog-body key-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><BytePlusSettingsFields value={value} onChange={setValue} disabled={busy} />{error && <p className="dialog-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy} type="submit">{busy && <LoaderCircle size={15} className="spin" />}모델 목록 조회하고 저장</button><p className="field-help">등록은 생성 요청을 실행하지 않습니다. 기존 작업은 실행 당시 모델·API 주소를 유지합니다.</p></form></dialog>;
}
