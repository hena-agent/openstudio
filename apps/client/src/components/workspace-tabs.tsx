"use client";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

export type WorkspaceTab = { id: string; label: string; count?: number; disabled?: boolean };

export function WorkspaceTabs({ id, label, tabs, value, onChange }: { id: string; label: string; tabs: WorkspaceTab[]; value: string; onChange: (value: string) => void }) {
  return <div className="flex h-12 min-h-12 shrink-0 overflow-x-auto border-b border-border bg-card" role="tablist" aria-label={label}>
    {tabs.map((tab) => <Button variant="ghost" key={tab.id} type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} disabled={tab.disabled} className={cn("relative h-12 rounded-none border-0 border-r border-border px-4 text-sm text-muted-foreground focus-visible:ring-inset focus-visible:ring-offset-0", value === tab.id && "bg-accent/40 text-foreground after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-primary")} onClick={() => onChange(tab.id)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const enabled = tabs.filter((item) => !item.disabled), index = enabled.findIndex((item) => item.id === tab.id);
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled[(index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
      if (next) { onChange(next.id); document.getElementById(`${id}-tab-${next.id}`)?.focus(); }
    }}>{tab.label}{tab.count !== undefined && <Badge variant="outline" className="px-1.5 py-0.5">{tab.count}</Badge>}</Button>)}
  </div>;
}
