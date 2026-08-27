"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Package, Loader2, Download, AlertTriangle, CheckCircle2, FileArchive } from "lucide-react";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { buildBundle, downloadBlob, type BundleProgress, type BundleResult } from "@/lib/cryosmart/bundle";
import type { TraceOptions } from "./configure-card";
import type { LoadedMetadata } from "./data-source-card";

interface Props {
  summary: LineageSummary | null;
  options: TraceOptions | null;
  loaded: LoadedMetadata | null;
}

const BUNDLE_FILES = [
  { name: "CryoSmart_*_lineage.json", desc: "Full normalized lineage summary", always: true },
  { name: "CryoSmart_*_lineage_report.html", desc: "Standalone interactive HTML report", always: true },
  { name: "CryoSmart_*_picture_flow.svg", desc: "A4 SVG picture flow", always: true },
  { name: "CryoSmart_*.mmd", desc: "Mermaid graph source", always: true },
  { name: "CryoSmart_*_preview.txt", desc: "Plain text preview", always: true },
  { name: "rebuild_picture_flow_pptx.mjs", desc: "Standalone Node PPTX rebuilder", always: true },
  { name: "CryoSmart_align_maps_check_view.py", desc: "ChimeraX alignment script", always: true },
  { name: "CryoSmart_export_current_view_ppt.py", desc: "ChimeraX export script", always: true },
  { name: "CryoSmart_auto_align_export_ppt.py", desc: "ChimeraX one-shot pipeline", always: true },
  { name: "CryoSmart_*_picture_flow.pptx", desc: "Picture flow PPTX (OOXML)", always: false },
  { name: "images/*", desc: "Preview images", always: false },
  { name: "maps/*", desc: "Map / MRC files", always: false },
  { name: "Final_Result/*", desc: "Final results package", always: false },
  { name: "download_warnings.txt", desc: "Errors log", always: false },
];

export function DownloadCard({ summary, options, loaded }: Props) {
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<BundleProgress | null>(null);
  const [result, setResult] = useState<BundleResult | null>(null);

  const handleBuild = useCallback(async () => {
    if (!summary || !options) {
      toast.error("Trace lineage first.");
      return;
    }
    setBuilding(true);
    setResult(null);
    setProgress({ phase: "init", current: 0, total: 1, message: "Starting…" });
    try {
      const res = await buildBundle(
        summary,
        {
          includePptx: options.includePptx,
          includeImages: options.includeImages,
          includeMaps: options.includeMaps,
          includeFinalResults: options.includeFinalResults,
          session: loaded?.session || null,
        },
        (p) => setProgress(p)
      );
      setResult(res);
      downloadBlob(res.blob, res.filename);
      toast.success(`Downloaded ${res.filename} (${res.fileCount} files)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Bundle build failed: ${msg}`);
    } finally {
      setBuilding(false);
    }
  }, [summary, options, loaded]);

  const enabled = !!summary && !!options;
  const phaseLabel = progress?.phase === "report" ? "Generating reports"
    : progress?.phase === "pptx" ? "Building PPTX"
    : progress?.phase === "images" ? "Fetching preview images"
    : progress?.phase === "maps" ? "Fetching maps"
    : progress?.phase === "final" ? "Scanning final results"
    : progress?.phase === "zip" ? "Zipping"
    : progress?.phase === "done" ? "Done"
    : "Idle";
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Card id="download" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">4</span>
          <CardTitle className="text-lg">Download Bundle</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Generate a single ZIP containing the JSON, HTML, SVG, Mermaid, preview text, PPTX, and ChimeraX helper scripts — same layout as the original extension.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {BUNDLE_FILES.map((f) => (
            <div
              key={f.name}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px] ${
                f.always ? "border-slate-200 bg-slate-50" : "border-dashed border-slate-200 bg-white"
              }`}
            >
              <FileArchive className={`h-3.5 w-3.5 shrink-0 ${f.always ? "text-slate-500" : "text-slate-400"}`} />
              <span className="font-mono text-slate-700">{f.name}</span>
              <span className="ml-auto truncate text-[10.5px] text-slate-500">{f.desc}</span>
              {f.always ? (
                <Badge variant="outline" className="ml-1 shrink-0 border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[9px] text-emerald-700">always</Badge>
              ) : (
                <Badge variant="outline" className="ml-1 shrink-0 border-slate-300 bg-slate-100 px-1.5 py-0 text-[9px] text-slate-500">optional</Badge>
              )}
            </div>
          ))}
        </div>

        {building && progress && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 font-medium text-teal-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phaseLabel}
              </span>
              <span className="font-mono text-[11px] text-teal-700">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5 bg-teal-100" />
            <div className="mt-1.5 font-mono text-[10.5px] text-teal-700">{progress.message}</div>
          </div>
        )}

        {result && !building && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-[12px]">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-slate-800">Bundle ready</span>
              <span className="font-mono text-slate-600">{result.filename}</span>
              <span className="ml-auto text-[11px] text-slate-500">{result.fileCount} files</span>
            </div>
            {result.warnings.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  {result.warnings.length} warning(s)
                </div>
                <ScrollArea className="mt-1 max-h-24">
                  <pre className="whitespace-pre-wrap font-mono text-[10px] text-amber-700">{result.warnings.join("\n")}</pre>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleBuild}
            disabled={!enabled || building}
            className="h-9 bg-teal-600 text-[13px] hover:bg-teal-700"
          >
            {building ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />}
            {building ? "Building…" : "Build & download ZIP"}
          </Button>
          {result && !building && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[13px]"
              onClick={() => downloadBlob(result.blob, result.filename)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Re-download
            </Button>
          )}
          {!enabled && (
            <span className="text-[11px] text-slate-400">
              {!summary ? "Trace lineage above to enable" : "No options selected"}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
