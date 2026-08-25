"use client";

/**
 * Interactive lineage DAG renderer — BFS-distance redesign.
 *
 * Layout: nodes are placed in columns by their upstream BFS distance from
 * `summary.start_uid` (distance 0 = start). The most-upstream (oldest) jobs
 * sit on the LEFT, the START job sits on the FAR RIGHT, so data visibly
 * converges rightward onto the start. Each column carries an axis label
 * "↑ N hops upstream / {stage}" (or "START · 目标 / destination" for the
 * start column, or "Disconnected / {stage}" for unreachable nodes).
 *
 * Interactivity:
 *  - Hover a node to highlight its full upstream→start path (ancestors ∪
 *    downstream-to-start). Non-connected nodes dim to 22 %, edges to 10 %.
 *  - Click toggles pinned selection (sky-500 ring). Selection persists
 *    until the same node is clicked again.
 *  - Pan by dragging the canvas background (not on nodes); zoom via
 *    buttons (+/-15 %), wheel (non-passive so the page does not scroll),
 *    Maximize2 fit-to-view, RotateCcw reset.
 *  - Export PNG (2× retina) / SVG (vector with theme background).
 *
 * The component is fully self-contained — no new files, no new packages.
 * It reuses only `@/components/ui/{button,badge}`, `next-themes`,
 * `lucide-react`, and types from `@/lib/cryosmart/types`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Download,
  Target,
  FileCode2,
} from "lucide-react";
import type { LineageEdge, LineageNode, LineageSummary } from "@/lib/cryosmart/types";

interface Props {
  summary: LineageSummary;
}

/* ── Layout constants ─────────────────────────────────────────────────── */
const NODE_W = 168;
const NODE_H = 70;
const LAYER_X = 224;
const LAYER_Y = 104;
const PAD = 24;
const TOP_AXIS_H = 46;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;

/* ── Node / edge families ──────────────────────────────────────────────── */
type NodeFamily = "exposure" | "particle" | "volume" | "other";

function classify(node: LineageNode): NodeFamily {
  const t = node.job_type || "";
  if (node.volume_count != null || /refine|abinit|volume|class_3D/i.test(t)) return "volume";
  if (node.particle_count != null || /particle|picker|topaz/i.test(t)) return "particle";
  if (node.micrograph_count != null || /micrograph|ctf|exposure/i.test(t)) return "exposure";
  return "other";
}

const FAMILY_COLOR: Record<NodeFamily, string> = {
  exposure: "#06b6d4", // cyan
  particle: "#f59e0b", // amber
  volume:   "#0d9488", // teal
  other:    "#64748b", // slate
};

const FAMILY_LABEL: Record<NodeFamily, string> = {
  exposure: "Micrograph",
  particle: "Particle",
  volume:   "Map",
  other:    "Other",
};

type EdgeFam = "exposure" | "particle" | "volume" | "other";

function edgeFamily(edge: LineageEdge): EdgeFam {
  const k = (edge.kind || edge.input_type || "parent").toLowerCase();
  if (k === "mask" || k === "volume" || k === "template" || k === "ml_model" || k === "model") return "volume";
  if (k === "exposure" || k === "micrograph") return "exposure";
  if (k === "particle") return "particle";
  return "other";
}

const EDGE_COLOR: Record<EdgeFam, string> = {
  exposure: "#06b6d4",
  particle: "#f59e0b",
  volume:   "#0d9488",
  other:    "#64748b",
};

const EDGE_MARKER: Record<EdgeFam, string> = {
  exposure: "arrow-exposure",
  particle: "arrow-particle",
  volume:   "arrow-volume",
  other:    "arrow-other",
};

/* ── BFS upstream distance (target → source; source is the upstream producer) */
function computeUpstreamDistances(
  edges: LineageEdge[],
  startUid: string,
): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(startUid, 0);
  const reverse = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    if (!reverse.has(e.target)) reverse.set(e.target, []);
    reverse.get(e.target)!.push(e.source);
  }
  const queue: string[] = [startUid];
  const visited = new Set<string>([startUid]);
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur) ?? 0;
    for (const s of reverse.get(cur) || []) {
      if (visited.has(s)) continue;
      visited.add(s);
      dist.set(s, d + 1);
      queue.push(s);
    }
  }
  return dist;
}

function collectAncestors(uid: string, edges: LineageEdge[]): Set<string> {
  const result = new Set<string>([uid]);
  const reverse = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    if (!reverse.has(e.target)) reverse.set(e.target, []);
    reverse.get(e.target)!.push(e.source);
  }
  const stack = [uid];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of reverse.get(cur) || []) {
      if (!result.has(s)) {
        result.add(s);
        stack.push(s);
      }
    }
  }
  return result;
}

function collectDownstream(uid: string, edges: LineageEdge[]): Set<string> {
  const result = new Set<string>([uid]);
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    if (!forward.has(e.source)) forward.set(e.source, []);
    forward.get(e.source)!.push(e.target);
  }
  const stack = [uid];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const t of forward.get(cur) || []) {
      if (!result.has(t)) {
        result.add(t);
        stack.push(t);
      }
    }
  }
  return result;
}

/* ── Display helpers ──────────────────────────────────────────────────── */
function stageLabel(node: LineageNode): string {
  const t = node.job_type || "";
  if (/import_movies|import_micrographs/i.test(t)) return "import";
  if (/motion_correction|patch_motion/i.test(t)) return "motion";
  if (/ctf/i.test(t)) return "CTF";
  if (/picker|topaz/i.test(t)) return "picker";
  if (/extract/i.test(t)) return "extract";
  if (/class_2D|select_2D|rebalance/i.test(t)) return "2D";
  if (/abinit|ab_initio/i.test(t)) return "abinit";
  if (/homo_refine|homo_reconstruct/i.test(t)) return "refine";
  if (/hetero_refine/i.test(t)) return "hetero";
  if (/nonuniform|local_refine/i.test(t)) return "local refine";
  if (/class_3D/i.test(t)) return "3D";
  return t.slice(0, 14) || "—";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

/** Returns a single-line "particles · mics · maps · resolution Å" string. */
function formatMetrics(node: LineageNode): string {
  const parts: string[] = [];
  if (node.particle_count != null) parts.push(`${fmtCount(node.particle_count)} parts`);
  if (node.micrograph_count != null) parts.push(`${fmtCount(node.micrograph_count)} mics`);
  if (node.volume_count != null && node.volume_count > 0) {
    parts.push(`${node.volume_count} map${node.volume_count === 1 ? "" : "s"}`);
  }
  if (node.resolution_A != null) parts.push(`${node.resolution_A.toFixed(2)}\u00C5`);
  return parts.length ? parts.join(" \u00B7 ") : "no metrics";
}

/* ── Component ────────────────────────────────────────────────────────── */
export function LineageGraph({ summary }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Theme-derived palette (explicit hex so SVG/PNG exports are self-contained).
  const bgColor        = isDark ? "#0b1220" : "#ffffff";
  const textColor      = isDark ? "#e2e8f0" : "#0f172a";
  const mutedColor     = isDark ? "#94a3b8" : "#64748b";
  const gridColor      = isDark ? "#1e293b" : "#e2e8f0";
  const borderColor    = isDark ? "#1e293b" : "#e2e8f0";
  const panelBg        = isDark ? "#0f172a" : "#f8fafc";
  const startColor     = "#0d9488";
  const selectionColor = "#0ea5e9"; // sky-500

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  /* Layout: BFS distance columns, oldest upstream LEFT, START RIGHT. */
  const { nodes, edges, layout, bounds, columns, distMap } = useMemo(() => {
    const nodes = summary.nodes || [];
    const edges = summary.edges || [];
    const distMap = computeUpstreamDistances(edges, summary.start_uid);

    let maxDistance = 0;
    for (const d of distMap.values()) if (d > maxDistance) maxDistance = d;

    const connected = nodes.filter((n) => distMap.has(n.uid));
    const disconnected = nodes.filter((n) => !distMap.has(n.uid));

    const byDist = new Map<number, LineageNode[]>();
    for (const n of connected) {
      const d = distMap.get(n.uid) ?? 0;
      if (!byDist.has(d)) byDist.set(d, []);
      byDist.get(d)!.push(n);
    }
    for (const list of byDist.values()) {
      list.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));
    }
    disconnected.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));

    type ColKind = "disconnected" | "start" | "upstream";
    interface Col { kind: ColKind; distance: number; columnIndex: number; nodes: LineageNode[]; }
    const cols: Col[] = [];
    if (disconnected.length > 0) {
      cols.push({ kind: "disconnected", distance: -1, columnIndex: 0, nodes: disconnected });
    }
    // Walk distance from maxDistance down to 0 so older jobs come first.
    for (let d = maxDistance; d >= 0; d--) {
      const list = byDist.get(d) || [];
      if (list.length === 0) continue;
      cols.push({
        kind: d === 0 ? "start" : "upstream",
        distance: d,
        columnIndex: 0,
        nodes: list,
      });
    }
    cols.forEach((c, i) => { c.columnIndex = i; });

    const layout = new Map<string, { x: number; y: number; columnIndex: number; distance: number; row: number }>();
    let maxRows = 0;
    for (const c of cols) if (c.nodes.length > maxRows) maxRows = c.nodes.length;
    const tallestColHeight = maxRows * LAYER_Y;
    const topOffset = TOP_AXIS_H + PAD;
    for (const c of cols) {
      const colHeight = c.nodes.length * LAYER_Y;
      const startY = topOffset + (tallestColHeight - colHeight) / 2;
      c.nodes.forEach((n, i) => {
        layout.set(n.uid, {
          x: PAD + c.columnIndex * LAYER_X,
          y: startY + i * LAYER_Y,
          columnIndex: c.columnIndex,
          distance: c.distance,
          row: i,
        });
      });
    }

    let maxX = PAD;
    for (const pos of layout.values()) {
      if (pos.x + NODE_W > maxX) maxX = pos.x + NODE_W;
    }
    const totalWidth = Math.max(maxX + PAD, cols.length * LAYER_X + PAD, PAD * 2);
    const totalHeight = topOffset + tallestColHeight + NODE_H + PAD;

    return { nodes, edges, layout, bounds: { w: totalWidth, h: totalHeight }, columns: cols, distMap };
  }, [summary]);

  /* Highlight set — full upstream→start path through the hovered/selected node. */
  const highlightUid = hoveredUid ?? selectedUid;
  const highlightSet = useMemo(() => {
    if (!highlightUid) return null;
    const anc = collectAncestors(highlightUid, edges);
    const down = collectDownstream(highlightUid, edges);
    return new Set<string>([...anc, ...down]);
  }, [highlightUid, edges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LineageNode>();
    for (const n of nodes) m.set(n.uid, n);
    return m;
  }, [nodes]);

  /* Pan via mouse drag on the canvas background (not on nodes). */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element | null)?.closest("[data-node]")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = pan.x;
    const startPanY = pan.y;
    setDragging(true);
    const move = (ev: MouseEvent) => {
      setPan({ x: startPanX + (ev.clientX - startX), y: startPanY + (ev.clientY - startY) });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [pan.x, pan.y]);

  /* Wheel zoom (non-passive so preventDefault stops page scroll). */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only intercept vertical wheel to zoom (horizontal wheel passes through).
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => {
        const nz = z * (1 + delta);
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* Fit-to-view: zoom so the whole graph fits in the container. */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0 || bounds.w === 0 || bounds.h === 0) {
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      return;
    }
    const z = Math.min(cw / bounds.w, ch / bounds.h);
    const safeZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    setZoom(safeZ);
    setPan({ x: 0, y: 0 });
  }, [bounds.w, bounds.h]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* Auto-fit on mount + when summary/bounds change.
   *
   * `fitToView` calls setZoom/setPan synchronously, which normally trips the
   * react-hooks/set-state-in-effect rule. This is the canonical "fit-to-view
   * on layout change" pattern (not a cascading render — fitToView only runs
   * when its own identity changes, which only happens when bounds.w/h change
   * i.e. when summary changes). The explicit disable mirrors the established
   * pattern used in sibling components. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fitToView();
  }, [fitToView]);

  /* PNG export — canvas-based, 2× retina, theme-colored background. */
  const exportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bounds.w * 2));
      canvas.height = Math.max(1, Math.round(bounds.h * 2));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = bgColor;
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
  }, [bounds.w, bounds.h, bgColor, summary.project_uid, summary.start_uid]);

  /* SVG export — clone, insert background <rect>, serialize, download. */
  const exportSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(bounds.w));
    bg.setAttribute("height", String(bounds.h));
    bg.setAttribute("fill", bgColor);
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_graph.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bounds.w, bounds.h, bgColor, summary.project_uid, summary.start_uid]);

  /* Keyboard support for SVG nodes (Enter / Space toggles selection). */
  const onKeyDownNode = useCallback((e: React.KeyboardEvent, uid: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedUid((cur) => (cur === uid ? null : uid));
    }
  }, []);

  /* Captions (JS string literals — use \u00XX escapes for special chars). */
  const inCanvasCaption = `Data flows left \u2192 right, converging on the start job \`${summary.start_uid}\`.`;
  const belowCanvasCaption = `${nodes.length} jobs \u00B7 ${edges.length} data links \u00B7 hover/click a node to trace its upstream\u2192start path \u00B7 drag to pan \u00B7 scroll/buttons to zoom`;

  const selectedNode = selectedUid ? nodeMap.get(selectedUid) ?? null : null;
  const selectedDist = selectedUid ? distMap.get(selectedUid) ?? null : null;
  const selectedUpstreamCount = selectedUid
    ? Math.max(0, collectAncestors(selectedUid, edges).size - 1)
    : 0;
  const selectedDownstreamEdgeCount = selectedUid
    ? edges.filter((e) => e.source === selectedUid && distMap.has(e.target)).length
    : 0;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded-md border p-0.5"
          style={{ borderColor, background: panelBg }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.15))}
            title="Zoom in (+15%)"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.15))}
            title="Zoom out (-15%)"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fitToView}
            title="Fit to view"
            aria-label="Fit to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={resetView}
            title="Reset view"
            aria-label="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span
            className="px-1.5 font-mono text-[10px]"
            style={{ color: mutedColor }}
          >
            {Math.round(zoom * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={exportPng}
            title="Export as raster PNG (2× retina)"
          >
            <Download className="mr-1 h-3 w-3" /> PNG
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={exportSvg}
            title="Export as vector SVG (scalable, editable)"
          >
            <FileCode2 className="mr-1 h-3 w-3" /> SVG
          </Button>
        </div>
        {/* Legend */}
        <div
          className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]"
          style={{ color: mutedColor }}
        >
          <LegendDot color={FAMILY_COLOR.exposure} label={FAMILY_LABEL.exposure} />
          <LegendDot color={FAMILY_COLOR.particle} label={FAMILY_LABEL.particle} />
          <LegendDot color={FAMILY_COLOR.volume}   label={FAMILY_LABEL.volume} />
          <LegendDot color={FAMILY_COLOR.other}    label={FAMILY_LABEL.other} />
          <span className="inline-flex items-center gap-1">
            <Target className="h-3 w-3" style={{ color: startColor }} />
            Start job
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border"
        style={{
          height: 480,
          cursor: dragging ? "grabbing" : "grab",
          borderColor,
          background: bgColor,
        }}
        onMouseDown={handleMouseDown}
      >
        <span className="sr-only">
          Lineage graph: {nodes.length} jobs and {edges.length} data links. Start job is {summary.start_uid}. Data flows from the leftmost (oldest) jobs rightward, converging on the start job on the far right. Use Tab to focus a node and Enter or Space to toggle its selection.
        </span>
        <svg
          ref={svgRef}
          width={bounds.w}
          height={bounds.h}
          viewBox={`0 0 ${bounds.w} ${bounds.h}`}
          role="img"
          aria-label={`Lineage graph of ${nodes.length} jobs converging on start job ${summary.start_uid}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: dragging ? "none" : "transform 0.15s ease-out",
            display: "block",
          }}
        >
          <defs>
            {/* START glow halo */}
            <filter id="start-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            {/* Per-family arrowhead markers (refX=9 so tip lands ~1px past path end). */}
            {(["exposure", "particle", "volume", "other"] as EdgeFam[]).map((f) => (
              <marker
                key={f}
                id={EDGE_MARKER[f]}
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill={EDGE_COLOR[f]} />
              </marker>
            ))}
          </defs>

          {/* Background */}
          <rect width={bounds.w} height={bounds.h} fill={bgColor} />

          {/* In-canvas caption */}
          <text
            x={PAD}
            y={16}
            fontSize={11}
            fill={mutedColor}
            style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
          >
            {inCanvasCaption}
          </text>

          {/* Axis labels + column guides */}
          {columns.map((col) => {
            const cx = PAD + col.columnIndex * LAYER_X + NODE_W / 2;
            let label: string;
            if (col.kind === "start") {
              label = "START \u00B7 \u76EE\u6807 / destination";
            } else if (col.kind === "disconnected") {
              label = `Disconnected / ${stageLabel(col.nodes[0])}`;
            } else {
              label = `\u2191 ${col.distance} hop${col.distance === 1 ? "" : "s"} upstream / ${stageLabel(col.nodes[0])}`;
            }
            const isStart = col.kind === "start";
            return (
              <g key={`col-${col.columnIndex}`}>
                <text
                  x={cx}
                  y={TOP_AXIS_H}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={isStart ? 700 : 500}
                  fill={isStart ? startColor : mutedColor}
                >
                  {label}
                </text>
                <line
                  x1={cx}
                  y1={TOP_AXIS_H + 6}
                  x2={cx}
                  y2={bounds.h - PAD}
                  stroke={isStart ? startColor : gridColor}
                  strokeWidth={isStart ? 1.2 : 1}
                  strokeDasharray={isStart ? undefined : "3 4"}
                  strokeOpacity={isStart ? 0.7 : 0.5}
                />
              </g>
            );
          })}

          {/* Edges */}
          {edges.map((e, i) => {
            const from = layout.get(e.source);
            const to = layout.get(e.target);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const midX = (x1 + x2) / 2;
            const fam = edgeFamily(e);
            const color = EDGE_COLOR[fam];
            const isHi = !!highlightUid && (e.source === highlightUid || e.target === highlightUid);
            const isDim = !!highlightSet && !(highlightSet.has(e.source) && highlightSet.has(e.target));
            const opacity = isDim ? 0.1 : isHi ? 1 : 0.65;
            const strokeWidth = isHi ? 2.6 : 2;
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeOpacity={opacity}
                markerEnd={`url(#${EDGE_MARKER[fam]})`}
                style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = layout.get(node.uid);
            if (!pos) return null;
            const family = classify(node);
            const color = FAMILY_COLOR[family];
            const isStart = node.uid === summary.start_uid;
            const isHovered = node.uid === hoveredUid;
            const isSelected = node.uid === selectedUid;
            const isDim = !!highlightSet && !highlightSet.has(node.uid);
            const dist = distMap.get(node.uid);
            const distLabel = dist == null ? null : `${dist}h`;
            const ariaLabel = isStart
              ? `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, start job`
              : dist == null
                ? `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, disconnected from start`
                : `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, ${dist} hop${dist === 1 ? "" : "s"} upstream / start job`;
            return (
              <g
                key={node.uid}
                data-node=""
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                transform={`translate(${pos.x}, ${pos.y})`}
                style={{
                  cursor: "pointer",
                  opacity: isDim ? 0.22 : 1,
                  transition: "opacity 0.2s",
                  outline: "none",
                }}
                onMouseEnter={() => setHoveredUid(node.uid)}
                onMouseLeave={() => setHoveredUid(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelectedUid(isSelected ? null : node.uid);
                }}
                onKeyDown={(ev) => onKeyDownNode(ev, node.uid)}
              >
                {/* START glow halo (behind everything else) */}
                {isStart && (
                  <rect
                    x={-6}
                    y={-6}
                    width={NODE_W + 12}
                    height={NODE_H + 12}
                    rx={10}
                    fill={startColor}
                    opacity={0.35}
                    filter="url(#start-glow)"
                  />
                )}
                {/* Selection ring */}
                {isSelected && (
                  <rect
                    x={-3}
                    y={-3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={9}
                    fill="none"
                    stroke={selectionColor}
                    strokeWidth={2}
                  />
                )}
                {/* Hover ring (only when not selected) */}
                {isHovered && !isSelected && (
                  <rect
                    x={-3}
                    y={-3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={9}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                  />
                )}
                {/* START inner ring */}
                {isStart && (
                  <rect
                    x={-1.5}
                    y={-1.5}
                    width={NODE_W + 3}
                    height={NODE_H + 3}
                    rx={8}
                    fill="none"
                    stroke={startColor}
                    strokeWidth={1.5}
                  />
                )}
                {/* Node body */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={bgColor}
                  stroke={isStart ? startColor : gridColor}
                  strokeWidth={isStart ? 1.5 : 1}
                />
                {/* Left color bar */}
                <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={color} />
                {/* UID */}
                <text
                  x={14}
                  y={22}
                  fontSize={13}
                  fontWeight={700}
                  fill={textColor}
                  style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                >
                  {node.uid}
                </text>
                {/* Job type */}
                <text
                  x={14}
                  y={38}
                  fontSize={10.5}
                  fill={mutedColor}
                >
                  {truncate(node.job_type || "", 26)}
                </text>
                {/* Metrics row */}
                <text
                  x={14}
                  y={56}
                  fontSize={10}
                  fill={textColor}
                  style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                >
                  {formatMetrics(node)}
                </text>
                {/* Distance pill (non-start only) */}
                {!isStart && distLabel && (
                  <g transform={`translate(${NODE_W - 32}, 6)`}>
                    <rect width={26} height={14} rx={7} fill={color} opacity={0.18} />
                    <text
                      x={13}
                      y={11}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill={color}
                      style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                    >
                      {distLabel}
                    </text>
                  </g>
                )}
                {/* START badge above start node */}
                {isStart && (
                  <g transform={`translate(${NODE_W / 2 - 28}, -22)`}>
                    <rect width={56} height={16} rx={8} fill={startColor} />
                    <text
                      x={28}
                      y={11.5}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={800}
                      fill="#ffffff"
                      style={{ letterSpacing: "0.6px" }}
                    >
                      START
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center text-[12px]"
            style={{ color: mutedColor }}
          >
            No lineage nodes to display.
          </div>
        )}

        {/* Detail popover */}
        {selectedNode && (
          <DetailPopover
            node={selectedNode}
            isStart={selectedUid === summary.start_uid}
            dist={selectedDist}
            upstreamCount={selectedUpstreamCount}
            downstreamEdgeCount={selectedDownstreamEdgeCount}
            family={classify(selectedNode)}
            bgColor={bgColor}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            startColor={startColor}
            onClose={() => setSelectedUid(null)}
          />
        )}
      </div>
      {/* Below-canvas caption */}
      <div className="text-[10.5px]" style={{ color: mutedColor }}>
        {belowCanvasCaption}
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────────── */

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

interface DetailPopoverProps {
  node: LineageNode;
  isStart: boolean;
  dist: number | null;
  upstreamCount: number;
  downstreamEdgeCount: number;
  family: NodeFamily;
  bgColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  startColor: string;
  onClose: () => void;
}

function DetailPopover({
  node,
  isStart,
  dist,
  upstreamCount,
  downstreamEdgeCount,
  family,
  bgColor,
  textColor,
  mutedColor,
  borderColor,
  startColor,
  onClose,
}: DetailPopoverProps) {
  const color = FAMILY_COLOR[family];
  return (
    <div
      className="absolute bottom-2 right-2 rounded-lg border p-2.5 shadow-lg"
      style={{
        width: 260,
        background: bgColor,
        color: textColor,
        borderColor,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[12px] font-bold" style={{ color: textColor }}>
          {node.uid}
        </span>
        {isStart ? (
          <Badge
            className="px-1 py-0 text-[8px] font-bold"
            style={{ backgroundColor: startColor, color: "#ffffff", border: "none" }}
          >
            START
          </Badge>
        ) : dist != null ? (
          <Badge
            variant="outline"
            className="px-1 py-0 text-[8px] font-bold"
            style={{ color, borderColor: color }}
          >
            {dist} hop{dist === 1 ? "" : "s"}
          </Badge>
        ) : null}
        <button
          type="button"
          className="ml-auto text-[14px] leading-none"
          style={{ color: mutedColor }}
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>
      <div className="mt-0.5 font-mono text-[10px]" style={{ color: mutedColor }}>
        {node.job_type}
      </div>
      {node.title && (
        <div
          className="mt-0.5 truncate text-[10px]"
          style={{ color: mutedColor }}
          title={node.title}
        >
          {node.title}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]" style={{ color: mutedColor }}>
        {node.particle_count != null && (
          <span>Particles: {node.particle_count.toLocaleString()}</span>
        )}
        {node.micrograph_count != null && (
          <span>Mics: {node.micrograph_count.toLocaleString()}</span>
        )}
        {node.volume_count != null && (
          <span>Maps: {node.volume_count}</span>
        )}
        {node.resolution_A != null && (
          <span>Res: {node.resolution_A.toFixed(2)} Å</span>
        )}
      </div>
      <div className="mt-1 text-[9.5px]" style={{ color: mutedColor }}>
        {upstreamCount} upstream ancestor node{upstreamCount === 1 ? "" : "s"} · {downstreamEdgeCount} edge{downstreamEdgeCount === 1 ? "" : "s"} toward start
      </div>
    </div>
  );
}
