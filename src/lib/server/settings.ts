import { promises as fs } from "fs";
import { SETTINGS_EXAMPLE_PATH, SETTINGS_PATH } from "./paths";

export type AppSettings = {
  lua_root: string;
  default_host: string;
  default_operator: string;
  operators: string[];
  port: number;
};

const DEFAULT_OPERATORS = [
  "pilotfiber",
  "lotusflaretelecom",
  "superflex",
  "dtmace",
  "pnccpalau",
  "smartless",
  "devedge",
  "devedgewholesale",
  "demo",
  "lotusflaredemo",
  "creed",
  "default",
  "testpartnermvno1",
];

const DEFAULTS: AppSettings = {
  lua_root: "",
  default_host: "http://localhost:31880",
  default_operator: "lotusflaretelecom",
  operators: DEFAULT_OPERATORS,
  port: 3000,
};

function normalizeOperators(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.length ? out : [...fallback];
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function loadSettings(): Promise<AppSettings> {
  let data: Record<string, unknown> = {};
  try {
    data = await readJsonFile(SETTINGS_PATH);
  } catch {
    try {
      data = await readJsonFile(SETTINGS_EXAMPLE_PATH);
    } catch {
      data = {};
    }
  }
  const operators = normalizeOperators(data.operators, DEFAULTS.operators);
  const defaultOperator =
    typeof data.default_operator === "string" && data.default_operator.trim()
      ? data.default_operator.trim()
      : DEFAULTS.default_operator;
  return {
    ...DEFAULTS,
    ...data,
    default_operator: defaultOperator,
    operators:
      defaultOperator && !operators.includes(defaultOperator)
        ? [defaultOperator, ...operators]
        : operators,
    port: Number(data.port ?? DEFAULTS.port),
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([key]) =>
        ["lua_root", "default_host", "default_operator", "operators", "port"].includes(
          key,
        ),
      ),
    ),
  };
  if (patch.operators !== undefined) {
    next.operators = normalizeOperators(patch.operators, DEFAULTS.operators);
  }
  if (
    next.default_operator &&
    !next.operators.includes(next.default_operator)
  ) {
    next.operators = [next.default_operator, ...next.operators];
  }
  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 4)}\n`, "utf8");
  return next;
}
