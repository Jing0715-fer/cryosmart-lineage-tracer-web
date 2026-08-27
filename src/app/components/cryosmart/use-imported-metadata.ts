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
    job_log_images?: Record<string, Array<{ fileid?: string; name?: string }>>;
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
  log_jobs_with_images: number;
  note: string;
}

export interface ImportProgress {
  /** Jobs scanned for log images so far (staged flow only). */
  done: number;
  /** Jobs the capture script plans to scan. */
  total: number;
  /** Log image refs received so far. */
  images: number;
}

export interface ImportState {
  status: "idle" | "polling" | "loaded" | "error" | "expired" | "not-found";
  message: string;
  token: string | null;
  startedAt: number | null;
  /** Live log-collection progress (staged flow; null until jobs are in). */
  progress: ImportProgress | null;
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
 * job object as `log_images: [{ fileid, name }]`. The lineage builder then
 * turns them into `/api/log_image/<fileid>` preview assets. Handles both
 * `{ jobs: [...] }` and bare-array raw payloads. No-op when the capture
 * didn't include log images.
 */
function mergeLogImagesIntoRaw(
  raw: unknown,
  jobLogImages: PendingData["data"]["job_log_images"]
): unknown {
  if (!jobLogImages) return raw;
  const attach = (j: unknown): unknown => {
    const job = j as { uid?: string } | null;
    if (
      job &&
      typeof job === "object" &&
      job.uid &&
      Array.isArray(jobLogImages[job.uid]) &&
      jobLogImages[job.uid].length > 0
    ) {
      return { ...job, log_images: jobLogImages[job.uid] };
    }
    return j;
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
    data.data.job_log_images
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

export function useImportedMetadata(opts?: UseImportedOpts) {
  const [state, setState] = useState<ImportState>({
    status: "idle",
    message: "",
    token: null,
    startedAt: null,
    progress: null,
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

      while (!cancelled) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          if (!cancelled) {
            setState({
              status: "error",
              message: "Timed out waiting for CryoSmart data — please re-run the capture script.",
              token,
              startedAt,
              progress: null,
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

          // Jobs are in — render the graph immediately (first time only)
          // and keep showing live log-collection progress.
          if (sessionStatus.has_data && !stagedLoaded) {
            stagedLoaded = true;
            try {
              const dataResp = await fetch(
                `/api/cryosmart/import/session/${encodeURIComponent(token)}/data`,
                { credentials: "same-origin", cache: "no-store" }
              );
              if (cancelled) return;
              if (dataResp.ok) {
                const data = (await dataResp.json()) as PendingData;
                if (data.ok && Array.isArray(data.data.jobs) && data.data.jobs.length > 0) {
                  onLoadedRef.current?.(toLoaded(data, token));
                }
              }
            } catch {
              // non-fatal: retried on the complete pass
            }
          }

          if (sessionStatus.status === "complete") {
            // Final snapshot (includes every streamed log image).
            try {
              const dataResp = await fetch(
                `/api/cryosmart/import/session/${encodeURIComponent(token)}/data`,
                { credentials: "same-origin", cache: "no-store" }
              );
              if (cancelled) return;
              if (dataResp.ok) {
                const data = (await dataResp.json()) as PendingData;
                if (data.ok && Array.isArray(data.data.jobs) && data.data.jobs.length > 0) {
                  onLoadedRef.current?.(toLoaded(data, token));
                  const nLogs = sessionStatus.log_images_count;
                  const withLogs = sessionStatus.log_jobs_with_images;
                  setState({
                    status: "loaded",
                    message:
                      nLogs > 0
                        ? `Captured ${data.data.jobs.length} jobs + ${nLogs} log images from ${withLogs} jobs.`
                        : `Captured ${data.data.jobs.length} jobs (no log images available on this CryoSmart build).`,
                    token,
                    startedAt,
                    progress: null,
                  });
                  cleanUrl();
                  return;
                }
              }
            } catch {
              // fall through — retry next tick
            }
          } else if (sessionStatus.has_data) {
            setState({
              status: "polling",
              message:
                `Loaded ${sessionStatus.total_jobs} jobs — fetching log images ` +
                `${sessionStatus.log_jobs_done}/${sessionStatus.log_jobs_total}` +
                (sessionStatus.log_images_count > 0
                  ? ` (${sessionStatus.log_images_count} captured)`
                  : "") +
                "…",
              token,
              startedAt,
              progress: {
                done: sessionStatus.log_jobs_done,
                total: Math.max(1, sessionStatus.log_jobs_total),
                images: sessionStatus.log_images_count,
              },
            });
          } else {
            setState({
              status: "polling",
              message: "Capture session established — uploading job metadata…",
              token,
              startedAt,
              progress: null,
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
