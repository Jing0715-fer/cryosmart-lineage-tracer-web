"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, ExternalLink, Copy, Activity, Microscope, Box, Layers, Maximize2, FileCode2 } from "lucide-react";
import { toast } from "sonner";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { buildLineageHtmlV2 } from "@/lib/cryosmart/report-html";
import { makePreview } from "@/lib/cryosmart/lineage";
import { LineageGraph } from "./lineage-graph";

interface Props {
  summary: LineageSummary | null;
}

export function LineagePreviewCard({ summary }: Props) {
  const [reportTab, setReportTab] = useState("stats");

  const reportHtml = useMemo(() => {
    if (!summary) return "";
    try {
      return buildLineageHtmlV2(summary);
    } catch (err) {
      return `<!doctype html><body style="font-family:monospace;padding:2rem;color:#b91c1c;">Failed to build report: ${(err as Error).message}</body>`;
    }
  }, [summary]);

  const previewText = useMemo(() => {
    if (!summary) return "";
    try { return makePreview(summary); } catch { return ""; }
  }, [summary]);

  const reportSrcDoc = useMemo(() => {
    if (!reportHtml) return "";
    // srcDoc renders the standalone HTML in an isolated iframe.
    return reportHtml;
  }, [reportHtml]);

  if (!summary) {
    return (
      <Card id="preview" className="scroll-mt-20 opacity-60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-300 text-[13px] font-bold text-white">3</span>
            <CardTitle className="text-lg">Lineage Preview</CardTitle>
          </div>
          <CardDescription className="mt-1.5 pl-9 text-[13px]">
            Load data and trace lineage above — the lineage graph, stats, and full HTML report will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-48 items-center justify-center text-[12px] text-slate-400">
          <div className="flex flex-col items-center gap-2">
            <Layers className="h-6 w-6 text-slate-300" />
            <span>No lineage traced yet.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="preview" className="scroll-mt-20">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">3</span>
          <CardTitle className="text-lg">Lineage Preview</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Interactive view of the traced lineage — same data layout as the original extension&apos;s report: left outline + right chain cards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Final Particles"
            value={summary.final_particle_count?.toLocaleString() ?? "—"}
            sub={summary.final_particle_count ? "particles" : "no particle output"}
          />
          <StatCard
            icon={<Microscope className="h-3.5 w-3.5" />}
            label="Micrographs"
            value={summary.final_micrograph_count?.toLocaleString() ?? "—"}
            sub={summary.final_micrograph_count ? "exposures" : "no exposure output"}
          />
          <StatCard
            icon={<Box className="h-3.5 w-3.5" />}
            label="Resolution"
            value={summary.final_resolution_A ? `${summary.final_resolution_A} Å` : "—"}
            sub={summary.final_resolution_A ? "FSC" : (summary.resolution_note?.slice(0, 22) || "FSC")}
          />
          <StatCard
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Jobs Traced"
            value={String(summary.nodes.length)}
            sub={`${summary.class_split_jobs?.length || 0} class splits`}
          />
        </div>

        <Tabs value={reportTab} onValueChange={setReportTab}>
          <TabsList className="grid w-full grid-cols-5 bg-slate-100 sm:w-auto sm:grid-cols-5">
            <TabsTrigger value="stats" className="text-[12px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Overview</TabsTrigger>
            <TabsTrigger value="graph" className="text-[12px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Graph</TabsTrigger>
            <TabsTrigger value="report" className="text-[12px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Report</TabsTrigger>
            <TabsTrigger value="mermaid" className="text-[12px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Mermaid</TabsTrigger>
            <TabsTrigger value="preview" className="text-[12px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="mt-3 space-y-3">
            <OverviewPanel summary={summary} />
          </TabsContent>

          <TabsContent value="graph" className="mt-3">
            <LineageGraph summary={summary} />
          </TabsContent>

          <TabsContent value="report" className="mt-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500">
                  Standalone HTML report rendered in an iframe — the same file you&apos;ll download as <code className="font-mono text-[10px]">{summary.project_uid}_{summary.start_uid}_lineage_report.html</code>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const w = window.open();
                      if (w) { w.document.write(reportHtml); w.document.close(); }
                    }}
                  >
                    <Maximize2 className="mr-1 h-3 w-3" /> Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const blob = new Blob([reportHtml], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_report.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="mr-1 h-3 w-3" /> HTML
                  </Button>
                </div>
              </div>
              <iframe
                srcDoc={reportSrcDoc}
                title="Lineage Report"
                className="h-[600px] w-full rounded-lg border border-slate-300 bg-white"
                sandbox="allow-same-origin allow-popups"
              />
            </div>
          </TabsContent>

          <TabsContent value="mermaid" className="mt-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500">
                  Mermaid <code className="font-mono text-[10px]">flowchart LR</code> source. Paste into <a href="https://mermaid.live" target="_blank" rel="noreferrer" className="text-teal-600 underline">mermaid.live</a> to render.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    if (!summary.focused_mermaid) return;
                    navigator.clipboard.writeText(summary.focused_mermaid);
                    toast.success("Mermaid source copied");
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
              <ScrollArea className="h-[400px] rounded-lg border border-slate-200 bg-slate-950 p-3">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-emerald-300">
                  {summary.focused_mermaid || "(no mermaid graph)"}
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-3">
            <ScrollArea className="h-[400px] rounded-lg border border-slate-200 bg-slate-950 p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200">
                {previewText || "(no preview text)"}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        <span className="text-teal-500">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold leading-tight text-slate-900">{value}</div>
      <div className="text-[10.5px] text-slate-400">{sub}</div>
    </div>
  );
}

function OverviewPanel({ summary }: { summary: LineageSummary }) {
  const nodes = summary.nodes || [];
  const importOrLeaf = summary.import_or_leaf_jobs || [];
  const classSplits = summary.class_split_jobs || [];
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const t = n.job_type || "unknown";
      m.set(t, (m.get(t) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Job type breakdown</div>
        <div className="space-y-1.5">
          {byType.slice(0, 8).map(([type, count]) => (
            <div key={type} className="flex items-center justify-between text-[11.5px]">
              <span className="font-mono text-slate-700">{type}</span>
              <Badge variant="outline" className="font-mono text-[10px]">{count}</Badge>
            </div>
          ))}
          {byType.length > 8 && <div className="text-[10.5px] text-slate-400">+ {byType.length - 8} more</div>}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Import / leaf jobs ({importOrLeaf.length})</div>
        <div className="space-y-1.5">
          {importOrLeaf.slice(0, 8).map((n) => (
            <div key={n.uid} className="flex items-center justify-between text-[11.5px]">
              <span className="font-mono text-slate-700">{n.uid}</span>
              <span className="text-[10.5px] text-slate-500">{n.job_type}</span>
            </div>
          ))}
          {importOrLeaf.length > 8 && <div className="text-[10.5px] text-slate-400">+ {importOrLeaf.length - 8} more</div>}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Class splits ({classSplits.length})</div>
        <div className="space-y-1.5">
          {classSplits.slice(0, 8).map((cs) => (
            <div key={cs.uid} className="flex items-center justify-between text-[11.5px]">
              <span className="font-mono text-slate-700">{cs.uid}</span>
              <span className="text-[10.5px] text-slate-500">{cs.classes?.length || 0} classes</span>
            </div>
          ))}
          {classSplits.length === 0 && <div className="text-[10.5px] text-slate-400">No class split jobs.</div>}
        </div>
      </div>
    </div>
  );
}
