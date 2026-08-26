/**
 * A4-portrait SVG report builder for the CryoSmart lineage "Picture Flow".
 *
 * Ported verbatim from `CryoSmartLineageTracer_3.0/popup.js`:
 *   - `buildPictureFlowSvg(summary, imageDataMap)`
 *   - SVG helpers: `svgText`, `svgArrow`, `svgImageHref`, `svgClassGrid`,
 *     `svgParticleStepBlock`
 *
 * The original JS inlines all fonts/CSS (the SVG has no external stylesheet)
 * and renders to a 794×1123 canvas (A4 at ~96dpi) that scales down to fit
 * one A4 page. This TS port preserves that behavior byte-for-byte.
 *
 * Image embedding: when `imageDataMap` is supplied, image `href`s become
 * `data:` URIs (so the SVG is fully self-contained). When `imageDataMap`
 * is `null` (the default — used by `downloadBtn` in popup.js), each
 * `href` falls back to the relative path `images/<uid>/<name>.png` that
 * the bundled download lays out on disk.
 *
 * All `report*` / `html*` helpers that `buildPictureFlowSvg` calls are
 * defined locally with `// duplicated` comments. They mirror the versions
 * in `./lineage.ts`; once that module exports them, these copies can be
 * removed in favor of imports.
 */

import type {
  ClassSplit,
  ClassSplitJob,
  LineageEdge,
  LineageNode,
  LineageReportState,
  LineageSummary,
  MapAsset,
  NormalizedLineageEdge,
} from "./types";
import {
  MAJOR_JOB_TYPES,
  PARTICLE_AUX_JOB_TYPES,
  PICKING_JOB_TYPES,
  REPICK_PARTICLE_PRODUCER_TYPES,
  REPICK_SETUP_JOB_TYPES,
  SVG_A4_CENTER_X,
  SVG_A4_HEIGHT,
  SVG_A4_WIDTH,
} from "./constants";

/* ================================================================== */
/* Local helpers — duplicated from `./lineage.ts`                     */
/* ================================================================== */

/** Escape HTML/XML special characters in a string. */
function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format an integer with thousands separators; pass strings through escaped. */
function fmt(value: unknown): string {
  return Number.isInteger(value)
    ? (value as number).toLocaleString("en-US")
    : escHtml(value);
}

/** Pull a numeric job index out of a uid like `J427`. */
function reportJobNum(uid: string | null | undefined): number {
  const match = String(uid || "").match(/J(\d+)/i);
  return match ? Number(match[1]) : 0;
}

/** Map of uid → node, used by many `report*` helpers. */
function summaryNodeMap(summary: LineageSummary): Map<string, LineageNode> {
  return new Map((summary.nodes || []).map((node) => [node.uid, node]));
}

/** Sanitize a value for use as a filename path segment. */
function safePart(value: unknown): string {
  return String(value || "item")
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

/** Relative path used for an image file inside the downloaded bundle. */
function localImageFilename(nodeUid: string, name: string): string {
  return `images/${safePart(nodeUid)}/${safePart(name)}.png`;
}

/** Stable key for a (uid, name) image — used by the PPTX and SVG flows. */
function pptImageKey(nodeUid: string, name: string): string {
  return `${safePart(nodeUid)}/${safePart(name)}`;
}

/** Extract the numeric class index from a group name like `class_2`. */
function parseClassIndex(name: string | null | undefined): number | null {
  const match = String(name || "").match(/class[_-](\d+)/);
  return match ? Number(match[1]) : null;
}

/** Choose the image-name segment for a map preview group (`volume.map` → `volume`). */
function mapPreviewImageName(group: string | null | undefined): string {
  const value = String(group || "volume");
  if (/^(volume|map)$/i.test(value)) return "volume";
  return value.replace(/\.map$/i, "");
}

/* ------------------------------------------------------------------ */
/* Pixel / resolution / extraction formatting                          */
/* ------------------------------------------------------------------ */

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

function pixelSizeText(node: LineageNode | null | undefined): string {
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

function resolutionText(node: LineageNode | null | undefined): string {
  const value = node && resolutionNumber(node.resolution_A);
  return value ? `${formatBinFactor(value)} Å` : "";
}

function extractionBinText(node: LineageNode | null | undefined): string {
  const p = node && node.extraction_params;
  if (!p || !p.bin_factor) return "";
  return `bin ${formatBinFactor(p.bin_factor)}`;
}

/* ------------------------------------------------------------------ */
/* Edge kind / family helpers                                          */
/* ------------------------------------------------------------------ */

function edgeKind(edge: LineageEdge): string {
  if (["particle", "volume", "mask", "template", "exposure"].includes(edge.input_type)) {
    return edge.input_type;
  }
  const types = (edge.slots || []).map((slot) => slot.result_type || "").join(" ");
  for (const kind of ["particle", "volume", "mask", "template", "exposure"]) {
    if (types.includes(kind)) return kind;
  }
  return edge.input_type || "parent";
}

function summaryKind(edge: LineageEdge): string {
  if (edge.kind) return edge.kind;
  if (edge.input_type) return edgeKind({ ...edge, slots: edge.slots || [] });
  if (Array.isArray(edge.kinds) && edge.kinds.length) return edge.kinds[0];
  return "parent";
}

function reportEdgeKind(edge: LineageEdge): string {
  return summaryKind(edge);
}

function reportKindFamily(kind: string): string {
  if (kind === "mask") return "volume";
  if (kind === "exposure") return "exposure";
  if (kind === "particle") return "particle";
  if (kind === "volume") return "volume";
  if (kind === "template" || kind === "ml_model" || kind === "model") return "template";
  return kind || "other";
}

function htmlGroupLabel(edge: LineageEdge): string {
  return edge.source_group || edge.input_name || "";
}

/* ------------------------------------------------------------------ */
/* Node-kind predicates                                               */
/* ------------------------------------------------------------------ */

function reportIsPickingNode(node: LineageNode | null | undefined): boolean {
  return PICKING_JOB_TYPES.has((node && node.job_type) as string);
}

function reportIsRepickParticleProducer(
  node: LineageNode | null | undefined,
): boolean {
  return Boolean(
    node &&
      REPICK_PARTICLE_PRODUCER_TYPES.has(node.job_type) &&
      node.particle_count !== null &&
      node.particle_count !== undefined,
  );
}

function reportIsRepickSetupNode(node: LineageNode | null | undefined): boolean {
  return REPICK_SETUP_JOB_TYPES.has((node && node.job_type) as string);
}

function reportIsParticleAuxNode(node: LineageNode | null | undefined): boolean {
  return PARTICLE_AUX_JOB_TYPES.has((node && node.job_type) as string);
}

function reportIsVolumeSourceNode(node: LineageNode | null | undefined): boolean {
  const type = (node && node.job_type) || "";
  return Boolean(
    node &&
      ((node.volume_count !== null && node.volume_count !== undefined) ||
        /homo_abinit|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|volume|map|align_3D|homo_reconstruct|sym_expand|particle_subtract/i.test(
          type,
        )),
  );
}

function reportIsParticlePipelineNode(node: LineageNode | null | undefined): boolean {
  const type = (node && node.job_type) || "";
  return /import_particles|picker|topaz|extract_micrographs|remove_duplicate|particle_sets|downsample|standardize_particle|check_corrupt|reassign_particles/i.test(
    type,
  );
}

function reportIsSelect2DNode(node: LineageNode | null | undefined): boolean {
  return Boolean(
    node && (node.select_2d || /select_2D/i.test(node.job_type || "")),
  );
}

function reportIsPostMapExtraction(
  node: LineageNode | null | undefined,
  state: LineageReportState,
): boolean {
  if (!node || !/extract_micrographs/i.test(node.job_type || "")) return false;
  const incoming = state.incomingByTarget.get(node.uid) || [];
  return incoming.some((edge) => {
    const source = state.nodeMap.get(edge.source);
    return (
      /class_\d+/i.test(edge.group || "") ||
      edge.family === "volume" ||
      reportIsVolumeSourceNode(source)
    );
  });
}

/* ------------------------------------------------------------------ */
/* Lineage round computation                                          */
/* ------------------------------------------------------------------ */

interface LineageRoundState {
  nodeMap: Map<string, LineageNode>;
  incomingByTarget: Map<string, NormalizedLineageEdge[]>;
  outgoingBySource: Map<string, NormalizedLineageEdge[]>;
  roundMemo: Map<string, number>;
  repickSeedMemo: Map<string, boolean>;
}

function reportHasRepickSeed(
  uid: string,
  state: LineageRoundState,
  visited: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!uid || visited.has(uid) || depth > 8) return false;
  if (state.repickSeedMemo.has(uid)) return state.repickSeedMemo.get(uid) as boolean;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  const finish = (value: boolean): boolean => {
    state.repickSeedMemo.set(uid, value);
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
      if (reportHasRepickSeed(edge.source, state, new Set(visited), depth + 1)) {
        return finish(true);
      }
    }
  }
  return finish(false);
}

function reportFeedsVolumeMainline(
  uid: string,
  state: LineageRoundState,
  visited: Set<string> = new Set(),
  depth = 0,
): boolean {
  if (!uid || visited.has(uid) || depth > 10) return false;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  if (depth > 0 && reportIsVolumeSourceNode(node)) return true;
  const outgoing = state.outgoingBySource.get(uid) || [];
  for (const edge of outgoing) {
    const target = state.nodeMap.get(edge.target);
    if (!target) continue;
    if (
      edge.family === "particle" ||
      edge.family === "volume" ||
      edge.family === "template" ||
      /model/i.test(edge.kind || "")
    ) {
      if (reportFeedsVolumeMainline(edge.target, state, new Set(visited), depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function reportRepickSeedSourceRounds(
  incoming: NormalizedLineageEdge[],
  state: LineageRoundState,
  visited: Set<string>,
): number[] {
  return incoming
    .map((edge) => {
      const sourceNode = state.nodeMap.get(edge.source);
      const directSeed =
        edge.family === "volume" ||
        edge.kind === "mask" ||
        (edge.family === "particle" && reportIsVolumeSourceNode(sourceNode));
      const inheritedSeed =
        reportIsRepickSetupNode(sourceNode) && reportHasRepickSeed(edge.source, state);
      if (!directSeed && !inheritedSeed) return null;
      return reportLineageRound(edge.source, state, new Set(visited));
    })
    .filter((value): value is number => Number.isInteger(value));
}

function reportMaxRoundFromEdges(
  edges: NormalizedLineageEdge[],
  state: LineageRoundState,
  visited: Set<string>,
): number {
  const rounds = edges.map((edge) =>
    reportLineageRound(edge.source, state, new Set(visited)),
  );
  return rounds.length ? Math.max(...rounds) : 0;
}

function reportParticleSourceRound(
  incoming: NormalizedLineageEdge[],
  state: LineageRoundState,
  visited: Set<string>,
): number | null {
  const particleIncoming = incoming.filter((edge) => edge.family === "particle");
  return particleIncoming.length
    ? reportMaxRoundFromEdges(particleIncoming, state, visited)
    : null;
}

function reportLineageRound(
  uid: string,
  state: LineageRoundState,
  visited: Set<string> = new Set(),
): number {
  if (!uid || visited.has(uid)) return 0;
  if (state.roundMemo.has(uid)) return state.roundMemo.get(uid) as number;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return 0;
  const type = node.job_type || "";
  const finish = (value: number): number => {
    state.roundMemo.set(uid, value);
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
    return finish(
      Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1),
    );
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
    return finish(
      Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1),
    );
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

/* ------------------------------------------------------------------ */
/* Report-state construction (mirrors `reportBuildLineageState`)       */
/* ------------------------------------------------------------------ */

const REPORT_NORMALIZED_EDGES_CACHE = new WeakMap<
  LineageSummary,
  NormalizedLineageEdge[]
>();

function reportNormalizedEdges(summary: LineageSummary): NormalizedLineageEdge[] {
  if (REPORT_NORMALIZED_EDGES_CACHE.has(summary)) {
    return REPORT_NORMALIZED_EDGES_CACHE.get(summary) as NormalizedLineageEdge[];
  }
  const edges: NormalizedLineageEdge[] = (summary.edges || []).map((edge) => {
    const kind = reportEdgeKind(edge);
    return {
      ...edge,
      kind,
      family: reportKindFamily(kind) as NormalizedLineageEdge["family"],
      group: htmlGroupLabel(edge),
    } as NormalizedLineageEdge;
  });
  REPORT_NORMALIZED_EDGES_CACHE.set(summary, edges);
  return edges;
}

function reportNodeIsMajor(node: LineageNode, summary: LineageSummary): boolean {
  const type = node.job_type || "";
  if (node.uid === summary.start_uid) return true;
  if (MAJOR_JOB_TYPES.has(type)) return true;
  if (/local_refine|topaz_train|topaz_extract/i.test(type)) return true;
  if (node.particle_count !== null && node.particle_count !== undefined) return true;
  if (node.volume_count !== null && node.volume_count !== undefined) return true;
  return false;
}

function reportVisibleOutlineNodes(
  summary: LineageSummary,
  nodeMap: Map<string, LineageNode>,
): LineageNode[] {
  return (summary.nodes || [])
    .filter((node) => reportNodeIsMajor(node, summary))
    .sort(
      (a, b) =>
        (a.uid_num || reportJobNum(a.uid)) - (b.uid_num || reportJobNum(b.uid)),
    );
}

function reportBuildLineageState(summary: LineageSummary): LineageReportState {
  const nodeMap = summaryNodeMap(summary);
  const edges = reportNormalizedEdges(summary);
  const incomingByTarget = new Map<string, NormalizedLineageEdge[]>();
  const outgoingBySource = new Map<string, NormalizedLineageEdge[]>();
  for (const edge of edges) {
    if (!incomingByTarget.has(edge.target)) {
      incomingByTarget.set(edge.target, []);
    }
    incomingByTarget.get(edge.target)!.push(edge);
    if (!outgoingBySource.has(edge.source)) {
      outgoingBySource.set(edge.source, []);
    }
    outgoingBySource.get(edge.source)!.push(edge);
  }
  // The original code attaches a per-instance trace memo to the Map.
  (incomingByTarget as unknown as { __traceVisibleMemo?: Map<string, string[]> }).__traceVisibleMemo = new Map();
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

/* ------------------------------------------------------------------ */
/* Round / particle-node selectors                                     */
/* ------------------------------------------------------------------ */

function reportRoundNodes(
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

function reportHasUpstreamSelectInSameRound(
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
      if (
        reportHasUpstreamSelectInSameRound(source.uid, state, round, new Set(visited), depth + 1)
      ) {
        return true;
      }
    }
  }
  return false;
}

function reportRoundParticleNodes(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
  postSelect: boolean | null = null,
): LineageNode[] {
  return reportRoundNodes(summary, state, round, reportIsParticlePipelineNode).filter(
    (node) => {
      if (postSelect === null) return true;
      return reportHasUpstreamSelectInSameRound(node.uid, state, round) === postSelect;
    },
  );
}

function reportFirstMicrographNode(summary: LineageSummary): LineageNode | undefined {
  return (
    (summary.nodes || []).find(
      (node) => node.job_type === "import_micrographs" && node.micrograph_count !== null,
    ) || (summary.nodes || []).find((node) => /micrograph/i.test(node.job_type || ""))
  );
}

function reportSelectedClassIndices(
  nodeUid: string,
  _summary: LineageSummary,
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

/* ------------------------------------------------------------------ */
/* Map / metric helpers                                               */
/* ------------------------------------------------------------------ */

/** Filter a node's `maps` to the normal (non-mask) map files. Includes
 *  every non-mask volume blob — sharp maps and half maps included (see
 *  the canonical copy in lineage.ts for the full rationale). */
function normalMapAssets(node: LineageNode): MapAsset[] {
  return (node.maps || []).filter((item) => {
    const group = String(item.group || "");
    const result = String(item.result_name || "");
    const volumeGroup = item.group_type ? item.group_type === "volume" : !/mask/i.test(group);
    const isMask = /mask/i.test(group) || /mask/i.test(result);
    return volumeGroup && !isMask;
  });
}

function reportMetricText(node: LineageNode, compact = false): string {
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
  return compact ? parts.join(" · ") : parts.join(" · ");
}

function reportPictureParticleMetricText(node: LineageNode): string {
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
/* SVG primitives                                                     */
/* ================================================================== */

/**
 * Render a `<text>` element with the project's house font (Times New Roman).
 * `anchor` is one of `"start" | "middle" | "end"` (default `"middle"`).
 */
function svgText(
  x: number,
  y: number,
  text: unknown,
  size = 13,
  weight = 400,
  anchor: "start" | "middle" | "end" = "middle",
): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Times New Roman, Times, serif" font-size="${size}" font-weight="${weight}" fill="#172033">${escHtml(text)}</text>`;
}

/** Render a centered vertical arrow from `y1` to `y2` with an optional label. */
function svgArrow(y1: number, y2: number, label = ""): string {
  const labelText = label ? svgText(SVG_A4_CENTER_X, y1 + 22, label, 12, 600) : "";
  return `<line x1="${SVG_A4_CENTER_X}" y1="${y1}" x2="${SVG_A4_CENTER_X}" y2="${y2 - 12}" stroke="#222" stroke-width="2"/><path d="M${SVG_A4_CENTER_X} ${y2} l-8 -13 h16 z" fill="#222"/>${labelText}`;
}

/**
 * Resolve the `href` for an image: if `imageDataMap` contains an inline
 * data URI for this (uid, name) pair, return it; otherwise fall back to
 * the relative on-disk path that the bundled download lays out.
 */
function svgImageHref(
  nodeUid: string,
  name: string,
  imageDataMap: Map<string, string> | null,
): string {
  const key = pptImageKey(nodeUid, name);
  if (imageDataMap && imageDataMap.has(key)) return escHtml(imageDataMap.get(key));
  return escHtml(localImageFilename(nodeUid, name));
}

/* ================================================================== */
/* SVG block renderers (mirrors popup.js)                             */
/* ================================================================== */

interface SvgBlock {
  svg: string;
  height: number;
}

/** Render a grid of class tiles for an `abinit` / `hetero` / `class_3D` node. */
function svgClassGrid(
  node: LineageNode,
  classJob: ClassSplitJob,
  selected: Set<number>,
  startY: number,
  imageDataMap: Map<string, string> | null,
): SvgBlock {
  let out = "";
  const classCount = classJob.classes.length;
  const cols = classCount <= 6 ? classCount : 3;
  const tileW = classCount <= 6 ? 104 : 176;
  const tileH = classCount <= 6 ? 118 : 132;
  const gapX = classCount <= 6 ? 12 : 22;
  const gapY = 20;
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  for (let i = 0; i < classJob.classes.length; i += 1) {
    const cls: ClassSplit = classJob.classes[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = left + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const name = cls.volume_group || `class_${cls.class_index}`;
    const isSelected = selected.has(cls.class_index);
    out += `<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="0" fill="#fff" stroke="${isSelected ? "#111" : "transparent"}" stroke-width="${isSelected ? 3 : 1}"/>`;
    out += `<image href="${svgImageHref(node.uid, name, imageDataMap)}" x="${x + 12}" y="${y + 6}" width="${tileW - 24}" height="${classCount <= 6 ? 56 : 74}" preserveAspectRatio="xMidYMid meet"/>`;
    out += svgText(
      x + tileW / 2,
      y + (classCount <= 6 ? 76 : 94),
      `class ${cls.class_index}${isSelected ? " selected" : ""}`,
      11,
      500,
    );
    const pct =
      cls.particle_percent !== null && cls.particle_percent !== undefined
        ? `${cls.particle_percent}%`
        : "";
    const count =
      cls.particle_count !== null && cls.particle_count !== undefined
        ? `${fmt(cls.particle_count)} particles`
        : "";
    out += svgText(x + tileW / 2, y + (classCount <= 6 ? 94 : 114), pct, 17, 500);
    out += svgText(x + tileW / 2, y + (classCount <= 6 ? 108 : 128), count, 10, 400);
  }
  const rows = Math.ceil(classJob.classes.length / cols);
  return { svg: out, height: rows * tileH + Math.max(0, rows - 1) * gapY };
}

/** Render the per-round "picking / extraction" step grid (yellow cards). */
function svgParticleStepBlock(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
  label: string,
  postSelect: boolean | null,
  startY: number,
): SvgBlock {
  const nodes = reportRoundParticleNodes(summary, state, round, postSelect);
  if (!nodes.length) return { svg: "", height: 0 };
  let out = svgText(SVG_A4_CENTER_X, startY, label, 14, 700);
  const cols = Math.min(3, nodes.length);
  const gap = 12;
  const cardW = (SVG_A4_WIDTH - 96 - Math.max(0, cols - 1) * gap) / cols;
  const cardH = 56;
  const gridW = cols * cardW + Math.max(0, cols - 1) * gap;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  const y0 = startY + 16;
  nodes.slice(0, 12).forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = left + col * (cardW + gap);
    const y = y0 + row * (cardH + 10);
    const metric = reportPictureParticleMetricText(node);
    out += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="6" fill="#fffaf0" stroke="#d99300" stroke-width="1.6"/>`;
    out += svgText(x + cardW / 2, y + 18, `${node.uid} ${node.job_type || ""}`, 11, 700);
    if (metric) out += svgText(x + cardW / 2, y + 37, metric, 10, 400);
  });
  const rows = Math.ceil(Math.min(nodes.length, 12) / cols);
  return { svg: out, height: 16 + rows * cardH + Math.max(0, rows - 1) * 10 };
}

/* ================================================================== */
/* Main entry point                                                   */
/* ================================================================== */

/**
 * Build the A4-portrait "Picture Flow" SVG for a lineage summary.
 *
 * @param summary       The full lineage summary produced by `buildSummary`.
 * @param imageDataMap  Optional map of `pptImageKey(uid, name)` → data URI
 *                       for inline-embedding images. When omitted (the
 *                       default — used by `downloadBtn` in popup.js), image
 *                       `href`s fall back to relative on-disk paths.
 * @returns A self-contained SVG document string (210mm × 297mm viewBox).
 */
export function buildPictureFlowSvg(
  summary: LineageSummary,
  imageDataMap: Map<string, string> | null = null,
): string {
  const state = reportBuildLineageState(summary);
  const width = SVG_A4_WIDTH;
  let y = 34;
  let body = "";
  body += svgText(
    width / 2,
    y,
    `CryoSmart ${summary.project_uid}/${summary.start_uid} Picture Flow`,
    20,
    700,
  );
  y += 28;

  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    body += svgText(width / 2, y, `${fmt(microNode.micrograph_count)} micrographs`, 20, 500);
    y += 12;
    if (pixelSizeText(microNode)) {
      body += svgText(width / 2, y, `pixel ${pixelSizeText(microNode)}`, 11, 400);
      y += 14;
    }
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 118;
    const startX =
      width / 2 -
      (imgs.length * imgW + Math.max(0, imgs.length - 1) * 12) / 2;
    for (let i = 0; i < imgs.length; i += 1) {
      body += `<image href="${svgImageHref(microNode.uid, imgs[i].name || "image", imageDataMap)}" x="${startX + i * (imgW + 12)}" y="${y}" width="${imgW}" height="${imgW}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    y += imgs.length ? imgW + 24 : 20;
    body += svgText(width / 2, y, `${microNode.uid} ${microNode.job_type}`, 12, 500);
    y += 18;
  }

  const rounds = Array.from(
    new Set(
      (summary.nodes || [])
        .map((node) => reportLineageRound(node.uid, state))
        .filter((round) => round > 0),
    ),
  ).sort((a, b) => a - b);

  for (const round of rounds) {
    body += svgArrow(y, y + 46, round > 1 ? `Round ${round} repicking` : `Round ${round}`);
    y += 70;
    body += svgText(width / 2, y, `Round ${round}${round > 1 ? " repicking" : ""}`, 21, 600);
    y += 24;

    const selectNodes = reportRoundNodes(summary, state, round, (node) => Boolean(node.select_2d));
    const preParticleBlock = svgParticleStepBlock(
      summary,
      state,
      round,
      "Picking / extraction",
      selectNodes.length ? false : null,
      y,
    );
    if (preParticleBlock.svg) {
      body += preParticleBlock.svg;
      y += preParticleBlock.height + 18;
      body += svgArrow(y, y + 42, "");
      y += 62;
    }
    for (const node of selectNodes) {
      const s = node.select_2d!;
      const input = node.particle_count ?? s.particles_selected ?? null;
      const selected = s.particles_selected;
      const ratio =
        typeof input === "number" && typeof selected === "number" && input > 0
          ? `${Math.round((selected / input) * 1000) / 10}%`
          : "";
      body += svgText(width / 2, y, `${node.uid} select_2D`, 15, 700);
      y += 18;
      body += svgText(
        width / 2,
        y,
        `input ${input ? fmt(input) : "?"} particles; selected ${s.classes_selected ?? "?"} classes; output ${selected ? fmt(selected) : "?"}${ratio ? ` (${ratio})` : ""}`,
        12,
        400,
      );
      y += 10;
      if (s.selected_classes_image) {
        body += `<image href="${svgImageHref(node.uid, "selected_classes", imageDataMap)}" x="${(width - 360) / 2}" y="${y}" width="360" height="150" preserveAspectRatio="xMidYMid meet"/>`;
        y += 166;
      } else {
        y += 12;
      }
      body += svgArrow(y, y + 42, "");
      y += 62;
    }

    const postParticleBlock = selectNodes.length
      ? svgParticleStepBlock(summary, state, round, "Repicking / extraction", true, y)
      : { svg: "", height: 0 };
    if (postParticleBlock.svg) {
      body += postParticleBlock.svg;
      y += postParticleBlock.height + 18;
      body += svgArrow(y, y + 42, "");
      y += 62;
    }

    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some(
        (item) => item.uid === node.uid && item.classes && item.classes.length,
      );
      return hasClasses || normalMapAssets(node).length > 0;
    });
    for (let i = 0; i < mapNodes.length; i += 1) {
      const node = mapNodes[i];
      const classJob = (summary.class_split_jobs || []).find(
        (item) => item.uid === node.uid,
      );
      body += svgText(width / 2, y, `${node.uid} ${node.job_type}`, 16, 700);
      y += 20;
      if (classJob) {
        const selected = reportSelectedClassIndices(node.uid, summary, state);
        const total =
          classJob.classes.find((item) => Number.isInteger(item.total_particles))
            ?.total_particles || node.particle_count;
        body += svgText(
          width / 2,
          y,
          `input ${total ? fmt(total) : "?"} particles${selected.size ? `; selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}` : ""}`,
          12,
          400,
        );
        y += 14;
        const grid = svgClassGrid(node, classJob, selected, y, imageDataMap);
        body += grid.svg;
        y += grid.height + 22;
      } else {
        const maps = normalMapAssets(node);
        const item = maps.find((map) => map.preview_url) || maps[0];
        if (item && item.preview_url) {
          body += `<image href="${svgImageHref(node.uid, mapPreviewImageName(item.group), imageDataMap)}" x="${(width - 170) / 2}" y="${y}" width="170" height="150" preserveAspectRatio="xMidYMid meet"/>`;
          y += 162;
        }
        if (node.particle_count !== null && node.particle_count !== undefined) {
          body += svgText(width / 2, y, `${fmt(node.particle_count)} particles`, 18, 500);
          y += 22;
        }
      }
      if (i < mapNodes.length - 1) {
        body += svgArrow(y, y + 42, "");
        y += 62;
      }
    }
  }

  const contentHeight = y + 28;
  const margin = 22;
  const scale = Math.min(1, (SVG_A4_HEIGHT - margin * 2) / contentHeight);
  const xOffset = (SVG_A4_WIDTH - SVG_A4_WIDTH * scale) / 2;
  const yOffset = scale < 1 ? margin : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${SVG_A4_WIDTH} ${SVG_A4_HEIGHT}"><rect width="100%" height="100%" fill="#fff"/><g transform="translate(${xOffset} ${yOffset}) scale(${scale})">${body}</g></svg>`;
}
