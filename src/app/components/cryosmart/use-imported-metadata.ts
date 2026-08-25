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
              
              const loaded: LoadedMetadata = {
                raw: data.data.raw || { jobs: data.data.jobs },
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
