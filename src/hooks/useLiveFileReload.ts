"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, pretty } from "@/lib/api";
import { isWatchableLuaPath } from "@/lib/paths";
import type { OePlan } from "@/lib/plan/types";

export { isWatchableLuaPath };

type FilePayload = {
  path: string;
  mtimeMs: number;
  size: number;
  json?: OePlan | null;
};

type Options = {
  filePath: string | null;
  /** Current in-memory plan (graph / inspector). */
  plan: OePlan | null;
  onReload: (plan: OePlan, path: string) => Promise<void>;
};

/**
 * Live-reload a plan opened from the lua repo when the file changes on disk.
 * Auto-applies when local state still matches the last disk snapshot; otherwise
 * keeps local edits and offers a Reload action.
 */
export function useLiveFileReload({ filePath, plan, onReload }: Options) {
  const planRef = useRef(plan);
  const onReloadRef = useRef(onReload);
  const mtimeRef = useRef<number | null>(null);
  const diskSnapshotRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);
  planRef.current = plan;
  onReloadRef.current = onReload;

  useEffect(() => {
    if (!isWatchableLuaPath(filePath)) {
      mtimeRef.current = null;
      diskSnapshotRef.current = null;
      return;
    }

    let closed = false;
    mtimeRef.current = null;
    // Baseline = whatever is already in memory for this path (just opened).
    diskSnapshotRef.current = planRef.current ? pretty(planRef.current) : null;
    const encoded = encodeURIComponent(filePath);

    const localDiverged = () => {
      const local = planRef.current ? pretty(planRef.current) : null;
      const baseline = diskSnapshotRef.current;
      return Boolean(local && baseline && local !== baseline);
    };

    const applyFromDisk = async (meta?: { mtimeMs: number }) => {
      if (closed || reloadingRef.current) return;
      reloadingRef.current = true;
      try {
        const file = await api<FilePayload>(`/api/lua/file?path=${encoded}`);
        if (closed) return;
        mtimeRef.current = meta?.mtimeMs ?? file.mtimeMs;
        if (!file.json) {
          toast.error("Disk file is not valid JSON");
          return;
        }
        diskSnapshotRef.current = pretty(file.json);
        await onReloadRef.current(file.json, filePath);
        toast.success("Reloaded from disk", {
          description: filePath.split(/[/\\]/).pop(),
        });
      } catch (err) {
        toast.error(
          `Live reload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        reloadingRef.current = false;
      }
    };

    const onDiskChange = (meta: { mtimeMs: number; size: number }) => {
      if (closed) return;
      if (mtimeRef.current != null && meta.mtimeMs === mtimeRef.current) return;

      if (localDiverged()) {
        mtimeRef.current = meta.mtimeMs;
        toast.warning("File changed on disk", {
          description: "Local edits kept. Reload to take disk version.",
          action: {
            label: "Reload",
            onClick: () => {
              void applyFromDisk(meta);
            },
          },
          duration: 8000,
        });
        return;
      }

      void applyFromDisk(meta);
    };

    const es = new EventSource(`/api/lua/watch?path=${encoded}`);

    es.addEventListener("ready", (ev) => {
      try {
        const meta = JSON.parse((ev as MessageEvent).data) as {
          mtimeMs: number;
        };
        mtimeRef.current = meta.mtimeMs;
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("change", (ev) => {
      try {
        const meta = JSON.parse((ev as MessageEvent).data) as {
          mtimeMs: number;
          size: number;
        };
        onDiskChange(meta);
      } catch {
        /* ignore */
      }
    });

    const poll = window.setInterval(async () => {
      if (closed || reloadingRef.current) return;
      try {
        const meta = await api<{ mtimeMs: number; size: number }>(
          `/api/lua/file?path=${encoded}&stat=1`,
        );
        if (mtimeRef.current == null) {
          mtimeRef.current = meta.mtimeMs;
          return;
        }
        if (meta.mtimeMs !== mtimeRef.current) onDiskChange(meta);
      } catch {
        /* ignore transient */
      }
    }, 2000);

    return () => {
      closed = true;
      es.close();
      window.clearInterval(poll);
    };
    // plan intentionally omitted — baseline captured at path bind time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);
}
