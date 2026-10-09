import { promises as fs } from "fs";
import path from "path";
import { SCHEMA_CACHE_PATH } from "./paths";
import { luaRoot, orchestrationplanRoot } from "./lua";
import { parseLuaStateValidator } from "./luaValidatorParse";
import type { SchemaCache, StateTypeSchema } from "@/lib/plan/types";

export type { SchemaCache } from "@/lib/plan/types";

const KNOWN_TYPES = [
  "task",
  "callback",
  "choice",
  "wait",
  "loop",
  "lambda",
  "publish",
  "parallel",
  "redis_executor",
  "wait_for",
  "notify_to",
  "human_task",
  "success",
  "fail",
];

const VALIDATOR_TO_TYPES: Record<string, string[]> = {
  "Task.lua": ["task"],
  "Callback.lua": ["callback"],
  "Choice.lua": ["choice"],
  "Wait.lua": ["wait"],
  "Loop.lua": ["loop"],
  "Lambda.lua": ["lambda"],
  "Publish.lua": ["publish"],
  "Parallel.lua": ["parallel"],
  "RedisExecutor.lua": ["redis_executor"],
  "WaitFor.lua": ["wait_for"],
  "NotifyTo.lua": ["notify_to"],
  "HumanTask.lua": ["human_task"],
  "TerminalState.lua": ["success", "fail"],
};

const BLOCK_KINDS = [
  "state_blocks",
  "catch_blocks",
  "retry_blocks",
  "locking_blocks",
  "pause_blocks",
  "choice_blocks",
] as const;

function extractEnumTypes(luaText: string): string[] {
  const found: string[] = [];
  const re = /enum\s*=\s*\{\s*"([a-z_]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(luaText))) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

function emptyTypeEntry(typeId: string): StateTypeSchema {
  return {
    id: typeId,
    label: typeId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    validator: null,
    required: ["type"],
    fields: [],
    variants: [{ required: ["type"], fields: [] }],
  };
}

async function collectStateTypes(opRoot: string): Promise<StateTypeSchema[]> {
  const validatorsDir = path.join(opRoot, "routes", "validators", "state_validators");
  const byId: Record<string, StateTypeSchema> = {};

  for (const typeId of KNOWN_TYPES) {
    byId[typeId] = emptyTypeEntry(typeId);
  }

  try {
    const files = await fs.readdir(validatorsDir);
    for (const file of files.filter((f) => f.endsWith(".lua")).sort()) {
      const mapped = VALIDATOR_TO_TYPES[file];
      const text = await fs.readFile(path.join(validatorsDir, file), "utf8");
      const enums = extractEnumTypes(text);
      const targets = mapped || enums;
      const parsed = parseLuaStateValidator(text);
      for (const typeId of targets) {
        const entry = byId[typeId] || emptyTypeEntry(typeId);
        entry.validator = file;
        entry.required = parsed.required.length ? parsed.required : ["type"];
        entry.fields = parsed.fields;
        entry.variants = parsed.variants.length
          ? parsed.variants
          : [{ required: entry.required, fields: parsed.fields.map((f) => f.name) }];
        byId[typeId] = entry;
      }
    }
  } catch {
    /* no validators */
  }

  return Object.keys(byId)
    .sort()
    .map((k) => byId[k]);
}

async function collectWrappers(opRoot: string) {
  const templates = path.join(opRoot, "common", "templates");
  const wrappers: {
    id: string;
    ref: string;
    kind: string;
    path: string;
  }[] = [];
  const seen = new Set<string>();

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const parts = full.split(path.sep);
      if (!BLOCK_KINDS.some((k) => parts.includes(k))) continue;
      try {
        const data = JSON.parse(await fs.readFile(full, "utf8")) as {
          name?: string;
        };
        const name = data.name || entry.name.replace(/\.json$/i, "");
        if (seen.has(name)) continue;
        seen.add(name);
        let blockKind = "state_blocks";
        for (const kind of BLOCK_KINDS) {
          if (parts.includes(kind)) {
            blockKind = kind;
            break;
          }
        }
        wrappers.push({
          id: name,
          ref: `#.${name}`,
          kind: blockKind,
          path: path.relative(opRoot, full),
        });
      } catch {
        /* skip */
      }
    }
  }

  await walk(templates);
  return wrappers.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadSchemaCache(): Promise<SchemaCache | null> {
  try {
    const raw = await fs.readFile(SCHEMA_CACHE_PATH, "utf8");
    return JSON.parse(raw) as SchemaCache;
  } catch {
    return null;
  }
}

export async function refreshSchemaCache(): Promise<SchemaCache> {
  const root = await luaRoot();
  const op = orchestrationplanRoot(root);
  let existing: Partial<SchemaCache> = {};
  try {
    existing = JSON.parse(await fs.readFile(SCHEMA_CACHE_PATH, "utf8"));
  } catch {
    /* empty */
  }
  const payload: SchemaCache = {
    generated_at: new Date().toISOString(),
    source: op,
    state_types: await collectStateTypes(op),
    wrappers: await collectWrappers(op),
    plan_fields: existing.plan_fields || [],
  };
  await fs.mkdir(path.dirname(SCHEMA_CACHE_PATH), { recursive: true });
  await fs.writeFile(SCHEMA_CACHE_PATH, `${JSON.stringify(payload, null, 4)}\n`, "utf8");
  return payload;
}
