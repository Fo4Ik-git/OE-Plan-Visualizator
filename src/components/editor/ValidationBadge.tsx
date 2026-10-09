"use client";

import { Badge } from "@/components/ui/badge";
import type { ValidationResult } from "@/lib/plan/types";

export function ValidationBadge({
  validation,
  oeCheck,
}: {
  validation: ValidationResult | null;
  oeCheck?: string | null;
}) {
  if (!validation) {
    return (
      <Badge variant="secondary" title="No plan">
        —
      </Badge>
    );
  }

  const oeOk = oeCheck === "OK";
  const oeFail = !!oeCheck && oeCheck !== "OK";
  const title =
    validation.errors.map((e) => e.message).join("\n") +
    (oeCheck ? `\n\nOE check: ${oeCheck}` : "");

  if (oeFail) {
    return (
      <Badge variant="destructive" title={title}>
        OE fail
        {validation.errorCount ? ` · ${validation.errorCount}` : ""}
      </Badge>
    );
  }

  if (validation.valid && validation.warnCount === 0) {
    return (
      <Badge
        variant="outline"
        className="border-success/50 text-success"
        title={title || "No structural errors"}
      >
        {oeOk ? "OE OK" : "Valid"}
      </Badge>
    );
  }
  if (validation.valid) {
    return (
      <Badge
        variant="outline"
        className="border-warn/50 text-warn"
        title={title}
      >
        {oeOk ? "OE OK" : "Valid"} · {validation.warnCount} warn
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" title={title}>
      Invalid · {validation.errorCount}
    </Badge>
  );
}
