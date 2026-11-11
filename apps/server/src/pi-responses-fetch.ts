import { AppError } from "./storage";

// Keep the existing Sign in with ChatGPT SSE/completed-JSON compatibility when
// handing Responses traffic to Pi's streaming adapter.
export const piResponsesFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const prefix: Uint8Array[] = []; let text = "", ended = false;
  try {
    while (!text.trim() && !ended) {
      const part = await reader.read(); ended = part.done;
      if (part.value) { prefix.push(part.value); text += decoder.decode(part.value, { stream: true }); }
      if (!text.trim() && text.length > 32000) throw new AppError("Responses 응답의 시작 형식을 확인할 수 없습니다.", 502);
    }
    if (text.trimStart().startsWith("{")) {
      if (text.length > 2_000_000) throw new AppError("Responses 결과가 준비 작업 크기 제한을 넘었습니다.", 502);
      while (!ended) {
        const part = await reader.read(); ended = part.done;
        if (part.value) text += decoder.decode(part.value, { stream: true });
        if (text.length > 2_000_000) throw new AppError("Responses 결과가 준비 작업 크기 제한을 넘었습니다.", 502);
      }
      text += decoder.decode();
      let result;
      try { result = JSON.parse(text); } catch { throw new AppError("Responses JSON을 해석하지 못했습니다.", 502); }
      if (result?.object !== "response" || result.status !== "completed" || !Array.isArray(result.output)) throw new AppError("완료된 Responses 결과가 아닙니다.", 502);
      const events = [{ type: "response.created", response: { id: result.id } }, ...result.output.map((item: unknown, output_index: number) => ({ type: "response.output_item.done", output_index, item })), { type: "response.completed", response: result }];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: response.status, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { for (const bytes of prefix) controller.enqueue(bytes); if (ended) controller.close(); },
      async pull(controller) { if (ended) return; try { const part = await reader.read(); if (part.done) { ended = true; controller.close(); } else controller.enqueue(part.value); } catch (error) { controller.error(error); } },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(stream, { status: response.status, headers: response.headers });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
};
