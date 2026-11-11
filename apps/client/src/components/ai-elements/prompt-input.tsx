"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PromptInput({ label, value, onChange, onSubmit, canSubmit, busy, actionLabel, placeholder, inputId }: {
  label: string; value: string; onChange: (value: string) => void; onSubmit: () => void; canSubmit: boolean; busy: boolean; actionLabel: string; placeholder: string; inputId?: string;
}) {
  const generated = useId(), id = inputId || `prompt-${generated}`, form = useRef<HTMLFormElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "0px"; input.current.style.height = `${Math.min(176, Math.max(72, input.current.scrollHeight))}px`; } }, [value]);
  return <div data-slot="prompt-input" className="grid gap-2"><Label htmlFor={id} className="sr-only">{label}</Label><form ref={form} className="overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30" onSubmit={(event) => { event.preventDefault(); if (canSubmit && !busy) onSubmit(); }}>
    <Textarea ref={input} id={id} rows={2} value={value} maxLength={4000} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-18 resize-none rounded-none border-0 bg-transparent focus-visible:border-transparent focus-visible:ring-0" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); form.current?.requestSubmit(); } }} />
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3"><span className="text-xs text-muted-foreground">Ctrl / ⌘ + Enter</span><Button type="submit" size="sm" disabled={!canSubmit || busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />}{actionLabel}</Button></div>
  </form></div>;
}
