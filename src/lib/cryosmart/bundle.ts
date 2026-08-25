/**
 * Bundle assembly: pulls together all the report generators + ZIP writer +
 * bundled helper scripts, and produces a single .zip Blob for download.
 *
 * Browser-only (uses fetch, Blob, URL).
 */

import type { LineageSummary } from "./types";
import { buildLineageHtmlV2, type ReportHtmlOptions } from "./report-html";
import { prefetchImagesForReport } from "./image-embed";
import { buildPictureFlowSvg } from "./report-svg";
import { buildPictureFlowPptx } from "./report-pptx";
import { makePreview } from "./lineage";
import { makeZip } from "./zip";
import {
  DEFAULT_BASE_URL,
  MAP_SUFFIXES,
} from "./constants";
import {
  cryoSmartBytes,
  type CryoSmartSession,
} from "./proxy-client";

export interface BundleOptions {
  includePptx: boolean;
  includeImages: boolean;
  includeMaps: boolean;
  includeFinalResults: boolean;
  /** Live-mode session (for downloading images/maps via proxy). */
  session?: CryoSmartSession | null;
}

export interface BundleFile {
  /** Path inside the ZIP, e.g. "images/J1/thumb.png". */
  path: string;
  /** Either raw bytes or a string (UTF-8). */
  data: Uint8Array | string;
}

export interface BundleProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export interface BundleResult {
  blob: Blob;
  filename: string;
  fileCount: number;
  warnings: string[];
}

const HELPER_FILES = [
  "helpers/CryoSmart_align_maps_check_view.py",
  "helpers/CryoSmart_export_current_view_ppt.py",
  "helpers/CryoSmart_auto_align_export_ppt.py",
  "helpers/rebuild_picture_flow_pptx.mjs",
];

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Assemble the full download bundle as a ZIP.
 *
 * @param summary    The lineage summary (already built).
 * @param options    What to include.
 * @param onProgress Optional progress callback.
 */
export async function buildBundle(
  summary: LineageSummary,
  options: BundleOptions,
  onProgress?: (p: BundleProgress) => void
): Promise<BundleResult> {
  const warnings: string[] = [];
  const files: BundleFile[] = [];
  const project = summary.project_uid || "P";
  const startUid = summary.start_uid || "J0";
  const base = `CryoSmart_${project}_${startUid}_lineage`;

  onProgress?.({ phase: "report", current: 0, total: 6, message: "Generating JSON…" });
  files.push({ path: `${base}.json`, data: utf8(JSON.stringify(summary, null, 2)) });

  onProgress?.({ phase: "report", current: 1, total: 6, message: "Generating HTML report…" });
  // Build HTML report with embedded images when session is available
  let htmlOpts: ReportHtmlOptions | undefined;
  if (options.includeImages && options.session) {
    onProgress?.({ phase: "images", current: 0, total: 2, message: "Prefetching images for report..." });
    const embeddedImages = await prefetchImagesForReport(options.session, summary, (msg) =>
      onProgress?.({ phase: "images", current: 0, total: 2, message: msg })
    );
    htmlOpts = { embeddedImages, session: options.session };
  }
  files.push({ path: `${base}_report.html`, data: utf8(buildLineageHtmlV2(summary, htmlOpts)) });

  onProgress?.({ phase: "report", current: 2, total: 6, message: "Generating SVG…" });
  try {
    const svg = buildPictureFlowSvg(summary);
    files.push({ path: `${base}_picture_flow.svg`, data: utf8(svg) });
  } catch (err) {
    warnings.push(`SVG generation failed: ${(err as Error).message}`);
  }

  onProgress?.({ phase: "report", current: 3, total: 6, message: "Generating Mermaid…" });
  if (summary.focused_mermaid) {
    files.push({ path: `${base}.mmd`, data: utf8(summary.focused_mermaid) });
  }

  onProgress?.({ phase: "report", current: 4, total: 6, message: "Generating preview text…" });
  try {
    const preview = makePreview(summary);
    files.push({ path: `${base}_preview.txt`, data: utf8(preview) });
  } catch (err) {
    warnings.push(`Preview text failed: ${(err as Error).message}`);
  }

  onProgress?.({ phase: "report", current: 5, total: 6, message: "Bundling helper scripts…" });
  for (const helperPath of HELPER_FILES) {
    try {
      const resp = await fetch(`/${helperPath}`);
      if (resp.ok) {
        const text = await resp.text();
        files.push({ path: helperPath.replace(/^helpers\//, ""), data: utf8(text) });
      }
    } catch (err) {
      warnings.push(`Helper ${helperPath} fetch failed: ${(err as Error).message}`);
    }
  }

  // PPTX (optional)
  if (options.includePptx) {
    onProgress?.({ phase: "pptx", current: 0, total: 2, message: "Fetching PPTX images…" });
    const imageMap = new Map<string, Uint8Array>();
    if (options.session) {
      try {
        await collectPptImages(summary, options.session, imageMap, (msg) =>
          onProgress?.({ phase: "pptx", current: 0, total: 2, message: msg })
        );
      } catch (err) {
        warnings.push(`PPTX image fetch failed: ${(err as Error).message}`);
      }
    }
    onProgress?.({ phase: "pptx", current: 1, total: 2, message: "Building PPTX…" });
    try {
      const blob = buildPictureFlowPptx(summary, imageMap);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files.push({ path: `${base}_picture_flow.pptx`, data: bytes });
    } catch (err) {
      warnings.push(`PPTX build failed: ${(err as Error).message}`);
    }
  }

  // Images (optional)
  if (options.includeImages) {
    onProgress?.({ phase: "images", current: 0, total: 1, message: "Collecting preview images…" });
    if (options.session) {
      const imageItems = collectImageRequests(summary);
      let done = 0;
      for (const item of imageItems) {
        try {
          const bytes = await cryoSmartBytes(options.session, item.url);
          files.push({ path: `images/${item.path}`, data: bytes });
        } catch (err) {
          warnings.push(`Image ${item.path} failed: ${(err as Error).message}`);
        }
        done++;
        onProgress?.({
          phase: "images",
          current: done,
          total: imageItems.length,
          message: `Image ${done}/${imageItems.length}: ${item.path}`,
        });
      }
    } else {
      warnings.push("Image download skipped: requires session from Smart Capture mode.");
    }
  }

  // Maps (optional)
  if (options.includeMaps) {
    onProgress?.({ phase: "maps", current: 0, total: 1, message: "Collecting maps…" });
    if (options.session) {
      const mapItems = collectMapRequests(summary);
      let done = 0;
      for (const item of mapItems) {
        try {
          const bytes = await cryoSmartBytes(options.session, item.url);
          files.push({ path: `maps/${item.path}`, data: bytes });
        } catch (err) {
          warnings.push(`Map ${item.path} failed: ${(err as Error).message}`);
        }
        done++;
        onProgress?.({
          phase: "maps",
          current: done,
          total: mapItems.length,
          message: `Map ${done}/${mapItems.length}: ${item.path}`,
        });
      }
    } else {
      warnings.push("Map download skipped: requires session from Smart Capture mode.");
    }
  }

  // Final results (optional) — only available in live mode
  if (options.includeFinalResults) {
    if (options.session) {
      onProgress?.({ phase: "final", current: 0, total: 1, message: "Scanning final results…" });
      const baseUrl = options.session.baseUrl || DEFAULT_BASE_URL;
      const projectId = summary.project_uid;
      const startUid = summary.start_uid;
      const suffixes = [
        "volume.map",
        "volume.map_sharp",
        "volume.map_half_A",
        "volume.map_half_B",
        "volume.mask_refine",
        "mask.mask_refine",
      ];
      const graphPaths = [
        { kind: "fsc", iteration: 1, suffix: "FSC", ext: "png" },
        { kind: "fsc", iteration: 1, suffix: "FSC", ext: "pdf" },
        { kind: "guinier", iteration: 1, suffix: "Guinier_Plot", ext: "png" },
        { kind: "guinier", iteration: 1, suffix: "Guinier_Plot", ext: "pdf" },
        { kind: "direction_distribution", iteration: 1, suffix: "Direction_Distribution", ext: "png" },
      ];
      // Try to fetch final maps (best-effort; will 404 if the job isn't a refine).
      const finalFiles: BundleFile[] = [];
      for (const suffix of suffixes) {
        const url = `api/log_image/download_result_file/${projectId}/${startUid}.${suffix}`;
        try {
          const bytes = await cryoSmartBytes(options.session, url);
          finalFiles.push({
            path: `Final_Result/Map/BJ.${projectId}.${startUid}.${suffix}.mrc`,
            data: bytes,
          });
        } catch {
          // expected to fail for non-refine jobs
        }
      }
      // Plots (best-effort; we don't know the exact iteration, try 1)
      for (const g of graphPaths) {
        const url = `api/log_image/${g.kind}_${g.iteration}_${g.suffix}.${g.ext}`;
        try {
          const bytes = await cryoSmartBytes(options.session, url);
          finalFiles.push({
            path: `Final_Result/${g.kind}/${g.suffix}.${g.ext}`,
            data: bytes,
          });
        } catch {
          // expected to fail
        }
      }
      files.push(...finalFiles);
      const summaryText = `Final result scan for ${projectId}/${startUid}.\n` +
        `Fetched ${finalFiles.length} files.\n` +
        `Generated at ${new Date().toISOString()}.\n`;
      files.push({ path: `Final_Result/final_result_summary.txt`, data: utf8(summaryText) });
    } else {
      warnings.push("Final results scan skipped: requires session from Smart Capture mode.");
    }
  }

  // download_warnings.txt if any
  if (warnings.length > 0) {
    files.push({ path: `download_warnings.txt`, data: utf8(warnings.join("\n") + "\n") });
  }

  onProgress?.({ phase: "zip", current: 0, total: 1, message: `Zipping ${files.length} files…` });

  // Build the ZIP
  const zipFiles = files.map((f) => ({
    name: f.path,
    data: typeof f.data === "string" ? utf8(f.data) : f.data,
  }));
  const blob = makeZip(zipFiles, "application/zip");

  onProgress?.({ phase: "done", current: 1, total: 1, message: "Done." });

  return {
    blob,
    filename: `${base}.zip`,
    fileCount: files.length,
    warnings,
  };
}

/** Collect image URLs from the summary for PPTX embedding. */
async function collectPptImages(
  summary: LineageSummary,
  session: CryoSmartSession,
  imageMap: Map<string, Uint8Array>,
  onMessage: (msg: string) => void
) {
  const requests = collectImageRequests(summary);
  let done = 0;
  for (const req of requests) {
    try {
      const bytes = await cryoSmartBytes(session, req.url);
      imageMap.set(req.url, bytes);
      imageMap.set(req.path, bytes);
    } catch {
      // skip
    }
    done++;
    onMessage(`PPT image ${done}/${requests.length}: ${req.path}`);
  }
}

/** Gather all preview image URLs referenced by the summary. */
export function collectImageRequests(summary: LineageSummary): Array<{ url: string; path: string }> {
  const out: Array<{ url: string; path: string }> = [];
  for (const node of summary.nodes || []) {
    const uid = node.uid || "J0";
    if (Array.isArray(node.images)) {
      for (const img of node.images) {
        if (img.url) {
          out.push({ url: img.url, path: `${uid}/${img.name || "image"}.png` });
        }
      }
    }
    if (Array.isArray(node.representative_micrograph_images)) {
      for (const img of node.representative_micrograph_images) {
        if (img.url) {
          out.push({ url: img.url, path: `${uid}/${img.name || "micrograph"}.png` });
        }
      }
    }
    if (Array.isArray(node.classes)) {
      node.classes.forEach((cls, i) => {
        // Per-class MRC preview (stored on ClassSplit, not ClassMap)
        if (cls.mrc_preview_url) {
          out.push({ url: cls.mrc_preview_url, path: `${uid}/class_${i}_preview.png` });
        }
        if (Array.isArray(cls.maps)) {
          for (const m of cls.maps) {
            if (m.download_url) {
              out.push({ url: m.download_url, path: `${uid}/class_${i}_${m.result_name || "map"}.png` });
            }
          }
        }
      });
    }
  }
  return out;
}

/** Gather all map/MRC download URLs. */
export function collectMapRequests(summary: LineageSummary): Array<{ url: string; path: string }> {
  const out: Array<{ url: string; path: string }> = [];
  const project = summary.project_uid || "P";
  const startUid = summary.start_uid || "J0";
  const baseUrl = summary.base_url || DEFAULT_BASE_URL;

  // Start job normal maps
  for (const suffix of MAP_SUFFIXES) {
    out.push({
      url: `api/log_image/download_result_file/${project}/${startUid}.${suffix}`,
      path: `${startUid}/BJ.${project}.${startUid}.${suffix}.mrc`,
    });
  }

  // Every node's normal map assets
  for (const node of summary.nodes || []) {
    const uid = node.uid || "J0";
    if (Array.isArray(node.maps)) {
      for (const m of node.maps) {
        if (m.download_url) {
          // Convert absolute URL → relative path for proxy
          let rel = m.download_url;
          if (rel.startsWith(baseUrl)) rel = rel.slice(baseUrl.length).replace(/^\/+/, "");
          out.push({
            url: rel,
            path: `${uid}/BJ.${project}.${uid}.${m.group || "volume"}.${m.result_name || "map"}.mrc`,
          });
        }
      }
    }
  }
  return out;
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
