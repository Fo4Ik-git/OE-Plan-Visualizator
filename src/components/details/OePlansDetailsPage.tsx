"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  fetchExecutionBundle,
  isTerminalStatus,
  type ExecutionBundle,
} from "@/lib/plan/execution";
import {
  fetchOePlanIds,
  formatEpoch,
  searchExecutions,
  type ExecutionListItem,
} from "@/lib/plan/executionSearch";
import { getServiceToken } from "@/lib/plan/run";
import type { AppSettings } from "@/lib/plan/types";
import {
  PlanNameCombobox,
  type PlanNameOption,
} from "@/components/details/PlanNameCombobox";
import { ExecutionModal } from "@/components/editor/ExecutionModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { statusBadgeClass } from "@/lib/executionStatus";
import { cn } from "@/lib/utils";

export function OePlansDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [host, setHost] = useState("");
  const [operator, setOperator] = useState("");
  const [token, setToken] = useState("");
  const [planQuery, setPlanQuery] = useState("");
  const [executionIdQuery, setExecutionIdQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<ExecutionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExecutionBundle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [polling, setPolling] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [planOptions, setPlanOptions] = useState<PlanNameOption[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<AppSettings>("/api/settings");
        setSettings(s);
        setHost(s.default_host || "");
        setOperator(s.default_operator || "pilotfiber");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load settings",
        );
      } finally {
        setBootDone(true);
      }
    })();
  }, []);

  // Local lua plan names (always available)
  useEffect(() => {
    (async () => {
      setPlansLoading(true);
      try {
        const resp = await api<{
          plans: { name: string; service: string; path: string }[];
        }>("/api/lua/plans?q=&service=");
        const byId = new Map<string, PlanNameOption>();
        for (const p of resp.plans || []) {
          if (!p.name || byId.has(p.name)) continue;
          byId.set(p.name, {
            id: p.name,
            hint: p.service,
            source: "lua",
          });
        }
        setPlanOptions((prev) => {
          const merged = new Map(byId);
          for (const o of prev) {
            if (!merged.has(o.id)) merged.set(o.id, o);
            else if (o.source === "oe") {
              const cur = merged.get(o.id)!;
              merged.set(o.id, {
                ...cur,
                source: "oe",
                hint: o.hint || cur.hint,
              });
            }
          }
          return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
        });
      } catch {
        /* lua_root missing — OE get_plans may still fill the list */
      } finally {
        setPlansLoading(false);
      }
    })();
  }, []);

  const ensureToken = useCallback(async () => {
    let t = token.trim();
    if (t) return t;
    t = await getServiceToken(host.trim(), operator.trim());
    setToken(t);
    return t;
  }, [host, operator, token]);

  // Merge deployed OE plan_ids when host/token ready
  const refreshOePlanNames = useCallback(async () => {
    if (!host.trim()) return;
    try {
      const t = await ensureToken();
      const ids = await fetchOePlanIds(host.trim(), t);
      if (!ids.length) return;
      setPlanOptions((prev) => {
        const merged = new Map(prev.map((o) => [o.id, o]));
        for (const id of ids) {
          const existing = merged.get(id);
          merged.set(id, {
            id,
            hint: existing?.hint,
            source: "oe",
          });
        }
        return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
      });
    } catch {
      /* ignore — local lua list is enough for the combobox */
    }
  }, [ensureToken, host]);

  useEffect(() => {
    if (!bootDone || !host.trim()) return;
    void refreshOePlanNames();
  }, [bootDone, host, operator, refreshOePlanNames]);

  const knownPlanIds = useMemo(
    () => planOptions.map((o) => o.id),
    [planOptions],
  );

  const runSearch = useCallback(
    async (override?: { planQuery?: string; executionId?: string }) => {
      const planQ = (override?.planQuery ?? planQuery).trim();
      const execQ = (override?.executionId ?? executionIdQuery).trim();
      setBusy(true);
      setNote(null);
      try {
        const t = await ensureToken();
        void refreshOePlanNames();
        const result = await searchExecutions({
          host,
          token: t,
          planQuery: planQ || undefined,
          executionId: execQ || undefined,
          pageSize: 50,
          knownPlanIds,
        });
        setItems(result.items);
        setNote(result.note || null);
        if (!result.items.length) {
          toast.message("No executions found");
        } else if (result.items.length === 1 && execQ) {
          setSelectedId(result.items[0].executionId);
        }
        const qs = new URLSearchParams();
        if (execQ) qs.set("execution_id", execQ);
        else if (planQ) qs.set("plan_id", planQ);
        router.replace(qs.toString() ? `/details?${qs}` : "/details");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setItems([]);
      } finally {
        setBusy(false);
      }
    },
    [
      ensureToken,
      executionIdQuery,
      host,
      knownPlanIds,
      planQuery,
      refreshOePlanNames,
      router,
    ],
  );

  // Deep-link once: /details?plan_id=… or ?execution_id=…
  useEffect(() => {
    if (!bootDone || !host.trim()) return;
    const plan = searchParams.get("plan_id") || searchParams.get("plan") || "";
    const exec =
      searchParams.get("execution_id") || searchParams.get("execution") || "";
    if (!plan && !exec) return;
    if (plan) setPlanQuery(plan);
    if (exec) setExecutionIdQuery(exec);
    void runSearch({ planQuery: plan, executionId: exec });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone, host]);

  const loadBundle = useCallback(
    async (executionId: string, opts?: { openModal?: boolean }) => {
      try {
        const t = await ensureToken();
        const b = await fetchExecutionBundle(host.trim(), t, executionId);
        setBundle(b);
        setSelectedId(executionId);
        if (opts?.openModal) setModalOpen(true);
        return b;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [ensureToken, host],
  );

  useEffect(() => {
    if (!bundle?.executionId) {
      setPolling(false);
      return;
    }
    if (isTerminalStatus(bundle.status)) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const id = window.setInterval(() => {
      void loadBundle(bundle.executionId);
    }, 2500);
    return () => window.clearInterval(id);
  }, [bundle?.executionId, bundle?.status, loadBundle]);

  const operators = useMemo(
    () => settings?.operators || ["pilotfiber"],
    [settings],
  );

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur-md">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Editor
        </Link>
        <div className="mx-1 h-5 w-px bg-border" />
        <div className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <span className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_16px_var(--primary)]" />
          <span className="truncate">OE Plans Details</span>
        </div>
        <span className="text-xs text-muted-foreground">
          Local OE only · plan name or execution_id
        </span>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-hidden p-4">
        <section className="shrink-0 rounded-lg border bg-card/60 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel>Local OE host</FieldLabel>
              <Input
                value={host}
                readOnly
                title="Locked to settings.default_host (local only)"
                className="text-muted-foreground"
              />
            </Field>
            <Field>
              <FieldLabel>operator_name</FieldLabel>
              <select
                className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              >
                {operator && !operators.includes(operator) ? (
                  <option value={operator}>{operator}</option>
                ) : null}
                {operators.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel>Bearer token</FieldLabel>
              <div className="flex min-w-0 gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="paste or fetch"
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={async () => {
                    try {
                      const t = await getServiceToken(
                        host.trim(),
                        operator.trim(),
                      );
                      setToken(t);
                      toast.success("Token fetched");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                  }}
                >
                  Get service token
                </Button>
              </div>
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Field>
              <FieldLabel>
                OE plan name{" "}
                <span className="font-normal text-muted-foreground">
                  ({planOptions.length} in list)
                </span>
              </FieldLabel>
              <PlanNameCombobox
                value={planQuery}
                options={planOptions}
                loading={plansLoading}
                placeholder="Type to filter plan_id…"
                onChange={setPlanQuery}
                onPick={(opt) => {
                  setPlanQuery(opt.id);
                  setExecutionIdQuery("");
                  void runSearch({ planQuery: opt.id, executionId: "" });
                }}
                onEnter={() => void runSearch()}
              />
            </Field>
            <Field>
              <FieldLabel>execution_id</FieldLabel>
              <Input
                value={executionIdQuery}
                onChange={(e) => setExecutionIdQuery(e.target.value)}
                placeholder="paste UUID"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
              />
            </Field>
            <div className="flex items-end">
              <Button
                className="w-full md:w-auto"
                disabled={busy || !host.trim()}
                onClick={() => void runSearch()}
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                ) : (
                  <SearchIcon data-icon="inline-start" />
                )}
                Search
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Plan names come from your local lua repo (and plans already upserted
            on local OE). Search calls only{" "}
            <code>localhost</code> <code>get_executions</code> /{" "}
            <code>get_execution</code> — nothing remote.
          </p>
          {note ? (
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card/40">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Results · {items.length}
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || (!planQuery.trim() && !executionIdQuery.trim())}
              onClick={() => void runSearch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {items.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No results yet. Search by plan name or execution_id.
              </p>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">execution_id</th>
                    <th className="px-3 py-2 font-medium">last_state</th>
                    <th className="px-3 py-2 font-medium">started</th>
                    <th className="px-3 py-2 font-medium">finished</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const active = row.executionId === selectedId;
                    return (
                      <tr
                        key={row.executionId}
                        className={cn(
                          "cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40",
                          active && "bg-accent/40",
                        )}
                        onClick={() => {
                          void loadBundle(row.executionId, { openModal: true });
                        }}
                      >
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(row.status)}
                          >
                            {row.status || "—"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.planId || "—"}
                        </td>
                        <td
                          className="max-w-[14rem] truncate px-3 py-2 font-mono text-[11px] text-muted-foreground"
                          title={row.executionId}
                        >
                          {row.executionId}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.lastState || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {formatEpoch(row.startedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {formatEpoch(row.finishedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <ExecutionModal
        open={modalOpen && !!bundle}
        onOpenChange={setModalOpen}
        bundle={bundle}
        planOrder={[]}
        planVersion={null}
        openPlanId={null}
        host={host.trim()}
        token={token.trim() || null}
        polling={polling}
        onRefresh={() => {
          if (bundle?.executionId) void loadBundle(bundle.executionId);
        }}
        onAfterAction={() => {
          if (bundle?.executionId) void loadBundle(bundle.executionId);
        }}
        onLog={() => {
          /* details page has no run log */
        }}
      />
    </div>
  );
}
