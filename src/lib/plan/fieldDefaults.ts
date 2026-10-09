import type { StateFieldSchema } from "@/lib/plan/types";

/** Sample value for a state field when scaffolding or adding from Available fields. */
export function defaultValueForField(
  name: string,
  field?: Pick<StateFieldSchema, "ref" | "type"> | null,
): unknown {
  switch (name) {
    case "type":
      return undefined;
    case "end":
      return true;
    case "api_config":
      return { uri: "/api/v3/example", method: "POST", timeout_ms: 10000 };
    case "headers":
    case "body":
    case "data":
    case "params":
    case "inject":
    case "response_definition":
    case "execution_plans":
      return {};
    case "events":
      return [{}];
    case "choices":
      return [{ variable: "$.flag", boolean_equals: true, next: "" }];
    case "foreach":
      return { items: "$.items", item: "item" };
    case "while":
      return [{ variable: "$.continue", boolean_equals: true }];
    case "until":
      return "${ return ngx.time() + 60; }";
    case "delay":
      return 1;
    case "lambda_code":
      return "${ return $.input; }";
    case "result_path":
      return "$.result";
    case "message_queue_type":
      return "kafka";
    case "topic":
      return "example_topic";
    case "action_type":
      return "SCHEDULE";
    case "depends_on":
      return { correlation_ids: [] };
    case "correlation_ids":
      return [];
    case "validation_schema":
      return { type: "object", properties: {} };
    case "not_retryable":
    case "persist_execution_variables_before_child":
      return false;
    default:
      break;
  }

  const ref = field?.ref || "";
  const typ = field?.type || "";
  if (typ === "boolean" || /boolean/i.test(ref)) return false;
  if (typ === "integer" || typ === "number" || /integer|number/i.test(ref)) return 0;
  if (typ === "array" || /_array|array$/i.test(ref)) return [];
  if (typ === "object" || /object/i.test(ref)) return {};
  return "";
}
