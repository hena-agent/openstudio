"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clipboard, Clock3, Code2, ExternalLink, Film, Github, KeyRound, Layers3, LoaderCircle, LockKeyhole, Play, Plug2, Plus, RefreshCw, Search, Settings2, ShieldCheck, Terminal, Unplug, Workflow, X } from "lucide-react";
import type { Catalog, CatalogModel, Connection, DeviceAuthorization } from "@/lib/types";
import { formatTokens } from "@/lib/model-metadata";
import { ModelPicker } from "./model-picker";
import { SelectedModelInfo } from "./model-details";
import { CatalogModelDialog } from "./catalog-model-dialog";

type ServerState = {
  connections: Connection[]; storageReady: boolean; oauthReady: boolean;
  openaiOAuthReady: boolean; frontend?: string; backend?: string;
};
type Auth = { id: string; provider: "openai" | "github-copilot"; expiresAt: number; authorizationUrl?: string; device?: DeviceAuthorization };
type Log = { time: string; message: string; ok: boolean };
type Result = { text: string; model: string; endpoint: string; duration: number };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

const nameOf = (connection: Connection) => connection.provider === "github-copilot" ? "GitHub Copilot" : connection.method === "oauth" ? "ChatGPT" : "OpenAI API";

export function Studio() {
  const [view, setView] = useState<"connections" | "catalog">("connections");
  const [server, setServer] = useState<ServerState>({ connections: [], storageReady: false, oauthReady: false, openaiOAuthReady: false });
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogModel, setCatalogModel] = useState<CatalogModel>();
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [selected, setSelected] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("30초 분량의 제품 소개 영상을 만들려고 해. 제작 과정을 3단계로 제안해 줘.");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Result>();
  const [dialog, setDialog] = useState<"add" | "settings" | null>(null);
  const [provider, setProvider] = useState<"openai" | "github-copilot">("openai");
  const [method, setMethod] = useState<"oauth" | "key">("oauth");
  const [label, setLabel] = useState("OpenAI API");
  const [key, setKey] = useState("");
  const [auth, setAuth] = useState<Auth>();
  const [authMessage, setAuthMessage] = useState("");
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState("all");
  const [page, setPage] = useState(0);
  const modal = useRef<HTMLDialogElement>(null);

  const log = useCallback((message: string, ok = true) => {
    setLogs((previous) => [{ time: new Date().toLocaleTimeString("ko-KR", { hour12: false }), message, ok }, ...previous].slice(0, 50));
  }, []);
  const loadConnections = useCallback(async () => {
    const data = await api<ServerState>("connections");
    setServer(data);
    setSelected((old) => data.connections.some((item) => item.id === old) ? old : data.connections.find((item) => item.status !== "disconnected")?.id || data.connections[0]?.id || "");
    setLoaded(true);
  }, []);
  const loadCatalog = useCallback(async (force = false) => {
    setCatalogError("");
    try { setCatalog(await api<Catalog>("catalog", force ? {} : undefined)); }
    catch (error) { setCatalogError((error as Error).message); }
  }, []);
  useEffect(() => {
    void loadConnections().catch((error) => { setError(error.message); setLoaded(true); });
    void loadCatalog();
  }, [loadConnections, loadCatalog]);
  const connection = server.connections.find((item) => item.id === selected);
  const active = connection && connection.status !== "disconnected";
  const connectedCount = server.connections.filter((item) => item.status !== "disconnected").length;
  useEffect(() => { setResult(undefined); setConsent(false); }, [selected]);
  useEffect(() => { setModel((old) => connection?.models.some((item) => item.id === old) ? old : connection?.models[0]?.id || ""); }, [connection?.models, selected]);
  useEffect(() => { setPage(0); }, [search, modality]);
  useEffect(() => {
    if (dialog && !modal.current?.open) modal.current?.showModal();
    if (!dialog) modal.current?.close();
  }, [dialog]);

  useEffect(() => {
    if (!auth) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() > auth.expiresAt) { setAuth(undefined); setAuthMessage("인증 시간이 만료됐습니다. 다시 로그인하세요."); return; }
      try {
        const response = await api<{ status: string; connectionId?: string; connection?: Connection; error?: string; interval?: number }>("oauth", { action: auth.provider === "openai" ? "openai-status" : "poll", id: auth.id });
        if (stopped) return;
        if (response.status === "connected") {
          await loadConnections();
          if (stopped) return;
          const id = response.connectionId || response.connection?.id;
          if (id) setSelected(id);
          setAuth(undefined); setDialog(null); setAuthMessage("");
          log(`${auth.provider === "openai" ? "ChatGPT" : "GitHub"} 인증 완료. 모델을 조회할 수 있습니다.`);
          return;
        }
        if (["failed", "cancelled", "denied", "expired"].includes(response.status)) { setAuth(undefined); setAuthMessage(response.error || "인증이 중단되었습니다."); log(response.error || "인증 중단", false); return; }
        if (response.error) setAuthMessage(response.error);
        timer = setTimeout(poll, Math.max(response.interval || (auth.provider === "openai" ? 1500 : 5000), 1000));
      } catch (error) {
        if (stopped) return;
        setAuthMessage((error as Error).message);
        timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, auth.provider === "openai" ? 1500 : auth.device?.interval || 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [auth, loadConnections, log]);

  async function run(name: string, work: () => Promise<void>) {
    setBusy(name); setError("");
    try { await work(); }
    catch (error) { setError((error as Error).message); log((error as Error).message, false); }
    finally { setBusy(""); }
  }
  function addConnection(nextProvider: "openai" | "github-copilot" = "openai") {
    setProvider(nextProvider); setMethod("oauth"); setDialog("add"); setError(""); setAuthMessage("");
  }
  async function closeDialog() {
    if (auth) {
      const attempt = auth;
      setAuth(undefined);
      await run("cancel", async () => { await api("oauth", { action: attempt.provider === "openai" ? "openai-cancel" : "cancel", id: attempt.id }); await loadConnections(); });
    }
    setDialog(null); setKey(""); setAuthMessage(""); setError("");
  }
  function startOpenAI(connectionId?: string) {
    // Open synchronously from the click so browser popup policies don't block the login.
    const loginWindow = window.open("about:blank", "_blank", "popup,width=560,height=740");
    if (loginWindow) loginWindow.opener = null;
    setProvider("openai"); setMethod("oauth"); setDialog("add"); setAuthMessage("");
    void run("oauth", async () => {
      try {
        const attempt = await api<{ id: string; expiresAt: number; authorizationUrl: string }>("oauth", { action: "openai-start", connectionId });
        setAuth({ ...attempt, provider: "openai" });
        if (loginWindow) loginWindow.location.href = attempt.authorizationUrl;
        log("ChatGPT OAuth 시작 · OpenStudio 직접 등록 / PKCE");
      } catch (error) { try { loginWindow?.close(); } catch { /* Provider pages can isolate their browsing context. */ } throw error; }
    });
  }
  async function discoverModels() {
    await run("models", async () => {
      await api("connections", { action: "models", id: selected });
      await loadConnections(); log("연결 계정의 모델 목록을 조회했습니다.");
    });
  }
  const filtered = (catalog?.models || []).filter((item) => `${item.name} ${item.id} ${item.provider}`.toLowerCase().includes(search.toLowerCase()) && (modality === "all" || item.output.some((type) => type.includes(modality))));
  const chosenModel = connection?.models.find((item) => item.id === model);
  const steps = [{ title: "계정 인증", done: !!active }, { title: "모델 조회", done: !!active && !!connection?.modelsCheckedAt }, { title: "실제 응답", done: !!active && !!connection?.verifiedAt }];

  return <div className="app">
    <a href="#work-area" className="skip-link">작업 영역으로 이동</a>
    <header className="app-bar"><a className="app-brand" href="/" aria-label="OpenStudio 홈"><Layers3 size={20} /><strong>OpenStudio</strong><span>DEV</span></a><div className="project-name"><span className="project-square" />내 워크스페이스<span className="divider">/</span><span>연결 설정</span></div><div className="app-bar-right"><span className="local-indicator"><i />LOCAL</span><button className="icon-button" aria-label="서버 설정" onClick={() => { setError(""); setDialog("settings"); }}><Settings2 size={16} /></button></div></header>
    <nav className="tool-rail" aria-label="도구"><button className={view === "connections" ? "rail-button active" : "rail-button"} aria-label="연결 관리" title="연결 관리" aria-current={view === "connections" ? "page" : undefined} onClick={() => setView("connections")}><Plug2 size={20} /></button><button className={view === "catalog" ? "rail-button active" : "rail-button"} aria-label="모델 카탈로그" title="모델 카탈로그" aria-current={view === "catalog" ? "page" : undefined} onClick={() => setView("catalog")}><Layers3 size={19} /></button><span className="rail-line" /><button className="rail-button" aria-label="워크플로우 · 준비 중" title="워크플로우 · 준비 중" disabled><Workflow size={19} /></button><button className="rail-button" aria-label="에셋 · 준비 중" title="에셋 · 준비 중" disabled><Film size={19} /></button><div className="rail-bottom"><button className="rail-button" aria-label="환경 설정" title="환경 설정" onClick={() => { setError(""); setDialog("settings"); }}><Settings2 size={19} /></button><span className="user-avatar">OS</span></div></nav>

    <aside className="account-pane"><div className="pane-heading"><h1>연결 계정</h1><span className="number-badge">{connectedCount}</span><button className="icon-button" aria-label="새 연결 추가" onClick={() => addConnection()} disabled={!!busy || !loaded}><Plus size={16} /></button></div><div className="pane-scroll"><div className="list-label">ACCOUNTS</div>{!loaded && <p className="small-loading"><LoaderCircle size={14} className="spin" />불러오는 중</p>}{server.connections.map((item) => <button key={item.id} className={`account-item ${selected === item.id ? "selected" : ""}`} onClick={() => { setSelected(item.id); setView("connections"); }}><span className={`provider-monogram ${item.provider === "github-copilot" ? "github" : ""}`}>{item.provider === "github-copilot" ? <Github size={17} /> : "O"}</span><span className="account-item-copy"><strong>{nameOf(item)}</strong><small title={item.label}>{item.label}</small></span><span className={`account-dot ${item.status === "disconnected" ? "offline" : ""}`} /></button>)}{loaded && !server.connections.length && <div className="no-accounts"><Plug2 size={20} /><p>연결된 계정이 없습니다.</p><span>구독 계정이나 API 키를 추가하세요.</span></div>}<button className="add-account-row" onClick={() => addConnection()} disabled={!!busy || !loaded}><Plus size={14} />연결 추가</button><div className="list-label provider-label">PROVIDERS</div><button className="provider-row" onClick={() => addConnection("openai")}><span className="provider-monogram small">O</span><span>OpenAI<small>ChatGPT 구독 · API 키</small></span><Plus size={14} /></button><button className="provider-row" onClick={() => addConnection("github-copilot")}><span className="provider-monogram small github"><Github size={15} /></span><span>GitHub Copilot<small>Device OAuth</small></span><Plus size={14} /></button></div><div className="environment"><div><span className="environment-dot" /><strong>로컬 개발 서버</strong></div><p><span>FRONT</span><code>{server.frontend ? new URL(server.frontend).port : "—"}</code><span>API</span><code>{server.backend ? new URL(server.backend).port : "—"}</code></p><small><LockKeyhole size={11} />서버 암호화 · 브라우저 세션 격리</small></div></aside>

    <main id="work-area" className="work-area">
      <div className="workspace-tabs"><button className={view === "connections" ? "workspace-tab selected" : "workspace-tab"} onClick={() => setView("connections")}><Terminal size={14} />연결 테스트</button><button className={view === "catalog" ? "workspace-tab selected" : "workspace-tab"} onClick={() => setView("catalog")}><Layers3 size={14} />모델 카탈로그</button><div className="workspace-tabs-end"><span>연결 가능성 검증</span><span className="version">v0.1</span></div></div>
      {error && !dialog && <div className="error-bar" role="alert"><CircleAlert size={15} /><span>{error}</span><button className="icon-button" aria-label="오류 닫기" onClick={() => setError("")}><X size={14} /></button></div>}
      {view === "connections" ? <div className="connection-workspace"><div className="work-toolbar"><div><h2>{connection ? nameOf(connection) : "연결 테스트"}<span className={`connection-state ${active ? "online" : ""}`}><i />{active ? "인증됨" : "연결 대기"}</span></h2><p>{connection ? connection.label : "계정을 연결하고 모델의 실제 응답을 확인하세요."}</p></div><div className="toolbar-actions">{connection && active && <button className="button ghost" disabled={!!busy} onClick={() => void run("disconnect", async () => { const data = await api<{ revoked: boolean }>("connections", { action: "disconnect", id: selected }); await loadConnections(); setResult(undefined); log(data.revoked ? "연결 해제 · OpenAI 세션 폐기 완료" : "저장된 토큰 삭제 완료. 원격 권한 폐기는 확인되지 않았습니다."); })}><Unplug size={14} />연결 해제</button>}{connection?.method === "oauth" && connection.provider === "openai" && <button className="button secondary" disabled={!!busy} onClick={() => startOpenAI(connection.id)}><RefreshCw size={13} />다시 로그인</button>}{!connection && <button className="button secondary" onClick={() => addConnection()} disabled={!loaded}><Plus size={14} />계정 연결</button>}</div></div>
        <div className="verification-strip">{steps.map((step, index) => <div className={step.done ? "step done" : "step"} key={step.title}>{step.done ? <CheckCircle2 size={13} /> : <span className="step-number">{index + 1}</span>}<span>{step.title}</span>{index < 2 && <ArrowRight size={12} className="step-arrow" />}</div>)}<span className="verification-note">각 단계는 별도로 검증됩니다</span></div>
        <div className="test-grid"><section className="request-panel"><div className="panel-bar"><span><Code2 size={14} />요청</span><span className="panel-meta">TEXT / RESPONSES</span></div><div className="request-form">
          <div className="form-label-row"><label htmlFor="model">모델</label><button className="small-button" disabled={!active || !!busy} onClick={() => void discoverModels()}><RefreshCw size={12} className={busy === "models" ? "spin" : ""} />목록 조회</button></div>
          <ModelPicker models={connection?.models || []} value={model} onChange={(id) => { setModel(id); setResult(undefined); setConsent(false); }} connection={connection} catalog={catalog} disabled={!active || !connection?.models.length || !!busy} placeholder={active ? "모델 목록을 먼저 조회하세요" : "계정을 먼저 연결하세요"} />
          {chosenModel && connection && <SelectedModelInfo model={chosenModel} providerId={connection.provider} providerName={connection.provider === "openai" ? "OpenAI" : "GitHub Copilot"} connection={connection} catalog={catalog} />}
          {catalogError && <p className="metadata-note">공개 모델 사양을 불러오지 못했습니다. 계정 API에서 확인한 정보만 표시합니다.</p>}
          <div className="form-label-row prompt-label"><label htmlFor="prompt">프롬프트</label><span>{prompt.length.toLocaleString()} / 4,000</span></div><textarea id="prompt" value={prompt} maxLength={4000} spellCheck={false} onChange={(event) => setPrompt(event.target.value)} /><div className="request-settings"><span><span className="code-dot" />store: false</span><span>{connection?.method === "oauth" && connection.provider === "openai" ? "stream: true" : "text output"}</span></div><div className="run-area"><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>구독 사용량 또는 API 비용을 사용해 실행</span></label><button className="button primary" disabled={!!busy || !active || !model || !consent || !prompt.trim()} onClick={() => void run("invoke", async () => { setResult(undefined); const started = performance.now(); log(`요청 시작 · ${nameOf(connection!)} / ${model}`); const data = await api<Omit<Result, "duration">>("connections", { action: "invoke", id: selected, model, prompt, consent: true }); await loadConnections(); setResult({ ...data, duration: performance.now() - started }); log(`응답 완료 · ${data.model} · ${((performance.now() - started) / 1000).toFixed(2)}s`); })}>{busy === "invoke" ? <LoaderCircle className="spin" size={13} /> : <Play size={13} fill="currentColor" />}실행</button></div></div></section>
          <section className="response-panel" aria-label="모델 응답"><div className="panel-bar"><span><Terminal size={14} />응답</span>{result ? <button className="icon-button" aria-label="응답 복사" onClick={() => void navigator.clipboard.writeText(result.text).then(() => log("응답을 복사했습니다.")).catch(() => setError("클립보드에 접근할 수 없습니다."))}><Clipboard size={13} /></button> : <span className="panel-meta">OUTPUT</span>}</div>{result ? <div className="response-body"><div className="result-meta"><span><CheckCircle2 size={12} />완료</span><code>{result.model}</code><span>{(result.duration / 1000).toFixed(2)}s</span></div><div className="response-text">{result.text}</div><div className="endpoint-label">POST {result.endpoint}</div></div> : <div className="output-placeholder">{busy === "invoke" ? <LoaderCircle size={24} className="spin" /> : <Terminal size={25} strokeWidth={1.3} />}<strong>{busy === "invoke" ? "모델 응답 수신 중" : "응답 대기 중"}</strong><p>{busy === "invoke" ? "완료 이벤트까지 확인한 뒤 결과를 표시합니다." : "모델을 선택하고 요청을 실행하세요."}</p>{!active && <button className="small-button" onClick={() => addConnection()}>계정 연결<ArrowRight size={12} /></button>}</div>}</section></div>
        <section className="execution-log"><div className="panel-bar"><span><Clock3 size={13} />실행 기록<span className="log-count">{logs.length}</span></span><button className="small-button" onClick={() => setLogs([])} disabled={!logs.length}>지우기</button></div><div className="log-scroll" role="log" aria-label="실행 기록">{logs.length ? logs.map((item, index) => <div className={`log-row ${item.ok ? "" : "failed"}`} key={`${item.time}-${index}`}><time>{item.time}</time>{item.ok ? <Check size={12} /> : <CircleAlert size={12} />}<span>{item.message}</span></div>) : <div className="log-empty"><span>—</span>아직 실행 기록이 없습니다.</div>}</div></section>
      </div> : <section className="catalog-workspace"><div className="catalog-toolbar"><label className="search-input"><Search size={14} /><input aria-label="모델 검색" placeholder="모델, 제공자 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="출력 유형" value={modality} onChange={(event) => setModality(event.target.value)}><option value="all">모든 출력</option><option value="text">텍스트</option><option value="image">이미지</option><option value="video">영상</option><option value="audio">오디오</option></select><button className="button secondary" disabled={!!busy} onClick={() => void run("catalog", () => loadCatalog(true))}><RefreshCw size={13} className={busy === "catalog" ? "spin" : ""} />새로고침</button></div><div className="catalog-caption"><span>{catalog ? `${filtered.length.toLocaleString()}개 모델 · models.dev` : "카탈로그 불러오는 중"}</span><span>{catalog ? `${catalog.stale ? "마지막 정상 데이터 · " : ""}${new Date(catalog.updatedAt).toLocaleString("ko-KR")}` : ""}</span></div>{catalogError && <div className="error-bar" role="alert">{catalogError}</div>}
        <div className="table-scroll"><table><thead><tr><th>모델 / ID</th><th>제공자</th><th>컨텍스트</th><th>최대 출력</th><th>입력 → 출력</th><th>상세 정보</th></tr></thead><tbody>{filtered.slice(page * 50, page * 50 + 50).map((item) => <tr key={item.id}><td><button className="catalog-model-button" onClick={() => setCatalogModel(item)}><strong>{item.name}</strong><code>{item.id}</code></button></td><td>{item.provider}</td><td className="token-cell">{formatTokens(item.metadata?.context, true)}</td><td className="token-cell">{formatTokens(item.metadata?.maxOutput, true)}</td><td><span className="catalog-inputs">{item.input.join(", ") || "미확인"}</span><span className="catalog-output-arrow">→</span>{item.output.map((type) => <span className={`modality ${type.includes("video") ? "video" : ""}`} key={type}>{type}</span>)}</td><td><button className="small-button" aria-label={`${item.provider} ${item.name} 상세 정보`} onClick={() => setCatalogModel(item)}>사양·가격<ArrowUpRight size={13} /></button></td></tr>)}</tbody></table>{catalog && !filtered.length && <div className="catalog-empty">검색 결과가 없습니다.</div>}</div><div className="pagination"><span>카탈로그 등록과 실제 호출 권한은 별개입니다.</span><div><button className="icon-button" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage((old) => old - 1)}><ChevronLeft size={16} /></button><span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 50))}</span><button className="icon-button" aria-label="다음 페이지" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage((old) => old + 1)}><ChevronRight size={16} /></button></div></div></section>}
    </main><footer className="status-bar"><span><ShieldCheck size={11} />{server.storageReady ? "인증 저장소 준비됨" : "인증 저장소 확인 중"}</span><span>{connectedCount} accounts<span className="status-divider">│</span>{catalog ? `${catalog.models.length.toLocaleString()} catalog models` : "catalog loading"}</span><span className="status-end">OpenStudio / local development</span></footer>

    <dialog className="connection-dialog" ref={modal} aria-label={dialog === "settings" ? "환경 설정" : "계정 연결"} onCancel={(event) => { event.preventDefault(); if (busy !== "oauth" && busy !== "key") void closeDialog(); }}><div className="dialog-heading"><h2>{dialog === "settings" ? "환경 설정" : "계정 연결"}</h2><button className="icon-button" aria-label="대화상자 닫기" disabled={busy === "oauth" || busy === "key"} onClick={() => void closeDialog()}><X size={17} /></button></div>
      {dialog === "settings" ? <div className="settings-content"><h3>개발 서버</h3><div className="settings-row"><span>프런트엔드</span><code>{server.frontend || "—"}</code></div><div className="settings-row"><span>백엔드</span><code>{server.backend || "—"}</code></div><div className="settings-row"><span>OAuth callback</span><code>{server.backend ? `${server.backend}/auth/callback` : "—"}</code></div><p className="field-help">실행할 때마다 프런트는 3001–3999, 백엔드는 4001–4999의 빈 포트를 선택합니다.</p><h3>인증 저장소</h3><p className="field-help">{server.storageReady ? "AES-256-GCM 암호화 준비 완료. 로컬 개발 키는 .data/master.key에 보관됩니다." : "OPENSTUDIO_ENCRYPTION_KEY 설정을 확인하세요."}</p><h3>GitHub Copilot</h3><p className="field-help"><code>GITHUB_COPILOT_CLIENT_ID</code>에 사용할 OAuth 앱의 client ID를 설정하세요. Device flow와 Copilot API 권한이 필요합니다.</p><a className="small-button" href="https://developers.openai.com/siwc/token-sharing-open-source/sign-in" target="_blank" rel="noreferrer">ChatGPT 구독 연결 문서<ExternalLink size={12} /></a></div> : <div className="dialog-body">{!auth && <><label className="field-label" htmlFor="provider">제공자</label><select id="provider" value={provider} disabled={!!busy} onChange={(event) => { setProvider(event.target.value as typeof provider); setError(""); setAuthMessage(""); }}><option value="openai">OpenAI</option><option value="github-copilot">GitHub Copilot</option></select>{provider === "openai" && <div className="method-tabs" role="tablist" aria-label="인증 방식"><button role="tab" aria-selected={method === "oauth"} className={method === "oauth" ? "selected" : ""} disabled={!!busy} onClick={() => { setMethod("oauth"); setError(""); }}>ChatGPT 구독 · OAuth</button><button role="tab" aria-selected={method === "key"} className={method === "key" ? "selected" : ""} disabled={!!busy} onClick={() => { setMethod("key"); setError(""); }}>API 키</button></div>}</>}
        {error && <div className="dialog-error" role="alert"><CircleAlert size={14} /><span>{error}</span></div>}
        {auth ? <div className="authorization"><div className="auth-status"><LoaderCircle size={17} className="spin" /><h3>{auth.provider === "openai" ? "ChatGPT 로그인 대기" : "GitHub 승인 대기"}</h3></div>{auth.device ? <><p>아래 코드를 GitHub 인증 페이지에 입력하세요.</p><div className="device-code"><code>{auth.device.userCode}</code><button className="icon-button" aria-label="인증 코드 복사" onClick={() => void navigator.clipboard.writeText(auth.device!.userCode).catch(() => setAuthMessage("코드를 직접 복사해 주세요."))}><Clipboard size={16} /></button></div><a className="button secondary full" target="_blank" rel="noreferrer" href={auth.device.verificationUri}>GitHub 인증 열기<ArrowUpRight size={14} /></a></> : <><p>새 창에서 ChatGPT에 로그인하고 <strong>OpenStudio</strong>의 구독 사용 권한을 승인하세요.</p><a className="button secondary full" href={auth.authorizationUrl} target="_blank" rel="noreferrer">로그인 창 다시 열기<ArrowUpRight size={14} /></a></>}<p className="auth-expiry">{new Date(auth.expiresAt).toLocaleTimeString("ko-KR")}까지 유효 · 승인 후 자동 반영</p></div> : provider === "openai" && method === "oauth" ? <div className="oauth-content"><h3>ChatGPT 계정으로 연결</h3><p>OpenStudio를 앱으로 등록하고, 계정에서 허용한 모델을 구독 사용량으로 호출합니다.</p><div className="auth-detail"><ShieldCheck size={14} /><span>OpenAI 공식 직접 등록 · PKCE · 서버 토큰 저장</span></div><button className="button chatgpt-button full" data-oai-siwc-button disabled={!!busy || !server.openaiOAuthReady} onClick={() => startOpenAI()}>{busy === "oauth" ? <LoaderCircle size={15} className="spin" /> : null}Continue with ChatGPT<ArrowUpRight size={15} /></button><p className="field-help">브라우저가 OpenAI 인증 페이지를 엽니다. 승인 전에는 모델 생성 요청을 보내지 않습니다.</p></div> : provider === "openai" ? <form className="key-form" onSubmit={(event) => { event.preventDefault(); void run("key", async () => { await api("connections", { action: "add-key", key, label }); setKey(""); setDialog(null); await loadConnections(); log("OpenAI API 키 검증 및 모델 목록 조회 완료"); }); }}><label htmlFor="key-name" className="field-label">연결 이름</label><input id="key-name" required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /><label htmlFor="api-key" className="field-label">API 키</label><input id="api-key" type="password" autoComplete="off" required minLength={10} maxLength={1000} placeholder="sk-…" value={key} onChange={(event) => setKey(event.target.value)} /><p className="field-help">키를 서버에 암호화해 저장합니다. ChatGPT 구독과 별도 과금됩니다.</p><button className="button primary full" disabled={!!busy || !server.storageReady} type="submit">{busy === "key" ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}키 검증하고 연결</button></form> : <div className="oauth-content"><h3>GitHub Copilot 연결</h3><p>Device flow로 GitHub 계정을 인증합니다. 로그인과 Copilot 모델 권한을 별도로 확인합니다.</p>{!server.oauthReady && <div className="inline-warning"><CircleAlert size={14} /><span>서버에 GITHUB_COPILOT_CLIENT_ID 설정이 필요합니다.</span></div>}<button className="button secondary full" disabled={!!busy || !server.oauthReady} onClick={() => void run("oauth", async () => { const device = await api<DeviceAuthorization>("oauth", { action: "start" }); setAuth({ id: device.id, provider: "github-copilot", expiresAt: device.expiresAt, device }); log("GitHub device 인증 시작"); })}><Github size={15} />GitHub로 로그인</button></div>}{authMessage && <div className="dialog-error" role="status">{authMessage}</div>}</div>}
      <div className="dialog-footer"><LockKeyhole size={12} /><span>비밀값은 브라우저 저장소에 보관하지 않습니다.</span></div>
    </dialog>
    <CatalogModelDialog model={catalogModel} catalog={catalog} onClose={() => setCatalogModel(undefined)} />
  </div>;
}
