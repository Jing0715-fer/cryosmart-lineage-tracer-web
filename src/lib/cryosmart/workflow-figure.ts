/**
 * Workflow-figure model builder + image post-processing (v3.41).
 *
 * Turns a `LineageSummary` into the stage model consumed by the 16:9
 * workflow PPTX (format modelled after the user's reference Workflow.pptx:
 * a text header row "N Micrographs → Auto pick → N particles", then map
 * thumbnails arranged left → right — parallel refinement branches stacked
 * vertically with per-branch stats — connected by straight / elbow arrows,
 * final resolution text bottom-right).
 *
 * Map thumbnails come from three modes (chosen by the FlowFigureCard):
 *   - "chimerax": rendered by ChimeraX via the flow bridge (aligned to a
 *     reference, handedness-checked, uniform camera — see chimerax-bridge.ts)
 *   - "preview":  captured preview images from the session
 *   - "demo":     the reference-style sample images shipped in /demo
 */

import type {
  ClassSplitJob,
  ImageAsset,
  LineageNode,
  LineageSummary,
  MapAsset,
} from "./types";
import { normalMapAssets } from "./lineage";
import { PICKING_JOB_TYPES } from "./constants";
import type { CryoSmartSession } from "./proxy-client";
import { cryoSmartBytes } from "./proxy-client";
import { parseFscText, type FscCurve } from "./fsc-parser";
import { parseFscXml, renderFscCurvePng } from "./fsc-xml";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface FlowFigureItem {
  uid: string;
  label: string;
  /** Two lines max — rendered as the 8pt stats box next to the thumbnail. */
  stats: string[];
  /** "uid/group" when this item has a ChimeraX-renderable volume map. */
  mapKey: string | null;
  map: {
    group: string;
    resultName: string;
    downloadUrl: string;
    previewUrl: string | null;
  } | null;
  /** Captured image (2D montage etc.) used when the item has no map. */
  imageUrl: string | null;
}

export interface FlowFigureModel {
  headerStats: { micrographs: string | null; pick: string | null; particles: string | null };
  /** Ordered ancestor → final; each group is a vertical stack of parallel items. */
  groups: FlowFigureItem[][];
  /** e.g. "3.46 Å" — bottom-right text like the reference's "C1, 3.46 Å". */
  finalStats: string | null;
  /** "uid/group" of the alignment reference map (final job's map). */
  referenceKey: string | null;
  referenceItem: FlowFigureItem | null;
  fscXml: { xml?: string; url?: string; name?: string } | null;
  warnings: string[];
  projectLabel: string;
}

export interface BuildModelOptions {
  maxGroups?: number;
  includeSelect2d?: boolean;
}

/* ------------------------------------------------------------------ */
/* Formatting helpers (match the reference's style)                    */
/* ------------------------------------------------------------------ */

function fmtParticles(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toLocaleString("en-US");
}

export function jobTypeLabel(jobType: string): string {
  const map: Record<string, string> = {
    hetero_refine: "Hetero refinement",
    homo_refine: "Refinement",
    homo_refine_new: "Refinement",
    nonuniform_refine_new: "Non-uniform refinement",
    nonuniform_refine: "Non-uniform refinement",
    new_local_refine: "Local refinement",
    local_refine: "Local refinement",
    naive_local_refine: "Local refinement",
    homo_abinit: "Ab-initio reconstruction",
    class_3D: "3D classification",
    class_2D: "2D classification",
    select_2D: "2D class selection",
    select_2d: "2D class selection",
    helix_refine: "Helical refinement",
    relion_auto_refine: "Auto refinement",
    relion_3d_classification: "3D classification",
  };
  if (map[jobType]) return map[jobType];
  if (/sharpen|deep.*hancer|postprocess|density_mod/i.test(jobType)) return "DeepEMhancer";
  if (/filter|mask/i.test(jobType)) return "Filtering";
  return jobType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isPostProcessType(jobType: string): boolean {
  return /sharpen|deep.*hanc|postprocess|density_mod/i.test(jobType);
}

function classPercentFor(summary: LineageSummary, uid: string, group: string): string | null {
  const job: ClassSplitJob | undefined = (summary.class_split_jobs || []).find((j) => j.uid === uid);
  if (!job) return null;
  const cls = job.classes.find((c) => String(c.volume_group || "") === group);
  if (cls?.particle_percent != null) return `${Math.round(cls.particle_percent * 10) / 10}%`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Lineage walking                                                     */
/* ------------------------------------------------------------------ */

/** v3.44 full-DAG lineage graph. The v3.41-43 model walked ONE
 *  volume-preferring parent chain, so any dataset branch that merged via a
 *  particle/other edge (P208: J474-dataset → … → J494 hetero_refine → J497
 *  nonuniform_refine) was invisible — the stage model showed a single
 *  branch and the earliest stages were folded away on top of it. */
interface LineageGraph {
  byUid: Map<string, LineageNode>;
  parentsOf: Map<string, string[]>;
  volParentsOf: Map<string, string[]>;
  /** Longest-path depth from the roots (0 = import/seed). */
  depth: Map<string, number>;
  /** Ancestors of the final job over ALL incoming edges, every family. */
  ancestorUids: Set<string>;
}

function collectLineageGraph(summary: LineageSummary): LineageGraph {
  const byUid = new Map<string, LineageNode>();
  for (const n of summary.nodes || []) byUid.set(n.uid, n);

  const parentsOf = new Map<string, string[]>();
  const volParentsOf = new Map<string, string[]>();
  for (const e of summary.edges || []) {
    if (!byUid.has(e.source) || !byUid.has(e.target)) continue;
    if (!parentsOf.has(e.target)) parentsOf.set(e.target, []);
    parentsOf.get(e.target)!.push(e.source);
    if (e.input_type === "volume") {
      if (!volParentsOf.has(e.target)) volParentsOf.set(e.target, []);
      volParentsOf.get(e.target)!.push(e.source);
    }
  }

  const ancestorUids = new Set<string>();
  const queue: string[] = [summary.start_uid];
  while (queue.length) {
    const cur = queue.shift()!;
    if (ancestorUids.has(cur)) continue;
    ancestorUids.add(cur);
    for (const p of parentsOf.get(cur) || []) {
      if (!ancestorUids.has(p)) queue.push(p);
    }
  }

  // Longest-path depth (iterate until stable — lineage graphs are small).
  const depth = new Map<string, number>();
  for (const uid of ancestorUids) depth.set(uid, 0);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 96) {
    changed = false;
    for (const e of summary.edges || []) {
      if (!ancestorUids.has(e.source) || !ancestorUids.has(e.target)) continue;
      const d = (depth.get(e.source) ?? 0) + 1;
      if (d > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, d);
        changed = true;
      }
    }
  }
  return { byUid, parentsOf, volParentsOf, depth, ancestorUids };
}

/** Volume-preferring backbone chain (final → earliest ancestor). v3.44:
 *  supplies the ORDER of the stage groups only — completeness comes from
 *  the merge-contributor scan over the full ancestor DAG. */
function walkParentChain(summary: LineageSummary, graph: LineageGraph): LineageNode[] {
  const chain: LineageNode[] = [];
  const seen = new Set<string>();
  let cur = summary.start_uid;
  while (cur && !seen.has(cur) && chain.length < 80) {
    seen.add(cur);
    const node = graph.byUid.get(cur);
    if (!node) break;
    chain.push(node);
    const nexts = graph.volParentsOf.get(cur)?.length
      ? graph.volParentsOf.get(cur)!
      : graph.parentsOf.get(cur) || [];
    cur = nexts[0] || "";
  }
  return chain; // final → ancestor
}

function mapAssetFor(node: LineageNode): MapAsset | null {
  const assets = normalMapAssets(node);
  if (!assets.length) return null;
  if (isPostProcessType(node.job_type)) {
    const sharp = assets.find((a) => /map_sharp/i.test(a.result_name));
    if (sharp) return sharp;
  }
  const plain = assets.find((a) => /^map$/i.test(a.result_name));
  return plain ?? assets[0];
}

function itemFromNode(
  summary: LineageSummary,
  node: LineageNode,
  opts: { isFinal?: boolean } = {},
): FlowFigureItem {
  const asset = mapAssetFor(node);
  const group = asset?.group || "volume";
  const stats: string[] = [];
  if (!opts.isFinal) {
    const pct = classPercentFor(summary, node.uid, group);
    if (pct) stats.push(pct);
  }
  if (node.particle_count != null) stats.push(`${fmtParticles(node.particle_count)} particles`);
  return {
    uid: node.uid,
    label: jobTypeLabel(node.job_type),
    stats,
    mapKey: asset ? `${node.uid}/${group}` : null,
    map: asset
      ? {
          group,
          resultName: asset.result_name,
          downloadUrl: asset.download_url,
          previewUrl: asset.preview_url,
        }
      : null,
    imageUrl: null,
  };
}

function select2dImage(node: LineageNode): ImageAsset | null {
  const prefer = ["selected_classes", "templates_selected"];
  for (const name of prefer) {
    const hit = (node.images || []).find((im) => im.name === name);
    if (hit) return hit;
  }
  const loose = (node.images || []).find((im) => /selected|template/i.test(im.name || ""));
  return loose ?? (node.images || [])[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Model builders                                                      */
/* ------------------------------------------------------------------ */

export function buildFlowFigureModel(
  summary: LineageSummary,
  opts: BuildModelOptions = {},
): FlowFigureModel {
  const warnings: string[] = [];
  const maxGroups = opts.maxGroups ?? 6;
  const graph = collectLineageGraph(summary);
  const chain = walkParentChain(summary, graph); // final → ancestor
  const ancestors = [...graph.ancestorUids]
    .map((u) => graph.byUid.get(u)!)
    .filter((n): n is LineageNode => !!n);
  const hasMaps = (uid: string) => {
    const n = graph.byUid.get(uid);
    return !!n && normalMapAssets(n).length > 0;
  };
  const mapParentsOf = (uid: string): string[] => {
    const out: string[] = [];
    for (const p of graph.parentsOf.get(uid) || []) {
      if (p !== uid && hasMaps(p) && !out.includes(p)) out.push(p);
    }
    return out;
  };
  const byDepthAsc = (a: LineageNode, b: LineageNode) =>
    (graph.depth.get(a.uid) ?? 0) - (graph.depth.get(b.uid) ?? 0);

  /* Header stats */
  const micrographs =
    summary.final_micrograph_count != null && summary.final_micrograph_count > 0
      ? `${Math.round(summary.final_micrograph_count).toLocaleString("en-US")} Micrographs`
      : null;
  const pickNode = ancestors.filter((n) => PICKING_JOB_TYPES.has(n.job_type)).sort(byDepthAsc)[0];
  const pickLabel = pickNode ? (pickNode.job_type.includes("manual") ? "Manual pick" : "Auto pick") : "Auto pick";
  const earliestParticles = ancestors
    .filter((n) => n.particle_count != null && n.particle_count > 0)
    .sort(byDepthAsc)[0];
  const particles =
    earliestParticles?.particle_count != null
      ? `${fmtParticles(earliestParticles.particle_count)} particles`
      : null;

  /* Final job + group accumulators. */
  const finalNode: LineageNode | null = summary.start_job ?? graph.byUid.get(summary.start_uid) ?? null;
  const groups: FlowFigureItem[][] = [];
  const usedUids = new Set<string>();
  let referenceItem: FlowFigureItem | null = null;
  let referenceKey: string | null = null;

  // 2D selection stage (image montage, no map) — deepest ancestor (closest
  // to the final job), optional.
  if (opts.includeSelect2d !== false) {
    const s2d = ancestors
      .filter((n) => (n.select_2d != null || /select_2d/i.test(n.job_type)) && select2dImage(n))
      .sort((a, b) => (graph.depth.get(b.uid) ?? 0) - (graph.depth.get(a.uid) ?? 0))[0];
    if (s2d) {
      const img = select2dImage(s2d);
      const stats: string[] = [];
      if (s2d.select_2d?.particles_selected != null) stats.push(`${fmtParticles(s2d.select_2d.particles_selected)} selected`);
      if (s2d.select_2d?.classes_selected != null) stats.push(`${s2d.select_2d.classes_selected} classes`);
      groups.push([
        {
          uid: s2d.uid,
          label: jobTypeLabel(s2d.job_type),
          stats,
          mapKey: null,
          map: null,
          imageUrl: img?.url ?? null,
        },
      ]);
      usedUids.add(s2d.uid);
    }
  }

  /* Stage groups along the volume backbone (ancestor → final). A merge job
     with ≥2 DIRECT map-bearing parents renders those parents as ONE
     parallel group (the reference's J68-H1 + J142-H2 case) — this is how
     the second dataset's branch enters the figure even when it merges via
     a particle edge (P208: J494 hetero_refine → J497 nonuniform_refine). */
  const spineMapOrder = [...chain].reverse().filter((n) => hasMaps(n.uid));
  const mergeContributors = new Map<string, string[]>();
  for (const S of spineMapOrder) {
    const contrib = mapParentsOf(S.uid);
    if (contrib.length >= 2) mergeContributors.set(S.uid, contrib);
  }
  // Spine nodes that feed a LATER merge render inside that merge's parallel
  // group instead of getting their own single stage.
  const deferredSpine = new Set<string>();
  spineMapOrder.forEach((S, i) => {
    for (const [m, contrib] of mergeContributors) {
      const mIdx = spineMapOrder.findIndex((n) => n.uid === m);
      if (mIdx > i && contrib.includes(S.uid)) deferredSpine.add(S.uid);
    }
  });

  for (const S of spineMapOrder) {
    const contrib = mergeContributors.get(S.uid);
    if (contrib) {
      const fresh = contrib.filter((c) => !usedUids.has(c));
      if (fresh.length >= 2) {
        const items = fresh.slice(0, 3).map((c) => itemFromNode(summary, graph.byUid.get(c)!));
        items.forEach((it) => usedUids.add(it.uid));
        groups.push(items);
      } else if (fresh.length === 1) {
        const node = graph.byUid.get(fresh[0]);
        if (node) {
          groups.push([itemFromNode(summary, node)]);
          usedUids.add(node.uid);
        }
      }
    }
    if (!deferredSpine.has(S.uid) && !usedUids.has(S.uid)) {
      groups.push([itemFromNode(summary, S, { isFinal: S.uid === summary.start_uid })]);
      usedUids.add(S.uid);
    }
  }

  // v3.44 folding: only SINGLE stages fold (earliest first) — parallel
  // branch groups and the final stage never fold. The old splice(1, n)
  // deleted the branch group first, which is exactly how a dataset branch
  // vanished from the 4-group figure.
  const folded = trimFlowGroups(groups, maxGroups, warnings);

  // Reference = the FINAL job's map when it has one.
  if (finalNode && normalMapAssets(finalNode).length > 0) {
    const ref = itemFromNode(summary, finalNode, { isFinal: true });
    referenceItem = ref;
    referenceKey = ref.mapKey;
  } else {
    for (let i = folded.length - 1; i >= 0; i--) {
      const last = folded[i][folded[i].length - 1];
      if (last?.mapKey) {
        referenceItem = last;
        referenceKey = last.mapKey;
        break;
      }
    }
  }
  if (!referenceKey) warnings.push("未找到参考地图（谱系中没有可下载的 volume map）。");

  /* Final stats */
  let finalStats: string | null = null;
  const res = summary.final_resolution_A ?? finalNode?.resolution_A ?? null;
  if (res != null && res > 0) finalStats = `${res >= 10 ? res.toFixed(1) : res.toFixed(2)} Å`;

  /* FSC XML */
  const fscNode = [summary.start_job, ...ancestors].find((n) => n?.fsc_xml);
  const fscXml = fscNode?.fsc_xml
    ? { xml: fscNode.fsc_xml.xml, url: fscNode.fsc_xml.url, name: fscNode.fsc_xml.name }
    : null;

  const projectLabel = `${summary.project_uid || "P"} / ${summary.start_uid || "J"}`;

  if (!folded.length) warnings.push("谱系中未找到可用于流程图的阶段（无 volume map 且无 2D 选择步骤）。");

  return {
    headerStats: { micrographs, pick: pickLabel, particles },
    groups: folded,
    finalStats,
    referenceKey,
    referenceItem,
    fscXml,
    warnings,
    projectLabel,
  };
}

/** v3.44 stage folding with branch protection: parallel groups (length
 *  > 1), the first group and the final group are mandatory; only single
 *  stages fold, earliest first. */
function trimFlowGroups(
  groups: FlowFigureItem[][],
  maxGroups: number,
  warnings: string[],
): FlowFigureItem[][] {
  if (groups.length <= maxGroups) return groups;
  const mandatory = new Set<number>();
  groups.forEach((g, i) => {
    if (g.length > 1) mandatory.add(i);
  });
  mandatory.add(0);
  mandatory.add(groups.length - 1);
  if (mandatory.size >= maxGroups) {
    warnings.push(
      `谱系阶段较多，已折叠最早的 ${groups.length - mandatory.size} 个单图阶段（并行分支与最终阶段已全部保留；可在选项中调大阶段数）。`,
    );
    return groups.filter((_, i) => mandatory.has(i));
  }
  const chosen = new Set(mandatory);
  for (let i = groups.length - 1; i >= 0 && chosen.size < maxGroups; i--) chosen.add(i);
  for (let i = 0; i < groups.length && chosen.size < maxGroups; i++) chosen.add(i);
  const kept = groups.filter((_, i) => chosen.has(i));
  warnings.push(
    `谱系阶段较多，已折叠最早的 ${groups.length - kept.length} 个阶段（并行分支已保留；可在选项中调大阶段数）。`,
  );
  return kept;
}

/** Reference-style demo model — uses the images extracted from the user's
 *  own Workflow.pptx sample (public/demo/workflow/*.png). */
export function buildDemoFigureModel(): FlowFigureModel {
  return {
    headerStats: { micrographs: "14,482 Micrographs", pick: "Auto pick", particles: "4980K particles" },
    groups: [
      [
        {
          uid: "J68",
          label: "Hetero refinement",
          stats: ["32.9%", "1638K particles"],
          mapKey: "J68/volume",
          map: null,
          imageUrl: "/demo/workflow/J68_H1.png",
        },
        {
          uid: "J142",
          label: "Hetero refinement",
          stats: [],
          mapKey: "J142/volume",
          map: null,
          imageUrl: "/demo/workflow/J142_H2.png",
        },
      ],
      [
        {
          uid: "J174",
          label: "Non-uniform refinement",
          stats: ["26.3%", "431K particles"],
          mapKey: "J174/volume",
          map: null,
          imageUrl: "/demo/workflow/J174.png",
        },
      ],
      [
        {
          uid: "J175",
          label: "DeepEMhancer",
          stats: [],
          mapKey: "J175/volume",
          map: null,
          imageUrl: "/demo/workflow/J175.png",
        },
      ],
    ],
    finalStats: "3.46 Å",
    referenceKey: "J174/volume",
    referenceItem: null,
    fscXml: null,
    warnings: [],
    projectLabel: "Demo / Workflow sample",
  };
}

/* ------------------------------------------------------------------ */
/* Image collection & post-processing                                  */
/* ------------------------------------------------------------------ */

/** Fetch image bytes for items that use captured images (2D montage …). */
export async function fetchFigureImages(
  urls: string[],
  session: CryoSmartSession | null,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let done = 0;
  for (const url of urls) {
    try {
      const bytes = await cryoSmartBytes(session, url);
      out.set(url, bytes);
    } catch {
      // Individual image failures are non-fatal — a placeholder frame is
      // drawn instead.
    }
    done += 1;
    onProgress?.(done, urls.length, url);
  }
  return out;
}

/** Fetch FSC XML text (embedded xml preferred, URL fallback). */
export async function fetchFscXmlText(
  fsc: { xml?: string; url?: string } | null | undefined,
  session: CryoSmartSession | null,
): Promise<string | null> {
  if (!fsc) return null;
  if (fsc.xml) return fsc.xml;
  if (!fsc.url) return null;
  try {
    if (fsc.url.startsWith("data:")) {
      const res = await fetch(fsc.url);
      return await res.text();
    }
    const bytes = await cryoSmartBytes(session, fsc.url);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Parse FSC from XML, falling back to the plain-text two-column parser. */
export function parseFscAny(raw: string, pixelSizeA?: number | null): { curves: FscCurve[]; warnings: string[] } {
  const xmlResult = parseFscXml(raw, { pixelSizeA: pixelSizeA ?? null });
  if (xmlResult.curves.length) return { curves: xmlResult.curves, warnings: xmlResult.warnings };
  const textResult = parseFscText(raw);
  if (textResult.curves.length) return { curves: textResult.curves, warnings: textResult.warnings };
  return { curves: [], warnings: [...xmlResult.warnings, ...textResult.warnings] };
}

/** Render the FSC curves to a PNG (null when no curves / no DOM). */
export async function fscPng(
  raw: string | null,
  pixelSizeA?: number | null,
): Promise<Uint8Array | null> {
  if (!raw) return null;
  const { curves } = parseFscAny(raw, pixelSizeA);
  if (!curves.length) return null;
  return renderFscCurvePng(curves, { title: null });
}

interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function nonWhiteBBox(data: Uint8ClampedArray, w: number, h: number, delta: number): BBox | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 10) continue;
      const dist = Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]);
      if (dist > delta) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

/**
 * Port of the desktop helper's `common_trim_box` + uniform-crop step: all
 * renders share one trim box (smallest white margin per side + 5% keep),
 * expanded to the target aspect, then letterboxed onto identical white
 * canvases so every thumbnail has the same scale AND framing.
 */
export async function uniformLetterbox(
  images: Map<string, Uint8Array>,
  aspect = 2,
  outW = 1600,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (typeof document === "undefined" || !images.size) return out;

  // Decode all + compute common margins.
  const decoded: Array<{ key: string; bmp: ImageBitmap }> = [];
  let refW = 0;
  let refH = 0;
  const margins: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  for (const [key, bytes] of images) {
    try {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const box = nonWhiteBBox(data, bmp.width, bmp.height, 8);
      decoded.push({ key, bmp });
      refW = bmp.width;
      refH = bmp.height;
      if (box) {
        margins.push({ left: box.left, top: box.top, right: bmp.width - box.right, bottom: bmp.height - box.bottom });
      } else {
        margins.push({ left: 0, top: 0, right: 0, bottom: 0 });
      }
    } catch {
      // skip undecodable
    }
  }
  if (!decoded.length) return out;

  const minLeft = Math.min(...margins.map((m) => m.left));
  const minTop = Math.min(...margins.map((m) => m.top));
  const minRight = Math.min(...margins.map((m) => m.right));
  const minBottom = Math.min(...margins.map((m) => m.bottom));
  const keepX = Math.max(60, Math.round(refW * 0.05));
  const keepY = Math.max(60, Math.round(refH * 0.05));
  let left = Math.max(0, minLeft - keepX);
  let top = Math.max(0, minTop - keepY);
  let right = Math.max(0, minRight - keepX);
  let bottom = Math.max(0, minBottom - keepY);

  // Expand the crop box back to the source aspect (port of
  // expand_box_to_aspect) so no content is stretched, then letterbox to the
  // uniform target aspect inside the identical output canvas.
  const srcAspect = refW / refH;
  let boxW = refW - left - right;
  let boxH = refH - top - bottom;
  if (boxW / boxH < srcAspect) {
    const need = boxH * srcAspect - boxW;
    left = Math.max(0, left - need / 2);
    right = Math.max(0, right - need / 2);
    boxW = refW - left - right;
  } else {
    const need = boxW / srcAspect - boxH;
    top = Math.max(0, top - need / 2);
    bottom = Math.max(0, bottom - need / 2);
    boxH = refH - top - bottom;
  }
  const cropW = Math.max(1, Math.round(boxW));
  const cropH = Math.max(1, Math.round(boxH));

  const outH = Math.round(outW / aspect);
  for (const { key, bmp } of decoded) {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    const scale = Math.min(outW / cropW, outH / cropH);
    const dw = cropW * scale;
    const dh = cropH * scale;
    ctx.drawImage(bmp, left, top, cropW, cropH, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) out.set(key, new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

/**
 * PNG/JPEG dimension sniffing (for aspect-preserving placement of captured
 * images inside fixed figure boxes). Ported from rebuild_picture_flow_pptx.mjs.
 */
export function imageDims(bytes: Uint8Array): { width: number; height: number; ext: string } {
  const ext = "png";
  if (bytes.length > 24 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), ext };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      const len = view.getUint16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), ext: "jpeg" };
      }
      i += 2 + len;
    }
  }
  return { width: 1, height: 1, ext };
}

/** Compose the bottom-left footnote about alignment & handedness. */
export function figureFootnote(
  meta: {
    referenceKey?: string | null;
    corrected: number;
    consistent: number;
    ambiguous: number;
    failed: number;
    view?: string | null;
    mode: string;
  },
): string {
  const parts: string[] = [];
  if (meta.referenceKey) parts.push(`所有地图已对齐至参考 ${meta.referenceKey}`);
  const chiral: string[] = [];
  if (meta.corrected) chiral.push(`${meta.corrected} 个已翻正`);
  if (meta.consistent) chiral.push(`${meta.consistent} 个一致`);
  if (meta.ambiguous) chiral.push(`${meta.ambiguous} 个对称/不可判定`);
  if (meta.failed) chiral.push(`${meta.failed} 个失败`);
  if (chiral.length) parts.push(`手性检查: ${chiral.join("，")}`);
  if (meta.view) parts.push(`视角 ${meta.view}`);
  parts.push(`CryoSmart Workflow Figure (${meta.mode})`);
  return parts.join(" · ");
}
