import type { OePlan } from "@/lib/plan/types";
import { isWatchableLuaPath } from "@/lib/paths";

const SESSION_KEY = "oe-plan-creator:session-v1";

export type EditorSession =
  | {
      v: 1;
      kind: "file";
      path: string;
      selected: string | null;
    }
  | {
      v: 1;
      kind: "draft";
      plan: OePlan;
      selected: string | null;
    };

export function loadSession(): EditorSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as EditorSession;
    if (!data || data.v !== 1) return null;
    if (data.kind === "file") {
      if (!isWatchableLuaPath(data.path)) return null;
      return data;
    }
    if (data.kind === "draft" && data.plan && typeof data.plan === "object") {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: EditorSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function buildSession(input: {
  plan: OePlan;
  filePath: string | null;
  selected: string | null;
}): EditorSession {
  if (isWatchableLuaPath(input.filePath)) {
    return {
      v: 1,
      kind: "file",
      path: input.filePath,
      selected: input.selected,
    };
  }
  return {
    v: 1,
    kind: "draft",
    plan: input.plan,
    selected: input.selected,
  };
}
