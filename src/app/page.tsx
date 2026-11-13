"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader, SiteFooter } from "./components/cryosmart/site-chrome";
import { DataSourceCard, type LoadedMetadata } from "./components/cryosmart/data-source-card";
import { CaptureHistoryCard } from "./components/cryosmart/capture-history-card";
import { ConfigureCard } from "./components/cryosmart/configure-card";
import { LineagePreviewCard } from "./components/cryosmart/lineage-preview-card";
import { DownloadCard } from "./components/cryosmart/download-card";
import { FlowFigureCard } from "./components/cryosmart/flow-figure-card";
import { HelpCard } from "./components/cryosmart/help-card";
import { ScrollToTop } from "./components/cryosmart/scroll-to-top";
import { useImportedMetadata } from "./components/cryosmart/use-imported-metadata";
import { useSharedSummary } from "./components/cryosmart/use-shared-summary";
import { useKeyboardShortcuts } from "./components/cryosmart/use-keyboard-shortcuts";
import {
  navigateToModule,
  setModuleNavigator,
  tabForAnchor,
  consumePendingScroll,
  scrollToModuleSection,
  type ModuleTabId,
} from "./components/cryosmart/module-nav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { saveSession } from "@/lib/cryosmart/proxy-client";
import {
  Database,
  Crosshair,
  GitBranch,
  ImageIcon,
  PackageOpen,
  CircleHelp,
  ArrowRight,
  Loader2,
} from "lucide-react";

/**
 * v3.76 (round-36 “完全重新设计UI界面，用横向标签显示每个模块，不要影响
 * 目前已有功能”): the page shell is now a HORIZONTAL TAB layout — the six
 * modules (数据 / 追踪 / 预览 / 流程图 / 下载 / 帮助) live as tabs on a
 * sticky bar instead of one long vertical stack.
 *
 * State preservation: every TabsContent is forceMount-ed and merely hidden
 * with `data-[state=inactive]:hidden`, so switching tabs NEVER unmounts a
 * module — the bridge probe, delivery settings, run logs, thumbnails and
 * trace results all survive a tab round-trip exactly as they did when the
 * cards were stacked (the no-behavior-change requirement).
 *
 * Navigation: all legacy anchor jumps (header nav, hero buttons, keyboard
 * shortcuts, post-trace / post-restore / imported-capture auto-jumps) route
 * through the module-nav bus (navigateToModule) so they switch the tab
 * first, then scroll. The URL hash mirrors the active tab (#module-flow),
 * and a restored hash picks the initial tab after a reload.
 */
const TAB_META: Array<{
  value: ModuleTabId;
  label: string;
  icon: React.ReactNode;
  anchor: string;
}> = [
  { value: "data", label: "数据", icon: <Database className="h-4 w-4" />, anchor: "data-source" },
  { value: "configure", label: "追踪", icon: <Crosshair className="h-4 w-4" />, anchor: "configure" },
  { value: "preview", label: "预览", icon: <GitBranch className="h-4 w-4" />, anchor: "preview" },
  { value: "flow", label: "流程图", icon: <ImageIcon className="h-4 w-4" />, anchor: "flow-figure" },
  { value: "download", label: "下载", icon: <PackageOpen className="h-4 w-4" />, anchor: "download" },
  { value: "help", label: "帮助", icon: <CircleHelp className="h-4 w-4" />, anchor: "help" },
];

function initialTab(): ModuleTabId {
  if (typeof window === "undefined") return "data";
  // Pre-mount bus call (a popup capture navigated before React mounted).
  try {
    const pending = window.sessionStorage.getItem("cryoflow.pendingTab");
    if (pending) {
      window.sessionStorage.removeItem("cryoflow.pendingTab");
      if (TAB_META.some((t) => t.value === pending)) return pending as ModuleTabId;
    }
  } catch {
    /* private mode */
  }
  // Restored hash (#module-flow / legacy #flow-figure).
  const hash = window.location.hash.replace(/^#/, "");
  const fromHash = tabForAnchor(hash === "" ? "" : hash.replace(/^module-/, ""));
  if (fromHash) return fromHash;
  return "data";
}

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);
  const [summary, setSummary] = useState<LineageSummary | null>(null);
  const [activeTab, setActiveTab] = useState<ModuleTabId>("data");
  /** Auto-trace anchor from a RESTORED capture-history entry (the capture's
   *  original end job). Lives until the next live capture / manual load
   *  replaces the dataset — ConfigureCard validates it against the loaded
   *  jobs, so a stale anchor can never trace a different project. */
  const [historyAnchorUid, setHistoryAnchorUid] = useState<string | null>(null);
  /** Bumped on every history restore — remounts ConfigureCard so its
   *  once-per-dataset auto-trace guard resets and the restored capture
   *  auto-traces even when an identical dataset was traced before. */
  const [restoreEpoch, setRestoreEpoch] = useState(0);

  const importState = useImportedMetadata({
    onLoaded: (data) => {
      setLoaded({
        ...data,
        source: "bookmarklet",
      });
      saveSession(data.session ?? null);
      // A live capture supersedes any restored-history anchor.
      setHistoryAnchorUid(null);
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
    setHistoryAnchorUid(null);
  });

  /* v3.76: mount the tab-navigation bus. A navigateToModule() call switches
   * the tab and (unless suppressed) scrolls to the module section once the
   * tab content is visible. */
  const tabRef = useRef(activeTab);
  useEffect(() => {
    tabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    setModuleNavigator((tab, opts) => {
      if (tabRef.current !== tab) setActiveTab(tab);
      if (opts.scroll) {
        const anchor = opts.anchor || TAB_META.find((t) => t.value === tab)?.anchor || "";
        // The tab content renders in the same frame for a switch (all tabs
        // stay mounted); a rAF lets the hidden→visible class flip land
        // before measuring the scroll target.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToModuleSection(anchor));
        });
      }
    });
    return () => setModuleNavigator(null);
  }, []);

  /* v3.76: initial tab (restored hash / pre-mount pending call), and a
   * pre-mount scroll request replays after mount. The setState rides a
   * rAF (React Compiler: no synchronous setState inside an effect body;
   * one frame of the default tab is invisible in practice). */
  useEffect(() => {
    const t = initialTab();
    if (t !== "data") {
      requestAnimationFrame(() => setActiveTab(t));
    }
    if (consumePendingScroll()) {
      requestAnimationFrame(() => scrollToModuleSection(TAB_META.find((x) => x.value === t)?.anchor || ""));
    }
  }, []);

  /* v3.76: mirror the active tab into the URL hash (replaceState — no
   * history spam; back/forward keeps working on browsers that restore
   * hashchange). */
  useEffect(() => {
    const wanted = `#module-${activeTab}`;
    if (window.location.hash !== wanted) {
      window.history.replaceState(null, "", wanted);
    }
  }, [activeTab]);

  /* v3.76: hashchange (manual hash edit / back button) switches tabs too. */
  useEffect(() => {
    const onHash = () => {
      const t = tabForAnchor(window.location.hash.replace(/^#module-/, ""));
      if (t) setActiveTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useKeyboardShortcuts({
    onTrace: () => {
      // v3.76: the trace button lives in the 追踪 tab — switch to it first
      // (the shortcut handler below then clicks the button wherever it is,
      // and the trace itself scrolls the 预览 tab via the bus).
      if (tabRef.current !== "configure") navigateToModule("configure", { scroll: true });
    },
    onDownload: () => {
      if (tabRef.current !== "download") navigateToModule("download", { scroll: true });
    },
    onShowHelp: () => {
      if (tabRef.current !== "help") navigateToModule("help", { scroll: true });
    },
  });

  // When the page is opened as a capture popup (/?imported=<token>), jump
  // to where the next action happens:
  //   - script ran on a JOB page (endJobUid) → everything is automatic
  //     (auto-trace + log-image streaming), so land on Lineage Preview
  //     where the single live progress strip + the filling-in graph live;
  //   - script ran on a project page → land on Configure & Trace, the
  //     manual Start Job + Trace step the user must complete.
  // The end_job_uid only arrives with the FIRST status poll (~1s), so the
  // landing decision waits for it — with a 2.5s fallback so a legacy
  // capture (no end_job_uid field at all) still lands somewhere promptly.
  // v3.76: the jumps ride the tab bus (tab switch first, scroll second).
  const importScrolledRef = useRef(false);
  useEffect(() => {
    if (importScrolledRef.current) return;
    if (importState.status !== "polling" || !importState.token) return;
    let decided = false;
    const decide = (anchor: string | null) => {
      if (decided || importScrolledRef.current) return;
      decided = true;
      importScrolledRef.current = true;
      navigateToModule(anchor ? "preview" : "configure");
    };
    if (importState.endJobUid) {
      decide(importState.endJobUid);
      return;
    }
    const t = setTimeout(() => decide(importState.endJobUid), 2500);
    return () => clearTimeout(t);
  }, [importState.status, importState.token, importState.endJobUid]);

  /* v3.76: per-tab status badges — the tabs stay informative at a glance
   * (job count on 数据, live-capture spinner on 预览, traced dot). Plain
   * function (no useCallback): it renders inline, nothing memoizes on it. */
  const badgeFor = (tab: ModuleTabId) => {
    if (tab === "data" && loaded?.jobCount) {
      return (
        <span className="ml-1.5 hidden rounded-full bg-teal-100 px-1.5 py-px text-[10px] font-semibold text-teal-700 sm:inline dark:bg-teal-900/50 dark:text-teal-300">
          {loaded.jobCount} jobs
        </span>
      );
    }
    if (tab === "preview") {
      if (importState.status === "polling") {
        return <Loader2 className="ml-1.5 h-3 w-3 animate-spin text-teal-600" />;
      }
      if (summary?.ok) {
        return <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="已追踪" />;
      }
    }
    return null;
  };

  const heroBadge = useMemo(() => {
    if (importState.status === "polling") return { text: `正在接收捕获…${importState.progress ?? ""}`, tone: "live" as const };
    if (summary?.ok) return { text: "谱系已就绪 — 可生成流程图 / 交付文件", tone: "ok" as const };
    if (loaded?.jobCount) return { text: `${loaded.jobCount} 个 job 已载入 — 去追踪`, tone: "ok" as const };
    return null;
  }, [importState.status, importState.progress, summary?.ok, loaded?.jobCount]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <SiteHeader activeTab={activeTab} onNavigate={setActiveTab} />

      {/* Compact hero — a single horizontal band; the tabs carry the
       * module navigation from here on. */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-teal-50/50">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#0d9488 1px, transparent 1px), linear-gradient(90deg, #0d9488 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8 lg:py-7">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50/80 px-3 py-1 text-[11px] font-medium text-teal-700 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                </span>
                CryoSmart Lineage Tracer
              </span>
              {heroBadge && (
                <span
                  className={
                    heroBadge.tone === "live"
                      ? "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                      : "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                  }
                >
                  {heroBadge.tone === "live" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {heroBadge.text}
                </span>
              )}
            </div>
            <h1 className="mt-2.5 text-[1.55rem] font-bold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
              工作流追踪 · 流程图 PPTX ·{" "}
              <span className="bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 bg-clip-text text-transparent">
                交付文件直写本地
              </span>
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-600 sm:text-[13.5px]">
              从 CryoSmart 捕获颗粒与 map 谱系，ChimeraX 对齐生成论文级流程 PPTX（手性已纠正），
              并把 map / FSC / Guinier / 角度分布 / fsc.xml 交付集直接写入您的数据目录。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => navigateToModule("data")}
              className="group inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-5 text-[13.5px] font-semibold text-white shadow-md shadow-teal-600/20 transition-all hover:bg-teal-700 hover:shadow-lg hover:shadow-teal-600/30"
            >
              开始使用
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={() => navigateToModule("flow")}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-5 text-[13.5px] font-medium text-slate-700 backdrop-blur transition-all hover:border-slate-400 hover:bg-white"
            >
              生成流程图
            </button>
            <button
              onClick={() => navigateToModule("help")}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-transparent px-4 text-[13.5px] font-medium text-slate-500 transition-all hover:text-slate-800 dark:hover:text-slate-200"
            >
              使用说明
            </button>
          </div>
        </div>
      </section>

      {/* The horizontal module tabs — sticky under the header, scrollable
       * on narrow screens, every module stays MOUNTED (forceMount +
       * hidden) so no tab switch ever drops state. */}
      <div id="module-tabs-bar" className="sticky top-14 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ModuleTabId)} className="min-w-0 gap-0">
          {/* The scroll box is this OUTER block (a block div is width-clamped
           * by its parent; the inline-flex TabsList alone would just grow to
           * its content and poke out of the viewport on phones). min-w-0:
           * this div is a flex item of the Tabs root — flex's min-width:auto
           * would otherwise let the content re-widen it past the viewport. */}
          <div className="mx-auto min-w-0 w-full max-w-7xl overflow-x-auto px-4 sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-auto w-max justify-start gap-1 rounded-none bg-transparent p-1.5 dark:bg-transparent">
              {TAB_META.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="h-9 flex-none gap-1.5 rounded-lg px-3 text-[13px] data-[state=active]:bg-teal-50 data-[state=active]:text-teal-800 data-[state=active]:shadow-sm dark:data-[state=active]:bg-teal-950/60 dark:data-[state=active]:text-teal-300"
                >
                  {t.icon}
                  <span>{t.label}</span>
                  {badgeFor(t.value)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <TabsContent value="data" forceMount className="data-[state=inactive]:hidden">
              <div className="space-y-6">
                {/* Data loading flows through useImportedMetadata's onLoaded hook
                 *  (staged capture / restore) — the card itself is display-only.
                 *  v3.25: `applying` drives the "Receiving N jobs (X MB) · Ys…"
                 *  badge + download bar while a /data snapshot is in flight. */}
                <DataSourceCard loaded={loaded} applying={importState.applying} />
                <CaptureHistoryCard
                  importToken={importState.token}
                  onRestore={(restored, anchorUid) => {
                    // Replace the whole working set: data + session, reset the trace,
                    // and auto-trace from the capture's original anchor job.
                    setLoaded(restored);
                    setSummary(null);
                    setHistoryAnchorUid(anchorUid);
                    setRestoreEpoch((n) => n + 1);
                    saveSession(restored.session ?? null);
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="configure" forceMount className="data-[state=inactive]:hidden">
              <ConfigureCard
                key={`configure-${restoreEpoch}`}
                loaded={loaded}
                summary={summary}
                onSummary={setSummary}
                awaitingImport={importState.status === "polling"}
                importToken={importState.status === "polling" ? importState.token : null}
                autoTraceJobUid={importState.endJobUid ?? historyAnchorUid}
              />
            </TabsContent>

            <TabsContent value="preview" forceMount className="data-[state=inactive]:hidden">
              <LineagePreviewCard
                summary={summary}
                session={loaded?.session ?? null}
                importInfo={
                  importState.status === "idle" || importState.status === "not-found"
                    ? null
                    : {
                        message: importState.message,
                        progress: importState.progress,
                        uploadStalled: importState.uploadStalled,
                        applying: importState.applying,
                        fetchAllJobs: importState.fetchAllJobs,
                        fetchAllRequested: importState.fetchAllRequested,
                      }
                }
                importStatus={importState.status}
                onStopImport={importState.status === "polling" ? importState.stop : undefined}
                onRequestAllLogs={importState.status === "polling" ? importState.requestAllLogs : undefined}
                stagedImport={importState.token !== null}
              />
            </TabsContent>

            <TabsContent value="flow" forceMount className="data-[state=inactive]:hidden">
              <FlowFigureCard summary={summary} loaded={loaded} />
            </TabsContent>

            <TabsContent value="download" forceMount className="data-[state=inactive]:hidden">
              <DownloadCard summary={summary} loaded={loaded} />
            </TabsContent>

            <TabsContent value="help" forceMount className="data-[state=inactive]:hidden">
              <HelpCard />
            </TabsContent>
          </main>
        </Tabs>
      </div>

      <ScrollToTop />
      <SiteFooter />
    </div>
  );
}
