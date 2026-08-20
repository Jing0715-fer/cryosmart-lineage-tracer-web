"use client";

import { useState } from "react";
import { SiteHeader, SiteFooter } from "./components/cryosmart/site-chrome";
import { DataSourceCard, type LoadedMetadata } from "./components/cryosmart/data-source-card";
import { ConfigureCard, type TraceOptions } from "./components/cryosmart/configure-card";
import { LineagePreviewCard } from "./components/cryosmart/lineage-preview-card";
import { DownloadCard } from "./components/cryosmart/download-card";
import { HelpCard } from "./components/cryosmart/help-card";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { ShieldCheck, Globe, Zap, FileCheck2 } from "lucide-react";

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
  const [summary, setSummary] = useState<LineageSummary | null>(null);
  const [traceOptions, setTraceOptions] = useState<TraceOptions | null>({
    includePptx: true,
    includeImages: true,
    includeMaps: false,
    includeFinalResults: false,
  });

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <SiteHeader />

      {/* Hero */}
      <section className="border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-teal-50/40">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-medium text-teal-700">
                <span className="flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                Chrome extension → Cross-browser web app
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
                CryoSmart Lineage Tracer, <span className="text-teal-600">reborn for the web</span>
              </h1>
              <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-slate-600 sm:text-[15px]">
                Trace particle &amp; map lineage for any CryoSmart job, build an interactive HTML / SVG / PPTX
                report, and download the full bundle — including ChimeraX alignment scripts —
                from any modern browser. No extension install required.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#data-source"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal-600 px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  Get started
                </a>
                <a
                  href="#help"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  How does it work?
                </a>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-3">
                <FeatureCard
                  icon={<Globe className="h-4 w-4" />}
                  title="Cross-browser"
                  desc="Chrome · Firefox · Safari · Edge"
                  tone="teal"
                />
                <FeatureCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="No install"
                  desc="Pure web app, no extension"
                  tone="emerald"
                />
                <FeatureCard
                  icon={<Zap className="h-4 w-4" />}
                  title="Client-side"
                  desc="All tracing runs in browser"
                  tone="cyan"
                />
                <FeatureCard
                  icon={<FileCheck2 className="h-4 w-4" />}
                  title="Full bundle"
                  desc="JSON · HTML · SVG · PPTX"
                  tone="teal"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main workflow */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <DataSourceCard loaded={loaded} onLoad={setLoaded} />

          <ConfigureCard
            loaded={loaded}
            summary={summary}
            onSummary={setSummary}
            onOptionsChange={setTraceOptions}
            initialOptions={traceOptions || undefined}
          />

          <LineagePreviewCard summary={summary} />

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
  const toneCls =
    tone === "teal"
      ? "from-teal-50 to-teal-100/50 text-teal-700 border-teal-200"
      : tone === "emerald"
      ? "from-emerald-50 to-emerald-100/50 text-emerald-700 border-emerald-200"
      : "from-cyan-50 to-cyan-100/50 text-cyan-700 border-cyan-200";
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneCls} p-3`}>
      <div className="flex items-center gap-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/70 text-current">{icon}</span>
        <span className="text-[12.5px] font-semibold">{title}</span>
      </div>
      <p className="mt-1 pl-1 text-[11px] opacity-80">{desc}</p>
    </div>
  );
}
