import { assertLocalOeHost } from "@/lib/plan/localHost";
import { proxy } from "@/lib/plan/run";

export type ExecutionListItem = {
  executionId: string;
  planId: string | null;
  status: string;
  lastState: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  scheduledFor: number | null;
  source: "cassandra" | "direct";
};

export type SearchExecutionsOpts = {
  host: string;
  token: string;
  /** Exact or partial plan_id — matched against knownPlanIds locally. */
  planQuery?: string;
  /** Exact execution_id — uses get_execution only. */
  executionId?: string;
  pageSize?: number;
  /** Local catalog (lua plan names + optional local OE get_plans). */
  knownPlanIds?: string[];
};

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { data: unknown[] }).data;
  }
  return [];
}

function normalizeRow(
  raw: Record<string, unknown>,
  source: ExecutionListItem["source"],
): ExecutionListItem | null {
  const executionId = String(
    raw.execution_id || raw.plan_execution_id || raw.id || "",
  ).trim();
  if (!executionId) return null;
  return {
    executionId,
    planId: (raw.plan_id as string) || null,
    status: String(raw.status || ""),
    lastState: (raw.last_state as string) || (raw.current_state as string) || null,
    startedAt:
      typeof raw.started_at === "number"
        ? raw.started_at
        : raw.started_at != null
          ? Number(raw.started_at) || null
          : null,
    finishedAt:
      typeof raw.finished_at === "number"
        ? raw.finished_at
        : raw.finished_at != null
          ? Number(raw.finished_at) || null
          : null,
    scheduledFor:
      typeof raw.scheduled_for === "number"
        ? raw.scheduled_for
        : raw.scheduled_for != null
          ? Number(raw.scheduled_for) || null
          : null,
    source,
  };
}

function rowsFromBody(
  body: Record<string, unknown> | null | undefined,
  source: ExecutionListItem["source"],
): ExecutionListItem[] {
  if (!body) return [];
  const list = asArray(body.executions || body.data || body.results);
  const out: ExecutionListItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const item = normalizeRow(row as Record<string, unknown>, source);
    if (item) out.push(item);
  }
  return out;
}

/** Lookup one execution by id on local OE. */
export async function lookupExecutionById(
  host: string,
  token: string,
  executionId: string,
): Promise<ExecutionListItem> {
  const local = assertLocalOeHost(host);
  const resp = await proxy(
    local,
    token,
    "/api/v3/orchestration/get_execution",
    { execution_id: executionId },
    "POST",
  );
  if (resp.status >= 400) {
    throw new Error(
      `get_execution HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 400)}`,
    );
  }
  const body = (resp.body || {}) as Record<string, unknown>;
  const execution = (body.execution || body) as Record<string, unknown>;
  const item = normalizeRow(
    {
      ...execution,
      execution_id: execution.execution_id || executionId,
      plan_id: execution.plan_id || body.plan_id,
    },
    "direct",
  );
  if (!item) throw new Error("Execution not found in get_execution response");
  return item;
}

/** Plan ids deployed on local OE (`get_plans`). */
export async function fetchOePlanIds(
  host: string,
  token: string,
): Promise<string[]> {
  const local = assertLocalOeHost(host);
  const resp = await proxy(
    local,
    token,
    "/api/v3/orchestrationplan/get_plans",
    {},
    "POST",
  );
  if (resp.status >= 400) return [];
  const body = (resp.body || {}) as Record<string, unknown>;
  const plans = asArray(body.plans);
  const ids: string[] = [];
  for (const p of plans) {
    if (!p || typeof p !== "object") continue;
    const id = String((p as { plan_id?: unknown }).plan_id || "").trim();
    if (id) ids.push(id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function matchKnownPlanIds(query: string, known: string[]): string[] {
  const q = query.toLowerCase();
  const exact = known.filter((id) => id.toLowerCase() === q);
  if (exact.length) return exact;
  const starts = known.filter((id) => id.toLowerCase().startsWith(q));
  const mid = known.filter(
    (id) =>
      !id.toLowerCase().startsWith(q) && id.toLowerCase().includes(q),
  );
  return starts.concat(mid).slice(0, 12);
}

async function getExecutionsForPlan(
  host: string,
  token: string,
  planId: string,
  pageSize: number,
): Promise<ExecutionListItem[]> {
  const resp = await proxy(
    host,
    token,
    "/api/v3/orchestration/get_executions",
    { plan_id: planId, page_size: pageSize },
    "POST",
  );
  if (resp.status >= 400) {
    throw new Error(
      `get_executions(${planId}) HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 280)}`,
    );
  }
  return rowsFromBody(resp.body as Record<string, unknown>, "cassandra").map(
    (item) => ({ ...item, planId: item.planId || planId }),
  );
}

/**
 * Local-only execution search:
 * - execution_id → get_execution
 * - plan name → match against knownPlanIds (lua / local OE), then get_executions per id
 * Never calls OpenSearch / remote Portal.
 */
export async function searchExecutions(
  opts: SearchExecutionsOpts,
): Promise<{ items: ExecutionListItem[]; note?: string }> {
  const host = assertLocalOeHost(opts.host);
  const token = opts.token.trim();
  const executionId = (opts.executionId || "").trim();
  const planQuery = (opts.planQuery || "").trim();
  const pageSize = opts.pageSize ?? 50;
  const known = opts.knownPlanIds || [];

  if (!token) throw new Error("Bearer token is required");

  if (executionId) {
    const item = await lookupExecutionById(host, token, executionId);
    return { items: [item] };
  }

  if (!planQuery) {
    throw new Error("Pick a plan name or paste an execution_id");
  }

  const matched = matchKnownPlanIds(planQuery, known);
  const planIds = matched.length > 0 ? matched : [planQuery];

  if (matched.length === 0 && known.length > 0) {
    throw new Error(
      `No plan named “${planQuery}” in the local list — pick one from the dropdown`,
    );
  }

  const perPlan = Math.max(
    5,
    Math.ceil(pageSize / Math.max(1, Math.min(planIds.length, 8))),
  );

  const batches = await Promise.all(
    planIds.slice(0, 8).map((id) =>
      getExecutionsForPlan(host, token, id, perPlan).catch(() => [] as ExecutionListItem[]),
    ),
  );

  const merged: ExecutionListItem[] = [];
  const seen = new Set<string>();
  for (const batch of batches) {
    for (const item of batch) {
      if (seen.has(item.executionId)) continue;
      seen.add(item.executionId);
      merged.push(item);
    }
  }
  merged.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  return {
    items: merged.slice(0, pageSize),
    note:
      planIds.length > 1
        ? `Local OE · ${planIds.length} plan_ids matched “${planQuery}”`
        : undefined,
  };
}

export function formatEpoch(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return String(sec);
  }
}
