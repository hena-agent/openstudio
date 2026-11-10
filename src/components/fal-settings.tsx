"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Plus, Search, X } from "lucide-react";
import { FAL_CATEGORIES, FAL_CATEGORY_NAMES, falSettingsSchema } from "@/lib/fal-config";
import type { Connection, FalCatalogPage, FalSettings, Model } from "@/lib/types";
import { studioApi } from "@/lib/client-api";

export function FalSettingsFields({ value, onChange, disabled }: { value: FalSettings; onChange: (value: FalSettings) => void; disabled?: boolean }) {
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<typeof FAL_CATEGORIES[number]>("text-to-image");
  const [models, setModels] = useState<Model[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  function reset() { request.current++; setBusy(false); setModels([]); setCursor(undefined); setError(""); setSearched(false); }
  async function search(more = false) {
    const token = ++request.current;
    setBusy(true); setError(""); setSearched(true);
    try {
      const params = new URLSearchParams({ q: query, category });
      if (more && cursor) params.set("cursor", cursor);
      const data = await studioApi<FalCatalogPage>(`fal/models?${params}`);
      if (request.current !== token) return;
      setModels((old) => more ? [...new Map([...old, ...data.models].map((model) => [model.id, model])).values()] : data.models);
      setCursor(data.nextCursor);
    } catch (error) { if (request.current === token) setError((error as Error).message); }
    finally { if (request.current === token) setBusy(false); }
  }
  function contains(id: string) {
    return value.endpoints.some((endpoint) => falSettingsSchema.safeParse({ endpoints: [endpoint] }).data?.endpoints[0] === id);
  }
  return <fieldset className="fal-fields" disabled={disabled}><legend>fal.ai 모델 / endpoint</legend>
    <div className="fal-catalog-search"><label htmlFor={`${prefix}-query`} className="field-label">공식 모델 검색</label><input id={`${prefix}-query`} placeholder="Seedream, FLUX, Veo, Kling…" maxLength={160} value={query} onChange={(event) => { reset(); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <div className="fal-search-controls"><label htmlFor={`${prefix}-category`} className="field-label">작업 분류</label><select id={`${prefix}-category`} value={category} onChange={(event) => { reset(); setCategory(event.target.value as typeof category); }}>{FAL_CATEGORIES.map((item) => <option key={item} value={item}>{FAL_CATEGORY_NAMES[item]}</option>)}</select><button type="button" className="button secondary" disabled={busy} onClick={() => void search()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}검색</button></div>
      <p className="field-help">공개 카탈로그 조회이며 키 인증이나 모델 실행 성공을 의미하지 않습니다. 검색으로 추가하거나 아래에 endpoint를 직접 입력할 수 있습니다.</p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {searched && !busy && !error && !models.length && <p className="field-help" role="status">검색 조건에 맞는 fal 모델이 없습니다.</p>}
      {models.length > 0 && <div className="fal-search-results" aria-label="fal 모델 검색 결과">{models.map((model) => <div className="fal-search-result" key={model.id}><div><strong>{model.name}</strong><code>{model.id}</code><span>{model.tasks?.map((task) => task === "image" ? "이미지" : "영상").join(" / ") || "분류 미확인"}</span>{model.unavailableReason && <p>{model.unavailableReason}</p>}</div><button type="button" className="small-button" aria-label={`${model.name} endpoint 추가`} disabled={model.callable === false || contains(model.id) || value.endpoints.length >= 20} onClick={() => onChange({ endpoints: [...value.endpoints, model.id] })}>{contains(model.id) ? "추가됨" : "추가"}<Plus size={13} /></button></div>)}</div>}
      {cursor && <button type="button" className="button secondary full" disabled={busy} onClick={() => void search(true)}>{busy && <LoaderCircle size={14} className="spin" />}더 불러오기</button>}
    </div>
    <div className="form-label-row"><span>사용할 endpoint · {value.endpoints.length}/20</span><button type="button" className="small-button" disabled={value.endpoints.length >= 20} onClick={() => onChange({ endpoints: [...value.endpoints, ""] })}><Plus size={14} />직접 입력</button></div>
    {value.endpoints.map((endpoint, index) => <div className="fal-endpoint-row" key={index}><label className="field-label" htmlFor={`${prefix}-endpoint-${index}`}>endpoint {index + 1}</label><div><input id={`${prefix}-endpoint-${index}`} required maxLength={1000} placeholder="fal-ai/… 또는 https://fal.ai/models/…" value={endpoint} onChange={(event) => onChange({ endpoints: value.endpoints.map((old, position) => position === index ? event.target.value : old) })} /><button type="button" className="icon-button" aria-label={`fal endpoint ${index + 1} 삭제`} onClick={() => onChange({ endpoints: value.endpoints.filter((_, position) => position !== index) })}><X size={15} /></button></div></div>)}
    <p className="field-help">선택한 endpoint는 인증된 키로 다시 확인하고 저장합니다. 최근 목록 밖의 모델도 유지되며 실제 호출에 같은 ID를 사용합니다.</p>
  </fieldset>;
}

export function FalSettingsDialog({ connection, onClose, onSaved }: { connection?: Connection; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<FalSettings>({ endpoints: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (connection) { setValue(connection.fal || { endpoints: [] }); setError(""); if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [connection?.id]);
  async function save() {
    if (!connection) return;
    const settings = falSettingsSchema.safeParse(value);
    if (!settings.success) { setError(settings.error.issues[0]?.message || "endpoint ID를 확인하세요."); return; }
    setBusy(true); setError("");
    try { await studioApi("connections", { action: "fal-settings", id: connection.id, fal: settings.data }); await onSaved(); onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="connection-dialog fal-settings-dialog" aria-label="fal.ai 모델 설정" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="dialog-heading"><h2>fal.ai 모델 설정</h2><button className="icon-button" aria-label="fal 설정 닫기" disabled={busy} onClick={onClose}><X size={17} /></button></div><form className="dialog-body key-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><FalSettingsFields value={value} onChange={setValue} disabled={busy} />{error && <p className="dialog-error" role="alert">{error}</p>}<button className="button primary full" type="submit" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}endpoint 확인하고 저장</button><p className="field-help">검색·등록은 생성 요청을 보내지 않습니다. 실제 사용량은 생성 버튼을 누를 때 발생합니다.</p></form></dialog>;
}
