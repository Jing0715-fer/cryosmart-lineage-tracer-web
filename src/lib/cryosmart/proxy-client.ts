/**
 * Browser-side client for the CryoSmart proxy API route.
 *
 * The web app cannot fetch CryoSmart directly (CORS + HttpOnly cookies), so
 * every live-mode request goes through `/api/cryosmart/[...path]?base=&cookie=`.
 *
 * This module is browser-only (uses fetch, FormData, atob).
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
 */
export async function cryoSmartFetch(
  session: CryoSmartSession,
  cryosmartPath: string,
  init?: { signal?: AbortSignal }
): Promise<Response> {
  const cleanPath = cryosmartPath.replace(/^\/+/, "");
  const params = new URLSearchParams();
  params.set("base", session.baseUrl);
  if (session.cookie) params.set("cookie", session.cookie);
  if (session.auth) params.set("auth", session.auth);
  const url = `/api/cryosmart/${cleanPath}?${params.toString()}`;
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

/**
 * Try the four candidate "list jobs" endpoints the original extension
 * probes (popup.js:tryFetchProjectJobs). Returns the first that responds
 * with an array or `{ jobs: [...] }`.
 */
export interface RawJobsResult {
  jobs: unknown[];
  source: string;
}

export async function fetchProjectJobs(
  session: CryoSmartSession,
  projectId: string
): Promise<RawJobsResult> {
  const candidates = [
    `api/projects/${encodeURIComponent(projectId)}/jobs`,
    `api/jobs?project_uid=${encodeURIComponent(projectId)}`,
    `api/projects/${encodeURIComponent(projectId)}/metadata`,
    `api/meteor/jobs?project_uid=${encodeURIComponent(projectId)}`,
  ];
  let lastErr: Error | null = null;
  for (const path of candidates) {
    try {
      const data = await cryoSmartJson<unknown>(session, path);
      const arr = extractJobsArray(data);
      if (arr && arr.length > 0) {
        return { jobs: arr, source: path };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (lastErr) {
    throw new Error(
      `Could not list jobs for project ${projectId} on ${session.baseUrl}. Last error: ${lastErr.message}`
    );
  }
  return { jobs: [], source: "none" };
}

function extractJobsArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) return obj.jobs;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return null;
}
