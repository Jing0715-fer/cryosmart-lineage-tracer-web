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
 *
 * v3.54 (round-13): a SIMPLIFIED figure mode (BuildModelOptions.simplified)
 * builds the 多→少 funnel reading — small-subset 2D / select-2D / ab-initio
 * bootstrap steps are omitted, count lines that would break the
 * non-increasing flow are hidden, and a default-12 Å ab-initio final's
 * resolution info is ignored (see simplifiedFunnelPass + dropBootstrap).
 *
 * v3.55 (round-14): the header's "Auto pick → N particles" count is now the
 * MAINLINE pick (largest pick/extract-family ancestor count — P96's J25
 * topaz_extract 1,634,842, not the 217-photo subset pick J9's 164,291), and
 * the simplified figure omits an ab-initio STAGE entirely when its own
 * Maximum-resolution parameter is the cryoSPARC default 12 Å (or absent) —
 * the flow connects straight to the following refinement stage. Every
 * stage also carries its job id for the PPTX layer to label (round-14
 * "最好把 job 的 id 也标记到图中").
 */

import type {
  ClassSplitJob,
  ImageAsset,
  LineageNode,
  LineageSummary,
  MapAsset,
} from "./types";
import { normalMapAssets } from "./lineage";
import { PARTICLE_AUX_JOB_TYPES, PICKING_JOB_TYPES } from "./constants";
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
  /** v3.51: EVERY class volume of this job, one row side by side. Null for
   *  single-map stages (where mapKey/map carry the one map) and captured
   *  images (2D montage / demo / FSC). */
  classes?: FigureClassSlot[] | null;
  /** v3.54: the stage's representative particle count — the job's own
   *  particle_count, else the sum of its class counts (select_2D montage
   *  items carry the SELECTED count). Null when unknown. The simplified
   *  mode's small-subset drop + 从多到少 funnel read it; rendering ignores
   *  it. */
  particleTotal?: number | null;
}

/** v3.51: one per-class thumbnail slot inside a stage row. */
export interface FigureClassSlot {
  /** Canonical map key "uid/group" — image marker + render lookup key. */
  mapKey: string;
  /** v3.52: 0-based position of this class within its job (class 1 → 0) —
   *  drives the Chimera default open-color (grey → pale yellow → pale cyan →
   *  pale blue → …, the v3.54 8-entry list; cycles past class 7).
   *  Computed AFTER sorting/dedup so it is the position the
   *  map would get when the job's maps are opened together in Chimera. */
  classIndex: number;
  group: string;
  resultName: string;
  downloadUrl: string;
  previewUrl: string | null;
  /** Per-class stats ("50%", "58K particles") rendered under the thumbnail. */
  stats: string[];
  /** v3.54: the numeric particle count behind this slot's "N particles"
   *  stats line (null when unknown). The simplified mode's 从多到少
   *  funnel hides count lines that would break the non-increasing flow;
   *  the PPTX layer ignores this field. */
  particleCount?: number | null;
}

/** v3.51: every ChimeraX-renderable map in the figure (all classes), keyed by
 *  mapKey — the card's source-of-truth for proxy/staging/preview/render loops.
 *  v3.52: carries classIndex so the card can attach the Chimera default
 *  open-color to each render request (grey/pale yellow/pale cyan/pale blue…). */
export interface FigureMapSource {
  key: string;
  uid: string;
  group: string;
  resultName: string;
  downloadUrl: string;
  previewUrl: string | null;
  /** 0-based class position within the source job (single-map stages: 0). */
  classIndex: number;
}

/** v3.51: most classes shown per job row — a wider row shrinks EVERY
 *  thumbnail on the slide, so a huge split is truncated with a warning
 *  instead of turning the whole figure into confetti. v3.52 (round-11):
 *  raised 4 → 8 — the user asked for classes past 4 to KEEP rendering in
 *  the Chimera default open-colors ("尽量也都改成chimera中默认的打开的
 *  颜色"), so realistic 5-8-class hetero/hyper splits stay visible; the
 *  row-aware width solver folds the whole figure into columns when the
 *  per-thumbnail readability floor (1.45") is crossed. */
export const MAX_FIG_CLASSES = 8;

export function figureMapSources(model: FlowFigureModel): Map<string, FigureMapSource> {
  const out = new Map<string, FigureMapSource>();
  const items = [...model.groups.flat()];
  if (model.referenceItem) items.push(model.referenceItem);
  for (const item of items) {
    if (item.classes?.length) {
      for (const c of item.classes) {
        if (!out.has(c.mapKey)) {
          out.set(c.mapKey, {
            key: c.mapKey,
            uid: item.uid,
            group: c.group,
            resultName: c.resultName,
            downloadUrl: c.downloadUrl,
            previewUrl: c.previewUrl,
            classIndex: c.classIndex,
          });
        }
      }
    } else if (item.mapKey && item.map) {
      if (!out.has(item.mapKey)) {
        out.set(item.mapKey, {
          key: item.mapKey,
          uid: item.uid,
          group: item.map.group,
          resultName: item.map.resultName,
          downloadUrl: item.map.downloadUrl,
          previewUrl: item.map.previewUrl,
          classIndex: 0,
        });
      }
    }
  }
  return out;
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
  /** v3.54 (round-13 "简化模式"): build the SIMPLIFIED stage figure —
   *  (a) OMIT small-subset bootstrap steps (2D classification / 2D
   *      selection / ab-initio jobs that ran on materially fewer
   *      particles than the lineage's funnel top),
   *  (b) guarantee the DISPLAYED particle counts read 多→少 (count
   *      lines that would break the non-increasing flow are hidden),
   *  (c) v3.55 (round-14): an ab-initio stage whose own `Maximum
   *      resolution` parameter is the cryoSPARC default 12 Å (or is
   *      absent — i.e. the default) is omitted ENTIRELY, so the flow
   *      shows the following refinement stage (hetero refine …)
   *      directly; only an ab-initio the user deliberately ran at a
   *      NON-default resolution stays. A default-12 Å ab-initio
   *      FINAL's resolution info is ignored as well. */
  simplified?: boolean;
}

/** v3.54: a 2D-classification / 2D-selection / ab-initio stage whose
 * particle count falls below this fraction of its successor stage's count
 * is a "少量数据" bootstrap step and is omitted in simplified mode (the
 * flow visibly jumps back up after such a step — the signature of a
 * template / initial-model side branch, P96's J12 12,259 / J27 58,048 vs
 * the mainline hetero's 766,560). At-or-above the fraction stays, so a
 * mainline ab-initio that consumed the full remaining stream (its
 * successor only SHRINKS) never drops. */
export const SIMPLIFIED_SUBSET_FRACTION = 0.5;

/** v3.54: cryoSPARC ab-initio jobs report a nominal 12 Å output resolution
 * by default — within ±0.5 Å of 12 counts as "the default 12 Å". */
const ABINIT_DEFAULT_RESOLUTION_A = 12;
const ABINIT_DEFAULT_RESOLUTION_TOL_A = 0.5;

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

function fmtClassPercent(pct: number): string {
  return `${Math.round(pct * 10) / 10}%`;
}

/** v3.51: enumerate EVERY class volume of a job as thumbnail slots (the
 *  round-10 request — "每个 job 的多个 class 并列成一排"). Authoritative
 *  source: the node's own `classes` split (per-class map downloads +
 *  particle percent/count), falling back to `summary.class_split_jobs`,
 *  then to the raw `volume_class_*` groups in node.maps. A job with < 2
 *  usable classes degrades to the previous single-primary-map behavior.
 *  Rows are capped at MAX_FIG_CLASSES (warning pushed when truncated). */
function classSlotsFor(
  summary: LineageSummary,
  node: LineageNode,
  opts: { isFinal?: boolean; warnings?: string[] } = {},
): FigureClassSlot[] {
  const isFinal = !!opts.isFinal;
  const pushStats = (slotStats: string[], percent: number | null, count: number | null) => {
    if (!isFinal && percent != null) slotStats.push(fmtClassPercent(percent));
    if (count != null) slotStats.push(`${fmtParticles(count)} particles`);
  };

  const splits =
    node.classes?.length
      ? node.classes
      : (summary.class_split_jobs || []).find((j) => j.uid === node.uid)?.classes ?? [];

  const slots: FigureClassSlot[] = [];
  for (const cls of [...splits].sort((a, b) => (a.class_index ?? 0) - (b.class_index ?? 0))) {
    const primaryMap =
      cls.maps?.find((m) => /^map$/i.test(m.result_name)) ?? cls.maps?.[0] ?? null;
    const group = String(cls.volume_group || `volume_class_${cls.class_index}`);
    if (!primaryMap?.download_url) continue;
    const stats: string[] = [];
    pushStats(stats, cls.particle_percent, cls.particle_count);
    slots.push({
      mapKey: `${node.uid}/${group}`,
      // v3.52: slot POSITION (after sort + downloadability filter), not the
      // raw class_index — opening the job's available maps in Chimera hands
      // out grey/pale yellow/pale cyan/pale blue by this order.
      classIndex: slots.length,
      group,
      resultName: primaryMap.result_name,
      downloadUrl: primaryMap.download_url,
      previewUrl: cls.mrc_preview_url ?? null,
      stats,
      particleCount: cls.particle_count ?? null,
    });
  }

  if (slots.length < 2) {
    // Fallback: raw volume_class_* groups on the node (jobs whose split
    // summary wasn't captured but whose map list still enumerates classes).
    const raw = new Map<string, MapAsset>();
    for (const asset of node.maps || []) {
      const m = /^volume_class_(\d+)$/.exec(String(asset.group || ""));
      if (!m) continue;
      const prev = raw.get(asset.group);
      if (!prev || (/^map$/i.test(asset.result_name) && !/^map$/i.test(prev.result_name))) {
        raw.set(asset.group, asset);
      }
    }
    const rawSlots: FigureClassSlot[] = [];
    for (const [group, asset] of [...raw.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      const pct = classPercentFor(summary, node.uid, group);
      const stats: string[] = [];
      if (!isFinal && pct) stats.push(pct);
      rawSlots.push({
        mapKey: `${node.uid}/${group}`,
        classIndex: rawSlots.length,
        group,
        resultName: asset.result_name,
        downloadUrl: asset.download_url,
        previewUrl: asset.preview_url,
        stats,
        particleCount: null,
      });
    }
    if (rawSlots.length >= 2) {
      slots.push(...rawSlots);
    }
  }

  if (slots.length < 2) {
    // Single-map stage — previous behavior (primary asset, job-level stats).
    const asset = mapAssetFor(node);
    if (!asset) return [];
    const stats: string[] = [];
    if (!isFinal) {
      const pct = classPercentFor(summary, node.uid, asset.group);
      if (pct) stats.push(pct);
    }
    if (node.particle_count != null) stats.push(`${fmtParticles(node.particle_count)} particles`);
    return [
      {
        mapKey: `${node.uid}/${asset.group}`,
        classIndex: 0,
        group: asset.group,
        resultName: asset.result_name,
        downloadUrl: asset.download_url,
        previewUrl: asset.preview_url,
        stats,
        particleCount: node.particle_count ?? null,
      },
    ];
  }

  if (slots.length > MAX_FIG_CLASSES) {
    const dropped = slots.length - MAX_FIG_CLASSES;
    opts.warnings?.push(
      `${node.uid} 有 ${slots.length} 个 class，每行最多并排 ${MAX_FIG_CLASSES} 个 — 已省略 ${dropped} 个（class ${MAX_FIG_CLASSES + 1} 起不显示）。`,
    );
    return slots.slice(0, MAX_FIG_CLASSES);
  }
  return slots;
}

function itemFromNode(
  summary: LineageSummary,
  node: LineageNode,
  opts: { isFinal?: boolean; warnings?: string[] } = {},
): FlowFigureItem {
  const slots = classSlotsFor(summary, node, opts);
  const primary = slots[0] ?? null;
  const stats = slots.length <= 1 ? (primary?.stats ?? []) : [];
  // v3.54: the stage's representative count — its own particle_count when
  // known, else the sum of the rendered class counts (both null → null).
  const classSum = slots.reduce((s, c) => s + (c.particleCount ?? 0), 0);
  const particleTotal =
    node.particle_count != null
      ? node.particle_count
      : classSum > 0
        ? classSum
        : null;
  return {
    uid: node.uid,
    label: jobTypeLabel(node.job_type),
    stats,
    mapKey: primary?.mapKey ?? null,
    map: primary
      ? {
          group: primary.group,
          resultName: primary.resultName,
          downloadUrl: primary.downloadUrl,
          previewUrl: primary.previewUrl,
        }
      : null,
    classes: slots.length ? slots : null,
    particleTotal,
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
  // v3.45 (user report — “已折叠最早的 2 个阶段…少了前面的 dataset”): the
  // default used to be 6 groups with the earliest single stages folded away,
  // so a lineage with 8 stages read as incomplete. Default is now 10 (the
  // widest selector value); a caller may pass Infinity (or any value <= 0,
  // mapped to Infinity) for explicit never-fold semantics.
  const rawMax = opts.maxGroups ?? 10;
  const maxGroups = rawGroupsEffective(rawMax);
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

  /* Header stats — v3.47 (user round-6 report — “标题的照片计数还是只统计了
   * 一个job的照片，其他照片未统计进去”): the micrograph figure is now the
   * SUM over EVERY import_(movies|micrographs) job (P208: 233 + 500 + 150 +
   * 4,810 + 5,562 = 11,255), not the single mainline import's count, so
   * every dataset's photos are counted in the headline. Falls back to the
   * legacy final_micrograph_count when no import carries a count. */
  const importMicroNodes = (summary.nodes || []).filter((n) => /import_(movies|micrographs)/i.test(n.job_type || ""));
  const importMicroTotal = importMicroNodes.reduce((sum, n) => sum + (n.micrograph_count ?? 0), 0);
  const micrographs =
    importMicroTotal > 0
      ? `${importMicroTotal.toLocaleString("en-US")} Micrographs`
      : summary.final_micrograph_count != null && summary.final_micrograph_count > 0
        ? `${Math.round(summary.final_micrograph_count).toLocaleString("en-US")} Micrographs`
        : null;
  const pickNode = ancestors.filter((n) => PICKING_JOB_TYPES.has(n.job_type)).sort(byDepthAsc)[0];
  const pickLabel = pickNode ? (pickNode.job_type.includes("manual") ? "Manual pick" : "Auto pick") : "Auto pick";
  /* v3.55 (round-14 "autopick 的数字还是不对，远少于后面的颗粒数"): the
   * header's pick count is the MAINLINE pick — the LARGEST count among the
   * pick/extract-family ancestors (the funnel top), NOT the earliest
   * ancestor's count. P96's earliest pick-bearing job was J9 blob_picker_gpu
   * with 164,291 picks — but that ran on only the 217-photo subset; the real
   * pick over all 6,060 micrographs was J25 topaz_extract with 1,634,842
   * (later extract/dedup steps only SHRINK: 1,588,675 → 769,822 → 766,560),
   * so the old "earliest" rule printed a pick count far BELOW every later
   * stage. Falls back to the legacy earliest-count rule only when no
   * pick-family ancestor carries a count (e.g. imported-particle lineages). */
  const earliestParticles = ancestors
    .filter((n) => n.particle_count != null && n.particle_count > 0)
    .sort(byDepthAsc)[0];
  const pickFamilyCounts = ancestors
    .filter(
      (n) =>
        PICKING_JOB_TYPES.has(n.job_type) || PARTICLE_AUX_JOB_TYPES.has(n.job_type),
    )
    .map((n) => n.particle_count ?? null)
    .filter((v): v is number => v != null && v > 0);
  const mainPickCount = pickFamilyCounts.length ? Math.max(...pickFamilyCounts) : null;
  const pickCountForHeader = mainPickCount ?? earliestParticles?.particle_count ?? null;
  const particles =
    pickCountForHeader != null ? `${fmtParticles(pickCountForHeader)} particles` : null;

  /* Final job + group accumulators. */
  const finalNode: LineageNode | null = summary.start_job ?? graph.byUid.get(summary.start_uid) ?? null;
  const groups: FlowFigureItem[][] = [];
  const usedUids = new Set<string>();
  let referenceItem: FlowFigureItem | null = null;
  let referenceKey: string | null = null;

  /* v3.54 (round-13 “简化模式”): the small-subset bootstrap drop is a
   * SUCCESSOR-based post-pass (see dropSimplifiedBootstrap) — group
   * building below stays untouched; only the flag is threaded here. */
  const simplified = !!opts.simplified;

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
          particleTotal: s2d.select_2d?.particles_selected ?? s2d.particle_count ?? null,
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
        const items = fresh.slice(0, 3).map((c) => itemFromNode(summary, graph.byUid.get(c)!, { warnings }));
        items.forEach((it) => usedUids.add(it.uid));
        groups.push(items);
      } else if (fresh.length === 1) {
        const node = graph.byUid.get(fresh[0]);
        if (node) {
          groups.push([itemFromNode(summary, node, { warnings })]);
          usedUids.add(node.uid);
        }
      }
    }
    if (!deferredSpine.has(S.uid) && !usedUids.has(S.uid)) {
      groups.push([itemFromNode(summary, S, { isFinal: S.uid === summary.start_uid, warnings })]);
      usedUids.add(S.uid);
    }
  }

  // v3.54 (round-13 “简化模式”): OMIT small-subset bootstrap steps — 2D
  // classification / 2D selection / ab-initio stages whose particle count
  // is materially below their successor's (the tell-tale “flow jumps back
  // up after it” of a template / initial-model side branch). Runs as a
  // post-pass over the built groups, BEFORE folding, so the geometry and
  // the merge logic above stay untouched.
  let staged = groups;
  if (simplified && groups.length) {
    staged = dropSimplifiedBootstrap(groups, summary.start_uid, graph.byUid, warnings);
  }

  // v3.44 folding: only SINGLE stages fold (earliest first) — parallel
  // branch groups and the final stage never fold. The old splice(1, n)
  // deleted the branch group first, which is exactly how a dataset branch
  // vanished from the 4-group figure.
  const folded = trimFlowGroups(staged, maxGroups, warnings);

  // v3.54 (round-13 “简化模式”): enforce the 多→少 reading over the
  // DISPLAYED count lines (stage-to-stage; the header's pick count is
  // about picking and is not enforced against re-extraction merges).
  if (simplified && folded.length) simplifiedFunnelPass(folded, warnings);

  // Reference = the FINAL job's map when it has one.
  if (finalNode && normalMapAssets(finalNode).length > 0) {
    const ref = itemFromNode(summary, finalNode, { isFinal: true, warnings });
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
  // v3.54 (round-13 “简化模式”): an ab-initio final reporting the default
  // 12 Å has never been refined — its nominal resolution carries no
  // information, so the simplified figure ignores it. v3.55 (round-14): the
  // verdict also reads the job's own Maximum-resolution PARAMETER (the
  // node-level isDefaultResolutionAbinit) — an ab-initio final whose
  // parameter is default-12 (or absent = default) is unrefined even when no
  // nominal resolution number was captured.
  const finalIsAbinit = finalNode ? /abinit/i.test(finalNode.job_type || "") : false;
  const finalResIsDefaultAbinit =
    finalIsAbinit &&
    (isDefaultResolutionAbinit(finalNode) ||
      (res != null &&
        Math.abs(res - ABINIT_DEFAULT_RESOLUTION_A) <= ABINIT_DEFAULT_RESOLUTION_TOL_A));
  if (simplified && finalResIsDefaultAbinit && res != null) {
    warnings.push(
      `简化模式: 最终 ab-initio 的分辨率为默认 ${res.toFixed(1)} Å，已忽略（未精修的初始模型不携带分辨率信息）。`,
    );
  } else if (simplified && finalResIsDefaultAbinit) {
    warnings.push(
      "简化模式: 最终 ab-initio 的 Maximum resolution 为默认 12 Å，分辨率信息已忽略（未精修的初始模型）。",
    );
  } else if (res != null && res > 0) {
    finalStats = `${res >= 10 ? res.toFixed(1) : res.toFixed(2)} Å`;
  }

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

/** v3.45: selector semantics — a value <= 0 (the “全部” option) means
 * Infinity: never fold, every stage renders. Infinity passes through as-is. */
function rawGroupsEffective(raw: number): number {
  if (!Number.isFinite(raw)) return Infinity;
  return raw <= 0 ? Infinity : raw;
}

/** v3.44 stage folding with branch protection: parallel groups (length
 *  > 1), the first group and the final group are mandatory; only single
 *  stages fold, earliest first. v3.45: the warning names the “全部” escape
 *  (调到“全部”即不折叠) instead of the old “调大阶段数” hint. */
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
      `谱系阶段较多，已折叠最早的 ${groups.length - mandatory.size} 个单图阶段（并行分支与最终阶段已全部保留；阶段数选“全部”即不折叠）。`,
    );
    return groups.filter((_, i) => mandatory.has(i));
  }
  const chosen = new Set(mandatory);
  for (let i = groups.length - 1; i >= 0 && chosen.size < maxGroups; i--) chosen.add(i);
  for (let i = 0; i < groups.length && chosen.size < maxGroups; i++) chosen.add(i);
  const kept = groups.filter((_, i) => chosen.has(i));
  warnings.push(
    `谱系阶段较多，已折叠最早的 ${groups.length - kept.length} 个阶段（并行分支已保留；阶段数选“全部”即不折叠）。`,
  );
  return kept;
}

/** v3.55 (round-14): does this node read as an UNREFINED default-12 Å
 * ab-initio? True when the job's own `Maximum resolution (Å)` parameter is
 * within ±0.5 Å of cryoSPARC's default 12 — OR the parameter is absent
 * (absent = the default). False for every other job type, and for an
 * ab-initio the user deliberately ran at a non-default resolution. */
function isDefaultResolutionAbinit(node: LineageNode | undefined | null): boolean {
  if (!node || !/abinit/i.test(node.job_type || "")) return false;
  const max = node.abinit_max_resolution_A ?? null;
  return (
    max == null ||
    Math.abs(max - ABINIT_DEFAULT_RESOLUTION_A) <= ABINIT_DEFAULT_RESOLUTION_TOL_A
  );
}

/** v3.54 (round-13 “简化模式”): OMIT small-subset bootstrap steps from the
 *  built stage groups. A 2D-classification / 2D-selection / ab-initio item
 *  whose particle count is < SIMPLIFIED_SUBSET_FRACTION × its successor
 *  group's count is removed (an empty group disappears with it; a shrunken
 *  parallel group keeps its remaining items). The final stage never drops;
 *  items without a usable count stay (can't be judged); every drop is named
 *  in the warnings so the run log explains the simplified figure.
 *
 *  v3.55 (round-14 “当 ab initio 的 Maximum resolution 是默认的 12 时，
 *  忽略掉这些步骤，直接显示 heterorefine”): an ab-initio stage whose own
 *  Maximum-resolution parameter is the default 12 Å (or absent = the
 *  default) now drops REGARDLESS of its count — an unrefined initial model
 *  is a bootstrap step by definition, so the figure connects its
 *  predecessor straight to the following refinement stage. Only a
 *  deliberately NON-default ab-initio (e.g. a 6 Å one) survives, and then
 *  only via the count rule. */
function dropSimplifiedBootstrap(
  groups: FlowFigureItem[][],
  startUid: string,
  byUid: Map<string, LineageNode>,
  warnings: string[],
): FlowFigureItem[][] {
  const isBootstrapJobType = (jobType: string) => /class_2d|select_2d|homo_abinit/i.test(jobType || "");
  // Each group's representative count, in flow order.
  const groupCounts = groups.map((g) => {
    const cs = g
      .map((it) => it.particleTotal ?? null)
      .filter((v): v is number => v != null && v > 0);
    return cs.length ? Math.max(...cs) : null;
  });
  const dropped = new Set<string>();
  for (let gi = 0; gi < groups.length; gi++) {
    // Successor = the next group's known count (parallel-row siblings are
    // NOT successors of each other).
    let successorCount: number | null = null;
    for (let gj = gi + 1; gj < groups.length; gj++) {
      if (groupCounts[gj] != null) {
        successorCount = groupCounts[gj];
        break;
      }
    }
    // NOTE v3.55: successorCount may be null here (no later group carries a
    // count) — the default-12 ab-initio rule below does not need one; the
    // count rule simply skips such groups as before.
    for (const item of groups[gi]) {
      if (item.uid === startUid) continue; // the final stage never drops
      const node = byUid.get(item.uid);
      if (!node || !isBootstrapJobType(node.job_type)) continue;
      if (!dropped.has(item.uid) && isDefaultResolutionAbinit(node)) {
        // v3.55: the default-12 Å rule fires FIRST and regardless of count —
        // the stage is an unrefined initial model; the flow shows its
        // successor (hetero refinement …) directly.
        dropped.add(item.uid);
        const max = node.abinit_max_resolution_A ?? null;
        warnings.push(
          `简化模式: 已省略 ab-initio 步骤 ${item.uid}（Maximum resolution 为默认 ${
            max != null ? max.toFixed(1) : "12"
          } Å 的未精修初始模型 — 图中直接衔接其后续精修阶段）。`,
        );
        continue;
      }
      if (successorCount == null) continue;
      const count = item.particleTotal;
      if (count == null || count <= 0) continue;
      if (count >= successorCount * SIMPLIFIED_SUBSET_FRACTION) continue;
      if (!dropped.has(item.uid)) {
        dropped.add(item.uid);
        warnings.push(
          `简化模式: 已省略少量数据步骤 ${item.uid}（${item.label}，${fmtParticles(count)} ≪ 下一阶段 ${fmtParticles(successorCount)} particles）。`,
        );
      }
    }
  }
  if (!dropped.size) return groups;
  const out: FlowFigureItem[][] = [];
  for (const g of groups) {
    const kept = g.filter((it) => !dropped.has(it.uid));
    if (kept.length) out.push(kept);
  }
  return out;
}

/** v3.54 (round-13 “简化模式”): enforce the 多→少 reading over the
 *  DISPLAYED particle-count lines. Walks the kept stage groups in flow
 *  order with a running maximum (initialized to +∞ — the header's pick
 *  count is about PICKING, and a later re-extraction / merged dataset may
 *  legitimately exceed it, so only stage-to-stage counts are enforced):
 *
 *    - a stage whose representative count EXCEEDS the running maximum has
 *      ALL of its count lines hidden ("… particles" / "… selected";
 *      percentages stay — they are per-stage-relative and never break the
 *      funnel) and does NOT lower the bar;
 *    - a stage at or below the maximum keeps its counts and becomes the
 *      new bar.
 *
 *  Every hiding is named in the warnings so the run log explains itself. */
function simplifiedFunnelPass(groups: FlowFigureItem[][], warnings: string[]) {
  const isCountLine = (line: string) => / (particles|selected)$/.test(line);
  let runningMax = Infinity;
  for (const group of groups) {
    const totals = group
      .map((it) => it.particleTotal ?? null)
      .filter((v): v is number => v != null && v > 0);
    const groupTotal = totals.length ? Math.max(...totals) : null;
    const overflow = groupTotal != null && groupTotal > runningMax;
    const hiddenUids: string[] = [];
    for (const item of group) {
      if (item.classes?.length) {
        for (const c of item.classes) {
          const cOver =
            overflow ||
            (c.particleCount != null && c.particleCount > runningMax);
          if (cOver && c.stats.some(isCountLine)) {
            c.stats = c.stats.filter((l) => !isCountLine(l));
            if (!hiddenUids.includes(item.uid)) hiddenUids.push(item.uid);
          }
        }
        // single-class rows: item.stats carries the same lines the one slot
        // was built from — filter it too so the PPTX layer's item.stats
        // preference never resurrects a hidden count.
        if (overflow && item.stats.some(isCountLine)) {
          item.stats = item.stats.filter((l) => !isCountLine(l));
          if (!hiddenUids.includes(item.uid)) hiddenUids.push(item.uid);
        }
      } else if (item.stats.some(isCountLine)) {
        const over =
          overflow ||
          (item.particleTotal != null && item.particleTotal > runningMax);
        if (over) {
          item.stats = item.stats.filter((l) => !isCountLine(l));
          hiddenUids.push(item.uid);
        }
      }
    }
    if (overflow && hiddenUids.length) {
      warnings.push(
        `简化模式: ${hiddenUids.join(" + ")} 的粒子数（${fmtParticles(groupTotal as number)}）大于上一阶段（${runningMax === Infinity ? "—" : fmtParticles(runningMax)}），已隐藏其计数统计，保证流程「颗粒从多到少」。`,
      );
    }
    if (!overflow && groupTotal != null) {
      runningMax = Math.min(runningMax, groupTotal);
    }
  }
}

/** Reference-style demo model — uses the images extracted from the user's
 *  own Workflow.pptx sample (public/demo/workflow/*.png). v3.49: mirrors the
 *  reference deck EXACTLY — four single-map stages top→bottom (2*Hetero →
 *  Hetero → Non-uniform → DeepEMhancer), the stats boxes belong to the same
 *  stages as in the reference (32.9%/1638K on the first row, 26.3%/431K on
 *  the second), and the final line keeps its "C1, 3.46 Å" shape. */
export function buildDemoFigureModel(): FlowFigureModel {
  return {
    headerStats: { micrographs: "14,482 Micrographs", pick: "Auto pick", particles: "4980K particles" },
    groups: [
      [
        {
          uid: "J68",
          label: "2*Hetero refinement",
          stats: ["32.9%", "1638K particles"],
          mapKey: "J68/volume",
          map: null,
          imageUrl: "/demo/workflow/J68_H1.png",
        },
      ],
      [
        {
          uid: "J142",
          label: "Hetero refinement",
          stats: ["26.3%", "431K particles"],
          mapKey: "J142/volume",
          map: null,
          imageUrl: "/demo/workflow/J142_H2.png",
        },
      ],
      [
        {
          uid: "J174",
          label: "Non-uniform refinement",
          stats: [],
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
    finalStats: "C1, 3.46 Å",
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

/** v3.51: sample the canvas background from the four corners (2 px in) —
 *  renders now come back on ChimeraX's BLACK background (reference-deck
 *  style), so "trim white margins" must trim MARGINS OF THE ACTUAL BG.
 *  v3.53: transparent renders (save transparentBackground true) have
 *  alpha≈0 corners — their margins are trimmed by ALPHA, not color. */
function cornerBgColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const pts: Array<[number, number]> = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

/** v3.53: average ALPHA of the four corner pixels — a transparent render
 *  (transparentBackground true) has corners ≈0 and must keep its alpha channel
 *  through the letterbox step; opaque renders keep the v3.51 bg-fill. */
function cornerBgAlpha(data: Uint8ClampedArray, w: number, h: number): number {
  const pts: Array<[number, number]> = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let a = 0;
  let n = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    a += data[(y * w + x) * 4 + 3];
    n += 1;
  }
  return n ? a / n : 255;
}

/** Content bounding box: pixels that differ from the given background by
 *  more than `delta` on any channel (the old white-only test generalized —
 *  identical behaviour for white-background renders). */
function bgDiffBBox(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bg: [number, number, number],
  delta: number,
): BBox | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 10) continue;
      const dist = Math.max(
        Math.abs(data[i] - bg[0]),
        Math.abs(data[i + 1] - bg[1]),
        Math.abs(data[i + 2] - bg[2]),
      );
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
 * renders share one trim box (smallest bg margin per side + 5% keep),
 * expanded to the target aspect, then letterboxed onto identical canvases
 * (v3.51: canvas colour = each render's own sampled background) so every
 * thumbnail has the same scale AND framing. v3.53: renders saved with
 * transparentBackground true (alpha≈0 corners) keep their alpha — the
 * canvas is NOT filled, so the letterbox margins stay see-through and the
 * maps float on the white slide exactly like the reference deck's media.
 */
export async function uniformLetterbox(
  images: Map<string, Uint8Array>,
  aspect = 2,
  outW = 1600,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (typeof document === "undefined" || !images.size) return out;

  // Decode all + compute common margins.
  const decoded: Array<{ key: string; bmp: ImageBitmap; bg: [number, number, number]; transparent: boolean }> = [];
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
      const bg = cornerBgColor(data, bmp.width, bmp.height);
      const transparent = cornerBgAlpha(data, bmp.width, bmp.height) < 20;
      const box = bgDiffBBox(data, bmp.width, bmp.height, bg, 8);
      decoded.push({ key, bmp, bg, transparent });
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
  for (const { key, bmp, bg, transparent } of decoded) {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    if (!transparent) {
      // Opaque renders keep the v3.51 behaviour: margins filled with the
      // render's own sampled background so every thumb reads uniformly.
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      ctx.fillRect(0, 0, outW, outH);
    }
    // v3.53: transparent renders — canvas left clear, the drawn image's
    // alpha channel (including its see-through margins) is preserved as-is
    // in the exported PNG (canvas.toBlob keeps RGBA).
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
