/** Extract top-level properties / required from OE state validator Lua tables. */

export type StateFieldSchema = {
  name: string;
  ref?: string | null;
  type?: string | null;
  /** Required in the preferred (first) variant. */
  required: boolean;
  /** oneOf variant indexes that declare this field (0-based). */
  variants: number[];
};

export type StateVariantSchema = {
  required: string[];
  fields: string[];
};

export type ParsedStateValidator = {
  required: string[];
  fields: StateFieldSchema[];
  variants: StateVariantSchema[];
};

function extractBraceBlock(text: string, openBraceIdx: number): string | null {
  if (openBraceIdx < 0 || text[openBraceIdx] !== "{") return null;
  let depth = 0;
  let inStr: string | null = null;
  let escape = false;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openBraceIdx, i + 1);
    }
  }
  return null;
}

/** Find `key = { ... }` only among top-level keys of a `{ ... }` table. */
function findTopLevelKeyTable(table: string, key: string): string | null {
  if (!table.startsWith("{")) return null;
  const inner = table.slice(1, -1);
  let depth = 0;
  let inStr: string | null = null;
  let escape = false;
  let i = 0;
  const keyRes = [
    new RegExp(`^${key}\\s*=\\s*\\{`),
    new RegExp(`^\\[\\s*["']${key}["']\\s*\\]\\s*=\\s*\\{`),
  ];

  while (i < inner.length) {
    const ch = inner[i];
    if (inStr) {
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      continue;
    }
    if (depth !== 0) {
      i++;
      continue;
    }

    const slice = inner.slice(i);
    for (const re of keyRes) {
      const m = slice.match(re);
      if (!m) continue;
      const brace = i + m[0].length - 1;
      return extractBraceBlock(inner, brace);
    }
    i++;
  }
  return null;
}

function splitTopLevelObjects(arrayTable: string): string[] {
  const inner = arrayTable.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr: string | null = null;
  let escape = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(inner.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function parseRequiredList(requiredTable: string | null): string[] {
  if (!requiredTable) return [];
  const names: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(requiredTable))) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

type RawField = { name: string; ref: string | null; type: string | null };

/** Skip a Lua value starting at `i` (table, call, string, bare). Returns end index. */
function skipValue(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return i;

  if (text[i] === "{") {
    const block = extractBraceBlock(text, i);
    return block ? i + block.length : text.length;
  }

  if (text[i] === '"' || text[i] === "'") {
    const q = text[i];
    i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === q) return i + 1;
      i++;
    }
    return i;
  }

  // identifier / call / number / expression — track () and {}
  let depthBrace = 0;
  let depthParen = 0;
  let inStr: string | null = null;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") depthBrace++;
    else if (ch === "}") {
      if (depthBrace === 0 && depthParen === 0) break;
      depthBrace--;
    } else if (ch === "(") depthParen++;
    else if (ch === ")") {
      if (depthParen === 0 && depthBrace === 0) break;
      depthParen--;
    } else if ((ch === "," || ch === "\n") && depthBrace === 0 && depthParen === 0) {
      break;
    }
    i++;
  }
  return i;
}

function parsePropertiesTable(propsTable: string | null): RawField[] {
  if (!propsTable) return [];
  const inner = propsTable.slice(1, -1);
  const fields: RawField[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let escape = false;
  let i = 0;

  while (i < inner.length) {
    const ch = inner[i];
    if (inStr) {
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      continue;
    }

    if (depth !== 0) {
      i++;
      continue;
    }

    const slice = inner.slice(i);
    const keyMatch = slice.match(/^(?:\[(["'])([^"']+)\1\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*/);
    if (!keyMatch) {
      i++;
      continue;
    }
    const name = keyMatch[2] || keyMatch[3];
    i += keyMatch[0].length;
    const valueStart = i;
    i = skipValue(inner, i);
    const valueText = inner.slice(valueStart, i).trim();

    const refMatch =
      valueText.match(/\["\$ref"\]\s*=\s*["']([^"']+)["']/) ||
      valueText.match(/\$ref\s*=\s*["']([^"']+)["']/);
    // only direct type = "…" at first level of a property value table
    let type: string | null = null;
    if (valueText.startsWith("{")) {
      const typeM = valueText.match(/^\{\s*type\s*=\s*["']([^"']+)["']/);
      if (typeM) type = typeM[1];
    } else {
      const typeM = valueText.match(/\btype\s*=\s*["']([^"']+)["']/);
      if (typeM && !valueText.includes("enrich")) type = typeM[1];
    }

    if (name && !fields.some((f) => f.name === name)) {
      fields.push({
        name,
        ref: refMatch ? refMatch[1] : null,
        type,
      });
    }
  }

  return fields;
}

function parseObjectSchema(table: string): { required: string[]; fields: RawField[] } {
  return {
    required: parseRequiredList(findTopLevelKeyTable(table, "required")),
    fields: parsePropertiesTable(findTopLevelKeyTable(table, "properties")),
  };
}

function mergeFields(
  variants: { required: string[]; fields: RawField[] }[],
): ParsedStateValidator {
  const preferred = variants[0] || { required: [], fields: [] };
  const byName = new Map<string, StateFieldSchema>();

  variants.forEach((v, vi) => {
    for (const f of v.fields) {
      const existing = byName.get(f.name);
      if (existing) {
        if (!existing.variants.includes(vi)) existing.variants.push(vi);
        if (!existing.ref && f.ref) existing.ref = f.ref;
        if (!existing.type && f.type) existing.type = f.type;
      } else {
        byName.set(f.name, {
          name: f.name,
          ref: f.ref,
          type: f.type,
          required: preferred.required.includes(f.name),
          variants: [vi],
        });
      }
    }
    for (const r of v.required) {
      if (!byName.has(r)) {
        byName.set(r, {
          name: r,
          ref: null,
          type: null,
          required: preferred.required.includes(r),
          variants: [vi],
        });
      } else if (!byName.get(r)!.variants.includes(vi)) {
        byName.get(r)!.variants.push(vi);
      }
    }
  });

  for (const f of byName.values()) {
    f.required = preferred.required.includes(f.name);
  }

  const fields = [...byName.values()].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    required: preferred.required,
    fields,
    variants: variants.map((v) => ({
      required: v.required,
      fields: v.fields.map((f) => f.name),
    })),
  };
}

/**
 * Parse a state_validators/*.lua file into field / required metadata.
 * Prefers the first oneOf branch for required scaffolding.
 */
export function parseLuaStateValidator(luaText: string): ParsedStateValidator {
  const validatorAssign = /local\s+validator\s*=\s*\{/.exec(luaText);
  let root: string | null = null;
  if (validatorAssign) {
    const brace = luaText.indexOf("{", validatorAssign.index);
    root = extractBraceBlock(luaText, brace);
  }

  // RedisExecutor: `local validator = create_validator()` — parse factory return shape
  if (!root) {
    const factory = /local\s+function\s+check_param_schema\s*\(/.exec(luaText);
    const from = factory ? factory.index : luaText.indexOf("properties =");
    if (from >= 0) {
      const slice = luaText.slice(from);
      // build a synthetic object table from the first properties+required pair
      const propsIdx = slice.indexOf("properties =");
      const reqIdx = slice.indexOf("required =");
      if (propsIdx >= 0) {
        const propsBrace = slice.indexOf("{", propsIdx);
        const props = extractBraceBlock(slice, propsBrace);
        let required: string[] = ["type"];
        if (reqIdx >= 0) {
          const reqBrace = slice.indexOf("{", reqIdx);
          required = parseRequiredList(extractBraceBlock(slice, reqBrace));
        }
        return mergeFields([
          {
            required,
            fields: parsePropertiesTable(props),
          },
        ]);
      }
    }
    return { required: ["type"], fields: [], variants: [{ required: ["type"], fields: [] }] };
  }

  const oneOf = findTopLevelKeyTable(root, "oneOf");
  if (oneOf) {
    const objs = splitTopLevelObjects(oneOf).filter(
      (o) => findTopLevelKeyTable(o, "properties") || findTopLevelKeyTable(o, "required"),
    );
    if (objs.length > 0) {
      return mergeFields(objs.map(parseObjectSchema));
    }
  }

  return mergeFields([parseObjectSchema(root)]);
}
