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
  /** Jobs scanned for logs so far (progress numerator). */
  logJobsDone: number;
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
  const entropy = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `s${seq}-${entropy}`;
}

export function createImportSession(
  data: ImportSessionData,
  note = "session created"
): ImportSession {
  gc();
  const token = newToken();
  const now = Date.now();
  const session: ImportSession = {
    token,
    status: "awaiting_jobs",
    data: { ...data, captured_at: data.captured_at || new Date().toISOString() },
    jobLogImages: {},
    imageStore: new Map(),
    imageStoreBytes: 0,
    logImagesUploaded: 0,
    logJobsDone: 0,
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
    session.logJobsDone += 1;
    if (images.length > 0) {
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
        session.logJobsWithImages += 1;
      }
    }
  }
  session.updatedAt = Date.now();
  return session;
}

/** Max base64 chars stored across a session's image store (~192 MB).
 * When exceeded, further uploads are rejected (refs still flow through). */
const MAX_IMAGE_STORE_CHARS = 192 * 1024 * 1024;

/** Max base64 chars for a single image (~4 MB binary → ~5.4 MB base64). */
const MAX_SINGLE_IMAGE_CHARS = 6 * 1024 * 1024;

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
    // Accept only well-formed image data URLs.
    const m = data.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) continue;
    if (m[2].length > MAX_SINGLE_IMAGE_CHARS) continue;
    if (session.imageStoreBytes + m[2].length > MAX_IMAGE_STORE_CHARS) {
      // Store is full — stop accepting new bytes (refs remain usable).
      break;
    }
    session.imageStore.set(fileid, {
      mime: m[1].toLowerCase(),
      b64: m[2],
      name: typeof item.name === "string" ? item.name : undefined,
    });
    session.imageStoreBytes += m[2].length;
    session.logImagesUploaded += 1;
    stored += 1;
  }
  if (stored > 0) session.updatedAt = Date.now();
  return stored;
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
      // The session TTL is 15 min — cache in the browser for comfortably
      // less than that so an expired+reused fileid never sticks around.
      "Cache-Control": "public, max-age=300",
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
