"use client";

import type { ReactNode } from "react";
import { ChevronDown, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Composes shadcn primitives using the AI Elements collapsible Plan pattern.
export function Plan({ title, description, meta, children, actions, defaultOpen = false }: { title: string; description: string; meta: ReactNode; children: ReactNode; actions: ReactNode; defaultOpen?: boolean }) {
  return <Collapsible data-slot="plan" defaultOpen={defaultOpen} className="rounded-md border border-border bg-background">
    <CollapsibleTrigger asChild><Button variant="ghost" className="group h-auto min-h-11 w-full justify-start rounded-b-none px-4 py-3 text-left whitespace-normal"><ListTodo /><span className="min-w-0 flex-1 break-words text-sm">{title}</span><ChevronDown className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
    <CollapsibleContent className="grid gap-4 border-t border-border p-4"><p className="m-0 text-sm leading-7">{description}</p>{children}<div className="text-xs leading-6 text-muted-foreground">{meta}</div>{actions}</CollapsibleContent>
  </Collapsible>;
}
