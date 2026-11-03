"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Download, BookOpen, FlaskConical, Terminal, FileCode2, ArrowRight, Info, Share2, Zap } from "lucide-react";

// After the master-branch consolidation, the data-source flow has been
// collapsed from 4 modes (Bookmarklet / Upload JSON / Live Connect /
// Try Sample) into ONE single method: Smart Capture (the console snippet
// shipped inside <SmartCapturePanel />). This Help card reflects that —
// the "how to get metadata" accordion now presents just one method.
//
// v3.73 (round-32): the four legacy picture-flow desktop helpers (the
// one-shot align+export ChimeraX script, its two components, and the
// standalone Node PPTX rebuilder) are REMOVED — the Workflow Figure
// card's relay bridge (CryoSmart_flow_relay.py) drives ChimeraX directly
// from the page (alignment, chirality, screenshots, deck assembly), so
// the downloadable list below carries just that bridge script.

const HELPER_FILES = [
  {
    name: "CryoSmart_flow_relay.py",
    desc: "The ChimeraX bridge script the Workflow Figure card drives: open it once inside ChimeraX (open https://<this-site>/api/cryosmart/flow-figure/relay.py) and the page can then command ChimeraX remotely — map download into a persistent local cache dir, 8-candidate dual-hand alignment, 90° view unification, screenshot return, reference-hand (EMalign) verification and delivery-file export. Keep ChimeraX open afterwards.",
    size: "66 KB",
    url: "/helpers/CryoSmart_flow_relay.py",
    recommended: true,
  },
];

export function HelpCard() {
  return (
    <Card id="help" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700 text-[13px] font-bold text-white">
            <BookOpen className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Help & ChimeraX Bridge</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          How to capture CryoSmart metadata with the in-page Smart Capture console snippet, the browser-portability verdict, and the ChimeraX bridge script for the one-click workflow figure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Accordion type="single" collapsible defaultValue="how-to-capture" className="w-full">
          <AccordionItem value="how-to-capture" className="border-slate-200 dark:border-slate-700">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-teal-600" />
                How do I get CryoSmart metadata into the web app?
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/30">
                <p className="mb-1">
                  <strong className="text-emerald-800 dark:text-emerald-300">Smart Capture — the only method you need</strong>
                </p>
                <p className="mb-2">
                  The web app now ships a single, reliable capture method that runs a script directly inside the CryoSmart page to read the Vue Pinia store. It returns full job metadata (input slot groups, params spec, output group images, UI tile images) <em>and</em> the session info needed to download maps and images later — no extension, no manual cookie paste, no JSON file export.
                </p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>In the <strong>Smart Capture</strong> card above, click <span className="font-medium">Open CryoSmart</span> and log in.</li>
                  <li>Navigate to your project page (URL like <code className="rounded bg-emerald-100 px-1 font-mono text-[10.5px] dark:bg-emerald-900/40">http://192.168.202.11:8080/#/projects/P259</code>) and wait for the jobs to render.</li>
                  <li>Press <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-800">F12</kbd> → open the <strong>Console</strong> tab.</li>
                  <li>Click <span className="font-medium">Copy Capture Script</span> in the Smart Capture card, paste into the console (Ctrl/Cmd+V), press Enter.</li>
                  <li>The script stages a capture session first (this tab opens immediately and shows live progress), then streams job metadata + log-image bytes to the session endpoints, and finishes with one <code className="rounded bg-slate-100 px-1 font-mono text-[10.5px] dark:bg-slate-800">/complete</code> call — the graph, report and every image fill in here live. Completed captures auto-archive to Capture History.</li>
                </ol>
                <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <strong>Why this is the only method:</strong> it runs in the exact page context (never <code className="font-mono">about:blank</code>), no bookmark installation, no URL length limits, cookies + bearer token auto-attached (same-origin), and captures full Pinia-store metadata that the legacy bookmarklet could not. Works in Chrome / Firefox / Safari / Edge.
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <strong>For programmatic use:</strong> the same import endpoint the script talks to is public — POST a previously captured metadata JSON to <code className="font-mono">/api/cryosmart/import</code> and open the returned <code className="font-mono">/?imported=…</code> link. This is the only fallback; there is no other capture method.
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="feasibility" className="border-slate-200 dark:border-slate-700">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Info className="h-3.5 w-3.5 text-teal-600" />
                Can a web app fully replicate the Chrome extension?
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              <p className="mb-2">
                <strong className="text-slate-800 dark:text-slate-200">Yes, with one necessary design change.</strong> The original extension relied on injecting a content script into the CryoSmart tab to scrape job metadata out of the DOM and to reuse the user&apos;s same-origin session cookie. A web app on a different origin cannot do this (CORS + HttpOnly cookies).
              </p>
              <p className="mb-2">So we split the extension into three parts:</p>
              <ul className="mb-2 ml-5 list-disc space-y-1">
                <li><strong className="text-emerald-700 dark:text-emerald-400">Pure JS logic (~6500 lines)</strong> — verbatim port. All the lineage tracing, BFS walk, HTML/SVG/PPTX report generation, and the hand-rolled ZIP writer run client-side.</li>
                <li><strong className="text-amber-700 dark:text-amber-400">DOM scraper (1575 lines)</strong> — replaced by <strong>Smart Capture</strong>: a console snippet you paste into the CryoSmart page&apos;s DevTools console. It runs same-origin with your cookie + bearer token auto-attached, reads the Vue Pinia store directly (so it captures full metadata the legacy DOM scraper could not), uploads it to this web app, and opens a new tab with everything loaded.</li>
                <li><strong className="text-rose-700 dark:text-rose-400">ChimeraX Python scripts (~2300 lines)</strong> — superseded by the <strong>ChimeraX relay bridge</strong>: the Workflow Figure card drives ChimeraX directly from the page (one <code className="font-mono">open …/relay.py</code> in ChimeraX, then alignment, chirality and screenshots all run remotely).</li>
              </ul>
              <p>
                The result is a web app that works in <strong>Chrome, Firefox, Safari, Edge</strong> — any browser that supports ES2020 — without installing any extension.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="chimerax" className="border-slate-200 dark:border-slate-700">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-teal-600" />
                ChimeraX 流程图与 helper 脚本（网页一键 + 桌面高级）
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3 dark:border-teal-800 dark:from-teal-950/30 dark:to-emerald-950/20">
                <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-teal-800 dark:text-teal-300">
                  <Zap className="h-3.5 w-3.5" />
                  方法一（推荐 · 网页一键）：Workflow Figure 卡片 + ChimeraX 桥
                </div>
                <ol className="ml-4 list-decimal space-y-1 text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
                  <li>完成 Smart Capture 与 Trace Lineage 后，滚动到 <strong>Workflow Figure · 一键流程图</strong> 卡片。</li>
                  <li>在 ChimeraX（1.12+，需 GPU 桌面版）的 Command Line 运行一次（卡片内可一键复制）：<code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">open https://&lt;本站&gt;/api/cryosmart/flow-figure/relay.py</code></li>
                  <li>点击卡片里的 <strong>生成流程图 PPTX</strong> —— 网页会自动驱动 ChimeraX：地图打开 → 5 候选拟合对齐（含 z-flip 手性检查与自动翻正）→ 90° 视角统一 → 1600×1200 截图回传 → 组装成 16:9 参考版式 PPTX 并下载。</li>
                  <li>若 ChimeraX 无法直读内网地图，页面自动改走中转（MRC 经本应用暂存 45 分钟）。若桥不可用，可用「会话预览图 / 演示样例」两种降级模式先生成。</li>
                </ol>
                <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <strong>与 ChimeraX 1.12 MCP 的关系：</strong>ChimeraX 的 <code className="font-mono">mcp start</code> 启动的是官方本地 REST server（供 Claude/Cursor 等 stdio bridge 使用），其 CORS 仅放行 localhost 网页。本桥使用同一内部机制（<code className="font-mono">session.ui.thread_safe</code> + 日志捕获），但 Origin 锁定为本应用，因此公网网页也能安全驱动；亦兼容官方 REST 通道（8080/8765/8650 自动探测，仅命令诊断）。
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                唯一需要的桌面脚本就是上面的桥接脚本（在 ChimeraX 中 open 一次即可）。旧的 A4 picture_flow PPTX 桌面链路（3 个 ChimeraX 脚本 + 独立 Node 重打包器）已在 v3.73 移除 — 网页流程图卡片已完全取代它们（对齐、手性、截图、组装全在网页内完成）：
              </p>
              <div className="grid grid-cols-1 gap-2">
                {HELPER_FILES.map((f) => (
                  <div
                    key={f.name}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 ${
                      f.recommended
                        ? "border-teal-300 bg-teal-50/40 dark:border-teal-700 dark:bg-teal-950/20"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                  >
                    <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-slate-800 dark:text-slate-200">{f.name}</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-slate-500 dark:text-slate-400">{f.size}</Badge>
                        {f.recommended && (
                          <Badge className="bg-teal-100 px-1.5 py-0 text-[9px] text-teal-700 hover:bg-teal-100 dark:bg-teal-900/40 dark:text-teal-300">
                            required for ChimeraX mode
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{f.desc}</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-7 shrink-0 text-[11px]">
                      <a href={f.url} download={f.name}>
                        <Download className="mr-1 h-3 w-3" /> Download
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="share" className="border-slate-200 dark:border-slate-700">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Share2 className="h-3.5 w-3.5 text-teal-600" />
                How do I share a lineage with a colleague?
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              <p>After tracing lineage, click the green <strong>Share</strong> button in the top-right of the Lineage Preview card.</p>
              <p>The web app compresses the full lineage summary (project IDs, job types, particle counts, edges) into a URL-safe base64url string appended to the page URL as <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">#s=...</code>.</p>
              <p>Your colleague opens the link → the web app decodes the hash automatically → the same graph, stats, and report render without them needing to load any data source.</p>
              <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>What&apos;s shared:</strong> job UIDs, types, particle counts, resolution, edges, Mermaid source.<br />
                <strong>What&apos;s NOT shared:</strong> image/map URLs (stripped — recipient re-fetches via their own CryoSmart session), your CryoSmart cookie, your name/email.<br />
                <strong>Size:</strong> ~1-10 KB for typical projects; up to ~48 KB before the app falls back to suggesting JSON download instead.
              </div>
              <p>The Share dialog also renders a QR code so you can scan it from a phone camera to open the lineage on mobile.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="port" className="border-slate-200 dark:border-slate-700">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <FlaskConical className="h-3.5 w-3.5 text-teal-600" />
                What was ported vs. replaced?
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <tr>
                      <th className="px-2.5 py-1.5">Component</th>
                      <th className="px-2.5 py-1.5">Lines</th>
                      <th className="px-2.5 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
                    <Row c="popup.js pure functions (lineage, HTML, SVG, PPTX, ZIP)" l="~6500" s="Ported verbatim to TS" tone="emerald" />
                    <Row c="popup.js chrome.* glue (tabs, downloads, scripting)" l="~600" s="Replaced with fetch + Blob + &lt;a download&gt;" tone="amber" />
                    <Row c="content.js DOM scraper" l="1575" s="Replaced with Smart Capture console snippet" tone="amber" />
                    <Row c="background.js (service worker)" l="37" s="Dropped (Blob download)" tone="rose" />
                    <Row c="rebuild_picture_flow_pptx.mjs (Node)" l="454" s="Removed in v3.73 — the Workflow Figure card builds the deck in-page" tone="rose" />
                    <Row c="3 ChimeraX Python scripts" l="~2300" s="Removed in v3.73 — superseded by the relay bridge (relay.py)" tone="rose" />
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3 dark:border-teal-800 dark:from-teal-950/30 dark:to-emerald-950/20">
          <div className="flex items-start gap-2.5">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
            <div className="text-[12px] text-teal-900 dark:text-teal-200">
              <strong>Quick start:</strong> Click <em>Open CryoSmart</em> in the Smart Capture card above, log in, navigate to your project, press <kbd className="rounded border border-teal-300 bg-white px-1 font-mono text-[10px] dark:border-teal-700 dark:bg-slate-800">F12</kbd> → Console, click <em>Copy Capture Script</em>, paste into the console, press Enter — a new tab opens here with everything auto-loaded (project, jobs, session for maps/images).
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ c, l, s, tone }: { c: string; l: string; s: string; tone: "emerald" | "amber" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700 dark:text-emerald-400" : tone === "amber" ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400";
  return (
    <tr>
      <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-200">{c}</td>
      <td className="px-2.5 py-1.5 font-mono text-slate-500 dark:text-slate-400">{l}</td>
      <td className={`px-2.5 py-1.5 ${cls}`}>{s}</td>
    </tr>
  );
}
