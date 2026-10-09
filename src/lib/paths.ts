/** Repo-relative paths from "Open from lua"; browser File picks are not watchable. */
export function isWatchableLuaPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.includes("/") && !path.includes("\\")) return false;
  return path.endsWith(".json");
}
