/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck

import { defaultValueForField } from "./fieldDefaults";

const TERMINAL: Set<string> = new Set(["success", "fail"]);

export function normalizeStates(states) {
    if (!states) return { map: {}, order: [], form: "object" };
    if (Array.isArray(states)) {
        const map = {};
        const order = [];
        states.forEach((state, index) => {
            const name = state.name || `state_${index}`;
            const copy = Object.assign({}, state);
            if (!copy.next && index < states.length - 1 && !TERMINAL.has(copy.type)) {
                const nextName = states[index + 1].name || `state_${index + 1}`;
                copy.next = nextName;
                copy._auto_next = true;
            }
            map[name] = copy;
            order.push(name);
        });
        return { map, order, form: "array" };
    }
    const order = Object.keys(states);
    const map = {};
    order.forEach((name) => {
        map[name] = Object.assign({}, states[name]);
    });
    return { map, order, form: "object" };
}

export function inferType(state) {
    if (!state || typeof state !== "object") return "unknown";
    if (state.type) return state.type;
    if (state.ref) return "ref";
    if (state.choices) return "choice";
    if (state.api_config) return "task";
    if (state.lambda_code) return "lambda";
    if (state.events && state.message_queue_type) return "publish";
    if (state.execution_plans) return "parallel";
    if (state.foreach || state.while) return "loop";
    if (state.end === true && state.response_definition) return "fail";
    if (state.end === true) return "success";
    return "unknown";
}

export function collectEdges(statesMap) {
    const edges = [];
    const add = (source, target, kind, label) => {
        if (!target || typeof target !== "string") return;
        edges.push({
            id: `${source}->${target}:${kind}:${label || ""}`,
            source,
            target,
            kind,
            label: label || "",
        });
    };

    Object.keys(statesMap).forEach((name) => {
        const state = statesMap[name] || {};
        const type = inferType(state);

        const nextTarget = state.next || (state.merge && state.merge.next);
        if (nextTarget) add(name, nextTarget, "next", "");

        const choiceLists = [state.choices, state.merge && state.merge.choices].filter(Array.isArray);
        choiceLists.forEach((choices) => {
            choices.forEach((choice, i) => {
                const target = branchNext(choice);
                let label = choice && choice.variable ? String(choice.variable) : `c${i}`;
                if (label.length > 28) label = label.slice(0, 27) + "…";
                add(name, target, "choice", label);
            });
        });
        const defaultTarget = state.default || (state.merge && state.merge.default);
        if (defaultTarget) add(name, defaultTarget, "default", "default");

        catchBranches(state).forEach((c, i) => {
            add(name, branchNext(c), "catch", c && c.variable ? "catch" : `catch${i}`);
        });

        if (type === "loop") {
            // Modern OE: loop.start_at is the first body state (foreach is a path string).
            if (typeof state.start_at === "string" && state.start_at.trim()) {
                add(name, state.start_at, "loop-body", "start_at");
            }
            // Legacy nested foreach/while: { items, next } object form.
            const body = state.foreach || state.while;
            if (body && typeof body === "object" && body.next) {
                add(name, body.next, "loop-body", "body");
            }
        }

        if (type === "parallel" && state.execution_plans) {
            Object.keys(state.execution_plans).forEach((key) => {
                const child = state.execution_plans[key];
                if (child && child.plan_id) {
                    edges.push({
                        id: `${name}->plan:${child.plan_id}`,
                        source: name,
                        target: name,
                        kind: "parallel-ref",
                        label: child.plan_id,
                        meta: { plan_id: child.plan_id, key },
                    });
                }
            });
        }
    });
    return edges;
}

/**
 * Resolve `next` on a choice/catch branch.
 * OE often uses wrapper form: `{ "ref": "#.catch_regular", "merge": { "next": "…" } }`.
 */
export function branchNext(branch) {
    if (!branch || typeof branch !== "object") return null;
    if (typeof branch.next === "string" && branch.next.trim()) return branch.next;
    if (branch.merge && typeof branch.merge.next === "string" && branch.merge.next.trim()) {
        return branch.merge.next;
    }
    return null;
}

/** Top-level `catch` plus `merge.catch` (ref+merge states). */
export function catchBranches(state) {
    const list = [];
    if (!state || typeof state !== "object") return list;
    if (Array.isArray(state.catch)) list.push(...state.catch);
    if (state.merge && Array.isArray(state.merge.catch)) list.push(...state.merge.catch);
    return list;
}

function rewriteBranchNext(branch, fromName, toName) {
    if (!branch || typeof branch !== "object") return branch;
    if (branch.next === fromName) {
        const copy = Object.assign({}, branch);
        if (toName === undefined) delete copy.next;
        else copy.next = toName;
        return copy;
    }
    if (branch.merge && branch.merge.next === fromName) {
        const merge = Object.assign({}, branch.merge);
        if (toName === undefined) delete merge.next;
        else merge.next = toName;
        return Object.assign({}, branch, { merge: merge });
    }
    return branch;
}

function edgeKey(e) {
    return `${e.source}\0${e.target}\0${e.kind}`;
}

function inheritedEdgeLabel(kind) {
    if (kind === "catch") return "default catch";
    if (kind === "next") return "default next";
    if (kind === "default") return "default branch";
    if (kind === "choice") return "default choice";
    if (kind === "loop-body") return "default body";
    return "from template";
}

/**
 * Edges present after template resolve but absent from authored JSON
 * (e.g. `#.task_regular` default catch → final_fail_state).
 */
export function markInheritedEdges(authoredPlan, resolvedEdges) {
    const authoredMap = normalizeStates((authoredPlan && authoredPlan.states) || {}).map;
    const authoredKeys = new Set(
        collectEdges(authoredMap)
            .filter((e) => e.kind !== "parallel-ref" && e.target)
            .map(edgeKey)
    );
    return resolvedEdges.map((e) => {
        if (authoredKeys.has(edgeKey(e))) return e;
        const label = e.label && String(e.label).trim() ? e.label : inheritedEdgeLabel(e.kind);
        return Object.assign({}, e, {
            inherited: true,
            label: label,
            id: `${e.id}:inherited`,
        });
    });
}

export function toCytoscapeElements(plan, resolvedPlan) {
    const source = resolvedPlan || plan;
    const { map, order } = normalizeStates(source.states);
    const startAt = source.start_at || plan.start_at;
    const loopEntries = new Set();
    order.forEach((name) => {
        const state = map[name] || {};
        if (inferType(state) !== "loop") return;
        if (typeof state.start_at === "string" && state.start_at.trim()) {
            loopEntries.add(state.start_at);
        }
        const body = state.foreach || state.while;
        if (body && typeof body === "object" && body.next) {
            loopEntries.add(body.next);
        }
    });
    // Prefer unresolved defs for node badges (keeps ref visible)
    const authoredMap = normalizeStates((plan && plan.states) || {}).map;
    const nodes = order.map((name) => {
        const state = map[name];
        const authored = authoredMap[name] || state;
        const type = inferType(authored.ref ? authored : state);
        return {
            data: {
                id: name,
                label: name,
                type,
                start: name === startAt,
                loopEntry: loopEntries.has(name) || undefined,
                uri: state.api_config && state.api_config.uri,
                ref: authored.ref || state._from_ref || null,
                raw: authored,
            },
        };
    });

    // Edges from resolved plan (runtime truth), flagged when only from template
    let rawEdges = collectEdges(map)
        .filter((e) => e.kind !== "parallel-ref")
        .filter((e) => map[e.target]);
    rawEdges = markInheritedEdges(plan, rawEdges);

    // Stagger labeled edges that share a source so captions don't stack.
    const labeledBySource = {};
    rawEdges.forEach((e) => {
        if (!e.label) return;
        if (!labeledBySource[e.source]) labeledBySource[e.source] = [];
        labeledBySource[e.source].push(e);
    });
    Object.keys(labeledBySource).forEach((src) => {
        const group = labeledBySource[src];
        group.forEach((e, i) => {
            e.labelSlot = i;
            e.labelSlots = group.length;
        });
    });

    // Also spread any multi-edges from the same source (choice fan-out).
    const fromSource = {};
    rawEdges.forEach((e) => {
        if (!fromSource[e.source]) fromSource[e.source] = [];
        fromSource[e.source].push(e);
    });
    Object.keys(fromSource).forEach((src) => {
        const group = fromSource[src];
        group.forEach((e, i) => {
            e.fanSlot = i;
            e.fanSlots = group.length;
        });
    });

    const edges = rawEdges.map((e) => ({
        data: {
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.kind,
            label: e.label,
            inherited: e.inherited ? true : undefined,
            labelSlot: e.labelSlot || 0,
            labelSlots: e.labelSlots || 1,
            fanSlot: e.fanSlot || 0,
            fanSlots: e.fanSlots || 1,
        },
        classes: e.inherited ? "inherited-edge" : undefined,
    }));

    return { nodes, edges, map, order, startAt };
}

export function statesObjectFromMap(map, order) {
    const out = {};
    order.forEach((name) => {
        const state = Object.assign({}, map[name]);
        delete state._auto_next;
        delete state._from_ref;
        delete state._unresolved_ref;
        // strip auto-injected name when storing as object form
        if (state.name === name) delete state.name;
        out[name] = state;
    });
    return out;
}

export function applyPlanStates(plan, map, order) {
    const next = Object.assign({}, plan);
    next.states = statesObjectFromMap(map, order);
    return next;
}

export function addState(plan, name, state) {
    const { map, order } = normalizeStates(plan.states);
    if (map[name]) throw new Error(`State already exists: ${name}`);
    map[name] = state;
    order.push(name);
    return applyPlanStates(plan, map, order);
}

export function deleteState(plan, name) {
    const { map, order } = normalizeStates(plan.states);
    delete map[name];
    const nextOrder = order.filter((n) => n !== name);
    Object.keys(map).forEach((key) => {
        const s = map[key];
        if (s.next === name) delete s.next;
        if (s.merge && s.merge.next === name) {
            const merge = Object.assign({}, s.merge);
            delete merge.next;
            s.merge = merge;
        }
        if (s.default === name) delete s.default;
        if (s.merge && s.merge.default === name) {
            const merge = Object.assign({}, s.merge);
            delete merge.default;
            s.merge = merge;
        }
        if (Array.isArray(s.choices)) {
            s.choices = s.choices.map((c) => rewriteBranchNext(c, name, undefined));
        }
        if (Array.isArray(s.catch)) {
            s.catch = s.catch.map((c) => rewriteBranchNext(c, name, undefined));
        }
        if (s.merge && Array.isArray(s.merge.catch)) {
            s.merge = Object.assign({}, s.merge, {
                catch: s.merge.catch.map((c) => rewriteBranchNext(c, name, undefined)),
            });
        }
        if (s.merge && Array.isArray(s.merge.choices)) {
            s.merge = Object.assign({}, s.merge, {
                choices: s.merge.choices.map((c) => rewriteBranchNext(c, name, undefined)),
            });
        }
    });
    const next = applyPlanStates(plan, map, nextOrder);
    if (next.start_at === name) next.start_at = nextOrder[0] || "";
    return next;
}

export function renameState(plan, oldName, newName) {
    if (!newName || oldName === newName) return plan;
    const { map, order } = normalizeStates(plan.states);
    if (!map[oldName]) throw new Error(`Missing state: ${oldName}`);
    if (map[newName]) throw new Error(`State already exists: ${newName}`);
    map[newName] = map[oldName];
    delete map[oldName];
    const nextOrder = order.map((n) => (n === oldName ? newName : n));
    Object.keys(map).forEach((key) => {
        const s = map[key];
        if (s.next === oldName) s.next = newName;
        if (s.merge && s.merge.next === oldName) {
            s.merge = Object.assign({}, s.merge, { next: newName });
        }
        if (s.default === oldName) s.default = newName;
        if (s.merge && s.merge.default === oldName) {
            s.merge = Object.assign({}, s.merge, { default: newName });
        }
        if (Array.isArray(s.choices)) {
            s.choices = s.choices.map((c) => rewriteBranchNext(c, oldName, newName));
        }
        if (Array.isArray(s.catch)) {
            s.catch = s.catch.map((c) => rewriteBranchNext(c, oldName, newName));
        }
        if (s.merge && Array.isArray(s.merge.catch)) {
            s.merge = Object.assign({}, s.merge, {
                catch: s.merge.catch.map((c) => rewriteBranchNext(c, oldName, newName)),
            });
        }
        if (s.merge && Array.isArray(s.merge.choices)) {
            s.merge = Object.assign({}, s.merge, {
                choices: s.merge.choices.map((c) => rewriteBranchNext(c, oldName, newName)),
            });
        }
    });
    const next = applyPlanStates(plan, map, nextOrder);
    if (next.start_at === oldName) next.start_at = newName;
    return next;
}

export function updateState(plan, name, patch) {
    const { map, order } = normalizeStates(plan.states);
    if (!map[name]) throw new Error(`Missing state: ${name}`);
    map[name] = Object.assign({}, map[name], patch);
    return applyPlanStates(plan, map, order);
}

export function replaceState(plan, name, definition) {
    const { map, order } = normalizeStates(plan.states);
    if (!map[name]) throw new Error(`Missing state: ${name}`);
    map[name] = definition;
    return applyPlanStates(plan, map, order);
}

function isChoiceState(state: Record<string, unknown> | null | undefined): boolean {
    if (!state || typeof state !== "object") return false;
    return state.type === "choice" || Array.isArray(state.choices);
}

/**
 * Lint: wire a success-path edge from `fromName` → `toName`.
 * - plain / ref+merge → `next`
 * - choice → `default` for now (later: also pick among `choices[].next`)
 */
export function setNext(plan, fromName, toName) {
    const { map, order } = normalizeStates(plan.states);
    const s = map[fromName];
    if (!s) throw new Error(`Missing state: ${fromName}`);
    if (!map[toName]) throw new Error(`Missing state: ${toName}`);
    if (isChoiceState(s)) {
        s.default = toName;
        delete s.next;
        if (s.end) delete s.end;
    } else if (s.ref) {
        s.merge = Object.assign({}, s.merge || {}, { next: toName });
    } else {
        s.next = toName;
        if (s.end) delete s.end;
    }
    map[fromName] = s;
    return applyPlanStates(plan, map, order);
}

/** Clear the lint success-path edge (`next` or choice `default`). */
export function clearNext(plan, fromName) {
    const { map, order } = normalizeStates(plan.states);
    const s = map[fromName];
    if (!s) return plan;
    if (isChoiceState(s)) {
        delete s.default;
    } else if (s.ref && s.merge) {
        const merge = Object.assign({}, s.merge);
        delete merge.next;
        s.merge = merge;
    } else {
        delete s.next;
    }
    map[fromName] = s;
    return applyPlanStates(plan, map, order);
}

/** Label used in status / UI for the lint edge field on a state. */
export function lintEdgeField(state: Record<string, unknown> | null | undefined): "default" | "next" {
    return isChoiceState(state) ? "default" : "next";
}

export function defaultInputValidationSchema() {
    return {
        type: "object",
        properties: {},
        required: [],
    };
}

export function blankPlan(opts: Record<string, any> = {}) {
    let schema = opts.input_validation_schema;
    if (schema == null) {
        schema = defaultInputValidationSchema();
    }
    return {
        plan_id: opts.plan_id || "new_plan",
        name: opts.plan_id || "new_plan",
        plan_owner: opts.plan_owner || "orchestration-team",
        is_default: opts.is_default !== false,
        start_at: "final_success_state",
        mapper_ids: Array.isArray(opts.mapper_ids) ? opts.mapper_ids : [],
        input_validation_schema: schema,
        states: {
            final_success_state: {
                type: "success",
                end: true,
            },
        },
    };
}

/**
 * Scaffold a new state. When `typeSchema` is provided (from schema-cache),
 * only preferred-variant **required** fields are filled; optional fields stay
 * in the inspector Available fields list.
 */
export function defaultStateForType(type, typeSchema) {
    if (typeSchema && Array.isArray(typeSchema.required) && typeSchema.required.length) {
        const out = { type: type || typeSchema.id || "task" };
        const fieldByName = {};
        (typeSchema.fields || []).forEach((f) => {
            fieldByName[f.name] = f;
        });
        for (const key of typeSchema.required) {
            if (key === "type") continue;
            const sample = defaultValueForField(key, fieldByName[key]);
            if (sample !== undefined) out[key] = sample;
        }
        return out;
    }
    // Fallback when schema cache is missing / not refreshed yet
    switch (type) {
        case "task":
            return {
                type: "task",
                api_config: { uri: "/api/v3/example", method: "POST", timeout_ms: 10000 },
                headers: {},
                next: "",
            };
        case "callback":
            return {
                type: "callback",
                api_config: { uri: "/api/v3/example", method: "POST", timeout_ms: 10000 },
                headers: {},
                body: {},
                next: "",
            };
        case "choice":
            return {
                type: "choice",
                choices: [{ variable: "$.flag", boolean_equals: true, next: "" }],
                default: "",
            };
        case "publish":
            return {
                type: "publish",
                message_queue_type: "kafka",
                events: [{}],
                next: "",
            };
        case "lambda":
            return {
                type: "lambda",
                lambda_code: "${ return $.input; }",
                result_path: "$.result",
                next: "",
            };
        case "wait":
            return { type: "wait", until: "${ return ngx.time() + 60; }", next: "" };
        case "loop":
            return {
                type: "loop",
                start_at: "",
                foreach: { items: "$.items", item: "item" },
                next: "",
            };
        case "parallel":
            return { type: "parallel" };
        case "fail":
            return { type: "fail", end: true };
        case "success":
            return { type: "success", end: true };
        case "human_task":
            return {
                type: "human_task",
                api_config: { uri: "/api/v3/example", method: "POST", timeout_ms: 10000 },
                headers: {},
                body: {},
                validation_schema: { type: "object", properties: {} },
                next: "",
            };
        case "wait_for":
            return { type: "wait_for", depends_on: { correlation_ids: [] }, next: "" };
        case "notify_to":
            return { type: "notify_to", correlation_id: "", data: {}, next: "" };
        case "redis_executor":
            return { type: "redis_executor", action_type: "SCHEDULE", params: {}, next: "" };
        default:
            return { type: type || "task", next: "" };
    }
}

export function wrapperState(ref) {
    return {
        ref: ref.indexOf("#.") === 0 ? ref : `#.${ref}`,
        merge: {
            api_config: { uri: "/api/v3/example" },
            body: {},
            next: "",
        },
    };
}


