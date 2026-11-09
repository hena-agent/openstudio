import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "./storage";

export function readSession(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("studio_session="))?.slice("studio_session=".length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function sessionCookie(id: string) {
  const secure = process.env.OPENSTUDIO_FRONTEND_ORIGIN?.startsWith("https:") ? "; Secure" : "";
  return `studio_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function sameOrigin(request: Request) {
  const expected = process.env.OPENSTUDIO_FRONTEND_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("origin") !== expected) throw new AppError("허용되지 않은 요청 출처입니다.", 403, "invalid_origin");
}

export function errorResponse(error: unknown) {
  const known = error instanceof AppError;
  return Response.json({
    error: known ? error.message : error instanceof ZodError ? "입력값 또는 제공자 응답 형식을 확인해 주세요." : "요청을 처리하지 못했습니다. 서버 설정과 연결을 확인해 주세요.",
    code: known ? error.code : "request_failed",
  }, { status: known ? error.status : error instanceof ZodError ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}

export function route(handler: (request: Request, sessionId: string) => Promise<unknown>, mutation = false) {
  return async (request: Request) => {
    try {
      if (mutation) sameOrigin(request);
      const id = readSession(request) || randomBytes(32).toString("hex");
      const data = await handler(request, id);
      return Response.json(data, { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(id) } });
    } catch (error) { return errorResponse(error); }
  };
}
