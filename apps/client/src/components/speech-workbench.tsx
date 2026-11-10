"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, Search } from "lucide-react";
import { studioApi } from "@/lib/client-api";
import type { Connection, MediaJob, Model, Voice } from "@/lib/types";
import { JobResults, useMediaJobs } from "./media-workbench";

export function SpeechWorkbench({ connection, model, jobs }: { connection: Connection; model: Model; jobs: ReturnType<typeof useMediaJobs> }) {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const requestId = useRef("");
  useEffect(() => { requestId.current = ""; }, [text, voice]);
  async function loadVoices(next?: string) {
    setLoadingVoices(true); setError("");
    try {
      const data = await studioApi<{ voices: Voice[]; nextCursor?: string }>("models", { action: "voices", connectionId: connection.id, search, cursor: next });
      setVoices((old) => next ? [...old, ...data.voices] : data.voices); setCursor(data.nextCursor);
    } catch (error) { setError((error as Error).message); }
    finally { setLoadingVoices(false); }
  }
  useEffect(() => { void loadVoices(); }, [connection.id]);
  const job = jobs.jobs.find((item) => item.id === jobId) || jobs.jobs.find((item) => item.kind === "audio" && item.connectionId === connection.id && item.model === model.id);
  return <div className="test-grid"><section className="request-panel"><div className="panel-bar">음성 원고 · TTS</div><div className="request-form">
    <label htmlFor="voice-search">보이스 찾기</label><div className="voice-search"><input id="voice-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="보이스 이름 검색" /><button className="small-button" disabled={loadingVoices} onClick={() => void loadVoices()}><Search size={14} />검색</button></div>
    <label htmlFor="speech-voice">보이스</label><select id="speech-voice" value={voice} onChange={(event) => setVoice(event.target.value)}><option value="">{loadingVoices ? "보이스 조회 중" : "보이스를 선택하세요"}</option>{voices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{cursor && <button className="small-button" disabled={loadingVoices} onClick={() => void loadVoices(cursor)}>보이스 더 보기</button>}
    <label className="prompt-label" htmlFor="speech-text">읽을 텍스트</label><textarea id="speech-text" value={text} maxLength={Math.min(model.speech?.maxCharacters || 4000, 4000)} onChange={(event) => setText(event.target.value)} placeholder="내레이션으로 읽을 원고를 입력하세요." /><p className="field-help">최대 {Math.min(model.speech?.maxCharacters || 4000, 4000).toLocaleString()}자 · 입력한 언어로 AI 음성을 생성하고 MP3로 저장합니다.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}<div className="run-area"><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />이 계정의 크레딧으로 음성 생성 실행</label><button className="button primary" disabled={busy || !voice || !text.trim() || !consent || connection.status === "disconnected"} onClick={async () => {
      setBusy(true); setError("");
      try { requestId.current ||= crypto.randomUUID(); const data = await studioApi<{ job: MediaJob }>("jobs", { action: "create", requestId: requestId.current, connectionId: connection.id, model: model.id, kind: "audio", prompt: text, options: { voice }, consent: true }); setJobId(data.job.id); requestId.current = ""; setConsent(false); await jobs.reload(); }
      catch (error) { setError((error as Error).message); } finally { setBusy(false); }
    }}>{busy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}음성 생성</button></div>
  </div></section><section className="response-panel"><div className="panel-bar">음성 결과</div><div className="media-output">{job ? <><p className="field-help">{job.modelName} · {job.status === "completed" ? "완료 · AI 생성 음성" : job.status === "failed" ? "실패" : job.status === "unknown" ? "제출 결과 미확인" : "생성 중"}</p>{job.error && <p className="dialog-error">{job.error}</p>}<JobResults job={job} /></> : <div className="output-placeholder"><strong>음성 결과 대기 중</strong><p>생성한 음성을 재생하고 다운로드할 수 있습니다.</p></div>}</div></section></div>;
}
