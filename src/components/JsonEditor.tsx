"use client";

import Editor, { type OnMount, useMonaco } from "@monaco-editor/react";
import type { editor as MonacoEditor, IDisposable, IKeyboardEvent } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { OeSuggestPopup } from "@/components/OeSuggestPopup";
import {
  detectSuggestContext,
  itemsForHit,
  stringValueEndColumn,
  type SuggestFieldKind,
  type SuggestItem,
  type SuggestLists,
} from "@/lib/plan/jsonSuggest";
import { cn } from "@/lib/utils";

type JsonSchema = Record<string, unknown>;

export type JsonSuggestLists = SuggestLists;

type Props = {
  value: string;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  height?: string | number;
  minHeight?: number;
  readOnly?: boolean;
  className?: string;
  path?: string;
  schema?: JsonSchema | null;
  schemaUri?: string;
  suggest?: JsonSuggestLists | null;
};

type SchemaEntry = {
  uri: string;
  fileMatch: string[];
  schema: JsonSchema;
};

type MonacoJson = {
  languages: {
    json: {
      jsonDefaults: {
        diagnosticsOptions: {
          schemas?: SchemaEntry[];
          validate?: boolean;
          allowComments?: boolean;
        };
        setDiagnosticsOptions: (opts: {
          schemas?: SchemaEntry[];
          validate?: boolean;
          allowComments?: boolean;
        }) => void;
      };
    };
  };
};

type PopupState = {
  items: SuggestItem[];
  kind: SuggestFieldKind;
  top: number;
  left: number;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
};

function upsertSchema(
  monaco: MonacoJson,
  entry: SchemaEntry | null,
  previousUri: string | null,
) {
  const current = monaco.languages.json.jsonDefaults.diagnosticsOptions;
  const existing = (current.schemas || []).filter((s: SchemaEntry) => {
    if (entry && s.uri === entry.uri) return false;
    if (previousUri && s.uri === previousUri) return false;
    return true;
  });
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    ...current,
    validate: true,
    allowComments: false,
    schemas: entry ? [...existing, entry] : existing,
  });
}

export function JsonEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  height = "100%",
  minHeight,
  readOnly = false,
  className,
  path,
  schema = null,
  schemaUri,
  suggest = null,
}: Props) {
  const monaco = useMonaco();
  const schemaUriRef = useRef<string | null>(null);
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoApiRef = useRef<any>(null);
  const refreshSuggestRef = useRef<() => void>(() => {});
  const applyItemRef = useRef<(index: number) => void>(() => {});
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(0);
  const popupRef = useRef<PopupState | null>(null);

  const [popup, setPopup] = useState<PopupState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    popupRef.current = popup;
  }, [popup]);

  useEffect(() => {
    activeRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (!monaco) return;
    const m = monaco as unknown as MonacoJson;
    if (schema && schemaUri && path) {
      upsertSchema(
        m,
        {
          uri: schemaUri,
          fileMatch: [path, `*/${path}`, `**/${path}`],
          schema,
        },
        schemaUriRef.current,
      );
      schemaUriRef.current = schemaUri;
    } else if (schemaUriRef.current) {
      upsertSchema(m, null, schemaUriRef.current);
      schemaUriRef.current = null;
    }
  }, [monaco, path, schema, schemaUri]);

  useEffect(() => {
    return () => {
      if (monaco && schemaUriRef.current) {
        upsertSchema(monaco as unknown as MonacoJson, null, schemaUriRef.current);
        schemaUriRef.current = null;
      }
    };
  }, [monaco]);

  const closePopup = useCallback(() => {
    setPopup(null);
    setActiveIndex(0);
  }, []);

  const refreshSuggest = useCallback(() => {
    const ed = editorRef.current;
    const lists = suggestRef.current;
    if (!ed || readOnly || !lists) {
      closePopup();
      return;
    }
    const model = ed.getModel();
    const pos = ed.getPosition();
    if (!model || !pos) {
      closePopup();
      return;
    }

    const line = model.getLineContent(pos.lineNumber);
    const linePrefix = line.slice(0, pos.column - 1);
    const hit = detectSuggestContext(linePrefix);
    if (!hit) {
      closePopup();
      return;
    }

    const items = itemsForHit(hit, lists);
    if (!items.length) {
      closePopup();
      return;
    }

    const endColumn = stringValueEndColumn(line, pos.column);
    const coords = ed.getScrolledVisiblePosition(pos);
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!coords || !wrap) {
      closePopup();
      return;
    }

    // Viewport coords for a fixed portal (not clipped by editor overflow)
    const top = wrap.top + coords.top + coords.height + 4;
    const left = Math.max(8, wrap.left + coords.left);

    setPopup({
      items,
      kind: hit.kind,
      top,
      left,
      lineNumber: pos.lineNumber,
      startColumn: hit.valueStartColumn,
      endColumn,
    });
    setActiveIndex(0);
  }, [closePopup, readOnly]);

  const applyItem = useCallback(
    (index: number) => {
      const ed = editorRef.current;
      const m = monacoApiRef.current;
      const state = popupRef.current;
      if (!ed || !m || !state) return;
      const item = state.items[index];
      if (!item) return;

      const range = new m.Range(
        state.lineNumber,
        state.startColumn,
        state.lineNumber,
        state.endColumn,
      );
      ed.executeEdits("oe-suggest", [
        {
          range,
          text: item.value,
          forceMoveMarkers: true,
        },
      ]);
      ed.setPosition({
        lineNumber: state.lineNumber,
        column: state.startColumn + item.value.length,
      });
      ed.focus();
      closePopup();
    },
    [closePopup],
  );

  refreshSuggestRef.current = refreshSuggest;
  applyItemRef.current = applyItem;

  const handleMount: OnMount = useCallback(
    (editor, monacoApi) => {
      editorRef.current = editor;
      monacoApiRef.current = monacoApi;
      const m = monacoApi as unknown as MonacoJson;
      m.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas:
          m.languages.json.jsonDefaults.diagnosticsOptions.schemas || [],
      });
      editor.updateOptions({
        fontSize: 12,
        fontFamily: "IBM Plex Mono, SF Mono, ui-monospace, Menlo, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        wordWrap: "on",
        lineNumbers: "on",
        renderLineHighlight: readOnly ? "none" : "line",
        readOnly,
        domReadOnly: readOnly,
        // Built-in Monaco string suggest off — we own the popup.
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: "off",
        snippetSuggestions: "none",
        scrollbar: {
          vertical: "auto",
          horizontal: "auto",
          alwaysConsumeMouseWheel: true,
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });

      const disposables: IDisposable[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => refreshSuggestRef.current(), 40);
      };

      disposables.push(editor.onDidChangeModelContent(schedule));
      disposables.push(editor.onDidChangeCursorPosition(schedule));
      disposables.push(editor.onDidScrollChange(() => closePopup()));
      disposables.push(
        editor.onDidFocusEditorWidget(() => {
          onFocusRef.current?.();
        }),
      );
      disposables.push(
        editor.onDidBlurEditorWidget(() => {
          onBlurRef.current?.();
          setTimeout(() => closePopup(), 150);
        }),
      );

      disposables.push(
        editor.onKeyDown((e: IKeyboardEvent) => {
          const state = popupRef.current;
          if (!state?.items.length) return;

          if (e.keyCode === monacoApi.KeyCode.Escape) {
            e.preventDefault();
            e.stopPropagation();
            closePopup();
            return;
          }
          if (e.keyCode === monacoApi.KeyCode.DownArrow) {
            e.preventDefault();
            e.stopPropagation();
            setActiveIndex((i) => (i + 1) % state.items.length);
            return;
          }
          if (e.keyCode === monacoApi.KeyCode.UpArrow) {
            e.preventDefault();
            e.stopPropagation();
            setActiveIndex(
              (i) => (i - 1 + state.items.length) % state.items.length,
            );
            return;
          }
          if (
            e.keyCode === monacoApi.KeyCode.Enter ||
            e.keyCode === monacoApi.KeyCode.Tab
          ) {
            e.preventDefault();
            e.stopPropagation();
            applyItemRef.current(activeRef.current);
          }
        }),
      );

      editor.onDidDispose(() => {
        for (const d of disposables) d.dispose();
        if (timer) clearTimeout(timer);
        if (editorRef.current === editor) editorRef.current = null;
      });

      schedule();
    },
    [closePopup, readOnly],
  );

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !ed.hasTextFocus()) return;
    refreshSuggest();
  }, [suggest, refreshSuggest]);

  // Sync from parent without controlled `value` — that resets the caret on every
  // plan resolve / re-render while the user is still typing.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.getValue() === value) return;
    if (ed.hasTextFocus()) return;
    ed.setValue(value);
  }, [value]);

  const fixedPx =
    typeof height === "number" ? Math.max(height, minHeight ?? 0) : null;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative min-h-0 min-w-0 w-full overflow-auto rounded-lg border border-border",
        fixedPx == null && "h-full",
        className,
      )}
      style={
        fixedPx != null
          ? {
              height: fixedPx,
              minHeight: minHeight ?? fixedPx,
              maxHeight: fixedPx,
            }
          : minHeight != null
            ? { minHeight }
            : undefined
      }
    >
      <Editor
        height={fixedPx != null ? fixedPx : height}
        defaultLanguage="json"
        language="json"
        theme="vs-dark"
        path={path}
        defaultValue={value}
        onChange={(v) => onChange?.(v ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          automaticLayout: true,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: "off",
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            alwaysConsumeMouseWheel: true,
          },
        }}
      />
      <OeSuggestPopup
        open={popup != null}
        items={popup?.items ?? []}
        activeIndex={activeIndex}
        top={popup?.top ?? 0}
        left={popup?.left ?? 0}
        kind={popup?.kind ?? null}
        onHover={setActiveIndex}
        onPick={applyItem}
      />
    </div>
  );
}
