import {
  formatMeaningfulError,
  type RunHighlight,
  type StateHistoryRow,
  type StepOutcome,
} from "@/lib/plan/execution";

/** Seven fields OE records per state visit (portal Raw tabs). */
export const RAW_FIELD_KEYS = [
  "request",
  "result",
  "input",
  "callback",
  "error",
  "output",
  "context",
] as const;

export type RawFieldKey = (typeof RAW_FIELD_KEYS)[number];

export type StepVisit = {
  index: number;
  iteration?: number;
  retry?: number;
  type?: string;
  createdAt?: number;
  fields: Partial<Record<RawFieldKey, unknown>>;
  errorText: string;
};

export type ExecutionStep = {
  state: string;
  outcome: StepOutcome;
  visits: StepVisit[];
  endedHere: boolean;
  firstAt: number | null;
  lastAt: number | null;
};

function recorded(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function errorText(value: unknown): string {
  return formatMeaningfulError(value);
}

/**
 * Fold consecutive rows with the same iteration+retry into one visit
 * (portal rawFields.rawVisits).
 */
export function mergeVisits(rows: StateHistoryRow[]): StepVisit[] {
  const groups: StateHistoryRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last[0].iteration === row.iteration &&
      last[0].retry === row.retry
    ) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }

  return groups.map((group, index) => {
    const merged: Record<string, unknown> = {};
    for (const key of new Set(group.flatMap((r) => Object.keys(r)))) {
      const withValue = group.find((r) => recorded(r[key]));
      const fallback = group.find((r) => r[key] !== undefined);
      merged[key] = (withValue ?? fallback)?.[key];
    }
    const fields: Partial<Record<RawFieldKey, unknown>> = {};
    for (const key of RAW_FIELD_KEYS) {
      const value = merged[key];
      if (value === undefined) continue;
      // Skip empty error shells OE leaves on successful steps.
      if (key === "error" && !formatMeaningfulError(value)) continue;
      if (!recorded(value) && key !== "error") continue;
      fields[key] = value;
    }
    return {
      index,
      iteration: merged.iteration as number | undefined,
      retry: merged.retry as number | undefined,
      type: typeof merged.type === "string" ? merged.type : undefined,
      createdAt:
        typeof merged.created_at === "number" ? merged.created_at : undefined,
      fields,
      errorText: errorText(merged.error),
    };
  });
}

function outcomeFor(
  state: string,
  highlight: RunHighlight | null,
  visits: StepVisit[],
  current: string | null,
): StepOutcome {
  if (highlight?.outcomes[state]) return highlight.outcomes[state];
  if (visits.some((v) => v.errorText)) return "failed";
  if (state === current) return "running";
  if (visits.length > 0) return "completed";
  return "notreached";
}

/**
 * Portal-style step list: visited states in first-seen order, then remaining plan states.
 */
export function buildExecutionSteps(
  stateHistory: StateHistoryRow[],
  planOrder: string[],
  highlight: RunHighlight | null,
): ExecutionStep[] {
  const current = highlight?.current || null;
  const byState = new Map<string, StateHistoryRow[]>();
  const visitOrder: string[] = [];

  for (const row of stateHistory) {
    const name = row.state;
    if (!name || typeof name !== "string") continue;
    if (!byState.has(name)) {
      byState.set(name, []);
      visitOrder.push(name);
    }
    byState.get(name)!.push(row);
  }

  const steps: ExecutionStep[] = [];
  const seen = new Set<string>();

  for (const state of visitOrder) {
    seen.add(state);
    const visits = mergeVisits(byState.get(state) || []);
    const times = visits
      .map((v) => v.createdAt)
      .filter((t): t is number => typeof t === "number");
    steps.push({
      state,
      outcome: outcomeFor(state, highlight, visits, current),
      visits,
      endedHere: state === current,
      firstAt: times.length ? Math.min(...times) : null,
      lastAt: times.length ? Math.max(...times) : null,
    });
  }

  for (const state of planOrder) {
    if (seen.has(state)) continue;
    steps.push({
      state,
      outcome: "notreached",
      visits: [],
      endedHere: false,
      firstAt: null,
      lastAt: null,
    });
  }

  return steps;
}

export function formatFieldJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 4);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 4);
  } catch {
    return String(value);
  }
}
