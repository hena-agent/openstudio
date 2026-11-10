import { createServer, request as proxyRequest, type RequestListener } from "node:http";
import next from "next";
import { listenInRange } from "../../../scripts/ports";
import { prepareEnvironment, publishRuntime, readRuntime } from "../../../scripts/runtime";

async function main() {
  prepareEnvironment();
  const dev = !process.argv.includes("--production");
  Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });
  let handler: RequestListener = (_request, response) => { response.writeHead(503).end("Starting client…"); };
  const serve: RequestListener = (request, response) => {
    if (request.url?.startsWith("/api/")) {
      const backend = process.env.OPENSTUDIO_BACKEND_ORIGIN || readRuntime("server")?.origin;
      if (!backend) { response.writeHead(503, { "Content-Type": "application/json" }); response.end('{"error":"서버 시작 중입니다."}'); return; }
      const upstream = proxyRequest(new URL(request.url, backend), { method: request.method, headers: request.headers, timeout: 190_000 }, (result) => {
        response.writeHead(result.statusCode || 502, result.headers); result.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" }); response.end('{"error":"백엔드에 연결할 수 없습니다."}'); });
      upstream.on("timeout", () => upstream.destroy()); request.on("aborted", () => upstream.destroy()); request.pipe(upstream); return;
    }
    handler(request, response);
  };
  const server = createServer(serve), ipv6 = createServer(serve);
  ipv6.on("upgrade", (request, socket, head) => { if (server.listenerCount("upgrade")) server.emit("upgrade", request, socket, head); else socket.destroy(); });
  const requested = Number(process.env.OPENSTUDIO_CLIENT_PORT) || 0;
  if (requested && (requested < 3001 || requested > 3999)) throw new Error("Client port must be in 3001–3999");
  const port = await listenInRange(server, requested || 3001, requested || 3999, ipv6);
  const app = next({ dev, hostname: "127.0.0.1", port, httpServer: server });
  let unpublish: (() => void) | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    unpublish?.(); server.closeAllConnections(); ipv6.closeAllConnections(); server.close(); ipv6.close(); await app.close(); process.exit(0);
  };
  process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop());
  await app.prepare(); handler = app.getRequestHandler();
  unpublish = publishRuntime("client", `http://127.0.0.1:${port}`);
  console.log(`Client: http://localhost:${port} · http://127.0.0.1:${port}`);
}
main().catch(() => { console.error("클라이언트 시작 실패. 빌드 상태와 3xxx 포트를 확인하세요."); process.exit(1); });
