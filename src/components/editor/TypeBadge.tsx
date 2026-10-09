"use client";

import { Badge } from "@/components/ui/badge";
import { TYPE_COLORS } from "@/lib/plan/colors";
import { cn } from "@/lib/utils";

export function TypeBadge({
  type,
  label,
  className,
}: {
  type: string;
  /** Display text; defaults to `type`. Use for refs (`#.schedule_execution`). */
  label?: string;
  className?: string;
}) {
  const text = label || type;
  const color = TYPE_COLORS[type] || TYPE_COLORS.unknown;
  return (
    <Badge
      variant="outline"
      className={cn("max-w-full truncate font-normal", className)}
      style={{ borderColor: color, color }}
      title={text}
    >
      {text}
    </Badge>
  );
}
