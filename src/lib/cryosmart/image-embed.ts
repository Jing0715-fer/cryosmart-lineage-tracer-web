/**
 * Browser-side client for fetching CryoSmart images and converting to base64.
 * Used by the bundle builder + preview iframe to pre-fetch images for
 * embedding in HTML reports (so the report is fully self-contained and does
 * not depend on remote CryoSmart being reachable / referrer / CORS).
 */

import { cryoSmartFetch, type CryoSmartSession } from "./proxy-client";

/**
 * Convert a CryoSmart image URL (full URL or path) to a base64 data URL via
 * the /api/cryosmart/[...path] proxy. Returns null on any failure.
 *
 * Every fetch is bounded by a 10s abort timeout — an unreachable upstream
 * (e.g. the app server trying to reach an intranet CryoSmart it can't route
 * to) otherwise HANGS the connection pool slot for minutes, which is what
 * made large report embeds feel frozen (user: "加载需要比较长时间").
 *
 * `cryosmartPath` may be:
 *   - a full URL like "http://192.168.4.3:8080/api/log_image/<fileid>"
 *   - a relative path like "/api/log_image/<fileid>" or "api/log_image/..."
 *   - a path with a query string like "api/log_image/<fileid>?token=..."
 *
 * We normalize it to a path-only (+query) relative to the CryoSmart origin
 * and hand it to `cryoSmartFetch`, which builds the correct proxy URL and
 * forwards `base`/`auth`/`cookie` as query params.
 */
const FETCH_TIMEOUT_MS = 10_000;

export async function imageToBase64(
  session: CryoSmartSession,
  cryosmartPath: string
): Promise<string | null> {
  try {
    if (!cryosmartPath) return null;

    let pathOnly = cryosmartPath.trim();
    let existingQuery = "";

    // Data URLs are already self-contained — nothing to fetch.
    if (/^data:/i.test(pathOnly)) return pathOnly;

    // Uploaded session images (`/api/cryosmart/import/session/<token>/image/...`)
    // are served by THIS app — fetch them directly, NOT through the CryoSmart
    // proxy (the generic `/api/...` branch below would forward them to the
    // CryoSmart server, which doesn't have that path → 404).
    if (/^\/api\/cryosmart\/import\/session\/[^/]+\/image\//i.test(pathOnly)) {
      const resp = await fetch(pathOnly, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength === 0) return null;
      const mime = resp.headers.get("content-type") || "image/png";
      return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    }

    // Same-origin assets that are NOT CryoSmart API paths (e.g. the bundled
    // /demo/*.png sample images) must not go through the CryoSmart proxy —
    // fetch them directly from this origin instead.
    if (/^\/(?!api\/)/i.test(pathOnly)) {
      const resp = await fetch(pathOnly, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength === 0) return null;
      const mime = resp.headers.get("content-type") || "image/png";
      return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    }

    // If it's a full URL, strip the origin so we're left with just the path
    // (+query). This is the critical fix: previously a full URL like
    // "http://192.168.4.3:8080/api/log_image/abc" was passed verbatim into
    // `/api/cryosmart/${fullUrl}`, which the [...path] catch-all then split
    // into ["http:", "", "192.168.4.3", ...] — producing a mangled, broken
    // upstream URL and a 404/error response for EVERY image, so embedding
    // always returned an empty map and images never rendered.
    if (/^https?:\/\//i.test(pathOnly)) {
      try {
        const u = new URL(pathOnly);
        pathOnly = u.pathname + (u.search ? u.search : "");
      } catch {
        // Not a parseable URL — bail out rather than risk a broken request.
        return null;
      }
    }

    // Strip leading slashes + split path / query (cryoSmartFetch expects a
    // relative path and merges its own query params with any existing ones).
    const clean = pathOnly.replace(/^\/+/, "");
    const [p, q] = clean.split("?");
    pathOnly = p;
    existingQuery = q || "";

    // Skip empty paths.
    if (!pathOnly) return null;

    // Re-attach the query so cryoSmartFetch can merge it with base/auth/cookie.
    const relativePath = existingQuery ? `${pathOnly}?${existingQuery}` : pathOnly;

    const resp = await cryoSmartFetch(session, relativePath);
    if (!resp.ok) return null;

    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;
    const mime = resp.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

/** Convert an ArrayBuffer to base64 without blowing the call stack on big
 *  buffers (btoa on a single huge binary string throws RangeError above ~8MB,
 *  so we chunk it at 32KB per String.fromCharCode call). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32KB per chunk — safe across all engines.
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Pre-fetch the images the report will actually DISPLAY and return a map of
 * { remoteUrl → base64DataUrl } for embedding in the HTML report.
 *
 * The scope mirrors report-html.ts's rendering caps exactly — previously the
 * prefetch collected EVERY referenced image (a real capture can carry 900+
 * log-image refs while the report shows at most 12 per job), so the embed
 * step fetched ~5× more URLs than the report ever renders, at concurrency 4,
 * each potentially hanging on an unreachable proxy. That was the "report
 * images take forever" experience.
 *
 * Scope per node (matching reportMediaBlock / reportClassTable /
 * reportMapDownloads / reportImageBoxes):
 *   - node.images: log-image refs (log_image + image_log kinds) → first 12;
 *     other kinds are not rendered by the report (they feed the graph
 *     card / modal instead) → skipped.
 *   - representative_micrograph_images → first 3.
 *   - select_2d → the 3 tile images.
 *   - classes → every mrc_preview (the classes table renders all rows).
 *   - maps → every preview (the map table renders all rows).
 * Both the `.url` AND `.src` variants are collected: reportImgTag() looks
 * images up by their SRC string, so every src that can differ from its url
 * must be a key in the returned map. Fetches are deduped, so adding both
 * variants costs nothing extra when they're equal.
 */
const REPORT_LOG_IMAGE_LIMIT = 12;

export async function prefetchImagesForReport(
  session: CryoSmartSession,
  summary: import("./types").LineageSummary,
  onProgress?: (msg: string) => void
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const urls = new Set<string>();
  const add = (url?: string | null, ...also: Array<string | null | undefined>) => {
    if (url) urls.add(url);
    for (const u of also) if (u && u !== url) urls.add(u);
  };

  for (const node of summary.nodes || []) {
    // From node.images — log images only (log_image + image_log kinds,
    // mirroring reportMediaBlock), capped at the report's per-job display
    // limit (non-log node.images are not rendered by the report).
    const logImages = (node.images || []).filter(
      (img) => img.kind === "log_image" || img.kind === "image_log"
    );
    for (const img of logImages.slice(0, REPORT_LOG_IMAGE_LIMIT)) {
      add(img.url, img.src);
    }

    // From representative_micrograph_images (report shows 3).
    for (const img of (node.representative_micrograph_images || []).slice(0, 3)) {
      add(img.url, img.src);
    }

    // From select_2d (report shows the 3 tile images).
    if (node.select_2d) {
      const s = node.select_2d;
      add(s.selected_classes_image, s.selected_classes_src);
      add(s.selected_particles_image, s.selected_particles_src);
      add(s.excluded_classes_image, s.excluded_classes_src);
    }

    // From class splits (mrc preview — the classes table renders every row).
    for (const cls of node.classes || []) {
      add(cls.mrc_preview_url, cls.mrc_preview_src);
    }

    // From maps (preview URLs — the map table renders every row).
    for (const m of node.maps || []) {
      add(m.preview_url, m.preview_src);
    }
  }

  // Also collect from the start job (picture-flow section).
  const sj = summary.start_job;
  if (sj) {
    const logImages = (sj.images || []).filter(
      (img) => img.kind === "log_image" || img.kind === "image_log"
    );
    for (const img of logImages.slice(0, REPORT_LOG_IMAGE_LIMIT)) {
      add(img.url, img.src);
    }
    if (sj.select_2d) {
      const s = sj.select_2d;
      add(s.selected_classes_image, s.selected_classes_src);
      add(s.selected_particles_image, s.selected_particles_src);
      add(s.excluded_classes_image, s.excluded_classes_src);
    }
  }

  const urlList = Array.from(urls).filter(Boolean);
  if (urlList.length === 0) {
    onProgress?.("No images referenced in this lineage.");
    return out;
  }

  // Fetch with limited concurrency (8 at a time). Session-image URLs are
  // same-origin in-memory serves — fast; remote/proxied URLs are bounded by
  // the 10s abort timeout inside imageToBase64 so nothing hangs the pool.
  const CONCURRENCY = 8;
  let done = 0;
  let embedded = 0;
  let index = 0;

  async function worker() {
    while (index < urlList.length) {
      const myIndex = index++;
      const url = urlList[myIndex];
      onProgress?.(`Embedding image ${done + 1}/${urlList.length}…`);
      const dataUrl = await imageToBase64(session, url);
      if (dataUrl) {
        out[url] = dataUrl;
        embedded++;
      }
      done++;
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, urlList.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  onProgress?.(
    embedded > 0
      ? `${embedded}/${urlList.length} images embedded`
      : "Image embedding failed — falling back to remote URLs"
  );
  return out;
}
