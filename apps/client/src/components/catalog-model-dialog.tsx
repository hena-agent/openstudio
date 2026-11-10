"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Catalog, CatalogModel } from "@/lib/types";
import { ModelDetails } from "./model-details";

export function CatalogModelDialog({ model, catalog, onClose }: { model?: CatalogModel; catalog?: Catalog; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (model && !dialog.current?.open) dialog.current?.showModal(); else if (!model) dialog.current?.close(); }, [model]);
  return <dialog className="catalog-model-dialog" ref={dialog} aria-label="카탈로그 모델 상세" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="dialog-heading"><h2>모델 정보</h2><button className="icon-button" aria-label="모델 정보 닫기" onClick={onClose}><X size={18} /></button></div>{model && <ModelDetails model={{ id: model.modelId || model.id.slice(model.id.indexOf("/") + 1), name: model.name, endpoints: [] }} providerId={model.providerId || model.id.split("/")[0]} providerName={model.provider} catalog={catalog} reference={model} />}<div className="dialog-footer">카탈로그 정보입니다. 실제 호출 가능 여부는 연결 계정과 실행 어댑터에서 확인합니다.</div></dialog>;
}
