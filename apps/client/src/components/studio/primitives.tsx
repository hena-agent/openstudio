"use client";

import { useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Panel({ className, ...props }: ComponentProps<typeof Card>) { return <Card data-slot="studio-panel" className={cn("gap-6 p-4 sm:p-6", className)} {...props} />; }
export function SectionHeader({ title, description, actions, level = 2, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; level?: 1 | 2 | 3; className?: string }) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return <header data-slot="section-header" className={cn("flex min-w-0 items-start justify-between gap-4", className)}><div className="min-w-0 space-y-2"><Heading className={cn("m-0 flex items-center gap-2 font-semibold break-words", level === 1 ? "text-xl leading-7" : "text-base leading-6")}>{title}</Heading>{description && <p className="m-0 text-sm leading-6 text-muted-foreground">{description}</p>}</div>{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}</header>;
}
export function FormSection({ title, description, className, children, ...props }: ComponentProps<"fieldset"> & { title: ReactNode; description?: ReactNode }) {
  return <fieldset data-slot="form-section" className={cn("m-0 min-w-0 border-0 p-0 disabled:opacity-70", className)} {...props}><legend className="mb-4 p-0 text-base font-semibold leading-6">{title}</legend><div className="grid gap-4">{description && <p className="m-0 text-sm leading-6 text-muted-foreground">{description}</p>}{children}</div></fieldset>;
}
export function FormField({ label, description, error, children, id, className }: { label: ReactNode; description?: ReactNode; error?: string; children: ReactElement; id?: string; className?: string }) {
  const generated = useId(), fieldId = id || `field-${generated}`;
  const descriptionId = description || error ? `${fieldId}-description` : undefined;
  return <div data-slot="form-field" className={cn("grid min-w-0 gap-2", className)}><Label htmlFor={fieldId}>{label}</Label><Slot id={fieldId} aria-describedby={descriptionId} aria-invalid={error ? true : undefined}>{children}</Slot>{(description || error) && <p id={descriptionId} role={error ? "alert" : undefined} className={cn("m-0 text-xs leading-5", error ? "text-destructive" : "text-muted-foreground")}>{error || description}</p>}</div>;
}
export function ActionBar({ className, separated = false, ...props }: ComponentProps<"div"> & { separated?: boolean }) { return <div data-slot="action-bar" className={cn("flex flex-wrap items-center gap-3", separated && "border-t border-border pt-6", className)} {...props} />; }
export function HelpText({ className, ...props }: ComponentProps<"p">) { return <p data-slot="help-text" className={cn("m-0 text-xs leading-6 text-muted-foreground", className)} {...props} />; }
export function EmptyState({ icon, title, description, actions, className }: { icon?: ReactNode; title: ReactNode; description: ReactNode; actions?: ReactNode; className?: string }) {
  return <div data-slot="empty-state" className={cn("flex min-h-56 flex-col items-start justify-center gap-4 p-4 sm:p-6", className)}>{icon && <span className="text-muted-foreground [&_svg]:size-7">{icon}</span>}<div className="space-y-2"><h3 className="m-0 text-base font-semibold leading-6">{title}</h3><p className="m-0 max-w-xl text-sm leading-7 text-muted-foreground">{description}</p></div>{actions && <ActionBar>{actions}</ActionBar>}</div>;
}
export function Notice({ children, variant = "info", className, ...props }: ComponentProps<"div"> & { variant?: "info" | "warning" | "error" }) {
  return <div data-slot="notice" role={variant === "error" ? "alert" : "status"} className={cn("flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 text-sm leading-6", variant === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : variant === "warning" ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-border bg-secondary text-secondary-foreground", className)} {...props}>{children}</div>;
}
export function IconButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function InlineAction(props: ComponentProps<typeof Button>) { return <Button variant="link" size="inline" className="font-medium" {...props} />; }
