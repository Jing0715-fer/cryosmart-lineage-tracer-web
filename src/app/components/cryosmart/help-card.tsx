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
// The ChimeraX desktop helpers are still 4 files, but the recommended
// workflow is the one-shot `CryoSmart_auto_align_export_ppt.py`; the
// two individual scripts are kept as advanced components for users who
// want manual control.

const HELPER_FILES = [
  {
    name: "CryoSmart_auto_align_export_ppt.py",
    desc: "Recommended one-shot pipeline: opens all lineage maps in ChimeraX, tests 5 alignment hypotheses per terminal map (original + 3 axis flips + z-flip), picks the best by correlation, optimises the 90° view by thumbnail coverage, exports PNGs, white-balances & uniformly crops them, then substitutes them into the PPTX by matching the `name=\"CryoSmartImage:<key>\"` marker.",
    size: "42 KB",
    url: "/helpers/CryoSmart_auto_align_export_ppt.py",
    recommended: true,
  },
  {
    name: "CryoSmart_align_maps_check_view.py",
    desc: "Advanced component (Step 1 of the manual workflow): the align + optimise half of the one-shot script — runs the 5-hypothesis alignment + 90° view optimisation, writes `chimerax_rendered_maps/alignment_debug.log` + a manifest, but does NOT export. Use this when you want to inspect intermediate state before exporting.",
    size: "32 KB",
    url: "/helpers/CryoSmart_align_maps_check_view.py",
    recommended: false,
  },
  {
    name: "CryoSmart_export_current_view_ppt.py",
    desc: "Advanced component (Step 2 of the manual workflow): the export half of the one-shot script — assumes alignment is already done. After you manually adjust the camera in ChimeraX, runs `save` for each volume, white-balances & uniformly crops all PNGs, then substitutes them into the PPTX.",
    size: "14 KB",
    url: "/helpers/CryoSmart_export_current_view_ppt.py",
    recommended: false,
  },
  {
    name: "rebuild_picture_flow_pptx.mjs",
    desc: "Standalone Node ESM script that rebuilds the Picture Flow PPTX from the lineage JSON (no pptxgenjs — hand-rolled OOXML + ZIP). Run with `node rebuild_picture_flow_pptx.mjs path/to/*_lineage.json`.",
    size: "27 KB",
    url: "/helpers/rebuild_picture_flow_pptx.mjs",
    recommended: false,
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
          <CardTitle className="text-lg">Help & ChimeraX Helper Scripts</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          How to capture CryoSmart metadata with the in-page Smart Capture console snippet, the browser-portability verdict, and the downloadable ChimeraX desktop helper scripts.
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
                  <li>The script extracts every job with full metadata + the CryoSmart session token, POSTs to <code className="rounded bg-slate-100 px-1 font-mono text-[10.5px] dark:bg-slate-800">/api/cryosmart/import</code>, and a new tab opens here at <code className="rounded bg-slate-100 px-1 font-mono text-[10.5px] dark:bg-slate-800">/?imported=…</code> with everything loaded.</li>
                </ol>
                <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <strong>Why this is the only method:</strong> it runs in the exact page context (never <code className="font-mono">about:blank</code>), no bookmark installation, no URL length limits, cookies + bearer token auto-attached (same-origin), and captures full Pinia-store metadata that the legacy bookmarklet could not. Works in Chrome / Firefox / Safari / Edge.
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <strong>Fallbacks (rarely needed):</strong> if you already have a metadata JSON file from a previous capture, you can still load it — open the Smart Capture card, paste the JSON into a <code className="font-mono">.json</code> file, and drag-drop it onto the page (the import endpoint accepts either form). For programmatic use, POST the JSON to <code className="font-mono">/api/cryosmart/import</code> directly.
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
                <li><strong className="text-rose-700 dark:text-rose-400">ChimeraX Python scripts (~2300 lines)</strong> — kept as downloadable desktop helpers. They require ChimeraX (UCSF molecular visualization software) which cannot run in a browser.</li>
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
                ChimeraX helper scripts (desktop only)
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                These four scripts ship inside every download bundle. They are <strong>not browser-portable</strong> — they require ChimeraX installed locally. Download them individually here if you only need the helpers.
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
                            recommended
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
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">Recommended ChimeraX workflow (one method):</div>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Download the lineage bundle (above) and unzip.</li>
                  <li>Open ChimeraX, then run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">open CryoSmart_auto_align_export_ppt.py</code> — this single script aligns all maps, optimises the 90° view, exports white-balanced cropped PNGs, and substitutes them into <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">{`*_picture_flow.pptx`}</code> as <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">{`*_chimerax.pptx`}</code>.</li>
                </ol>
                <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                  <strong>Advanced (manual control):</strong> if you need to inspect intermediate state, run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">CryoSmart_align_maps_check_view.py</code> first (writes <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">chimerax_rendered_maps/alignment_debug.log</code> + a manifest), inspect or manually rotate to your preferred view, then run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px] dark:bg-slate-800">CryoSmart_export_current_view_ppt.py</code> to export. These are the two halves of the one-shot script, kept as individual components.
                </div>
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
                    <Row c="rebuild_picture_flow_pptx.mjs (Node)" l="454" s="Ported to TS + kept as downloadable helper" tone="emerald" />
                    <Row c="3 ChimeraX Python scripts" l="~2300" s="Kept as downloadable desktop helpers" tone="rose" />
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
