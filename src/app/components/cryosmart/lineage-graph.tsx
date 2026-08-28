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
 * Edges: n8n-style smooth curves that NEVER pass under a card — no
 *   segment of any edge is ever covered by a card:
 *   - Adjacent column: a smooth S-curve whose control points all sit
 *     inside the column gap, so the whole curve lives in the gap.
 *   - Multi-column (compact) / cross-row or multi-column (wrap): a
 *     smooth 3-segment "lane route" — curve into a free lane inside the
 *     source's column gap, run horizontally along the lane (a card-free
 *     band above the cards, below the cards, or between wrap rows),
 *     curve into the target's left gap. Lanes are staggered per edge so
 *     parallel long-range edges fan out instead of stacking.
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
  /** A staged Smart-Capture session produced the current data — the modal
   *  gallery's base64 prefetch then skips direct intranet image URLs (the
   *  capture script delivers bytes via the session-image channel; proxying
   *  them from the app server only grinds 10s timeouts per image). */
  stagedImport?: boolean;
}

/* ── Layout constants ───────────────────────────────────────────────────
 * The card GEOMETRY is mode-dependent: detail-mode cards are both wider and
 * taller than compact cards so the inline preview grid (up to 4 images) has
 * real room — hetero-refine montages and ab-initio class slices were
 * previously squeezed into a 180×100 box (user: "hetero-refine的图太小了").
 * The column gap (LAYER_X − NODE_W) stays ≥ 72px in BOTH modes, so the
 * card-free routing corridors below hold at either width. */
const NODE_W_COMPACT = 208;
const NODE_W_DETAIL = 256;
const NODE_H_COMPACT = 84;
const NODE_H_DETAIL = 260;
const LAYER_X_COMPACT = 280; // gap 72
const LAYER_X_DETAIL = 336;  // gap 80
const LAYER_Y_COMPACT = 116;
const LAYER_Y_DETAIL = 284;
/** Detail-mode inline preview grid geometry (inside the card). */
const THUMB_X = 10;
const THUMB_Y = 74;
const THUMB_GUTTER = 6;
const THUMB_MAX_IMAGES = 4;
const PAD = 28;
const TOP_AXIS_H = 50;
const TOP_LANE_H = 36; // "free lane" above cards for long-range orthogonal edges
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
// Wrap layout: max canvas width (the SVG width is capped so the layout
// fits a typical desktop viewport without horizontal scrolling). When
// the column count would exceed this width, columns wrap to a new row.
const WRAP_MAX_WIDTH = 1280;
// Wrap-mode LEFT routing gutter — a card-free vertical corridor between
// the canvas's left edge and the first (wrap-col-0) column. Cross-row
// edges that wrap into a row's FIRST card descend inside this corridor
// before turning right into the card's left port. Without it, col-0
// cards sit at x = PAD and their "left gap" is the canvas margin:
// routeEdgeLane clamps the descent to x ≈ 16 and the corner radii
// collapse to ~2px (portRoom = 2), producing the hard SQUARE left-side
// turns the user reported. 56px restores a proper gap so every turn
// keeps the full n8n-style r=24 quarter-ellipse used everywhere else.
const WRAP_LEFT_GUTTER = 56;
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

/** Pick up to `max` preview images for a node (detail-mode inline grid).
 *  CARD images are the job's UI-TILE images ONLY (user request: "卡片上的
 *  图片只显示ui title图片即可，其他都不显示") — each image type has its
 *  own place now:
 *    ui_tile   → the graph card (ab-initio class slices, select-2D template
 *                tiles and representative micrographs all LIVE in
 *                ui_tile_images, so those previews keep working),
 *    log images → the job-detail modal gallery (collectAllImages),
 *    output-group images → the Maps / download section.
 *  Candidates are deduped by src, then partitioned so RENDERABLE images
 *  (same-origin paths, session-image URLs, inline data:) come before direct
 *  intranet URLs — the app is viewed over HTTPS where direct
 *  `http://<cryosmart>` images are mixed-content blocked, so without this
 *  ordering a card's 4-cell grid could fill with broken tiles while
 *  perfectly-good session images wait behind them.
 *  Showing SEVERAL tiles matters for classification jobs — an ab-initio
 *  run produces one slice PER class and the old single-thumbnail card hid
 *  every class but the first (user: "ab-initio只显示1类，不完整"). */
function isRenderableSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  return src.startsWith("data:") || src.startsWith("/");
}

function pickPreviewImages(node: LineageNode, max = THUMB_MAX_IMAGES): ImageAsset[] {
  const all: ImageAsset[] = [];
  const seen = new Set<string>();
  for (const im of node.images || []) {
    if (im.kind !== "ui_tile") continue;   // card = UI title images only
    if (!im.src || seen.has(im.src)) continue;
    seen.add(im.src);
    all.push(im);
  }
  // Stable partition: renderable sources first (sort is stable, so the
  // original curated order is preserved within each half).
  const ranked = [...all].sort(
    (a, b) => Number(isRenderableSrc(b.src)) - Number(isRenderableSrc(a.src)),
  );
  return ranked.slice(0, max);
}

/** Collect the LOG images for a node (the modal gallery). Detail-page rule
 *  (user request: "点开详情页不显示ui title图，显示log图"): the gallery
 *  shows the job's runtime log images — kind `log_image` (flattened refs
 *  from the Smart Capture script) and kind `image_log` (raw jobLogs entries
 *  embedded on the job). UI-tile / output-group / class / map previews do
 *  NOT belong here; they render on the card, in the classes table and in
 *  the maps/download section respectively (each image has ONE home).
 *  Same renderable-first ranking as pickPreviewImages so the modal opens on
 *  an image that can actually load instead of a mixed-content-blocked one. */
function collectAllImages(node: LineageNode): ImageAsset[] {
  const out: ImageAsset[] = [];
  const seen = new Set<string>();
  for (const im of node.images || []) {
    if (im.kind !== "log_image" && im.kind !== "image_log") continue;
    if (!im.src || seen.has(im.src)) continue;
    seen.add(im.src);
    out.push(im);
  }
  // Stable partition: renderable sources first (same rationale as
  // pickPreviewImages — the gallery's first image is what the modal opens
  // on, so it should be one that loads).
  return [...out].sort(
    (a, b) => Number(isRenderableSrc(b.src)) - Number(isRenderableSrc(a.src)),
  );
}

/* ── Edge routing: n8n-style smooth curves that NEVER cross a card. ── */

/** Width of the free vertical corridor between adjacent columns (the
 *  compact-mode gap — the WORST case; detail mode's 80px gap only adds
 *  room, so every routing constant derived from this stays safe). */
const GAP_W = LAYER_X_COMPACT - NODE_W_COMPACT; // 72px — no card ever lives inside a gap

/** How far into a column gap the lane-route's vertical runs live.
 *  Split so the gap's 72px width gives the vertical run ~48px and leaves
 *  ~24px for the lane-side rounded corners — both strips are card-free
 *  at ANY y, which is what keeps the whole route card-free. */
const LANE_SHOULDER_W = Math.min(48, GAP_W * 0.67);

/** Max corner radius for lane-route turns (n8n smoothstep style). */
const LANE_CORNER_MAX = Math.min(24, GAP_W - LANE_SHOULDER_W, LANE_SHOULDER_W - 12);

interface EdgePath {
  d: string;
  /** where the arrow marker should sit (always the target-side endpoint). */
  markerEnd: string;
}

/** Wrap-mode x of a column's LEFT edge: PAD + routing gutter + wrapCol*LAYER_X.
 *  Single source of truth — the node layout AND the per-row axis labels must
 *  agree on it, or the headers drift off their cards (the label formula
 *  previously missed the gutter and sat 56px left of its column). */
function wrapColX(wrapCol: number, layerX: number): number {
  return PAD + WRAP_LEFT_GUTTER + wrapCol * layerX;
}

/**
 * Adjacent-column edge: smooth S-curve that lives ENTIRELY inside the
 * column gap. A cubic bezier is an affine combination of its control
 * points, so the curve's x stays within [x1, x2] whenever every control
 * x is — and [x1, x2] IS the gap (source right edge → target left
 * edge). Card-free by construction, in both layout modes.
 *
 * The control-point offset is clamped to the gap width so the curve can
 * never bulge sideways into either column (this also covers the
 * defensive same-column bow, which can't occur with longest-path
 * depths but is kept for safety).
 */
function routeEdgeGap(
  x1: number, y1: number,
  x2: number, y2: number,
): EdgePath {
  // n8n-style: control offset = half the horizontal distance (the classic
  // "smooth step" bezier) so the S-curve is as full as the gap allows —
  // small offsets made the bend look like a hard right angle.
  const offset = Math.max(20, Math.min(42, Math.abs(x2 - x1) * 0.5));
  return {
    d: `M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}`,
    markerEnd: `${x2},${y2}`,
  };
}

/**
 * Long-range edge (multi-column in compact mode; cross-row or
 * multi-column in wrap mode): an n8n "smoothstep"-style lane route —
 * straight segments joined by true quarter-ellipse rounded corners —
 * that is GUARANTEED to avoid every card (no segment is ever covered):
 *
 *   1. Exit the source's right port horizontally, round a corner into a
 *      vertical run inside the source's right column gap (no cards at
 *      ANY y inside a column gap), then round into the free lane.
 *   2. Run horizontally along the lane. The lane sits in a card-free
 *      band — above all cards (top band), below all cards (bottom
 *      band), or in the between-rows strip (wrap mode).
 *   3. Round out of the lane into a vertical run inside the target's
 *      left column gap, then round into the target's left port.
 *
 * `stag1` / `stag2` shift the two vertical runs sideways WITHIN their
 * column gaps. Without them every long-range edge whose source sits in
 * the same column would drop at the SAME x (x1 + LANE_SHOULDER_W) — their
 * vertical segments overprinted into the single muddy "thick line" the
 * user reported. Staggering by the source/target ROW spreads each column's
 * vertical runs across 5 distinct corridors 6px apart, so crossings stay
 * legible instead of stacking. The clamps keep each run inside its gap
 * ([x1+34, x1+58] / [x2-58, x2-34]) — card-free at every y in both modes.
 *
 * Corner radii are as large as the geometry allows (up to
 * LANE_CORNER_MAX, scaled down when the vertical detour or the lane run
 * is short), and each corner is a cubic bezier approximating a quarter
 * ellipse (kappa ≈ 0.5523) — the same construction n8n/xyflow use for
 * smoothstep edges, so turns read as wide sweeping arcs rather than the
 * tight near-right-angle fillets a single S-bezier produced here
 * (its control points nearly coincide in x, so the vertical drop
 * happened within a ~2px band and looked like a hard corner).
 *
 * Card-freeness proof: every corner's convex hull lies either inside a
 * column gap ([x1, x1+GAP_W] / [x2-GAP_W, x2] — card-free at every y) or,
 * for the lane-side corners, within LANE_CORNER_MAX of the lane itself
 * (card-free bands). The straight segments run inside gaps, along the
 * lane, or along the port rows in-gap. Hence no segment can ever pass
 * under a card.
 */
function routeEdgeLane(
  x1: number, y1: number,  // source right port
  x2: number, y2: number,  // target left port
  laneY: number,           // free-lane y (above or below the ports' rows)
  stag1 = 0,               // sideways stagger of the source-side vertical run
  stag2 = 0,               // sideways stagger of the target-side vertical run
): EdgePath {
  const s1 = laneY >= y1 ? 1 : -1;   // vertical direction source → lane
  const s2 = y2 >= laneY ? 1 : -1;   // vertical direction lane → target
  const dy1 = Math.abs(laneY - y1);  // vertical detour source → lane
  const dy2 = Math.abs(y2 - laneY);  // vertical detour lane → target

  // Vertical-run x positions — inside the source's right gap / the
  // target's left gap (both strips are card-free at every y). Wrap-col-0
  // targets get their "left gap" from WRAP_LEFT_GUTTER (their card sits
  // at PAD + gutter, so gx2 = x2 - LANE_SHOULDER_W lands ~36px inside the
  // canvas with full room for the r=24 corners). The clamps below are
  // defensive only — they keep the run inside the canvas (≥6) and ≥12px
  // before the target port in case a future layout squeezes the gap again.
  const gx1 = Math.min(Math.max(x1 + LANE_SHOULDER_W + stag1, x1 + 34), x1 + GAP_W - 14);
  // NOTE: an earlier version floored gx2 with max(gx2Raw, min(gx1+4, x2-12))
  // — that floor ONLY ever bound for backward (wrap-col-0) targets, where it
  // pushed the descent to x2-12 and collapsed the corner radii to ~2px (the
  // hard SQUARE left-side turns the user reported). The plain clamp keeps the
  // vertical run centered in the target's left gap/gutter with full room for
  // the r=24 quarter-ellipse corners; short lanes already degenerate safely
  // via the laneRoom shrink below.
  const gx2 = Math.min(Math.max(x2 - LANE_SHOULDER_W - stag2, 6), x2 - 12);
  // Lane direction: normally left→right, but a wrap-col-0 target sits
  // LEFT of the source, so the lane run goes right→left along the
  // card-free band (never under a card).
  const laneDir = gx2 >= gx1 ? 1 : -1;

  // Corner radii — as large as the room allows (n8n smoothstep style).
  //  A: port stub → source vertical run      B: source vertical → lane
  //  C: lane → target vertical run           D: target vertical → port
  //  A and D are bounded by the ACTUAL stub length (gx1−x1 / x2−gx2), which
  //  the stagger can shorten below the nominal shoulder width.
  const lead = 10;
  let rA = Math.min(LANE_CORNER_MAX, dy1 * 0.45, gx1 - x1 - lead);
  let rB = Math.min(LANE_CORNER_MAX, dy1 * 0.45, GAP_W - LANE_SHOULDER_W);
  let rC = Math.min(LANE_CORNER_MAX, dy2 * 0.45, GAP_W - LANE_SHOULDER_W);
  let rD = Math.min(LANE_CORNER_MAX, dy2 * 0.45, x2 - gx2 - lead);
  // Lane-side corners of a wrap-col-0 target extend toward the port —
  // clamp them so they stay clear of the target card's left edge.
  const portRoom = x2 - gx2 - lead;
  if (laneDir < 0) { rC = Math.min(rC, Math.max(0, portRoom)); }
  rD = Math.min(rD, Math.max(0, portRoom));
  // Each corner pair shares one vertical run: shrink proportionally when
  // the pair would overlap (small detours degenerate gracefully into a
  // compact S — the two corners simply meet).
  if (rA + rB > dy1) { const k = dy1 / (rA + rB || 1); rA *= k; rB *= k; }
  if (rC + rD > dy2) { const k = dy2 / (rC + rD || 1); rC *= k; rD *= k; }
  // The two lane-side corners share the lane run — shrink when short.
  const laneLen = Math.abs(gx2 - gx1);
  const laneRoom = Math.max(0, laneLen - 8);
  if (rB + rC > laneRoom) {
    if (laneRoom < 4) { rB = 0; rC = 0; }
    else { const k = laneRoom / (rB + rC || 1); rB *= k; rC *= k; }
  }

  // Quarter-ellipse corner emitter: cubic bezier with kappa controls.
  // `v→h` turns from a vertical run (direction sv) into a horizontal run
  // (direction sh); `h→v` is the mirror. r=0 emits a plain line-to.
  const K = 0.5523;
  const cornerVtoH = (
    x: number, y: number,      // corner start (on the vertical run)
    sv: number, sh: number, r: number,
  ) =>
    r < 0.5
      ? `L${x + sh * r},${y + sv * r}`
      : `C${x},${y + sv * K * r} ${x + sh * (1 - K) * r},${y + sv * r} ${x + sh * r},${y + sv * r}`;
  const cornerHtoV = (
    x: number, y: number,      // corner start (on the horizontal run)
    sh: number, sv: number, r: number,
  ) =>
    r < 0.5
      ? `L${x + sh * r},${y + sv * r}`
      : `C${x + sh * K * r},${y} ${x + sh * r},${y + sv * (1 - K) * r} ${x + sh * r},${y + sv * r}`;

  const d =
    // Port stub (in-gap, along the source row).
    `M${x1},${y1}` +
    `L${gx1 - rA},${y1}` +
    // Corner A: → source vertical run.
    cornerHtoV(gx1 - rA, y1, 1, s1, rA) +
    `L${gx1},${laneY - s1 * rB}` +
    // Corner B: → the lane.
    cornerVtoH(gx1, laneY - s1 * rB, s1, laneDir, rB) +
    `L${gx2 - laneDir * rC},${laneY}` +
    // Corner C: → target vertical run.
    cornerHtoV(gx2 - laneDir * rC, laneY, laneDir, s2, rC) +
    `L${gx2},${y2 - s2 * rD}` +
    // Corner D: → the target port row.
    cornerVtoH(gx2, y2 - s2 * rD, s2, 1, rD) +
    `L${x2},${y2}`;
  return { d, markerEnd: `${x2},${y2}` };
}


/* ── Component ────────────────────────────────────────────────────────── */
export function LineageGraph({ summary, session, stagedImport }: Props) {
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

  const [detailMode, setDetailMode] = useState(false);
  // Mode-dependent geometry (see the constants block above). Everything
  // downstream — card bodies, ports, lanes, wrap columns — reads THESE.
  const NODE_W = detailMode ? NODE_W_DETAIL : NODE_W_COMPACT;
  const NODE_H = detailMode ? NODE_H_DETAIL : NODE_H_COMPACT;
  const LAYER_X = detailMode ? LAYER_X_DETAIL : LAYER_X_COMPACT;
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
  const { nodes, edges, drawnEdges, layout, bounds, columns, depthMap, leafSet, wrapRowBounds, edgeLanes, portDy } = useMemo(() => {
    const nodes = summary.nodes || [];
    const edges = summary.edges || [];
    /* ── Parallel-edge dedupe ───────────────────────────────────────────
     * The same source→target pair can carry SEVERAL edges (one per input
     * slot — e.g. a job feeding another half_map_A + half_map_B + particles
     * from the SAME output groups). Drawing each produced multiple lines
     * between the two cards (user: "多个map连接到下游时会有多条重复的线，
     * 没有必要重复显示"). Draw ONE line per card pair — the first edge
     * decides the family color; the full edge list still drives ancestor
     * highlighting and the detail modal's input tables. */
    const seenPair = new Set<string>();
    const drawnEdges: LineageEdge[] = [];
    for (const e of edges) {
      if (!e || !e.source || !e.target) continue;
      const key = `${e.source}\u2192${e.target}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      drawnEdges.push(e);
    }
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
    // derived from WRAP_MAX_WIDTH, LAYER_X and the left routing gutter;
    // we floor to at least 2 so tiny lineages still get a horizontal
    // left→right strip in wrap mode.
    const maxColsPerRow = Math.max(
      2,
      Math.floor((WRAP_MAX_WIDTH - PAD * 2 - WRAP_LEFT_GUTTER) / LAYER_X),
    );
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
              ? wrapColX(cw.wrapCol, LAYER_X)
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
    // vertically, so the SVG grows DOWN, not RIGHT. The width covers the
    // widest possible row (gutter + maxColsPerRow columns + margins, plus
    // headroom so the last column's centered axis label isn't clipped)
    // and the actual rightmost card. In compact mode the canvas grows
    // horizontally to fit every column.
    const totalWidth =
      layoutMode === "wrap"
        ? Math.min(
            WRAP_MAX_WIDTH,
            Math.max(
              maxX + PAD + 60,
              PAD + WRAP_LEFT_GUTTER + Math.min(cols.length, maxColsPerRow) * LAYER_X + PAD,
            ),
          )
        : Math.max(maxX + PAD, cols.length * LAYER_X + PAD, PAD * 2);
    const totalHeight =
      layoutMode === "wrap"
        ? topOffset + numWrapRows * tallestColHeight + (numWrapRows - 1) * WRAP_ROW_GAP + NODE_H + PAD
        : topOffset + tallestColHeight + NODE_H + PAD;

    /* ── Port fan-out ───────────────────────────────────────────────────
     * Every edge used to enter/leave a card at the SAME point (the side's
     * vertical center). A hub node with k connections drew k curves all
     * converging onto one point — and parallel edges (same source→target,
     * different data kinds) overprinted EXACTLY, reading as one muddy
     * "thick line" (user: "有一些线很粗"). n8n-style port slots: each
     * node's k connections get their own port spread ±26px around the
     * center, so curves fan out and parallel edges stay visually distinct. */
    const portDy = new Map<number, { dy1: number; dy2: number }>();
    {
      const outLists = new Map<string, number[]>();
      const inLists = new Map<string, number[]>();
      drawnEdges.forEach((e, i) => {
        if (!e.source || !e.target) return;
        if (!outLists.has(e.source)) outLists.set(e.source, []);
        outLists.get(e.source)!.push(i);
        if (!inLists.has(e.target)) inLists.set(e.target, []);
        inLists.get(e.target)!.push(i);
      });
      const spread = (k: number): number[] => {
        if (k <= 1) return [0];
        const maxHalf = 26;
        const step = Math.min(14, (maxHalf * 2) / (k - 1));
        const half = (step * (k - 1)) / 2;
        return Array.from({ length: k }, (_, j) => -half + j * step);
      };
      for (const list of outLists.values()) {
        const dys = spread(list.length);
        list.forEach((edgeIdx, j) => {
          const cur = portDy.get(edgeIdx) || { dy1: 0, dy2: 0 };
          portDy.set(edgeIdx, { ...cur, dy1: dys[j] });
        });
      }
      for (const list of inLists.values()) {
        const dys = spread(list.length);
        list.forEach((edgeIdx, j) => {
          const cur = portDy.get(edgeIdx) || { dy1: 0, dy2: 0 };
          portDy.set(edgeIdx, { ...cur, dy2: dys[j] });
        });
      }
    }

    /* ── Lane assignment for long-range edges ─────────────────────────
     * Long-range edges (multi-column in compact mode; cross-row or
     * multi-column within a wrap row) route through free "lanes" (see
     * routeEdgeLane). Each such edge gets its own staggered lane Y so
     * parallel long-range edges fan out instead of stacking:
     *
     *  - compact TOP band:    between the axis labels and the card tops
     *                          → edges whose endpoints sit in the upper half.
     *  - compact BOTTOM band: below the lowest card (cards end at least
     *                          LAYER_Y - NODE_H above the column-band bottom)
     *                          → edges whose endpoints sit in the lower half.
     *  - wrap bands:          the strip below each source row, up to just
     *                          above the next row's axis header (or the
     *                          canvas bottom for the last row). Cards in a
     *                          row end ≥ LAYER_Y - NODE_H above the row's
     *                          bottomY, so the strip is card-free.
     * Adjacent-column edges are excluded — they use the in-gap S-curve. */
    const edgeLanes = new Map<string, number>();
    {
      interface LaneCandidate {
        key: string; sc: number; srow: number; tc: number; y1: number; y2: number;
      }
      const topLanes: LaneCandidate[] = [];
      const bottomLanes: LaneCandidate[] = [];
      const wrapBands = new Map<number, LaneCandidate[]>();
      drawnEdges.forEach((e, i) => {
        if (!e.source || !e.target) return;
        const from = layout.get(e.source);
        const to = layout.get(e.target);
        if (!from || !to) return;
        const pd = portDy.get(i) || { dy1: 0, dy2: 0 };
        const cand: LaneCandidate = {
          key: `${e.source}\u2192${e.target}`,
          sc: from.columnIndex, srow: from.row, tc: to.columnIndex,
          y1: from.y + NODE_H / 2 + pd.dy1, y2: to.y + NODE_H / 2 + pd.dy2,
        };
        if (layoutMode === "wrap") {
          const fw = from.wrapRow ?? 0;
          const tw = to.wrapRow ?? 0;
          if (fw === tw) {
            const wcd = (to.wrapCol ?? 0) - (from.wrapCol ?? 0);
            if (wcd <= 1) return; // adjacent (or backward, not drawn) — S-curve
          }
          if (!wrapBands.has(fw)) wrapBands.set(fw, []);
          wrapBands.get(fw)!.push(cand);
        } else {
          const d = to.columnIndex - from.columnIndex;
          if (d <= 1) return; // adjacent / defensive — S-curve
          if ((cand.y1 + cand.y2) / 2 < topOffset + tallestColHeight / 2) {
            topLanes.push(cand);
          } else {
            bottomLanes.push(cand);
          }
        }
      });
      // Distribute lanes evenly inside a [yTop, yBottom] band, sorted so
      // leftmost sources get the outermost (highest/lowest) lane.
      const assign = (list: LaneCandidate[], yTop: number, yBottom: number) => {
        if (list.length === 0 || yBottom <= yTop) return;
        list.sort((a, b) => a.sc - b.sc || a.srow - b.srow || a.tc - b.tc);
        const n = list.length;
        list.forEach((c, k) => {
          const y =
            n === 1
              ? (yTop + yBottom) / 2
              : yTop + ((yBottom - yTop) * (k + 1)) / (n + 1);
          edgeLanes.set(c.key, Math.round(y * 10) / 10);
        });
      };
      assign(topLanes, TOP_AXIS_H + 8, topOffset - 8);
      assign(bottomLanes, topOffset + tallestColHeight - (LAYER_Y - NODE_H) + 8, totalHeight - 10);
      for (const [r, list] of wrapBands) {
        const bottomY = wrapRowBounds[r]?.bottomY ?? topOffset + tallestColHeight;
        const bandTop = bottomY - (LAYER_Y - NODE_H) + 8;
        const bandBottom =
          r + 1 < numWrapRows ? wrapRowBounds[r + 1].topY - 28 : totalHeight - 10;
        assign(list, bandTop, bandBottom);
      }
    }

    return {
      nodes, edges, drawnEdges, layout, bounds: { w: totalWidth, h: totalHeight },
      columns: cols, depthMap, leafSet, wrapRowBounds, edgeLanes, portDy,
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

  /** Map of nodeUid → up-to-4 preview-image base64 data URLs (detail-mode
   *  inline grid). Pre-fetched so the cards render self-contained. */
  const [embeddedThumbs, setEmbeddedThumbs] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!session || !detailMode) {
      setEmbeddedThumbs({});
      return;
    }
    let cancelled = false;
    const thumbs: Record<string, string[]> = {};
    // Capture the narrowed (non-null) session — the early-return guard above
    // narrows `session`, but that narrowing doesn't survive into the worker
    // closure below.
    const sess = session;
    (async () => {
      // Dynamic import to keep the lib out of the server bundle.
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      // Flat task list: one entry per (node, image) pair.
      const tasks: Array<{ uid: string; src: string }> = [];
      for (const n of nodes) {
        for (const img of pickPreviewImages(n)) {
          if (img.src) tasks.push({ uid: n.uid, src: img.src });
        }
      }
      const CONCURRENCY = 6;
      let cursor = 0;
      async function worker() {
        while (cursor < tasks.length) {
          const task = tasks[cursor++];
          try {
            const b64 = await imageToBase64(sess, task.src);
            if (!cancelled && b64) {
              (thumbs[task.uid] ||= []).push(b64);
            }
          } catch {
            // ignore — fallback to remote URL in render
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (!cancelled && Object.keys(thumbs).length > 0) setEmbeddedThumbs(thumbs);
    })();
    return () => { cancelled = true; };
  }, [session, detailMode, nodes]);

  /* Pan via pointer drag on the canvas background (not on nodes).
   * POINTER events (v3.14) — covers mouse, touch and pen in one path; the
   * old mouse-only implementation made drag-pan inoperative on touch
   * devices. `setPointerCapture` keeps the move/up stream flowing to the
   * container even when the pointer leaves it, and replaces the old window
   * listeners (which leaked if the component unmounted mid-drag).
   * Two active pointers = pinch-zoom about their midpoint. */
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as Element | null)?.closest("[data-node]")) return;
    const el = e.currentTarget as HTMLElement;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // some browsers reject capture for released pointers — harmless
    }
    if (activePointersRef.current.size === 2) {
      const [p1, p2] = Array.from(activePointersRef.current.values());
      pinchStartRef.current = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        zoom: zoomRef.current,
      };
      setDragging(false);
      return;
    }
    if (activePointersRef.current.size > 2) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = pan.x;
    const startPanY = pan.y;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (!activePointersRef.current.has(ev.pointerId)) return;
      activePointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinchStartRef.current && activePointersRef.current.size >= 2) {
        // Pinch: zoom about the current midpoint, anchored at the start zoom.
        const [p1, p2] = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (dist > 10 && pinchStartRef.current.dist > 10) {
          const target = Math.max(
            MIN_ZOOM,
            Math.min(MAX_ZOOM, pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist))
          );
          const rect = el.getBoundingClientRect();
          const midX = (p1.x + p2.x) / 2 - rect.left;
          const midY = (p1.y + p2.y) / 2 - rect.top;
          const z0 = zoomRef.current;
          const k = z0 > 0 ? target / z0 : 1;
          if (k !== 1) {
            zoomRef.current = target;
            setZoom(target);
            setPan((p) => ({ x: midX - (midX - p.x) * k, y: midY - (midY - p.y) * k }));
          }
        }
        return;
      }
      setPan({ x: startPanX + (ev.clientX - startX), y: startPanY + (ev.clientY - startY) });
    };
    const up = (ev: PointerEvent) => {
      activePointersRef.current.delete(ev.pointerId);
      if (activePointersRef.current.size < 2) pinchStartRef.current = null;
      if (activePointersRef.current.size === 0) {
        setDragging(false);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, [pan.x, pan.y]);

  /* Wheel zoom (non-passive so preventDefault stops page scroll).
   * Cursor-anchored (n8n/ReactFlow behavior): the content point under the
   * mouse cursor stays fixed while the scale changes — pan is adjusted by
   * pan' = cursor - (cursor - pan) * (z'/z). Previously zoom scaled around
   * the ORIGIN (0,0), so zooming in while panned dragged the viewport
   * sideways and felt broken. zoomRef mirrors the state so the handler
   * can read the CURRENT zoom synchronously (setZoom's updater must stay
   * pure — no side effects — so we don't compute pan inside it). */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /* Shared zoom-about-a-point helper. `px, py` are container-relative
   * anchor coordinates (mouse position for wheel, center for buttons). */
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const z0 = zoomRef.current;
    const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
    if (z1 === z0) return;
    const k = z1 / z0;
    zoomRef.current = z1;
    setZoom(z1);
    setPan((p) => ({ x: px - (px - p.x) * k, y: py - (py - p.y) * k }));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.87 : 1.15);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* Fit-to-view: zoom so the whole graph fits in the container, and CENTER
   * it — previously pan was reset to (0,0), so content smaller than the
   * container hugged the top-left corner and wasted the surrounding
   * space. Content larger than the container stays pinned at top-left
   * (clamped ≥ 0) so nothing drifts out of view. */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0 || bounds.w === 0 || bounds.h === 0) {
      zoomRef.current = MIN_ZOOM;
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      return;
    }
    const z = Math.min(cw / bounds.w, ch / bounds.h);
    const safeZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    zoomRef.current = safeZ;
    setZoom(safeZ);
    setPan({
      x: Math.max(0, (cw - bounds.w * safeZ) / 2),
      y: Math.max(0, (ch - bounds.h * safeZ) / 2),
    });
  }, [bounds.w, bounds.h]);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* Button zoom anchored at the canvas CENTER (same math as the wheel). */
  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    zoomAt(el ? el.clientWidth / 2 : 0, el ? el.clientHeight / 2 : 0, factor);
  }, [zoomAt]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  /* PNG export — canvas-based, 2× retina, theme-colored background.
   * Remote <image> thumbnails (http(s) hrefs) are STRIPPED from the
   * serialized SVG before rasterizing: the blob-SVG loader either fails
   * to fetch them or taints the canvas, and toBlob then returns null —
   * the download silently did nothing in no-session mode. Data: URLs
   * (embedded thumbnails) are kept. */
  const exportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("image").forEach((im) => {
      const href =
        im.getAttribute("href") ??
        im.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
        "";
      if (!href.startsWith("data:")) im.remove();
    });
    const xml = new XMLSerializer().serializeToString(clone);
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
  const belowCanvasCaption = `${nodes.length} jobs \u00B7 ${drawnEdges.length} data links \u00B7 ${leafSet.size} source node${leafSet.size === 1 ? "" : "s"} \u00B7 hover/click a node to trace its path \u00B7 drag to pan \u00B7 scroll/buttons to zoom \u00B7 click a card for full details`;

  const selectedNode = selectedUid ? nodeMap.get(selectedUid) ?? null : null;
  const modalNode = modalUid ? nodeMap.get(modalUid) ?? null : null;

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
            onClick={() => zoomBy(1.15)}
            title="Zoom in (+15%, centered)" aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => zoomBy(1 / 1.15)}
            title="Zoom out (−15%, centered)" aria-label="Zoom out"
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
          // Let pointer drags pan the graph on touch devices instead of
          // scrolling the page (page scroll is still available everywhere
          // outside the canvas — the standard canvas-app convention).
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
      >
        <span className="sr-only">
          Lineage graph: {nodes.length} jobs and {drawnEdges.length} data links. Target job is {summary.start_uid}. Data flows from the leftmost (oldest) source jobs rightward, converging on the target job on the far right. Use Tab to focus a node and Enter or Space to open its details.
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
            {/* Clip shape matching the card body's rounded rect. Applied to
                the left accent bar so its top/bottom corners follow the
                card's rounded outline — previously the bar's square corners
                protruded OUTSIDE the card frame, which looked broken. The
                clip is defined in the referencing element's local user
                space (each card's <g> has its own translate), so a single
                shared clipPath serves every card. */}
            <clipPath id="card-clip">
              <rect width={NODE_W} height={NODE_H} rx={8} />
            </clipPath>
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
                ? wrapColX(cw.wrapCol ?? 0, LAYER_X) + NODE_W / 2
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

          {/* Edges. Every route is card-free by construction: adjacent
              columns use an in-gap S-curve; long-range edges use a
              staggered free-lane route (see routeEdgeGap/routeEdgeLane).
              Edges are still drawn before nodes, but no edge ever passes
              under a card, so nothing is ever visually clipped.
              Parallel-edge DEDUPE: one line per source→target pair (the
              first edge of the pair sets the color) — several input slots
              between the same two cards no longer stack duplicate lines.
              Port fan-out (portDy) + corridor stagger keep hub-converging
              edges from overprinting into "thick" muddy lines. */}
          {drawnEdges.map((e, i) => {
            const from = layout.get(e.source);
            const to = layout.get(e.target);
            if (!from || !to) return null;
            // Port fan-out: each connection gets its own slot on the card
            // side, spread ±26px around the center (n8n-style handles).
            const pd = portDy.get(i) || { dy1: 0, dy2: 0 };
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2 + pd.dy1;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2 + pd.dy2;
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
            // Pick routing: long-range edges (assigned a staggered lane
            // in the layout pass) → smooth lane route; adjacent columns
            // (and defensive same-column bows) → in-gap S-curve.
            const laneY = edgeLanes.get(edgeKey);
            // Corridor stagger: shift each vertical run sideways inside its
            // column gap by the source/target ROW so same-column runs don't
            // overprint (see routeEdgeLane docs).
            const stag1 = ((from.row % 5) - 2) * 6;
            const stag2 = ((to.row % 5) - 2) * 6;
            const d = (laneY != null
              ? routeEdgeLane(x1, y1, x2, y2, laneY, stag1, stag2)
              : routeEdgeGap(x1, y1, x2, y2)
            ).d;
            return (
              // Same source→target pair CAN appear twice (e.g. a job feeds
              // another with both particles and a volume — two colored
              // paths, legitimately). Suffix the index so React keys stay
              // unique while still being stable across re-renders.
              <g key={`${edgeKey}#${i}`}>
                {/* Highlight casing — a background-colored halo under the
                    colored path so a highlighted edge visually separates
                    from the pack instead of blending into neighbours. */}
                {isHi && (
                  <path
                    d={d}
                    fill="none"
                    stroke={bgColor}
                    strokeWidth={strokeWidth + 4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={0.85}
                    pointerEvents="none"
                  />
                )}
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

            // Detail-mode inline preview: up to THUMB_MAX_IMAGES images in a
            // 1-wide (single image) or 2×2 grid — classification jobs show
            // ALL their classes at a glance instead of just the first.
            const previewImgs = detailMode ? pickPreviewImages(node) : [];
            const embeddedList = previewImgs.length ? embeddedThumbs[node.uid] : undefined;
            const thumbW = NODE_W - THUMB_X * 2;
            const thumbH = NODE_H - THUMB_Y - 10;
            const cellW = (thumbW - THUMB_GUTTER) / 2;
            const cellH = (thumbH - THUMB_GUTTER) / 2;
            // "+N" chip counts the ui-tile images the grid couldn't fit —
            // the card shows ONLY ui tiles now, so the overflow is tiles
            // (log images live in the modal, not behind this chip).
            const tileSrcs = new Set<string>();
            for (const im of node.images || []) {
              if (im.kind === "ui_tile" && im.src) tileSrcs.add(im.src);
            }
            const extraCount = Math.max(0, tileSrcs.size - previewImgs.length);

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
                    there's no gap between the glow and the card body.
                    Family-colored so it matches the card's own accent. */}
                {isHoveredEdgeEndpoint && !isSelected && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6} height={NODE_H + 6}
                    rx={11}
                    fill={color}
                    opacity={0.2}
                    filter="url(#start-glow)"
                    pointerEvents="none"
                  />
                )}
                {/* SELECTED glow halo — same soft treatment, family-colored,
                    so a selected card reads as "lit up" in its own color
                    (and stays distinguishable from the thinner hover border). */}
                {isSelected && (
                  <rect
                    x={-3} y={-3}
                    width={NODE_W + 6} height={NODE_H + 6}
                    rx={11}
                    fill={color}
                    opacity={0.26}
                    filter="url(#start-glow)"
                    pointerEvents="none"
                  />
                )}
                {/* Card body — the stroke IS the selection/hover/SOURCE/
                    TARGET border. No separate ring `<rect>` elements → no
                    gap between border and body. Hover/selection borders use
                    the card's FAMILY color — the same color as the left
                    accent bar — so border and bar merge into one seamless
                    band (user request: "悬停/选中框颜色和左边条一致，且
                    与左边条之间不留空隙").
                    The LEFT ACCENT BAR below starts at x=0 — the stroke's
                    CENTERLINE — and paints OVER the stroke's inner half,
                    so there is no card-gradient sliver between the border
                    and the bar at ANY border width (previously the bar sat
                    at x=borderW/2, the stroke's inner edge, and the two
                    anti-aliased edges produced a visible ~1px gap).
                    Priority: isSelected > isHoveredEdgeEndpoint > isHovered
                    > isTarget/isLeaf. */}
                {(() => {
                  const borderCol =
                    isSelected || isHoveredEdgeEndpoint || isHovered
                      ? color
                      : isTarget
                        ? targetColor
                        : isLeaf
                          ? startColor
                          : borderColor;
                  const borderW =
                    isSelected ? 3
                    : isHoveredEdgeEndpoint ? 2.5
                    : isHovered ? 2
                    : (isTarget || isLeaf) ? 1.5
                    : 1;
                  return (
                    <>
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        fill="url(#card-grad)"
                        stroke={borderCol}
                        strokeWidth={borderW}
                        filter="url(#card-shadow)"
                      />
                      {/* Left color bar — x=0 = the stroke's CENTERLINE, so
                          the bar covers the stroke's inner half and merges
                          flush with the border (zero gap by construction).
                          Still clipped to the card's rounded outline so the
                          bar never protrudes outside the card frame. */}
                      <rect
                        x={0} y={0}
                        width={4} height={NODE_H}
                        fill={color}
                        clipPath="url(#card-clip)"
                      />
                    </>
                  );
                })()}
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

                {/* Inline preview grid (detail mode only).
                    - 1 image  → single large preview (full card width × the
                      taller detail-card body — square class slices render at
                      ~176px instead of the old 100px).
                    - 2+ images → 2×2 grid of cells so ab-initio / hetero-refine
                      show every class at a glance; a "+N" chip on the last
                      cell points at the full gallery in the detail modal. */}
                {detailMode && previewImgs.length === 1 && (() => {
                  const img = previewImgs[0];
                  const b64 = embeddedList?.[0];
                  const src = b64 || withSession(img.src || img.original_url, session);
                  const fallback = !b64
                    ? buildProxyFallback(img.src || img.original_url, session)
                    : null;
                  return src ? (
                    <image
                      href={src}
                      x={THUMB_X}
                      y={THUMB_Y}
                      width={thumbW}
                      height={thumbH}
                      preserveAspectRatio="xMidYMid meet"
                      // referrerpolicy is honored on SVG <image> by Chromium
                      // (and mirrors the report's <meta name="referrer">), but
                      // React's SVGProps doesn't model it — cast to keep tsc
                      // happy while preserving the runtime attribute.
                      {...({ referrerPolicy: "no-referrer" } as React.SVGProps<SVGImageElement>)}
                      onError={
                        fallback
                          ? (e) => {
                              const t = e.currentTarget;
                              if (t.getAttribute("data-tried")) return;
                              t.setAttribute("data-tried", "1");
                              t.setAttribute("href", fallback);
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <rect
                      x={THUMB_X} y={THUMB_Y}
                      width={thumbW} height={thumbH}
                      rx={4}
                      fill={isDark ? "#1e293b" : "#f1f5f9"}
                      stroke={borderColor}
                    />
                  );
                })()}
                {detailMode && previewImgs.length >= 2 && previewImgs.map((img, k) => {
                  const col = k % 2;
                  const row = Math.floor(k / 2);
                  const cx = THUMB_X + col * (cellW + THUMB_GUTTER);
                  const cy = THUMB_Y + row * (cellH + THUMB_GUTTER);
                  const b64 = embeddedList?.[k];
                  const src = b64 || withSession(img.src || img.original_url, session);
                  const fallback = !b64
                    ? buildProxyFallback(img.src || img.original_url, session)
                    : null;
                  const isLast = k === previewImgs.length - 1;
                  return (
                    <g key={`${img.src}-${k}`}>
                      {/* Cell frame — keeps an empty slot visible when the
                          image is still loading or failed to load. */}
                      <rect
                        x={cx} y={cy}
                        width={cellW} height={cellH}
                        rx={4}
                        fill={isDark ? "#1e293b" : "#f1f5f9"}
                        stroke={borderColor}
                      />
                      {src && (
                        <image
                          href={src}
                          x={cx + 1} y={cy + 1}
                          width={cellW - 2} height={cellH - 2}
                          preserveAspectRatio="xMidYMid meet"
                          {...({ referrerPolicy: "no-referrer" } as React.SVGProps<SVGImageElement>)}
                          onError={
                            fallback
                              ? (e) => {
                                  const t = e.currentTarget;
                                  if (t.getAttribute("data-tried")) return;
                                  t.setAttribute("data-tried", "1");
                                  t.setAttribute("href", fallback);
                                }
                              : undefined
                          }
                        />
                      )}
                      {/* "+N more" chip on the last cell when the job has
                          more images than the grid shows. */}
                      {isLast && extraCount > 0 && (
                        <g transform={`translate(${cx + cellW - 40}, ${cy + cellH - 16})`}>
                          <rect width={36} height={14} rx={7} fill={color} opacity={0.92} />
                          <text
                            x={18} y={10.5}
                            textAnchor="middle"
                            fontSize={9}
                            fontWeight={700}
                            fill="#ffffff"
                            style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                          >
                            +{extraCount}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
                {detailMode && previewImgs.length === 0 && (
                  <g transform={`translate(${THUMB_X}, ${THUMB_Y})`}>
                    <rect width={thumbW} height={thumbH} rx={4}
                      fill={isDark ? "#1e293b" : "#f1f5f9"}
                      stroke={borderColor} />
                    <text
                      x={thumbW / 2} y={thumbH / 2 + 4}
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
          stagedImport={stagedImport}
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
  /** Staged capture active — the gallery prefetch skips direct intranet
   *  URLs (bytes arrive via the session-image channel instead). */
  stagedImport?: boolean;
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
  node, summary, session, stagedImport,
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
  /* Image srcs that failed EVERY load strategy (direct + proxy fallback).
   * Used to swap the broken-image icon for a calm "not captured" tile —
   * e.g. log images whose bytes never reached the session store, or a
   * session whose TTL expired. */
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  useEffect(() => { setFailedSrcs({}); setActiveIdx(0); }, [node.uid]);

  /* Pre-fetch all gallery images as base64 when a session is available,
   * so they render self-contained (no remote/referrer/CORS issues).
   * Capped at MAX_EMBED_PREFETCH — a 112-image job would otherwise fetch
   * every byte before the user sees anything (v3.11: the last-iteration
   * filter already shrinks most galleries far below the cap). */
  const MAX_EMBED_PREFETCH = 48;
  useEffect(() => {
    if (!session || allImages.length === 0) {
      setEmbeddedGallery({});
      return;
    }
    let cancelled = false;
    // Capture the narrowed (non-null) session for the worker closure.
    const sess = session;
    (async () => {
      const { imageToBase64 } = await import("@/lib/cryosmart/image-embed");
      const out: Record<string, string> = {};
      const targets = allImages.slice(0, MAX_EMBED_PREFETCH);
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < targets.length) {
          const idx = cursor++;
          const img = targets[idx];
          try {
            const b64 = await imageToBase64(sess, img.src, {
              skipDirectCryosmart: stagedImport === true,
            });
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
  }, [session, allImages, stagedImport]);

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
          {/* min-w-0 on the grid columns: without it the 1fr track's
              min-content width is the content's intrinsic width — a long
              thumbnail strip / table stretched the track past the dialog
              and the dialog's overflow-hidden CLIPPED the right side
              (the "宽度撑的很大，右侧显示不全" bug). */}
          <div className="grid min-w-0 grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* LEFT: facts list + status + position */}
            <div className="min-w-0 space-y-3">
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
            <div className="min-w-0 space-y-4">
              {/* Image gallery — LOG images only. UI-tile images render on
                  the graph card, output-group images in the Maps section;
                  each image type has exactly one home (user request). */}
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: textColor }}>
                    <ImageIcon className="h-3.5 w-3.5" /> Log images
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
                    No log images captured for this job.
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
                      {activeSrc && !failedSrcs[activeImage?.src || ""] ? (
                        <img
                          src={activeSrc}
                          alt={activeImage?.name || "preview"}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                          onError={
                            (e) => {
                              const t = e.currentTarget;
                              const key = activeImage?.src || activeSrc;
                              if (t.dataset.tried) {
                                setFailedSrcs((prev) => ({ ...prev, [key]: true }));
                                return;
                              }
                              t.dataset.tried = "1";
                              if (activeFallback) t.src = activeFallback;
                              else setFailedSrcs((prev) => ({ ...prev, [key]: true }));
                            }
                          }
                          style={{ maxWidth: "100%", maxHeight: 340, objectFit: "contain" }}
                        />
                      ) : activeSrc ? (
                        <div className="flex flex-col items-center gap-1 px-6 text-center">
                          <ImageIcon className="h-5 w-5 opacity-40" style={{ color: mutedColor }} />
                          <div className="text-[11px]" style={{ color: mutedColor }}>
                            Image unavailable — its bytes were not captured by the
                            Smart Capture script (or the session expired).
                          </div>
                          <div className="text-[10px] font-mono" style={{ color: mutedColor }}>
                            {activeImage?.name}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px]" style={{ color: mutedColor }}>
                          image unavailable
                        </div>
                      )}
                    </div>
                    {/* Thumbnail grid — wraps (bounded height, vertical
                        scroll) so a large gallery never stretches the modal
                        sideways; the old single-row strip made a 112-image
                        job's min-content width exceed the dialog. */}
                    {allImages.length > 1 && (
                      <div className="flex max-h-[168px] flex-wrap gap-1.5 overflow-y-auto pb-1">
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
                              {src && !failedSrcs[img.src] ? (
                                <img
                                  src={src}
                                  alt={img.name}
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  onError={
                                    (e) => {
                                      const t = e.currentTarget;
                                      if (t.dataset.tried) {
                                        setFailedSrcs((prev) => ({ ...prev, [img.src]: true }));
                                        return;
                                      }
                                      t.dataset.tried = "1";
                                      if (fallback) t.src = fallback;
                                      else setFailedSrcs((prev) => ({ ...prev, [img.src]: true }));
                                    }
                                  }
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : src ? (
                                <div className="flex h-full w-full items-center justify-center text-[8px]"
                                  style={{ color: mutedColor }} title="bytes not captured">✕</div>
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
                      <div className="break-all text-[10px]" style={{ color: mutedColor }}>
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
      <div className="overflow-x-auto rounded-md border" style={{ borderColor }}>
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
                <td className="break-all px-2 py-1 font-mono" style={{ color: textColor }}>{name}</td>
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
      <div className="overflow-x-auto rounded-md border" style={{ borderColor }}>
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
                                if (t.dataset.tried) { t.style.display = "none"; return; }
                                t.dataset.tried = "1";
                                t.src = fallback;
                              }
                            : (e) => { e.currentTarget.style.display = "none"; }
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
  /* The Maps section is the home of the job's OUTPUT-GROUP images (user
   * rule: "下载map处显示output group图") — `preview_src` comes from
   * `output_group_images[group]`, and a failed preview hides itself
   * instead of showing a broken-image icon. */
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
      {/* 3 maps per row (user request — one-per-row wasted vertical space
          on jobs with sharp/half map sets). Cards stay compact so 3 fit
          even on narrow viewports. */}
      <div className="grid grid-cols-3 gap-2">
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
                            if (t.dataset.tried) { t.style.display = "none"; return; }
                            t.dataset.tried = "1";
                            t.src = fallback;
                          }
                        : (e) => { e.currentTarget.style.display = "none"; }
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
      <div className="overflow-x-auto rounded-md border" style={{ borderColor }}>
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
                  <td className="break-all px-2 py-1 font-mono" style={{ color: textColor }}>
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
