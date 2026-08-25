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
  // Helper: filter jobs by project_uid (the global endpoints don't filter server-side)
  const belongsToProject = (job: unknown): boolean => {
    if (!job || typeof job !== "object") return false;
    const obj = job as Record<string, unknown>;
    const jPid = obj.project_uid;
    return jPid === undefined || jPid === null || jPid === projectId || jPid === pid;
  };

  // We collect (uid → job) across multiple endpoints, deduplicating by uid.
  const jobsByUid = new Map<string, Record<string, unknown>>();
  const recordJobs = (jobs: unknown[]) => {
    for (const job of jobs) {
      if (!job || typeof job !== "object") continue;
      const obj = job as Record<string, unknown>;
      const uid = obj.uid;
      if (typeof uid !== "string" || jobsByUid.has(uid)) continue;
      if (!belongsToProject(job)) continue;
      jobsByUid.set(uid, obj);
    }
  };
  const errors: string[] = [];

  // Step 1: get_clear_job_list (only endpoint that server-side filters by project_uid).
  // Returns "intermediate" jobs — for some projects (e.g. P259) this captures most/all jobs;
  // for others (e.g. P52) it returns null and we need other endpoints.
  try {
    const data = await cryoSmartJson<unknown>(
      session,
      `api/job/get_clear_job_list?project_uid=${pid}`
    );
    const arr = extractJobsArray(data);
    if (arr && arr.length > 0) recordJobs(arr);
  } catch (err) {
    errors.push(`get_clear_job_list: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: paginate global endpoints (get_current_jobs + get_job_history),
  // client-side filter. /api/job/get_job_history is the only history endpoint and
  // it doesn't honor project_uid for sort — different sort fields expose different
  // jobs. We sweep a few pages per sort direction so we don't miss old jobs.
  const globalSweeps: Array<{ name: string; path: string; sortField: string; desc: boolean; pages: number }> = [
    { name: "get_current_jobs page=0", path: "api/job/get_current_jobs", sortField: "created_at", desc: false, pages: 3 },
    { name: "get_job_history (completed_at asc)", path: "api/job/get_job_history", sortField: "completed_at", desc: false, pages: 3 },
    { name: "get_job_history (created_at asc)", path: "api/job/get_job_history", sortField: "created_at", desc: false, pages: 3 },
    { name: "get_job_history (uid asc)", path: "api/job/get_job_history", sortField: "uid", desc: false, pages: 3 },
  ];
  for (const sweep of globalSweeps) {
    for (let page = 0; page < sweep.pages; page++) {
      try {
        const data = await cryoSmartJson<unknown>(
          session,
          `${sweep.path}?project_uid=${pid}&page=${page}&limit=100&sort_field=${sweep.sortField}&desc=${sweep.desc}`
        );
        const arr = extractJobsArray(data);
        if (!arr || arr.length === 0) break;
        recordJobs(arr);
        if (arr.length < 100) break;
      } catch (err) {
        errors.push(`${sweep.name} p${page}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
  }

  // Step 3: get_compound_time_project returns a CSV with EVERY job UID for this project
  // (212 for P52, 48 for P259) — even ones the JSON endpoints don't surface. We use the CSV
  // as the authoritative UID list, and merge it with the jobs we already have. UIDs in the
  // CSV that aren't in jobsByUid get a minimal placeholder so they still appear in the UI.
  try {
    const csvText = await cryoSmartText(session, `api/project/get_compound_time_project?project_id=${pid}`);
    const csvUids = parseProjectCsv(csvText, projectId);
    let addedFromCsv = 0;
    for (const uid of csvUids) {
      if (jobsByUid.has(uid)) continue;
      // Placeholder — lineage tracer can still walk edges from these UIDs even without metadata.
      jobsByUid.set(uid, {
        uid,
        project_uid: projectId,
        job_type: "unknown",
        status: "unknown",
        _from_csv: true,
      });
      addedFromCsv += 1;
    }
    if (addedFromCsv > 0) {
      errors.length = 0; // clear errors since CSV was authoritative
    }
  } catch (err) {
    errors.push(`get_compound_time_project: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (jobsByUid.size > 0) {
    return {
      jobs: Array.from(jobsByUid.values()),
      source: `get_clear_job_list + paginated global endpoints + CSV UID merge (${jobsByUid.size} jobs)`,
    };
  }

  throw new Error(
    `Could not list jobs for project ${projectId} on ${session.baseUrl}.\n\n` +
      `Tried get_clear_job_list + paginated get_current_jobs/get_job_history + get_compound_time_project CSV, all returned 0 matching jobs.\n` +
      `Errors:\n` +
      errors.map((e) => `  ${e}`).join("\n") +
      `\n\nThis usually means your session cookie is invalid/expired or you don't have access to project ${projectId}.`
  );
}

/**
 * Parse the CSV returned by /api/project/get_compound_time_project into a set of job UIDs.
 * CSV columns: Project,Job,Type,Status,Create By,Started Time,Completed Time,Killed Time,Failed Time,State,Total Time
 * Only rows whose Project column equals projectId are kept.
 */
function parseProjectCsv(csv: string, projectId: string): Set<string> {
  const uids = new Set<string>();
  if (!csv) return uids;
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return uids;
  const header = lines[0].split(",");
  const projectCol = header.indexOf("Project");
  const jobCol = header.indexOf("Job");
  if (projectCol < 0 || jobCol < 0) return uids;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[projectCol] === projectId && cols[jobCol]) {
      uids.add(cols[jobCol]);
    }
  }
  return uids;
}

/** Like cryoSmartJson but returns the raw text (for non-JSON responses like CSV). */
async function cryoSmartText(
  session: CryoSmartSession,
  cryosmartPath: string
): Promise<string> {
  const resp = await cryoSmartFetch(session, cryosmartPath);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CryoSmart ${resp.status} for ${cryosmartPath}: ${text.slice(0, 200)}`);
  }
  return resp.text();
}

function extractJobsArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Standard wrappers
    if (Array.isArray(obj.jobs)) return obj.jobs;
    if (Array.isArray(obj.items)) return obj.items;
    // CryoSmart wrapper: { data: [...], msg: "..." }
    if (Array.isArray(obj.data)) return obj.data;
    // CryoSmart wrapper: { data: {...}, pagination: {...} } where data is array
    if (Array.isArray(obj.data)) {
      // data might itself be an object wrapping a jobs array
      if (Array.isArray(obj.data)) return obj.data;
      if (obj.data && typeof obj.data === "object") {
        const inner = obj.data as Record<string, unknown>;
        if (Array.isArray(inner.jobs)) return inner.jobs;
        if (Array.isArray(inner.items)) return inner.items;
        if (Array.isArray(inner.job_list)) return inner.job_list;
        if (Array.isArray(inner.jobList)) return inner.jobList;
        // get_clear_job_list returns {"data": {"class_2D": [...], "class_3D": [...], ...}}
        // — flatten all dict-of-array values into a single jobs array.
        const flattened: unknown[] = [];
        let anyFlattened = false;
        for (const key of Object.keys(inner)) {
          const v = inner[key];
          if (Array.isArray(v) && v.length > 0) {
            const first = v[0] as Record<string, unknown> | undefined;
            if (first && typeof first === "object" && (first.uid || first.job_type || first.job_uid || first.project_uid)) {
              flattened.push(...v);
              anyFlattened = true;
            }
          }
        }
        if (anyFlattened) return flattened;
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
