import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <div data-slot="native-select" className="relative min-w-0"><select className={cn("h-11 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-background py-2 pr-9 pl-3 text-[15px] leading-6 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive max-sm:text-base", className)} {...props} /><ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" /></div>;
}
