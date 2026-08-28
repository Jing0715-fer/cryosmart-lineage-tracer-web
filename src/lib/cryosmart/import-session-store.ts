/**
 * Staged, in-memory import sessions for the Smart Capture flow.
 *
 * Legacy flow (still supported): the capture script gathers EVERYTHING
 * (jobs + log images) client-side, then POSTs one big payload to
 * /api/cryosmart/import and only then opens the web app. Two problems:
 *   1. window.open() runs long after the user gesture → popup blocked.
 *   2. The user stares at the CryoSmart console for up to a minute with
 *      no feedback.
 *
 * Staged flow (this store): the script creates a session FIRST, opens the
 * web app immediately (the UI polls /status for live progress), then
 * uploads jobs (graph renders right away) and streams log-image batches
 * as they are collected, and finally marks the session complete.
 */

import { randomBytes } from "crypto";

export type ImportSessionStatus =
  | "awaiting_jobs" // session created, jobs not uploaded yet
  | "collecting_logs" // jobs uploaded; log images streaming in
  | "complete"; // capture script finished (may still be awaiting first read)

export interface LogImageRef {
  fileid?: string;
  name?: string;
  text?: string | null;
  flags?: string[] | string | null;
  [key: string]: unknown;
}

export interface ImportSessionData {
  project_uid?: string;
  experiment_uid?: string;
  source_url?: string;
  captured_at?: string;
  discovered_job_count?: number;
  cryosmart_origin?: string;
  cryosmart_auth?: string;
  cryosmart_cookie?: string;
  jobs?: unknown[];
}

export interface ImportSession {
  token: string;
  status: ImportSessionStatus;
  data: ImportSessionData;
  /** v3.5: the job whose CryoSmart page the capture script was run on.
   * The web UI auto-fills Start Job with it and auto-traces the moment
   * jobs land, so running the script from the END JOB's page needs zero
   * manual setup. Null when the script ran from a non-job page. */
  endJobUid: string | null;
  /** v3.5: log images are fetched ONLY for jobs published to `logRequest`
   * by the web UI's Trace Lineage action (lineage-scoped capture — a
   * 46-job project with 900+ images typically needs only ~10 jobs). When
   * false (small projects, or older scripts) every job is scanned. */
  lineageMode: boolean;
  /** Lineage job uids requested by the web UI's Trace action. Unioned
   * across re-traces; `revision` bumps on every update so the capture
   * script (and the UI's stall detector) can see changes. */
  logRequest: { jobs: string[]; revision: number; requestedAt: number } | null;
  /** Log images streamed in batches: { [jobUid]: [{fileid, name, ...}] } */
  jobLogImages: Record<string, LogImageRef[]>;
  /** Image BYTES uploaded by the capture script (it runs same-origin with
   * CryoSmart, so it is the only party that can fetch them). Keyed by
   * fileid; value is a `data:<mime>;base64,...` URL. Served back to the
   * web UI same-origin via GET .../image/<fileid> — the browser viewing the
   * app over HTTPS cannot load `http://192.168.x.x` images directly
   * (mixed content), and the app server usually cannot reach the user's
   * intranet either, so uploaded bytes are the only universally-working
   * delivery channel. */
  imageStore: Map<string, { mime: string; b64: string; name?: string }>;
  /** Approximate total size of `imageStore` (base64 chars ≈ bytes). */
  imageStoreBytes: number;
  /** Log-image refs whose bytes were uploaded successfully. */
  logImagesUploaded: number;
  /** Jobs scanned for logs so far (progress numerator — DISTINCT jobs:
   *  v3.11 rescue batches re-send a uid that already streamed an empty
   *  batch, and that must not push the counter past the total). */
  logJobsDone: number;
  /** Distinct job uids already counted in logJobsDone. */
  logJobsScanned: Set<string>;
  /** Jobs the capture script plans to scan (set with the jobs upload). */
  logJobsTotal: number;
  /** Total log-image refs received. */
  logImagesCount: number;
  /** Distinct jobs that yielded at least one log image. */
  logJobsWithImages: number;
  /** Free-form stage note from the capture script (e.g. "calibrating loader"). */
  note: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const TTL_MS = 45 * 60 * 1000; // captures can take minutes; review can take
// longer. Sessions whose data (esp. uploaded image BYTES) is still being
// READ are kept alive by the sliding refresh below — an untouched session
// expires 45 min after its last access. Previously a flat 15 min, which
// regularly killed the image store while the user was still reading the
// report → every session-image URL 404'd → "graph details has no log image".
const MAX_ENTRIES = 60;

const globalRef = globalThis as unknown as {
  __cryoImportSessions?: Map<string, ImportSession>;
  __cryoImportSessionSeq?: number;
};

if (!globalRef.__cryoImportSessions) {
  globalRef.__cryoImportSessions = new Map<string, ImportSession>();
  globalRef.__cryoImportSessionSeq = 0;
}

const store: Map<string, ImportSession> = globalRef.__cryoImportSessions;
let seq: number = globalRef.__cryoImportSessionSeq || 0;

function gc() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

function newToken(): string {
  seq += 1;
  globalRef.__cryoImportSessionSeq = seq;
  // SECURITY: crypto randomness, not Math.random — session tokens gate
  // access to /data which returns the captured CryoSmart credentials, so
  // a guessable 32-bit token is a real credential-leak risk on shared
  // deployments. 16 bytes = 128 bits of entropy on top of the seq prefix.
  const entropy = randomBytes(8).toString("hex");
  return `s${seq}-${entropy}`;
}

export function createImportSession(
  data: ImportSessionData,
  note = "session created",
  opts?: { endJobUid?: string | null; lineageMode?: boolean }
): ImportSession {
  gc();
  const token = newToken();
  const now = Date.now();
  const session: ImportSession = {
    token,
    status: "awaiting_jobs",
    data: { ...data, captured_at: data.captured_at || new Date().toISOString() },
    endJobUid: opts?.endJobUid || null,
    lineageMode: opts?.lineageMode === true,
    logRequest: null,
    jobLogImages: {},
    imageStore: new Map(),
    imageStoreBytes: 0,
    logImagesUploaded: 0,
    logJobsDone: 0,
    logJobsScanned: new Set(),
    logJobsTotal: 0,
    logImagesCount: 0,
    logJobsWithImages: 0,
    note,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + TTL_MS,
  };
  store.set(token, session);
  return session;
}

export function getImportSession(token: string): ImportSession | null {
  if (!token) return null;
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  // Sliding expiry — every read (status poll, /data fetch, image byte
  // serve) pushes expiry out by the full TTL, so a session the user is
  // actively viewing never dies under them, while an abandoned one is
  // still collected after the TTL.
  entry.expiresAt = Date.now() + TTL_MS;
  return entry;
}

export function addJobsToSession(
  session: ImportSession,
  jobs: unknown[],
  extra: ImportSessionData
): ImportSession {
  session.data = { ...session.data, ...extra, jobs };
  session.data.discovered_job_count = jobs.length;
  session.logJobsTotal = jobs.length;
  session.status = "collecting_logs";
  session.note = "jobs uploaded";
  session.updatedAt = Date.now();
  return session;
}

/**
 * Merge one batch of scanned jobs. Each item is { uid, images } — images may
 * be empty (job scanned, no log images found) so the progress count stays
 * accurate.
 */
export function addLogBatchToSession(
  session: ImportSession,
  items: Array<{ uid: string; images: LogImageRef[] }>
): ImportSession {
  for (const item of items) {
    if (!item || typeof item.uid !== "string") continue;
    const images = Array.isArray(item.images) ? item.images : [];
    // v3.11: count DISTINCT jobs — a slow-log rescue batch re-sends a uid
    // that already streamed an (empty) batch; the progress numerator must
    // stay <= the total or the UI shows "8/7 jobs scanned".
    if (!session.logJobsScanned.has(item.uid)) {
      session.logJobsScanned.add(item.uid);
      session.logJobsDone += 1;
    }
    if (images.length > 0) {
      const hadRefs = (session.jobLogImages[item.uid] || []).length > 0;
      const merged = session.jobLogImages[item.uid] || [];
      for (const img of images) {
        if (!img || typeof img.fileid !== "string") continue;
        const dup = merged.some((m) => m.fileid === img.fileid);
        if (!dup) {
          merged.push(img);
          session.logImagesCount += 1;
        }
      }
      if (merged.length > 0) {
        session.jobLogImages[item.uid] = merged;
        // v3.11: distinct-jobs-with-images must not double-count a rescue
        // batch that upgrades an empty first batch to refs.
        if (!hadRefs) session.logJobsWithImages += 1;
      }
    }
  }
  // v3.12: bytes can land before their refs — a new ref batch may raise
  // the log-uploaded count (it never exceeds the ref count now).
  session.logImagesUploaded = logImagesUploadedCount(session);
  session.updatedAt = Date.now();
  return session;
}

/** Max base64 chars stored across a session's image store (~288 MB).
 * When exceeded, further uploads are rejected (refs still flow through).
 * v3.13: 192 MB → 288 MB — a full-project capture (46 jobs, 900+ images)
 * lands around 200–250 MB of base64; the old cap silently dropped the
 * LAST-scanned jobs' bytes (hetero/abinit at the end of the pipeline),
 * which then rendered as "no log images" over the HTTPS preview. */
const MAX_IMAGE_STORE_CHARS = 288 * 1024 * 1024;

/** Max base64 chars for a single image (~4 MB binary → ~5.4 MB base64). */
const MAX_SINGLE_IMAGE_CHARS = 6 * 1024 * 1024;

/** v3.12: sniff the real image type from a base64 payload's leading bytes.
 * Real CryoSmart deployments serve /api/log_image/ responses with NO
 * Content-Type — capture scripts then build data:application/octet-stream
 * URLs whose bytes are perfectly good PNGs. The old image/*-only regex
 * rejected every one of them, so a capture could stream 128 image refs
 * and store ZERO bytes (the graph and report then showed no images at
 * all). Sniffing rescues those uploads — including STALE script copies
 * the user still has open in their CryoSmart tab. */
function sniffImageMimeB64(b64: string): string | null {
  try {
    // 32 base64 chars → 24 decoded bytes, enough for every signature.
    const head = Buffer.from(b64.slice(0, 32), "base64");
    if (head.length >= 4) {
      if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
      if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
      if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
      if (head[0] === 0x42 && head[1] === 0x4d) return "image/bmp";
      if (
        head.length >= 12 &&
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
      ) return "image/webp";
      if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) ||
          (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00)) return "image/tiff";
      if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01) return "image/x-icon";
    }
  } catch {
    // fall through — undecodable prefix is simply not a known image
  }
  return null;
}

/** v3.12: uploaded bytes now include map previews + ui tiles (not just log
 * images), so the "M of N images" progress numbers must count ONLY bytes
 * for KNOWN log refs — M can never exceed N regardless of arrival order
 * (bytes can legitimately land before their refs stream in). */
function logImagesUploadedCount(session: ImportSession): number {
  if (session.imageStore.size === 0) return 0;
  const refIds = new Set<string>();
  for (const arr of Object.values(session.jobLogImages)) {
    for (const r of arr || []) {
      if (r && typeof r.fileid === "string" && r.fileid) refIds.add(r.fileid);
    }
  }
  let n = 0;
  for (const id of session.imageStore.keys()) if (refIds.has(id)) n++;
  return n;
}

/**
 * Merge one batch of uploaded image bytes (data URLs from the capture
 * script). Items: `{ fileid, data: "data:image/png;base64,...", name? }`.
 * Duplicates (same fileid) are skipped. Returns the number stored.
 */
export function addImagesToSession(
  session: ImportSession,
  items: Array<{ fileid?: unknown; data?: unknown; name?: unknown }>
): number {
  let stored = 0;
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    const fileid = typeof item.fileid === "string" ? item.fileid : "";
    const data = typeof item.data === "string" ? item.data : "";
    if (!fileid || !data) continue;
    if (session.imageStore.has(fileid)) continue;
    // Accept well-formed base64 data URLs of ANY declared mime — the
    // declaring side may be a typeless server (octet-stream). When the
    // declared mime is not an image, trust the actual BYTES instead and
    // only store when they sniff as a real image format.
    const m = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) continue;
    if (m[2].length > MAX_SINGLE_IMAGE_CHARS) continue;
    if (session.imageStoreBytes + m[2].length > MAX_IMAGE_STORE_CHARS) {
      // Store is full — stop accepting new bytes (refs remain usable).
      break;
    }
    // SECURITY: ALWAYS trust the actual BYTES over the declared mime. The
    // sniffer only recognizes RASTER signatures (png/jpeg/gif/bmp/webp/
    // tiff/ico) — anything else is rejected, so a declared
    // `image/svg+xml` carrying a <script> payload can never be stored and
    // re-served same-origin (stored XSS via history import would make it
    // persistent). Previously any image/* declared mime bypassed sniffing.
    const sniffed = sniffImageMimeB64(m[2]);
    if (!sniffed) continue; // not raster image bytes (text/xml/svg/pdf body) — reject
    const mime = sniffed;
    session.imageStore.set(fileid, {
      mime,
      b64: m[2],
      name: typeof item.name === "string" ? item.name : undefined,
    });
    session.imageStoreBytes += m[2].length;
    stored += 1;
  }
  if (stored > 0) {
    session.logImagesUploaded = logImagesUploadedCount(session);
    session.updatedAt = Date.now();
  }
  return stored;
}

/**
 * v3.5: record the traced lineage's job list — the capture script waits
 * for this and then fetches log images for ONLY these jobs. Re-traces
 * UNION into the existing list (jobs already scanned are skipped
 * client-side); `revision` bumps so pollers see the change.
 */
export function setLogRequest(session: ImportSession, jobs: unknown): ImportSession {
  const requested = Array.isArray(jobs)
    ? Array.from(
        new Set(
          jobs.filter((j): j is string => typeof j === "string" && j.length > 0)
        )
      )
    : [];
  if (requested.length === 0) return session;
  // Keep only jobs that exist in the captured set (belt-and-braces: the
  // UI traces from the session's own jobs, but a stale/reloaded tab could
  // post uids from a different dataset).
  let effective = requested;
  if (Array.isArray(session.data.jobs) && session.data.jobs.length > 0) {
    const captured = new Set(
      (session.data.jobs as Array<{ uid?: unknown }>)
        .map((j) => (j && typeof j.uid === "string" ? j.uid : null))
        .filter((u): u is string => !!u)
    );
    effective = requested.filter((u) => captured.has(u));
    if (effective.length === 0) return session;
  }
  const existing = session.logRequest ? session.logRequest.jobs : [];
  const union = Array.from(new Set([...existing, ...effective]));
  session.logRequest = {
    jobs: union,
    revision: (session.logRequest?.revision || 0) + 1,
    requestedAt: Date.now(),
  };
  // In lineage mode the progress denominator is the requested lineage
  // size (every scanned job comes from the request), not the whole project.
  if (session.lineageMode) session.logJobsTotal = union.length;
  if (session.status === "awaiting_jobs") session.status = "collecting_logs";
  session.updatedAt = Date.now();
  return session;
}

/** Serve a stored image as a Response (or null when not found). */
export function sessionImageResponse(
  session: ImportSession,
  fileid: string
): Response | null {
  const img = session.imageStore.get(fileid);
  if (!img) return null;
  const bytes = Buffer.from(img.b64, "base64");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(bytes.byteLength),
      // The session TTL is 45 min — cache in the browser for comfortably
      // less than that so an expired+reused fileid never sticks around.
      "Cache-Control": "public, max-age=300",
      // Defense in depth for served image bytes: if anything ever slips
      // past the raster sniffing, these headers stop the response from
      // being executed as an active document (script/iframe) in the app
      // origin. Harmless for <img> usage.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      ...IMPORT_SESSION_CORS,
    },
  });
}

export function completeImportSession(session: ImportSession): ImportSession {
  session.status = "complete";
  session.note = "capture complete";
  session.updatedAt = Date.now();
  return session;
}

export function setSessionNote(session: ImportSession, note: string): void {
  session.note = note;
  session.updatedAt = Date.now();
}

/** Public progress snapshot for the status endpoint. */
export function sessionProgress(session: ImportSession) {
  return {
    ok: true,
    token: session.token,
    status: session.status,
    has_data: Array.isArray(session.data.jobs) && session.data.jobs.length > 0,
    project_uid: session.data.project_uid || null,
    captured_at: session.data.captured_at || null,
    total_jobs: session.data.jobs?.length ?? 0,
    log_jobs_total: session.logJobsTotal,
    log_jobs_done: session.logJobsDone,
    log_images_count: session.logImagesCount,
    log_images_uploaded: session.logImagesUploaded,
    log_jobs_with_images: session.logJobsWithImages,
    end_job_uid: session.endJobUid,
    lineage_mode: session.lineageMode,
    log_request: session.logRequest
      ? {
          jobs: session.logRequest.jobs,
          revision: session.logRequest.revision,
          requested_at: session.logRequest.requestedAt,
        }
      : null,
    note: session.note,
    updated_at: session.updatedAt,
    expires_in: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
  };
}

/** CORS headers shared by every /api/cryosmart/import/session* route. */
export const IMPORT_SESSION_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cryosmart-Capture",
  "Access-Control-Max-Age": "86400",
};
