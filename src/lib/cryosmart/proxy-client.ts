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
  // Split the CryoSmart path into path + query, because some candidate
  // endpoints like "api/jobs?project_uid=P259" already contain a query
  // string. We must NOT just append "?base=..." (that would create two "?"
  // and break param parsing). Instead, merge the path's own query params
  // with the proxy's params (base, cookie, auth) into one URLSearchParams.
  const cleanPath = cryosmartPath.replace(/^\/+/, "");
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
  const pid = encodeURIComponent(projectId);
  const candidates = [
    // Real CryoSmart API endpoints (verified from deployment at 192.168.202.11:8080):
    `api/job/get_clear_job_list?project_uid=${pid}`,
    `api/project/get_compound_time_project?project_id=${pid}`,
    `api/job/get_clear_job_list?project_uid=${pid}&all=true`,
    `api/job/get_job_list?project_uid=${pid}`,
    `api/job/get_job_list?project_uid=${pid}&all=true`,
    `api/project/get_project?project_id=${pid}`,
    `api/project/get_project_info?project_id=${pid}`,
    // Original guesses (for other CryoSmart deployments):
    `api/projects/${pid}/jobs`,
    `api/jobs?project_uid=${pid}`,
    `api/projects/${pid}/metadata`,
    `api/meteor/jobs?project_uid=${pid}`,
    `api/v1/projects/${pid}/jobs`,
    `api/v1/projects/${pid}`,
    `api/projects/${pid}`,
    `api/project/${pid}/jobs`,
    `v1/projects/${pid}/jobs`,
    `projects/${pid}/jobs`,
    `api/projects/${pid}/exposures`,
    `api/projects/${pid}/exposures/jobs`,
  ];
  const errors: string[] = [];
  for (const path of candidates) {
    try {
      const data = await cryoSmartJson<unknown>(session, path);
      const arr = extractJobsArray(data);
      if (arr && arr.length > 0) {
        return { jobs: arr, source: path };
      }
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(
    `Could not list jobs for project ${projectId} on ${session.baseUrl}.\n\n` +
    `Tried ${candidates.length} candidate endpoints, all failed:\n` +
    errors.map((e) => `  ${e}`).join("\n") +
    `\n\nHow to fix: open CryoSmart in your browser, press F12 → Network tab, ` +
    `refresh the page, and find the XHR request that returns the job list ` +
    `(look for a JSON response containing job objects). Copy the URL path ` +
    `(e.g. /api/custom/projects/P222/jobs) and report it so we can add it.`
  );
}

function extractJobsArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Standard wrappers
    if (Array.isArray(obj.jobs)) return obj.jobs;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data)) {
      // data might itself be an object wrapping a jobs array
      if (Array.isArray(obj.data)) return obj.data;
      if (obj.data && typeof obj.data === "object") {
        const inner = obj.data as Record<string, unknown>;
        if (Array.isArray(inner.jobs)) return inner.jobs;
        if (Array.isArray(inner.items)) return inner.items;
        if (Array.isArray(inner.job_list)) return inner.job_list;
        if (Array.isArray(inner.jobList)) return inner.jobList;
      }
    }
    // CryoSmart-specific wrappers (get_clear_job_list, get_compound_time_project)
    if (Array.isArray(obj.job_list)) return obj.job_list;
    if (Array.isArray(obj.jobList)) return obj.jobList;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.exposures)) return obj.exposures;
    if (Array.isArray(obj.nodes)) return obj.nodes;
    if (Array.isArray(obj.pipeline)) return obj.pipeline;
    // Nested: { result: { jobs: [...] } } or { data: { result: [...] } }
    if (obj.result && typeof obj.result === "object") {
      const r = obj.result as Record<string, unknown>;
      if (Array.isArray(r.jobs)) return r.jobs;
      if (Array.isArray(r.job_list)) return r.job_list;
      if (Array.isArray(r.items)) return r.items;
      if (Array.isArray(r.data) && Array.isArray(r.data)) return r.data;
    }
    // Deep search: find any array property with > 0 items that looks like jobs
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0) {
        const first = val[0] as Record<string, unknown> | undefined;
        // Check if items look like job objects (have uid or job_type)
        if (first && typeof first === "object" && (first.uid || first.job_type || first.job_uid || first.project_uid)) {
          return val;
        }
      }
    }
  }
  return null;
}
