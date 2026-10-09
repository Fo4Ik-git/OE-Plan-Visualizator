export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PlanState = {
  type?: string;
  name?: string;
  next?: string;
  default?: string;
  end?: boolean;
  ref?: string;
  merge?: Record<string, unknown>;
  choices?: { variable?: string; next?: string; [key: string]: unknown }[];
  catch?: { variable?: string; next?: string; [key: string]: unknown }[];
  api_config?: { uri?: string; method?: string; timeout_ms?: number; [key: string]: unknown };
  headers?: Record<string, unknown>;
  body?: unknown;
  lambda_code?: string;
  message_queue_type?: string;
  topic?: string;
  events?: unknown[];
  foreach?: { items?: string; item?: string; next?: string; [key: string]: unknown };
  while?: { next?: string; [key: string]: unknown };
  execution_plans?: Record<string, { plan_id?: string; [key: string]: unknown }>;
  response_definition?: unknown;
  seconds?: number;
  depends_on?: unknown;
  correlation_ids?: unknown[];
  action_type?: string;
  params?: unknown;
  _auto_next?: boolean;
  _from_ref?: string;
  _unresolved_ref?: boolean;
  [key: string]: unknown;
};

export type OePlan = {
  plan_id?: string;
  name?: string;
  plan_owner?: string;
  is_default?: boolean;
  start_at?: string;
  mapper_ids?: unknown[];
  input_validation_schema?: Record<string, unknown>;
  states?: Record<string, PlanState> | PlanState[];
  [key: string]: unknown;
};

export type PlanEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  labelSlot?: number;
  labelSlots?: number;
  fanSlot?: number;
  fanSlots?: number;
  meta?: Record<string, unknown>;
};

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
  state: string | null;
  path: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  byState: Record<string, ValidationIssue[]>;
  errorCount: number;
  warnCount: number;
};

export type AppSettings = {
  lua_root: string;
  default_host: string;
  default_operator: string;
  /** Dropdown choices for operator_name (Run / Settings). */
  operators: string[];
  port: number;
};

export type StateFieldSchema = {
  name: string;
  ref?: string | null;
  type?: string | null;
  /** Required in the preferred (first) oneOf / top-level variant. */
  required: boolean;
  /** oneOf variant indexes that declare this field (0-based). */
  variants: number[];
};

export type StateVariantSchema = {
  required: string[];
  fields: string[];
};

export type StateTypeSchema = {
  id: string;
  label: string;
  validator: string | null;
  /** Preferred-variant required keys (always scaffolded on create). */
  required: string[];
  fields: StateFieldSchema[];
  variants: StateVariantSchema[];
};

export type SchemaCache = {
  generated_at: string;
  source: string;
  state_types: StateTypeSchema[];
  wrappers: { id: string; ref: string; kind: string; path: string }[];
  plan_fields: unknown[];
};
