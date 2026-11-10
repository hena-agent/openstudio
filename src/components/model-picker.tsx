"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { Catalog, Connection, Model } from "@/lib/types";
import { formatTokens, resolveModelMetadata } from "@/lib/model-metadata";
import { ModelDetails } from "./model-details";
import { providerName as registeredProviderName } from "@/lib/provider-registry";

type Props = {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
  connection?: Connection;
  catalog?: Catalog;
  disabled?: boolean;
  placeholder: string;
};

export function ModelPicker({ models, value, onChange, connection, catalog, disabled, placeholder }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const titleId = useId();
  const selected = models.find((model) => model.id === value);
  const filtered = useMemo(() => models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())), [models, query]);
  const preview = filtered[highlight];
  const providerId = connection?.provider || "";
  const providerName = connection ? registeredProviderName(connection.provider) : "제공자 미선택";

  useEffect(() => {
    if (open) { dialog.current?.showModal(); searchInput.current?.focus(); }
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, listId]);

  function choose(model: Model) { if (model.callable === false) return; onChange(model.id); setOpen(false); }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => filtered.length ? (current + direction + filtered.length) % filtered.length : 0);
    }
    if (event.key === "Enter" && preview) { event.preventDefault(); choose(preview); }
  }
  return <>
    <button id="model" ref={trigger} type="button" className="model-picker-trigger" aria-label="모델 선택" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setQuery(""); setHighlight(Math.max(0, models.findIndex((model) => model.id === value))); setOpen(true); }}><span>{selected?.name || placeholder}</span><ChevronDown size={16} /></button>
    <dialog ref={dialog} className="model-picker-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
      <div className="dialog-heading"><h2 id={titleId}>모델 선택<span className="picker-account">{connection?.label}</span></h2><button className="icon-button" aria-label="모델 선택 닫기" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <div className="model-picker-search"><Search size={17} /><input ref={searchInput} role="combobox" aria-label="계정 모델 검색" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={preview ? `${listId}-${highlight}` : undefined} value={query} placeholder="모델 이름 또는 ID 검색" onChange={(event) => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={navigate} autoComplete="off" /><span>{filtered.length}</span></div>
      <div className="model-picker-body"><div className="model-picker-list" role="listbox" aria-label="사용 가능한 계정 모델" id={listId}>
        {filtered.map((model, index) => {
          const { values } = resolveModelMetadata(model, providerId, catalog);
          return <button type="button" role="option" aria-selected={model.id === value} aria-disabled={model.callable === false} tabIndex={-1} id={`${listId}-${index}`} key={model.id} className={`model-option ${index === highlight ? "highlighted" : ""}`} onPointerMove={() => { if (index !== highlight) setHighlight(index); }} onClick={() => choose(model)}><span className="model-option-title"><strong>{model.name}</strong>{model.id === value && <Check size={15} />}</span><code>{model.id}</code><span className="model-option-spec">{model.media ? `${model.media.kind === "video" ? "영상" : "이미지"} · ${model.media.resolutions?.join(" / ") || "모델별 옵션"}` : <>컨텍스트 {formatTokens(values.context, true)}<span>·</span>출력 {formatTokens(values.maxOutput, true)}</>}</span><span className="model-option-features">{model.unavailableReason || `${values.input?.join(" · ") || "입력 미확인"}${values.reasoning === true ? " / 추론" : ""}`}</span></button>;
        })}
        {!filtered.length && <p className="model-picker-empty" role="status">일치하는 모델이 없습니다.</p>}
      </div><aside className="model-picker-preview" aria-label="모델 사양 미리보기">{preview ? <ModelDetails model={preview} providerId={providerId} providerName={providerName} catalog={catalog} connection={connection} /> : <p className="model-picker-empty">검색 조건을 변경해 주세요.</p>}</aside></div>
      <div className="model-picker-footer"><span>↑ ↓ 탐색 · Enter 선택 · Esc 닫기</span><span>계정 목록과 공개 참고 사양을 함께 표시합니다.</span></div>
    </dialog>
  </>;
}
