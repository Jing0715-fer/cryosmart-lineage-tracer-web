"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import type { LoadedMetadata } from "@/app/components/cryosmart/data-source-card";
import type { CryoSmartSession } from "@/lib/cryosmart/proxy-client";

/**
 * Shape shared by the LIVE staged-session /data endpoint and the RESTORED
 * capture-history /api/cryosmart/history/<id> endpoint — restoring a
 * historical capture reuses the exact same merge pipeline.
 */
export interface PendingData {
  ok: boolean;
  token: string;
  captured_at: string | null;
  data: {
    project_uid?: string;
    experiment_uid?: string;
    jobs?: unknown[];
    raw?: unknown;
    source_url?: string;
    captured_at?: string;
    discovered_job_count?: number;
    // CryoSmart session info
    cryosmart_origin?: string;
    cryosmart_auth?: string;
    cryosmart_cookie?: string;
    // Log images force-loaded from the SPA's lazy jobLogs state
    job_log_images?: Record<string, Array<{ fileid?: string; name?: string; src?: string; data?: string }>>;
    // Fileids whose BYTES were uploaded to the session's image store —
    // these get a same-origin /image/<fileid> src that works over HTTPS.
    uploaded_image_ids?: string[];
    // v3.15: fileids WITHOUT bytes but WITH an absolute CryoSmart URL
    // (links-only imports). Same rewrite as uploaded ids — the history
    // image endpoint proxy-fetches the URL when disk bytes are missing.
    remote_image_ids?: string[];
  };
}

/** Progress snapshot from GET /api/cryosmart/import/session/<token> */
interface SessionStatus {
  ok: boolean;
  token: string;
  status: "awaiting_jobs" | "collecting_logs" | "complete";
  has_data: boolean;
  project_uid: string | null;
  total_jobs: number;
  log_jobs_total: number;
  log_jobs_done: number;
  log_images_count: number;
  /** Log images whose BYTES were uploaded (renderable same-origin). */
  log_images_uploaded: number;
  log_jobs_with_images: number;
  note: string;
  /** v3.29: the capture script's current sub-step kind ("prepare",
   *  "calibrating", "scan", "rescue", "grace", "rest", "drain") —
   *  reported via POST .../phase during the stretches where the aggregate
   *  counters cannot move (loader calibration, per-job slow waits). */
  script_phase?: string;
  /** v3.29: human detail for script_phase ("scanning 13/72 · J13
   *  (class_3d)"). */
  phase_detail?: string;
  /** v3.29: epoch-ms of the last phase POST — the strip renders a
   *  liveness age ("3s ago") from it. */
  phase_at?: number;
  /** v3.5: job whose CryoSmart page the script ran on (auto-trace anchor). */
  end_job_uid?: string | null;
  /** v3.5: log images are fetched only for the requested lineage jobs. */
  lineage_mode?: boolean;
  /** v3.5: lineage job list requested by the UI's Trace action. */
  log_request?: { jobs: string[]; revision: number; requested_at?: number } | null;
  /** Session mutation clock — bumped by the script's ?hb=1 heartbeat. */
  updated_at?: number;
}

export interface ImportProgress {
  /** Jobs scanned for log images so far (staged flow only). */
  done: number;
  /** Jobs the capture script plans to scan. */
  total: number;
  /** Log image refs received so far. */
  images: number;
  /** Log image bytes uploaded so far (same-origin renderable). */
  uploaded: number;
  /** v3.29: the script's current sub-step kind ("calibrating", "scan",
   *  "rescue", "grace", "rest", "drain") — null until the script reports
   *  its first phase. */
  phase?: string | null;
  /** v3.29: human detail ("scanning 13/72 · J13 (class_3d)"). */
  phaseDetail?: string | null;
  /** v3.29: epoch-ms of the last phase POST (liveness age). */
  phaseAt?: number | null;
}

/**
 * v3.25: live feedback for the /data APPLY phase. A big capture (590 jobs,
 * ~7 MB of JSON) spends seconds in download → JSON.parse → merge →
 * LineageGraph re-render — all previously invisible, which reads as "the
 * popup page is dead until I refresh". While an apply is running the
 * poller publishes this snapshot so DataSourceCard and the capture
 * progress strip can show "Receiving 590 jobs (7.0 MB) · 3.2s…" plus a
 * real "4.3 MB / 7.0 MB · 1.2 MB/s" download bar (the /data endpoint now
 * streams its body with an exact Content-Length for exactly this).
 */
export interface ApplyProgress {
  /** Jobs in the snapshot being applied — the session's total_jobs hint
   *  while downloading, the ACTUAL job count once parsing begins. */
  jobs: number | null;
  /** Bytes received so far (== total once the download finished). */
  received: number;
  /** Total payload bytes from Content-Length (null when unknown). */
  total: number | null;
  /** download = body still streaming; parse = JSON.parse + graph render. */
  phase: "download" | "parse";
  /** Date.now() when this apply's fetch started (elapsed-timer anchor). */
  startedAt: number;
}

export interface ImportState {
  status: "idle" | "polling" | "loaded" | "error" | "expired" | "not-found";
  message: string;
  token: string | null;
  startedAt: number | null;
  /** Live log-collection progress (staged flow; null until jobs are in). */
  progress: ImportProgress | null;
  /** v3.5: job whose CryoSmart page the capture script ran on — the app
   * auto-fills Start Job with it and auto-traces when jobs land, so the
   * manual Trace Lineage setup can be skipped entirely. Sticky (survives
   * the polling → loaded transition so the suggested Start Job doesn't
   * flip after the capture completes). */
  endJobUid: string | null;
  /** v3.16.1: TRUE when the capture counters (jobs scanned / image refs /
   * uploaded bytes) have been FROZEN for a while with the scan finished
   * but the byte upload still incomplete — the user's "stuck at 263/268"
   * case. The script's ?hb=1 heartbeat keeps the session alive (so the
   * 10-min dead-tab stall timeout never fires) while nothing progresses:
   * a hung /images POST, a frozen capture tab, or a script that already
   * exited after its /complete POST failed 3×. The strip surfaces this
   * with an amber badge and emphasizes the Stop button. */
  uploadStalled?: boolean;
  /** v3.26: total job count when the "Fetch all jobs' log images" action is
   * available (live lineage-scoped session whose log_request does not yet
   * cover every captured job). Null otherwise. Clicking the strip button
   * POSTs {all:true} to request-logs; the capture script picks the extras
   * up via its re-trace grace window / byte-drain poll and scans them. */
  fetchAllJobs?: number | null;
  /** v3.26: a Fetch-all request was sent for THIS session — the strip
   * button stays disabled ("Requested ✓") until the next poll tick sees
   * the unioned request (and drops the button). */
  fetchAllRequested?: boolean;
}

interface UseImportedOpts {
  onLoaded?: (loaded: LoadedMetadata) => void;
}

function buildSessionFromPending(data: PendingData["data"]): CryoSmartSession | null {
  if (!data?.cryosmart_origin) return null;
  return {
    baseUrl: data.cryosmart_origin,
    auth: data.cryosmart_auth || undefined,
    cookie: data.cryosmart_cookie || undefined,
  };
}

/**
 * Merge captured log images (`job_log_images`, keyed by job uid) onto each
 * job object as `log_images: [{ fileid, name, src? }]`. Refs whose bytes
 * were uploaded to the session image store get a `src` pointing at the
 * same-origin session-image endpoint (works over HTTPS; the direct
 * CryoSmart URL is mixed-content-blocked there). Refs carrying inline
 * `data:` URLs (legacy console snippet) keep them as `src`. The lineage
 * builder turns each ref into an ImageAsset. Handles both `{ jobs: [...] }`
 * and bare-array raw payloads. No-op when the capture didn't include log
 * images.
 *
 * Additionally, ANY other fileid-carrying field on the job
 * (`output_group_images`, `ui_tile_images`, `image_logs[].imgfiles`)
 * whose bytes were uploaded is rewritten to the same session-image URL —
 * those fields flow into node.images / map previews / representative
 * micrographs, and without the rewrite they'd stay direct intranet URLs
 * that mixed-content-fail on the HTTPS preview.
 */
function mergeLogImagesIntoRaw(
  raw: unknown,
  jobLogImages: PendingData["data"]["job_log_images"],
  uploadedImageIds?: string[],
  imageBase?: string | null,
  linkedImageIds?: string[]
): unknown {
  if (!jobLogImages) return raw;
  // v3.15: the rewrite set is the UNION of byte-uploaded ids and
  // remote-linked ids — for history restores the imageBase endpoint serves
  // both (disk bytes first, then an on-demand proxy fetch of the stored
  // absolute URL). Live staged sessions pass no linked ids (all images are
  // browser-uploaded bytes).
  const known = new Set([...(uploadedImageIds || []), ...(linkedImageIds || [])]);
  const sessionBase =
    imageBase && known.size > 0 ? imageBase : null;
  const decorate = (ref: {
    fileid?: string;
    name?: string;
    src?: string;
    data?: string;
  }) => {
    if (ref && typeof ref === "object") {
      const out = { ...ref };
      if (!out.src && out.data) out.src = out.data;
      if (
        !out.src &&
        sessionBase &&
        typeof out.fileid === "string" &&
        out.fileid &&
        known.has(out.fileid)
      ) {
        out.src = sessionBase + encodeURIComponent(out.fileid);
      }
      return out;
    }
    return ref;
  };
  /** Rewrite a bare fileid string to its same-origin session-image URL. */
  const refile = (v: unknown): unknown =>
    typeof v === "string" && sessionBase && known.has(v)
      ? sessionBase + encodeURIComponent(v)
      : v;
  const attach = (j: unknown): unknown => {
    const job = j as { uid?: string } | null;
    if (!job || typeof job !== "object" || !job.uid) return j;
    let out: Record<string, unknown> = { ...(job as Record<string, unknown>) };
    if (
      Array.isArray(jobLogImages[job.uid]) &&
      jobLogImages[job.uid].length > 0
    ) {
      out.log_images = jobLogImages[job.uid].map(decorate);
    }
    if (sessionBase) {
      // output_group_images: { [groupName]: fileid } — feeds node.images
      // (output_group kind) AND every map preview_url.
      if (out.output_group_images && typeof out.output_group_images === "object") {
        let changed = false;
        const ogi: Record<string, unknown> = { ...(out.output_group_images as Record<string, unknown>) };
        for (const [k, v] of Object.entries(ogi)) {
          const rv = refile(v);
          if (rv !== v) { ogi[k] = rv; changed = true; }
        }
        if (changed) out.output_group_images = ogi;
      }
      // ui_tile_images: [{ name, fileid, ... }] — feeds node.images
      // (ui_tile kind) and representative micrographs.
      if (Array.isArray(out.ui_tile_images)) {
        let changed = false;
        const tiles = (out.ui_tile_images as Array<Record<string, unknown>>).map((t) => {
          if (t && typeof t === "object" && typeof t.fileid === "string" && known.has(t.fileid)) {
            changed = true;
            return { ...t, fileid: sessionBase + encodeURIComponent(t.fileid) };
          }
          return t;
        });
        if (changed) out.ui_tile_images = tiles;
      }
      // image_logs: [{ type:'image', imgfiles:[{fileid, filename}] }] —
      // cached logs embedded by the capture script before upload.
      if (Array.isArray(out.image_logs)) {
        let changed = false;
        const logs = (out.image_logs as Array<Record<string, unknown>>).map((l) => {
          if (l && typeof l === "object" && Array.isArray(l.imgfiles)) {
            let fChanged = false;
            const files = (l.imgfiles as Array<Record<string, unknown>>).map((f) => {
              if (f && typeof f === "object" && typeof f.fileid === "string" && known.has(f.fileid)) {
                fChanged = true;
                return { ...f, fileid: sessionBase + encodeURIComponent(f.fileid) };
              }
              return f;
            });
            if (fChanged) { changed = true; return { ...l, imgfiles: files }; }
          }
          return l;
        });
        if (changed) out.image_logs = logs;
      }
    }
    return out;
  };
  if (Array.isArray(raw)) return raw.map(attach);
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { jobs?: unknown[] }).jobs)
  ) {
    const rawObj = raw as { jobs?: unknown[] };
    return { ...rawObj, jobs: (rawObj.jobs || []).map(attach) };
  }
  return raw;
}

function toLoaded(
  data: PendingData,
  imageBase: string | null,
  source: LoadedMetadata["source"] = "upload"
): LoadedMetadata {
  const session = buildSessionFromPending(data.data);
  const mergedRaw = mergeLogImagesIntoRaw(
    data.data.raw || { jobs: data.data.jobs },
    data.data.job_log_images,
    data.data.uploaded_image_ids,
    imageBase,
    data.data.remote_image_ids
  );
  return {
    raw: mergedRaw,
    projectUid: data.data.project_uid || "P",
    jobCount: (data.data.jobs || []).length,
    source,
    session,
  };
}

/** Image-base prefix for a LIVE staged session's uploaded bytes. */
export function sessionImageBase(token: string): string {
  return `/api/cryosmart/import/session/${encodeURIComponent(token)}/image/`;
}

/**
 * Read a fetch Response body as text while reporting the received byte
 * count (drives the download-progress bar). Falls back to resp.text()
 * when no streaming reader is available (ancient browsers / test mocks).
 */
async function readBodyWithProgress(
  resp: Response,
  onProgress: (received: number) => void
): Promise<string> {
  if (!resp.body || typeof resp.body.getReader !== "function") {
    const t = await resp.text();
    onProgress(t.length);
    return t;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      received += value.byteLength;
      onProgress(received);
    }
  }
  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Wait ~two animation frames so a state update PAINTS before the caller
 * blocks the main thread (JSON.parse of a 7 MB body). Hidden tabs never
 * fire rAF — the wall-clock fallback keeps backgrounded capture tabs
 * moving. */
function yieldToPaint(maxWaitMs = 150): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
    setTimeout(finish, maxWaitMs);
  });
}

/** Image-base prefix for a RESTORED capture-history entry's stored bytes. */
export function historyImageBase(entryId: string): string {
  return `/api/cryosmart/history/${encodeURIComponent(entryId)}/image/`;
}

/**
 * Build a LoadedMetadata from a capture-history RESTORE response — the
 * same pipeline the live staged flow uses, with the history image base
 * so every ref/fileid points at this app's on-disk byte store.
 */
export function toLoadedFromHistory(data: PendingData, entryId: string): LoadedMetadata {
  return toLoaded(data, historyImageBase(entryId), "history");
}

const POLL_INTERVAL_MS = 700;
const MAX_WAIT_MS = 5 * 60 * 1000; // staged captures can stream for minutes

/** localStorage key for the ACTIVE import token. The staged-capture poller
 * runs inside the preview tab, which the browser aggressively throttles when
 * backgrounded (timers stretched to ~1/min, then frozen entirely) — a capture
 * that completes while the tab is in the background then NEVER applies its
 * final data: the page keeps rendering the stale mid-capture snapshot where
 * images uploaded after the last poll still carry direct `http://<cryosmart>`
 * URLs (mixed-content-blocked on the HTTPS preview → hidden), while the
 * "打开" link works in a new tab. The token is persisted so a reload (or a
 * preview-panel refresh that drops the ?imported= query) re-attaches to the
 * session and applies the final snapshot. Cleared once the final data is
 * applied (or the session is gone) so later reloads start clean. */
const IMPORT_TOKEN_KEY = "cryosmart_import_token_v1";

function persistImportToken(token: string): void {
  try {
    localStorage.setItem(IMPORT_TOKEN_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    // private mode / storage disabled — resume support is best-effort
  }
}

function clearPersistedImportToken(): void {
  try {
    localStorage.removeItem(IMPORT_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** Read a persisted import token (null when absent or unreadable). */
function readPersistedImportToken(): string | null {
  try {
    const raw = localStorage.getItem(IMPORT_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (parsed && typeof parsed.token === "string" && parsed.token) return parsed.token;
  } catch {
    // corrupt entry — treat as absent
  }
  return null;
}

/** Sleep `ms`, but wake IMMEDIATELY when the tab becomes visible or gains
 * focus. Background tabs get their timers throttled (Chrome: chains limited
 * to 1/min after 5 min, then frozen) — without this wake, a capture that
 * completes while the tab is hidden applies its final data only when the
 * browser eventually runs the next queued timer, which can be never for a
 * frozen tab. visibilitychange/focus are delivered the moment the user looks
 * at the tab again, so the next poll — and the final /data apply — fires
 * instantly. */
function sleepWithWake(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onWake = () => {
      // Only cut the sleep short when the wake actually makes the tab ACTIVE —
      // a visibilitychange to `hidden` must not accelerate the loop.
      if (document.visibilityState === "visible") finish();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
  });
}
// Once jobs have landed there is no fixed deadline anymore (lineage-scoped
// captures can legitimately wait many minutes for the user to trace, kept
// alive by the script's ?hb=1 heartbeat). Instead: a capture is STALLED —
// and the poller gives up with a clear message — when NOTHING about the
// session has changed (counters, note, request revision, updated_at) for
// this long. A dead capture tab stops heartbeating, which stops the
// session clock, which trips this timeout.
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

/** v3.16.1: how long the capture PROGRESS counters (jobs scanned / image
 * refs / uploaded bytes — everything EXCEPT the heartbeat-bumped
 * updated_at) may sit frozen, with the scan finished but the byte upload
 * still incomplete, before the strip flags the capture as stalled.
 * Deliberately BELOW the script's own worst-case healthy silence (3-min
 * re-trace grace window + up-to-7-min byte drain tail) — the badge is a
 * hint ("nothing has moved for 2 min; you can stop waiting"), NOT an
 * auto-abort: a healthy capture whose last few images are slow or failed
 * can legitimately look like this for a few minutes and then complete on
 * its own, so we never cut it off automatically. The user decides via the
 * Stop button. */
const UPLOAD_STALL_HINT_MS = 2 * 60 * 1000;

/** Snapshot of the fields stopImport() needs, mirrored from state via an
 * effect so the callback itself never has to be rebuilt (stable identity
 * for the whole page lifetime). */
interface StopSnapshot {
  token: string | null;
  endJobUid: string | null;
  startedAt: number | null;
}

export function useImportedMetadata(opts?: UseImportedOpts) {
  const [state, setState] = useState<ImportState>({
    status: "idle",
    message: "",
    token: null,
    startedAt: null,
    progress: null,
    endJobUid: null,
  });

  /* v3.25: apply-phase progress — deliberately OUTSIDE ImportState so the
   * poller's change-deduped applyState() never has to reason about it,
   * and so a superseded apply can never resurrect stale progress. */
  const [applying, setApplying] = useState<ApplyProgress | null>(null);
  /** Monotonic apply sequence: progress callbacks from an older fetch are
   *  dropped once a newer apply (or the final stop) has begun. */
  const applySeqRef = useRef(0);
  /** v3.26: a Fetch-all request was acknowledged for the CURRENT session
   *  (reset whenever a new session's polling loop starts). Read by the poll
   *  loop's applyState so the strip button flips to "Requested ✓"
   *  immediately instead of waiting for the next status tick. */
  const fetchAllDoneRef = useRef(false);

  const onLoadedRef = useRef(opts?.onLoaded);
  useEffect(() => {
    onLoadedRef.current = opts?.onLoaded;
  }, [opts?.onLoaded]);

  /* ── v3.25: the ONE place a /data snapshot is fetched + applied ──────
   * Streaming read with byte progress, an explicit parse phase, the
   * first-apply toast, and a badge that stays up until the heavy graph
   * re-render has painted. The poll loop's progressive passes, the final
   * /complete apply AND the manual stop all route through here. */
  const fetchSessionData = useCallback(
    async (
      token: string,
      expectedJobs: number | null,
      callOpts?: { firstApply?: boolean; isCancelled?: () => boolean }
    ): Promise<PendingData | null> => {
      const seq = ++applySeqRef.current;
      const now0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      /** setApplying, but no-ops once a NEWER apply has started. */
      const commit = (next: SetStateAction<ApplyProgress | null>) => {
        if (applySeqRef.current !== seq) return;
        setApplying(next);
      };
      commit({
        jobs: expectedJobs,
        received: 0,
        total: null,
        phase: "download",
        startedAt: Date.now(),
      });

      let resp: Response;
      try {
        resp = await fetch(
          `/api/cryosmart/import/session/${encodeURIComponent(token)}/data`,
          { credentials: "same-origin", cache: "no-store" }
        );
      } catch {
        commit(null);
        return null;
      }
      if (!resp.ok) {
        commit(null);
        return null;
      }
      const totalHeader = Number(resp.headers.get("Content-Length"));
      const total =
        Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;

      // Byte progress, throttled to ~4 Hz — a callback per network chunk
      // would re-render the page 110+ times for a 7 MB body.
      let lastEmit = 0;
      let received = 0;
      let text: string;
      try {
        text = await readBodyWithProgress(resp, (r) => {
          received = r;
          const t = Date.now();
          if (t - lastEmit >= 250) {
            lastEmit = t;
            commit((prev) =>
              prev ? { ...prev, received: r, total: total ?? prev.total } : prev
            );
          }
        });
      } catch {
        commit(null);
        return null;
      }

      // Download finished → parsing. Let the "parsing…" state paint
      // BEFORE the JSON.parse block freezes the timer.
      commit((prev) =>
        prev
          ? {
              ...prev,
              received: received || text.length,
              total: total ?? Math.max(received, text.length),
              phase: "parse",
            }
          : prev
      );
      await yieldToPaint();

      let data: PendingData;
      try {
        data = JSON.parse(text) as PendingData;
      } catch {
        commit(null);
        return null;
      }
      if (
        !(data.ok && Array.isArray(data.data.jobs) && data.data.jobs.length > 0)
      ) {
        commit(null);
        return null;
      }
      const jobsCount = data.data.jobs.length;
      const bytesCount = total ?? Math.max(received, text.length);
      commit((prev) =>
        prev
          ? { ...prev, jobs: jobsCount, received: bytesCount, total: bytesCount }
          : prev
      );

      // The genuinely heavy step: mergeLogImagesIntoRaw + page setState +
      // the LineageGraph re-render of hundreds of nodes.
      if (callOpts?.isCancelled?.()) {
        commit(null);
        return null;
      }
      onLoadedRef.current?.(toLoaded(data, sessionImageBase(token)));

      // Keep the "Receiving…" badge up until the re-render has PAINTED —
      // rAF fires after the next paint, the nested setTimeout(0) runs
      // after React commits it. The 3 s wall-clock fallback covers
      // hidden tabs (whose rAF never fires).
      const clear = () => commit(null);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => setTimeout(clear, 0));
      } else {
        setTimeout(clear, 0);
      }
      setTimeout(clear, 3000);

      if (callOpts?.firstApply) {
        const seconds = Math.max(
          0.1,
          ((typeof performance !== "undefined" ? performance.now() : Date.now()) -
            now0) /
            1000
        );
        const finish = () =>
          toast.success(`Loaded ${jobsCount} jobs in ${seconds.toFixed(1)}s`);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(finish);
        } else {
          setTimeout(finish, 0);
        }
      }
      return data;
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const urlToken = u.searchParams.get("imported");
    if (urlToken) {
      persistImportToken(urlToken);
    }
    // Re-attach to a capture whose progress tab was reloaded/navigated away
    // (the preview panel refreshes can drop the ?imported= query) — the
    // persisted token keeps the final apply reachable. Only used when the
    // URL itself carries no token; an explicit ?imported= always wins.
    const token = urlToken || readPersistedImportToken();
    if (!token) return;
    // Transition from "idle" (initial mount state) to "polling" once we
    // detect an ?imported= query param (or a persisted one). Deferred by one
    // tick so the setState is not synchronous inside the effect body
    // (react-compiler restriction) — the polling effect below starts a tick
    // later, which is imperceptible.
    const t = setTimeout(() => {
      setState({
        status: "polling",
        message: "Connected to capture script — waiting for data…",
        token,
        startedAt: Date.now(),
        progress: null,
        endJobUid: null,
      });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (state.status !== "polling" || !state.token) return;
    let cancelled = false;
    const token = state.token;
    const startedAt = state.startedAt || Date.now();

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("imported");
        url.searchParams.delete("pid");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      } catch {
        // ignore
      }
    };

    // A "resumed" poller re-attaches to a STAGED session from localStorage
    // (no ?imported= in the URL — the progress tab was reloaded/navigated).
    // Two consequences: the legacy /pending probe is pointless (staged tokens
    // never live there), and a 404 must end SILENTLY — the session simply
    // expired after its 45-min TTL, which is not an error worth surfacing to
    // a user who just reloaded the page.
    let isResume = false;
    try {
      isResume = !new URL(window.location.href).searchParams.get("imported");
    } catch {
      // keep false
    }

    const poll = async () => {
      /** staged-flow state: initial (jobs-only) snapshot already applied? */
      let stagedLoaded = false;
      /** v3.5: first non-null end_job_uid seen (sticky across iterations). */
      let endJobUidSeen: string | null = null;
      /** stall detection: has_data once seen + fingerprint of last activity. */
      let sawData = false;
      let lastSig = "";
      let lastActivity = Date.now();
      /** v3.16.1: progress-only fingerprint + its clock — heartbeat-bumped
       *  updated_at must NOT count as capture progress (a live-but-stuck
       *  script keeps the session alive while the counters freeze). */
      let lastProgressSig = "";
      let progressLastActivity = Date.now();
      /** consecutive session-endpoint 404s (stale-URL early exit below). */
      let staged404Count = 0;
      // v3.26: fresh session → fresh Fetch-all acknowledgement state.
      fetchAllDoneRef.current = false;

      // ── Progressive data application ─────────────────────────────
      // The graph/report are built from `loaded`, which used to refresh
      // only TWICE (first jobs snapshot + final /complete). Between
      // "24/24 jobs scanned" and /complete the script can sit in its
      // re-trace grace window + byte-upload drain for minutes — during
      // which the graph and report showed NO log images even though the
      // strip said "320 captured". Now every change of the image
      // counters re-applies the (cumulative) session data so the graph,
      // detail modal and report fill in LIVE as refs + bytes stream in.
      // /complete still triggers one final unconditional application.
      let lastDataSig = "";
      let lastDataFetchAt = 0;
      const DATA_FETCH_MIN_INTERVAL_MS = 1500;

      /** PERF: the poll loop fires every 700ms for up to ~20 minutes. Each
       *  tick used to swap in a FRESH state object, re-rendering the entire
       *  page (including the mounted lineage-graph SVG — no card is
       *  React.memo'd) ~1700× per capture even when NOTHING changed.
       *  Returning the PREVIOUS object from the updater makes React bail
       *  out of the re-render + effects entirely when every visible field
       *  is identical. */
      const applyState = (next: ImportState) => {
        setState((prev) => {
          const p = prev.progress;
          const n = next.progress;
          const sameProgress =
            p === n ||
            (!!p && !!n &&
              p.done === n.done &&
              p.total === n.total &&
              p.images === n.images &&
              p.uploaded === n.uploaded &&
              p.phase === n.phase &&
              p.phaseDetail === n.phaseDetail &&
              p.phaseAt === n.phaseAt) ||
            (!p && !n);
          if (
            prev.status === next.status &&
            prev.message === next.message &&
            prev.token === next.token &&
            prev.startedAt === next.startedAt &&
            prev.endJobUid === next.endJobUid &&
            prev.uploadStalled === next.uploadStalled &&
            sameProgress
          ) {
            return prev;
          }
          return next;
        });
      };

      /** Fetch the current cumulative session snapshot and apply it.
       * v3.25: routes through fetchSessionData — streaming byte progress,
       * parse-phase indicator, first-apply toast and the stop-race
       * cancellation check all live there. */
      const applyStagedData = (
        expectedJobs: number | null = null,
        firstApply = false
      ): Promise<PendingData | null> =>
        fetchSessionData(token, expectedJobs, {
          firstApply,
          isCancelled: () => cancelled,
        });

      /** Fingerprint of "what data the session holds right now" — any
       * change means the streamed log images grew and `loaded` is stale. */
      const dataSigOf = (s: SessionStatus) =>
        [
          s.total_jobs,
          s.log_jobs_total,
          s.log_jobs_done,
          s.log_images_count,
          s.log_images_uploaded,
          s.status,
        ].join("|");

      while (!cancelled) {
        // Hard timeout only applies BEFORE jobs land — after that the
        // heartbeat-driven stall detector below takes over (a legitimate
        // capture can run for many minutes).
        if (!sawData && Date.now() - startedAt > MAX_WAIT_MS) {
          if (!cancelled) {
            clearPersistedImportToken();
            applyState({
              status: "error",
              message: "Timed out waiting for CryoSmart data — please re-run the capture script.",
              token,
              startedAt,
              progress: null,
              endJobUid: endJobUidSeen,
            });
          }
          return;
        }

        // ── Staged flow: GET /api/cryosmart/import/session/<token> ──
        let sessionStatus: SessionStatus | null = null;
        let stagedNotFound = false;
        try {
          const resp = await fetch(
            `/api/cryosmart/import/session/${encodeURIComponent(token)}`,
            { credentials: "same-origin", cache: "no-store" }
          );
          if (cancelled) return;
          if (resp.ok) {
            sessionStatus = (await resp.json()) as SessionStatus;
          } else if (resp.status === 404) {
            stagedNotFound = true;
          }
        } catch {
          // network hiccup — fall through to legacy probe
        }

        // Track consecutive session-404s for the stale-token early exit
        // below (reset whenever the session IS found or the network hiccuped).
        if (stagedNotFound) staged404Count += 1;
        else staged404Count = 0;

        // Resumed re-attach to a session that has since expired: stop
        // silently instead of showing an error (and stop the legacy probe —
        // a staged token can never appear in /pending).
        if (!sessionStatus && stagedNotFound && isResume) {
          clearPersistedImportToken();
          if (!cancelled) {
            applyState({
              status: "idle",
              message: "",
              token: null,
              startedAt: null,
              progress: null,
              endJobUid: null,
            });
          }
          return;
        }

        // Fresh ?imported= URL pointing at a session that no longer exists
        // (45-min TTL passed, or the server restarted). The staged token
        // can NEVER appear in /pending either, so the old behavior ground
        // the full MAX_WAIT_MS before a misleading "Timed out" — bail
        // early with an actionable message instead. Staged tokens carry a
        // `s<seq>-` prefix (legacy /pending tokens don't), and 3
        // consecutive 404s (~2s) rules out a transient network blip.
        if (
          !sessionStatus &&
          stagedNotFound &&
          !isResume &&
          !sawData &&
          staged404Count >= 3 &&
          /^s\d+-/.test(token)
        ) {
          clearPersistedImportToken();
          cleanUrl();
          if (!cancelled) {
            applyState({
              status: "error",
              message:
                "Capture session expired or not found — re-run Smart Capture, or restore the capture from Capture History below.",
              token,
              startedAt,
              progress: null,
              endJobUid: endJobUidSeen,
            });
          }
          return;
        }

        if (sessionStatus && sessionStatus.ok) {
          if (sessionStatus.end_job_uid) endJobUidSeen = sessionStatus.end_job_uid;
          if (sessionStatus.has_data) sawData = true;

          // Stall detection — the script's heartbeat (?hb=1) keeps bumping
          // `updated_at` while it waits for the user's trace, and every
          // log/image batch mutates the counters, so a live capture always
          // changes this fingerprint.
          // v3.29: phase POSTS count as liveness here — a script deep in
          // loader calibration (or a 20s slow-log wait) reports its
          // sub-step but cannot move any counter, and must not trip the
          // 10-min dead-tab timeout.
          const sig = [
            sessionStatus.status,
            sessionStatus.log_jobs_done,
            sessionStatus.log_jobs_total,
            sessionStatus.log_images_count,
            sessionStatus.log_images_uploaded,
            sessionStatus.note,
            sessionStatus.updated_at ?? 0,
            sessionStatus.log_request?.revision ?? 0,
            sessionStatus.script_phase ?? "",
            sessionStatus.phase_detail ?? "",
          ].join("|");
          // v3.16.1: progress-only fingerprint (NO updated_at) — heartbeat
          // bumps must not mask frozen COUNTERS. When the scan is finished
          // but the byte upload is incomplete and even the counters stop
          // moving for UPLOAD_STALL_HINT_MS, the strip flags the capture as
          // stalled (amber badge + emphasized Stop button). See
          // UPLOAD_STALL_HINT_MS for why this is a hint, never an auto-abort.
          const progressSig = [
            sessionStatus.status,
            sessionStatus.log_jobs_done,
            sessionStatus.log_jobs_total,
            sessionStatus.log_images_count,
            sessionStatus.log_images_uploaded,
            sessionStatus.note,
            sessionStatus.log_request?.revision ?? 0,
          ].join("|");
          if (progressSig !== lastProgressSig) {
            lastProgressSig = progressSig;
            progressLastActivity = Date.now();
          }
          const scanFinished =
            sessionStatus.log_jobs_total > 0 &&
            sessionStatus.log_jobs_done >= sessionStatus.log_jobs_total;
          const uploadIncomplete =
            sessionStatus.log_images_count > 0 &&
            sessionStatus.log_images_uploaded < sessionStatus.log_images_count;
          const uploadStalled =
            sawData &&
            scanFinished &&
            uploadIncomplete &&
            Date.now() - progressLastActivity > UPLOAD_STALL_HINT_MS;
          if (sig !== lastSig) {
            lastSig = sig;
            lastActivity = Date.now();
          } else if (
            sawData &&
            Date.now() - lastActivity > STALL_TIMEOUT_MS
          ) {
            if (!cancelled) {
              // Best-effort rescue: apply whatever the session managed to
              // collect before the script died, so streamed log images are
              // not stranded in the store (they were ALREADY counted by
              // the strip — losing them now would look like the original
              // "captured 320 but nothing shows" bug).
              try {
                await applyStagedData(sessionStatus.total_jobs);
              } catch {
                // nothing to rescue
              }
              if (cancelled) return;
              clearPersistedImportToken();
              applyState({
                status: "error",
                message:
                  "Capture stalled — the capture script stopped responding (its tab may have been closed). The data received so far is shown; re-run the script to capture the rest.",
                token,
                startedAt,
                progress: null,
                endJobUid: endJobUidSeen,
              });
            }
            return;
          }

          // Jobs are in — render the graph immediately (first time only)
          // and keep showing live log-collection progress.
          if (sessionStatus.has_data && !stagedLoaded) {
            stagedLoaded = true;
            lastDataSig = dataSigOf(sessionStatus);
            lastDataFetchAt = Date.now();
            try {
              if (cancelled) return;
              // firstApply → the "Loaded N jobs in X.Xs" toast fires once
              // the initial snapshot has rendered.
              await applyStagedData(sessionStatus.total_jobs, true);
            } catch {
              // non-fatal: retried by the progressive pass below
            }
          } else if (
            sessionStatus.has_data &&
            stagedLoaded &&
            dataSigOf(sessionStatus) !== lastDataSig &&
            Date.now() - lastDataFetchAt >= DATA_FETCH_MIN_INTERVAL_MS
          ) {
            // Log images grew since the last applied snapshot — apply the
            // new cumulative data so the graph/report refresh LIVE.
            lastDataSig = dataSigOf(sessionStatus);
            lastDataFetchAt = Date.now();
            try {
              if (cancelled) return;
              await applyStagedData(sessionStatus.total_jobs);
            } catch {
              // transient — the next counter change or /complete re-applies
            }
          }

          if (sessionStatus.status === "complete") {
            // Final snapshot (includes every streamed log image). Applied
            // unconditionally even after the progressive passes — the last
            // word on what the capture collected.
            try {
              if (cancelled) return;
              const data = await applyStagedData(sessionStatus.total_jobs);
              if (data) {
                const jobsCount = data.data.jobs?.length ?? 0;
                const nLogs = sessionStatus.log_images_count;
                const withLogs = sessionStatus.log_jobs_with_images;
                const uploaded = sessionStatus.log_images_uploaded;
                const req = sessionStatus.log_request;
                // v3.26: the summary now EXPLAINS its own numbers — the
                // user's recurring "why did only 41 of 72 jobs get images?"
                // question (31 jobs with no readable logs, untraced jobs
                // skipped by design, refs without preview bytes) is answered
                // right where the final message lands, instead of requiring
                // a console scroll through the capture script's notes.
                const lineageScoped =
                  !!sessionStatus.lineage_mode && !!req && req.jobs.length > 0;
                // v3.27: the complete-report pass widens the request to every
                // job — "traced" wording only while the request is a real
                // subset (early stop / legacy capture).
                const wholeProject = lineageScoped && jobsCount > 0 && req.jobs.length >= jobsCount;
                let message: string;
                if (nLogs > 0 && lineageScoped) {
                  const scopeLabel = wholeProject ? "" : "traced ";
                  const noLogCount = Math.max(0, req.jobs.length - withLogs);
                  const untraced = Math.max(0, jobsCount - req.jobs.length);
                  const noBytes = Math.max(0, nLogs - uploaded);
                  const reasons: string[] = [];
                  if (noLogCount > 0)
                    reasons.push(
                      `${noLogCount} of the ${scopeLabel}jobs have no readable log images (import/ctf jobs usually have none — the CryoSmart console lists them; the report shows their output-group previews instead)`
                    );
                  if (untraced > 0)
                    reasons.push(
                      `${untraced} jobs outside the traced lineage were skipped by design`
                    );
                  if (noBytes > 0)
                    reasons.push(
                      `${noBytes} image(s) have no preview bytes (missing or too large on the CryoSmart server)`
                    );
                  message =
                    `Captured ${jobsCount} jobs + ${nLogs} log images from ${withLogs} of the ${req.jobs.length} ${scopeLabel}jobs` +
                    (reasons.length ? ` — ${reasons.join("; ")}` : "") +
                    ` (${uploaded} with previews).`;
                } else if (nLogs > 0) {
                  message =
                    `Captured ${jobsCount} jobs + ${nLogs} log images from ${withLogs} jobs` +
                    (uploaded > 0 && uploaded < nLogs
                      ? ` (${uploaded} with previews).`
                      : ".");
                } else {
                  message =
                    sessionStatus.log_jobs_done > 0
                      ? `Captured ${jobsCount} jobs — no log images readable on this build (see the CryoSmart console diagnostics).`
                      : sessionStatus.lineage_mode && !sessionStatus.log_request
                        ? `Captured ${jobsCount} jobs — no Trace Lineage ran during the capture window, so no log images were fetched. Re-run the script and trace (or call __csCaptureAll() in the CryoSmart console).`
                        : `Captured ${jobsCount} jobs (no log images available).`;
                }
                applyState({
                  status: "loaded",
                  message,
                  token,
                  startedAt,
                  progress: null,
                  endJobUid: endJobUidSeen,
                });
                // Final snapshot applied — a later reload must NOT resurrect
                // this capture over whatever the user does next.
                clearPersistedImportToken();
                cleanUrl();
                return;
              }
            } catch {
              // fall through — retry next tick
            }
          } else if (sessionStatus.has_data) {
            const req = sessionStatus.log_request || null;
            // v3.5 lineage mode BEFORE the first trace: no log work has
            // happened (and none should until the lineage is known).
            const waitingForTrace =
              !!sessionStatus.lineage_mode &&
              !req &&
              sessionStatus.log_jobs_done === 0;
            if (waitingForTrace) {
              applyState({
                status: "polling",
                message:
                  `Loaded ${sessionStatus.total_jobs} jobs — waiting for Trace Lineage (its log images are fetched first; every remaining job follows)` +
                  (endJobUidSeen
                    ? `… auto-tracing from ${endJobUidSeen}.`
                    : ` — pick a Start Job below and click Trace Lineage.`),
                token,
                startedAt,
                progress: null,
                endJobUid: endJobUidSeen,
                uploadStalled: false,
                fetchAllJobs: sessionStatus.lineage_mode
                  ? sessionStatus.total_jobs
                  : null,
                fetchAllRequested: fetchAllDoneRef.current,
              });
            } else {
              const imgs = sessionStatus.log_images_count;
              const upl = sessionStatus.log_images_uploaded;
              const scanDone =
                sessionStatus.log_jobs_total > 0 &&
                sessionStatus.log_jobs_done >= sessionStatus.log_jobs_total;
              const lineageNote =
                sessionStatus.lineage_mode && req && req.jobs.length < sessionStatus.total_jobs
                  ? " for the traced lineage"
                  : "";
              // v3.26: is every captured job already in the log request?
              // (fetch-all clicked, or the trace genuinely covered the
              // whole project — either way the button is pointless).
              const allRequested =
                !!req && sessionStatus.total_jobs > 0 && req.jobs.length >= sessionStatus.total_jobs;
              const fetchAllJobs =
                sessionStatus.lineage_mode && !allRequested
                  ? sessionStatus.total_jobs
                  : null;
              // v3.29: the script's current sub-step ("calibrating the log
              // loader on J45 — action 'getJobDetail' arg shape 2/6…",
              // "scanning 13/72 · J13 (class_3d)", "rescue", "grace",
              // "rest", "drain"). While NO job has streamed yet the
              // generic "fetching log images 0/72…" line says nothing —
              // the phase detail replaces it so the calibration stretch
              // (30–120s on a real build) explains itself; afterwards the
              // generic line resumes and the detail moves to the strip's
              // activity row.
              const phaseDetail =
                typeof sessionStatus.phase_detail === "string" && sessionStatus.phase_detail
                  ? sessionStatus.phase_detail
                  : null;
              // Phase-aware message: the scan can finish minutes before the
              // script completes (re-trace grace window + byte upload
              // drain) — say what is actually happening instead of a
              // stale "fetching… 24/24". v3.26: the "all ready" wording
              // now names the grace window — this is the silent multi-minute
              // stretch that previously read as "stuck".
              // v3.27: the "all ready" case is now TRANSIENT — after the
              // short grace window the complete-report pass widens the
              // denominator to the whole project and the "fetching X/N"
              // line resumes, so the note names the wrap-up, not a wait.
              const message =
                scanDone && imgs > 0 && upl < imgs
                  ? `Loaded ${sessionStatus.total_jobs} jobs — uploading image previews ${upl}/${imgs}${lineageNote}…`
                  : scanDone && imgs > 0
                    ? `Loaded ${sessionStatus.total_jobs} jobs — all ${imgs} log images ready${lineageNote}; the script is wrapping up…`
                    : sessionStatus.log_jobs_done === 0 && phaseDetail
                      ? `Loaded ${sessionStatus.total_jobs} jobs — ${phaseDetail}${
                          phaseDetail.endsWith("…") || phaseDetail.endsWith(".") ? "" : "…"
                        }`
                      : `Loaded ${sessionStatus.total_jobs} jobs — fetching log images${lineageNote} ` +
                        `${sessionStatus.log_jobs_done}/${sessionStatus.log_jobs_total}` +
                        (imgs > 0 ? ` (${imgs} captured)` : "") +
                        "…";
              applyState({
                status: "polling",
                message,
                token,
                startedAt,
                progress: {
                  done: sessionStatus.log_jobs_done,
                  total: Math.max(1, sessionStatus.log_jobs_total),
                  images: sessionStatus.log_images_count,
                  uploaded: sessionStatus.log_images_uploaded,
                  phase: sessionStatus.script_phase || null,
                  phaseDetail,
                  phaseAt: sessionStatus.phase_at || null,
                },
                endJobUid: endJobUidSeen,
                uploadStalled,
                fetchAllJobs,
                fetchAllRequested: fetchAllDoneRef.current,
              });
            }
          } else {
            applyState({
              status: "polling",
              message: "Capture session established — uploading job metadata…",
              token,
              startedAt,
              progress: null,
              endJobUid: endJobUidSeen,
              uploadStalled: false,
            });
          }

          await sleepWithWake(POLL_INTERVAL_MS);
          continue;
        }

        // ── Legacy flow: GET /api/cryosmart/pending?token= (single-use) ──
        try {
          const resp = await fetch(
            `/api/cryosmart/pending?token=${encodeURIComponent(token)}`,
            { method: "GET", credentials: "same-origin", cache: "no-store" }
          );
          if (cancelled) return;
          if (resp.ok) {
            const data = (await resp.json()) as PendingData;
            if (data.ok && data.data && Array.isArray(data.data.jobs) && data.data.jobs.length > 0) {
              const session = buildSessionFromPending(data.data);
              onLoadedRef.current?.(toLoaded(data, sessionImageBase(token)));
              applyState({
                status: "loaded",
                message: session
                  ? `Loaded ${data.data.jobs.length} jobs from CryoSmart (session available for maps/images).`
                  : `Loaded ${data.data.jobs.length} jobs from CryoSmart.`,
                token,
                startedAt,
                progress: null,
                endJobUid: endJobUidSeen,
              });
              cleanUrl();
              clearPersistedImportToken();
              return;
            }
          }
          // 404 on both endpoints → data not uploaded yet; keep polling.
        } catch {
          // network error — keep polling
        }

        await sleepWithWake(POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
    // fetchSessionData is a stable useCallback([]) — listed for the
    // exhaustive-deps linter, it never re-triggers this effect.
  }, [state.status, state.token, state.startedAt, fetchSessionData]);

  /* ── v3.16.1: manual stop ("Stop waiting & keep captured data") ──────
   * The user's "stuck at 263/268 with no way to stop" case: a live capture
   * can sit with frozen counters for minutes (hung /images POST, frozen
   * capture tab, or a script whose /complete POST failed 3×) — the
   * heartbeat keeps the dead-tab stall timeout at bay, so the strip used to
   * spin forever with NO escape hatch. stopImport() detaches the page from
   * the session: it applies the LATEST cumulative snapshot (progressive
   * application already streamed most of it, this is the final refresh),
   * ends the polling state, and reports exactly what was kept. The capture
   * script itself is untouched — it may still be running in its CryoSmart
   * tab, and its eventual /complete persists whatever it collected to
   * Capture History for a later restore. */
  const stopRef = useRef<StopSnapshot>({ token: null, endJobUid: null, startedAt: null });
  useEffect(() => {
    stopRef.current = {
      token: state.token,
      endJobUid: state.endJobUid,
      startedAt: state.startedAt,
    };
  }, [state.token, state.endJobUid, state.startedAt]);

  const stopImport = useCallback(async (): Promise<void> => {
    const { token, endJobUid, startedAt } = stopRef.current;
    if (!token) return;
    // Best-effort final snapshot: fetch + apply the cumulative data (the
    // poll loop has been applying it live all along — this is a last
    // refresh so anything uploaded in the final seconds is not lost).
    // v3.25: routed through fetchSessionData, so the stop's own /data read
    // gets the applying indicator AND supersedes any in-flight poll apply
    // (applySeq) — the newest snapshot can no longer be overwritten by a
    // stale poll fetch finishing late.
    try {
      const data = await fetchSessionData(token, null);
      if (data) {
        const jobsCount = data.data.jobs?.length ?? 0;
        const uploaded = data.data.uploaded_image_ids?.length ?? 0;
        const refs = Object.values(data.data.job_log_images || {}).reduce(
          (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
          0
        );
        const withLogs = Object.values(data.data.job_log_images || {}).filter(
          (arr) => Array.isArray(arr) && arr.length > 0
        ).length;
        setState({
          status: "loaded",
          message:
            refs > 0
              ? `Stopped waiting — kept ${jobsCount} jobs + ${refs} log images from ${withLogs} jobs (${uploaded} with previews). The capture script may still be running in its tab; re-run Smart Capture to fetch the rest.`
              : `Stopped waiting — kept ${jobsCount} jobs (no log images captured yet). Re-run Smart Capture to collect them.`,
          token,
          startedAt,
          progress: null,
          endJobUid,
          uploadStalled: false,
        });
        clearPersistedImportToken();
        return;
      }
    } catch {
      // fall through to the error report below
    }
    // Data unreadable (session expired / server restart): still STOP —
    // an honest error beats an eternal spinner.
    setState({
      status: "error",
      message:
        "Stopped waiting — the capture session could no longer be read (it may have expired). Re-run Smart Capture, or restore a previous capture from Capture History.",
      token,
      startedAt,
      progress: null,
      endJobUid,
      uploadStalled: false,
    });
    clearPersistedImportToken();
  }, [fetchSessionData]);

  /* ── v3.26: "Fetch all jobs' log images" ────────────────────────────
   * The user's recurring "why did only 41 of 72 traced jobs (and none of
   * the 520 untraced ones) get log images?" — the capture is lineage-
   * scoped by design, and the only escape hatch was the console-only
   * __csCaptureAll(). This publishes {all:true} to the session's log
   * request: the running script sees the unioned list (trace-wait loop,
   * re-trace grace window, or the v3.26 byte-drain poll) and scans every
   * remaining job. Only meaningful while the script is still attached —
   * after /complete the button disappears with the polling state. */
  const requestAllLogs = useCallback(async (): Promise<void> => {
    const token = stopRef.current.token;
    if (!token || fetchAllDoneRef.current) return;
    try {
      const resp = await fetch(
        `/api/cryosmart/import/session/${encodeURIComponent(token)}/request-logs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }
      );
      const data = (await resp.json()) as { ok?: boolean; log_request?: { jobs?: unknown[] }; error?: string };
      if (data?.ok) {
        fetchAllDoneRef.current = true;
        const n = Array.isArray(data.log_request?.jobs) ? data.log_request.jobs.length : 0;
        // Optimistic UI: flip the button to "Requested ✓" without waiting
        // for the next 700ms poll tick to publish fetchAllRequested.
        setState((prev) =>
          prev.status === "polling" ? { ...prev, fetchAllRequested: true } : prev
        );
        toast.success(
          `Requested log images for all ${n} job(s) — the capture script picks them up within seconds and the progress above extends. Large projects can take several minutes.`
        );
      } else {
        toast.error(data?.error || "Could not request all jobs' log images.");
      }
    } catch {
      toast.error("Could not reach the capture session — try again.");
    }
  }, []);

  return { ...state, applying, stop: stopImport, requestAllLogs };
}
