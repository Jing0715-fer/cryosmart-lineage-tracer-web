"use client";

import { useEffect, useState } from "react";
import { SiteHeader, SiteFooter } from "./components/cryosmart/site-chrome";
import { DataSourceCard, type LoadedMetadata } from "./components/cryosmart/data-source-card";
import { ConfigureCard, type TraceOptions } from "./components/cryosmart/configure-card";
import { LineagePreviewCard } from "./components/cryosmart/lineage-preview-card";
import { DownloadCard } from "./components/cryosmart/download-card";
import { HelpCard } from "./components/cryosmart/help-card";
import { ScrollToTop } from "./components/cryosmart/scroll-to-top";
import { useImportedMetadata } from "./components/cryosmart/use-imported-metadata";
import { useSharedSummary } from "./components/cryosmart/use-shared-summary";
import { useKeyboardShortcuts } from "./components/cryosmart/use-keyboard-shortcuts";
import { recordSession } from "@/lib/cryosmart/recent-sessions";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { ShieldCheck, Globe, Zap, FileCheck2, Loader2, CheckCircle2, AlertCircle, ArrowRight, Keyboard } from "lucide-react";

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
  const [summary, setSummary] = useState<LineageSummary | null>(null);
  const [traceOptions, setTraceOptions] = useState<TraceOptions | null>({
    includePptx: false,
    includeImages: true,
    includeMaps: true,
    includeFinalResults: true,
  });

  const importState = useImportedMetadata({
    onLoaded: (data) => {
      setLoaded({
        ...data,
        source: "bookmarklet",
      });
    },
  });

  useSharedSummary((sharedSummary) => {
    setSummary(sharedSummary);
    setLoaded({
      raw: { jobs: sharedSummary.nodes || [] },
      projectUid: sharedSummary.project_uid || "P",
      jobCount: sharedSummary.nodes?.length || 0,
      source: "bookmarklet",
      cryosmartOrigin: sharedSummary.base_url,
    });
  });

  useKeyboardShortcuts({
    onTrace: () => {
      document.getElementById("configure")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onDownload: () => {
      document.getElementById("download")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  });

  useEffect(() => {
    if (!summary || !loaded) return;
    recordSession({
      projectUid: summary.project_uid || loaded.projectUid,
      startJob: summary.start_uid || undefined,
      source: loaded.source,
      jobCount: loaded.jobCount,
      cryosmartOrigin: loaded.cryosmartOrigin,
    });
  }, [summary, loaded]);

  const getBannerClass = () => {
    if (importState.status === "loaded") return "mt-2 flex items-center gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50/90 text-emerald-900 px-3 py-2 text-[12.5px] shadow-sm backdrop-blur";
    if (importState.status === "error" || importState.status === "expired") return "mt-2 flex items-center gap-2.5 rounded-lg border border-rose-300 bg-rose-50/90 text-rose-900 px-3 py-2 text-[12.5px] shadow-sm backdrop-blur";
    return "mt-2 flex items-center gap-2.5 rounded-lg border border-teal-300 bg-teal-50/90 text-teal-900 px-3 py-2 text-[12.5px] shadow-sm backdrop-blur";
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-teal-50/40">
        <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "linear-gradient(#0d9488 1px, transparent 1px), linear-gradient(90deg, #0d9488 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50/80 px-3 py-1 text-[11px] font-medium text-teal-700 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                </span>
                CryoSmart Lineage Tracer
              </div>
              <h1 className="mt-4 text-[2rem] font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.5rem] lg:text-[3rem]">
                CryoSmart Lineage Tracer,
                <br />
                <span className="bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 bg-clip-text text-transparent">web-based workflow</span>
              </h1>
              <p className="mt-4 max-w-xl text-[14px] leading-[1.7] text-slate-600 sm:text-[15px]">
                Trace particle and map lineage from CryoSmart. Build interactive HTML reports and download the full bundle with maps and images.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href="#data-source" className="group inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-5 text-[13.5px] font-semibold text-white shadow-md shadow-teal-600/20 transition-all hover:bg-teal-700 hover:shadow-lg hover:shadow-teal-600/30">
                  Get started
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a href="#help" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 text-[13.5px] font-medium text-slate-700 backdrop-blur transition-all hover:border-slate-400 hover:bg-white">
                  How does it work?
                </a>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FeatureCard icon={<Globe className="h-4 w-4" />} title="Cross-browser" desc="Works everywhere" tone="teal" />
                <FeatureCard icon={<ShieldCheck className="h-4 w-4" />} title="No install" desc="Pure web app" tone="emerald" />
                <FeatureCard icon={<Zap className="h-4 w-4" />} title="Smart Capture" desc="One-click extract" tone="cyan" />
                <FeatureCard icon={<FileCheck2 className="h-4 w-4" />} title="Full bundle" desc="JSON HTML Maps" tone="teal" />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-6 shadow-xl shadow-slate-900/5 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Smart Capture Mode</span>
                <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[10px] font-medium text-teal-700">Recommended</span>
              </div>
              <div className="space-y-3 text-[13px] text-slate-600">
                <p><strong>1. Open CryoSmart</strong> in your browser and navigate to your project</p>
                <p><strong>2. Copy the capture script</strong> from the Smart Capture panel below</p>
                <p><strong>3. Paste in browser console</strong> (F12 then Console tab)</p>
                <p><strong>4. Data auto-imports</strong> with session for maps and images</p>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
                <Keyboard className="h-3.5 w-3.5" />
                <span>Keyboard shortcut: Ctrl+Shift+T to trace lineage</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {importState.status !== "idle" && (
        <div className="sticky top-14 z-30 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className={getBannerClass()}>
            {importState.status === "polling" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {importState.status === "loaded" && <CheckCircle2 className="h-3.5 w-3.5" />}
            {(importState.status === "error" || importState.status === "expired") && <AlertCircle className="h-3.5 w-3.5" />}
            <span className="flex-1">{importState.message}</span>
            {importState.token && <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] opacity-70">{importState.token}</code>}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <DataSourceCard loaded={loaded} onLoad={setLoaded} />
          <ConfigureCard loaded={loaded} summary={summary} onSummary={setSummary} onOptionsChange={setTraceOptions} initialOptions={traceOptions || undefined} />
          <LineagePreviewCard summary={summary} session={loaded?.session ?? null} />
          <DownloadCard summary={summary} options={traceOptions} loaded={loaded} />
          <HelpCard />
        </div>
      </main>

      <ScrollToTop />
      <SiteFooter />
    </div>
  );
}

function FeatureCard({ icon, title, desc, tone }: { icon: React.ReactNode; title: string; desc: string; tone: "teal" | "emerald" | "cyan"; }) {
  const toneMap = {
    teal: { bg: "from-teal-50 to-teal-100/40", border: "border-teal-200/60", iconBg: "bg-teal-100 text-teal-600", title: "text-teal-800", hoverBorder: "hover:border-teal-300" },
    emerald: { bg: "from-emerald-50 to-emerald-100/40", border: "border-emerald-200/60", iconBg: "bg-emerald-100 text-emerald-600", title: "text-emerald-800", hoverBorder: "hover:border-emerald-300" },
    cyan: { bg: "from-cyan-50 to-cyan-100/40", border: "border-cyan-200/60", iconBg: "bg-cyan-100 text-cyan-600", title: "text-cyan-800", hoverBorder: "hover:border-cyan-300" },
  };
  const t = toneMap[tone];
  const divClass = "group rounded-xl border " + t.bg + " " + t.border + " " + t.hoverBorder + " p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md";
  const spanClass = "flex h-7 w-7 items-center justify-center rounded-lg " + t.iconBg + " transition-transform group-hover:scale-110";
  const titleClass = "text-[12.5px] font-semibold " + t.title;
  return (
    <div className={divClass}>
      <div className="flex items-center gap-2">
        <span className={spanClass}>{icon}</span>
        <span className={titleClass}>{title}</span>
      </div>
      <p className="mt-1.5 pl-1 text-[11px] text-slate-500">{desc}</p>
    </div>
  );
}