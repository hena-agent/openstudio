"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />; }
export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) { return <div className={cn("flex flex-col gap-2 pr-10", className)} {...props} />; }
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) { return <div className={cn("flex flex-wrap items-center justify-end gap-3", className)} {...props} />; }
export function DialogContent({ className, children, closeDisabled = false, onOpenAutoFocus, onCloseAutoFocus, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { closeDisabled?: boolean }) {
  const returnFocus = React.useRef<HTMLElement | null>(null);
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/65" /><DialogPrimitive.Content data-slot="dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl outline-none", className)} {...props} onOpenAutoFocus={(event) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenAutoFocus?.(event);
  }} onCloseAutoFocus={(event) => {
    onCloseAutoFocus?.(event);
    if (!event.defaultPrevented && returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }); }
  }}>{children}<DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" className="absolute top-4 right-4" aria-label="대화상자 닫기" disabled={closeDisabled}><X /></Button></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>;
}
