/**
 * Disk-backed CAPTURE HISTORY for the Smart Capture flow.
 *
 * Problem it solves: staged import sessions are IN-MEMORY with a 45-min
 * sliding TTL (`import-session-store.ts`) — once a session expires (or the
 * dev server restarts), every captured job, log image byte and map URL is
 * gone and the user must re-run the whole capture script on CryoSmart.
 *
 * This store snapshots a completed capture to disk instead:
 *
 *   capture-history/<id>/meta.json     light summary for list views
 *   capture-history/<id>/capture.json  full data (jobs, log-image refs,
 *                                      image index, CryoSmart session info)
 *   capture-history/<id>/images/<sha1>.<ext>   binary image bytes
 *
 * `meta.json` is written LAST — its presence marks the entry as complete
 * (a partially-written entry is invisible to list/restore and gets cleaned
 * up by the next save with the same id).
 *
 * Two extra capabilities ride on the same store:
 *   • JSON metadata EXPORT (`exportCaptureJson`) — a portable
 *     `cryosmart-capture/v1` document with absolute CryoSmart URLs for
 *     every image + map, optionally with image bytes embedded as base64
 *     (fully self-contained) and optionally with the captured CryoSmart
 *     credentials (for authenticated re-downloads). Other projects /
 *     instances can read it; `importCaptureJson` reads it back into a
 *     fresh history entry so the graph + report render offline.
 *   • Can the JSON alone re-download everything? Images whose bytes were
 *     uploaded by the capture script exist ONLY in this app (the intranet
 *     browser was the only party that could fetch them) — but their
 *     CryoSmart URL is still included, so any machine WITH intranet access
 *     can re-download them (with credentials when the server requires
 *     login). `embed=1` removes even that requirement for images. Maps are
 *     multi-MB/GB binaries and are NEVER embedded — they are always
 *     re-downloadable via their absolute URLs from the intranet.
 */

import { createHash, randomBytes } from "crypto";
import { promises as fsp } from "fs";
import * as path from "path";
import type { ImportSession } from "./import-session-store";
import { MAP_SUFFIXES } from "./constants";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One persisted image file inside an entry's `images/` dir. */
export interface HistoryImageFile {
  fileid: string;
  /** Safe on-disk file name (sha1 of the fileid + extension). */
  file: string;
  mime: string;
  name?: string;
  /** Binary byte size. */
  size: number;
}

/** Light summary persisted as `meta.json` (list views). */
export interface HistoryMeta {
  id: string;
  label: string;
  /** "session" = snapshotted from a live import session; "import" = created from an exported JSON. */
  origin: "session" | "import";
  project_uid: string | null;
  experiment_uid: string | null;
  source_url: string | null;
  captured_at: string | null;
  created_at: number;
  end_job_uid: string | null;
  lineage_mode: boolean;
  cryosmart_origin: string | null;
  counts: {
    jobs: number;
    log_images: number;
    images: number;
    maps: number;
  };
  /** Approximate on-disk size (bytes). */
  bytes: number;
}

/** Full persisted capture (`capture.json`). */
export interface HistoryCapture extends HistoryMeta {
  saved_at: number;
  cryosmart_auth: string | null;
  cryosmart_cookie: string | null;
  jobs: unknown[];
  /** { [jobUid]: [{ fileid, name, text, flags, src?, data? }] } */
  job_log_images: Record<string, unknown[]>;
  image_files: HistoryImageFile[];
}

/** One downloadable map derived from the jobs' output_result_groups. */
export interface HistoryMapEntry {
  job_uid: string;
  group: string;
  result_name: string;
  url: string;
}

/** Options for the portable JSON export. */
export interface ExportOptions {
  /** Embed every stored image as a base64 `data:` URL (self-contained). */
  embedImages?: boolean;
  /** Include the captured CryoSmart auth/cookie (for authenticated re-downloads). */
  includeCredentials?: boolean;
}

/** The portable `cryosmart-capture/v1` document. */
export interface CaptureJsonExport {
  format: "cryosmart-capture/v1";
  app: string;
  exported_at: string;
  capture: {
    id: string;
    project_uid: string | null;
    experiment_uid: string | null;
    source_url: string | null;
    captured_at: string | null;
    end_job_uid: string | null;
    lineage_mode: boolean;
    cryosmart_origin: string | null;
    /** Present only when exported with credentials. */
    credentials?: { auth?: string | null; cookie?: string | null };
  };
  counts: HistoryMeta["counts"];
  url_templates: {
    log_image: string;
    download_result_file: string;
    note: string;
  };
  /** Raw CryoSmart job metadata (unmodified). */
  jobs: unknown[];
  /** Log-image refs keyed by job uid. */
  job_log_images: Record<string, unknown[]>;
  /** Every stored image with its absolute CryoSmart URL (+ bytes when embedded). */
  images: Array<{
    fileid: string;
    name?: string;
    mime: string;
    size: number;
    url: string;
    data?: string;
  }>;
  /** Every downloadable map across all jobs, with its absolute URL. */
  maps: HistoryMapEntry[];
}

/* ------------------------------------------------------------------ */
/* Storage plumbing                                                    */
/* ------------------------------------------------------------------ */

/** Keep the most recent N captures on disk (newest-kept by created_at —
 * age-based retention; restoring an entry does NOT bump its recency). */
const MAX_HISTORY_ENTRIES = 40;

const globalRef = globalThis as unknown as {
  __cryoHistoryInFlight?: Set<string>;
};
if (!globalRef.__cryoHistoryInFlight) {
  globalRef.__cryoHistoryInFlight = new Set<string>();
}
const inFlight: Set<string> = globalRef.__cryoHistoryInFlight;

function historyRoot(): string {
  return path.join(process.cwd(), "capture-history");
}

function entryDir(id: string): string {
  return path.join(historyRoot(), id);
}

function imagesDir(id: string): string {
  return path.join(entryDir(id), "images");
}

/** Entry ids are filesystem-safe by construction (session tokens or
 *  generated `imp-*` ids); validate defensively before any path join. */
function isValidId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id) && !id.includes("..");
}

function imageFileName(fileid: string, mime: string): string {
  const hash = createHash("sha1").update(fileid).digest("hex").slice(0, 20);
  const ext =
    mime === "image/png" ? "png" :
    mime === "image/jpeg" ? "jpg" :
    mime === "image/gif" ? "gif" :
    mime === "image/webp" ? "webp" :
    mime === "image/bmp" ? "bmp" :
    mime === "image/tiff" ? "tif" :
    mime === "image/x-icon" ? "ico" : "img";
  return `${hash}.${ext}`;
}

/** Default human label for a capture (`P259 · 2025-01-24 14:32`). */
function defaultLabel(projectUid: string | null | undefined, capturedAt: string | null | undefined): string {
  let date = "";
  if (capturedAt) {
    const d = new Date(capturedAt);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      date = ` · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return `${projectUid || "capture"}${date}`;
}

/** Total log-image refs across the job_log_images map. */
function countLogImages(jobLogImages: Record<string, unknown[]> | null | undefined): number {
  let n = 0;
  for (const arr of Object.values(jobLogImages || {})) {
    if (Array.isArray(arr)) n += arr.length;
  }
  return n;
}

/**
 * Derive every downloadable map (volume.map / *.map / *.mrc / volume.blob
 * "map" results) from raw job metadata — mirrors the URL conventions used
 * by `lineage.ts` (`download_result_file/<project>/<job>.<group>.<result>`).
 */
export function collectMapEntries(
  jobs: unknown[],
  cryosmartOrigin: string | null | undefined
): HistoryMapEntry[] {
  const origin = String(cryosmartOrigin || "").replace(/\/$/, "");
  if (!origin) return [];
  const out: HistoryMapEntry[] = [];
  for (const j of jobs || []) {
    const job = j as {
      uid?: unknown; project_uid?: unknown; output_result_groups?: unknown;
    } | null;
    if (!job || typeof job !== "object") continue;
    const uid = String(job.uid || "");
    const project = String(job.project_uid || "");
    if (!uid || !project) continue;
    const groups = job.output_result_groups;
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const group = g as { name?: unknown; contains?: unknown } | null;
      if (!group || typeof group !== "object" || !group.name) continue;
      const groupName = String(group.name);
      const contains = Array.isArray(group.contains) ? group.contains : [];
      for (const c of contains) {
        const item = c as { name?: unknown; type?: unknown } | null;
        if (!item || typeof item !== "object") continue;
        const name = String(item.name || "");
        if (!name) continue;
        const type = String(item.type || "");
        // Everything downloadable as a volume/map binary: explicit
        // .map/.mrc result names, volume.blob results (map, map_sharp,
        // half_map_A, half_map_B, …), and the classic volume.map path.
        const isMap =
          /\.mrc$/i.test(name) ||
          /\.map$/i.test(name) ||
          type === "volume.blob" ||
          MAP_SUFFIXES.includes(`${groupName}.${name}`);
        if (!isMap) continue;
        out.push({
          job_uid: uid,
          group: groupName,
          result_name: name,
          url: `${origin}/api/log_image/download_result_file/${project}/${uid}.${groupName}.${name}`,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Save (from a live import session)                                   */
/* ------------------------------------------------------------------ */

/**
 * Snapshot a (typically completed) staged import session to disk. Safe to
 * call repeatedly — an existing entry with the same id is fully rewritten
 * (rm -rf then fresh write). Returns the stored meta, or null when nothing
 * could be persisted (e.g. zero jobs).
 */
export async function saveSessionToHistory(
  session: ImportSession
): Promise<HistoryMeta | null> {
  const id = session.token;
  if (!isValidId(id)) return null;
  const jobs = Array.isArray(session.data.jobs) ? session.data.jobs : [];
  if (jobs.length === 0) return null;

  // Serialize same-id saves (manual "Save" racing the auto-save on complete).
  while (inFlight.has(id)) {
    await new Promise((r) => setTimeout(r, 150));
  }
  inFlight.add(id);
  try {
    const dir = entryDir(id);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(imagesDir(id), { recursive: true });

    // 1. Binary image files (decode the store's base64 payloads).
    const imageFiles: HistoryImageFile[] = [];
    let bytes = 0;
    const imageEntries = Array.from(session.imageStore.entries());
    const CHUNK = 12;
    for (let i = 0; i < imageEntries.length; i += CHUNK) {
      const slice = imageEntries.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async ([fileid, img]) => {
          try {
            const buf = Buffer.from(img.b64, "base64");
            if (buf.byteLength === 0) return;
            const mime = img.mime || "image/png";
            const file = imageFileName(fileid, mime);
            await fsp.writeFile(path.join(imagesDir(id), file), buf);
            bytes += buf.byteLength;
            imageFiles.push({
              fileid,
              file,
              mime,
              name: img.name,
              size: buf.byteLength,
            });
          } catch {
            // one bad image must not kill the snapshot
          }
        })
      );
    }

    const capturedAt =
      session.data.captured_at || new Date(session.createdAt).toISOString();
    const projectUid =
      typeof session.data.project_uid === "string" ? session.data.project_uid : null;
    const origin =
      typeof session.data.cryosmart_origin === "string"
        ? session.data.cryosmart_origin
        : null;

    const counts = {
      jobs: jobs.length,
      log_images: countLogImages(session.jobLogImages),
      images: imageFiles.length,
      maps: collectMapEntries(jobs, origin).length,
    };

    const meta: HistoryMeta = {
      id,
      label: defaultLabel(projectUid, capturedAt),
      origin: "session",
      project_uid: projectUid,
      experiment_uid:
        typeof session.data.experiment_uid === "string"
          ? session.data.experiment_uid
          : null,
      source_url:
        typeof session.data.source_url === "string" ? session.data.source_url : null,
      captured_at: capturedAt,
      created_at: session.createdAt || Date.now(),
      end_job_uid: session.endJobUid,
      lineage_mode: session.lineageMode,
      cryosmart_origin: origin,
      counts,
      bytes,
    };

    // 2. Full capture (jobs + refs + image index + session info).
    const capture: HistoryCapture = {
      ...meta,
      saved_at: Date.now(),
      cryosmart_auth:
        typeof session.data.cryosmart_auth === "string"
          ? session.data.cryosmart_auth
          : null,
      cryosmart_cookie:
        typeof session.data.cryosmart_cookie === "string"
          ? session.data.cryosmart_cookie
          : null,
      jobs,
      job_log_images: session.jobLogImages,
      image_files: imageFiles,
    };
    await fsp.writeFile(
      path.join(dir, "capture.json"),
      JSON.stringify(capture),
      "utf8"
    );

    // 3. meta.json LAST — its presence marks the entry as complete.
    await fsp.writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify(meta),
      "utf8"
    );

    await evictOldEntries();
    return meta;
  } finally {
    inFlight.delete(id);
  }
}

/** Retention: keep only the newest MAX_HISTORY_ENTRIES entries. */
async function evictOldEntries(): Promise<void> {
  try {
    const entries = await listHistoryEntries();
    if (entries.length <= MAX_HISTORY_ENTRIES) return;
    const doomed = entries
      .slice()
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, entries.length - MAX_HISTORY_ENTRIES);
    for (const e of doomed) {
      if (inFlight.has(e.id)) continue;
      await fsp.rm(entryDir(e.id), { recursive: true, force: true });
    }
  } catch {
    // best-effort housekeeping
  }
}

/* ------------------------------------------------------------------ */
/* Read / delete                                                       */
/* ------------------------------------------------------------------ */

/** List all captures, newest first. Reads only the tiny meta.json files. */
export async function listHistoryEntries(): Promise<HistoryMeta[]> {
  const root = historyRoot();
  let ids: string[] = [];
  try {
    ids = (await fsp.readdir(root)).filter(isValidId);
  } catch {
    return []; // no history yet (or unreadable) — not an error
  }
  const metas: HistoryMeta[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const raw = await fsp.readFile(path.join(entryDir(id), "meta.json"), "utf8");
        const meta = JSON.parse(raw) as HistoryMeta;
        if (meta && meta.id === id) metas.push(meta);
      } catch {
        // partial entry (no meta.json yet) — invisible
      }
    })
  );
  metas.sort((a, b) => b.created_at - a.created_at);
  return metas;
}

/** Read one capture's full data (or null when absent/incomplete). */
export async function getHistoryCapture(id: string): Promise<HistoryCapture | null> {
  if (!isValidId(id)) return null;
  try {
    const raw = await fsp.readFile(path.join(entryDir(id), "capture.json"), "utf8");
    const capture = JSON.parse(raw) as HistoryCapture;
    if (!capture || !Array.isArray(capture.jobs)) return null;
    return capture;
  } catch {
    return null;
  }
}

/** Delete one capture entry. Returns true when something was removed. */
export async function deleteHistoryEntry(id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  if (inFlight.has(id)) return false;
  try {
    await fsp.access(entryDir(id));
  } catch {
    return false;
  }
  await fsp.rm(entryDir(id), { recursive: true, force: true });
  return true;
}

/** Serve one stored image as a Response (or null when not found). */
export async function historyImageResponse(
  capture: HistoryCapture,
  fileid: string
): Promise<Response | null> {
  const idx = (capture.image_files || []).find((f) => f.fileid === fileid);
  if (!idx) return null;
  try {
    const buf = await fsp.readFile(path.join(imagesDir(capture.id), idx.file));
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": idx.mime || "image/png",
        "Content-Length": String(buf.byteLength),
        // History images are immutable — cache aggressively.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Defense in depth for served image bytes (see sessionImageResponse).
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Export (portable JSON)                                              */
/* ------------------------------------------------------------------ */

/** Build the portable `cryosmart-capture/v1` document for one entry. */
export async function exportCaptureJson(
  capture: HistoryCapture,
  opts?: ExportOptions
): Promise<CaptureJsonExport> {
  const origin = String(capture.cryosmart_origin || "").replace(/\/$/, "");
  const originOrPlaceholder = origin || "<cryosmart-origin>";

  // images[] — every stored image, with its absolute CryoSmart URL, and
  // (optionally) its bytes as a data: URL.
  const images: CaptureJsonExport["images"] = [];
  for (const f of capture.image_files || []) {
    const entry: CaptureJsonExport["images"][number] = {
      fileid: f.fileid,
      name: f.name,
      mime: f.mime,
      size: f.size,
      url: `${originOrPlaceholder}/api/log_image/${f.fileid}`,
    };
    if (opts?.embedImages) {
      try {
        const buf = await fsp.readFile(path.join(imagesDir(capture.id), f.file));
        entry.data = `data:${f.mime};base64,${buf.toString("base64")}`;
      } catch {
        // file vanished — keep the link-only entry
      }
    }
    images.push(entry);
  }

  const captureSection: CaptureJsonExport["capture"] = {
    id: capture.id,
    project_uid: capture.project_uid,
    experiment_uid: capture.experiment_uid,
    source_url: capture.source_url,
    captured_at: capture.captured_at,
    end_job_uid: capture.end_job_uid,
    lineage_mode: capture.lineage_mode,
    cryosmart_origin: origin || null,
  };
  if (opts?.includeCredentials) {
    captureSection.credentials = {
      auth: capture.cryosmart_auth || undefined,
      cookie: capture.cryosmart_cookie || undefined,
    };
  }

  return {
    format: "cryosmart-capture/v1",
    app: "cryosmart-lineage-tracer-web",
    exported_at: new Date().toISOString(),
    capture: captureSection,
    counts: capture.counts,
    url_templates: {
      log_image: `${originOrPlaceholder}/api/log_image/{fileid}`,
      download_result_file:
        `${originOrPlaceholder}/api/log_image/download_result_file/` +
        `{project_uid}/{job_uid}.{group}.{result_name}`,
      note:
        "Absolute intranet URLs. A machine with network access to the CryoSmart " +
        "server can re-download every image and map from this file alone " +
        "(pass capture.credentials when the server requires login). Images with " +
        "an embedded `data` field are fully self-contained; maps are large " +
        "binaries and are never embedded — always fetched via their URL.",
    },
    jobs: capture.jobs,
    job_log_images: capture.job_log_images || {},
    images,
    maps: collectMapEntries(capture.jobs, origin || null),
  };
}

/** Suggested download filename for an export. */
export function exportFilename(capture: HistoryCapture): string {
  const project = (capture.project_uid || "capture").replace(/[^A-Za-z0-9_-]+/g, "_");
  const d = capture.captured_at ? new Date(capture.captured_at) : new Date(capture.created_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = Number.isNaN(d.getTime())
    ? "unknown"
    : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `CryoSmart_capture_${project}_${stamp}.json`;
}

/* ------------------------------------------------------------------ */
/* Import (from a portable JSON or a legacy jobs-only JSON)            */
/* ------------------------------------------------------------------ */

/** Sniff the real image mime from base64 payload bytes (mirrors the
 *  import-session-store logic — CryoSmart often serves typeless bytes). */
function sniffImageMimeB64(b64: string): string | null {
  try {
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
      // TIFF + ICO: match the live session store's sniffer so imports of
      // exports taken from live sessions accept every format it accepts.
      if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) ||
          (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00)) return "image/tiff";
      if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01) return "image/x-icon";
    }
  } catch {
    // fall through
  }
  return null;
}

export interface ImportResult {
  meta: HistoryMeta;
  /** True when the payload carried embedded image bytes (vs links only). */
  embeddedImages: number;
}

/**
 * Create a new history entry from a portable capture JSON (or a legacy
 * `{ jobs: [...] }` project metadata JSON). Returns the created entry.
 */
export async function importCaptureJson(
  payload: unknown
): Promise<ImportResult | null> {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // ── Portable capture format ─────────────────────────────────────
  const isPortable =
    p.format === "cryosmart-capture/v1" && Array.isArray(p.jobs);
  // ── Legacy: bare { jobs: [...] } project metadata ──────────────
  const isLegacy = !isPortable && Array.isArray(p.jobs);

  if (!isPortable && !isLegacy) return null;

  const captureSection = (p.capture || {}) as Record<string, unknown>;
  const jobs = (p.jobs as unknown[]) || [];
  if (jobs.length === 0) return null;

  const id = `imp-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const dir = entryDir(id);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(imagesDir(id), { recursive: true });
  // A failed import (fs error, unwritable disk, …) must not leave an orphan
  // dir behind: an entry without meta.json is INVISIBLE to listHistoryEntries
  // and never evicted by the LRU — a silent disk leak. Rewrite the tail of
  // this function as an async IIFE so every failure path cleans up the dir.
  try {
  return await (async (): Promise<ImportResult> => {

  // 1. Embedded image bytes → binary files.
  const imageFiles: HistoryImageFile[] = [];
  let bytes = 0;
  let embedded = 0;
  if (isPortable && Array.isArray(p.images)) {
    for (const rawImg of p.images as Array<Record<string, unknown>>) {
      const fileid = typeof rawImg.fileid === "string" ? rawImg.fileid : "";
      const data = typeof rawImg.data === "string" ? rawImg.data : "";
      if (!fileid || !data) continue;
      const m = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
      if (!m) continue;
      // SECURITY: ALWAYS trust the actual BYTES over the declared mime —
      // same rule as the live session store: only RASTER signatures are
      // accepted, so an `image/svg+xml` with a <script> payload can never
      // be persisted to disk and re-served (stored XSS).
      const sniffed = sniffImageMimeB64(m[2]);
      if (!sniffed) continue;
      const mime = sniffed;
      try {
        const buf = Buffer.from(m[2], "base64");
        if (buf.byteLength === 0) continue;
        const file = imageFileName(fileid, mime);
        await fsp.writeFile(path.join(imagesDir(id), file), buf);
        bytes += buf.byteLength;
        embedded += 1;
        imageFiles.push({
          fileid,
          file,
          mime,
          name: typeof rawImg.name === "string" ? rawImg.name : undefined,
          size: buf.byteLength,
        });
      } catch {
        // skip this image
      }
    }
  }

  const projectUid =
    typeof captureSection.project_uid === "string"
      ? captureSection.project_uid
      : typeof p.project_uid === "string"
        ? (p.project_uid as string)
        : null;
  const capturedAt =
    typeof captureSection.captured_at === "string"
      ? captureSection.captured_at
      : typeof p.captured_at === "string"
        ? (p.captured_at as string)
        : null;
  const origin =
    typeof captureSection.cryosmart_origin === "string"
      ? captureSection.cryosmart_origin
      : null;
  const jobLogImages =
    p.job_log_images && typeof p.job_log_images === "object"
      ? (p.job_log_images as Record<string, unknown[]>)
      : {};

  const counts = {
    jobs: jobs.length,
    log_images: countLogImages(jobLogImages),
    images: imageFiles.length,
    maps: collectMapEntries(jobs, origin).length,
  };

  const credentials =
    (captureSection.credentials || {}) as Record<string, unknown>;

  const meta: HistoryMeta = {
    id,
    label: defaultLabel(projectUid, capturedAt),
    origin: "import",
    project_uid: projectUid,
    experiment_uid:
      typeof captureSection.experiment_uid === "string"
        ? captureSection.experiment_uid
        : null,
    source_url:
      typeof captureSection.source_url === "string"
        ? captureSection.source_url
        : null,
    captured_at: capturedAt,
    created_at: Date.now(),
    end_job_uid:
      typeof captureSection.end_job_uid === "string"
        ? captureSection.end_job_uid
        : null,
    lineage_mode: captureSection.lineage_mode === true,
    cryosmart_origin: origin,
    counts,
    bytes,
  };

  const capture: HistoryCapture = {
    ...meta,
    saved_at: Date.now(),
    cryosmart_auth:
      typeof credentials.auth === "string" ? credentials.auth : null,
    cryosmart_cookie:
      typeof credentials.cookie === "string" ? credentials.cookie : null,
    jobs,
    job_log_images: jobLogImages,
    image_files: imageFiles,
  };

  await fsp.writeFile(
    path.join(dir, "capture.json"),
    JSON.stringify(capture),
    "utf8"
  );
  await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");

  await evictOldEntries();
  return { meta, embeddedImages: embedded };
  })();
  } catch (err) {
    // Roll back the half-written entry so no orphan dir survives.
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
