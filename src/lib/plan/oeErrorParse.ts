/**
 * Ultimate OE check_plan error parser.
 *
 * Recursively walks the proxy/OE JSON tree and attaches issues to states when:
 * - object keys are known state names (invalid_lambdas, invalid_run_values, …)
 * - values are state-name lists (undefined_states, unreachable_states)
 * - free text mentions `State [name]` / `@ name` / `foo -> …`
 *
 * No per-key whitelist — new plan_errors shapes keep working.
 */

export type OeParsedIssue = {
  level: "error" | "warn";
  message: string;
  state: string | null;
  path: string;
};

const ROOT_NOISE = new Set([
  "server_time",
  "request_id",
  "code",
  "module",
  "http_status",
  "status",
  "raw",
]);

const WARN_BAGS = new Set(["unreachable_states"]);

const STATE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function shortJson(v: unknown, max = 400): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(v);
  }
}

function detailText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isPlainObject(v)) {
    if (typeof v.msg === "string") return v.msg;
    if (typeof v.message === "string") return v.message;
    if (typeof v.error === "string") return v.error;
  }
  return shortJson(v);
}

/** Pull state names mentioned in free text. */
export function extractStateNamesFromMessage(
  message: string,
  knownStates?: Set<string> | string[] | null,
): string[] {
  if (!message || typeof message !== "string") return [];
  const known =
    knownStates == null
      ? null
      : knownStates instanceof Set
        ? knownStates
        : new Set(knownStates);
  const found: string[] = [];
  const push = (name: string) => {
    const n = name.trim();
    if (!n || found.includes(n)) return;
    if (known && !known.has(n)) return;
    found.push(n);
  };

  let m: RegExpExecArray | null;
  const bracket = /State\s*\[([^\]]+)\]/gi;
  while ((m = bracket.exec(message))) push(m[1]);
  const at = /(?:@|in state|for state)\s+([A-Za-z_][A-Za-z0-9_.-]*)/gi;
  while ((m = at.exec(message))) push(m[1]);
  const quoted = /(?:state|states)\s+[“"']([^”"']+)[”"']/gi;
  while ((m = quoted.exec(message))) push(m[1]);
  const arrow = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*->\s*/;
  const am = message.match(arrow);
  if (am) push(am[1]);
  if (known && known.has(message.trim())) push(message.trim());
  return found;
}

function pathLabel(path: string[]): string {
  return path.filter(Boolean).join(".") || "plan";
}

/**
 * Object whose keys are (mostly) state names and values are details.
 */
function isStateDetailMap(
  obj: Record<string, unknown>,
  known: Set<string> | null,
): boolean {
  const keys = Object.keys(obj);
  if (!keys.length) return false;
  const idKeys = keys.filter((k) => STATE_NAME_RE.test(k) && !ROOT_NOISE.has(k));
  if (idKeys.length < keys.length * 0.6) return false;
  if (known && known.size) {
    if (!idKeys.some((k) => known.has(k))) return false;
  }
  let detailish = 0;
  for (const k of idKeys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      detailish++;
      continue;
    }
    if (typeof v === "object") detailish++;
  }
  return detailish >= idKeys.length * 0.5;
}

function isStateNameList(arr: unknown[], known: Set<string> | null): boolean {
  if (!arr.length) return false;
  const strings = arr.filter((x) => typeof x === "string") as string[];
  if (strings.length < arr.length * 0.8) return false;
  if (!known || !known.size) {
    return strings.every((s) => STATE_NAME_RE.test(s));
  }
  const knownHits = strings.filter((s) => known.has(s)).length;
  return (
    knownHits >= Math.ceil(strings.length * 0.5) ||
    strings.every((s) => STATE_NAME_RE.test(s))
  );
}

type WalkCtx = {
  known: Set<string> | null;
  out: OeParsedIssue[];
  seen: Set<string>;
};

function pushIssue(
  ctx: WalkCtx,
  level: "error" | "warn",
  message: string,
  state: string | null,
  path: string[],
) {
  const msg = message.startsWith("OE") ? message : `OE: ${message}`;
  const key = `${level}|${state || ""}|${msg}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.out.push({
    level,
    message: msg,
    state,
    path: state ? `states.${state}` : pathLabel(path),
  });
}

function walk(
  value: unknown,
  path: string[],
  ctx: WalkCtx,
  level: "error" | "warn" = "error",
) {
  if (value == null) return;

  if (typeof value === "string") {
    if (!value.trim()) return;
    const mentioned = extractStateNamesFromMessage(value, ctx.known);
    const parentKey = path[path.length - 1];
    const parentIsState = !!(parentKey && ctx.known?.has(parentKey));
    const bag = path[path.length - 2];
    const lvl = bag && WARN_BAGS.has(bag) ? "warn" : level;
    const label = path.length ? `[${pathLabel(path)}] ` : "";

    if (parentIsState) {
      pushIssue(ctx, lvl, `${label}${value}`, parentKey!, path);
      return;
    }
    if (mentioned.length) {
      mentioned.forEach((s) => pushIssue(ctx, lvl, `${label}${value}`, s, path));
      return;
    }
    if (ctx.known?.has(value.trim())) {
      pushIssue(ctx, lvl, `${label}${value.trim()}`, value.trim(), path);
      return;
    }
    pushIssue(ctx, lvl, `${label}${value}`, null, path);
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    // Ignore bare OE result codes at root (handled in summary)
    if (path.length === 1 && path[0] === "code") return;
    pushIssue(ctx, level, `[${pathLabel(path)}] ${String(value)}`, null, path);
    return;
  }

  if (Array.isArray(value)) {
    const bag = path[path.length - 1] || "";
    const lvl = WARN_BAGS.has(bag) ? "warn" : level;
    if (isStateNameList(value, ctx.known)) {
      for (const item of value) {
        if (typeof item !== "string") continue;
        const name = item.trim();
        const attach = !ctx.known || ctx.known.has(name) ? name : null;
        const verb =
          bag === "undefined_states"
            ? "undefined (referenced but missing)"
            : bag === "unreachable_states"
              ? "unreachable from start_at"
              : bag.replace(/_/g, " ") || "state";
        pushIssue(ctx, lvl, `${verb}: ${name}`, attach, path.concat(name));
      }
      return;
    }
    value.forEach((item, i) => walk(item, path.concat(String(i)), ctx, lvl));
    return;
  }

  if (!isPlainObject(value)) {
    pushIssue(ctx, level, `[${pathLabel(path)}] ${shortJson(value)}`, null, path);
    return;
  }

  const hasEnvelope =
    typeof value.msg === "string" ||
    typeof value.message === "string" ||
    typeof value.error === "string";
  const envelope = detailText(value);

  if (hasEnvelope && envelope) {
    const mentioned = extractStateNamesFromMessage(envelope, ctx.known);
    const parentKey = path[path.length - 1];
    const attach =
      (parentKey && ctx.known?.has(parentKey) && parentKey) ||
      mentioned[0] ||
      null;
    pushIssue(
      ctx,
      level,
      path.length ? `[${pathLabel(path)}] ${envelope}` : envelope,
      attach,
      path,
    );
  }

  if (isStateDetailMap(value, ctx.known)) {
    const bag = path[path.length - 1] || "error";
    const lvl = WARN_BAGS.has(bag) ? "warn" : level;
    const humanBag = bag.replace(/_/g, " ");
    for (const stateName of Object.keys(value)) {
      if (!STATE_NAME_RE.test(stateName)) continue;
      const detail = detailText(value[stateName]);
      const attach = !ctx.known || ctx.known.has(stateName) ? stateName : null;
      pushIssue(
        ctx,
        lvl,
        `${humanBag} @ ${stateName}: ${detail || "(no detail)"}`,
        attach,
        path.concat(stateName),
      );
    }
    return;
  }

  for (const key of Object.keys(value)) {
    if (path.length === 0 && ROOT_NOISE.has(key)) continue;
    if (hasEnvelope && (key === "msg" || key === "message" || key === "error")) continue;
    const nextLevel = WARN_BAGS.has(key) ? "warn" : level;
    walk(value[key], path.concat(key), ctx, nextLevel);
  }
}

function branchNext(branch: unknown): string | null {
  if (!branch || typeof branch !== "object") return null;
  const b = branch as Record<string, unknown>;
  if (typeof b.next === "string" && b.next.trim()) return b.next;
  if (b.merge && typeof b.merge === "object") {
    const n = (b.merge as Record<string, unknown>).next;
    if (typeof n === "string" && n.trim()) return n;
  }
  return null;
}

function outboundTargets(state: Record<string, unknown>): string[] {
  const outs: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) outs.push(v);
  };
  add(state.next);
  add(state.default);
  add(state.start_at);
  if (state.merge && typeof state.merge === "object") {
    const m = state.merge as Record<string, unknown>;
    add(m.next);
    add(m.default);
  }
  const lists = [state.choices, state.catch, (state.merge as any)?.choices, (state.merge as any)?.catch];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      add(branchNext(c));
    }
  }
  return outs;
}

function enrichUndefinedReferrers(
  issues: OeParsedIssue[],
  plan: { states?: unknown; start_at?: string },
  undefinedNames: string[],
) {
  if (!plan?.states || !undefinedNames.length) return;
  const states = plan.states;
  const map: Record<string, Record<string, unknown>> = Array.isArray(states)
    ? Object.fromEntries(
        states.map((s: any, i: number) => [s?.name || `state_${i}`, s || {}]),
      )
    : (states as Record<string, Record<string, unknown>>);

  const undef = new Set(undefinedNames);
  const seen = new Set(issues.map((i) => `${i.state}|${i.message}`));

  Object.keys(map).forEach((from) => {
    outboundTargets(map[from] || {}).forEach((target) => {
      if (!undef.has(target)) return;
      const message = `OE: next/edge targets undefined state “${target}”`;
      const k = `${from}|${message}`;
      if (seen.has(k)) return;
      seen.add(k);
      issues.push({
        level: "error",
        message,
        state: from,
        path: `states.${from}`,
      });
    });
  });
  if (plan.start_at && undef.has(plan.start_at)) {
    const message = `OE: start_at “${plan.start_at}” is not defined`;
    if (!seen.has(`|${message}`)) {
      issues.push({ level: "error", message, state: null, path: "start_at" });
    }
  }
}

function toIssue(i: OeParsedIssue) {
  return {
    level: i.level,
    message: i.message,
    state: i.state,
    path: i.path,
  };
}

function hasPlanErrors(upstream: any): boolean {
  const pe = upstream?.plan_errors;
  if (pe == null) return false;
  if (typeof pe !== "object") return true;
  return Object.keys(pe).length > 0;
}

function isCheckPlanSuccess(
  status: number | undefined,
  upstream: any,
): boolean {
  if (hasPlanErrors(upstream)) return false;
  const code = upstream?.code;
  if (status != null && status !== 200) return false;
  if (code === 0 || code === "0") return true;
  // Some OE successes omit code; treat as OK only when no error payload
  if (code == null && !upstream?.message && !upstream?.error) return true;
  return false;
}

export function issuesFromCheckPlanResponse(
  proxyResp: { status?: number; body?: any; error?: string } | any,
  opts: { knownStates?: string[]; plan?: any } = {},
): { ok: boolean; summary: string; issues: ReturnType<typeof toIssue>[] } {
  const hasWrappedBody =
    proxyResp && typeof proxyResp === "object" && "body" in proxyResp;
  const upstream = hasWrappedBody ? proxyResp.body || {} : proxyResp || {};
  const status = hasWrappedBody ? proxyResp.status : undefined;

  if (isCheckPlanSuccess(status, upstream)) {
    return { ok: true, summary: "OK", issues: [] };
  }

  const known = opts.knownStates?.length ? new Set(opts.knownStates) : null;
  const ctx: WalkCtx = { known, out: [], seen: new Set() };

  if (upstream?.plan_errors != null) {
    walk(upstream.plan_errors, ["plan_errors"], ctx);
  }
  if (typeof upstream?.message === "string" && upstream.message.trim()) {
    walk(upstream.message, ["message"], ctx);
  }
  if (typeof upstream?.error === "string" && upstream.error.trim()) {
    walk(upstream.error, ["error"], ctx);
  }
  if (typeof proxyResp?.error === "string" && proxyResp.error.trim()) {
    walk(proxyResp.error, ["proxy_error"], ctx);
  }
  if (!ctx.out.length && isPlainObject(upstream)) {
    walk(upstream, [], ctx);
  }

  const undefNames = ctx.out
    .filter((i) => /undefined \(referenced but missing\)/i.test(i.message))
    .map((i) => {
      const m = i.message.match(/:\s*([A-Za-z_][A-Za-z0-9_.-]*)$/);
      return m?.[1];
    })
    .filter(Boolean) as string[];
  if (opts.plan && undefNames.length) {
    enrichUndefinedReferrers(ctx.out, opts.plan, undefNames);
  }

  if (!ctx.out.length) {
    const fallback =
      (typeof upstream?.message === "string" && upstream.message) ||
      (upstream?.module != null ? `${upstream.module}.${upstream.code}` : null) ||
      shortJson(upstream) ||
      "OE check failed";
    ctx.out.push({
      level: "error",
      message: `OE: ${fallback}`,
      state: null,
      path: "plan",
    });
  }

  const deduped: OeParsedIssue[] = [];
  const seen2 = new Set<string>();
  for (const i of ctx.out) {
    const k = `${i.level}|${i.state || ""}|${i.message}`;
    if (seen2.has(k)) continue;
    seen2.add(k);
    deduped.push(i);
  }

  const issues = deduped.map(toIssue);
  const first = deduped.find((i) => i.state) || deduped[0];
  const summary = first.state
    ? `${first.state}: ${first.message}`
    : first.message;

  return {
    ok: false,
    summary: summary.startsWith("FAIL") ? summary : `FAIL — ${summary}`,
    issues,
  };
}
