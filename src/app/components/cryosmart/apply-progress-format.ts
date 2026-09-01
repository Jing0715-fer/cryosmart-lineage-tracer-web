"use client";

import { useEffect, useState } from "react";
import type { ApplyProgress } from "./use-imported-metadata";

/**
 * Shared presentation helpers for the v3.25 apply-phase indicator
 * (ApplyProgress) — used by BOTH the DataSourceCard badge and the capture
 * progress strip, so the numbers read identically in both places.
 */

/** Human byte label: 0.7 MB, 7.0 MB, 1.2 GB (KB below 1 MB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Elapsed-seconds label for an apply's wall clock ("4.2s"). */
export function applyElapsedSeconds(applying: ApplyProgress, now: number): number {
  return Math.max(0, (now - applying.startedAt) / 1000);
}

/** Average download speed in bytes/s over the apply's elapsed time. */
export function applySpeedBps(applying: ApplyProgress, now: number): number {
  const secs = applyElapsedSeconds(applying, now);
  if (secs <= 0.05 || applying.received <= 0) return 0;
  return applying.received / secs;
}

/**
 * Re-rendering clock for the elapsed timer — ticks ~5×/s while `active`,
 * stops entirely when idle. The applying state itself only changes at
 * ~4 Hz (throttled in useImportedMetadata); the elapsed SECONDS are
 * derived here so the hook never has to re-render the page per tick.
 */
export function useElapsedTick(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
