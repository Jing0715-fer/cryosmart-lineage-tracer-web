"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Download, BookOpen, FlaskConical, Terminal, FileCode2, ArrowRight, Info, Share2 } from "lucide-react";

/**
 * Helper scripts shipped in every download bundle + individually downloadable.
 *
 * NOTE (updated to current project situation): the ChimeraX pipeline now has
 * a SINGLE end-to-end method — `CryoSmart_auto_align_export_ppt.py` (internal
 * name `CryoSmart_align_optimize_export.py`, docstring "一键完成"). It runs
 * alignment → view optimisation → export → PPTX substitution in one go.
 * The two individual scripts (`..._align_maps_check_view.py` and
 * `..._export_current_view_ppt.py`) are the two halves that the one-shot
 * script combines; they remain available as *advanced* components for users
 * who want to inspect / manually adjust the camera between alignment and
 * export, but they are no longer a separate recommended workflow.
 */
const HELPER_FILES = [
  {
    name: "CryoSmart_auto_align_export_ppt.py",
    desc: "THE single end-to-end script. One-click: auto-aligns all maps (candidate test → pick best → inherit transform), optimises the view (tests base + Y±90 + X±90), exports high-res snapshots, crops white margins, and substitutes them into the PPTX by matching the name=\"CryoSmartImage:<key>\" marker. This is the only ChimeraX script most users need to run.",
    badge: "Recommended · one-shot",
    size: "42 KB",
    url: "/helpers/CryoSmart_auto_align_export_ppt.py",
    primary: true,
  },
  {
    name: "CryoSmart_align_maps_check_view.py",
    desc: "Advanced component — alignment + view-optimisation only (does NOT export images or touch the PPTX). Use this if you want to inspect the aligned maps in ChimeraX and manually adjust the camera before exporting. Outputs chimerax_rendered_maps/alignment_debug.log + a manifest. Pair it with the script below to finish the export.",
    badge: "Advanced · step 1 of manual",
    size: "32 KB",
    url: "/helpers/CryoSmart_align_maps_check_view.py",
    primary: false,
  },
  {
    name: "CryoSmart_export_current_view_ppt.py",
    desc: "Advanced component — export + PPTX substitution only, keeping the current ChimeraX camera view unchanged. Requires that alignment already ran (i.e. a chimerax_rendered_maps/rendered_map_manifest.json exists). Use it after you have manually rotated to your preferred view.",
    badge: "Advanced · step 2 of manual",
    size: "14 KB",
    url: "/helpers/CryoSmart_export_current_view_ppt.py",
    primary: false,
  },
  {
    name: "rebuild_picture_flow_pptx.mjs",
    desc: "Standalone Node ESM script that rebuilds the Picture Flow PPTX from the lineage JSON (no pptxgenjs — hand-rolled OOXML + ZIP). Useful if you edited the JSON and want to regenerate the PPTX without re-tracing. Run with: node rebuild_picture_flow_pptx.mjs path/to/*_lineage.json",
    badge: "Node · PPTX rebuild",
    size: "27 KB",
    url: "/helpers/rebuild_picture_flow_pptx.mjs",
    primary: false,
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
          The browser-portability verdict, the single recommended way to pull CryoSmart metadata into the web app, and the downloadable ChimeraX helper scripts (one end-to-end method).
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
                <li><strong className="text-amber-700">DOM scraper (1575 lines)</strong> — replaced. The web app now offers a single recommended capture path — the <em>Bookmarklet / Console Snippet</em> — that runs same-origin inside your CryoSmart tab with cookies auto-attached, then hands the metadata to the app. (Upload JSON and Live Connect remain as advanced fallbacks in the Data Source card.)</li>
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
              <p>
                <strong className="text-slate-800">There is now one recommended method:</strong> the Console Snippet in the <em>Bookmarklet</em> tab. It runs inside your logged-in CryoSmart project page, so your session cookie is auto-attached (same-origin), and it opens this web app in a new tab with everything loaded — no file juggling, no cookie pasting, no URL length limits.
              </p>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5">
                <p className="mb-1"><strong className="text-emerald-800">The single method — Console Snippet</strong></p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Go to the <em>Bookmarklet</em> tab in the Data Source card above.</li>
                  <li>Open your CryoSmart project page (URL like <code className="rounded bg-emerald-100 px-1 font-mono text-[10.5px]">http://192.168.202.11:8080/#/projects/P259</code>).</li>
                  <li>Press <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px]">F12</kbd> → open the <strong>Console</strong> tab.</li>
                  <li>Click the <span className="font-medium">Copy</span> button next to the Console Snippet, paste into the Console (Ctrl/Cmd+V), press Enter.</li>
                  <li>Watch the Console — it fetches the project&apos;s jobs and opens this web app in a new tab with everything loaded. Pick a start job in the Configure step and trace.</li>
                </ol>
                <p className="mt-1.5 text-[11px] text-emerald-700">
                  <strong>Why this is the one recommended way:</strong> it runs in the exact page context (never <code className="font-mono">about:blank</code>), no bookmark installation, no URL length limits, cookies auto-attached (same-origin). Works in Chrome / Firefox / Safari / Edge.
                </p>
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/60 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  <strong>Prefer a draggable bookmark?</strong> The Bookmarklet tab also offers a green bookmark button you can drag to your bookmarks bar and click on the CryoSmart page. <strong>Note:</strong> a few browsers run <code className="font-mono">javascript:</code> bookmarks in a blank <code className="font-mono">about:blank</code> tab instead of the current page — if that happens, use the Console Snippet above instead.
                </div>
              </div>
              <p className="mt-2 text-[11.5px] text-slate-500">
                <strong className="text-slate-600">Advanced fallbacks</strong> (available as separate tabs in the Data Source card, for cases where you cannot open the CryoSmart page in a browser):
              </p>
              <ul className="ml-5 list-disc space-y-0.5 text-[11.5px] text-slate-500">
                <li><strong>Upload JSON</strong> — if you already have an exported metadata JSON (from the original extension, a REST call, or a DevTools <em>Copy response</em> of <code className="rounded bg-slate-100 px-1 font-mono text-[10.5px] dark:bg-slate-800">/api/projects/&lt;pid&gt;/jobs</code>), drop the file in this tab.</li>
                <li><strong>Live Connect</strong> — paste your CryoSmart base URL + session cookie; the app&apos;s backend proxy (<code className="rounded bg-slate-100 px-1 font-mono text-[10.5px] dark:bg-slate-800">/api/cryosmart/[...path]</code>) fetches the metadata server-side with your cookie. Useful for headless / scripted runs.</li>
                <li><strong>Try Sample</strong> — synthetic 10-job cryo-EM pipeline, no real CryoSmart needed (great for exploring the UI).</li>
              </ul>
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
                <strong className="text-slate-800">There is now a single end-to-end method:</strong> the one-shot <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">CryoSmart_auto_align_export_ppt.py</code> script. It runs the entire pipeline — map alignment, view optimisation, high-res snapshot export, and PPTX image substitution — in one ChimeraX session. The two individual scripts below are the two halves that this one-shot combines; they remain available as <em>advanced</em> components for users who want to inspect the aligned maps or manually adjust the camera between alignment and export.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {HELPER_FILES.map((f) => (
                  <div
                    key={f.name}
                    className={`flex items-start gap-2 rounded-lg border bg-white p-2.5 dark:bg-slate-900 ${
                      f.primary
                        ? "border-teal-300 bg-teal-50/40 dark:border-teal-700 dark:bg-teal-950/30"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <FileCode2 className={`mt-0.5 h-4 w-4 shrink-0 ${f.primary ? "text-teal-600" : "text-slate-500"}`} />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-slate-800 dark:text-slate-100">{f.name}</span>
                        <Badge
                          variant="outline"
                          className={`px-1.5 py-0 text-[9px] ${
                            f.primary
                              ? "border-teal-300 text-teal-700 dark:border-teal-600 dark:text-teal-300"
                              : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {f.badge}
                        </Badge>
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-slate-500">{f.size}</Badge>
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
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-[11.5px] text-teal-900 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200">
                <div className="mb-1 font-medium text-teal-800 dark:text-teal-300">The single recommended workflow:</div>
                <ol className="ml-4 list-decimal space-y-0.5">
                  <li>Download the lineage bundle (above) and unzip it — it contains <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">*_lineage.json</code>, the HTML / SVG / Mermaid reports, <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">*_picture_flow.pptx</code>, and the helper scripts.</li>
                  <li>Open ChimeraX, then run <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">open CryoSmart_auto_align_export_ppt.py</code> in the command line.</li>
                  <li>The script aligns every map, tests 5 view hypotheses and picks the best by correlation, exports white-balanced uniformly-cropped PNGs, and substitutes them into the PPTX by matching the <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">name="CryoSmartImage:&lt;key&gt;"</code> marker, producing <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">*_chimerax.pptx</code>.</li>
                  <li>Debug logs + a manifest are written to <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px] dark:bg-teal-900/50">chimerax_rendered_maps/</code>.</li>
                </ol>
                <div className="mt-2 rounded-md border border-slate-200 bg-white/70 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  <strong>Advanced (optional):</strong> if you want to inspect the aligned maps or manually rotate to a preferred view before exporting, run <code className="font-mono">CryoSmart_align_maps_check_view.py</code> first (aligns + optimises, no export), adjust the camera, then run <code className="font-mono">CryoSmart_export_current_view_ppt.py</code> to export at your view. This is the two-step manual path the one-shot script automates.
                </div>
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
              <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="px-2.5 py-1.5">Component</th>
                      <th className="px-2.5 py-1.5">Lines</th>
                      <th className="px-2.5 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
                    <Row c="popup.js pure functions (lineage, HTML, SVG, PPTX, ZIP)" l="~6500" s="Ported verbatim to TS" tone="emerald" />
                    <Row c="popup.js chrome.* glue (tabs, downloads, scripting)" l="~600" s="Replaced with fetch + Blob + &lt;a download&gt;" tone="amber" />
                    <Row c="content.js DOM scraper" l="1575" s="Replaced — bookmarklet console snippet (Upload JSON / Live Connect as advanced fallbacks)" tone="amber" />
                    <Row c="background.js (service worker)" l="37" s="Dropped (Blob download)" tone="rose" />
                    <Row c="rebuild_picture_flow_pptx.mjs (Node)" l="454" s="Ported to TS + kept as downloadable helper" tone="emerald" />
                    <Row c="ChimeraX Python scripts" l="~2300" s="Kept as downloadable desktop helpers — one end-to-end one-shot script + 2 advanced components" tone="rose" />
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3 dark:border-teal-800 dark:from-teal-950/40 dark:to-emerald-950/40">
          <div className="flex items-start gap-2.5">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
            <div className="text-[12px] text-teal-900 dark:text-teal-200">
              <strong>Quick start (no CryoSmart):</strong> Click <em>Try Sample</em> in the Data Source card above, then <em>Trace Lineage</em> (Ctrl+Enter), then <em>Build &amp; download ZIP</em>.<br />
              <strong>With real CryoSmart:</strong> Go to the <em>Bookmarklet</em> tab, copy the Console Snippet, paste it into your CryoSmart project page&apos;s DevTools Console — the web app opens with everything auto-loaded. Then trace, download the bundle, and run the one-shot ChimeraX script.
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
      <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300">{c}</td>
      <td className="px-2.5 py-1.5 font-mono text-slate-500 dark:text-slate-400">{l}</td>
      <td className={`px-2.5 py-1.5 ${cls}`}>{s}</td>
    </tr>
  );
}
