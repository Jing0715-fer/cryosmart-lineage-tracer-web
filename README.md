# CryoSmart Lineage Tracer — Web

A cross-browser reimplementation of the **CryoSmart Lineage Tracer 3.0** Chrome extension as a standalone Next.js web app. Works in **Chrome · Firefox · Safari · Edge** — no extension install required.

Trace particle & map lineage for any CryoSmart job, build interactive HTML / SVG / PPTX reports, and download the full bundle (JSON + HTML + SVG + Mermaid + PPTX + ChimeraX helper scripts) as a single ZIP.

## Features

- **Lineage tracing** — BFS walk upstream from any start job, classifying each into particle / map / micrograph lineages. Same algorithm as the original extension (`collectUpstream`, `connectionEdges`, `reportLineageRound`).
- **Interactive HTML report** — left outline + right chain cards, with per-job source tables, class splits, map downloads, and a picture-flow panel.
- **A4 SVG picture flow** — same layout as the original extension's `buildPictureFlowSvg`.
- **Hand-rolled OOXML PPTX** — no `pptxgenjs` dependency. Preserves the `name="CryoSmartImage:<key>"` marker so the bundled ChimeraX Python scripts can substitute rendered images later.
- **Hand-rolled STORE-only ZIP writer** — produces the bundle Blob entirely client-side.
- **Three data source modes**:
  1. **Upload JSON** — drop a CryoSmart metadata JSON (exported by the original extension or fetched via REST).
  2. **Live Connect** — a Next.js API route `/api/cryosmart/[...path]?base=&cookie=` acts as an authenticated server-side proxy to your CryoSmart instance (browser cannot call CryoSmart directly due to CORS + HttpOnly cookies).
  3. **Try Sample** — synthetic 10-job cryo-EM pipeline, no real CryoSmart instance needed.
- **Downloadable ChimeraX helpers** — `CryoSmart_align_maps_check_view.py`, `CryoSmart_export_current_view_ppt.py`, `CryoSmart_auto_align_export_ppt.py`, `rebuild_picture_flow_pptx.mjs` are bundled into every ZIP and also individually downloadable from the Help section.

## Tech stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **UI**: Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- **No backend database** — all tracing runs client-side; the only server-side code is the optional CryoSmart proxy route.

## Getting started

```bash
bun install
bun run dev   # http://localhost:3000
```

Open the app, click **Try Sample** → **Load sample project** → **Trace Lineage** → **Build & download ZIP** to see the full pipeline end-to-end without a real CryoSmart instance.

## Project structure

```
src/
├── lib/cryosmart/
│   ├── constants.ts        # job-type categories, PPTX/SVG layout constants
│   ├── types.ts            # JobMetadata, LineageNode, LineageEdge, LineageSummary
│   ├── lineage.ts          # BFS, buildSummary, focusedMermaid, reportLineageRound
│   ├── report-html.ts      # buildLineageHtmlV2 (left outline + right chain cards)
│   ├── report-svg.ts       # buildPictureFlowSvg (A4 SVG)
│   ├── report-pptx.ts      # buildPictureFlowPptx (hand-rolled OOXML)
│   ├── zip.ts              # hand-rolled STORE-only ZIP writer
│   ├── proxy-client.ts     # browser-side client for /api/cryosmart/[...path]
│   ├── bundle.ts           # assembles the full download ZIP
│   └── sample-data.ts      # synthetic cryo-EM workflow for demo
├── app/
│   ├── api/cryosmart/[...path]/route.ts   # backend proxy (live mode)
│   ├── components/cryosmart/               # UI: data-source, configure, preview, download, help
│   └── page.tsx            # main workflow
└── public/helpers/        # bundled ChimeraX .py + .mjs scripts
```

## How it maps to the original Chrome extension

| Original component | Lines | Status in this web app |
|---|---|---|
| `popup.js` pure functions (lineage, HTML, SVG, PPTX, ZIP) | ~6500 | ✅ Ported verbatim to TypeScript |
| `popup.js` `chrome.*` glue (tabs, downloads, scripting) | ~600 | ✅ Replaced with `fetch` + `Blob` + `<a download>` |
| `content.js` DOM scraper | 1575 | ⚠️ Replaced — JSON Upload mode + Live Connect proxy |
| `background.js` (service worker) | 37 | ✅ Dropped (browser-native Blob download) |
| `rebuild_picture_flow_pptx.mjs` (Node) | 454 | ✅ Ported to TS + kept as downloadable helper |
| 3 ChimeraX Python scripts | ~2300 | ⚠️ Kept as downloadable desktop helpers (require ChimeraX) |

## Why a web app instead of a Chrome extension?

The original extension relied on injecting a content script into the CryoSmart tab to scrape job metadata out of the DOM and to reuse the user's same-origin session cookie. A web app on a different origin cannot do this (CORS + HttpOnly cookies), so we split the extension into three parts:

1. **Pure JS logic** (~6500 lines) — verbatim port. All the lineage tracing, BFS walk, HTML/SVG/PPTX report generation, and the hand-rolled ZIP writer run client-side.
2. **DOM scraper** (1575 lines) — replaced by two modes: (a) JSON Upload, (b) Live Connect via a server-side proxy.
3. **ChimeraX Python scripts** (~2300 lines) — kept as downloadable desktop helpers. They require ChimeraX (UCSF molecular visualization software) which cannot run in a browser.

The result is a web app that works in any modern browser without installing any extension.

## License

Private project.
