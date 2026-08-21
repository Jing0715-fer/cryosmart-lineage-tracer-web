"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Download, BookOpen, FlaskConical, Terminal, FileCode2, ArrowRight, Info, Share2 } from "lucide-react";

const HELPER_FILES = [
  {
    name: "CryoSmart_align_maps_check_view.py",
    desc: "Step 1: Opens all lineage maps in ChimeraX, tests 5 alignment hypotheses per terminal map (original + 3 axis flips + z-flip), picks the best by correlation, then optimises the 90° view by thumbnail coverage.",
    size: "32 KB",
    url: "/helpers/CryoSmart_align_maps_check_view.py",
  },
  {
    name: "CryoSmart_export_current_view_ppt.py",
    desc: "Step 2: After you manually adjust the camera in ChimeraX, runs `save` for each volume, white-balances & uniformly crops all PNGs, then substitutes them into the PPTX by matching the `name=\"CryoSmartImage:<key>\"` marker.",
    size: "14 KB",
    url: "/helpers/CryoSmart_export_current_view_ppt.py",
  },
  {
    name: "CryoSmart_auto_align_export_ppt.py",
    desc: "One-shot pipeline: combines scripts 1 + 2 into a single end-to-end run (alignment → view optimisation → export → PPTX substitution). Use this only when you want a fully automatic pass.",
    size: "42 KB",
    url: "/helpers/CryoSmart_auto_align_export_ppt.py",
  },
  {
    name: "rebuild_picture_flow_pptx.mjs",
    desc: "Standalone Node ESM script that rebuilds the Picture Flow PPTX from the lineage JSON (no pptxgenjs — hand-rolled OOXML + ZIP). Run with `node rebuild_picture_flow_pptx.mjs path/to/*_lineage.json`.",
    size: "27 KB",
    url: "/helpers/rebuild_picture_flow_pptx.mjs",
  },
];

export function HelpCard() {
  return (
    <Card id="help" className="scroll-mt-20">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700 text-[13px] font-bold text-white">
            <BookOpen className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Help & ChimeraX Helper Scripts</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          How to obtain the metadata JSON, the browser-portability verdict, and the four downloadable desktop helper scripts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Accordion type="single" collapsible defaultValue="feasibility" className="w-full">
          <AccordionItem value="feasibility" className="border-slate-200">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Info className="h-3.5 w-3.5 text-teal-600" />
                Can a web app fully replicate the Chrome extension?
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-[12.5px] leading-relaxed text-slate-600">
              <p className="mb-2">
                <strong className="text-slate-800">Yes, with one necessary design change.</strong> The original extension relied on injecting a content script into the CryoSmart tab to scrape job metadata out of the DOM and to reuse the user&apos;s same-origin session cookie. A web app on a different origin cannot do this (CORS + HttpOnly cookies).
              </p>
              <p className="mb-2">
                So we split the extension into three parts:
              </p>
              <ul className="mb-2 ml-5 list-disc space-y-1">
                <li><strong className="text-emerald-700">Pure JS logic (~6500 lines)</strong> — verbatim port. All the lineage tracing, BFS walk, HTML/SVG/PPTX report generation, and the hand-rolled ZIP writer run client-side.</li>
                <li><strong className="text-amber-700">DOM scraper (1575 lines)</strong> — replaced by three modes: (a) <em>Bookmarklet</em> (recommended) — drag a button to your bookmarks bar, then click it on the CryoSmart project page; it runs same-origin with your cookie auto-attached, captures the metadata, and opens the web app with everything loaded; (b) <em>JSON Upload</em> — you export metadata via the original extension or any REST call, then upload the file; (c) <em>Live Connect</em> — a Next.js API route <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">/api/cryosmart/[...path]</code> proxies authenticated requests to CryoSmart with a pasted cookie.</li>
                <li><strong className="text-rose-700">ChimeraX Python scripts (~2300 lines)</strong> — kept as downloadable desktop helpers. They require ChimeraX (UCSF molecular visualization software) which cannot run in a browser.</li>
              </ul>
              <p>
                The result is a web app that works in <strong>Chrome, Firefox, Safari, Edge</strong> — any browser that supports ES2020 — without installing any extension.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="how-to-export" className="border-slate-200">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <FileCode2 className="h-3.5 w-3.5 text-teal-600" />
                How do I get CryoSmart metadata into the web app?
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-[12.5px] leading-relaxed text-slate-600">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5">
                <p className="mb-1"><strong className="text-emerald-800">Option A — Bookmarklet (recommended, no cookie pasting)</strong></p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Go to the <em>Bookmarklet</em> tab above.</li>
                  <li>Drag the green <span className="font-medium">Capture CryoSmart</span> button to your browser&apos;s bookmarks bar (Ctrl/Cmd+Shift+B to show it).</li>
                  <li>Open CryoSmart in a normal tab and log in.</li>
                  <li>Navigate to a project page (URL like <code className="rounded bg-emerald-100 px-1 font-mono text-[10.5px]">http://your-cryosmart/#/projects/P52</code>).</li>
                  <li>Click the <span className="font-medium">Capture CryoSmart</span> bookmark.</li>
                  <li>A status box appears in the top-left; the web app opens in a new tab with all jobs auto-loaded. Click <span className="font-medium">Trace Lineage</span>.</li>
                </ol>
                <p className="mt-1.5 text-[11px] text-emerald-700">
                  <strong>Why this works:</strong> the bookmark runs <em>inside</em> the CryoSmart tab (same-origin), so the browser automatically attaches your session cookie — including HttpOnly cookies that JavaScript cannot read. No pasting, no token, works in Chrome/Firefox/Safari/Edge.
                </p>
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-800">
                  <strong>Troubleshooting:</strong> If clicking the bookmark opens a blank <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">about:blank</code> tab with an error, the bookmark URL was likely truncated or installed from a stale version. Fix:
                  <ol className="ml-4 mt-1 list-decimal space-y-0.5">
                    <li>Delete the old bookmark.</li>
                    <li>Hard-refresh the web app (Ctrl/Cmd+Shift+R).</li>
                    <li>Drag the <span className="font-medium">Capture CryoSmart</span> button from the Bookmarklet tab to your bookmarks bar again.</li>
                    <li>Make sure you click the bookmark from the <strong>bookmarks bar</strong> (not the bookmarks menu or a context-menu).</li>
                  </ol>
                </div>
              </div>
              <p className="mt-2"><strong>Option B (upload JSON file):</strong> Use the original Chrome extension&apos;s <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">可选：导出当前 Project 全部 metadata</code> button — it downloads a JSON file with all job metadata. Upload that file via the <em>Upload JSON</em> tab.</p>
              <p><strong>Option C (manual REST):</strong> Open CryoSmart, log in, open DevTools → Network. Navigate to your project page. Find the XHR call to one of these endpoints (CryoSmart deployments vary):</p>
              <pre className="rounded-md bg-slate-950 p-2.5 font-mono text-[10.5px] text-emerald-300">{`GET /api/projects/P52/jobs
GET /api/jobs?project_uid=P52
GET /api/projects/P52/metadata
GET /api/meteor/jobs?project_uid=P52`}</pre>
              <p>Right-click the request → <em>Copy response</em> → paste into a <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">.json</code> file. Upload here.</p>
              <p><strong>Option D (Live Connect with cookie paste):</strong> Use the <em>Live Connect</em> tab. Paste your CryoSmart base URL and the value of your session cookie (from DevTools → Application → Cookies). The web app&apos;s backend proxy will fetch the metadata for you. Most users should prefer Option A — it avoids manual cookie handling entirely.</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="chimerax" className="border-slate-200">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-teal-600" />
                ChimeraX helper scripts (desktop only)
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-slate-600">
                These four scripts ship inside every download bundle. They are <strong>not browser-portable</strong> — they require ChimeraX installed locally. Download them individually here if you only need the helpers.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {HELPER_FILES.map((f) => (
                  <div key={f.name} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                    <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-slate-800">{f.name}</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-slate-500">{f.size}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{f.desc}</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-7 shrink-0 text-[11px]">
                      <a href={f.url} download={f.name}>
                        <Download className="mr-1 h-3 w-3" /> Download
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600">
                <div className="mb-1 font-medium text-slate-700">Recommended ChimeraX workflow:</div>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Download the lineage bundle (above) and unzip.</li>
                  <li>Open ChimeraX, then run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">open CryoSmart_align_maps_check_view.py</code> — it writes <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">chimerax_rendered_maps/alignment_debug.log</code> + a manifest.</li>
                  <li>Inspect or manually rotate to your preferred view.</li>
                  <li>In the same session, run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">open CryoSmart_export_current_view_ppt.py</code> — it exports PNGs, white-balances them, and substitutes them into <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">{`*_picture_flow.pptx`}</code> as <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">{`*_chimerax.pptx`}</code>.</li>
                  <li>Or skip steps 3–4 and run <code className="rounded bg-slate-200 px-1 font-mono text-[10.5px]">CryoSmart_auto_align_export_ppt.py</code> for a one-shot automatic pass.</li>
                </ol>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="share" className="border-slate-200">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <Share2 className="h-3.5 w-3.5 text-teal-600" />
                How do I share a lineage with a colleague?
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-[12.5px] leading-relaxed text-slate-600">
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

          <AccordionItem value="port" className="border-slate-200">
            <AccordionTrigger className="text-[13px] hover:no-underline">
              <span className="flex items-center gap-2">
                <FlaskConical className="h-3.5 w-3.5 text-teal-600" />
                What was ported vs. replaced?
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-[12.5px] leading-relaxed text-slate-600">
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2.5 py-1.5">Component</th>
                      <th className="px-2.5 py-1.5">Lines</th>
                      <th className="px-2.5 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    <Row c="popup.js pure functions (lineage, HTML, SVG, PPTX, ZIP)" l="~6500" s="Ported verbatim to TS" tone="emerald" />
                    <Row c="popup.js chrome.* glue (tabs, downloads, scripting)" l="~600" s="Replaced with fetch + Blob + &lt;a download&gt;" tone="amber" />
                    <Row c="content.js DOM scraper" l="1575" s="Replaced with bookmarklet + JSON upload + REST proxy" tone="amber" />
                    <Row c="background.js (service worker)" l="37" s="Dropped (Blob download)" tone="rose" />
                    <Row c="rebuild_picture_flow_pptx.mjs (Node)" l="454" s="Ported to TS + kept as downloadable helper" tone="emerald" />
                    <Row c="3 ChimeraX Python scripts" l="~2300" s="Kept as downloadable desktop helpers" tone="rose" />
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3">
          <div className="flex items-start gap-2.5">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
            <div className="text-[12px] text-teal-900">
              <strong>Quick start (no CryoSmart):</strong> Click <em>Try Sample</em> in the Data Source card above, then <em>Trace Lineage</em>, then <em>Build &amp; download ZIP</em>.<br />
              <strong>With real CryoSmart:</strong> Go to the <em>Bookmarklet</em> tab, drag the green button to your bookmarks bar, open your CryoSmart project page, click the bookmark — the web app opens with everything auto-loaded.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ c, l, s, tone }: { c: string; l: string; s: string; tone: "emerald" | "amber" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <tr>
      <td className="px-2.5 py-1.5 text-slate-700">{c}</td>
      <td className="px-2.5 py-1.5 font-mono text-slate-500">{l}</td>
      <td className={`px-2.5 py-1.5 ${cls}`}>{s}</td>
    </tr>
  );
}
