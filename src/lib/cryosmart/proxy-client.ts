/**
 * Browser-side client for the CryoSmart proxy API route.
 *
 * The web app cannot fetch CryoSmart directly (CORS + HttpOnly cookies), so
 * requests that need the CryoSmart backend (map downloads, image fallbacks)
 * go through `/api/cryosmart/[...path]?base=&cookie=`.
 *
 * This module is browser-only (uses fetch, localStorage).
 */

export interface CryoSmartSession {
  /** Origin, e.g. "http://192.168.4.3:8080" — no trailing slash. */
  baseUrl: string;
  /** Raw Cookie header value, e.g. "session=eyJ...; csrftoken=abc". */
  cookie?: string;
  /** Raw Authorization header value, e.g. "Bearer eyJ...". */
  auth?: string;
}

const SESSION_KEY = "cryosmart.session.v1";

export function loadSession(): CryoSmartSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CryoSmartSession;
    if (!parsed || typeof parsed.baseUrl !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: CryoSmartSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Per-request options shared by every fetch helper below. */
export interface CryoSmartFetchInit {
  signal?: AbortSignal;
  /** Upstream timeout in ms for proxy-routed requests. Forwarded to the
   *  `/api/cryosmart/[...path]` route as `timeout=<ms>` (clamped there to
   *  1s–5min; default 10s). Pass a large value for big downloads — map /
   *  .mrc files routinely exceed the 10s default even on fast intranets. */
  timeoutMs?: number;
  /** No-DATA stall watchdog for byte downloads (cryoSmartBytes only).
   * If the response body produces no chunk for this long, the download is
   * aborted as "stalled" even before timeoutMs elapses. A slow-but-flowing
   * download never trips it (every chunk resets the window). Default 45s
   * — see cryoSmartBytes for why this exists. */
  stallMs?: number;
  /** Byte-progress callback for cryoSmartBytes (throttle at the call
   *  site; fires once per chunk with the cumulative byte count). Used by
   * the ZIP builder to prove liveness while large maps stream. */
  onBytes?: (totalBytes: number) => void;
}

/** True for URLs pointing at THIS app's own uploaded-image stores —
 *  either the staged-capture session store
 *  (`/api/cryosmart/import/session/<token>/image/<fileid>`) or a persisted
 *  capture-history entry (`/api/cryosmart/history/<id>/image/<fileid>`).
 *  Those bytes live in this app; the CryoSmart server knows nothing about
 *  those paths. */
export function isSessionImageUrl(url: string | null | undefined): boolean {
  return /^\/?(?:https?:\/\/[^/]+\/)?api\/cryosmart\/(?:import\/session|history)\/[^/?#]+\/image\//i.test(
    String(url || "")
  );
}

/** True for DIRECT CryoSmart image URLs (`http://<intranet>/api/log_image/…`).
 *  In a staged capture these are refs whose bytes were never uploaded — the
 *  only machine that can fetch them is the user's intranet browser. */
export function isDirectCryosmartUrl(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(url || "")) && String(url).includes("/api/log_image/");
}

/**
 * Fetch a CryoSmart path via the proxy. Returns the raw Response.
 * The caller can use `.json()`, `.arrayBuffer()`, `.blob()`, or `.text()`.
 *
 * Path shapes supported:
 *  (0) An app-served uploaded-image URL — a staged session's
 *      `/api/cryosmart/import/session/<token>/image/<fileid>` OR a restored
 *      capture-history entry's `/api/cryosmart/history/<id>/image/<fileid>`.
 *      The bytes live in THIS app, so fetch them directly same-origin.
 *      Forwarding them through the proxy used to relay them to the
 *      CryoSmart server, which 404s ("detail: Not Found") — that single
 *      missing branch broke EVERY staged-capture image in the ZIP bundle
 *      download (the "247 warnings" report: 221 images lost despite their
 *      bytes being safely stored in the session).
 *  (1) A CryoSmart relative path (e.g. "api/log_image/<fileid>" or
 *      "api/job/get_clear_job_list?project_uid=P259") — the path is
 *      forwarded through `/api/cryosmart/[...path]?base=&cookie=&auth=`.
 *  (2) A `/api/proxy-image/<fileid>?base=...` URL produced by `logImageUrl`
 *      in `lineage.ts` — already a same-origin Next.js proxy URL. We just
 *      merge `cookie` / `auth` from the session into its query string and
 *      fetch it directly. Without this branch, `imageToBase64` would
 *      route proxy-image URLs through `/api/cryosmart/...` which would
 *      then try to fetch CryoSmart at the non-existent path
 *      `/api/proxy-image/<fileid>` → 404.
 *  (3) Any other root-relative same-origin path (e.g. `/favicon.ico` or the
 *      bundled `/demo/*.png` assets) — fetched directly, never proxied.
 */
export async function cryoSmartFetch(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: CryoSmartFetchInit
): Promise<Response> {
  const cleanPath = String(cryosmartPath || "").replace(/^\/+/, "");

  // Normalize DIRECT absolute http(s) URLs (e.g.
  // "http://<intranet>/api/log_image/<fileid>") BEFORE the branch logic.
  // Previously such URLs fell through to branch (1) verbatim and the
  // [...path] route rebuilt `${base}/http://<intranet>/api/...` — a nested
  // path the upstream 404s, so EVERY direct-URL image (ZIP bundle + PPTX)
  // failed even when this server COULD reach CryoSmart, and landed in
  // images/NOT_UPLOADED_LINKS.txt misleadingly. image-embed.ts strips
  // origins at its own call sites; bundle.ts / collectPptImages pass full
  // URLs — normalizing HERE fixes every caller at once.
  if (/^https?:\/\//i.test(cleanPath)) {
    try {
      const u = new URL(cleanPath);
      const rest = `${u.pathname.replace(/^\/+/, "")}${u.search}`;
      // Absolute form of an app-served uploaded-image URL (staged session
      // or capture history): the bytes live in THIS app — fetch same-origin,
      // never through the CryoSmart proxy.
      if (/^api\/cryosmart\/(?:import\/session|history)\/[^/]+\/image\//i.test(rest)) {
        return fetch(`/${rest}`, {
          method: "GET",
          credentials: "same-origin",
          signal: init?.signal,
        });
      }
      // Direct CryoSmart (or other) URL: proxy it against ITS OWN origin —
      // a direct image URL may point at an intranet host even when
      // session.baseUrl differs. Mirrors branch (1)'s query merging.
      const [pathPart, queryPart] = rest.split("?");
      const params = new URLSearchParams(queryPart || "");
      params.set("base", u.origin);
      if (session.cookie) params.set("cookie", session.cookie);
      if (session.auth) params.set("auth", session.auth);
      if (init?.timeoutMs) params.set("timeout", String(Math.round(init.timeoutMs)));
      return fetch(`/api/cryosmart/${pathPart}?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        signal: init?.signal,
      });
    } catch {
      // Unparseable absolute URL — fall through to the legacy branches.
    }
  }

  // Branch (0): app-served uploaded-image URL (staged session or restored
  // capture history) — served by THIS app.
  if (/^api\/cryosmart\/(?:import\/session|history)\/[^/]+\/image\//i.test(cleanPath)) {
    const [p, q] = cleanPath.split("?");
    return fetch(`/${p}${q ? `?${q}` : ""}`, {
      method: "GET",
      credentials: "same-origin",
      signal: init?.signal,
    });
  }

  // Branch (3): same-origin assets that are not app API paths — fetch
  // directly instead of relaying them to the CryoSmart server.
  if (String(cryosmartPath || "").startsWith("/") && !/^api\//i.test(cleanPath)) {
    const [p, q] = cleanPath.split("?");
    return fetch(`/${p}${q ? `?${q}` : ""}`, {
      method: "GET",
      credentials: "same-origin",
      signal: init?.signal,
    });
  }

  // Branch (2): proxy-image URL — fetch directly, just merge session.
  if (cleanPath.startsWith("api/proxy-image/")) {
    const [pathOnly, existingQuery] = cleanPath.split("?");
    const params = new URLSearchParams(existingQuery || "");
    // The proxy-image URL already carries `base` from `logImageUrl`. Don't
    // overwrite it with `session.baseUrl` (they should match anyway, but
    // if the URL was constructed before the session was loaded, the URL's
    // base is what we want). Only add session credentials.
    if (session.cookie) params.set("cookie", session.cookie);
    if (session.auth) params.set("auth", session.auth);
    const qs = params.toString();
    const url = `/${pathOnly}${qs ? `?${qs}` : ""}`;
    return fetch(url, {
      method: "GET",
      credentials: "same-origin",
      signal: init?.signal,
    });
  }

  // Branch (1): CryoSmart relative path — forward via /api/cryosmart/[...path].
  // Split the CryoSmart path into path + query, because some candidate
  // endpoints like "api/jobs?project_uid=P259" already contain a query
  // string. We must NOT just append "?base=..." (that would create two "?"
  // and break param parsing). Instead, merge the path's own query params
  // with the proxy's params (base, cookie, auth, timeout) into one
  // URLSearchParams.
  const [pathOnly, existingQuery] = cleanPath.split("?");
  const params = new URLSearchParams(existingQuery || "");
  params.set("base", session.baseUrl);
  if (session.cookie) params.set("cookie", session.cookie);
  if (session.auth) params.set("auth", session.auth);
  if (init?.timeoutMs) params.set("timeout", String(Math.round(init.timeoutMs)));
  const url = `/api/cryosmart/${pathOnly}?${params.toString()}`;
  const resp = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    signal: init?.signal,
  });
  return resp;
}

/** Fetch JSON. Throws on non-2xx. */
export async function cryoSmartJson<T = unknown>(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: CryoSmartFetchInit
): Promise<T> {
  const resp = await cryoSmartFetch(session, cryosmartPath, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CryoSmart ${resp.status} for ${cryosmartPath}: ${text.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}

/* ── Byte-download hardening (v3.17) ──────────────────────────────────
 * The user's bundle build hung FOREVER at "Fetching maps 0% — Collecting
 * maps…": the proxy route already aborts its UPSTREAM fetch after
 * `timeoutMs`, but since v3.16 it STREAMS the body straight through, and
 * the browser-side read (`resp.arrayBuffer()`) had NO signal of its own.
 * If either leg stalls in a way that never closes the socket (CryoSmart
 * wedged mid-body after sending headers, gateway half-open, dev-server
 * hiccup), the await never settles, the maps pool never drains, and the
 * progress bar sits at 0% with no escape hatch. cryoSmartBytes now owns
 * a local AbortController and enforces THREE guarantees regardless of
 * what the network does:
 *
 *   1. absolute cap   — abort at timeoutMs + 15s grace (the grace lets
 *                       the proxy's own timeout error win the race and
 *                       produce its clearer message);
 *   2. stall watchdog — abort when NO chunk arrives for stallMs (45s
 *                       default). A wedged server that already sent
 *                       headers used to burn the FULL per-map window;
 *                       now it costs stallMs, and the bundle builder
 *                       skips the queue after a few of these;
 *   3. external abort — an init.signal (user pressed Stop) aborts
 *                       immediately with a proper AbortError.
 *
 * It also reads the body chunk-by-chunk and reports cumulative bytes via
 * onBytes, so the UI can show "N MB received" liveness while big maps
 * stream (progress used to tick only on COMPLETION — minutes of 0% even
 * on a healthy run). */

/** Default no-data window before a byte download is declared stalled. */
export const DEFAULT_STALL_MS = 45_000;

function isAbortReason(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
}

/** Fetch bytes (for maps, MRC, PNG, PDF). Returns Uint8Array.
 *
 * Throws Error("…download stalled — no data for <N>s…") on a silent body,
 * a normal Error on HTTP failures (message keeps the `CryoSmart <status>`
 * prefix the bundle builder pattern-matches for unreachable detection),
 * and an AbortError when the caller cancels via init.signal. */
export async function cryoSmartBytes(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: CryoSmartFetchInit
): Promise<Uint8Array> {
  const timeoutMs = init?.timeoutMs;
  const stallMs = init?.stallMs ?? DEFAULT_STALL_MS;
  const ctrl = new AbortController();
  let abortReason: "stalled" | "timeout" | "external" | null = null;

  // Merge an external cancel signal (Stop button) into the local one so
  // BOTH the fetch and any in-progress body read die together.
  const onExternalAbort = () => {
    abortReason = "external";
    ctrl.abort();
  };
  if (init?.signal) {
    if (init.signal.aborted) onExternalAbort();
    else init.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  // Absolute cap: timeoutMs (+grace) from request START — covers header
  // wait AND body read no matter what the proxy does.
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs && timeoutMs > 0) {
    capTimer = setTimeout(() => {
      if (!abortReason) abortReason = "timeout";
      ctrl.abort();
    }, timeoutMs + 15_000);
  }

  const cleanup = () => {
    if (capTimer) clearTimeout(capTimer);
    init?.signal?.removeEventListener("abort", onExternalAbort);
  };
  /** Map a watchdog/cancel abort to its proper error (shared by the
   *  read-loop guard and the catch below). */
  const mapAbort = (): Error | null => {
    if (abortReason === "external") {
      return new DOMException("Download cancelled", "AbortError");
    }
    if (abortReason === "stalled") {
      return new Error(
        `CryoSmart download of ${cryosmartPath} stalled — no data for ${Math.round(stallMs / 1000)}s`
      );
    }
    if (abortReason === "timeout") {
      return new Error(
        `CryoSmart download of ${cryosmartPath} timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s`
      );
    }
    return null;
  };

  try {
    const resp = await cryoSmartFetch(session, cryosmartPath, {
      ...init,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`CryoSmart ${resp.status} for ${cryosmartPath}: ${text.slice(0, 200)}`);
    }

    // Small / no body (or non-streamable environment) — plain read.
    if (!resp.body) {
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    }

    // Chunked read with the no-data watchdog: every received chunk
    // resets the window, so a SLOW download never trips it — only a
    // silent one does.
    //
    // NOTE: the watchdog must ONLY abort the fetch signal — calling
    // reader.cancel() here (a "defensive nudge" in the first draft)
    // resolves the pending read() as a CLEAN EOF, which turned every
    // watchdog kill into a "successful" TRUNCATED download. Instead,
    // the post-loop guard below turns any surviving abort into the
    // proper error: runtimes differ on whether an aborted fetch REJECTS
    // the pending read (spec) or resolves it as done (some undici/Bun
    // versions) — both paths are covered.
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!abortReason) abortReason = "stalled";
        ctrl.abort();
      }, stallMs);
    };
    armStall();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          init?.onBytes?.(received);
        }
        armStall();
      }
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
    // Post-loop guard: if the watchdog/cancel aborted the fetch but the
    // runtime handed us a clean EOF instead of a rejection, do NOT ship
    // the truncated bytes as a success. Same for a body that ends
    // "cleanly" SHORT of its declared Content-Length (a proxy/upstream
    // that closes early without an RST can look like a normal EOF).
    const abortedRead = mapAbort();
    if (abortedRead) throw abortedRead;
    const declaredLen = Number(resp.headers.get("content-length") || "");
    if (Number.isFinite(declaredLen) && declaredLen > 0 && received !== declaredLen) {
      throw new Error(
        `CryoSmart download of ${cryosmartPath} truncated — got ${received} of ${declaredLen} bytes`
      );
    }
    if (received === 0 && chunks.length === 0) {
      // Empty 2xx body — treat as zero bytes (caller decides if that is
      // valid; historically arrayBuffer() returned an empty buffer here).
      return new Uint8Array(0);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  } catch (err) {
    const mapped = mapAbort();
    if (mapped) throw mapped;
    if (isAbortReason(err)) {
      // The proxy's own AbortSignal.timeout fired mid-body (its 502
      // contract only covers pre-header failures) — surface a readable
      // per-item error instead of a raw "The operation was aborted".
      throw new Error(
        `CryoSmart download of ${cryosmartPath} aborted (upstream timeout${timeoutMs ? ` ${Math.round(timeoutMs / 1000)}s` : ""})`
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * Probe whether the APP SERVER can reach the user's CryoSmart instance.
 *
 * Used by the ZIP bundle builder to fail fast: when the app runs in the
 * cloud and CryoSmart lives on the user's intranet (the common preview
 * deployment), every proxied map / .mrc download burns its full timeout
 * before failing with 502 — a 26-map lineage ground for minutes in the
 * user's "247 warnings" download. ONE cheap request settles it: any HTTP
 * status (200 / 404 / 403 …) proves the server can connect; only a 502
 * whose body says "Failed to reach" (the proxy's connection-failure
 * marker) or a thrown fetch means unreachable.
 */
export async function probeCryosmartReachable(
  session: CryoSmartSession,
  timeoutMs = 8000
): Promise<boolean> {
  try {
    const resp = await cryoSmartFetch(session, "favicon.ico", { timeoutMs });
    if (resp.status === 502) {
      const text = await resp.text().catch(() => "");
      return !/failed to reach/i.test(text);
    }
    return true;
  } catch {
    return false;
  }
}
