"use client";
import type { ReactNode } from "react";
import { TooltipProvider } from "./ui/tooltip";
export function UiProvider({ children }: { children: ReactNode }) { return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>; }
