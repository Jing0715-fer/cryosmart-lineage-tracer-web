/**
 * Hand-rolled OOXML PPTX builder for the CryoSmart lineage "Picture Flow".
 *
 * Ported verbatim from `CryoSmartLineageTracer_3.0/popup.js`:
 *   - OOXML XML string builders (`ppt*Xml` family)
 *   - Slide-content ops (`pptAddText`, `pptAddShape`, `pptAddImage`,
 *     `pptAddHeader`, `pptAddNodeCard`, `pptAddMetricCard`,
 *     `pptAddImageFrame`)
 *   - Per-slide builders (`buildPptOverviewSlide`, `buildPptRoundSlide`,
 *     `buildPptClassSlide`, `buildPptMapSlide`)
 *   - Logical-coordinate layer (`pptLogicalScale`, `pptLogicalBox`,
 *     `pptLogicalX/Y/W/H`, `pptLogicalFont`, `pptLogicalText/Shape/Image/
 *     Arrow/ImageFrame/NodeCard/ClassGrid`)
 *   - Object-flow assembler (`buildPictureFlowPptObjectOps`,
 *     `buildPptObjectPictureFlowSlide`)
 *   - Package assembler (`buildPictureFlowPptx`)
 *
 * Image embedding differs from the original: instead of fetching images
 * via `fetchPptImages` (which only works inside the Chrome extension),
 * the caller passes an optional `images: Map<string, Uint8Array>` keyed
 * by image URL. The builder walks `collectPptImageRequests(summary)` to
 * resolve each image key → URL → bytes. If a URL is missing from the map,
 * a placeholder text shape is emitted in place of the picture (instead
 * of crashing).
 *
 * The ChimeraX-replacement marker `name="CryoSmartImage:<key>"` on the
 * `<p:cNvPr>` element is preserved EXACTLY — ChimeraX Python scripts use
 * this marker to substitute images post-hoc.
 *
 * All `report*` helpers used internally (e.g. `reportBuildLineageState`,
 * `reportLineageRound`, `reportRoundNodes`, …) are imported from
 * `./lineage`. A handful of small helpers (`escHtml`, `safePart`,
 * `localImageFilename`, `pptImageKey`, `reportFirstMicrographNode`,
 * `reportSelectedClassIndices`) are not exported from `./lineage` — those
 * are defined locally with `// duplicated` comments.
 */

import type {
  ClassSplit,
  ClassSplitJob,
  LineageNode,
  LineageReportState,
  LineageSummary,
} from "./types";
import {
  PPTX_CONTENT_TYPE,
  PPT_EMU,
  PPT_W,
  PPT_H,
  PPT_MARGIN,
  PPT_PAPER_FONT_SIZE,
  PPT_TWO_COLUMN_RATIO,
  PPT_COLORS,
  SVG_A4_WIDTH,
  SVG_A4_HEIGHT,
  SVG_A4_CENTER_X,
} from "./constants";
import { makeZip } from "./zip";
import {
  parseClassIndex,
  mapPreviewImageName,
  normalMapAssets,
  pixelSizeText,
  reportLineageRound,
  reportBuildLineageState,
} from "./lineage";
import {
  fmt,
  reportNodeCardKind,
  reportMetricText,
  reportPictureParticleMetricText,
  reportRoundNodes,
  reportRoundParticleNodes,
  safePart,
  localImageFilename,
  reportFirstMicrographNode,
  reportSelectedClassIndices,
} from "./report-html";

/* ================================================================== */
/* Small helpers — duplicated from `./lineage.ts`                     */
/* ================================================================== */

/** HTML/XML special-character escaper (matches the original `escHtml`). */
function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stable key for a (uid, name) image — used by the PPTX image XML and
 *  by the SVG renderer when matching `imageDataMap` entries. */
function pptImageKey(nodeUid: string, name: string): string {
  return `${safePart(nodeUid)}/${safePart(name)}`;
}

/* ================================================================== */
/* Image-byte utilities                                               */
/* ================================================================== */

/** Decode a `data:` URI into bytes + MIME, or `null` if not a data URI. */
function bytesFromDataUri(uri: string): { bytes: Uint8Array; mime: string } | null {
  const match = String(uri || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

/** Sniff the MIME type of an image from its leading bytes. */
function sniffImageMime(bytes: Uint8Array, fallback = "image/png"): string {
  if (bytes && bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (bytes && bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  return fallback || "image/png";
}

/** Pick a file extension for a MIME type (`image/png` → `png`). */
function imageExtFromMime(mime: string): string {
  const value = String(mime || "").toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  return "png";
}

/** De-duplicate URL candidates (drops `null` and repeats). */
function dedupeUrls(urls: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls || []) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export interface PptImageInfo {
  key: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  width: number;
  height: number;
}

/** Parse PNG / JPEG dimensions out of image bytes. */
function imageInfo(bytes: Uint8Array): { width: number; height: number } {
  let width = 1;
  let height = 1;
  if (bytes.length > 24 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        height = (bytes[i + 5] << 8) | bytes[i + 6];
        width = (bytes[i + 7] << 8) | bytes[i + 8];
        break;
      }
      i += 2 + len;
    }
  }
  return { width: width || 1, height: height || 1 };
}

/* ================================================================== */
/* PPTX primitives                                                    */
/* ================================================================== */

/** XML-escape for OOXML (uses `&apos;` instead of `&#39;` for apostrophes). */
function pptXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Convert inches to PowerPoint EMU (914400 per inch). */
function pptEmu(value: number): number {
  return Math.round(value * PPT_EMU);
}

/** Convert point size to OOXML `sz` attribute (point × 100, min 100). */
function pptFontSize(value: number): number {
  return Math.max(100, Math.round(value * 100));
}

/** Normalize a hex color (strip leading `#`, uppercase, default to text color). */
function pptColor(value: string | null | undefined): string {
  return String(value || PPT_COLORS.text).replace(/^#/, "").toUpperCase();
}

/** Render `<a:solidFill>` or `<a:noFill/>`. */
function pptFillXml(fill: string | null | undefined): string {
  return fill
    ? `<a:solidFill><a:srgbClr val="${pptColor(fill)}"/></a:solidFill>`
    : "<a:noFill/>";
}

/** Render `<a:ln>` for a stroke. */
function pptLineXml(line: string | null | undefined, width = 1): string {
  return line
    ? `<a:ln w="${Math.round(width * 12700)}"><a:solidFill><a:srgbClr val="${pptColor(line)}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
}

interface PptKindStyle {
  fill: string;
  line: string;
}

/** Pick the fill/line colors for a node "kind" (micrograph/particle/volume/other). */
function pptKindStyle(kind: string): PptKindStyle {
  if (kind === "micrograph") return { fill: PPT_COLORS.microFill, line: PPT_COLORS.microLine };
  if (kind === "particle") return { fill: PPT_COLORS.particleFill, line: PPT_COLORS.particleLine };
  if (kind === "volume") return { fill: PPT_COLORS.volumeFill, line: PPT_COLORS.volumeLine };
  return { fill: PPT_COLORS.otherFill, line: PPT_COLORS.otherLine };
}

/* ================================================================== */
/* Slide / shape data model                                           */
/* ================================================================== */

export interface PptShapeItem {
  type: "shape" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fill?: string | null;
  line?: string | null;
  lineWidth?: number;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: string;
  valign?: string;
  /** For image items: the `pptImageKey(uid, name)` used to look up bytes. */
  key?: string;
  /** For image items: `"contain"` (default) or `"cover"`. */
  fit?: string;
}

export interface PptSlide {
  title: string;
  items: PptShapeItem[];
}

/** Allocate a fresh slide object. */
function pptNewSlide(title = ""): PptSlide {
  return { title, items: [] };
}

/** Add a shape (rectangle) to a slide. */
function pptAddShape(
  slide: PptSlide,
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<PptShapeItem> = {},
): void {
  slide.items.push({ type: "shape", x, y, w, h, ...options });
}

/** Add a text box (rectangle with text) to a slide. */
function pptAddText(
  slide: PptSlide,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  options: Partial<PptShapeItem> = {},
): void {
  pptAddShape(slide, x, y, w, h, {
    ...options,
    text,
    fill: options.fill || null,
    line: options.line || null,
  });
}

/** Add an image (referenced by `pptImageKey`) to a slide. */
function pptAddImage(
  slide: PptSlide,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<PptShapeItem> = {},
): void {
  if (!key) return;
  slide.items.push({ type: "image", key, x, y, w, h, ...options });
}

/** Add a slide header (centered title + optional subtitle). */
function pptAddHeader(slide: PptSlide, title: string, subtitle = ""): void {
  pptAddText(slide, PPT_MARGIN, 0.22, PPT_W - PPT_MARGIN * 2, 0.34, title, {
    fontSize: 20,
    bold: true,
    align: "center",
  });
  if (subtitle) {
    pptAddText(slide, PPT_MARGIN, 0.56, PPT_W - PPT_MARGIN * 2, 0.22, subtitle, {
      fontSize: 10.5,
      color: PPT_COLORS.muted,
      align: "center",
    });
  }
}

/** Build a multi-line text label for a node card. */
function pptNodeLabel(node: LineageNode, compact = false): string {
  const metric = reportMetricText(node, true);
  if (compact) return `${node.uid}\n${node.job_type || ""}${metric ? `\n${metric}` : ""}`;
  return `${node.uid} ${node.job_type || ""}${metric ? `\n${metric}` : ""}`;
}

/** Add a node-card shape (colored fill + line + label). */
function pptAddNodeCard(
  slide: PptSlide,
  node: LineageNode,
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<PptShapeItem> = {},
): void {
  const kind = reportNodeCardKind(node);
  const style = pptKindStyle(kind);
  pptAddShape(slide, x, y, w, h, {
    fill: style.fill,
    line: style.line,
    lineWidth: options.lineWidth || 1.7,
    text: pptNodeLabel(node, true),
    fontSize: options.fontSize || 9.5,
    bold: true,
    align: "left",
    valign: "mid",
  });
}

/** Add a metric-card shape (title + lines, colored by `kind`). */
function pptAddMetricCard(
  slide: PptSlide,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  lines: string[],
  kind: string = "other",
): void {
  const style = pptKindStyle(kind);
  pptAddShape(slide, x, y, w, h, {
    fill: style.fill,
    line: style.line,
    lineWidth: 1.2,
    text: [title, ...(lines || [])].filter(Boolean).join("\n"),
    fontSize: 10,
    bold: true,
    align: "left",
    valign: "mid",
  });
}

/** Add an image frame: white rectangle + image + optional label below. */
function pptAddImageFrame(
  slide: PptSlide,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label = "",
): void {
  pptAddShape(slide, x, y, w, h, {
    fill: PPT_COLORS.white,
    line: PPT_COLORS.line,
    lineWidth: 0.8,
  });
  pptAddImage(slide, key, x + 0.03, y + 0.03, w - 0.06, h - 0.2);
  if (label) {
    pptAddText(slide, x, y + h - 0.17, w, 0.15, label, {
      fontSize: 7.5,
      color: PPT_COLORS.muted,
      align: "center",
    });
  }
}

/* ================================================================== */
/* Image request collection                                           */
/* ================================================================== */

interface PptImageRequest {
  key: string;
  url: string;
  urls: string[];
}

/** Add an image-fetch request to the `map` keyed by `pptImageKey`. */
function pptAddImageRequest(
  map: Map<string, PptImageRequest>,
  nodeUid: string,
  name: string,
  url: string | null | undefined,
  fallbackUrls: (string | null | undefined)[] = [],
): void {
  const urls = dedupeUrls([url, ...fallbackUrls]);
  if (!urls.length) return;
  const key = pptImageKey(nodeUid, name);
  if (!map.has(key)) map.set(key, { key, url: urls[0], urls });
}

/** Walk the summary and collect every image needed by the PPTX. */
function collectPptImageRequests(summary: LineageSummary): PptImageRequest[] {
  const requests = new Map<string, PptImageRequest>();
  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    for (const image of (microNode.representative_micrograph_images || []).slice(0, 3)) {
      pptAddImageRequest(
        requests,
        microNode.uid,
        image.name || "image",
        image.original_url || image.src || image.url,
        [image.src, image.url],
      );
    }
  }
  for (const node of summary.nodes || []) {
    if (node.select_2d) {
      const s = node.select_2d;
      pptAddImageRequest(
        requests,
        node.uid,
        "selected_classes",
        s.selected_classes_original_url || s.selected_classes_src || s.selected_classes_image,
        [s.selected_classes_src, s.selected_classes_image],
      );
    }
    for (const cls of node.classes || []) {
      pptAddImageRequest(
        requests,
        node.uid,
        cls.volume_group || `class_${cls.class_index}`,
        cls.mrc_preview_original_url || cls.mrc_preview_src || cls.mrc_preview_url,
        [cls.mrc_preview_src, cls.mrc_preview_url],
      );
    }
    for (const item of normalMapAssets(node)) {
      pptAddImageRequest(
        requests,
        node.uid,
        mapPreviewImageName(item.group),
        item.preview_original_url || item.preview_src || item.preview_url,
        [item.preview_src, item.preview_url],
      );
    }
  }
  return Array.from(requests.values());
}

/**
 * Resolve `collectPptImageRequests(summary)` against a `Map<URL, Uint8Array>`
 * supplied by the caller. Returns `Map<pptImageKey, PptImageInfo>`.
 *
 * Missing URLs simply produce no entry — the slide renderer will emit a
 * placeholder text shape in place of the missing picture.
 */
function resolvePptImages(
  summary: LineageSummary,
  images: Map<string, Uint8Array> | null | undefined,
): Map<string, PptImageInfo> {
  const resolved = new Map<string, PptImageInfo>();
  if (!images || images.size === 0) return resolved;
  for (const request of collectPptImageRequests(summary)) {
    const urls = dedupeUrls([...(request.urls || []), request.url]);
    for (const url of urls) {
      const bytes = images.get(url);
      if (!bytes) continue;
      const info = imageInfo(bytes);
      const mime = sniffImageMime(bytes);
      resolved.set(request.key, {
        key: request.key,
        bytes,
        mime,
        ext: imageExtFromMime(mime),
        width: info.width,
        height: info.height,
      });
      break;
    }
  }
  return resolved;
}

/* ================================================================== */
/* Per-slide builders (overview / round / class / map)                */
/* ================================================================== */

/** Build the overview slide (micrographs + per-round metric cards). */
function buildPptOverviewSlide(summary: LineageSummary, state: LineageReportState): PptSlide {
  const slide = pptNewSlide("Overview");
  pptAddHeader(slide, `CryoSmart ${summary.project_uid}/${summary.start_uid}`, `${(summary.nodes || []).length} nodes · Picture Flow`);
  const microNode = reportFirstMicrographNode(summary);
  let y = 0.95;
  if (microNode) {
    pptAddText(
      slide,
      PPT_MARGIN,
      y,
      PPT_W - PPT_MARGIN * 2,
      0.28,
      `${fmt(microNode.micrograph_count)} micrographs${pixelSizeText(microNode) ? ` · ${pixelSizeText(microNode)}` : ""}`,
      { fontSize: 18, bold: true, align: "center" },
    );
    y += 0.38;
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 1.75;
    const gap = 0.16;
    const startX = (PPT_W - imgs.length * imgW - Math.max(0, imgs.length - 1) * gap) / 2;
    imgs.forEach((image, index) => {
      pptAddImageFrame(
        slide,
        pptImageKey(microNode.uid, image.name || "image"),
        startX + index * (imgW + gap),
        y,
        imgW,
        imgW,
        image.name || "",
      );
    });
    y += imgs.length ? imgW + 0.42 : 0.34;
    pptAddText(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.22, `${microNode.uid} ${microNode.job_type || ""}`, {
      fontSize: 10.5,
      color: PPT_COLORS.muted,
      align: "center",
    });
    y += 0.42;
  }
  const rounds = Array.from(
    new Set(
      (summary.nodes || [])
        .map((node) => reportLineageRound(node.uid, state))
        .filter((round) => round > 0),
    ),
  ).sort((a, b) => a - b);
  const cardW = (PPT_W - PPT_MARGIN * 2 - 0.18) / 2;
  rounds.forEach((round, index) => {
    const x = PPT_MARGIN + (index % 2) * (cardW + 0.18);
    const row = Math.floor(index / 2);
    const roundNodes = reportRoundNodes(summary, state, round, () => true);
    const particles = roundNodes.find(
      (node) => node.particle_count !== null && node.particle_count !== undefined,
    )?.particle_count;
    const maps = roundNodes.filter(
      (node) =>
        normalMapAssets(node).length > 0 ||
        (summary.class_split_jobs || []).some((item) => item.uid === node.uid),
    ).length;
    pptAddMetricCard(
      slide,
      x,
      y + row * 0.82,
      cardW,
      0.66,
      `Round ${round}${round > 1 ? " repicking" : ""}`,
      [
        `${roundNodes.length} jobs`,
        particles ? `${fmt(particles)} particles` : "",
        maps ? `${maps} map/refine jobs` : "",
      ].filter(Boolean),
      round > 1 ? "particle" : "volume",
    );
  });
  return slide;
}

/** Build a per-round slide (particle steps + select_2D summary). */
function buildPptRoundSlide(
  summary: LineageSummary,
  state: LineageReportState,
  round: number,
): PptSlide {
  const slide = pptNewSlide(`Round ${round}`);
  pptAddHeader(slide, `Round ${round}${round > 1 ? " repicking" : ""}`, "Picking / extraction, 2D selection and inputs");
  let y = 0.92;
  const selectNodes = reportRoundNodes(summary, state, round, (node) => Boolean(node.select_2d));
  const addParticleSection = (nodes: LineageNode[], title: string): void => {
    if (!nodes.length) return;
    pptAddText(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.22, title, {
      fontSize: 13,
      bold: true,
    });
    y += 0.3;
    const cols = 2;
    const gap = 0.14;
    const cardW = (PPT_W - PPT_MARGIN * 2 - gap) / cols;
    const cardH = 0.62;
    nodes.slice(0, 10).forEach((node, index) => {
      const x = PPT_MARGIN + (index % cols) * (cardW + gap);
      const yy = y + Math.floor(index / cols) * (cardH + 0.1);
      pptAddNodeCard(slide, node, x, yy, cardW, cardH, { fontSize: 8.8 });
    });
    y += Math.ceil(Math.min(nodes.length, 10) / cols) * (cardH + 0.1) + 0.16;
  };
  const preParticleNodes = reportRoundParticleNodes(summary, state, round, selectNodes.length ? false : null);
  const postParticleNodes = selectNodes.length ? reportRoundParticleNodes(summary, state, round, true) : [];
  addParticleSection(preParticleNodes, "Picking / extraction");
  for (const node of selectNodes.slice(0, 2)) {
    const s = node.select_2d!;
    const input = node.particle_count ?? s.particles_selected ?? null;
    const selected = s.particles_selected;
    const ratio =
      typeof input === "number" && typeof selected === "number" && input > 0
        ? `${Math.round((selected / input) * 1000) / 10}%`
        : "";
    pptAddMetricCard(
      slide,
      PPT_MARGIN,
      y,
      PPT_W - PPT_MARGIN * 2,
      0.58,
      `${node.uid} select_2D`,
      [
        `input ${input ? fmt(input) : "?"} particles`,
        `selected ${s.classes_selected ?? "?"} classes; output ${selected ? fmt(selected) : "?"}${ratio ? ` (${ratio})` : ""}`,
      ],
      "particle",
    );
    y += 0.72;
    if (s.selected_classes_image) {
      pptAddImageFrame(slide, pptImageKey(node.uid, "selected_classes"), PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 2.0, "templates_selected");
      y += 2.16;
    }
  }
  addParticleSection(postParticleNodes, "Repicking / extraction");
  if (!preParticleNodes.length && !selectNodes.length && !postParticleNodes.length) {
    pptAddText(slide, PPT_MARGIN, 1.2, PPT_W - PPT_MARGIN * 2, 0.5, "No particle/2D summary for this round.", {
      fontSize: 16,
      color: PPT_COLORS.muted,
      align: "center",
    });
  }
  return slide;
}

/** Build a class-grid slide for an `abinit` / `hetero` / `class_3D` job. */
function buildPptClassSlide(
  summary: LineageSummary,
  state: LineageReportState,
  node: LineageNode,
): PptSlide {
  const slide = pptNewSlide(`${node.uid} ${node.job_type || ""}`);
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  const selected = reportSelectedClassIndices(node.uid, summary, state);
  const metric = reportMetricText(node, true);
  pptAddHeader(slide, `${node.uid} ${node.job_type || ""}`, metric);
  if (!classJob || !classJob.classes || !classJob.classes.length) return slide;
  const total =
    classJob.classes.find((item) => Number.isInteger(item.total_particles))?.total_particles || node.particle_count;
  pptAddText(
    slide,
    PPT_MARGIN,
    0.86,
    PPT_W - PPT_MARGIN * 2,
    0.22,
    `input ${total ? fmt(total) : "?"} particles${selected.size ? ` · selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}` : ""}`,
    {
      fontSize: 10.5,
      color: PPT_COLORS.muted,
      align: "center",
    },
  );
  const count = classJob.classes.length;
  const cols = count <= 6 ? count : 3;
  const gapX = 0.12;
  const gapY = 0.15;
  const tileW = (PPT_W - PPT_MARGIN * 2 - Math.max(0, cols - 1) * gapX) / cols;
  const rows = Math.ceil(count / cols);
  const tileH = Math.min(1.65, (PPT_H - 1.35 - 0.35 - Math.max(0, rows - 1) * gapY) / rows);
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const startX = (PPT_W - gridW) / 2;
  const startY = 1.22;
  classJob.classes.forEach((cls: ClassSplit, index: number) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const isSelected = selected.has(cls.class_index);
    pptAddShape(slide, x, y, tileW, tileH, {
      fill: PPT_COLORS.white,
      line: isSelected ? "111111" : PPT_COLORS.line,
      lineWidth: isSelected ? 2.2 : 0.7,
    });
    pptAddImage(
      slide,
      pptImageKey(node.uid, cls.volume_group || `class_${cls.class_index}`),
      x + 0.06,
      y + 0.06,
      tileW - 0.12,
      tileH - 0.56,
    );
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${cls.particle_percent}%` : "";
    const particles = cls.particle_count !== null && cls.particle_count !== undefined ? fmt(cls.particle_count) : "";
    pptAddText(slide, x + 0.04, y + tileH - 0.45, tileW - 0.08, 0.16, `class ${cls.class_index}${isSelected ? " selected" : ""}`, {
      fontSize: 7.5,
      bold: true,
      align: "center",
    });
    pptAddText(slide, x + 0.04, y + tileH - 0.27, tileW - 0.08, 0.17, pct, {
      fontSize: 11,
      bold: true,
      align: "center",
    });
    pptAddText(slide, x + 0.04, y + tileH - 0.11, tileW - 0.08, 0.11, particles, {
      fontSize: 6.8,
      color: PPT_COLORS.muted,
      align: "center",
    });
  });
  return slide;
}

/** Build a single-map preview slide (volume + particle count). */
function buildPptMapSlide(node: LineageNode): PptSlide {
  const slide = pptNewSlide(`${node.uid} ${node.job_type || ""}`);
  const maps = normalMapAssets(node);
  const item = maps.find((map) => map.preview_url) || maps[0];
  pptAddHeader(slide, `${node.uid} ${node.job_type || ""}`, reportMetricText(node, true));
  if (item && item.preview_url) {
    pptAddImageFrame(slide, pptImageKey(node.uid, mapPreviewImageName(item.group)), 1.8, 1.2, 4.65, 4.0, `${item.group} preview`);
  }
  if (node.particle_count !== null && node.particle_count !== undefined) {
    pptAddText(slide, PPT_MARGIN, 5.55, PPT_W - PPT_MARGIN * 2, 0.32, `${fmt(node.particle_count)} particles`, {
      fontSize: 18,
      bold: true,
      align: "center",
    });
  }
  return slide;
}

/* ================================================================== */
/* Logical-coordinate layer (maps SVG → PPT inches)                  */
/* ================================================================== */

export type PptLogicalOp =
  | PptLogicalTextOp
  | PptLogicalShapeOp
  | PptLogicalImageOp
  | PptLogicalBreakOp;

interface PptLogicalTextOp {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: string;
  valign?: string;
  fixedFontSize?: number;
}

interface PptLogicalShapeOp {
  type: "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fill?: string | null;
  line?: string | null;
  lineWidth?: number;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: string;
  valign?: string;
}

interface PptLogicalImageOp {
  type: "image";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit?: string;
  text?: string;
}

interface PptLogicalBreakOp {
  type: "break";
  y: number;
}

export interface PptScaleInfo {
  mode: "single" | "columns";
  scale: number;
  scaleX: number;
  scaleY: number;
  xOffset: number;
  yOffset: number;
  splitY?: number;
  leftX?: number;
  rightX?: number;
}

/** Decide how to fit `contentHeight` pixels of SVG content onto one A4 slide. */
function pptLogicalScale(contentHeight: number, ops: PptLogicalOp[] = []): PptScaleInfo {
  const margin = 22;
  if (contentHeight / SVG_A4_HEIGHT > PPT_TWO_COLUMN_RATIO) {
    const gutter = 34;
    const target = contentHeight / 2;
    const candidates = ops
      .filter((op): op is PptLogicalBreakOp => op.type === "break")
      .map((op) => op.y)
      .filter((y) => y > SVG_A4_HEIGHT * 0.28 && y < contentHeight - SVG_A4_HEIGHT * 0.18);
    const splitY = candidates.length
      ? candidates.reduce(
          (best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best),
          candidates[0],
        )
      : target;
    const columnWidth = (SVG_A4_WIDTH - gutter) / 2;
    const columnHeight = Math.max(splitY, contentHeight - splitY);
    return {
      mode: "columns",
      splitY,
      scaleX: columnWidth / SVG_A4_WIDTH,
      scaleY: Math.min(1, (SVG_A4_HEIGHT - margin * 2) / Math.max(columnHeight, 1)),
      yOffset: margin,
      leftX: 0,
      rightX: columnWidth + gutter,
      scale: 1,
      xOffset: 0,
    };
  }
  const scale = Math.min(1, (SVG_A4_HEIGHT - margin * 2) / Math.max(contentHeight, 1));
  return {
    mode: "single",
    scale,
    scaleX: scale,
    scaleY: scale,
    xOffset: 0,
    yOffset: Math.min(22, Math.max(0, (SVG_A4_HEIGHT - Math.min(contentHeight, SVG_A4_HEIGHT)) / 2)),
  };
}

interface PptLogicalBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Translate a logical-coordinate op into PPT-inch coordinates. */
function pptLogicalBox(op: Exclude<PptLogicalOp, PptLogicalBreakOp>, scaleInfo: PptScaleInfo): PptLogicalBox {
  const secondColumn = scaleInfo.mode === "columns" && op.y >= (scaleInfo.splitY || 0);
  const baseX =
    scaleInfo.mode === "columns"
      ? secondColumn
        ? scaleInfo.rightX || 0
        : scaleInfo.leftX || 0
      : scaleInfo.xOffset;
  const localY = secondColumn ? op.y - (scaleInfo.splitY || 0) : op.y;
  return {
    x: ((baseX + op.x * scaleInfo.scaleX) / SVG_A4_WIDTH) * PPT_W,
    y: ((scaleInfo.yOffset + localY * scaleInfo.scaleY) / SVG_A4_HEIGHT) * PPT_H,
    w: (op.w * scaleInfo.scaleX / SVG_A4_WIDTH) * PPT_W,
    h: (op.h * scaleInfo.scaleY / SVG_A4_HEIGHT) * PPT_H,
  };
}

/** Always return the paper-print font size (the original ignores scale). */
function pptLogicalFont(value: number, _scaleInfo: PptScaleInfo): number {
  return PPT_PAPER_FONT_SIZE;
}

function pptLogicalText(
  ops: PptLogicalOp[],
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  options: Partial<PptShapeItem> = {},
): void {
  const { type: _type, ...rest } = options;
  ops.push({ type: "text", x, y, w, h, text, ...rest });
}

function pptLogicalShape(
  ops: PptLogicalOp[],
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<PptShapeItem> = {},
): void {
  const { type: _type, ...rest } = options;
  ops.push({ type: "shape", x, y, w, h, ...rest });
}

function pptLogicalImage(
  ops: PptLogicalOp[],
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: Partial<PptShapeItem> = {},
): void {
  const { type: _type, ...rest } = options;
  ops.push({ type: "image", key, x, y, w, h, ...rest });
}

function pptLogicalImageFrame(
  ops: PptLogicalOp[],
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label = "",
  fit = "contain",
): void {
  pptLogicalImage(ops, key, x, y, w, h, { fit, text: label });
}

function pptLogicalArrow(ops: PptLogicalOp[], y: number, label = ""): number {
  pptLogicalText(ops, SVG_A4_CENTER_X - 20, y, 40, 22, "↓", {
    fontSize: 9,
    bold: true,
    align: "center",
    color: "111111",
  });
  if (label) {
    pptLogicalText(ops, SVG_A4_CENTER_X - 120, y + 21, 240, 16, label, {
      fontSize: PPT_PAPER_FONT_SIZE,
      bold: true,
      align: "center",
      color: "111111",
    });
    ops.push({ type: "break", y: y + 40 });
    return 40;
  }
  ops.push({ type: "break", y: y + 28 });
  return 28;
}

function pptLogicalNodeCard(
  ops: PptLogicalOp[],
  node: LineageNode,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const metric = reportPictureParticleMetricText(node) || reportMetricText(node, true);
  pptLogicalText(ops, x, y, w, h, `${node.job_type || ""}${metric ? `\n${metric}` : ""}`, {
    fontSize: PPT_PAPER_FONT_SIZE,
    bold: true,
    align: "center",
    color: "111111",
  });
}

function pptLogicalClassGrid(
  ops: PptLogicalOp[],
  node: LineageNode,
  classJob: ClassSplitJob,
  selected: Set<number>,
  startY: number,
): number {
  const classCount = classJob.classes.length;
  const cols = classCount <= 6 ? classCount : 4;
  const tileW = classCount <= 6 ? 104 : 84;
  const tileH = classCount <= 6 ? 112 : 96;
  const gapX = classCount <= 6 ? 12 : 14;
  const gapY = 15;
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  classJob.classes.forEach((cls: ClassSplit, index: number) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = left + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const name = cls.volume_group || `class_${cls.class_index}`;
    const isSelected = selected.has(cls.class_index);
    if (isSelected) {
      pptLogicalShape(ops, x, y, tileW, tileH, {
        fill: null,
        line: "111111",
        lineWidth: 1.1,
      });
    }
    pptLogicalImage(ops, pptImageKey(node.uid, name), x + 9, y + 6, tileW - 18, classCount <= 6 ? 52 : 45);
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${cls.particle_percent}%` : "";
    const count = cls.particle_count !== null && cls.particle_count !== undefined ? fmt(cls.particle_count) : "";
    pptLogicalText(ops, x + 4, y + (classCount <= 6 ? 66 : 58), tileW - 8, 12, pct, {
      fontSize: PPT_PAPER_FONT_SIZE,
      bold: true,
      align: "center",
      color: "111111",
    });
    pptLogicalText(ops, x + 4, y + (classCount <= 6 ? 82 : 74), tileW - 8, 10, count, {
      fontSize: PPT_PAPER_FONT_SIZE,
      color: "111111",
      align: "center",
    });
  });
  const rows = Math.ceil(classJob.classes.length / cols);
  return rows * tileH + Math.max(0, rows - 1) * gapY;
}

/* ================================================================== */
/* Picture-flow ops → single A4 slide                                */
/* ================================================================== */

/** Build the logical op stream for the A4 "picture flow" slide. */
function buildPictureFlowPptObjectOps(
  summary: LineageSummary,
  state: LineageReportState,
): { ops: PptLogicalOp[]; contentHeight: number } {
  const ops: PptLogicalOp[] = [];
  let y = 28;
  pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 25, "CryoSmart Picture Flow", {
    fontSize: 20,
    bold: true,
    align: "center",
  });
  y += 34;

  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 24, `${fmt(microNode.micrograph_count)} micrographs${pixelSizeText(microNode) ? ` · ${pixelSizeText(microNode)}` : ""}`, {
      fontSize: 18,
      align: "center",
    });
    y += 28;
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 112;
    const gap = 14;
    const startX = SVG_A4_CENTER_X - (imgs.length * imgW + Math.max(0, imgs.length - 1) * gap) / 2;
    imgs.forEach((img, index) => {
      pptLogicalImageFrame(ops, pptImageKey(microNode.uid, img.name || "image"), startX + index * (imgW + gap), y, imgW, imgW, "", "contain");
    });
    y += imgs.length ? imgW + 18 : 16;
  }

  const rounds = Array.from(
    new Set(
      (summary.nodes || [])
        .map((node) => reportLineageRound(node.uid, state))
        .filter((round) => round > 0),
    ),
  ).sort((a, b) => a - b);

  for (const round of rounds) {
    y += pptLogicalArrow(ops, y, round > 1 ? `Round ${round} repicking` : `Round ${round}`);
    pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 24, `Round ${round}${round > 1 ? " repicking" : ""}`, {
      fontSize: 20,
      bold: true,
      align: "center",
    });
    y += 30;

    const selectNodes = reportRoundNodes(summary, state, round, (node) => Boolean(node.select_2d));
    const addParticleOps = (nodes: LineageNode[], title: string): boolean => {
      if (!nodes.length) return false;
      pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 14, title, {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111",
      });
      y += 18;
      const cols = Math.min(3, nodes.length);
      const gap = 9;
      const cardW = (SVG_A4_WIDTH - 80 - Math.max(0, cols - 1) * gap) / cols;
      const cardH = 48;
      const startX = 40;
      nodes.slice(0, 9).forEach((node, index) => {
        const x = startX + (index % cols) * (cardW + gap);
        const yy = y + Math.floor(index / cols) * (cardH + 8);
        pptLogicalNodeCard(ops, node, x, yy, cardW, cardH);
      });
      y += Math.ceil(Math.min(nodes.length, 9) / cols) * (cardH + 8) + 12;
      return true;
    };

    const hasPreParticleOps = addParticleOps(
      reportRoundParticleNodes(summary, state, round, selectNodes.length ? false : null),
      "Picking / extraction",
    );
    if (hasPreParticleOps) y += pptLogicalArrow(ops, y);
    for (const node of selectNodes) {
      const s = node.select_2d!;
      const input = node.particle_count ?? s.particles_selected ?? null;
      const selected = s.particles_selected;
      const ratio =
        typeof input === "number" && typeof selected === "number" && input > 0
          ? `${Math.round((selected / input) * 1000) / 10}%`
          : "";
      pptLogicalText(ops, 50, y + 8, SVG_A4_WIDTH - 100, 16, "select_2D", {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111",
      });
      pptLogicalText(
        ops,
        50,
        y + 24,
        SVG_A4_WIDTH - 100,
        12,
        `${s.classes_selected ?? "?"} classes · ${selected ? fmt(selected) : "?"} particles${ratio ? ` · ${ratio}` : ""}`,
        {
          fontSize: PPT_PAPER_FONT_SIZE,
          align: "center",
          color: "111111",
        },
      );
      if (s.selected_classes_image) {
        pptLogicalImage(ops, pptImageKey(node.uid, "selected_classes"), 122, y + 42, 550, 96);
      }
      y += s.selected_classes_image ? 160 : 58;
      y += pptLogicalArrow(ops, y);
    }

    if (selectNodes.length) {
      const hasPostParticleOps = addParticleOps(
        reportRoundParticleNodes(summary, state, round, true),
        "Repicking / extraction",
      );
      if (hasPostParticleOps) y += pptLogicalArrow(ops, y);
    }

    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some(
        (item) => item.uid === node.uid && item.classes && item.classes.length,
      );
      return hasClasses || normalMapAssets(node).length > 0;
    });
    for (let index = 0; index < mapNodes.length; index += 1) {
      const node = mapNodes[index];
      const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
      pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 18, `${node.job_type || ""}`, {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111",
      });
      y += 20;
      if (classJob) {
        const selected = reportSelectedClassIndices(node.uid, summary, state);
        y += pptLogicalClassGrid(ops, node, classJob, selected, y) + 18;
      } else {
        const maps = normalMapAssets(node);
        const item = maps.find((map) => map.preview_url) || maps[0];
        if (item && item.preview_url) {
          pptLogicalImageFrame(
            ops,
            pptImageKey(node.uid, mapPreviewImageName(item.group)),
            SVG_A4_CENTER_X - 78,
            y,
            156,
            126,
            "",
          );
          y += 140;
        }
        if (node.particle_count !== null && node.particle_count !== undefined) {
          pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 20, `${fmt(node.particle_count)} particles`, {
            fontSize: PPT_PAPER_FONT_SIZE,
            align: "center",
            color: "111111",
          });
          y += 24;
        }
      }
      if (index < mapNodes.length - 1) {
        y += pptLogicalArrow(ops, y);
      }
    }
  }
  return { ops, contentHeight: y + 26 };
}

/** Build the single-A4-page "picture flow" slide. */
function buildPptObjectPictureFlowSlide(summary: LineageSummary): PptSlide {
  const state = reportBuildLineageState(summary);
  const { ops, contentHeight } = buildPictureFlowPptObjectOps(summary, state);
  const slide = pptNewSlide("Picture Flow");
  const scaleInfo = pptLogicalScale(contentHeight, ops);
  for (const op of ops) {
    if (op.type === "break") continue;
    const box = pptLogicalBox(op, scaleInfo);
    if (op.type === "image") {
      pptAddImage(slide, op.key || "", box.x, box.y, box.w, box.h, { fit: op.fit || "contain" });
    } else if (op.type === "text") {
      pptAddText(slide, box.x, box.y, box.w, box.h, op.text || "", {
        fontSize: pptLogicalFont(op.fontSize || 11, scaleInfo),
        bold: op.bold,
        color: op.color,
        align: op.align || "left",
        valign: op.valign || "mid",
      });
    } else {
      pptAddShape(slide, box.x, box.y, box.w, box.h, {
        fill: op.fill,
        line: op.line,
        lineWidth: (op.lineWidth || 1) * Math.min(scaleInfo.scaleX || 1, scaleInfo.scaleY || 1),
        text: op.text,
        fontSize: pptLogicalFont(op.fontSize || 9, scaleInfo),
        bold: op.bold,
        color: op.color,
        align: op.align || "left",
        valign: op.valign || "mid",
      });
    }
  }
  if (scaleInfo.mode === "columns") {
    pptAddText(slide, PPT_W / 2 - 0.16, PPT_H - 0.42, 0.32, 0.2, "→", {
      fontSize: 9,
      bold: true,
      align: "center",
      color: "111111",
    });
  }
  return slide;
}

/** Build the full slide deck (overview + per-round + per-map slides). */
function buildPictureFlowPptSlides(summary: LineageSummary): PptSlide[] {
  const state = reportBuildLineageState(summary);
  const slides: PptSlide[] = [buildPptOverviewSlide(summary, state)];
  const rounds = Array.from(
    new Set(
      (summary.nodes || [])
        .map((node) => reportLineageRound(node.uid, state))
        .filter((round) => round > 0),
    ),
  ).sort((a, b) => a - b);
  for (const round of rounds) {
    slides.push(buildPptRoundSlide(summary, state, round));
    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some(
        (item) => item.uid === node.uid && item.classes && item.classes.length,
      );
      return hasClasses || normalMapAssets(node).length > 0;
    });
    for (const node of mapNodes) {
      const hasClasses = (summary.class_split_jobs || []).some(
        (item) => item.uid === node.uid && item.classes && item.classes.length,
      );
      slides.push(hasClasses ? buildPptClassSlide(summary, state, node) : buildPptMapSlide(node));
    }
  }
  return slides;
}

/* ================================================================== */
/* Slide → XML renderers                                              */
/* ================================================================== */

/** Convert alignment string ("left"/"center"/"right") to OOXML code. */
function pptAlign(value: string | null | undefined): string {
  return (
    ({
      left: "l",
      center: "ctr",
      right: "r",
      l: "l",
      ctr: "ctr",
      r: "r",
    } as Record<string, string>)[String(value || "left")] || "l"
  );
}

/** Render the `<p:txBody>` block for a text shape. */
function pptTextXml(text: string, options: Partial<PptShapeItem> = {}): string {
  const lines = String(text ?? "").split(/\n/);
  const align = pptAlign(options.align || "left");
  const size = pptFontSize(options.fontSize || 12);
  const color = pptColor(options.color || PPT_COLORS.text);
  const bold = options.bold ? ' b="1"' : "";
  const paragraphs = lines
    .map(
      (line) =>
        `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${size}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Times New Roman"/><a:cs typeface="Times New Roman"/></a:rPr><a:t>${pptXml(line)}</a:t></a:r></a:p>`,
    )
    .join("");
  return `<p:txBody><a:bodyPr wrap="square" anchor="${options.valign || "mid"}" lIns="45720" rIns="45720" tIns="22860" bIns="22860"/><a:lstStyle/>${paragraphs}</p:txBody>`;
}

/** Render a `<p:sp>` (shape) element. */
function pptShapeXml(id: number, item: PptShapeItem): string {
  const fill = pptFillXml(item.fill);
  const line = pptLineXml(item.line, item.lineWidth || 1);
  const text =
    item.text !== undefined
      ? pptTextXml(item.text, item)
      : "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${pptEmu(item.x)}" y="${pptEmu(item.y)}"/><a:ext cx="${pptEmu(item.w)}" cy="${pptEmu(item.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>${text}</p:sp>`;
}

/** Contain-fit an image inside a box, preserving aspect ratio. */
function pptContainBox(
  image: PptImageInfo | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): PptLogicalBox {
  const iw = image && image.width ? image.width : 1;
  const ih = image && image.height ? image.height : 1;
  const ratio = iw / ih;
  const boxRatio = w / h;
  if (ratio > boxRatio) {
    const fitH = w / ratio;
    return { x, y: y + (h - fitH) / 2, w, h: fitH };
  }
  const fitW = h * ratio;
  return { x: x + (w - fitW) / 2, y, w: fitW, h };
}

/**
 * Render a `<p:pic>` (picture) element.
 *
 * IMPORTANT: the `name` attribute on `<p:cNvPr>` is `CryoSmartImage:<key>`.
 * ChimeraX Python scripts (the `CryoSmart_*_ppt.py` helpers shipped in
 * `public/helpers/`) grep the slide XML for this exact marker to find
 * picture shapes they should swap out with rendered snapshots. Do NOT
 * change the prefix or strip the key — post-hoc image substitution will
 * silently break.
 */
function pptImageXml(
  id: number,
  item: PptShapeItem,
  relId: string,
  image: PptImageInfo | undefined,
): string {
  const box = item.fit === "cover" ? { x: item.x, y: item.y, w: item.w, h: item.h } : pptContainBox(image, item.x, item.y, item.w, item.h);
  const name = `CryoSmartImage:${item.key || `Image ${id}`}`;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${pptXml(name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${pptEmu(box.x)}" y="${pptEmu(box.y)}"/><a:ext cx="${pptEmu(box.w)}" cy="${pptEmu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** Render the full `<p:sld>` document for a slide. */
function pptSlideXml(
  slide: PptSlide,
  imageRelIds: Map<string, string>,
  images: Map<string, PptImageInfo>,
): string {
  let id = 2;
  const items = slide.items
    .map((item) => {
      const currentId = id;
      id += 1;
      if (item.type === "image") {
        const relId = imageRelIds.get(item.key || "");
        const image = images.get(item.key || "");
        if (!relId || !image) {
          // Emit a placeholder text shape instead of crashing. The
          // marker `name="CryoSmartImage:<key>"` is preserved so that
          // downstream ChimeraX substitution scripts can still find the
          // slot — they only need the `<p:cNvPr name=...>` element to
          // exist, not an actual image blip.
          return `<p:sp><p:nvSpPr><p:cNvPr id="${currentId}" name="CryoSmartImage:${pptXml(item.key || `Image ${currentId}`)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${pptEmu(item.x)}" y="${pptEmu(item.y)}"/><a:ext cx="${pptEmu(item.w)}" cy="${pptEmu(item.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${pptFillXml(PPT_COLORS.otherFill)}${pptLineXml(PPT_COLORS.otherLine, 0.5)}</p:spPr>${pptTextXml(`[image not available: ${item.key || "?"}]`, { fontSize: 7, color: PPT_COLORS.muted, align: "center", valign: "mid" })}</p:sp>`;
        }
        return pptImageXml(currentId, item, relId, image);
      }
      return pptShapeXml(currentId, item);
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${pptFillXml(PPT_COLORS.white)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${items}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

interface PptSlideRel {
  id: string;
  mediaName: string;
}

/** Render the `_rels/slideN.xml.rels` for a slide. */
function pptSlideRelsXml(slideImageRels: PptSlideRel[]): string {
  const imageRels = slideImageRels
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${pptXml(rel.mediaName)}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imageRels}</Relationships>`;
}

/* ================================================================== */
/* Package-level XML builders                                         */
/* ================================================================== */

/** List image keys actually present on the slide (deduped, image-only). */
function pptUniqueSlideImageKeys(
  slide: PptSlide,
  images: Map<string, PptImageInfo>,
): string[] {
  return Array.from(
    new Set(
      slide.items
        .filter((item): item is PptShapeItem & { type: "image"; key: string } => {
          if (item.type !== "image") return false;
          if (typeof item.key !== "string" || !item.key) return false;
          return images.has(item.key);
        })
        .map((item) => item.key),
    ),
  );
}

/** Render `[Content_Types].xml`. */
function pptContentTypesXml(slideCount: number, imageExts: string[]): string {
  const imageDefaults = Array.from(new Set(imageExts))
    .map((ext) => {
      const type =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "svg"
              ? "image/svg+xml"
              : "image/png";
      return `<Default Extension="${pptXml(ext)}" ContentType="${type}"/>`;
    })
    .join("");
  const slides = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides}</Types>`;
}

/** Render `_rels/.rels`. */
function pptRootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

/** Render `ppt/presentation.xml`. */
function pptPresentationXml(slideCount: number): string {
  const slideIds = Array.from(
    { length: slideCount },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${pptEmu(PPT_W)}" cy="${pptEmu(PPT_H)}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

/** Render `ppt/_rels/presentation.xml.rels`. */
function pptPresentationRelsXml(slideCount: number): string {
  const slideRels = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`;
}

/** Render `ppt/slideMasters/slideMaster1.xml`. */
function pptSlideMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${pptFillXml(PPT_COLORS.white)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
}

/** Render `ppt/slideMasters/_rels/slideMaster1.xml.rels`. */
function pptSlideMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
}

/** Render `ppt/slideLayouts/slideLayout1.xml`. */
function pptSlideLayoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

/** Render `ppt/slideLayouts/_rels/slideLayout1.xml.rels`. */
function pptSlideLayoutRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
}

/** Render `ppt/theme/theme1.xml`. */
function pptThemeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CryoSmart"><a:themeElements><a:clrScheme name="CryoSmart"><a:dk1><a:srgbClr val="17202E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="526174"/></a:dk2><a:lt2><a:srgbClr val="F6F8FB"/></a:lt2><a:accent1><a:srgbClr val="16A05D"/></a:accent1><a:accent2><a:srgbClr val="D99300"/></a:accent2><a:accent3><a:srgbClr val="4D64E8"/></a:accent3><a:accent4><a:srgbClr val="CBD7E6"/></a:accent4><a:accent5><a:srgbClr val="8EE6AF"/></a:accent5><a:accent6><a:srgbClr val="F0C56B"/></a:accent6><a:hlink><a:srgbClr val="086AD8"/></a:hlink><a:folHlink><a:srgbClr val="293FAF"/></a:folHlink></a:clrScheme><a:fontScheme name="Times"><a:majorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface="Times New Roman"/></a:majorFont><a:minorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface="Times New Roman"/></a:minorFont></a:fontScheme><a:fmtScheme name="Simple"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

/** Render `docProps/core.xml`. */
function pptCoreXml(summary: LineageSummary): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>CryoSmart ${pptXml(summary.project_uid)}/${pptXml(summary.start_uid)} Picture Flow</dc:title><dc:creator>CryoSmart Lineage Tracer</dc:creator><cp:lastModifiedBy>CryoSmart Lineage Tracer</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

/** Render `docProps/app.xml`. */
function pptAppXml(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>CryoSmart Lineage Tracer</Application><PresentationFormat>A4 Portrait</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
}

/* ================================================================== */
/* Main entry point — `buildPictureFlowPptx`                         */
/* ================================================================== */

interface PptMediaPart extends PptImageInfo {
  mediaName: string;
}

/**
 * Build the CryoSmart "Picture Flow" PPTX as a single-page A4-portrait
 * deck and return it as a `Blob` ready for download or HTTP response.
 *
 * @param summary The full lineage summary produced by `buildSummary`.
 * @param images  Optional map of `imageURL → bytes` for embedding images
 *                fetched out-of-band (e.g. by the proxy route handler or
 *                by the JSON-upload client). When omitted, every picture
 *                shape emits a placeholder text instead of crashing —
 *                the ChimeraX substitution marker
 *                `name="CryoSmartImage:<key>"` is still attached so the
 *                bundled Python helper scripts can swap in real images
 *                after the fact.
 */
export function buildPictureFlowPptx(
  summary: LineageSummary,
  images: Map<string, Uint8Array> | null = null,
): Blob {
  const imagesByKey = resolvePptImages(summary, images);
  const slides = [buildPptObjectPictureFlowSlide(summary)];

  const mediaParts = new Map<string, PptMediaPart>();
  let mediaIndex = 1;
  for (const slide of slides) {
    for (const key of pptUniqueSlideImageKeys(slide, imagesByKey)) {
      if (!mediaParts.has(key)) {
        const image = imagesByKey.get(key);
        if (!image) continue;
        const mediaName = `image${mediaIndex}.${image.ext}`;
        mediaIndex += 1;
        mediaParts.set(key, { ...image, mediaName });
      }
    }
  }

  const files: { name: string; data: Uint8Array | string }[] = [];
  files.push({
    name: "[Content_Types].xml",
    data: pptContentTypesXml(
      slides.length,
      Array.from(mediaParts.values()).map((item) => item.ext),
    ),
  });
  files.push({ name: "_rels/.rels", data: pptRootRelsXml() });
  files.push({ name: "docProps/core.xml", data: pptCoreXml(summary) });
  files.push({ name: "docProps/app.xml", data: pptAppXml(slides.length) });
  files.push({ name: "ppt/presentation.xml", data: pptPresentationXml(slides.length) });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: pptPresentationRelsXml(slides.length) });
  files.push({ name: "ppt/slideMasters/slideMaster1.xml", data: pptSlideMasterXml() });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: pptSlideMasterRelsXml() });
  files.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: pptSlideLayoutXml() });
  files.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: pptSlideLayoutRelsXml() });
  files.push({ name: "ppt/theme/theme1.xml", data: pptThemeXml() });

  slides.forEach((slide, index) => {
    const rels: PptSlideRel[] = [];
    const relIdMap = new Map<string, string>();
    let relIndex = 2;
    for (const key of pptUniqueSlideImageKeys(slide, imagesByKey)) {
      const part = mediaParts.get(key);
      if (!part) continue;
      const relId = `rId${relIndex}`;
      relIndex += 1;
      relIdMap.set(key, relId);
      rels.push({ id: relId, mediaName: part.mediaName });
    }
    files.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: pptSlideXml(slide, relIdMap, imagesByKey),
    });
    files.push({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: pptSlideRelsXml(rels),
    });
  });

  for (const part of mediaParts.values()) {
    files.push({ name: `ppt/media/${part.mediaName}`, data: part.bytes });
  }

  return makeZip(files, PPTX_CONTENT_TYPE);
}
