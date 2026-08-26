/**
 * CryoSmart lineage-tracing core.
 *
 * Verbatim port of the pure helper functions from
 * `CryoSmartLineageTracer_3.0/popup.js` (Manifest V3 Chrome extension)
 * into a TypeScript module. No `chrome.*`, no `document` / `window` —
 * every function here is a pure utility that runs both server- and
 * client-side.
 *
 * String literals (including the Chinese UI strings) are preserved
 * byte-for-byte from the original source so that downstream renderers
 * (HTML / SVG / PPTX / preview) produce identical output.
 */

import {
  MAP_SUFFIXES,
  MAJOR_JOB_TYPES,
  PICKING_JOB_TYPES,
  PARTICLE_AUX_JOB_TYPES,
  REPICK_PARTICLE_PRODUCER_TYPES,
  REPICK_SETUP_JOB_TYPES,
  SMALL_JOB_TYPES,
} from "./constants";
import type {
  ClassMap,
  ClassSplit,
  ClassSplitJob,
  DateValue,
  EdgeFamily,
  ExtractionParams,
  ImageAsset,
  IncomingByTargetMap,
  InputSlotGroup,
  JobMetadata,
  LineageEdge,
  LineageEdgeSlot,
  LineageNode,
  LineageReportState,
  LineageSummary,
  MapAsset,
  NormalizedLineageEdge,
  OutputGroupIndex,
  OutputGroupIndexItem,
  OutputResultGroup,
  ParamSpecEntry,
  ParamsSpec,
  Select2DSummary,
  Slot,
  UiTileImage,
} from "./types";

/* ------------------------------------------------------------------ */
/* Module-level caches                                                */
/* ------------------------------------------------------------------ */

/**
 * WeakMap cache for `reportNormalizedEdges` — keyed on the summary
 * object so that two consecutive calls with the same summary return
 * the same memoized edge array.
 */
const REPORT_NORMALIZED_EDGES_CACHE = new WeakMap<
  LineageSummary,
  NormalizedLineageEdge[]
>();

/* ------------------------------------------------------------------ */
/* URL / route helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Normalize a user-typed job uid into the canonical `J<number>` form
 * used throughout the lineage graph. Throws a Chinese error message
 * when the value is empty (matches the original popup.js UX).
 */
export function normalizeJobUid(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) throw new Error("请输入起始 Job，例如 427 或 J427。");
  return /^J/i.test(text) ? text.toUpperCase() : `J${text}`;
}

/** Parse a CryoSmart SPA hash-route into its three path components. */
export function parseRoute(url: unknown): {
  projectId: string;
  experimentId: string;
  jobId: string;
} {
  const match = String(url || "").match(
    /#\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/?#]+))?/i
  );
  return {
    projectId: match ? match[1] : "",
    experimentId: match && match[2] ? match[2] : "",
    jobId: match && match[3] ? match[3] : "",
  };
}

/** Unwrap a CryoSmart `{ $date: ... }` timestamp wrapper if present. */
export function plainDate(value: unknown): unknown {
  return value && typeof value === "object" && "$date" in (value as object)
    ? (value as { $date: unknown }).$date
    : value;
}

/* ------------------------------------------------------------------ */
/* Output-group / params-spec helpers                                */
/* ------------------------------------------------------------------ */

/** Return all `output_result_groups` on a job, optionally filtered by `type`. */
export function outputGroups(
  job: JobMetadata,
  type?: string
): OutputResultGroup[] {
  const groups = Array.isArray(job.output_result_groups)
    ? job.output_result_groups
    : [];
  return type ? groups.filter((group) => group.type === type) : groups;
}

/** Largest `num_items` across groups of the given `type`, or `null`. */
export function maxGroupNumItems(
  job: JobMetadata,
  type?: string
): number | null {
  const values = outputGroups(job, type)
    .map((group) => group.num_items)
    .filter((value): value is number => Number.isInteger(value));
  return values.length ? Math.max(...values) : null;
}

/**
 * Read a numeric value out of `params_spec`, trying each candidate key
 * in order. The first finite value wins; otherwise `null`.
 */
export function paramSpecNumber(
  job: JobMetadata | null | undefined,
  names: string[]
): number | null {
  const params: ParamsSpec = (job && job.params_spec) || {};
  for (const name of names) {
    const entry: ParamSpecEntry | undefined = params[name];
    const value =
      entry !== null && typeof entry === "object" && "value" in (entry as object)
        ? (entry as { value?: unknown }).value
        : entry;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * Scan `output_result_groups[].summary` for a key matching any of the
 * given regexes and return the first finite numeric value found.
 */
export function outputSummaryNumber(
  job: JobMetadata,
  patterns: RegExp[]
): number | null {
  for (const group of outputGroups(job)) {
    const summary =
      group && group.summary && typeof group.summary === "object"
        ? group.summary
        : ({} as Record<string, unknown>);
    for (const [key, value] of Object.entries(summary)) {
      if (!patterns.some((pattern) => pattern.test(key))) continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Pixel-size helpers                                                 */
/* ------------------------------------------------------------------ */

/** Round a pixel size (Å/px) to 4 decimals, rejecting implausible values. */
export function pixelSizeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100
    ? Math.round(number * 10000) / 10000
    : null;
}

/** Resolve the pixel size (Å/px) for a job from summary and params. */
export function pixelSizeFromJob(job: JobMetadata): number | null {
  return (
    pixelSizeNumber(
      outputSummaryNumber(job, [/psize[_-]?A$/i, /pixel[^a-z0-9]*size/i])
    ) ||
    pixelSizeNumber(
      paramSpecNumber(job, [
        "psize_A",
        "pixel_size_A",
        "pixel_size",
        "micrograph_pixel_size_A",
      ])
    )
  );
}

/** Format a pixel size as a short human-readable string (no unit suffix). */
export function formatPixelSize(value: unknown): string {
  const number = pixelSizeNumber(value);
  if (!number) return "";
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Format a node's pixel size as `"<n> Å/px"`, or `""` when unknown. */
export function pixelSizeText(node: {
  pixel_size_A?: number | null;
}): string {
  const text = formatPixelSize(node && node.pixel_size_A);
  return text ? `${text} Å/px` : "";
}

/* ------------------------------------------------------------------ */
/* Extraction helpers                                                  */
/* ------------------------------------------------------------------ */

/** Returns `true` for `extract_micrographs*` job types. */
export function isExtractMicrographsJob(
  jobOrNode: { job_type?: string } | null | undefined
): boolean {
  return /extract_micrographs/i.test((jobOrNode && jobOrNode.job_type) || "");
}

/** Pull the (raw box, extracted box, bin factor) triple out of `params_spec`. */
export function extractionParams(job: JobMetadata): ExtractionParams {
  const rawBox = paramSpecNumber(job, [
    "box_size_pix",
    "box_size",
    "extraction_box_size_pix",
    "extraction_box_size",
  ]);
  const extractedBox = paramSpecNumber(job, [
    "bin_size_pix",
    "downsample_box_size_pix",
    "crop_size_pix",
  ]);
  const inferredExtractedBox =
    rawBox && !extractedBox && isExtractMicrographsJob(job) ? rawBox : extractedBox;
  const bin =
    rawBox && inferredExtractedBox ? rawBox / inferredExtractedBox : null;
  return {
    box_size_pix: rawBox,
    extracted_box_size_pix: inferredExtractedBox,
    bin_factor: Number.isFinite(bin) ? bin : null,
    bin_inferred: Boolean(rawBox && !extractedBox && isExtractMicrographsJob(job)),
  };
}

/** Format a bin factor: integer → no decimal, otherwise `toFixed(2)` trimmed. */
export function formatBinFactor(value: number | null | undefined): string {
  if (!Number.isFinite(value as number)) return "";
  const v = value as number;
  const rounded = Math.round(v);
  return Math.abs(v - rounded) < 0.01
    ? String(rounded)
    : v.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Format the extraction-params triple for a node as a Chinese-text
 * summary string (e.g. `原始 pixel 256 px · 提取 box 128 px · bin 2`).
 */
export function extractionParamText(node: {
  extraction_params?: ExtractionParams | null;
}): string {
  const p = node && node.extraction_params;
  if (!p) return "";
  const parts: string[] = [];
  if (p.box_size_pix) parts.push(`原始 pixel ${formatBinFactor(p.box_size_pix)} px`);
  if (p.extracted_box_size_pix)
    parts.push(`提取 box ${formatBinFactor(p.extracted_box_size_pix)} px`);
  if (p.bin_factor)
    parts.push(
      `bin ${formatBinFactor(p.bin_factor)}${p.bin_inferred ? " (推断)" : ""}`
    );
  return parts.join(" · ");
}

/** Short `bin <n>` summary for a node, or `""` when unknown. */
export function extractionBinText(node: {
  extraction_params?: ExtractionParams | null;
}): string {
  const p = node && node.extraction_params;
  if (!p || !p.bin_factor) return "";
  return `bin ${formatBinFactor(p.bin_factor)}`;
}

/** Backfill `bin_factor = 1` for `extract_micrographs*` nodes missing it. */
export function normalizeExtractionParamsForNode(node: {
  job_type?: string;
  extraction_params?: ExtractionParams | null;
} | null): void {
  if (!node || !node.extraction_params) return;
  const p = node.extraction_params;
  if (p.bin_factor) return;
  if (
    p.box_size_pix &&
    !p.extracted_box_size_pix &&
    isExtractMicrographsJob(node)
  ) {
    p.extracted_box_size_pix = p.box_size_pix;
    p.bin_factor = 1;
    p.bin_inferred = true;
  }
}

/* ------------------------------------------------------------------ */
/* Resolution helpers                                                 */
/* ------------------------------------------------------------------ */

/** Round a resolution (Å) to 2 decimals, rejecting implausible values. */
export function resolutionNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 20
    ? Math.round(number * 100) / 100
    : null;
}

/** Parse a free-text resolution string like `"FSC 3.2 Å"`. */
export function parseResolutionText(value: unknown): number | null {
  const text = String(value || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:resolution|res|FSC[^:]{0,40})[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)[^.;]{0,60}(?:resolution|FSC|res)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = match && resolutionNumber(match[1]);
    if (number) return number;
  }
  return null;
}

/** Recursively walk an object looking for a plausible resolution number. */
export function resolutionFromObject(
  value: unknown,
  keyPath = "",
  depth = 0,
  seen: Set<unknown> = new Set()
): number | null {
  if (value === null || value === undefined || depth > 7) return null;
  if (typeof value === "number") {
    return /resolution|fsc|res[_-]?a/i.test(keyPath) &&
      !/threshold|cutoff/i.test(keyPath)
      ? resolutionNumber(value)
      : null;
  }
  if (typeof value === "string") {
    if (/resolution|FSC|angstrom|Å|\bA\b/i.test(value) || /resolution|fsc/i.test(keyPath)) {
      return (
        parseResolutionText(value) ||
        (/resolution|fsc/i.test(keyPath) ? resolutionNumber(value) : null)
      );
    }
    return null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = resolutionFromObject(item, keyPath, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = keyPath ? `${keyPath}.${key}` : key;
    const found = resolutionFromObject(item, path, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

/** Resolve the final resolution (Å) for a job, or `null` if N/A. */
export function resolutionFromJob(job: JobMetadata | null | undefined): number | null {
  if (
    !/nonuniform|homo_refine|local_refine|local_resolution|fsc3D|sharpen|reslog/i.test(
      (job && job.job_type) || ""
    )
  ) {
    return null;
  }
  return (
    resolutionNumber(job && job.radwn_final_A) ||
    resolutionNumber(job && job.final_resolution_A) ||
    resolutionNumber(job && job.resolution_A) ||
    resolutionNumber(job && job.fsc_resolution_A) ||
    resolutionNumber(job && job.gold_standard_fsc_resolution_A) ||
    resolutionFromObject(
      job && job.overview_assets && (job.overview_assets as Record<string, unknown>).resolution_A,
      "overview_assets.resolution_A"
    ) ||
    resolutionFromObject(job && job.overview_assets, "overview_assets", 0) ||
    resolutionFromObject(job && job.output_result_groups, "output_result_groups", 0)
  );
}

/** Format a node's resolution as `"<n> Å"`, or `""` when unknown. */
export function resolutionText(node: { resolution_A?: number | null }): string {
  const value = node && resolutionNumber(node.resolution_A);
  return value ? `${formatBinFactor(value)} Å` : "";
}

/**
 * `popup.js` does not define a dedicated `formatResolution` helper — it
 * reuses `formatBinFactor` for resolution values (see `resolutionText`).
 * Alias kept here so downstream modules can import a single source of
 * truth for resolution formatting.
 *
 * TODO: verify — original `resolutionText` calls `formatBinFactor(value)`.
 */
export const formatResolution = formatBinFactor;

/* ------------------------------------------------------------------ */
/* URL builders                                                       */
/* ------------------------------------------------------------------ */

/** Build the canonical full CryoSmart preview URL
 *  `http://host:port/api/log_image/<fileid>`.
 *
 *  This is the URL that the browser loads DIRECTLY from CryoSmart —
 *  it works when the user's browser is on the same network as the
 *  CryoSmart server (the common case, proven by right-click → "open
 *  in new tab" working). The `<img>`/`<image>` tag should carry
 *  `referrerpolicy="no-referrer"` (set both on the element AND via the
 *  report HTML's `<meta name="referrer" content="no-referrer">`) so
 *  CryoSmart doesn't see an external Referer and reject the request.
 *
 *  As an `onerror` fallback, callers can also build a same-origin
 *  proxy URL via `proxyImageUrl()` — this helps when the browser
 *  CAN'T reach CryoSmart directly (e.g. the app is served from a
 *  different network) but the Next.js server CAN.
 *
 *  Callers that fetch bytes server-side (image-embed.ts base64 pre-fetch,
 *  bundle.ts ZIP downloads) also use this URL — `cryoSmartFetch` strips
 *  the origin and routes through the `/api/cryosmart/[...path]` proxy.
 */
export function logImageUrl(
  baseUrl: string | null | undefined,
  fileid: string | null | undefined
): string | null {
  return canonicalLogImageUrl(baseUrl, fileid);
}

/** Build the canonical full CryoSmart URL `http://host:port/api/log_image/<fileid>`.
 *  Used directly by `logImageUrl` above (inline `<img>` rendering),
 *  and by `image-embed.ts` / `bundle.ts` (server-side fetch via proxy). */
export function canonicalLogImageUrl(
  baseUrl: string | null | undefined,
  fileid: string | null | undefined
): string | null {
  if (!fileid) return null;
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/api/log_image/${fileid}`;
}

/** Build a same-origin proxy URL `/api/proxy-image/<fileid>?base=...&cookie=...&auth=...`
 *  for use as an `onerror` fallback when the direct CryoSmart URL fails
 *  (e.g. when the user's browser can't reach CryoSmart directly, but the
 *  Next.js server can). Extracts the fileid from the full CryoSmart URL
 *  produced by `logImageUrl` / `canonicalLogImageUrl`.
 *
 *  Pass the session's cookie/auth so the proxy can forward them to
 *  CryoSmart for authenticated deployments. */
export function proxyImageUrl(
  cryosmartUrl: string | null | undefined,
  baseUrl: string | null | undefined,
  cookie?: string,
  auth?: string
): string | null {
  if (!cryosmartUrl) return null;
  // Extract fileid from the URL path `/api/log_image/<fileid>`.
  const m = String(cryosmartUrl).match(/\/api\/log_image\/([^/?#]+)/);
  if (!m) return null;
  const fileid = m[1];
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  const params = new URLSearchParams();
  params.set("base", base);
  if (cookie) params.set("cookie", cookie);
  if (auth) params.set("auth", auth);
  return `/api/proxy-image/${fileid}?${params.toString()}`;
}

/** Extract the fileid from a CryoSmart log_image URL. Returns null if
 *  the URL doesn't match the expected `/api/log_image/<fileid>` shape. */
export function fileidFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(/\/api\/log_image\/([^/?#]+)/);
  return m ? m[1] : null;
}

/** Build a `/api/log_image/download_result_file/<projectId>/<jobId>.<group>.<result>` URL. */
export function resultFileUrl(
  baseUrl: string | null | undefined,
  projectId: string,
  jobId: string,
  groupName: string,
  resultName: string
): string {
  return `${String(baseUrl || "").replace(/\/$/, "")}/api/log_image/download_result_file/${projectId}/${jobId}.${groupName}.${resultName}`;
}

/** Build a `/api/log_image/download_result_file/<projectId>/<jobId>.<name>.png` URL. */
export function resultPreviewImageUrl(
  baseUrl: string | null | undefined,
  projectId: string,
  jobId: string,
  name: string
): string | null {
  if (!baseUrl || !projectId || !jobId || !name) return null;
  return `${String(baseUrl || "").replace(/\/$/, "")}/api/log_image/download_result_file/${projectId}/${jobId}.${name}.png`;
}

/** Build the `<suffix> -> url` map for downloadable `.map` files of a job. */
export function mapDownloadUrls(
  baseUrl: string,
  projectId: string,
  jobId: string
): Record<string, string> {
  const root = String(baseUrl || "http://192.168.4.3:8080").replace(/\/$/, "");
  return Object.fromEntries(
    MAP_SUFFIXES.map((suffix) => [
      suffix,
      `${root}/api/log_image/download_result_file/${projectId}/${jobId}.${suffix}`,
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Output-group index / class split                                    */
/* ------------------------------------------------------------------ */

/** Index a job's output groups by name. */
export function outputGroupsByName(
  job: JobMetadata
): Map<string, OutputResultGroup> {
  const index = new Map<string, OutputResultGroup>();
  for (const group of outputGroups(job)) {
    if (group && group.name) index.set(group.name, group);
  }
  return index;
}

/** Parse the integer class index out of a group name like `particles_class_3`. */
export function parseClassIndex(name: unknown): number | null {
  const match = String(name || "").match(/class[_-](\d+)/);
  return match ? Number(match[1]) : null;
}

/** Build the indexed `output_groups` dictionary stored on a `LineageNode`. */
export function outputGroupIndex(job: JobMetadata): OutputGroupIndex {
  const byName = outputGroupsByName(job);
  const totalEntry = byName.get("particles_all_classes");
  const total =
    totalEntry && Number.isInteger(totalEntry.num_items) ? totalEntry.num_items : null;
  const index: OutputGroupIndex = {};

  for (const group of outputGroups(job)) {
    if (!group || !group.name) continue;
    const idx = parseClassIndex(group.name);
    const count = group.num_items ?? null;
    const item: OutputGroupIndexItem = {
      name: group.name,
      type: group.type ?? null,
      title: group.title || group.name,
      count: Number.isInteger(count) ? count : null,
      class_index: idx,
      percent: null,
      paired_particle_count: null,
      paired_particle_percent: null,
    };

    if (
      group.name.startsWith("particles_class_") &&
      Number.isInteger(count) &&
      Number.isInteger(total) &&
      total
    ) {
      item.percent = Math.round(((count as number) / (total as number)) * 10000) / 100;
    }

    if (group.name.startsWith("volume_class_") && idx !== null) {
      const paired = byName.get(`particles_class_${idx}`);
      const pairedCount = paired ? paired.num_items ?? null : null;
      if (Number.isInteger(pairedCount)) {
        item.paired_particle_count = pairedCount;
        if (Number.isInteger(total) && total) {
          item.paired_particle_percent =
            Math.round(((pairedCount as number) / (total as number)) * 10000) / 100;
        }
      }
    }

    index[group.name] = item;
  }

  return index;
}

/** Compute the per-class particle/volume split for `abinit` / `hetero` / `class_3D` jobs. */
export function classSplits(
  job: JobMetadata,
  baseUrl: string
): ClassSplit[] {
  const type = job.job_type || "";
  if (
    !type.includes("abinit") &&
    !type.includes("hetero") &&
    !type.includes("class_3D")
  )
    return [];

  let total: number | null = null;
  const classes = new Map<
    number,
    {
      particle_count?: number;
      volume_group?: string;
      mrc_preview_url?: string | null;
      mrc_preview_src?: string | null;
      mrc_preview_original_url?: string | null;
      maps?: ClassMap[];
    }
  >();
  const outputImages = job.output_group_images || {};

  // Build a name → fileid map from `ui_tile_images` so we can resolve a
  // volume class's preview thumbnail by name (the Vue store on the CryoSmart
  // side keeps class previews here, not in `output_group_images`). Falls
  // back to `output_group_images` if the name isn't in the tile list.
  const tileImageMap: Record<string, string> = {};
  if (job.ui_tile_images) {
    for (const tile of job.ui_tile_images) {
      if (tile && tile.name && tile.fileid) {
        tileImageMap[tile.name] = tile.fileid;
      }
    }
  }

  for (const group of outputGroups(job, "particle")) {
    if (group.name === "particles_all_classes") {
      total = group.num_items ?? null;
      continue;
    }
    const idx = parseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    classes.get(idx)!.particle_count = group.num_items ?? undefined;
  }

  for (const group of outputGroups(job, "volume")) {
    const idx = parseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    const entry = classes.get(idx)!;
    entry.volume_group = group.name;
    const groupName = group.name || "";
    // Resolve the preview fileid: prefer `ui_tile_images` (keyed by name),
    // fall back to `output_group_images`. Both point at the same
    // `/api/log_image/<fileid>` endpoint on the CryoSmart server.
    const previewFileId =
      tileImageMap[groupName] || outputImages[groupName] || "";
    const previewUrl = logImageUrl(baseUrl, previewFileId);
    entry.mrc_preview_url = previewUrl;
    entry.mrc_preview_src = previewUrl;
    // The "open original" link used to point at `download_result_file/...`,
    // which 404'd for many class volume previews. Point it at the same
    // `/api/log_image/<fileid>` URL so click-to-open actually shows the
    // image (matching what's rendered inline).
    entry.mrc_preview_original_url = previewUrl;
    entry.maps = (group.contains || [])
      .filter(
        (item) => item.type === "volume.blob" && item.name === "map"
      )
      .map((item) => ({
        result_name: item.name || "",
        download_url: `${baseUrl.replace(/\/$/, "")}/api/log_image/download_result_file/${job.project_uid}/${job.uid}.${group.name}.${item.name}`,
      }));
  }

  return Array.from(classes.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([idx, entry]) => ({
      class_index: idx,
      particle_count: Number.isInteger(entry.particle_count)
        ? (entry.particle_count as number)
        : null,
      particle_percent:
        Number.isInteger(entry.particle_count) &&
        Number.isInteger(total) &&
        total
          ? Math.round(((entry.particle_count as number) / total) * 10000) / 100
          : null,
      total_particles: total,
      volume_group: entry.volume_group || null,
      mrc_preview_url: entry.mrc_preview_url || null,
      mrc_preview_src: entry.mrc_preview_src || null,
      mrc_preview_original_url: entry.mrc_preview_original_url || null,
      maps: entry.maps || [],
    }));
}

/* ------------------------------------------------------------------ */
/* Image / map assets                                                  */
/* ------------------------------------------------------------------ */

/** Collect preview image assets (ui_tile + output_group) for a job. */
export function imageAssets(
  job: JobMetadata,
  baseUrl: string,
  // `projectId` is kept for API stability — callers (selected2dSummary,
  // jobNode) pass it through. It used to be needed for `resultPreviewImageUrl`
  // (a `download_result_file/<projectId>/...` URL) but that fallback was
  // removed because the URL it produced 404'd for many tiles.
  _projectId = ""
): ImageAsset[] {
  const assets: ImageAsset[] = [];
  for (const item of job.ui_tile_images || []) {
    const tile: UiTileImage = item;
    const fileid = tile.fileid;
    const url = logImageUrl(baseUrl, fileid);
    if (!url) continue;
    assets.push({
      kind: "ui_tile",
      name: tile.name || "image",
      url,
      src: url,
      // The "open original" link used to point at a `download_result_file`
      // URL which 404'd for many ui-tile previews. Point it at the same
      // `/api/log_image/<fileid>` URL so click-to-open matches what's
      // rendered inline (both go through the same CryoSmart endpoint).
      original_url: url,
      num_cols: tile.num_cols ?? null,
      num_rows: tile.num_rows ?? null,
    });
  }

  const outputImages = job.output_group_images || {};
  for (const [name, fileid] of Object.entries(outputImages)) {
    const url = logImageUrl(baseUrl, fileid);
    if (!url) continue;
    assets.push({
      kind: "output_group",
      name,
      url,
      src: url,
      // Same as above — use the `/api/log_image/<fileid>` URL for the
      // click-to-open link instead of the broken `download_result_file`
      // path.
      original_url: url,
    });
  }

  return assets;
}

/** Collect downloadable map assets (volume + mask groups) for a job. */
export function mapAssets(
  job: JobMetadata,
  baseUrl: string,
  projectId: string
): MapAsset[] {
  const assets: MapAsset[] = [];
  const outputImages = job.output_group_images || {};
  for (const group of outputGroups(job)) {
    if (!["volume", "mask"].includes(group.type || "") || !group.name) continue;
    const previewUrl = logImageUrl(baseUrl, outputImages[group.name]);
    for (const item of group.contains || []) {
      if (item.type !== "volume.blob" || !item.name) continue;
      assets.push({
        group: group.name,
        group_title: group.title || group.name,
        group_type: group.type || "",
        result_name: item.name,
        download_url: resultFileUrl(
          baseUrl,
          projectId,
          job.uid || "",
          group.name,
          item.name
        ),
        preview_url: previewUrl,
        preview_src: previewUrl,
        // Point click-to-open at the same `/api/log_image/<fileid>` URL
        // that's rendered inline — the previous `download_result_file`
        // fallback 404'd for many volume/mask previews.
        preview_original_url: previewUrl,
      });
    }
  }
  return assets;
}

/**
 * Map a volume-group name to a friendly preview image label
 * (e.g. `volume_class_3` → `volume_class_3`, `volume.map` → `volume`).
 */
export function mapPreviewImageName(group: unknown): string {
  const value = String(group || "volume");
  if (/^(volume|map)$/i.test(value)) return "volume";
  return value.replace(/\.map$/i, "");
}

/** Filter a node's map assets down to the "normal" (non-mask) `.map` files. */
export function normalMapAssets(node: {
  maps?: MapAsset[];
}): MapAsset[] {
  return (node.maps || []).filter((item) => {
    const group = String(item.group || "");
    const volumeGroup = item.group_type
      ? item.group_type === "volume"
      : !/mask/i.test(group);
    return (
      volumeGroup &&
      (item.result_name === "map" || item.download_url.endsWith(".map"))
    );
  });
}

/* ------------------------------------------------------------------ */
/* Select-2D summary                                                   */
/* ------------------------------------------------------------------ */

/** Build the `select_2d` summary for a `select_2D` job (or `null`). */
export function selected2dSummary(
  job: JobMetadata,
  baseUrl: string
): Select2DSummary | null {
  if (job.job_type !== "select_2D") return null;
  const byName = outputGroupsByName(job);
  const images = new Map(
    imageAssets(job, baseUrl, job.project_uid || "").map((item) => [item.name, item])
  );
  const overviewSelected =
    job.overview_assets &&
    (job.overview_assets as Record<string, unknown>).select_2d as
      | Record<string, unknown>
      | undefined;

  const selectedClassesImageSource =
    overviewSelected &&
    (overviewSelected as Record<string, unknown>).selected_classes_image;
  const selectedClassesImage = selectedClassesImageSource
    ? {
        url: String(selectedClassesImageSource),
        src:
          (overviewSelected &&
            String((overviewSelected as Record<string, unknown>).selected_classes_src || "")) ||
          String(selectedClassesImageSource),
        original_url:
          (overviewSelected &&
            String(
              (overviewSelected as Record<string, unknown>)
                .selected_classes_original_url || ""
            )) ||
          String(selectedClassesImageSource),
      }
    : images.get("templates_selected");
  const selectedParticlesImage = images.get("particles_selected");
  const excludedClassesImage = images.get("templates_excluded");

  const safe = (uid: string | undefined): number | null => {
    const g = uid ? byName.get(uid) : undefined;
    if (g && Number.isInteger(g.num_items)) return g.num_items as number;
    return null;
  };

  const classesSelectedRaw =
    overviewSelected && (overviewSelected as Record<string, unknown>).classes_selected;
  const classesSelected =
    overviewSelected && Number.isInteger(classesSelectedRaw)
      ? (classesSelectedRaw as number)
      : safe("templates_selected");

  return {
    particles_selected: safe("particles_selected"),
    particles_excluded: safe("particles_excluded"),
    classes_selected: classesSelected,
    classes_excluded: safe("templates_excluded"),
    selected_classes_image: selectedClassesImage ? selectedClassesImage.url : null,
    selected_classes_src: selectedClassesImage ? selectedClassesImage.src : null,
    selected_classes_original_url: selectedClassesImage
      ? selectedClassesImage.original_url
      : null,
    selected_classes_source:
      overviewSelected && (overviewSelected as Record<string, unknown>).source
        ? String((overviewSelected as Record<string, unknown>).source)
        : selectedClassesImage
          ? "metadata_templates_selected"
          : null,
    selected_classes_log_text:
      overviewSelected && (overviewSelected as Record<string, unknown>).log_text
        ? String((overviewSelected as Record<string, unknown>).log_text)
        : null,
    selected_classes_log_timestamp:
      overviewSelected && (overviewSelected as Record<string, unknown>).log_timestamp
        ? String((overviewSelected as Record<string, unknown>).log_timestamp)
        : null,
    selected_particles_image: selectedParticlesImage
      ? selectedParticlesImage.url
      : null,
    selected_particles_src: selectedParticlesImage
      ? selectedParticlesImage.src
      : null,
    selected_particles_original_url: selectedParticlesImage
      ? selectedParticlesImage.original_url
      : null,
    excluded_classes_image: excludedClassesImage ? excludedClassesImage.url : null,
    excluded_classes_src: excludedClassesImage ? excludedClassesImage.src : null,
    excluded_classes_original_url: excludedClassesImage
      ? excludedClassesImage.original_url
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Job -> node                                                         */
/* ------------------------------------------------------------------ */

/** Build a fully-normalized `LineageNode` from a raw `JobMetadata`. */
export function jobNode(
  job: JobMetadata,
  baseUrl = "",
  projectId = ""
): LineageNode {
  const images = baseUrl
    ? imageAssets(job, baseUrl, projectId || job.project_uid || "")
    : [];
  const classes = baseUrl ? classSplits(job, baseUrl) : [];
  const node: LineageNode = {
    uid: job.uid || "",
    uid_num: job.uid_num ?? null,
    project_uid: job.project_uid || "",
    job_type: job.job_type || "",
    title: job.title || "",
    status: job.status || "",
    created_at: (plainDate(job.created_at) as DateValue | null) ?? null,
    completed_at: (plainDate(job.completed_at) as DateValue | null) ?? null,
    parents: job.parents || [],
    children: job.children || [],
    particle_count: maxGroupNumItems(job, "particle"),
    micrograph_count: maxGroupNumItems(job, "exposure"),
    pixel_size_A: pixelSizeFromJob(job),
    volume_count: maxGroupNumItems(job, "volume"),
    class_count: classes.length || null,
    resolution_A: resolutionFromJob(job),
    extraction_params: extractionParams(job),
    output_groups: baseUrl ? outputGroupIndex(job) : {},
    images,
    maps: baseUrl
      ? mapAssets(job, baseUrl, projectId || job.project_uid || "")
      : [],
    classes,
    select_2d: baseUrl ? selected2dSummary(job, baseUrl) : null,
  };
  if (job.job_type === "import_micrographs") {
    node.representative_micrograph_images = images
      .filter((item) => item.kind === "ui_tile")
      .slice(0, 3);
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

/** Convert an input-slot-group connection into a `LineageEdge`. */
export function connectionEdges(job: JobMetadata): LineageEdge[] {
  const edges: LineageEdge[] = [];
  for (const inputGroup of job.input_slot_groups || []) {
    const group: InputSlotGroup = inputGroup;
    for (const connection of group.connections || []) {
      if (!connection.job_uid) continue;
      edges.push({
        source: connection.job_uid,
        target: job.uid || "",
        input_type: group.type || "",
        input_name: group.name || "",
        input_title: group.title ?? null,
        source_group: connection.group_name ?? null,
        slots: (connection.slots || []).map((slot: Slot) => ({
          slot_name: slot.slot_name ?? null,
          source_group: slot.group_name ?? null,
          result_name: slot.result_name ?? null,
          result_type: slot.result_type ?? null,
          version: slot.version ?? null,
        })) as LineageEdgeSlot[],
      });
    }
  }
  return edges;
}

/** Build synthetic `parent` edges for jobs whose parents weren't covered by explicit edges. */
export function fallbackParentEdges(
  job: JobMetadata,
  explicitSources: Set<string>
): LineageEdge[] {
  return (job.parents || [])
    .filter((uid) => !explicitSources.has(uid))
    .map((uid) => ({
      source: uid,
      target: job.uid || "",
      input_type: "parent",
      input_name: "parent",
      input_title: "Parent job",
      source_group: null,
      slots: [],
    }));
}

/** Classify an edge into one of `particle | volume | mask | template | exposure | <input_type>`. */
export function edgeKind(edge: {
  input_type?: string;
  slots?: { result_type?: string | null }[];
}): string {
  if (
    edge.input_type &&
    ["particle", "volume", "mask", "template", "exposure"].includes(edge.input_type)
  ) {
    return edge.input_type;
  }
  const types = (edge.slots || [])
    .map((slot) => slot.result_type || "")
    .join(" ");
  for (const kind of ["particle", "volume", "mask", "template", "exposure"]) {
    if (types.includes(kind)) return kind;
  }
  return edge.input_type || "parent";
}

/* ------------------------------------------------------------------ */
/* Upstream BFS                                                        */
/* ------------------------------------------------------------------ */

/** BFS-collect every upstream job + edge starting from `startUid`. */
export function collectUpstream(
  projectJobs: Map<string, JobMetadata>,
  startUid: string
): { nodes: Map<string, JobMetadata>; edges: LineageEdge[] } {
  const seen = new Map<string, JobMetadata>();
  const edges: LineageEdge[] = [];
  const queue: string[] = [startUid];

  while (queue.length) {
    const uid = queue.shift() as string;
    if (seen.has(uid)) continue;
    const job = projectJobs.get(uid);
    if (!job) continue;
    seen.set(uid, job);

    const explicit = connectionEdges(job);
    const sources = new Set(explicit.map((edge) => edge.source));
    const jobEdges = explicit.concat(fallbackParentEdges(job, sources));
    edges.push(...jobEdges);

    for (const edge of jobEdges) {
      if (!seen.has(edge.source)) queue.push(edge.source);
    }
  }

  return { nodes: seen, edges };
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** Build a full `LineageSummary` for a project + start uid. */
export function buildSummary(
  data: JobMetadata[],
  projectId: string,
  startUid: string,
  baseUrl: string
): LineageSummary {
  const projectJobs = new Map(
    data
      .filter((job) => job.project_uid === projectId && job.uid)
      .map((job) => [job.uid as string, job])
  );
  if (!projectJobs.has(startUid)) {
    const latest = Array.from(projectJobs.values())
      .filter((job) => Number.isInteger(job.uid_num))
      .sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0))
      .slice(-20)
      .map((job) => [job.uid_num ?? null, job.uid, job.job_type]);
    const lastEntry = latest.length ? latest[latest.length - 1] : null;
    throw new Error(
      `${projectId}/${startUid} 不在当前 metadata 中。项目内 jobs=${projectJobs.size}，最新=${JSON.stringify(lastEntry)}`
    );
  }

  const { nodes, edges } = collectUpstream(projectJobs, startUid);
  const startJob = projectJobs.get(startUid) as JobMetadata;
  const nodeList: LineageNode[] = Array.from(nodes.values())
    .sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0))
    .map((job) => jobNode(job, baseUrl, projectId));
  const classJobs: ClassSplitJob[] = nodeList
    .filter((node) => Array.isArray(node.classes) && node.classes.length)
    .map((node) => ({ uid: node.uid, job_type: node.job_type, classes: node.classes }));
  const importJobs: LineageNode[] = Array.from(nodes.values())
    .filter(
      (job) => (job.job_type || "").startsWith("import_") || !(job.parents || []).length
    )
    .map((job) => jobNode(job, baseUrl, projectId));

  return normalizeLineageSummary({
    ok: true,
    project_uid: projectId,
    base_url: baseUrl,
    start_uid: startUid,
    start_job: jobNode(startJob, baseUrl, projectId),
    final_particle_count: maxGroupNumItems(startJob, "particle"),
    final_micrograph_count: maxGroupNumItems(startJob, "exposure"),
    final_resolution_A: resolutionFromJob(startJob),
    resolution_note:
      "需要从 CryoSmart metadata/log/FSC 结果补充；jobs metadata 通常没有最终分辨率。",
    map_download_urls: mapDownloadUrls(baseUrl, projectId, startUid),
    nodes: nodeList,
    edges,
    import_or_leaf_jobs: importJobs,
    class_split_jobs: classJobs,
    focused_mermaid: focusedMermaid(nodes, edges, startUid),
  });
}

/** Backfill `bin_factor`, `final_resolution_A`, `micrograph_pixel_size_A` etc. on a summary. */
export function normalizeLineageSummary<T extends LineageSummary>(
  summary: T
): T {
  if (!summary || !Array.isArray(summary.nodes)) return summary;
  for (const node of summary.nodes) normalizeExtractionParamsForNode(node);
  if (summary.start_job) normalizeExtractionParamsForNode(summary.start_job);
  if (Array.isArray(summary.import_or_leaf_jobs)) {
    for (const node of summary.import_or_leaf_jobs)
      normalizeExtractionParamsForNode(node);
  }
  const startNode =
    summary.nodes.find((node) => node.uid === summary.start_uid) ||
    summary.start_job;
  const finalResolution =
    resolutionNumber(summary.final_resolution_A) ||
    resolutionNumber(startNode && startNode.resolution_A) ||
    resolutionFromObject(startNode, "", 0);
  summary.final_resolution_A = finalResolution || null;
  summary.micrograph_pixel_size_A =
    pixelSizeNumber(summary.micrograph_pixel_size_A) ||
    pixelSizeNumber(
      (summary.nodes || []).find(
        (node) => pixelSizeNumber(node.pixel_size_A)
      )?.pixel_size_A
    ) ||
    pixelSizeNumber(
      (summary.import_or_leaf_jobs || []).find(
        (node) => pixelSizeNumber(node.pixel_size_A)
      )?.pixel_size_A
    ) ||
    null;
  summary.resolution_note = finalResolution
    ? "从 metadata/Overview 文本中解析得到。"
    : (summary.resolution_note ||
      "未在 metadata/Overview 中找到分辨率；可从 FSC txt/xml 继续补充。");
  return summary;
}

/* ------------------------------------------------------------------ */
/* Importance / Mermaid                                                */
/* ------------------------------------------------------------------ */

/** Bucket a job into `final | major | small` based on its type and outputs. */
export function importance(
  job: { uid?: string; job_type?: string } | null | undefined,
  startUid: string
): "final" | "major" | "small" {
  if (
    job &&
    job.uid === startUid &&
    !/nonuniform_refine/i.test(job.job_type || "")
  ) {
    return "final";
  }
  if (job && MAJOR_JOB_TYPES.has(job.job_type || "")) return "major";
  if (job && SMALL_JOB_TYPES.has(job.job_type || "")) return "small";
  const proxy = job as Pick<JobMetadata, "output_result_groups"> | null;
  if (
    proxy &&
    (maxGroupNumItems(proxy as JobMetadata, "particle") ||
      maxGroupNumItems(proxy as JobMetadata, "volume"))
  ) {
    return "major";
  }
  return "small";
}

/** Build a compact HTML label for a Mermaid node (uid + job_type + counts). */
export function nodeLabel(job: JobMetadata): string {
  const node = jobNode(job);
  const parts: string[] = [node.uid, node.job_type || ""];
  if (node.particle_count !== null) parts.push(`${node.particle_count} particles`);
  if (node.micrograph_count !== null) parts.push(`${node.micrograph_count} micrographs`);
  return parts.join("<br/>").replace(/"/g, "'");
}

/** Pretty label for a set of edge kinds, joined by ` + `. */
export function focusedEdgeLabel(kinds: Set<string>): string {
  const order = ["particle", "volume", "mask", "template", "exposure", "parent"];
  const labels: Record<string, string> = {
    particle: "particles",
    volume: "map",
    mask: "mask",
    template: "template",
    exposure: "micrographs",
    parent: "parent",
  };
  return order
    .filter((kind) => kinds.has(kind))
    .map((kind) => labels[kind])
    .join(" + ");
}

/** Build a Mermaid `flowchart LR` definition for a lineage subgraph. */
export function focusedMermaid(
  nodes: Map<string, JobMetadata>,
  edges: LineageEdge[],
  startUid: string
): string {
  const lines = ["flowchart LR"];
  const sortedNodes = Array.from(nodes.values()).sort(
    (a, b) => (a.uid_num || 0) - (b.uid_num || 0)
  );

  for (const job of sortedNodes) {
    const cls = importance(job, startUid);
    lines.push(
      cls === "final"
        ? `  ${job.uid}[["${nodeLabel(job)}"]]`
        : `  ${job.uid}["${nodeLabel(job)}"]`
    );
    lines.push(`  class ${job.uid} ${cls};`);
  }

  const merged = new Map<string, { source: string; target: string; kinds: Set<string> }>();
  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (!merged.has(key))
      merged.set(key, { source: edge.source, target: edge.target, kinds: new Set() });
    merged.get(key)!.kinds.add(edgeKind(edge));
  }

  for (const item of Array.from(merged.values())) {
    lines.push(`  ${item.source} -- "${focusedEdgeLabel(item.kinds)}" --> ${item.target}`);
  }

  lines.push(
    "  classDef final fill:#fee2e2,stroke:#b91c1c,stroke-width:3px,color:#111827;"
  );
  lines.push(
    "  classDef major fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#111827;"
  );
  lines.push(
    "  classDef small fill:#f3f4f6,stroke:#9ca3af,stroke-width:1px,color:#4b5563,font-size:11px;"
  );
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* HTML / report helpers shared with the HTML/SVG/PPTX renderers     */
/* ------------------------------------------------------------------ */

/** Pick a "kind" string for an HTML/SVG/PPTX card based on a node's metadata. */
export function htmlNodeKind(node: {
  job_type?: string;
  volume_count?: number | null;
  particle_count?: number | null;
  micrograph_count?: number | null;
}): "volume" | "particle" | "exposure" | "other" {
  const type = node.job_type || "";
  if (node.volume_count !== null && node.volume_count !== undefined) return "volume";
  if (/refine|abinit|volume|class_3D/i.test(type)) return "volume";
  if (node.particle_count !== null && node.particle_count !== undefined) return "particle";
  if (/particle|picker|topaz/i.test(type)) return "particle";
  if (node.micrograph_count !== null && node.micrograph_count !== undefined)
    return "exposure";
  if (/micrograph|ctf|exposure/i.test(type)) return "exposure";
  return "other";
}

/** Resolve the display "group" label of an edge (`source_group` > `input_name`). */
export function htmlGroupLabel(edge: LineageEdge): string {
  return edge.source_group || edge.input_name || "";
}

/** Resolve the "kind" of an edge, preferring a precomputed `kind` field. */
export function summaryKind(edge: {
  kind?: string;
  input_type?: string;
  slots?: { result_type?: string | null }[];
  kinds?: string[];
}): string {
  if (edge.kind) return edge.kind;
  if (edge.input_type)
    return edgeKind({ input_type: edge.input_type, slots: edge.slots || [] });
  if (Array.isArray(edge.kinds) && edge.kinds.length) return edge.kinds[0];
  return "parent";
}

/** Map a node list into a `uid -> node` lookup Map. */
export function summaryNodeMap(summary: {
  nodes?: LineageNode[];
}): Map<string, LineageNode> {
  return new Map((summary.nodes || []).map((node) => [node.uid, node]));
}

/* ------------------------------------------------------------------ */
/* Report layer (round detection, outline visibility, repick seeds)   */
/* ------------------------------------------------------------------ */

/** Extract the numeric portion of a `J123`-style job uid. */
export function reportJobNum(uid: unknown): number {
  const match = String(uid || "").match(/J(\d+)/i);
  return match ? Number(match[1]) : 0;
}

/** Edge "kind" used by the report layer (delegates to `summaryKind`). */
export function reportEdgeKind(edge: LineageEdge): string {
  return summaryKind(edge);
}

/** Map an edge kind to its "family" bucket (mask → volume, etc.). */
export function reportKindFamily(kind: string): EdgeFamily {
  if (kind === "mask") return "volume";
  if (kind === "exposure") return "exposure";
  if (kind === "particle") return "particle";
  if (kind === "volume") return "volume";
  if (kind === "template" || kind === "ml_model" || kind === "model")
    return "template";
  return (kind || "other") as EdgeFamily;
}

/** Is this node a particle picker? */
export function reportIsPickingNode(node: { job_type?: string } | null | undefined): boolean {
  return PICKING_JOB_TYPES.has((node && node.job_type) || "");
}

/** Is this node a "repick" particle producer (picker with particle output)? */
export function reportIsRepickParticleProducer(
  node: { job_type?: string; particle_count?: number | null } | null | undefined
): boolean {
  return Boolean(
    node &&
      REPICK_PARTICLE_PRODUCER_TYPES.has(node.job_type || "") &&
      node.particle_count !== null &&
      node.particle_count !== undefined
  );
}

/** Is this node a "repick seed" setup job (topaz_train, deep_picker_train, ...)? */
export function reportIsRepickSetupNode(
  node: { job_type?: string } | null | undefined
): boolean {
  return REPICK_SETUP_JOB_TYPES.has((node && node.job_type) || "");
}

/** Is this node a particle-auxiliary job (extract, particle_sets, ...)? */
export function reportIsParticleAuxNode(
  node: { job_type?: string } | null | undefined
): boolean {
  return PARTICLE_AUX_JOB_TYPES.has((node && node.job_type) || "");
}

/** Is this node a "volume source" (refine / class_3D / volume_tools / ...)? */
export function reportIsVolumeSourceNode(
  node: { job_type?: string; volume_count?: number | null } | null | undefined
): boolean {
  const type = (node && node.job_type) || "";
  return Boolean(
    node &&
      ((node.volume_count !== null && node.volume_count !== undefined) ||
        /homo_abinit|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|volume|map|align_3D|homo_reconstruct|sym_expand|particle_subtract/i.test(
          type
        ))
  );
}

/**
 * Does this branch of the lineage contain a "repick seed" (volume
 * source upstream of a particle producer)?
 */
export function reportHasRepickSeed(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set(),
  depth = 0
): boolean {
  if (!uid || visited.has(uid) || depth > 8) return false;
  if (state.repickSeedMemo && state.repickSeedMemo.has(uid))
    return state.repickSeedMemo.get(uid) as boolean;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  const finish = (value: boolean) => {
    if (state.repickSeedMemo) state.repickSeedMemo.set(uid, value);
    return value;
  };
  if (reportIsVolumeSourceNode(node)) return finish(true);
  if (reportIsRepickParticleProducer(node)) return finish(false);

  const incoming = state.incomingByTarget.get(uid) || [];
  for (const edge of incoming) {
    const source = state.nodeMap.get(edge.source);
    if (edge.family === "volume" || edge.kind === "mask") return finish(true);
    if (edge.family === "particle" && reportIsVolumeSourceNode(source))
      return finish(true);
    if (
      reportIsRepickSetupNode(node) ||
      reportIsRepickSetupNode(source) ||
      edge.family === "particle"
    ) {
      if (reportHasRepickSeed(edge.source, state, new Set(visited), depth + 1))
        return finish(true);
    }
  }
  return finish(false);
}

/** Does this branch of the lineage eventually feed a volume-source mainline? */
export function reportFeedsVolumeMainline(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set(),
  depth = 0
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
      if (reportFeedsVolumeMainline(edge.target, state, new Set(visited), depth + 1))
        return true;
    }
  }
  return false;
}

/** For each incoming edge, run `reportLineageRound` over its repick-seed sources. */
export function reportRepickSeedSourceRounds(
  incoming: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string> = new Set()
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

/** Max `reportLineageRound` over a list of incoming edges. */
export function reportMaxRoundFromEdges(
  edges: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string>
): number {
  const rounds = edges.map((edge) =>
    reportLineageRound(edge.source, state, new Set(visited))
  );
  return rounds.length ? Math.max(...rounds) : 0;
}

/** `reportLineageRound` over just the particle-family incoming edges. */
export function reportParticleSourceRound(
  incoming: NormalizedLineageEdge[],
  state: LineageReportState,
  visited: Set<string>
): number | null {
  const particleIncoming = incoming.filter((edge) => edge.family === "particle");
  return particleIncoming.length
    ? reportMaxRoundFromEdges(particleIncoming, state, visited)
    : null;
}

/** Compute the "repick round" of a job (1 = first pick, 2 = first repick, ...). */
export function reportLineageRound(
  uid: string,
  state: LineageReportState,
  visited: Set<string> = new Set()
): number {
  if (!uid || visited.has(uid)) return 0;
  if (state.roundMemo && state.roundMemo.has(uid))
    return state.roundMemo.get(uid) as number;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return 0;
  const type = node.job_type || "";
  const finish = (value: number) => {
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
      type
    )
  ) {
    return finish(particleSourceRound ?? maxSourceRound);
  }

  return finish(particleSourceRound ?? maxSourceRound);
}

/** Is this node "major" (worth showing in the report outline)? */
export function reportNodeIsMajor(
  node: LineageNode,
  summary: { start_uid?: string }
): boolean {
  const type = node.job_type || "";
  if (node.uid === summary.start_uid) return true;
  if (MAJOR_JOB_TYPES.has(type)) return true;
  if (/local_refine|topaz_train|topaz_extract/i.test(type)) return true;
  if (node.particle_count !== null && node.particle_count !== undefined) return true;
  if (node.volume_count !== null && node.volume_count !== undefined) return true;
  return false;
}

/** Visible outline nodes = major nodes sorted by numeric uid. */
export function reportVisibleOutlineNodes(
  summary: LineageSummary,
  _nodeMap: Map<string, LineageNode>
): LineageNode[] {
  const nodes = (summary.nodes || []).filter((node) => {
    if (reportNodeIsMajor(node, summary)) return true;
    return false;
  });
  return nodes.sort(
    (a, b) =>
      (a.uid_num || reportJobNum(a.uid)) - (b.uid_num || reportJobNum(b.uid))
  );
}

/** Memoized `NormalizedLineageEdge[]` view of a summary's edges. */
export function reportNormalizedEdges(
  summary: LineageSummary
): NormalizedLineageEdge[] {
  if (summary && REPORT_NORMALIZED_EDGES_CACHE.has(summary))
    return REPORT_NORMALIZED_EDGES_CACHE.get(summary) as NormalizedLineageEdge[];
  const edges: NormalizedLineageEdge[] = (summary.edges || []).map((edge) => {
    const kind = reportEdgeKind(edge);
    return {
      ...edge,
      kind,
      family: reportKindFamily(kind),
      group: htmlGroupLabel(edge),
    };
  });
  if (summary) REPORT_NORMALIZED_EDGES_CACHE.set(summary, edges);
  return edges;
}

/** Build the per-summary `LineageReportState` used by the report helpers. */
export function reportBuildLineageState(
  summary: LineageSummary
): LineageReportState {
  const nodeMap = summaryNodeMap(summary);
  const edges = reportNormalizedEdges(summary);
  const incomingByTarget: IncomingByTargetMap = new Map<string, NormalizedLineageEdge[]>();
  const outgoingBySource = new Map<string, NormalizedLineageEdge[]>();
  for (const edge of edges) {
    if (!incomingByTarget.has(edge.target))
      incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target)!.push(edge);
    if (!outgoingBySource.has(edge.source))
      outgoingBySource.set(edge.source, []);
    outgoingBySource.get(edge.source)!.push(edge);
  }
  incomingByTarget.__traceVisibleMemo = new Map<string, string[]>();
  const outlineNodes = reportVisibleOutlineNodes(summary, nodeMap);
  const visible = new Set(outlineNodes.map((node) => node.uid));
  return {
    nodeMap,
    edges,
    incomingByTarget,
    outgoingBySource,
    outlineNodes,
    visible,
    roundMemo: new Map<string, number>(),
    repickSeedMemo: new Map<string, boolean>(),
  };
}

/**
 * Trace a `sourceUid` upstream until it hits a `visible` node, returning
 * the list of visible ancestors of the given `family`.
 */
export function reportTraceVisibleSources(
  sourceUid: string,
  family: EdgeFamily,
  visible: Set<string>,
  incomingByTarget: IncomingByTargetMap,
  visited: Set<string> = new Set(),
  depth = 0
): string[] {
  const memo = incomingByTarget.__traceVisibleMemo;
  const memoKey = `${sourceUid}\t${family}`;
  const useMemo = visited.size === 0 && memo;
  if (useMemo && memo!.has(memoKey)) return memo!.get(memoKey) as string[];
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
      ...reportTraceVisibleSources(
        edge.source,
        family,
        visible,
        incomingByTarget,
        new Set(visited),
        depth + 1
      )
    );
  }
  const result = Array.from(new Set(results)).sort(
    (a, b) => reportJobNum(a) - reportJobNum(b)
  );
  if (useMemo) memo!.set(memoKey, result);
  return result;
}

/** For each incoming edge of `uid`, collect (sourceUid, family) outline refs. */
export function reportOutlineRefs(
  uid: string,
  state: LineageReportState
): Array<[string, EdgeFamily]> {
  const refs = new Map<string, [string, EdgeFamily]>();
  for (const edge of state.incomingByTarget.get(uid) || []) {
    for (const source of reportTraceVisibleSources(
      edge.source,
      edge.family,
      state.visible,
      state.incomingByTarget
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
    return (familyOrder[a[1]] || 9) - (familyOrder[b[1]] || 9);
  });
}

/* ------------------------------------------------------------------ */
/* Text preview                                                       */
/* ------------------------------------------------------------------ */

/** Build the plain-text preview of a `LineageSummary`. */
export function makePreview(summary: LineageSummary): string {
  if (summary.preview) return summary.preview;
  const lines: string[] = [];
  lines.push(`${summary.project_uid}/${summary.start_uid}`);
  lines.push(`类型: ${summary.start_job.job_type}`);
  lines.push(`最终颗粒数: ${summary.final_particle_count ?? "未知"}`);
  lines.push(
    `最终分辨率: ${
      summary.final_resolution_A
        ? `${formatBinFactor(summary.final_resolution_A)} Å`
        : "待从 FSC/metadata 补充"
    }`
  );
  lines.push("");
  lines.push("Map 下载:");
  for (const [name, url] of Object.entries(summary.map_download_urls)) {
    lines.push(`- ${name}: ${url}`);
  }
  lines.push("");
  lines.push("Ab initio / hetero class:");
  for (const item of summary.class_split_jobs) {
    lines.push(`- ${item.uid} ${item.job_type}`);
    for (const cls of item.classes) {
      lines.push(
        `  class ${cls.class_index}: ${cls.particle_count} particles (${cls.particle_percent}%) maps=${cls.maps
          .map((m) => m.result_name)
          .join(", ")}`
      );
    }
  }
  lines.push("");
  lines.push("Micrograph 源头:");
  for (const job of summary.import_or_leaf_jobs) {
    lines.push(
      `- ${job.uid} ${job.job_type}: ${job.micrograph_count ?? "?"} micrographs${
        pixelSizeText(job) ? `, pixel ${pixelSizeText(job)}` : ""
      }`
    );
  }
  return lines.join("\n");
}
