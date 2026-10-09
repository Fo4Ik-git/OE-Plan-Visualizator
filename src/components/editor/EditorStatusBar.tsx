"use client";

import { cn } from "@/lib/utils";

export type EditorStatusBarProps = {
  className?: string;
  status: string;
};

export function EditorStatusBar({ className, status }: EditorStatusBarProps) {
  return (
    <footer
      className={cn(
        "truncate border-t bg-card/80 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
      title={status}
    >
      {status}
    </footer>
  );
}
