import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { z } from "zod";
import type { Asset } from "@openstudio/shared/types";
import { AppError, dataRoot, transaction } from "./storage";
import { errorResponse, readSession, route } from "./http";

const MAX_IMAGE = 20 * 1024 * 1024, MAX_VIDEO = 200 * 1024 * 1024;
function assetPath(sessionId: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(sessionId)) throw new AppError("잘못된 세션입니다.", 401);
  z.uuid().parse(id);
  return path.join(dataRoot(), "assets", sessionId, id);
}
function mediaType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).toString() === "ID3" || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return "video/webm";
}

export async function saveMedia(sessionId: string, response: Response, kind: Asset["kind"], name: string): Promise<Asset> {
  if (!response.ok || !response.body) throw new AppError("결과 파일을 내려받지 못했습니다.", 502, "download_failed");
  const max = kind === "image" ? MAX_IMAGE : MAX_VIDEO;
  if (Number(response.headers.get("content-length")) > max) { await response.body.cancel(); throw new AppError("결과 파일이 저장 크기 제한을 초과했습니다.", 413); }
  const id = randomUUID(), file = assetPath(sessionId, id);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, "wx", 0o600);
  const reader = response.body.getReader();
  let size = 0, prefix = Buffer.alloc(0);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) throw new AppError("파일이 저장 크기 제한을 초과했습니다.", 413);
      if (prefix.length < 64) prefix = Buffer.concat([prefix, Buffer.from(value).subarray(0, 64 - prefix.length)]);
      await handle.writeFile(value);
    }
    const mime = mediaType(prefix);
    if (!mime?.startsWith(`${kind}/`)) throw new AppError("지원하는 이미지(PNG/JPEG/WebP/GIF), 영상(MP4/WebM), 음성(MP3) 파일이 아닙니다.", 415, "invalid_media");
    const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm", "audio/mpeg": ".mp3" }[mime]!;
    const cleanName = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 110) || "asset";
    const asset: Asset = { id, name: cleanName.endsWith(extension) ? cleanName : `${cleanName}${extension}`, mime, size, kind, createdAt: new Date().toISOString() };
    await transaction(sessionId, (data) => { (data.assets ??= []).push(asset); });
    return asset;
  } catch (error) { await rm(file, { force: true }); throw error; }
  finally { await reader.cancel().catch(() => {}); await handle.close(); }
}

export function validateDownloadURL(input: string) {
  const url = new URL(input);
  const hosts = ["fal.media", "fal.run", "openrouter.ai", "public.blob.vercel-storage.com", "storage.googleapis.com", "bytepluses.com", "bytepluscdn.com", "tos-ap-southeast-1.volces.com"];
  if (url.protocol !== "https:" || url.port || url.username || url.password || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new AppError("제공자의 파일 다운로드 주소가 지원되는 호스트가 아닙니다.", 502, "invalid_download_url");
  return url;
}
export async function downloadMedia(sessionId: string, input: string, kind: Asset["kind"], name: string, headers: Record<string, string> = {}) {
  let url = validateDownloadURL(input);
  const credentialOrigin = url.origin;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: url.origin === credentialOrigin ? headers : {}, redirect: "manual", signal: AbortSignal.timeout(180_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new AppError("파일 이동 주소가 없습니다.", 502);
      url = validateDownloadURL(new URL(location, url).toString()); continue;
    }
    return saveMedia(sessionId, response, kind, name);
  }
  throw new AppError("파일 다운로드 이동 횟수를 초과했습니다.", 502);
}
export async function referenceData(sessionId: string, id: string) {
  const asset = await transaction(sessionId, (data) => data.assets?.find((asset) => asset.id === id));
  if (!asset || asset.kind !== "image" || asset.size > MAX_IMAGE) throw new AppError("이 세션에서 사용할 수 있는 참조 이미지가 없습니다.", 404);
  return `data:${asset.mime};base64,${(await readFile(assetPath(sessionId, id))).toString("base64")}`;
}

export const uploadAsset = route(async (request, sessionId) => {
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_IMAGE) throw new AppError("20MB 이하의 참조 이미지를 선택하세요.", 413);
  return { asset: await saveMedia(sessionId, new Response(file.stream()), "image", file.name) };
}, true);

export async function serveAsset(request: Request) {
  try {
    const sessionId = readSession(request); if (!sessionId) throw new AppError("파일 접근 권한이 없습니다.", 401);
    const url = new URL(request.url), id = z.uuid().parse(url.searchParams.get("id"));
    const asset = await transaction(sessionId, (data) => data.assets?.find((item) => item.id === id));
    if (!asset) throw new AppError("파일을 찾을 수 없습니다.", 404);
    let start = 0, end = asset.size - 1;
    const headers: Record<string, string> = { "Content-Type": asset.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
    if (url.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.size}` } });
      if (!match[1]) start = Math.max(0, asset.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.size}` } });
      headers["Content-Range"] = `bytes ${start}-${end}/${asset.size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(assetPath(sessionId, id), { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
