/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck

export function issue(level, message, state, path) {
    return {
        level: level || "error",
        message: message,
        state: state || null,
        path: path || (state ? "states." + state : "plan"),
    };
}

export function normalizeStates(states) {
    if (!states) return { map: {}, order: [] };
    if (Array.isArray(states)) {
        const map = {};
        const order = [];
        states.forEach((s, i) => {
            const name = (s && s.name) || ("state_" + i);
            map[name] = s || {};
            order.push(name);
        });
        return { map: map, order: order };
    }
    return { map: states, order: Object.keys(states) };
}

export function inferType(state) {
    if (!state || typeof state !== "object") return "unknown";
    if (state.type) return state.type;
    if (state.ref) return "ref";
    if (state.choices) return "choice";
    if (state.api_config) return "task";
    if (state.end === true) return "success";
    return "unknown";
}

export function effectiveNext(state) {
    if (!state) return null;
    if (state.next) return state.next;
    if (state.merge && state.merge.next) return state.merge.next;
    return null;
}

export function effectiveApiConfig(state) {
    if (!state) return null;
    if (state.api_config) return state.api_config;
    if (state.merge && state.merge.api_config) return state.merge.api_config;
    return null;
}

export function validatePlan(plan: any, opts: any = {}): ValidationResult {
    const wrapperIds = opts.wrapperIds || null;
    /** Optional map/list from schema-cache state_types (required + fields). */
    const typeSchemas = opts.typeSchemas || null;
    const typeSchemaById = (() => {
        if (!typeSchemas) return null;
        const m = new Map();
        const list = Array.isArray(typeSchemas) ? typeSchemas : Object.values(typeSchemas);
        list.forEach((t: any) => {
            if (t && t.id) m.set(t.id, t);
        });
        return m;
    })();
    const errors = [];

    if (!plan || typeof plan !== "object") {
        return {
            valid: false,
            errors: [issue("error", "Plan is missing or not an object")],
            byState: {},
        };
    }

    if (!plan.plan_id || typeof plan.plan_id !== "string" || !plan.plan_id.trim()) {
        errors.push(issue("error", "plan_id is required (non-empty string)", null, "plan_id"));
    }
    if (!plan.plan_owner || typeof plan.plan_owner !== "string" || !plan.plan_owner.trim()) {
        errors.push(issue("error", "plan_owner is required", null, "plan_owner"));
    }
    if (!plan.start_at || typeof plan.start_at !== "string" || !plan.start_at.trim()) {
        errors.push(issue("error", "start_at is required", null, "start_at"));
    }
    if (!plan.states || (typeof plan.states !== "object")) {
        errors.push(issue("error", "states is required", null, "states"));
        return finalize(errors);
    }

    const { map, order } = normalizeStates(plan.states);
    if (order.length === 0) {
        errors.push(issue("error", "states must contain at least one state", null, "states"));
        return finalize(errors);
    }

    if (plan.start_at && !map[plan.start_at]) {
        errors.push(issue(
            "error",
            `start_at “${plan.start_at}” does not exist in states`,
            null,
            "start_at"
        ));
    }

    if (plan.name && plan.plan_id && plan.name !== plan.plan_id) {
        errors.push(issue(
            "warn",
            `name (“${plan.name}”) should match plan_id (“${plan.plan_id}”) for check_plan`,
            null,
            "name"
        ));
    }

    const reachable = new Set();
    if (plan.start_at && map[plan.start_at]) {
        const queue = [plan.start_at];
        while (queue.length) {
            const cur = queue.shift();
            if (reachable.has(cur)) continue;
            reachable.add(cur);
            const st = map[cur] || {};
            const outs = collectOutbound(st);
            outs.forEach((t) => {
                if (map[t] && !reachable.has(t)) queue.push(t);
            });
        }
    }

    order.forEach((name) => {
        const state = map[name] || {};
        const type = inferType(state);

        if (state.ref) {
            const ref = String(state.ref);
            const refName = ref.indexOf("#.") === 0 ? ref.slice(2) : ref;
            // wrapperIds === null → catalog not loaded yet; skip (don't spam false warns)
            if (
                wrapperIds &&
                wrapperIds.size > 0 &&
                !wrapperIds.has(refName) &&
                !wrapperIds.has(ref) &&
                !wrapperIds.has(`#.${refName}`)
            ) {
                errors.push(issue(
                    "warn",
                    `Unknown template ref “${ref}” (not in local state_blocks catalog)`,
                    name,
                    "states." + name + ".ref"
                ));
            }
            const next = effectiveNext(state);
            if (!next && state.end !== true && !(state.merge && state.merge.end === true)) {
                errors.push(issue(
                    "error",
                    "ref state needs merge.next (or end: true)",
                    name,
                    "states." + name + ".merge.next"
                ));
            }
            validateOutboundTargets(name, state, map, errors);
            return;
        }

        if (type === "unknown") {
            errors.push(issue("error", "State has no type and no ref", name, "states." + name + ".type"));
        }

        // Schema-cache: required keys + unknown properties (OE additionalProperties: false)
        const typeSchema = typeSchemaById && typeSchemaById.get(type);
        if (typeSchema && typeSchema.fields?.length) {
            const allowed = new Set(
                (typeSchema.fields as { name: string }[]).map((f) => f.name),
            );
            ["_auto_next", "_from_ref", "_unresolved_ref", "ref", "merge"].forEach((k) =>
                allowed.add(k),
            );
            const variants: { required: string[] }[] =
                Array.isArray(typeSchema.variants) && typeSchema.variants.length
                    ? typeSchema.variants
                    : [{ required: typeSchema.required || ["type"] }];
            const variantOk = variants.some((v) =>
                (v.required || []).every((key) => {
                    if (key === "type") return true;
                    return state[key] !== undefined && state[key] !== null;
                }),
            );
            if (!variantOk) {
                const hint = variants
                    .map((v) => (v.required || []).filter((k) => k !== "type").join("+"))
                    .filter(Boolean)
                    .join(" | ");
                errors.push(
                    issue(
                        "error",
                        `Missing required fields for ${type}` + (hint ? ` (need ${hint})` : ""),
                        name,
                        `states.${name}`,
                    ),
                );
            }
            Object.keys(state).forEach((key) => {
                if (!allowed.has(key)) {
                    errors.push(
                        issue(
                            "error",
                            `Unknown field “${key}” (not in ${type} schema)`,
                            name,
                            `states.${name}.${key}`,
                        ),
                    );
                }
            });
        }

        if (type === "task" || type === "callback") {
            const api = effectiveApiConfig(state);
            if (!api || !api.uri) {
                errors.push(issue(
                    "error",
                    `${type} requires api_config.uri`,
                    name,
                    "states." + name + ".api_config.uri"
                ));
            }
            if (!state.headers && type === "task") {
                errors.push(issue(
                    "warn",
                    "task usually requires headers (OE schema)",
                    name,
                    "states." + name + ".headers"
                ));
            }
            const next = effectiveNext(state);
            if (!next && state.end !== true) {
                errors.push(issue(
                    "error",
                    `${type} needs next (or end: true)`,
                    name,
                    "states." + name + ".next"
                ));
            }
        }

        if (type === "choice") {
            if (!Array.isArray(state.choices) || state.choices.length === 0) {
                errors.push(issue("error", "choice requires non-empty choices[]", name, "states." + name + ".choices"));
            }
            if (!state.default) {
                errors.push(issue("warn", "choice without default", name, "states." + name + ".default"));
            }
        }

        if (type === "publish") {
            if (!state.message_queue_type) {
                errors.push(issue("error", "publish requires message_queue_type", name, "states." + name + ".message_queue_type"));
            }
            if (!effectiveNext(state) && state.end !== true) {
                errors.push(issue("error", "publish needs next", name, "states." + name + ".next"));
            }
        }

        if (type === "lambda") {
            if (!state.lambda_code) {
                errors.push(issue("error", "lambda requires lambda_code", name, "states." + name + ".lambda_code"));
            }
        }

        if (type === "success" || type === "fail") {
            if (state.end !== true) {
                errors.push(issue("warn", `${type} should set end: true`, name, "states." + name + ".end"));
            }
        }

        validateOutboundTargets(name, state, map, errors);

        if (plan.start_at && reachable.size && !reachable.has(name)) {
            errors.push(issue(
                "warn",
                `Unreachable from start_at “${plan.start_at}”`,
                name,
                "states." + name
            ));
        }
    });

    return finalize(errors);
}

/** choice/catch next — plain or `{ ref, merge: { next } }`. */
export function branchNext(branch) {
    if (!branch || typeof branch !== "object") return null;
    if (typeof branch.next === "string" && branch.next.trim()) return branch.next;
    if (branch.merge && typeof branch.merge.next === "string" && branch.merge.next.trim()) {
        return branch.merge.next;
    }
    return null;
}

export function collectOutbound(state) {
    const outs = [];
    const next = effectiveNext(state);
    if (next) outs.push(next);
    if (state.default) outs.push(state.default);
    // Loop body entry (modern OE: type=loop + start_at)
    if (state.type === "loop" || state.foreach || state.while) {
        if (typeof state.start_at === "string" && state.start_at.trim()) {
            outs.push(state.start_at);
        }
        const body = state.foreach || state.while;
        if (body && typeof body === "object" && body.next) {
            outs.push(body.next);
        }
    }
    (state.choices || []).forEach((c) => {
        const t = branchNext(c);
        if (t) outs.push(t);
    });
    (state.catch || []).forEach((c) => {
        const t = branchNext(c);
        if (t) outs.push(t);
    });
    if (state.merge) {
        if (state.merge.default) outs.push(state.merge.default);
        (state.merge.choices || []).forEach((c) => {
            const t = branchNext(c);
            if (t) outs.push(t);
        });
        (state.merge.catch || []).forEach((c) => {
            const t = branchNext(c);
            if (t) outs.push(t);
        });
    }
    return outs;
}

export function assertTarget(name, field, target, map, errors, path) {
    if (target === undefined || target === null) return;
    if (typeof target !== "string" || !target.trim()) {
        errors.push(issue("error", `${field} is empty`, name, path));
        return;
    }
    if (!map[target]) {
        errors.push(issue("error", `${field} “${target}” does not exist`, name, path));
    }
}

export function validateOutboundTargets(name, state, map, errors) {
    const next = effectiveNext(state);
    // Only assert next when present (empty string handled by type-specific “needs next”)
    if (next) {
        assertTarget(name, "next", next, map, errors, "states." + name + ".next");
    }
    if (state.default !== undefined && state.default !== null) {
        assertTarget(name, "default", state.default, map, errors, "states." + name + ".default");
    }
    (state.choices || []).forEach((c, i) => {
        if (!c) return;
        assertTarget(name, `choices[${i}].next`, branchNext(c), map, errors, "states." + name + ".choices");
    });
    (state.catch || []).forEach((c, i) => {
        if (!c) return;
        assertTarget(name, `catch[${i}].next`, branchNext(c), map, errors, "states." + name + ".catch");
    });
    if (state.merge) {
        (state.merge.choices || []).forEach((c, i) => {
            if (!c) return;
            assertTarget(name, `merge.choices[${i}].next`, branchNext(c), map, errors, "states." + name + ".merge.choices");
        });
        (state.merge.catch || []).forEach((c, i) => {
            if (!c) return;
            assertTarget(name, `merge.catch[${i}].next`, branchNext(c), map, errors, "states." + name + ".merge.catch");
        });
    }
}

export function finalize(errors) {
    const byState = {};
    errors.forEach((e) => {
        if (!e.state) return;
        if (!byState[e.state]) byState[e.state] = [];
        byState[e.state].push(e);
    });
    const hasError = errors.some((e) => e.level === "error");
    return {
        valid: !hasError,
        errors: errors,
        byState: byState,
        errorCount: errors.filter((e) => e.level === "error").length,
        warnCount: errors.filter((e) => e.level === "warn").length,
    };
}



export async function checkPlanRemote(host: any, token: any, plan: any, operatorName: any) {
  const body = {
    plan: Object.assign({}, plan, {
      name: plan.name || plan.plan_id,
    }),
  };
  const resp = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: host,
      token: token || null,
      path: "/api/v3/orchestrationplan/check_plan",
      method: "POST",
      body: body,
      headers: operatorName ? { "X-Operator-Name": operatorName } : {},
    }),
  });
  return resp.json();
}

export {
  extractStateNamesFromMessage,
  issuesFromCheckPlanResponse,
} from "@/lib/plan/oeErrorParse";

export function mergeValidationResults(
  local: ReturnType<typeof finalize> | null | undefined,
  oeIssues: ReturnType<typeof issue>[] | null | undefined,
): ReturnType<typeof finalize> {
  const base = local || finalize([]);
  if (!oeIssues || !oeIssues.length) return base;
  // Drop previous OE-tagged issues from local merge targets if any, then append
  const withoutOe = base.errors.filter((e) => !String(e.message || "").startsWith("OE"));
  return finalize(withoutOe.concat(oeIssues));
}
