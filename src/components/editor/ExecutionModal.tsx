"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { toast } from "sonner";
import { pretty } from "@/lib/api";
import type { ExecutionBundle, StepOutcome } from "@/lib/plan/execution";
import {
  haltExecution,
  isTerminalStatus,
  restartExecution,
} from "@/lib/plan/execution";
import {
  buildExecutionSteps,
  formatFieldJson,
  RAW_FIELD_KEYS,
  type ExecutionStep,
  type RawFieldKey,
} from "@/lib/plan/executionSteps";
import { AppDialog } from "@/components/editor/AppDialog";
import { JsonEditor } from "@/components/JsonEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { statusBadgeClass } from "@/lib/executionStatus";
import { cn } from "@/lib/utils";

const OUTCOME_STYLE: Record<StepOutcome, string> = {
  completed: "bg-emerald-900/50 text-emerald-200 border-emerald-700/50",
  failed: "bg-red-900/50 text-red-200 border-red-700/50",
  running: "bg-sky-900/50 text-sky-200 border-sky-700/50",
  waiting: "bg-amber-900/50 text-amber-200 border-amber-700/50",
  stopped: "bg-zinc-800 text-zinc-300 border-zinc-600/50",
  notreached: "bg-muted text-muted-foreground border-border",
};

const FIELD_LABEL: Record<RawFieldKey, string> = {
  request: "request",
  result: "response",
  input: "input",
  callback: "callback",
  error: "error",
  output: "output",
  context: "context",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundle: ExecutionBundle | null;
  planOrder: string[];
  planVersion: number | null;
  /** Currently open editor plan_id — warn when execution is for another plan. */
  openPlanId?: string | null;
  host: string;
  token: string | null;
  polling?: boolean;
  initialState?: string | null;
  onRefresh: () => void;
  onAfterAction: () => void;
  onLog: (line: string) => void;
};

function canResumeStatus(status: string): boolean {
  return [
    "WAITING_FOR_RESTART",
    "FAILED",
    "STOPPED",
    "PAUSE_EXPIRED",
    "ACTION_FAILED",
  ].includes(status.toUpperCase());
}

export function ExecutionModal({
  open,
  onOpenChange,
  bundle,
  planOrder,
  planVersion,
  openPlanId = null,
  host,
  token,
  polling,
  initialState,
  onRefresh,
  onAfterAction,
  onLog,
}: Props) {
  const steps = useMemo(
    () =>
      bundle
        ? buildExecutionSteps(bundle.stateHistory, planOrder, bundle.highlight)
        : [],
    [bundle, planOrder],
  );

  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [visitIndex, setVisitIndex] = useState(0);
  const [fieldTab, setFieldTab] = useState<RawFieldKey>("input");
  const [resumeOpen, setResumeOpen] = useState(false);
  const [continueState, setContinueState] = useState("");
  const [resumeInput, setResumeInput] = useState("{}");
  const [mergeInput, setMergeInput] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !bundle) return;
    const prefer =
      initialState ||
      bundle.highlight.current ||
      bundle.lastState ||
      steps.find((s) => s.visits.length)?.state ||
      steps[0]?.state ||
      null;
    setSelectedState(prefer);
    setVisitIndex(0);
    setResumeOpen(false);
    // only reset selection when opening / switching execution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bundle?.executionId]);

  useEffect(() => {
    if (!open || !initialState) return;
    setSelectedState(initialState);
    setVisitIndex(0);
  }, [open, initialState]);

  useEffect(() => {
    setVisitIndex(0);
  }, [selectedState]);

  const selected: ExecutionStep | null =
    steps.find((s) => s.state === selectedState) || null;
  const visit = selected?.visits[visitIndex] || selected?.visits[0] || null;

  useEffect(() => {
    if (!visit) return;
    const prefer = (["input", "output", "result", "request", "error"] as RawFieldKey[]).find(
      (k) => visit.fields[k] != null,
    );
    if (prefer) setFieldTab(prefer);
  }, [selectedState, visitIndex, visit?.index]);

  const openResume = (fromState?: string) => {
    if (!bundle) return;
    setContinueState(
      fromState ||
        selectedState ||
        bundle.lastState ||
        planOrder[0] ||
        "",
    );
    setResumeInput(pretty(bundle.input || {}));
    setMergeInput(true);
    setResumeOpen(true);
  };

  const doResume = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      let input: Record<string, unknown> | null = null;
      if (resumeInput.trim()) input = JSON.parse(resumeInput);
      const resp = await restartExecution(host, token, bundle.executionId, {
        continueState: continueState || null,
        input,
        mergeCurrentInput: mergeInput,
        planVersion,
      });
      onLog(
        `restart_state continue=${continueState} HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 300)}`,
      );
      if (resp.status >= 400) {
        toast.error(
          (resp.body as { msg?: string })?.msg ||
            `restart_state HTTP ${resp.status}`,
        );
        return;
      }
      toast.success(`Resume from ${continueState}`);
      setResumeOpen(false);
      onAfterAction();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`restart_state ERROR: ${msg}`);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const doHalt = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const resp = await haltExecution(host, token, bundle.executionId);
      onLog(
        `halt_execution HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 240)}`,
      );
      toast.success("Halt requested");
      onAfterAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!bundle) return null;

  const terminal = isTerminalStatus(bundle.status);
  const resumable = canResumeStatus(bundle.status);
  const fieldText = visit ? formatFieldJson(visit.fields[fieldTab]) : "";
  const planMismatch =
    Boolean(bundle.planId) &&
    Boolean(openPlanId) &&
    bundle.planId !== openPlanId;

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Execution"
        size="fullscreen"
        className="sm:max-w-6xl"
        bodyClassName="min-h-[min(70svh,640px)] overflow-hidden"
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              variant="outline"
              disabled={!resumable || busy}
              onClick={() => openResume()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Resume…
            </Button>
            <Button
              variant="destructive"
              disabled={terminal || busy}
              onClick={() => void doHalt()}
            >
              <SquareIcon data-icon="inline-start" />
              Halt
            </Button>
          </>
        }
      >
        <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-1">
          {planMismatch ? (
            <div className="shrink-0 rounded-md border border-amber-600/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
              Attached execution is for plan{" "}
              <code className="font-mono">{bundle.planId}</code>, but the editor
              has <code className="font-mono">{openPlanId}</code> open. Graph
              highlight / resume targets may not match this plan&apos;s states.
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={statusBadgeClass(bundle.status)}
            >
              {bundle.status || "—"}
            </Badge>
            {polling ? (
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {bundle.executionId}
            </code>
            {bundle.planId ? (
              <span className="text-xs text-muted-foreground">
                plan: <span className="text-foreground">{bundle.planId}</span>
              </span>
            ) : null}
            {planMismatch ? (
              <Badge variant="destructive">other plan</Badge>
            ) : null}
            {bundle.lastState ? (
              <span className="text-xs text-muted-foreground">
                last:{" "}
                <span className="text-foreground">{bundle.lastState}</span>
              </span>
            ) : null}
          </div>
          {bundle.error ? (
            <pre className="max-h-16 shrink-0 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
              {bundle.error}
            </pre>
          ) : null}

          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border">
              <div className="shrink-0 border-b px-2.5 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Steps ({steps.filter((s) => s.visits.length).length}/
                {steps.length})
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                {steps.map((step, i) => {
                  const visited = step.visits.length > 0;
                  return (
                    <li key={step.state}>
                      <button
                        type="button"
                        onClick={() => setSelectedState(step.state)}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          selectedState === step.state
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/60",
                          !visited && "opacity-50",
                        )}
                      >
                        <span className="w-5 shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
                          {visited ? i + 1 : "·"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {step.state}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className={cn(
                                "rounded border px-1 py-px text-[10px]",
                                OUTCOME_STYLE[step.outcome],
                              )}
                            >
                              {step.outcome}
                            </span>
                            {step.endedHere ? (
                              <span className="text-[10px] text-sky-400">
                                current
                              </span>
                            ) : null}
                            {step.visits.length > 1 ? (
                              <span className="text-[10px] text-muted-foreground">
                                {step.visits.length} visits
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border">
              {!selected ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Select a step
                </div>
              ) : (
                <>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2.5 py-1.5">
                    <span className="font-medium">{selected.state}</span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-px text-[10px]",
                        OUTCOME_STYLE[selected.outcome],
                      )}
                    >
                      {selected.outcome}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      disabled={!resumable || busy}
                      onClick={() => openResume(selected.state)}
                      title="restart_state from this step"
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      Resume from here
                    </Button>
                  </div>

                  {selected.visits.length > 1 ? (
                    <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1.5">
                      {selected.visits.map((v) => (
                        <Button
                          key={v.index}
                          size="xs"
                          variant={
                            visitIndex === v.index ? "default" : "outline"
                          }
                          onClick={() => setVisitIndex(v.index)}
                        >
                          visit {v.index + 1}
                          {v.retry != null ? ` · r${v.retry}` : ""}
                          {v.errorText ? " !" : ""}
                        </Button>
                      ))}
                    </div>
                  ) : null}

                  {selected.visits.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                      Not reached in this run
                    </div>
                  ) : (
                    <>
                      <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1.5">
                        {RAW_FIELD_KEYS.map((key) => {
                          const has = visit?.fields[key] != null;
                          return (
                            <Button
                              key={key}
                              size="xs"
                              variant={fieldTab === key ? "default" : "ghost"}
                              disabled={!has}
                              onClick={() => setFieldTab(key)}
                            >
                              {FIELD_LABEL[key]}
                            </Button>
                          );
                        })}
                      </div>
                      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#1e1e1e]">
                        {fieldText ? (
                          <JsonEditor
                            value={fieldText}
                            readOnly
                            height="100%"
                            className="h-full min-h-0 rounded-none border-0"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            —
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </AppDialog>

      <AppDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        title="Resume execution"
        size="wide"
        footer={
          <>
            <Button variant="outline" onClick={() => setResumeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !continueState} onClick={() => void doResume()}>
              {busy ? (
                <Loader2Icon className="size-3.5 animate-spin" data-icon="inline-start" />
              ) : (
                <RotateCcwIcon data-icon="inline-start" />
              )}
              Restart from step
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel>continue_state</FieldLabel>
          <select
            className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
            value={continueState}
            onChange={(e) => setContinueState(e.target.value)}
          >
            {planOrder.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {continueState && !planOrder.includes(continueState) ? (
              <option value={continueState}>{continueState}</option>
            ) : null}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={mergeInput}
            onCheckedChange={(c) => setMergeInput(c === true)}
          />
          merge_current_input (deep-merge onto existing execution input)
        </label>
        <Field>
          <FieldLabel>input</FieldLabel>
        </Field>
        <JsonEditor value={resumeInput} onChange={setResumeInput} height={220} />
      </AppDialog>
    </>
  );
}
