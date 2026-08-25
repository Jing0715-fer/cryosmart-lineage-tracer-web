"use client";

import { useEffect, useRef, useState } from "react";
import { decodeSummaryFromHash } from "@/lib/cryosmart/share-url";
import type { LineageSummary } from "@/lib/cryosmart/types";

export interface ShareState {
  status: "idle" | "decoding" | "loaded" | "error";
  message: string;
  summary: LineageSummary | null;
}

/**
 * Detects `#s=<base64url>` in the URL on client mount, decodes the shared
 * LineageSummary, and surfaces it via `state.summary`. The parent component
 * is expected to setLoaded/setSummary when state becomes "loaded".
 *
 * We always start in "idle" on both server and client to avoid hydration
 * mismatch (server can't read window.location).
 */
export function useSharedSummary(onLoaded?: (s: LineageSummary) => void) {
  const [state, setState] = useState<ShareState>({
    status: "idle",
    message: "",
    summary: null,
  });

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#s=")) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- set "decoding" status synchronously before starting the async decode so the UI shows a spinner immediately.
    setState({ status: "decoding", message: "Decoding shared lineage…", summary: null });

    let cancelled = false;
    decodeSummaryFromHash(hash)
      .then((summary) => {
        if (cancelled) return;
        if (summary && Array.isArray(summary.nodes) && summary.nodes.length > 0) {
          setState({
            status: "loaded",
            message: `Loaded shared lineage: ${summary.nodes.length} jobs, project ${summary.project_uid}, start ${summary.start_uid}.`,
            summary,
          });
          onLoadedRef.current?.(summary);
          // Clean the URL hash so refresh doesn't re-trigger.
          try {
            history.replaceState(null, "", window.location.pathname + window.location.search);
          } catch {
            // ignore
          }
        } else {
          setState({
            status: "error",
            message: "Shared link is empty or corrupt.",
            summary: null,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: `Failed to decode shared link: ${err instanceof Error ? err.message : String(err)}`,
          summary: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
