"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, ExternalLink, Copy, Activity, Microscope, Box, Layers, Maximize2, FileCode2, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { buildLineageHtmlV2, type ReportHtmlOptions } from "@/lib/cryosmart/report-html";
import { prefetchImagesForReport } from "@/lib/cryosmart/image-embed";
import type { CryoSmartSession } from "@/lib/cryosmart/proxy-client";
import { makePreview } from "@/lib/cryosmart/lineage";
import { LineageGraph } from "./lineage-graph";
import { ShareLineageButton } from "./share-lineage-button";
import { FscPlotViewer } from "./fsc-plot-viewer";

interface Props {
  summary: LineageSummary | null;
  /** Optional CryoSmart live session — when present, the preview iframe
   *  pre-fetches all referenced images as base64 data URLs so the report
   *  is fully self-contained (no remote/CORS/referrer issues). */
  session?: CryoSmartSession | null;
}

export function LineagePreviewCard({ summary, session }: Props) {
  const [reportTab, setReportTab] = useState("stats");
  const { resolvedTheme } = useTheme();

  // Auto-resize the report iframe to fit its content. The report HTML
  // posts { type: 'cryosmart-report-height', height } via postMessage once
  // it loads (and on every resize / image load). We listen for it here and
  // grow the iframe so the report flows naturally in the page — no cramped
  // fixed-height iframe, no double scrollbar. Clamped to [320, 4000] so a
  // misbehaving report can't collapse the iframe to 0 or grow it absurdly.
  const [iframeHeight, setIframeHeight] = useState(600);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; height?: number } | null;
      if (!data || data.type !== "cryosmart-report-height") return;
      const h = typeof data.height === "number" ? data.height : 0;
      if (h > 0) {
        // Clamp to a sensible range.
        const next = Math.max(320, Math.min(4000, Math.round(h)));
        // Only update if the change is meaningful (>4px) to avoid render thrash.
        setIframeHeight((prev) => (Math.abs(prev - next) > 4 ? next : prev));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Pre-fetch referenced images as base64 data URLs when a live session is
  // available. The resulting map is passed to buildLineageHtmlV2 so <img src>
  // becomes a data: URL — eliminating the iframe-referrer/CORS failure that
  // previously made images appear broken even though the URL was valid.
  const [embeddedImages, setEmbeddedImages] = useState<Record<string, string> | null>(null);
  const [embeddingProgress, setEmbeddingProgress] = useState<string>("");
  const [embedFailed, setEmbedFailed] = useState(false);

  useEffect(() => {
    if (!summary || !session) {
      // Synchronous reset of local UI state when the summary or session goes
      // away. This is a mount/dep-change transition, not a cascading render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmbeddedImages(null);
      setEmbeddingProgress("");
      setEmbedFailed(false);
      setIframeHeight(600);
      return;
    }
    let cancelled = false;
    // Synchronous reset before kicking off the async prefetch — same as
    // above, a dep-change transition.
    setEmbeddedImages(null);
    setEmbedFailed(false);
    setIframeHeight(600);
    setEmbeddingProgress("Prefetching images for report preview…");
    prefetchImagesForReport(session, summary, (msg) => {
      if (!cancelled) setEmbeddingProgress(msg);
    })
      .then((map) => {
        if (cancelled) return;
        const count = Object.keys(map).length;
        setEmbeddedImages(map);
        setEmbeddingProgress(count ? `${count} images embedded` : "No images could be embedded");
      })
      .catch(() => {
        if (!cancelled) {
          setEmbedFailed(true);
          setEmbeddingProgress("Image prefetch failed — falling back to remote URLs");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [summary, session]);

  const reportHtml = useMemo(() => {
    if (!summary) return "";
    try {
      const opts: ReportHtmlOptions | undefined = embeddedImages
        ? { embeddedImages, session: session ?? undefined }
        : session
          ? { session }
          : undefined;
      return buildLineageHtmlV2(summary, opts);
    } catch (err) {
      return `<!doctype html><body style="font-family:monospace;padding:2rem;color:#b91c1c;">Failed to build report: ${(err as Error).message}</body>`;
    }
  }, [summary, embeddedImages, session]);

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
      <Card id="preview" className="scroll-mt-20 opacity-90">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-300 text-[13px] font-bold text-white dark:bg-slate-700">3</span>
            <CardTitle className="text-lg text-slate-700 dark:text-slate-300">Lineage Preview</CardTitle>
          </div>
          <CardDescription className="mt-1.5 pl-9 text-[13px]">
            Load data and trace lineage above — the lineage graph, stats, and full HTML report will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Skeleton stat cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-2.5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="mt-1.5 h-5 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="mt-0.5 h-2 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
          {/* Skeleton tabs + content */}
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-7 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
          <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/40 text-[12px] text-slate-400 dark:border-slate-600 dark:bg-slate-900/40">
            <div className="flex flex-col items-center gap-2">
              <Layers className="h-6 w-6 text-slate-300 dark:text-slate-600" />
              <span>No lineage traced yet.</span>
              <span className="text-[10.5px] text-slate-400 dark:text-slate-500">Load data above and click <strong className="text-teal-600 dark:text-teal-400">Trace Lineage</strong> (Ctrl+Enter).</span>
            </div>
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
          <div className="ml-auto">
            <ShareLineageButton summary={summary} />
          </div>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Interactive view of the traced lineage — same data layout as the original extension&apos;s report: left outline + right chain cards. Use <strong>Share</strong> to generate a linkable URL.
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
          <TabsList className="grid w-full grid-cols-6 bg-slate-100 sm:w-auto sm:grid-cols-6">
            <TabsTrigger value="stats" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Overview</TabsTrigger>
            <TabsTrigger value="graph" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Graph</TabsTrigger>
            <TabsTrigger value="fsc" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">FSC</TabsTrigger>
            <TabsTrigger value="report" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Report</TabsTrigger>
            <TabsTrigger value="mermaid" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Mermaid</TabsTrigger>
            <TabsTrigger value="preview" className="text-[11.5px] data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="mt-3 space-y-3">
            <OverviewPanel summary={summary} />
          </TabsContent>

          <TabsContent value="graph" className="mt-3">
            <LineageGraph summary={summary} />
          </TabsContent>

          <TabsContent value="fsc" className="mt-3">
            <FscPlotViewer />
          </TabsContent>

          <TabsContent value="report" className="mt-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500">
                  Standalone HTML report rendered in an iframe — the same file you&apos;ll download as <code className="font-mono text-[10px]">{summary.project_uid}_{summary.start_uid}_lineage_report.html</code>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      // Open the report in a new tab via a Blob URL. This is
                      // more reliable than window.open()+document.write()
                      // (which popup blockers sometimes neuter into a blank
                      // window), and the resulting tab has a real browsing
                      // context so the full-width CSS + referrerpolicy
                      // handling work correctly. The blob URL is revoked
                      // after 30s — long enough for the tab to navigate
                      // back to it if the user reloads, short enough not to
                      // leak memory.
                      const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const w = window.open(url, "_blank");
                      if (!w) {
                        // Popup blocked — fall back to a same-tab navigation
                        // via a synthetic link click.
                        const a = document.createElement("a");
                        a.href = url;
                        a.target = "_blank";
                        a.rel = "noopener";
                        a.click();
                      }
                      setTimeout(() => URL.revokeObjectURL(url), 30000);
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
              {/* Image embedding status indicator */}
              {session && (
                <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${
                  embedFailed
                    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : embeddedImages
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}>
                  {embedFailed ? (
                    <ImageIcon className="h-3 w-3 shrink-0" />
                  ) : embeddedImages ? (
                    <ImageIcon className="h-3 w-3 shrink-0" />
                  ) : (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  )}
                  <span className="truncate">{embeddingProgress || "Preparing report images…"}</span>
                  {embeddedImages && Object.keys(embeddedImages).length > 0 && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] opacity-70">self-contained</span>
                  )}
                </div>
              )}
              {!session && (
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <ImageIcon className="h-3 w-3 shrink-0" />
                  <span>Images load directly from CryoSmart (no live session). If images appear broken, right-click → open in new tab, or use the &ldquo;Smart Capture&rdquo; mode to embed them.</span>
                </div>
              )}
              <iframe
                key={`report-${resolvedTheme || "light"}-${embeddedImages ? "embedded" : "remote"}`}
                srcDoc={reportSrcDoc}
                title="Lineage Report"
                style={{ height: `${iframeHeight}px` }}
                className="w-full rounded-lg border border-slate-300 bg-white transition-[height] duration-150 ease-out dark:border-slate-700"
                sandbox="allow-same-origin allow-scripts allow-popups allow-downloads"
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
  const isPlaceholder = value === "—" || value === "0";
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-white p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 ${
        isPlaceholder
          ? "border-slate-200/60 dark:border-slate-700/60"
          : "border-slate-200 hover:border-teal-300 dark:border-slate-700 dark:hover:border-teal-700"
      }`}
    >
      {/* Accent strip on hover */}
      {!isPlaceholder && (
        <div className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-teal-500 to-emerald-500 transition-transform duration-300 group-hover:scale-x-100" />
      )}
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className="text-teal-500 transition-transform group-hover:scale-110">{icon}</span>
        {label}
      </div>
      <div
        className={`mt-1 text-[18px] font-semibold leading-tight ${
          isPlaceholder ? "text-slate-400 dark:text-slate-600" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </div>
      <div className="text-[10.5px] text-slate-400 dark:text-slate-500">{sub}</div>
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
