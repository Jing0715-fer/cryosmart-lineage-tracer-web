"use client";

/**
 * Interactive lineage DAG renderer — topological-depth + n8n-style routing.
 *
 * Layout: nodes are placed in columns by their longest-path depth from any
 * leaf (depth 0 = oldest / import job on the LEFT, maxDepth = start_uid on
 * the FAR RIGHT). Using longest-path depth instead of BFS shortest-path
 * guarantees every edge goes from lower-depth → higher-depth = LEFT → RIGHT,
 * so there are NEVER any backward (left-pointing) arrows — even when there
 * are diamond dependencies or multi-path merges that BFS would have
 * collapsed into a single shortest path.
 *
 * Edges: n8n-style routing. Lines never pass through cards:
 *   - Same / adjacent column: smooth bezier whose control points are pulled
 *     horizontally into the column-gap, so the curve lives entirely inside
 *     the gap (it never overlaps any card in either column).
 *   - Multi-column (long-range): orthogonal Manhattan route that exits the
 *     source rightward, climbs into a "free lane" above all cards, runs
 *     horizontally across, drops down to the target row, and re-enters the
 *     target leftward. Vertical segments live in column gaps; the horizontal
 *     segment lives in the lane above the cards. No card is ever crossed.
 *
 * START badge: placed on the upstream-most node(s) — depth-0 leaves on the
 * FAR LEFT (i.e., the jobs where data flow BEGINS). The start_uid node on
 * the far right is labeled "TARGET" (the destination / trace target)
 * instead. The legend + axis labels reflect this.
 *
 * Detail Mode (toolbar toggle): when ON, cards grow taller and render a
 * thumbnail of the node's first preview image directly inside the card
 * (CryoSPARC-style inline image previews).
 *
 * Click a card: opens a full NodeDetailModal with all node info, output
 * groups, image gallery, maps list, classes table, and incoming/outgoing
 * edges — mirroring the report section's per-node card. When a live
 * CryoSmart session is available, images are pre-fetched as base64 data
 * URLs for self-contained display (no referrer/CORS issues).
 *
 * The component reuses @/components/ui/{button,badge,dialog,scroll-area},
 * next-themes, lucide-react, and types from @/lib/cryosmart/types. It also
 * uses the optional `imageToBase64` helper from @/lib/cryosmart/image-embed
 * when a session is supplied (for inline image embedding in detail mode).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Download,
  Target,
  FileCode2,
  ImageIcon,
  X,
  ExternalLink,
  Play,
  ArrowRight,
  ArrowDown,
  Layers,
  WrapText,
} from "lucide-react";
import type {
  ClassSplit,
  ImageAsset,
  LineageEdge,
  LineageNode,
  LineageSummary,
  MapAsset,
} from "@/lib/cryosmart/types";
import type { CryoSmartSession } from "@/lib/cryosmart/proxy-client";

interface Props {
  summary: LineageSummary;
  /** Optional CryoSmart live session — when present, the detail-mode
   *  thumbnails + modal gallery pre-fetch images as base64 data URLs so
   *  they render self-contained (no remote/referrer/CORS issues). When
   *  absent, images fall back to the remote URL with referrerPolicy =
   *  "no-referrer" (works in the browser, may fail inside sandboxed
   *  iframes but is fine for the modal which renders in the top window). */
  session?: CryoSmartSession | null;
}

/* ── Layout constants ─────────────────────────────────────────────────── */
const NODE_W = 208;
const NODE_H_COMPACT = 84;
const NODE_H_DETAIL = 188;
const LAYER_X = 280;
const LAYER_Y_COMPACT = 116;
const LAYER_Y_DETAIL = 212;
const PAD = 28;
const TOP_AXIS_H = 50;
const TOP_LANE_H = 36; // "free lane" above cards for long-range orthogonal edges
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
// Wrap layout: max canvas width (the SVG width is capped so the layout
// fits a typical desktop viewport without horizontal scrolling). When
// the column count would exceed this width, columns wrap to a new row.
const WRAP_MAX_WIDTH = 1280;
// Vertical gap between wrap rows — leaves room for cross-row edge routing.
const WRAP_ROW_GAP = 56;
// Per-row axis header height in wrap mode (so each row can show its own
// depth label band without overlapping the row above's edges).
const WRAP_ROW_AXIS_H = 22;

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
  exposure: "#0891b2", // cyan-600
  particle: "#d97706", // amber-600
  volume:   "#0d9488", // teal-600
  other:    "#475569", // slate-600
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
  exposure: "#0891b2",
  particle: "#d97706",
  volume:   "#0d9488",
  other:    "#475569",
};

const EDGE_MARKER: Record<EdgeFam, string> = {
  exposure: "arrow-exposure",
  particle: "arrow-particle",
  volume:   "arrow-volume",
  other:    "arrow-other",
};

/* ── Longest-path depth: depth(N) = max(depth(P)+1) over P→N edges.
 * Guarantee: for every edge P→N, depth(P) < depth(N) (so P is strictly
 * LEFT of N in the column layout). This eliminates backward arrows
 * structurally — no special-casing needed. */
function computeLongestPathDepths(
  edges: LineageEdge[],
  startUid: string,
): Map<string, number> {
  const depth = new Map<string, number>();
  // Adjacency: incoming[P] = list of nodes that have an edge P→N.
  // For longest-path, we need a topological order; do it iteratively.
  // First, identify all nodes reachable from start_uid by walking edges
  // in REVERSE (i.e., collect the connected component containing start).
  const reverseAdj = new Map<string, string[]>();
  const forwardAdj = new Map<string, string[]>();
  const allNodes = new Set<string>([startUid]);
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    allNodes.add(e.source);
    allNodes.add(e.target);
    if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
    reverseAdj.get(e.target)!.push(e.source);
    if (!forwardAdj.has(e.source)) forwardAdj.set(e.source, []);
    forwardAdj.get(e.source)!.push(e.target);
  }

  // Connected component (reverse-reachable from start_uid): these are the
  // nodes for which a path to start_uid exists. Only these get a depth.
  const connected = new Set<string>([startUid]);
  const queue = [startUid];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s of reverseAdj.get(cur) || []) {
      if (!connected.has(s)) {
        connected.add(s);
        queue.push(s);
      }
    }
  }

  // Initialize depth = 0 for all connected leaves (nodes with no incoming
  // edges within the connected subgraph).
  for (const uid of connected) {
    const incomings = (reverseAdj.get(uid) || []).filter((s) => connected.has(s));
    if (incomings.length === 0) depth.set(uid, 0);
  }
  // If start_uid itself has no incoming edges (rare), depth 0 too.
  if (!depth.has(startUid) && (reverseAdj.get(startUid) || []).filter((s) => connected.has(s)).length === 0) {
    depth.set(startUid, 0);
  }

  // Kahn-style topological longest-path propagation. Repeat until no
  // depth changes (handles DAGs even with diamond merges).
  // For efficiency, process in topological order; here we do a fixed-point
  // iteration that is O(V*E) but V is small (<500 nodes in practice).
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const uid of connected) {
      const incomings = (reverseAdj.get(uid) || []).filter((s) => connected.has(s));
      if (incomings.length === 0) continue;
      let maxDepth = -1;
      for (const s of incomings) {
        const d = depth.get(s);
        if (d != null && d > maxDepth) maxDepth = d;
      }
      if (maxDepth >= 0) {
        const newDepth = maxDepth + 1;
        if (depth.get(uid) !== newDepth) {
          depth.set(uid, newDepth);
          changed = true;
        }
      }
    }
  }
  return depth;
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

function plainDateStr(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 19).replace("T", " ");
  if (typeof v === "object" && "$date" in (v as Record<string, unknown>)) {
    const d = (v as { $date: string | number }).$date;
    if (typeof d === "string") return d.replace("T", " ").slice(0, 19);
    if (typeof d === "number") return new Date(d).toISOString().slice(0, 19).replace("T", " ");
  }
  return String(v);
}

/**
 * Append session cookie / auth to a `/api/proxy-image/<fileid>?base=...`
 * URL produced by `logImageUrl` in `lineage.ts`. The proxy-image route
 * reads `cookie` and `auth` from its query string and forwards them as
 * `Cookie` / `Authorization` headers to the upstream CryoSmart request
 * — without this, authenticated CryoSmart deployments reject the
 * inline `<img>`/`<image>` request with 401/403, and the user sees a
 * broken-image icon. URLs that are NOT proxy-image URLs (e.g. base64
 * data: URLs, or already-canonical full CryoSmart URLs) are returned
 * unchanged. Runs only at render time so the underlying `node.images` /
 * `node.classes` data stays canonical.
 */
function withSession(url: string | null | undefined, session: CryoSmartSession | null | undefined): string | null {
  if (!url) return null;
  if (typeof window === "undefined") return url;
  if (!url.includes("/api/proxy-image/")) return url;
  if (!session) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (session.cookie) u.searchParams.set("cookie", session.cookie);
    if (session.auth) u.searchParams.set("auth", session.auth);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * Build a same-origin proxy URL `/api/proxy-image/<fileid>?base=...&cookie=...&auth=...`
 * from a direct CryoSmart log_image URL. Used as the `onError` fallback
 * for inline `<img>`/`<image>` so images still render when the browser
 * can't reach CryoSmart directly but the Next.js server can.
 *
 * Returns null if the URL isn't a `/api/log_image/<fileid>` URL or if
 * the session is missing.
 */
function buildProxyFallback(
  directUrl: string | null | undefined,
  session: CryoSmartSession | null | undefined
): string | null {
  if (!directUrl || !session) return null;
  const m = String(directUrl).match(/\/api\/log_image\/([^/?#]+)/);
  if (!m) return null;
  const fileid = m[1];
  const base = String(session.baseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  const params = new URLSearchParams();
  params.set("base", base);
  if (session.cookie) params.set("cookie", session.cookie);
  if (session.auth) params.set("auth", session.auth);
  return `/api/proxy-image/${fileid}?${params.toString()}`;
}

/** Pick the best preview image for a node (used by detail-mode thumbnail). */
function pickPreviewImage(node: LineageNode): ImageAsset | null {
  if (node.images && node.images.length > 0) return node.images[0];
  if (node.representative_micrograph_images && node.representative_micrograph_images.length > 0) {
    return node.representative_micrograph_images[0];
  }
  if (node.select_2d?.selected_classes_src) {
    return {
      kind: "ui_tile",
      name: "selected_classes",
      url: node.select_2d.selected_classes_image || "",
      src: node.select_2d.selected_classes_src,
      original_url: node.select_2d.selected_classes_original_url || "",
    };
  }
  if (node.classes && node.classes.length > 0) {
    const c = node.classes.find((x) => !!x.mrc_preview_src) || node.classes[0];
    if (c?.mrc_preview_src) {
      return {
        kind: "ui_tile",
        name: `class_${c.class_index}`,
        url: c.mrc_preview_url || "",
        src: c.mrc_preview_src,
        original_url: c.mrc_preview_original_url || "",
      };
    }
  }
  if (node.maps && node.maps.length > 0) {
    const m = node.maps.find((x) => !!x.preview_src) || node.maps[0];
    if (m?.preview_src) {
      return {
        kind: "ui_tile",
        name: m.group,
        url: m.preview_url || "",
        src: m.preview_src,
        original_url: m.preview_original_url || "",
      };
    }
  }
  return null;
}

/** Collect ALL preview images for a node (used by the modal gallery). */
function collectAllImages(node: LineageNode): ImageAsset[] {
  const out: ImageAsset[] = [];
  const seen = new Set<string>();
  const push = (img: ImageAsset | null | undefined) => {
    if (!img || !img.src) return;
    if (seen.has(img.src)) return;
    seen.add(img.src);
    out.push(img);
  };
  for (const im of node.images || []) push(im);
  for (const im of node.representative_micrograph_images || []) push(im);
  if (node.select_2d?.selected_classes_src) {
    push({
      kind: "ui_tile",
      name: "selected_classes",
      url: node.select_2d.selected_classes_image || "",
      src: node.select_2d.selected_classes_src,
      original_url: node.select_2d.selected_classes_original_url || "",
    });
  }
  if (node.select_2d?.selected_particles_src) {
    push({
      kind: "ui_tile",
      name: "selected_particles",
      url: node.select_2d.selected_particles_image || "",
      src: node.select_2d.selected_particles_src,
      original_url: node.select_2d.selected_particles_original_url || "",
    });
  }
  if (node.select_2d?.excluded_classes_src) {
    push({
      kind: "ui_tile",
      name: "excluded_classes",
      url: node.select_2d.excluded_classes_image || "",
      src: node.select_2d.excluded_classes_src,
      original_url: node.select_2d.excluded_classes_original_url || "",
    });
  }
  for (const c of node.classes || []) {
    if (c.mrc_preview_src) {
      push({
        kind: "ui_tile",
        name: `class_${c.class_index}`,
        url: c.mrc_preview_url || "",
        src: c.mrc_preview_src,
        original_url: c.mrc_preview_original_url || "",
      });
    }
  }
  for (const m of node.maps || []) {
    if (m.preview_src) {
      push({
        kind: "ui_tile",
        name: m.group,
        url: m.preview_url || "",
        src: m.preview_src,
        original_url: m.preview_original_url || "",
      });
    }
  }
  return out;
}

/* ── Edge routing: n8n-style smooth bezier curves (no right-angle). ──── */

interface EdgePath {
  d: string;
  /** where the arrow marker should sit (always the target-side endpoint). */
  markerEnd: string;
}

/**
 * Compute a horizontal control-point offset for a smooth bezier.
 * Clamped so very short edges get a minimum visible curve and very
 * long edges don't overshoot. This mirrors n8n's curve style where
 * the control points are pulled horizontally from the endpoints.
 */
function bezierOffset(dx: number): number {
  return Math.min(80, Math.max(24, Math.abs(dx) * 0.4));
}

/**
 * Build an SVG path for an edge from (x1,y1) on the source's right edge
 * to (x2,y2) on the target's left edge. Uses smooth cubic bezier curves
 * for ALL cases (no right-angle Manhattan routing).
 *
 * - delta == 0 (same column): defensive side-bowed bezier.
 * - delta == 1 (adjacent): smooth S-curve in the column gap — curve
 *   lives entirely in the gap, doesn't touch cards.
 * - delta >  1 (multi-column): smooth bezier that bows UPWARD toward
 *   the free lane above the cards. The control points sit at
 *   topLaneY, pulling the curve up so it clears most intermediate
 *   cards. Some intermediate cards may still be crossed (the user
 *   explicitly accepted "连线跨过去" — lines crossing over), but
 *   the curve is smooth (no right-angle bends) like n8n.
 *
 * The user's requirement: "graph部分尽量避免线的叠合，参考n8n，可以用
 * 各种曲线，而不是直角折线" — avoid line overlap, reference n8n, use
 * curves not right-angle. The smooth bezier achieves this: curves are
 * continuous and organic, and by using topLaneY as the control-point Y,
 * parallel multi-column edges naturally fan out into the top lane area
 * rather than stacking on top of each other.
 */
function routeEdge(
  x1: number, y1: number, x2: number, y2: number,
  deltaCols: number, topLaneY: number,
): EdgePath {
  const dx = x2 - x1;
  const offset = bezierOffset(dx);

  if (deltaCols <= 0) {
    // Same column (defensive). Bow to the right of the column.
    return {
      d: `M${x1},${y1} C${x1 + offset},${y1} ${x1 + offset},${y2} ${x2},${y2}`,
      markerEnd: `${x2},${y2}`,
    };
  }

  if (deltaCols === 1) {
    // Adjacent column: smooth S-curve in the column gap.
    return {
      d: `M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}`,
      markerEnd: `${x2},${y2}`,
    };
  }

  // Multi-column: smooth bezier bowing UPWARD to the top lane.
  // Control points at (x1+offset, topLaneY) and (x2-offset, topLaneY)
  // pull the curve up so it arcs above intermediate cards. The actual
  // peak of a cubic bezier with equal control-point Y is
  // 0.25*max(y1,y2) + 0.75*topLaneY — enough to clear the top of
  // most cards while staying smooth (no right-angle bends).
  return {
    d: `M${x1},${y1} C${x1 + offset},${topLaneY} ${x2 - offset},${topLaneY} ${x2},${y2}`,
    markerEnd: `${x2},${y2}`,
  };
}

/**
 * Wrap-mode edge routing — also uses smooth bezier curves (no L-shaped
 * Manhattan). Layout in wrap mode is a grid: columns flow left → right
 * within a row, then wrap to a new row below.
 *
 *  (a) Same wrap-row: smooth S-curve (same as compact's adjacent case).
 *  (b) Cross wrap-row: smooth bezier that dips DOWN through the
 *      between-rows gap. Control points sit at the midpoint of the gap
 *      between the source's row and the row immediately below, creating
 *      a smooth curve that arcs through the gap. No right-angle bends.
 */
function routeEdgeWrap(
  x1: number, y1: number, x2: number, y2: number,
  sourceWrapRow: number, targetWrapRow: number,
  rowBottomY: (r: number) => number,
  nextRowTopY: (r: number) => number,
): EdgePath {
  const dx = x2 - x1;
  const offset = bezierOffset(dx);

  if (sourceWrapRow === targetWrapRow) {
    // Same row → smooth S-curve.
    return {
      d: `M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}`,
      markerEnd: `${x2},${y2}`,
    };
  }

  // Cross-row → smooth bezier dipping through the between-rows gap.
  const sBottom = rowBottomY(sourceWrapRow);
  const nextTop = nextRowTopY(sourceWrapRow);
  // Midpoint of the gap between source's row and the row below.
  const laneY = sBottom + (nextTop - sBottom) / 2;
  // Control points at (x1+offset, laneY) and (x2-offset, laneY) — the
  // curve arcs down into the gap and back up to the target. Smooth,
  // no right-angle bends.
  return {
    d: `M${x1},${y1} C${x1 + offset},${laneY} ${x2 - offset},${laneY} ${x2},${y2}`,
    markerEnd: `${x2},${y2}`,
  };
}


/* ── Component ────────────────────────────────────────────────────────── */
export function LineageGraph({ summary, session }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const bgColor        = isDark ? "#0b1220" : "#ffffff";
  const textColor      = isDark ? "#e2e8f0" : "#0f172a";
  const mutedColor     = isDark ? "#94a3b8" : "#64748b";
  const gridColor      = isDark ? "#1e293b" : "#e2e8f0";
  const borderColor    = isDark ? "#1e293b" : "#e2e8f0";
  const panelBg        = isDark ? "#0f172a" : "#f8fafc";
  const cardBg         = isDark ? "#0f172a" : "#ffffff";
  const cardShadow     = isDark ? "rgba(0,0,0,0.45)" : "rgba(15,23,42,0.08)";
  const startColor     = "#0d9488"; // teal-600 — SOURCE / upstream-most
  const targetColor    = "#dc2626"; // red-600 — TARGET / trace destination
  const selectionColor = "#0ea5e9"; // sky-500

  const [detailMode, setDetailMode] = useState(false);
  const NODE_H = detailMode ? NODE_H_DETAIL : NODE_H_COMPACT;
  const LAYER_Y = detailMode ? LAYER_Y_DETAIL : LAYER_Y_COMPACT;

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  // `hoveredEdge` is keyed by `${source}\u2192${target}` (using a Unicode
  // arrow so it can't collide with any real UID). Set when the user hovers
  // an edge's hit-area — drives both edge highlighting AND card highlighting
  // (both endpoints of the hovered edge light up).
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [modalUid, setModalUid] = useState<string | null>(null);
  // Layout mode: "compact" (single horizontal strip, may require horizontal
  // scroll for deep lineages) vs "wrap" (caps the canvas width at
  // WRAP_MAX_WIDTH and wraps excess columns to a new row below, with edges
  // routing through the between-rows gap). User-toggleable via toolbar.
  const [layoutMode, setLayoutMode] = useState<"compact" | "wrap">("compact");

  // Resolve the hovered edge's source/target UIDs (null when no edge hovered).
  const hoveredEdgeEndpoints = useMemo(() => {
    if (!hoveredEdge) return null;
    const [src, tgt] = hoveredEdge.split("\u2192");
    return { source: src, target: tgt };
  }, [hoveredEdge]);

  /* Layout: longest-path depth columns, oldest upstream LEFT, TARGET RIGHT. */
  const { nodes, edges, layout, bounds, columns, depthMap, leafSet, wrapRowBounds } = useMemo(() => {
    const nodes = summary.nodes || [];
    const edges = summary.edges || [];
    const depthMap = computeLongestPathDepths(edges, summary.start_uid);

    let maxDepth = 0;
    for (const d of depthMap.values()) if (d > maxDepth) maxDepth = d;

    const connected = nodes.filter((n) => depthMap.has(n.uid));
    const disconnected = nodes.filter((n) => !depthMap.has(n.uid));

    // Leaf set: connected nodes whose depth == 0 (no incoming edges within
    // the connected subgraph). These get the START / "data source" badge.
    const reverseAdj = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.source || !e.target) continue;
      if (!depthMap.has(e.source) || !depthMap.has(e.target)) continue;
      if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
      reverseAdj.get(e.target)!.push(e.source);
    }
    const leafSet = new Set<string>();
    for (const n of connected) {
      if (depthMap.get(n.uid) === 0) leafSet.add(n.uid);
    }
    // If no leaves (e.g., a pure cycle), treat depth-0 = max-depth holders.
    if (leafSet.size === 0) {
      for (const n of connected) {
        if (depthMap.get(n.uid) === maxDepth) leafSet.add(n.uid);
      }
    }

    const byDepth = new Map<number, LineageNode[]>();
    for (const n of connected) {
      const d = depthMap.get(n.uid) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    }
    for (const list of byDepth.values()) {
      list.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));
    }
    disconnected.sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));

    type ColKind = "disconnected" | "leaf" | "upstream" | "target";
    interface Col { kind: ColKind; depth: number; columnIndex: number; nodes: LineageNode[]; }
    const cols: Col[] = [];
    if (disconnected.length > 0) {
      cols.push({ kind: "disconnected", depth: -1, columnIndex: 0, nodes: disconnected });
    }
    // Walk depth 0 → maxDepth so oldest jobs come first (LEFT), TARGET last (RIGHT).
    for (let d = 0; d <= maxDepth; d++) {
      const list = byDepth.get(d) || [];
      if (list.length === 0) continue;
      cols.push({
        kind: d === 0 ? "leaf" : d === maxDepth ? "target" : "upstream",
        depth: d,
        columnIndex: 0,
        nodes: list,
      });
    }
    cols.forEach((c, i) => { c.columnIndex = i; });

    // Wrap layout: cap canvas width so deep lineages wrap to a new row
    // instead of growing horizontally without bound. maxColsPerRow is
    // derived from WRAP_MAX_WIDTH and LAYER_X; we floor to at least 2 so
    // tiny lineages still get a horizontal left→right strip in wrap mode.
    const maxColsPerRow = Math.max(2, Math.floor((WRAP_MAX_WIDTH - PAD * 2) / LAYER_X));
    const numWrapRows = Math.max(1, Math.ceil(cols.length / maxColsPerRow));

    // Assign each column its (wrapRow, wrapCol) coordinates.
    (cols as Array<Col & { wrapRow: number; wrapCol: number }>).forEach((c, i) => {
      (c as Col & { wrapRow: number; wrapCol: number }).wrapRow = Math.floor(i / maxColsPerRow);
      (c as Col & { wrapRow: number; wrapCol: number }).wrapCol = i % maxColsPerRow;
    });

    const layout = new Map<string, { x: number; y: number; columnIndex: number; depth: number; row: number; wrapRow?: number; wrapCol?: number }>();
    let maxRows = 0;
    for (const c of cols) if (c.nodes.length > maxRows) maxRows = c.nodes.length;
    const tallestColHeight = maxRows * LAYER_Y;
    const topOffset = TOP_AXIS_H + TOP_LANE_H + PAD;

    // Per-wrap-row y bounds (top y + bottom y of each row's card area).
    // Used by routeEdgeWrap to compute the cross-row between-rows lane Y.
    const wrapRowBounds: Array<{ topY: number; bottomY: number }> = [];
    for (let r = 0; r < numWrapRows; r++) {
      const topY = topOffset + r * (tallestColHeight + WRAP_ROW_GAP);
      wrapRowBounds.push({ topY, bottomY: topY + tallestColHeight });
    }

    for (const c of cols) {
      const cw = c as Col & { wrapRow: number; wrapCol: number };
      const colHeight = c.nodes.length * LAYER_Y;
      // Center the column's nodes vertically within its row's band.
      const startY =
        layoutMode === "wrap"
          ? wrapRowBounds[cw.wrapRow].topY + (tallestColHeight - colHeight) / 2
          : topOffset + (tallestColHeight - colHeight) / 2;
      c.nodes.forEach((n, i) => {
        layout.set(n.uid, {
          x:
            layoutMode === "wrap"
              ? PAD + cw.wrapCol * LAYER_X
              : PAD + c.columnIndex * LAYER_X,
          y: startY + i * LAYER_Y,
          columnIndex: c.columnIndex,
          depth: c.depth,
          row: i,
          wrapRow: layoutMode === "wrap" ? cw.wrapRow : undefined,
          wrapCol: layoutMode === "wrap" ? cw.wrapCol : undefined,
        });
      });
    }

    let maxX = PAD;
    for (const pos of layout.values()) {
      if (pos.x + NODE_W > maxX) maxX = pos.x + NODE_W;
    }
    // In wrap mode the canvas width is capped at WRAP_MAX_WIDTH — the
    // content is laid out in `numWrapRows` horizontal bands stacked
    // vertically, so the SVG grows DOWN, not RIGHT. In compact mode
    // the canvas grows horizontally to fit every column.
    const totalWidth =
      layoutMode === "wrap"
        ? Math.min(WRAP_MAX_WIDTH, Math.max(maxColsPerRow, cols.length) * LAYER_X + PAD, cols.length * LAYER_X + PAD)
        : Math.max(maxX + PAD, cols.length * LAYER_X + PAD, PAD * 2);
    const totalHeight =
      layoutMode === "wrap"
        ? topOffset + numWrapRows * tallestColHeight + (numWrapRows - 1) * WRAP_ROW_GAP + NODE_H + PAD
        : topOffset + tallestColHeight + NODE_H + PAD;

    return {
      nodes, edges, layout, bounds: { w: totalWidth, h: totalHeight },
      columns: cols, depthMap, leafSet, wrapRowBounds,
    };
  }, [summary, detailMode, layoutMode]);

  /* Highlight set: full upstream→target path through the hovered/selected node. */
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

  /** Map of nodeUid → first-preview-image base64 data URL (detail-mode). */
  const [embeddedThumbs, setEmbeddedThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!session || !detailMode) {
      setEmbeddedThumbs({});
      return;
    }
    let cancelled = false;
    const thumbs: Record<string, string> = {};
    (async () => {
      // Dynamic import to keep the lib out of the server bundle.
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      const tasks: Promise<void>[] = [];
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < nodes.length) {
          const idx = cursor++;
          const n = nodes[idx];
          const img = pickPreviewImage(n);
          if (!img) continue;
          try {
            const b64 = await imageToBase64(session, img.src);
            if (!cancelled && b64) thumbs[n.uid] = b64;
          } catch {
            // ignore — fallback to remote URL in render
          }
        }
      }
      for (let i = 0; i < CONCURRENCY; i++) tasks.push(worker());
      await Promise.all(tasks);
      if (!cancelled && Object.keys(thumbs).length > 0) setEmbeddedThumbs(thumbs);
    })();
    return () => { cancelled = true; };
  }, [session, detailMode, nodes]);

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
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (1 + delta))));
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

  useEffect(() => {
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

  /* Keyboard support for SVG nodes (Enter / Space opens modal). */
  const onKeyDownNode = useCallback((e: React.KeyboardEvent, uid: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setModalUid(uid);
    }
  }, []);

  /* Captions. */
  const inCanvasCaption = `Data flows left \u2192 right, converging on the target job \`${summary.start_uid}\`.`;
  const belowCanvasCaption = `${nodes.length} jobs \u00B7 ${edges.length} data links \u00B7 ${leafSet.size} source node${leafSet.size === 1 ? "" : "s"} \u00B7 hover/click a node to trace its path \u00B7 drag to pan \u00B7 scroll/buttons to zoom \u00B7 click a card for full details`;

  const selectedNode = selectedUid ? nodeMap.get(selectedUid) ?? null : null;
  const modalNode = modalUid ? nodeMap.get(modalUid) ?? null : null;

  // For long-range orthogonal edges, vertical segment Y = top of free lane.
  const topLaneY = TOP_AXIS_H + 6;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-0.5 rounded-md border p-0.5"
          style={{ borderColor, background: panelBg }}
        >
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.15))}
            title="Zoom in (+15%)" aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.15))}
            title="Zoom out (-15%)" aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={fitToView} title="Fit to view" aria-label="Fit to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={resetView} title="Reset view" aria-label="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <span className="px-1.5 font-mono text-[10px]" style={{ color: mutedColor }}>
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {/* Detail mode toggle (CryoSPARC-style inline image thumbnails). */}
        <Button
          variant={detailMode ? "default" : "outline"}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setDetailMode((v) => !v)}
          title="Toggle inline image thumbnails in cards (CryoSPARC-style)"
          aria-pressed={detailMode}
        >
          <ImageIcon className="mr-1 h-3 w-3" />
          Detail mode
          {detailMode && <span className="ml-1 font-mono text-[9px] opacity-80">ON</span>}
        </Button>

        {/* Layout mode toggle: "compact" (single horizontal strip, grows
            right without bound — clean for shallow lineages) vs "wrap"
            (caps canvas width at WRAP_MAX_WIDTH, wraps excess columns
            to a new row below — fits a single page for deep lineages). */}
        <Button
          variant={layoutMode === "wrap" ? "default" : "outline"}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setLayoutMode((v) => (v === "compact" ? "wrap" : "compact"))}
          title={
            layoutMode === "wrap"
              ? "Layout: wrap (fits one page width, excess wraps down). Click for compact."
              : "Layout: compact (single horizontal strip). Click for wrap (fits page width)."
          }
          aria-pressed={layoutMode === "wrap"}
        >
          <WrapText className="mr-1 h-3 w-3" />
          {layoutMode === "wrap" ? "Wrap" : "Compact"}
        </Button>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={exportPng}
            title="Export as raster PNG (2× retina)">
            <Download className="mr-1 h-3 w-3" /> PNG
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={exportSvg}
            title="Export as vector SVG (scalable, editable)">
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
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: startColor }} />
            Source
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: targetColor }} />
            Target
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border"
        style={{
          height: 540,
          cursor: dragging ? "grabbing" : "grab",
          borderColor,
          background: bgColor,
        }}
        onMouseDown={handleMouseDown}
      >
        <span className="sr-only">
          Lineage graph: {nodes.length} jobs and {edges.length} data links. Target job is {summary.start_uid}. Data flows from the leftmost (oldest) source jobs rightward, converging on the target job on the far right. Use Tab to focus a node and Enter or Space to open its details.
        </span>
        <svg
          ref={svgRef}
          width={bounds.w}
          height={bounds.h}
          viewBox={`0 0 ${bounds.w} ${bounds.h}`}
          role="img"
          aria-label={`Lineage graph of ${nodes.length} jobs converging on target job ${summary.start_uid}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            transition: dragging ? "none" : "transform 0.15s ease-out",
            display: "block",
          }}
        >
          <defs>
            <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor={cardShadow} />
            </filter>
            <filter id="start-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient id="card-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? "#1e293b" : "#ffffff"} />
              <stop offset="100%" stopColor={isDark ? "#0f172a" : "#f8fafc"} />
            </linearGradient>
            {(["exposure", "particle", "volume", "other"] as EdgeFam[]).map((f) => (
              <marker
                key={f}
                id={EDGE_MARKER[f]}
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="4.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0,0 L9,4.5 L0,9 Z" fill={EDGE_COLOR[f]} />
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

          {/* Free-lane indicator removed — purely decorative and added
              visual noise behind the cards without aiding comprehension. */}

          {/* Axis labels — column headers only, no vertical divider lines.
              In compact mode, render once at `y = TOP_AXIS_H` (single
              header strip at the top of the SVG). In wrap mode, render
              the header at the TOP of each wrap row so users can read
              the depth label of any column regardless of which row it's
              in. The previous implementation also drew a dashed <line>
              from `TOP_AXIS_H + 6` down to `bounds.h - PAD` for every
              column — that produced a forest of faint vertical lines
              the user called out as ugly. Removed in favor of header
              text alone (cards themselves visually demarcate columns). */}
          {columns.map((col) => {
            const cw = col as typeof columns[number] & { wrapRow?: number; wrapCol?: number };
            const cx =
              layoutMode === "wrap"
                ? PAD + (cw.wrapCol ?? 0) * LAYER_X + NODE_W / 2
                : PAD + col.columnIndex * LAYER_X + NODE_W / 2;
            const cy =
              layoutMode === "wrap" && cw.wrapRow != null && wrapRowBounds[cw.wrapRow]
                ? wrapRowBounds[cw.wrapRow].topY - 12
                : TOP_AXIS_H;
            let label: string;
            let labelColor = mutedColor;
            if (col.kind === "target") {
              label = `TARGET \u00B7 \u7EC8\u70B9 / trace destination`;
              labelColor = targetColor;
            } else if (col.kind === "leaf") {
              label = `SOURCE \u00B7 \u8D77\u70B9 / data origin`;
              labelColor = startColor;
            } else if (col.kind === "disconnected") {
              label = `Disconnected / ${stageLabel(col.nodes[0])}`;
            } else {
              label = `${col.depth} hop${col.depth === 1 ? "" : "s"} to target / ${stageLabel(col.nodes[0])}`;
            }
            return (
              <text
                key={`col-${col.columnIndex}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={col.kind === "target" || col.kind === "leaf" ? 700 : 500}
                fill={labelColor}
              >
                {label}
              </text>
            );
          })}

          {/* Edges (drawn BEFORE nodes so nodes overlay arrows that come near). */}
          {edges.map((e, i) => {
            const from = layout.get(e.source);
            const to = layout.get(e.target);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const deltaCols = to.columnIndex - from.columnIndex;
            // Skip edges that would go backward (shouldn't happen with
            // longest-path depths, but defensive — keeps the graph clean).
            // In wrap mode, the deltaCols is the per-row column delta;
            // cross-row edges have a positive wrapRow delta which we route
            // through the between-rows lane instead.
            const fromWrapRow = (from as { wrapRow?: number }).wrapRow;
            const toWrapRow = (to as { wrapRow?: number }).wrapRow;
            const isWrapCrossRow =
              layoutMode === "wrap" && fromWrapRow != null && toWrapRow != null && fromWrapRow !== toWrapRow;
            if (layoutMode !== "wrap" && deltaCols < 0) return null;
            if (layoutMode === "wrap" && !isWrapCrossRow && deltaCols < 0) return null;
            const fam = edgeFamily(e);
            const color = EDGE_COLOR[fam];
            const edgeKey = `${e.source}\u2192${e.target}`;
            // An edge is highlighted when: the user is hovering one of its
            // endpoint cards (existing behavior), OR the user is hovering
            // this edge itself (new — both endpoint cards also light up
            // via the card-side `isHoveredEdgeEndpoint` check below).
            const isEndpointHi =
              !!highlightUid && (e.source === highlightUid || e.target === highlightUid);
            const isEdgeHi = hoveredEdge === edgeKey;
            const isHi = isEndpointHi || isEdgeHi;
            // Dim an edge only when there's a node-level focus AND neither
            // endpoint of THIS edge is in the focus's ancestor/descendant
            // chain. Pure edge-hover never dims other edges (it's a
            // gentle "look at this link" gesture, not a filter).
            const isDim = !!highlightSet && !(highlightSet.has(e.source) && highlightSet.has(e.target));
            const opacity = isDim ? 0.08 : isHi ? 1 : 0.55;
            const strokeWidth = isHi ? 2.6 : 1.6;
            // Pick routing: wrap cross-row → routeEdgeWrap; otherwise →
            // routeEdge (bezier for adjacent, Manhattan via top-lane for
            // multi-column within the same row).
            const d = isWrapCrossRow
              ? routeEdgeWrap(
                  x1, y1, x2, y2,
                  fromWrapRow!, toWrapRow!,
                  (r: number) => wrapRowBounds[r]?.bottomY ?? y1,
                  (r: number) => wrapRowBounds[r + 1]?.topY ?? y2,
                ).d
              : routeEdge(x1, y1, x2, y2, layoutMode === "wrap" ? ((to as { wrapCol?: number }).wrapCol ?? 0) - ((from as { wrapCol?: number }).wrapCol ?? 0) : deltaCols, topLaneY).d;
            return (
              <g key={i}>
                {/* Visible colored path — no pointer events so the wide
                    hit area below is the only thing the user interacts
                    with (avoids 1.6px stroke being nearly impossible
                    to mouse-over precisely). */}
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeOpacity={opacity}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  markerEnd={`url(#${EDGE_MARKER[fam]})`}
                  style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
                  pointerEvents="none"
                />
                {/* Invisible wide hit area for hover detection. 14px is
                    wide enough to hit comfortably without being so wide
                    that it overlaps adjacent cards' hit boxes (the path
                    runs through the column gaps and the top free-lane). */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredEdge(edgeKey)}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = layout.get(node.uid);
            if (!pos) return null;
            const family = classify(node);
            const color = FAMILY_COLOR[family];
            const isTarget = node.uid === summary.start_uid;
            const isLeaf = leafSet.has(node.uid);
            const isHovered = node.uid === hoveredUid;
            // Light up this card when the user hovers an edge whose source
            // OR target is this card. The user's request was: "悬停线时
            // 也要高亮其连接的两个卡片" (when hovering a line, both
            // connected cards should highlight). This is in ADDITION to
            // the existing per-card hover ring.
            const isHoveredEdgeEndpoint =
              !!hoveredEdgeEndpoints &&
              (hoveredEdgeEndpoints.source === node.uid ||
                hoveredEdgeEndpoints.target === node.uid);
            const isSelected = node.uid === selectedUid;
            // Dim a card only when there's a node-level focus AND it's not
            // in the focus's ancestor/descendant chain. Pure edge-hover
            // never dims other cards (matches the edge-side rule above —
            // edge hover is a gentle highlight, not a filter).
            const isDim = !!highlightSet && !highlightSet.has(node.uid);
            const depth = depthMap.get(node.uid);
            const depthLabel = depth == null ? null : `${depth}h`;
            const ariaLabel = isTarget
              ? `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, target job`
              : isLeaf
                ? `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, source job`
                : depth == null
                  ? `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, disconnected`
                  : `${node.uid}, ${node.job_type}, ${formatMetrics(node)}, ${depth} hop${depth === 1 ? "" : "s"} to target`;

            const previewImg = detailMode ? pickPreviewImage(node) : null;
            const embeddedB64 = previewImg ? embeddedThumbs[node.uid] : undefined;
            const imgSrc = embeddedB64 || withSession(previewImg?.src || previewImg?.original_url, session);
            // Proxy fallback for when the browser can't reach CryoSmart directly.
            const imgProxyFallback = !embeddedB64
              ? buildProxyFallback(previewImg?.src || previewImg?.original_url, session)
              : null;

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
                  setModalUid(node.uid);
                }}
                onKeyDown={(ev) => onKeyDownNode(ev, node.uid)}
              >
                {/* SOURCE glow halo (behind everything else).
                    Tightened from x=-6/w+12 to x=-3/w+6 so the halo
                    overlaps the card body — no visible gap between the
                    glow and the card body. The blur filter extends the
                    visible glow outward. */}
                {isLeaf && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6} height={NODE_H + 6}
                    rx={11}
                    fill={startColor}
                    opacity={0.3}
                    filter="url(#start-glow)"
                  />
                )}
                {/* TARGET glow halo. Same tightening as SOURCE. */}
                {isTarget && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6} height={NODE_H + 6}
                    rx={11}
                    fill={targetColor}
                    opacity={0.32}
                    filter="url(#start-glow)"
                  />
                )}
                {/* Edge-hover endpoint glow halo — a soft fill behind the
                    card that pulses the connection visually. Mirrors the
                    SOURCE/TARGET glow treatment so it feels native.
                    Drawn BEFORE the card body so the card sits on top.
                    Tightened to x=-3 (matches SOURCE/TARGET halos) so
                    there's no gap between the glow and the card body. */}
                {isHoveredEdgeEndpoint && !isSelected && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6} height={NODE_H + 6}
                    rx={11}
                    fill={selectionColor}
                    opacity={0.22}
                    filter="url(#start-glow)"
                    pointerEvents="none"
                  />
                )}
                {/* Card body — the stroke IS the selection/hover/SOURCE/
                    TARGET border. No separate ring `<rect>` elements → no
                    gap between border and body (the old rings left a
                    visible 0.25–2px gap because SVG strokes are centered
                    on the path, so a ring at x=-1.5 with strokeWidth=1.5
                    has its inner edge at -0.75 while the card body's outer
                    edge is at -0.5). Priority:
                      isSelected > isHoveredEdgeEndpoint > isHovered > isTarget/isLeaf. */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="url(#card-grad)"
                  stroke={
                    isSelected ? selectionColor
                    : isHoveredEdgeEndpoint ? selectionColor
                    : isHovered ? color
                    : isTarget ? targetColor
                    : isLeaf ? startColor
                    : borderColor
                  }
                  strokeWidth={
                    isSelected ? 3
                    : isHoveredEdgeEndpoint ? 2.5
                    : isHovered ? 2
                    : (isTarget || isLeaf) ? 1.5
                    : 1
                  }
                  filter="url(#card-shadow)"
                />
                {/* Left color bar. */}
                <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={color} />
                {/* UID row. */}
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
                {/* Depth pill (non-leaf, non-target only). */}
                {!isLeaf && !isTarget && depthLabel && (
                  <g transform={`translate(${NODE_W - 32}, 6)`}>
                    <rect width={26} height={14} rx={7} fill={color} opacity={0.18} />
                    <text
                      x={13} y={11}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill={color}
                      style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                    >
                      {depthLabel}
                    </text>
                  </g>
                )}
                {/* Job type. */}
                <text
                  x={14} y={38}
                  fontSize={10.5}
                  fill={mutedColor}
                >
                  {truncate(node.job_type || "", 28)}
                </text>
                {/* Metrics row. */}
                <text
                  x={14} y={54}
                  fontSize={10}
                  fill={textColor}
                  style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                >
                  {formatMetrics(node)}
                </text>
                {/* Status dot + title (compact 2nd line). */}
                <g transform="translate(14, 64)">
                  <circle
                    cx={4} cy={-3} r={3}
                    fill={node.status === "completed" ? "#10b981" : node.status === "running" ? "#f59e0b" : "#94a3b8"}
                  />
                  <text
                    x={12} y={0}
                    fontSize={9.5}
                    fill={mutedColor}
                  >
                    {truncate(node.title || node.status || "—", 30)}
                  </text>
                </g>

                {/* Inline preview thumbnail (detail mode only). */}
                {detailMode && previewImg && imgSrc && (
                  <image
                    href={imgSrc}
                    x={14}
                    y={78}
                    width={NODE_W - 28}
                    height={NODE_H - 88}
                    preserveAspectRatio="xMidYMid meet"
                    referrerPolicy="no-referrer"
                    onError={
                      imgProxyFallback
                        ? (e) => {
                            const t = e.currentTarget;
                            if (t.getAttribute("data-tried")) return;
                            t.setAttribute("data-tried", "1");
                            t.setAttribute("href", imgProxyFallback);
                          }
                        : undefined
                    }
                  />
                )}
                {detailMode && previewImg && !imgSrc && (
                  <rect
                    x={14} y={78}
                    width={NODE_W - 28} height={NODE_H - 88}
                    rx={4}
                    fill={isDark ? "#1e293b" : "#f1f5f9"}
                    stroke={borderColor}
                  />
                )}
                {detailMode && !previewImg && (
                  <g transform={`translate(${NODE_W / 2 - 40}, 86)`}>
                    <rect width={80} height={NODE_H - 96} rx={4}
                      fill={isDark ? "#1e293b" : "#f1f5f9"}
                      stroke={borderColor} />
                    <text
                      x={40} y={(NODE_H - 96) / 2 + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill={mutedColor}
                    >
                      no preview
                    </text>
                  </g>
                )}

                {/* SOURCE badge above source node. */}
                {isLeaf && (
                  <g transform={`translate(${NODE_W / 2 - 30}, -22)`}>
                    <rect width={60} height={16} rx={8} fill={startColor} />
                    <text
                      x={30} y={11.5}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={800}
                      fill="#ffffff"
                      style={{ letterSpacing: "0.6px" }}
                    >
                      SOURCE
                    </text>
                  </g>
                )}
                {/* TARGET badge above target node. */}
                {isTarget && (
                  <g transform={`translate(${NODE_W / 2 - 30}, -22)`}>
                    <rect width={60} height={16} rx={8} fill={targetColor} />
                    <text
                      x={30} y={11.5}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={800}
                      fill="#ffffff"
                      style={{ letterSpacing: "0.6px" }}
                    >
                      TARGET
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Empty state. */}
        {nodes.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center text-[12px]"
            style={{ color: mutedColor }}
          >
            No lineage nodes to display.
          </div>
        )}

        {/* Mini hover/selection popover (kept for at-a-glance info; click
            opens the full modal below). */}
        {selectedNode && !modalUid && (
          <DetailMiniBar
            node={selectedNode}
            isTarget={selectedUid === summary.start_uid}
            isLeaf={selectedUid ? leafSet.has(selectedUid) : false}
            depth={selectedUid ? depthMap.get(selectedUid) ?? null : null}
            bgColor={bgColor}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            startColor={startColor}
            targetColor={targetColor}
            onOpen={() => selectedUid && setModalUid(selectedUid)}
            onClose={() => setSelectedUid(null)}
          />
        )}
      </div>

      {/* Below-canvas caption. */}
      <div className="text-[10.5px]" style={{ color: mutedColor }}>
        {belowCanvasCaption}
      </div>

      {/* Full Detail Modal (click any card). */}
      {modalNode && (
        <NodeDetailModal
          node={modalNode}
          summary={summary}
          session={session ?? null}
          isTarget={modalNode.uid === summary.start_uid}
          isLeaf={leafSet.has(modalNode.uid)}
          depth={depthMap.get(modalNode.uid) ?? null}
          upstreamCount={Math.max(0, collectAncestors(modalNode.uid, edges).size - 1)}
          downstreamCount={Math.max(0, collectDownstream(modalNode.uid, edges).size - 1)}
          incomingEdges={edges.filter((e) => e.target === modalNode.uid)}
          outgoingEdges={edges.filter((e) => e.source === modalNode.uid)}
          onClose={() => setModalUid(null)}
          bgColor={bgColor}
          textColor={textColor}
          mutedColor={mutedColor}
          borderColor={borderColor}
          startColor={startColor}
          targetColor={targetColor}
          isDark={isDark}
        />
      )}
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

interface DetailMiniBarProps {
  node: LineageNode;
  isTarget: boolean;
  isLeaf: boolean;
  depth: number | null;
  bgColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  startColor: string;
  targetColor: string;
  onOpen: () => void;
  onClose: () => void;
}

function DetailMiniBar({
  node, isTarget, isLeaf, depth,
  bgColor, textColor, mutedColor, borderColor,
  startColor, targetColor, onOpen, onClose,
}: DetailMiniBarProps) {
  const family = classify(node);
  const color = FAMILY_COLOR[family];
  return (
    <div
      className="absolute bottom-2 right-2 flex items-center gap-2 rounded-lg border p-2.5 shadow-lg"
      style={{ width: 320, background: bgColor, color: textColor, borderColor }}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] font-bold" style={{ color: textColor }}>
            {node.uid}
          </span>
          {isTarget ? (
            <Badge className="px-1 py-0 text-[8px] font-bold"
              style={{ backgroundColor: targetColor, color: "#fff", border: "none" }}>
              TARGET
            </Badge>
          ) : isLeaf ? (
            <Badge className="px-1 py-0 text-[8px] font-bold"
              style={{ backgroundColor: startColor, color: "#fff", border: "none" }}>
              SOURCE
            </Badge>
          ) : depth != null ? (
            <Badge variant="outline" className="px-1 py-0 text-[8px] font-bold"
              style={{ color, borderColor: color }}>
              {depth} hop{depth === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
        <div className="font-mono text-[10px]" style={{ color: mutedColor }}>
          {node.job_type}
        </div>
        <div className="truncate text-[10px]" style={{ color: mutedColor }} title={node.title}>
          {node.title || "—"}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline" size="sm"
          className="h-7 px-2 text-[10.5px]"
          onClick={onOpen}
          title="Open full details + image gallery"
        >
          <ExternalLink className="mr-1 h-3 w-3" /> Details
        </Button>
        <button
          type="button"
          className="text-[14px] leading-none"
          style={{ color: mutedColor }}
          onClick={onClose}
          aria-label="Close mini bar"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/* ── Full Detail Modal ────────────────────────────────────────────────── */

interface NodeDetailModalProps {
  node: LineageNode;
  summary: LineageSummary;
  session: CryoSmartSession | null;
  isTarget: boolean;
  isLeaf: boolean;
  depth: number | null;
  upstreamCount: number;
  downstreamCount: number;
  incomingEdges: LineageEdge[];
  outgoingEdges: LineageEdge[];
  onClose: () => void;
  bgColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  startColor: string;
  targetColor: string;
  isDark: boolean;
}

function NodeDetailModal({
  node, summary, session,
  isTarget, isLeaf, depth,
  upstreamCount, downstreamCount,
  incomingEdges, outgoingEdges,
  onClose,
  bgColor, textColor, mutedColor, borderColor,
  startColor, targetColor, isDark,
}: NodeDetailModalProps) {
  const family = classify(node);
  const color = FAMILY_COLOR[family];
  const allImages = useMemo(() => collectAllImages(node), [node]);
  const [embeddedGallery, setEmbeddedGallery] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);

  /* Pre-fetch all gallery images as base64 when a session is available,
   * so they render self-contained (no remote/referrer/CORS issues). */
  useEffect(() => {
    if (!session || allImages.length === 0) {
      setEmbeddedGallery({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      const out: Record<string, string> = {};
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < allImages.length) {
          const idx = cursor++;
          const img = allImages[idx];
          try {
            const b64 = await imageToBase64(session, img.src);
            if (!cancelled && b64) out[img.src] = b64;
          } catch {
            // ignore
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (!cancelled) setEmbeddedGallery(out);
    })();
    return () => { cancelled = true; };
  }, [session, allImages]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LineageNode>();
    for (const n of summary.nodes || []) m.set(n.uid, n);
    return m;
  }, [summary.nodes]);

  const activeImage = allImages[activeIdx];
  const activeSrc = activeImage
    ? embeddedGallery[activeImage.src] || withSession(activeImage.original_url || activeImage.url, session)
    : null;
  const activeFallback = activeImage && !embeddedGallery[activeImage.src]
    ? buildProxyFallback(activeImage.original_url || activeImage.url, session)
    : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[88vh] overflow-hidden p-0 sm:max-w-[960px]"
        style={{ background: bgColor, color: textColor, borderColor }}
      >
        <DialogHeader className="border-b px-5 py-3" style={{ borderColor }}>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="font-mono">{node.uid}</span>
            <span className="text-[12px] font-normal" style={{ color: mutedColor }}>
              {node.job_type}
            </span>
            {isTarget && (
              <Badge className="ml-1 px-1.5 py-0 text-[9px] font-bold"
                style={{ backgroundColor: targetColor, color: "#fff", border: "none" }}>
                TARGET
              </Badge>
            )}
            {isLeaf && (
              <Badge className="ml-1 px-1.5 py-0 text-[9px] font-bold"
                style={{ backgroundColor: startColor, color: "#fff", border: "none" }}>
                SOURCE
              </Badge>
            )}
            {depth != null && !isTarget && !isLeaf && (
              <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[9px] font-bold"
                style={{ color, borderColor: color }}>
                {depth} hop{depth === 1 ? "" : "s"} to target
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-[12px]" style={{ color: mutedColor }}>
            {node.title || "No title"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(88vh-64px)]">
          <div className="grid grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[260px_1fr]">
            {/* LEFT: facts list + status + position */}
            <div className="space-y-3">
              <FactGroup title="Identity">
                <Fact label="UID" value={node.uid} mono />
                <Fact label="Job #" value={node.uid_num != null ? String(node.uid_num) : "—"} mono />
                <Fact label="Project" value={node.project_uid || "—"} mono />
                <Fact label="Type" value={node.job_type || "—"} />
                <Fact label="Status" value={node.status || "—"} />
              </FactGroup>

              <FactGroup title="Timing">
                <Fact label="Created" value={plainDateStr(node.created_at)} mono />
                <Fact label="Completed" value={plainDateStr(node.completed_at)} mono />
              </FactGroup>

              <FactGroup title="Metrics">
                <Fact label="Particles" value={node.particle_count != null ? node.particle_count.toLocaleString() : "—"} mono />
                <Fact label="Micrographs" value={node.micrograph_count != null ? node.micrograph_count.toLocaleString() : "—"} mono />
                <Fact label="Volumes" value={node.volume_count != null ? String(node.volume_count) : "—"} mono />
                <Fact label="Classes" value={node.class_count != null ? String(node.class_count) : "—"} mono />
                <Fact label="Resolution" value={node.resolution_A != null ? `${node.resolution_A.toFixed(2)} Å` : "—"} mono />
                <Fact label="Pixel size" value={node.pixel_size_A != null ? `${node.pixel_size_A.toFixed(3)} Å` : "—"} mono />
              </FactGroup>

              <FactGroup title="Extraction">
                <Fact label="Box size" value={node.extraction_params?.box_size_pix != null ? String(node.extraction_params.box_size_pix) : "—"} mono />
                <Fact label="Extracted box" value={node.extraction_params?.extracted_box_size_pix != null ? String(node.extraction_params.extracted_box_size_pix) : "—"} mono />
                <Fact label="Bin factor" value={node.extraction_params?.bin_factor != null ? node.extraction_params.bin_factor.toFixed(3) : "—"} mono />
              </FactGroup>

              <FactGroup title="Lineage Position">
                <Fact label="Depth" value={depth != null ? `${depth} (0=source, max=target)` : "—"} mono />
                <Fact label="Upstream" value={`${upstreamCount} ancestor${upstreamCount === 1 ? "" : "s"}`} />
                <Fact label="Downstream" value={`${downstreamCount} descendant${downstreamCount === 1 ? "" : "s"}`} />
                <Fact label="Parents" value={node.parents?.length ? `${node.parents.length} (${node.parents.join(", ")})` : "—"} mono />
                <Fact label="Children" value={node.children?.length ? `${node.children.length} (${node.children.join(", ")})` : "—"} mono />
              </FactGroup>
            </div>

            {/* RIGHT: image gallery + output groups + maps + classes + edges */}
            <div className="space-y-4">
              {/* Image gallery */}
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
                    <ImageIcon className="h-3.5 w-3.5" /> Images
                    <span className="font-mono text-[10px]" style={{ color: mutedColor }}>
                      ({allImages.length})
                    </span>
                  </h4>
                  {session && Object.keys(embeddedGallery).length > 0 && (
                    <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[9px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      self-contained
                    </span>
                  )}
                </div>
                {allImages.length === 0 ? (
                  <div
                    className="flex h-32 items-center justify-center rounded-md border border-dashed text-[11px]"
                    style={{ borderColor, color: mutedColor }}
                  >
                    No preview images attached to this job.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Main viewer */}
                    <div
                      className="relative flex items-center justify-center rounded-md border"
                      style={{
                        borderColor,
                        background: isDark ? "#020617" : "#f8fafc",
                        minHeight: 260,
                        maxHeight: 360,
                      }}
                    >
                      {activeSrc ? (
                        <img
                          src={activeSrc}
                          alt={activeImage?.name || "preview"}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                          onError={
                            activeFallback
                              ? (e) => {
                                  const t = e.currentTarget;
                                  if (t.dataset.tried) return;
                                  t.dataset.tried = "1";
                                  t.src = activeFallback;
                                }
                              : undefined
                          }
                          style={{ maxWidth: "100%", maxHeight: 340, objectFit: "contain" }}
                        />
                      ) : (
                        <div className="text-[11px]" style={{ color: mutedColor }}>
                          image unavailable
                        </div>
                      )}
                    </div>
                    {/* Thumbnail strip */}
                    {allImages.length > 1 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {allImages.map((img, idx) => {
                          const src = embeddedGallery[img.src] || withSession(img.original_url || img.url, session);
                          const fallback = !embeddedGallery[img.src] ? buildProxyFallback(img.original_url || img.url, session) : null;
                          const active = idx === activeIdx;
                          return (
                            <button
                              key={`${img.src}-${idx}`}
                              type="button"
                              onClick={() => setActiveIdx(idx)}
                              className="relative shrink-0 overflow-hidden rounded border"
                              style={{
                                width: 56,
                                height: 44,
                                borderColor: active ? color : borderColor,
                                boxShadow: active ? `0 0 0 2px ${color}` : undefined,
                              }}
                              aria-label={`Show image ${idx + 1}: ${img.name}`}
                            >
                              {src ? (
                                <img
                                  src={src}
                                  alt={img.name}
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  onError={
                                    fallback
                                      ? (e) => {
                                          const t = e.currentTarget;
                                          if (t.dataset.tried) return;
                                          t.dataset.tried = "1";
                                          t.src = fallback;
                                        }
                                      : undefined
                                  }
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[8px]"
                                  style={{ color: mutedColor }}>—</div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {activeImage && (
                      <div className="text-[10px]" style={{ color: mutedColor }}>
                        <span className="font-mono">{activeImage.kind}</span>
                        {" · "}
                        <span>{activeImage.name}</span>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Output groups table */}
              <OutputGroupsTable
                groups={node.output_groups}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
              />

              {/* Classes table (for class_2D / class_3D / abinit / hetero) */}
              {node.classes && node.classes.length > 0 && (
                <ClassesTable
                  classes={node.classes}
                  session={session}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                />
              )}

              {/* Maps list */}
              {node.maps && node.maps.length > 0 && (
                <MapsList
                  maps={node.maps}
                  session={session}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                />
              )}

              {/* Incoming edges */}
              {incomingEdges.length > 0 && (
                <EdgeList
                  title="Incoming edges (data sources for this job)"
                  edges={incomingEdges}
                  nodeMap={nodeMap}
                  direction="in"
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                />
              )}

              {/* Outgoing edges */}
              {outgoingEdges.length > 0 && (
                <EdgeList
                  title="Outgoing edges (this job feeds into)"
                  edges={outgoingEdges}
                  nodeMap={nodeMap}
                  direction="out"
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                />
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/* ── Modal sub-components ─────────────────────────────────────────────── */

function FactGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2" style={{ borderColor: "transparent" }}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span
        className={mono ? "font-mono" : ""}
        style={{ color: "#0f172a", textAlign: "right" }}
        title={value}
      >
        {value.length > 36 ? value.slice(0, 35) + "…" : value}
      </span>
    </div>
  );
}

function OutputGroupsTable({
  groups, textColor, mutedColor, borderColor,
}: {
  groups: LineageNode["output_groups"];
  textColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  const entries = Object.entries(groups || {});
  if (entries.length === 0) return null;
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
        <Layers className="h-3.5 w-3.5" /> Output groups
        <span className="font-mono text-[10px]" style={{ color: mutedColor }}>({entries.length})</span>
      </h4>
      <div className="overflow-hidden rounded-md border" style={{ borderColor }}>
        <table className="w-full text-[10.5px]">
          <thead style={{ background: "rgba(148,163,184,0.12)" }}>
            <tr>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Name</th>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Type</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>Count</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>Class</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>%</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, g]) => (
              <tr key={name} className="border-t" style={{ borderColor }}>
                <td className="px-2 py-1 font-mono" style={{ color: textColor }}>{name}</td>
                <td className="px-2 py-1" style={{ color: mutedColor }}>{g.type || "—"}</td>
                <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>{g.count ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>{g.class_index ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>{g.percent != null ? `${g.percent.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClassesTable({
  classes, session, textColor, mutedColor, borderColor,
}: {
  classes: ClassSplit[];
  session: CryoSmartSession | null;
  textColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  const [embedded, setEmbedded] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      const out: Record<string, string> = {};
      await Promise.all(classes.filter((c) => c.mrc_preview_src).map(async (c) => {
        try {
          const b64 = await imageToBase64(session, c.mrc_preview_src!);
          if (!cancelled && b64) out[c.mrc_preview_src!] = b64;
        } catch { /* ignore */ }
      }));
      if (!cancelled) setEmbedded(out);
    })();
    return () => { cancelled = true; };
  }, [session, classes]);

  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
        <Layers className="h-3.5 w-3.5" /> Classes
        <span className="font-mono text-[10px]" style={{ color: mutedColor }}>({classes.length})</span>
      </h4>
      <div className="overflow-hidden rounded-md border" style={{ borderColor }}>
        <table className="w-full text-[10.5px]">
          <thead style={{ background: "rgba(148,163,184,0.12)" }}>
            <tr>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Preview</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>Class</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>Particles</th>
              <th className="px-2 py-1 text-right font-semibold" style={{ color: mutedColor }}>%</th>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Maps</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c, idx) => {
              const src = c.mrc_preview_src ? embedded[c.mrc_preview_src] || withSession(c.mrc_preview_url, session) : null;
              const fallback = c.mrc_preview_src && !embedded[c.mrc_preview_src] ? buildProxyFallback(c.mrc_preview_url, session) : null;
              return (
                <tr key={idx} className="border-t" style={{ borderColor }}>
                  <td className="px-2 py-1">
                    {src ? (
                      <img src={src} alt={`class ${c.class_index}`}
                        referrerPolicy="no-referrer"
                        onError={
                          fallback
                            ? (e) => {
                                const t = e.currentTarget;
                                if (t.dataset.tried) return;
                                t.dataset.tried = "1";
                                t.src = fallback;
                              }
                            : undefined
                        }
                        style={{ width: 48, height: 48, objectFit: "cover" }} />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded border text-[8px]"
                        style={{ borderColor, color: mutedColor }}>—</div>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>{c.class_index}</td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>
                    {c.particle_count != null ? c.particle_count.toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-1 text-right font-mono" style={{ color: textColor }}>
                    {c.particle_percent != null ? `${c.particle_percent.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-[10px]" style={{ color: mutedColor }}>
                    {c.maps.length} map{c.maps.length === 1 ? "" : "s"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MapsList({
  maps, session, textColor, mutedColor, borderColor,
}: {
  maps: MapAsset[];
  session: CryoSmartSession | null;
  textColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  const [embedded, setEmbedded] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      const out: Record<string, string> = {};
      await Promise.all(maps.filter((m) => m.preview_src).map(async (m) => {
        try {
          const b64 = await imageToBase64(session, m.preview_src!);
          if (!cancelled && b64) out[m.preview_src!] = b64;
        } catch { /* ignore */ }
      }));
      if (!cancelled) setEmbedded(out);
    })();
    return () => { cancelled = true; };
  }, [session, maps]);

  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
        <Layers className="h-3.5 w-3.5" /> Maps
        <span className="font-mono text-[10px]" style={{ color: mutedColor }}>({maps.length})</span>
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {maps.map((m, idx) => {
          const src = m.preview_src ? embedded[m.preview_src] || withSession(m.preview_url, session) : null;
          const fallback = m.preview_src && !embedded[m.preview_src] ? buildProxyFallback(m.preview_url, session) : null;
          return (
            <div key={idx} className="overflow-hidden rounded-md border" style={{ borderColor }}>
              <div className="flex h-20 items-center justify-center"
                style={{ background: "rgba(148,163,184,0.08)" }}>
                {src ? (
                  <img src={src} alt={m.group_title || m.group}
                    referrerPolicy="no-referrer"
                    onError={
                      fallback
                        ? (e) => {
                            const t = e.currentTarget;
                            if (t.dataset.tried) return;
                            t.dataset.tried = "1";
                            t.src = fallback;
                          }
                        : undefined
                    }
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : (
                  <div className="text-[10px]" style={{ color: mutedColor }}>no preview</div>
                )}
              </div>
              <div className="px-2 py-1 text-[10px]">
                <div className="truncate font-mono" style={{ color: textColor }} title={m.group}>
                  {m.group}
                </div>
                <div className="truncate" style={{ color: mutedColor }} title={m.result_name}>
                  {m.result_name}
                </div>
                <a
                  href={m.download_url}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-semibold text-teal-600 hover:underline dark:text-teal-400"
                >
                  <Download className="h-2.5 w-2.5" /> download
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EdgeList({
  title, edges, nodeMap, direction,
  textColor, mutedColor, borderColor,
}: {
  title: string;
  edges: LineageEdge[];
  nodeMap: Map<string, LineageNode>;
  direction: "in" | "out";
  textColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
        {direction === "in" ? <ArrowRight className="h-3.5 w-3.5 rotate-180" /> : <ArrowRight className="h-3.5 w-3.5" />}
        {title}
        <span className="font-mono text-[10px]" style={{ color: mutedColor }}>({edges.length})</span>
      </h4>
      <div className="overflow-hidden rounded-md border" style={{ borderColor }}>
        <table className="w-full text-[10.5px]">
          <thead style={{ background: "rgba(148,163,184,0.12)" }}>
            <tr>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Job</th>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Type</th>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Input</th>
              <th className="px-2 py-1 text-left font-semibold" style={{ color: mutedColor }}>Group</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e, idx) => {
              const otherUid = direction === "in" ? e.source : e.target;
              const otherNode = nodeMap.get(otherUid);
              return (
                <tr key={idx} className="border-t" style={{ borderColor }}>
                  <td className="px-2 py-1 font-mono" style={{ color: textColor }}>
                    {otherUid}
                    {otherNode && (
                      <span className="ml-1 text-[9.5px]" style={{ color: mutedColor }}>
                        ({otherNode.job_type})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1" style={{ color: mutedColor }}>{e.input_type || "—"}</td>
                  <td className="px-2 py-1" style={{ color: mutedColor }}>{e.input_name || "—"}</td>
                  <td className="px-2 py-1 font-mono" style={{ color: mutedColor }}>{e.source_group || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
