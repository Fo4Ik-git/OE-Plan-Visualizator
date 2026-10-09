/** Badge classes for OE execution status: green success, red fail, gray else. */
export function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "SUCCESS") {
    return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (s === "FAILED" || s === "ACTION_FAILED") {
    return "border-transparent bg-red-500/15 text-red-700 dark:text-red-400";
  }
  return "border-transparent bg-muted text-muted-foreground";
}
