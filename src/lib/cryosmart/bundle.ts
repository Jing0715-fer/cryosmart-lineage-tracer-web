/**
 * Bundle assembly: pulls together all the report generators + ZIP writer +
 * bundled helper scripts, and produces a single .zip for download.
 *
 * v3.18: the archive is STREAMED entry-by-entry into a BundleSink (OPFS
 * file on disk in browsers; guarded memory buffer as fallback) instead of
 * accumulating every byte in a files[] array and assembling one giant
 * in-memory Blob — the old path peaked at ~3× the archive size in JS heap
 * and killed the tab on a 66-map build ("Previous build did not finish").
 *
 * Browser-only (uses fetch, Blob, URL).
 */

import type { LineageSummary } from "./types";
import type { ReportStyleConfig } from "./report-style";
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
import { StreamingZipWriter } from "./zip";
import { createBundleSink, type BundleSink } from "./zip-sink";
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
  /** Cancel switch (v3.17): aborts every in-flight download (Stop button
   *  in the Download card) and short-circuits the build between phases.
   *  buildBundle rejects with an AbortError as soon as possible. */
  signal?: AbortSignal;
  /** No-data stall window forwarded to map downloads (default 45s — see
   *  cryoSmartBytes). Exposed mainly so the harness can test the stall
   *  path quickly; power users can raise it on genuinely bursty links. */
  mapStallMs?: number;
  /** Pre-opened output sink (v3.18). When omitted (harness / server use)
   * buildBundle opens one itself — OPFS where available, otherwise the
   * byte-budget-guarded memory fallback (see zip-sink.ts). */
  sink?: BundleSink | null;
  /** Byte budget for the MEMORY fallback sink only (default 1 GiB). Once
   * the buffered archive would exceed it, large payloads (maps, final
   * .mrc results) degrade to DOWNLOAD_LINKS.txt entries instead of OOMing
   * the tab. Ignored for the OPFS sink (disk-backed). Test hook. */
  memZipBudgetBytes?: number;
  /** v3.19: the user's report style (template / font / image mode /
   *  title) — the ZIP's HTML report is generated with the same skin the
   *  user configured in the Report tab. Defaults to the paper template
   *  when omitted. */
  reportStyle?: ReportStyleConfig;
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
  /** Final archive. OPFS builds return a File BACKED BY the on-disk
   *  staging file (not a heap copy); memory builds return a Blob over
   * the buffered chunks. */
  blob: Blob;
  filename: string;
  fileCount: number;
  /** Total archive size in bytes (for honest "66 files · 8.2 GB" UI). */
  zipBytes: number;
  warnings: string[];
}

const HELPER_FILES = [
  "helpers/CryoSmart_align_maps_check_view.py",
  "helpers/CryoSmart_export_current_view_ppt.py",
  "helpers/CryoSmart_auto_align_export_ppt.py",
  "helpers/rebuild_picture_flow_pptx.mjs",
];

/* ── Download concurrency tuning (v3.16 speed-up) ────────────────────
 * The maps phase used to download every .mrc SEQUENTIALLY (one at a
 * time, 180s timeout each) — a 26-map lineage ground for minutes even
 * on a fast intranet, because per-request latency (server read + two
 * network legs through the proxy) serialized instead of overlapping.
 * All bulk-download phases now run through pooledMap(). Limits are
 * deliberately ≤4: the browser allows only ~6 concurrent HTTP/1.1
 * connections per origin, maps are tens–hundreds of MB each (peak
 * memory in-flight scales with concurrency), and undici on the server
 * side has no per-origin cap to worry about. */
/** Concurrent downloads for the maps/ phase (large .mrc volumes). */
const MAP_CONCURRENCY = 4;
/** Concurrent downloads for direct-URL images (bytes never uploaded). */
const DIRECT_IMAGE_CONCURRENCY = 3;
/** Concurrent downloads for PPTX-embedded preview images (small PNGs). */
const PPT_IMAGE_CONCURRENCY = 4;
/** Concurrent best-effort fetches for the Final_Result scan. */
const FINAL_RESULT_CONCURRENCY = 4;

/** Default byte budget for the MEMORY fallback sink (see BundleOptions.
 *  memZipBudgetBytes). 1 GiB keeps the tab comfortably under its ~4 GB
 *  ceiling even with the report HTML + PPTX + in-flight download buffers
 *  on top, while leaving room for ~1 GB of maps on the degraded path. */
export const DEFAULT_MEM_ZIP_BUDGET_BYTES = 1024 * 1024 * 1024;

/** True for the AbortError thrown by cryoSmartBytes when the caller's
 *  signal (Stop button) fires — used to bail out of download pools
 *  immediately instead of recording bogus per-item failures. */
function isCancelError(err: unknown): boolean {
  return (err as { name?: string })?.name === "AbortError";
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
 * Assemble the full download bundle as a ZIP, streamed entry-by-entry.
 *
 * The output sink is opened BEFORE any downloading starts, so completed
 * files are written + released immediately (peak heap = a few concurrent
 * download buffers instead of the whole archive).
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
  // options.sink lets the UI pre-open OPFS at click time; everything
  // else (harness / server / non-secure context) gets the guarded
  // memory fallback. createBundleSink NEVER throws.
  const bundleSink = options.sink ?? (await createBundleSink());
  const writer = new StreamingZipWriter(bundleSink.sink);
  try {
    return await assembleBundle(summary, options, bundleSink, writer, onProgress);
  } catch (err) {
    // Cancel, sink failure, phase crash — never leave a half-written
    // writable stream or a partial OPFS staging file behind.
    await writer.abort();
    throw err;
  }
}

async function assembleBundle(
  summary: LineageSummary,
  options: BundleOptions,
  bundleSink: BundleSink,
  writer: StreamingZipWriter,
  onProgress?: (p: BundleProgress) => void
): Promise<BundleResult> {
  const warnings: string[] = [];
  const project = summary.project_uid || "P";
  const startUid = summary.start_uid || "J0";
  const base = `CryoSmart_${project}_${startUid}_lineage`;
  /** Abort short-circuit at every phase boundary (Stop button). */
  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new DOMException("Build cancelled", "AbortError");
  };

  /* ── Streaming output plumbing (v3.18) ─────────────────────────────
   * Every phase below calls addFile() the moment its bytes are ready;
   * the entry is CRC'd + written to the sink and the bytes become
   * collectable. fitsBudget() gates ONLY the big binary payloads
   * (maps / final .mrc results) on the MEMORY fallback sink — reports,
   * HTML and links files always go through (they are the point of the
   * bundle and are bounded by the report builders themselves). */
  const memBudget =
    options.memZipBudgetBytes ?? DEFAULT_MEM_ZIP_BUDGET_BYTES;
  const fitsBudget = (bytes: number): boolean =>
    bundleSink.kind !== "memory" || bundleSink.writtenBytes() + bytes <= memBudget;
  let memBudgetWarned = false;
  const warnMemBudgetOnce = (what: string) => {
    if (memBudgetWarned) return;
    memBudgetWarned = true;
    warnings.push(
      `In-memory ZIP budget (${(memBudget / 1073741824).toFixed(1)} GB) reached while adding ${what} — remaining large files degrade to manual links. Serve this app over HTTPS (or localhost) to stream the ZIP to browser disk storage and bundle everything.`
    );
  };
  const addFile = async (path: string, data: Uint8Array | string): Promise<void> => {
    try {
      await writer.add(path, data);
    } catch (err) {
      if (isCancelError(err)) throw err;
      // Sink-level failure (disk full, stream torn down): fatal for the
      // whole build — wrapping keeps it recognizable upstream.
      throw new Error(`ZIP sink write failed: ${(err as Error).message || String(err)}`);
    }
  };

  onProgress?.({ phase: "report", current: 0, total: 6, message: "Generating JSON…" });
  await addFile(`${base}.json`, JSON.stringify(summary, null, 2));

  onProgress?.({ phase: "report", current: 1, total: 6, message: "Generating HTML report…" });
  // Build HTML report with embedded images when session is available.
  // bundleMode=true tells reportImgTag to use a local `images/<uid>/<name>.png`
  // path (with an onerror fallback to the remote URL) for any image that
  // didn't get embedded as a base64 data URL — the downloadable ZIP ships
  // the `images/` folder alongside the HTML so the report works offline.
  // v3.17: the ZIP report uses the user's chosen style (template / font /
  // title / image mode). imageMode "none" strips <img> tags from the report
  // (the images/ folder itself is still controlled by includeImages); other
  // modes keep the bundleMode local-file references + remote fallback.
  const styleOpts: ReportHtmlOptions = {
    template: options.reportStyle?.template,
    fontScale: options.reportStyle?.fontScale,
    imageMode: options.reportStyle?.imageMode,
    widthMode: options.reportStyle?.widthMode,
    titleOverride: options.reportStyle?.titleOverride || undefined,
    subtitle: options.reportStyle?.subtitle || undefined,
  };
  let htmlOpts: ReportHtmlOptions = { ...styleOpts, bundleMode: options.includeImages };
  if (options.includeImages && options.session) {
    onProgress?.({ phase: "images", current: 0, total: 0, message: "Prefetching images for report..." });
    const embeddedImages = await prefetchImagesForReport(
      options.session,
      summary,
      (p) =>
        onProgress?.({
          phase: "images",
          current: p.current ?? 0,
          total: p.total ?? 0,
          message: p.message ?? "Embedding images…",
        }),
      // v3.24: thread the build's AbortSignal (Stop button) into the
      // prefetch pool — previously a cancelled build left up to N/8 × 10s
      // of zombie image fetches running into an already-idle card.
      { signal: options.signal ?? undefined }
    );
    htmlOpts = { ...styleOpts, embeddedImages, session: options.session, bundleMode: true };
  }
  await addFile(`${base}_report.html`, buildLineageHtmlV2(summary, htmlOpts));

  onProgress?.({ phase: "report", current: 2, total: 6, message: "Generating SVG…" });
  try {
    const svg = buildPictureFlowSvg(summary);
    await addFile(`${base}_picture_flow.svg`, svg);
  } catch (err) {
    warnings.push(`SVG generation failed: ${(err as Error).message}`);
  }

  onProgress?.({ phase: "report", current: 3, total: 6, message: "Generating Mermaid…" });
  if (summary.focused_mermaid) {
    await addFile(`${base}.mmd`, summary.focused_mermaid);
  }

  onProgress?.({ phase: "report", current: 4, total: 6, message: "Generating preview text…" });
  try {
    const preview = makePreview(summary);
    await addFile(`${base}_preview.txt`, preview);
  } catch (err) {
    warnings.push(`Preview text failed: ${(err as Error).message}`);
  }

  onProgress?.({ phase: "report", current: 5, total: 6, message: "Bundling helper scripts…" });
  for (const helperPath of HELPER_FILES) {
    try {
      const resp = await fetch(`/${helperPath}`);
      if (resp.ok) {
        const text = await resp.text();
        await addFile(helperPath.replace(/^helpers\//, ""), text);
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
    throwIfCancelled();
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
        , options.signal);
      } catch (err) {
        warnings.push(`PPTX image fetch failed: ${(err as Error).message}`);
      }
    }
    onProgress?.({ phase: "pptx", current: 1, total: 2, message: "Building PPTX…" });
    try {
      const blob = buildPictureFlowPptx(summary, imageMap);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await addFile(`${base}_picture_flow.pptx`, bytes);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      warnings.push(`PPTX build failed: ${msg}`);
      console.error("[bundle] PPTX build failed:", err);
    }
  }

  // Images (optional)
  if (options.includeImages) {
    throwIfCancelled();
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
            {
              ...(timeoutMs ? { timeoutMs } : {}),
              signal: options.signal,
            }
          );
          // item.path is already the HTML-canonical `images/<uid>/<name>.png`
          // (from localImageFilename) — no extra prefix here.
          if (!fitsBudget(bytes.length)) {
            notUploaded.push(item);
            warnMemBudgetOnce("preview images");
          } else {
            await addFile(item.path, bytes);
          }
        } catch (err) {
          if (isCancelError(err)) throw err; // Stop button — bail, don't record
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
          // Parallel (was: serial for-loop → per-image 30s window stacked
          // end-to-end). Connection-level failures still surface per item;
          // the reachability probe above already handled the fully-dead case.
          await pooledMap(directImageItems, DIRECT_IMAGE_CONCURRENCY, (item) =>
            fetchOne(item, 30_000)
          );
        } else {
          notUploaded.push(...directImageItems);
          warnings.push(
            `${directImageItems.length} image(s) skipped: bytes were not uploaded by Smart Capture and CryoSmart (${options.session.baseUrl}) is unreachable from this app — direct links saved to images/NOT_UPLOADED_LINKS.txt`
          );
        }
      }

      if (notUploaded.length > 0) {
        await addFile(
          "images/NOT_UPLOADED_LINKS.txt",
          notUploadedLinksText(options.session.baseUrl, notUploaded)
        );
      }
    } else {
      warnings.push("Image download skipped: requires session from Smart Capture mode.");
    }
  }

  // Maps (optional)
  if (options.includeMaps) {
    throwIfCancelled();
    const mapItems = collectMapRequests(summary);
    onProgress?.({
      phase: "maps",
      current: 0,
      total: Math.max(1, mapItems.length),
      message: mapItems.length > 0 ? `Collecting ${mapItems.length} maps…` : "Collecting maps…",
    });
    if (options.session) {
      const session = options.session;
      const mapBase = String(options.session.baseUrl || "").replace(/\/$/, "");
      const mapLink = (item: { url: string; path: string }): string => {
        const u = String(item.url || "");
        return /^https?:\/\//i.test(u) ? u : `${mapBase}/${u.replace(/^\/+/, "")}`;
      };
      const failedMaps: Array<{ url: string; path: string }> = [];

      if (mapItems.length > 0 && (await ensureReachability())) {
        // PARALLEL map download (v3.16): was a serial for-loop — every map
        // waited for the previous one, so N maps cost N × (server read +
        // proxy transfer). pooledMap keeps MAP_CONCURRENCY downloads in
        // flight; the shared `stopQueue` flag preserves the old
        // "connection died → stop grinding, record links" semantics: the
        // first connection-level failure flips the flag and every item a
        // worker pulls after that is recorded as failed WITHOUT a request.
        // In-flight requests at the moment of the failure still complete
        // (or fail) on their own and keep their bytes if they succeed.
        //
        // v3.17 adds two more escape hatches for the "stuck at 0%" hang:
        //  • STALL-SKIP — a map whose body goes silent (no chunk for
        //    stallMs, default 45s) is aborted by cryoSmartBytes; after 3
        //    such stalls the queue is skipped like an unreachable — a
        //    wedged-but-accepting CryoSmart used to burn 180s × N/4 before
        //    v3.17 (or forever when a leg never closed the socket).
        //  • LIVENESS — progress used to tick only when a map COMPLETED,
        //    so the first minutes of a healthy 4-way download showed an
        //    unchanged "0% Collecting maps…". Byte chunks now emit a
        //    throttled "N in flight · M MB received" line (400ms) so slow
        //    ≠ stuck is visible at a glance.
        let done = 0;
        let stopQueue = false;
        let stallFails = 0;
        let budgetStop = false;
        let activeDownloads = 0;
        let bytesReceived = 0;
        let lastEmit = 0;
        const emitLiveness = () => {
          const now = Date.now();
          if (now - lastEmit < 400) return;
          lastEmit = now;
          onProgress?.({
            phase: "maps",
            current: done,
            total: mapItems.length,
            message: `Map ${done}/${mapItems.length} · ${activeDownloads} in flight · ${(bytesReceived / 1048576).toFixed(1)} MB received`,
          });
        };
        await pooledMap(mapItems, MAP_CONCURRENCY, async (item) => {
          if (stopQueue) {
            failedMaps.push(item);
          } else {
            activeDownloads++;
            const itemBytes = { v: 0 };
            try {
              // .mrc volumes are big — give the proxy a long window (the
              // 10s default aborted every map, even where reachable).
              const bytes = await cryoSmartBytes(session, item.url, {
                timeoutMs: 180_000,
                stallMs: options.mapStallMs,
                signal: options.signal,
                onBytes: (t) => {
                  bytesReceived += t - itemBytes.v;
                  itemBytes.v = t;
                  emitLiveness();
                },
              });
              if (!fitsBudget(bytes.length)) {
                // Memory-sink budget guard (OPFS path never lands here):
                // the bytes are already downloaded, but buffering them
                // would push the JS heap past the tab-safe budget — the
                // same OOM that killed 66-map builds outright before
                // v3.18. Record the link, stop pulling more maps.
                failedMaps.push(item);
                if (!budgetStop) {
                  budgetStop = true;
                  stopQueue = true;
                  warnMemBudgetOnce("maps");
                }
              } else {
                await addFile(`maps/${item.path}`, bytes);
              }
            } catch (err) {
              if (options.signal?.aborted || isCancelError(err)) throw err;
              const msg = (err as Error).message || String(err);
              failedMaps.push(item);
              if (/CryoSmart 502/.test(msg) && /failed to reach/i.test(msg)) {
                // Connection-level failure — every remaining map will fail
                // the same way. Under concurrency several workers can hit
                // it simultaneously; only the one that flips the flag
                // emits the warning (await-free sync section → no race).
                if (!stopQueue) {
                  stopQueue = true;
                  warnings.push(
                    `CryoSmart became unreachable mid-download — remaining map(s) skipped (links in maps/DOWNLOAD_LINKS.txt)`
                  );
                }
              } else if (/stalled — no data/i.test(msg)) {
                // Server accepted the request (maybe even sent headers)
                // then went SILENT — not a routing failure like the 502
                // above, but just as fatal for this map. One stall can be
                // a hiccup; three means the upstream is wedged → skip the
                // rest of the queue instead of burning stallMs × N/4.
                stallFails++;
                warnings.push(`Map ${item.path} failed: ${msg}`);
                if (stallFails >= 3 && !stopQueue) {
                  stopQueue = true;
                  warnings.push(
                    `Map downloads stalled ${stallFails}× with no data from CryoSmart — remaining map(s) skipped (links in maps/DOWNLOAD_LINKS.txt); CryoSmart may be overloaded or its disk stalled`
                  );
                }
              } else {
                warnings.push(`Map ${item.path} failed: ${msg}`);
              }
            } finally {
              activeDownloads--;
            }
          }
          done++;
          onProgress?.({
            phase: "maps",
            current: done,
            total: mapItems.length,
            message: `Map ${done}/${mapItems.length}: ${item.path}`,
          });
        });
      } else if (mapItems.length > 0) {
        failedMaps.push(...mapItems);
        warnings.push(
          `Map download skipped: CryoSmart at ${mapBase} is unreachable from this app server (0/${mapItems.length} bundled) — direct links saved to maps/DOWNLOAD_LINKS.txt`
        );
      }

      if (failedMaps.length > 0) {
        await addFile(
          "maps/DOWNLOAD_LINKS.txt",
          mapLinksText(failedMaps.map((m) => ({ path: m.path, link: mapLink(m) })))
        );
      }
    } else {
      warnings.push("Map download skipped: requires session from Smart Capture mode.");
    }
  }

  // Final results (optional) — only available in live mode
  if (options.includeFinalResults) {
    throwIfCancelled();
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
      // Try to fetch final maps + plots (best-effort; will 404 if the job
      // isn't a refine). Parallel since v3.16 (was two serial loops — the
      // 11 requests stacked their round-trips needlessly; most of them are
      // expected 404s which now resolve concurrently).
      const finalSession = options.session;
      const finalTargets: Array<{ url: string; path: string }> = [];
      for (const suffix of suffixes) {
        finalTargets.push({
          url: `api/log_image/download_result_file/${projectId}/${startUid}.${suffix}`,
          path: `Final_Result/Map/BJ.${projectId}.${startUid}.${suffix}.mrc`,
        });
      }
      // Plots (best-effort; we don't know the exact iteration, try 1)
      for (const g of graphPaths) {
        finalTargets.push({
          url: `api/log_image/${g.kind}_${g.iteration}_${g.suffix}.${g.ext}`,
          path: `Final_Result/${g.kind}/${g.suffix}.${g.ext}`,
        });
      }
      // v3.24: sort targets by archive path UP FRONT so the ordered
      // consumer below writes a deterministic ZIP (the v3.16 invariant)
      // while still streaming each payload to the sink the moment its
      // turn comes. The old code buffered ALL six .mrc maps + plots in a
      // finalFiles[] array until the pool drained — peak heap = their sum,
      // the same tab-OOM class ("Previous build did not finish") that
      // v3.18 eliminated for the maps phase.
      finalTargets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      type FinalSlot = { bytes?: Uint8Array; failed?: boolean };
      const slotReady: Array<(r: FinalSlot) => void> = [];
      const slots: Array<Promise<FinalSlot> | null> = finalTargets.map(
        () => new Promise<FinalSlot>((res) => slotReady.push(res))
      );
      const producer = pooledMap(finalTargets, FINAL_RESULT_CONCURRENCY, async (t, i) => {
        try {
          const bytes = await cryoSmartBytes(finalSession, t.url, {
            signal: options.signal,
          });
          slotReady[i]({ bytes });
        } catch (err) {
          if (isCancelError(err)) throw err; // Stop button — bail, not a 404
          slotReady[i]({ failed: true }); // expected to fail for non-refine jobs
        }
      });
      let finalFetched = 0;
      let finalBudgetSkipped = 0;
      // Ordered consumer: writes slot 0, 1, 2… as they land, releasing each
      // big buffer right after its ZIP entry hits the sink. Downloads stay
      // parallel (4×); only the WRITES are ordered. On a cancel/error the
      // producer rejects and Promise.all unwinds without the consumer.
      const consumer = (async () => {
        for (let i = 0; i < finalTargets.length; i++) {
          const r = await slots[i];
          slots[i] = null; // drop the promise reference for GC
          if (!r || r.failed || !r.bytes) continue;
          finalFetched++;
          if (!fitsBudget(r.bytes.length)) {
            finalBudgetSkipped++;
            continue;
          }
          await addFile(finalTargets[i].path, r.bytes);
        }
      })();
      await Promise.all([producer, consumer]);
      if (finalBudgetSkipped > 0) {
        warnMemBudgetOnce("final results");
        warnings.push(`${finalBudgetSkipped} final-result file(s) skipped: in-memory ZIP budget exceeded (no manual link available for these)`);
      }
      const summaryText = `Final result scan for ${projectId}/${startUid}.\n` +
        `Fetched ${finalFetched} files.\n` +
        `Generated at ${new Date().toISOString()}.\n`;
      await addFile(`Final_Result/final_result_summary.txt`, summaryText);
    }
  }

  // download_warnings.txt if any
  if (warnings.length > 0) {
    await addFile(`download_warnings.txt`, warnings.join("\n") + "\n");
  }

  throwIfCancelled();

  // Central directory + EOCD. By now every payload byte is already on the
  // sink (disk for OPFS) — this only writes the small per-entry metadata.
  onProgress?.({
    phase: "zip",
    current: 0,
    total: 1,
    message: `Finalizing ZIP · ${writer.entryCount} files · ${(writer.bytesWritten / 1048576).toFixed(1)} MB…`,
  });
  await writer.finish();
  const blob = await bundleSink.result();

  onProgress?.({ phase: "done", current: 1, total: 1, message: "Done." });

  return {
    blob,
    filename: `${base}.zip`,
    fileCount: writer.entryCount,
    zipBytes: writer.bytesWritten,
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
  onProgress: (p: { current: number; total: number; message: string }) => void,
  signal?: AbortSignal
) {
  if (requests.length === 0) {
    onProgress({ current: 0, total: 0, message: "No PPT images to fetch." });
    return;
  }
  let done = 0;
  // Parallel since v3.16 (was a serial for-loop — preview PNGs are small,
  // the win here is overlapping per-request round-trips, which dominated
  // for 40+ images).
  await pooledMap(requests, PPT_IMAGE_CONCURRENCY, async (req) => {
    try {
      const bytes = await cryoSmartBytes(session, req.url, { signal });
      imageMap.set(req.url, bytes);
      imageMap.set(req.path, bytes);
    } catch (err) {
      if (isCancelError(err)) throw err; // Stop button — bail, don't skip
      // skip — a single missing image must not abort the rest
    }
    done++;
    onProgress({
      current: done,
      total: requests.length,
      message: `PPT image ${done}/${requests.length}: ${req.path}`,
    });
  });
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
  // v3.18: multi-GB archives can take a while for the browser to latch
  // onto the blob URL — 5s was too aggressive, 30s is still bounded.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
