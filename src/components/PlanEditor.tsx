"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, humanizeId, pretty, sampleFromSchema } from "@/lib/api";
import {
  addState,
  applyPlanStates,
  blankPlan,
  clearNext,
  defaultInputValidationSchema,
  defaultStateForType,
  deleteState,
  inferType,
  normalizeStates,
  renameState,
  setNext,
  lintEdgeField,
  wrapperState,
} from "@/lib/plan/model";
import {
  checkPlanRemote,
  issuesFromCheckPlanResponse,
  mergeValidationResults,
  validatePlan,
} from "@/lib/plan/validator";
import { getServiceToken, runPlan } from "@/lib/plan/run";
import {
  ACTIVATE_BILLING_SAMPLE_INPUT,
  fetchExecutionBundle,
  haltExecution,
  isTerminalStatus,
  type ExecutionBundle,
  type RunHighlight,
} from "@/lib/plan/execution";
import { defaultValueForField } from "@/lib/plan/fieldDefaults";
import { collectVariablePaths } from "@/lib/plan/jsonSuggest";
import type {
  AppSettings,
  OePlan,
  SchemaCache,
  StateTypeSchema,
  ValidationResult,
} from "@/lib/plan/types";
import { usePlanStore } from "@/store/plan-store";
import { GraphCanvas, resetGraphPositions } from "@/components/GraphCanvas";
import { JsonEditor } from "@/components/JsonEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AppDialog } from "@/components/editor/AppDialog";
import { EditorExecutionPanel } from "@/components/editor/EditorExecutionPanel";
import { EditorGraphPanel } from "@/components/editor/EditorGraphPanel";
import { EditorInspector } from "@/components/editor/EditorInspector";
import { EditorSidebar } from "@/components/editor/EditorSidebar";
import { EditorStatusBar } from "@/components/editor/EditorStatusBar";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { ExecutionModal } from "@/components/editor/ExecutionModal";
import { OpenPlanDialog } from "@/components/editor/dialogs/OpenPlanDialog";
import { EditorWorkspace } from "@/components/editor/EditorWorkspace";
import { useLiveFileReload } from "@/hooks/useLiveFileReload";
import { buildSession, loadSession, saveSession } from "@/lib/session";

function uniqueStateName(plan: OePlan, base: string) {
  const { map } = normalizeStates(plan.states) as {
    map: Record<string, unknown>;
    order: string[];
  };
  let name = base;
  let i = 1;
  while (map[name]) name = `${base}_${i++}`;
  return name;
}

export function PlanEditor() {
  const store = usePlanStore();
  const [renderToken, setRenderToken] = useState(1);
  const [relayoutToken, setRelayoutToken] = useState(0);
  const [newNode, setNewNode] = useState<{
    id: string;
    nearId?: string;
    position?: { x: number; y: number };
  } | null>(null);
  const [runHighlight, setRunHighlight] = useState<RunHighlight | null>(null);
  const [execBundle, setExecBundle] = useState<ExecutionBundle | null>(null);
  const [execPolling, setExecPolling] = useState(false);
  const [execModalOpen, setExecModalOpen] = useState(false);
  const [execFocusState, setExecFocusState] = useState<string | null>(null);
  const [inspectorJson, setInspectorJson] = useState("");
  const [inspectorName, setInspectorName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [runHost, setRunHost] = useState("");
  const [runOperator, setRunOperator] = useState("");
  const [runToken, setRunToken] = useState("");
  const [runUpsert, setRunUpsert] = useState(true);
  const [runInput, setRunInput] = useState("{}");
  const [runIntegrationTests, setRunIntegrationTests] = useState(
    pretty({ use_mock_http_client: true }),
  );
  const [oeCheckBusy, setOeCheckBusy] = useState(false);
  const [setLuaRoot, setSetLuaRoot] = useState("");
  const [setHost, setSetHost] = useState("");
  const [setOperator, setSetOperator] = useState("");
  const [newPlanId, setNewPlanId] = useState("new_plan");
  const [newPlanOwner, setNewPlanOwner] = useState("orchestration-team");
  const [newPlanDefault, setNewPlanDefault] = useState(true);
  const [planOwners, setPlanOwners] = useState<string[]>([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [newPlanSchema, setNewPlanSchema] = useState(
    pretty(defaultInputValidationSchema()),
  );
  const [planSearch, setPlanSearch] = useState("");
  const [planService, setPlanService] = useState("all");
  const [plans, setPlans] = useState<{ path: string; name: string; service: string }[]>(
    [],
  );
  const [services, setServices] = useState<string[]>([]);
  const [paletteQuery, setPaletteQuery] = useState("");
  const inspectorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boundInspectorName = useRef<string | null>(null);
  /** Skip clobbering Monaco after inspector auto-save / while the editor is focused. */
  const inspectorSkipSyncRef = useRef(false);
  const inspectorFocusedRef = useRef(false);

  const bump = useCallback(
    (opts?: {
      relayout?: boolean;
      newNodeId?: string;
      nearId?: string;
      position?: { x: number; y: number };
    }) => {
      setRenderToken((t) => t + 1);
      if (opts?.relayout) setRelayoutToken((t) => t + 1);
      if (opts?.newNodeId) {
        setNewNode({
          id: opts.newNodeId,
          nearId: opts.nearId,
          position: opts.position,
        });
      } else {
        setNewNode(null);
      }
    },
    [],
  );

  const syncJson = useCallback(
    (plan: OePlan) => {
      store.setJsonText(pretty(plan));
      store.setDirtyJson(false);
    },
    [store],
  );

  const resolveAndValidate = useCallback(
    async (plan: OePlan, schemaOverride?: SchemaCache | null) => {
      try {
        const resp = await api<{ resolved: OePlan }>("/api/plan/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        store.setResolved(resp.resolved);
      } catch {
        store.setResolved(plan);
      }
      // Always read fresh schema — boot calls this before React re-renders
      // after setSchema, so a closed-over `store.schema` is often still null.
      const schema =
        schemaOverride ?? usePlanStore.getState().schema ?? null;
      const wrappers = schema?.wrappers || [];
      // Empty catalog → skip ref checks (don't flag every #.task_pausable).
      const wrapperIds =
        wrappers.length > 0
          ? (() => {
              const ids = new Set<string>();
              for (const w of wrappers) {
                if (w.id) ids.add(w.id);
                if (w.ref) {
                  ids.add(w.ref);
                  ids.add(w.ref.replace(/^#\./, ""));
                }
              }
              return ids;
            })()
          : null;
      store.setValidation(
        validatePlan(plan, {
          wrapperIds,
          typeSchemas: schema?.state_types || null,
        }),
      );
      store.setOeCheck(null);
      store.setOeIssues(null);
    },
    [store],
  );

  const loadPlan = useCallback(
    async (
      plan: OePlan,
      filePath: string | null,
      schemaOverride?: SchemaCache | null,
    ) => {
      store.setPlan(plan);
      store.setFilePath(filePath);
      store.setSelected(plan.start_at || null);
      store.setPlanVersion(null);
      store.setOeCheck(null);
      store.setOeIssues(null);
      store.setDirtyJson(false);
      resetGraphPositions();
      syncJson(plan);
      await resolveAndValidate(plan, schemaOverride);
      bump({ relayout: true });
      const { order } = normalizeStates(plan.states);
      store.setStatus(
        `${plan.plan_id || "(no plan_id)"} · ${order.length} states` +
          (filePath ? ` · ${filePath}` : ""),
      );
    },
    [bump, resolveAndValidate, store, syncJson],
  );

  useLiveFileReload({
    filePath: store.filePath,
    plan: store.plan,
    onReload: loadPlan,
  });

  const refreshExecution = useCallback(
    async (executionId: string, opts?: { silent?: boolean }) => {
      const host = runHost.trim() || store.settings?.default_host || "";
      if (!host) {
        if (!opts?.silent) toast.error("Set OE host first");
        return null;
      }
      try {
        let token = runToken.trim();
        if (!token) {
          token = await getServiceToken(
            host,
            runOperator.trim() || store.settings?.default_operator || "pilotfiber",
          );
          setRunToken(token);
        }
        const bundle = await fetchExecutionBundle(host, token, executionId);
        setExecBundle(bundle);
        setRunHighlight(bundle.highlight);
        bump();
        store.setStatus(
          `Execution ${bundle.status}` +
            (bundle.lastState ? ` · ${bundle.lastState}` : ""),
        );
        return bundle;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!opts?.silent) toast.error(msg);
        store.appendRunLog(`Execution refresh error: ${msg}`);
        return null;
      }
    },
    [bump, runHost, runOperator, runToken, store],
  );

  useEffect(() => {
    if (!execBundle?.executionId) return;
    if (isTerminalStatus(execBundle.status)) {
      setExecPolling(false);
      return;
    }
    setExecPolling(true);
    const id = window.setInterval(() => {
      void refreshExecution(execBundle.executionId, { silent: true });
    }, 2000);
    return () => window.clearInterval(id);
  }, [execBundle?.executionId, execBundle?.status, refreshExecution]);

  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const settings = await api<AppSettings>("/api/settings");
        store.setSettings(settings);
        let schema: SchemaCache;
        try {
          schema = await api<SchemaCache>("/api/schema");
        } catch {
          schema = await api<SchemaCache>("/api/schema/refresh", {
            method: "POST",
            body: "{}",
          });
        }
        // Stale/empty cache after restart → rebuild from lua_root
        if (!schema.wrappers?.length || !schema.state_types?.length) {
          schema = await api<SchemaCache>("/api/schema/refresh", {
            method: "POST",
            body: "{}",
          });
        }
        store.setSchema(schema);

        try {
          const ownersResp = await api<{ owners: string[] }>(
            "/api/lua/plan-owners",
          );
          const owners = ownersResp.owners || [];
          setPlanOwners(owners);
          if (owners.length) setNewPlanOwner(owners[0]);
        } catch {
          setPlanOwners([]);
        }

        const session = loadSession();
        if (session?.kind === "file") {
          try {
            const file = await api<{ json: OePlan | null }>(
              `/api/lua/file?path=${encodeURIComponent(session.path)}`,
            );
            if (file.json) {
              await loadPlan(file.json, session.path, schema);
              if (session.selected) store.setSelected(session.selected);
              store.setStatus(
                `Reopened ${session.path} · ${schema.wrappers.length} wrappers`,
              );
            } else {
              await loadPlan(blankPlan(), null, schema);
              toast.warning("Last file is not valid JSON — started blank plan");
            }
          } catch (err) {
            await loadPlan(blankPlan(), null, schema);
            toast.warning(
              `Could not reopen ${session.path}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        } else if (session?.kind === "draft") {
          await loadPlan(session.plan, null, schema);
          if (session.selected) store.setSelected(session.selected);
          store.setStatus(
            `Restored draft ${session.plan.plan_id || "(no plan_id)"} · ${schema.wrappers.length} wrappers`,
          );
        } else {
          await loadPlan(blankPlan(), null, schema);
          store.setStatus(
            `Ready · lua_root=${settings.lua_root} · ${schema.wrappers.length} wrappers`,
          );
        }
      } catch (err) {
        store.setStatus(
          `Boot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setSessionReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionReady || !store.plan) return;
    const timer = window.setTimeout(() => {
      saveSession(
        buildSession({
          plan: store.plan!,
          filePath: store.filePath,
          selected: store.selected,
        }),
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sessionReady, store.plan, store.filePath, store.selected]);

  const plan = store.plan;
  const { map, order } = useMemo(() => {
    return normalizeStates(plan?.states) as {
      map: Record<string, Record<string, unknown>>;
      order: string[];
    };
  }, [plan]);

  useEffect(() => {
    if (!store.selected || !map[store.selected]) {
      setInspectorJson("");
      setInspectorName("");
      boundInspectorName.current = null;
      return;
    }
    const selectionChanged = boundInspectorName.current !== store.selected;
    boundInspectorName.current = store.selected;

    // Same state: don't rewrite Monaco while typing or right after inspector apply.
    // Rewrites were stealing focus when applyPlan → resolve bumped map/renderToken.
    if (!selectionChanged) {
      if (inspectorSkipSyncRef.current) {
        inspectorSkipSyncRef.current = false;
        setInspectorName(store.selected);
        return;
      }
      if (inspectorFocusedRef.current) {
        return;
      }
    }

    setInspectorName(store.selected);
    setInspectorJson(pretty(map[store.selected]));
  }, [store.selected, map]);

  const applyPlan = useCallback(
    async (
      next: OePlan,
      opts?: {
        relayout?: boolean;
        newNodeId?: string;
        nearId?: string;
        position?: { x: number; y: number };
        status?: string;
        /** Update store/resolve without bumping graph renderToken (inspector typing). */
        quiet?: boolean;
      },
    ) => {
      store.setPlan(next);
      syncJson(next);
      await resolveAndValidate(next);
      if (!opts?.quiet) bump(opts);
      if (opts?.status) store.setStatus(opts.status);
    },
    [bump, resolveAndValidate, store, syncJson],
  );

  const connectStates = useCallback(
    async (fromId: string, toId: string) => {
      if (!plan) return;
      try {
        store.setSelected(fromId);
        const field = lintEdgeField(map[fromId]);
        await applyPlan(setNext(plan, fromId, toId), {
          status: `${fromId}.${field} = ${toId}`,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [applyPlan, map, plan, store],
  );

  const clearNextFrom = useCallback(
    async (fromId: string) => {
      if (!plan) return;
      store.setSelected(fromId);
      const field = lintEdgeField(map[fromId]);
      await applyPlan(clearNext(plan, fromId), {
        status: `Cleared ${field} on ${fromId}`,
      });
    },
    [applyPlan, map, plan, store],
  );

  const deleteSelectedState = useCallback(
    async (name: string | null) => {
      if (!plan || !name) return;
      if (!confirm(`Delete state “${name}”?`)) return;
      const next = deleteState(plan, name);
      store.setSelected(next.start_at || null);
      await applyPlan(next);
    },
    [applyPlan, plan, store],
  );

  const typeSchemaFor = useCallback(
    (type: string): StateTypeSchema | undefined =>
      (store.schema?.state_types || []).find((t) => t.id === type),
    [store.schema],
  );

  const addStateAfter = useCallback(
    async (fromId: string, type = "task") => {
      if (!plan) return;
      const name = uniqueStateName(plan, `after_${fromId}`);
      let next = addState(plan, name, defaultStateForType(type, typeSchemaFor(type)));
      next = setNext(next, fromId, name);
      store.setSelected(name);
      await applyPlan(next, {
        newNodeId: name,
        nearId: fromId,
        status: `Created ${name} after ${fromId}`,
      });
    },
    [applyPlan, plan, store, typeSchemaFor],
  );

  const addTypedState = useCallback(
    async (type: string, position?: { x: number; y: number }) => {
      if (!plan) return;
      const name = uniqueStateName(
        plan,
        type === "success" ? "final_success" : `new_${type}`,
      );
      store.setSelected(name);
      await applyPlan(
        addState(plan, name, defaultStateForType(type, typeSchemaFor(type))),
        {
          newNodeId: name,
          position,
          status: `Added ${name}`,
        },
      );
    },
    [applyPlan, plan, store, typeSchemaFor],
  );

  const addWrapperState = useCallback(
    async (ref: string) => {
      if (!plan) return;
      const name = uniqueStateName(plan, ref.replace(/^#\./, ""));
      store.setSelected(name);
      await applyPlan(addState(plan, name, wrapperState(ref)), {
        newNodeId: name,
        status: `Added wrapper ${name}`,
      });
    },
    [applyPlan, plan, store],
  );

  const scheduleInspectorApply = useCallback(
    (json: string, nameField: string) => {
      setInspectorJson(json);
      if (inspectorTimer.current) clearTimeout(inspectorTimer.current);
      inspectorTimer.current = setTimeout(async () => {
        if (!plan || !boundInspectorName.current) return;
        const originalName = boundInspectorName.current;
        let patched;
        try {
          patched = JSON.parse(json);
        } catch {
          store.setStatus("Inspector JSON invalid — fix to auto-apply");
          return;
        }
        let next = plan;
        let name = originalName;
        if (nameField && nameField !== originalName) {
          next = renameState(next, originalName, nameField);
          name = nameField;
        }
        const norm = normalizeStates(next.states) as {
          map: Record<string, unknown>;
          order: string[];
        };
        if (!norm.map[name]) return;
        norm.map[name] = patched;
        next = applyPlanStates(next, norm.map, norm.order);
        store.setSelected(name);
        boundInspectorName.current = name;
        inspectorSkipSyncRef.current = true;
        await applyPlan(next, {
          status: `Updated state “${name}”`,
          quiet: true,
        });
      }, 450);
    },
    [applyPlan, plan, store],
  );

  const browsePlans = useCallback(async () => {
    const params = new URLSearchParams();
    if (planSearch) params.set("q", planSearch);
    if (planService && planService !== "all") params.set("service", planService);
    const data = await api<{
      plans: { path: string; name: string; service: string }[];
      services: string[];
    }>(`/api/lua/plans?${params}`);
    setPlans(data.plans || []);
    setServices(data.services || []);
  }, [planSearch, planService]);

  useEffect(() => {
    if (store.modal === "open") browsePlans().catch(console.error);
  }, [store.modal, browsePlans]);

  const filteredTypes = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    return (store.schema?.state_types || []).filter((t) => {
      if (!q) return true;
      const hay = `${t.id} ${t.label} ${humanizeId(t.id)}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });
  }, [paletteQuery, store.schema]);

  const filteredWrappers = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const preferred = [
      "task_regular",
      "task_pausable",
      "callback_pausable",
      "callback_regular",
      "run_plan_regular",
      "run_plan_pausable",
      "callback_run_plan",
    ];
    let list = (store.schema?.wrappers || []).filter(
      (w) => !w.kind || w.kind === "state_blocks",
    );
    list = list.filter((w) => {
      if (!q) return true;
      const hay = `${w.id} ${w.ref} ${w.path} ${humanizeId(w.id)}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });
    list.sort((a, b) => {
      const ia = preferred.indexOf(a.id);
      const ib = preferred.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [paletteQuery, store.schema]);

  const displayValidation: ValidationResult = useMemo(
    () =>
      mergeValidationResults(store.validation, store.oeIssues) as ValidationResult,
    [store.validation, store.oeIssues],
  );

  const stageNames = useMemo(() => {
    const stages = new Set<string>();
    for (const name of order) {
      const st = map[name];
      const stage = st && typeof st.stage === "string" ? st.stage.trim() : "";
      if (stage) stages.add(stage);
    }
    return [...stages].sort((a, b) => a.localeCompare(b));
  }, [map, order]);

  const variablePaths = useMemo(() => collectVariablePaths(plan), [plan]);

  const selectedIssues = useMemo(() => {
    const forState =
      (store.selected && displayValidation.byState[store.selected]) || [];
    const planLevel = displayValidation.errors.filter((e) => !e.state);
    // Plan-level OE/local errors stay visible even when a state is selected
    return [...planLevel, ...forState];
  }, [displayValidation, store.selected]);

  const runOeCheck = useCallback(async () => {
    if (!plan) return;
    const host = store.settings?.default_host || runHost || "";
    const operator =
      store.settings?.default_operator || runOperator || "pilotfiber";
    if (!host) {
      toast.error("Set OE host in Settings first");
      store.setModal("settings");
      return;
    }
    setOeCheckBusy(true);
    store.setStatus("OE check_plan…");
    try {
      let token: string | null = runToken.trim() || null;
      if (!token) {
        token = await getServiceToken(host, operator);
        if (token) setRunToken(token);
      }
      const knownStates = Object.keys(map);
      const data = await checkPlanRemote(host, token, plan, operator);
      const parsed = issuesFromCheckPlanResponse(data, { knownStates, plan });
      store.setOeCheck(parsed.summary);
      store.setOeIssues(parsed.ok ? [] : parsed.issues);
      if (parsed.ok) {
        store.setStatus("OE check_plan: valid");
        toast.success("OE check_plan: valid");
      } else {
        store.setStatus(`OE check_plan failed: ${parsed.summary}`);
        toast.error(parsed.summary.slice(0, 280));
        const firstState = parsed.issues.find((i) => i.state)?.state;
        if (firstState) store.setSelected(firstState);
      }
      bump();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.setOeCheck(`error — ${msg}`);
      store.setOeIssues([
        {
          level: "error",
          message: `OE: ${msg}`,
          state: null,
          path: "plan",
        },
      ]);
      store.setStatus(`OE check_plan error: ${msg}`);
      toast.error(msg);
    } finally {
      setOeCheckBusy(false);
    }
  }, [bump, map, plan, runHost, runOperator, runToken, store]);

  const selectedTypeSchema = useMemo(() => {
    const t = inferType(map[store.selected || ""] || {});
    return typeSchemaFor(t);
  }, [map, store.selected, typeSchemaFor]);

  const inspectorPresentKeys = useMemo(() => {
    try {
      const obj = JSON.parse(inspectorJson) as Record<string, unknown>;
      return Object.keys(obj || {});
    } catch {
      const st = map[store.selected || ""];
      return st && typeof st === "object" ? Object.keys(st) : [];
    }
  }, [inspectorJson, map, store.selected]);

  const addAvailableField = useCallback(
    (fieldName: string) => {
      if (!store.selected) return;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(inspectorJson) as Record<string, unknown>;
      } catch {
        toast.error("Fix invalid JSON before adding a field");
        return;
      }
      if (Object.prototype.hasOwnProperty.call(obj, fieldName)) return;
      const field = selectedTypeSchema?.fields?.find((f) => f.name === fieldName);
      const sample = defaultValueForField(fieldName, field);
      obj[fieldName] = sample === undefined ? null : sample;
      const nextJson = pretty(obj);
      scheduleInspectorApply(nextJson, inspectorName);
    },
    [
      inspectorJson,
      inspectorName,
      scheduleInspectorApply,
      selectedTypeSchema,
      store.selected,
    ],
  );

  const closeModal = () => store.setModal(null);

  if (!plan) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        {store.status}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <EditorToolbar
        oeCheckBusy={oeCheckBusy}
        onNew={() => store.setModal("new")}
        onOpenLua={() => store.setModal("open")}
        onPaste={() => {
          setPasteText("");
          store.setModal("paste");
        }}
        onCopyJson={async () => {
          try {
            await navigator.clipboard.writeText(pretty(plan));
            toast.success("Plan JSON copied");
          } catch (err) {
            toast.error(
              `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }}
        onOeCheck={() => void runOeCheck()}
        onRun={() => {
          setRunHost(store.settings?.default_host || "");
          setRunOperator(store.settings?.default_operator || "pilotfiber");
          setRunUpsert(true);
          if (plan.plan_id === "activate_billing") {
            setRunInput(pretty(ACTIVATE_BILLING_SAMPLE_INPUT));
          } else {
            setRunInput(
              pretty(
                plan.input_validation_schema
                  ? sampleFromSchema(plan.input_validation_schema)
                  : {},
              ),
            );
          }
          store.setRunLog("");
          store.setModal("run");
        }}
        onSettings={() => {
          setSetLuaRoot(store.settings?.lua_root || "");
          setSetHost(store.settings?.default_host || "");
          setSetOperator(store.settings?.default_operator || "");
          store.setModal("settings");
        }}
      />

      <EditorWorkspace
        sidebar={
          <EditorSidebar
            plan={plan}
            order={order}
            map={map}
            selected={store.selected}
            validation={displayValidation}
            sideTab={store.sideTab}
            paletteQuery={paletteQuery}
            planOwners={planOwners}
            filteredTypes={filteredTypes}
            filteredWrappers={filteredWrappers}
            onSideTab={store.setSideTab}
            onSelect={store.setSelected}
            onPlanMeta={(patch) => {
              const next = { ...plan, ...patch };
              store.setPlan(next);
              syncJson(next);
              if ("plan_id" in patch) store.setPlanVersion(null);
              if ("start_at" in patch) {
                void applyPlan(next, { status: `start_at → ${patch.start_at}` });
              } else {
                void resolveAndValidate(next);
              }
            }}
            onPaletteQuery={setPaletteQuery}
            onAddType={(t) => void addTypedState(t)}
            onAddWrapper={(ref) => void addWrapperState(ref)}
            inferType={inferType}
          />
        }
        graph={
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <EditorGraphPanel
              className="min-h-0 flex-1"
              hint={store.graphHint}
              validation={displayValidation}
              oeCheck={store.oeCheck}
              onAddAfterSelected={() => {
                if (!store.selected) {
                  store.setStatus("Select a state first");
                  return;
                }
                void addStateAfter(store.selected, "task");
              }}
              onDeleteSelected={() => void deleteSelectedState(store.selected)}
              onRelayout={() => {
                resetGraphPositions();
                bump({ relayout: true });
              }}
            >
              <GraphCanvas
                plan={plan}
                resolved={store.resolved}
                selected={store.selected}
                validation={displayValidation}
                renderToken={renderToken}
                relayoutToken={relayoutToken}
                newNode={newNode}
                runHighlight={runHighlight}
                handlers={{
                  onSelect: (id) => {
                    store.setSelected(id);
                    if (
                      id &&
                      execModalOpen &&
                      execBundle?.highlight.outcomes[id]
                    ) {
                      setExecFocusState(id);
                    }
                  },
                  onConnect: connectStates,
                  onClearNext: clearNextFrom,
                  onAddNext: addStateAfter,
                  onDelete: deleteSelectedState,
                  onEmptyDblClick: (pos) => void addTypedState("task", pos),
                }}
              />
            </EditorGraphPanel>
            <EditorExecutionPanel
              bundle={execBundle}
              polling={execPolling}
              openPlanId={plan.plan_id || null}
              onOpen={() => {
                setExecFocusState(store.selected);
                setExecModalOpen(true);
              }}
              onRefresh={() => {
                if (execBundle?.executionId) {
                  void refreshExecution(execBundle.executionId);
                }
              }}
              onHalt={async () => {
                if (!execBundle?.executionId) return;
                const host =
                  runHost.trim() || store.settings?.default_host || "";
                try {
                  const resp = await haltExecution(
                    host,
                    runToken.trim() || null,
                    execBundle.executionId,
                  );
                  store.appendRunLog(
                    `halt_execution HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 240)}`,
                  );
                  toast.success("Halt requested");
                  await refreshExecution(execBundle.executionId);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }}
              onClear={() => {
                setExecBundle(null);
                setRunHighlight(null);
                setExecPolling(false);
                setExecModalOpen(false);
                bump();
              }}
            />
          </div>
        }
        inspector={
          <EditorInspector
            selected={store.selected}
            stateType={inferType(map[store.selected || ""] || {})}
            stateRef={
              store.selected && map[store.selected]?.ref != null
                ? String(map[store.selected].ref)
                : null
            }
            issues={selectedIssues}
            nameValue={inspectorName}
            jsonValue={inspectorJson}
            availableFields={selectedTypeSchema?.fields || []}
            variants={selectedTypeSchema?.variants || []}
            presentKeys={inspectorPresentKeys}
            stateNames={order}
            stageNames={stageNames}
            variablePaths={variablePaths}
            onNameChange={setInspectorName}
            onNameCommit={() =>
              scheduleInspectorApply(inspectorJson, inspectorName)
            }
            onJsonChange={(v) => scheduleInspectorApply(v, inspectorName)}
            onJsonFocus={() => {
              inspectorFocusedRef.current = true;
            }}
            onJsonBlur={() => {
              inspectorFocusedRef.current = false;
            }}
            onAddField={addAvailableField}
            onAddAfter={() => {
              if (store.selected) void addStateAfter(store.selected, "task");
            }}
            onDelete={() => void deleteSelectedState(store.selected)}
          />
        }
      />

      <EditorStatusBar status={store.status} />

      <ExecutionModal
        open={execModalOpen && !!execBundle}
        onOpenChange={setExecModalOpen}
        bundle={execBundle}
        planOrder={order}
        planVersion={store.planVersion}
        openPlanId={plan.plan_id || null}
        host={runHost.trim() || store.settings?.default_host || ""}
        token={runToken.trim() || null}
        polling={execPolling}
        initialState={execFocusState}
        onRefresh={() => {
          if (execBundle?.executionId) {
            void refreshExecution(execBundle.executionId);
          }
        }}
        onAfterAction={() => {
          if (execBundle?.executionId) {
            void refreshExecution(execBundle.executionId);
          }
        }}
        onLog={(line) => store.appendRunLog(line)}
      />

      <OpenPlanDialog
        open={store.modal === "open"}
        onOpenChange={(open) => !open && closeModal()}
        services={services}
        plans={plans}
        service={planService}
        search={planSearch}
        onServiceChange={setPlanService}
        onSearchChange={setPlanSearch}
        onPick={async (p) => {
          const file = await api<{ json: OePlan | null }>(
            `/api/lua/file?path=${encodeURIComponent(p.path)}`,
          );
          if (!file.json) {
            toast.error("Not valid JSON");
            return;
          }
          closeModal();
          await loadPlan(file.json, p.path);
        }}
      />

      <AppDialog
        open={store.modal === "paste"}
        onOpenChange={(open) => !open && closeModal()}
        title="Paste plan JSON"
        size="wide"
        footer={
          <>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  closeModal();
                  await loadPlan(JSON.parse(pasteText), null);
                } catch (err) {
                  toast.error(
                    `Invalid JSON: ${err instanceof Error ? err.message : err}`,
                  );
                }
              }}
            >
              Load
            </Button>
          </>
        }
      >
        <div className="min-h-0 min-w-0 w-full overflow-hidden">
          <JsonEditor value={pasteText} onChange={setPasteText} height={280} />
        </div>
      </AppDialog>

      <AppDialog
        open={store.modal === "new"}
        onOpenChange={(open) => !open && closeModal()}
        title="New plan"
        footer={
          <>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                let schema;
                try {
                  schema = JSON.parse(newPlanSchema);
                } catch (err) {
                  toast.error(
                    `Schema invalid: ${err instanceof Error ? err.message : err}`,
                  );
                  return;
                }
                closeModal();
                await loadPlan(
                  blankPlan({
                    plan_id: newPlanId.trim() || "new_plan",
                    plan_owner:
                      newPlanOwner.trim() ||
                      planOwners[0] ||
                      "orchestration-team",
                    is_default: newPlanDefault,
                    input_validation_schema: schema,
                  }),
                  null,
                );
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel>plan_id</FieldLabel>
          <Input value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>plan_owner</FieldLabel>
          <select
            className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
            value={newPlanOwner}
            onChange={(e) => setNewPlanOwner(e.target.value)}
          >
            {newPlanOwner && !planOwners.includes(newPlanOwner) ? (
              <option value={newPlanOwner}>{newPlanOwner}</option>
            ) : null}
            {planOwners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={newPlanDefault}
            onCheckedChange={(c) => setNewPlanDefault(c === true)}
          />
          is_default
        </label>
        <Field>
          <FieldLabel>input_validation_schema</FieldLabel>
        </Field>
        <JsonEditor value={newPlanSchema} onChange={setNewPlanSchema} height={220} />
      </AppDialog>

      <AppDialog
        open={store.modal === "settings"}
        onOpenChange={(open) => !open && closeModal()}
        title="Settings"
        footer={
          <>
            <Button variant="outline" onClick={closeModal}>
              Close
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                store.setStatus("Refreshing schema from lua…");
                const schema = await api<SchemaCache>("/api/schema/refresh", {
                  method: "POST",
                  body: "{}",
                });
                store.setSchema(schema);
                const plan = usePlanStore.getState().plan;
                if (plan) await resolveAndValidate(plan, schema);
                closeModal();
                store.setStatus(
                  `Schema: ${schema.state_types.length} types, ${schema.wrappers.length} wrappers`,
                );
                toast.success("Schema refreshed");
              }}
            >
              Refresh schema
            </Button>
            <Button
              onClick={async () => {
                const settings = await api<AppSettings>("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    lua_root: setLuaRoot.trim(),
                    default_host: setHost.trim(),
                    default_operator: setOperator.trim(),
                  }),
                });
                store.setSettings(settings);
                closeModal();
                store.setStatus("Settings saved");
                toast.success("Settings saved");
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel>lua_root</FieldLabel>
          <div className="flex min-w-0 gap-2">
            <Input
              className="min-w-0 flex-1"
              value={setLuaRoot}
              onChange={(e) => setSetLuaRoot(e.target.value)}
              placeholder="/path/to/lua"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={pickingFolder}
              onClick={async () => {
                setPickingFolder(true);
                try {
                  const resp = await api<{
                    path?: string;
                    cancelled?: boolean;
                    error?: string;
                  }>("/api/settings/pick-folder", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      prompt: "Select lua repository root",
                    }),
                  });
                  if (resp.cancelled) return;
                  if (resp.path) {
                    setSetLuaRoot(resp.path);
                    toast.success("Folder selected");
                  }
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setPickingFolder(false);
                }
              }}
            >
              {pickingFolder ? "Choosing…" : "Browse…"}
            </Button>
          </div>
        </Field>
        <Field>
          <FieldLabel>Default OE host</FieldLabel>
          <Input value={setHost} onChange={(e) => setSetHost(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Default operator_name</FieldLabel>
          <select
            className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
            value={setOperator}
            onChange={(e) => setSetOperator(e.target.value)}
          >
            {setOperator &&
            !(store.settings?.operators || []).includes(setOperator) ? (
              <option value={setOperator}>{setOperator}</option>
            ) : null}
            {(store.settings?.operators || []).map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Edit the <code>operators</code> array in{" "}
            <code>settings.json</code> to change this list.
          </p>
        </Field>
      </AppDialog>

      <AppDialog
        open={store.modal === "run"}
        onOpenChange={(open) => !open && closeModal()}
        title="Run on local OE"
        size="xl"
        className="max-h-[min(92svh,960px)]"
        bodyClassName="overflow-hidden"
        footer={
          <>
            <Button variant="outline" onClick={closeModal}>
              Close
            </Button>
            <Button
              onClick={async () => {
                try {
                  let input = {};
                  if (runInput.trim()) input = JSON.parse(runInput);
                  let integrationTests: Record<string, unknown> | null = null;
                  if (runIntegrationTests.trim()) {
                    integrationTests = JSON.parse(runIntegrationTests);
                  }
                  setRunHighlight(null);
                  setExecBundle(null);
                  const result = await runPlan({
                    host: runHost.trim(),
                    operator: runOperator.trim(),
                    token: runToken.trim() || null,
                    plan,
                    input,
                    integrationTests,
                    upsert: runUpsert,
                    knownVersion: store.planVersion,
                    log: (m: string) => store.appendRunLog(m),
                    onToken: (t: string) => setRunToken(t),
                    onVersion: (ver: number, action: string) => {
                      store.setPlanVersion(ver);
                      store.appendRunLog(`Tracked OE version → ${ver} (${action})`);
                    },
                  });
                  if (result.planVersion != null) {
                    store.setPlanVersion(result.planVersion);
                  }
                  if (result.executionId) {
                    store.appendRunLog(`Done. execution_id=${result.executionId}`);
                    toast.success(`execution_id=${result.executionId}`);
                    await refreshExecution(result.executionId);
                    closeModal();
                    setExecFocusState(null);
                    setExecModalOpen(true);
                  } else {
                    toast.error("No execution_id in response — see log");
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  store.appendRunLog(`ERROR: ${msg}`);
                  toast.error(msg);
                }
              }}
            >
              Execute
            </Button>
          </>
        }
      >
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.9fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Host</FieldLabel>
                <Input
                  value={runHost}
                  onChange={(e) => setRunHost(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>operator_name</FieldLabel>
                <select
                  className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
                  value={runOperator}
                  onChange={(e) => setRunOperator(e.target.value)}
                >
                  {runOperator &&
                  !(store.settings?.operators || []).includes(runOperator) ? (
                    <option value={runOperator}>{runOperator}</option>
                  ) : null}
                  {(store.settings?.operators || []).map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field>
              <FieldLabel>Bearer token</FieldLabel>
              <div className="flex min-w-0 gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={runToken}
                  onChange={(e) => setRunToken(e.target.value)}
                  placeholder="paste or fetch"
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={async () => {
                    try {
                      const token = await getServiceToken(
                        runHost.trim(),
                        runOperator.trim(),
                      );
                      setRunToken(token);
                      store.appendRunLog("Token fetched.");
                      toast.success("Token fetched");
                    } catch (err) {
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      store.appendRunLog(`Token error: ${msg}`);
                      toast.error(msg);
                    }
                  }}
                >
                  Get service token
                </Button>
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={runUpsert}
                onCheckedChange={(c) => setRunUpsert(c === true)}
              />
              Upsert plan before run
            </label>
            <p className="text-xs text-muted-foreground">
              Runs the currently open plan (
              <code className="font-mono">{plan.plan_id || "—"}</code>
              ). OE version:{" "}
              {store.planVersion != null
                ? `${store.planVersion}`
                : "— (fetched via get_plan on upsert)"}
            </p>
            <Field>
              <FieldLabel>Input JSON</FieldLabel>
            </Field>
            <JsonEditor
              value={runInput}
              onChange={setRunInput}
              height={220}
              minHeight={180}
            />
            <Field>
              <FieldLabel>integration_tests</FieldLabel>
            </Field>
            <JsonEditor
              value={runIntegrationTests}
              onChange={setRunIntegrationTests}
              height={140}
              minHeight={120}
            />
          </div>
          <div className="flex min-h-[280px] min-w-0 flex-col gap-2 lg:min-h-0">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <FieldLabel className="mb-0">Log</FieldLabel>
              <Button
                size="xs"
                variant="ghost"
                disabled={!store.runLog}
                onClick={() => store.setRunLog("")}
              >
                Clear logs
              </Button>
            </div>
            <pre className="min-h-[240px] flex-1 overflow-auto overscroll-contain rounded-lg border bg-background p-2.5 font-mono text-[11px] whitespace-pre-wrap lg:min-h-0">
              {store.runLog || "—"}
            </pre>
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
