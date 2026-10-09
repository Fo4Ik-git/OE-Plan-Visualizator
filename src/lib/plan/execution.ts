/* eslint-disable @typescript-eslint/no-explicit-any */
import { proxy } from "@/lib/plan/run";

export type StepOutcome =
  | "completed"
  | "failed"
  | "running"
  | "waiting"
  | "stopped"
  | "notreached";

export type RunHighlight = {
  outcomes: Record<string, StepOutcome>;
  current: string | null;
};

export type ExecutionBundle = {
  executionId: string;
  status: string;
  lastState: string | null;
  planId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  input: Record<string, unknown> | null;
  execution: Record<string, unknown> | null;
  stateHistory: StateHistoryRow[];
  executionHistory: unknown[];
  highlight: RunHighlight;
};

export type StateHistoryRow = {
  state?: string;
  type?: string;
  error?: string;
  created_at?: number;
  [key: string]: unknown;
};

const WAITING = new Set([
  "WAITING_FOR_CALLBACK",
  "WAITING_FOR_RESTART",
  "PENDING",
]);

const TERMINAL = new Set([
  "SUCCESS",
  "FAILED",
  "STOPPED",
  "ACTION_FAILED",
]);

export function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL.has(String(status).toUpperCase());
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { data: unknown[] }).data;
  }
  return [];
}

/**
 * OE often leaves `error: {}` / `null` / `""` on successful StateExecuted rows.
 * Those must NOT count as failures (portal ignores empty objects the same way).
 */
export function formatMeaningfulError(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return value ? String(value) : "";
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.length ? JSON.stringify(value) : "";
    }
    const keys = Object.keys(value as object);
    if (keys.length === 0) return "";
    const e = value as { message?: unknown; msg?: unknown; error?: unknown };
    if (typeof e.message === "string" && e.message.trim()) return e.message.trim();
    if (typeof e.msg === "string" && e.msg.trim()) return e.msg.trim();
    if (typeof e.error === "string" && e.error.trim()) return e.error.trim();
    return JSON.stringify(value);
  }
  return "";
}

function pickError(row: StateHistoryRow): string {
  return formatMeaningfulError(row.error);
}

/**
 * Portal-style (simplified) mapping of state history → graph highlight.
 * Mirrors redesign stepBuild outcomes enough for local debugging.
 */
export function buildRunHighlight(
  stateHistory: StateHistoryRow[],
  execution: {
    status?: string;
    last_state?: string;
    current_state?: string;
  } | null,
): RunHighlight {
  const status = String(execution?.status || "").toUpperCase();
  const current =
    execution?.last_state || execution?.current_state || null;
  const byState = new Map<string, StateHistoryRow[]>();

  for (const row of stateHistory) {
    const name = row.state;
    if (!name || typeof name !== "string") continue;
    const list = byState.get(name) || [];
    list.push(row);
    byState.set(name, list);
  }

  const outcomes: Record<string, StepOutcome> = {};
  for (const [state, rows] of byState) {
    const executed = rows.filter((r) => r.type === "StateExecuted");
    const paused = rows.some((r) => r.type === "ExecutionPaused");
    const lastExecErr = [...rows]
      .reverse()
      .find(
        (r) =>
          r.type === "StateExecuted" && Boolean(formatMeaningfulError(r.error)),
      );
    const isCurrent = state === current;

    if (lastExecErr) {
      outcomes[state] = "failed";
      continue;
    }
    if (isCurrent && status === "FAILED") {
      outcomes[state] = "failed";
      continue;
    }
    if (isCurrent && status === "STOPPED") {
      outcomes[state] = "stopped";
      continue;
    }
    if (isCurrent && status === "EXECUTING") {
      outcomes[state] = "running";
      continue;
    }
    if (isCurrent && WAITING.has(status)) {
      outcomes[state] = "waiting";
      continue;
    }
    if (paused && isCurrent) {
      outcomes[state] = "waiting";
      continue;
    }
    if (executed.length > 0 || rows.some((r) => r.type === "StateEntered")) {
      outcomes[state] = "completed";
      continue;
    }
    outcomes[state] = "notreached";
  }

  if (current && !outcomes[current]) {
    if (status === "FAILED") outcomes[current] = "failed";
    else if (status === "EXECUTING") outcomes[current] = "running";
    else if (WAITING.has(status)) outcomes[current] = "waiting";
    else if (status === "STOPPED") outcomes[current] = "stopped";
  }

  return { outcomes, current };
}

export async function fetchExecutionBundle(
  host: string,
  token: string | null,
  executionId: string,
): Promise<ExecutionBundle> {
  const getResp = await proxy(
    host,
    token,
    "/api/v3/orchestration/get_execution",
    { execution_id: executionId },
    "POST",
  );
  const getBody = getResp.body || {};
  const execution = (getBody.execution || getBody) as Record<string, unknown>;
  const status = String(execution.status || getBody.status || "");
  const lastState = (execution.last_state ||
    execution.current_state ||
    null) as string | null;
  const planId = (execution.plan_id || getBody.plan_id || null) as string | null;

  const stateResp = await proxy(
    host,
    token,
    "/api/v3/orchestration/get_state_history",
    { execution_id: executionId },
    "POST",
  );
  const stateBody = stateResp.body || {};
  const stateHistory = asArray(
    stateBody.history ||
      stateBody.state_history ||
      stateBody.states ||
      stateBody.data,
  ) as StateHistoryRow[];

  const histResp = await proxy(
    host,
    token,
    "/api/v3/orchestration/get_execution_history",
    { execution_id: executionId },
    "POST",
  );
  const histBody = histResp.body || {};
  const executionHistory = asArray(
    histBody.history || histBody.execution_history || histBody.data,
  );

  let error: string | null = null;
  for (const row of [...stateHistory].reverse()) {
    const e = pickError(row);
    if (e) {
      error = e;
      break;
    }
  }

  const input =
    (getBody.current_execution_input as Record<string, unknown>) ||
    (execution.input as Record<string, unknown>) ||
    null;

  const highlight = buildRunHighlight(stateHistory, {
    status,
    last_state: lastState || undefined,
    current_state: (execution.current_state as string) || undefined,
  });

  // Browser console (DevTools). Server-side OE I/O is logged in /api/proxy.
  const emptyErrorRows = stateHistory.filter(
    (r) =>
      r.error != null &&
      typeof r.error === "object" &&
      !Array.isArray(r.error) &&
      Object.keys(r.error as object).length === 0,
  ).length;
  console.info("[oe-exec]", {
    executionId,
    status,
    lastState,
    planId,
    stateHistoryRows: stateHistory.length,
    emptyErrorObjects: emptyErrorRows,
    realErrors: stateHistory.filter((r) => formatMeaningfulError(r.error)).length,
    outcomes: highlight.outcomes,
    sampleRow: stateHistory[0]
      ? {
          state: stateHistory[0].state,
          type: stateHistory[0].type,
          error: stateHistory[0].error,
          keys: Object.keys(stateHistory[0]),
        }
      : null,
  });

  return {
    executionId,
    status,
    lastState,
    planId,
    startedAt: (execution.started_at as number) || null,
    finishedAt: (execution.finished_at as number) || null,
    error,
    input,
    execution,
    stateHistory,
    executionHistory,
    highlight,
  };
}

export type RestartOptions = {
  continueState?: string | null;
  input?: Record<string, unknown> | null;
  mergeCurrentInput?: boolean;
  planVersion?: number | null;
  ignoreNotRetryable?: boolean;
};

/** Portal ResumeExecutionModal → restart_state */
export async function restartExecution(
  host: string,
  token: string | null,
  executionId: string,
  opts: RestartOptions = {},
) {
  const body: Record<string, unknown> = {
    execution_id: executionId,
    merge_current_input: opts.mergeCurrentInput !== false,
    ignore_not_retryable: opts.ignoreNotRetryable === true,
  };
  if (opts.continueState) body.continue_state = opts.continueState;
  if (opts.input) body.input = opts.input;
  if (typeof opts.planVersion === "number") body.plan_version = opts.planVersion;
  return proxy(host, token, "/api/v3/orchestration/restart_state", body, "POST");
}

export async function haltExecution(
  host: string,
  token: string | null,
  executionId: string,
) {
  return proxy(
    host,
    token,
    "/api/v3/orchestration/halt_execution",
    { plan_execution_id: executionId },
    "POST",
  );
}

/** Sample input matching fiber-team delayed_activate_billing IT (fill IDs after buyflow). */
export const ACTIVATE_BILLING_SAMPLE_INPUT = {
  operator_name: "pilotfiber",
  account_id: "<base_account_id>",
  subscriber_id: "<base_subscriber_id>",
  billing_activation_timestamp: 1760097600,
  billing_activation_trigger: "service_activation",
};
