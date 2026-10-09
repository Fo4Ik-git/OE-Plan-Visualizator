"use client";

import { useEffect, useRef } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import dagre from "cytoscape-dagre";
import { toCytoscapeElements } from "@/lib/plan/model";
import { TYPE_COLORS } from "@/lib/plan/colors";
import type { RunHighlight } from "@/lib/plan/execution";
import type { OePlan, ValidationResult } from "@/lib/plan/types";
import { usePlanStore } from "@/store/plan-store";

if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cytoscape.use(dagre as any);
}

export type GraphHandlers = {
  onSelect: (id: string | null) => void;
  onConnect: (from: string, to: string) => void;
  onClearNext: (from: string) => void;
  onAddNext: (from: string, type: string) => void;
  onDelete: (id: string) => void;
  onEmptyDblClick: (pos: { x: number; y: number }) => void;
};

type Props = {
  plan: OePlan | null;
  resolved: OePlan | null;
  selected: string | null;
  validation: ValidationResult | null;
  renderToken: number;
  relayoutToken: number;
  newNode: { id: string; nearId?: string; position?: { x: number; y: number } } | null;
  runHighlight: RunHighlight | null;
  handlers: GraphHandlers;
};

export function GraphCanvas({
  plan,
  resolved,
  selected,
  validation,
  renderToken,
  relayoutToken,
  newNode,
  runHighlight,
  handlers,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const drawingFromRef = useRef<string | null>(null);
  const handlersRef = useRef(handlers);
  const lastRelayoutRef = useRef(0);
  const setGraphHint = usePlanStore((s) => s.setGraphHint);
  const setStatus = usePlanStore((s) => s.setStatus);
  handlersRef.current = handlers;

  const draftEdgeId = "_draft_link";

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "font-size": "11px",
            "font-family": "IBM Plex Sans, Segoe UI, system-ui, sans-serif",
            color: "#e7ecf3",
            "background-color": "#243044",
            "border-width": 2,
            "border-color": "#3d8bfd",
            width: 150,
            height: 46,
            shape: "round-rectangle",
            "text-wrap": "ellipsis",
            "text-max-width": "130px",
          },
        },
        {
          selector: "node[type]",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style: {
            "border-color": ((ele: NodeSingular) =>
              TYPE_COLORS[ele.data("type")] || TYPE_COLORS.unknown) as any,
          },
        },
        {
          selector: "node[?start]",
          style: { "border-width": 3, "background-color": "#1e4a8c" },
        },
        { selector: "node.success-run", style: { "background-color": "#1f4d3a" } },
        { selector: "node.fail-run", style: { "background-color": "#5a2a30" } },
        { selector: "node.waiting-run", style: { "background-color": "#4a3d1a" } },
        { selector: "node.stopped-run", style: { "background-color": "#3a3a48" } },
        {
          selector: "node.active-run",
          style: { "border-color": "#fff", "border-width": 3 },
        },
        {
          selector: "node:selected",
          style: { "border-color": "#fff", "border-width": 3 },
        },
        {
          selector: "node.invalid-state",
          style: {
            "border-color": "#f07178",
            "border-width": 3,
            "background-color": "#4a2228",
          },
        },
        {
          selector: "node.warn-state",
          style: {
            "border-color": "#e6c07b",
            "border-width": 3,
            "background-color": "#3d3420",
          },
        },
        {
          selector: "node.connect-handle",
          style: {
            label: "",
            width: 16,
            height: 16,
            shape: "ellipse",
            "background-color": "#3d8bfd",
            "border-width": 2,
            "border-color": "#e7ecf3",
            "z-index": 999,
            "z-index-compare": "manual",
            "overlay-opacity": 0,
          },
        },
        {
          selector: "node.draw-source",
          style: {
            "border-color": "#3d8bfd",
            "border-width": 4,
            "background-color": "#1e4a8c",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2.5,
            "curve-style": "unbundled-bezier",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "control-point-distances": ((ele: any) => {
              const slots = ele.data("fanSlots") || 1;
              if (slots <= 1) return [0];
              const mid = (slots - 1) / 2;
              const slot = ele.data("fanSlot") || 0;
              return [(slot - mid) * 48];
            }) as any,
            "control-point-weights": [0.45] as any,
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#6b7c93",
            "line-color": "#6b7c93",
            label: "data(label)",
            "font-size": "10px",
            color: "#e7ecf3",
            "text-rotation": "autorotate",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "text-margin-y": ((ele: any) => {
              const slot = ele.data("labelSlot") || 0;
              return -12 - slot * 14;
            }) as any,
            "text-background-color": "#0f1419",
            "text-background-opacity": 0.9,
            "text-background-padding": "2",
            "text-background-shape": "roundrectangle",
            "z-index": 20,
            "z-index-compare": "manual",
          },
        },
        {
          selector: "edge[!label], edge[label='']",
          style: { "text-opacity": 0 },
        },
        {
          selector: "edge[kind='next']",
          style: {
            "line-color": "#3d8bfd",
            "target-arrow-color": "#3d8bfd",
          },
        },
        {
          selector: "edge[kind='catch']",
          style: {
            "line-style": "dashed",
            "line-color": "#f07178",
            "target-arrow-color": "#f07178",
          },
        },
        {
          // Edges inherited from #.wrappers (e.g. task_regular default catch)
          selector: "edge.inherited-edge, edge[?inherited]",
          style: {
            "line-style": "dotted",
            width: 2,
            opacity: 0.72,
            "line-color": "#c678dd",
            "target-arrow-color": "#c678dd",
            color: "#c678dd",
            "text-opacity": 1,
            "font-style": "italic",
            "font-size": 10,
          },
        },
        {
          selector: "edge.inherited-edge[kind='catch'], edge[?inherited][kind='catch']",
          style: {
            "line-color": "#e06c9a",
            "target-arrow-color": "#e06c9a",
            color: "#e06c9a",
          },
        },
        {
          selector: "edge[kind='choice'], edge[kind='default']",
          style: {
            "line-color": "#e6c07b",
            "target-arrow-color": "#e6c07b",
          },
        },
        {
          selector: "edge[kind='loop-body']",
          style: {
            "line-style": "dotted",
            width: 3,
            "line-color": "#d19a66",
            "target-arrow-color": "#d19a66",
            color: "#d19a66",
            "text-opacity": 1,
          },
        },
        {
          selector: "node[loopEntry]",
          style: {
            "border-style": "double",
            "border-width": 4,
            "border-color": "#d19a66",
          },
        },
        {
          selector: "edge.draft",
          style: {
            "line-style": "dashed",
            "line-color": "#3d8bfd",
            "target-arrow-color": "#3d8bfd",
            width: 2,
            "text-opacity": 0,
            "z-index": 999,
            events: "no",
          },
        },
        {
          selector: "node.draft-cursor",
          style: {
            width: 1,
            height: 1,
            opacity: 0,
            "border-width": 0,
            label: "",
            events: "no",
          },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      layout: { name: "preset" },
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;

    const isHandle = (ele: NodeSingular) => !!ele.data("handleFor");
    const isState = (ele: NodeSingular) =>
      ele.isNode() && !isHandle(ele) && !ele.hasClass("draft-cursor");
    const resolveStateId = (ele: NodeSingular) => {
      if (isHandle(ele)) return ele.data("handleFor") as string;
      if (ele.hasClass("draft-cursor")) return null;
      return ele.id();
    };

    const hideMenu = () => document.getElementById("graphContextMenu")?.remove();

    const placeHandle = (stateNode: NodeSingular) => {
      const hid = `${stateNode.id()}__out`;
      const pos = {
        x: stateNode.position("x"),
        y: stateNode.position("y") + 30,
      };
      const handle = cy.getElementById(hid);
      if (handle.empty()) {
        cy.add({
          group: "nodes",
          data: { id: hid, handleFor: stateNode.id(), label: "" },
          position: pos,
          grabbable: false,
          selectable: false,
          classes: "connect-handle",
        });
      } else {
        handle.position(pos);
      }
    };

    const syncHandles = () => {
      cy.nodes().forEach((n) => {
        if (isState(n)) placeHandle(n);
      });
      cy.nodes(".connect-handle").forEach((h) => {
        if (cy.getElementById(h.data("handleFor")).empty()) h.remove();
      });
    };

    const removeDraft = () => {
      cy.getElementById(draftEdgeId).remove();
      cy.getElementById(`${draftEdgeId}_cursor`).remove();
    };

    const stopDraw = () => {
      drawingFromRef.current = null;
      cy.nodes().removeClass("draw-source");
      cy.container()?.classList.remove("link-mode");
      cy.userPanningEnabled(true);
      removeDraft();
      setGraphHint(
        "Drag blue dots to set next · Right-click edge to clear · Right-click node for menu",
      );
    };

    const startDraw = (fromId: string) => {
      drawingFromRef.current = fromId;
      cy.nodes().removeClass("draw-source");
      cy.getElementById(fromId).addClass("draw-source");
      cy.container()?.classList.add("link-mode");
      cy.userPanningEnabled(false);
      setGraphHint(`Connect from “${fromId}” — drop on another state. Esc to cancel`);
      setStatus(`Connecting ${fromId} → … (next)`);
    };

    const stateIdAtPosition = (position: { x: number; y: number } | null) => {
      if (!position) return null;
      const pad = 8;
      const hits = cy.nodes().filter((n) => {
        if (!isState(n)) return false;
        const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
        return (
          position.x >= bb.x1 - pad &&
          position.x <= bb.x2 + pad &&
          position.y >= bb.y1 - pad &&
          position.y <= bb.y2 + pad
        );
      });
      if (hits.empty()) {
        const handleHits = cy.nodes(".connect-handle").filter((h) => {
          const bb = h.boundingBox({ includeLabels: false, includeOverlays: false });
          return (
            position.x >= bb.x1 - pad &&
            position.x <= bb.x2 + pad &&
            position.y >= bb.y1 - pad &&
            position.y <= bb.y2 + pad
          );
        });
        if (handleHits.nonempty()) return handleHits[0].data("handleFor") as string;
        return null;
      }
      let best: string | null = null;
      let bestDist = Infinity;
      hits.forEach((n) => {
        const p = n.position();
        const d =
          (p.x - position.x) * (p.x - position.x) +
          (p.y - position.y) * (p.y - position.y);
        if (d < bestDist) {
          bestDist = d;
          best = n.id();
        }
      });
      return best;
    };

    const updateDraft = (position: { x: number; y: number }) => {
      const from = drawingFromRef.current;
      if (!from) return;
      let cursor = cy.getElementById(`${draftEdgeId}_cursor`);
      if (cursor.empty()) {
        cy.add({
          group: "nodes",
          data: { id: `${draftEdgeId}_cursor`, label: "" },
          position,
          grabbable: false,
          selectable: false,
          classes: "draft-cursor",
        });
      } else {
        cursor.position(position);
      }
      if (cy.getElementById(draftEdgeId).empty()) {
        cy.add({
          group: "edges",
          data: {
            id: draftEdgeId,
            source: from,
            target: `${draftEdgeId}_cursor`,
            kind: "next",
            label: "",
          },
          classes: "draft",
        });
      }
    };

    // expose helpers on cy for render effect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cy as any).__oe = { placeHandle, syncHandles, stopDraw, isState };

    cy.on("tap", "node", (evt) => {
      if (drawingFromRef.current) return;
      if (!isState(evt.target)) return;
      handlersRef.current.onSelect(evt.target.id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        if (drawingFromRef.current) {
          stopDraw();
          setStatus("Connect cancelled");
        } else {
          handlersRef.current.onSelect(null);
        }
      }
    });
    cy.on("dblclick", (evt) => {
      if (evt.target === cy) handlersRef.current.onEmptyDblClick(evt.position);
    });

    const beginConnect = (evt: cytoscape.EventObject) => {
      const from = evt.target.data("handleFor");
      if (!from) return;
      evt.preventDefault();
      evt.stopPropagation();
      startDraw(from);
      if (evt.position) updateDraft(evt.position);
    };
    cy.on("tapstart", "node.connect-handle", beginConnect);
    cy.on("vmousedown", "node.connect-handle", beginConnect);
    cy.on("tapdrag", (evt) => {
      if (drawingFromRef.current && evt.position) updateDraft(evt.position);
    });
    cy.on("vmousemove", (evt) => {
      if (drawingFromRef.current && evt.position) updateDraft(evt.position);
    });

    const finishConnect = (evt: cytoscape.EventObject) => {
      if (!drawingFromRef.current) return;
      const from = drawingFromRef.current;
      let to = stateIdAtPosition(evt.position || null);
      if (!to && evt.target && evt.target !== cy) {
        to = resolveStateId(evt.target as NodeSingular);
      }
      stopDraw();
      if (to && to !== from) handlersRef.current.onConnect(from, to);
      else setStatus("Connect cancelled — drop on a state");
    };
    cy.on("tapend", finishConnect);
    cy.on("vmouseup", finishConnect);

    const onDocMouseUp = () => {
      if (!drawingFromRef.current) return;
      setTimeout(() => {
        if (!drawingFromRef.current) return;
        stopDraw();
        setStatus("Connect cancelled — drop on a state");
      }, 0);
    };
    document.addEventListener("mouseup", onDocMouseUp);

    cy.on("drag", "node", (evt) => {
      if (isState(evt.target)) placeHandle(evt.target);
    });
    cy.on("position", "node", (evt) => {
      if (isState(evt.target)) placeHandle(evt.target);
    });

    cy.on("cxttap", "node", (evt) => {
      if (!isState(evt.target)) return;
      evt.originalEvent?.preventDefault();
      hideMenu();
      const menu = document.createElement("div");
      menu.id = "graphContextMenu";
      menu.className = "graph-context-menu";
      menu.style.left = `${evt.originalEvent?.clientX || 0}px`;
      menu.style.top = `${evt.originalEvent?.clientY || 0}px`;
      const nodeId = evt.target.id();
      menu.innerHTML = `
        <button data-act="add-task">+ New state after…</button>
        <button data-act="delete" class="danger">Delete state</button>`;
      menu.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.getAttribute("data-act");
          hideMenu();
          if (act === "add-task") handlersRef.current.onAddNext(nodeId, "task");
          if (act === "delete") handlersRef.current.onDelete(nodeId);
        });
      });
      document.body.appendChild(menu);
    });

    cy.on("cxttap", "edge", (evt) => {
      const kind = evt.target.data("kind");
      if (kind !== "next" && kind !== "") return;
      evt.originalEvent?.preventDefault();
      hideMenu();
      const sourceId = evt.target.data("source") as string;
      const targetId = evt.target.data("target") as string;
      const menu = document.createElement("div");
      menu.id = "graphContextMenu";
      menu.className = "graph-context-menu";
      menu.style.left = `${evt.originalEvent?.clientX || 0}px`;
      menu.style.top = `${evt.originalEvent?.clientY || 0}px`;
      menu.innerHTML = `
        <div class="menu-meta">${sourceId} → ${targetId}</div>
        <button data-act="clear" class="danger">Clear next</button>`;
      menu.querySelector("[data-act='clear']")?.addEventListener("click", (e) => {
        e.stopPropagation();
        hideMenu();
        handlersRef.current.onClearNext(sourceId);
      });
      document.body.appendChild(menu);
    });

    const onKey = (evt: KeyboardEvent) => {
      const tag = (evt.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (evt.target as HTMLElement)?.isContentEditable)
        return;
      if ((evt.target as HTMLElement)?.closest?.(".monaco-editor")) return;
      if (evt.key === "Escape") {
        stopDraw();
        hideMenu();
      }
      if (evt.key === "Delete" || evt.key === "Backspace") {
        const sel = cy.$("node:selected").filter((n) => isState(n as NodeSingular));
        if (sel.nonempty()) {
          evt.preventDefault();
          handlersRef.current.onDelete(sel.id());
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const onClick = (evt: MouseEvent) => {
      const menu = document.getElementById("graphContextMenu");
      if (menu && !menu.contains(evt.target as Node)) hideMenu();
    };
    document.addEventListener("click", onClick);

    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(containerRef.current);

    return () => {
      document.removeEventListener("mouseup", onDocMouseUp);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      ro.disconnect();
      hideMenu();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render graph when plan changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !plan) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const helpers = (cy as any).__oe;
    if (!helpers) return;

    helpers.stopDraw();
    cy.nodes().forEach((n: NodeSingular) => {
      if (helpers.isState(n)) {
        positionsRef.current[n.id()] = { ...n.position() };
      }
    });

    const elements = toCytoscapeElements(plan, resolved || plan);
    elements.edges.forEach((e: { data: { kind?: string } }) => {
      if (!e.data.kind || e.data.kind === "") e.data.kind = "next";
    });

    const prevSelected = cy
      .$("node:selected")
      .filter((n) => helpers.isState(n as NodeSingular))
      .id();
    cy.elements().remove();
    cy.add(elements.nodes);
    cy.add(elements.edges);

    let needLayout = relayoutToken !== lastRelayoutRef.current;
    if (needLayout) lastRelayoutRef.current = relayoutToken;
    let placed = 0;
    cy.nodes().forEach((n: NodeSingular) => {
      if (!helpers.isState(n)) return;
      const id = n.id();
      if (positionsRef.current[id]) {
        n.position(positionsRef.current[id]);
        placed++;
      }
    });
    if (placed === 0) needLayout = true;

    if (newNode?.id) {
      const node = cy.getElementById(newNode.id);
      if (node.nonempty() && !positionsRef.current[newNode.id]) {
        let base = { x: 120, y: 80 };
        if (newNode.nearId && positionsRef.current[newNode.nearId]) {
          base = positionsRef.current[newNode.nearId];
        } else if (newNode.position) base = newNode.position;
        const pos = { x: base.x, y: base.y + 90 };
        node.position(pos);
        positionsRef.current[newNode.id] = pos;
      }
    }

    if (needLayout) {
      cy.layout({
        name: "dagre",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rankDir: "TB",
        nodeSep: 56,
        rankSep: 90,
        edgeSep: 40,
        animate: false,
        padding: 28,
      } as any).run();
      cy.nodes().forEach((n: NodeSingular) => {
        if (helpers.isState(n)) {
          positionsRef.current[n.id()] = { ...n.position() };
        }
      });
      cy.fit(undefined, 40);
    }

    helpers.syncHandles();

    const selectId = selected || prevSelected;
    if (selectId) {
      const n = cy.getElementById(selectId);
      if (n.nonempty()) n.select();
    }

    cy.nodes().removeClass("invalid-state warn-state");
    Object.entries(validation?.byState || {}).forEach(([name, issues]) => {
      if (!issues.length) return;
      const node = cy.getElementById(name);
      if (node.empty()) return;
      const hasError = issues.some((i) => i.level === "error");
      node.addClass(hasError ? "invalid-state" : "warn-state");
    });

    cy.nodes().removeClass(
      "success-run fail-run active-run waiting-run stopped-run",
    );
    if (runHighlight) {
      Object.entries(runHighlight.outcomes || {}).forEach(([name, outcome]) => {
        const node = cy.getElementById(name);
        if (node.empty()) return;
        if (outcome === "failed") node.addClass("fail-run");
        else if (outcome === "waiting") node.addClass("waiting-run");
        else if (outcome === "stopped") node.addClass("stopped-run");
        else if (outcome === "completed" || outcome === "running") {
          node.addClass("success-run");
        }
      });
      if (runHighlight.current) {
        const node = cy.getElementById(runHighlight.current);
        if (node.nonempty()) node.addClass("active-run");
      }
    }
  }, [plan, resolved, renderToken, relayoutToken, newNode, validation, selected, runHighlight]);

  // External reset positions
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__oeResetGraphPositions = () => {
      positionsRef.current = {};
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__oeResizeGraph = () => cyRef.current?.resize();
  }, []);

  return (
    <div
      ref={containerRef}
      className="graph-canvas h-full min-h-0 min-w-0 w-full overflow-hidden"
    />
  );
}

export function resetGraphPositions() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__oeResetGraphPositions?.();
}
