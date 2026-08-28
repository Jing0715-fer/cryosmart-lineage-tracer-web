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
}

/** True for URLs pointing at THIS app's staged-capture image store
 *  (`/api/cryosmart/import/session/<token>/image/<fileid>`). Those bytes
 *  live in the import session's in-memory store and are served same-origin;
 *  the CryoSmart server knows nothing about the path. */
export function isSessionImageUrl(url: string | null | undefined): boolean {
  return /^\/?(?:https?:\/\/[^/]+\/)?api\/cryosmart\/import\/session\/[^/?#]+\/image\//i.test(
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
 *  (0) An uploaded session-image URL (`/api/cryosmart/import/session/<token>/
 *      image/<fileid>`) — served by THIS app, fetched directly same-origin.
 *      Forwarding it through the proxy used to relay it to the CryoSmart
 *      server, which 404s ("detail: Not Found") — that single missing branch
 *      broke EVERY staged-capture image in the ZIP bundle download (the
 *      "247 warnings" report: 221 images lost despite their bytes being
 *      safely stored in the session).
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

  // Branch (0): uploaded session-image URL — served by THIS app.
  if (/^api\/cryosmart\/import\/session\/[^/]+\/image\//i.test(cleanPath)) {
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

/** Fetch bytes (for maps, MRC, PNG, PDF). Returns Uint8Array. */
export async function cryoSmartBytes(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: CryoSmartFetchInit
): Promise<Uint8Array> {
  const resp = await cryoSmartFetch(session, cryosmartPath, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CryoSmart ${resp.status} for ${cryosmartPath}: ${text.slice(0, 200)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
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
