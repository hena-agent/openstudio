"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, ImageIcon, LoaderCircle, Play, RefreshCw, Upload, X } from "lucide-react";
import type { Asset, Catalog, Connection, MediaJob, Model } from "@/lib/types";
import { providerName } from "@/lib/provider-registry";
import { studioApi } from "@/lib/client-api";

export function useMediaJobs(ready: boolean) {
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const data = await studioApi<{ jobs: MediaJob[]; assets: Asset[] }>("jobs");
    setJobs(data.jobs); setAssets(data.assets); setError("");
  }, []);
  useEffect(() => {
    if (!ready) return;
    let stopped = false, running = false;
    const tick = async () => {
      if (running) return; running = true;
      try {
        if (!stopped) await reload();
      } catch (error) { if (!stopped) setError((error as Error).message); }
      finally { running = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 8000);
    return () => { stopped = true; clearInterval(timer); };
  }, [ready, reload]);
  return { jobs, assets, reload, error };
}

const statusNames: Record<MediaJob["status"], string> = { queued: "실행 대기", submitting: "제출 중", pending: "대기", running: "생성 중", downloading: "결과 저장 중", completed: "완료", failed: "실패", unknown: "제출 결과 미확인" };
export function JobResults({ job }: { job: MediaJob }) {
  return <div className="job-results">{job.warning && <p className="metadata-note" role="status">{job.warning}</p>}{job.assets.map((asset) => <figure key={asset.id}>{asset.kind === "audio" ? <audio controls preload="metadata" src={`/api/assets?id=${asset.id}`} aria-label="AI가 생성한 음성" /> : asset.kind === "video" ? <video controls playsInline preload="metadata" src={`/api/assets?id=${asset.id}`} aria-label="생성된 영상" /> : <img src={`/api/assets?id=${asset.id}`} alt="모델이 생성한 이미지" loading="lazy" />}<figcaption><span>{asset.mime} · {(asset.size / 1024 / 1024).toFixed(2)} MB</span><a className="small-button" href={`/api/assets?id=${asset.id}&download=1`}><Download size={13} />다운로드</a></figcaption></figure>)}</div>;
}
export function MediaHistory({ jobs, error, refresh }: { jobs: MediaJob[]; error: string; refresh: () => Promise<void> }) {
  return <section className="media-history"><div className="section-title"><h2>미디어 작업</h2><button className="small-button" onClick={() => void refresh()}><RefreshCw size={14} />새로고침</button></div>{error && <p className="dialog-error" role="alert">{error}</p>}{!jobs.length && <p className="metadata-note">이미지·영상 생성 작업을 실행하면 기록과 결과가 표시됩니다.</p>}{jobs.map((job) => <article className="media-job-card" key={job.id}><header><span className={`job-status ${job.status}`}>{!["completed", "failed", "unknown"].includes(job.status) && <LoaderCircle className="spin" size={13} />}{statusNames[job.status]}</span><strong>{job.modelName}</strong><span>{providerName(job.provider)}</span><time>{new Date(job.createdAt).toLocaleString("ko-KR")}</time></header><p className="job-prompt">{job.prompt}</p>{job.externalId && <p className="metadata-note">외부 작업 ID <code>{job.externalId}</code></p>}{job.error && <p className="dialog-error" role="status">{job.error}</p>}<JobResults job={job} /></article>)}</section>;
}

type Props = { kind: "image" | "video"; connection?: Connection; model?: Model; models: Model[]; onSelect: (id: string) => void; catalog?: Catalog; jobs: ReturnType<typeof useMediaJobs>; refreshConnection: () => Promise<void> };
export function MediaWorkbench({ kind, connection, model, jobs, refreshConnection }: Props) {
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [advanced, setAdvanced] = useState("{}");
  const [references, setReferences] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [currentJobId, setCurrentJobId] = useState("");
  const requestId = useRef("");
  const infoRequest = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const media = model?.media;
  const acceptsPrompt = !(connection?.provider === "fal" && media?.acceptsPrompt === false);
  const maxReferences = media?.maxReferences ?? (media?.referenceArray ? 3 : 1);
  const job = jobs.jobs.find((job) => job.id === currentJobId) || jobs.jobs.find((job) => job.kind === kind && job.connectionId === connection?.id && job.model === model?.id);
  const ready = connection?.status !== "disconnected" && !!connection;
  const infoReady = !!media && (connection?.provider === "fal" ? !!media.inputSchema && media.acceptsPrompt !== undefined : !(connection?.provider === "openrouter" && kind === "image") || !!media.inputSchema);

  useEffect(() => { setOptions({}); setAdvanced("{}"); setReferences([]); setConsent(false); setError(""); requestId.current = ""; }, [model?.id, kind, connection?.id]);
  useEffect(() => { requestId.current = ""; }, [prompt, options, advanced, references]);
  useEffect(() => {
    const key = `${connection?.id}:${model?.id}`;
    if (infoReady) { infoRequest.current = ""; setBusy((old) => old === "info" ? "" : old); return; }
    if (!connection || !model?.media || infoRequest.current === key) return;
    infoRequest.current = key; let stopped = false;
    setBusy("info");
    void studioApi("connections", { action: "model-info", id: connection.id, model: model.id }).then(() => refreshConnection()).catch((error) => { if (!stopped) setError(error.message); }).finally(() => { if (!stopped) setBusy(""); });
    return () => { stopped = true; };
  }, [connection?.id, model?.id, infoReady, refreshConnection]);

  function setOption(name: string, value: unknown) { setOptions((old) => { const next = { ...old }; if (value === "" || value === undefined) delete next[name]; else next[name] = value; return next; }); }
  const fields: { name: string; label: string; type?: string; values?: (string | number)[]; min?: number; max?: number }[] = [];
  const labels: Record<string, string> = { aspect_ratio: "화면비", ratio: "화면비 (예: 9:16)", resolution: "해상도 (예: 720p)", duration: "영상 길이 (초)", quality: "품질", n: "이미지 수", num_images: "이미지 수", image_size: "이미지 크기", size: "이미지 크기 (예: 2K, 2048x2048)", output_format: "파일 형식" };
  if (connection?.provider === "openrouter" && kind === "video") {
    if (media?.aspectRatios?.length) fields.push({ name: "aspect_ratio", label: "화면비", values: media.aspectRatios });
    if (media?.resolutions?.length) fields.push({ name: "resolution", label: "해상도", values: media.resolutions });
    if (media?.durations?.length) fields.push({ name: "duration", label: "영상 길이 (초)", values: media.durations });
  } else for (const [name, descriptor] of Object.entries(media?.parameters || {})) {
    if (labels[name] && ["enum", "range", "string"].includes(descriptor.type)) fields.push({ name, type: descriptor.type, label: labels[name], values: descriptor.values, min: descriptor.min, max: connection?.provider === "openrouter" && name === "n" ? Math.min(4, descriptor.max || 4) : descriptor.max });
  }

  async function upload(file: File) {
    setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", body: form }); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setReferences((previous) => [...previous, data.asset.id].slice(0, maxReferences)); await jobs.reload();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function generate() {
    if (!connection || !model) return;
    setBusy("generate"); setError("");
    try {
      const extras = JSON.parse(advanced);
      if (!extras || typeof extras !== "object" || Array.isArray(extras)) throw new Error("추가 옵션은 JSON 객체여야 합니다.");
      requestId.current ||= crypto.randomUUID();
      const data = await studioApi<{ job: MediaJob }>("jobs", { action: "create", requestId: requestId.current, connectionId: connection.id, model: model.id, kind, prompt: acceptsPrompt ? prompt : "", options: { ...extras, ...options }, referenceIds: references, consent: true });
      setCurrentJobId(data.job.id); requestId.current = ""; setConsent(false); await jobs.reload();
    } catch (error) { setError(error instanceof SyntaxError ? "추가 옵션 JSON 문법을 확인하세요." : (error as Error).message); }
    finally { setBusy(""); }
  }
  return <div className="media-workspace"><div className="test-grid media-grid"><section className="request-panel"><div className="panel-bar"><span>{kind === "image" ? <ImageIcon size={15} /> : <Film size={15} />}{kind === "image" ? "이미지 생성" : "영상 생성"}</span><span className="panel-meta">{connection ? providerName(connection.provider) : "계정 선택"}</span></div><div className="request-form">{model?.registration && <details><summary>직접 등록한 endpoint</summary><p className="metadata-note">기반 모델 매핑과 endpoint 권한은 미확인이며, 등록한 ID를 그대로 전송합니다.</p></details>}{busy === "info" && <p className="metadata-note"><LoaderCircle size={13} className="spin" /> 모델 입력 명세 조회 중</p>}{model?.unavailableReason && <p className="inline-warning">{model.unavailableReason}</p>}
      {!infoReady && model && !busy && <button className="small-button" onClick={() => { setBusy("info"); setError(""); void studioApi("connections", { action: "model-info", id: connection!.id, model: model.id }).then(refreshConnection).catch((error) => setError(error.message)).finally(() => setBusy("")); }}>모델 옵션 명세 다시 조회</button>}
      {acceptsPrompt ? <><label className="field-label media-prompt-label" htmlFor="media-prompt">프롬프트</label><textarea id="media-prompt" value={prompt} placeholder={kind === "video" ? "장면, 움직임, 카메라와 소리를 설명하세요." : "생성하거나 편집할 이미지를 설명하세요."} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} /></> : <p className="metadata-note">이 fal endpoint에는 prompt 필드가 없습니다. 참조 이미지와 필요한 추가 옵션만 전송합니다.</p>}
      {connection?.provider === "byteplus" && <p className="metadata-note">BytePlus 공통 API 필드입니다. 실제 지원 크기·길이·옵션은 선택한 모델/endpoint에 따라 다릅니다. 입력하지 않은 값은 제공자 기본값을 사용합니다.</p>}
      <div className="media-options">{fields.map((field) => <div key={field.name}><label htmlFor={`media-option-${field.name}`}>{field.label}</label>{field.values ? <select id={`media-option-${field.name}`} value={options[field.name] === undefined ? "" : String(options[field.name])} onChange={(event) => setOption(field.name, event.target.value ? field.values!.find((value) => String(value) === event.target.value) : undefined)}><option value="">제공자 기본값</option>{field.values.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : <input id={`media-option-${field.name}`} type={field.type === "string" ? "text" : "number"} min={field.min} max={field.max} placeholder="기본값" value={options[field.name] === undefined ? "" : String(options[field.name])} onChange={(event) => setOption(field.name, event.target.value === "" ? undefined : field.type === "string" ? event.target.value : Number(event.target.value))} />}</div>)}</div>
      {media?.generateAudio === true && <label className="consent"><input type="checkbox" checked={options.generate_audio === true} onChange={(event) => setOption("generate_audio", event.target.checked)} />오디오 함께 생성</label>}
      {media?.reference !== "none" && media?.reference && <section className="reference-input"><div className="form-label-row"><span>참조 이미지 {media.reference === "required" ? "(필수)" : "(선택)"} · 최대 {maxReferences}장</span><button className="small-button" disabled={!!busy || references.length >= maxReferences} onClick={() => fileInput.current?.click()}><Upload size={13} />업로드</button></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="참조 이미지 업로드" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /><div className="reference-thumbnails">{references.map((id) => <div key={id}><img src={`/api/assets?id=${id}`} alt="선택한 참조 이미지" /><button className="icon-button" aria-label="참조 제거" onClick={() => setReferences((old) => old.filter((value) => value !== id))}><X size={12} /></button></div>)}</div><select aria-label="저장된 참조 이미지 선택" value="" disabled={references.length >= maxReferences} onChange={(event) => { if (event.target.value) setReferences((old) => [...old, event.target.value]); }}><option value="">저장된 이미지에서 선택</option>{jobs.assets.filter((asset) => asset.kind === "image" && !references.includes(asset.id)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><p className="metadata-note">20MB 이하 PNG/JPEG/WebP/GIF · 제공자가 지원하는 참조 방식만 전송합니다.</p></section>}
      {["fal", "byteplus"].includes(connection?.provider || "") && <details className="advanced-options"><summary>추가 모델 옵션 (JSON)</summary><p className="metadata-note">{connection?.provider === "byteplus" ? "지원하는 공통 필드만 전송합니다. 이미지: size/seed/watermark/output_format/background. 영상: resolution/ratio/duration/seed/generate_audio/watermark/camera_fixed/return_last_frame." : "스키마에 필요한 옵션을 입력하세요. 최종 입력은 제공자 명세로 서버에서 검증합니다."}</p><textarea aria-label="추가 모델 옵션 JSON" value={advanced} spellCheck={false} onChange={(event) => setAdvanced(event.target.value)} /></details>}
      {error && <p className="dialog-error" role="alert">{error}</p>}<div className="run-area"><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />이 계정의 API 크레딧으로 유료 생성 요청 실행</label><button className="button primary" disabled={!!busy || !ready || !model || model.callable === false || !infoReady || acceptsPrompt && !prompt.trim() || !consent || media?.reference === "required" && !references.length} onClick={() => void generate()}>{busy === "generate" ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}생성</button></div>
    </div></section><section className="response-panel"><div className="panel-bar"><span>{kind === "image" ? <ImageIcon size={15} /> : <Film size={15} />}생성 결과</span><span className="panel-meta">{job ? statusNames[job.status] : "OUTPUT"}</span></div><div className="media-output">{job ? <><p className="metadata-note">{job.modelName} · {statusNames[job.status]}</p>{job.externalId && <details><summary>외부 작업 ID</summary><code>{job.externalId}</code></details>}{job.error && <p className="dialog-error" role="status">{job.error}</p>}<JobResults job={job} />{!["completed", "failed", "unknown"].includes(job.status) && <p className="media-wait"><LoaderCircle size={20} className="spin" />기존 작업을 추적하고 있습니다. 페이지를 닫아도 작업 ID는 보존됩니다.</p>}</> : <div className="output-placeholder">{kind === "video" ? <Film size={28} /> : <ImageIcon size={28} />}<strong>생성 결과 대기 중</strong><p>실행 후 실제 파일을 저장하고 표시합니다.</p></div>}</div></section></div></div>;
}
