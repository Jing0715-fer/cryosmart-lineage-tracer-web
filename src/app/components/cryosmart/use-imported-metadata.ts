"use client";

import { useEffect, useRef, useState } from "react";
import type { LoadedMetadata } from "@/app/components/cryosmart/data-source-card";

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

/**
 * Watches the URL for `?imported=<token>`.
 * When found, polls /api/cryosmart/pending?token=<token>, and on success
 * calls `onLoaded` so the data flows into the regular DataSourceCard pipeline.
 *
 * The polling is necessary because the bookmarklet POSTs the data and then
 * immediately opens the web app — there's a race where the web app might
 * load before the POST has landed in the in-memory store. We poll for up
 * to ~20 seconds, then give up.
 */
export function useImportedMetadata(opts?: UseImportedOpts) {
  // Always start with idle state on both server and client to avoid hydration
  // mismatch. We detect ?imported=<token> in useEffect (client-only).
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

  // On client mount, check for ?imported=<token> in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const token = u.searchParams.get("imported");
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- set "polling" status synchronously before the polling effect picks it up, so the banner renders immediately.
    setState({
      status: "polling",
      message: "Waiting for CryoSmart metadata to arrive…",
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
      const MAX_ATTEMPTS = 40; // ~20 seconds at 500ms intervals
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
              const loaded: LoadedMetadata = {
                raw: data.data.raw || { jobs: data.data.jobs },
                projectUid: data.data.project_uid || "P",
                jobCount: data.data.jobs.length,
                source: "upload",
              };
              onLoadedRef.current?.(loaded);
              setState({
                status: "loaded",
                message: `Loaded ${data.data.jobs.length} jobs from CryoSmart bookmarklet.`,
                token,
                startedAt,
              });
              // Clean the URL: remove ?imported=...&pid=...
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
            // Not found yet — keep polling (race: POST hasn't landed yet).
          } else if (resp.status === 410) {
            setState({
              status: "expired",
              message: "Import token expired. Please re-run the CryoSmart bookmarklet.",
              token,
              startedAt,
            });
            return;
          }
        } catch {
          // Network error — keep polling.
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setState({
          status: "error",
          message: "Timed out waiting for CryoSmart metadata. Please try the bookmarklet again.",
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
