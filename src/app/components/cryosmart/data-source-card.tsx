"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2 } from 'lucide-react';
import { SmartCapturePanel } from './smart-capture-panel';
import type { CryoSmartSession } from '@/lib/cryosmart/proxy-client';
import type { ApplyProgress } from './use-imported-metadata';
import { formatBytes, useElapsedTick, applyElapsedSeconds, applySpeedBps } from './apply-progress-format';

export interface LoadedMetadata {
  raw: unknown;
  projectUid: string;
  jobCount: number;
  /** 'bookmarklet' = staged Smart-Capture session; 'upload' = legacy direct
   *  POST to /api/cryosmart/import; 'history' = restored from the on-disk
   *  capture history (images served by /api/cryosmart/history/<id>/image/). */
  source: 'upload' | 'bookmarklet' | 'history';
  session?: CryoSmartSession | null;
  cryosmartOrigin?: string;
}

interface Props {
  loaded: LoadedMetadata | null;
  /** v3.25: a /data snapshot is being downloaded/parsed/applied right now —
   *  big captures (590 jobs ≈ 7 MB) take seconds and previously looked like
   *  a dead page. Null when no apply is running. */
  applying?: ApplyProgress | null;
}

export function DataSourceCard({ loaded, applying }: Props) {
  return (
    <Card id="data-source" className="scroll-mt-28 overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-slate-50 to-teal-50/40 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">1</span>
              <CardTitle className="text-lg">Smart Capture</CardTitle>
            </div>
            <CardDescription className="mt-1.5 pl-9 text-[13px]">
              Extract complete job metadata from CryoSmart SPA, including input_slot_groups and params_spec.
              Session info is captured for map/image downloads.
            </CardDescription>
          </div>
          {applying ? (
            <ApplyingBadge applying={applying} />
          ) : loaded ? (
            <Badge variant="secondary" className="gap-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              <Check className="h-3.5 w-3.5" />
              {loaded.jobCount} jobs loaded
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-4">
        <SmartCapturePanel />

        {applying && <ApplyingProgress applying={applying} />}

        {loaded && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-slate-500">Loaded:</span>
              <span className="font-mono text-slate-700">project = {loaded.projectUid}</span>
              <span className="font-mono text-slate-700">jobs = {loaded.jobCount}</span>
              <span className="font-mono text-slate-700">source = {loaded.source}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Header badge while a snapshot is in flight: "Receiving 590 jobs (7.0 MB) · 4.2s…" */
function ApplyingBadge({ applying }: { applying: ApplyProgress }) {
  const now = useElapsedTick(true);
  const secs = applyElapsedSeconds(applying, now || applying.startedAt);
  const size = applying.total ?? applying.received;
  const jobsLabel = applying.jobs != null ? `${applying.jobs} jobs` : 'data';
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 bg-teal-100 text-teal-800 hover:bg-teal-100 dark:bg-teal-900/50 dark:text-teal-200"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Receiving {jobsLabel} ({formatBytes(size)}) · {secs.toFixed(1)}s…
    </Badge>
  );
}

/** Body progress panel: byte bar + speed while downloading, parse note after. */
function ApplyingProgress({ applying }: { applying: ApplyProgress }) {
  const now = useElapsedTick(true);
  const base = now || applying.startedAt;
  const secs = applyElapsedSeconds(applying, base);
  const pct =
    applying.phase === "download" && applying.total && applying.total > 0
      ? Math.min(100, Math.round((applying.received / applying.total) * 100))
      : null;
  const speed = applySpeedBps(applying, base);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Data apply progress"
      className="mt-4 rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800/60 dark:bg-teal-950/30"
    >
      <div className="flex items-center gap-2 text-[12px] font-medium text-teal-800 dark:text-teal-200">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="min-w-0 truncate">
          {applying.phase === "download"
            ? `Downloading snapshot from the capture session… ${secs.toFixed(1)}s`
            : `Applying ${applying.jobs ?? ""}${applying.jobs != null ? " jobs" : " snapshot"} to the graph — ${secs.toFixed(1)}s`}
        </span>
      </div>
      {applying.phase === "download" ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/90 ring-1 ring-inset ring-teal-100 dark:bg-slate-800 dark:ring-teal-900/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-[width] duration-300 ease-out"
              style={{ width: pct != null ? `${pct}%` : "100%" }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10.5px] text-teal-800/75 dark:text-teal-300/70">
            <span>
              {formatBytes(applying.received)}
              {applying.total ? ` / ${formatBytes(applying.total)}` : ""}
              {pct != null ? ` · ${pct}%` : ""}
            </span>
            {speed > 0 && <span>{formatBytes(speed)}/s</span>}
          </div>
        </>
      ) : (
        <p className="mt-1.5 pl-[22px] text-[11px] text-teal-700/80 dark:text-teal-300/70">
          Parsing {formatBytes(applying.received)} of JSON and rendering the lineage graph — the page may
          pause briefly.
        </p>
      )}
    </div>
  );
}
