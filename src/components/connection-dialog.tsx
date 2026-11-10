"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clipboard, Github, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { PROVIDERS, providerDefinition } from "@/lib/provider-registry";
import type { DeviceAuthorization, ProviderId } from "@/lib/types";

export type PendingAuth = { id: string; provider: "openai" | "github-copilot" | "openrouter"; expiresAt: number; authorizationUrl?: string; device?: DeviceAuthorization };
type Props = {
  open: boolean; initialProvider: ProviderId; busy: string; error: string; auth?: PendingAuth; authMessage: string;
  storageReady: boolean; copilotReady: boolean; keyOnly?: boolean; providerLocked?: boolean;
  onClose: () => void; onOAuth: (provider: PendingAuth["provider"]) => void;
  onKey: (provider: ProviderId, label: string, key: string) => void;
};
export function ConnectionDialog(props: Props) {
  const modal = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<ProviderId>(props.initialProvider);
  const [method, setMethod] = useState("oauth");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const definition = providerDefinition(provider);
  useEffect(() => {
    if (props.open) {
      setProvider(props.initialProvider); setMethod(props.keyOnly ? "api-key" : providerDefinition(props.initialProvider).methods[0]); setKey(""); setLabel("");
      if (!modal.current?.open) modal.current?.showModal();
    } else { modal.current?.close(); setKey(""); }
  }, [props.open, props.initialProvider, props.keyOnly]);
  function changeProvider(id: ProviderId) { setProvider(id); setMethod(providerDefinition(id).methods[0]); setKey(""); }
  const waiting = !!props.auth, locked = !!props.busy;
  return <dialog ref={modal} className="connection-dialog" aria-label="계정 연결" onCancel={(event) => { event.preventDefault(); if (!locked) props.onClose(); }}>
    <div className="dialog-heading"><h2>{props.keyOnly ? "API 키 갱신" : "계정 연결"}</h2><button className="icon-button" aria-label="대화상자 닫기" disabled={locked} onClick={props.onClose}><X size={17} /></button></div>
    <div className="dialog-body">
      {!waiting && <><label className="field-label" htmlFor="provider">제공자</label><select id="provider" value={provider} disabled={locked || props.keyOnly || props.providerLocked} onChange={(event) => changeProvider(event.target.value as ProviderId)}>{PROVIDERS.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.tasks.join(" / ")}</option>)}</select><p className="field-help">{definition.description}</p><div className="method-tabs" aria-label="인증 방식">{definition.methods.filter((value) => !props.keyOnly || value === "api-key").map((value) => <button key={value} className={method === value ? "selected" : ""} disabled={locked} aria-pressed={method === value} onClick={() => setMethod(value)}>{value === "oauth" ? "OAuth 로그인" : "API 키"}</button>)}</div></>}
      {props.error && <p className="dialog-error" role="alert">{props.error}</p>}
      {props.auth ? <div className="authorization"><div className="auth-status"><LoaderCircle size={17} className="spin" /><h3>{props.auth.provider === "openrouter" ? "OpenRouter 승인 대기" : props.auth.provider === "openai" ? "ChatGPT 로그인 대기" : "GitHub 승인 대기"}</h3></div>{props.auth.device ? <><p>아래 코드를 GitHub 인증 페이지에 입력하세요.</p><div className="device-code"><code>{props.auth.device.userCode}</code><button className="icon-button" aria-label="인증 코드 복사" onClick={() => void navigator.clipboard.writeText(props.auth!.device!.userCode)}><Clipboard size={16} /></button></div><a className="button secondary full" href={props.auth.device.verificationUri} target="_blank" rel="noreferrer">GitHub 인증 열기<ArrowUpRight size={14} /></a></> : <><p>새 창에서 로그인하고 OpenStudio의 연결을 승인하세요.</p><a className="button secondary full" href={props.auth.authorizationUrl} target="_blank" rel="noreferrer">로그인 창 다시 열기<ArrowUpRight size={14} /></a></>}<p className="auth-expiry">{new Date(props.auth.expiresAt).toLocaleTimeString("ko-KR")}까지 유효 · 승인 후 자동 반영</p></div> : method === "oauth" ? <div className="oauth-content">
        <h3>{provider === "openrouter" ? "OpenRouter 계정으로 연결" : provider === "openai" ? "ChatGPT 계정으로 연결" : "GitHub Copilot 연결"}</h3>
        <p>{provider === "openrouter" ? "로그인 후 사용자 소유의 API 키를 발급받아 서버에 저장합니다. 생성 비용은 OpenRouter 크레딧에 적용됩니다." : provider === "openai" ? "OpenStudio를 앱으로 등록하고 허용한 모델을 ChatGPT 구독 사용량으로 호출합니다." : "Device flow로 GitHub를 인증하고 Copilot 모델 권한을 별도로 확인합니다."}</p>
        <div className="auth-detail"><ShieldCheck size={14} /><span>{provider === "openrouter" ? "공식 OAuth PKCE · API 크레딧 사용 · 서버 저장" : provider === "openai" ? "공식 직접 등록 · PKCE · 서버 저장" : "서버에 GITHUB_COPILOT_CLIENT_ID 설정 필요"}</span></div>
        <button className={`button full ${provider === "openai" ? "chatgpt-button" : "secondary"}`} data-oai-siwc-button={provider === "openai" ? "" : undefined} disabled={locked || !props.storageReady || provider === "github-copilot" && !props.copilotReady} onClick={() => props.onOAuth(provider as PendingAuth["provider"])}>{locked ? <LoaderCircle size={15} className="spin" /> : provider === "github-copilot" ? <Github size={15} /> : null}{provider === "openai" ? "Continue with ChatGPT" : provider === "openrouter" ? "OpenRouter로 로그인" : "GitHub로 로그인"}<ArrowUpRight size={15} /></button>
      </div> : <form className="key-form" onSubmit={(event) => { event.preventDefault(); props.onKey(provider, label.trim() || definition.name, key); }}>
        <label className="field-label" htmlFor="key-label">연결 이름</label><input id="key-label" value={label} maxLength={80} placeholder={definition.name} onChange={(event) => setLabel(event.target.value)} />
        <label className="field-label" htmlFor="api-key">API 키</label><input id="api-key" type="password" required autoComplete="off" minLength={10} maxLength={1000} value={key} onChange={(event) => setKey(event.target.value)} />
        {provider === "anthropic" && <p className="field-help">Claude Console API 키를 사용합니다. Claude.ai 구독 OAuth는 공식 조건상 이 앱에서 직접 제공하지 않습니다.</p>}
        {provider === "fal" && <p className="field-help">fal API 키로 연결하면 이미지·영상 모델을 조회하고 작업 화면에서 검색·선택할 수 있습니다.</p>}
        {provider === "byteplus" && <p className="field-help">ModelArk API 키로 연결하면 계정의 모델 목록을 조회합니다. 현재 지원 리전은 Singapore입니다.</p>}
        <p className="field-help">모델 조회로 연결을 확인합니다. 유료 생성 요청은 실행 버튼을 누를 때만 전송합니다.</p><button className="button primary full" disabled={locked || !props.storageReady || !key.trim()} type="submit">{locked ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}{locked ? "API 키·모델 목록 확인 중…" : props.keyOnly ? "키 검증하고 갱신" : "키 검증하고 연결"}</button>
      </form>}
      {props.authMessage && <p className="dialog-error" role="status">{props.authMessage}</p>}
    </div><div className="dialog-footer"><LockKeyhole size={12} />인증 정보는 서버에 암호화해 저장합니다.</div>
  </dialog>;
}
