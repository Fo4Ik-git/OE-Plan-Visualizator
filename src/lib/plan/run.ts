/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck

export async function api(path, options) {
    const resp = await fetch(path, options);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || resp.statusText);
    return data;
}

export async function proxy(host, token, apiPath, body, method) {
    return api("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host: host,
            token: token,
            path: apiPath,
            method: method || "POST",
            body: body,
        }),
    });
}

export async function getServiceToken(host, operatorName) {
    const result = await proxy(host, null, "/api/v3/authorization/get_service_token", {
        operator_name: operatorName,
    });
    if (result.status >= 400) {
        throw new Error(`get_service_token HTTP ${result.status}: ${JSON.stringify(result.body)}`);
    }
    const token = result.body && (result.body.token || (result.body.body && result.body.body.token));
    if (!token) throw new Error("Token missing in get_service_token response: " + JSON.stringify(result.body));
    return token;
}

export function preparePlanForOe(plan) {
    const out = Object.assign({}, plan || {});
    if (!out.plan_id) throw new Error("plan.plan_id is required for upsert");
    if (!out.name) out.name = out.plan_id;
    return out;
}

export function extractStoredVersion(getPlanBody, planId) {
    const byId = getPlanBody && getPlanBody.orchestration_plan_by_id;
    if (!byId || typeof byId !== "object") return null;
    const entity = byId[planId] || byId[Object.keys(byId)[0]];
    if (!entity) return null;
    const meta = entity.metadata || {};
    if (typeof meta.version === "number") return meta.version;
    if (meta.version != null && !isNaN(Number(meta.version))) return Number(meta.version);
    return null;
}

export function planExistsInGetResponse(getPlanBody, planId) {
    const byId = getPlanBody && getPlanBody.orchestration_plan_by_id;
    if (!byId || typeof byId !== "object") return false;
    const entity = byId[planId];
    return !!(entity && (entity.data || entity.metadata));
}

/**
 * add_plan when missing; update_plan with current entity version when present.
 * Returns { status, body, version, action }.
 */
export async function upsertPlan(host, token, plan, opts) {
    opts = opts || {};
    const log = opts.log || function () {};
    const prepared = preparePlanForOe(plan);
    const planId = prepared.plan_id;

    log(`Looking up plan “${planId}”…`);
    const getResp = await proxy(host, token, "/api/v3/orchestrationplan/get_plan", {
        ids: [planId],
        dont_enrich_with_templates: true,
    });
    log(`get_plan HTTP ${getResp.status}: ${JSON.stringify(getResp.body).slice(0, 300)}`);

    const exists =
        getResp.status < 400 && planExistsInGetResponse(getResp.body, planId);
    const currentVersion = exists ? extractStoredVersion(getResp.body, planId) : null;

    let upsertResp;
    let action;
    if (!exists) {
        action = "add_plan";
        log("Plan not found — add_plan…");
        upsertResp = await proxy(host, token, "/api/v3/orchestrationplan/add_plan", {
            plan: prepared,
            ignore_linter: !!opts.ignoreLinter,
        });
    } else {
        action = "update_plan";
        // Optimistic concurrency: OE requires the current stored version.
        // Prefer server version; fall back to client-tracked; last resort force_update.
        let version = currentVersion;
        if (version == null && typeof opts.knownVersion === "number") {
            version = opts.knownVersion;
        }
        if (version == null) {
            log("Stored version unknown — update_plan with force_update…");
            upsertResp = await proxy(host, token, "/api/v3/orchestrationplan/update_plan", {
                plan: prepared,
                version: 0,
                force_update: true,
                ignore_linter: !!opts.ignoreLinter,
            });
        } else {
            log(`Plan exists at version ${version} — update_plan…`);
            upsertResp = await proxy(host, token, "/api/v3/orchestrationplan/update_plan", {
                plan: prepared,
                version: version,
                force_update: true,
                ignore_linter: !!opts.ignoreLinter,
            });
        }
    }

    log(`${action} HTTP ${upsertResp.status}: ${JSON.stringify(upsertResp.body).slice(0, 400)}`);
    if (upsertResp.status >= 400) {
        const msg =
            (upsertResp.body && (upsertResp.body.msg || upsertResp.body.message || upsertResp.body.error)) ||
            JSON.stringify(upsertResp.body);
        throw new Error(`${action} failed: ${msg}`);
    }

    let newVersion =
        upsertResp.body && typeof upsertResp.body.version === "number"
            ? upsertResp.body.version
            : null;
    if (newVersion == null && action === "add_plan") {
        newVersion = 1;
    }
    if (newVersion == null && currentVersion != null) {
        newVersion = currentVersion + 1;
    }

    return {
        status: upsertResp.status,
        body: upsertResp.body,
        version: newVersion,
        action: action,
        plan: prepared,
    };
}

/**
 * Upsert plan into orchestrationplan then execute immediately.
 * Mirrors it_bruno OrchestrationClient patterns.
 */
export async function runPlan(opts) {
    const log = opts.log || function () {};
    let token = opts.token;
    const host = opts.host;
    const operator = opts.operator;
    const plan = opts.plan;
    const input = opts.input || {};
    const upsert = opts.upsert !== false;

    if (!token) {
        log("Fetching service token…");
        token = await getServiceToken(host, operator);
        log("Got service token.");
        if (opts.onToken) opts.onToken(token);
    }

    let planVersion = opts.knownVersion;
    if (upsert) {
        const result = await upsertPlan(host, token, plan, {
            log: log,
            knownVersion: opts.knownVersion,
            ignoreLinter: opts.ignoreLinter,
        });
        planVersion = result.version;
        if (opts.onVersion) opts.onVersion(planVersion, result.action);
        log(`Upsert OK (${result.action}) · version=${planVersion}`);
    }

    // Same entrypoint as it_bruno: run_plan creates + starts a new execution.
    // execute_plan is NOT a fallback — it resumes an existing reservation and requires reservation_id.
    log(`Running ${plan.plan_id} via run_plan…`);
    const execBody = {
        plan_id: plan.plan_id,
        input: input,
    };
    if (opts.integrationTests != null) {
        execBody.integration_tests = opts.integrationTests;
    }
    let execResp = await proxy(host, token, "/api/v3/orchestration/run_plan", execBody);
    if (execResp.status >= 400) {
        log(`run_plan failed (${execResp.status}), trying execute_plan_immediately…`);
        execResp = await proxy(
            host,
            token,
            "/api/v3/orchestration/execute_plan_immediately",
            execBody,
        );
    }
    log(`Execute HTTP ${execResp.status}: ${JSON.stringify(execResp.body).slice(0, 600)}`);

    const body = execResp.body || {};
    const executionId =
        body.execution_id ||
        (body.execution && body.execution.execution_id) ||
        (body.body && body.body.execution_id);

    let history = [];
    let execution = null;
    if (executionId) {
        log(`Fetching execution ${executionId}…`);
        const getResp = await proxy(host, token, "/api/v3/orchestration/get_execution", {
            execution_id: executionId,
        });
        execution = getResp.body && (getResp.body.execution || getResp.body);
        const histResp = await proxy(host, token, "/api/v3/orchestration/get_execution_history", {
            execution_id: executionId,
        });
        const histBody = histResp.body || {};
        history = histBody.history || histBody.execution_history || histBody.states || [];
        if (!Array.isArray(history) && histBody.data) history = histBody.data;
    }

    return {
        token,
        execResp,
        executionId,
        execution,
        history,
        planVersion,
    };
}


