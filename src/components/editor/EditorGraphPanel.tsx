"use client";

import type { ReactNode } from "react";
import { LayoutIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ValidationBadge } from "@/components/editor/ValidationBadge";
import type { ValidationResult } from "@/lib/plan/types";
import { cn } from "@/lib/utils";

export type EditorGraphPanelProps = {
  className?: string;
  hint?: string;
  validation?: ValidationResult | null;
  oeCheck?: string | null;
  onAddAfterSelected: () => void;
  onDeleteSelected: () => void;
  onRelayout: () => void;
  children: ReactNode;
};

export function EditorGraphPanel({
  className,
  hint,
  validation = null,
  oeCheck = null,
  onAddAfterSelected,
  onDeleteSelected,
  onRelayout,
  children,
}: EditorGraphPanelProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/60 px-2.5 py-2">
        <ValidationBadge validation={validation} oeCheck={oeCheck} />
        <Button size="sm" variant="outline" onClick={onAddAfterSelected}>
          <PlusIcon data-icon="inline-start" />
          After selected
        </Button>
        <Button size="sm" variant="destructive" onClick={onDeleteSelected}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
        <Button size="sm" variant="outline" onClick={onRelayout}>
          <LayoutIcon data-icon="inline-start" />
          Relayout
        </Button>
        {hint ? (
          <span className="ml-auto hidden min-w-0 truncate text-xs text-muted-foreground 2xl:inline">
            {hint}
          </span>
        ) : null}
      </div>
      <div className="graph-host min-h-0 flex-1">{children}</div>
    </div>
  );
}
