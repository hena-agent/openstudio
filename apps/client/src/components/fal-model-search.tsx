"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { studioApi } from "@/lib/client-api";
import type { Connection, FalCatalogPage, Model } from "@/lib/types";
import { ModelPicker } from "./model-picker";

export function FalModelSearch({ connection, kind, onSelect }: { connection: Connection; kind: "image" | "video"; onSelect: (model: Model, connection: Connection) => void }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("text");
  const [page, setPage] = useState<FalCatalogPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(connection);
  useEffect(() => { latest.current = connection; }, [connection]);
  const sequence = useRef(0);
  useEffect(() => { sequence.current++; setPage(undefined); setError(""); setBusy(false); return () => { sequence.current++; }; }, [connection.id, kind, query, mode]);
  async function search(cursor?: string) {
    const request = ++sequence.current; setBusy(true); setError("");
    try {
      const data = await studioApi<FalCatalogPage & { connection: Connection }>("connections", { action: "search-models", id: connection.id, query, category: `${mode}-to-${kind}`, cursor });
      if (request !== sequence.current) return;
      latest.current = data.connection;
      setPage((old) => ({ ...data, models: cursor ? [...(old?.models || []), ...data.models] : data.models }));
    } catch (error) { if (request === sequence.current) setError((error as Error).message); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  return <details className="fal-discovery"><summary>fal.ai 전체 모델 검색</summary><form className="fal-discovery-controls" onSubmit={(event) => { event.preventDefault(); void search(); }}><label>모델 검색<input value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} placeholder="모델 이름 검색" /></label><label>입력 방식<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="text">텍스트</option><option value="image">참조 이미지</option></select></label><button className="button secondary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}검색</button></form>{error && <p className="dialog-error" role="alert">{error}</p>}{page && <div className="grid gap-3"><p className="field-help">조회한 모델 {page.models.length.toLocaleString()}개</p><ModelPicker label="전체 검색 결과 모델 선택" models={page.models} value="" connection={latest.current} disabled={busy} placeholder="전체 검색 결과에서 모델 선택" onChange={(id) => { const model = page.models.find((item) => item.id === id); if (model) onSelect(model, latest.current); }} /></div>}{page?.nextCursor && <button className="small-button" disabled={busy} onClick={() => void search(page.nextCursor)}>더 보기</button>}</details>;
}
