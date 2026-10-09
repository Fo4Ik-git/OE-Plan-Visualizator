"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlanNameOption = {
  id: string;
  /** Optional hint under the id (service / owner). */
  hint?: string;
  source: "lua" | "oe";
};

type Props = {
  value: string;
  options: PlanNameOption[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onPick?: (option: PlanNameOption) => void;
  onEnter?: () => void;
};

export function PlanNameCombobox({
  value,
  options,
  loading = false,
  placeholder = "Search plan_id…",
  disabled = false,
  onChange,
  onPick,
  onEnter,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = !q
      ? options
      : options.filter(
          (o) =>
            o.id.toLowerCase().includes(q) ||
            (o.hint || "").toLowerCase().includes(q),
        );
    // Prefer exact / prefix matches first
    return [...list]
      .sort((a, b) => {
        const aq = a.id.toLowerCase();
        const bq = b.id.toLowerCase();
        const aExact = aq === q ? 0 : aq.startsWith(q) ? 1 : 2;
        const bExact = bq === q ? 0 : bq.startsWith(q) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 80);
  }, [options, value]);

  useEffect(() => {
    setActive(0);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (opt: PlanNameOption) => {
    onChange(opt.id);
    onPick?.(opt);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="relative">
        <input
          className={cn(
            "flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm",
            "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "dark:bg-input/30",
            disabled && "opacity-50",
          )}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                filtered.length ? (i + 1) % filtered.length : 0,
              );
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                filtered.length
                  ? (i - 1 + filtered.length) % filtered.length
                  : 0,
              );
              return;
            }
            if (e.key === "Enter") {
              if (open && filtered[active]) {
                e.preventDefault();
                pick(filtered[active]);
                return;
              }
              onEnter?.();
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle plan list"
        >
          {loading ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <ChevronsUpDownIcon className="size-3.5" />
          )}
        </button>
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">
              {loading ? "Loading plans…" : "No matching plan_id"}
            </li>
          ) : (
            filtered.map((opt, idx) => {
              const selected = opt.id === value;
              return (
                <li key={`${opt.source}:${opt.id}`}>
                  <button
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={idx === active}
                    className={cn(
                      "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm",
                      idx === active && "bg-accent text-accent-foreground",
                      idx !== active && "hover:bg-muted/50",
                    )}
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(opt);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">
                        {opt.id}
                      </span>
                      {opt.hint ? (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {opt.hint}
                          {opt.source === "oe" ? " · OE" : " · lua"}
                        </span>
                      ) : (
                        <span className="block text-[10px] text-muted-foreground">
                          {opt.source === "oe" ? "deployed on OE" : "lua repo"}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
