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
  if (props.model.media) return <MediaModelDetails {...props} />;
  const { model, catalog, connection, providerName } = props;
  const { values, sources, reference } = resolveModelMetadata(model, props.providerId, catalog, props.reference);
  function fact(field: keyof ModelMetadata, label: string, value: ReactNode) {
    const source = sources[field];
    const referenceValue = reference?.metadata?.[field];
    const differentLimit = ["context", "maxInput", "maxOutput"].includes(field) && source === "provider" && typeof referenceValue === "number" && referenceValue !== values[field];
    return <div className="model-fact" key={field}>
      <dt>{label}</dt>
      <dd><span>{value}</span>{source && <small className={`fact-source ${source}`}>{source === "provider" ? "계정 API" : source === "provider-catalog" ? "제공자 공개 목록" : "models.dev"}</small>}{differentLimit && <small className="reference-limit">참고 사양 {formatTokens(referenceValue)}</small>}</dd>
    </div>;
  }
  const pricing = values.pricing;
  return <div className="model-details-content">
    <header className="model-details-heading"><h3>{model.name}</h3><code>{model.id}</code></header>
    {values.description && <p className="model-description">{values.description}</p>}
    <dl className="model-facts">
      <div className="model-fact"><dt>제공자</dt><dd>{providerName}</dd></div>
      {connection && <div className="model-fact"><dt>연결 방식</dt><dd>{connection.method === "oauth" ? connection.provider === "openrouter" ? "OAuth · API 크레딧" : "구독 · OAuth" : "API 키"}</dd></div>}
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
      <p className="metadata-note">{connection?.method === "oauth" && connection.provider !== "openrouter" ? "구독 연결에는 계정의 사용량·정책이 적용됩니다. 위 API 단가는 구독 청구 금액이 아닙니다." : "공개 기본 단가입니다. 제공자·컨텍스트·요청 옵션에 따라 실제 비용이 달라질 수 있습니다."}</p>
      {!pricing && <p className="metadata-note">이 모델의 토큰 단가가 등록되지 않았습니다. 미디어 모델은 초·이미지 등 별도 과금 단위를 사용할 수 있습니다.</p>}
    </section>

    <dl className="model-facts model-extra-facts">
      {values.family && fact("family", "모델 계열", values.family)}
      {values.releaseDate && fact("releaseDate", "출시일", values.releaseDate)}
      {values.knowledge && fact("knowledge", "지식 기준일", values.knowledge)}
      {values.openWeights !== undefined && fact("openWeights", "가중치 공개", values.openWeights ? "공개" : "비공개")}
      {!!model.endpoints.length && <div className="model-fact"><dt>호출 경로</dt><dd><code>{model.endpoints.join(", ")}</code></dd></div>}
    </dl>
    <div className="metadata-provenance"><Info size={14} /><div><p>{model.metadataSource === "provider-catalog" ? "제공자의 공개 모델 사양입니다. 계정별 실행 권한과 실제 제한을 보장하지 않습니다." : "계정 API가 제공한 값이 우선합니다. 나머지는 공개 참고 사양이며, 정보가 없는 항목은 추정하지 않습니다."}</p>{model.metadataUpdatedAt && <p>{model.metadataSource === "provider-catalog" ? "제공자 목록 조회" : "계정 조회"}: {new Date(model.metadataUpdatedAt).toLocaleString("ko-KR")}</p>}{reference && catalog && <p>카탈로그: {new Date(catalog.updatedAt).toLocaleString("ko-KR")}{catalog.stale ? " · 마지막 정상 데이터" : ""}</p>}{!reference && <p>동일 제공자·모델 ID의 카탈로그 항목을 찾지 못했습니다.</p>}{reference && <a href={`https://models.dev/providers/${encodeURIComponent(props.providerId)}`} target="_blank" rel="noreferrer">models.dev 출처<ExternalLink size={12} /></a>}</div></div>
  </div>;
}

export function SelectedModelInfo(props: ModelDetailsProps) {
  const { values, sources } = resolveModelMetadata(props.model, props.providerId, props.catalog);
  if (props.model.media) return <div className="selected-model-info"><dl className="model-quick-facts"><div><dt>작업</dt><dd>{props.model.media.kind === "image" ? "이미지" : "영상"}</dd></div><div><dt>해상도</dt><dd>{props.model.media.resolutions?.join(" / ") || "모델별 옵션"}</dd></div><div><dt>참조 이미지</dt><dd>{props.model.media.reference === "required" ? "필수" : props.model.media.reference === "optional" ? "선택" : "미지원"}</dd></div></dl><details className="model-details" key={props.model.id}><summary>미디어 옵션·과금 정보<ChevronDown size={14} /></summary><MediaModelDetails {...props} /></details></div>;
  return <div className="selected-model-info">
    <dl className="model-quick-facts"><div><dt>컨텍스트</dt><dd>{formatTokens(values.context, true)}</dd></div><div><dt>최대 출력</dt><dd>{formatTokens(values.maxOutput, true)}</dd></div><div><dt>입력</dt><dd>{values.input?.join(" · ") || "미확인"}</dd></div></dl>
    <div className="model-quick-source">{sources.context === "provider" ? "컨텍스트: 계정 API 확인" : sources.context === "provider-catalog" ? "컨텍스트: 제공자 공개 모델 사양" : sources.context === "catalog" ? "컨텍스트: models.dev 참고 사양" : "컨텍스트 정보 미확인"}</div>
    <details className="model-details" key={props.model.id}><summary>사양·기능·가격<ChevronDown size={14} /></summary><ModelDetails {...props} /></details>
  </div>;
}

function MediaModelDetails({ model, providerName, connection }: ModelDetailsProps) {
  const media = { ...model.media!, pricing: model.media!.pricing?.map((price) => ({ ...price, unit: price.label ? `${price.label} / ${price.unit}` : price.unit })) };
  const byteplus = connection?.provider === "byteplus";
  return <div className="model-details-content">
    <header className="model-details-heading"><h3>{model.name}</h3><code>{model.id}</code></header>
    {model.metadata?.description && <p className="model-description">{model.metadata.description}</p>}
    {model.unavailableReason && <p className="inline-warning">{model.unavailableReason}</p>}
    {model.registration && <p className="metadata-note">사용자가 등록한 호출 ID입니다. 기반 모델 매핑과 endpoint 사용 권한은 미확인입니다.{model.registration.baseModelId ? ` 설정한 기반 모델: ${model.registration.baseModelId}` : ""}</p>}
    <dl className="model-facts">
      <div className="model-fact"><dt>제공자</dt><dd>{providerName}</dd></div>
      {connection && <div className="model-fact"><dt>연결</dt><dd>{connection.method === "oauth" ? "OAuth · API 크레딧" : "API 키"}</dd></div>}
      {connection?.byteplus && <div className="model-fact"><dt>리전</dt><dd>{connection.byteplus.region}</dd></div>}
      <div className="model-fact"><dt>작업</dt><dd>{media.kind === "video" ? "영상 생성" : "이미지 생성·편집"}</dd></div>
      <div className="model-fact"><dt>해상도</dt><dd>{media.resolutions?.join(", ") || (byteplus ? "모델별 지원값 확인 후 입력" : "endpoint 옵션 조회 필요")}</dd></div>
      <div className="model-fact"><dt>화면비</dt><dd>{media.aspectRatios?.join(", ") || (byteplus ? "ratio 옵션 · 모델별 확인" : "endpoint 옵션 조회 필요")}</dd></div>
      {media.kind === "video" && <div className="model-fact"><dt>길이 (초)</dt><dd>{media.durations?.join(", ") || "모델별 옵션"}</dd></div>}
      <div className="model-fact"><dt>참조 이미지</dt><dd>{media.reference === "required" ? "필수" : media.reference === "optional" ? "선택" : "미지원"}{media.maxReferences ? ` · 최대 ${media.maxReferences}장` : ""}</dd></div>
      <div className="model-fact"><dt>오디오 생성</dt><dd>{formatCapability(media.generateAudio)}</dd></div>
      {!!model.endpoints.length && <div className="model-fact"><dt>호출 경로</dt><dd><code>{model.endpoints.join(", ")}</code></dd></div>}
    </dl>
    {media.parameters && <><h4 className="media-facts-title">{byteplus ? "공통 API 필드 · 모델별 지원값 확인 필요" : "endpoint 옵션"}</h4><dl className="model-facts">{Object.entries(media.parameters).map(([name, parameter]) => <div className="model-fact" key={name}><dt>{name}</dt><dd>{byteplus && parameter.type === "range" ? "앱 입력 범위 " : ""}{parameter.values?.join(", ") || (parameter.type === "string" ? "직접 입력" : parameter.type === "boolean" ? "true / false" : `${parameter.min ?? "—"} ~ ${parameter.max ?? "—"}`)}</dd></div>)}</dl></>}
    <h4 className="media-facts-title">제공자 과금 단위</h4>
    {media.pricing?.length ? <dl className="model-facts">{media.pricing.map((price, index) => <div className="model-fact" key={index}><dt>{price.unit}</dt><dd>{price.amount} {price.currency}</dd></div>)}</dl> : <p className="metadata-note">현재 endpoint의 가격을 확인하지 못했습니다. 토큰·초·해상도·이미지 등 과금 단위는 제공자에서 확인하세요.</p>}
    <p className="metadata-note">{byteplus ? "표시한 옵션은 ModelArk 공통 요청 규격입니다. API 키로 모델을 조회한 것과 개별 endpoint 실행 성공은 다릅니다." : "공개 카탈로그의 기능과 현재 endpoint·계정에서 실행 가능한 기능은 다를 수 있습니다. 미디어 실행 옵션은 제공자 명세로 검증합니다."}</p>
  </div>;
}
