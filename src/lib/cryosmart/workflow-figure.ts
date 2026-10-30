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
  /** v3.63: the raw cryoSPARC job_type ("hetero_refine" …) — drives the
   *  极简 classification-only curation (isClassificationJobType) without
   *  the PPTX layer having to reverse-engineer the display label. */
  jobType?: string;
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
  /** v3.63 (round-22 “每步展示的颗粒数和上一步的比例要重新用这一步
   *  除以上一步来计算”): the count flowing INTO this displayed row —
   *  for a merged “N×” row this is the FIRST member's particleTotal (the
   *  row's true upstream entry), while particleTotal keeps the LAST
   *  member's count. The retention labels divide THIS step by the
   *  PREVIOUS step, so they read entryParticleCount, not the montage's
   *  rep count. Undefined for un-merged rows (falls back to
   *  particleTotal). */
  entryParticleCount?: number | null;
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

/** v3.62 (round-21 “省略的步骤可能需要写为几*hetero refine或几*abinitio
 * 这样”): one stage type the 极简 deck dropped from between two displayed
 * rows — the PPTX renders the gap note “omitted: 2× Hetero refinement”
 * under the retention label, so a curated figure never skips steps
 * silently. */
export interface FlowOmission {
  /** Displayed stage type (jobTypeLabel output), e.g. "Hetero refinement". */
  label: string;
  /** How many dropped stages of this type sit in this gap. */
  count: number;
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
  /** v3.62: 极简 builds only — per-GAP omitted-stage notes: omissions[i]
   *  lists the stages removed between groups[i] and groups[i+1],
   *  aggregated by displayed type. Undefined for non-minimal builds
   *  (标准/简化 decks keep their round-19/20 look; 手动 drops are the
   *  user's own choice and stay named in the run log only). */
  omissions?: FlowOmission[][];
}

export interface BuildModelOptions {
  maxGroups?: number;
  includeSelect2d?: boolean;
  /** v3.61 (round-20 “极简模式还是有问题，很多上下游的job放在同一级了，
   *  应该是精选出几个job展示，上下游关系还是不能混乱”): build the CURATED
   *  MAINLINE figure instead of the full merge-assembly:
   *  - rows come from the particle MAINLINE only (walkParentChain's
   *    map-bearing spine, ancestor → final): EVERY job gets its OWN row —
   *    the merge-contributor parallel groups that crammed an upstream
   *    refinement and a downstream one into the same visual level (P268's
   *    “Import Volumes + Non-uniform refinement” rows) are never built;
   *  - imported reference volumes (import_volumes and other import_*
   *    seeds — map-bearing but pure data inputs) are excluded from the
   *    funnel (they render as workflow STEPS nowhere in the reference
   *    deck); the exclusion lifts only when it would empty the chain;
   *  - no select_2D montage row (the reference's funnel starts at the
   *    first map stage; the header band carries the entry counts);
   *  - the simplified passes (bootstrap/redundant drops + funnel) still
   *    run underneath, and the row cap falls to the same first+last /
   *    fill-from-the-end selection round-19 approved (curateMinimalFlow).
   *  v3.62 (round-21): consecutive same-type stages MERGE into one
   *  “N× <type>” row (the reference deck's own “2*Hetero refinement”)
   *  BEFORE the cap, and every stage the deck omits between two kept
   *  rows is annotated per gap (model.omissions → the PPTX's
   *  “omitted: N× <type>” note) — a curated figure never skips steps
   *  silently (“省略的步骤可能需要写为几*hetero refine或几*abinitio这样”).
   *  v3.63 (round-22 “极简模式中间精选的一定是分类的结果…每步展示的
   *  颗粒数和上一步的比例要重新用这一步除以上一步来计算，平行合并的
   *  分类job要将两个job的颗粒数合并”): the middle rows curate from
   *  CLASSIFICATION jobs ONLY (isClassificationJobType); a merged “N×”
   *  row carries entryParticleCount = its FIRST member's count so the
   *  retention labels divide this step by the previous step's true
   *  entry; and ≥2 parallel classification jobs reuniting at one merge
   *  render as ONE parallel row whose entry count is the SUM of the
   *  two jobs' counts.
   *  Implies nothing about the LAYOUT style; pair with workflow-pptx's
   *  style:"minimal" for the workflow.pptx look. */
  minimal?: boolean;
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

/** v3.62 (round-21, the uploaded P268 deck's “4812K particles”): always
 * the FULL separator format — the reference header itself prints
 * “1,588,675 particles”; the old ≥1e6 → “1635K”/“4812K” truncation read as
 * a typo next to the full numbers every other label carries. */
function fmtParticles(n: number): string {
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
    homo_reconstruct: "Reconstruction",
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

/** v3.63 (round-22 “极简模式中间精选的一定是分类的结果，不要选non-uniform
 *  这种非分类的job”): the job families that SORT particles into classes —
 *  heterogeneous refinement, ab-initio (multi-class initial model) and 3D
 *  classification. The 极简 middle rows curate from these ONLY;
 *  refinements (non-uniform / local / homo) and post-processing
 *  (DeepEMhancer …) are never selected as showcase middles — they appear
 *  (if at all) as the first/final rows or in the “omitted: N× …” gap
 *  notes. */
export function isClassificationJobType(jobType: string | null | undefined): boolean {
  return /hetero_refine|homo_abinit|class_3d|3d_classif/i.test(jobType || "");
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

/** v3.58 (round-17 “怎么缺少了 J28”): particle-first spine search. The old
 *  walk followed a job's VOLUME (map) input first — for P96's J31 that
 *  meant jumping straight back to J27 (J31's reference maps came directly
 *  from the ab-initio), so the entire particle mainline between them
 *  (J28 hetero refinement on the FULL 1.59M extract → J29 dedup → J30 →
 *  J31) never entered the figure: J28 rides only PARTICLE edges and was
 *  invisible. The figure is a WORKFLOW picture, so the search now prefers
 *  the PARTICLE ancestry: DFS upstream through non-volume edges first
 *  (passing through map-less steps like dedup / inspect / ctf), taking
 *  the first map-bearing ancestor found; volume parents are explored only
 *  after the particle subtree is exhausted (they are reference-map side
 *  inputs — e.g. J28 ← J27). A volume-parent chain therefore still works
 *  when no particle ancestor carries maps (the pre-v3.58 look).
 *
 *  v3.61 (round-20): `skipImportSeeds` — the 极简 curated-mainline variant.
 *  When several VOLUME-side ancestors compete after the particle subtree
 *  dies, the LIFO pops them in REVERSE push order, so an import_volumes
 *  reference (J220, pushed after the true initial model J230) can win the
 *  stop and hide the ab-initio behind it. The 极简 walk refuses to STOP on
 *  an import_* seed (it explores THROUGH it like a map-less step) so the
 *  real initial-model stage stays on the curated mainline; the standard
 *  walk keeps the old stop-on-first-map semantics (v3.58 unchanged). */
function spineUpstreamOf(
  uid: string,
  graph: LineageGraph,
  seen: Set<string>,
  skipImportSeeds = false,
): string {
  const isImportSeed = (u: string) => {
    const n = graph.byUid.get(u);
    return !!n && /^import_/i.test(n.job_type || "");
  };
  const stack: string[] = [];
  const pushParents = (u: string) => {
    const vol = graph.volParentsOf.get(u) || [];
    const all = graph.parentsOf.get(u) || [];
    // LIFO: non-volume parents go in LAST so they pop FIRST.
    for (const p of vol) if (!seen.has(p) && !stack.includes(p)) stack.push(p);
    for (const p of all)
      if (!seen.has(p) && !vol.includes(p) && !stack.includes(p)) stack.push(p);
  };
  pushParents(uid);
  let expansions = 0;
  while (stack.length && expansions++ < 64) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    const node = graph.byUid.get(cur);
    if (node && normalMapAssets(node).length > 0 && !(skipImportSeeds && isImportSeed(cur))) {
      // Do NOT mark the found spine node here — the caller's loop marks
      // nodes when APPENDING them to the chain, and its `!seen.has(cur)`
      // guard must not reject the node we just returned.
      return cur;
    }
    // Dead-branch exploration marker: map-less intermediates (and, for the
    // 极简 walk, import seeds) can never be spine members, so remembering
    // them only skips redundant re-walks.
    seen.add(cur);
    pushParents(cur);
  }
  return "";
}

/** Spine chain (final → earliest ancestor). v3.44: supplies the ORDER of
 *  the stage groups only — completeness comes from the merge-contributor
 *  scan over the full ancestor DAG. v3.58: each step now runs the
 *  particle-first search above (see spineUpstreamOf). v3.61: the 极简
 *  curation passes { skipImportSeeds: true } so imported reference volumes
 *  never steal the stop from the real initial-model stage. */
function walkParentChain(
  summary: LineageSummary,
  graph: LineageGraph,
  opts: { skipImportSeeds?: boolean } = {},
): LineageNode[] {
  const chain: LineageNode[] = [];
  const seen = new Set<string>();
  let cur = summary.start_uid;
  while (cur && !seen.has(cur) && chain.length < 80) {
    seen.add(cur);
    const node = graph.byUid.get(cur);
    if (!node) break;
    chain.push(node);
    cur = spineUpstreamOf(cur, graph, seen, !!opts.skipImportSeeds);
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
    jobType: node.job_type,
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
  /* v3.61 (round-20): 极简 CURATION — one job per row along the particle
   *  MAINLINE, never the merge-assembly's parallel cramping.
   *  v3.62 (round-21): the ORIGINAL mainline (pre-simplified) is kept
   *  for the per-gap omission notes. */
  const minimal = !!opts.minimal;
  let minimalMainline: Array<{ uid: string; label: string }> | null = null;

  const spineMapOrder = [...chain].reverse().filter((n) => hasMaps(n.uid));

  if (minimal) {
    /* v3.61 (round-20 “应该是精选出几个job展示，上下游关系还是不能混乱”):
     *  the curated funnel = the particle mainline's map-bearing stages,
     *  ancestor → final, EVERY job in its OWN row. No select_2D montage
     *  row (the reference deck's funnel starts at the first map stage;
     *  the header band carries the entry counts), no merge-contributor
     *  parallel groups (they are what crammed an upstream refinement and
     *  a downstream one onto the SAME visual level in P268's garbled
     *  deck), and imported reference volumes (import_* seeds) are not
     *  workflow STEPS — excluded unless the chain would be empty (a
     *  lineage traced from an imported map still needs an entry row).
     *  The walk skips import seeds (skipImportSeeds) so a volume-imported
     *  reference can never steal the stop from the real initial model.
     *  v3.63 (round-22 “平行合并的分类job要将两个job的颗粒数合并”): the
     *  ONE parallel shape now allowed — a stage whose PARTICLE side draws
     *  from ≥2 parallel CLASSIFICATION jobs (split branches reuniting at
     *  a merge) renders those branches as ONE parallel row, their
     *  montages side by side, with the row's entry count = the SUM of
     *  the two jobs' counts. */
    const isImportSeed = (n: LineageNode) => /^import_/i.test(n.job_type || "");
    const chainCurated = walkParentChain(summary, graph, { skipImportSeeds: true });
    const spineCurated = [...chainCurated].reverse().filter((n) => hasMaps(n.uid));
    const curatedStages = spineCurated.filter((n) => !isImportSeed(n));
    /* safety: a lineage whose ONLY map ancestors are imported volumes must
     * still render — fall back to the plain spine's stages (imports and
     * all) when the curated walk surfaced nothing beyond them. */
    const fallbackStages = spineMapOrder.filter((n) => !isImportSeed(n));
    const stages = curatedStages.length ? curatedStages : fallbackStages.length ? fallbackStages : spineMapOrder;
    /* v3.64 (round-23 “最终不应该用deepEMhancer，而是deepemhancer前一步的
     * map也需要展示”): post-processing jobs (DeepEMhancer / sharpen /
     * density_mod) never enter the 极简 deck — they are not classification
     * rows (isClassificationJobType), so their only way in was the
     * mandatory FINAL row, which showed the SHARPENED postprocess map
     * instead of the refinement that produced it. The funnel now STOPS at
     * the last refinement: the final row renders the pre-DeepEMhancer map
     * and the spine carries THAT job's resolution (the reference map
     * switches with it — see the reference/finalStats overrides below).
     * The un-filtered `stages` snapshot stays the omission-notes mainline
     * so a MID-chain postprocess stage still gets named in the per-gap
     * “omitted: N×” notes; only trailing ones (the usual case) fall off
     * the end and live in the warning below. */
    const postStages = stages.filter((n) => isPostProcessType(n.job_type || ""));
    const nonPostStages = stages.filter((n) => !isPostProcessType(n.job_type || ""));
    const renderStages = nonPostStages.length ? nonPostStages : stages;
    if (postStages.length && nonPostStages.length) {
      warnings.push(
        `极简模式: ${postStages.map((n) => `${jobTypeLabel(n.job_type)}(${n.uid})`).join("、")} 等后处理阶段不进入极简流程图 — 末行改为展示其前一步 ${renderStages[renderStages.length - 1].uid} 的 map，并显示该步的分辨率。`,
      );
    }
    /* v3.63: detect parallel CLASSIFICATION merges — for every mainline
     * stage, the map-bearing classification jobs that feed it PARTICLES
     * (a non-volume incoming edge — a parent connected by BOTH particle
     * and reference-map edges still counts as a particle contributor;
     * volume-only parents are reference inputs and never count). */
    const particleClassificationParentsOf = (uid: string): string[] => {
      const out: string[] = [];
      for (const e of summary.edges || []) {
        if (e.target !== uid || e.input_type === "volume") continue;
        const n = graph.byUid.get(e.source);
        if (!n || !isClassificationJobType(n.job_type)) continue;
        if (/^import_/i.test(n.job_type || "")) continue;
        if (normalMapAssets(n).length === 0) continue;
        if (!out.includes(e.source)) out.push(e.source);
      }
      return out;
    };
    const isAncestorOf = (a: string, b: string): boolean => {
      const stack = [b];
      const seen = new Set<string>();
      let hops = 0;
      while (stack.length && hops++ < 96) {
        const cur = stack.pop()!;
        if (cur === a) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const p of graph.parentsOf.get(cur) || []) if (!seen.has(p)) stack.push(p);
      }
      return false;
    };
    const parallelByStage = new Map<string, string[]>();
    /* v3.64: detection runs over ALL mainline stages INCLUDING the
     * postprocess ones — a pair of parallel classification jobs reuniting
     * AT a DeepEMhancer merge still renders as ONE summed parallel row
     * even though the merge target itself never enters the deck. */
    for (const S of stages) {
      const ps = particleClassificationParentsOf(S.uid);
      if (ps.length >= 2) parallelByStage.set(S.uid, ps);
    }
    const parallelMembers = new Set([...parallelByStage.values()].flat());
    const renderedGroups = new Set<string>();
    const emittedInGroups = new Set<string>();
    for (const S of renderStages) {
      if (parallelMembers.has(S.uid)) {
        const members = [...parallelByStage.values()].find((ps) => ps.includes(S.uid))!;
        const key = members.join("+");
        if (!renderedGroups.has(key)) {
          renderedGroups.add(key);
          const sorted = [...members].sort(
            (a, b) =>
              (graph.depth.get(a) ?? 0) - (graph.depth.get(b) ?? 0) ||
              a.localeCompare(b, undefined, { numeric: true }),
          );
          /* a member that is another member's ANCESTOR is chained, not
           *  parallel — drop it from the group (it keeps its own row). */
          const flat = sorted.filter((m) => !sorted.some((o) => o !== m && isAncestorOf(o, m)));
          if (flat.length >= 2) {
            const items = flat
              .slice(0, 3)
              .map((p) => itemFromNode(summary, graph.byUid.get(p)!, { warnings }));
            groups.push(items);
            items.forEach((it) => {
              usedUids.add(it.uid);
              emittedInGroups.add(it.uid);
            });
            warnings.push(
              `极简模式: 检测到 ${items.length} 个并行分类 job（${flat.join(" + ")}）在同一汇合点合并 — 已并列为一行展示，两个 job 的颗粒数合并计算（${items
                .reduce((s, it) => s + (it.particleTotal ?? 0), 0)
                .toLocaleString("en-US")} particles）。`,
            );
            continue;
          }
        }
        if (emittedInGroups.has(S.uid)) continue; // rendered inside its group
        // (fall through: S renders its own single row)
      }
      groups.push([itemFromNode(summary, S, { isFinal: S.uid === summary.start_uid, warnings })]);
      usedUids.add(S.uid);
    }
    /* v3.62 (round-21): snapshot the ORIGINAL curated mainline (uid +
     *  displayed label, ancestor → final) BEFORE the simplified passes —
     *  the per-gap omission notes below read it to name what each
     *  displayed gap skips (简化 drops + row-cap drops alike). */
    minimalMainline = stages.map((n) => ({ uid: n.uid, label: jobTypeLabel(n.job_type) }));
    const excludedImports = spineMapOrder.filter((n) => isImportSeed(n) && !stages.includes(n)).length;
    warnings.push(
      `极简模式: 已精选颗粒主线上的 ${renderStages.length} 个阶段 — 关键 job 逐个成行、按上下游顺序排列（连续同类型阶段将合并为一行「N×」标注；省略的步骤在图上以「N×」注明）` +
        (excludedImports
          ? `；另排除 ${excludedImports} 个导入/种子阶段（参考体积等输入不作为流程阶段展示）`
          : "") +
        "。",
    );
    warnings.push(
      "极简模式: 中间行仅精选分类结果（Hetero refinement / Ab-initio / 3D classification），非分类的中间阶段（Non-uniform、Local refinement 等）不入选 — 以「omitted: N× 类型」注明；箭头旁留存比例按「本步颗粒数 ÷ 上一步」重新计算，并行分类 job 颗粒数合并。",
    );
  } else {
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
  } // !minimal (v3.61: the 极简 figure never builds the merge assembly)

  // v3.54 (round-13 “简化模式”): OMIT small-subset bootstrap steps — 2D
  // classification / 2D selection / ab-initio stages whose particle count
  // is materially below their successor's (the tell-tale “flow jumps back
  // up after it” of a template / initial-model side branch). Runs as a
  // post-pass over the built groups, BEFORE folding, so the geometry and
  // the merge logic above stay untouched.
  let staged = groups;
  if (simplified && groups.length) {
    staged = dropSimplifiedBootstrap(groups, summary.start_uid, graph.byUid, warnings);
    // v3.58 (round-17): redundant non-uniform refinements merge and
    // reconstruct-only stages drop — AFTER the bootstrap pass so "adjacent"
    // refers to the displayed sequence.
    staged = dropSimplifiedRedundant(staged, summary.start_uid, graph, warnings);
  }

  /* v3.62 (round-21, the uploaded P268 deck's back-to-back “Ab-initio
   * reconstruction” rows): the 极简 mainline MERGES consecutive
   * same-type stages into ONE “N× <type>” row BEFORE the row cap —
   * the reference deck's own “2*Hetero refinement” pattern. Merging
   * first also frees row budget, so the cap drops fewer distinct
   * stages. Runs only on the minimal build: 标准/简化 decks keep the
   * round-19/20 look the user signed off.
   * v3.63 (round-22): the merged row also carries entryParticleCount =
   *  the FIRST member's particleTotal — the retention labels divide
   *  THIS step by the PREVIOUS step, so the merged row's denominator is
   *  its true upstream entry (the reference deck's own 37.2% = 590,421
   *  ÷ the 1,588,675 that entered the 2*Hetero run), not the last
   * member's input. Returns member→rep so the omission pass can tell
   * “represented by a displayed N× row” apart from “dropped”. */
  let mergedInto: Map<string, string> | null = null;
  if (minimal && staged.length) {
    const merged = mergeMinimalRuns(staged, warnings);
    staged = merged.groups;
    mergedInto = merged.mergedInto;
  }

  // v3.44 folding: only SINGLE stages fold (earliest first) — parallel
  // branch groups and the final stage never fold. The old splice(1, n)
  // deleted the branch group first, which is exactly how a dataset branch
  // vanished from the 4-group figure.
  // v3.61 (round-20): the 极简 figure curates its all-single mainline with
  // first+last mandatory and the middle filling from the END (closest to
  // the final map carries the resolution story) — the same selection
  // round-19 approved on the P96 chain, now on a cramp-free mainline.
  const folded = minimal
    ? curateMinimalFlow(staged, maxGroups, warnings)
    : trimFlowGroups(staged, maxGroups, warnings);

  /* v3.62 (round-21 “省略的步骤可能需要写为几*hetero refine或几*abinitio
   * 这样”): per-gap omission notes — which ORIGINAL mainline stages each
   * adjacent displayed pair skips (简化 drops + row-cap drops),
   * aggregated by type. Merged “N×” members are NOT omissions (the
   * multiplier label already represents them); stages beyond the
   * first/last kept row have no gap to live in (the run log names them). */
  const omissions =
    minimal && minimalMainline
      ? computeMinimalOmissions(folded, minimalMainline, mergedInto)
      : undefined;

  // v3.54 (round-13 “简化模式”): enforce the 多→少 reading over the
  // DISPLAYED count lines (stage-to-stage; the header's pick count is
  // about picking and is not enforced against re-extraction merges).
  if (simplified && folded.length) simplifiedFunnelPass(folded, warnings);

  // Reference = the FINAL job's map when it has one.
  // v3.64 (round-23): 极简 never anchors to the final JOB's map — the
  // postprocess stages never entered its deck, so the reference falls to
  // the last DISPLAYED map-bearing row below (the pre-DeepEMhancer
  // refinement every other map aligns to).
  if (finalNode && !minimal && normalMapAssets(finalNode).length > 0) {
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

  /* v3.64 (round-23 “最终不应该用deepEMhancer…并且需要显示分辨率”): in
   * the 极简 deck the funnel ends at the last DISPLAYED stage — post-
   * processing never entered it (filtered in the minimal walk above), so
   * the spine's resolution belongs to the pre-DeepEMhancer refinement, not
   * to the DeepEMhancer job that merely copies its input's number. Read it
   * from the last displayed row's own node; keep the default-12 Å
   * unrefined-abinit guard the simplified mode uses. The REFERENCE map
   * for 极简 was already re-anchored to this row by the `!minimal` branch
   * above (last map-bearing folded row). */
  if (minimal && folded.length) {
    const lastRow = folded[folded.length - 1];
    const lastItem = [...lastRow].reverse().find((it) => it.mapKey) ?? null;
    const lastNode = lastItem ? graph.byUid.get(lastItem.uid) ?? null : null;
    const lastRes = lastNode?.resolution_A ?? null;
    const lastIsAbinit = lastNode ? /abinit/i.test(lastNode.job_type || "") : false;
    const lastResIsDefaultAbinit =
      lastIsAbinit &&
      (isDefaultResolutionAbinit(lastNode) ||
        (lastRes != null && Math.abs(lastRes - ABINIT_DEFAULT_RESOLUTION_A) <= ABINIT_DEFAULT_RESOLUTION_TOL_A));
    if (lastRes != null && lastRes > 0 && !lastResIsDefaultAbinit) {
      finalStats = `${lastRes >= 10 ? lastRes.toFixed(1) : lastRes.toFixed(2)} Å`;
    } else if (lastItem) {
      warnings.push(
        `极简模式: 末行 ${lastItem.uid} 无可用分辨率（${
          lastResIsDefaultAbinit ? "未精修 ab-initio 默认 12 Å，已忽略" : "谱系未捕获该步的 FSC 分辨率"
        }）— 脊柱末端不显示分辨率标注。`,
      );
    }
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
    /* v3.62: 极简 only — undefined for every other build (the spread in
     * applyManualSelection carries undefined harmlessly). */
    omissions,
  };
}

/** v3.59 (round-18 手动模式 “自己勾选需要体现哪些 job 的图片”): filter the
 *  figure model down to the stages whose uid passes `keep`. Handles the
 *  two dangling references a trim can leave behind:
 *  - referenceKey/referenceItem would still point at the ORIGINAL final
 *    job's map — figureMapSources pushes referenceItem into its walk, so
 *    a dropped stage's map would sweep back into the render pipeline.
 *    Re-anchored to the LAST kept map-bearing stage (the same fallback
 *    buildFlowFigureModel itself uses).
 *  - finalStats ("3.46 Å") belongs to the original final JOB — dropped
 *    with it when that job is unchecked (whatever now ends the figure
 *    must not inherit another stage's resolution). */
export function applyManualSelection(
  model: FlowFigureModel,
  keep: (uid: string) => boolean,
): FlowFigureModel {
  const finalGroup = model.groups[model.groups.length - 1];
  const finalUid = finalGroup?.[finalGroup.length - 1]?.uid ?? null;
  const groups = model.groups
    .map((g) => g.filter((it) => keep(it.uid)))
    .filter((g) => g.length > 0);
  if (groups.length === model.groups.length) return model; // nothing dropped
  const dropped = model.groups.length - groups.length;
  if (!groups.length) {
    return {
      ...model,
      groups,
      referenceKey: null,
      referenceItem: null,
      finalStats: null,
      warnings: [...model.warnings, "手动勾选: 未保留任何阶段 — 请至少勾选一个 job"],
    };
  }
  let referenceKey: string | null = null;
  let referenceItem: FlowFigureItem | null = null;
  for (let i = groups.length - 1; i >= 0 && !referenceKey; i--) {
    for (let j = groups[i].length - 1; j >= 0; j--) {
      const it = groups[i][j];
      if (it.mapKey) {
        referenceKey = it.mapKey;
        referenceItem = it;
        break;
      }
    }
  }
  const droppedFinal = finalUid != null && !keep(finalUid);
  return {
    ...model,
    groups,
    referenceKey,
    referenceItem,
    finalStats: droppedFinal ? null : model.finalStats,
    warnings: [
      ...model.warnings,
      `手动勾选: 已省略未勾选的 ${dropped} 个阶段` +
        (droppedFinal ? "（最终阶段被取消勾选 — 其分辨率标注一并省略）" : ""),
    ],
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

/** v3.61 (round-20 “应该是精选出几个job展示，上下游关系还是不能混乱”):
 *  the 极简 row cap. The curated mainline is all-single rows, so there are
 *  no parallel groups to protect — the FINAL stage (the resolution story)
 *  is mandatory, and the remaining budget fills from the END: the stages
 *  closest to the final map are the most refined ones, so earlier middle
 *  steps drop first. The dropped stages' upstream→downstream ORDER among
 *  the survivors is untouched — curation only REMOVES rungs, it never
 *  re-levels them.
 *  v3.62 (round-21): runs on the POST-MERGE sequence (mergeMinimalRuns
 *  folds same-type runs first), and the warning points the reader at
 *  the per-gap “omitted: N×” notes the deck carries for the drops.
 *  v3.63 (round-22 “极简模式中间精选的一定是分类的结果，不要选
 *  non-uniform这种非分类的job”): the MIDDLE budget spends on
 *  CLASSIFICATION rows ONLY (hetero refinement / ab-initio / 3D
 *  classification — isClassificationJobType). A non-classification
 *  middle (non-uniform / local / homo refinement, post-processing) is
 *  never selected as a showcase row even when the cap has room to
 *  spare — it reads in the “omitted: N× …” gap note instead.
 *  v3.64 (round-23 “应该找到颗粒最多一个分类任务作为第一行”): the FIRST
 *  row is no longer simply the earliest mainline stage — it is the
 *  CLASSIFICATION task carrying the MOST particles (a parallel merge
 *  row reads the SUM of its jobs' counts; a merged “N×” row its FIRST
 *  member's entry — the funnel's true head). Everything upstream of it
 *  is left out of the deck (the header band already carries the entry
 *  counts); the last row is never a first-row candidate (it must stay
 *  the funnel's end), and the earliest stage remains the fallback when
 *  no classification row carries a count. */
function curateMinimalFlow(
  groups: FlowFigureItem[][],
  maxGroups: number,
  warnings: string[],
): FlowFigureItem[][] {
  const isClassRow = (g: FlowFigureItem[]) =>
    g.length > 0 && g.every((it) => isClassificationJobType(it.jobType));
  /* v3.63 rowEntryCount semantics (workflow-pptx.ts mirrors this): a
   * merged “N×” row reads its FIRST member's entry (entryParticleCount)
   * and a parallel row reads the SUM of its jobs' counts. */
  const entryOf = (g: FlowFigureItem[]): number | null => {
    const one = (it: FlowFigureItem): number | null => {
      const v = it.entryParticleCount ?? it.particleTotal ?? null;
      return v != null && v > 0 ? v : null;
    };
    if (!g.length) return null;
    if (g.length > 1) {
      const cs = g.map(one).filter((v): v is number => v != null);
      return cs.length ? cs.reduce((a, b) => a + b, 0) : null;
    }
    return one(g[0]);
  };
  if (groups.length <= 2) return groups;
  const lastIdx = groups.length - 1;
  let firstIdx = 0;
  let bestCount = -1;
  for (let i = 0; i < lastIdx; i++) {
    if (!isClassRow(groups[i])) continue;
    const c = entryOf(groups[i]);
    if (c != null && c > bestCount) {
      bestCount = c;
      firstIdx = i;
    }
  }
  const chosen = new Set<number>();
  chosen.add(firstIdx);
  chosen.add(lastIdx);
  let classMiddles = 0;
  let nonClassMiddles = 0;
  for (let i = lastIdx - 1; i > firstIdx; i--) {
    if (isClassRow(groups[i])) {
      classMiddles += 1;
      if (chosen.size < maxGroups) chosen.add(i);
    } else {
      nonClassMiddles += 1;
    }
  }
  if (chosen.size === groups.length) return groups;
  const kept = groups.filter((_, i) => chosen.has(i));
  const capDropped = classMiddles - Math.max(0, Math.min(classMiddles, maxGroups - 2));
  if (firstIdx > 0)
    warnings.push(
      `极简模式: 首行取颗粒数最多的分类任务「${groups[firstIdx][0].label} · ${entryOf(groups[firstIdx])?.toLocaleString("en-US") ?? "—"} particles」— 其上游 ${firstIdx} 个阶段未展示（首行之前的颗粒数已计入顶部总数带）。`,
    );
  if (nonClassMiddles > 0)
    warnings.push(
      `极简模式: 中间行仅精选分类结果 — 已略过 ${nonClassMiddles} 个非分类中间阶段（Non-uniform / Local refinement 等精修步骤，在图上以「omitted: N× 类型」注明）。`,
    );
  if (capDropped > 0 || kept.length < groups.length)
    warnings.push(
      `极简模式: 合并同类型后主线共 ${groups.length} 行，已精选 ${kept.length} 行（首行为颗粒数最多的分类任务、末行必留，其余自后向前仅保留分类结果 — 未选阶段在图上以「N×」省略标注，上下游顺序保持不变）。`,
    );
  return kept;
}

/** v3.62 (round-21 “省略的步骤可能需要写为几*hetero refine或几*abinitio
 * 这样”): the 极简 same-type run merge. Consecutive single-item rows whose
 * labels match collapse into ONE row labelled “N× <type>” — the reference
 * deck's own “2*Hetero refinement” row (the uploaded P268 deck instead
 * spent two identical “Ab-initio reconstruction” rows on one run). The
 * merged row keeps the LAST (most downstream) member's classes montage
 * and particle count — the ones feeding the next stage — so the anchor
 * selection reads unchanged, while entryParticleCount carries the FIRST
 * member's count (the row's true upstream entry — the retention labels'
 * “这一步 ÷ 上一步” denominator; v3.63 round-22).
 * v3.63: members map to their rep (mergedInto) so the omission pass can
 * tell a member of a DISPLAYED N× row (represented) from one whose row
 * was dropped (omitted).
 * Only truly CONSECUTIVE rows merge: a different stage type between two
 * heteros disqualifies the pair (the true flow order must never be
 * flattened). */
function mergeMinimalRuns(
  groups: FlowFigureItem[][],
  warnings: string[],
): { groups: FlowFigureItem[][]; mergedInto: Map<string, string> } {
  const out: FlowFigureItem[][] = [];
  const mergedInto = new Map<string, string>();
  let i = 0;
  while (i < groups.length) {
    const run: FlowFigureItem[][] = [groups[i]];
    while (
      i + 1 < groups.length &&
      groups[i + 1].length === 1 &&
      run[run.length - 1].length === 1 &&
      run[run.length - 1][0].label === groups[i + 1][0].label
    ) {
      run.push(groups[i + 1]);
      i += 1;
    }
    i += 1;
    if (run.length === 1) {
      out.push(run[0]);
      continue;
    }
    const rep = run[run.length - 1][0];
    const first = run[0][0];
    for (const g of run) mergedInto.set(g[0].uid, rep.uid);
    out.push([
      {
        ...rep,
        label: `${run.length}× ${rep.label}`,
        entryParticleCount: first.particleTotal ?? first.entryParticleCount ?? null,
      },
    ]);
    warnings.push(
      `极简模式: 已合并主线上连续 ${run.length} 个同类型阶段 ${run.map((g) => g[0].uid).join(" → ")} 为一行「${run.length}× ${rep.label}」（缩略图与颗粒数取最下游 ${rep.uid}，留存比例按合并前行入口 ${
        first.particleTotal != null ? first.particleTotal.toLocaleString("en-US") : "—"
      } 重新计算）。`,
    );
  }
  return { groups: out, mergedInto };
}

/** v3.62: the 极简 per-gap omission notes — which ORIGINAL mainline stages
 * each adjacent displayed pair skips (简化 drops + row-cap drops),
 * aggregated by displayed type. Runs over the pre-simplified mainline
 * snapshot so a stage the 简化 passes removed still gets NAMED (the user's
 * “省略的步骤写为几×…”). Merged N× members are excluded (their multiplier
 * label already represents them); so are displayed reps; stages before
 * the first / after the last kept row have no gap to live in (the run
 * log's warnings already name them). */
function computeMinimalOmissions(
  folded: FlowFigureItem[][],
  mainline: Array<{ uid: string; label: string }>,
  mergedInto: Map<string, string> | null,
): FlowOmission[][] {
  const displayed = new Set(folded.flat().map((it) => it.uid));
  const indexOf = new Map(mainline.map((m, i) => [m.uid, i] as const));
  const bracketUid = (row: FlowFigureItem[], prefer: "first" | "last"): string | null => {
    if (!row.length) return null;
    const onMainline = row.filter((it) => indexOf.has(it.uid));
    const pool = onMainline.length ? onMainline : row;
    return (prefer === "first" ? pool[0] : pool[pool.length - 1]).uid;
  };
  const out: FlowOmission[][] = [];
  for (let i = 0; i + 1 < folded.length; i++) {
    const a = bracketUid(folded[i], "last");
    const b = bracketUid(folded[i + 1], "first");
    const aIdx = a != null ? indexOf.get(a) : undefined;
    const bIdx = b != null ? indexOf.get(b) : undefined;
    const byLabel = new Map<string, number>();
    if (aIdx != null && bIdx != null && bIdx > aIdx) {
      for (let k = aIdx + 1; k < bIdx; k++) {
        const m = mainline[k];
        if (displayed.has(m.uid)) continue;
        const rep = mergedInto?.get(m.uid);
        if (rep != null && displayed.has(rep)) continue; // inside a displayed N× row
        byLabel.set(m.label, (byLabel.get(m.label) ?? 0) + 1);
      }
    }
    out.push([...byLabel].map(([label, count]) => ({ label, count })));
  }
  return out;
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

/** v3.58 (round-17): 简化模式 redundant-stage drops — two user-named rules:
 *  (1) non-uniform → (CTF 矫正) → non-uniform: the earlier refinement of
 *      the pair is superseded — show only the LATER one (P96's J35 → J36
 *      ctf → J37, both 378,677 particles, rendered the same map twice);
 *      the merge also fires for adjacent non-uniforms with EQUAL particle
 *      counts (the user's 或者-clause);
 *  (2) homo-reconstruct-only jobs (Reconstruct without refinement — P96's
 *      J40) add nothing to a presentation figure and are omitted; the
 *      flow connects their neighbours directly (J39 class 2 → J41).
 *  The FINAL stage never drops. Runs on the DISPLAYED group sequence right
 *  after dropSimplifiedBootstrap, so "adjacent" means adjacent in the
 *  figure (bootstrap stages are already gone). */
function dropSimplifiedRedundant(
  groups: FlowFigureItem[][],
  startUid: string,
  graph: LineageGraph,
  warnings: string[],
): FlowFigureItem[][] {
  const jobTypeOf = (uid: string) => graph.byUid.get(uid)?.job_type || "";
  const isNonuniform = (uid: string) => /nonuniform/i.test(jobTypeOf(uid));
  const isCtfish = (uid: string) => /ctf/i.test(jobTypeOf(uid));
  /** particle-parents of uid = incoming edges that are NOT volume inputs. */
  const particleParentsOf = (uid: string): string[] => {
    const vol = new Set(graph.volParentsOf.get(uid) || []);
    return (graph.parentsOf.get(uid) || []).filter((p) => p !== uid && !vol.has(p));
  };
  /** true when the particle path from `later` back to `earlier` passes
   *  only through CTF-refinement steps (none of which render as stages —
   *  they have no maps). Any non-CTF intermediate disqualifies the merge. */
  const ctfOnlyBetween = (earlier: string, later: string): boolean => {
    const stack = [later];
    const visited = new Set<string>([later]);
    let expansions = 0;
    while (stack.length && expansions++ < 24) {
      const cur = stack.pop()!;
      for (const p of particleParentsOf(cur)) {
        if (p === earlier) return true;
        if (visited.has(p) || !isCtfish(p)) continue;
        visited.add(p);
        stack.push(p);
      }
    }
    return false;
  };

  const dropped = new Set<string>();
  // (1) adjacent displayed non-uniform pairs — keep the LATER one.
  for (let gi = 0; gi + 1 < groups.length; gi++) {
    const a = groups[gi];
    const b = groups[gi + 1];
    if (a.length !== 1 || b.length !== 1) continue;
    const aUid = a[0].uid;
    const bUid = b[0].uid;
    if (aUid === startUid || bUid === startUid) continue;
    if (dropped.has(aUid)) continue;
    if (!isNonuniform(aUid) || !isNonuniform(bUid)) continue;
    const sameCount =
      a[0].particleTotal != null &&
      b[0].particleTotal != null &&
      a[0].particleTotal === b[0].particleTotal;
    if (!sameCount && !ctfOnlyBetween(aUid, bUid)) continue;
    dropped.add(aUid);
    warnings.push(
      `简化模式: 已合并连续 Non-uniform 精修 ${aUid} → ${bUid}（${
        sameCount ? "颗粒数相同" : "其间仅 CTF 矫正"
      } — 图中只保留后一次精修结果）。`,
    );
  }
  // (2) homo-reconstruct-only stages.
  for (const g of groups) {
    for (const it of g) {
      if (it.uid === startUid || dropped.has(it.uid)) continue;
      if (!/^homo_reconstruct$/i.test(jobTypeOf(it.uid))) continue;
      dropped.add(it.uid);
      warnings.push(
        `简化模式: 已省略仅重建步骤 ${it.uid}（Homo Reconstruct 不含精修环节 — 颗粒数与上一阶段相同）。`,
      );
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
 *  the second), and the final line keeps its "C1, 3.46 Å" shape.
 *  v3.62 (round-21): the merged row label and the counts follow the NEW
 *  generator conventions — “2× Hetero refinement” (the reference's own
 *  “2*Hetero refinement” row, now with the typographic ×) and full
 *  separator numbers everywhere (“4,980,000 particles”, not “4980K”). */
export function buildDemoFigureModel(): FlowFigureModel {
  return {
    headerStats: { micrographs: "14,482 Micrographs", pick: "Auto pick", particles: "4,980,000 particles" },
    groups: [
      [
        {
          uid: "J68",
          label: "2× Hetero refinement",
          stats: ["32.9%", "1,638,000 particles"],
          mapKey: "J68/volume",
          map: null,
          imageUrl: "/demo/workflow/J68_H1.png",
        },
      ],
      [
        {
          uid: "J142",
          label: "Hetero refinement",
          stats: ["26.3%", "431,000 particles"],
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
      /* v3.56: session-less same-origin URLs (the demo model's
       * /demo/workflow/*.png statics, data: URLs, and staged-session
       * image routes whose tokens live in the URL itself) need no
       * CryoSmart credentials — cryoSmartBytes(null, …) threw for EVERY
       * demo image, so a demo run shipped a PPTX of empty placeholder
       * frames. Plain same-origin fetch instead; anything absolute /
       * credential-bearing still goes through cryoSmartBytes. */
      let bytes: Uint8Array;
      if (!session && /^(?:\/|data:)/i.test(url)) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      } else {
        bytes = await cryoSmartBytes(session, url);
      }
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
