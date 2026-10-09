export async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(path, options);
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || resp.statusText);
  }
  return data;
}

export function pretty(obj: unknown): string {
  return JSON.stringify(obj, null, 4);
}

/** JSON Schema fragment we care about for run-input scaffolding. */
export type SampleSchema = {
  type?: string;
  properties?: Record<string, SampleSchema>;
  required?: string[];
  items?: SampleSchema | SampleSchema[];
};

function samplePrimitive(schema: SampleSchema | undefined): unknown {
  const type = schema?.type;
  if (type === "string") return "";
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return null;
}

function sampleArray(schema: SampleSchema): unknown[] {
  const items = schema.items;
  const itemSchema = Array.isArray(items) ? items[0] : items;
  if (!itemSchema) return [];
  // Seed one element when the item is an object with required fields
  if (itemSchema.type === "object" || itemSchema.properties) {
    const sample = sampleRequiredObject(itemSchema);
    if (Object.keys(sample).length > 0) return [sample];
    return [];
  }
  return [];
}

/**
 * Build a sample object with only `required` keys.
 * Nested required objects are expanded the same way.
 */
export function sampleRequiredObject(schema: SampleSchema | null | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const out: Record<string, unknown> = {};
  for (const key of required) {
    out[key] = sampleSchemaValue(props[key]);
  }
  return out;
}

function sampleSchemaValue(schema: SampleSchema | undefined): unknown {
  if (!schema || typeof schema !== "object") return null;
  if (schema.type === "object" || schema.properties) {
    return sampleRequiredObject(schema);
  }
  if (schema.type === "array") {
    return sampleArray(schema);
  }
  // oneOf / anyOf — take first branch if present
  const alts = (schema as { oneOf?: SampleSchema[]; anyOf?: SampleSchema[] }).oneOf
    || (schema as { anyOf?: SampleSchema[] }).anyOf;
  if (Array.isArray(alts) && alts[0]) {
    return sampleSchemaValue(alts[0]);
  }
  return samplePrimitive(schema);
}

/**
 * Scaffold run input from `input_validation_schema`:
 * only top-level `required` fields, recursively for nested objects.
 */
export function sampleFromSchema(schema: SampleSchema | null | undefined): Record<string, unknown> {
  return sampleRequiredObject(schema);
}

export function humanizeId(id: string): string {
  return String(id || "")
    .replace(/^#\./, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
