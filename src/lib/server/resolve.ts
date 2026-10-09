/* eslint-disable @typescript-eslint/no-explicit-any */

export function deepMerge(base: any, overlay: any): any {
  if (
    base &&
    overlay &&
    typeof base === "object" &&
    typeof overlay === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(overlay)
  ) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      out[key] = key in out ? deepMerge(out[key], value) : value;
    }
    return out;
  }
  return overlay;
}

export function resolveRefs(
  node: any,
  catalog: Record<string, unknown>,
  depth = 0,
): any {
  if (depth > 20) return node;
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, catalog, depth + 1));
  }
  if (!node || typeof node !== "object") return node;

  if (typeof node.ref === "string") {
    const ref = node.ref as string;
    let template = catalog[ref];
    if (template == null && ref.startsWith("#.")) {
      template = catalog[ref.slice(2)];
    }
    if (template == null) {
      return { ...node, _unresolved_ref: true };
    }
    const merged = deepMerge(template, node.merge || {});
    return resolveRefs(merged, catalog, depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = resolveRefs(value, catalog, depth + 1);
  }
  return out;
}
