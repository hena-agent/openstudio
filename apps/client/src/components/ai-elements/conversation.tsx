"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { WorkflowLog } from "@openstudio/shared/workflow";
import { Button } from "@/components/ui/button";
import { HelpText } from "@/components/studio/primitives";
import { Message, MessageContent, ToolEvent } from "./message";

export function Conversation({ messages, conversationId, emptyText }: { messages: WorkflowLog[]; conversationId: string; emptyText: string }) {
  const viewport = useRef<HTMLDivElement>(null), follow = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => { follow.current = true; setAway(false); }, [conversationId]);
  useEffect(() => { if (viewport.current && follow.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [messages.at(-1)?.id, conversationId]);
  return <div data-slot="conversation" className="relative min-h-24 flex-1">
    <div ref={viewport} role="log" aria-label="에이전트 대화" aria-live="polite" aria-relevant="additions text" className="h-full min-h-24 space-y-6 overflow-y-auto pr-2" onScroll={() => { const node = viewport.current; if (node) { follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40; setAway(!follow.current); } }}>
      {messages.slice(-40).map((message) => message.role === "tool" || message.role === "system" ? <ToolEvent key={message.id} text={message.text} system={message.role === "system"} /> : <Message key={message.id} from={message.role}><span className="text-xs font-medium text-muted-foreground">{message.role === "user" ? "사용자" : "Pi"}</span><MessageContent>{message.text}</MessageContent></Message>)}
      {!messages.length && <HelpText>{emptyText}</HelpText>}
    </div>
    {away && <Button variant="secondary" size="icon-sm" className="absolute right-3 bottom-2 shadow-md" aria-label="최신 대화로" onClick={() => { follow.current = true; setAway(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}><ArrowDown /></Button>}
  </div>;
}
