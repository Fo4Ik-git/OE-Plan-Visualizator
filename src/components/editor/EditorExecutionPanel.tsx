"use client";

import Link from "next/link";
import {
  ExternalLinkIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { statusBadgeClass } from "@/lib/executionStatus";
import type { ExecutionBundle } from "@/lib/plan/execution";
import { isTerminalStatus } from "@/lib/plan/execution";
import { cn } from "@/lib/utils";

export type EditorExecutionPanelProps = {
  className?: string;
  bundle: ExecutionBundle | null;
  polling?: boolean;
  /** Currently open editor plan_id — when different from execution, show warn. */
  openPlanId?: string | null;
  onOpen: () => void;
  onRefresh: () => void;
  onHalt: () => void;
  onClear: () => void;
};

export function EditorExecutionPanel({
  className,
  bundle,
  polling,
  openPlanId = null,
  onOpen,
  onRefresh,
  onHalt,
  onClear,
}: EditorExecutionPanelProps) {
  if (!bundle) return null;

  const terminal = isTerminalStatus(bundle.status);
  const canHalt = !terminal && bundle.status.toUpperCase() !== "STOPPED";
  const visited = Object.values(bundle.highlight.outcomes).filter(
    (o) => o !== "notreached",
  ).length;
  const planMismatch =
    Boolean(bundle.planId) &&
    Boolean(openPlanId) &&
    bundle.planId !== openPlanId;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1.5 border-t bg-card/80 px-2.5 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Execution
        </span>
        <Badge
          variant="outline"
          className={statusBadgeClass(bundle.status)}
          title={bundle.status}
        >
          {bundle.status || "—"}
        </Badge>
        {polling ? (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {bundle.executionId}
        </code>
        {planMismatch ? (
          <Badge
            variant="destructive"
            title={`Execution plan_id “${bundle.planId}” ≠ open “${openPlanId}”`}
          >
            other plan
          </Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="xs" onClick={onOpen}>
            <Maximize2Icon data-icon="inline-start" />
            Open
          </Button>
          <Link
            href={`/details?execution_id=${encodeURIComponent(bundle.executionId)}`}
            className={cn(
              buttonVariants({ size: "xs", variant: "outline" }),
              "inline-flex",
            )}
            title="Open in OE Plans Details"
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Details
          </Link>
          <Button size="xs" variant="outline" onClick={onRefresh}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
          <Button
            size="xs"
            variant="destructive"
            disabled={!canHalt}
            onClick={onHalt}
          >
            <SquareIcon data-icon="inline-start" />
            Halt
          </Button>
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {bundle.planId ? (
          <span>
            plan: <span className="text-foreground">{bundle.planId}</span>
            {planMismatch ? (
              <span className="text-amber-500">
                {" "}
                (editor: {openPlanId})
              </span>
            ) : null}
          </span>
        ) : null}
        {bundle.lastState ? (
          <span>
            last_state:{" "}
            <span className="text-foreground">{bundle.lastState}</span>
          </span>
        ) : null}
        <span>
          visited: <span className="text-foreground">{visited}</span>
        </span>
        {bundle.error ? (
          <span className="truncate text-destructive" title={bundle.error}>
            {bundle.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
