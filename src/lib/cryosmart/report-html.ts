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
import type {
  ReportFontScale,
  ReportImageMode,
  ReportTemplateId,
  ReportWidthMode,
} from "./report-style";

import {
  MAJOR_JOB_TYPES,
  PARTICLE_AUX_JOB_TYPES,
  PICKING_JOB_TYPES,
  REPICK_PARTICLE_PRODUCER_TYPES,
  REPICK_SETUP_JOB_TYPES,
  SMALL_JOB_TYPES,
} from "./constants";
// Shared data-layer helpers. Historically these were duplicated locally
// ("to avoid circular import") but lineage.ts only imports constants/types,
// so no cycle exists — report-pptx.ts already follows this import pattern.
import {
  reportJobNum,
  pixelSizeNumber,
  formatPixelSize,
  resolutionNumber,
  parseClassIndex,
  mapPreviewImageName,
  reportFeedsVolumeMainline,
  reportRepickSeedSourceRounds,
  reportParticleSourceRound,
  reportEdgeKind,
  htmlGroupLabel,
  groupLogImagesByClass,
} from "./lineage";

export interface ReportHtmlOptions {
  /**
   * v3.17 — visual template skin (default "paper"). "classic" keeps the
   * pre-3.17 stylesheet verbatim (gradients + auto light/dark); the three
   * new skins (paper / minimal / slate) are flat, restrained, print-clean
   * designs generated from a token spec.
   */
  template?: ReportTemplateId;
  /** Base font-size scale (default "standard"). */
  fontScale?: ReportFontScale;
  /**
   * v3.20 — content width (default "full": use the whole viewport, no
   * letterboxed margins). "wide" caps the workspace at 1680px, "boxed"
   * at 1280px (classic document measure).
   */
  widthMode?: ReportWidthMode;
  /**
   * Image delivery mode (default "embed"):
   *  - embed  : use `embeddedImages` data-URLs when available (self-contained)
   *  - remote : always reference the source URL (smaller file)
   *  - none   : strip image tags entirely — data tables/captions stay
   */
  imageMode?: ReportImageMode;
  /** Custom report title (default: "CryoSmart Lineage: <P> / <J>"). */
  titleOverride?: string;
  /** Optional note line under the title (author / date / remark). */
  subtitle?: string;
  /** { remoteUrl -> base64 data-URL } map from prefetchImagesForReport() */
  embeddedImages?: Record<string, string>;
  /**
   * The web app's own origin (e.g. "https://preview-….space-z.ai"), used to
   * ABSOLUTIZE same-origin session-image URLs (`/api/cryosmart/import/
   * session/<token>/image/<fileid>`) emitted as `<img src>`. Relative srcs
   * resolve fine inside the preview iframe (srcdoc inherits the parent base
   * URL), but the "Open" button serves the report from a `blob:` URL — and
   * relative resolution against a blob: opaque path FAILS, so those images
   * would all break in the opened report. With the origin provided they
   * become absolute and load from the live session (until its TTL expires;
   * failed loads then hide via the standard onerror chain).
   */
  webAppOrigin?: string;
  /**
   * Bundle mode: when true, image tags use a local filename
   * (`images/<uid>/<name>.png`) with an onerror fallback to the remote URL.
   * This is appropriate for the downloadable ZIP bundle, where the `images/`
   * folder is saved alongside the HTML so the report works offline.
   *
   * When false/undefined (default — preview iframe + "open in new window"),
   * image tags reference the remote CryoSmart URL directly with
   * `referrerpolicy="no-referrer"`. The local-filename + onerror dance is
   * skipped because there is no `images/` folder in the preview/new-window
   * context — emitting it only caused a guaranteed 404 + broken-image flash
   * before the onerror fallback fired.
   */
  bundleMode?: boolean;
  /** Live session (baseUrl + auth token + cookie) for proxying downloads */
  session?: {
    baseUrl: string;
    auth?: string;
    cookie?: string;
  } | null;
}

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

  /** "1.24 Å/px" or empty string. */
  // duplicated from lineage.ts to avoid circular import
  export function pixelSizeText(node: LineageNode | null | undefined): string {
    const text = formatPixelSize(node && node.pixel_size_A);
    return text ? `${text} Å/px` : "";
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

  /** Sanitize a string for use as a path component.
   *  Exported so bundle.ts can save ZIP images under exactly the same
   *  names that reportImgTag() references in bundle mode. */
  // duplicated from lineage.ts to avoid circular import
  export function safePart(value: unknown): string {
    return String(value || "item")
      .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 100);
  }

  /** Local image path inside the report bundle: `images/<uid>/<name>.png`.
   *  Exported so bundle.ts can mirror these exact paths in the ZIP's
   *  `images/` folder (any mismatch = silent 404 in the offline report). */
  // duplicated from lineage.ts to avoid circular import
  export function localImageFilename(nodeUid: string, name: string): string {
    return `images/${safePart(nodeUid)}/${safePart(name)}.png`;
  }

  /** Build a same-origin proxy URL `/api/proxy-image/<fileid>?base=...&cookie=...&auth=...`
   *  from a full CryoSmart log_image URL. Used as the `onerror` fallback
   *  for `<img>` tags in the report so images still load when the browser
   *  can't reach CryoSmart directly but the Next.js server can.
   *  Returns null if the URL isn't a `/api/log_image/<fileid>` URL. */
  function buildProxyFallbackUrl(
    remoteSrc: string,
    session?: { baseUrl?: string; cookie?: string; auth?: string } | null
  ): string | null {
    const m = String(remoteSrc || "").match(/\/api\/log_image\/([^/?#]+)/);
    if (!m) return null;
    const fileid = m[1];
    const base = String(session?.baseUrl || "").replace(/\/$/, "");
    if (!base) return null;
    const params: string[] = [`base=${encodeURIComponent(base)}`];
    if (session?.cookie) params.push(`cookie=${encodeURIComponent(session.cookie)}`);
    if (session?.auth) params.push(`auth=${encodeURIComponent(session.auth)}`);
    return `/api/proxy-image/${fileid}?${params.join("&")}`;
  }

  /** Absolutize a same-origin app-served image URL for contexts whose base
   *  URL cannot resolve relative paths (the blob: URL the report's "Open in
   *  new tab" button navigates to, and a downloaded file:// page).
   *  v3.20: this now covers CAPTURE-HISTORY image URLs too
   *  (`/api/cryosmart/history/<id>/image/...`) — after restoring a past
   *  capture the report's ui-tile / log images carry history URLs, and the
   *  blob: context failed to resolve them, so every "UI title" image broke
   *  and silently self-hid (v3.19 regression: the old inline iframe
   *  resolved relative paths against the app origin; the new-tab blob
   *  report does not). Non-app URLs are returned unchanged. */
  function absolutizeSessionUrl(
    url: string,
    webAppOrigin?: string
  ): string {
    if (
      webAppOrigin &&
      url.startsWith("/") &&
      /^\/api\/cryosmart\/(?:import\/session|history)\/[^/?#]+\/image\//.test(url)
    ) {
      return `${String(webAppOrigin).replace(/\/$/, "")}${url}`;
    }
    return url;
  }

  /** Preview image name for one row of the map download table.
   *  Mirrors the label logic in reportMapDownloads(): the plain map is named
   *  after its group ("volume"), sharp/half maps keep `group.result_name`
   *  ("volume.map_sharp"). Exported so bundle.ts saves the ZIP copy of the
   *  preview under the exact same filename the HTML references. */
  export function mapPreviewAssetName(item: MapAsset): string {
    const label =
      item.result_name && item.result_name !== "map"
        ? `${item.group}.${item.result_name}`
        : item.group;
    return mapPreviewImageName(label);
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
  function reportMaxRoundFromEdges(
    edges: NormalizedLineageEdge[],
    state: LineageReportState,
    visited: Set<string>,
  ): number {
    const rounds = edges.map((edge) => reportLineageRound(edge.source, state, new Set(visited)));
    return rounds.length ? Math.max(...rounds) : 0;
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
    // `compact` is kept in the signature for API compatibility with the
    // original popup.js port; both modes render the same string.
    return parts.join(" · ");
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
    return `<h3>Class / MRC 来源</h3><table><tr><th scope="col">Class</th><th scope="col">Particles</th><th scope="col">%</th><th scope="col">Map downloads</th></tr>${rows}</table>`;
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
    return `<h3>MRC Maps</h3><table><tr><th scope="col">Result</th><th scope="col">Download</th></tr>${rows}</table>`;
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
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CryoSmart ${escHtml(
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
    return `<div class="source-block"><h3>来源</h3><table class="source-table"><thead><tr><th scope="col">类型</th><th scope="col">直接来源</th><th scope="col">引用</th><th scope="col">合并上游</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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

  /** Filter a node's `maps` to the normal (non-mask) map files. Includes
   *  every non-mask volume blob — sharp maps and half maps included (see
   *  the canonical copy in lineage.ts for the full rationale). */
  export function normalMapAssets(node: LineageNode): MapAsset[] {
    return (node.maps || []).filter((item) => {
      const group = String(item.group || "");
      const result = String(item.result_name || "");
      const volumeGroup = item.group_type ? item.group_type === "volume" : !/mask/i.test(group);
      const isMask = /mask/i.test(group) || /mask/i.test(result);
      return volumeGroup && !isMask;
    });
  }

  /** `<img>` tag. Embeds base64 when available; otherwise references the
   *  remote URL directly (preview/new-window) or a local filename with an
   *  onerror fallback to the remote URL (bundle mode).
   *
   *  Failure chain (preview/new-window): direct remote URL → same-origin
   *  proxy → the image VANISHES WITHOUT A TRACE (user request: "图片加载
   *  不出来自动隐藏，在report中不留痕迹" — the failed boxes used to be
   *  dashed "image unavailable" placeholders, and their captions duplicated
   *  titles of images that DID load, i.e. dead older-round log images).
   *  The enclosing <figure> (image + caption + "打开" link) is hidden
   *  entirely; an image without a figure hides its <a> wrapper, or itself.
   *  Inside an `.imgs-block` (log images / micrographs media blocks) the
   *  heading count is rewritten as figures disappear, and the whole block
   *  hides once its last figure is gone. */
  /** v3.17: imageMode "none" strips every <img> from the report (data
   *  tables, captions and counts are untouched). */
  function imagesEnabled(opts?: ReportHtmlOptions): boolean {
    return (opts?.imageMode ?? "embed") !== "none";
  }

  export function reportImgTag(
    nodeUid: string,
    name: string,
    remoteSrc: string | null | undefined,
    className = "",
    alt = "image",
    opts?: ReportHtmlOptions,
  ): string {
    if (!remoteSrc) return "";
    if (!imagesEnabled(opts)) return "";
    const cls = className ? ` class="${escHtml(className)}"` : "";
    // Shared "final failure" handler: hide the figure (or <a>, or the img),
    // keep .imgs-block headings truthful, and collapse empty image blocks.
    // NOTE: every backslash is doubled so the regexes survive the TS
    // template-literal → runtime-string hop.
    const markFailed =
      "var f=this.closest('figure');if(f){f.classList.add('img-gone');}" +
      "else{var a=this.closest('a');if(a){a.classList.add('img-gone');}else{this.style.display='none';}}" +
      "var s=this.closest('.cls-sec');if(s){var c=s.querySelector('.cnt');" +
      "if(c){var m2=c.textContent.match(/^(\\d+)(?:\\s*\\/\\s*(\\d+))?/);" +
      "if(m2){c.textContent=(parseInt(m2[1],10)-1)+(m2[2]?' / '+m2[2]:'');}}}" +
      "var b=this.closest('.imgs-block');if(b){" +
      "var v=b.querySelectorAll('figure.imgbox:not(.img-gone)').length;" +
      "var h=b.querySelector('h3');" +
      "if(h){var m=h.textContent.match(/\\((\\d+)(?:\\s*\\/\\s*(\\d+))?\\)/);" +
      "if(m){h.textContent=h.textContent.replace(m[0],'('+v+(m[2]?' / '+m[2]:'')+')');}}" +
      "if(!v){b.classList.add('block-gone');}}";
    // Prefer embedded base64 when available so the image renders standalone
    // (works in iframe, new window, and downloaded bundle alike). v3.17:
    // only in "embed" mode — "remote" deliberately skips the data-URLs so
    // the file stays small and images resolve against the live source.
    if ((opts?.imageMode ?? "embed") === "embed" && opts?.embeddedImages?.[remoteSrc]) {
      return `<img${cls} src="${escHtml(opts.embeddedImages[remoteSrc])}" alt="${escHtml(alt)}" loading="lazy" decoding="async" data-embedded="1">`;
    }
    // Bundle mode: the downloadable ZIP ships an `images/` folder alongside
    // the HTML, so reference the local file and fall back to the remote URL
    // on error; if BOTH fail, hide the figure like the preview mode does.
    // (All quoting is handled by the single escHtml() at the end — never
    // pre-escape the pieces or the attribute would double-escape them.)
    if (opts?.bundleMode) {
      const localSrc = localImageFilename(nodeUid, name);
      return `<img${cls} src="${escHtml(localSrc)}" data-remote-src="${escHtml(remoteSrc)}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="${escHtml(
        `if(!this.dataset.tried){this.dataset.tried='1';this.src=this.dataset.remoteSrc;}else{${markFailed}}`,
      )}" alt="${escHtml(alt)}">`;
    }
    // Default (preview iframe + open-in-new-window): reference the remote
    // CryoSmart URL directly. referrerpolicy=no-referrer mirrors the
    // <meta name="referrer"> in <head> — remote CryoSmart servers reject
    // requests carrying an external Referer header (the iframe's srcdoc
    // origin), which is exactly why right-click "open in new tab" worked
    // while inline <img> did not. We deliberately do NOT emit a local-filename
    // first: there is no `images/` folder in the preview/new-window context,
    // so that would 404 and flash a broken-image icon before the onerror
    // fallback fired — the direct-remote approach renders the image in one
    // hop or hides itself cleanly.
    //
    // As a SECOND fallback, if the direct URL fails, try the same-origin
    // proxy URL with the session's cookie/auth forwarded. This helps when
    // the browser can't reach CryoSmart directly but the Next.js server can.
    // Third and final: markFailed — the figure disappears without a trace.
    // (proxyUrl + markFailed stay RAW here; the single escHtml() below
    // escapes the whole handler exactly once, so the browser's attribute
    // decoding yields valid JS.)
    //
    // Session-image URLs (staged capture, same-origin relative paths) are
    // ABSOLUTIZED with the web app's origin when provided — inside the
    // preview iframe they'd resolve against the parent base URL anyway, but
    // the "Open" button serves this same HTML from a blob: URL where
    // relative resolution fails outright.
    const renderSrc = absolutizeSessionUrl(remoteSrc, opts?.webAppOrigin);
    const proxyUrl = buildProxyFallbackUrl(remoteSrc, opts?.session);
    // SECURITY: the proxy fallback URL is carried in a data-* attribute and
    // read back via `this.dataset.proxySrc` — NEVER interpolated into the
    // JS string literal. `proxyUrl` embeds the raw fileid captured from the
    // remote URL, and a crafted fileid like `x";alert(document.cookie);//`
    // used to break out of the old `this.src="${proxyUrl}"` literal and
    // execute arbitrary JS inside the report iframe (which runs SAME-ORIGIN
    // with the app when rendered from srcdoc). escHtml() protects the
    // HTML-attribute context only; a dataset read-back is context-safe.
    const proxyAttr = proxyUrl ? ` data-proxy-src="${escHtml(proxyUrl)}"` : "";
    const onerror = proxyUrl
      ? `if(!this.dataset.tried){this.dataset.tried='1';this.src=this.dataset.proxySrc;}else{${markFailed}}`
      : `if(!this.dataset.tried){this.dataset.tried='1';${markFailed}}`;
    return `<img${cls} src="${escHtml(renderSrc)}"${proxyAttr} referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="${escHtml(onerror)}" alt="${escHtml(alt)}">`;
  }

  /** Grid of image boxes (used by media block). `variant="compact"`
   *  renders the tighter `.imgs-c` CSS grid + `.imgbox.sm` figures —
   *  used by the log-image block (v3.15) where a class-grouped gallery
   *  must stay dense; the classic flex layout stays for micrograph /
   *  select-2D previews. */
  export function reportImageBoxes(
    nodeUid: string,
    images: Array<ImageAsset | null | undefined> | null | undefined,
    limit = 4,
    opts?: ReportHtmlOptions,
    variant?: "compact",
  ): string {
    if (!imagesEnabled(opts)) return "";
    const good = (images || [])
      .filter((item): item is ImageAsset => Boolean(item && item.url && (item as ImageAsset).src))
      .slice(0, limit);
    if (!good.length) return "";
    const containerCls = variant === "compact" ? "imgs-c" : "imgs";
    const boxCls = variant === "compact" ? "imgbox sm" : "imgbox";
    return `<div class="${containerCls}">${good
      .map((item) => {
        const localName = (item as ImageAsset & { local_name?: string }).local_name || item.name || "image";
        const originalUrl = absolutizeSessionUrl(
          item.original_url || item.url,
          opts?.webAppOrigin
        );
        return `<figure class="${boxCls}"><a href="${escHtml(originalUrl)}" target="_blank">${reportImgTag(
          nodeUid,
          localName,
          item.src,
          "",
          item.name || "image",
          opts
        )}</a><figcaption title="${escHtml(item.name || "image")}">${escHtml(item.name || "image")} <a href="${escHtml(
          originalUrl,
        )}" target="_blank">打开</a></figcaption></figure>`;
      })
      .join("")}</div>`;
  }

  /** Micrograph preview + Select 2D media block. */
  export function reportMediaBlock(node: LineageNode, opts?: ReportHtmlOptions): string {
    const chunks: string[] = [];
    if (
      node.job_type === "import_micrographs" &&
      Array.isArray(node.representative_micrograph_images)
    ) {
      const html = reportImageBoxes(node.uid, node.representative_micrograph_images, 3, opts);
      if (html) {
        chunks.push(`<div class="media-block imgs-block"><h3>原始 micrographs 预览</h3>${html}</div>`);
  }
  }

    // Log images — captured from the SPA's lazy jobLogs state by the Smart
    // Capture script (force-loaded via the store's log-loading action).
    // Rendered whenever present so runtime log previews make it into the
    // report alongside the tile/select-2D images.
    //
    // v3.15 — CLASS GROUPING + COMPACT GRID: ab-initio / hetero-refine
    // jobs emit their plots PER CLASS ("class 0 FSC", `J4_final_000.png`
    // gallery files…). When class info is extractable the block renders
    // one dense sub-section per class (auto-fill CSS grid — no trailing
    // gaps like the old flex row, tighter boxes, ellipsised captions).
    // Per-class cap keeps each section printable; the h3 + per-class
    // counts are rewritten by reportImgTag's markFailed as images fail.
    // Flat jobs (no class info) get the same compact grid, capped at 24.
    // The block carries `imgs-block` so failed images can auto-hide it
    // and keep the heading count truthful (see reportImgTag's markFailed).
    const logImages = (node.images || []).filter(
      (item) => item.kind === "log_image" || item.kind === "image_log"
    );
    if (logImages.length > 0) {
      const CLASS_LIMIT = 12;
      const groups = groupLogImagesByClass(logImages);
      if (groups) {
        const sections = groups
          .map((g) => {
            const shown = g.images.slice(0, CLASS_LIMIT);
            const grid = reportImageBoxes(node.uid, shown, CLASS_LIMIT, opts, "compact");
            if (!grid) return "";
            const count =
              g.images.length > CLASS_LIMIT
                ? `${shown.length} / ${g.images.length}`
                : `${g.images.length}`;
            return `<div class="cls-sec"><div class="cls-head"><span>${escHtml(
              g.label
            )}</span><span class="cnt">${escHtml(count)}</span></div>${grid}</div>`;
          })
          .filter(Boolean)
          .join("");
        if (sections) {
          chunks.push(
            `<div class="media-block imgs-block"><h3>Log images (${escHtml(
              String(logImages.length)
            )})</h3>${sections}</div>`
          );
        }
      } else {
        const LIMIT = 24;
        const shown = logImages.slice(0, LIMIT);
        const html = reportImageBoxes(node.uid, shown, LIMIT, opts, "compact");
        if (html) {
          const heading =
            logImages.length > LIMIT
              ? `Log images (${shown.length} / ${logImages.length})`
              : `Log images (${logImages.length})`;
          chunks.push(`<div class="media-block imgs-block"><h3>${escHtml(heading)}</h3>${html}</div>`);
        }
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
        )}</div>${reportImageBoxes(node.uid, images, 3, opts)}</div>`,
      );
  }

    return chunks.join("");
  }

  /** Map download grid + "一键下载 map" button for a single node.
   *  v2: 3 maps per row (user request — the old one-map-per-row table
   *  wasted vertical space on jobs with sharp/half map sets). Each cell:
   *  output-group preview (click to open) + group label + download link. */
  export function reportMapDownloads(node: LineageNode, summary: LineageSummary, opts?: ReportHtmlOptions): string {
    if (Array.isArray(node.classes) && node.classes.length) return "";
    const maps = normalMapAssets(node);
    if (!maps.length) return "";
    const urls = maps.map((item) => item.download_url).join("|");
    // Friendly download filenames (mirrors the ZIP maps/ naming:
    // BJ.<project>.<uid>.<group>.<result>.mrc) — without data-names the
    // inline script falls back to the URL's last path segment.
    const dlNames = maps
      .map(
        (item) =>
          `BJ.${summary.project_uid || "P"}.${node.uid}.${item.group || "volume"}.${item.result_name || "map"}.mrc`,
      )
      .join("|");
    const cells = maps
      .map((item) => {
        // Show the result name when it's not the plain "map" — nu-refine
        // and friends keep `map_sharp` / `map_half_A` / `map_half_B` inside
        // the `volume` group; the cell should say which one is which.
        const label =
          item.result_name && item.result_name !== "map"
            ? `${item.group}.${item.result_name}`
            : item.group;
        // v3.17: imageMode "none" degrades to the text placeholder instead
        // of an <img> (the cell keeps its label + download link — data intact).
        const preview =
          item.preview_url && imagesEnabled(opts)
            ? `<a class="map-cell-img" href="${escHtml(
                absolutizeSessionUrl(
                  item.preview_original_url || item.preview_url,
                  opts?.webAppOrigin
                )
              )}" target="_blank">${reportImgTag(
                node.uid,
                mapPreviewAssetName(item),
                item.preview_src || item.preview_url,
                "map-preview",
                `${label} preview`,
                opts
              )}</a>`
            : `<span class="map-cell-img map-cell-none">${imagesEnabled(opts) ? "无预览" : "图片已省略"}</span>`;
        return `<div class="map-cell">${preview}<div class="map-cell-name" title="${escHtml(
          label,
        )}">${escHtml(label)}</div><a class="map-dl" href="${escHtml(
          item.download_url,
        )}" target="_blank">下载 map</a></div>`;
      })
      .join("");
    return `<div class="map-block"><h3>Map / MRC</h3><div class="download-head"><b>map: ${maps.length} 个（含 sharp / half map）</b><button type="button" class="download-all" data-urls="${escHtml(
      urls,
    )}" data-names="${escHtml(dlNames)}">一键下载 map</button></div><div class="map-grid">${cells}</div></div>`;
  }

  /** Class table (horizontal) + "一键下载 map" for class_3D / abinit / hetero. */
  export function reportClassTable(node: LineageNode, summary: LineageSummary, opts?: ReportHtmlOptions): string {
    const classJob = (summary.class_split_jobs || []).find(
      (item: ClassSplitJob) => item.uid === node.uid,
    );
    if (!classJob || !Array.isArray(classJob.classes) || !classJob.classes.length) return "";
    const headers = classJob.classes
      .map((cls: ClassSplit) => `<th scope="col">class ${escHtml(cls.class_index)}</th>`)
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
            ? `<a href="${escHtml(
                absolutizeSessionUrl(
                  cls.mrc_preview_original_url || cls.mrc_preview_url,
                  opts?.webAppOrigin
                )
              )}" target="_blank">${reportImgTag(
                node.uid,
                cls.volume_group || `class_${cls.class_index}`,
                cls.mrc_preview_src || cls.mrc_preview_url,
                "class-preview",
                `class ${cls.class_index} map preview`,
                opts
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
    // Friendly per-class download filenames (mirrors the ZIP maps/ naming:
    // BJ.<project>.<uid>.<volume_group|class_i>.<result>.mrc). Indexed in
    // lockstep with downloadUrls above so names[i] matches urls[i].
    const downloadNames = classJob.classes
      .flatMap((cls: ClassSplit) =>
        (cls.maps || [])
          .filter((item) => item.result_name === "map" || !item.result_name)
          .map((item) =>
            `BJ.${summary.project_uid || "P"}.${node.uid}.${cls.volume_group || `class_${cls.class_index}`}.${item.result_name || "map"}.mrc`,
          ),
      )
      .filter(Boolean);
    const button = downloadUrls.length
      ? `<button type="button" class="download-all" data-urls="${escHtml(downloadUrls.join("|"))}" data-names="${escHtml(downloadNames.join("|"))}">一键下载 map</button>`
      : "";
    return `<div class="class-toolbar"><span>Class / Map</span></div><div class="classes horizontal-view"><div class="horizontal-table"><table><tbody><tr><th scope="row">Class</th>${headers}</tr><tr><th scope="row">颗粒</th>${counts}</tr><tr><th scope="row">%</th>${percents}</tr><tr><th scope="row">预览</th>${previews}</tr><tr><th scope="row">Map</th>${maps}</tr></tbody></table></div></div>${
      downloadUrls.length
        ? `<div class="download-head"><b>普通 map: ${downloadUrls.length} 个</b>${button}</div>`
        : ""
    }`;
  }

  /* ================================================================== */
  /*  V2 picture-flow helpers (the SVG-style mini-flow inside the left  */
  /*  pane, rendered as HTML)                                            */
  /* ================================================================== */

  export function reportFirstMicrographNode(summary: LineageSummary): LineageNode | undefined {
    return (
      (summary.nodes || []).find(
        (node) => node.job_type === "import_micrographs" && node.micrograph_count !== null,
      ) || (summary.nodes || []).find((node) => /micrograph/i.test(node.job_type || ""))
    );
  }

  export function reportSelectedClassIndices(
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
    opts?: ReportHtmlOptions,
  ): string {
    return reportImgTag(nodeUid, name, remoteSrc, className, alt, opts);
  }

  function reportPictureMicrographs(summary: LineageSummary, opts?: ReportHtmlOptions): string {
    const node = reportFirstMicrographNode(summary);
    if (!node) return "";
    const imgs = (node.representative_micrograph_images || []).slice(0, 3);
    const imgHtml =
      imgs.length && imagesEnabled(opts)
        ? `<div class="pf-mic-imgs">${imgs
          .map((item) =>
            reportPictureImg(
              node.uid,
              (item as ImageAsset & { local_name?: string }).local_name || item.name || "image",
              item.src,
              "",
              item.name || "micrograph",
            opts
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

  function reportPictureSelect2D(node: LineageNode, opts?: ReportHtmlOptions): string {
    const s = node.select_2d;
    if (!s) return "";
    const input: number | null = node.particle_count || s.particles_selected || null;
    const selected = s.particles_selected;
    const ratio =
      Number.isInteger(input) && Number.isInteger(selected as number) && input
        ? `${Math.round(((selected as number) / input!) * 1000) / 10}%`
        : "";
    const img =
      s.selected_classes_image && imagesEnabled(opts)
        ? `<div class="pf-select-img">${reportPictureImg(
          node.uid,
          // Same name as the media block ("templates_selected") so both
          // <img> tags share ONE local file in the offline ZIP bundle.
          "templates_selected",
          s.selected_classes_src || s.selected_classes_image,
          "",
          "templates selected",
        opts
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
    opts?: ReportHtmlOptions,
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
    opts?: ReportHtmlOptions,
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
            opts
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

  function reportPictureNormalMap(node: LineageNode, opts?: ReportHtmlOptions): string {
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
        opts
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
    opts?: ReportHtmlOptions,
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
      opts
    );
    const postParticleSteps = selectNodes.length
      ? reportPictureParticleSteps(summary, state, round, "再挑颗粒 / 提取", true, opts)
      : "";
    if (!preParticleSteps && !selectNodes.length && !postParticleSteps && !mapNodes.length) {
      return "";
  }
    const steps: string[] = [];
    if (preParticleSteps) steps.push(preParticleSteps);
    for (const node of selectNodes) steps.push(reportPictureSelect2D(node, opts));
    if (postParticleSteps) steps.push(postParticleSteps);
    for (const node of mapNodes) {
      const html = (summary.class_split_jobs || []).some((item: ClassSplitJob) => item.uid === node.uid)
        ? reportPictureClassJob(node, summary, state, opts)
        : reportPictureNormalMap(node, opts);
      if (html) steps.push(html);
  }
    return `<div class="pf-round"><div class="pf-round-head"><h3>Round ${round}${
      round > 1 ? " repicking" : ""
    }</h3></div>${steps.join('<div class="pf-arrow">↓</div>')}</div>`;
  }

  /** The picture-flow diagram (HTML version of the SVG flow). */
  export function reportPictureFlow(summary: LineageSummary, state: LineageReportState, opts?: ReportHtmlOptions): string {
    const rounds = Array.from(
      new Set(
        (summary.nodes || [])
          .map((node) => reportLineageRound(node.uid, state))
          .filter((round) => round > 0),
      ),
    ).sort((a, b) => a - b);
    const roundHtml = rounds
      .map((round) => reportPictureRound(summary, state, round, opts))
      .filter(Boolean)
      .join('<div class="pf-arrow">↓</div>');
    if (!roundHtml) return "";
    return `<div class="picture-flow"><div class="picture-head"><h2>Picture Flow</h2><span>SVG 会随报告单独导出</span></div>${reportPictureMicrographs(
      summary,
      opts
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
    opts?: ReportHtmlOptions,
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
      opts
    )}${reportClassTable(node, summary, opts)}${reportMapDownloads(node, summary, opts)}</div>`;
    return `<section class="job-card ${escHtml(kind)}" id="card-${escHtml(
      node.uid,
    )}">${main}${reportOutgoingBox(node, summary, state)}</section>`;
  }

  /* ================================================================== */
  /*  v3.17 report templates — token-driven skins (paper/minimal/slate)  */
  /* ================================================================== */

  /** Design tokens for one v3.17 report skin. `buildTemplateCss()` turns a
   *  spec into the full stylesheet; the body markup is IDENTICAL across
   *  templates (content is never watered down — only the skin changes).
   *  v3.20 adds layout tokens: stickyHeader / boxedSections / flowTop and
   *  the width-mode machinery in buildReportCss.
   *  v3.22 adds `layout` — a genuine structural archetype switch (not a
   *  recolour): "split" keeps the two-pane workspace (left outline +
   *  right chain), "reading" reflows the SAME markup into a single-column
   *  document with a horizontal chapter rail at the top. */
  interface ReportTemplateSpec {
    id: Exclude<ReportTemplateId, "classic">;
    /**
     *  - "split"   : two-pane workspace (outline+flow left, cards right)
     *  - "reading" : single-column document flow — the outline pane turns
     *                into a horizontally scrolling chapter rail and job
     *                cards span the full measure below (v3.22 "focus")
     */
    layout?: "split" | "reading";
    fontBody: string;
    /** base body font-size (px) at fontScale "standard" */
    baseFontPx: number;
    /** paper: centered academic title block */
    centerHeader: boolean;
    /** minimal/slate: slim sticky header — the title stays visible while
     *  scrolling the (now full-width) two-pane workspace. */
    stickyHeader: boolean;
    /** minimal/slate: media/map sections render as boxed inset panels
     *  (visible layering); paper keeps open hairline sections instead. */
    boxedSections: boolean;
    /** flow-pane sticky offset — "16px" under a static header, or the
     *  sticky header height + gutter for minimal/slate. */
    flowTop: string;
    bg: string;
    bg2: string;
    panel: string;
    panel2: string;
    panel3: string;
    text: string;
    text2: string;
    text3: string;
    muted: string;
    muted2: string;
    line: string;
    line2: string;
    link: string;
    linkHover: string;
    linkUnderline: "none" | "hover" | "always";
    /** primary button (.download-all) */
    btnBg: string;
    btnText: string;
    btnBorder: string;
    btnHoverBg: string;
    micro: string;
    microBg: string;
    microBorder: string;
    particle: string;
    particleBg: string;
    particleBorder: string;
    volume: string;
    volumeBg: string;
    volumeBorder: string;
    smallBg: string;
    smallBorder: string;
    radius: string;
    radiusSm: string;
    radiusLg: string;
    shadowSm: string;
    shadow: string;
    rowHover: string;
    thBg: string;
    /** extra CSS appended verbatim (template-specific flourishes) */
    extra?: string;
  }

  const REPORT_FONT_MONO =
    '"SF Mono","JetBrains Mono",Monaco,"Cascadia Code","Roboto Mono",Consolas,monospace';

  /** Paper — 学术纸面：serif、纯白纸面、hairline 边框、书册式表格。
   *  v3.20: 静态题头 + 双线装饰 + 居中题头排版；全宽利用（不封顶）。 */
  const PAPER_SPEC: ReportTemplateSpec = {
    id: "paper",
    fontBody: 'Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif',
    baseFontPx: 15,
    centerHeader: true,
    stickyHeader: false,
    boxedSections: false,
    flowTop: "16px",
    bg: "#ffffff",
    bg2: "#f7f6f3",
    panel: "#ffffff",
    panel2: "#fbfaf8",
    panel3: "#f4f2ee",
    text: "#1c1917",
    text2: "#292524",
    text3: "#57534e",
    muted: "#79716b",
    muted2: "#a8a29e",
    line: "#e5e2dd",
    line2: "#d6d1ca",
    link: "#7a2e2e",
    linkHover: "#5d2222",
    linkUnderline: "always",
    btnBg: "#ffffff",
    btnText: "#292524",
    btnBorder: "#292524",
    btnHoverBg: "#f4f2ee",
    micro: "#3f5c34",
    microBg: "#f3f7f0",
    microBorder: "#ccd9c3",
    particle: "#8a5800",
    particleBg: "#faf4e8",
    particleBorder: "#e0d0ab",
    volume: "#1f5750",
    volumeBg: "#eef4f2",
    volumeBorder: "#bfd4cf",
    smallBg: "#f4f2ee",
    smallBorder: "#d6d1ca",
    radius: "2px",
    radiusSm: "2px",
    radiusLg: "3px",
    shadowSm: "none",
    shadow: "none",
    rowHover: "#f7f6f3",
    thBg: "#f4f2ee",
    extra: [
      // Academic flourishes: double rule under the title block, booktabs-style
      // table heads, print page setup.
      "header{border-bottom:3px double var(--line-2)}",
      ".top{padding:30px 32px 22px}",
      ".title h1{font-size:1.85em;font-weight:600;letter-spacing:.005em;text-wrap:balance}",
      ".title p{letter-spacing:.02em}",
      ".source-table th,table th{background:transparent;border-bottom:1.5px solid var(--line-2)}",
      ".source-table{border:0}",
      ".source-table thead th{border-top:1.5px solid var(--line-2)}",
      ".classes{border:0}",
      "th{background:transparent;border-top:1.5px solid var(--line-2)}",
      "tr:hover td{background:var(--row-hover)}",
      // v3.23 VLM pass: stronger job-title hierarchy + breathing room in
      // the dense data tables ("字体层级不够明显 / 表格线条过密").
      ".job-head h2{font-size:1.16em;letter-spacing:.01em}",
      ".source-table th,.source-table td,table th,table td{padding:8px 13px}",
      // r3: looser leading + more air between open hairline sections
      "body{line-height:1.72}",
      ".source-block,.media-block,.map-block{margin-top:22px;padding-top:14px}",
      "@page{margin:14mm}",
    ].join("\n"),
  };

  /** Minimal — 极简：系统无衬线、浅灰纸面白卡片、青绿点缀、近单色 kind 标记。
   *  v3.20: 层次感来自「页面灰 → 白面板 → 内嵌灰盒」三级灰阶 + 2px 青绿题头刻线。 */
  const MINIMAL_SPEC: ReportTemplateSpec = {
    id: "minimal",
    fontBody:
      '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,"Helvetica Neue",Arial,sans-serif',
    baseFontPx: 14,
    centerHeader: false,
    stickyHeader: true,
    boxedSections: true,
    flowTop: "78px",
    bg: "#f6f7f8",
    bg2: "#eef0f2",
    panel: "#ffffff",
    panel2: "#f8f9fa",
    panel3: "#f1f3f5",
    text: "#18181b",
    text2: "#27272a",
    text3: "#52525b",
    muted: "#71717a",
    muted2: "#a1a1aa",
    line: "#e4e4e7",
    line2: "#d4d4d8",
    link: "#0f766e",
    linkHover: "#0d5f58",
    linkUnderline: "hover",
    btnBg: "#18181b",
    btnText: "#fafafa",
    btnBorder: "#18181b",
    btnHoverBg: "#3f3f46",
    micro: "#15803d",
    microBg: "transparent",
    microBorder: "#d4d4d8",
    particle: "#b45309",
    particleBg: "transparent",
    particleBorder: "#d4d4d8",
    volume: "#0f766e",
    volumeBg: "transparent",
    volumeBorder: "#d4d4d8",
    smallBg: "#f4f4f5",
    smallBorder: "#e4e4e7",
    radius: "8px",
    radiusSm: "6px",
    radiusLg: "10px",
    shadowSm: "0 1px 2px 0 rgba(0,0,0,.04)",
    shadow: "0 6px 20px -8px rgba(0,0,0,.14)",
    rowHover: "#fafafa",
    thBg: "#f8f9fa",
    extra: [
      // 2px teal tick at the sticky header's bottom-left — the single accent
      // that keeps the near-monochrome skin from reading as flat.
      "header::after{content:\"\";position:absolute;left:0;bottom:0;width:84px;height:2px;background:var(--volume)}",
      ".job-card:hover{box-shadow:var(--shadow)}",
      ".map-cell:hover,.mini-node:hover{box-shadow:var(--shadow-sm)}",
      // Section labels sit on boxed panel-2 insets — nudge them one step
      // darker than the default text-3 so they don't wash out (VLM review).
      "h3{color:var(--text-2)}",
    ].join("\n"),
  };

  /** Slate — 暗色专业：深色多层面板、青绿荧光点缀、暗室演示友好。
   *  v3.20: 三级明度面板（页面 → pane → 内嵌盒）+ 题头青绿渐隐刻线 + 悬停辉光。 */
  const SLATE_SPEC: ReportTemplateSpec = {
    id: "slate",
    fontBody:
      '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,"Helvetica Neue",Arial,sans-serif',
    baseFontPx: 14,
    centerHeader: false,
    stickyHeader: true,
    boxedSections: true,
    flowTop: "78px",
    bg: "#0f1318",
    bg2: "#0a0e13",
    panel: "#141a21",
    panel2: "#1a212b",
    panel3: "#212a35",
    text: "#e6eaf0",
    text2: "#c9d2dc",
    text3: "#a8b3c1",
    muted: "#7e8a99",
    muted2: "#515c6b",
    line: "#242c37",
    line2: "#323d4b",
    link: "#5eead4",
    linkHover: "#99f6e4",
    linkUnderline: "hover",
    btnBg: "#0d9488",
    btnText: "#e6fffb",
    btnBorder: "#0d9488",
    btnHoverBg: "#0f766e",
    micro: "#4ade80",
    microBg: "rgba(74,222,128,.08)",
    microBorder: "rgba(74,222,128,.32)",
    particle: "#fbbf24",
    particleBg: "rgba(251,191,36,.08)",
    particleBorder: "rgba(251,191,36,.32)",
    volume: "#2dd4bf",
    volumeBg: "rgba(45,212,191,.08)",
    volumeBorder: "rgba(45,212,191,.32)",
    smallBg: "rgba(148,163,184,.08)",
    smallBorder: "rgba(148,163,184,.24)",
    radius: "10px",
    radiusSm: "8px",
    radiusLg: "12px",
    shadowSm: "0 1px 2px 0 rgba(0,0,0,.4)",
    shadow: "0 8px 28px -10px rgba(0,0,0,.6)",
    rowHover: "#1a212b",
    thBg: "#212a35",
    extra: [
      // Teal fade rule under the sticky header + hover glow on cards.
      "header::after{content:\"\";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,var(--volume),rgba(94,234,212,0) 65%)}",
      ".job-card:hover{box-shadow:var(--shadow),0 0 0 1px var(--line-2)}",
      ".map-cell:hover{border-color:var(--volume-border);box-shadow:0 0 20px -6px rgba(45,212,191,.25)}",
      ".mini-node:hover{border-color:var(--line-2)}",
    ].join("\n"),
  };

  /** Blueprint — 工程记录簿（v3.22）：等宽标签、方角面板、点阵纸面、
   *  石墨标题黑块 + 铁锈红注记、虚线连接线与直角角标。结构与 paper 的
   *  “书册”感完全不同：面板全部方角 + 硬投影，分节编号用 SEC 01 计数器，
   *  job 卡带四角角标（corner ticks），流程箭头改为虚线导轨。 */
  const BLUEPRINT_SPEC: ReportTemplateSpec = {
    id: "blueprint",
    layout: "split",
    fontBody:
      'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,"Helvetica Neue",Arial,sans-serif',
    baseFontPx: 13.5,
    centerHeader: false,
    stickyHeader: true,
    boxedSections: true,
    flowTop: "78px",
    bg: "#f4f5f2",
    bg2: "#eceee8",
    panel: "#ffffff",
    panel2: "#f7f8f4",
    panel3: "#eef0e9",
    text: "#23262b",
    text2: "#2f343b",
    text3: "#4b545c",
    muted: "#5f6771",
    muted2: "#9aa2a9",
    line: "#d4d8d0",
    line2: "#c2c8bf",
    link: "#b3541e",
    linkHover: "#8f4216",
    linkUnderline: "hover",
    btnBg: "#23262b",
    btnText: "#f4f5f2",
    btnBorder: "#23262b",
    btnHoverBg: "#3c4148",
    micro: "#4d7c0f",
    microBg: "#f4f8ec",
    microBorder: "#ccdcb0",
    particle: "#a2540a",
    particleBg: "#faf2e6",
    particleBorder: "#e2cda6",
    volume: "#136a5c",
    volumeBg: "#eef6f3",
    volumeBorder: "#b9d8d0",
    smallBg: "#f2f4ee",
    smallBorder: "#d4d8d0",
    radius: "0px",
    radiusSm: "0px",
    radiusLg: "0px",
    shadowSm: "2px 2px 0 -1px rgba(35,38,43,.08)",
    shadow: "4px 4px 0 -1px rgba(35,38,43,.10)",
    rowHover: "#f5f7f0",
    thBg: "#eef0e9",
    extra: [
      // 点阵坐标纸页面背景（面板自身保持纯白，网格只在页面层露出；
      // v3.22 review：降低到 .11，避免与面板抢视覚）
      "body{background-image:radial-gradient(circle,rgba(35,38,43,.11) 1px,transparent 1.1px);background-size:22px 22px}",
      // 石墨标题黑块（工程图纸 title block）+ 通栏铁锈红刻度带
      "header{background:#23262b;border-bottom:0}",
      "header .top{padding:16px 28px}",
      ".title h1{color:#f4f5f2;letter-spacing:.02em;font-family:var(--font-mono)}",
      ".title p{color:#aab1a7}",
      ".title p b{color:#d7dbd2}",
      ".title .note{color:#c4b39a}",
      // 等宽大写分节标签 + SEC 编号
      "body{counter-reset:stg}",
      ".stage{counter-increment:stg}",
      "h3{font-family:var(--font-mono)}",
      ".stage h3::before{content:\"SEC \" counter(stg,decimal-leading-zero) \"  ·  \";color:#b3541e}",
      // h3 渲染为贴签（tag）样式：实线小框 + 前置方块
      ".source-block h3,.media-block h3,.map-block h3{display:inline-block;border:1px solid var(--line-2);padding:2px 9px;background:var(--panel)}",
      ".source-block h3::before,.media-block h3::before,.map-block h3::before{content:\"\";display:inline-block;width:7px;height:7px;background:#b3541e;margin-right:7px;vertical-align:0}",
      // job 卡四角角标（corner ticks，工程图定位角）
      ".job-card{border-left-width:1px;border-left-style:solid}",
      ".job-card::before,.job-card::after{content:\"\";position:absolute;width:13px;height:13px;pointer-events:none}",
      ".job-card::before{top:-1px;left:-1px;border-top:2px solid var(--text);border-left:2px solid var(--text)}",
      ".job-card::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--text);border-right:2px solid var(--text)}",
      // 流程箭头 → 虚线导轨 + 三角箭头
      ".pf-arrow{color:transparent;position:relative;height:16px;margin:8px 0 12px}",
      ".pf-arrow::before{content:\"\";position:absolute;left:8%;right:8%;top:50%;border-top:1px dashed var(--muted-2)}",
      ".pf-arrow::after{content:\"\";position:absolute;right:7%;top:50%;transform:translateY(-3px);border-left:6px solid var(--muted-2);border-top:3px solid transparent;border-bottom:3px solid transparent}",
      ".stage-arrow{display:none}",
      // 顶栏铁锈红刻度带（紧贴黑块下方，与铁锈红分节编号呼应）
      "header::after{content:\"\";position:absolute;left:0;right:0;bottom:-3px;height:3px;background:#b3541e}",
      "table th{text-transform:uppercase;font-family:var(--font-mono)}",
      // v3.23 r3 VLM pass ("模块边界模糊 / 留白节奏不统一"): the boxed
      // sections get the skin's signature hard offset shadow so panel
      // edges read clearly on the white panels, + one step more padding.
      ".source-block,.media-block,.map-block{box-shadow:4px 4px 0 -1px rgba(35,38,43,.09);padding:16px 18px}",
      "@page{margin:12mm}",
    ].join("\n"),
  };

  /** Editorial — 画报/年报（v3.22）：墨色报头 + 大号衬线展示字体、
   *  章节大数字编号（01/02…）、job 卡顶部色带与序号徽章、奶油纸面。
   *  结构上与 split 系模板的差异：报头是整幅墨色 band（非细 bar）、
   *  卡片用“上色带”而非“左色条”、分节以大号数字主导层级。 */
  const EDITORIAL_SPEC: ReportTemplateSpec = {
    id: "editorial",
    layout: "split",
    fontBody: 'Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif',
    // v3.23 r3 VLM pass: 15 → 16px ("部分文本字号偏小，长距离阅读易疲劳")
    baseFontPx: 16,
    centerHeader: false,
    stickyHeader: true,
    boxedSections: true,
    flowTop: "96px",
    // v3.23 VLM pass: bg softened one step ("偏暖黄易疲劳")
    bg: "#f6f2ea",
    bg2: "#ece5d6",
    panel: "#fffdf8",
    panel2: "#f8f3e8",
    panel3: "#f1ead9",
    text: "#231f18",
    text2: "#39322a",
    text3: "#6b6353",
    muted: "#8d8471",
    muted2: "#b8af9a",
    // v3.23 r3 VLM pass ("卡片边框颜色较浅层次弱"): lines one step darker
    line: "#ded3bc",
    line2: "#c9bda2",
    link: "#9a3b26",
    linkHover: "#7c2e1d",
    linkUnderline: "hover",
    btnBg: "#231f18",
    btnText: "#f6f1e5",
    btnBorder: "#231f18",
    btnHoverBg: "#3d352a",
    micro: "#4a6b3a",
    microBg: "#f0f4e8",
    microBorder: "#c9d5b4",
    particle: "#a06010",
    particleBg: "#f9f0e0",
    particleBorder: "#e0c9a4",
    volume: "#34605f",
    volumeBg: "#ecf3f1",
    volumeBorder: "#b9cfc9",
    smallBg: "#f4efe3",
    smallBorder: "#ddd3bd",
    radius: "10px",
    radiusSm: "8px",
    radiusLg: "14px",
    shadowSm: "0 1px 2px rgba(58,49,32,.06)",
    shadow: "0 10px 30px -12px rgba(58,49,32,.28)",
    rowHover: "#f8f3e8",
    thBg: "#f1ead9",
    extra: [
      // 墨色报头 band + 铁锈红下缘（整幅色带，非细线）
      "header{background:#231f18;border-bottom:0}",
      "header::after{content:\"\";position:absolute;left:0;right:0;bottom:-4px;height:4px;background:#9a3b26}",
      "header .top{padding:26px 32px}",
      ".title h1{color:#f7f2e6;font-size:1.9em;letter-spacing:-.015em;font-weight:700}",
      ".title p{color:#b3a893}",
      ".title p b{color:#d8cfb8}",
      ".title .note{color:#c9b99a}",
      // 章节大数字：stage 标题前置两位数字（01 02 …），层级一眼可读
      "body{counter-reset:stg}",
      ".stage{counter-increment:stg;padding:14px 16px 12px}",
      ".stage h3{font-family:Georgia,serif;font-size:.78em}",
      ".stage h3::before{content:counter(stg,decimal-leading-zero);display:inline-block;min-width:1.5em;margin-right:10px;font-size:1.75em;font-weight:700;line-height:1;color:#c8bfa6;vertical-align:-.12em}",
      // job 卡：上色带（替代左色条）+ 序号徽章
      "body{counter-reset:job}",
      ".cards{counter-reset:job;gap:20px}",
      ".job-card{counter-increment:job;border-left-width:1px;border-left-style:solid;border-top:4px solid var(--jc,var(--muted-2));padding-top:14px}",
      ".job-card:hover{border-top-color:var(--jc,var(--muted-2))}",
      ".job-head h2::before{content:counter(job,decimal-leading-zero);display:inline-block;margin-right:10px;padding:1px 8px;border:1px solid var(--line-2);border-radius:999px;font-size:.68em;letter-spacing:.08em;color:var(--text-3);vertical-align:.12em;font-family:var(--font-mono)}",
      // 杂志图注：斜体衬线
      ".imgbox figcaption{font-style:italic;font-family:Georgia,serif}",
      // v3.22 review：表格去“网格感”——表头不用等宽大写，改衬线小体、
      // 行分隔线减淡，与画报的软性容器协调
      "th{text-transform:none;letter-spacing:.02em;font-size:.74em;color:var(--text-2)}",
      ".source-table th{text-transform:none;letter-spacing:.02em;font-size:.74em;color:var(--text-2)}",
      "th,td{border-bottom-color:var(--line)}",
      // 印刷页边
      "@page{margin:16mm}",
    ].join("\n"),
  };

  /** Focus — 沉浸阅读（v3.22）：单栏文档流。左侧 outline 变为顶部横向
   *  章节导轨（卡片横排、横向滚动），picture-flow 与 job 卡按文档顺序
   *  通栏排布，暖纸色衬线正文、大行距，适合从上读到下。 */
  const FOCUS_SPEC: ReportTemplateSpec = {
    id: "focus",
    layout: "reading",
    fontBody:
      '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Songti SC","Noto Serif CJK SC",serif',
    baseFontPx: 16,
    centerHeader: false,
    stickyHeader: true,
    boxedSections: true,
    flowTop: "78px",
    bg: "#f7f3e9",
    bg2: "#efe9db",
    panel: "#fdfaf3",
    panel2: "#f4efe2",
    panel3: "#eee7d6",
    text: "#33302a",
    text2: "#443f36",
    text3: "#6a6355",
    muted: "#857d6c",
    muted2: "#a89f8c",
    line: "#e2d9c6",
    line2: "#d3c8ae",
    link: "#31695c",
    linkHover: "#245247",
    linkUnderline: "hover",
    btnBg: "#31695c",
    btnText: "#f7f3e9",
    btnBorder: "#31695c",
    btnHoverBg: "#245247",
    micro: "#4a6b3a",
    microBg: "#f0f2e4",
    microBorder: "#c8d1b2",
    particle: "#8a5a1c",
    particleBg: "#f6eeda",
    particleBorder: "#dcc9a2",
    volume: "#31695c",
    volumeBg: "#eaf0ea",
    volumeBorder: "#b9cdc0",
    smallBg: "#f1ebdc",
    smallBorder: "#ddd2b9",
    radius: "6px",
    radiusSm: "5px",
    radiusLg: "8px",
    shadowSm: "0 1px 2px rgba(74,64,42,.05)",
    shadow: "0 8px 24px -12px rgba(74,64,42,.22)",
    rowHover: "#f4efe2",
    thBg: "#f1ebdc",
    extra: [
      // 阅读模式专属：章节导轨横排 + 文档节奏（布局分支在
      // buildTemplateCss 的 layout==="reading" 段生成，这里只做点缀）。
      "header{border-bottom:2px solid var(--line-2)}",
      ".title h1{font-size:1.62em;letter-spacing:-.008em}",
      // 阅读节奏：卡片间更大呼吸 + 段落式开节
      ".cards{gap:22px;padding:20px 22px}",
      "h3{letter-spacing:.1em}",
      // 阅读模式的图注使用衬线斜体（与正文同族）
      ".imgbox figcaption{font-style:italic}",
      "@page{margin:14mm}",
    ].join("\n"),
  };

  /** Font-scale multipliers for the v3.17+ skins. */
  const REPORT_FONT_SCALE_MULT: Record<ReportFontScale, number> = {
    compact: 0.9,
    standard: 1,
    comfortable: 1.14,
  };

  /** Generate the full v3.17 stylesheet for one skin. Covers every class the
   *  body markup emits (outline / picture-flow / job cards / tables / image
   *  grids / map cells / gone-markers / responsive + print).
   *  v3.20 — full-width layout (widthMode), wider auto-fill image grids,
   *  larger media frames, 3-level visual layering (page → pane → inset
   *  boxes), sticky slim headers for minimal/slate, unified scrollbar +
   *  focus styling, and per-template flourish blocks in spec.extra. */
  /** v3.23: per-skin lightbox tints. The lightbox STRUCTURE (stage / bar /
   *  nav buttons / spinner) is shared; the backdrop tone, chrome colors and
   *  caption typography follow each template's archetype so the enlarged
   *  view still reads as part of the same design system. Every skin uses a
   *  dark scrim (micrographs are dark — light backdrops kill contrast),
   *  but with the palette's own temperature and accent. */
  interface LightboxTint {
    back: string;
    text: string;
    muted: string;
    well: string;
    btnBg: string;
    btnLine: string;
    /** v3.23 r3: button glyph color — defaults to `text`, but LIGHT button
     *  chrome (paper's white buttons) needs a dark glyph or the ✕/‹/› are
     *  nearly invisible (the VLM "导航按钮难以辨识" finding). */
    btnText?: string;
    /** extra per-skin lightbox css (caption typography, frame chrome) */
    extra?: string;
  }
  const LIGHTBOX_TINTS: Record<string, LightboxTint> = {
    // paper: mounted-print aesthetic — white mat + hairline frame, serif italic caption
    paper: {
      back: "rgba(22,19,16,.97)",
      text: "#f6f0e6",
      muted: "#b6a695",
      well: "#fcfaf6",
      // r4: dark translucent chrome (the WHITE buttons oscillated — r2
      // "invisible glyph", r3 "too strong vs dark backdrop"; dark chrome
      // matches every other skin while the white MAT frame keeps the
      // mounted-print signature).
      btnBg: "rgba(38,33,28,.92)",
      btnLine: "#a99a82",
      extra:
        ".lb-frame{padding:10px;background:#fcfaf6;border:1px solid #d8d0c1;box-shadow:0 34px 90px -22px rgba(0,0,0,.78)}\n" +
        ".lb-frame .lb-img{background:transparent}\n" +
        ".lb-cap{font-style:italic}\n",
    },
    // minimal: neutral graphite chrome, quiet
    minimal: {
      back: "rgba(8,9,10,.96)",
      text: "#f4f5f6",
      muted: "#8b9096",
      // r6: wells one step lighter than pure graphite — dark micrographs
      // need a distinguishable mat (the "图片区域为纯黑" VLM readings).
      well: "#1a1d21",
      btnBg: "rgba(24,26,28,.96)",
      btnLine: "#5a6066",
    },
    // slate: deep cool scrim, teal accent via --lb-accent
    slate: {
      back: "rgba(4,7,10,.97)",
      text: "#dfe7ee",
      muted: "#7e8a99",
      well: "#141b24",
      btnBg: "rgba(16,22,29,.97)",
      btnLine: "#3d4e5e",
    },
    // blueprint: graphite scrim, mono uppercase caption, squared chrome (radius 0)
    blueprint: {
      back: "rgba(9,11,13,.96)",
      text: "#e8e4da",
      muted: "#9a8f7c",
      well: "#181b1f",
      btnBg: "rgba(18,21,25,.97)",
      btnLine: "#7d868e",
      extra:
        ".lb-cap{font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.06em}\n" +
        ".lb-btn{border-radius:0}\n" +
        ".lb-btn:hover{box-shadow:0 0 0 1px var(--lb-accent) inset}\n",
    },
    // editorial: warm ink scrim, cream serif italic caption
    editorial: {
      back: "rgba(16,13,10,.97)",
      text: "#f3ead8",
      muted: "#a4906f",
      well: "#262017",
      btnBg: "rgba(30,25,18,.97)",
      btnLine: "#6a5c44",
      extra: ".lb-cap{font-style:italic}\n",
    },
    // focus: warm reading-room scrim, serif caption
    focus: {
      back: "rgba(15,12,8,.97)",
      text: "#efe7d8",
      muted: "#a89a82",
      well: "#241e15",
      btnBg: "rgba(28,23,16,.97)",
      btnLine: "#6e6250",
      extra: ".lb-cap{font-style:italic}\n",
    },
  };
  const LIGHTBOX_TINT_DEFAULT: LightboxTint = LIGHTBOX_TINTS.minimal;

  /** v3.23: shared lightbox stylesheet (structure identical across skins;
   *  colors from --lb-* tokens, accent from the skin's link color). Emitted
   *  by buildTemplateCss AND appended to the classic override so ALL
   *  templates support click-to-enlarge. */
  function buildLightboxCss(): string {
    return (
      ".lb-root{position:fixed;inset:0;z-index:900;display:none;flex-direction:column;background:var(--lb-back);color:var(--lb-text);-webkit-backdrop-filter:blur(12px) saturate(1.05);backdrop-filter:blur(12px) saturate(1.05)}\n" +
      ".lb-root.lb-on{display:flex;animation:lb-fade .18s ease}\n" +
      "@keyframes lb-fade{from{opacity:0}to{opacity:1}}\n" +
      ".lb-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:46px 64px 8px;overflow:hidden}\n" +
      // r4: the frame has a DEFINITE size and the img fills it with
      // object-fit:contain — small images upscale to use the screen (the
      // r3 "图片尺寸偏小，未充分利用屏幕空间" finding: a 96×72 source was
      // rendered at 96×72 because max-w/max-h never UPSCALE). Contain keeps
      // the aspect; the well color letterboxes around it.
      ".lb-frame{position:relative;display:flex;align-items:center;justify-content:center;width:min(92vw,1500px);height:calc(100vh - 148px);animation:lb-pop .2s ease;box-shadow:0 32px 90px -24px rgba(0,0,0,.6);border:1px solid var(--lb-btn-line)}\n" +
      "@keyframes lb-pop{from{opacity:0;transform:scale(.965)}to{opacity:1;transform:scale(1)}}\n" +
      ".lb-img{width:100%;height:100%;object-fit:contain;background:var(--lb-well);cursor:zoom-in;touch-action:none;-webkit-user-select:none;user-select:none;transform-origin:center}\n" +
      ".lb-img.lb-zoomed{cursor:zoom-out}\n" +
      ".lb-img.lb-dragging{cursor:grabbing}\n" +
      ".lb-load{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid var(--lb-btn-line);border-top-color:var(--lb-accent);border-radius:50%;animation:lb-spin .8s linear infinite;display:none;pointer-events:none}\n" +
      ".lb-load.lb-busy{display:block}\n" +
      "@keyframes lb-spin{to{transform:rotate(360deg)}}\n" +
      ".lb-bar{display:flex;align-items:center;gap:8px;padding:8px 20px 14px}\n" +
      ".lb-cap{flex:1;min-width:0;font-family:var(--font-ui);font-size:.8em;color:var(--lb-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n" +
      ".lb-cnt{flex-shrink:0;font-family:var(--font-mono);font-size:.72em;color:var(--lb-muted);letter-spacing:.08em}\n" +
      ".lb-hint{flex-shrink:0;font-size:.66em;color:var(--lb-muted);letter-spacing:.04em;opacity:.85}\n" +
      ".lb-btn{position:fixed;top:50%;transform:translateY(-50%);width:46px;height:46px;display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:700;line-height:1;border-radius:var(--radius);border:1.5px solid var(--lb-btn-line);background:var(--lb-btn-bg);color:var(--lb-btn-text,var(--lb-text));cursor:pointer;padding:0;transition:border-color .15s ease,color .15s ease,box-shadow .15s ease}\n" +
      ".lb-btn:hover{border-color:var(--lb-accent);color:var(--lb-accent);box-shadow:0 0 0 1px var(--lb-accent)}\n" +
      ".lb-prev{left:16px}\n" +
      ".lb-next{right:16px}\n" +
      ".lb-close{top:16px;right:16px;transform:none;width:44px;height:44px;font-size:19px;font-weight:700;box-shadow:0 6px 22px -6px rgba(0,0,0,.45)}\n" +
      ".lb-root :focus-visible{outline:2px solid var(--lb-accent);outline-offset:2px}\n" +
      "@media(max-width:640px){.lb-stage{padding:52px 10px 6px}.lb-prev{left:6px}.lb-next{right:6px}.lb-hint{display:none}}\n"
    );
  }

  function buildTemplateCss(
    spec: ReportTemplateSpec,
    fontPx: number,
    widthMode: ReportWidthMode = "full"
  ): string {
    const tint = LIGHTBOX_TINTS[spec.id] ?? LIGHTBOX_TINT_DEFAULT;
    const linkDeco =
      spec.linkUnderline === "always"
        ? "text-decoration:underline"
        : "text-decoration:none";
    const linkHoverDeco = spec.linkUnderline === "none" ? "" : "text-decoration:underline";
    const widthCap =
      widthMode === "boxed"
        ? "max-width:1280px;"
        : widthMode === "wide"
          ? "max-width:1680px;"
          : "";
    const headerCss = spec.centerHeader
      ? ".top{display:block;text-align:center}"
      : ".top{display:flex;align-items:center;gap:20px;padding:15px 28px}";
    const stickyCss = spec.stickyHeader ? "position:sticky;top:0;z-index:50" : "";
    // Boxed sections (minimal/slate): media/map blocks become inset panels on
    // panel-2 — the visible "card inside card" layering. Paper keeps the open
    // hairline-section look of a printed document.
    const sectionCss = spec.boxedSections
      ? ".source-block,.media-block,.map-block{margin-top:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);padding:14px 16px}\n"
      : ".source-block,.media-block,.map-block{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}\n";
    const flowMax = spec.stickyHeader ? "calc(100vh - 94px)" : "calc(100vh - 32px)";
    // v3.22 layout archetype switch. "reading" (focus) reflows the shared
    // markup into a single-column document: the outline+flow pane becomes
    // a static full-width document head whose stages lay out as a
    // horizontally scrolling chapter rail; "split" keeps the v3.20
    // two-pane workspace with a sticky left rail.
    const isReading = spec.layout === "reading";
    const workspaceCss = isReading
      ? 
        // reading: document flow — no two-pane grid, no sticky rail
        `.workspace{${widthCap}margin:0 auto;display:block;padding:22px clamp(18px,3vw,52px) 72px;width:100%}\n` +
        ".flow-pane{position:relative;top:auto;max-height:none;overflow:visible}\n" +
        // chapter rail: stages side-by-side, horizontal scroll + snap.
        // v3.22 review fix: stretch (not flex-start) — the stage boxes
        // share the band height so shorter stages don't leave dead space
        // beside taller ones (content stays top-aligned inside).
        ".outline{display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;align-items:stretch}\n" +
        ".stage{flex:0 0 min(340px,82vw);margin-bottom:0;scroll-snap-align:start}\n" +
        ".stage-arrow{display:none}\n" +
        ".chain-pane{margin-top:22px}\n" +
        // v3.22 review fix: the picture-flow stops being a tall vertical
        // stack (huge dead space at full width) and becomes a responsive
        // "chapter board" — pf-start + each round sit side-by-side in an
        // auto-fit grid; the flow arrows are hidden because grid adjacency
        // IS the reading order here. Each cell keeps its internal vertical
        // step order (particle steps → select → classes → final).
        ".picture-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:14px;align-items:start}\n" +
        ".picture-head{grid-column:1/-1}\n" +
        ".pf-arrow{display:none}\n" +
        ".pf-start,.pf-round{margin:0}\n"
      : 
        // split: two-pane workspace (v3.20 full-width layout)
        `.workspace{${widthCap}margin:0 auto;display:grid;grid-template-columns:minmax(360px,min(24vw,540px)) minmax(0,1fr);gap:24px;padding:24px clamp(20px,2.5vw,44px) 64px;width:100%;align-items:start}\n` +
        `.flow-pane{position:sticky;top:${spec.flowTop};max-height:${flowMax};overflow:auto}\n`;
    return (
      `:root{--bg:${spec.bg};--bg-2:${spec.bg2};--panel:${spec.panel};--panel-2:${spec.panel2};--panel-3:${spec.panel3};--text:${spec.text};--text-2:${spec.text2};--text-3:${spec.text3};--muted:${spec.muted};--muted-2:${spec.muted2};--line:${spec.line};--line-2:${spec.line2};--micro:${spec.micro};--micro-bg:${spec.microBg};--micro-border:${spec.microBorder};--particle:${spec.particle};--particle-bg:${spec.particleBg};--particle-border:${spec.particleBorder};--volume:${spec.volume};--volume-bg:${spec.volumeBg};--volume-border:${spec.volumeBorder};--small-bg:${spec.smallBg};--small-border:${spec.smallBorder};--radius:${spec.radius};--radius-sm:${spec.radiusSm};--radius-lg:${spec.radiusLg};--font-ui:${spec.fontBody};--font-mono:${REPORT_FONT_MONO};--shadow-sm:${spec.shadowSm};--shadow:${spec.shadow};--link:${spec.link};--link-hover:${spec.linkHover};--th-bg:${spec.thBg};--row-hover:${spec.rowHover};--btn-bg:${spec.btnBg};--btn-text:${spec.btnText};--btn-border:${spec.btnBorder};--btn-hover-bg:${spec.btnHoverBg};--lb-back:${tint.back};--lb-text:${tint.text};--lb-muted:${tint.muted};--lb-well:${tint.well};--lb-btn-bg:${tint.btnBg};--lb-btn-line:${tint.btnLine};--lb-btn-text:${tint.btnText ?? tint.text};--lb-accent:${spec.link}}\n` +
      "*{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}\n" +
      "html{scroll-behavior:smooth;background:var(--bg)}\n" +
      `body{background:var(--bg);color:var(--text);font:${fontPx}px/1.62 var(--font-ui);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;min-height:100vh}\n` +
      "img{max-width:100%}\n" +
      // v3.23: every report image is click-to-enlarge (lightbox) — show the
      // zoom-in affordance on hover so users discover it.
      "main img{cursor:zoom-in}\n" +
      `a{color:var(--link);${linkDeco}}\n` +
      `a:hover{color:var(--link-hover);${linkHoverDeco}}\n` +
      ":focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:2px}\n" +
      "::-webkit-scrollbar{width:9px;height:9px}\n" +
      "::-webkit-scrollbar-track{background:transparent}\n" +
      "::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:5px}\n" +
      "::-webkit-scrollbar-thumb:hover{background:var(--muted-2)}\n" +
      `header{background:var(--panel);border-bottom:1px solid var(--line);${stickyCss}}\n` +
      `${headerCss}\n` +
      ".title h1{font-size:1.42em;font-weight:700;letter-spacing:-.012em;line-height:1.25;color:var(--text)}\n" +
      ".title p{margin-top:7px;color:var(--muted);font-size:.84em;letter-spacing:.01em}\n" +
      ".title p b{color:var(--text-3);font-weight:600;font-variant-numeric:tabular-nums}\n" +
      ".title .note{margin-top:5px;color:var(--text-3);font-size:.84em;font-style:italic}\n" +
      // v3.20: FULL-WIDTH workspace — no 1240px cap by default. The left
      // outline pane is proportional (capped at 540px so it never gets
      // absurd on ultra-wide monitors); the chain pane takes the rest.
      // v3.22: layout archetype comes from workspaceCss — split (two-pane
      // grid + sticky rail) or reading (single-column document + horizontal
      // chapter rail).
      workspaceCss +
      ".pane{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);overflow:hidden}\n" +
      ".flow-pane::-webkit-scrollbar{width:6px}\n" +
      ".flow-pane::-webkit-scrollbar-track{background:transparent}\n" +
      ".flow-pane::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:3px}\n" +
      ".flow-pane::-webkit-scrollbar-thumb:hover{background:var(--muted-2)}\n" +
      ".pane-head,.chain-head{display:flex;align-items:baseline;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel-2)}\n" +
      ".pane-head h2,.chain-head h2{margin:0;font-size:.8em;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}\n" +
      ".chain-head .hint{color:var(--text-3);margin-left:auto;font-size:.78em;font-weight:400;letter-spacing:0;text-transform:none}\n" +
      ".legend{display:flex;gap:14px;margin-left:auto}\n" +
      ".legend span{display:inline-flex;align-items:center;gap:6px;font-size:.7em;font-weight:600;color:var(--text-3);letter-spacing:.05em;text-transform:uppercase}\n" +
      ".legend span::before{content:\"\";width:9px;height:9px;border-radius:2px;background:var(--kc,var(--muted-2))}\n" +
      ".legend .micrograph{--kc:var(--micro)}\n" +
      ".legend .particle{--kc:var(--particle)}\n" +
      ".legend .volume{--kc:var(--volume)}\n" +
      ".outline{padding:14px}\n" +
      ".stage{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);padding:12px;margin-bottom:10px}\n" +
      ".stage h3{margin:0 0 10px;font-size:.7em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.09em}\n" +
      // v3.21: the phase label sits ABOVE the grid (not in a 92px side
      // column) so the stage-grid gets the full stage width, and the grid
      // min is 140px → 2 mini-nodes per row at every width mode (the old
      // 92px + minmax(190px) combo rendered one job per row in the left
      // outline — the user's "左侧每行只显示一个 job 浪费空间" complaint).
      ".phase{border-top:1px solid var(--line);padding-top:9px;margin-top:9px}\n" +
      ".phase:first-of-type{border-top:0;padding-top:0;margin-top:0}\n" +
      ".phase-label{display:inline-block;margin:2px 0 6px;font-size:.68em;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;line-height:1.35}\n" +
      ".stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}\n" +
      // v3.21: compact vertical mini-node tile — uid / type / metric stack,
      // ref pills wrap below (the old side-by-side pill column needed a
      // ~200px card; the 2-per-row grid yields ~145-200px per tile).
      ".mini-node{display:flex;flex-direction:column;border:1px solid var(--line-2);border-radius:var(--radius);background:var(--panel);padding:8px 10px 8px 12px;color:var(--text);cursor:default;position:relative;overflow:hidden;transition:border-color .15s ease}\n" +
      ".mini-node::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--kc,var(--muted-2))}\n" +
      // v3.23 VLM pass: the left-rail mini-nodes read as "too many colored
      // cards" (paper/blueprint/slate/classic reviews) — the kind tiles now
      // stay NEUTRAL (panel bg + normal border); the kind shows through the
      // 3px left stripe AND the mono uid picking up the kind color. Calmer
      // rail, same instant color-coding.
      ".mini-node.micrograph{--kc:var(--micro)}\n" +
      ".mini-node.particle{--kc:var(--particle)}\n" +
      ".mini-node.volume{--kc:var(--volume)}\n" +
      ".mini-node.micrograph b{color:var(--micro)}\n" +
      ".mini-node.particle b{color:var(--particle)}\n" +
      ".mini-node.volume b{color:var(--volume)}\n" +
      ".mini-node:hover{border-color:var(--line-2)}\n" +
      ".mini-node b{font-size:.82em;font-weight:700;color:var(--text);font-family:var(--font-mono);line-height:1.3}\n" +
      ".mini-node span{font-size:.68em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-2);margin-top:1px}\n" +
      ".mini-node em{font-style:normal;font-size:.64em;color:var(--muted);margin-top:2px;line-height:1.35}\n" +
      ".mini-node p{margin:4px 0 0;display:flex;flex-wrap:wrap;gap:3px}\n" +
      ".ref-pill{display:block;border-radius:3px;padding:1px 5px;min-width:26px;text-align:center;font-size:.62em;line-height:1.2;font-style:normal;font-weight:700;border:1px solid;white-space:nowrap;letter-spacing:.02em;font-family:var(--font-mono)}\n" +
      ".ref-pill.exposure,.ref-pill.micrograph{color:var(--micro);background:var(--micro-bg);border-color:var(--micro-border)}\n" +
      ".ref-pill.particle{color:var(--particle);background:var(--particle-bg);border-color:var(--particle-border)}\n" +
      ".ref-pill.volume{color:var(--volume);background:var(--volume-bg);border-color:var(--volume-border)}\n" +
      ".ref-pill.template,.ref-pill.other{color:var(--muted);background:var(--small-bg);border-color:var(--small-border)}\n" +
      ".stage-arrow{text-align:center;color:var(--muted-2);font-weight:600;font-size:14px;margin:-2px 0 8px}\n" +
      ".picture-flow{margin:14px 0 0;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel);padding:14px 16px}\n" +
      ".picture-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px}\n" +
      ".picture-head h2{margin:0;font-size:.8em;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}\n" +
      ".picture-head span{font-size:.72em;color:var(--text-3)}\n" +
      ".pf-start,.pf-round,.pf-step,.pf-map-job,.pf-final{background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:0 0 12px;transition:border-color .15s ease}\n" +
      ".pf-start:hover,.pf-round:hover,.pf-step:hover,.pf-map-job:hover,.pf-final:hover{border-color:var(--line-2)}\n" +
      ".pf-big{font-size:1.15em;font-weight:700;color:var(--text);text-align:center;font-family:var(--font-mono);letter-spacing:-.01em}\n" +
      ".pf-note{font-size:.78em;color:var(--text-3);line-height:1.55;text-align:center;margin-top:5px}\n" +
      ".pf-mic-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:10px 0}\n" +
      ".pf-mic-imgs img{width:100%;aspect-ratio:4/3;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}\n" +
      ".pf-arrow{text-align:center;font-size:15px;line-height:1;color:var(--muted-2);margin:6px 0 10px}\n" +
      ".pf-round-head h3{margin:0 0 10px;font-size:.95em;font-weight:700;color:var(--text)}\n" +
      ".pf-subhead{font-size:.68em;font-weight:700;text-align:center;margin:0 0 8px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em}\n" +
      ".pf-particle-steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin-bottom:10px}\n" +
      ".pf-particle-step{display:block;border:1px solid var(--line);border-left:3px solid var(--particle);border-radius:var(--radius);background:var(--panel);padding:11px;color:var(--text);transition:border-color .15s ease}\n" +
      ".pf-particle-step:hover{border-color:var(--line-2)}\n" +
      ".pf-particle-step b{display:block;font-size:.85em;font-weight:700;font-family:var(--font-mono);color:var(--particle)}\n" +
      ".pf-particle-step span{display:block;font-size:.72em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-2);margin-top:3px}\n" +
      ".pf-particle-step em{display:block;font-style:normal;font-size:.72em;color:var(--muted);margin-top:2px}\n" +
      ".pf-step-title{font-weight:700;font-size:.75em;text-align:center;margin-bottom:6px;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;font-family:var(--font-mono)}\n" +
      ".pf-select-img img{display:block;width:100%;max-height:230px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin-top:8px}\n" +
      ".pf-classes{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:10px}\n" +
      ".pf-class{margin:0;padding:9px;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm);text-align:center;transition:border-color .15s ease}\n" +
      ".pf-class:hover{border-color:var(--line-2)}\n" +
      ".pf-class.selected{border-color:var(--particle);box-shadow:inset 0 0 0 1px var(--particle)}\n" +
      ".pf-class img{display:block;width:100%;height:110px;object-fit:contain;background:var(--bg-2);border-radius:3px}\n" +
      ".pf-class figcaption{font-size:.66em;color:var(--muted);margin-top:5px}\n" +
      ".pf-class b{display:block;font-size:.88em;font-weight:700;color:var(--text);margin-top:2px;font-family:var(--font-mono)}\n" +
      ".pf-class span{display:block;font-size:.66em;color:var(--muted)}\n" +
      ".pf-final-img img{display:block;width:min(420px,86%);max-width:100%;height:250px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin:10px auto}\n" +
      ".cards{padding:16px;display:grid;gap:16px}\n" +
      // v3.21: fixed sidebar track — clamp(180px,22%,280px) instead of
      // the old `auto`. The auto track sized to each card's 输出到 content
      // (218px for J1 vs 76px for the final node), so the main content
      // column had a DIFFERENT width in every job card (the user's "输出
      // 到这一栏的宽度不一致" complaint). A definite track resolves
      // identically for every card in the pane.
      ".job-card{display:grid;grid-template-columns:minmax(0,1fr) clamp(180px,22%,280px);gap:14px;border:1px solid var(--line);border-left:4px solid var(--jc,var(--muted-2));border-radius:var(--radius-lg);background:var(--panel);padding:16px 18px;position:relative;scroll-margin-top:92px;transition:border-color .18s ease,box-shadow .2s ease}\n" +
      ".job-card:hover{border-color:var(--line-2)}\n" +
      ".job-card.micrograph{--jc:var(--micro)}\n" +
      ".job-card.particle{--jc:var(--particle)}\n" +
      ".job-card.volume{--jc:var(--volume)}\n" +
      // v3.22: hairline under the card head — a clear head/body hierarchy
      // inside every job card (title+chips row vs. the section stack below).
      ".job-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:11px;border-bottom:1px solid var(--line)}\n" +
      ".job-head h2{margin:0;min-width:0;font-size:1.06em;font-weight:700;line-height:1.3;color:var(--text);letter-spacing:-.01em;font-family:var(--font-mono)}\n" +
      ".metrics{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}\n" +
      ".chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;border:1px solid var(--small-border);background:var(--small-bg);font-size:.72em;font-weight:600;white-space:nowrap;color:var(--text-2);font-family:var(--font-mono);letter-spacing:.01em}\n" +
      ".chip.micrograph{background:var(--micro-bg);border-color:var(--micro-border);color:var(--micro)}\n" +
      ".chip.particle{background:var(--particle-bg);border-color:var(--particle-border);color:var(--particle)}\n" +
      ".chip.volume,.chip.class{background:var(--volume-bg);border-color:var(--volume-border);color:var(--volume)}\n" +
      ".chip.aux{background:var(--small-bg);border-color:var(--small-border);color:var(--muted)}\n" +
      sectionCss +
      "h3{margin:0 0 8px;font-size:.7em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.09em}\n" +
      ".source-block,.media-block,.map-block{min-width:0}\n" +
      // v3.22 mobile fix: 4-column source tables exceed the narrow-screen
      // measure and were silently CLIPPED by .pane{overflow:hidden}. Give
      // the section its own horizontal scroll so the table stays reachable
      // (harmless on desktop — nothing overflows there).
      ".source-block{overflow-x:auto}\n" +
      ".source-table{width:100%;border-collapse:collapse;font-size:.84em;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--line)}\n" +
      ".source-table th,.source-table td{border-bottom:1px solid var(--line);padding:6px 10px;vertical-align:middle;text-align:left}\n" +
      ".source-table tr:last-child td{border-bottom:0}\n" +
      ".source-table th{background:var(--th-bg);color:var(--text-3);font-weight:700;font-size:.68em;text-transform:uppercase;letter-spacing:.07em}\n" +
      ".source-table tr:hover td{background:var(--row-hover)}\n" +
      ".kind-cell{width:56px;text-align:center;font-weight:700}\n" +
      ".kind-cell i{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:middle}\n" +
      ".kind-cell.exposure i{background:var(--micro)}\n" +
      ".kind-cell.particle i{background:var(--particle)}\n" +
      ".kind-cell.volume i{background:var(--volume)}\n" +
      ".kind-cell.template i,.kind-cell.other i{background:var(--muted-2)}\n" +
      ".source-table em{font-style:normal;color:var(--muted);margin-left:6px;font-size:.78em}\n" +
      ".up-cell{color:var(--text-2);line-height:1.55}\n" +
      ".up-route{display:block;font-weight:600;color:var(--text);border-bottom:1px solid var(--line-2);margin-bottom:5px;padding-bottom:4px;font-size:.84em;font-family:var(--font-mono)}\n" +
      ".up-list{display:grid;gap:4px}\n" +
      ".up-line{display:block;font-size:.84em;color:var(--text-3)}\n" +
      ".job-out{border-left:2px solid var(--line);padding-left:14px;color:var(--text-2);min-width:0}\n" +
      ".job-out h3{white-space:nowrap}\n" +
      // v3.21: the final-node placeholder renders as a quiet pill so the
      // fixed-width sidebar looks intentional, not empty.
      ".job-out .quiet{display:inline-block;margin-top:2px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:.72em;font-weight:600;font-style:normal;color:var(--muted);letter-spacing:.03em}\n" +
      ".job-out div{margin:0 0 5px;padding:6px 10px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);font-size:.84em;transition:border-color .15s ease}\n" +
      ".job-out div:hover{border-color:var(--line-2);background:var(--panel-3)}\n" +
      ".quiet{color:var(--muted);font-style:italic}\n" +
      ".class-toolbar{margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n" +
      ".class-toolbar span{font-weight:600;font-size:.84em;color:var(--text-2);margin-right:auto}\n" +
      ".classes{margin-top:8px;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:auto}\n" +
      "table{width:100%;border-collapse:collapse;font-size:.84em}\n" +
      "th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}\n" +
      "th{background:var(--th-bg);color:var(--text-3);font-weight:700;font-size:.68em;text-transform:uppercase;letter-spacing:.06em}\n" +
      "tr:hover td{background:var(--row-hover)}\n" +
      ".horizontal-table th:first-child{left:0;position:sticky;z-index:2;background:var(--th-bg)}\n" +
      ".horizontal-table td,.horizontal-table th{min-width:88px;text-align:center}\n" +
      ".download-head{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}\n" +
      ".download-head b{font-size:.84em}\n" +
      ".download-all{border:1px solid var(--btn-border);background:var(--btn-bg);color:var(--btn-text);border-radius:var(--radius-sm);padding:7px 16px;font-size:.76em;font-weight:700;cursor:pointer;font-family:var(--font-mono);letter-spacing:.02em;transition:background-color .15s ease,color .15s ease,transform .1s ease}\n" +
      ".download-all:hover{background:var(--btn-hover-bg)}\n" +
      ".download-all:active{transform:translateY(1px)}\n" +
      ".download-links{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}\n" +
      ".download-links a{padding:5px 12px;border:1px solid var(--line-2);border-radius:999px;font-size:.72em;font-weight:600;color:var(--text-2);font-family:var(--font-mono);text-decoration:none;transition:border-color .15s ease,color .15s ease}\n" +
      ".download-links a:hover{border-color:var(--link);color:var(--link);text-decoration:none}\n" +
      ".imgs{display:flex;gap:12px;flex-wrap:wrap}\n" +
      ".imgs-c{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:10px}\n" +
      ".cls-sec{margin-top:8px}\n" +
      ".cls-head{display:flex;align-items:center;gap:8px;margin:2px 0 6px;font-size:.66em;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em}\n" +
      ".cls-head .cnt{margin-left:auto;font-weight:500;color:var(--muted);font-family:var(--font-mono);font-size:1em}\n" +
      ".imgbox{flex:1 1 240px;min-width:200px;max-width:480px;margin:0;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);transition:border-color .15s ease}\n" +
      ".imgbox:hover{border-color:var(--line-2)}\n" +
      ".imgbox img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-sm)}\n" +
      ".imgbox figcaption{margin-top:6px;font-size:.72em;color:var(--muted);font-weight:500;font-family:var(--font-mono);display:flex;gap:6px;align-items:baseline;justify-content:space-between}\n" +
      ".imgbox.sm{padding:6px;border-radius:var(--radius-sm)}\n" +
      ".imgbox.sm img{border-radius:3px}\n" +
      ".imgbox.sm figcaption{margin-top:4px;font-size:.66em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}\n" +
      ".class-preview,.map-preview{max-width:130px;max-height:96px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}\n" +
      ".map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:10px}\n" +
      ".map-cell{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:9px;text-align:center;transition:border-color .15s ease,transform .15s ease}\n" +
      ".map-cell:hover{border-color:var(--line-2)}\n" +
      ".map-cell-img{display:flex;align-items:center;justify-content:center;height:130px;background:var(--bg-2);border-radius:var(--radius-sm);overflow:hidden}\n" +
      ".map-cell-img .map-preview{max-width:100%;max-height:130px;width:auto;height:auto}\n" +
      ".map-cell-none{display:flex;align-items:center;justify-content:center;height:130px;background:var(--bg-2);border-radius:var(--radius-sm);color:var(--muted);font-size:.68em}\n" +
      ".map-cell-name{margin-top:6px;font-size:.7em;color:var(--text-2);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n" +
      ".map-dl{display:inline-block;margin-top:4px;font-size:.7em;font-weight:700;color:var(--link);text-decoration:underline}\n" +
      ".map-dl:hover{color:var(--link-hover)}\n" +
      ".img-gone{display:none!important}\n" +
      ".imgs-block.block-gone{display:none!important}\n" +
      "@media(max-width:1180px){.workspace{grid-template-columns:1fr;width:100%}.flow-pane{position:relative;top:auto;max-height:none}.job-card{grid-template-columns:minmax(0,1fr)}.metrics{margin-left:0}}\n" +
      "@media print{header{position:static}.workspace{grid-template-columns:1fr;padding:0}.flow-pane{position:relative;top:auto;max-height:none;overflow:visible}.download-all,.download-links,.lb-root,.lb-btn{display:none!important}a{color:inherit}}\n" +
      // v3.23 lightbox (click-to-enlarge) — shared structure + skin tint.
      // Comes AFTER the print rule; the print block above already hides it.
      buildLightboxCss() +
      (tint.extra ?? "") +
      (spec.extra ? `${spec.extra}\n` : "")
    );
  }

  /** Token-driven skin registry — v3.22. Keyed by every non-classic
   *  ReportTemplateId so the dispatch below can never fall through to a
   *  wrong default when a new id is added (the classic skin keeps its own
   *  legacy stylesheet above). */
  const REPORT_TEMPLATE_SPECS: Record<
    Exclude<ReportTemplateId, "classic">,
    ReportTemplateSpec
  > = {
    paper: PAPER_SPEC,
    minimal: MINIMAL_SPEC,
    slate: SLATE_SPEC,
    blueprint: BLUEPRINT_SPEC,
    editorial: EDITORIAL_SPEC,
    focus: FOCUS_SPEC,
  };

  /** Resolve the stylesheet for any template id (classic = legacy CSS).
   *  v3.20: the token skins take a widthMode (default "full" — the
   *  workspace spans the whole viewport; "wide"/"boxed" cap it at
   *  1680/1280px for users who prefer a reading measure).
   *  v3.22: dispatch through REPORT_TEMPLATE_SPECS — six token skins
   *  (paper/minimal/slate/blueprint/editorial/focus). */
  export function buildReportCss(
    template: ReportTemplateId = "paper",
    fontScale: ReportFontScale = "standard",
    widthMode: ReportWidthMode = "full",
  ): string {
    if (template === "classic") {
      const mult = REPORT_FONT_SCALE_MULT[fontScale] ?? 1;
      // Same-specificity later rules override the legacy `font:14px/1.6 …`
      // shorthand; append only when a non-default scale is requested.
      // v3.20: classic is full-width by design (the legacy workspace never
      // had a max-width); the widthMode override is appended for wide/boxed
      // so classic users get the same width control.
      const widthOverride =
        widthMode === "boxed" || widthMode === "wide"
          ? `.workspace{max-width:${widthMode === "boxed" ? 1280 : 1680}px;margin:0 auto}\n`
          : "";
      // v3.21: classic gets the same LAYOUT fixes as the v3.17 templates
      // (appended, same-specificity-later-wins): the left outline shows 2
      // mini-nodes per row (phase label above the grid, 140px auto-fill,
      // compact flex tiles) and every job card's 输出到 sidebar sits in a
      // fixed clamp(180px,22%,280px) track so the main column width is
      // identical across cards. The legacy gradient look is untouched.
      const layoutOverride =
        ".phase{display:block}\n" +
        ".phase-label{padding-top:0;margin:0 0 6px}\n" +
        ".stage-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}\n" +
        ".mini-node{display:flex;flex-direction:column;min-height:0;padding:8px 10px 8px 12px}\n" +
        ".mini-node::before{opacity:1}\n" +
        ".mini-node b,.mini-node span,.mini-node em{grid-column:auto}\n" +
        ".mini-node p{grid-column:auto;grid-row:auto;display:flex;flex-wrap:wrap;justify-content:flex-start;align-content:flex-start;min-width:0;margin:4px 0 0}\n" +
        ".job-card{grid-template-columns:minmax(0,1fr) clamp(180px,22%,280px)}\n" +
        ".job-out .quiet{display:inline-block;margin-top:2px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:600;font-style:normal}\n";
      // v3.23: classic gets the lightbox too — tokens resolve against the
      // classic :root (--brand teal accent), structure identical to the
      // token skins. main-img cursor + print-hide included.
      const lightboxOverride =
        ":root{--lb-back:rgba(6,9,14,.96);--lb-text:#eef2f6;--lb-muted:#9aa5bd;--lb-well:#161d27;--lb-btn-bg:rgba(18,24,34,.97);--lb-btn-line:#55667a;--lb-accent:var(--brand)}\n" +
        "main img{cursor:zoom-in}\n" +
        buildLightboxCss() +
        "@media print{.lb-root,.lb-btn{display:none!important}}\n" +
        // v3.23 VLM pass: classic left rail gets the same calm mini-nodes
        // (neutral tile + colored stripe + colored uid) and slightly more
        // line-height for the dense data lists.
        ".mini-node.micrograph,.mini-node.particle,.mini-node.volume{background:var(--panel);border-color:var(--line)}\n" +
        ".mini-node.micrograph b{color:var(--micro)}\n" +
        ".mini-node.particle b{color:var(--particle)}\n" +
        ".mini-node.volume b{color:var(--volume)}\n" +
        "body{line-height:1.65}\n";
      const override = `${mult !== 1 ? `body{font-size:${Math.round(14 * mult * 10) / 10}px}\n` : ""}.title .note{font-style:italic}\n${widthOverride}${layoutOverride}${lightboxOverride}`;
      return REPORT_HTML_V2_CSS + override;
    }
    const spec =
      REPORT_TEMPLATE_SPECS[template as Exclude<ReportTemplateId, "classic">] ??
      PAPER_SPEC;
    const fontPx = Math.round(spec.baseFontPx * (REPORT_FONT_SCALE_MULT[fontScale] ?? 1) * 10) / 10;
    return buildTemplateCss(spec, fontPx, widthMode);
  }

  /* ================================================================== */
  /*  V2 main entry point                                                */
  /* ================================================================== */

  /** Inline `<style>` block (verbatim from popup.js — single CSS string). */
  const REPORT_HTML_V2_CSS = `:root{--bg:#f8fafc;--bg-2:#f1f5f9;--panel:#ffffff;--panel-2:#f8fafc;--panel-3:#f1f5f9;--text:#0f172a;--text-2:#1e293b;--text-3:#475569;--muted:#64748b;--muted-2:#94a3b8;--line:#e2e8f0;--line-2:#cbd5e1;--line-3:#94a3b8;--micro:#0891b2;--micro-2:#06b6d4;--micro-bg:#ecfeff;--micro-border:#a5f3fc;--micro-glow:rgba(6,182,212,.12);--particle:#d97706;--particle-2:#f59e0b;--particle-bg:#fffbeb;--particle-border:#fde68a;--particle-glow:rgba(245,158,11,.12);--volume:#0d9488;--volume-2:#14b8a6;--volume-bg:#f0fdfa;--volume-border:#99f6e4;--volume-glow:rgba(13,148,136,.12);--brand:#0d9488;--brand-2:#14b8a6;--brand-emerald:#059669;--brand-cyan:#06b6d4;--small-bg:#f8fafc;--small-border:#cbd5e1;--shadow-sm:0 1px 2px 0 rgba(15,23,42,.04);--shadow:0 4px 12px -2px rgba(15,23,42,.06),0 2px 4px -1px rgba(15,23,42,.04);--shadow-lg:0 12px 32px -4px rgba(15,23,42,.08),0 4px 8px -2px rgba(15,23,42,.04);--shadow-xl:0 20px 40px -8px rgba(15,23,42,.1),0 8px 16px -4px rgba(15,23,42,.06);--radius:10px;--radius-sm:8px;--radius-lg:14px;--radius-xl:16px;--font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--font-mono:"SF Mono","JetBrains Mono",Monaco,"Cascadia Code","Roboto Mono",Consolas,monospace}.dark{--bg:#0a0e1a;--bg-2:#0f1420;--panel:#141a2a;--panel-2:#1a2138;--panel-3:#222b45;--text:#e8edf7;--text-2:#c4cee0;--text-3:#9aa5bd;--muted:#6b7794;--muted-2:#4a5470;--line:#1e2740;--line-2:#283353;--line-3:#323d5e;--micro:#22d3ee;--micro-2:#06b6d4;--micro-bg:rgba(34,211,238,.08);--micro-border:rgba(34,211,238,.3);--micro-glow:rgba(34,211,238,.15);--particle:#fbbf24;--particle-2:#f59e0b;--particle-bg:rgba(251,191,36,.08);--particle-border:rgba(251,191,36,.3);--particle-glow:rgba(251,191,36,.15);--volume:#2dd4bf;--volume-2:#14b8a6;--volume-bg:rgba(45,212,191,.08);--volume-border:rgba(45,212,191,.3);--volume-glow:rgba(45,212,191,.15);--brand:#2dd4bf;--brand-2:#14b8a6;--brand-emerald:#34d399;--brand-cyan:#22d3ee;--small-bg:rgba(148,163,184,.06);--small-border:rgba(148,163,184,.2);--shadow-sm:0 1px 2px 0 rgba(0,0,0,.3);--shadow:0 4px 16px -2px rgba(0,0,0,.4),0 2px 6px -1px rgba(0,0,0,.2);--shadow-lg:0 16px 48px -4px rgba(0,0,0,.5),0 6px 12px -2px rgba(0,0,0,.3);--shadow-xl:0 24px 64px -8px rgba(0,0,0,.6),0 8px 16px -4px rgba(0,0,0,.3)}*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;background:var(--bg)}body{background:var(--bg);background-image:radial-gradient(ellipse 600px 400px at 15% 0%,rgba(13,148,136,.06) 0%,transparent 60%),radial-gradient(ellipse 600px 400px at 85% 100%,rgba(6,182,212,.05) 0%,transparent 60%),linear-gradient(180deg,var(--bg) 0%,var(--bg-2) 100%);background-attachment:fixed;color:var(--text);font:14px/1.6 var(--font-ui);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;min-height:100vh;transition:background-color .3s ease,color .3s ease}.dark body{background-image:radial-gradient(ellipse 600px 400px at 15% 0%,rgba(45,212,191,.05) 0%,transparent 60%),radial-gradient(ellipse 600px 400px at 85% 100%,rgba(34,211,238,.04) 0%,transparent 60%),linear-gradient(180deg,var(--bg) 0%,var(--bg-2) 100%)}a{color:var(--brand);text-decoration:none;transition:color .15s ease}a:hover{color:var(--brand-2);text-decoration:underline}header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.8);backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);border-bottom:1px solid var(--line);box-shadow:0 1px 0 0 rgba(13,148,136,.06)}.dark header{background:rgba(10,14,26,.8);border-bottom-color:var(--line-2);box-shadow:0 1px 0 0 rgba(45,212,191,.08),0 8px 32px -8px rgba(0,0,0,.5)}.top{min-height:72px;display:flex;align-items:center;gap:20px;padding:16px 24px;width:100%}.title h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em;background:linear-gradient(135deg,var(--text) 0%,var(--brand) 60%,var(--brand-cyan) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.title p{margin:6px 0 0;color:var(--text-3);font-size:13px;font-weight:500;letter-spacing:.01em}.title p b{color:var(--text-2);font-weight:600;font-variant-numeric:tabular-nums}.workspace{display:grid;grid-template-columns:minmax(360px,24vw) minmax(0,1fr);gap:20px;padding:20px 24px;width:100%;align-items:start}.pane{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-xl);box-shadow:var(--shadow);overflow:hidden;transition:border-color .2s ease,box-shadow .2s ease}.dark .pane{border-color:var(--line-2)}.flow-pane{position:sticky;top:88px;max-height:calc(100vh - 104px);overflow:auto;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}.flow-pane::-webkit-scrollbar{width:6px}.flow-pane::-webkit-scrollbar-track{background:transparent}.flow-pane::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:3px}.flow-pane::-webkit-scrollbar-thumb:hover{background:var(--muted-2)}.pane-head,.chain-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(13,148,136,.03) 0%,transparent 100%)}.dark .pane-head,.dark .chain-head{border-bottom-color:var(--line-2);background:linear-gradient(180deg,rgba(45,212,191,.04) 0%,transparent 100%)}.pane-head h2,.chain-head h2{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--text)}.chain-head .hint{color:var(--text-3);margin-left:auto;font-size:12px}.legend{display:flex;gap:6px;margin-left:auto}.legend span{padding:4px 10px;border-radius:999px;font-size:10px;font-weight:600;border:1px solid;letter-spacing:.02em;text-transform:uppercase}.legend .micrograph{color:var(--micro);background:var(--micro-bg);border-color:var(--micro-border)}.legend .particle{color:var(--particle);background:var(--particle-bg);border-color:var(--particle-border)}.legend .volume{color:var(--volume);background:var(--volume-bg);border-color:var(--volume-border)}.outline{padding:12px}.stage{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);padding:10px;margin-bottom:8px;transition:border-color .2s ease,box-shadow .2s ease}.dark .stage{border-color:var(--line-2);background:var(--panel-2)}.stage:hover{border-color:var(--line-2);box-shadow:var(--shadow-sm)}.dark .stage:hover{border-color:var(--line-3)}.stage h3{margin:0 0 10px;font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em}.phase{display:grid;grid-template-columns:88px minmax(0,1fr);gap:10px;align-items:start;border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.dark .phase{border-top-color:var(--line)}.phase:first-of-type{border-top:0;padding-top:0;margin-top:0}.phase-label{font-size:11px;font-weight:600;color:var(--text-3);line-height:1.3;padding-top:6px;letter-spacing:.02em;text-transform:uppercase}.stage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px}.mini-node{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;align-items:start;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:10px;min-height:68px;color:var(--text);transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;cursor:default;position:relative;overflow:hidden}.dark .mini-node{border-color:var(--line-2)}.mini-node::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--muted-2);opacity:0;transition:opacity .2s ease}.mini-node:hover{transform:translateY(-2px);border-color:var(--line-2);box-shadow:var(--shadow)}.dark .mini-node:hover{border-color:var(--line-3)}.mini-node.micrograph{border-color:var(--micro-border);background:var(--micro-bg)}.mini-node.micrograph::before{background:var(--micro);opacity:1}.mini-node.micrograph:hover{border-color:var(--micro);box-shadow:0 4px 16px -2px var(--micro-glow)}.mini-node.particle{border-color:var(--particle-border);background:var(--particle-bg)}.mini-node.particle::before{background:var(--particle);opacity:1}.mini-node.particle:hover{border-color:var(--particle);box-shadow:0 4px 16px -2px var(--particle-glow)}.mini-node.volume{border-color:var(--volume-border);background:var(--volume-bg)}.mini-node.volume::before{background:var(--volume);opacity:1}.mini-node.volume:hover{border-color:var(--volume);box-shadow:0 4px 16px -2px var(--volume-glow)}.mini-node.small,.mini-node.other{border-color:var(--small-border);background:var(--small-bg)}.mini-node b{font-size:14px;font-weight:700;display:block;grid-column:1;color:var(--text);letter-spacing:-.01em;font-family:var(--font-mono)}.mini-node span{font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:1;color:var(--text-2);font-weight:500;margin-top:2px}.mini-node em{font-style:normal;font-size:10px;color:var(--muted);display:block;grid-column:1;margin-top:3px;line-height:1.3}.mini-node p{grid-column:2;grid-row:1 / span 3;margin:0;display:grid;grid-template-columns:repeat(2,max-content);justify-content:end;align-content:start;gap:2px 3px;min-width:54px}.ref-pill{display:block;border-radius:4px;padding:1px 4px;min-width:26px;text-align:center;font-size:9px;line-height:1.2;font-style:normal;font-weight:700;border:1px solid;white-space:nowrap;letter-spacing:.02em;font-family:var(--font-mono)}.ref-pill.exposure,.ref-pill.micrograph{color:var(--micro);background:var(--micro-bg);border-color:var(--micro-border)}.ref-pill.particle{color:var(--particle);background:var(--particle-bg);border-color:var(--particle-border)}.ref-pill.volume{color:var(--volume);background:var(--volume-bg);border-color:var(--volume-border)}.ref-pill.template,.ref-pill.other{color:var(--muted);background:var(--small-bg);border-color:var(--small-border)}.stage-arrow{text-align:center;color:var(--muted-2);font-weight:600;font-size:16px;margin:-2px 0 6px}.picture-flow{margin:10px 0 0;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel);padding:12px;box-shadow:var(--shadow-sm)}.dark .picture-flow{border-color:var(--line-2)}.picture-head{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}.dark .picture-head{border-bottom-color:var(--line-2)}.picture-head h2{margin:0;font-size:14px;font-weight:600;color:var(--text)}.picture-head span{font-size:11px;color:var(--text-3);font-weight:500}.pf-start,.pf-round,.pf-step,.pf-map-job,.pf-final{background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius);padding:12px;margin:0 0 10px;transition:border-color .2s ease,box-shadow .2s ease}.dark .pf-start,.dark .pf-round,.dark .pf-step,.dark .pf-map-job,.dark .pf-final{border-color:var(--line-2)}.pf-start:hover,.pf-round:hover,.pf-step:hover,.pf-map-job:hover,.pf-final:hover{border-color:var(--line-2);box-shadow:var(--shadow-sm)}.dark .pf-start:hover,.dark .pf-round:hover,.dark .pf-step:hover,.dark .pf-map-job:hover,.dark .pf-final:hover{border-color:var(--line-3)}.pf-big{font-size:18px;font-weight:700;color:var(--text);text-align:center;letter-spacing:-.02em;font-family:var(--font-mono);background:linear-gradient(135deg,var(--text) 0%,var(--brand) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.pf-note{font-size:12px;color:var(--text-3);line-height:1.5;text-align:center;margin-top:4px}.pf-mic-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}.pf-mic-imgs img{width:100%;aspect-ratio:4/3;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}.dark .pf-mic-imgs img{border-color:var(--line-2)}.pf-arrow{text-align:center;font-size:18px;line-height:1;color:var(--muted-2);margin:4px 0 8px}.pf-round-head h3{margin:0 0 8px;font-size:15px;font-weight:600;color:var(--text);letter-spacing:-.01em}.pf-subhead{font-size:11px;font-weight:700;text-align:center;margin:0 0 6px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em}.pf-particle-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:8px}.pf-particle-step{display:block;border:1px solid var(--line);border-left:3px solid var(--particle);border-radius:var(--radius);background:var(--panel);padding:10px;color:var(--text);transition:transform .15s ease,box-shadow .15s ease}.dark .pf-particle-step{border-color:var(--line-2)}.pf-particle-step:hover{transform:translateY(-2px);box-shadow:0 4px 16px -2px var(--particle-glow)}.pf-particle-step b{display:block;font-size:13px;font-weight:700;font-family:var(--font-mono);color:var(--particle)}.pf-particle-step span{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-2);margin-top:3px}.pf-particle-step em{display:block;font-style:normal;font-size:11px;color:var(--muted);margin-top:2px}.pf-step-title{font-weight:700;font-size:12px;text-align:center;margin-bottom:4px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em;font-family:var(--font-mono)}.pf-select-img img{display:block;width:100%;max-height:170px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin-top:6px}.dark .pf-select-img img{border-color:var(--line-2)}.pf-classes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}.pf-class{margin:0;padding:8px;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-sm);text-align:center;min-height:0;transition:transform .15s ease,border-color .15s ease}.dark .pf-class{border-color:var(--line-2)}.pf-class:hover{transform:translateY(-2px);border-color:var(--line-2)}.dark .pf-class:hover{border-color:var(--line-3)}.pf-class.selected{border-color:var(--particle);box-shadow:0 0 0 1px var(--particle),0 4px 16px -2px var(--particle-glow)}.pf-class img{display:block;width:100%;height:78px;object-fit:contain;background:var(--bg-2);border-radius:4px}.pf-class figcaption{font-size:10px;color:var(--muted);margin-top:4px}.pf-class b{display:block;font-size:14px;font-weight:700;color:var(--text);margin-top:2px;font-family:var(--font-mono)}.pf-class span{display:block;font-size:10px;color:var(--muted)}.pf-final-img img{display:block;width:180px;max-width:100%;height:150px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2);margin:8px auto}.dark .pf-final-img img{border-color:var(--line-2)}.cards{padding:12px;display:grid;gap:10px}.job-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;border:1px solid var(--line);border-left:4px solid;border-radius:var(--radius-lg);background:var(--panel);padding:12px;box-shadow:var(--shadow-sm);transition:box-shadow .2s ease,transform .2s ease;position:relative}.dark .job-card{border-color:var(--line-2)}.job-card:hover{box-shadow:var(--shadow);transform:translateY(-2px)}.job-card.micrograph{border-left-color:var(--micro)}.job-card.micrograph:hover{box-shadow:var(--shadow),0 0 24px -4px var(--micro-glow)}.job-card.particle{border-left-color:var(--particle)}.job-card.particle:hover{box-shadow:var(--shadow),0 0 24px -4px var(--particle-glow)}.job-card.volume{border-left-color:var(--volume)}.job-card.volume:hover{box-shadow:var(--shadow),0 0 24px -4px var(--volume-glow)}.job-card.other{border-left-color:var(--muted-2)}.job-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.job-head h2{margin:0;min-width:0;font-size:16px;font-weight:700;line-height:1.2;color:var(--text);letter-spacing:-.01em;font-family:var(--font-mono)}.metrics{display:flex;flex-wrap:wrap;gap:6px}.chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel-2);font-size:11px;font-weight:600;white-space:nowrap;color:var(--text-2);transition:transform .1s ease;font-family:var(--font-mono);letter-spacing:.01em}.dark .chip{border-color:var(--line-2)}.chip:hover{transform:translateY(-1px)}.chip.micrograph{background:var(--micro-bg);border-color:var(--micro-border);color:var(--micro)}.chip.particle{background:var(--particle-bg);border-color:var(--particle-border);color:var(--particle)}.chip.volume,.chip.class{background:var(--volume-bg);border-color:var(--volume-border);color:var(--volume)}.chip.aux{background:var(--small-bg);border-color:var(--small-border);color:var(--muted)}.source-block,.media-block,.map-block{margin-top:10px;border-top:1px solid var(--line);padding-top:6px}.dark .source-block,.dark .media-block,.dark .map-block{border-top-color:var(--line-2)}h3{margin:0 0 6px;font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em}.source-table{width:100%;border-collapse:collapse;font-size:12px;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--line)}.dark .source-table{border-color:var(--line-2)}.source-table th,.source-table td{border-bottom:1px solid var(--line);padding:4px 8px;vertical-align:middle;text-align:left}.dark .source-table th,.dark .source-table td{border-bottom-color:var(--line)}.source-table tr:last-child td{border-bottom:0}.source-table th{background:var(--panel-3);color:var(--text-3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line-2)}.source-table tr:hover td{background:var(--panel-3)}.kind-cell{width:54px;text-align:center;font-weight:700}.kind-cell i{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:middle}.dark .kind-cell i{box-shadow:0 0 8px currentColor}.kind-cell.exposure i{background:var(--micro);color:var(--micro)}.kind-cell.particle i{background:var(--particle);color:var(--particle)}.kind-cell.volume i{background:var(--volume);color:var(--volume)}.kind-cell.template i,.kind-cell.other i{background:var(--muted-2);color:var(--muted-2)}.source-table em{font-style:normal;color:var(--muted);margin-left:6px;font-size:11px}.up-cell{color:var(--text-2);line-height:1.5}.up-route{display:block;font-weight:600;color:var(--text);border-bottom:1px solid var(--line-2);margin-bottom:4px;padding-bottom:3px;font-size:12px;font-family:var(--font-mono)}.up-list{display:grid;gap:3px}.up-line{display:block;font-size:12px;color:var(--text-3)}.job-out{border-left:2px solid var(--line);padding-left:12px;color:var(--text-2)}.dark .job-out{border-left-color:var(--line-2)}.job-out div{margin:0 0 4px;padding:5px 8px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);font-size:12px;transition:border-color .15s ease}.dark .job-out div{border-color:var(--line-2)}.job-out div:hover{border-color:var(--line-2);background:var(--panel-3)}.dark .job-out div:hover{border-color:var(--line-3)}.quiet{color:var(--muted);font-style:italic}.class-toolbar{margin-top:8px;display:flex;align-items:center;gap:6px}.class-toolbar span{font-weight:600;font-size:12px;color:var(--text-2);margin-right:auto}.classes{margin-top:6px;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:auto}.dark .classes{border-color:var(--line-2)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left}.dark th,.dark td{border-bottom-color:var(--line)}th{background:var(--panel-3);color:var(--text-3);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em}tr:hover td{background:var(--panel-3)}.horizontal-table th:first-child{left:0;position:sticky;z-index:2;background:var(--panel-3)}.horizontal-table td,.horizontal-table th{min-width:74px;text-align:center}.download-head{display:flex;align-items:center;gap:8px;margin-top:8px}.download-all{border:1px solid var(--brand);background:var(--brand);color:#fff;border-radius:var(--radius-sm);padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s ease;font-family:var(--font-mono);box-shadow:0 2px 8px -2px var(--volume-glow)}.dark .download-all{color:var(--bg)}.download-all:hover{background:var(--brand-2);border-color:var(--brand-2);box-shadow:0 4px 16px -2px var(--volume-glow);transform:translateY(-1px)}.download-links{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}.download-links a{padding:4px 10px;border:1px solid var(--volume-border);border-radius:var(--radius-sm);background:var(--volume-bg);font-size:11px;font-weight:500;color:var(--volume);transition:all .2s ease;font-family:var(--font-mono)}.download-links a:hover{background:var(--volume);color:#fff;box-shadow:0 2px 12px -2px var(--volume-glow);text-decoration:none;transform:translateY(-1px)}.dark .download-links a:hover{color:var(--bg)}.imgs{display:flex;gap:10px;flex-wrap:wrap}.imgs-c{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}.cls-sec{margin-top:6px}.cls-head{display:flex;align-items:center;gap:8px;margin:2px 0 4px;font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em}.cls-head .cnt{margin-left:auto;font-weight:500;color:var(--muted);font-family:var(--font-mono);font-size:10px}.imgbox{flex:1 1 180px;min-width:140px;max-width:240px;margin:0;padding:6px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2);transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}.dark .imgbox{border-color:var(--line-2)}.imgbox:hover{transform:translateY(-3px);border-color:var(--line-2);box-shadow:var(--shadow)}.dark .imgbox:hover{border-color:var(--line-3)}.imgbox img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--bg-2);border:1px solid var(--line);border-radius:var(--radius-sm)}.dark .imgbox img{border-color:var(--line-2)}.imgbox figcaption{margin-top:6px;font-size:11px;color:var(--muted);font-weight:500;font-family:var(--font-mono)}.imgbox.sm{padding:4px;border-radius:var(--radius-sm);transition:transform .12s ease,border-color .12s ease}.imgbox.sm:hover{transform:translateY(-2px)}.imgbox.sm img{border-radius:4px}.imgbox.sm figcaption{margin-top:3px;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.class-preview,.map-preview{max-width:94px;max-height:70px;object-fit:contain;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-2)}.dark .class-preview,.dark .map-preview{border-color:var(--line-2)}.map-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:6px}.map-cell{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel-2);padding:6px;text-align:center;transition:transform .15s ease,border-color .15s ease}.dark .map-cell{border-color:var(--line-2)}.map-cell:hover{transform:translateY(-2px);border-color:var(--line-2);box-shadow:var(--shadow-sm)}.dark .map-cell:hover{border-color:var(--line-3)}.map-cell-img{display:flex;align-items:center;justify-content:center;height:78px;background:var(--bg-2);border-radius:4px;overflow:hidden}.map-cell-img .map-preview{max-width:100%;max-height:78px;width:auto;height:auto}.map-cell-none{display:flex;align-items:center;justify-content:center;height:78px;background:var(--bg-2);border-radius:4px;color:var(--muted);font-size:10px}.map-cell-name{margin-top:4px;font-size:10.5px;color:var(--text-2);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.map-dl{display:inline-block;margin-top:3px;font-size:10.5px;font-weight:600;color:var(--volume)}.map-dl:hover{color:var(--brand-2)}.job-card{scroll-margin-top:88px}.img-gone{display:none!important}.imgs-block.block-gone{display:none!important}@media(max-width:1180px){.workspace{grid-template-columns:1fr;width:100%}.flow-pane{position:relative;top:auto}.job-card{grid-template-columns:minmax(0,1fr)}}`;

  /**
   * Inline `<script>`:
   *   1. `.download-all` buttons stagger the downloads per URL with 200ms
   *      delay (fetch → blob → <a download>, window.open fallback).
   *   2. Anchor navigation interceptor — every `a[href^="#card-..."]` click
   *      is prevented from its default fragment navigation and turned into
   *      a smooth scrollIntoView instead. CRITICAL inside the preview
   *      iframe: a srcDoc document has no URL of its own, so a plain
   *      `#fragment` click resolves against the PARENT page's URL and
   *      navigates the iframe to the web app itself — the user saw the
   *      report "disappear" into a nested copy of the UI. The interceptor
   *      also adds smooth scrolling + works identically in the downloaded
   *      standalone report.
   *   3. Height reporter — posts the document scrollHeight to the parent
   *      window so the preview iframe can auto-resize to fit the report
   *      (no cramped fixed-height iframe, no double scrollbar). Uses
   *      ResizeObserver on <body> + window resize + image load events,
   *      debounced so it doesn't spam the parent.
   * Embedded as a string so the final HTML page is fully standalone.
   *
   * NOTE: this string is REAL JavaScript parsed by the browser — a single
   * unbalanced brace silently kills the ENTIRE script (the renderer pasted
   * it through `new Function()` during review and found exactly that: the
   * click-listener arrow body was missing its closing `}`, so the IIFE below
   * was swallowed into it and the whole script threw `Unexpected token ')'`
   * — which broke BOTH the iframe auto-resize AND every 一键下载 button).
   * Keep it balanced; prefer appending statements rather than editing tails.
   */
  const REPORT_HTML_V2_SCRIPT = `document.addEventListener("click",(event)=>{const button=event.target.closest(".download-all");if(button){event.preventDefault();const urls=(button.dataset.urls||"").split("|").filter(Boolean);const names=(button.dataset.names||"").split("|").filter(Boolean);urls.forEach((url,index)=>{if(!url||url.startsWith("#"))return;const name=names[index]||url.split("/").pop()||"download";setTimeout(()=>{fetch(url).then(r=>{if(!r.ok){window.open(url,"_blank");return}return r.blob()}).then(blob=>{if(blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}}).catch(()=>window.open(url,"_blank"))},index*200);});}});document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest('a[href^="#"]');if(!a)return;var href=a.getAttribute("href");if(!href||href==="#")return;var el=document.getElementById(href.slice(1));if(el){e.preventDefault();try{el.scrollIntoView({behavior:"smooth",block:"start"});}catch(err){el.scrollIntoView();}}});`;
  // v3.23: the lightbox IIFE below is APPENDED as a third statement. It is
  // deliberately written with ZERO backslashes (no regex literals) — inside
  // this TS template literal an escape like \\s would silently degrade to
  // "s" at runtime and corrupt the script (see the markFailed comment for
  // the historical precedent). Keep it balanced; keep concat, no backticks.
  const REPORT_LIGHTBOX_SCRIPT = `(function(){"use strict";var root=null,im=null,cap=null,cnt=null,prevB=null,nextB=null,closeB=null,loadB=null;var list=[],idx=-1,scale=1,tx=0,ty=0,px=0,py=0,swx=0,swy=0,down=false,dragging=false,movedPx=0,lastFocus=null,cur=null;function collect(){var out=[],els=document.querySelectorAll("main img");for(var i=0;i<els.length;i++){var el=els[i];if(el.closest(".lb-root"))continue;if(el.closest(".img-gone,.block-gone"))continue;out.push(el);}return out;}function resolveSrc(el){var a=el.closest("a"),full=null;if(a){var h=a.getAttribute("href");if(h&&h.charAt(0)!=="#")full=h;}var disp=el.currentSrc||el.getAttribute("src")||"";return {full:full,disp:disp};}function captionOf(el){var t="",fig=el.closest("figure");if(fig){var fc=fig.querySelector("figcaption");if(fc){t=(fc.textContent||"").trim();while(t.length>1&&t.slice(-2)==="\\u6253\\u5f00")t=t.slice(0,-2).trim();}}if(!t){var mc=el.closest(".map-cell");if(mc){var mn=mc.querySelector(".map-cell-name");if(mn)t=mn.getAttribute("title")||mn.textContent||"";}}if(!t)t=el.getAttribute("alt")||"";var card=el.closest(".job-card");var uid="";if(card){var h2=card.querySelector(".job-head h2");if(h2)uid=(h2.textContent||"").trim();}return {t:t,uid:uid};}function ensure(){if(root)return;root=document.createElement("div");root.className="lb-root";root.setAttribute("role","dialog");root.setAttribute("aria-modal","true");root.setAttribute("aria-label","\\u56fe\\u7247\\u67e5\\u770b\\u5668\\uff08\\u70b9\\u51fb\\u56fe\\u7247\\u7f29\\u653e\\uff0cESC \\u5173\\u95ed\\uff09");root.innerHTML='<div class="lb-stage"><div class="lb-frame"><img class="lb-img" alt=""><div class="lb-load"></div></div></div><div class="lb-bar"><span class="lb-cap"></span><span class="lb-cnt"></span><span class="lb-hint">\\u70b9\\u51fb\\u7f29\\u653e \\u00b7 ESC \\u5173\\u95ed</span></div><button type="button" class="lb-btn lb-prev" aria-label="\\u4e0a\\u4e00\\u5f20">\\u2039</button><button type="button" class="lb-btn lb-next" aria-label="\\u4e0b\\u4e00\\u5f20">\\u203a</button><button type="button" class="lb-btn lb-close" aria-label="\\u5173\\u95ed\\uff08ESC\\uff09">\\u2715</button>';document.body.appendChild(root);im=root.querySelector(".lb-img");cap=root.querySelector(".lb-cap");cnt=root.querySelector(".lb-cnt");loadB=root.querySelector(".lb-load");prevB=root.querySelector(".lb-prev");nextB=root.querySelector(".lb-next");closeB=root.querySelector(".lb-close");im.addEventListener("load",function(){loadB.classList.remove("lb-busy");});im.addEventListener("error",function(){if(!root.classList.contains("lb-on"))return;if(cur&&cur.full&&im.getAttribute("src")!==cur.disp&&cur.disp){loadB.classList.add("lb-busy");cur.full=null;im.src=cur.disp;return;}loadB.classList.remove("lb-busy");im.removeAttribute("src");cap.textContent="\\u56fe\\u7247\\u52a0\\u8f7d\\u5931\\u8d25";});root.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest(".lb-btn"):null;if(b){e.preventDefault();e.stopPropagation();if(b===closeB)close();else if(b===prevB)show(idx-1);else show(idx+1);return;}if(e.target===im){if(movedPx<8){e.preventDefault();e.stopPropagation();toggleZoom(e.clientX,e.clientY);}return;}if(e.target===root||(e.target.classList&&(e.target.classList.contains("lb-stage")||e.target.classList.contains("lb-frame")))){e.preventDefault();e.stopPropagation();close();}});im.addEventListener("pointerdown",function(e){down=true;dragging=scale>1;movedPx=0;px=e.clientX;py=e.clientY;swx=e.clientX;swy=e.clientY;if(dragging){im.classList.add("lb-dragging");try{im.setPointerCapture(e.pointerId);}catch(err){}}});im.addEventListener("pointermove",function(e){if(!down)return;var dx=e.clientX-px,dy=e.clientY-py;movedPx+=Math.abs(dx)+Math.abs(dy);px=e.clientX;py=e.clientY;if(dragging){tx+=dx;ty+=dy;apply();}});var endDrag=function(e){if(!down)return;down=false;dragging=false;im.classList.remove("lb-dragging");if(scale<=1&&movedPx>60&&list.length>1){var dx=e.clientX-swx,dy=e.clientY-swy;if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>60)show(dx<0?idx+1:idx-1);}};im.addEventListener("pointerup",endDrag);im.addEventListener("pointercancel",function(){down=false;dragging=false;im.classList.remove("lb-dragging");});im.addEventListener("wheel",function(e){e.preventDefault();zoomTo(scale*(e.deltaY<0?1.18:1/1.18),e.clientX,e.clientY);},{passive:false});document.addEventListener("keydown",function(e){if(!root.classList.contains("lb-on"))return;if(e.key==="Escape"){e.preventDefault();close();}else if(e.key==="ArrowLeft"){e.preventDefault();show(idx-1);}else if(e.key==="ArrowRight"){e.preventDefault();show(idx+1);}else if(e.key==="+"||e.key==="="){e.preventDefault();zoomTo(scale*1.3,window.innerWidth/2,window.innerHeight/2);}else if(e.key==="-"){e.preventDefault();zoomTo(scale/1.3,window.innerWidth/2,window.innerHeight/2);}});}function open(el){ensure();list=collect();if(!list.length)return;var i=list.indexOf(el);if(i<0){list.push(el);i=list.length-1;}lastFocus=document.activeElement;root.classList.add("lb-on");document.documentElement.style.overflow="hidden";try{closeB.focus();}catch(err){}show(i);}function show(i){if(!list.length)return;idx=(i+list.length)%list.length;cur=resolveSrc(list[idx]);scale=1;tx=0;ty=0;movedPx=0;down=false;dragging=false;apply();var meta=captionOf(list[idx]);cap.textContent=(meta.uid?meta.uid+" \\u00b7 ":"")+meta.t;var nav=list.length>1;prevB.style.display=nav?"":"none";nextB.style.display=nav?"":"none";loadB.classList.add("lb-busy");var src=cur.full||cur.disp;if(src)im.src=src;else{loadB.classList.remove("lb-busy");cap.textContent="\\u56fe\\u7247\\u4e0d\\u53ef\\u7528";}}function close(){if(!root)return;root.classList.remove("lb-on");document.documentElement.style.overflow="";im.removeAttribute("src");if(lastFocus&&lastFocus.focus){try{lastFocus.focus();}catch(err){}}}function apply(){im.style.transform=scale===1?"":"translate("+tx+"px,"+ty+"px) scale("+scale+")";im.classList.toggle("lb-zoomed",scale>1);cnt.textContent=(idx+1)+" / "+list.length+(scale>1?" \u00b7 "+Math.round(scale*100)+"%":"");}function zoomTo(k,vx,vy){k=Math.min(8,Math.max(1,k));if(k===scale)return;var r=im.getBoundingClientRect();var ccx=r.left+r.width/2,ccy=r.top+r.height/2;var dx=vx-ccx,dy=vy-ccy;tx=(tx+dx)-(k/scale)*dx;ty=(ty+dy)-(k/scale)*dy;scale=k;if(scale===1){tx=0;ty=0;}apply();}function toggleZoom(vx,vy){if(scale>1){scale=1;tx=0;ty=0;apply();}else zoomTo(2.5,vx,vy);}document.addEventListener("click",function(e){var t=e.target;if(!t||!t.tagName)return;if(t.tagName!=="IMG")return;if(t.classList.contains("lb-img"))return;if(!t.closest||!t.closest("main"))return;e.preventDefault();e.stopPropagation();open(t);});})();`;
  const REPORT_HTML_V2_SCRIPT_FULL = REPORT_HTML_V2_SCRIPT + REPORT_LIGHTBOX_SCRIPT;
  // v3.17: the height-reporting IIFE that used to live at the tail of this
  // script was REMOVED — the web UI no longer embeds the report in an
  // auto-resizing iframe (download / new-tab only), so nobody listens to
  // those postMessages anymore. Keep the download-all + anchor-scroll
  // handlers; keep the string balanced (see the comment above).

  /**
   * Build the V2 lineage report — a standalone HTML page with a left outline
   * (stages / phases / mini-nodes) + picture flow, and a right column of
   * per-job cards.
   *
   * The returned string is a complete `<!doctype html>` document. It can be
   * written to disk, opened directly in a browser, served from a Next.js
   * route, or embedded in a Blob for download.
   */
  export function buildLineageHtmlV2(summary: LineageSummary, opts?: ReportHtmlOptions): string {
    const state = reportBuildLineageState(summary);
    const cards = (summary.nodes || [])
      .slice()
      .sort((a, b) => uidOrder(a) - uidOrder(b))
      .map((node) => reportJobCard(node, summary, state, opts))
      .join("");
    const template: ReportTemplateId = opts?.template ?? "paper";
    const css = buildReportCss(
      template,
      opts?.fontScale ?? "standard",
      opts?.widthMode ?? "full",
    );
    // Only the classic skin auto-switches light/dark — paper/minimal/slate
    // are intentionally locked to their native palette.
    const themeInit =
      template === "classic"
        ? "<script>(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t==='system'||!t)&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');else document.documentElement.classList.add('light')}catch(e){}})();</script>"
        : "";
    const defaultTitle = `CryoSmart Lineage: ${summary.project_uid} / ${summary.start_uid}`;
    const title = (opts?.titleOverride || "").trim() || defaultTitle;
    const subtitle = (opts?.subtitle || "").trim();
    const dateText = new Date().toISOString().slice(0, 10);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(
      title.slice(0, 120),
    )}</title>${themeInit}<style>${css}</style></head><body><header><div class="top"><div class="title"><h1>${escHtml(
      title,
    )}</h1><p>${(summary.nodes || []).length} nodes · ${
      (summary.edges || []).length
    } data links · visible main-node tracing · generated ${dateText}</p>${
      subtitle ? `<p class="note">${escHtml(subtitle)}</p>` : ""
    }</div></div></header><main class="workspace"><section class="pane flow-pane"><div class="pane-head"><h2>Lineage Outline</h2><div class="legend"><span class="micrograph">micrographs</span><span class="particle">particles</span><span class="volume">map</span></div></div><div class="outline">${reportOutline(
      summary,
      state,
    )}</div>${reportPictureFlow(summary, state, opts)}</section><section class="pane chain-pane"><div class="chain-head"><h2>Main Data Chain</h2><span class="hint">小节点会折叠到可见主节点；左侧标签只指向左侧已有节点。</span></div><div class="cards">${cards}</div></section></main><script>${REPORT_HTML_V2_SCRIPT_FULL}</script></body></html>`;
  }

  /** @internal Exported only for testing of the inline script string. */
  export const _REPORT_HTML_V2_CSS = REPORT_HTML_V2_CSS;
  /** @internal Exported only for testing of the inline script string
   *  (v3.23: the FULL script = base handlers + lightbox IIFE, so a
   *  new-Function() parse test covers the lightbox too). */
  export const _REPORT_HTML_V2_SCRIPT = REPORT_HTML_V2_SCRIPT_FULL;

