"use client";

import { useId, useRef, type ReactNode } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PromptInput({ label, value, onChange, onSubmit, canSubmit, busy, actionLabel, placeholder, footer, inputId }: {
  label: string; value: string; onChange: (value: string) => void; onSubmit: () => void; canSubmit: boolean; busy: boolean; actionLabel: string; placeholder: string; footer?: ReactNode; inputId?: string;
}) {
  const generated = useId(), id = inputId || `prompt-${generated}`, form = useRef<HTMLFormElement>(null);
  return <div data-slot="prompt-input" className="grid gap-2"><Label htmlFor={id}>{label}</Label><form ref={form} className="overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30" onSubmit={(event) => { event.preventDefault(); if (canSubmit && !busy) onSubmit(); }}>
    <Textarea id={id} value={value} maxLength={4000} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-28 rounded-none border-0 bg-transparent focus-visible:border-transparent focus-visible:ring-0" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); form.current?.requestSubmit(); } }} />
    <div className="grid gap-3 border-t border-border p-3">{footer}<Button type="submit" size="sm" disabled={!canSubmit || busy} className="w-full">{busy ? <LoaderCircle className="animate-spin" /> : <Send />}{actionLabel}</Button><span className="text-right text-xs text-muted-foreground">Ctrl / ⌘ + Enter</span></div>
  </form></div>;
}
