/**
 * report-html.ts — V2 HTML report builder for CryoSmart lineage.
 *
 * Ported verbatim (logic-wise) from `popup.js` of the original Chrome
 * extension `CryoSmartLineageTracer_3.0`. The main export
 * `buildLineageHtmlV2(summary)` returns a complete standalone HTML string
 * (single `<html>` document with inline `<style>` and `<script>`) that can
 * be opened in any browser without external dependencies.
 *
 * Layout (matches popup.js):
 *   - sticky header with project / start-job title
 *   - two-pane grid: left = outline + picture-flow, right = chain cards
 *   - per-job card shows source table, media block, class table, map
 *     downloads, outgoing box
 *   - `.download-all` buttons trigger staggered `window.open` (160 ms)
 *
 * This module is safe to import from both server and client components —
 * it contains no `'use server'` / `'use client'` directive and performs no
 * I/O.
 *
 * NOTE: At the time of this port, `lineage.ts` (Task 2-a) has not yet been
 * written. Per the task's fallback rule, every lineage helper that would
 * naturally live in `lineage.ts` is defined locally with a
 * `// duplicated from lineage.ts to avoid circular import` comment. When
 * `lineage.ts` is finalised, the duplicated locals can be replaced by
 * imports.
 */
import type {
  ClassSplit,
  ClassSplitJob,
  EdgeFamily,
  ImageAsset,
  IncomingByTargetMap,
  LineageEdge,
  LineageNode,
  LineageReportState,
  LineageSummary,
  MapAsset,
  NormalizedLineageEdge,
  Select2DSummary,
} from "./types";
import {
  MAJOR_JOB_TYPES,
  PARTICLE_AUX_JOB_TYPES,
  PICKING_JOB_TYPES,
  REPICK_PARTICLE_PRODUCER_TYPES,
  REPICK_SETUP_JOB_TYPES,
  SMALL_JOB_TYPES,
} from "./constants";

/* ================================================================== */
/*  Small helpers (HTML / formatting)                                 */
/* ================================================================== */

/** HTML-escape a string for safe interpolation into HTML. */
export function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// `escHtml` is the historical name used throughout the ported code; alias
// to `htmlEscape` so every reference below can stay verbatim with popup.js.
const escHtml = htmlEscape;

/** Format a numeric or string value for display. */
export function fmt(value: unknown): string {
  return Number.isInteger(value)
    ? (value as number).toLocaleString("en-US")
    : escHtml(value);
}

/** Build a uid -> node lookup map. */
// duplicated from lineage.ts to avoid circular import
export function summaryNodeMap(summary: LineageSummary): Map<string, LineageNode> {
  return new Map((summary.nodes || []).map((node) => [node.uid, node]));
}

/** Sort key for "J123" style uids — returns the numeric portion, or 0. */
// duplicated from lineage.ts to avoid circular import
export function reportJobNum(uid: string): number {
  const match = String(uid || "").match(/J(\d+)/i);
  return match ? Number(match[1]) : 0;
}

/** Sort nodes by their numeric uid. */
// duplicated from lineage.ts to avoid circular import
export function uidOrder(node: LineageNode): number {
  return node.uid_num ?? reportJobNum(node.uid);
}

/** Infer the lineage kind ("particle" / "volume" / ...) of an edge. */
// duplicated from lineage.ts to avoid circular import
export function edgeKind(edge: LineageEdge): string {
  if (["particle", "volume", "mask", "template", "exposure"].includes(edge.input_type)) {
    return edge.input_type;
  }
  const types = (edge.slots || []).map((slot) => slot.result_type || "").join(" ");
  for (const kind of ["particle", "volume", "mask", "template", "exposure"]) {
    if (types.includes(kind)) return kind;
  }
  return edge.input_type || "parent";
}

/** Resolve a stable kind string for an edge (kind, input_type, or "parent"). */
// duplicated from lineage.ts to avoid circular import
export function summaryKind(edge: LineageEdge): string {
  if (edge.kind) return edge.kind;
  if (edge.input_type) return edgeKind({ ...edge, slots: edge.slots || [] } as LineageEdge);
  if (Array.isArray(edge.kinds) && edge.kinds.length) return edge.kinds[0];
  return "parent";
}

/** Bucket a kind into one of the 5 visual families (mask → volume). */
// duplicated from lineage.ts to avoid circular import
export function reportKindFamily(kind: string): EdgeFamily | string {
  if (kind === "mask") return "volume";
  if (kind === "exposure") return "exposure";
  if (kind === "particle") return "particle";
  if (kind === "volume") return "volume";
  if (kind === "template" || kind === "ml_model" || kind === "model") return "template";
  return kind || "other";
}

/** Human-readable label for a kind (used in pills). */
// duplicated from lineage.ts to avoid circular import
export function reportKindLabel(kind: string): string {
  return (
    ({
      particle: "颗粒",
      volume: "map",
      mask: "mask",
      exposure: "照片",
      template: "template",
      ml_model: "model",
      model: "model",
      parent: "parent",
    } as Record<string, string>)[kind] || kind || ""
  );
}

/** The CSS class suffix for an edge kind (mask → "volume", etc.). */
export function htmlKindClass(kind: string): string {
  return (
    ({
      particle: "particle",
      volume: "volume",
      mask: "volume",
      exposure: "exposure",
      template: "template",
    } as Record<string, string>)[kind] || "other"
  );
}

/** Friendly label for an edge kind on the edge pills. */
export function htmlKindLabel(kind: string): string {
  return (
    ({
      particle: "particles",
      volume: "map",
      mask: "mask",
      exposure: "micrographs",
      template: "2D classes/templates",
      parent: "parent",
    } as Record<string, string>)[kind] || kind || ""
  );
}

/** Coarse visual family for a node (micrograph / particle / volume / other). */
// duplicated from lineage.ts to avoid circular import
export function htmlNodeKind(node: LineageNode): string {
  const type = node.job_type || "";
  if (node.volume_count !== null && node.volume_count !== undefined) return "volume";
  if (/refine|abinit|volume|class_3D/i.test(type)) return "volume";
  if (node.particle_count !== null && node.particle_count !== undefined) return "particle";
  if (/particle|picker|topaz/i.test(type)) return "particle";
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) return "exposure";
  if (/micrograph|ctf|exposure/i.test(type)) return "exposure";
  return "other";
}

/* ================================================================== */
/*  Domain helpers (pixel size / resolution / extraction)              */
/* ================================================================== */

function pixelSizeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100
    ? Math.round(number * 10000) / 10000
    : null;
}

function formatPixelSize(value: unknown): string {
  const number = pixelSizeNumber(value);
  if (!number) return "";
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** "1.24 Å/px" or empty string. */
// duplicated from lineage.ts to avoid circular import
export function pixelSizeText(node: LineageNode | null | undefined): string {
  const text = formatPixelSize(node && node.pixel_size_A);
  return text ? `${text} Å/px` : "";
}

function resolutionNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 20
    ? Math.round(number * 100) / 100
    : null;
}

function formatBinFactor(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.01
    ? String(rounded)
    : value.toFixed(2).replace(/\.?0+$/, "");
}

/** "3.2 Å" or empty string. */
// duplicated from lineage.ts to avoid circular import
export function resolutionText(node: LineageNode | null | undefined): string {
  const value = node && resolutionNumber(node.resolution_A);
  return value ? `${formatBinFactor(value)} Å` : "";
}

/** Extraction bin text "bin 2" or empty string. */
// duplicated from lineage.ts to avoid circular import
export function extractionBinText(node: LineageNode | null | undefined): string {
  const p = node && node.extraction_params;
  if (!p || !p.bin_factor) return "";
  return `bin ${formatBinFactor(p.bin_factor)}`;
}

/** "原始 pixel 256 px · 提取 box 128 px · bin 2" or empty. */
// duplicated from lineage.ts to avoid circular import
export function extractionParamText(node: LineageNode | null | undefined): string {
  const p = node && node.extraction_params;
  if (!p) return "";
  const parts: string[] = [];
  if (p.box_size_pix) parts.push(`原始 pixel ${formatBinFactor(p.box_size_pix)} px`);
  if (p.extracted_box_size_pix) parts.push(`提取 box ${formatBinFactor(p.extracted_box_size_pix)} px`);
  if (p.bin_factor) parts.push(`bin ${formatBinFactor(p.bin_factor)}${p.bin_inferred ? " (推断)" : ""}`);
  return parts.join(" · ");
}

/** Parse "class_12" → 12 (or null). */
// duplicated from lineage.ts to avoid circular import
export function parseClassIndex(name: unknown): number | null {
  const match = String(name || "").match(/class[_-](\d+)/);
  return match ? Number(match[1]) : null;
}

/** Sanitize a string for use as a path component. */
// duplicated from lineage.ts to avoid circular import
function safePart(value: unknown): string {
  return String(value || "item")
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

/** Local image path inside the report bundle: `images/<uid>/<name>.png`. */
// duplicated from lineage.ts to avoid circular import
function localImageFilename(nodeUid: string, name: string): string {
  return `images/${safePart(nodeUid)}/${safePart(name)}.png`;
}

/** Map preview image name for a volume group ("volume.map" → "volume"). */
// duplicated from lineage.ts to avoid circular import
function mapPreviewImageName(group: unknown): string {
  const value = String(group || "volume");
  if (/^(volume|map)$/i.test(value)) return "volume";
  return value.replace(/\.map$/i, "");
}

/* ================================================================== */
/*  Importance / classification helpers (duplicated from lineage.ts)   */
/* ================================================================== */

// duplicated from lineage.ts to avoid circular import
export function importance(node: LineageNode, startUid: string): "final" | "major" | "small" {
  if (node.uid === startUid && !/nonuniform_refine/i.test(node.job_type || "")) return "final";
  if (MAJOR_JOB_TYPES.has(node.job_type)) return "major";
  if (SMALL_JOB_TYPES.has(node.job_type)) return "small";
  // Best-effort "major" detection — popup.js checked `maxGroupNumItems`
  // against `output_result_groups`, which isn't available on a normalized
  // `LineageNode`. Fall back to counts.
  if (node.particle_count || node.volume_count || node.micrograph_count) return "major";
  return "small";
}

// duplicated from lineage.ts to avoid circular import
export function reportIsPickingNode(node: LineageNode | null | undefined): boolean {
  return Boolean(node && PICKING_JOB_TYPES.has(node.job_type));
}

// duplicated from lineage.ts to avoid circular import
export function reportIsRepickParticleProducer(node: LineageNode | null | undefined): boolean {
  return Boolean(
    node &&
      REPICK_PARTICLE_PRODUCER_TYPES.has(node.job_type) &&
      node.particle_count !== null &&
      node.particle_count !== undefined,
  );
}

// duplicated from lineage.ts to avoid circular import
export function reportIsRepickSetupNode(node: LineageNode | null | undefined): boolean {
  return Boolean(node && REPICK_SETUP_JOB_TYPES.has(node.job_type));
}

// duplicated from lineage.ts to avoid circular import
export function reportIsParticleAuxNode(node: LineageNode | null | undefined): boolean {
  return Boolean(node && PARTICLE_AUX_JOB_TYPES.has(node.job_type));
}

// duplicated from lineage.ts to avoid circular import
export function reportIsVolumeSourceNode(node: LineageNode | null | undefined): boolean {
  const type = (node && node.job_type) || "";
  return Boolean(
    node &&
      ((node.volume_count !== null && node.volume_count !== undefined) ||
        /homo_abinit|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|volume|map|align_3D|homo_reconstruct|sym_expand|particle_subtract/i.test(
          type,
        )),
  );
}

// duplicated from lineage.ts to avoid circular import
export function reportIsParticlePipelineNode(node: LineageNode | null | undefined): boolean {
  const type = (node && node.job_type) || "";
  return /import_particles|picker|topaz|extract_micrographs|remove_duplicate|particle_sets|downsample|standardize_particle|check_corrupt|reassign_particles/i.test(
    type,
  );
}

// duplicated from lineage.ts to avoid circular import
export function reportIsSelect2DNode(node: LineageNode | null | undefined): boolean {
  return Boolean(node && (node.select_2d || /select_2D/i.test(node.job_type || "")));
}

/* ================================================================== */
/*  reportLineageRound + dependencies                                 */
/*  (the central "round number" computation — duplicated from         */
/*  lineage.ts to avoid circular import)                              */
/* ================================================================== */

// duplicated from lineage.ts to avoid circular import
export function reportHasRepickSeed(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!uid || visited.has(uid) || depth > 8) return false;
  if (state.repickSeedMemo && state.repickSeedMemo.has(uid)) return state.repickSeedMemo.get(uid)!;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  const finish = (value: boolean): boolean => {
    if (state.repickSeedMemo) state.repickSeedMemo.set(uid, value);
    return value;
  };
  if (reportIsVolumeSourceNode(node)) return finish(true);
  if (reportIsRepickParticleProducer(node)) return finish(false);

  const incoming = state.incomingByTarget.get(uid) || [];
  for (const edge of incoming) {
    const source = state.nodeMap.get(edge.source);
    if (edge.family === "volume" || edge.kind === "mask") return finish(true);
    if (edge.family === "particle" && reportIsVolumeSourceNode(source)) return finish(true);
    if (
      reportIsRepickSetupNode(node) ||
      reportIsRepickSetupNode(source) ||
      edge.family === "particle"
    ) {
      if (reportHasRepickSeed(edge.source, state, new Set(visited), depth + 1)) return finish(true);
    }
  }
  return finish(false);
}

// duplicated from lineage.ts to avoid circular import
export function reportFeedsVolumeMainline(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!uid || visited.has(uid) || depth > 10) return false;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  if (depth > 0 && reportIsVolumeSourceNode(node)) return true;
  const outgoing = state.outgoingBySource ? state.outgoingBySource.get(uid) || [] : [];
  for (const edge of outgoing) {
    const target = state.nodeMap.get(edge.target);
    if (!target) continue;
    if (
      edge.family === "particle" ||
      edge.family === "volume" ||
      edge.family === "template" ||
      /model/i.test(edge.kind || "")
    ) {
      if (reportFeedsVolumeMainline(edge.target, state, new Set(visited), depth + 1)) return true;
    }
  }
  return false;
}

// duplicated from lineage.ts to avoid circular import
function reportRepickSeedSourceRounds(
  incoming: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string> = new Set(),
): number[] {
  return incoming
    .map((edge) => {
      const sourceNode = state.nodeMap.get(edge.source);
      const directSeed =
        edge.family === "volume" ||
        edge.kind === "mask" ||
        (edge.family === "particle" && reportIsVolumeSourceNode(sourceNode));
      const inheritedSeed = reportIsRepickSetupNode(sourceNode) && reportHasRepickSeed(edge.source, state);
      if (!directSeed && !inheritedSeed) return null;
      return reportLineageRound(edge.source, state, new Set(visited));
    })
    .filter((value): value is number => Number.isInteger(value));
}

// duplicated from lineage.ts to avoid circular import
function reportMaxRoundFromEdges(
  edges: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string>,
): number {
  const rounds = edges.map((edge) => reportLineageRound(edge.source, state, new Set(visited)));
  return rounds.length ? Math.max(...rounds) : 0;
}

function reportParticleSourceRound(
  incoming: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string>,
): number | null {
  const particleIncoming = incoming.filter((edge) => edge.family === "particle");
  return particleIncoming.length
    ? reportMaxRoundFromEdges(particleIncoming, state, visited)
    : null;
}

/**
 * The "round" of a job — 0 for imports, 1 for first picking round, 2 for a
 * repick after volume mainline, etc.
 *
 * `reportLineageRound` is the single most important function in the
 * report layer: it dictates which round column a node appears in on the
 * picture-flow diagram and the outline. Memoised via `state.roundMemo`.
 */
// duplicated from lineage.ts to avoid circular import
export function reportLineageRound(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set(),
): number {
  if (!uid || visited.has(uid)) return 0;
  if (state.roundMemo && state.roundMemo.has(uid)) return state.roundMemo.get(uid)!;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return 0;
  const type = node.job_type || "";
  const finish = (value: number): number => {
    if (state.roundMemo) state.roundMemo.set(uid, value);
    return value;
  };

  if (/import_(movies|micrographs)/i.test(type)) return finish(0);
  if (/import_particles/i.test(type)) return finish(1);

  const incoming = state.incomingByTarget.get(uid) || [];
  const maxSourceRound = reportMaxRoundFromEdges(incoming, state, visited);
  const particleSourceRound = reportParticleSourceRound(incoming, state, visited);
  const seedSourceRounds = reportRepickSeedSourceRounds(incoming, state, visited);
  const seedRound = seedSourceRounds.length ? Math.max(...seedSourceRounds) : null;

  if (reportIsRepickSetupNode(node)) {
    if (seedRound !== null && reportFeedsVolumeMainline(uid, state)) {
      return finish(Math.max(2, seedRound + 1));
    }
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1));
  }

  if (reportIsRepickParticleProducer(node)) {
    const setupSourceRounds = incoming
      .filter((edge) => reportIsRepickSetupNode(state.nodeMap.get(edge.source)))
      .map((edge) => reportLineageRound(edge.source, state, new Set(visited)));
    if (setupSourceRounds.length) {
      return finish(Math.max(1, ...setupSourceRounds));
    }
    if (seedRound !== null && reportFeedsVolumeMainline(uid, state)) {
      return finish(Math.max(2, seedRound + 1));
    }
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1));
  }

  if (reportIsPickingNode(node)) {
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || 1));
  }

  if (reportIsParticleAuxNode(node)) {
    return finish(particleSourceRound ?? maxSourceRound);
  }

  if (/class_2D|select_2D|rebalance_classes_2D|class_probability_filter/i.test(type)) {
    return finish(Math.max(1, particleSourceRound ?? maxSourceRound));
  }

  if (
    /homo_abinit|import_volumes|import_templates|create_templates|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|align_3D|homo_reconstruct|sym_expand|particle_subtract|volume_tools|volume_alignment|local_resolution|sharpen|fsc3D|cryodrgn|relion|helix|auto3Dre/i.test(
      type,
    )
  ) {
    return finish(particleSourceRound ?? maxSourceRound);
  }

  return finish(particleSourceRound ?? maxSourceRound);
}

/* ================================================================== */
/*  Node classification helpers                                       */
/* ================================================================== */

// duplicated from lineage.ts to avoid circular import
export function reportNodeIsMajor(node: LineageNode, summary: LineageSummary): boolean {
  const type = node.job_type || "";
  if (node.uid === summary.start_uid) return true;
  if (MAJOR_JOB_TYPES.has(type)) return true;
  if (/local_refine|topaz_train|topaz_extract/i.test(type)) return true;
  if (node.particle_count !== null && node.particle_count !== undefined) return true;
  if (node.volume_count !== null && node.volume_count !== undefined) return true;
  return false;
}

// duplicated from lineage.ts to avoid circular import
export function reportNodeCardKind(node: LineageNode): string {
  const kind = htmlNodeKind(node);
  return kind === "exposure" ? "micrograph" : kind;
}

/** "Micrographs" / "Round N" / "Auxiliary" — the outline stage label. */
// duplicated from lineage.ts to avoid circular import
export function reportStageName(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState | null,
): string {
  const type = node.job_type || "";
  if (/import_(movies|micrographs)/i.test(type)) return "Micrographs";
  const round = state ? reportLineageRound(node.uid, state) : 0;
  if (round > 0) {
    return `Round ${round}`;
  }
  return "Auxiliary";
}

// duplicated from lineage.ts to avoid circular import
export function reportIsPostMapExtraction(
  node: LineageNode | null | undefined,
  state: LineageReportState | null,
): boolean {
  if (!node || !state || !/extract_micrographs/i.test(node.job_type || "")) return false;
  const incoming = state.incomingByTarget.get(node.uid) || [];
  return incoming.some((edge) => {
    const source = state.nodeMap.get(edge.source);
    return /class_\d+/i.test(edge.group || "") || edge.family === "volume" || reportIsVolumeSourceNode(source);
  });
}

// duplicated from lineage.ts to avoid circular import
export function reportHasUpstreamSelectInSameRound(
  uid: string,
  state: LineageReportState,
  round: number,
  visited: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!uid || visited.has(uid) || depth > 10) return false;
  visited.add(uid);
  for (const edge of state.incomingByTarget.get(uid) || []) {
    const source = state.nodeMap.get(edge.source);
    if (!source || reportLineageRound(source.uid, state) !== round) continue;
    if (reportIsSelect2DNode(source)) return true;
    if (
      reportIsParticlePipelineNode(source) ||
      reportIsPickingNode(source) ||
      reportIsParticleAuxNode(source) ||
      reportIsRepickSetupNode(source)
    ) {
      if (reportHasUpstreamSelectInSameRound(source.uid, state, round, new Set(visited), depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/** Phase label inside a stage ("导入 / 预处理", "2D", "refine / final", ...). */
// duplicated from lineage.ts to avoid circular import
export function reportPhaseName(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState | null,
): string {
  const type = node.job_type || "";
  if (/import_(movies|micrographs)/i.test(type)) return "导入 / 预处理";
  if (/class_2D|select_2D|rebalance_classes_2D|class_probability_filter/i.test(type)) return "2D";
  if (/homo_abinit|import_volumes|import_templates|create_templates/i.test(type)) return "初始建模";
  if (
    /hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|align_3D|homo_reconstruct|sym_expand|particle_subtract|volume_tools|volume_alignment|local_resolution|sharpen|fsc3D|cryodrgn|relion|helix|auto3Dre/i.test(
      type,
    )
  ) {
    return "refine / final";
  }
  if (reportIsPostMapExtraction(node, state)) return "refine / final";
  if (reportIsParticlePipelineNode(node)) {
    const round = state ? reportLineageRound(node.uid, state) : 0;
    if (round > 0 && state && reportHasUpstreamSelectInSameRound(node.uid, state, round)) {
      return "再挑颗粒 / 提取";
    }
    return "挑颗粒 / 提取";
  }
  return "附属";
}

/** "颗粒 12345 · 照片 678 · 3.2 Å" — one-line metric string for a node. */
// duplicated from lineage.ts to avoid circular import
export function reportMetricText(node: LineageNode | null | undefined, compact = false): string {
  if (!node) return "";
  const parts: string[] = [];
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) {
    parts.push(`照片 ${fmt(node.micrograph_count)}`);
  }
  if (pixelSizeText(node)) parts.push(`pixel ${pixelSizeText(node)}`);
  if (node.particle_count !== null && node.particle_count !== undefined) {
    parts.push(`颗粒 ${fmt(node.particle_count)}`);
  }
  if (node.class_count !== null && node.class_count !== undefined) {
    parts.push(`class ${fmt(node.class_count)}`);
  }
  if (node.volume_count !== null && node.volume_count !== undefined) {
    parts.push(`volume ${fmt(node.volume_count)}`);
  }
  const res = resolutionText(node);
  if (res) parts.push(res);
  const bin = extractionBinText(node);
  if (bin) parts.push(bin);
  // popup.js branches on `compact` but returns the same string either way;
  // keep the branch for verbatim parity.
  return compact ? parts.join(" · ") : parts.join(" · ");
}

/** Variant of `reportMetricText` used by the picture-flow particle steps. */
// duplicated from lineage.ts to avoid circular import
export function reportPictureParticleMetricText(node: LineageNode): string {
  const parts: string[] = [];
  if (node.particle_count !== null && node.particle_count !== undefined) {
    parts.push(`颗粒 ${fmt(node.particle_count)}`);
  }
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) {
    parts.push(`照片 ${fmt(node.micrograph_count)}`);
  }
  const bin = extractionBinText(node);
  if (bin) parts.push(bin);
  return parts.join(" · ");
}

/* ================================================================== */
/*  Edge normalisation + grouping helpers                             */
/* ================================================================== */

const REPORT_NORMALIZED_EDGES_CACHE = new WeakMap<
  LineageSummary,
  NormalizedLineageEdge[]
>();

// duplicated from lineage.ts to avoid circular import
export function reportEdgeKind(edge: LineageEdge): string {
  return summaryKind(edge);
}

/** Normalised edges: every edge has `kind` / `family` / `group` filled. */
// duplicated from lineage.ts to avoid circular import
export function reportNormalizedEdges(summary: LineageSummary): NormalizedLineageEdge[] {
  if (summary && REPORT_NORMALIZED_EDGES_CACHE.has(summary)) {
    return REPORT_NORMALIZED_EDGES_CACHE.get(summary)!;
  }
  const edges = (summary.edges || []).map((edge) => {
    const kind = reportEdgeKind(edge);
    return {
      ...edge,
      kind,
      family: reportKindFamily(kind) as EdgeFamily,
      group: htmlGroupLabel(edge),
    } as NormalizedLineageEdge;
  });
  if (summary) REPORT_NORMALIZED_EDGES_CACHE.set(summary, edges);
  return edges;
}

/** Group label used on edge pills (source_group → input_name → ""). */
export function htmlGroupLabel(edge: LineageEdge): string {
  return edge.source_group || edge.input_name || "";
}

interface GroupedIncomingItem {
  source: string;
  kind: string;
  family: EdgeFamily;
  groups: string[];
}

interface GroupedOutgoingItem {
  target: string;
  kind: string;
  family: EdgeFamily;
  groups: string[];
}

// duplicated from lineage.ts to avoid circular import
export function reportGroupedIncoming(
  summary: LineageSummary,
  nodeUid: string,
): GroupedIncomingItem[] {
  const grouped = new Map<string, GroupedIncomingItem>();
  for (const edge of reportNormalizedEdges(summary).filter((item) => item.target === nodeUid)) {
    const key = `${edge.source}\t${edge.kind}`;
    if (!grouped.has(key)) {
      grouped.set(key, { source: edge.source, kind: edge.kind, family: edge.family, groups: [] });
    }
    const entry = grouped.get(key)!;
    if (edge.group && !entry.groups.includes(edge.group)) {
      entry.groups.push(edge.group);
    }
  }
  return Array.from(grouped.values()).sort(
    (a, b) => reportJobNum(a.source) - reportJobNum(b.source),
  );
}

// duplicated from lineage.ts to avoid circular import
export function reportGroupedOutgoing(
  summary: LineageSummary,
  nodeUid: string,
): GroupedOutgoingItem[] {
  const grouped = new Map<string, GroupedOutgoingItem>();
  for (const edge of reportNormalizedEdges(summary).filter((item) => item.source === nodeUid)) {
    const key = `${edge.target}\t${edge.kind}`;
    if (!grouped.has(key)) {
      grouped.set(key, { target: edge.target, kind: edge.kind, family: edge.family, groups: [] });
    }
    const entry = grouped.get(key)!;
    if (edge.group && !entry.groups.includes(edge.group)) {
      entry.groups.push(edge.group);
    }
  }
  return Array.from(grouped.values()).sort(
    (a, b) => reportJobNum(a.target) - reportJobNum(b.target),
  );
}

/* ================================================================== */
/*  Trace / outline helpers (visible-source chasing)                  */
/* ================================================================== */

/**
 * Walk back from `sourceUid` through same-family edges until we hit a node
 * that is in `visible`. Memoised on the `incomingByTarget` map itself
 * (`__traceVisibleMemo`).
 */
// duplicated from lineage.ts to avoid circular import
export function reportTraceVisibleSources(
  sourceUid: string,
  family: EdgeFamily | string,
  visible: Set<string>,
  incomingByTarget: IncomingByTargetMap,
  visited: Set<string> = new Set(),
  depth = 0,
): string[] {
  const memo = incomingByTarget.__traceVisibleMemo;
  const memoKey = `${sourceUid}\t${family}`;
  const useMemo = visited.size === 0 && memo;
  if (useMemo && memo!.has(memoKey)) return memo!.get(memoKey)!;
  if (!sourceUid || visited.has(sourceUid) || depth > 8) return [];
  visited.add(sourceUid);
  if (visible.has(sourceUid)) {
    const result: string[] = [sourceUid];
    if (useMemo) memo!.set(memoKey, result);
    return result;
  }
  const allIncoming = incomingByTarget.get(sourceUid) || [];
  let incoming = allIncoming.filter((edge) => edge.family === family);
  if (!incoming.length) incoming = allIncoming;
  if (!incoming.length) return [];
  const results: string[] = [];
  for (const edge of incoming) {
    results.push(
      ...reportTraceVisibleSources(edge.source, family, visible, incomingByTarget, new Set(visited), depth + 1),
    );
  }
  const result = Array.from(new Set(results)).sort((a, b) => reportJobNum(a) - reportJobNum(b));
  if (useMemo) memo!.set(memoKey, result);
  return result;
}

/** Outline = major nodes only, sorted by numeric uid. */
// duplicated from lineage.ts to avoid circular import
export function reportVisibleOutlineNodes(
  summary: LineageSummary,
  nodeMap: Map<string, LineageNode>,
): LineageNode[] {
  const nodes = (summary.nodes || []).filter((node) => {
    if (reportNodeIsMajor(node, summary)) return true;
    return false;
  });
  return nodes.sort((a, b) => uidOrder(a) - uidOrder(b));
}

/** Build the mutable report state (nodeMap, edge maps, memos, ...). */
// duplicated from lineage.ts to avoid circular import
export function reportBuildLineageState(summary: LineageSummary): LineageReportState {
  const nodeMap = summaryNodeMap(summary);
  const edges = reportNormalizedEdges(summary);
  const incomingByTarget: IncomingByTargetMap = new Map() as IncomingByTargetMap;
  const outgoingBySource = new Map<string, NormalizedLineageEdge[]>();
  for (const edge of edges) {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target)!.push(edge);
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    outgoingBySource.get(edge.source)!.push(edge);
  }
  incomingByTarget.__traceVisibleMemo = new Map();
  const outlineNodes = reportVisibleOutlineNodes(summary, nodeMap);
  const visible = new Set(outlineNodes.map((node) => node.uid));
  return {
    nodeMap,
    edges,
    incomingByTarget,
    outgoingBySource,
    outlineNodes,
    visible,
    roundMemo: new Map(),
    repickSeedMemo: new Map(),
  };
}

/** Visible ancestor uids (one per family) for an outline mini-node. */
// duplicated from lineage.ts to avoid circular import
export function reportOutlineRefs(
  uid: string,
  state: LineageReportState,
): Array<[string, EdgeFamily | string]> {
  const refs = new Map<string, [string, EdgeFamily | string]>();
  for (const edge of state.incomingByTarget.get(uid) || []) {
    for (const source of reportTraceVisibleSources(
      edge.source,
      edge.family,
      state.visible,
      state.incomingByTarget,
    )) {
      if (!state.visible.has(source) || source === uid) continue;
      const key = `${source}\t${edge.family}`;
      if (!refs.has(key)) refs.set(key, [source, edge.family]);
    }
  }
  const familyOrder: Record<string, number> = {
    exposure: 1,
    micrograph: 1,
    particle: 2,
    volume: 3,
    template: 4,
    other: 5,
  };
  return Array.from(refs.values()).sort((a, b) => {
    const byJob = reportJobNum(a[0]) - reportJobNum(b[0]);
    if (byJob) return byJob;
    return (familyOrder[a[1] as string] || 9) - (familyOrder[b[1] as string] || 9);
  });
}

/** Outline trace HTML for one (targetUid, sourceUid, family) triple. */
// duplicated from lineage.ts to avoid circular import
export function reportSourceTrace(
  targetUid: string,
  sourceUid: string,
  family: EdgeFamily | string,
  state: LineageReportState,
): string {
  if (state.visible.has(sourceUid)) return "";
  const refs: string[] = [];
  for (const edge of state.incomingByTarget.get(sourceUid) || []) {
    if (edge.family === family) {
      refs.push(
        ...reportTraceVisibleSources(edge.source, family, state.visible, state.incomingByTarget),
      );
    }
  }
  if (!refs.length) {
    for (const edge of state.incomingByTarget.get(sourceUid) || []) {
      refs.push(
        ...reportTraceVisibleSources(edge.source, family, state.visible, state.incomingByTarget),
      );
    }
  }
  const dedupedRefs = Array.from(new Set(refs))
    .filter((uid) => uid !== sourceUid && state.visible.has(uid))
    .sort((a, b) => reportJobNum(a) - reportJobNum(b));
  if (!dedupedRefs.length) return "";
  const route = `${escHtml(targetUid)} &larr; ${escHtml(sourceUid)} &larr; ${dedupedRefs
    .map(escHtml)
    .join(" / ")}`;
  const lines = dedupedRefs
    .map((uid) => {
      const node = state.nodeMap.get(uid);
      const metric = reportMetricText(node, true);
      return `<div class="up-line">${escHtml(uid)} ${escHtml(node ? node.job_type || "" : "")}${
        metric ? ` ${escHtml(metric)}` : ""
      }</div>`;
    })
    .join("");
  return `<div class="up-route">${route}</div><div class="up-list">${lines}</div>`;
}

/** Round nodes filtered by `predicate`, sorted by numeric uid. */
// duplicated from lineage.ts to avoid circular import
export function reportRoundNodes(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
  predicate: (node: LineageNode) => boolean,
): LineageNode[] {
  return (summary.nodes || [])
    .filter((node) => reportLineageRound(node.uid, state) === round)
    .filter(predicate)
    .sort((a, b) => reportJobNum(a.uid) - reportJobNum(b.uid));
}

/** Round particle nodes, optionally split by pre/post select_2D. */
// duplicated from lineage.ts to avoid circular import
export function reportRoundParticleNodes(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
  postSelect: boolean | null = null,
): LineageNode[] {
  return reportRoundNodes(summary, state, round, reportIsParticlePipelineNode).filter((node) => {
    if (postSelect === null) return true;
    return reportHasUpstreamSelectInSameRound(node.uid, state, round) === postSelect;
  });
}

/* ================================================================== */
/*  html* helpers (HTML-string fragments)                              */
/* ================================================================== */

export function htmlMetricChips(node: LineageNode): string {
  const chips: Array<[string, unknown]> = [];
  if (node.particle_count !== null && node.particle_count !== undefined) {
    chips.push(["颗粒数", node.particle_count]);
  }
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) {
    chips.push(["照片数", node.micrograph_count]);
  }
  if (pixelSizeText(node)) chips.push(["pixel size", pixelSizeText(node)]);
  if (node.volume_count !== null && node.volume_count !== undefined) {
    chips.push(["volume 数", node.volume_count]);
  }
  return chips
    .map(([label, value]) => `<span class="metric">${label}: ${fmt(value)}</span>`)
    .join("");
}

export function htmlCompactMetric(node: LineageNode | null | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  if (node.particle_count !== null && node.particle_count !== undefined) {
    parts.push(`颗粒数 ${fmt(node.particle_count)}`);
  }
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) {
    parts.push(`照片数 ${fmt(node.micrograph_count)}`);
  }
  if (pixelSizeText(node)) parts.push(`pixel ${pixelSizeText(node)}`);
  if (node.volume_count !== null && node.volume_count !== undefined) {
    parts.push(`volume 数 ${fmt(node.volume_count)}`);
  }
  return parts.join("; ");
}

export function htmlJobRef(uid: string, nodeMap: Map<string, LineageNode>): string {
  const node = nodeMap.get(uid);
  return node
    ? `<a href="#${escHtml(uid)}">${escHtml(uid)} ${escHtml(node.job_type || "")}</a>`
    : escHtml(uid);
}

export function htmlRelationPills(edge: NormalizedLineageEdge): string {
  const kind = summaryKind(edge);
  const cls = htmlKindClass(kind);
  const groups: string[] = [];
  const group = htmlGroupLabel(edge);
  if (group) groups.push(group);
  return `<span class="edge-pills"><span class="kind-pill kind-${cls}">${escHtml(
    htmlKindLabel(kind),
  )}</span>${groups
    .map((item) => `<span class="group-pill group-${cls}">${escHtml(item)}</span>`)
    .join("")}</span>`;
}

/** Group edges by (peer, kind, group) to collapse duplicate edges. */
export function groupedHtmlEdges(
  edges: NormalizedLineageEdge[],
  peerKey: "source" | "target",
): NormalizedLineageEdge[] {
  const grouped = new Map<string, NormalizedLineageEdge>();
  for (const edge of edges) {
    const peer = edge[peerKey];
    if (!peer) continue;
    const kind = summaryKind(edge);
    const group = htmlGroupLabel(edge);
    const key = `${peer}\t${kind}\t${group}`;
    if (!grouped.has(key)) grouped.set(key, { ...edge, kind, peer } as NormalizedLineageEdge);
  }
  return Array.from(grouped.values());
}

/** Hop rows for small sources collapsed under a major source. */
export function htmlSmallSourceHops(
  peerUid: string,
  kind: string,
  edges: NormalizedLineageEdge[],
  nodeMap: Map<string, LineageNode>,
): string {
  const peer = nodeMap.get(peerUid);
  if (!peer || importance(peer, "") !== "small") return "";
  const incoming = edges
    .filter((edge) => edge.target === peerUid && summaryKind(edge) === kind)
    .slice(0, 3);
  if (!incoming.length) return "";
  return `<div class="hop-stack">${incoming
    .map((edge) => {
      const source = nodeMap.get(edge.source);
      const cls = htmlKindClass(summaryKind(edge));
      const metric = htmlCompactMetric(source);
      return `<div class="hop-row hop-${cls}"><span class="hop-label">上一层来源</span><span class="hop-main">${htmlJobRef(
        edge.source,
        nodeMap,
      )} <span class="muted">-> ${escHtml(peerUid)}</span></span>${htmlRelationPills(
        edge,
      )}${
        metric ? `<span class="hop-metric">${metric}</span>` : ""
      }</div>`;
    })
    .join("")}</div>`;
}

/** The "来源 / 流向" grid for a single node card (V1 layout). */
export function htmlSourceRows(
  node: LineageNode,
  summary: LineageSummary,
  nodeMap: Map<string, LineageNode>,
): string {
  const edges = summary.edges || [];
  const incoming = groupedHtmlEdges(
    edges.filter((edge) => edge.target === node.uid) as NormalizedLineageEdge[],
    "source",
  );
  const outgoing = groupedHtmlEdges(
    edges.filter((edge) => edge.source === node.uid) as NormalizedLineageEdge[],
    "target",
  );
  if (!incoming.length && !outgoing.length) return "";
  const inHtml = incoming.length
    ? `<div class="source-col"><b>来源</b>${incoming
        .map(
          (edge) =>
            `<div class="source-row"><span>${htmlJobRef(edge.source, nodeMap)}</span>${htmlRelationPills(
              edge,
            )}</div>${htmlSmallSourceHops(edge.source, summaryKind(edge), edges as NormalizedLineageEdge[], nodeMap)}`,
        )
        .join("")}</div>`
    : "";
  const outHtml = outgoing.length
    ? `<div class="source-col source-col-out"><b>流向</b>${outgoing
        .slice(0, 10)
        .map(
          (edge) =>
            `<div class="source-row source-row-out"><span>${htmlJobRef(
              edge.target,
              nodeMap,
            )}</span>${htmlRelationPills(edge)}</div>`,
        )
        .join("")}</div>`
    : "";
  return `<div class="source-grid">${inHtml}${outHtml}</div>`;
}

/** Class table for the V1 layout (compact). */
export function htmlClassTable(node: LineageNode, summary: LineageSummary): string {
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  if (!classJob || !classJob.classes || !classJob.classes.length) return "";
  const rows = classJob.classes
    .map((cls) => {
      const links = (cls.maps || [])
        .map((map) => `<a href="${escHtml(map.download_url)}" target="_blank">${escHtml(map.result_name)}</a>`)
        .join(" ");
      return `<tr><td>${escHtml(cls.class_index)}</td><td>${
        cls.particle_count === null || cls.particle_count === undefined
          ? ""
          : fmt(cls.particle_count)
      }</td><td>${
        cls.particle_percent === null || cls.particle_percent === undefined
          ? ""
          : escHtml(cls.particle_percent)
      }</td><td>${links}</td></tr>`;
    })
    .join("");
  return `<h3>Class / MRC 来源</h3><table><tr><th>Class</th><th>Particles</th><th>%</th><th>Map downloads</th></tr>${rows}</table>`;
}

/** Map download table for the start node (V1 layout). */
export function htmlMapTable(node: LineageNode, summary: LineageSummary): string {
  if (node.uid !== summary.start_uid || !summary.map_download_urls) return "";
  const rows = Object.entries(summary.map_download_urls)
    .map(
      ([name, url]) =>
        `<tr><td>${escHtml(name)}</td><td><a href="${escHtml(url)}" target="_blank">download</a></td></tr>`,
    )
    .join("");
  return `<h3>MRC Maps</h3><table><tr><th>Result</th><th>Download</th></tr>${rows}</table>`;
}

/* ================================================================== */
/*  V1 layout (kept for reference / backwards compatibility)           */
/* ================================================================== */

/** V1 HTML builder — older single-column flow layout. */
export function buildLineageHtml(summary: LineageSummary): string {
  const nodeMap = summaryNodeMap(summary);
  const nodes = (summary.nodes || []).filter((node) => {
    const cls = importance(node, summary.start_uid);
    return cls === "major" || cls === "final";
  });
  const css = [
    "body{font-family:'Times New Roman',Times,serif;margin:24px;color:#17202a;background:#f8fafc}",
    "h1,h2,h3{margin:0 0 10px} h3{font-size:16px;margin-top:14px} a{color:#0b74de;text-decoration:none}",
    ".muted{color:#64748b}.metric{display:inline-block;margin:0 8px 8px 0;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-size:12px}",
    ".flow{position:relative;margin-left:12px}.flow::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:3px;background:#cbd5e1}.flow-card{position:relative;background:white;border:1px solid #d8e0ea;border-left:5px solid #0284c7;border-radius:8px;margin:14px 0 14px 34px;padding:14px}.flow-card::before{content:'';position:absolute;left:-31px;top:24px;width:24px;height:3px;background:#38bdf8}.flow-card::after{content:'';position:absolute;left:-39px;top:18px;width:14px;height:14px;border-radius:50%;background:#0284c7;border:3px solid #e0f2fe}",
    ".card-exposure{background:#f7fef9;border-left-color:#16a34a}.card-exposure::before{background:#16a34a}.card-exposure::after{background:#16a34a;border-color:#dcfce7}.card-particle{background:#fffdf4;border-left-color:#d97706}.card-particle::before{background:#d97706}.card-particle::after{background:#d97706;border-color:#fef3c7}.card-volume{background:#f8faff;border-left-color:#2563eb}.card-volume::before{background:#2563eb}.card-volume::after{background:#2563eb;border-color:#e0e7ff}",
    ".source-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin:10px 0}.source-col-out{background:#f8fafc;border:1px solid #edf2f7;border-radius:8px;padding:8px}.source-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0;padding:6px 8px;background:#fff;border:1px solid #dbe5ee;border-radius:6px}.source-row-out{background:#fbfdff;border-color:#edf2f7}",
    ".hop-stack{display:grid;gap:5px;margin:0 0 8px 18px;padding-left:12px;border-left:2px solid #dbe5ee}.hop-row{display:grid;grid-template-columns:auto minmax(210px,1fr) auto auto;align-items:center;gap:8px;padding:6px 8px;border:1px solid #dbe5ee;border-radius:6px;background:#fbfdff;font-size:12px}.hop-label{font-size:11px;color:#64748b;background:#eef2f7;border:1px solid #dbe5ee;border-radius:999px;padding:1px 7px}.hop-main{font-weight:600}.hop-metric{justify-self:end;color:#475569;white-space:nowrap}.hop-particle{background:#fffdf4;border-color:#fcd34d}.hop-volume{background:#f8faff;border-color:#a5b4fc}.hop-exposure{background:#f7fef9;border-color:#86efac}",
    ".edge-pills{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.kind-pill,.group-pill{white-space:nowrap;border-radius:999px;padding:2px 7px;font-size:12px}.kind-pill{color:#475569;background:#eef2f7;border:1px solid #dbe5ee}.group-pill{color:#334155;background:#f8fafc;border:1px solid #cbd5e1}.kind-particle,.group-particle{background:#fef3c7;border-color:#fcd34d;color:#78350f}.kind-volume,.group-volume{background:#e0e7ff;border-color:#a5b4fc;color:#1e3a8a}.kind-exposure,.group-exposure{background:#dcfce7;border-color:#86efac;color:#14532d}.kind-template,.group-template{background:#f1f5f9;border-color:#cbd5e1;color:#334155}",
    "table{border-collapse:collapse;width:100%;font-size:13px} th,td{border-bottom:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top}",
  ].join("\n");
  const cards = nodes
    .map(
      (node) =>
        `<article id="${escHtml(node.uid)}" class="flow-card card-${htmlNodeKind(node)}"><h2>${escHtml(
          node.uid,
        )} ${escHtml(node.job_type || "")}</h2><div>${htmlMetricChips(node)}</div>${htmlSourceRows(
          node,
          summary,
          nodeMap,
        )}${htmlClassTable(node, summary)}${htmlMapTable(node, summary)}</article>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CryoSmart ${escHtml(
    summary.project_uid,
  )} ${escHtml(summary.start_uid)} Lineage</title><style>${css}</style></head><body><h1>CryoSmart Lineage Report: ${escHtml(
    summary.project_uid,
  )}/${escHtml(summary.start_uid)}</h1><p class="muted">Nodes: ${(summary.nodes || []).length} | data edges: ${
    (summary.edges || []).length
  }</p><h2>Main Data Chain</h2><div class="flow">${cards}</div></body></html>`;
}

/* ================================================================== */
/*  V2 left outline (mini-nodes grouped by stage/phase)               */
/* ================================================================== */

/** A single outline mini-node card. */
export function reportMiniNode(node: LineageNode, state: LineageReportState): string {
  const kind = reportNodeCardKind(node);
  const refs = reportOutlineRefs(node.uid, state)
    .map(
      ([uid, family]) =>
        `<i class="ref-pill ${escHtml(family === "exposure" ? "micrograph" : family)}">${escHtml(
          uid,
        )}</i>`,
    )
    .join("");
  const metric = reportMetricText(node, true);
  return `<a class="mini-node ${escHtml(kind)}" href="#card-${escHtml(
    node.uid,
  )}"><b>${escHtml(node.uid)}</b><span>${escHtml(node.job_type || "")}</span>${
    metric ? `<em>${escHtml(metric)}</em>` : ""
  }<p class="mini-refs">${refs}</p></a>`;
}

/** The left outline panel — stages → phases → mini-node grid. */
export function reportOutline(summary: LineageSummary, state: LineageReportState): string {
  const byStage = new Map<string, LineageNode[]>();
  for (const node of state.outlineNodes) {
    const stage = reportStageName(node, summary, state);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(node);
  }
  const roundStages = Array.from(byStage.keys())
    .filter((stage) => /^Round \d+$/i.test(stage))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const stageOrder = ["Micrographs", ...roundStages, "Auxiliary"];
  const phaseOrder = [
    "导入 / 预处理",
    "挑颗粒 / 提取",
    "2D",
    "再挑颗粒 / 提取",
    "初始建模",
    "refine / final",
    "附属",
  ];
  return stageOrder
    .filter((stage) => (byStage.get(stage) || []).length)
    .map((stage, idx, stages) => {
      const nodes = byStage.get(stage) || [];
      const byPhase = new Map<string, LineageNode[]>();
      for (const node of nodes) {
        const phase = reportPhaseName(node, summary, state);
        if (!byPhase.has(phase)) byPhase.set(phase, []);
        byPhase.get(phase)!.push(node);
      }
      const phaseHtml = phaseOrder
        .filter((phase) => (byPhase.get(phase) || []).length)
        .map((phase) => {
          const phaseNodes = byPhase
            .get(phase)!
            .map((node) => reportMiniNode(node, state))
            .join("");
          return `<div class="phase"><div class="phase-label">${escHtml(
            phase,
          )}</div><div class="stage-grid">${phaseNodes}</div></div>`;
        })
        .join("");
      const arrow = idx < stages.length - 1 ? `<div class="stage-arrow">&darr;</div>` : "";
      return `<div class="stage"><h3>${escHtml(stage)}</h3>${phaseHtml}</div>${arrow}`;
    })
    .join("");
}

/* ================================================================== */
/*  V2 right-pane card pieces                                          */
/* ================================================================== */

/** "来源" table for a single node — direct sources + collapsed upstreams. */
export function reportSourceTable(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState,
): string {
  const incoming = reportGroupedIncoming(summary, node.uid);
  if (!incoming.length) return "";
  const rows = incoming
    .map((edge) => {
      const source = state.nodeMap.get(edge.source);
      const kindCls = htmlKindClass(edge.kind);
      const groups = edge.groups.join(", ");
      const metric = reportMetricText(source, true);
      return `<tr><td class="kind-cell ${escHtml(kindCls)}"><i></i>${escHtml(
        reportKindLabel(edge.kind),
      )}</td><td><a href="#card-${escHtml(edge.source)}">${escHtml(edge.source)} ${escHtml(
        source ? source.job_type || "" : "",
      )}</a>${metric ? `<em>${escHtml(metric)}</em>` : ""}</td><td>${escHtml(
        groups,
      )}</td><td class="up-cell">${reportSourceTrace(
        node.uid,
        edge.source,
        edge.family,
        state,
      )}</td></tr>`;
    })
    .join("");
  return `<div class="source-block"><h3>来源</h3><table class="source-table"><thead><tr><th>类型</th><th>直接来源</th><th>引用</th><th>合并上游</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** "输出到" side panel for a single node. */
export function reportOutgoingBox(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState,
): string {
  const outgoing = reportGroupedOutgoing(summary, node.uid);
  if (!outgoing.length) {
    return `<aside class="job-out"><h3>输出到</h3><span class="quiet">最终节点</span></aside>`;
  }
  const rows = outgoing
    .slice(0, 8)
    .map((edge) => {
      const target = state.nodeMap.get(edge.target);
      return `<div><b>${escHtml(reportKindLabel(edge.kind))}</b> -> ${escHtml(
        edge.target,
      )} ${escHtml(target ? target.job_type || "" : "")}</div>`;
    })
    .join("");
  return `<aside class="job-out"><h3>输出到</h3>${rows}</aside>`;
}

/** Filter a node's `maps` to those that look like normal (non-mask) maps. */
export function normalMapAssets(node: LineageNode): MapAsset[] {
  return (node.maps || []).filter((item) => {
    const group = String(item.group || "");
    const volumeGroup = item.group_type ? item.group_type === "volume" : !/mask/i.test(group);
    return volumeGroup && (item.result_name === "map" || item.download_url.endsWith(".map"));
  });
}

/** `<img>` tag with local src + onerror fallback to remote URL. */
export function reportImgTag(
  nodeUid: string,
  name: string,
  remoteSrc: string | null | undefined,
  className = "",
  alt = "image",
): string {
  if (!remoteSrc) return "";
  const localSrc = localImageFilename(nodeUid, name);
  const cls = className ? ` class="${escHtml(className)}"` : "";
  return `<img${cls} src="${escHtml(localSrc)}" data-remote-src="${escHtml(
    remoteSrc,
  )}" onerror="this.onerror=null;this.src=this.dataset.remoteSrc" alt="${escHtml(alt)}">`;
}

/** Grid of image boxes (used by media block). */
export function reportImageBoxes(
  nodeUid: string,
  images: Array<ImageAsset | null | undefined> | null | undefined,
  limit = 4,
): string {
  const good = (images || [])
    .filter((item): item is ImageAsset => Boolean(item && item.url && (item as ImageAsset).src))
    .slice(0, limit);
  if (!good.length) return "";
  return `<div class="imgs">${good
    .map((item) => {
      const localName = (item as ImageAsset & { local_name?: string }).local_name || item.name || "image";
      const originalUrl = item.original_url || item.url;
      return `<figure class="imgbox"><a href="${escHtml(originalUrl)}" target="_blank">${reportImgTag(
        nodeUid,
        localName,
        item.src,
        "",
        item.name || "image",
      )}</a><figcaption>${escHtml(item.name || "image")} <a href="${escHtml(
        originalUrl,
      )}" target="_blank">打开</a></figcaption></figure>`;
    })
    .join("")}</div>`;
}

/** Micrograph preview + Select 2D media block. */
export function reportMediaBlock(node: LineageNode): string {
  const chunks: string[] = [];
  if (
    node.job_type === "import_micrographs" &&
    Array.isArray(node.representative_micrograph_images)
  ) {
    const html = reportImageBoxes(node.uid, node.representative_micrograph_images, 3);
    if (html) {
      chunks.push(`<div class="media-block"><h3>原始 micrographs 预览</h3>${html}</div>`);
    }
  }

  if (node.select_2d) {
    const s = node.select_2d;
    const chips: string[] = [];
    if (s.particles_selected !== null && s.particles_selected !== undefined) {
      chips.push(`<span class="chip particle">保留颗粒: ${fmt(s.particles_selected)}</span>`);
    }
    if (s.particles_excluded !== null && s.particles_excluded !== undefined) {
      chips.push(`<span class="chip particle">排除颗粒: ${fmt(s.particles_excluded)}</span>`);
    }
    if (s.classes_selected !== null && s.classes_selected !== undefined) {
      chips.push(`<span class="chip">selected classes: ${fmt(s.classes_selected)}</span>`);
    }
    if (s.classes_excluded !== null && s.classes_excluded !== undefined) {
      chips.push(`<span class="chip">excluded classes: ${fmt(s.classes_excluded)}</span>`);
    }
    const images: Array<ImageAsset | null> = [
      s.selected_classes_image
        ? {
            kind: "ui_tile",
            name: "templates_selected",
            url: s.selected_classes_image,
            src: s.selected_classes_src || s.selected_classes_image,
            original_url: s.selected_classes_original_url || s.selected_classes_image,
          }
        : null,
      s.excluded_classes_image
        ? {
            kind: "ui_tile",
            name: "templates_excluded",
            url: s.excluded_classes_image,
            src: s.excluded_classes_src || s.excluded_classes_image,
            original_url: s.excluded_classes_original_url || s.excluded_classes_image,
          }
        : null,
      s.selected_particles_image
        ? {
            kind: "ui_tile",
            name: "particles_selected",
            url: s.selected_particles_image,
            src: s.selected_particles_src || s.selected_particles_image,
            original_url: s.selected_particles_original_url || s.selected_particles_image,
          }
        : null,
    ].filter(Boolean) as Array<ImageAsset | null>;
    chunks.push(
      `<div class="media-block"><h3>Select 2D</h3><div class="metrics">${chips.join(
        "",
      )}</div>${reportImageBoxes(node.uid, images, 3)}</div>`,
    );
  }

  return chunks.join("");
}

/** Map download table + "一键下载 map" button for a single node. */
export function reportMapDownloads(node: LineageNode, summary: LineageSummary): string {
  if (Array.isArray(node.classes) && node.classes.length) return "";
  const maps = normalMapAssets(node);
  if (!maps.length) return "";
  const urls = maps.map((item) => item.download_url).join("|");
  const rows = maps
    .map((item) => {
      const preview = item.preview_url
        ? `<a href="${escHtml(item.preview_original_url || item.preview_url)}" target="_blank">${reportImgTag(
            node.uid,
            mapPreviewImageName(item.group),
            item.preview_src || item.preview_url,
            "map-preview",
            `${item.group} preview`,
          )}</a>`
        : "";
      return `<tr><td>${escHtml(item.group)}</td><td>${preview}</td><td><a href="${escHtml(
        item.download_url,
      )}" target="_blank">map</a></td></tr>`;
    })
    .join("");
  return `<div class="map-block"><h3>Map / MRC</h3><div class="download-head"><b>普通 map: ${maps.length} 个</b><button type="button" class="download-all" data-urls="${escHtml(
    urls,
  )}">一键下载 map</button></div><table class="map-table"><thead><tr><th>Group</th><th>预览</th><th>下载</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Class table (horizontal) + "一键下载 map" for class_3D / abinit / hetero. */
export function reportClassTable(node: LineageNode, summary: LineageSummary): string {
  const classJob = (summary.class_split_jobs || []).find(
    (item: ClassSplitJob) => item.uid === node.uid,
  );
  if (!classJob || !Array.isArray(classJob.classes) || !classJob.classes.length) return "";
  const headers = classJob.classes
    .map((cls: ClassSplit) => `<th>class ${escHtml(cls.class_index)}</th>`)
    .join("");
  const counts = classJob.classes
    .map(
      (cls: ClassSplit) =>
        `<td>${
          cls.particle_count === null || cls.particle_count === undefined
            ? ""
            : fmt(cls.particle_count)
        }</td>`,
    )
    .join("");
  const percents = classJob.classes
    .map(
      (cls: ClassSplit) =>
        `<td>${
          cls.particle_percent === null || cls.particle_percent === undefined
            ? ""
            : `${escHtml(cls.particle_percent)}%`
        }</td>`,
    )
    .join("");
  const previews = classJob.classes
    .map((cls: ClassSplit) => {
      return `<td>${
        cls.mrc_preview_url
          ? `<a href="${escHtml(cls.mrc_preview_original_url || cls.mrc_preview_url)}" target="_blank">${reportImgTag(
              node.uid,
              cls.volume_group || `class_${cls.class_index}`,
              cls.mrc_preview_src || cls.mrc_preview_url,
              "class-preview",
              `class ${cls.class_index} map preview`,
            )}</a>`
          : ""
      }</td>`;
    })
    .join("");
  const maps = classJob.classes
    .map((cls: ClassSplit) => {
      const link =
        (cls.maps || []).find((item) => item.result_name === "map") || (cls.maps || [])[0];
      return `<td>${link ? `<a href="${escHtml(link.download_url)}" target="_blank">map</a>` : ""}</td>`;
    })
    .join("");
  const downloadUrls = classJob.classes
    .flatMap((cls: ClassSplit) => cls.maps || [])
    .filter((item: { result_name?: string; download_url: string }) => item.result_name === "map" || !item.result_name)
    .map((item: { download_url: string }) => item.download_url)
    .filter(Boolean);
  const button = downloadUrls.length
    ? `<button type="button" class="download-all" data-urls="${escHtml(downloadUrls.join("|"))}">一键下载 map</button>`
    : "";
  return `<div class="class-toolbar"><span>Class / Map</span></div><div class="classes horizontal-view"><div class="horizontal-table"><table><tbody><tr><th>Class</th>${headers}</tr><tr><th>颗粒</th>${counts}</tr><tr><th>%</th>${percents}</tr><tr><th>预览</th>${previews}</tr><tr><th>Map</th>${maps}</tr></tbody></table></div></div>${
    downloadUrls.length
      ? `<div class="download-head"><b>普通 map: ${downloadUrls.length} 个</b>${button}</div>`
      : ""
  }`;
}

/* ================================================================== */
/*  V2 picture-flow helpers (the SVG-style mini-flow inside the left  */
/*  pane, rendered as HTML)                                            */
/* ================================================================== */

function reportFirstMicrographNode(summary: LineageSummary): LineageNode | undefined {
  return (
    (summary.nodes || []).find(
      (node) => node.job_type === "import_micrographs" && node.micrograph_count !== null,
    ) || (summary.nodes || []).find((node) => /micrograph/i.test(node.job_type || ""))
  );
}

function reportSelectedClassIndices(
  nodeUid: string,
  summary: LineageSummary,
  state: LineageReportState,
): Set<number> {
  const selected = new Set<number>();
  for (const edge of state.edges.filter((item) => item.source === nodeUid)) {
    const group = edge.group || "";
    const idx = parseClassIndex(group);
    if (idx !== null && (edge.family === "particle" || edge.family === "volume")) {
      selected.add(idx);
    }
  }
  return selected;
}

function reportPictureImg(
  nodeUid: string,
  name: string,
  remoteSrc: string | null | undefined,
  className = "",
  alt = "image",
): string {
  return reportImgTag(nodeUid, name, remoteSrc, className, alt);
}

function reportPictureMicrographs(summary: LineageSummary): string {
  const node = reportFirstMicrographNode(summary);
  if (!node) return "";
  const imgs = (node.representative_micrograph_images || []).slice(0, 3);
  const imgHtml = imgs.length
    ? `<div class="pf-mic-imgs">${imgs
        .map((item) =>
          reportPictureImg(
            node.uid,
            (item as ImageAsset & { local_name?: string }).local_name || item.name || "image",
            item.src,
            "",
            item.name || "micrograph",
          ),
        )
        .join("")}</div>`
    : "";
  const preprocess = (summary.nodes || [])
    .filter(
      (item) =>
        SMALL_JOB_TYPES.has(item.job_type) &&
        /ctf|motion|curate|exposure/i.test(item.job_type || ""),
    )
    .slice(0, 4)
    .map((item) => `${item.uid} ${item.job_type}`)
    .join("; ");
  return `<div class="pf-start"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-big">${fmt(
    node.micrograph_count,
  )} micrographs${pixelSizeText(node) ? ` · ${escHtml(pixelSizeText(node))}` : ""}</div>${imgHtml}<div class="pf-note">${escHtml(
    node.uid,
  )} ${escHtml(node.job_type || "")}${
    preprocess ? ` · preprocessing: ${escHtml(preprocess)}` : ""
  }</div></a></div>`;
}

function reportPictureSelect2D(node: LineageNode): string {
  const s = node.select_2d;
  if (!s) return "";
  const input: number | null = node.particle_count || s.particles_selected || null;
  const selected = s.particles_selected;
  const ratio =
    Number.isInteger(input) && Number.isInteger(selected as number) && input
      ? `${Math.round(((selected as number) / input!) * 1000) / 10}%`
      : "";
  const img = s.selected_classes_image
    ? `<div class="pf-select-img">${reportPictureImg(
        node.uid,
        "selected_classes",
        s.selected_classes_src || s.selected_classes_image,
        "",
        "templates selected",
      )}</div>`
    : "";
  return `<div class="pf-step pf-select"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(
    node.uid,
  )} select_2D</div><div class="pf-note">input: ${
    input ? fmt(input) : "?"
  } particles</div><div class="pf-note">selected classes: ${
    s.classes_selected ?? "?"
  }</div><div class="pf-note">output: ${
    selected ? fmt(selected) : "?"
  } particles${ratio ? `, ${ratio}` : ""}</div>${img}</a></div>`;
}

function reportPictureParticleSteps(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
  label = "挑颗粒 / 提取",
  postSelect: boolean | null = null,
): string {
  const nodes = reportRoundParticleNodes(summary, state, round, postSelect);
  if (!nodes.length) return "";
  const items = nodes
    .map((node) => {
      const metric = reportPictureParticleMetricText(node);
      return `<a class="pf-particle-step" href="#card-${escHtml(node.uid)}"><b>${escHtml(
        node.uid,
      )}</b><span>${escHtml(node.job_type || "")}</span>${
        metric ? `<em>${escHtml(metric)}</em>` : ""
      }</a>`;
    })
    .join("");
  return `<div class="pf-particle-block"><div class="pf-subhead">${escHtml(
    label,
  )}</div><div class="pf-particle-steps">${items}</div></div>`;
}

function reportPictureClassJob(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState,
): string {
  const classJob = (summary.class_split_jobs || []).find((item: ClassSplitJob) => item.uid === node.uid);
  if (!classJob || !classJob.classes || !classJob.classes.length) return "";
  const selected = reportSelectedClassIndices(node.uid, summary, state);
  const total =
    classJob.classes.find((item: ClassSplit) => Number.isInteger(item.total_particles))?.total_particles ||
    node.particle_count;
  const toGroups = state.edges
    .filter((edge) => edge.source === node.uid && parseClassIndex(edge.group) !== null)
    .map((edge) => `${edge.target} ${edge.group}`)
    .filter(Boolean);
  const tiles = classJob.classes
    .map((cls: ClassSplit) => {
      const isSelected = selected.has(cls.class_index);
      const pct =
        cls.particle_percent !== null && cls.particle_percent !== undefined
          ? `${escHtml(cls.particle_percent)}%`
          : "";
      const count =
        cls.particle_count !== null && cls.particle_count !== undefined
          ? `${fmt(cls.particle_count)} particles`
          : "";
      const img = cls.mrc_preview_url
        ? reportPictureImg(
            node.uid,
            cls.volume_group || `class_${cls.class_index}`,
            cls.mrc_preview_src || cls.mrc_preview_url,
            "",
            `class ${cls.class_index}`,
          )
        : "";
      return `<figure class="pf-class ${isSelected ? "selected" : ""}">${img}<figcaption>class ${escHtml(
        cls.class_index,
      )}</figcaption><b>${pct}</b><span>${count}</span></figure>`;
    })
    .join("");
  return `<div class="pf-map-job"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(
    node.uid,
  )} ${escHtml(node.job_type || "")}</div><div class="pf-note">input: ${
    total ? fmt(total) : "?"
  } particles${
    selected.size
      ? ` · selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}`
      : ""
  }</div>${
    toGroups.length
      ? `<div class="pf-note">to: ${escHtml(toGroups.slice(0, 4).join("; "))}</div>`
      : ""
  }<div class="pf-classes">${tiles}</div></a></div>`;
}

function reportPictureNormalMap(node: LineageNode): string {
  const maps = normalMapAssets(node);
  if (!maps.length) return "";
  const item = maps.find((map) => map.preview_url) || maps[0];
  const preview = item.preview_url
    ? reportPictureImg(
        node.uid,
        mapPreviewImageName(item.group),
        item.preview_src || item.preview_url,
        "",
        `${item.group} preview`,
      )
    : "";
  return `<div class="pf-final"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(
    node.uid,
  )} ${escHtml(node.job_type || "")}</div>${
    preview ? `<div class="pf-final-img">${preview}</div>` : ""
  }<div class="pf-big">${
    node.particle_count !== null && node.particle_count !== undefined
      ? `${fmt(node.particle_count)} particles`
      : "final map"
  }</div>${summaryResolutionLine(node)}</a></div>`;
}

function summaryResolutionLine(node: LineageNode): string {
  const res = resolutionText(node);
  return res ? `<div class="pf-note">${escHtml(res)}</div>` : "";
}

function reportPictureRound(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
): string {
  const selectNodes = reportRoundNodes(summary, state, round, (node) => Boolean(node.select_2d));
  const mapNodes = reportRoundNodes(summary, state, round, (node) => {
    const hasClasses = (summary.class_split_jobs || []).some(
      (item: ClassSplitJob) => item.uid === node.uid && Boolean(item.classes && item.classes.length),
    );
    return hasClasses || normalMapAssets(node).length > 0;
  });
  const preParticleSteps = reportPictureParticleSteps(
    summary,
    state,
    round,
    "挑颗粒 / 提取",
    selectNodes.length ? false : null,
  );
  const postParticleSteps = selectNodes.length
    ? reportPictureParticleSteps(summary, state, round, "再挑颗粒 / 提取", true)
    : "";
  if (!preParticleSteps && !selectNodes.length && !postParticleSteps && !mapNodes.length) {
    return "";
  }
  const steps: string[] = [];
  if (preParticleSteps) steps.push(preParticleSteps);
  for (const node of selectNodes) steps.push(reportPictureSelect2D(node));
  if (postParticleSteps) steps.push(postParticleSteps);
  for (const node of mapNodes) {
    const html = (summary.class_split_jobs || []).some((item: ClassSplitJob) => item.uid === node.uid)
      ? reportPictureClassJob(node, summary, state)
      : reportPictureNormalMap(node);
    if (html) steps.push(html);
  }
  return `<div class="pf-round"><div class="pf-round-head"><h3>Round ${round}${
    round > 1 ? " repicking" : ""
  }</h3></div>${steps.join('<div class="pf-arrow">↓</div>')}</div>`;
}

/** The picture-flow diagram (HTML version of the SVG flow). */
export function reportPictureFlow(summary: LineageSummary, state: LineageReportState): string {
  const rounds = Array.from(
    new Set(
      (summary.nodes || [])
        .map((node) => reportLineageRound(node.uid, state))
        .filter((round) => round > 0),
    ),
  ).sort((a, b) => a - b);
  const roundHtml = rounds
    .map((round) => reportPictureRound(summary, state, round))
    .filter(Boolean)
    .join('<div class="pf-arrow">↓</div>');
  if (!roundHtml) return "";
  return `<div class="picture-flow"><div class="picture-head"><h2>Picture Flow</h2><span>SVG 会随报告单独导出</span></div>${reportPictureMicrographs(
    summary,
  )}<div class="pf-arrow">↓</div>${roundHtml}</div>`;
}

/* ================================================================== */
/*  V2 right-pane per-job card                                         */
/* ================================================================== */

/** A single right-pane per-job card. */
export function reportJobCard(
  node: LineageNode,
  summary: LineageSummary,
  state: LineageReportState,
): string {
  const kind = reportNodeCardKind(node);
  const chips: string[] = [];
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) {
    chips.push(`<span class="chip micrograph">照片: ${fmt(node.micrograph_count)}</span>`);
  }
  if (node.particle_count !== null && node.particle_count !== undefined) {
    chips.push(`<span class="chip particle">颗粒: ${fmt(node.particle_count)}</span>`);
  }
  if (node.volume_count !== null && node.volume_count !== undefined) {
    chips.push(`<span class="chip volume">volume: ${fmt(node.volume_count)}</span>`);
  }
  const res = resolutionText(node);
  if (res) chips.push(`<span class="chip volume">resolution: ${escHtml(res)}</span>`);
  const extractParams = extractionParamText(node);
  if (extractParams) chips.push(`<span class="chip aux">${escHtml(extractParams)}</span>`);
  const main = `<div class="job-main"><div class="job-head"><h2>${escHtml(
    node.uid,
  )} ${escHtml(node.job_type || "")}</h2><div class="metrics">${chips.join(
    "",
  )}</div></div>${reportSourceTable(node, summary, state)}${reportMediaBlock(
    node,
  )}${reportClassTable(node, summary)}${reportMapDownloads(node, summary)}</div>`;
  return `<section class="job-card ${escHtml(kind)}" id="card-${escHtml(
    node.uid,
  )}">${main}${reportOutgoingBox(node, summary, state)}</section>`;
}

/* ================================================================== */
/*  V2 main entry point                                                */
/* ================================================================== */

/** Inline `<style>` block (verbatim from popup.js — single CSS string). */
const REPORT_HTML_V2_CSS = `:root{--bg:#f6f8fb;--panel:#fff;--text:#17202e;--muted:#59687d;--line:#d6e0ec;--micro:#16a05d;--micro-bg:#e9fbef;--particle:#d99300;--particle-bg:#fff5d8;--volume:#4d64e8;--volume-bg:#edf1ff;--small-bg:#f4f7fa}*{box-sizing:border-box;font-family:"Times New Roman",Times,serif}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.35 "Times New Roman",Times,serif}a{color:#086ad8;text-decoration:none}header{position:sticky;top:0;z-index:5;background:rgba(246,248,251,.95);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}.top{min-height:58px;display:flex;align-items:center;gap:16px;padding:8px 14px}.title h1{margin:0;font-size:19px}.title p{margin:1px 0 0;color:var(--muted)}.workspace{display:grid;grid-template-columns:minmax(460px,34vw) minmax(780px,1fr);gap:10px;padding:10px;align-items:start}.pane{background:var(--panel);border:1px solid var(--line);border-radius:8px}.flow-pane{position:sticky;top:72px;max-height:calc(100vh - 82px);overflow:auto}.pane-head,.chain-head{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line)}.pane-head h2,.chain-head h2{margin:0;font-size:16px}.legend{display:flex;gap:5px;margin-left:auto}.legend span{padding:2px 7px;border-radius:999px;font-size:11px;border:1px solid}.legend .micrograph{color:#087a42;background:var(--micro-bg);border-color:#8ee6af}.legend .particle{color:#8a5a00;background:var(--particle-bg);border-color:#f0c56b}.legend .volume{color:#293faf;background:var(--volume-bg);border-color:#aebaff}.outline{padding:10px}.stage{border:1px solid #dde7f1;border-radius:8px;background:#fbfdff;padding:8px;margin-bottom:8px}.stage h3{margin:0 0 6px;font-size:12px;color:#526174}.phase{display:grid;grid-template-columns:86px minmax(0,1fr);gap:7px;align-items:start;border-top:1px solid #edf2f7;padding-top:7px;margin-top:7px}.phase:first-of-type{border-top:0;padding-top:0;margin-top:0}.phase-label{font-size:11px;font-weight:800;color:#536174;line-height:1.2;padding-top:4px}.stage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:7px}.mini-node{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:6px;align-items:start;border:2px solid #cbd7e6;border-radius:7px;background:white;padding:6px;min-height:64px;color:#142033}.mini-node.micrograph{border-color:var(--micro);background:var(--micro-bg)}.mini-node.particle{border-color:var(--particle);background:var(--particle-bg)}.mini-node.volume{border-color:var(--volume);background:var(--volume-bg)}.mini-node.small,.mini-node.other{border-color:#c9d4e2;background:var(--small-bg)}.mini-node b{font-size:15px;display:block;grid-column:1}.mini-node span{font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:1}.mini-node em{font-style:normal;font-size:10px;color:#46566c;display:block;grid-column:1}.mini-node p{grid-column:2;grid-row:1 / span 3;margin:0;display:grid;grid-template-columns:repeat(2,max-content);justify-content:end;align-content:start;gap:2px 3px;min-width:54px}.ref-pill{display:block;border-radius:4px;padding:1px 3px;min-width:24px;text-align:center;font-size:8px;line-height:1.15;font-style:normal;font-weight:800;border:1px solid;white-space:nowrap}.ref-pill.exposure,.ref-pill.micrograph{color:#087a42;background:#dcfce7;border-color:#86efac}.ref-pill.particle{color:#8a5a00;background:#fff3c4;border-color:#f0c56b}.ref-pill.volume{color:#293faf;background:#e8edff;border-color:#aebaff}.ref-pill.template,.ref-pill.other{color:#526174;background:#eef2f7;border-color:#cbd5e1}.stage-arrow{text-align:center;color:#8491a3;font-weight:800;font-size:18px;margin:-3px 0 5px}.picture-flow{margin:10px;border:1px solid #dde7f1;border-radius:8px;background:#fff;padding:10px}.picture-head{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #eee6d8;padding-bottom:6px;margin-bottom:8px}.picture-head h2{margin:0;font-size:15px}.picture-head span{font-size:11px;color:#6b7280}.pf-start,.pf-round,.pf-step,.pf-map-job,.pf-final{background:#fff;border:1px solid #e2e8f0;border-radius:7px;padding:8px;margin:0 0 8px}.pf-big{font-size:19px;color:#111;text-align:center}.pf-note{font-size:11px;color:#475569;line-height:1.35;text-align:center}.pf-mic-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:7px 0}.pf-mic-imgs img{width:100%;aspect-ratio:4/3;object-fit:contain;border:1px solid #d6dee9;background:#fff}.pf-arrow{text-align:center;font-size:20px;line-height:1;color:#222;margin:3px 0 7px}.pf-round-head h3{margin:0 0 7px;font-size:20px}.pf-subhead{font-size:12px;font-weight:800;text-align:center;margin:0 0 5px;color:#263447}.pf-particle-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:7px;margin-bottom:8px}.pf-particle-step{display:block;border:1px solid #e2e8f0;border-left:3px solid var(--particle);border-radius:7px;background:#fffaf0;padding:6px;color:#142033}.pf-particle-step b{display:block;font-size:13px}.pf-particle-step span{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pf-particle-step em{display:block;font-style:normal;font-size:11px;color:#475569}.pf-step-title{font-weight:800;font-size:13px;text-align:center;margin-bottom:3px}.pf-select-img img{display:block;width:100%;max-height:170px;object-fit:contain;border:1px solid #dbe5f0;background:#fff;margin-top:6px}.pf-classes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:7px}.pf-class{margin:0;padding:5px;border:2px solid transparent;background:#fff;text-align:center;min-height:126px}.pf-class.selected{border-color:#111}.pf-class img{display:block;width:100%;height:78px;object-fit:contain;background:#fff}.pf-class figcaption{font-size:10px;color:#334155}.pf-class b{display:block;font-size:15px;color:#111}.pf-class span{display:block;font-size:10px;color:#526174}.pf-final-img img{display:block;width:180px;max-width:100%;height:150px;object-fit:contain;border:1px solid #dbe5f0;background:#fff;margin:6px auto}.chain-head .hint{color:var(--muted);margin-left:auto}.cards{padding:10px;display:grid;gap:18px}.job-card{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:10px;border:1px solid var(--line);border-left-width:4px;border-radius:7px;background:#fff;padding:10px}.job-card.micrograph{border-left-color:var(--micro)}.job-card.particle{border-left-color:var(--particle)}.job-card.volume{border-left-color:var(--volume)}.job-card.other{border-left-color:#94a3b8}.job-head{display:flex;align-items:center;gap:10px}.job-head h2{margin:0;min-width:210px;font-size:17px;line-height:1.1}.metrics{display:flex;flex-wrap:wrap;gap:5px}.chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;border:1px solid var(--line);background:#f8fbff;font-size:12px;white-space:nowrap}.chip.micrograph{background:var(--micro-bg);border-color:#8ee6af;color:#087a42}.chip.particle{background:var(--particle-bg);border-color:#f0c56b;color:#8a5a00}.chip.volume,.chip.class{background:var(--volume-bg);border-color:#aebaff;color:#293faf}.chip.aux{background:#f8fafc;border-color:#cbd5e1;color:#334155}.source-block,.media-block,.map-block{margin-top:8px;border-top:1px solid #edf2f7;padding-top:7px}h3{margin:0 0 4px;font-size:12px;color:#263447}.source-table{width:100%;border-collapse:collapse;font-size:11px}.source-table th,.source-table td{border:1px solid #e3ebf4;padding:4px 6px;vertical-align:middle}.source-table th{background:#f8fafc;color:#526174}.kind-cell{width:54px;text-align:center;font-weight:800}.kind-cell i{width:8px;height:8px;border-radius:999px;display:inline-block;margin-right:4px}.kind-cell.exposure i{background:var(--micro)}.kind-cell.particle i{background:var(--particle)}.kind-cell.volume i{background:var(--volume)}.kind-cell.template i,.kind-cell.other i{background:#8793a6}.source-table em{font-style:normal;color:#607086;margin-left:6px}.up-cell{color:#475569;line-height:1.35}.up-route{display:block;font-weight:800;color:#263447;border-bottom:2px solid #9aa8ba;margin-bottom:3px;padding-bottom:2px}.up-list{display:grid;gap:2px}.up-line{display:block}.job-out{border-left:1px solid #edf2f7;padding-left:8px;color:#334155}.job-out div{margin:0 0 5px;padding:4px 6px;background:#f8fafc;border:1px solid #e1e9f2;border-radius:6px}.quiet{color:#7b8798}.class-toolbar{margin-top:7px;display:flex;align-items:center;gap:5px}.class-toolbar span{font-weight:700;font-size:12px;color:#263447;margin-right:auto}.classes{margin-top:5px;border:1px solid #dbe5f0;border-radius:6px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:5px 6px;border-bottom:1px solid #e7edf5;text-align:left}th{background:#f8fafc}.horizontal-table th:first-child{left:0;position:sticky;z-index:2}.horizontal-table td,.horizontal-table th{min-width:74px;text-align:center}.download-head{display:flex;align-items:center;gap:8px;margin-top:6px}.download-all{border:1px solid #cbd7e6;background:#fff;color:#40516a;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer}.download-links{margin-top:5px;display:flex;gap:5px;flex-wrap:wrap}.download-links a{padding:3px 6px;border:1px solid #b7c5ff;border-radius:6px;background:#f1f4ff;font-size:11px}.imgs{display:flex;gap:8px;flex-wrap:wrap}.imgbox{width:160px;margin:0;padding:6px;border:1px solid #dbe5f0;border-radius:6px;background:#fbfdff}.imgbox img{display:block;width:100%;height:112px;object-fit:contain;background:#fff;border:1px solid #edf2f7}.imgbox figcaption{margin-top:4px;font-size:11px;color:#536174}.class-preview,.map-preview{max-width:92px;max-height:68px;object-fit:contain;border:1px solid #dbe5f0;background:#fff}.map-table td{vertical-align:middle}@media(max-width:1180px){.workspace{grid-template-columns:1fr}.flow-pane{position:relative;top:auto}.job-card{grid-template-columns:minmax(0,1fr) 230px}}`;

/**
 * Inline `<script>` click handler — `.download-all` buttons stagger
 * `window.open` per URL with 160ms delay. Embedded as a string so the
 * final HTML page is fully standalone.
 */
const REPORT_HTML_V2_SCRIPT = `document.addEventListener("click",(event)=>{const button=event.target.closest(".download-all");if(!button)return;const urls=(button.dataset.urls||"").split("|").filter(Boolean);urls.forEach((url,index)=>setTimeout(()=>window.open(url,"_blank"),index*160));});`;

/**
 * Build the V2 lineage report — a standalone HTML page with a left outline
 * (stages / phases / mini-nodes) + picture flow, and a right column of
 * per-job cards.
 *
 * The returned string is a complete `<!doctype html>` document. It can be
 * written to disk, opened directly in a browser, served from a Next.js
 * route, or embedded in a Blob for download.
 */
export function buildLineageHtmlV2(summary: LineageSummary): string {
  const state = reportBuildLineageState(summary);
  const cards = (summary.nodes || [])
    .slice()
    .sort((a, b) => uidOrder(a) - uidOrder(b))
    .map((node) => reportJobCard(node, summary, state))
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CryoSmart ${escHtml(
    summary.project_uid,
  )} ${escHtml(summary.start_uid)} Lineage</title><style>${REPORT_HTML_V2_CSS}</style></head><body><header><div class="top"><div class="title"><h1>CryoSmart Lineage: ${escHtml(
    summary.project_uid,
  )} / ${escHtml(summary.start_uid)}</h1><p>${(summary.nodes || []).length} nodes · ${
    (summary.edges || []).length
  } data links · visible main-node tracing</p></div></div></header><main class="workspace"><section class="pane flow-pane"><div class="pane-head"><h2>Lineage Outline</h2><div class="legend"><span class="micrograph">micrographs</span><span class="particle">particles</span><span class="volume">map</span></div></div><div class="outline">${reportOutline(
    summary,
    state,
  )}</div>${reportPictureFlow(summary, state)}</section><section class="pane chain-pane"><div class="chain-head"><h2>Main Data Chain</h2><span class="hint">小节点会折叠到可见主节点；左侧标签只指向左侧已有节点。</span></div><div class="cards">${cards}</div></section></main><script>${REPORT_HTML_V2_SCRIPT}</script></body></html>`;
}

/** @internal Exported only for testing of the inline script string. */
export const _REPORT_HTML_V2_CSS = REPORT_HTML_V2_CSS;
/** @internal Exported only for testing of the inline script string. */
export const _REPORT_HTML_V2_SCRIPT = REPORT_HTML_V2_SCRIPT;
