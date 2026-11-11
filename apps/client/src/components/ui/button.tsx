// Adapted from shadcn/ui (MIT), new-york-v4/button. Studio controls use 44px.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
      outline: "border border-input bg-transparent text-foreground hover:bg-accent",
      secondary: "border border-border bg-secondary text-secondary-foreground hover:bg-accent",
      ghost: "border border-transparent text-foreground hover:bg-accent",
      destructive: "border border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25",
      link: "border-0 bg-transparent text-primary underline-offset-4 hover:underline",
    },
    size: { default: "h-11 px-4", sm: "h-9 px-3", icon: "size-11 p-0", "icon-sm": "size-9 p-0", inline: "h-auto min-h-0 p-0 leading-normal" },
  }, defaultVariants: { variant: "default", size: "default" },
});
export function Button({ className, variant, size, asChild = false, type, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" data-variant={variant || "default"} className={cn(buttonVariants({ variant, size }), className)} type={type || (asChild ? undefined : "button")} {...props} />;
}
