"use client";

import { create } from "zustand";
import type {
  AppSettings,
  OePlan,
  SchemaCache,
  ValidationIssue,
  ValidationResult,
} from "@/lib/plan/types";

type ModalId =
  | "open"
  | "paste"
  | "settings"
  | "run"
  | "new"
  | null;

type PlanStore = {
  settings: AppSettings | null;
  schema: SchemaCache | null;
  plan: OePlan | null;
  resolved: OePlan | null;
  selected: string | null;
  filePath: string | null;
  validation: ValidationResult | null;
  /** Last OE check_plan summary (OK / FAIL — …). */
  oeCheck: string | null;
  /** Parsed OE issues (merged into display validation). Cleared when the plan is edited. */
  oeIssues: ValidationIssue[] | null;
  planVersion: number | null;
  status: string;
  dirtyJson: boolean;
  modal: ModalId;
  sideTab: "states" | "palette";
  graphHint: string;
  runLog: string;
  jsonText: string;

  setSettings: (s: AppSettings) => void;
  setSchema: (s: SchemaCache) => void;
  setPlan: (plan: OePlan | null) => void;
  setResolved: (plan: OePlan | null) => void;
  setSelected: (id: string | null) => void;
  setFilePath: (path: string | null) => void;
  setValidation: (v: ValidationResult | null) => void;
  setOeCheck: (v: string | null) => void;
  setOeIssues: (v: ValidationIssue[] | null) => void;
  setPlanVersion: (v: number | null) => void;
  setStatus: (s: string) => void;
  setDirtyJson: (v: boolean) => void;
  setModal: (m: ModalId) => void;
  setSideTab: (t: "states" | "palette") => void;
  setGraphHint: (s: string) => void;
  setRunLog: (s: string) => void;
  appendRunLog: (s: string) => void;
  setJsonText: (s: string) => void;
};

export const usePlanStore = create<PlanStore>((set) => ({
  settings: null,
  schema: null,
  plan: null,
  resolved: null,
  selected: null,
  filePath: null,
  validation: null,
  oeCheck: null,
  oeIssues: null,
  planVersion: null,
  status: "Starting…",
  dirtyJson: false,
  modal: null,
  sideTab: "states",
  graphHint:
    "Drag blue dots to set next · Right-click edge to clear · Right-click node for menu",
  runLog: "",
  jsonText: "",

  setSettings: (settings) => set({ settings }),
  setSchema: (schema) => set({ schema }),
  setPlan: (plan) => set({ plan }),
  setResolved: (resolved) => set({ resolved }),
  setSelected: (selected) => set({ selected }),
  setFilePath: (filePath) => set({ filePath }),
  setValidation: (validation) => set({ validation }),
  setOeCheck: (oeCheck) => set({ oeCheck }),
  setOeIssues: (oeIssues) => set({ oeIssues }),
  setPlanVersion: (planVersion) => set({ planVersion }),
  setStatus: (status) => set({ status }),
  setDirtyJson: (dirtyJson) => set({ dirtyJson }),
  setModal: (modal) => set({ modal }),
  setSideTab: (sideTab) => set({ sideTab }),
  setGraphHint: (graphHint) => set({ graphHint }),
  setRunLog: (runLog) => set({ runLog }),
  appendRunLog: (line) =>
    set((s) => ({ runLog: s.runLog + line + (line.endsWith("\n") ? "" : "\n") })),
  setJsonText: (jsonText) => set({ jsonText }),
}));
