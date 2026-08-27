"use client";

import { useEffect, useRef, useState } from "react";
import type { LoadedMetadata } from "@/app/components/cryosmart/data-source-card";
import type { CryoSmartSession } from "@/lib/cryosmart/proxy-client";

interface PendingData {
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
  token?: string
): unknown {
  if (!jobLogImages) return raw;
  const uploaded = new Set(uploadedImageIds || []);
  const sessionBase =
    token && uploaded.size > 0
      ? `/api/cryosmart/import/session/${encodeURIComponent(token)}/image/`
      : null;
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
        uploaded.has(out.fileid)
      ) {
        out.src = sessionBase + encodeURIComponent(out.fileid);
      }
      return out;
    }
    return ref;
  };
  /** Rewrite a bare fileid string to its same-origin session-image URL. */
  const refile = (v: unknown): unknown =>
    typeof v === "string" && sessionBase && uploaded.has(v)
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
          if (t && typeof t === "object" && typeof t.fileid === "string" && uploaded.has(t.fileid)) {
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
              if (f && typeof f === "object" && typeof f.fileid === "string" && uploaded.has(f.fileid)) {
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

function toLoaded(data: PendingData, token: string): LoadedMetadata {
  const session = buildSessionFromPending(data.data);
  const mergedRaw = mergeLogImagesIntoRaw(
    data.data.raw || { jobs: data.data.jobs },
    data.data.job_log_images,
    data.data.uploaded_image_ids,
    token
  );
  return {
    raw: mergedRaw,
    projectUid: data.data.project_uid || "P",
    jobCount: (data.data.jobs || []).length,
    source: "upload",
    session,
  };
}

const POLL_INTERVAL_MS = 700;
const MAX_WAIT_MS = 5 * 60 * 1000; // staged captures can stream for minutes
// Once jobs have landed there is no fixed deadline anymore (lineage-scoped
// captures can legitimately wait many minutes for the user to trace, kept
// alive by the script's ?hb=1 heartbeat). Instead: a capture is STALLED —
// and the poller gives up with a clear message — when NOTHING about the
// session has changed (counters, note, request revision, updated_at) for
// this long. A dead capture tab stops heartbeating, which stops the
// session clock, which trips this timeout.
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

export function useImportedMetadata(opts?: UseImportedOpts) {
  const [state, setState] = useState<ImportState>({
    status: "idle",
    message: "",
    token: null,
    startedAt: null,
    progress: null,
    endJobUid: null,
  });

  const onLoadedRef = useRef(opts?.onLoaded);
  useEffect(() => {
    onLoadedRef.current = opts?.onLoaded;
  }, [opts?.onLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const token = u.searchParams.get("imported");
    if (!token) return;
    // Transition from "idle" (initial mount state) to "polling" once we
    // detect an ?imported= query param. Deferred by one tick so the
    // setState is not synchronous inside the effect body (react-compiler
    // restriction) — the polling effect below starts a tick later, which
    // is imperceptible.
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

    const poll = async () => {
      /** staged-flow state: initial (jobs-only) snapshot already applied? */
      let stagedLoaded = false;
      /** v3.5: first non-null end_job_uid seen (sticky across iterations). */
      let endJobUidSeen: string | null = null;
      /** stall detection: has_data once seen + fingerprint of last activity. */
      let sawData = false;
      let lastSig = "";
      let lastActivity = Date.now();

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

      /** Fetch the current cumulative session snapshot and apply it. */
      const applyStagedData = async (): Promise<PendingData | null> => {
        const dataResp = await fetch(
          `/api/cryosmart/import/session/${encodeURIComponent(token)}/data`,
          { credentials: "same-origin", cache: "no-store" }
        );
        if (!dataResp.ok) return null;
        const data = (await dataResp.json()) as PendingData;
        if (data.ok && Array.isArray(data.data.jobs) && data.data.jobs.length > 0) {
          onLoadedRef.current?.(toLoaded(data, token));
          return data;
        }
        return null;
      };

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
            setState({
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
        try {
          const resp = await fetch(
            `/api/cryosmart/import/session/${encodeURIComponent(token)}`,
            { credentials: "same-origin", cache: "no-store" }
          );
          if (cancelled) return;
          if (resp.ok) {
            sessionStatus = (await resp.json()) as SessionStatus;
          }
        } catch {
          // network hiccup — fall through to legacy probe
        }

        if (sessionStatus && sessionStatus.ok) {
          if (sessionStatus.end_job_uid) endJobUidSeen = sessionStatus.end_job_uid;
          if (sessionStatus.has_data) sawData = true;

          // Stall detection — the script's heartbeat (?hb=1) keeps bumping
          // `updated_at` while it waits for the user's trace, and every
          // log/image batch mutates the counters, so a live capture always
          // changes this fingerprint.
          const sig = [
            sessionStatus.status,
            sessionStatus.log_jobs_done,
            sessionStatus.log_jobs_total,
            sessionStatus.log_images_count,
            sessionStatus.log_images_uploaded,
            sessionStatus.note,
            sessionStatus.updated_at ?? 0,
            sessionStatus.log_request?.revision ?? 0,
          ].join("|");
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
                await applyStagedData();
              } catch {
                // nothing to rescue
              }
              if (cancelled) return;
              setState({
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
              await applyStagedData();
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
              await applyStagedData();
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
              const data = await applyStagedData();
              if (data) {
                const jobsCount = data.data.jobs?.length ?? 0;
                const nLogs = sessionStatus.log_images_count;
                const withLogs = sessionStatus.log_jobs_with_images;
                const uploaded = sessionStatus.log_images_uploaded;
                const req = sessionStatus.log_request;
                const lineageNote =
                  sessionStatus.lineage_mode && req && req.jobs.length > 0
                    ? ` (traced lineage — ${req.jobs.length} of ${jobsCount} jobs scanned)`
                    : "";
                setState({
                  status: "loaded",
                  message:
                    nLogs > 0
                      ? `Captured ${jobsCount} jobs + ${nLogs} log images from ${withLogs} jobs${lineageNote}` +
                          (uploaded > 0 && uploaded < nLogs
                            ? ` (${uploaded} with previews).`
                            : ".")
                      : sessionStatus.log_jobs_done > 0
                        ? `Captured ${jobsCount} jobs — no log images readable on this build (see the CryoSmart console diagnostics).`
                        : sessionStatus.lineage_mode && !sessionStatus.log_request
                          ? `Captured ${jobsCount} jobs — no Trace Lineage ran during the capture window, so no log images were fetched. Re-run the script and trace (or call __csCaptureAll() in the CryoSmart console).`
                          : `Captured ${jobsCount} jobs (no log images available).`,
                  token,
                  startedAt,
                  progress: null,
                  endJobUid: endJobUidSeen,
                });
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
              setState({
                status: "polling",
                message:
                  `Loaded ${sessionStatus.total_jobs} jobs — waiting for Trace Lineage (log images are fetched only for the traced lineage)` +
                  (endJobUidSeen
                    ? `… auto-tracing from ${endJobUidSeen}.`
                    : ` — pick a Start Job below and click Trace Lineage.`),
                token,
                startedAt,
                progress: null,
                endJobUid: endJobUidSeen,
              });
            } else {
              const imgs = sessionStatus.log_images_count;
              const upl = sessionStatus.log_images_uploaded;
              const scanDone =
                sessionStatus.log_jobs_total > 0 &&
                sessionStatus.log_jobs_done >= sessionStatus.log_jobs_total;
              const lineageNote =
                sessionStatus.lineage_mode && req ? " for the traced lineage" : "";
              // Phase-aware message: the scan can finish minutes before the
              // script completes (re-trace grace window + byte upload
              // drain) — say what is actually happening instead of a
              // stale "fetching… 24/24".
              const message =
                scanDone && imgs > 0 && upl < imgs
                  ? `Loaded ${sessionStatus.total_jobs} jobs — uploading image previews ${upl}/${imgs}${lineageNote}…`
                  : scanDone && imgs > 0
                    ? `Loaded ${sessionStatus.total_jobs} jobs — all ${imgs} log images ready${lineageNote}, finalizing…`
                    : `Loaded ${sessionStatus.total_jobs} jobs — fetching log images${lineageNote} ` +
                      `${sessionStatus.log_jobs_done}/${sessionStatus.log_jobs_total}` +
                      (imgs > 0 ? ` (${imgs} captured)` : "") +
                      "…";
              setState({
                status: "polling",
                message,
                token,
                startedAt,
                progress: {
                  done: sessionStatus.log_jobs_done,
                  total: Math.max(1, sessionStatus.log_jobs_total),
                  images: sessionStatus.log_images_count,
                  uploaded: sessionStatus.log_images_uploaded,
                },
                endJobUid: endJobUidSeen,
              });
            }
          } else {
            setState({
              status: "polling",
              message: "Capture session established — uploading job metadata…",
              token,
              startedAt,
              progress: null,
              endJobUid: endJobUidSeen,
            });
          }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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
              onLoadedRef.current?.(toLoaded(data, token));
              setState({
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
              return;
            }
          }
          // 404 on both endpoints → data not uploaded yet; keep polling.
        } catch {
          // network error — keep polling
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [state.status, state.token, state.startedAt]);

  return state;
}
