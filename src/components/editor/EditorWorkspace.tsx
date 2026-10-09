"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

export type EditorWorkspaceProps = {
  className?: string;
  sidebar: ReactNode;
  graph: ReactNode;
  inspector: ReactNode;
};

/**
 * Desktop workspace: left sidebar | graph | inspector — all resizable.
 * Panel sizes persist in localStorage via react-resizable-panels.
 */
export function EditorWorkspace({
  className,
  sidebar,
  graph,
  inspector,
}: EditorWorkspaceProps) {
  const [storage, setStorage] = useState<Storage | undefined>(undefined);
  useEffect(() => {
    setStorage(localStorage);
  }, []);

  const mainLayout = useDefaultLayout({
    id: "oe-main",
    panelIds: ["sidebar", "center", "inspector"],
    storage,
  });

  if (!storage) {
    return <div className={cn("app-main min-h-0", className)} />;
  }

  return (
    <ResizablePanelGroup
      id="oe-main"
      orientation="horizontal"
      className={cn("app-main min-h-0", className)}
      defaultLayout={mainLayout.defaultLayout}
      onLayoutChanged={(layout, meta) => {
        mainLayout.onLayoutChanged(layout, meta);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__oeResizeGraph?.();
      }}
    >
      <ResizablePanel
        id="sidebar"
        defaultSize={240}
        minSize={180}
        maxSize={420}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-border" />
      <ResizablePanel
        id="center"
        defaultSize="50%"
        minSize={280}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <div className="h-full min-h-0 min-w-0 overflow-hidden">{graph}</div>
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-border" />
      <ResizablePanel
        id="inspector"
        defaultSize={280}
        minSize={200}
        maxSize={480}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        {inspector}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
