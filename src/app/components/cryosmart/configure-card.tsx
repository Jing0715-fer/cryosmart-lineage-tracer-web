"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Loader2, Settings2, FileBox, Boxes, Map as MapIcon, FileCheck2, PresentationIcon } from "lucide-react";
import type { LoadedMetadata } from "./data-source-card";
import { buildSummary, normalizeLineageSummary, normalizeJobUid } from "@/lib/cryosmart/lineage";
import { DEFAULT_BASE_URL } from "@/lib/cryosmart/constants";
import type { LineageSummary } from "@/lib/cryosmart/types";

interface Props {
  loaded: LoadedMetadata | null;
  summary: LineageSummary | null;
  onSummary: (s: LineageSummary | null) => void;
  onOptionsChange?: (o: TraceOptions) => void;
  initialOptions?: TraceOptions;
}

export interface TraceOptions {
  includePptx: boolean;
  includeImages: boolean;
  includeMaps: boolean;
  includeFinalResults: boolean;
}

export function ConfigureCard({ loaded, summary, onSummary, onOptionsChange, initialOptions }: Props) {
  const [startJob, setStartJob] = useState("10");
  const [projectId, setProjectId] = useState("");
  const [tracing, setTracing] = useState(false);
  const [traceLog, setTraceLog] = useState<string[]>([]);
  const [options, setOptions] = useState<TraceOptions>(initialOptions || {
    includePptx: true,
    includeImages: true,
    includeMaps: false,
    includeFinalResults: false,
  });

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
      const startUid = normalizeJobUid(startJob);
      // Normalize the raw payload to { jobs: [...] }
      let jobs: unknown[] = [];
      const raw = loaded.raw as { jobs?: unknown[] } | unknown[];
      if (Array.isArray(raw)) {
        jobs = raw;
      } else if (raw && typeof raw === "object" && Array.isArray((raw as { jobs?: unknown[] }).jobs)) {
        jobs = (raw as { jobs: unknown[] }).jobs;
      }
      if (jobs.length === 0) throw new Error("No jobs found in the loaded data.");

      setTraceLog((l) => [...l, `Building project jobs map (${jobs.length} jobs)…`]);
      const baseUrl = loaded.session?.baseUrl || DEFAULT_BASE_URL;
      const jobMetadata = jobs as unknown[] as import("@/lib/cryosmart/types").JobMetadata[];

      setTraceLog((l) => [...l, `Tracing upstream lineage from ${startUid}…`]);
      const summary = buildSummary(jobMetadata, effectiveProjectId, startUid, baseUrl);
      const normalized = normalizeLineageSummary(summary);
      onSummary(normalized);
      setTraceLog((l) => [...l, `Done. ${normalized.nodes.length} nodes, ${normalized.edges.length} edges.`]);
      toast.success(`Traced ${normalized.nodes.length} jobs upstream from ${startUid}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTraceLog((l) => [...l, `Error: ${msg}`]);
      toast.error(`Trace failed: ${msg}`);
    } finally {
      setTracing(false);
    }
  }, [loaded, startJob, effectiveProjectId, onSummary]);

  return (
    <Card id="configure" className="scroll-mt-20">
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
            <Label htmlFor="start-job" className="text-[12px] text-slate-600">Start Job</Label>
            <Input
              id="start-job"
              value={startJob}
              onChange={(e) => setStartJob(e.target.value)}
              placeholder="10 or J10"
              className="h-9 font-mono text-[13px]"
              onKeyDown={(e) => { if (e.key === "Enter" && !tracing && loaded) handleTrace(); }}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleTrace}
              disabled={!loaded || tracing}
              className="h-9 w-full bg-teal-600 text-[13px] hover:bg-teal-700"
            >
              {tracing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              {tracing ? "Tracing…" : "Trace Lineage"}
            </Button>
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
              desc="Micrograph / select-2D / class / map preview PNGs (requires Live Connect)"
              tag={loaded?.source === "live" ? "live" : "needs live"}
            />
            <OptionCheckbox
              checked={options.includeMaps}
              onChecked={(v) => updateOptions({ includeMaps: v })}
              icon={<Boxes className="h-3.5 w-3.5" />}
              title="Map / MRC files"
              desc="Normal volume.map for every traced job (requires Live Connect)"
              tag={loaded?.source === "live" ? "live" : "needs live"}
            />
            <OptionCheckbox
              checked={options.includeFinalResults}
              onChecked={(v) => updateOptions({ includeFinalResults: v })}
              icon={<FileCheck2 className="h-3.5 w-3.5" />}
              title="Final results package"
              desc="FSC / Guinier / Direction plots + 6 final maps from the start job (Live Connect)"
              tag={loaded?.source === "live" ? "live" : "needs live"}
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
