"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, ChevronDown, Search, X } from "lucide-react";
import type { Catalog, Connection, Model } from "@/lib/types";
import { modelDisabledReason, modelTraits, referenceLabels, searchModels, type ReferenceFilter } from "@/lib/model-search";
import { providerName as registeredProviderName } from "@/lib/provider-registry";
import { ModelDetails } from "./model-details";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { HelpText, IconButton, Notice } from "./studio/primitives";
import { cn } from "@/lib/utils";

type Props = {
  id?: string; label?: string; models: Model[]; value: string; onChange: (id: string) => void; connection?: Connection; catalog?: Catalog;
  disabled?: boolean; placeholder: string; requireTools?: boolean;
};

export function ModelPicker({ id, label = "모델 선택", models, value, onChange, connection, catalog, disabled, placeholder, requireTools = false }: Props) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [reference, setReference] = useState<ReferenceFilter>("all"), [hideUnavailable, setHideUnavailable] = useState(true);
  const [activeId, setActiveId] = useState(""), [showDetails, setShowDetails] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null), optionNodes = useRef(new Map<string, HTMLButtonElement>()), listId = useId();
  const selected = models.find((model) => model.id === value), providerName = connection ? registeredProviderName(connection.provider) : "모델 목록";
  const results = useMemo(() => open ? searchModels(models, query, { reference, hideUnavailable, requireTools, selectedId: value, context: `${providerName} ${connection?.label || ""}` }) : [], [open, models, query, reference, hideUnavailable, requireTools, value, providerName, connection?.label]);
  const preview = results.find((model) => model.id === activeId) || results.find((model) => !modelDisabledReason(model, requireTools)) || results[0];
  const activeIndex = preview ? results.findIndex((model) => model.id === preview.id) : -1;
  const unavailableCount = models.filter((model) => !!modelDisabledReason(model, requireTools)).length;
  const hasReferences = models.some((model) => model.media?.reference !== undefined);
  useEffect(() => { if (open && preview) optionNodes.current.get(preview.id)?.scrollIntoView({ block: "nearest" }); }, [open, preview?.id]);
  useEffect(() => { setOpen(false); }, [connection?.id]);
  function reset() {
    setQuery(""); setReference("all"); setShowDetails(false); setActiveId(value);
    setHideUnavailable(unavailableCount < models.length && !(selected && modelDisabledReason(selected, requireTools)));
  }
  function choose(model?: Model) { if (!model || disabled || modelDisabledReason(model, requireTools)) return; onChange(model.id); setOpen(false); }
  function navigate(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "Home" || event.key === "End") && event.currentTarget === searchInput.current) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const selectable = results.filter((model) => !modelDisabledReason(model, requireTools));
      if (!selectable.length) return;
      const index = selectable.findIndex((model) => model.id === preview?.id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? selectable.length - 1 : event.key === "ArrowDown" ? (index + 1) % selectable.length : (index < 0 ? selectable.length - 1 : index + selectable.length - 1) % selectable.length;
      setActiveId(selectable[next].id); setShowDetails(false);
    }
    if (event.key === "Enter") { event.preventDefault(); choose(preview); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (next) reset(); setOpen(next); }}>
    <DialogTrigger asChild><Button id={id || `model-${listId}`} variant="outline" className="w-full min-w-0 justify-between px-3 text-left font-normal" aria-label={label} aria-description={selected ? `${selected.name} · ${selected.id}` : placeholder} disabled={disabled}>
      <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm leading-5">{selected?.name || placeholder}</span>{selected && <span className="truncate font-mono text-xs leading-4 text-muted-foreground">{selected.id}</span>}</span><ChevronDown />
    </Button></DialogTrigger>
    <DialogContent className="flex h-[min(760px,90dvh)] max-w-5xl flex-col gap-0 overflow-hidden p-0" onOpenAutoFocus={(event) => { event.preventDefault(); searchInput.current?.focus(); }}>
      <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6 sm:pr-16"><DialogTitle className="text-base font-semibold">모델 선택</DialogTitle><DialogDescription>{providerName}{connection && ` · ${connection.label}`}</DialogDescription></DialogHeader>
      <div className="grid shrink-0 gap-3 border-b border-border p-4 sm:px-6">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchInput} role="combobox" aria-label="계정 모델 검색" aria-autocomplete="list" aria-expanded={open && !showDetails} aria-controls={listId} aria-activedescendant={!showDetails && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} value={query} placeholder="모델 이름·ID·키워드 검색" className="pr-12 pl-10" onChange={(event) => { setQuery(event.target.value); setActiveId(""); setShowDetails(false); }} onKeyDown={navigate} autoComplete="off" />{query && <IconButton label="모델 검색어 지우기" className="absolute top-1 right-1" onClick={() => { setQuery(""); setActiveId(""); searchInput.current?.focus(); }}><X /></IconButton>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3">{hasReferences && <NativeSelect className="w-auto max-w-full text-sm" aria-label="참조 이미지 조건" value={reference} onChange={(event) => { setReference(event.target.value as ReferenceFilter); setActiveId(""); setShowDetails(false); }}><option value="all">모든 참조 조건</option>{Object.entries(referenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect>}{unavailableCount > 0 && <label className="flex items-center gap-2 text-sm"><Checkbox checked={hideUnavailable} onChange={(event) => { setHideUnavailable(event.target.checked); setActiveId(""); }} />선택 불가 숨기기</label>}<span role="status" className="ml-auto text-xs text-muted-foreground">검색 결과 {results.length.toLocaleString()} / {models.length.toLocaleString()}개</span></div>
        {connection?.connectionIssue && <Notice variant="warning" className="max-h-24 overflow-y-auto">{connection.connectionIssue.message}</Notice>}
        {value && !selected && <HelpText className="line-clamp-2 break-all" title={value}>현재 선택한 모델을 이 목록에서 찾을 수 없습니다: {value}</HelpText>}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto overscroll-contain p-2", showDetails && "hidden lg:block")}>
          <div id={listId} role="listbox" aria-label="모델 검색 결과">
          {results.map((model, index) => { const reason = modelDisabledReason(model, requireTools), traits = modelTraits(model); return <button key={model.id} ref={(node) => { if (node) optionNodes.current.set(model.id, node); else optionNodes.current.delete(model.id); }} id={`${listId}-${index}`} type="button" role="option" aria-selected={preview?.id === model.id} aria-disabled={!!reason} tabIndex={preview?.id === model.id ? 0 : -1} className={cn("mb-1 flex w-full min-w-0 items-start gap-3 rounded-md border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", preview?.id === model.id ? "border-primary/40 bg-accent" : "border-transparent hover:bg-secondary", reason && "text-muted-foreground")} onClick={() => setActiveId(model.id)} onFocus={() => setActiveId(model.id)} onKeyDown={navigate}>
            <span className="grid min-w-0 flex-1 gap-1"><strong className="line-clamp-2 text-sm leading-5 font-medium">{model.name}</strong><code className="line-clamp-2 text-xs leading-5 break-all text-muted-foreground">{model.id}</code>{traits.length > 0 && <span className="text-xs leading-5 text-muted-foreground">{traits.slice(0, 3).join(" · ")}</span>}{reason && <span className="text-xs leading-5 text-destructive">{reason}</span>}</span>{model.id === value && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-label="현재 선택" />}
          </button>; })}
          </div>
          {!results.length && <div className="grid gap-3 p-4 sm:p-6"><h3 className="text-sm font-medium">{models.length ? "일치하는 모델이 없습니다" : "조회된 모델이 없습니다"}</h3><HelpText>{models.length ? "이름·ID 또는 검색 조건을 바꿔 보세요." : "연결 화면에서 모델 목록과 계정 상태를 확인하세요."}</HelpText>{(query || reference !== "all" || hideUnavailable && unavailableCount > 0) && <Button variant="secondary" size="sm" onClick={() => { setQuery(""); setReference("all"); setHideUnavailable(false); setActiveId(""); searchInput.current?.focus(); }}>검색 조건 초기화</Button>}</div>}
        </div>
        <aside aria-label="모델 상세" className={cn("min-h-0 overflow-y-auto overscroll-contain border-border bg-background lg:border-l", !showDetails && "hidden lg:block")}>
          <div className="border-b border-border p-3 lg:hidden"><Button variant="ghost" size="sm" onClick={() => { setShowDetails(false); searchInput.current?.focus(); }}><ArrowLeft />목록으로</Button></div>
          {preview ? <><ModelDetails model={preview} providerId={connection?.provider || ""} providerName={providerName} catalog={catalog} connection={connection} />{modelDisabledReason(preview, requireTools) && <div className="p-4"><Notice variant="warning">{modelDisabledReason(preview, requireTools)}</Notice></div>}</> : <HelpText className="p-6">검색 결과에서 모델을 선택하면 상세 정보가 표시됩니다.</HelpText>}
        </aside>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1"><p className="m-0 truncate text-sm font-medium">{preview?.name || "모델을 선택하세요"}</p>{preview && <HelpText className="truncate font-mono" title={preview.id}>{preview.id}</HelpText>}</div><HelpText className="hidden md:block">↑ ↓ 탐색 · Enter 선택 · Esc 닫기</HelpText><div className="flex shrink-0 gap-2"><Button variant="outline" className="lg:hidden" disabled={!preview} onClick={() => setShowDetails(!showDetails)}>{showDetails ? "목록" : "상세"}</Button><Button disabled={!preview || !!modelDisabledReason(preview, requireTools) || disabled} onClick={() => choose(preview)}>선택</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
