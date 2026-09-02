/**
 * Browser-side client for fetching CryoSmart images and converting to base64.
 * Used by the bundle builder + preview iframe to pre-fetch images for
 * embedding in HTML reports (so the report is fully self-contained and does
 * not depend on remote CryoSmart being reachable / referrer / CORS).
 */

import { cryoSmartFetch, type CryoSmartSession } from "./proxy-client";
import { outputPreviewFallbackImages } from "./report-html";

/**
 * Convert a CryoSmart image URL (full URL or path) to a base64 data URL via
 * the /api/cryosmart/[...path] proxy. Returns null on any failure.
 *
 * `session` may be null (v3.20): app-served URLs (staged-session images,
 * capture-history images, /demo assets) are fetched SAME-ORIGIN without any
 * CryoSmart credentials, so a restored capture history entry can still
 * embed its images even when no live session exists. Only the proxied
 * CryoSmart branch requires a session with a baseUrl — it returns null
 * (no fetch) when the session is absent.
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

/* v3.38: EMBED RESUME CACHE. The preview card's prefetch effect re-runs
 * every time the live summary refreshes (which during an active capture
 * is every ~1.5s as log-image counters move) — each re-run CANCELLED the
 * in-flight prefetch and restarted it from scratch, so the embed progress
 * read "Embedding image 1/N…" forever and never crossed a handful of
 * images (the user's "嵌入 report 过程中卡住，进度一直是 0"). Only
 * SUCCESSES are cached: a URL that 404s while its bytes are still
 * uploading must be retried by a later pass (session-image bytes are
 * immutable once stored, so a cached success can never go stale). The
 * cap keeps a pathological restore from pinning unbounded memory
 * (data URLs are big; 4000 × ~50 KB ≈ 200 MB worst case, never reached
 * in practice — real reports reference ≤ 2–3k distinct URLs). */
const EMBED_CACHE = new Map<string, string>();
const EMBED_CACHE_CAP = 4000;

function cacheEmbed(url: string, dataUrl: string): void {
  if (EMBED_CACHE.has(url)) return;
  if (EMBED_CACHE.size >= EMBED_CACHE_CAP) {
    // Map preserves insertion order — evict the oldest entries (LRU-ish;
    // re-insertions below refresh recency).
    const it = EMBED_CACHE.keys();
    for (let i = 0; i < 64 && EMBED_CACHE.size >= EMBED_CACHE_CAP; i++) {
      const k = it.next().value as string | undefined;
      if (k === undefined) break;
      EMBED_CACHE.delete(k);
    }
  }
  EMBED_CACHE.set(url, dataUrl);
}

/* v3.38: UNREACHABLE-PROXY BREAKER. A restored capture (or a capture whose
 * byte uploads failed — refs only) carries DIRECT
 * `http://<intranet>/api/log_image/...` URLs; embedding them routes through
 * THIS app server's CryoSmart proxy, which often cannot reach the user's
 * intranet at all (the preview gateway especially). Every such fetch then
 * burns its full 10s abort timeout, so a 200-image embed grinds for
 * MINUTES at "Embedding image 1/N…" — the "嵌入 report 过程中卡住，进度
 * 一直是 0" experience. PROXY_FAIL_N consecutive proxied failures mark the
 * origin unreachable for PROXY_DEAD_TTL_MS (module-level, so
 * summary-refresh restarts skip the dead origin instantly instead of
 * re-grinding); skipped images fall back to remote links in the report —
 * the capture script's byte uploads remain the self-contained channel. */
const PROXY_DEAD = new Map<string, number>(); // proxy-origin → markedAt ms
const PROXY_DEAD_TTL_MS = 5 * 60_000;
const PROXY_FAIL_N = 6;

const SESSION_IMAGE_RE = /\/api\/cryosmart\/(?:import\/session|history)\/[^/?#]+\/image\//;

/** The proxy-origin a URL would route through, or null when the fetch is
 *  same-origin / data (those never grind on an unreachable proxy). */
function proxyDeadKey(url: string, baseUrl?: string | null): string | null {
  if (!url) return null;
  if (/^data:/i.test(url)) return null;
  if (SESSION_IMAGE_RE.test(url)) return null;
  if (/^https?:\/\//i.test(url)) {
    try { return new URL(url).origin; } catch { return null; }
  }
  // Relative CryoSmart API path ("api/log_image/…" or "/api/…") → proxied
  // against the session's base URL.
  if (/^\/?api\//i.test(url)) return baseUrl || "(relative-no-session)";
  // Other same-origin paths (/demo/…) never proxy.
  return null;
}

function isProxyDead(key: string): boolean {
  const at = PROXY_DEAD.get(key);
  if (at == null) return false;
  if (Date.now() - at >= PROXY_DEAD_TTL_MS) {
    PROXY_DEAD.delete(key);
    return false;
  }
  return true;
}

export interface ImageEmbedOptions {
  /** Skip fetching DIRECT CryoSmart URLs (`http://<intranet>/api/log_image/…`)
   *  entirely — return null without a request. Used while a STAGED capture is
   *  active: those URLs route through the app server's proxy, which usually
   *  cannot reach the user's intranet (10s abort each), and the bytes are
   *  about to arrive via the capture script's own uploads anyway — grinding
   *  the proxy only stalls the report/modal embed behind a wall of 502s. */
  skipDirectCryosmart?: boolean;
  /** v3.24: external abort (the bundle builder's Stop button). Merged with
   *  the internal 10s timeout so a cancelled build stops prefetching
   *  immediately instead of grinding N/8 × 10s of zombie fetches into an
   *  already-idle progress card. */
  signal?: AbortSignal;
}

/** Merge the external abort signal with the per-request timeout. Prefers
 *  native AbortSignal.any (Chrome 116+/FF 124+); falls back to a manual
 *  controller bridge for older engines. */
function anySignalWithTimeout(external: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([external, timeout]);
  const ctrl = new AbortController();
  const abortFromExternal = () => ctrl.abort();
  if (external.aborted) ctrl.abort();
  else external.addEventListener("abort", abortFromExternal, { once: true });
  timeout.addEventListener("abort", () => ctrl.abort(), { once: true });
  return ctrl.signal;
}

export async function imageToBase64(
  session: CryoSmartSession | null,
  cryosmartPath: string,
  opts?: ImageEmbedOptions
): Promise<string | null> {
  try {
    if (!cryosmartPath) return null;

    let pathOnly = cryosmartPath.trim();
    let existingQuery = "";

    // Data URLs are already self-contained — nothing to fetch.
    if (/^data:/i.test(pathOnly)) return pathOnly;

    // App-served uploaded images — a staged session's
    // `/api/cryosmart/import/session/<token>/image/...` OR a restored
    // capture-history entry's `/api/cryosmart/history/<id>/image/...` —
    // are served by THIS app: fetch them directly, NOT through the CryoSmart
    // proxy (the generic `/api/...` branch below would forward them to the
    // CryoSmart server, which doesn't have that path → 404).
    if (/^\/api\/cryosmart\/(?:import\/session|history)\/[^/]+\/image\//i.test(pathOnly)) {
      const resp = await fetch(pathOnly, {
        credentials: "same-origin",
        signal: anySignalWithTimeout(opts?.signal, FETCH_TIMEOUT_MS),
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
        signal: anySignalWithTimeout(opts?.signal, FETCH_TIMEOUT_MS),
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

    // Staged-capture mode: direct intranet URLs are not worth fetching (see
    // ImageEmbedOptions.skipDirectCryosmart) — the capture script will
    // deliver the bytes via the session-image channel instead.
    if (opts?.skipDirectCryosmart) return null;

    // Re-attach the query so cryoSmartFetch can merge it with base/auth/cookie.
    const relativePath = existingQuery ? `${pathOnly}?${existingQuery}` : pathOnly;

    // No live session (e.g. restored from capture history without a saved
    // CryoSmart origin) → the proxied branch has nothing to proxy against.
    if (!session || !session.baseUrl) return null;

    const resp = await cryoSmartFetch(session, relativePath, {
      signal: opts?.signal,
    });
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
 * `session` is NULLABLE (v3.20): app-served URLs (staged-session images,
 * capture-history images, /demo assets) are fetched same-origin without
 * credentials, so a capture restored from history still embeds its images
 * (the report's blob: / file:// contexts can't resolve relative app URLs —
 * embedding is the only fully self-contained path). Proxied CryoSmart URLs
 * are skipped when no session exists.
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
 *   - node.images: log-image refs (log_image + image_log kinds) → first 24;
 *     other kinds are not rendered by the report when log images exist
 *     (they feed the graph card / modal instead) → skipped.
 *   - v3.28: node.images ui_tile + output_group kinds → the report's
 *     OUTPUT-GROUP FALLBACK renders them (first 6, same selection rules
 *     via outputPreviewFallbackImages) when the job has no log images —
 *     they must embed too, or the downloaded report loses them.
 *   - representative_micrograph_images → first 3.
 *   - select_2d → the 3 tile images.
 *   - classes → every mrc_preview (the classes table renders all rows).
 *   - maps → every preview (the map table renders all rows).
 * Both the `.url` AND `.src` variants are collected: reportImgTag() looks
 * images up by their SRC string, so every src that can differ from its url
 * must be a key in the returned map. Fetches are deduped, so adding both
 * variants costs nothing extra when they're equal.
 */
const REPORT_LOG_IMAGE_LIMIT = 24;

export interface PrefetchImagesOptions {
  /** A staged Smart-Capture session is ACTIVE for this summary — the capture
   *  script is (or was) streaming image BYTES into the session store, so
   *  direct `http://<cryosmart>/api/log_image/...` URLs are skipped from the
   *  prefetch entirely (see ImageEmbedOptions.skipDirectCryosmart): they
   *  grind 10s proxy timeouts while their bytes are already on the way via
   *  the session-image channel. */
  stagedImport?: boolean;
  /** v3.24: external abort — the bundle builder's Stop button. Stops the
   *  worker pool from pulling new URLs and aborts in-flight fetches. */
  signal?: AbortSignal;
}

/** Structured progress: pass any subset of current/total/message. */
export type PrefetchProgress = (p: { current?: number; total?: number; message?: string }) => void;

export async function prefetchImagesForReport(
  session: CryoSmartSession | null,
  summary: import("./types").LineageSummary,
  onProgress?: PrefetchProgress,
  opts?: PrefetchImagesOptions
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
    // limit; when a job has NO log images the v3.28 output-group fallback
    // renders its preview assets instead, so those are collected too
    // (mirroring the rendered scope exactly via the shared helper).
    const logImages = (node.images || []).filter(
      (img) => img.kind === "log_image" || img.kind === "image_log"
    );
    for (const img of logImages.slice(0, REPORT_LOG_IMAGE_LIMIT)) {
      add(img.url, img.src);
    }
    for (const img of outputPreviewFallbackImages(node)) {
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
    for (const img of outputPreviewFallbackImages(sj)) {
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
    onProgress?.({ message: "No images referenced in this lineage." });
    return out;
  }

  // Staged-capture short-circuit: skip direct CryoSmart http(s) URLs when a
  // staged capture is active (explicit flag — covers the refs-only phase
  // BEFORE the first bytes land, when no session-image URLs exist yet for
  // the heuristic below to detect) or when ANY URL is a session-image URL
  // (bytes uploaded by the capture script). In that mode the direct
  // `http://<cryosmart>/api/log_image/...` URLs are near-worthless to
  // prefetch: they route through the app server's proxy (10s abort each)
  // which usually cannot reach the user's intranet at all, so a capture with
  // a handful of not-yet-uploaded previews used to spend MINUTES grinding
  // 502s while the already-uploaded session images waited behind them. An
  // asset with BOTH variants embeds via its session URL (same picture), and
  // an asset with ONLY a direct URL renders via the report's own src +
  // proxy-fallback chain (hidden cleanly when unreachable) and upgrades to
  // a session URL when its bytes land and the summary refreshes.
  const isSessionImageUrl = (u: string) =>
    /\/api\/cryosmart\/(?:import\/session|history)\/[^/?#]+\/image\//.test(u);
  const isDirectCryosmartUrl = (u: string) =>
    /^https?:\/\//i.test(u) && u.includes("/api/log_image/");
  if (opts?.stagedImport || urlList.some(isSessionImageUrl)) {
    const before = urlList.length;
    const kept = Array.from(new Set(urlList.filter((u) => !isDirectCryosmartUrl(u))));
    const skipped = before - kept.length;
    urlList.length = 0;
    urlList.push(...kept);
    if (skipped > 0) {
      onProgress?.({ message: `Skipping ${skipped} intranet-only image URL${skipped === 1 ? "" : "s"} (bytes not uploaded yet)…` });
    }
  }

  // Fetch with limited concurrency (8 at a time). Session-image URLs are
  // same-origin in-memory serves — fast; remote/proxied URLs are bounded by
  // the 10s abort timeout inside imageToBase64 so nothing hangs the pool.
  // v3.38: proxied failures feed the unreachable-proxy breaker above.
  const CONCURRENCY = 8;
  let done = 0;
  let embedded = 0;
  let index = 0;
  let proxiedFails = 0;
  let skippedUnreachable = 0;

  async function worker() {
    while (index < urlList.length) {
      // v3.24: a cancelled build stops pulling new URLs — the pool drains
      // as soon as the in-flight fetches observe the merged abort signal.
      if (opts?.signal?.aborted) return;
      const myIndex = index++;
      const url = urlList[myIndex];
      // v3.38: cache hit → instant. Restarted prefetches (live summary
      // refresh) resume from the previously embedded images instead of
      // restarting at 0 — progress becomes monotonic across restarts.
      const hit = EMBED_CACHE.get(url);
      if (hit) {
        out[url] = hit;
        embedded++;
        done++;
        continue;
      }
      // v3.38: unreachable-proxy skip — a dead origin (this page session)
      // is never re-ground; those images render as remote links.
      const deadKey = proxyDeadKey(url, session?.baseUrl);
      if (deadKey && isProxyDead(deadKey)) {
        skippedUnreachable++;
        done++;
        continue;
      }
      onProgress?.({ current: done, total: urlList.length, message: `Embedding image ${done + 1}/${urlList.length}…` });
      const dataUrl = await imageToBase64(session, url, {
        skipDirectCryosmart: opts?.stagedImport === true,
        signal: opts?.signal,
      });
      if (dataUrl) {
        out[url] = dataUrl;
        embedded++;
        cacheEmbed(url, dataUrl);
        if (deadKey) proxiedFails = 0;   // reachable after all — reset
      } else if (deadKey) {
        proxiedFails++;
        if (proxiedFails >= PROXY_FAIL_N && !isProxyDead(deadKey)) {
          PROXY_DEAD.set(deadKey, Date.now());
          onProgress?.({
            current: done,
            total: urlList.length,
            message: `App server cannot reach ${deadKey} — skipping its remaining image(s) (they render as remote links; the capture script's byte uploads are the self-contained channel)…`,
          });
        }
      }
      done++;
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, urlList.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  onProgress?.({
    current: urlList.length,
    total: urlList.length,
    message:
      embedded > 0
        ? `${embedded}/${urlList.length} images embedded` +
          (skippedUnreachable > 0
            ? ` · ${skippedUnreachable} skipped (app server cannot reach the CryoSmart intranet origin — those render as remote links; the capture script's byte uploads are the self-contained channel)`
            : "")
        : skippedUnreachable > 0
          ? `No images embedded — ${skippedUnreachable} skipped (app server cannot reach the CryoSmart intranet origin; they render as remote links in the report)`
          : "Image embedding failed — falling back to remote URLs",
  });
  return out;
}
