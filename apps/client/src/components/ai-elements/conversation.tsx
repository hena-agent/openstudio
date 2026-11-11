"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { WorkflowLog } from "@openstudio/shared/workflow";
import { Button } from "@/components/ui/button";
import { HelpText } from "@/components/studio/primitives";
import { Message, MessageContent, MessageResponse, ToolEvent } from "./message";

export function Conversation({ messages, conversationId, emptyText, children }: { messages: WorkflowLog[]; conversationId: string; emptyText: string; children?: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), follow = useRef(true);
  const [away, setAway] = useState(false);
  const dialogue = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const events = messages.filter((message) => message.role === "tool" || message.role === "system");
  useEffect(() => { follow.current = true; setAway(false); }, [conversationId]);
  useEffect(() => { if (viewport.current && follow.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [messages.at(-1)?.id, conversationId]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (viewport.current && follow.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return <div data-slot="conversation" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
    <div ref={viewport} role="log" aria-label="제작 대화" aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3" onScroll={() => { const node = viewport.current; if (node) { follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40; setAway(!follow.current); } }}>
      <div ref={content} className="space-y-6 py-2">
        {dialogue.map((message) => <Message key={message.id} from={message.role as "user" | "assistant"} aria-label={message.role === "user" ? "내 메시지" : "답변"}>{message.role === "user" ? <MessageContent>{message.text}</MessageContent> : <MessageResponse>{message.text}</MessageResponse>}</Message>)}
        {!dialogue.length && <HelpText>{emptyText}</HelpText>}
        {children}
        {events.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-ring">작업 기록 · {events.length}</summary><div className="space-y-3 pt-2">{events.map((event) => <ToolEvent key={event.id} text={event.text} system={event.role === "system"} />)}</div></details>}
      </div>
    </div>
    {away && <Button variant="secondary" size="icon-sm" className="absolute right-3 bottom-2 shadow-md" aria-label="최신 대화로" onClick={() => { follow.current = true; setAway(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}><ArrowDown /></Button>}
  </div>;
}
