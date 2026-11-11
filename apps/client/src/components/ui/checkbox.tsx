import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) { return <input data-slot="checkbox" type="checkbox" className={cn("mt-0.5 size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />; }
