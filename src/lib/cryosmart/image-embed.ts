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
 * `cryosmartPath` may be:
 *   - a full URL like "http://192.168.4.3:8080/api/log_image/<fileid>"
 *   - a relative path like "/api/log_image/<fileid>" or "api/log_image/..."
 *   - a path with a query string like "api/log_image/<fileid>?token=..."
 *
 * We normalize it to a path-only (+query) relative to the CryoSmart origin
 * and hand it to `cryoSmartFetch`, which builds the correct proxy URL and
 * forwards `base`/`auth`/`cookie` as query params.
 */
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
      const resp = await fetch(pathOnly, { credentials: "same-origin" });
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
      const resp = await fetch(pathOnly, { credentials: "same-origin" });
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
 * Pre-fetch all images referenced in the summary and return a map of
 * { remoteUrl → base64DataUrl } for embedding in the HTML report.
 *
 * Images are fetched in small concurrency batches to avoid saturating the
 * browser's connection pool (the proxy + CryoSmart have limited capacity).
 */
export async function prefetchImagesForReport(
  session: CryoSmartSession,
  summary: import("./types").LineageSummary,
  onProgress?: (msg: string) => void
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const urls = new Set<string>();

  // Collect all image URLs from the summary. Both the `.url` AND `.src`
  // variants are collected: reportImgTag() looks images up by their SRC
  // string, so every src that can differ from its url must be a key in the
  // returned map (overview_assets capture data can carry distinct url/src).
  // Fetches are deduped below, so adding both variants costs nothing extra
  // when they're equal (the common lineage.ts case).
  for (const node of summary.nodes || []) {
    // From node.images
    for (const img of node.images || []) {
      if (img.url) urls.add(img.url);
      if (img.src && img.src !== img.url) urls.add(img.src);
    }

    // From representative_micrograph_images
    for (const img of node.representative_micrograph_images || []) {
      if (img.url) urls.add(img.url);
      if (img.src && img.src !== img.url) urls.add(img.src);
    }

    // From select_2d
    if (node.select_2d) {
      const s = node.select_2d;
      if (s.selected_classes_image) urls.add(s.selected_classes_image);
      if (s.selected_classes_src) urls.add(s.selected_classes_src);
      if (s.selected_particles_image) urls.add(s.selected_particles_image);
      if (s.selected_particles_src) urls.add(s.selected_particles_src);
      if (s.excluded_classes_image) urls.add(s.excluded_classes_image);
      if (s.excluded_classes_src) urls.add(s.excluded_classes_src);
    }

    // From class splits (mrc preview)
    for (const cls of node.classes || []) {
      if (cls.mrc_preview_url) urls.add(cls.mrc_preview_url);
      if (cls.mrc_preview_src) urls.add(cls.mrc_preview_src);
    }

    // From maps (preview URLs)
    for (const m of node.maps || []) {
      if (m.preview_url) urls.add(m.preview_url);
      if (m.preview_src) urls.add(m.preview_src);
    }
  }

  // Also collect from the start job
  const sj = summary.start_job;
  if (sj) {
    for (const img of sj.images || []) {
      if (img.url) urls.add(img.url);
      if (img.src && img.src !== img.url) urls.add(img.src);
    }
    if (sj.select_2d) {
      const s = sj.select_2d;
      if (s.selected_classes_image) urls.add(s.selected_classes_image);
      if (s.selected_classes_src) urls.add(s.selected_classes_src);
      if (s.selected_particles_image) urls.add(s.selected_particles_image);
      if (s.selected_particles_src) urls.add(s.selected_particles_src);
      if (s.excluded_classes_image) urls.add(s.excluded_classes_image);
      if (s.excluded_classes_src) urls.add(s.excluded_classes_src);
    }
  }

  const urlList = Array.from(urls).filter(Boolean);
  if (urlList.length === 0) {
    onProgress?.("No images referenced in this lineage.");
    return out;
  }

  // Fetch with limited concurrency (4 at a time) to be gentle on the proxy
  // and the CryoSmart backend. Preserves order for stable progress messages.
  const CONCURRENCY = 4;
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
