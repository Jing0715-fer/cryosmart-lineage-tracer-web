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

/**
 * Fetch a CryoSmart path via the proxy. Returns the raw Response.
 * The caller can use `.json()`, `.arrayBuffer()`, `.blob()`, or `.text()`.
 *
 * Two path shapes are supported:
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
 */
export async function cryoSmartFetch(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: { signal?: AbortSignal }
): Promise<Response> {
  const cleanPath = cryosmartPath.replace(/^\/+/, "");

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
  // with the proxy's params (base, cookie, auth) into one URLSearchParams.
  const [pathOnly, existingQuery] = cleanPath.split("?");
  const params = new URLSearchParams(existingQuery || "");
  params.set("base", session.baseUrl);
  if (session.cookie) params.set("cookie", session.cookie);
  if (session.auth) params.set("auth", session.auth);
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
  init?: { signal?: AbortSignal }
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
  init?: { signal?: AbortSignal }
): Promise<Uint8Array> {
  const resp = await cryoSmartFetch(session, cryosmartPath, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CryoSmart ${resp.status} for ${cryosmartPath}: ${text.slice(0, 200)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}
