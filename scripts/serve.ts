import { createServer, request as proxyRequest, type RequestListener } from "node:http";
import next from "next";
import { listenInRange } from "./ports";
import { initializeStorage } from "../src/lib/server/storage";
import { createApiServer } from "../src/lib/server/api-server";

async function main() {
  for (const file of [".env.local", ".env"]) {
    try { process.loadEnvFile(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const dev = !process.argv.includes("--production");
  Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });
  process.env.OPENSTUDIO_LOCAL_DEV = dev ? "1" : "0";
  await initializeStorage(dev);

  let handler: RequestListener = (_request, response) => { response.writeHead(503).end("Starting OpenStudio…"); };
  const frontendHandler: RequestListener = (request, response) => {
    if (request.url?.startsWith("/api/") && process.env.OPENSTUDIO_BACKEND_ORIGIN) {
      const upstream = proxyRequest(new URL(request.url, process.env.OPENSTUDIO_BACKEND_ORIGIN), {
        method: request.method, headers: request.headers, timeout: 190_000,
      }, (result) => {
        response.writeHead(result.statusCode || 502, result.headers);
        result.pipe(response);
      });
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end('{"error":"백엔드에 연결할 수 없습니다."}'); });
      upstream.on("timeout", () => upstream.destroy());
      request.on("aborted", () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    handler(request, response);
  };
  const frontend = createServer(frontendHandler);
  const frontendIPv6 = createServer(frontendHandler);
  // Next attaches its development WebSocket handler to the primary HTTP server.
  frontendIPv6.on("upgrade", (request, socket, head) => {
    if (frontend.listenerCount("upgrade")) frontend.emit("upgrade", request, socket, head);
    else socket.destroy();
  });
  const backend = createApiServer();
  const backendIPv6 = createApiServer();
  let app: ReturnType<typeof next> | undefined;
  async function shutdown() {
    frontend.closeAllConnections(); backend.closeAllConnections();
    frontendIPv6.closeAllConnections(); backendIPv6.closeAllConnections();
    frontend.close(); backend.close();
    frontendIPv6.close(); backendIPv6.close();
    await app?.close();
  }
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  try {
    const backendPort = await listenInRange(backend, 4001, 4999, backendIPv6);
    const frontendPort = await listenInRange(frontend, 3001, 3999, frontendIPv6);
    process.env.OPENSTUDIO_BACKEND_ORIGIN = `http://127.0.0.1:${backendPort}`;
    process.env.OPENSTUDIO_FRONTEND_ORIGIN = `http://127.0.0.1:${frontendPort}`;
    app = next({ dev, hostname: "127.0.0.1", port: frontendPort, httpServer: frontend });
    await app.prepare();
    handler = app.getRequestHandler();
    console.log(`\nOpenStudio\n  Frontend  http://localhost:${frontendPort}\n            ${process.env.OPENSTUDIO_FRONTEND_ORIGIN}\n  Backend   ${process.env.OPENSTUDIO_BACKEND_ORIGIN}\n  OAuth     시작한 호스트의 ${backendPort}번 콜백\n`);
  } catch (error) { await shutdown(); throw error; }
}
main().catch(() => { console.error("OpenStudio 시작 실패. 포트 범위, 환경변수와 빌드 상태를 확인하세요."); process.exit(1); });
