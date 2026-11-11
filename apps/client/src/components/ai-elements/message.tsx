// AI Elements/shadcn Message pattern, adapted to OpenStudio's Pi event types.
import type { ComponentProps } from "react";
import { Wrench, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Message({ from, className, ...props }: ComponentProps<"article"> & { from: "user" | "assistant" }) {
  return <article data-slot="message" data-from={from} className={cn("flex flex-col gap-2", from === "user" ? "items-end" : "items-start", className)} {...props} />;
}
export function MessageContent({ className, ...props }: ComponentProps<"div">) { return <div data-slot="message-content" className={cn("max-w-full rounded-lg px-4 py-3 text-[15px] leading-7 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [[data-from=user]_&]:bg-secondary [[data-from=assistant]_&]:px-0 [[data-from=assistant]_&]:py-0", className)} {...props} />; }
export function ToolEvent({ text, system = false }: { text: string; system?: boolean }) { return <div data-slot="tool-event" className="flex items-start gap-2 border-l-2 border-border pl-3 text-xs leading-6 text-muted-foreground">{system ? <Info className="mt-1 size-3.5 shrink-0" /> : <Wrench className="mt-1 size-3.5 shrink-0" />}<span className="break-words [overflow-wrap:anywhere]">{text}</span></div>; }
