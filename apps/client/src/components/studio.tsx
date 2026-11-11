"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Clipboard, Clock3, Code2, Layers3, LoaderCircle, Play, Plug2, RefreshCw, Terminal, Workflow, X } from "lucide-react";
import type { Catalog, Connection, DeviceAuthorization, ProviderId, TaskKind } from "@/lib/types";
import { modelTasks, PROVIDERS, providerDefinition, providerName } from "@/lib/provider-registry";
import { studioApi as api } from "@/lib/client-api";
import { SelectedModelInfo } from "./model-details";
import { ModelPicker } from "./model-picker";
import { ConnectionDialog, type PendingAuth } from "./connection-dialog";
import { MediaWorkbench, MediaHistory, useMediaJobs } from "./media-workbench";
import { SpeechWorkbench } from "./speech-workbench";
import { FalModelSearch } from "./fal-model-search";
import { ConnectionBadge, ProviderConnectionCard } from "./provider-connection-card";
import { ProductionStudio } from "./production-studio";
import { WorkspaceTabs } from "./workspace-tabs";

type ServerState = { connections: Connection[]; storageReady: boolean; oauthReady: boolean; frontend?: string; backend?: string };
type TextRun = { id: string; model: string; prompt: string; text: string; createdAt: string };
const taskNames: Record<TaskKind, string> = { text: "텍스트", audio: "음성", image: "이미지", video: "영상" };

export function Studio() {
  const [view, setView] = useState<"studio" | "work" | "jobs" | "connections">("studio");
  const [server, setServer] = useState<ServerState>({ connections: [], storageReady: false, oauthReady: false });
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [textRuns, setTextRuns] = useState<TextRun[]>([]);
  const [task, setTask] = useState<TaskKind>("text");
  const [historyTab, setHistoryTab] = useState<"all" | "media" | "text">("all");
  const [accountId, setAccountId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{ text: string; model: string; duration: number }>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [keyConnectionId, setKeyConnectionId] = useState("");
  const [auth, setAuth] = useState<PendingAuth>();
  const [authMessage, setAuthMessage] = useState("");
  const [checkingId, setCheckingId] = useState("");
  const [notice, setNotice] = useState<{ message: string; connectionId?: string }>();
  const mediaJobs = useMediaJobs(loaded && server.storageReady);

  const loadConnections = useCallback(async () => {
    const data = await api<ServerState>("connections"); setServer(data); setLoaded(true); return data;
  }, []);
  const loadHistory = useCallback(async () => { const data = await api<{ textRuns: TextRun[] }>("models"); setTextRuns(data.textRuns); }, []);
  const refreshConnection = useCallback(async () => { await loadConnections(); }, [loadConnections]);
  useEffect(() => {
    void loadConnections().then(loadHistory).catch((error) => { setError(error.message); setLoaded(true); });
    void api<Catalog>("catalog").then(setCatalog).catch(() => {});
  }, [loadConnections, loadHistory]);
  useEffect(() => { if (view === "connections" && loaded) void loadConnections().catch((error) => setError(error.message)); }, [view, loaded, loadConnections]);
  useEffect(() => { setResult(undefined); setConsent(false); }, [accountId, modelId, task]);
  useEffect(() => {
    if (window.matchMedia("(max-width: 600px)").matches) document.querySelector(".account-item.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [accountId]);
  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name); setError(""); setNotice(undefined);
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function refreshModels(id: string) {
    setCheckingId(id);
    try {
      const data = await api<{ connection: Connection }>("connections", { action: "models", id }); await loadConnections();
      setNotice({ message: `${providerName(data.connection.provider)} 연결 확인 완료 — 모델 ${data.connection.models.length.toLocaleString()}개를 조회했습니다.`, connectionId: id });
      return data.connection;
    } catch (error) { await loadConnections().catch(() => {}); throw error; }
    finally { setCheckingId(""); }
  }
  function chooseAccount(connection: Connection) {
    if (!(providerDefinition(connection.provider).tasks as readonly TaskKind[]).includes(task)) setTask(providerDefinition(connection.provider).tasks[0]);
    setAccountId(connection.id); setModelId(""); setView("work");
  }
  function connect(id: ProviderId) { setKeyConnectionId(""); setProvider(id); setError(""); setNotice(undefined); setAuthMessage(""); setDialogOpen(true); }
  async function connected(id?: string) {
    const updatedKey = !!keyConnectionId;
    const data = await loadConnections();
    setDialogOpen(false); setAuth(undefined); setAuthMessage(""); setKeyConnectionId("");
    let connection = data.connections.find((item) => item.id === id);
    if (connection) {
      setAccountId(connection.id); setModelId(""); setView("connections");
      if (!connection.modelsCheckedAt) {
        try { connection = await refreshModels(connection.id); }
        catch (error) { setError((error as Error).message); }
      }
      setNotice({ message: `${providerName(connection.provider)} ${updatedKey ? "API 키 갱신 완료" : "연결 완료"}${connection.modelsCheckedAt ? ` — 모델 ${connection.models.length.toLocaleString()}개를 조회했습니다.` : " — 인증이 완료됐습니다. 모델 목록을 다시 확인하세요."}`, connectionId: connection.id });
    }
  }
  const connectedHandler = useRef(connected); connectedHandler.current = connected;
  useEffect(() => {
    if (!auth) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() > auth.expiresAt) { setAuth(undefined); setAuthMessage("인증 시간이 만료됐습니다. 다시 로그인하세요."); return; }
      try {
        const data = await api<{ status: string; connectionId?: string; connection?: Connection; error?: string; interval?: number }>("oauth", { action: auth.provider === "github-copilot" ? "poll" : `${auth.provider}-status`, id: auth.id });
        if (stopped) return;
        if (data.status === "connected") { await connectedHandler.current(data.connectionId || data.connection?.id); return; }
        if (["failed", "cancelled", "denied", "expired"].includes(data.status)) { setAuth(undefined); setAuthMessage(data.error || "인증이 중단되었습니다."); return; }
        if (data.error) setAuthMessage(data.error);
        timer = setTimeout(poll, Math.max(data.interval || (auth.provider === "github-copilot" ? 5000 : 2000), 1000));
      } catch (error) { if (!stopped) { setAuthMessage((error as Error).message); timer = setTimeout(poll, 5000); } }
    };
    timer = setTimeout(poll, auth.device?.interval || 2000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [auth]);
  function startOAuth(id: PendingAuth["provider"], connectionId?: string) {
    const popup = id === "github-copilot" ? null : window.open("about:blank", "_blank", "popup,width=560,height=740");
    if (popup) popup.opener = null;
    setKeyConnectionId(""); setProvider(id); setDialogOpen(true); setAuthMessage("");
    void run("oauth", async () => {
      try {
        if (id === "github-copilot") {
          const device = await api<DeviceAuthorization>("oauth", { action: "start" }); setAuth({ id: device.id, provider: id, expiresAt: device.expiresAt, device });
        } else {
          const attempt = await api<{ id: string; expiresAt: number; authorizationUrl: string }>("oauth", { action: `${id}-start`, ...(id === "openai" && connectionId ? { connectionId } : {}) });
          setAuth({ ...attempt, provider: id }); if (popup) popup.location.href = attempt.authorizationUrl;
        }
      } catch (error) { try { popup?.close(); } catch {} throw error; }
    });
  }
  async function closeConnectionDialog() {
    if (auth) { const pending = auth; setAuth(undefined); await run("cancel", async () => { await api("oauth", { action: pending.provider === "github-copilot" ? "cancel" : `${pending.provider}-cancel`, id: pending.id }); }); }
    setDialogOpen(false); setKeyConnectionId(""); setError(""); setAuthMessage("");
  }
  const availableAccounts = server.connections.filter((item) => item.status !== "disconnected" && (providerDefinition(item.provider).tasks as readonly TaskKind[]).includes(task));
  const connection = availableAccounts.find((item) => item.id === accountId);
  const models = (connection?.models || []).filter((item) => modelTasks(item).includes(task));
  const model = models.find((item) => item.id === modelId);
  const connectedCount = server.connections.filter((item) => item.status !== "disconnected").length;
  const pendingCount = mediaJobs.jobs.filter((job) => !["completed", "failed", "unknown"].includes(job.status)).length;
  const workKey = `${connection?.id}:${task}:${model?.id}`;
  const sortedProviders = [...PROVIDERS].sort((a, b) => Number(server.connections.some((item) => item.provider === b.id && item.status !== "disconnected")) - Number(server.connections.some((item) => item.provider === a.id && item.status !== "disconnected")));
  const noticeConnection = server.connections.find((item) => item.id === notice?.connectionId);

  return <div className={`app model-centric provider-centric ${view === "studio" ? "has-production" : ""}`}><a href="#work-area" className="skip-link">작업 영역으로 이동</a>
    <header className="app-bar"><a className="app-brand" href="/" aria-label="OpenStudio 홈"><Layers3 size={20} /><strong>OpenStudio</strong></a><div className="project-name">내 워크스페이스<span className="divider">/</span>{view === "studio" ? "제작 스튜디오" : view === "connections" ? "프로바이더 연결" : view === "jobs" ? "작업 기록" : "모델 실행"}</div></header>
    <nav className="tool-rail" aria-label="도구">
      <button className={`rail-button ${view === "studio" ? "active" : ""}`} aria-current={view === "studio" ? "page" : undefined} aria-label="제작 스튜디오" onClick={() => setView("studio")}><Workflow size={20} /></button>
      <button className={`rail-button ${view === "connections" ? "active" : ""}`} aria-current={view === "connections" ? "page" : undefined} aria-label="프로바이더 연결" onClick={() => setView("connections")}><Plug2 size={20} /></button>
      <button className={`rail-button ${view === "work" ? "active" : ""}`} aria-current={view === "work" ? "page" : undefined} aria-label="모델 실행" onClick={() => setView("work")}><Terminal size={20} /></button>
      <button className={`rail-button ${view === "jobs" ? "active" : ""}`} aria-current={view === "jobs" ? "page" : undefined} aria-label="작업 기록" onClick={() => { setView("jobs"); void run("history", loadHistory); }}><Clock3 size={20} />{pendingCount > 0 && <span className="rail-job-count">{pendingCount}</span>}</button>
    </nav>
    <aside className="account-pane"><div className="pane-heading"><h1>연결 계정</h1><span className="number-badge">{connectedCount}</span></div><div className="pane-scroll">{!loaded && <p className="small-loading"><LoaderCircle size={14} className="spin" />불러오는 중</p>}{server.connections.map((item) => <button key={item.id} className={`account-item ${accountId === item.id ? "selected" : ""}`} onClick={() => item.status === "disconnected" || item.connectionIssue ? setView("connections") : chooseAccount(item)}><span className="account-item-copy"><strong>{providerName(item.provider)}</strong><small>{item.label}</small><ConnectionBadge connection={item} checking={checkingId === item.id} /><small>{item.models.length}개 모델 · {item.method === "oauth" ? "OAuth" : "API 키"}</small></span></button>)}{loaded && !server.connections.length && <p className="field-help sidebar-empty">프로바이더를 연결하면 계정과 모델 목록이 표시됩니다.</p>}</div><button className="sidebar-settings" onClick={() => setView("connections")}><Plug2 size={15} />프로바이더 연결 관리</button></aside>
    <main id="work-area" className="work-area">
      {view === "work" && <WorkspaceTabs id="model-execution" label="모델 실행 유형" tabs={(Object.keys(taskNames) as TaskKind[]).map((kind) => ({ id: kind, label: taskNames[kind], disabled: !!busy }))} value={task} onChange={(kind) => { setTask(kind as TaskKind); setModelId(""); }} />}
      {view === "jobs" && <WorkspaceTabs id="history" label="작업 기록 종류" tabs={[{ id: "all", label: "전체" }, { id: "media", label: "미디어" }, { id: "text", label: "텍스트" }]} value={historyTab} onChange={(value) => setHistoryTab(value as typeof historyTab)} />}
      {error && !dialogOpen && <div className="error-bar" role="alert"><CircleAlert size={15} /><span>{error}</span><button className="icon-button" aria-label="오류 닫기" onClick={() => setError("")}><X size={14} /></button></div>}
      {notice && <div className="connection-notice" role="status"><CheckCircle2 size={18} /><strong>{notice.message}</strong>{noticeConnection && <button className="button primary" onClick={() => { chooseAccount(noticeConnection); setNotice(undefined); }}>모델 선택하기</button>}<button className="icon-button" aria-label="완료 메시지 닫기" onClick={() => setNotice(undefined)}><X size={14} /></button></div>}
      <div className="production-host" hidden={view !== "studio"}><ProductionStudio active={view === "studio"} ready={loaded && server.storageReady} connections={server.connections} onConnections={() => setView("connections")} /></div>
      {view === "connections" && <section className="account-settings"><h1 className="page-title">프로바이더 연결</h1><p className="field-help">계정을 연결한 뒤 작업 화면에서 해당 계정의 모델을 선택하세요.</p><div className="provider-connection-grid">{sortedProviders.map((definition) => <ProviderConnectionCard key={definition.id} definition={definition} connections={server.connections.filter((item) => item.provider === definition.id)} busy={!!busy} checkingId={checkingId} connecting={dialogOpen && provider === definition.id && (!!auth || busy === "key" || busy === "oauth")} loaded={loaded} ready={server.storageReady} onChoose={chooseAccount} onRefresh={(id) => void run("models", () => refreshModels(id))} onUpdateKey={(item) => { setKeyConnectionId(item.id); setProvider(item.provider); setError(""); setDialogOpen(true); }} onOAuth={(item) => startOAuth(item.provider as PendingAuth["provider"], item.id)} onDisconnect={(id) => void run("disconnect", async () => { await api("connections", { action: "disconnect", id }); await loadConnections(); setNotice({ message: "연결을 해제했습니다." }); })} onConnect={connect} />)}</div><details className="server-details"><summary>개발 서버 · 저장소</summary><p className="field-help">프런트 {server.frontend}<br />백엔드 {server.backend}<br />인증 정보와 실행 기록은 서버에 세션별로 저장됩니다.</p></details></section>}
      {view === "work" && <div className="connection-workspace" role="tabpanel" id={`model-execution-panel-${task}`} aria-labelledby={`model-execution-tab-${task}`}><div className="work-toolbar"><div><h2>{taskNames[task]} 모델 실행</h2><p>연결 계정과 모델을 선택하세요.</p></div></div>
        <div className="execution-selection"><div><label htmlFor="execution-account">프로바이더 · 연결 계정</label><select id="execution-account" value={connection?.id || ""} disabled={!!busy} onChange={(event) => { setAccountId(event.target.value); setModelId(""); }}><option value="">연결 계정을 선택하세요</option>{availableAccounts.map((item) => <option key={item.id} value={item.id}>{providerName(item.provider)} · {item.label}</option>)}</select></div><div><label htmlFor="model">모델</label><ModelPicker id="model" models={models} value={modelId} onChange={setModelId} connection={connection} catalog={catalog} disabled={!connection || !!busy} placeholder={!connection ? "계정을 먼저 선택하세요" : !models.length ? "이 유형의 모델이 조회되지 않았습니다" : "모델 검색·선택"} /></div>{connection && <button className="small-button" disabled={!!busy} onClick={() => void run("models", () => refreshModels(connection.id))}><RefreshCw size={14} />모델 새로고침</button>}</div>
        {!availableAccounts.length && <p className="field-help">이 작업 유형에 연결된 계정이 없습니다. <button className="small-button" onClick={() => setView("connections")}>프로바이더 연결</button></p>}
        {connection?.provider === "fal" && (task === "image" || task === "video") && <FalModelSearch key={`${connection.id}:${task}`} connection={connection} kind={task} onSelect={(model, updated) => { setServer((old) => ({ ...old, connections: old.connections.map((item) => item.id === updated.id ? updated : item) })); setModelId(model.id); }} />}
        {modelId && connection && !model && <p className="inline-warning">선택한 모델이 최신 목록에 없습니다. 모델을 다시 조회하거나 다른 모델을 선택하세요.</p>}
        {model && connection ? <><details className="model-specs"><summary>{model.name} · 사양 · 가격 · 출처</summary><SelectedModelInfo model={model} providerId={connection.provider} providerName={providerName(connection.provider)} connection={connection} catalog={catalog} /></details>
          {task === "audio" ? <SpeechWorkbench key={workKey} connection={connection} model={model} jobs={mediaJobs} /> : task !== "text" ? <MediaWorkbench key={workKey} kind={task} connection={connection} model={model} models={models} onSelect={setModelId} catalog={catalog} jobs={mediaJobs} refreshConnection={refreshConnection} /> : <div className="test-grid"><section className="request-panel"><div className="panel-bar"><span><Code2 size={15} />텍스트 요청</span></div><div className="request-form"><label htmlFor="prompt">프롬프트</label><textarea id="prompt" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder="모델에게 요청할 내용을 입력하세요." /><div className="run-area"><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />구독 사용량 또는 API 비용을 사용해 실행</label><button className="button primary" disabled={!!busy || !consent || !prompt.trim() || model.callable === false} onClick={() => void run("invoke", async () => {
            setResult(undefined); const started = performance.now(); const data = await api<{ text: string; model: string }>("connections", { action: "invoke", id: connection.id, model: model.id, prompt, consent: true }); setResult({ ...data, duration: performance.now() - started }); setConsent(false); await loadConnections(); await loadHistory();
          })}>{busy === "invoke" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}실행</button></div></div></section><section className="response-panel"><div className="panel-bar"><span>텍스트 결과</span>{result && <button className="icon-button" aria-label="결과 복사" onClick={() => void navigator.clipboard.writeText(result.text)}><Clipboard size={15} /></button>}</div>{result ? <div className="text-result"><p className="field-help">{result.model} · {(result.duration / 1000).toFixed(1)}초</p><pre>{result.text}</pre></div> : <div className="output-placeholder"><Code2 size={28} /><strong>{busy === "invoke" ? "응답 생성 중" : "텍스트 결과 대기 중"}</strong></div>}</section></div>}
        </> : <div className="model-empty-state"><Layers3 size={28} /><h2>{connection ? "실행할 모델을 선택하세요." : "연결 계정을 선택하세요."}</h2><p>{connection ? "조회된 모델을 선택하면 입력과 실행 옵션이 표시됩니다." : "프로바이더 연결 화면에서 계정을 연결할 수 있습니다."}</p></div>}
      </div>}
      {view === "jobs" && <div className="jobs-workspace" role="tabpanel" id={`history-panel-${historyTab}`} aria-labelledby={`history-tab-${historyTab}`}><h1 className="page-title">작업 기록</h1>{historyTab !== "text" && <MediaHistory jobs={mediaJobs.jobs} error={mediaJobs.error} refresh={mediaJobs.reload} />}{historyTab !== "media" && <section className="text-history"><h2>텍스트 작업</h2>{!textRuns.length && <p className="field-help">텍스트 실행 결과가 여기에 저장됩니다.</p>}{textRuns.map((run) => <details className="media-job-card" key={run.id}><summary>{run.model} · {new Date(run.createdAt).toLocaleString("ko-KR")}</summary><p>{run.prompt}</p><pre>{run.text}</pre></details>)}</section>}</div>}
    </main><footer className="status-bar"><span>{server.storageReady ? "로컬 워크스페이스" : "저장소 확인 중"}</span><span>{connectedCount}개 연결 · {pendingCount}개 진행 중</span></footer>
    <ConnectionDialog open={dialogOpen} providerLocked keyOnly={!!keyConnectionId} initialProvider={provider} busy={busy} error={error} auth={auth} authMessage={authMessage} storageReady={server.storageReady} copilotReady={server.oauthReady} onClose={() => void closeConnectionDialog()} onOAuth={startOAuth} onKey={(id, label, key) => void run("key", async () => {
      const data = await api<{ connection: Connection }>("connections", keyConnectionId ? { action: "update-key", id: keyConnectionId, key } : { action: "add-key", provider: id, label, key }); await connected(data.connection.id);
    })} />
  </div>;
}
