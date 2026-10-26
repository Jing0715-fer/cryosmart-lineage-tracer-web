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

/** Final job → … → earliest ancestor (volume edges preferred). */
function walkParentChain(summary: LineageSummary): LineageNode[] {
  const byUid = new Map<string, LineageNode>();
  for (const n of summary.nodes || []) byUid.set(n.uid, n);

  const volParents = new Map<string, string[]>();
  const anyParents = new Map<string, string[]>();
  for (const e of summary.edges || []) {
    if (!anyParents.has(e.target)) anyParents.set(e.target, []);
    anyParents.get(e.target)!.push(e.source);
    if (e.input_type === "volume") {
      if (!volParents.has(e.target)) volParents.set(e.target, []);
      volParents.get(e.target)!.push(e.source);
    }
  }

  const chain: LineageNode[] = [];
  const seen = new Set<string>();
  let cur = summary.start_uid;
  while (cur && !seen.has(cur) && chain.length < 80) {
    seen.add(cur);
    const node = byUid.get(cur);
    if (!node) break;
    chain.push(node);
    const nexts = volParents.get(cur)?.length ? volParents.get(cur)! : anyParents.get(cur) || [];
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
  const maxGroups = opts.maxGroups ?? 4;
  const chain = walkParentChain(summary); // final → ancestor
  const ancestorFirst = [...chain].reverse();

  /* Header stats */
  const micrographs =
    summary.final_micrograph_count != null && summary.final_micrograph_count > 0
      ? `${Math.round(summary.final_micrograph_count).toLocaleString("en-US")} Micrographs`
      : null;
  const pickNode = ancestorFirst.find((n) => PICKING_JOB_TYPES.has(n.job_type));
  const pickLabel = pickNode ? (pickNode.job_type.includes("manual") ? "Manual pick" : "Auto pick") : "Auto pick";
  const earliestParticles = ancestorFirst.find((n) => n.particle_count != null && n.particle_count > 0);
  const particles =
    earliestParticles?.particle_count != null
      ? `${fmtParticles(earliestParticles.particle_count)} particles`
      : null;

  /* Volume stages from the chain */
  const mapNodes = ancestorFirst.filter((n) => normalMapAssets(n).length > 0);
  const byUid = new Map(ancestorFirst.map((n) => [n.uid, n]));

  // Branch detection: several volume inputs feed the FINAL job (the
  // reference's J68-H1 + J142-H2 → non-uniform refinement case).
  const finalNode = summary.start_job ?? byUid.get(summary.start_uid);
  const volSources = (summary.edges || [])
    .filter((e) => e.target === summary.start_uid && e.input_type === "volume")
    .map((e) => byUid.get(e.source))
    .filter((n): n is LineageNode => !!n && normalMapAssets(n).length > 0);

  const groups: FlowFigureItem[][] = [];
  const usedUids = new Set<string>();
  let referenceItem: FlowFigureItem | null = null;
  let referenceKey: string | null = null;

  // 2D selection stage (image montage, no map) — optional.
  if (opts.includeSelect2d !== false) {
    const s2d = ancestorFirst.find((n) => (n.select_2d != null || /select_2d/i.test(n.job_type)) && select2dImage(n));
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

  // Volume branch group (parallel items).
  if (volSources.length >= 2) {
    const items = volSources.slice(0, 3).map((n) => itemFromNode(summary, n));
    items.forEach((i) => usedUids.add(i.uid));
    groups.push(items);
  }

  // Remaining spine volume groups, ancestor → final.
  const spine = mapNodes.filter((n) => !usedUids.has(n.uid));
  const spineGroups: FlowFigureItem[][] = [];
  for (const node of spine) {
    const item = itemFromNode(summary, node, { isFinal: node.uid === summary.start_uid });
    spineGroups.push([item]);
    usedUids.add(node.uid);
  }

  // Interleave: keep ancestor order, but a branch group slots right before
  // the group of the job its maps feed into (i.e. before the final job).
  if (volSources.length >= 2) {
    const finalIdx = spineGroups.findIndex((g) => g[0].uid === summary.start_uid);
    if (finalIdx >= 0) {
      groups.push(...spineGroups.slice(0, finalIdx));
      groups.push(...spineGroups.slice(finalIdx));
    } else {
      groups.push(...spineGroups);
    }
  } else {
    groups.push(...spineGroups);
  }

  // Trim to maxGroups — always keep the final groups.
  if (groups.length > maxGroups) {
    const dropped = groups.length - maxGroups;
    groups.splice(1, dropped); // keep header-adjacent (first) and the tail
    warnings.push(`谱系阶段较多，已折叠最早的 ${dropped} 个阶段（可在选项中调大）。`);
  }

  // Reference = the FINAL job's map when it has one.
  if (finalNode && normalMapAssets(finalNode).length > 0) {
    const ref = itemFromNode(summary, finalNode, { isFinal: true });
    referenceItem = ref;
    referenceKey = ref.mapKey;
  } else {
    for (let i = groups.length - 1; i >= 0; i--) {
      const last = groups[i][groups[i].length - 1];
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
  const fscNode = [summary.start_job, ...ancestorFirst].find((n) => n?.fsc_xml);
  const fscXml = fscNode?.fsc_xml
    ? { xml: fscNode.fsc_xml.xml, url: fscNode.fsc_xml.url, name: fscNode.fsc_xml.name }
    : null;

  const projectLabel = `${summary.project_uid || "P"} / ${summary.start_uid || "J"}`;

  if (!groups.length) warnings.push("谱系中未找到可用于流程图的阶段（无 volume map 且无 2D 选择步骤）。");

  return {
    headerStats: { micrographs, pick: pickLabel, particles },
    groups,
    finalStats,
    referenceKey,
    referenceItem,
    fscXml,
    warnings,
    projectLabel,
  };
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
