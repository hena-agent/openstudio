"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EditableTitle({ value, disabled, onSave }: { value: string; disabled?: boolean; onSave: (name: string, previousName: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(value), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), returnFocus = useRef(false), previousName = useRef(value), saving = useRef(false), errorId = useId();
  useEffect(() => {
    if (editing) { returnFocus.current = true; input.current?.focus(); input.current?.select(); }
    else if (returnFocus.current) { trigger.current?.focus(); returnFocus.current = false; }
  }, [editing]);
  function cancel() { if (saving.current) return; setEditing(false); setError(""); setText(value); }
  async function commit() {
    if (saving.current) return;
    const name = text.trim(); if (!name) { setError("프로젝트 이름을 입력하세요."); input.current?.focus(); return; }
    if (name === previousName.current && name === value) { setEditing(false); return; }
    saving.current = true; setPending(true); setError("");
    try { await onSave(name, previousName.current); setEditing(false); }
    catch (error) { setError((error as Error).message); }
    finally { saving.current = false; setPending(false); }
  }
  if (!editing) return <Button ref={trigger} variant="ghost" disabled={disabled} className="group max-w-lg min-w-0 justify-start px-2 text-lg font-semibold" aria-label={`${value} 프로젝트 이름 변경`} onClick={() => { previousName.current = value; setText(value); setError(""); setEditing(true); }}><span className="truncate">{value}</span><Pencil className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></Button>;
  return <form className="grid w-full min-w-0 max-w-sm gap-2 sm:w-auto" onSubmit={(event) => { event.preventDefault(); void commit(); }}>
    <div className="flex min-w-0 items-center gap-2"><Input ref={input} value={text} maxLength={120} aria-label="프로젝트 이름 수정" aria-describedby={error ? errorId : undefined} aria-invalid={!!error} disabled={pending} className="min-w-0 flex-1 sm:w-64" onChange={(event) => { setText(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} /><Button type="submit" size="icon" variant="secondary" aria-label="프로젝트 이름 저장" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Check />}</Button><Button size="icon" variant="ghost" aria-label="이름 수정 취소" disabled={pending} onClick={cancel}><X /></Button></div>
    {error && <p id={errorId} role="alert" className="m-0 text-xs leading-5 text-destructive">{error}</p>}
  </form>;
}
