"use client";

import { TYPE_COLORS } from "@/lib/plan/colors";
import { humanizeId } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "./TypeBadge";
import { cn } from "@/lib/utils";
import type { OePlan, ValidationResult } from "@/lib/plan/types";

export type EditorSidebarProps = {
  className?: string;
  plan: OePlan;
  order: string[];
  map: Record<string, Record<string, unknown>>;
  selected: string | null;
  validation: ValidationResult | null;
  sideTab: "states" | "palette";
  paletteQuery: string;
  planOwners: string[];
  filteredTypes: { id: string; label: string }[];
  filteredWrappers: { id: string; ref: string; path: string; kind: string }[];
  onSideTab: (tab: "states" | "palette") => void;
  onSelect: (name: string) => void;
  onPlanMeta: (patch: Partial<OePlan>) => void;
  onPaletteQuery: (q: string) => void;
  onAddType: (type: string) => void;
  onAddWrapper: (ref: string) => void;
  inferType: (state: Record<string, unknown>) => string;
};

export function EditorSidebar({
  className,
  plan,
  order,
  map,
  selected,
  validation,
  sideTab,
  paletteQuery,
  planOwners,
  filteredTypes,
  filteredWrappers,
  onSideTab,
  onSelect,
  onPlanMeta,
  onPaletteQuery,
  onAddType,
  onAddWrapper,
  inferType,
}: EditorSidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden border-r bg-sidebar p-3 text-sidebar-foreground",
        className,
      )}
    >
      <Tabs
        value={sideTab}
        onValueChange={(v) => onSideTab(v as "states" | "palette")}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList className="grid w-full shrink-0 grid-cols-2">
          <TabsTrigger value="states">Outline</TabsTrigger>
          <TabsTrigger value="palette">Palette</TabsTrigger>
        </TabsList>

        <TabsContent
          value="states"
          className="mt-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden data-[hidden]:hidden"
        >
          <Card size="sm" className="shrink-0 overflow-hidden">
            <CardContent className="flex flex-col gap-3 p-3">
              <Field className="min-w-0">
                <FieldLabel>plan_id</FieldLabel>
                <Input
                  className="min-w-0"
                  value={plan.plan_id || ""}
                  onChange={(e) =>
                    onPlanMeta({
                      plan_id: e.target.value,
                      name: e.target.value || plan.name,
                    })
                  }
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel>owner</FieldLabel>
                <Select
                  value={plan.plan_owner || ""}
                  onValueChange={(value) => {
                    if (typeof value === "string") {
                      onPlanMeta({ plan_owner: value });
                    }
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Select team…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {plan.plan_owner &&
                      !planOwners.includes(plan.plan_owner) ? (
                        <SelectItem value={plan.plan_owner}>
                          {plan.plan_owner}
                        </SelectItem>
                      ) : null}
                      {planOwners.map((owner) => (
                        <SelectItem key={owner} value={owner}>
                          {owner}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0">
                <FieldLabel>start_at</FieldLabel>
                <Select
                  value={plan.start_at || ""}
                  onValueChange={(value) => {
                    if (typeof value === "string") onPlanMeta({ start_at: value });
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {order.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={!!plan.is_default}
                  onCheckedChange={(checked) =>
                    onPlanMeta({ is_default: checked === true })
                  }
                />
                is_default
              </label>
            </CardContent>
          </Card>

          <div className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            States
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="flex min-w-0 flex-col gap-1">
              {order.map((name) => {
                const state = map[name] || {};
                const type = inferType(state);
                const badgeLabel =
                  type === "ref" && state.ref != null
                    ? String(state.ref)
                    : type;
                const issues = validation?.byState?.[name] || [];
                const hasErr = issues.some((i) => i.level === "error");
                const hasWarn = !hasErr && issues.length > 0;
                return (
                  <Button
                    key={name}
                    type="button"
                    variant={selected === name ? "secondary" : "ghost"}
                    className={cn(
                      "h-auto w-full min-w-0 flex-col items-start gap-1 px-2.5 py-2",
                      hasErr && "border border-destructive/50",
                      hasWarn && "border border-warn/50",
                    )}
                    onClick={() => onSelect(name)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      {(hasErr || hasWarn) && (
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            hasErr ? "bg-destructive" : "bg-warn",
                          )}
                        />
                      )}
                      <span className="truncate">
                        {name}
                        {name === plan.start_at ? " ★" : ""}
                      </span>
                    </span>
                    <TypeBadge type={type} label={badgeLabel} />
                  </Button>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="palette"
          className="mt-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden data-[hidden]:hidden"
        >
          <p className="shrink-0 text-xs text-muted-foreground">
            Click to add on the canvas. Or right-click a node → New state after.
          </p>
          <Field className="min-w-0 shrink-0">
            <FieldLabel>Search</FieldLabel>
            <Input
              className="min-w-0"
              type="search"
              value={paletteQuery}
              onChange={(e) => onPaletteQuery(e.target.value)}
              placeholder="task, callback, run plan…"
            />
          </Field>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Types ({filteredTypes.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filteredTypes.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="xs"
                    variant="outline"
                    title={t.id}
                    onClick={() => onAddType(t.id)}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{
                        background: TYPE_COLORS[t.id] || TYPE_COLORS.unknown,
                      }}
                    />
                    {t.label || humanizeId(t.id)}
                  </Button>
                ))}
              </div>
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Wrappers ({filteredWrappers.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(paletteQuery
                  ? filteredWrappers
                  : filteredWrappers.slice(0, 48)
                ).map((w) => (
                  <Button
                    key={w.id}
                    type="button"
                    size="xs"
                    variant="outline"
                    className="border-dashed"
                    title={`${w.ref}${w.path ? `\n${w.path}` : ""}`}
                    onClick={() => onAddWrapper(w.ref || `#.${w.id}`)}
                  >
                    {humanizeId(w.id)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
