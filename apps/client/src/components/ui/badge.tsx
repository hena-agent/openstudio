import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium leading-4 whitespace-nowrap [&_svg]:size-3", { variants: { variant: { default: "border-border bg-secondary text-secondary-foreground", success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200", warning: "border-amber-300/30 bg-amber-300/10 text-amber-200", destructive: "border-destructive/30 bg-destructive/10 text-destructive", outline: "border-border text-muted-foreground" } }, defaultVariants: { variant: "default" } });
export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) { return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />; }
