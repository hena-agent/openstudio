import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { AppError, localWorkspaceId } from "./storage";
import { readRuntime } from "../../../scripts/runtime";

export function readSession(request: Request) {
  const local = localWorkspaceId();
  if (local) return local;
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("studio_session="))?.slice("studio_session=".length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function sessionCookie(id: string) {
  const secure = configuredFrontendOrigin()?.startsWith("https:") ? "; Secure" : "";
  return `studio_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function configuredFrontendOrigin() {
  return process.env.OPENSTUDIO_FRONTEND_ORIGIN || (process.env.OPENSTUDIO_RUNTIME_DISCOVERY === "1" ? readRuntime("client")?.origin : undefined);
}
export function frontendOrigin(request: Request) {
  const discovered = configuredFrontendOrigin();
  if (!discovered && process.env.OPENSTUDIO_RUNTIME_DISCOVERY === "1") throw new AppError("클라이언트가 아직 준비되지 않았습니다.", 503, "client_not_ready");
  const expected = discovered || new URL(request.url).origin;
  const configured = new URL(expected), allowed = new Set([configured.origin]);
  if (configured.protocol === "http:" && ["127.0.0.1", "localhost"].includes(configured.hostname)) {
    const alias = new URL(configured); alias.hostname = configured.hostname === "localhost" ? "127.0.0.1" : "localhost"; allowed.add(alias.origin);
  }
  const origin = request.headers.get("origin");
  if (!origin || !allowed.has(origin)) throw new AppError("허용되지 않은 요청 출처입니다.", 403, "invalid_origin");
  return new URL(origin);
}
export function sameOrigin(request: Request) { frontendOrigin(request); }

export function errorResponse(error: unknown) {
  const known = error instanceof AppError;
  return Response.json({
    error: known ? error.message : error instanceof ZodError ? "입력값 또는 제공자 응답 형식을 확인해 주세요." : "요청을 처리하지 못했습니다. 서버 설정과 연결을 확인해 주세요.",
    code: known ? error.code : "request_failed",
  }, { status: known ? error.status : error instanceof ZodError ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}

export function route(handler: (request: Request, sessionId: string) => Promise<unknown>, mutation = false, withSession = true) {
  return async (request: Request) => {
    try {
      if (mutation) sameOrigin(request);
      const id = withSession ? readSession(request) || randomBytes(32).toString("hex") : "";
      const data = await handler(request, id);
      return Response.json(data, { headers: { "Cache-Control": "no-store", ...(withSession ? { "Set-Cookie": sessionCookie(id) } : {}) } });
    } catch (error) { return errorResponse(error); }
  };
}
