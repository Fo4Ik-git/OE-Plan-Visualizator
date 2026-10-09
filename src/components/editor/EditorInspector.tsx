"use client";

import { useMemo } from "react";
import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { JsonEditor } from "@/components/JsonEditor";
import { TypeBadge } from "@/components/editor/TypeBadge";
import {
  buildStateEditorJsonSchema,
  INSPECTOR_MODEL_PATH,
  INSPECTOR_SCHEMA_URI,
} from "@/lib/plan/stateJsonSchema";
import type { StateFieldSchema, StateVariantSchema, ValidationIssue } from "@/lib/plan/types";
import { cn } from "@/lib/utils";

export type EditorInspectorProps = {
  className?: string;
  selected: string | null;
  stateType: string;
  stateRef?: string | null;
  issues: ValidationIssue[];
  nameValue: string;
  jsonValue: string;
  emptyHint?: string;
  title?: string;
  /** Fields from OE state validator (schema-cache). */
  availableFields?: StateFieldSchema[];
  variants?: StateVariantSchema[];
  /** Keys currently present on the state definition. */
  presentKeys?: string[];
  /** Other state names in the plan (for next/default/start_at suggest). */
  stateNames?: string[];
  /** Distinct stage values used across the plan (for "stage" suggest). */
  stageNames?: string[];
  /** OE JSON-paths for variable / result_path suggest (`$.…`). */
  variablePaths?: string[];
  onNameChange: (value: string) => void;
  onNameCommit: () => void;
  onJsonChange: (value: string) => void;
  onJsonFocus?: () => void;
  onJsonBlur?: () => void;
  onAddField?: (fieldName: string) => void;
  onAddAfter: () => void;
  onDelete: () => void;
};

export function EditorInspector({
  className,
  selected,
  stateType,
  stateRef,
  issues,
  nameValue,
  jsonValue,
  emptyHint = "Select a state on the graph or in the list.",
  title = "Inspector",
  availableFields = [],
  variants = [],
  presentKeys = [],
  stateNames = [],
  stageNames = [],
  variablePaths = [],
  onNameChange,
  onNameCommit,
  onJsonChange,
  onJsonFocus,
  onJsonBlur,
  onAddField,
  onAddAfter,
  onDelete,
}: EditorInspectorProps) {
  const present = new Set(presentKeys);
  const optionalMissing = availableFields.filter(
    (f) => !f.required && f.name !== "type" && !present.has(f.name),
  );
  const requiredFields = availableFields.filter((f) => f.required && f.name !== "type");

  const editorSchema = useMemo(() => {
    if (!availableFields.length) return null;
    return buildStateEditorJsonSchema({
      stateType,
      fields: availableFields,
      variants,
      stateNames,
      stageNames,
    });
  }, [availableFields, variants, stateNames, stageNames, stateType]);

  const suggestLists = useMemo(
    () => ({ stateNames, stageNames, variablePaths }),
    [stateNames, stageNames, variablePaths],
  );

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden border-l bg-sidebar p-3 text-sidebar-foreground",
        className,
      )}
    >
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {!selected ? (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <>
          {issues.length > 0 && (
            <Alert variant="destructive" className="max-h-28 shrink-0 overflow-auto">
              <AlertTriangleIcon />
              <AlertTitle>What&apos;s wrong</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                  {issues.map((e, i) => (
                    <li key={i} className="break-words">
                      <span className="uppercase opacity-70">{e.level}</span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Field className="min-w-0 shrink-0">
            <FieldLabel>State</FieldLabel>
            <Input
              className="min-w-0"
              value={nameValue}
              onChange={(e) => onNameChange(e.target.value)}
              onBlur={onNameCommit}
            />
          </Field>
          <div className="flex min-w-0 shrink-0 flex-wrap gap-1.5">
            <TypeBadge type={stateType} />
            {stateRef != null ? <TypeBadge type={`ref ${stateRef}`} /> : null}
          </div>

          {availableFields.length > 0 && (
            <div className="flex max-h-40 min-h-0 shrink-0 flex-col gap-1.5 overflow-hidden">
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Available fields
              </div>
              {variants.length > 1 && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  oneOf:{" "}
                  {variants.map((v, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : ""}
                      {v.required.filter((r) => r !== "type").join("+") || `v${i + 1}`}
                    </span>
                  ))}
                  . Scaffold uses the first variant.
                </p>
              )}
              {requiredFields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {requiredFields.map((f) => (
                    <Badge
                      key={f.name}
                      variant={present.has(f.name) ? "default" : "destructive"}
                      className="font-mono text-[10px]"
                      title={f.ref || f.type || "required"}
                    >
                      {f.name}
                    </Badge>
                  ))}
                </div>
              )}
              {optionalMissing.length > 0 && onAddField ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="flex flex-wrap gap-1">
                    {optionalMissing.map((f) => (
                      <button
                        key={f.name}
                        type="button"
                        className="inline-flex items-center rounded-md border border-dashed border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                        title={
                          f.ref
                            ? `Add ${f.name} (${f.ref.replace("#/definitions/", "")})`
                            : `Add ${f.name}`
                        }
                        onClick={() => onAddField(f.name)}
                      >
                        + {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : optionalMissing.length === 0 && availableFields.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">All optional fields set.</p>
              ) : null}
            </div>
          )}

          <div className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Definition · auto-saves
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <JsonEditor
              value={jsonValue}
              height="100%"
              onChange={onJsonChange}
              onFocus={onJsonFocus}
              onBlur={onJsonBlur}
              path={INSPECTOR_MODEL_PATH}
              schema={editorSchema}
              schemaUri={INSPECTOR_SCHEMA_URI}
              suggest={suggestLists}
            />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onAddAfter}>
              <PlusIcon data-icon="inline-start" />
              After this
            </Button>
            <Button size="sm" variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}
