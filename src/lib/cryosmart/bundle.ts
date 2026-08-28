/**
 * Bundle assembly: pulls together all the report generators + ZIP writer +
 * bundled helper scripts, and produces a single .zip Blob for download.
 *
 * Browser-only (uses fetch, Blob, URL).
 */

import type { LineageSummary } from "./types";
import {
  buildLineageHtmlV2,
  localImageFilename,
  mapPreviewAssetName,
  type ReportHtmlOptions,
} from "./report-html";
import { prefetchImagesForReport } from "./image-embed";
import { buildPictureFlowSvg } from "./report-svg";
import { buildPictureFlowPptx } from "./report-pptx";
import { makePreview, normalMapAssets } from "./lineage";
import { makeZip } from "./zip";
import {
  DEFAULT_BASE_URL,
  MAP_SUFFIXES,
} from "./constants";
import {
  cryoSmartBytes,
  isDirectCryosmartUrl,
  isSessionImageUrl,
  probeCryosmartReachable,
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

/** Run `worker` over `items` with at most `limit` concurrent invocations. */
async function pooledMap<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const runners = Array.from(
    { length: Math.max(0, Math.min(limit, items.length)) },
    async () => {
      while (index < items.length) {
        const i = index++;
        await worker(items[i], i);
      }
    }
  );
  await Promise.all(runners);
}

/** Text for `images/NOT_UPLOADED_LINKS.txt` — every image the ZIP could not
 *  bundle (bytes never uploaded by the capture script + CryoSmart
 *  unreachable from this app server), with its direct URL so the user can
 *  fetch it from the intranet manually. */
function notUploadedLinksText(
  baseUrl: string,
  items: Array<{ path: string; url: string }>
): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const lines = [
    "The images below are referenced by the report but were NOT bundled:",
    "their bytes were never uploaded by the Smart Capture script, and this",
    "app's server cannot reach the CryoSmart instance. Open each URL in a",
    "browser on the CryoSmart network (logged in to CryoSmart) and save it",
    "under the listed file name inside the images/ folder to complete the",
    "offline report.",
    "",
  ];
  for (const item of items) {
    const url = /^https?:\/\//i.test(item.url)
      ? item.url
      : `${base}/${String(item.url).replace(/^\/+/, "")}`;
    lines.push(`${item.path}`);
    lines.push(`    ${url}`);
  }
  return lines.join("\n") + "\n";
}

/** Text for `maps/DOWNLOAD_LINKS.txt` — direct CryoSmart URLs for every map
 *  that could not be bundled automatically. */
function mapLinksText(items: Array<{ path: string; link: string }>): string {
  const lines = [
    "The maps below could not be bundled automatically (this app's server",
    "cannot reach the CryoSmart instance). Open each URL in a browser on the",
    "CryoSmart network (logged in to CryoSmart) and save it under the listed",
    "file name inside the maps/ folder.",
    "",
  ];
  for (const item of items) {
    lines.push(`maps/${item.path}`);
    lines.push(`    ${item.link}`);
  }
  return lines.join("\n") + "\n";
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
  // Build HTML report with embedded images when session is available.
  // bundleMode=true tells reportImgTag to use a local `images/<uid>/<name>.png`
  // path (with an onerror fallback to the remote URL) for any image that
  // didn't get embedded as a base64 data URL — the downloadable ZIP ships
  // the `images/` folder alongside the HTML so the report works offline.
  let htmlOpts: ReportHtmlOptions = { bundleMode: options.includeImages };
  if (options.includeImages && options.session) {
    onProgress?.({ phase: "images", current: 0, total: 0, message: "Prefetching images for report..." });
    const embeddedImages = await prefetchImagesForReport(options.session, summary, (p) =>
      onProgress?.({
        phase: "images",
        current: p.current ?? 0,
        total: p.total ?? 0,
        message: p.message ?? "Embedding images…",
      })
    );
    htmlOpts = { embeddedImages, session: options.session, bundleMode: true };
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

  // ── Staged-session image partitioning + upstream reachability ──────
  // (v3.13) Images referenced by the report come in two flavours after a
  // staged Smart Capture:
  //   • session-image URLs — bytes already uploaded into the import
  //     session; served same-origin by THIS app, always fetchable.
  //   • direct `http://<cryosmart>/api/log_image/…` URLs — refs whose
  //     bytes were never uploaded. Only the app server's proxy could
  //     fetch those, and when the app runs in the cloud the intranet
  //     CryoSmart is unreachable — each URL used to burn a 10s abort and
  //     fail (the user's "247 warnings" bundle). They are now attempted
  //     only when the server can reach CryoSmart; the rest are listed in
  //     images/NOT_UPLOADED_LINKS.txt for manual intranet download.
  const imageRequests = options.session ? collectImageRequests(summary) : [];
  const sessionImageItems = imageRequests.filter((i) => isSessionImageUrl(i.url));
  const directImageItems = imageRequests.filter((i) => isDirectCryosmartUrl(i.url));
  const otherImageItems = imageRequests.filter(
    (i) => !isSessionImageUrl(i.url) && !isDirectCryosmartUrl(i.url)
  );

  // Lazily probed ONCE per bundle build: can THIS app's server reach the
  // CryoSmart origin at all? (Direct-URL images and every map depend on it.)
  let upstreamReachable: boolean | null = null;
  const ensureReachability = async (): Promise<boolean> => {
    if (!options.session) return false;
    if (upstreamReachable === null) {
      onProgress?.({
        phase: "probe",
        current: 0,
        total: 1,
        message: `Checking CryoSmart reachability (${options.session.baseUrl})…`,
      });
      upstreamReachable = await probeCryosmartReachable(options.session);
    }
    return upstreamReachable;
  };

  // PPTX (optional). The builder embeds every byte in imageMap into the
  // slide XML. For very large lineages the resulting blob can be sizeable
  // (100+ jobs x multiple previews), but the user explicitly asked to see
  // the full result first — do NOT trim here. If a build OOMs or stalls,
  // the user will see it in the progress bar / buildCrashed banner and can
  // re-run with a smaller option set.
  if (options.includePptx) {
    onProgress?.({ phase: "pptx", current: 0, total: 0, message: "Fetching PPTX images…" });
    const imageMap = new Map<string, Uint8Array>();
    if (options.session) {
      try {
        // Session-store images always; direct intranet URLs only when the
        // app server can actually reach CryoSmart (same rule as the images
        // phase below — skipping them avoids a wall of 10s proxy aborts).
        const pptRequests = [...sessionImageItems, ...otherImageItems];
        if (directImageItems.length > 0 && (await ensureReachability())) {
          pptRequests.push(...directImageItems);
        }
        await collectPptImages(pptRequests, options.session, imageMap, (p) =>
          onProgress?.({
            phase: "pptx",
            current: p.current,
            total: p.total,
            message: p.message,
          })
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
      const msg = (err as Error).message || String(err);
      warnings.push(`PPTX build failed: ${msg}`);
      console.error("[bundle] PPTX build failed:", err);
    }
  }

  // Images (optional)
  if (options.includeImages) {
    onProgress?.({ phase: "images", current: 0, total: 1, message: "Collecting preview images…" });
    if (options.session) {
      let done = 0;
      const totalImages =
        sessionImageItems.length + otherImageItems.length + directImageItems.length;
      const notUploaded: Array<{ path: string; url: string }> = [];

      const fetchOne = async (item: { url: string; path: string }, timeoutMs?: number) => {
        try {
          const bytes = await cryoSmartBytes(
            options.session!,
            item.url,
            timeoutMs ? { timeoutMs } : undefined
          );
          // item.path is already the HTML-canonical `images/<uid>/<name>.png`
          // (from localImageFilename) — no extra prefix here.
          files.push({ path: item.path, data: bytes });
        } catch (err) {
          notUploaded.push(item);
          warnings.push(`Image ${item.path} failed: ${(err as Error).message}`);
        }
        done++;
        onProgress?.({
          phase: "images",
          current: done,
          total: totalImages,
          message: `Image ${done}/${totalImages}: ${item.path}`,
        });
      };

      // Session-store images (bytes uploaded by the capture script) are
      // served same-origin from the import session — fast and always
      // fetchable; use a small concurrency pool. (These used to be
      // forwarded through the CryoSmart proxy, which 404'd EVERY one of
      // them — the 221 lost images in the user's "247 warnings" bundle.)
      await pooledMap(sessionImageItems, 4, (item) => fetchOne(item));
      await pooledMap(otherImageItems, 4, (item) => fetchOne(item));

      // Direct intranet URLs — bytes never uploaded. Only the app server's
      // proxy could fetch them; when CryoSmart is unreachable from this
      // server (the common cloud-preview deployment) skip the whole batch
      // after ONE probe instead of N × 10s aborts, and record the links.
      if (directImageItems.length > 0) {
        if (await ensureReachability()) {
          for (const item of directImageItems) {
            await fetchOne(item, 30_000);
          }
        } else {
          notUploaded.push(...directImageItems);
          warnings.push(
            `${directImageItems.length} image(s) skipped: bytes were not uploaded by Smart Capture and CryoSmart (${options.session.baseUrl}) is unreachable from this app — direct links saved to images/NOT_UPLOADED_LINKS.txt`
          );
        }
      }

      if (notUploaded.length > 0) {
        files.push({
          path: "images/NOT_UPLOADED_LINKS.txt",
          data: utf8(notUploadedLinksText(options.session.baseUrl, notUploaded)),
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
      const mapBase = String(options.session.baseUrl || "").replace(/\/$/, "");
      const mapLink = (item: { url: string; path: string }): string => {
        const u = String(item.url || "");
        return /^https?:\/\//i.test(u) ? u : `${mapBase}/${u.replace(/^\/+/, "")}`;
      };
      const failedMaps: Array<{ url: string; path: string }> = [];

      if (mapItems.length > 0 && (await ensureReachability())) {
        let done = 0;
        let unreachableNow = false;
        for (const item of mapItems) {
          if (!unreachableNow) {
            try {
              // .mrc volumes are big — give the proxy a long window (the
              // 10s default aborted every map, even where reachable).
              const bytes = await cryoSmartBytes(options.session, item.url, {
                timeoutMs: 180_000,
              });
              files.push({ path: `maps/${item.path}`, data: bytes });
            } catch (err) {
              const msg = (err as Error).message || String(err);
              failedMaps.push(item);
              if (/CryoSmart 502/.test(msg) && /failed to reach/i.test(msg)) {
                // Connection-level failure — every remaining map will fail
                // the same way; stop grinding and just record the links.
                unreachableNow = true;
                warnings.push(
                  `CryoSmart became unreachable mid-download — remaining map(s) skipped (links in maps/DOWNLOAD_LINKS.txt)`
                );
              } else {
                warnings.push(`Map ${item.path} failed: ${msg}`);
              }
            }
          } else {
            failedMaps.push(item);
          }
          done++;
          onProgress?.({
            phase: "maps",
            current: done,
            total: mapItems.length,
            message: `Map ${done}/${mapItems.length}: ${item.path}`,
          });
        }
      } else if (mapItems.length > 0) {
        failedMaps.push(...mapItems);
        warnings.push(
          `Map download skipped: CryoSmart at ${mapBase} is unreachable from this app server (0/${mapItems.length} bundled) — direct links saved to maps/DOWNLOAD_LINKS.txt`
        );
      }

      if (failedMaps.length > 0) {
        files.push({
          path: "maps/DOWNLOAD_LINKS.txt",
          data: utf8(
            mapLinksText(failedMaps.map((m) => ({ path: m.path, link: mapLink(m) })))
          ),
        });
      }
    } else {
      warnings.push("Map download skipped: requires session from Smart Capture mode.");
    }
  }

  // Final results (optional) — only available in live mode
  if (options.includeFinalResults) {
    // Gate the whole phase on the SAME reachability probe as maps and
    // direct-URL images: these are 11 best-effort PROXIED fetches at the
    // 10s default timeout — on an unreachable intranet origin they used
    // to grind ~110s of aborts for nothing, exactly the stall the v3.13
    // probe was introduced to prevent.
    if (!options.session) {
      warnings.push("Final results scan skipped: requires session from Smart Capture mode.");
    } else if (!(await ensureReachability())) {
      warnings.push(
        `Final results scan skipped: CryoSmart (${options.session.baseUrl}) is unreachable from this app.`
      );
    } else {
      onProgress?.({ phase: "final", current: 0, total: 1, message: "Scanning final results…" });
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

/** Fetch the given image requests for PPTX embedding.
 *
 *  The caller hands in the already-partitioned request list (session-store
 *  images plus, when the app server can reach CryoSmart, direct-URL
 *  images) — see buildBundle. */
async function collectPptImages(
  requests: Array<{ url: string; path: string }>,
  session: CryoSmartSession,
  imageMap: Map<string, Uint8Array>,
  onProgress: (p: { current: number; total: number; message: string }) => void
) {
  if (requests.length === 0) {
    onProgress({ current: 0, total: 0, message: "No PPT images to fetch." });
    return;
  }
  let done = 0;
  for (const req of requests) {
    try {
      const bytes = await cryoSmartBytes(session, req.url);
      imageMap.set(req.url, bytes);
      imageMap.set(req.path, bytes);
    } catch {
      // skip — a single missing image must not abort the rest
    }
    done++;
    onProgress({
      current: done,
      total: requests.length,
      message: `PPT image ${done}/${requests.length}: ${req.path}`,
    });
  }
}

/** Gather all preview image URLs referenced by the HTML report.
 *
 *  IMPORTANT: every `path` MUST mirror the filename that reportImgTag()
 *  computes in bundle mode via localImageFilename(uid, name). The HTML
 *  falls back to the remote URL on error, but a matching local file is what
 *  makes the offline ZIP actually work — historically this collector used
 *  its own names (`class_<i>_preview.png`, no safePart) and never collected
 *  map / select-2D previews at all, so the offline report silently 404'd
 *  every class, map and select-2D preview image. */
export function collectImageRequests(summary: LineageSummary): Array<{ url: string; path: string }> {
  const out: Array<{ url: string; path: string }> = [];
  const seen = new Set<string>();
  const add = (uid: string, name: unknown, url: string | null | undefined) => {
    if (!url) return;
    const path = localImageFilename(uid || "J0", String(name ?? "image"));
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ url, path });
  };

  for (const node of summary.nodes || []) {
    const uid = node.uid || "J0";

    // Tile images + log images — reportImageBoxes() names these
    // `local_name || name || "image"`.
    for (const img of node.images || []) {
      const local = (img as { local_name?: string }).local_name || img.name || "image";
      add(uid, local, img.url);
    }

    // Representative micrographs (import_micrographs jobs) — same naming.
    for (const img of node.representative_micrograph_images || []) {
      const local = (img as { local_name?: string }).local_name || img.name || "micrograph";
      add(uid, local, img.url);
    }

    // Select-2D media block — fixed names from reportMediaBlock()
    // (templates_selected / templates_excluded / particles_selected).
    const s = node.select_2d;
    if (s) {
      add(uid, "templates_selected", s.selected_classes_image);
      add(uid, "templates_excluded", s.excluded_classes_image);
      add(uid, "particles_selected", s.selected_particles_image);
    }

    // Normal map previews (incl. sharp / half maps) — reportMapDownloads()
    // names these via mapPreviewAssetName().
    for (const m of normalMapAssets(node)) {
      add(uid, mapPreviewAssetName(m), m.preview_url);
    }

    // Per-class map previews — reportClassTable() / reportPictureClassJob()
    // name these `volume_group || class_<class_index>`.
    for (const cls of node.classes || []) {
      add(uid, cls.volume_group || `class_${cls.class_index}`, cls.mrc_preview_url);
    }
  }
  return out;
}

/** Gather all map/MRC download URLs. */
export function collectMapRequests(summary: LineageSummary): Array<{ url: string; path: string }> {
  const out: Array<{ url: string; path: string }> = [];
  const seen = new Set<string>();
  const project = summary.project_uid || "P";
  const startUid = summary.start_uid || "J0";
  const baseUrl = summary.base_url || DEFAULT_BASE_URL;

  // Start job normal maps
  for (const suffix of MAP_SUFFIXES) {
    out.push({
      url: `api/log_image/download_result_file/${project}/${startUid}.${suffix}`,
      path: `${startUid}/BJ.${project}.${startUid}.${suffix}.mrc`,
    });
    seen.add(`${startUid}/BJ.${project}.${startUid}.${suffix}.mrc`);
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
          const path = `${uid}/BJ.${project}.${uid}.${m.group || "volume"}.${m.result_name || "map"}.mrc`;
          if (seen.has(path)) continue;
          seen.add(path);
          out.push({ url: rel, path });
        }
      }
    }
    // Class-split map downloads (class_3D / abinit / hetero jobs) — these
    // are the files behind the report's per-class "map" links. Previously
    // they were mis-downloaded into images/ as .png; now they land in maps/
    // with their proper .mrc extension.
    for (const cls of node.classes || []) {
      for (const m of cls.maps || []) {
        if (!m.download_url) continue;
        let rel = m.download_url;
        if (rel.startsWith(baseUrl)) rel = rel.slice(baseUrl.length).replace(/^\/+/, "");
        const group = cls.volume_group || `class_${cls.class_index}`;
        const path = `${uid}/BJ.${project}.${uid}.${group}.${m.result_name || "map"}.mrc`;
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ url: rel, path });
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
