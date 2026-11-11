// Composable shadcn/ui card primitives (MIT), adapted to the studio spacing scale.
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card" className={cn("flex min-w-0 flex-col gap-6 rounded-lg border border-border bg-card text-[15px] leading-7 text-card-foreground", className)} {...props} />; }
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-header" className={cn("grid gap-2 px-6 pt-6", className)} {...props} />; }
export function CardTitle({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-title" className={cn("text-base font-semibold leading-6", className)} {...props} />; }
export function CardDescription({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-description" className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />; }
export function CardContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-content" className={cn("px-6", className)} {...props} />; }
export function CardFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="card-footer" className={cn("flex items-center gap-3 px-6 pb-6", className)} {...props} />; }
