"use client";

import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "./components/cryosmart/site-chrome";
import { DataSourceCard, type LoadedMetadata } from "./components/cryosmart/data-source-card";
import { ConfigureCard, type TraceOptions } from "./components/cryosmart/configure-card";
import { LineagePreviewCard } from "./components/cryosmart/lineage-preview-card";
import { DownloadCard } from "./components/cryosmart/download-card";
import { HelpCard } from "./components/cryosmart/help-card";
import { HeroVisualization } from "./components/cryosmart/hero-visualization";
import { JobExplorerCard } from "./components/cryosmart/job-explorer-card";
import { RecentSessionsCard } from "./components/cryosmart/recent-sessions-card";
import { useImportedMetadata } from "./components/cryosmart/use-imported-metadata";
import { useKeyboardShortcuts } from "./components/cryosmart/use-keyboard-shortcuts";
import { recordSession, type RecentSession } from "@/lib/cryosmart/recent-sessions";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { ShieldCheck, Globe, Zap, FileCheck2, Loader2, CheckCircle2, AlertCircle, ArrowRight, MousePointer2, Keyboard } from "lucide-react";

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
  const [summary, setSummary] = useState<LineageSummary | null>(null);
  const [traceOptions, setTraceOptions] = useState<TraceOptions | null>({
    includePptx: true,
    includeImages: true,
    includeMaps: false,
    includeFinalResults: false,
  });

  // Auto-load bookmarklet-captured data when ?imported=<token> is in the URL.
  const importState = useImportedMetadata({
    onLoaded: (data) => {
      setLoaded({
        ...data,
        source: "bookmarklet",
      });
    },
  });

  // Global keyboard shortcuts.
  useKeyboardShortcuts({
    onTrace: () => {
      document.getElementById("configure")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onDownload: () => {
      document.getElementById("download")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onFocusSearch: () => {
      document.getElementById("job-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  });

  // Record a session whenever tracing succeeds.
  useEffect(() => {
    if (!summary || !loaded) return;
    recordSession({
      projectUid: summary.project_uid || loaded.projectUid,
      startJob: summary.start_uid || undefined,
      source: loaded.source,
      jobCount: loaded.jobCount,
      cryosmartOrigin: loaded.cryosmartOrigin,
      fileName: loaded.source === "upload" ? "uploaded.json" : undefined,
    });
  }, [summary, loaded]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-teal-50/40">
        {/* Subtle grid pattern overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#0d9488 1px, transparent 1px), linear-gradient(90deg, #0d9488 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Decorative gradient blobs */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            {/* Left: copy */}
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50/80 px-3 py-1 text-[11px] font-medium text-teal-700 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                </span>
                Chrome extension → Cross-browser web app
              </div>
              <h1 className="mt-5 text-[2rem] font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.5rem] lg:text-[3.25rem]">
                CryoSmart Lineage Tracer,
                <br />
                <span className="bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 bg-clip-text text-transparent">
                  reborn for the web
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-[14.5px] leading-[1.7] text-slate-600 sm:text-[15.5px]">
                Trace particle &amp; map lineage for any CryoSmart job. Build interactive HTML / SVG / PPTX
                reports and download the full bundle — including ChimeraX alignment scripts —
                right from your browser. No extension install required.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href="#data-source"
                  className="group inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-5 text-[13.5px] font-semibold text-white shadow-md shadow-teal-600/20 transition-all hover:bg-teal-700 hover:shadow-lg hover:shadow-teal-600/30"
                >
                  Get started
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#help"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 text-[13.5px] font-medium text-slate-700 backdrop-blur transition-all hover:border-slate-400 hover:bg-white"
                >
                  How does it work?
                </a>
              </div>

              {/* Quick stats / trust signals */}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <MousePointer2 className="h-3.5 w-3.5 text-teal-500" />
                  One-click bookmarklet capture
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Keyboard className="h-3.5 w-3.5 text-teal-500" />
                  Keyboard shortcuts
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-teal-500" />
                  Chrome · Firefox · Safari · Edge
                </span>
              </div>
            </div>

            {/* Right: visualization + feature cards */}
            <div className="space-y-4">
              {/* Animated lineage DAG */}
              <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-xl shadow-slate-900/5 backdrop-blur">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Live lineage trace preview
                  </span>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">
                    9 jobs · 9 edges
                  </span>
                </div>
                <HeroVisualization />
              </div>

              {/* Feature cards row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <FeatureCard
                  icon={<Globe className="h-4 w-4" />}
                  title="Cross-browser"
                  desc="Works everywhere"
                  tone="teal"
                />
                <FeatureCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="No install"
                  desc="Pure web app"
                  tone="emerald"
                />
                <FeatureCard
                  icon={<Zap className="h-4 w-4" />}
                  title="Client-side"
                  desc="Fast & private"
                  tone="cyan"
                />
                <FeatureCard
                  icon={<FileCheck2 className="h-4 w-4" />}
                  title="Full bundle"
                  desc="JSON · HTML · PPTX"
                  tone="teal"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Floating bookmarklet-import status banner */}
      {importState.status !== "idle" && (
        <div className="sticky top-14 z-30 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div
            className={`mt-2 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px] shadow-sm backdrop-blur ${
              importState.status === "loaded"
                ? "border-emerald-300 bg-emerald-50/90 text-emerald-900"
                : importState.status === "error" || importState.status === "expired"
                ? "border-rose-300 bg-rose-50/90 text-rose-900"
                : "border-teal-300 bg-teal-50/90 text-teal-900"
            }`}
          >
            {importState.status === "polling" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {importState.status === "loaded" && <CheckCircle2 className="h-3.5 w-3.5" />}
            {(importState.status === "error" || importState.status === "expired") && <AlertCircle className="h-3.5 w-3.5" />}
            <span className="flex-1">{importState.message}</span>
            {importState.token && (
              <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] opacity-70">{importState.token}</code>
            )}
          </div>
        </div>
      )}

      {/* Main workflow */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <RecentSessionsCard
            onReload={(session: RecentSession) => {
              // We can't fully reload the raw payload (it's not in localStorage),
              // but we can re-load the sample or scroll to the data source.
              if (session.source === "sample") {
                import("@/lib/cryosmart/sample-data").then(({ buildSampleExportedMetadata }) => {
                  const startJobNum = session.startJob ? parseInt(session.startJob.replace(/^J/i, ""), 10) : 10;
                  const sample = buildSampleExportedMetadata({ startJob: isNaN(startJobNum) ? 10 : startJobNum });
                  setLoaded({
                    raw: sample,
                    projectUid: sample.project_uid,
                    jobCount: sample.jobs.length,
                    source: "sample",
                  });
                });
              } else {
                // For upload / live / bookmarklet — scroll to data source so the
                // user can re-run the capture. We can't replay the original payload.
                document.getElementById("data-source")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          />
          <DataSourceCard loaded={loaded} onLoad={setLoaded} />

          <ConfigureCard
            loaded={loaded}
            summary={summary}
            onSummary={setSummary}
            onOptionsChange={setTraceOptions}
            initialOptions={traceOptions || undefined}
          />

          <LineagePreviewCard summary={summary} />

          <JobExplorerCard summary={summary} />

          <DownloadCard summary={summary} options={traceOptions} loaded={loaded} />

          <HelpCard />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tone: "teal" | "emerald" | "cyan";
}) {
  const toneMap = {
    teal: {
      bg: "from-teal-50 to-teal-100/40",
      border: "border-teal-200/60",
      iconBg: "bg-teal-100 text-teal-600",
      title: "text-teal-800",
      hoverBorder: "hover:border-teal-300",
    },
    emerald: {
      bg: "from-emerald-50 to-emerald-100/40",
      border: "border-emerald-200/60",
      iconBg: "bg-emerald-100 text-emerald-600",
      title: "text-emerald-800",
      hoverBorder: "hover:border-emerald-300",
    },
    cyan: {
      bg: "from-cyan-50 to-cyan-100/40",
      border: "border-cyan-200/60",
      iconBg: "bg-cyan-100 text-cyan-600",
      title: "text-cyan-800",
      hoverBorder: "hover:border-cyan-300",
    },
  };
  const t = toneMap[tone];
  return (
    <div
      className={`group rounded-xl border bg-gradient-to-br ${t.bg} ${t.border} ${t.hoverBorder} p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.iconBg} transition-transform group-hover:scale-110`}>
          {icon}
        </span>
        <span className={`text-[12.5px] font-semibold ${t.title}`}>{title}</span>
      </div>
      <p className="mt-1.5 pl-1 text-[11px] text-slate-500">{desc}</p>
    </div>
  );
}
