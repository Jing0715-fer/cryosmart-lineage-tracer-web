"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ZoomIn, ZoomOut, Download, Maximize2, RotateCcw, Target } from "lucide-react";
import type { LineageSummary, LineageNode, LineageEdge } from "@/lib/cryosmart/types";

interface Props {
  summary: LineageSummary;
}

/**
 * Interactive lineage DAG renderer.
 *
 * The lineage is traced UPSTREAM from `summary.start_uid`, so every node in
 * `summary.nodes` is an ancestor of (i.e. upstream-of) the start job. The
 * start job is the most-downstream node and the visual focal point.
 *
 * Layout: each node is assigned an "upstream BFS distance" from start
 * (distance 0 = start itself, distance N = N hops upstream). Nodes are
 * grouped into columns by distance; columns are drawn left → right with
 * distance DECREASING to the right, so the most-upstream (oldest) jobs are
 * on the LEFT and the start job sits on the FAR RIGHT. Edges (source →
 * target, source = upstream producer) therefore flow rightward and visually
 * converge on the start job.
 *
 * Interactions: pan (drag), zoom (buttons + wheel), hover a node to trace
 * its full upstream → start path, click a node to pin the selection and
 * show a detail popover, PNG/SVG export.
 */

/* ------------------------------------------------------------------ */
/* Node / edge classification                                          */
/* ------------------------------------------------------------------ */

type NodeKind = "exposure" | "particle" | "volume" | "other";

function classify(node: LineageNode): NodeKind {
  if (node.volume_count != null || /refine|abinit|volume|class_3D|hetero/i.test(node.job_type || "")) {
    return "volume";
  }
  if (node.particle_count != null || /particle|picker|topaz/i.test(node.job_type || "")) {
    return "particle";
  }
  if (node.micrograph_count != null || /micrograph|ctf|exposure/i.test(node.job_type || "")) {
    return "exposure";
  }
  return "other";
}

const KIND_COLOR: Record<NodeKind, string> = {
  exposure: "#06b6d4", // cyan
  particle: "#f59e0b", // amber
  volume: "#0d9488",  // teal (brand)
  other: "#64748b",   // slate
};

const KIND_LABEL: Record<NodeKind, string> = {
  exposure: "Micrograph",
  particle: "Particle",
  volume: "Map",
  other: "Other",
};

/** Pick a color for an edge based on its family (matches node family palette). */
function edgeColor(edge: LineageEdge): string {
  const k = (edge.kind || edge.input_type || "parent").toLowerCase();
  if (/mask|volume|model/.test(k)) return KIND_COLOR.volume;
  if (/exposure|micrograph/.test(k)) return KIND_COLOR.exposure;
  if (/particle/.test(k)) return KIND_COLOR.particle;
  return KIND_COLOR.other;
}

/** Short stage label inferred from job_type, used in the column axis. */
function stageLabelFor(node: LineageNode): string {
  const t = node.job_type || "";
  if (/import_/i.test(t)) return "Import";
  if (/motion/i.test(t)) return "Motion";
  if (/ctf/i.test(t)) return "CTF";
  if (/picker|topaz/i.test(t)) return "Picking";
  if (/extract/i.test(t)) return "Extract";
  if (/class_2D|select_2D|rebalance/i.test(t)) return "2D Class";
  if (/abinit|ab_initio/i.test(t)) return "Ab-Initio";
  if (/refine/i.test(t)) return "Refine";
  if (/class_3D|hetero/i.test(t)) return "3D Class";
  return "Other";
}

/** Pick the most common stage label in a column (used for the axis sub-label). */
function columnStageLabel(nodes: LineageNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const s = stageLabelFor(n);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = "Other";
  let bestCount = -1;
  for (const [s, c] of counts) {
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* BFS distance + ancestor / descendant helpers                       */
/* ------------------------------------------------------------------ */

/**
 * Compute the upstream BFS distance from `startUid` for every reachable
 * node. Walks edges backward (target → source), since `source` is the
 * upstream producer. Distance 0 = start; distance N = N hops upstream.
 * Handles cycles defensively via a `visited` set.
 */
function computeUpstreamDistances(startUid: string, edges: LineageEdge[]): Map<string, number> {
  const upstreamOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.target || !e.source) continue;
    const arr = upstreamOf.get(e.target) || [];
    arr.push(e.source);
    upstreamOf.set(e.target, arr);
  }
  const dist = new Map<string, number>();
  const visited = new Set<string>([startUid]);
  dist.set(startUid, 0);
  const queue: string[] = [startUid];
  while (queue.length) {
    const cur = queue.shift() as string;
    const d = dist.get(cur) as number;
    const ups = upstreamOf.get(cur);
    if (!ups) continue;
    for (const s of ups) {
      if (!visited.has(s)) {
        visited.add(s);
        dist.set(s, d + 1);
        queue.push(s);
      }
    }
  }
  return dist;
}

/** Collect every upstream ancestor of `uid` (inclusive of `uid`). */
function collectAncestors(uid: string, edges: LineageEdge[]): Set<string> {
  const result = new Set<string>([uid]);
  const queue: string[] = [uid];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const e of edges) {
      if (e.target === cur && !result.has(e.source)) {
        result.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return result;
}

/** Collect every downstream node reachable from `uid` forward (toward start). */
function collectDownstream(uid: string, edges: LineageEdge[]): Set<string> {
  const result = new Set<string>([uid]);
  const queue: string[] = [uid];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const e of edges) {
      if (e.source === cur && !result.has(e.target)) {
        result.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Metrics formatting                                                  */
/* ------------------------------------------------------------------ */

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatMetrics(node: LineageNode): string {
  const parts: string[] = [];
  if (node.particle_count != null) parts.push(`${fmtCount(node.particle_count)} parts`);
  if (node.micrograph_count != null) parts.push(`${fmtCount(node.micrograph_count)} mics`);
  if (node.volume_count != null && node.volume_count > 0) {
    parts.push(`${node.volume_count} map${node.volume_count > 1 ? "s" : ""}`);
  }
  if (node.resolution_A != null) parts.push(`${node.resolution_A}\u00C5`);
  return parts.join("   \u00B7   ");
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

const NODE_W = 168;
const NODE_H = 70;
const LAYER_X = 224;
const LAYER_Y = 104;
const TOP_AXIS_H = 46;
const PAD = 24;

/* ------------------------------------------------------------------ */
/* Layout output shape                                                 */
/* ------------------------------------------------------------------ */

interface NodePos {
  x: number;
  y: number;
  distance: number;
  column: number;
}

interface Layout {
  nodes: LineageNode[];
  edges: LineageEdge[];
  positions: Map<string, NodePos>;
  distances: Map<string, number>;
  maxDistance: number;
  totalColumns: number;
  width: number;
  height: number;
  columnDistances: number[];
  columnStages: string[];
  startUid: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function LineageGraph({ summary }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  /* ----- Layout ----- */
  const layout = useMemo<Layout>(() => {
    const nodes = summary.nodes || [];
    const edges = summary.edges || [];
    const startUid = summary.start_uid;
    const distances = computeUpstreamDistances(startUid, edges);

    let maxDistance = 0;
    for (const n of nodes) {
      const d = distances.get(n.uid);
      if (d != null && d > maxDistance) maxDistance = d;
    }

    // Defensive: nodes not reachable upstream from start go in a special
    // "Disconnected" column at index 0; real columns get shifted right.
    let strayCount = 0;
    for (const n of nodes) if (!distances.has(n.uid)) strayCount++;
    const columnOffset = strayCount > 0 ? 1 : 0;

    const columnNodes = new Map<number, LineageNode[]>();
    for (const n of nodes) {
      const d = distances.get(n.uid);
      const col = d == null ? 0 : columnOffset + (maxDistance - d);
      const arr = columnNodes.get(col) || [];
      arr.push(n);
      columnNodes.set(col, arr);
    }

    let maxColumnCount = 1;
    for (const list of columnNodes.values()) {
      if (list.length > maxColumnCount) maxColumnCount = list.length;
    }
    const totalColumns = columnOffset + maxDistance + 1;
    const totalColumnHeight = (maxColumnCount - 1) * LAYER_Y + NODE_H;
    const contentTop = TOP_AXIS_H + PAD;
    const centerV = contentTop + totalColumnHeight / 2;

    const positions = new Map<string, NodePos>();
    for (const [col, list] of columnNodes) {
      list.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));
      const colH = (list.length - 1) * LAYER_Y + NODE_H;
      const yStart = centerV - colH / 2;
      list.forEach((n, i) => {
        const d = distances.get(n.uid);
        positions.set(n.uid, {
          x: PAD + col * LAYER_X,
          y: yStart + i * LAYER_Y - NODE_H / 2,
          distance: d == null ? -1 : d,
          column: col,
        });
      });
    }

    const columnDistances: number[] = [];
    const columnStages: string[] = [];
    for (let c = 0; c < totalColumns; c++) {
      const list = columnNodes.get(c) || [];
      if (columnOffset === 1 && c === 0) {
        columnDistances.push(-1);
        columnStages.push("Disconnected");
      } else {
        const d = maxDistance - (c - columnOffset);
        columnDistances.push(d);
        columnStages.push(columnStageLabel(list));
      }
    }

    const width = PAD + (totalColumns - 1) * LAYER_X + NODE_W + PAD;
    const height = TOP_AXIS_H + PAD + totalColumnHeight + PAD;

    return {
      nodes,
      edges,
      positions,
      distances,
      maxDistance,
      totalColumns,
      width,
      height,
      columnDistances,
      columnStages,
      startUid,
    };
  }, [summary]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LineageNode>();
    for (const n of layout.nodes) m.set(n.uid, n);
    return m;
  }, [layout.nodes]);

  /* ----- Highlight set: ancestors ∪ downstream (full upstream→start path) ----- */
  const highlightUid = hoveredUid ?? selectedUid;
  const highlightSet = useMemo(() => {
    if (!highlightUid) return null;
    const ancestors = collectAncestors(highlightUid, layout.edges);
    const downstream = collectDownstream(highlightUid, layout.edges);
    return new Set<string>([...ancestors, ...downstream]);
  }, [highlightUid, layout.edges]);

  /* ----- Pan (drag background) ----- */
  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    // Don't initiate a pan when the press started on a node (let node click win).
    const target = e.target as Element | null;
    if (target && typeof target.closest === "function" && target.closest("[data-node]")) return;
    setDragging(true);
    const startX = e.clientX - pan.x;
    const startY = e.clientY - pan.y;
    const move = (ev: MouseEvent) => {
      setPan({ x: ev.clientX - startX, y: ev.clientY - startY });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [pan]);

  /* ----- Wheel zoom (non-passive listener so preventDefault works) ----- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setZoom((z) => Math.min(3, Math.max(0.2, z + delta * z)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ----- Fit-to-view ----- */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth - 16;
    const ch = container.clientHeight - 16;
    const z = Math.min(cw / layout.width, ch / layout.height, 1.4);
    const safeZ = Math.max(0.2, z);
    setZoom(safeZ);
    setPan({
      x: (container.clientWidth - layout.width * safeZ) / 2,
      y: (container.clientHeight - layout.height * safeZ) / 2,
    });
  }, [layout.width, layout.height]);

  /* Auto-fit on first mount + when the summary/layout dimensions change. */
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* ----- PNG export (canvas) ----- */
  const exportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = layout.width * 2;
      canvas.height = layout.height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = isDark ? "#0b1220" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = `CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_graph.png`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }, "image/png");
    };
    img.src = url;
  }, [layout.width, layout.height, isDark, summary.project_uid, summary.start_uid]);

  /* ----- SVG export (vector) ----- */
  const exportSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(layout.width));
    bg.setAttribute("height", String(layout.height));
    bg.setAttribute("fill", isDark ? "#0b1220" : "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_graph.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [layout.width, layout.height, isDark, summary.project_uid, summary.start_uid]);

  /* ----- Theme-driven palette ----- */
  const bodyFill = isDark ? "#0b1220" : "#ffffff";
  const bodyFillHi = isDark ? "#1e293b" : "#f1f5f9";
  const textFill = isDark ? "#e2e8f0" : "#0f172a";
  const mutedFill = isDark ? "#94a3b8" : "#64748b";
  const axisFill = isDark ? "#94a3b8" : "#475569";
  const gridStroke = isDark ? "#1e293b" : "#e2e8f0";

  /* ----- Selection detail ----- */
  const selectedDetail = useMemo(() => {
    if (!selectedUid) return null;
    const node = nodeMap.get(selectedUid);
    if (!node) return null;
    const ancestors = collectAncestors(selectedUid, layout.edges);
    const downstream = collectDownstream(selectedUid, layout.edges);
    const ancestorCount = ancestors.size - 1;
    let downEdges = 0;
    for (const e of layout.edges) {
      if (downstream.has(e.source) && downstream.has(e.target)) downEdges++;
    }
    const dist = layout.distances.get(selectedUid);
    return { node, ancestorCount, downEdges, dist };
  }, [selectedUid, nodeMap, layout.edges, layout.distances]);

  const isNodeActive = useCallback(
    (uid: string) => !highlightSet || highlightSet.has(uid),
    [highlightSet]
  );
  const isEdgeActive = useCallback(
    (e: LineageEdge) => !highlightSet || (highlightSet.has(e.source) && highlightSet.has(e.target)),
    [highlightSet]
  );

  return (
    <div className="space-y-2">
      <span className="sr-only">
        Lineage graph with {layout.nodes.length} jobs and {layout.edges.length} data links.
        Data flows left to right, converging on the start job {summary.start_uid}.
        Hover or focus a node to trace its upstream-to-start path. Drag to pan, scroll or use buttons to zoom.
      </span>

      {/* Toolbar + Legend */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} title="Zoom in" aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.2, z - 0.15))} title="Zoom out" aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitToView} title="Fit to view" aria-label="Fit to view">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetView} title="Reset view" aria-label="Reset view">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="px-1.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={exportPng} title="Export as raster PNG (2x retina)">
            <Download className="mr-1 h-3 w-3" /> PNG
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={exportSvg} title="Export as vector SVG">
            <Download className="mr-1 h-3 w-3" /> SVG
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
          <LegendSwatch color={KIND_COLOR.exposure} label={KIND_LABEL.exposure} />
          <LegendSwatch color={KIND_COLOR.particle} label={KIND_LABEL.particle} />
          <LegendSwatch color={KIND_COLOR.volume} label={KIND_LABEL.volume} />
          <LegendSwatch color={KIND_COLOR.other} label={KIND_LABEL.other} />
          <span className="inline-flex items-center gap-1 border-l border-slate-200 pl-3 dark:border-slate-700">
            <Target className="h-3 w-3 text-teal-600 dark:text-teal-400" />
            <span>Start job</span>
          </span>
        </div>
      </div>

      {/* SVG canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/60"
        style={{ height: 460, cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
      >
        {layout.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400 dark:text-slate-500">
            No lineage nodes to display.
          </div>
        ) : (
          <svg
            ref={svgRef}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              transition: dragging ? "none" : "transform 0.12s ease-out",
            }}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={`Lineage DAG with ${layout.nodes.length} jobs and ${layout.edges.length} data links converging on start job ${summary.start_uid}`}
          >
            <defs>
              {(["exposure", "particle", "volume", "other"] as NodeKind[]).map((k) => (
                <marker
                  key={`arrow-${k}`}
                  id={`arrow-${k}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="5"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,0 L10,5 L0,10 L3,5 Z" fill={KIND_COLOR[k]} />
                </marker>
              ))}
              <filter id="start-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Column guides + axis labels */}
            {layout.columnDistances.map((dist, col) => {
              const colX = PAD + col * LAYER_X + NODE_W / 2;
              const isStartCol = dist === 0;
              const isStrayCol = dist === -1;
              const mainLabel = isStartCol ? "START \u00B7 \u76EE\u6807" : isStrayCol ? "Disconnected" : `\u2191 ${dist} hop${dist > 1 ? "s" : ""}`;
              const subLabel = isStartCol ? "destination" : layout.columnStages[col] || "";
              return (
                <g key={`axis-${col}`}>
                  <line
                    x1={colX}
                    y1={TOP_AXIS_H}
                    x2={colX}
                    y2={layout.height - PAD / 2}
                    stroke={gridStroke}
                    strokeOpacity={isStartCol ? 0.7 : 0.35}
                    strokeWidth={isStartCol ? 1.2 : 1}
                    strokeDasharray={isStartCol ? undefined : "2 4"}
                  />
                  <text
                    x={colX}
                    y={18}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={isStartCol ? KIND_COLOR.volume : axisFill}
                  >
                    {mainLabel}
                  </text>
                  <text
                    x={colX}
                    y={33}
                    textAnchor="middle"
                    fontSize={9.5}
                    fill={axisFill}
                    opacity={0.85}
                  >
                    {subLabel}
                  </text>
                </g>
              );
            })}

            {/* Edges */}
            {layout.edges.map((e, i) => {
              const from = layout.positions.get(e.source);
              const to = layout.positions.get(e.target);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;
              const color = edgeColor(e);
              const active = isEdgeActive(e);
              const isOnHighlight = highlightUid && (e.source === highlightUid || e.target === highlightUid);
              const dim = !active;
              return (
                <path
                  key={`edge-${i}`}
                  d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={isOnHighlight ? 2.6 : 2}
                  strokeOpacity={dim ? 0.1 : isOnHighlight ? 0.95 : 0.65}
                  markerEnd={`url(#arrow-${color === KIND_COLOR.exposure ? "exposure" : color === KIND_COLOR.particle ? "particle" : color === KIND_COLOR.volume ? "volume" : "other"})`}
                  style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
                />
              );
            })}

            {/* Nodes */}
            {layout.nodes.map((node) => {
              const pos = layout.positions.get(node.uid);
              if (!pos) return null;
              const kind = classify(node);
              const color = KIND_COLOR[kind];
              const isStart = node.uid === summary.start_uid;
              const isHovered = node.uid === hoveredUid;
              const isSelected = node.uid === selectedUid;
              const isActive = isNodeActive(node.uid);
              const metrics = formatMetrics(node);
              const ariaLabel = [
                node.uid,
                node.job_type,
                metrics,
                isStart ? "start job" : `${pos.distance === -1 ? "disconnected" : `${pos.distance} hop${pos.distance > 1 ? "s" : ""} upstream`}`,
              ].filter(Boolean).join(", ");
              return (
                <g
                  key={node.uid}
                  data-node=""
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={{
                    cursor: "pointer",
                    opacity: isActive ? 1 : 0.22,
                    transition: "opacity 0.18s",
                  }}
                  onMouseEnter={() => setHoveredUid(node.uid)}
                  onMouseLeave={() => setHoveredUid(null)}
                  onClick={(ev: ReactMouseEvent) => {
                    ev.stopPropagation();
                    setSelectedUid((cur) => (cur === node.uid ? null : node.uid));
                  }}
                  onKeyDown={(ev: ReactKeyboardEvent) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setSelectedUid((cur) => (cur === node.uid ? null : node.uid));
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={ariaLabel}
                >
                  {/* Start glow halo */}
                  {isStart && (
                    <rect
                      x={-9}
                      y={-9}
                      width={NODE_W + 18}
                      height={NODE_H + 18}
                      rx={14}
                      fill="none"
                      stroke={KIND_COLOR.volume}
                      strokeWidth={2}
                      opacity={0.45}
                      filter="url(#start-glow)"
                    />
                  )}
                  {/* Start inner ring */}
                  {isStart && (
                    <rect
                      x={-3}
                      y={-3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx={11}
                      fill="none"
                      stroke={KIND_COLOR.volume}
                      strokeWidth={2}
                    />
                  )}
                  {/* Hover / select ring */}
                  {(isHovered || isSelected) && !isStart && (
                    <rect
                      x={-3}
                      y={-3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx={11}
                      fill="none"
                      stroke={isSelected ? "#0ea5e9" : color}
                      strokeWidth={2}
                      opacity={isSelected ? 0.9 : 0.6}
                    />
                  )}
                  {/* Node body */}
                  <rect
                    x={0}
                    y={0}
                    width={NODE_W}
                    height={NODE_H}
                    rx={9}
                    fill={isHovered || isSelected ? bodyFillHi : bodyFill}
                    stroke={color}
                    strokeWidth={isStart ? 1.6 : 1.2}
                  />
                  {/* Left color bar */}
                  <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={color} />
                  {/* UID */}
                  <text
                    x={14}
                    y={22}
                    fontSize={13}
                    fontWeight={700}
                    fill={textFill}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {node.uid}
                  </text>
                  {/* Job type */}
                  <text
                    x={14}
                    y={38}
                    fontSize={10.5}
                    fill={mutedFill}
                  >
                    {truncate(node.job_type || "", 26)}
                  </text>
                  {/* Metrics row */}
                  <text
                    x={14}
                    y={57}
                    fontSize={10}
                    fill={mutedFill}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {metrics || "\u2014"}
                  </text>
                  {/* Distance pill (skip for start) */}
                  {!isStart && pos.distance >= 1 && (
                    <g transform={`translate(${NODE_W - 26}, -9)`}>
                      <rect x={-2} y={-7} width={32} height={14} rx={3} fill={color} opacity={0.92} />
                      <text x={14} y={3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff">
                        {pos.distance}h
                      </text>
                    </g>
                  )}
                  {/* START badge */}
                  {isStart && (
                    <g transform={`translate(${NODE_W / 2 - 26}, -19)`}>
                      <rect width={52} height={15} rx={3} fill={KIND_COLOR.volume} />
                      <text x={26} y={11} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff" letterSpacing="0.6">
                        START
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Caption inside canvas, bottom-left */}
        <div className="pointer-events-none absolute bottom-1.5 left-2 right-2 text-[10px] text-slate-500 dark:text-slate-400">
          Data flows left → right, converging on the start job <span className="font-mono">{summary.start_uid}</span>.
        </div>

        {/* Selected node detail popover */}
        {selectedDetail && (
          <div className="absolute bottom-7 right-2 w-[260px] max-w-[88%] rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] font-bold text-slate-800 dark:text-slate-100">{selectedDetail.node.uid}</span>
              {selectedUid === summary.start_uid && (
                <Badge className="bg-teal-100 px-1 py-0 text-[8px] text-teal-700 hover:bg-teal-100 dark:bg-teal-900/50 dark:text-teal-300">START</Badge>
              )}
              {selectedDetail.dist != null && selectedDetail.dist >= 1 && (
                <Badge variant="outline" className="px-1 py-0 text-[8px] font-mono">{selectedDetail.dist} hop{selectedDetail.dist > 1 ? "s" : ""}</Badge>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">{selectedDetail.node.job_type}</div>
            {selectedDetail.node.title && (
              <div className="mt-0.5 truncate text-[10px] text-slate-400" title={selectedDetail.node.title}>{selectedDetail.node.title}</div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-slate-500 dark:text-slate-400">
              {selectedDetail.node.particle_count != null && (
                <span>Particles: {selectedDetail.node.particle_count.toLocaleString()}</span>
              )}
              {selectedDetail.node.micrograph_count != null && (
                <span>Mics: {selectedDetail.node.micrograph_count.toLocaleString()}</span>
              )}
              {selectedDetail.node.volume_count != null && (
                <span>Maps: {selectedDetail.node.volume_count}</span>
              )}
              {selectedDetail.node.resolution_A != null && (
                <span>Res: {selectedDetail.node.resolution_A}Å</span>
              )}
            </div>
            <div className="mt-1.5 border-t border-slate-100 pt-1 text-[9.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {selectedDetail.ancestorCount} upstream ancestor node{selectedDetail.ancestorCount === 1 ? "" : "s"}
              {" \u00B7 "}{selectedDetail.downEdges} edge{selectedDetail.downEdges === 1 ? "" : "s"} to start
            </div>
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
        {layout.nodes.length} jobs · {layout.edges.length} data links · hover/click a node to trace its upstream→start path · drag to pan · scroll/buttons to zoom
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex h-3 w-4 items-center">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      </span>
      <span>{label}</span>
    </span>
  );
}
