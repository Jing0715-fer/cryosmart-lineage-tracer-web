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

export interface ImportState {
  status: "idle" | "polling" | "loaded" | "error" | "expired" | "not-found";
  message: string;
  token: string | null;
  startedAt: number | null;
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

export function useImportedMetadata(opts?: UseImportedOpts) {
  const [state, setState] = useState<ImportState>({
    status: "idle",
    message: "",
    token: null,
    startedAt: null,
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
    // Synchronous setState here is intentional: we're transitioning from
    // "idle" (initial mount state) to "polling" once we detect an ?imported=
    // query param. This is a one-time mount-time transition driven by an
    // external value (URL), not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      status: "polling",
      message: "Waiting for CryoSmart metadata to arrive...",
      token,
      startedAt: Date.now(),
    });
  }, []);

  useEffect(() => {
    if (state.status !== "polling" || !state.token) return;
    let cancelled = false;
    const token = state.token;
    const startedAt = state.startedAt || Date.now();

    const poll = async () => {
      let attempt = 0;
      const MAX_ATTEMPTS = 40;
      while (!cancelled && attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
          const resp = await fetch(`/api/cryosmart/pending?token=${encodeURIComponent(token)}`, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          });
          if (cancelled) return;
          if (resp.ok) {
            const data = (await resp.json()) as PendingData;
            if (data.ok && data.data && Array.isArray(data.data.jobs) && data.data.jobs.length > 0) {
              const session = buildSessionFromPending(data.data);

              const mergedRaw = mergeLogImagesIntoRaw(
                data.data.raw || { jobs: data.data.jobs },
                data.data.job_log_images
              );

              const loaded: LoadedMetadata = {
                raw: mergedRaw,
                projectUid: data.data.project_uid || "P",
                jobCount: data.data.jobs.length,
                source: "upload",
                session,
              };
              onLoadedRef.current?.(loaded);
              setState({
                status: "loaded",
                message: session
                  ? `Loaded ${data.data.jobs.length} jobs from CryoSmart (session available for maps/images).`
                  : `Loaded ${data.data.jobs.length} jobs from CryoSmart.`,
                token,
                startedAt,
              });
              
              // Clean URL
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete("imported");
                url.searchParams.delete("pid");
                window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
              } catch {
                // ignore
              }
              return;
            }
          } else if (resp.status === 404) {
            // Keep polling
          } else if (resp.status === 410) {
            setState({
              status: "expired",
              message: "Import token expired. Please re-run the CryoSmart capture.",
              token,
              startedAt,
            });
            return;
          }
        } catch {
          // Network error — keep polling
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setState({
          status: "error",
          message: "Timed out waiting for CryoSmart metadata. Please try again.",
          token,
          startedAt,
        });
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [state.status, state.token, state.startedAt]);

  return state;
}
