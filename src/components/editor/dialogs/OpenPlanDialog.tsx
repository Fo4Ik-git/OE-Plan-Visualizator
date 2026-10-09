"use client";

import { AppDialog } from "@/components/editor/AppDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PlanListItem = {
  path: string;
  name: string;
  service: string;
};

export type OpenPlanDialogProps = {
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  services: string[];
  plans: PlanListItem[];
  service: string;
  search: string;
  onServiceChange: (service: string) => void;
  onSearchChange: (search: string) => void;
  onPick: (plan: PlanListItem) => void;
};

export function OpenPlanDialog({
  className,
  open,
  onOpenChange,
  title = "Open plan from lua repo",
  services,
  plans,
  service,
  search,
  onServiceChange,
  onSearchChange,
  onPick,
}: OpenPlanDialogProps) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="wide"
      className={cn("h-[min(85svh,760px)]", className)}
      bodyClassName="min-h-0 overflow-hidden"
    >
      <div className="grid min-w-0 shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <Field className="min-w-0">
          <FieldLabel>Service</FieldLabel>
          <select
            className={cn(
              "flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm",
              "dark:bg-input/30",
            )}
            value={service}
            onChange={(e) => onServiceChange(e.target.value)}
          >
            <option value="all">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field className="min-w-0">
          <FieldLabel>Search</FieldLabel>
          <Input
            className="min-w-0"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="plan_id or path…"
          />
        </Field>
      </div>
      <p className="shrink-0 truncate text-xs text-muted-foreground">
        {plans.length} plan(s) · {service === "all" ? "all services" : service}
      </p>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border">
        <div className="flex min-w-0 flex-col gap-1 p-2">
          {plans.map((p) => (
            <Button
              key={p.path}
              type="button"
              variant="ghost"
              className="h-auto w-full min-w-0 flex-col items-start gap-1 px-2.5 py-2"
              onClick={() => onPick(p)}
            >
              <span className="w-full truncate text-left font-medium">
                {p.name}
              </span>
              <span className="w-full truncate text-left text-xs text-muted-foreground">
                {p.service} · {p.path}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </AppDialog>
  );
}
