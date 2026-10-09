/** Context-aware OE suggest: state / stage / variable paths. */

export const STATE_LINK_FIELDS = [
  "next",
  "default",
  "start_at",
  "on_pause",
  "on_resume",
] as const;

export const VARIABLE_PATH_FIELDS = [
  "variable",
  "result_path",
  "items",
  "item",
] as const;

const OE_ROOT_PATHS = [
  "$.",
  "$.input",
  "$.result",
  "$.error",
  "$.output",
  "$.callback",
  "$.constants",
  "$.enums",
  "$.config",
  "$.self",
  "$.run",
] as const;

export type SuggestFieldKind = "state" | "stage" | "variable";

export type SuggestHit = {
  kind: SuggestFieldKind;
  field: string;
  /** Text already typed inside the quotes (may be empty). */
  prefix: string;
  /** Column where the string value content starts (1-based, inside quotes). */
  valueStartColumn: number;
};

export type SuggestLists = {
  stateNames?: string[];
  stageNames?: string[];
  variablePaths?: string[];
};

export type SuggestItem = {
  value: string;
  detail: SuggestFieldKind;
};

function valueStart(linePrefix: string, prefix: string): number {
  return linePrefix.length - prefix.length + 1;
}

/**
 * Cursor is inside a JSON string value for a known OE field.
 * `linePrefix` = line content up to (not including) the cursor.
 */
export function detectSuggestContext(linePrefix: string): SuggestHit | null {
  const linkRe = new RegExp(
    `"(${STATE_LINK_FIELDS.join("|")})"\\s*:\\s*"([^"]*)$`,
  );
  const link = linePrefix.match(linkRe);
  if (link) {
    const prefix = link[2] ?? "";
    return {
      kind: "state",
      field: link[1],
      prefix,
      valueStartColumn: valueStart(linePrefix, prefix),
    };
  }

  const stage = linePrefix.match(/"stage"\s*:\s*"([^"]*)$/);
  if (stage) {
    const prefix = stage[1] ?? "";
    return {
      kind: "stage",
      field: "stage",
      prefix,
      valueStartColumn: valueStart(linePrefix, prefix),
    };
  }

  const varRe = new RegExp(
    `"(${VARIABLE_PATH_FIELDS.join("|")})"\\s*:\\s*"([^"]*)$`,
  );
  const varHit = linePrefix.match(varRe);
  if (varHit) {
    const prefix = varHit[2] ?? "";
    return {
      kind: "variable",
      field: varHit[1],
      prefix,
      valueStartColumn: valueStart(linePrefix, prefix),
    };
  }

  const anyString = linePrefix.match(/"([^"]+)"\s*:\s*"([^"]*)$/);
  if (anyString) {
    const prefix = anyString[2] ?? "";
    if (prefix.startsWith("$")) {
      return {
        kind: "variable",
        field: anyString[1],
        prefix,
        valueStartColumn: valueStart(linePrefix, prefix),
      };
    }
  }

  return null;
}

/** Exclusive end column of the string value (at closing `"` or at cursor). */
export function stringValueEndColumn(
  fullLine: string,
  cursorColumn: number,
): number {
  // cursorColumn is 1-based; look for closing quote after cursor
  const after = fullLine.slice(cursorColumn - 1);
  const close = after.indexOf('"');
  if (close >= 0) return cursorColumn + close;
  return cursorColumn;
}

export function filterNames(names: string[], prefix: string): string[] {
  if (!prefix) return names.slice(0, 80);
  const p = prefix.toLowerCase();
  const starts = names.filter((n) => n.toLowerCase().startsWith(p));
  const mid = names.filter(
    (n) => !n.toLowerCase().startsWith(p) && n.toLowerCase().includes(p),
  );
  return starts.concat(mid).slice(0, 80);
}

export function filterPaths(paths: string[], prefix: string): string[] {
  if (!prefix) return paths.slice(0, 80);
  if (prefix === "$") {
    return paths.filter((n) => n.startsWith("$")).slice(0, 80);
  }
  const starts = paths.filter((n) => n.startsWith(prefix));
  const mid = paths.filter((n) => !n.startsWith(prefix) && n.includes(prefix));
  return starts.concat(mid).slice(0, 80);
}

export function itemsForHit(
  hit: SuggestHit,
  lists: SuggestLists,
): SuggestItem[] {
  if (hit.kind === "variable") {
    return filterPaths(lists.variablePaths || [], hit.prefix).map((value) => ({
      value,
      detail: "variable" as const,
    }));
  }
  if (hit.kind === "stage") {
    return filterNames(lists.stageNames || [], hit.prefix).map((value) => ({
      value,
      detail: "stage" as const,
    }));
  }
  return filterNames(lists.stateNames || [], hit.prefix).map((value) => ({
    value,
    detail: "state" as const,
  }));
}

const PATH_IN_PLAN_RE =
  /\$\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]*\])*/g;

export function collectVariablePaths(plan: {
  input_validation_schema?: { properties?: Record<string, unknown> };
  states?: unknown;
} | null): string[] {
  const set = new Set<string>(OE_ROOT_PATHS);

  const props = plan?.input_validation_schema?.properties;
  if (props && typeof props === "object") {
    for (const key of Object.keys(props)) {
      if (!key) continue;
      set.add(`$.${key}`);
      set.add(`$.input.${key}`);
    }
  }

  try {
    const blob = JSON.stringify(plan?.states ?? {});
    let m: RegExpExecArray | null;
    PATH_IN_PLAN_RE.lastIndex = 0;
    while ((m = PATH_IN_PLAN_RE.exec(blob))) {
      set.add(m[0]);
    }
  } catch {
    /* ignore */
  }

  return [...set].sort((a, b) => {
    if (a === "$.") return -1;
    if (b === "$.") return 1;
    return a.localeCompare(b);
  });
}
