"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Clipboard, Github, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { PROVIDERS, providerDefinition } from "@/lib/provider-registry";
import type { DeviceAuthorization, ProviderId } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ActionBar, FormField, FormSection, HelpText, IconButton, Notice, SectionHeader } from "./studio/primitives";

export type PendingAuth = { id: string; provider: "openai" | "github-copilot" | "openrouter"; expiresAt: number; authorizationUrl?: string; device?: DeviceAuthorization };
type Props = {
  open: boolean; initialProvider: ProviderId; busy: string; error: string; auth?: PendingAuth; authMessage: string;
  storageReady: boolean; copilotReady: boolean; keyOnly?: boolean; providerLocked?: boolean;
  onClose: () => void; onOAuth: (provider: PendingAuth["provider"]) => void;
  onKey: (provider: ProviderId, label: string, key: string) => void;
};
export function ConnectionDialog(props: Props) {
  const [provider, setProvider] = useState<ProviderId>(props.initialProvider), [method, setMethod] = useState("oauth"), [label, setLabel] = useState(""), [key, setKey] = useState("");
  const definition = providerDefinition(provider), waiting = !!props.auth, locked = !!props.busy;
  useEffect(() => {
    if (props.open) { setProvider(props.initialProvider); setMethod(props.keyOnly ? "api-key" : providerDefinition(props.initialProvider).methods[0]); setKey(""); setLabel(""); }
    else setKey("");
  }, [props.open, props.initialProvider, props.keyOnly]);
  function changeProvider(id: ProviderId) { setProvider(id); setMethod(providerDefinition(id).methods[0]); setKey(""); }
  return <Dialog open={props.open} onOpenChange={(open) => { if (!open && !locked) props.onClose(); }}><DialogContent closeDisabled={locked} onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }} onInteractOutside={(event) => { if (locked) event.preventDefault(); }}>
    <DialogHeader><DialogTitle className="text-lg font-semibold">{props.keyOnly ? "API 키 갱신" : "계정 연결"}</DialogTitle><DialogDescription>{definition.description}</DialogDescription></DialogHeader>
    {!waiting && <FormSection title="연결 방식" disabled={locked}>
      <FormField label="제공자" id="provider"><NativeSelect value={provider} disabled={locked || props.keyOnly || props.providerLocked} onChange={(event) => changeProvider(event.target.value as ProviderId)}>{PROVIDERS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</NativeSelect></FormField>
      <ActionBar aria-label="인증 방식">{definition.methods.filter((value) => !props.keyOnly || value === "api-key").map((value) => <Button key={value} variant={method === value ? "secondary" : "outline"} disabled={locked} aria-pressed={method === value} onClick={() => setMethod(value)}>{value === "oauth" ? "OAuth 로그인" : "API 키"}</Button>)}</ActionBar>
    </FormSection>}
    {props.error && <Notice variant="error">{props.error}</Notice>}
    {props.auth ? <div className="grid gap-4"><SectionHeader level={3} title={<><LoaderCircle className="animate-spin" />{props.auth.provider === "openrouter" ? "OpenRouter 승인 대기" : props.auth.provider === "openai" ? "ChatGPT 로그인 대기" : "GitHub 승인 대기"}</>} />
      {props.auth.device ? <><HelpText>아래 코드를 GitHub 인증 페이지에 입력하세요.</HelpText><div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-4"><code className="font-mono text-lg">{props.auth.device.userCode}</code><IconButton label="인증 코드 복사" onClick={() => void navigator.clipboard.writeText(props.auth!.device!.userCode)}><Clipboard /></IconButton></div><Button variant="secondary" asChild><a href={props.auth.device.verificationUri} target="_blank" rel="noreferrer">GitHub 인증 열기<ArrowUpRight /></a></Button></> : <><HelpText>새 창에서 로그인하고 OpenStudio의 연결을 승인하세요.</HelpText><Button variant="secondary" asChild><a href={props.auth.authorizationUrl} target="_blank" rel="noreferrer">로그인 창 다시 열기<ArrowUpRight /></a></Button></>}
      <HelpText>{new Date(props.auth.expiresAt).toLocaleTimeString("ko-KR")}까지 유효 · 승인 후 자동 반영</HelpText>
    </div> : method === "oauth" ? <div className="grid gap-4"><SectionHeader level={3} title={provider === "openrouter" ? "OpenRouter 계정으로 연결" : provider === "openai" ? "ChatGPT 계정으로 연결" : "GitHub Copilot 연결"} />
      <HelpText>{provider === "openrouter" ? "로그인 후 사용자 소유의 API 키를 발급받아 서버에 저장합니다. 생성 비용은 OpenRouter 크레딧에 적용됩니다." : provider === "openai" ? "OpenStudio를 앱으로 등록하고 허용한 모델을 ChatGPT 구독 사용량으로 호출합니다." : "Device flow로 GitHub를 인증하고 Copilot 모델 권한을 별도로 확인합니다."}</HelpText>
      <HelpText className="flex items-start gap-2"><ShieldCheck className="mt-1 size-3.5 shrink-0" />{provider === "openrouter" ? "공식 OAuth PKCE · API 크레딧 사용 · 서버 저장" : provider === "openai" ? "공식 직접 등록 · PKCE · 서버 저장" : "서버에 GITHUB_COPILOT_CLIENT_ID 설정 필요"}</HelpText>
      <Button className={provider === "openai" ? "border-white bg-white text-black hover:bg-white/90" : undefined} data-oai-siwc-button={provider === "openai" ? "" : undefined} disabled={locked || !props.storageReady || provider === "github-copilot" && !props.copilotReady} onClick={() => props.onOAuth(provider as PendingAuth["provider"])}>{locked ? <LoaderCircle className="animate-spin" /> : provider === "github-copilot" ? <Github /> : null}{provider === "openai" ? "Continue with ChatGPT" : provider === "openrouter" ? "OpenRouter로 로그인" : "GitHub로 로그인"}<ArrowUpRight /></Button>
    </div> : <form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); props.onKey(provider, label.trim() || definition.name, key); }}>
      <FormSection title="API 인증" disabled={locked}><FormField label="연결 이름" id="key-label"><Input value={label} maxLength={80} placeholder={definition.name} onChange={(event) => setLabel(event.target.value)} /></FormField><FormField label="API 키" id="api-key"><Input type="password" required autoComplete="off" minLength={10} maxLength={1000} value={key} onChange={(event) => setKey(event.target.value)} /></FormField></FormSection>
      {provider === "anthropic" && <HelpText>Claude Console API 키를 사용합니다. Claude.ai 구독 OAuth는 공식 조건상 이 앱에서 직접 제공하지 않습니다.</HelpText>}
      {provider === "fal" && <HelpText>fal API 키로 연결하면 이미지·영상 모델을 조회하고 작업 화면에서 검색·선택할 수 있습니다.</HelpText>}
      {provider === "byteplus" && <HelpText>ModelArk API 키로 연결하면 계정의 모델 목록을 조회합니다. 현재 지원 리전은 Singapore입니다.</HelpText>}
      <HelpText>모델 조회로 연결을 확인합니다. 유료 생성 요청은 실행 버튼을 누를 때만 전송합니다.</HelpText><Button type="submit" disabled={locked || !props.storageReady || !key.trim()}>{locked ? <LoaderCircle className="animate-spin" /> : <KeyRound />}{locked ? "API 키·모델 목록 확인 중…" : props.keyOnly ? "키 검증하고 갱신" : "키 검증하고 연결"}</Button>
    </form>}
    {props.authMessage && <Notice variant="warning">{props.authMessage}</Notice>}
    <HelpText className="flex items-start gap-2 border-t border-border pt-6"><LockKeyhole className="mt-1 size-3.5 shrink-0" />인증 정보는 서버에 암호화해 저장합니다.</HelpText>
  </DialogContent></Dialog>;
}
