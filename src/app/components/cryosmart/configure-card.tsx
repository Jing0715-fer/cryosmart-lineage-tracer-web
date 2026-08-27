"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Loader2, Settings2, FileBox, Boxes, FileCheck2, PresentationIcon } from "lucide-react";
import type { LoadedMetadata } from "./data-source-card";
import type { ImportProgress } from "./use-imported-metadata";
import { buildSummary, normalizeLineageSummary, normalizeJobUid } from "@/lib/cryosmart/lineage";
import { DEFAULT_BASE_URL } from "@/lib/cryosmart/constants";
import type { JobMetadata, LineageSummary } from "@/lib/cryosmart/types";

export interface ImportPanelInfo {
  /** Live status message from the capture session (e.g. "Loaded 12 jobs — fetching log images 3/12…"). */
  message: string;
  /** Log-collection counters (null until the jobs array has been uploaded). */
  progress: ImportProgress | null;
}

interface Props {
  loaded: LoadedMetadata | null;
  summary: LineageSummary | null;
  onSummary: (s: LineageSummary | null) => void;
  onOptionsChange?: (o: TraceOptions) => void;
  initialOptions?: TraceOptions;
  /** True while a staged capture session is still streaming data in. */
  awaitingImport?: boolean;
  /** Live capture status rendered INSIDE this card, so the popup landing here never has to look elsewhere for progress. */
  importInfo?: ImportPanelInfo;
}

export interface TraceOptions {
  includePptx: boolean;
  includeImages: boolean;
  includeMaps: boolean;
  includeFinalResults: boolean;
}

export function ConfigureCard({ loaded, summary, onSummary, onOptionsChange, initialOptions, awaitingImport, importInfo }: Props) {
  const [startJob, setStartJob] = useState("");
  const [startJobDirty, setStartJobDirty] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [tracing, setTracing] = useState(false);
  const [traceLog, setTraceLog] = useState<string[]>([]);
  const [options, setOptions] = useState<TraceOptions>(initialOptions || {
    includePptx: true,
    includeImages: true,
    includeMaps: false,
    includeFinalResults: true,
  });
  // Brief teal glow on the Trace button when a new dataset lands —
  // draws the eye to the now-enabled primary action. Keyed by project+count
  // so the staged capture's second (final) snapshot does not re-trigger it.
  const [dataReadyFlash, setDataReadyFlash] = useState(false);
  const prevDatasetKeyRef = useRef("");
  const datasetKey = loaded ? `${loaded.projectUid || "P"}:${loaded.jobCount}` : "";

  /** Jobs array extracted from the loaded raw payload (handles both shapes). */
  const loadedJobs = useMemo<JobMetadata[]>(() => {
    if (!loaded) return [];
    const raw = loaded.raw as { jobs?: unknown[] } | unknown[] | null;
    if (Array.isArray(raw)) return raw as JobMetadata[];
    if (raw && typeof raw === "object" && Array.isArray((raw as { jobs?: unknown[] }).jobs)) {
      return (raw as { jobs: JobMetadata[] }).jobs;
    }
    return [];
  }, [loaded]);

  /**
   * Suggest a sensible default start job: the newest refinement-style job
   * (the final 3D result users usually trace from) within the last few jobs,
   * else the highest-numbered job in the project.
   */
  const suggestStartJob = useCallback((jobs: JobMetadata[]): string => {
    const withNum = jobs.filter(
      (j): j is JobMetadata & { uid: string } =>
        typeof j?.uid === "string" && /^J?\d+$/i.test(j.uid)
    );
    if (withNum.length === 0) {
      const first = jobs.find((j) => typeof j?.uid === "string" && j.uid);
      return (first?.uid as string) || "";
    }
    const num = (j: { uid: string }) => parseInt(j.uid.replace(/^J/i, ""), 10) || 0;
    const sorted = [...withNum].sort((a, b) => num(a) - num(b));
    const REFINE_RE = /refine|reconstruct|sharpen/i;
    for (let i = sorted.length - 1; i >= Math.max(0, sorted.length - 12); i--) {
      if (REFINE_RE.test(sorted[i].job_type || "")) return sorted[i].uid;
    }
    return sorted[sorted.length - 1].uid;
  }, []);

  const suggestedStartJob = useMemo(
    () => (loadedJobs.length ? suggestStartJob(loadedJobs) : ""),
    [loadedJobs, suggestStartJob]
  );
  // Derived value: the user's typed job wins once they edit the field;
  // until then the smart suggestion auto-fills the input.
  const effectiveStartJob = startJobDirty ? startJob : suggestedStartJob;

  /** Total log-image refs across the loaded jobs — the staged capture
   * streams these in AFTER the first snapshot, so this count is the
   * "data freshness" signal for the summary auto-refresh below. */
  const loadedLogImageCount = useMemo(
    () =>
      loadedJobs.reduce(
        (n, j) => n + ((j as { log_images?: unknown[] }).log_images?.length || 0),
        0
      ),
    [loadedJobs]
  );
  const dataVersion = loaded ? `${datasetKey}#${loadedLogImageCount}` : "";
  /** dataVersion the CURRENT summary was built from (set by handleTrace;
  * compared by the auto-refresh effect below). */
  const summaryBuiltFromRef = useRef("");

  useEffect(() => {
    if (!loaded) {
      prevDatasetKeyRef.current = "";
      return;
    }
    if (prevDatasetKeyRef.current === datasetKey) return;
    prevDatasetKeyRef.current = datasetKey;
    // Deferred so the setState is not synchronous inside the effect body
    // (react-compiler restriction).
    const t1 = setTimeout(() => setDataReadyFlash(true), 0);
    const t2 = setTimeout(() => setDataReadyFlash(false), 2600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [loaded, datasetKey]);

  const updateOptions = useCallback((patch: Partial<TraceOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      onOptionsChange?.(next);
      return next;
    });
  }, [onOptionsChange]);

  const effectiveProjectId = useMemo(() => {
    if (projectId) return projectId;
    if (loaded?.projectUid) return loaded.projectUid;
    return "P";
  }, [projectId, loaded]);

  const handleTrace = useCallback(async () => {
    if (!loaded) {
      toast.error("Load a data source first.");
      return;
    }
    setTracing(true);
    setTraceLog([]);
    onSummary(null);
    try {
      const startUid = normalizeJobUid(effectiveStartJob);
      const jobMetadata = loadedJobs as JobMetadata[];
      if (jobMetadata.length === 0) throw new Error("No jobs found in the loaded data.");

      // Friendly pre-flight validation (buildSummary would also throw, but
      // with a rawer message — this one suggests the obvious next step).
      const projectJobs = jobMetadata.filter(
        (j) => j && j.project_uid === effectiveProjectId && j.uid
      );
      if (projectJobs.length === 0) {
        throw new Error(
          `No jobs found for project ${effectiveProjectId} — check the Project ID field (loaded data has ${jobMetadata.length} job(s)).`
        );
      }
      if (!projectJobs.some((j) => String(j.uid) === startUid)) {
        const sug = suggestStartJob(projectJobs);
        throw new Error(
          `Job ${startUid} is not in project ${effectiveProjectId} (${projectJobs.length} jobs loaded)` +
            (sug ? `. Did you mean ${sug}?` : ".")
        );
      }

      setTraceLog((l) => [...l, `Building project jobs map (${jobMetadata.length} jobs)…`]);
      const baseUrl = loaded.session?.baseUrl || DEFAULT_BASE_URL;

      setTraceLog((l) => [...l, `Tracing upstream lineage from ${startUid}…`]);
      const summary = buildSummary(jobMetadata, effectiveProjectId, startUid, baseUrl);
      const normalized = normalizeLineageSummary(summary);
      summaryBuiltFromRef.current = dataVersion;
      onSummary(normalized);
      setTraceLog((l) => [...l, `Done. ${normalized.nodes.length} nodes, ${normalized.edges.length} edges.`]);
      toast.success(`Traced ${normalized.nodes.length} jobs upstream from ${startUid}`);
      // Jump to the Lineage Preview so the result is immediately visible.
      setTimeout(() => {
        document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTraceLog((l) => [...l, `Error: ${msg}`]);
      toast.error(`Trace failed: ${msg}`);
    } finally {
      setTracing(false);
    }
  }, [loaded, effectiveStartJob, loadedJobs, effectiveProjectId, suggestStartJob, onSummary, dataVersion]);

  /** Auto-refresh a summary that was traced DURING a staged capture: the
   *  final snapshot (with every streamed log image + uploaded byte) replaces
   *  `loaded`, but the already-built summary would otherwise stay stale —
   *  the user would see "Captured N images" yet no images in the graph or
   *  report. Rebuild silently with the SAME start_uid whenever the loaded
   *  data's log-image count grows past what the summary was built from. */
  useEffect(() => {
    if (!summary || !loaded || !summary.start_uid) return;
    if (!summaryBuiltFromRef.current) return; // nothing traced from THIS load yet
    if (summaryBuiltFromRef.current === dataVersion) return;
    summaryBuiltFromRef.current = dataVersion;
    try {
      const jobMetadata = loadedJobs as JobMetadata[];
      const baseUrl = loaded.session?.baseUrl || DEFAULT_BASE_URL;
      const next = normalizeLineageSummary(
        buildSummary(jobMetadata, summary.project_uid || effectiveProjectId, summary.start_uid, baseUrl)
      );
      onSummary(next);
      setTraceLog((l) => [
        ...l,
        `Log images finished arriving — refreshed lineage (${loadedLogImageCount} image refs attached).`,
      ]);
    } catch {
      // keep the previous summary — the manual Trace button still works
    }
  }, [loaded, summary, dataVersion, loadedJobs, loadedLogImageCount, effectiveProjectId, onSummary]);

  const importPct = importInfo?.progress
    ? Math.min(100, Math.round((importInfo.progress.done / Math.max(1, importInfo.progress.total)) * 100))
    : null;

  const startJobOptions = useMemo(() => {
    // Sorted newest-last so the browser datalist shows the tail (final jobs)
    // first while the user types.
    const withNum = loadedJobs
      .filter((j) => typeof j?.uid === "string" && j.uid)
      .sort((a, b) => {
        const na = parseInt(String(a.uid).replace(/^J/i, ""), 10) || 0;
        const nb = parseInt(String(b.uid).replace(/^J/i, ""), 10) || 0;
        return nb - na;
      });
    return withNum.slice(0, 1000);
  }, [loadedJobs]);

  return (
    <Card id="configure" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">2</span>
          <CardTitle className="text-lg">Configure & Trace Lineage</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Enter the start job ID. The tracer walks upstream via <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">input_slot_groups</code> connections (falling back to <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">parents[]</code>), classifying each job into particle / map / micrograph lineages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live capture progress — embedded here (not just in the top banner)
            so a popup that auto-lands on this section sees the stream without
            scrolling anywhere. */}
        {awaitingImport && importInfo && (
          <div
            className="rounded-xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white/40 to-emerald-50/60 px-4 py-3.5 dark:border-teal-800/60 dark:from-teal-950/40 dark:via-transparent dark:to-emerald-950/30"
            role="status"
            aria-live="polite"
            aria-label="Capture progress"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-300" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-teal-900 dark:text-teal-100">
                {importInfo.message}
              </span>
              {importInfo.progress && importPct !== null && (
                <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200/70 dark:bg-slate-900/70 dark:text-teal-300 dark:ring-teal-800/60">
                  {importPct}%
                </span>
              )}
            </div>
            {importInfo.progress && importPct !== null && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/90 ring-1 ring-inset ring-teal-100 dark:bg-slate-800 dark:ring-teal-900/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-[width] duration-500 ease-out"
                    style={{ width: `${importPct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10.5px] text-teal-800/75 dark:text-teal-300/70">
                  <span>{importInfo.progress.done}/{importInfo.progress.total} jobs scanned</span>
                  <span>
                    {importInfo.progress.images} {importInfo.progress.images === 1 ? "image" : "images"} captured
                    {importInfo.progress.uploaded > 0
                      ? ` · ${importInfo.progress.uploaded} ready`
                      : ""}
                  </span>
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-teal-700/80 dark:text-teal-300/60">
              {loaded
                ? "Lineage is ready to trace — log images keep streaming in as they arrive."
                : "Jobs will appear here automatically — no need to scroll or refresh."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-id" className="text-[12px] text-slate-600">Project ID</Label>
            <Input
              id="project-id"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder={loaded?.projectUid || "P52"}
              className="h-9 font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start-job" className="text-[12px] text-slate-600">
              Start Job
              {loadedJobs.length > 0 && (
                <span className="ml-1.5 font-normal text-slate-400">({loadedJobs.length} jobs loaded)</span>
              )}
            </Label>
            <Input
              id="start-job"
              list="start-job-options"
              value={effectiveStartJob}
              onChange={(e) => {
                setStartJob(e.target.value);
                setStartJobDirty(true);
              }}
              placeholder="10 or J10"
              className="h-9 font-mono text-[13px]"
              disabled={!loaded && awaitingImport}
              onKeyDown={(e) => { if (e.key === "Enter" && !tracing && loaded) handleTrace(); }}
            />
            <datalist id="start-job-options">
              {startJobOptions.map((j) => (
                <option key={String(j.uid)} value={String(j.uid)}>
                  {j.job_type || "unknown type"}
                </option>
              ))}
            </datalist>
          </div>
          <div className="flex flex-col justify-end gap-1.5">
            <Button
              onClick={handleTrace}
              disabled={!loaded || tracing}
              className={
                "h-9 w-full bg-teal-600 text-[13px] transition-shadow hover:bg-teal-700 " +
                (dataReadyFlash && loaded && !tracing
                  ? "ring-2 ring-teal-400 ring-offset-2"
                  : "")
              }
            >
              {tracing || (!loaded && awaitingImport) ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-4 w-4" />
              )}
              {tracing ? "Tracing…" : !loaded && awaitingImport ? "Waiting for data…" : "Trace Lineage"}
            </Button>
            {!loaded && !awaitingImport && (
              <p className="text-[10.5px] leading-snug text-slate-400">
                Load data in step 1 (Smart Capture, Upload, or Demo) first.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <Settings2 className="h-3 w-3" />
            Download bundle options
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <OptionCheckbox
              checked={options.includePptx}
              onChecked={(v) => updateOptions({ includePptx: v })}
              icon={<PresentationIcon className="h-3.5 w-3.5" />}
              title="Picture Flow PPTX"
              desc="Single A4 slide with embedded preview images (hand-rolled OOXML, no pptxgenjs)"
              tag="recommended"
            />
            <OptionCheckbox
              checked={options.includeImages}
              onChecked={(v) => updateOptions({ includeImages: v })}
              icon={<FileBox className="h-3.5 w-3.5" />}
              title="Preview images"
              desc="Micrograph / select-2D / class / map preview PNGs (requires session)"
              tag={loaded?.session ? "session" : "no session"}
            />
            <OptionCheckbox
              checked={options.includeMaps}
              onChecked={(v) => updateOptions({ includeMaps: v })}
              icon={<Boxes className="h-3.5 w-3.5" />}
              title="Map / MRC files"
              desc="Normal volume.map for every traced job (requires session)"
              tag={loaded?.session ? "session" : "no session"}
            />
            <OptionCheckbox
              checked={options.includeFinalResults}
              onChecked={(v) => updateOptions({ includeFinalResults: v })}
              icon={<FileCheck2 className="h-3.5 w-3.5" />}
              title="Final results package"
              desc="FSC / Guinier / Direction plots + final maps from the start job (requires session)"
              tag={loaded?.session ? "session" : "no session"}
            />
          </div>
        </div>

        {(traceLog.length > 0 || summary) && (
          <>
            <Separator />
            <div className="rounded-lg border border-slate-200 bg-slate-950 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Trace log</span>
                {summary && (
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    {summary.nodes.length} nodes · {summary.edges.length} edges
                  </Badge>
                )}
              </div>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-emerald-300">
                {traceLog.length > 0 ? traceLog.join("\n") : "Ready."}
              </pre>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OptionCheckbox({
  checked,
  onChecked,
  icon,
  title,
  desc,
  tag,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  tag?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
        checked ? "border-teal-300 bg-teal-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onChecked(v === true)} className="mt-0.5" />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">{icon}</span>
          <span className="text-[12.5px] font-medium text-slate-800">{title}</span>
          {tag && (
            <Badge
              variant="outline"
              className={`ml-auto px-1.5 py-0 text-[9.5px] font-medium uppercase ${
                tag === "live" ? "border-emerald-300 bg-emerald-50 text-emerald-700" :
                tag === "recommended" ? "border-teal-300 bg-teal-50 text-teal-700" :
                "border-slate-300 bg-slate-50 text-slate-500"
              }`}
            >
              {tag}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{desc}</p>
      </div>
    </label>
  );
}

// TraceOptions is exported above as an interface
