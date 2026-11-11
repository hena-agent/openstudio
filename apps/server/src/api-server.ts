import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "./storage";
import { errorResponse, readSession } from "./http";
import { completeOpenAI } from "./openai-oauth";
import * as connections from "./routes/connections";
import * as oauth from "./routes/oauth";
import * as catalog from "./routes/catalog";
import * as jobs from "./routes/jobs";
import { uploadAsset, serveAsset } from "./assets";
import { completeOpenRouter } from "./openrouter-oauth";
import * as falModels from "./routes/fal-models";
import * as models from "./routes/models";
import * as workflows from "./routes/workflows";

const routes: Record<string, Partial<Record<string, (request: Request) => Promise<Response>>>> = {
  "/api/connections": connections,
  "/api/oauth": oauth,
  "/api/catalog": catalog,
  "/api/jobs": jobs,
  "/api/fal/models": falModels,
  "/api/models": models,
  "/api/workflows": workflows,
};

const callbackPage = (success: boolean) => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenStudio · 계정 연결</title><style>body{background:#111214;color:#e4e4e7;font:15px system-ui;display:grid;place-items:center;min-height:95vh;margin:0}main{max-width:420px;padding:32px}h1{font-size:22px}p{color:#a1a1aa;line-height:1.8}a{color:#b5c9ff}</style><main><p>OPENSTUDIO / CONNECTIONS</p><h1>${success ? "계정 연결이 완료되었습니다." : "계정 연결을 완료하지 못했습니다."}</h1><p>${success ? "이 창을 닫고 작업 화면으로 돌아가세요. 계정의 모델을 조회해 사용할 수 있습니다." : "작업 화면에서 오류 내용을 확인하고 다시 로그인하세요."}</p></main></html>`;

export async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return Response.json({ ok: true });
  if (url.pathname === "/api/assets") {
    if (request.method === "POST") return uploadAsset(request);
    if (["GET", "HEAD"].includes(request.method)) return serveAsset(request);
    return Response.json({ error: "지원하지 않는 method입니다." }, { status: 405 });
  }
  if (["/auth/callback", "/auth/openrouter/callback"].includes(url.pathname) && request.method === "GET") {
    try {
      const id = readSession(request);
      if (!id) throw new AppError("인증을 시작한 브라우저 세션이 필요합니다.", 401);
      const result = url.pathname === "/auth/openrouter/callback" ? await completeOpenRouter(id, url) : await completeOpenAI(id, url);
      return new Response(callbackPage(result.ok), { status: result.ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
    } catch { return new Response(callbackPage(false), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
  }
  const route = routes[url.pathname];
  if (!route) return Response.json({ error: "존재하지 않는 API입니다." }, { status: 404 });
  const handler = route[request.method];
  if (!handler) return Response.json({ error: "지원하지 않는 HTTP method입니다." }, { status: 405, headers: { Allow: Object.keys(route).join(", ") } });
  return handler(request);
}

export function createApiServer() {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        const limit = incoming.url?.split("?")[0] === "/api/assets" ? 21 * 1024 * 1024 : 128 * 1024;
        if (size > limit) throw new AppError("요청이 너무 큽니다.", 413);
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const origin = process.env.OPENSTUDIO_BACKEND_ORIGIN || "http://127.0.0.1:4001";
      const request = new Request(new URL(incoming.url || "/", origin), {
        method: incoming.method, headers,
        ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await dispatch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), outgoing);
      else outgoing.end();
    } catch (error) {
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      const response = errorResponse(error);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(await response.text());
    }
  });
  server.requestTimeout = 190_000;
  server.headersTimeout = 20_000;
  return server;
}
