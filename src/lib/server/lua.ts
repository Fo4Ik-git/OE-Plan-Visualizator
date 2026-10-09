import { promises as fs, type Dirent } from "fs";
import path from "path";
import { loadSettings } from "./settings";
import { resolveRefs } from "./resolve";

export async function luaRoot(): Promise<string> {
  const settings = await loadSettings();
  const root = path.resolve(settings.lua_root.replace(/^~/, process.env.HOME || ""));
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error(`lua_root is not a directory: ${root}`);
  } catch {
    throw new Error(`lua_root does not exist: ${root}`);
  }
  return root;
}

export function orchestrationplanRoot(root: string): string {
  return path.join(root, "services_root", "services", "orchestrationplan");
}

export function safeUnder(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) {
    throw new Error("path escapes root");
  }
  return target;
}

export async function listPlanServices(root: string): Promise<string[]> {
  const servicesDir = path.join(root, "services_root", "services");
  try {
    const entries = await fs.readdir(servicesDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const plans = await fs.stat(path.join(servicesDir, entry.name, "common", "plans"));
        if (plans.isDirectory()) names.push(entry.name);
      } catch {
        /* skip */
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function walkJsonPlans(
  dir: string,
  root: string,
  service: string,
  queryL: string,
  results: { path: string; name: string; service: string }[],
  limit: number,
): Promise<void> {
  if (results.length >= limit) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonPlans(full, root, service, queryL, results, limit);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const rel = path.relative(root, full);
      const stem = entry.name.replace(/\.json$/i, "");
      if (
        queryL &&
        !rel.toLowerCase().includes(queryL) &&
        !stem.toLowerCase().includes(queryL)
      ) {
        continue;
      }
      results.push({ path: rel, name: stem, service });
    }
  }
}

export async function listPlanFiles(
  query = "",
  service = "",
  limit = 500,
): Promise<{ path: string; name: string; service: string }[]> {
  const root = await luaRoot();
  const queryL = query.toLowerCase().trim();
  let serviceF = service.trim();
  if (serviceF.toLowerCase() === "all") serviceF = "";

  const servicesDir = path.join(root, "services_root", "services");
  let serviceEntries;
  try {
    serviceEntries = await fs.readdir(servicesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: { path: string; name: string; service: string }[] = [];
  const sorted = serviceEntries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sorted) {
    if (results.length >= limit) break;
    if (serviceF && entry.name !== serviceF) continue;
    const plansDir = path.join(servicesDir, entry.name, "common", "plans");
    try {
      const st = await fs.stat(plansDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    await walkJsonPlans(plansDir, root, entry.name, queryL, results, limit);
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadTemplateCatalog(
  root?: string,
): Promise<Record<string, unknown>> {
  const lua = root || (await luaRoot());
  const templatesDir = path.join(orchestrationplanRoot(lua), "common", "templates");
  const catalog: Record<string, unknown> = {};
  try {
    await walkTemplates(templatesDir, catalog);
  } catch {
    /* empty */
  }
  return catalog;
}

async function walkTemplates(
  dir: string,
  catalog: Record<string, unknown>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTemplates(full, catalog);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        const data = JSON.parse(await fs.readFile(full, "utf8")) as {
          name?: string;
          content?: unknown;
        };
        const name = data.name || entry.name.replace(/\.json$/i, "");
        const content = data.content ?? data;
        catalog[name] = content;
        catalog[`#.${name}`] = content;
      } catch {
        /* skip bad json */
      }
    }
  }
}

export async function resolvePlanJson(plan: unknown): Promise<unknown> {
  const catalog = await loadTemplateCatalog();
  return resolveRefs(plan, catalog);
}

/** Collect `*-team` directory names under a root (shallow recursive). */
async function collectTeamDirs(
  dir: string,
  into: Set<string>,
  depth = 0,
): Promise<void> {
  if (depth > 4) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith("-team")) {
      into.add(entry.name);
    }
    // Operators/<Op>/<team>-team nesting
    if (depth < 3) {
      await collectTeamDirs(path.join(dir, entry.name), into, depth + 1);
    }
  }
}

async function collectOwnersFromPlans(
  dir: string,
  into: Set<string>,
  limit: number,
): Promise<void> {
  if (into.size >= limit) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (into.size >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectOwnersFromPlans(full, into, limit);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        const data = JSON.parse(await fs.readFile(full, "utf8")) as {
          plan_owner?: unknown;
        };
        if (typeof data.plan_owner === "string" && data.plan_owner.trim()) {
          into.add(data.plan_owner.trim());
        }
      } catch {
        /* skip */
      }
    }
  }
}

/**
 * Plan owners = it_bruno/e2e `*-team` folders (canonical enumeration)
 * plus distinct `plan_owner` values found in plan JSON under services.
 */
export async function listPlanOwners(): Promise<string[]> {
  const root = await luaRoot();
  const owners = new Set<string>();

  await collectTeamDirs(path.join(root, "it_bruno"), owners);
  await collectTeamDirs(path.join(root, "e2e"), owners);

  const servicesDir = path.join(root, "services_root", "services");
  let serviceEntries: Dirent[] = [];
  try {
    serviceEntries = await fs.readdir(servicesDir, { withFileTypes: true });
  } catch {
    serviceEntries = [];
  }
  for (const entry of serviceEntries) {
    if (!entry.isDirectory()) continue;
    const plansDir = path.join(servicesDir, entry.name, "common", "plans");
    await collectOwnersFromPlans(plansDir, owners, 200);
  }

  return [...owners].sort((a, b) => a.localeCompare(b));
}
