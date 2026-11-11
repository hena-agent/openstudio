"use client";

import { useEffect, useRef } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { stepStatusNames, type ProductionSession } from "@openstudio/shared/workflow";
import { cn } from "@/lib/utils";

export function ProductionStepStrip({ session, selected, disabled, onSelect }: { session: ProductionSession; selected: string; disabled: boolean; onSelect: (id: string) => void }) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => { current.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selected, session.id]);
  return <nav aria-label="제작 스텝" className="production-step-strip"><ol className="m-0 flex list-none gap-2 p-0">{session.steps.map((step, index) => {
    const status = session.states[step.id]?.status || "idle", active = selected === step.id;
    return <li key={step.id} className="min-w-0 shrink-0"><button ref={active ? current : undefined} type="button" disabled={disabled} aria-current={active ? "step" : undefined} aria-label={`${index + 1}. ${step.name} · ${stepStatusNames[status]}`} title={`${step.name} · ${stepStatusNames[status]}`} onClick={() => onSelect(step.id)} className={cn("flex h-11 max-w-48 cursor-pointer items-center gap-2 rounded-md border px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", active ? "border-primary/40 bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary")}>
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs", status === "complete" && "border-emerald-400/30 text-emerald-200", status === "failed" && "border-destructive/40 text-destructive", ["review", "needs_input", "stale"].includes(status) && "border-amber-300/40 text-amber-200")}>{status === "complete" ? <Check className="size-3.5" /> : status === "running" || status === "queued" ? <LoaderCircle className="size-3.5 animate-spin" /> : status === "failed" ? <CircleAlert className="size-3.5" /> : index + 1}</span><span className="truncate text-sm font-medium">{step.name}</span>
    </button></li>;
  })}</ol></nav>;
}
