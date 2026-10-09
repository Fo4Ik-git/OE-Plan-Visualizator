import type { StateFieldSchema, StateVariantSchema } from "@/lib/plan/types";

const STATE_LINK_KEYS = new Set([
  "next",
  "default",
  "start_at",
  "on_pause",
  "on_resume",
]);

const CHOICE_OPERATORS = [
  "and",
  "or",
  "not",
  "is_nil",
  "is_number",
  "is_string",
  "is_empty",
  "is_boolean",
  "boolean_equals",
  "numeric_equals",
  "numeric_less_than",
  "numeric_less_than_equals",
  "numeric_greater_than",
  "numeric_greater_than_equals",
  "string_equals",
  "string_less_than",
  "string_less_than_equals",
  "string_greater_than",
  "string_greater_than_equals",
  "string_contains",
  "timestamp_equals",
  "timestamp_less_than",
  "timestamp_less_than_equals",
  "timestamp_greater_than",
  "timestamp_greater_than_equals",
] as const;

function schemaForRef(ref: string | null | undefined, type: string | null | undefined): Record<string, unknown> {
  const r = ref || "";
  const t = type || "";
  if (t === "boolean" || /boolean/i.test(r)) return { type: "boolean" };
  if (t === "integer" || /integer/i.test(r)) return { type: ["integer", "string"] };
  if (t === "number" || /number/i.test(r)) return { type: ["number", "string"] };
  if (t === "array" || /_array|array$/i.test(r)) return { type: "array", items: {} };
  if (
    t === "object" ||
    /object|api_config|retry_schema|catch_schema|pause_schema|lock_config|set_execution_variables|visibility|comments|skip_scenarios|inject|values_paths_lambda_object/i.test(
      r,
    )
  ) {
    return { type: "object", additionalProperties: true };
  }
  return { type: "string" };
}

function stateNameSchema(stateNames: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: "string",
    description: "Name of another state in this plan",
  };
  if (stateNames.length) {
    base.enum = stateNames;
  }
  return base;
}

function choiceItemSchema(stateNames: string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {
    variable: {
      type: "string",
      description: "JSON path / lambda, e.g. $.flag",
    },
    next: stateNameSchema(stateNames),
    inject: { type: ["object", "array"] },
    comments: { type: ["string", "object", "array"] },
    alarm_severity: { type: "string" },
  };
  for (const op of CHOICE_OPERATORS) {
    props[op] = {
      description: `Condition operator (${op})`,
    };
  }
  return {
    type: "object",
    properties: props,
    required: ["next"],
    additionalProperties: true,
  };
}

function propertySchema(
  field: StateFieldSchema,
  stateNames: string[],
): Record<string, unknown> {
  const name = field.name;
  if (STATE_LINK_KEYS.has(name)) {
    return stateNameSchema(stateNames);
  }
  if (name === "type") {
    return {
      type: "string",
      description: "OE state type",
    };
  }
  if (name === "choices") {
    return {
      type: "array",
      description: "Choice branches",
      items: choiceItemSchema(stateNames),
    };
  }
  if (name === "catch") {
    return {
      type: "array",
      items: {
        type: "object",
        properties: {
          next: stateNameSchema(stateNames),
          variable: { type: "string" },
        },
        additionalProperties: true,
      },
    };
  }
  if (name === "api_config") {
    return {
      type: "object",
      properties: {
        uri: { type: "string" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        },
        timeout_ms: { type: "integer" },
      },
      additionalProperties: true,
    };
  }
  if (name === "foreach") {
    return {
      type: ["object", "array", "string"],
      description: "Loop foreach (object with items/item, path, or lambda)",
      properties: {
        items: { type: "string" },
        item: { type: "string" },
        next: stateNameSchema(stateNames),
      },
      additionalProperties: true,
    };
  }
  if (name === "while") {
    return {
      type: "array",
      description: "Loop while conditions",
      items: choiceItemSchema(stateNames),
    };
  }
  if (name === "end") {
    return { type: "boolean" };
  }

  const base = schemaForRef(field.ref, field.type);
  const shortRef = field.ref ? field.ref.replace("#/definitions/", "") : "";
  base.description = [
    field.required ? "required" : "optional",
    shortRef,
  ]
    .filter(Boolean)
    .join(" · ");
  return base;
}

export type StateEditorSchemaInput = {
  stateType: string;
  fields: StateFieldSchema[];
  variants?: StateVariantSchema[];
  stateNames: string[];
  /** Distinct `stage` values already used in the plan. */
  stageNames?: string[];
};

/**
 * JSON Schema for Monaco autocomplete / validation in the state inspector.
 * Not a full OE validator — enough for property + next-target suggestions.
 */
export function buildStateEditorJsonSchema(
  input: StateEditorSchemaInput,
): Record<string, unknown> {
  const { stateType, fields, variants = [], stateNames, stageNames = [] } = input;
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.name === "stage" && stageNames.length) {
      properties.stage = {
        type: "string",
        description: "Plan stage name",
        enum: stageNames,
      };
      continue;
    }
    properties[field.name] = propertySchema(field, stateNames);
  }
  // Always allow common link keys even if parser missed them
  for (const key of STATE_LINK_KEYS) {
    if (!properties[key]) properties[key] = stateNameSchema(stateNames);
  }
  if (!properties.stage && stageNames.length) {
    properties.stage = {
      type: "string",
      description: "Plan stage name",
      enum: stageNames,
    };
  }

  const required =
    variants[0]?.required?.length
      ? variants[0].required
      : fields.filter((f) => f.required).map((f) => f.name);

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `OE ${stateType} state`,
    type: "object",
    properties,
    required: required.filter((k) => k !== "type" || true),
    additionalProperties: false,
  };
}

export const INSPECTOR_MODEL_PATH = "oe-state-inspector.json";
export const INSPECTOR_SCHEMA_URI = "oe://schemas/state-inspector.json";
