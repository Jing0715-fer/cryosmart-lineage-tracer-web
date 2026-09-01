"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Download, Copy, Activity, Microscope, Box, Layers, Maximize2, ImageIcon, Loader2, CheckCircle2, AlertCircle, X, Square, Palette, Type } from "lucide-react";
import { toast } from "sonner";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { buildLineageHtmlV2, type ReportHtmlOptions } from "@/lib/cryosmart/report-html";
import {
  loadReportStyle,
  saveReportStyle,
  REPORT_TEMPLATES,
  DEFAULT_REPORT_STYLE,
  type ReportStyleConfig,
} from "@/lib/cryosmart/report-style";
import { prefetchImagesForReport } from "@/lib/cryosmart/image-embed";
import type { CryoSmartSession } from "@/lib/cryosmart/proxy-client";
import { makePreview } from "@/lib/cryosmart/lineage";
import { copyToClipboard } from "@/lib/cryosmart/clipboard";
import { LineageGraph } from "./lineage-graph";
import { ShareLineageButton } from "./share-lineage-button";
import { FscPlotViewer } from "./fsc-plot-viewer";
import type { ImportProgress, ApplyProgress } from "./use-imported-metadata";
import { formatBytes, useElapsedTick, applyElapsedSeconds, applySpeedBps } from "./apply-progress-format";

export type ImportStatusKind = "idle" | "polling" | "loaded" | "error" | "expired" | "not-found";

interface Props {
  summary: LineageSummary | null;
  /** Optional CryoSmart live session — when present, the preview iframe
   *  pre-fetches all referenced images as base64 data URLs so the report
   *  is fully self-contained (no remote/CORS/referrer issues). */
  session?: CryoSmartSession | null;
  /** Live capture progress — THE single progress bar of the whole app
   *  (user request: it lives here, next to the lineage it is filling in,
   *  instead of being duplicated in the banner and the Configure card). */
  importInfo?: {
    message: string;
    progress: ImportProgress | null;
    /** v3.16.1: counters frozen with the upload incomplete — the strip
     * shows an amber badge and emphasizes the Stop button. */
    uploadStalled?: boolean;
    /** v3.25: a /data snapshot apply is running (download → parse →
     *  render) — the strip adds a second row with byte progress so the
     *  multi-second apply of a big capture is visible HERE, where the
     *  popup page has auto-scrolled to. */
    applying?: ApplyProgress | null;
  } | null;
  /** Capture lifecycle state — "polling" renders the live strip;
   *  "loaded"/"error"/"expired" render the final message (dismissable). */
  importStatus?: ImportStatusKind;
  /** A staged Smart-Capture session produced the current data — the report
   *  prefetch (and the graph modal's) then SKIPS direct intranet image URLs
   *  (the capture script delivers bytes via the session-image channel;
   *  proxying direct URLs from the app server only grinds 10s timeouts). */
  stagedImport?: boolean;
  /** v3.16.1: manual escape hatch for a live capture — stops waiting and
   * keeps whatever data arrived so far (the user's "stuck at 263/268 with
   * no way to stop" case). Rendered as a Stop button on the polling strip. */
  onStopImport?: () => void;
}

export function LineagePreviewCard({ summary, session, importInfo, importStatus, onStopImport, stagedImport }: Props) {
  const [reportTab, setReportTab] = useState("stats");

  /* ── v3.17 report style (template / font / image mode / title) ──────
   * The report is no longer rendered inside the page (the old auto-sized
   * iframe is gone) — the user configures the style here, then opens the
   * report in a new tab or downloads the HTML. Persisted so reloads (and
   * the ZIP bundle, which reads it at build time) keep the choice. */
  const [reportStyle, setReportStyle] = useState<ReportStyleConfig>(DEFAULT_REPORT_STYLE);
  useEffect(() => {
    // Restore AFTER hydration (SSR renders defaults — reading localStorage
    // in the useState initializer would be a hydration mismatch). Same
    // nested-in-if pattern as DownloadCard's persisted-selections restore.
    const persisted = loadReportStyle();
    if (JSON.stringify(persisted) !== JSON.stringify(DEFAULT_REPORT_STYLE)) {
      // Synchronous one-time restore after hydration (mirrors the
      // DownloadCard pattern); flagged by react-hooks/set-state-in-effect
      // but deliberate — the ONLY alternative (initializer read) breaks SSR
      // hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReportStyle(persisted);
    }
  }, []);
  const updateReportStyle = <K extends keyof ReportStyleConfig>(key: K, value: ReportStyleConfig[K]) => {
    setReportStyle((prev) => {
      const next = { ...prev, [key]: value };
      saveReportStyle(next);
      return next;
    });
  };

  /* ── Live capture progress strip ───────────────────────────────────
   * The ONE progress UI in the app (banner + configure-card copies were
   * removed as duplicates). Shown while a staged capture streams, plus a
   * dismissable final message once it completes/fails. */
  const stripVisible =
    importStatus === "polling" ||
    ((importStatus === "loaded" || importStatus === "error" || importStatus === "expired") && !!importInfo?.message);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Derived dismissal (no effect needed): a dismissal applies to exactly
  // one (status, message) pair — a NEW capture (polling) or any changed
  // message always re-opens the strip.
  const stripKey = `${importStatus}:${importInfo?.message || ""}`;
  const stripDismissed = dismissedKey === stripKey && importStatus !== "polling";
  const progress = importInfo?.progress || null;
  const importPct = progress
    ? Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))
    : null;

  // Pre-fetch referenced images as base64 data URLs when a live session is
  // available AND the report is configured to embed them (v3.17: "remote"/
  // "none" modes skip the prefetch entirely — no wasted bandwidth, the
  // report rebuilds instantly from the live source instead).
  const [embeddedImages, setEmbeddedImages] = useState<Record<string, string> | null>(null);
  const [embeddingProgress, setEmbeddingProgress] = useState<string>("");
  const [embedFailed, setEmbedFailed] = useState(false);

  useEffect(() => {
    // v3.20: `session` is NO LONGER required — restored-from-history
    // captures (no live session) still prefetch their app-served history
    // image URLs so the report's blob:/file: contexts render the ui-tile /
    // log images as embedded data-URLs instead of relative paths that
    // cannot resolve there. Proxied intranet URLs are skipped inside
    // imageToBase64 when no session exists.
    if (!summary || reportStyle.imageMode !== "embed") {
      // Synchronous reset of local UI state when the summary/session goes
      // away or images are no longer embedded. This is a mount/dep-change
      // transition, not a cascading render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmbeddedImages(null);
      setEmbeddingProgress("");
      setEmbedFailed(false);
      return;
    }
    let cancelled = false;
    // Synchronous reset before kicking off the async prefetch — same as
    // above, a dep-change transition.
    setEmbeddedImages(null);
    setEmbedFailed(false);
    setEmbeddingProgress("Prefetching images for report preview…");
    prefetchImagesForReport(session ?? null, summary, (p) => {
      if (!cancelled) setEmbeddingProgress(p.message ?? "Embedding images…");
    }, { stagedImport })
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
  }, [summary, session, stagedImport, reportStyle.imageMode]);

  const reportHtml = useMemo(() => {
    if (!summary) return "";
    try {
      // The app's own origin — session-image URLs in the report become
      // ABSOLUTE so they survive the blob: context of the "Open" button
      // (relative srcs resolve fine in a same-document context but NOT
      // against a blob: opaque path). Undefined during SSR / non-browser
      // prerender, where the report is never actually rendered anyway.
      const webAppOrigin =
        typeof window !== "undefined" ? window.location.origin : undefined;
      // v3.17: the report is configured by the user (template / font /
      // image mode / title). Only "embed" mode consumes the prefetched
      // data-URLs — "remote" and "none" deliberately ignore them.
      const baseOpts: ReportHtmlOptions = {
        template: reportStyle.template,
        fontScale: reportStyle.fontScale,
        imageMode: reportStyle.imageMode,
        widthMode: reportStyle.widthMode,
        titleOverride: reportStyle.titleOverride,
        subtitle: reportStyle.subtitle,
        session: session ?? undefined,
        webAppOrigin,
      };
      const opts: ReportHtmlOptions | undefined =
        reportStyle.imageMode === "embed" && embeddedImages
          ? { ...baseOpts, embeddedImages }
          : baseOpts;
      return buildLineageHtmlV2(summary, opts);
    } catch (err) {
      return `<!doctype html><body style="font-family:monospace;padding:2rem;color:#b91c1c;">Failed to build report: ${(err as Error).message}</body>`;
    }
  }, [summary, embeddedImages, session, reportStyle]);

  /* NOTE: session is a legit dependency of the prefetch above; keep the
   * effect's dep list in sync if it changes. */

  const previewText = useMemo(() => {
    if (!summary) return "";
    try { return makePreview(summary); } catch { return ""; }
  }, [summary]);

  if (!summary) {
    return (
      <Card id="preview" className="scroll-mt-28 opacity-90">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-300 text-[13px] font-bold text-white dark:bg-slate-700">3</span>
            <CardTitle className="text-lg text-slate-700 dark:text-slate-300">Lineage Preview</CardTitle>
          </div>
          <CardDescription className="mt-1.5 pl-9 text-[13px]">
            Load data and trace lineage above — or restore a past capture from Capture History — and the lineage graph, stats, and full HTML report will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImportProgressStrip
            visible={stripVisible && !stripDismissed}
            status={importStatus}
            message={importInfo?.message || ""}
            progress={progress}
            pct={importPct}
            stalled={importInfo?.uploadStalled}
            applying={importInfo?.applying || null}
            onStop={onStopImport}
            onDismiss={() => setDismissedKey(stripKey)}
          />
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
              <span className="text-[10.5px] text-slate-400 dark:text-slate-500">Run Smart Capture above and click <strong className="text-teal-600 dark:text-teal-400">Trace Lineage</strong> (Ctrl+Enter).</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="preview" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">3</span>
          <CardTitle className="text-lg">Lineage Preview</CardTitle>
          <div className="ml-auto">
            <ShareLineageButton summary={summary} />
          </div>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Interactive view of the traced lineage — graph, stats, FSC and the exportable HTML report. Configure the report style in the <strong>Report</strong> tab, then open or download it; use <strong>Share</strong> to generate a linkable URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImportProgressStrip
          visible={stripVisible && !stripDismissed}
          status={importStatus}
          message={importInfo?.message || ""}
          progress={progress}
          pct={importPct}
          stalled={importInfo?.uploadStalled}
          applying={importInfo?.applying || null}
          onStop={onStopImport}
          onDismiss={() => setDismissedKey(stripKey)}
        />
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
            sub={summary.final_resolution_A ? "FSC" : "awaiting FSC"}
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
            <LineageGraph summary={summary} session={session ?? null} stagedImport={stagedImport} />
          </TabsContent>

          <TabsContent value="fsc" className="mt-3">
            <FscPlotViewer />
          </TabsContent>

          <TabsContent value="report" className="mt-3">
            {/* v3.17: the report is NO LONGER embedded in the page (the big
                auto-sized iframe is gone). The user picks a template +
                options here, then opens the standalone HTML in a new tab or
                downloads it. The same configuration flows into the ZIP
                bundle's report (read from localStorage at build time). */}
            <div className="space-y-3">
              {/* Template picker */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  <Palette className="h-3 w-3" />
                  报告样式模板
                  <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">选择后立即生效，下载 / 新标签页查看完整效果</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {REPORT_TEMPLATES.map((t) => {
                    const selected = reportStyle.template === t.id;
                    const isNew =
                      t.id === "blueprint" || t.id === "editorial" || t.id === "focus" || t.id === "industrial";
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => updateReportStyle("template", t.id)}
                        className={`group rounded-lg border p-2 text-left transition-colors ${
                          selected
                            ? "border-teal-400 bg-teal-50/60 ring-1 ring-teal-300 dark:border-teal-600 dark:bg-teal-950/40 dark:ring-teal-800"
                            : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                        }`}
                      >
                        {/* Mini style swatch — a pure-CSS mock of the template's
                            palette (NOT the report itself). */}
                        <div
                          className="mb-2 flex h-14 flex-col justify-between overflow-hidden rounded-md border p-2"
                          style={{ background: t.swatch.bg, borderColor: t.swatch.line }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`${t.swatch.fontClass} text-[13px] font-semibold leading-none`} style={{ color: t.swatch.fg }}>Aa</span>
                            <span className="h-[3px] w-8 rounded-full" style={{ background: t.swatch.accent }} />
                          </div>
                          <div className="space-y-1">
                            <div className="h-[3px] w-full rounded-full" style={{ background: t.swatch.line }} />
                            <div className="h-[3px] w-2/3 rounded-full" style={{ background: t.swatch.line }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[12.5px] font-medium ${selected ? "text-teal-700 dark:text-teal-300" : "text-slate-800 dark:text-slate-200"}`}>{t.label}</span>
                          {isNew && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-medium uppercase border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              新
                            </Badge>
                          )}
                          {selected && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-medium uppercase border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                              当前
                            </Badge>
                          )}
                          {t.id === "paper" && !selected && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-medium uppercase border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
                              默认
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500 dark:text-slate-400">{t.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Width / font scale / image mode */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SegmentedControl
                  icon={<Maximize2 className="h-3 w-3" />}
                  label="页面宽度"
                  options={[
                    { value: "full", label: "全宽" },
                    { value: "wide", label: "宽 (1680)" },
                    { value: "boxed", label: "适中 (1280)" },
                  ]}
                  value={reportStyle.widthMode}
                  onChange={(v) => updateReportStyle("widthMode", v as ReportStyleConfig["widthMode"])}
                />
                <SegmentedControl
                  icon={<Type className="h-3 w-3" />}
                  label="字号"
                  options={[
                    { value: "compact", label: "紧凑" },
                    { value: "standard", label: "标准" },
                    { value: "comfortable", label: "舒适" },
                  ]}
                  value={reportStyle.fontScale}
                  onChange={(v) => updateReportStyle("fontScale", v as ReportStyleConfig["fontScale"])}
                />
                <SegmentedControl
                  icon={<ImageIcon className="h-3 w-3" />}
                  label="图片"
                  options={[
                    { value: "embed", label: "嵌入 (自包含)" },
                    { value: "remote", label: "链接 (小体积)" },
                    { value: "none", label: "不含图片" },
                  ]}
                  value={reportStyle.imageMode}
                  onChange={(v) => updateReportStyle("imageMode", v as ReportStyleConfig["imageMode"])}
                />
              </div>

              {/* Custom title + note */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">报告标题</span>
                  <Input
                    value={reportStyle.titleOverride}
                    onChange={(e) => updateReportStyle("titleOverride", e.target.value)}
                    placeholder={`CryoSmart Lineage: ${summary.project_uid} / ${summary.start_uid}`}
                    className="h-8 text-[12px]"
                    maxLength={200}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">附注（作者 / 日期 / 备注）</span>
                  <Input
                    value={reportStyle.subtitle}
                    onChange={(e) => updateReportStyle("subtitle", e.target.value)}
                    placeholder="可选，显示在报告标题下方"
                    className="h-8 text-[12px]"
                    maxLength={300}
                  />
                </label>
              </div>

              {/* Image embedding status indicator — only meaningful in embed mode */}
              {reportStyle.imageMode === "embed" && (
                <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${
                  embedFailed
                    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : embeddedImages
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}>
                  {embedFailed || embeddedImages ? (
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
              {reportStyle.imageMode === "embed" && !session && !embeddedImages && !embedFailed && !embeddingProgress && null}
              {reportStyle.imageMode === "embed" && !session && embeddedImages && Object.keys(embeddedImages).length === 0 && (
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <ImageIcon className="h-3 w-3 shrink-0" />
                  <span>无会话内嵌图片 — 未嵌入的图将引用可直达的链接。</span>
                </div>
              )}

              {/* Actions: open in new tab / download */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
                <Button
                  size="sm"
                  className="h-8 bg-teal-600 text-[12px] hover:bg-teal-700"
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
                      // Popup blocked — fall back to a synthetic link click.
                      const a = document.createElement("a");
                      a.href = url;
                      a.target = "_blank";
                      a.rel = "noopener";
                      a.click();
                    }
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                  }}
                >
                  <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> 新标签页打开报告
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12px]"
                  onClick={() => {
                    const blob = new Blob([reportHtml], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_report.html`;
                    a.click();
                    // v3.24: revoke AFTER a delay (same policy as the bundle
                    // path) — the synchronous revoke raced the browser's
                    // download handshake in Safari-class engines and could
                    // cancel the download of the just-clicked blob URL.
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                    toast.success(`Downloaded CryoSmart_${summary.project_uid}_${summary.start_uid}_lineage_report.html`);
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> 下载 HTML
                </Button>
                <span className="ml-auto text-[10.5px] text-slate-400 dark:text-slate-500">
                  <code className="font-mono">CryoSmart_{summary.project_uid}_{summary.start_uid}_lineage_report.html</code>
                </span>
              </div>
              <p className="text-[10.5px] leading-snug text-slate-400 dark:text-slate-500">
                报告不再嵌入页面内展示 — 配置样式后通过上方按钮打开或下载。「Build &amp; download ZIP」中的 HTML 报告会使用同一份样式配置。
              </p>
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
                  onClick={async () => {
                    if (!summary.focused_mermaid) return;
                    // Shared helper: falls back to execCommand on LAN-HTTP
                    // deployments where navigator.clipboard is undefined —
                    // the bare writeText call used to throw an unhandled
                    // TypeError and silently copy nothing.
                    const ok = await copyToClipboard(summary.focused_mermaid);
                    if (ok) toast.success("Mermaid source copied");
                    else toast.error("Copy failed — select the text and press Ctrl/Cmd+C.");
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

/* ── Live capture progress strip ────────────────────────────────────────
 * The app's SINGLE progress UI for staged Smart Capture sessions. Lives in
 * the Lineage Preview card (right next to the lineage it is filling in) —
 * the old duplicates (page-level sticky banner + Configure-card panel) were
 * removed at the user's request.
 *   polling → teal live strip: spinner + message + progress bar + counters
 *   loaded → emerald final summary (dismissable)
 *   error/expired → rose message (dismissable) */
function ImportProgressStrip({
  visible,
  status,
  message,
  progress,
  pct,
  stalled,
  applying,
  onStop,
  onDismiss,
}: {
  visible: boolean;
  status?: ImportStatusKind;
  message: string;
  progress: ImportProgress | null;
  pct: number | null;
  /** v3.16.1: capture counters frozen with the upload incomplete. */
  stalled?: boolean;
  /** v3.25: /data snapshot apply in flight — second row with byte progress. */
  applying?: ApplyProgress | null;
  /** v3.16.1: manual stop — stop waiting and keep the data captured so far. */
  onStop?: () => void;
  onDismiss: () => void;
}) {
  if (!visible || !message) return null;
  const done = status === "loaded";
  const failed = status === "error" || status === "expired";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Capture progress"
      className={
        failed
          ? "rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 dark:border-rose-900/60 dark:bg-rose-950/30"
          : done
            ? "rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30"
            : "rounded-xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white/40 to-emerald-50/60 px-4 py-3 dark:border-teal-800/60 dark:from-teal-950/40 dark:via-transparent dark:to-emerald-950/30"
      }
    >
      <div className="flex items-center gap-2.5">
        {status === "polling" ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-300" />
          </span>
        ) : failed ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span
          className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${
            failed
              ? "text-rose-900 dark:text-rose-100"
              : done
                ? "text-emerald-900 dark:text-emerald-100"
                : "text-teal-900 dark:text-teal-100"
          }`}
        >
          {message}
        </span>
        {progress && pct !== null && (
          <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200/70 dark:bg-slate-900/70 dark:text-teal-300 dark:ring-teal-800/60">
            {pct}%
          </span>
        )}
        {status === "polling" && stalled && (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-300/70 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/60">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            no progress
          </span>
        )}
        {status === "polling" && onStop && (
          <button
            type="button"
            onClick={onStop}
            title="Stop waiting and keep the data captured so far (the capture script itself is not affected — close its CryoSmart tab to stop it too)"
            aria-label="Stop waiting and keep captured data"
            className={
              stalled
                ? "flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2.5 text-[11.5px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
                : "flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-teal-300 bg-white/80 px-2.5 text-[11.5px] font-medium text-teal-700 transition-colors hover:bg-white dark:border-teal-700 dark:bg-slate-900/70 dark:text-teal-300 dark:hover:bg-slate-800"
            }
          >
            <Square className="h-3 w-3 fill-current" />
            <span className="hidden sm:inline">Stop &amp; keep data</span>
            <span className="sm:hidden">Stop</span>
          </button>
        )}
        {status !== "polling" && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss capture message"
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {progress && pct !== null && (
        <div className="mt-2.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/90 ring-1 ring-inset ring-teal-100 dark:bg-slate-800 dark:ring-teal-900/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10.5px] text-teal-800/75 dark:text-teal-300/70">
            <span>
              {progress.done}/{progress.total} jobs scanned
            </span>
            <span>
              {progress.images} {progress.images === 1 ? "image" : "images"} captured
              {progress.uploaded > 0 ? ` · ${progress.uploaded} ready` : ""}
            </span>
          </div>
        </div>
      )}
      {applying && <StripApplyingRow applying={applying} />}
    </div>
  );
}

/** v3.25: the strip's apply-phase row — mirrors the DataSourceCard badge
 *  for users who landed on #preview (the capture popup auto-scrolls here,
 *  so the data card may be off-screen). Shows byte progress while the
 *  snapshot downloads and an elapsed timer through parse + render. */
function StripApplyingRow({ applying }: { applying: ApplyProgress }) {
  const now = useElapsedTick(true);
  const base = now || applying.startedAt;
  const secs = applyElapsedSeconds(applying, base);
  const speed = applySpeedBps(applying, base);
  const pct =
    applying.phase === "download" && applying.total && applying.total > 0
      ? Math.min(100, Math.round((applying.received / applying.total) * 100))
      : null;
  const jobsLabel = applying.jobs != null ? `${applying.jobs} jobs` : "snapshot";
  return (
    <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 ring-1 ring-inset ring-teal-100 dark:bg-slate-900/50 dark:ring-teal-900/50">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-teal-800 dark:text-teal-200">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span className="font-medium">
          {applying.phase === "download"
            ? `Receiving ${jobsLabel} (${formatBytes(applying.total ?? applying.received)}) · ${secs.toFixed(1)}s…`
            : `Applying ${jobsLabel} to the graph · ${secs.toFixed(1)}s…`}
        </span>
        {applying.phase === "download" && pct != null && (
          <span className="ml-auto rounded bg-teal-100/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-700 dark:bg-teal-900/60 dark:text-teal-300">
            {pct}%
          </span>
        )}
      </div>
      {applying.phase === "download" && (
        <div className="mt-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-teal-100/80 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-teal-500 transition-[width] duration-300 ease-out"
              style={{ width: pct != null ? `${pct}%` : "100%" }}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 font-mono text-[10px] text-teal-800/70 dark:text-teal-300/60">
            <span>
              {formatBytes(applying.received)}
              {applying.total ? ` / ${formatBytes(applying.total)}` : ""}
            </span>
            {speed > 0 && <span>{formatBytes(speed)}/s</span>}
          </div>
        </div>
      )}
    </div>
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

/* ── SegmentedControl ─────────────────────────────────────────────────
 * v3.17: a compact pill-group used by the Report tab's customisation
 * options (font scale / image mode). Renders as a labelled row with one
 * toggle button per option — keyboard accessible (real <button>s with
 * aria-pressed), 36px touch targets. */
function SegmentedControl({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </span>
      <div className="ml-auto flex gap-1" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={`h-7 min-w-[44px] rounded-md px-2 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-teal-600 text-white hover:bg-teal-700"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
