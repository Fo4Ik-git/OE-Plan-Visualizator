"use client";

import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/** Monaco cancels in-flight ops on remount/HMR — noisy, not actionable. */
function isMonacoCancelation(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const r = reason as { type?: string; msg?: string; message?: string };
  return (
    r.type === "cancelation" ||
    r.msg === "operation is manually canceled" ||
    r.message === "operation is manually canceled"
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isMonacoCancelation(event.reason)) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return (
    <TooltipProvider>
      <div className="h-full min-h-0 overflow-hidden">{children}</div>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
