"use client";

import { ChevronDown, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";
import type { Catalog, CatalogModel, Connection, Model, ModelMetadata } from "@/lib/types";
import { formatCapability, formatPrice, formatTokens, resolveModelMetadata } from "@/lib/model-metadata";

export type ModelDetailsProps = {
  model: Model;
  providerId: string;
  providerName: string;
  catalog?: Catalog;
  connection?: Connection;
  reference?: CatalogModel;
};

export function ModelDetails(props: ModelDetailsProps) {
  const { model, catalog, connection, providerName } = props;
  const { values, sources, reference } = resolveModelMetadata(model, props.providerId, catalog, props.reference);
  function fact(field: keyof ModelMetadata, label: string, value: ReactNode) {
    const source = sources[field];
    const referenceValue = reference?.metadata?.[field];
    const differentLimit = ["context", "maxInput", "maxOutput"].includes(field) && source === "provider" && typeof referenceValue === "number" && referenceValue !== values[field];
    return <div className="model-fact" key={field}>
      <dt>{label}</dt>
      <dd><span>{value}</span>{source && <small className={`fact-source ${source}`}>{source === "provider" ? "계정 API" : "models.dev"}</small>}{differentLimit && <small className="reference-limit">참고 사양 {formatTokens(referenceValue)}</small>}</dd>
    </div>;
  }
  const pricing = values.pricing;
  return <div className="model-details-content">
    <header className="model-details-heading"><h3>{model.name}</h3><code>{model.id}</code></header>
    {values.description && <p className="model-description">{values.description}</p>}
    <dl className="model-facts">
      <div className="model-fact"><dt>제공자</dt><dd>{providerName}</dd></div>
      {connection && <div className="model-fact"><dt>연결 방식</dt><dd>{connection.method === "oauth" ? "구독 · OAuth" : "API 키"}</dd></div>}
      {fact("context", "컨텍스트", <>{formatTokens(values.context)}{values.context ? <small className="fact-unit">tokens</small> : null}</>)}
      {fact("maxInput", "최대 입력", formatTokens(values.maxInput))}
      {fact("maxOutput", "최대 출력", formatTokens(values.maxOutput))}
      {fact("input", "입력 유형", values.input?.join(", ") || "미확인")}
      {fact("output", "출력 유형", values.output?.join(", ") || "미확인")}
      {fact("reasoning", "추론", formatCapability(values.reasoning))}
      {fact("tools", "도구 호출", formatCapability(values.tools))}
      {fact("structuredOutput", "구조화 출력", formatCapability(values.structuredOutput))}
      {fact("temperature", "Temperature 설정", formatCapability(values.temperature))}
    </dl>

    <section className="model-pricing" aria-label="API 참고 가격">
      <div className="model-subheading"><h4>API 참고 가격</h4><span>USD / 1M tokens · 기본 단가</span></div>
      <dl className="model-facts">
        <div className="model-fact"><dt>입력 / 출력</dt><dd>{formatPrice(pricing?.input)}<span className="price-divider"> / </span>{formatPrice(pricing?.output)}</dd></div>
        <div className="model-fact"><dt>캐시 읽기 / 쓰기</dt><dd>{formatPrice(pricing?.cacheRead)}<span className="price-divider"> / </span>{formatPrice(pricing?.cacheWrite)}</dd></div>
        {pricing?.tiers?.map((tier, index) => <div className="model-fact" key={`${tier.contextAbove}-${index}`}><dt>컨텍스트 {formatTokens(tier.contextAbove)} 초과<small>입력 / 출력</small></dt><dd>{formatPrice(tier.input)}<span className="price-divider"> / </span>{formatPrice(tier.output)}</dd></div>)}
      </dl>
      <p className="metadata-note">{connection?.method === "oauth" ? "구독 연결에는 계정의 사용량·정책이 적용됩니다. 위 API 단가는 구독 청구 금액이 아닙니다." : "공개 기본 단가입니다. 제공자·컨텍스트·요청 옵션에 따라 실제 비용이 달라질 수 있습니다."}</p>
      {!pricing && <p className="metadata-note">이 모델의 토큰 단가가 등록되지 않았습니다. 미디어 모델은 초·이미지 등 별도 과금 단위를 사용할 수 있습니다.</p>}
    </section>

    <dl className="model-facts model-extra-facts">
      {values.family && fact("family", "모델 계열", values.family)}
      {values.releaseDate && fact("releaseDate", "출시일", values.releaseDate)}
      {values.knowledge && fact("knowledge", "지식 기준일", values.knowledge)}
      {values.openWeights !== undefined && fact("openWeights", "가중치 공개", values.openWeights ? "공개" : "비공개")}
      {!!model.endpoints.length && <div className="model-fact"><dt>호출 경로</dt><dd><code>{model.endpoints.join(", ")}</code></dd></div>}
    </dl>
    <div className="metadata-provenance"><Info size={14} /><div><p>계정 API가 제공한 값이 우선합니다. 나머지는 공개 참고 사양이며, 정보가 없는 항목은 추정하지 않습니다.</p>{model.metadataUpdatedAt && <p>계정 조회: {new Date(model.metadataUpdatedAt).toLocaleString("ko-KR")}</p>}{reference && catalog && <p>카탈로그: {new Date(catalog.updatedAt).toLocaleString("ko-KR")}{catalog.stale ? " · 마지막 정상 데이터" : ""}</p>}{!reference && <p>동일 제공자·모델 ID의 카탈로그 항목을 찾지 못했습니다.</p>}{reference && <a href={`https://models.dev/providers/${encodeURIComponent(props.providerId)}`} target="_blank" rel="noreferrer">models.dev 출처<ExternalLink size={12} /></a>}</div></div>
  </div>;
}

export function SelectedModelInfo(props: ModelDetailsProps) {
  const { values, sources } = resolveModelMetadata(props.model, props.providerId, props.catalog);
  return <div className="selected-model-info">
    <dl className="model-quick-facts"><div><dt>컨텍스트</dt><dd>{formatTokens(values.context, true)}</dd></div><div><dt>최대 출력</dt><dd>{formatTokens(values.maxOutput, true)}</dd></div><div><dt>입력</dt><dd>{values.input?.join(" · ") || "미확인"}</dd></div></dl>
    <div className="model-quick-source">{sources.context === "provider" ? "컨텍스트: 계정 API 확인" : sources.context === "catalog" ? "컨텍스트: models.dev 참고 사양" : "컨텍스트 정보 미확인"}</div>
    <details className="model-details" key={props.model.id}><summary>사양·기능·가격<ChevronDown size={14} /></summary><ModelDetails {...props} /></details>
  </div>;
}
