"use client";

import { createPortal } from "react-dom";
import type { SuggestFieldKind, SuggestItem } from "@/lib/plan/jsonSuggest";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  items: SuggestItem[];
  activeIndex: number;
  top: number;
  left: number;
  kind: SuggestFieldKind | null;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
};

const KIND_LABEL: Record<SuggestFieldKind, string> = {
  state: "states",
  stage: "stages",
  variable: "variables",
};

export function OeSuggestPopup({
  open,
  items,
  activeIndex,
  top,
  left,
  kind,
  onHover,
  onPick,
}: Props) {
  if (!open || !items.length || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[9999] min-w-[14rem] max-w-[22rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ top, left }}
      role="listbox"
      aria-label={kind ? `OE ${KIND_LABEL[kind]}` : "suggestions"}
    >
      <div className="border-b border-border px-2 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        {kind ? KIND_LABEL[kind] : "suggestions"}
        <span className="ml-2 normal-case opacity-60">↑↓ Enter Esc</span>
      </div>
      <ul className="max-h-56 overflow-auto py-1">
        {items.map((item, i) => (
          <li key={`${item.detail}:${item.value}`}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-xs",
                i === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/60",
              )}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(i);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.value}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {item.detail}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
