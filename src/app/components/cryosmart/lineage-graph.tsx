"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ZoomIn, ZoomOut, Download, Maximize2, RotateCcw } from "lucide-react";
import type { LineageSummary, LineageNode } from "@/lib/cryosmart/types";

interface Props {
  summary: LineageSummary;
}

/**
 * Interactive lineage DAG renderer.
 * Lays out nodes in topological layers (micrographs → pickers → 2D → 3D → refine).
 * Edges color-coded by kind (particle / volume / exposure / parent).
 * Pan + zoom + click-to-highlight. Export to PNG via canvas.
 */

type NodeKind = "exposure" | "particle" | "volume" | "other";

function classify(node: LineageNode): NodeKind {
  if (node.volume_count != null || /refine|abinit|volume|class_3D/i.test(node.job_type || "")) return "volume";
  if (node.particle_count != null || /particle|picker|topaz/i.test(node.job_type || "")) return "particle";
  if (node.micrograph_count != null || /micrograph|ctf|exposure/i.test(node.job_type || "")) return "exposure";
  return "other";
}

const KIND_COLOR: Record<NodeKind, string> = {
  exposure: "#06b6d4", // cyan
  particle: "#10b981", // emerald
  volume: "#0d9488",   // teal
  other: "#64748b",    // slate
};

const KIND_LABEL: Record<NodeKind, string> = {
  exposure: "Micrograph",
  particle: "Particle",
  volume: "Map",
  other: "Other",
};

/** Topological layer assignment by job type (simple heuristic). */
function layerOf(node: LineageNode): number {
  const t = node.job_type || "";
  if (/import_movies|import_micrographs/i.test(t)) return 0;
  if (/motion_correction|patch_motion/i.test(t)) return 1;
  if (/ctf/i.test(t)) return 2;
  if (/picker|topaz/i.test(t)) return 3;
  if (/extract_micrographs|extract/i.test(t)) return 4;
  if (/class_2D|select_2D|rebalance/i.test(t)) return 5;
  if (/abinit|ab_initio/i.test(t)) return 6;
  if (/refine/i.test(t)) return 7;
  if (/class_3D|hetero/i.test(t)) return 7;
  return 4;
}

const NODE_W = 96;
const NODE_H = 40;
const LAYER_X = 150;
const LAYER_Y = 70;

export function LineageGraph({ summary }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const { nodes, edges, layout, bounds } = useMemo(() => {
    const nodes = summary.nodes || [];
    const edges = summary.edges || [];
    // Group nodes by layer.
    const byLayer = new Map<number, LineageNode[]>();
    for (const n of nodes) {
      const l = layerOf(n);
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n);
    }
    // Assign coordinates.
    const layout = new Map<string, { x: number; y: number; layer: number }>();
    const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);
    for (const layer of sortedLayers) {
      const layerNodes = byLayer.get(layer)!;
      layerNodes.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));
      layerNodes.forEach((n, i) => {
        layout.set(n.uid, {
          x: layer * LAYER_X,
          y: i * LAYER_Y,
          layer,
        });
      });
    }
    let maxX = 0, maxY = 0;
    for (const pos of layout.values()) {
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }
    return { nodes, edges, layout, bounds: { w: maxX + NODE_W + 40, h: maxY + NODE_H + 40 } };
  }, [summary]);

  const edgeKinds = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      const k = e.kind || e.input_type || "parent";
      m.set(`${e.source}->${e.target}`, k);
    }
    return m;
  }, [edges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LineageNode>();
    for (const n of nodes) m.set(n.uid, n);
    return m;
  }, [nodes]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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

  const exportPng = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    // Serialize SVG → PNG via canvas.
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bounds.w * 2; // 2x for retina
      canvas.height = bounds.h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
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
  }, [bounds, summary]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const highlightUid = hoveredUid || selectedUid;
  const connectedSet = useMemo(() => {
    if (!highlightUid) return null;
    const set = new Set<string>([highlightUid]);
    for (const e of edges) {
      if (e.source === highlightUid) set.add(e.target);
      if (e.target === highlightUid) set.add(e.source);
    }
    return set;
  }, [highlightUid, edges]);

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))} title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetView} title="Reset view">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="px-1.5 font-mono text-[10px] text-slate-500">{Math.round(zoom * 100)}%</span>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={exportPng}>
          <Download className="mr-1 h-3 w-3" /> Export PNG
        </Button>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] text-slate-500">
          <LegendDot color={KIND_COLOR.exposure} label="Micrograph" />
          <LegendDot color={KIND_COLOR.particle} label="Particle" />
          <LegendDot color={KIND_COLOR.volume} label="Map" />
        </div>
      </div>

      {/* SVG canvas */}
      <div
        className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/60"
        style={{ height: 420, cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
      >
        <svg
          ref={svgRef}
          width={bounds.w}
          height={bounds.h}
          viewBox={`0 0 ${bounds.w} ${bounds.h}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: dragging ? "none" : "transform 0.1s ease-out",
          }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
            </marker>
          </defs>

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
            const kind = edgeKinds.get(`${e.source}->${e.target}`) || "parent";
            const color = kind === "volume" || kind === "mask" ? KIND_COLOR.volume
              : kind === "exposure" ? KIND_COLOR.exposure
              : kind === "particle" ? KIND_COLOR.particle
              : "#94a3b8";
            const isDim = connectedSet && !(connectedSet.has(e.source) && connectedSet.has(e.target));
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={highlightUid && (e.source === highlightUid || e.target === highlightUid) ? 2 : 1.2}
                strokeOpacity={isDim ? 0.15 : 0.6}
                markerEnd="url(#arrow)"
                style={{ transition: "stroke-opacity 0.2s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = layout.get(node.uid);
            if (!pos) return null;
            const kind = classify(node);
            const color = KIND_COLOR[kind];
            const isStart = node.uid === summary.start_uid;
            const isHovered = node.uid === hoveredUid;
            const isSelected = node.uid === selectedUid;
            const isDim = connectedSet && !connectedSet.has(node.uid);
            return (
              <g
                key={node.uid}
                transform={`translate(${pos.x}, ${pos.y})`}
                style={{ cursor: "pointer", opacity: isDim ? 0.3 : 1, transition: "opacity 0.2s" }}
                onMouseEnter={() => setHoveredUid(node.uid)}
                onMouseLeave={() => setHoveredUid(null)}
                onClick={() => setSelectedUid(isSelected ? null : node.uid)}
              >
                {/* Selection ring */}
                {(isHovered || isSelected) && (
                  <rect
                    x={-3}
                    y={-3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={10}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.5}
                  />
                )}
                {/* Start job glow */}
                {isStart && (
                  <rect
                    x={-2}
                    y={-2}
                    width={NODE_W + 4}
                    height={NODE_H + 4}
                    rx={9}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.5}
                  />
                )}
                {/* Node body */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill={isHovered || isSelected || isStart ? color : "#ffffff"}
                  stroke={color}
                  strokeWidth={isStart ? 2 : 1}
                  className="dark:fill-slate-900"
                  style={isHovered || isSelected || isStart ? {} : { fill: "var(--background, #ffffff)" }}
                />
                {/* UID */}
                <text
                  x={NODE_W / 2}
                  y={16}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill={isHovered || isSelected || isStart ? "#ffffff" : "#1e293b"}
                  className="dark:fill-slate-100"
                >
                  {node.uid}
                </text>
                {/* Job type (truncated) */}
                <text
                  x={NODE_W / 2}
                  y={29}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill={isHovered || isSelected || isStart ? "rgba(255,255,255,0.85)" : "#64748b"}
                  className="dark:fill-slate-400"
                >
                  {(node.job_type || "").slice(0, 16)}
                </text>
                {/* Kind dot */}
                <circle cx={6} cy={6} r={2.5} fill={isHovered || isSelected || isStart ? "#ffffff" : color} />
              </g>
            );
          })}
        </svg>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
            No nodes to display.
          </div>
        )}

        {/* Selected node info popover */}
        {selectedUid && nodeMap.get(selectedUid) && (
          <div className="absolute bottom-2 right-2 max-w-xs rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] font-bold text-slate-800 dark:text-slate-100">{selectedUid}</span>
              {selectedUid === summary.start_uid && (
                <Badge className="bg-teal-100 px-1 py-0 text-[8px] text-teal-700 hover:bg-teal-100">START</Badge>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">{nodeMap.get(selectedUid)?.job_type}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-slate-500 dark:text-slate-400">
              {nodeMap.get(selectedUid)?.particle_count != null && (
                <span>Particles: {nodeMap.get(selectedUid)?.particle_count?.toLocaleString()}</span>
              )}
              {nodeMap.get(selectedUid)?.resolution_A != null && (
                <span>Res: {nodeMap.get(selectedUid)?.resolution_A}Å</span>
              )}
            </div>
            {nodeMap.get(selectedUid)?.title && (
              <div className="mt-1 truncate text-[10px] text-slate-400" title={nodeMap.get(selectedUid)?.title}>
                {nodeMap.get(selectedUid)?.title}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
        {nodes.length} jobs · {edges.length} edges · click a node to highlight connections · drag to pan · use buttons to zoom / export PNG
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
