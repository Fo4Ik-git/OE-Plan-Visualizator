"use client";

import Link from "next/link";
import {
  ClipboardCopyIcon,
  FileJsonIcon,
  FolderOpenIcon,
  LayoutListIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type EditorToolbarProps = {
  className?: string;
  brand?: string;
  oeCheckBusy?: boolean;
  onNew: () => void;
  onOpenLua: () => void;
  onPaste: () => void;
  onCopyJson: () => void;
  onOeCheck: () => void;
  onRun: () => void;
  onSettings: () => void;
};

export function EditorToolbar({
  className,
  brand = "OE Plan Creator",
  oeCheckBusy = false,
  onNew,
  onOpenLua,
  onPaste,
  onCopyJson,
  onOeCheck,
  onRun,
  onSettings,
}: EditorToolbarProps) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 overflow-hidden border-b bg-card/80 px-3 py-2 backdrop-blur-md",
        className,
      )}
    >
      <div className="mr-2 flex min-w-0 max-w-full items-center gap-2 truncate font-semibold tracking-tight">
        <span className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_16px_var(--primary)]" />
        <span className="truncate">{brand}</span>
      </div>
      <Button size="sm" onClick={onNew}>
        <PlusIcon data-icon="inline-start" />
        New
      </Button>
      <Button size="sm" variant="outline" onClick={onOpenLua}>
        <FolderOpenIcon data-icon="inline-start" />
        Open from lua
      </Button>
      <Button size="sm" variant="outline" onClick={onPaste}>
        <FileJsonIcon data-icon="inline-start" />
        Paste JSON
      </Button>
      <Button size="sm" variant="outline" onClick={onCopyJson}>
        <ClipboardCopyIcon data-icon="inline-start" />
        Copy JSON
      </Button>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Button
        size="sm"
        variant="outline"
        disabled={oeCheckBusy}
        title="Call OE check_plan (host from Settings)"
        onClick={onOeCheck}
      >
        <ShieldCheckIcon data-icon="inline-start" />
        {oeCheckBusy ? "OE check…" : "OE check"}
      </Button>
      <Button size="sm" onClick={onRun}>
        <PlayIcon data-icon="inline-start" />
        Run locally
      </Button>
      <Link
        href="/details"
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "inline-flex",
        )}
        title="Search executions by plan name or execution_id"
      >
        <LayoutListIcon data-icon="inline-start" />
        OE Plans Details
      </Link>
      <Button size="sm" variant="ghost" onClick={onSettings}>
        <SettingsIcon data-icon="inline-start" />
        Settings
      </Button>
    </header>
  );
}
