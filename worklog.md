# CryoSmart Lineage Tracer Web — Project Handover

## Background

User uploaded `CryoSmartLineageTracer_3.0.zip` — a Manifest V3 Chrome extension
(~8000 lines across popup.js + content.js + background.js + 3 Python ChimeraX
scripts + 1 Node .mjs PPTX builder). The user asked whether the same
functionality can be reimplemented as a **cross-browser web app**.

## Feasibility verdict (answered to user)

**Yes, the bulk of the extension is portable.** Specifically:

| Component | Lines | Portable to web app? | Why / How |
|---|---|---|---|
| `popup.js` pure functions (jobNode, connectionEdges, collectUpstream BFS, buildSummary, reportLineageRound, buildLineageHtmlV2, buildPictureFlowSvg, buildPictureFlowPptx, makeZip, focusedMermaid) | ~3000 | ✅ Yes, verbatim | Pure JS, zero chrome.* deps. Port to TS modules. |
| `popup.js` chrome.* glue (chromeCall, sendContentMessage, chrome.downloads) | ~600 | ✅ Replace | `<a download>` / Blob / File System Access API |
| `content.js` DOM scraper (1575 lines) | 1575 | ⚠️ Replace with REST proxy | Relies on injecting into CryoSmart tab + same-origin cookies. A web app on a different origin cannot do this. We instead provide a backend proxy that forwards authenticated requests to CryoSmart's actual REST API (`/api/projects/{pid}/jobs`, `/api/log_image/download_result_file/...`, `/api/log_image/{fileid}`). |
| `background.js` (37 lines) | 37 | ✅ Drop | Just a `chrome.downloads` router; replaced by browser Blob downloads. |
| `rebuild_picture_flow_pptx.mjs` (454 lines) | 454 | ✅ Port + keep downloadable | Pure JS, hand-rolled OOXML+ZIP. Port to TS for in-browser use, also ship as a downloadable Node helper. |
| 3 ChimeraX `.py` scripts (~2300 lines) | 2300 | ❌ Keep as downloadable helpers | Require desktop ChimeraX software (`from chimerax.core.commands import run`). Cannot run in browser. Ship as downloadable files in `public/helpers/`. |

**Two operating modes for the web app:**

1. **JSON Upload mode** (works in every browser, no CORS, no auth) — user
   exports CryoSmart project metadata via ANY method (existing extension,
   manual API, third-party tool) and uploads the `.json`. All lineage tracing
   + report/PPTX/ZIP generation happens **client-side**.

2. **Live Connect mode** (requires backend proxy) — user enters the CryoSmart
   base URL + a session cookie or Authorization header value. Our Next.js API
   route `/api/cryosmart/[...path]` proxies authenticated requests to
   CryoSmart's REST API and rewrites the host so the browser can fetch
   preview images / maps without CORS issues.

## Architecture

```
src/
├── lib/cryosmart/
│   ├── constants.ts      # job-type categories, MAP_SUFFIXES, PPTX layout consts
│   ├── types.ts          # JobMetadata, LineageNode, LineageEdge, LineageSummary
│   ├── lineage.ts        # jobNode, connectionEdges, collectUpstream, buildSummary,
│   │                     # normalizeLineageSummary, focusedMermaid, reportLineageRound
│   ├── report-html.ts    # buildLineageHtmlV2 (left outline + right chain cards)
│   ├── report-svg.ts     # buildPictureFlowSvg (A4 SVG)
│   ├── report-pptx.ts    # buildPictureFlowPptx (hand-rolled OOXML)
│   ├── zip.ts            # hand-rolled STORE-only ZIP writer (Blob)
│   ├── preview.ts        # makePreview (text preview)
│   └── proxy-client.ts   # fetch wrapper for /api/cryosmart/[...path]
├── app/
│   ├── api/cryosmart/[...path]/route.ts   # backend proxy (live mode)
│   ├── page.tsx          # main UI: tabbed workflow
│   └── components/       # workflow step components
└── public/helpers/       # bundled ChimeraX .py + rebuild_picture_flow_pptx.mjs
```

## Current status

**Phase 1 (in progress)**: Porting pure JS modules from popup.js to TypeScript,
building JSON-upload workflow end-to-end (upload → trace → preview → download
ZIP with JSON + HTML + SVG + Mermaid + PPTX + helper scripts).

## Goals for this round

1. ✅ Analyze Chrome extension thoroughly (3 parallel Explore subagents).
2. ⏳ Port constants/types/lineage core, HTML report, SVG, PPTX, ZIP — parallel subagents.
3. ⏳ Build main UI with tabbed workflow (Upload JSON / Live Connect / Help).
4. ⏳ Build interactive lineage preview (Mermaid + outline + cards).
5. ⏳ Build ZIP bundle download.
6. ⏳ Copy ChimeraX .py + .mjs helpers to public/helpers/.
7. ⏳ Lint + agent-browser self-verify + fix.
8. ⏳ Set up 15-minute cron review job.

## Unresolved / risks

- CryoSmart's actual REST endpoints for "list jobs" and "get job metadata" are
  not officially documented; the extension scrapes DOM precisely because the
  author didn't reverse-engineer them. The live-mode proxy will start with
  the four candidate endpoints `popup.js:tryFetchProjectJobs` already guesses
  (`/api/projects/{pid}/jobs`, `/api/jobs?project_uid=…`, etc.) and may need
  adjustment per CryoSmart deployment.
- CryoSmart session cookies are typically `HttpOnly`, so the browser cannot
  read them in JS. Live-mode users must paste the cookie value manually into
  the proxy config (stored server-side in memory / DB).
- ChimeraX-dependent steps (alignment, snapshot rendering, PPTX image
  substitution) remain desktop-only; the web app will offer the Python scripts
  as a downloadable helper bundle with clear instructions.

---
Task ID: 2-a
Agent: port-lineage-core
Task: Port CryoSmart lineage core (constants, types, lineage BFS, mermaid, preview) from popup.js to TypeScript

Work Log:
- Read worklog.md and the full source `/home/z/my-project/upload/extracted/CryoSmartLineageTracer_3.0/popup.js` (3614 lines) — identified all pure helpers belonging to the lineage-tracing core and the constants block at the top of the file.
- Created directory `/home/z/my-project/src/lib/cryosmart/`.
- Wrote `constants.ts` (208 LOC): all `MAP_SUFFIXES`, the six `Set<string>` job-type categories, all `PPT_*` PPTX layout constants (incl. `PPT_COLORS` with a `PptColorName` export), `SVG_A4_*` constants, and `DEFAULT_BASE_URL = "http://192.168.4.3:8080"`. Source literals preserved verbatim.
- Wrote `types.ts` (383 LOC): `JobMetadata`, `InputSlotGroup`, `Connection`, `Slot`, `OutputResultGroup`, `GroupContains`, `LineageEdge` (+`LineageEdgeSlot`, `NormalizedLineageEdge`, `EdgeFamily`), `ExtractionParams`, `OutputGroupIndex(Item)`, `ImageAsset`, `MapAsset`, `ClassMap`, `ClassSplit`, `Select2DSummary`, `LineageNode`, `ClassSplitJob`, `LineageSummary`, `ExportedProjectMetadata`/`FailedJob`, plus the `IncomingByTargetMap` interface (extends `Map` to carry the `__traceVisibleMemo` field) and `LineageReportState` interface used by the report helpers. Raw CryoSmart payloads typed loosely enough to survive `$date` / `{ value: ... }` wrappers without `any`.
- Wrote `lineage.ts` (1693 LOC): every pure helper listed in the task — `normalizeJobUid`, `parseRoute`, `plainDate`, `outputGroups`, `maxGroupNumItems`, `paramSpecNumber`, `outputSummaryNumber`, `pixelSizeNumber/FromJob/formatPixelSize/Text`, `isExtractMicrographsJob`, `extractionParams`, `formatBinFactor`, `extractionParamText`, `extractionBinText`, `normalizeExtractionParamsForNode`, `resolutionNumber`, `parseResolutionText`, `resolutionFromObject`, `resolutionFromJob`, `resolutionText`, `formatResolution` (alias of `formatBinFactor` with `// TODO: verify` per task — original `resolutionText` reuses `formatBinFactor`), `parseClassIndex`, `outputGroupIndex`, `classSplits`, `selected2dSummary`, `imageAssets`, `mapAssets`, `mapPreviewImageName`, `normalMapAssets`, `jobNode`, `connectionEdges`, `fallbackParentEdges`, `edgeKind`, `reportKindFamily`, `collectUpstream` (BFS), `buildSummary`, `normalizeLineageSummary`, `focusedMermaid`, `focusedEdgeLabel`, `importance`, `htmlNodeKind`, `reportLineageRound`, `reportRepickSeedSourceRounds`, `reportHasRepickSeed`, `reportFeedsVolumeMainline`, `reportNodeIsMajor`, `reportVisibleOutlineNodes`, `reportTraceVisibleSources`, `reportOutlineRefs`, `makePreview`, plus URL builders `logImageUrl`, `resultFileUrl`, `resultPreviewImageUrl`, `mapDownloadUrls`. Also included the dependent helpers (`reportJobNum`, `reportEdgeKind`, `summaryKind`, `summaryNodeMap`, `htmlGroupLabel`, `reportIsPickingNode/RepickParticleProducer/RepickSetupNode/ParticleAuxNode/VolumeSourceNode`, `reportMaxRoundFromEdges`, `reportParticleSourceRound`, `reportNormalizedEdges`, `reportBuildLineageState`, `nodeLabel`) so the explicitly-listed functions compile. `REPORT_NORMALIZED_EDGES_CACHE` declared at module scope as `WeakMap<LineageSummary, NormalizedLineageEdge[]>`. All Chinese UI strings preserved byte-for-byte. No `chrome.*` / `document` / `window` references.
- Verified with `bunx tsc --noEmit --strict --target es2020 --lib esnext,dom --moduleResolution bundler --module esnext --skipLibCheck --esModuleInterop src/lib/cryosmart/constants.ts src/lib/cryosmart/types.ts src/lib/cryosmart/lineage.ts` → exit 0, zero diagnostics. Also re-ran against the project's full `tsconfig.json` (`bunx tsc --noEmit -p tsconfig.json | grep cryosmart`) — only pre-existing errors in OTHER agents' files (`report-svg.ts`, `zip.ts`, which are out of scope for task 2-a). My three new files emit zero TypeScript errors.

Stage Summary:
- Files produced (3, total 2284 LOC):
  - `/home/z/my-project/src/lib/cryosmart/constants.ts` (208 LOC) — exports `MAP_SUFFIXES`, 6 job-type `Set<string>`s, all `PPT_*`/`SVG_A4_*` constants, `DEFAULT_BASE_URL`.
  - `/home/z/my-project/src/lib/cryosmart/types.ts` (383 LOC) — all 13 task-required types + supporting interfaces (`LineageEdgeSlot`, `NormalizedLineageEdge`, `EdgeFamily`, `IncomingByTargetMap`, `LineageReportState`, etc.).
  - `/home/z/my-project/src/lib/cryosmart/lineage.ts` (1693 LOC) — verbatim port of ~50 pure helpers from `popup.js`, fully typed, no `any`, all Chinese literals preserved.
- TypeScript errors remaining: **0** in the three new files (verified under both `--strict` standalone and the project's `tsconfig.json`).
- Next actions (for downstream tasks 2-b/2-c/2-d):
  - `report-html.ts` should import `htmlNodeKind`, `summaryNodeMap`, `summaryKind`, `htmlGroupLabel`, `importance`, `pixelSizeText`, `extractionBinText`, `resolutionText`, `reportBuildLineageState`, `reportNormalizedEdges`, `reportOutlineRefs`, `reportGroupedIncoming/Outgoing`, etc. from this module (these were ported here so the report layer can stay thin).
  - `report-svg.ts` / `report-pptx.ts` should import `SVG_A4_*` / `PPT_*` constants and `makePreview` / `importance` / `pixelSizeText` / `extractionBinText` from here.

---
Task ID: 2-b
Agent: port-html-report
Task: Port buildLineageHtmlV2 (left outline + right chain cards) from popup.js to TypeScript

Work Log:
- Read /home/z/my-project/worklog.md and popup.js (focused on lines 1260-2176 — the HTML-report section). Also read helpers from lines 1-1018 (escHtml, fmt, importance, edgeKind, summaryKind, summaryNodeMap, htmlNodeKind, pixelSizeText, resolutionText, extractionBinText, extractionParamText, parseClassIndex, localImageFilename, mapPreviewImageName, safePart, pixelSizeNumber, formatPixelSize, resolutionNumber, formatBinFactor).
- Discovered that sibling tasks have already produced /home/z/my-project/src/lib/cryosmart/types.ts (full type system: LineageSummary, LineageNode, LineageEdge, EdgeFamily, NormalizedLineageEdge, LineageReportState, IncomingByTargetMap, ClassSplit, ClassSplitJob, Select2DSummary, ImageAsset, MapAsset) and /home/z/my-project/src/lib/cryosmart/constants.ts (PICKING_JOB_TYPES, REPICK_PARTICLE_PRODUCER_TYPES, REPICK_SETUP_JOB_TYPES, PARTICLE_AUX_JOB_TYPES, MAJOR_JOB_TYPES, SMALL_JOB_TYPES). lineage.ts is not yet present.
- Wrote /home/z/my-project/src/lib/cryosmart/report-html.ts (1885 lines). Since lineage.ts does not exist yet, defined all lineage helpers locally with the comment `// duplicated from lineage.ts to avoid circular import` so they can be replaced by imports once Task 2-a finalises lineage.ts.
- Ported every function the task listed: buildLineageHtmlV2, reportOutline, reportPictureFlow, reportJobCard, reportSourceTable, reportSourceTrace, reportMediaBlock, reportClassTable, reportMapDownloads, reportOutgoingBox, reportMiniNode, reportNodeCardKind, reportKindFamily, reportOutlineRefs, reportRoundParticleNodes, reportLineageRound, reportVisibleOutlineNodes, reportTraceVisibleSources, reportNodeIsMajor, plus all html* helpers (htmlSourceRows, htmlClassTable, htmlMapTable, htmlEscape, htmlNodeKind, htmlMetricChips, htmlCompactMetric, htmlJobRef, htmlGroupLabel, htmlRelationPills, groupedHtmlEdges, htmlSmallSourceHops, htmlKindClass, htmlKindLabel). Also ported the V1 builder buildLineageHtml for parity. The task's mention of `reportRoundStages` was a phantom entry — there is no such function in popup.js (the round-stage logic is inlined inside `reportOutline`). Skipped.
- Preserved the V2 CSS verbatim (single backtick string `REPORT_HTML_V2_CSS`, ~5 KB) and the inline `<script>` click handler (string `REPORT_HTML_V2_SCRIPT`) that staggers `window.open` by 160 ms per URL when `.download-all` is clicked.
- Preserved every Chinese literal exactly: `颗粒`, `颗粒数`, `照片`, `照片数`, `原始 micrographs 预览`, `保留颗粒`, `排除颗粒`, `来源`, `流向`, `输出到`, `最终节点`, `附属`, `导入 / 预处理`, `挑颗粒 / 提取`, `再挑颗粒 / 提取`, `初始建模`, `refine / final`, `2D`, `普通 map: N 个`, `一键下载 map`, `Map / MRC`, `预览`, `下载`, `原始 pixel N px · 提取 box N px · bin N (推断)`, `SVG 会随报告单独导出`, etc.
- Properly typed all function signatures with types from './types' and './constants'. No `any` in any function signature (ESLint config has `@typescript-eslint/no-explicit-any` off, but I still avoided it per task constraints). The `LineageReportState`, `NormalizedLineageEdge`, `IncomingByTargetMap`, `EdgeFamily` types come from './types' — no manual type re-declarations needed.
- Module has NO `'use server'` or `'use client'` directive — safe to import from both server and client components.
- Did not modify any file outside /home/z/my-project/src/lib/cryosmart/.
- Verification: `npx eslint src/lib/cryosmart/report-html.ts` → 0 errors. `npx tsc --noEmit 2>&1 | grep -E "cryosmart|report-html"` → 0 errors in my file (the only TS errors in the repo are in unrelated examples/ and skills/ folders). Smoke-tested with `bun -e` importing the module and calling buildLineageHtmlV2 on a stub summary: produced a 10 875-char HTML page starting with `<!doctype html><html>...`. With a non-empty summary containing one import_micrographs node: produced an 11 455-char HTML containing `<style>`, `<script>`, `Lineage Outline`, `Main Data Chain`, `J1 import_micrographs`, the download-all click handler, and the 160-ms stagger.

Stage Summary:
- Produced /home/z/my-project/src/lib/cryosmart/report-html.ts — 1885 lines, 0 lint errors, 0 TS errors.
- Exported ~70 functions (the V2 entry point `buildLineageHtmlV2` plus all helpers, with `// duplicated from lineage.ts to avoid circular import` comments on the lineage-analysis helpers so Task 2-a can later replace them with imports).
- Imports types from './types' and constants from './constants' (both already created by sibling tasks).
- Standalone HTML output is browser-openable: includes inline `<style>` (~5 KB) and inline `<script>` for `.download-all` staggered `window.open(url, "_blank")` at 160 ms per URL.

---
Task ID: 2-c
Agent: port-svg-pptx
Task: Port buildPictureFlowSvg + buildPictureFlowPptx + hand-rolled ZIP from popup.js to TypeScript

Work Log:
- Read `/home/z/my-project/upload/extracted/CryoSmartLineageTracer_3.0/popup.js` in full
  (3614 lines, multiple Read calls). Located target functions via grep:
  `svg*` helpers (2181-2249), `buildPictureFlowSvg` (2251-2365),
  `ppt*` helpers + `buildPictureFlowPptx` (2389-3449), `makeZip` (3334-3398).
- Cross-referenced with `rebuild_picture_flow_pptx.mjs` (454 lines) — the Node-side
  standalone PPTX builder that mirrors popup.js — for the PNG/JPEG dimension-parsing
  approach (used in `imageInfo` inside report-pptx.ts).
- Found that sibling subagents had already produced `constants.ts` and `types.ts`
  with all the project constants (PPT_EMU, PPT_W, PPT_COLORS, SVG_A4_*, etc.) and
  full type definitions (LineageSummary, LineageNode, ClassSplitJob,
  LineageReportState, etc.). Wrote my three files importing from them.
- After I started writing, `lineage.ts` (1693 lines) and `report-html.ts` (1895
  lines) also appeared, exposing many of the report helpers I needed
  (`reportBuildLineageState`, `reportLineageRound`, `reportRoundNodes`, etc.).
  Used those imports where they existed; defined the rest locally with
  `// duplicated` comments as the task spec allows.

- Created `/home/z/my-project/src/lib/cryosmart/zip.ts` (221 lines):
  - Exports: `makeZip`, `zipCrc32`, `zipU16`, `zipU32`, `concatBytes`,
    `dosDateTime`, plus `ZipFileEntry` interface.
  - Precomputed `ZIP_CRC_TABLE` (256-entry Uint32Array) for CRC-32.
  - STORE-only (no DEFLATE) — required for OOXML containers.
  - Returns a browser `Blob`; works in client components and Node 18+.
  - Documented the TS 5.7+ `Uint8Array<ArrayBufferLike>` vs `BlobPart`
    issue in an inline comment and worked around it with a
    `as unknown as BlobPart[]` cast (runtime behavior is unchanged).

- Created `/home/z/my-project/src/lib/cryosmart/report-svg.ts` (971 lines):
  - Exports: `buildPictureFlowSvg(summary, imageDataMap = null)`.
  - A4 794×1123 canvas, scales content down to fit, inline font (Times New Roman).
  - Ports `svgText`, `svgArrow`, `svgImageHref`, `svgClassGrid`,
    `svgParticleStepBlock`.
  - All `report*` helpers (reportBuildLineageState, reportLineageRound
    recursive, reportRoundNodes, reportRoundParticleNodes,
    reportSelectedClassIndices, reportFirstMicrographNode, normalMapAssets,
    reportMetricText, reportPictureParticleMetricText, …) are defined locally
    with `// duplicated` comments so the module compiles independently of
    lineage.ts. Chinese strings (`照片`, `颗粒`, etc.) preserved verbatim.
  - Uses constants from `./constants` (MAJOR_JOB_TYPES, PICKING_JOB_TYPES,
    REPICK_*, PARTICLE_AUX_JOB_TYPES, SVG_A4_*).

- Created `/home/z/my-project/src/lib/cryosmart/report-pptx.ts` (1653 lines):
  - Exports: `buildPictureFlowPptx(summary, images = null)` returning a
    `Blob` of MIME `application/vnd.openxmlformats-officedocument
    .presentationml.presentation`.
  - Ports: `pptXml`, `pptEmu`, `pptFontSize`, `pptColor`, `pptFillXml`,
    `pptLineXml`, `pptKindStyle`, `pptNewSlide`, `pptAddShape`, `pptAddText`,
    `pptAddImage`, `pptAddHeader`, `pptNodeLabel`, `pptAddNodeCard`,
    `pptAddMetricCard`, `pptAddImageFrame`, `pptAlign`, `pptTextXml`,
    `pptShapeXml`, `pptContainBox`, `pptImageXml`, `pptSlideXml`,
    `pptSlideRelsXml`, `pptContentTypesXml`, `pptRootRelsXml`,
    `pptPresentationXml`, `pptPresentationRelsXml`, `pptSlideMasterXml`,
    `pptSlideMasterRelsXml`, `pptSlideLayoutXml`, `pptSlideLayoutRelsXml`,
    `pptThemeXml`, `pptCoreXml`, `pptAppXml`, `pptLogicalScale`,
    `pptLogicalBox`, `pptLogicalFont`, `pptLogicalText`/`Shape`/`Image`/
    `Arrow`/`ImageFrame`/`NodeCard`/`ClassGrid`, `buildPictureFlowPptObjectOps`,
    `buildPptObjectPictureFlowSlide`, `buildPictureFlowPptSlides`,
    `pptUniqueSlideImageKeys`.
  - Image-embedding redesign: caller passes
    `images: Map<string, Uint8Array>` keyed by URL. `resolvePptImages`
    walks `collectPptImageRequests(summary)` to map URL→bytes, parses
    PNG/JPEG dimensions via `imageInfo` (ported from .mjs), and produces
    a `Map<key, PptImageInfo>` for the slide renderer. Missing URLs emit
    a placeholder text shape (preserving the ChimeraX marker) instead of
    crashing.
  - `name="CryoSmartImage:<key>"` attribute on `<p:cNvPr>` preserved
    EXACTLY in both the picture and the placeholder variants — ChimeraX
    Python scripts grep for this marker to substitute images post-hoc.
  - Uses `makeZip` from `./zip` for final package assembly.
  - Imports the shared `report*` helpers from `./lineage` and `./report-html`
    (small handful that aren't exported there — `escHtml`, `safePart`,
    `localImageFilename`, `pptImageKey`, `reportFirstMicrographNode`,
    `reportSelectedClassIndices` — are defined locally with `// duplicated`
    comments).
  - Cleanly-typed discriminated union `PptLogicalOp` (text | shape | image |
    break) instead of an `any`-ish `[key: string]: unknown` shape.

- Ran `bunx tsc --noEmit` after each file: zero TS errors in my files.
- Ran `bunx eslint src/lib/cryosmart/`: zero ESLint errors in my files.
- `bun run lint` reports 4 errors — all in
  `upload/extracted/__MACOSX/CryoSmartLineageTracer_3.0/._*.js` (macOS
  resource-fork binary files that ESLint tries to parse as JavaScript).
  These are pre-existing and outside my scope (`src/lib/cryosmart/`).

Stage Summary:
- Produced files:
  - `/home/z/my-project/src/lib/cryosmart/zip.ts` (221 lines)
  - `/home/z/my-project/src/lib/cryosmart/report-svg.ts` (971 lines)
  - `/home/z/my-project/src/lib/cryosmart/report-pptx.ts` (1653 lines)
  - Total: 2845 lines ported.
- All three modules are importable from both server and client components
  (no `'use server'` / `'use client'` directive; only Web-standard APIs
  like `Uint8Array`, `TextEncoder`, `Blob`).
- TypeScript strict-mode clean (zero errors in my files).
- ESLint clean for `src/lib/cryosmart/`.
- The 4 pre-existing lint errors in `upload/extracted/__MACOSX/` are
  macOS metadata files and are not in scope.

---
Task ID: 3-8
Agent: main-orchestrator
Task: Build backend proxy, main UI, ZIP bundle, copy helpers, self-verify with agent-browser

Work Log:
- Created `/src/app/api/cryosmart/[...path]/route.ts` — backend proxy that forwards authenticated requests to CryoSmart (accepts `?base=&cookie=&auth=` query params).
- Created `/src/lib/cryosmart/proxy-client.ts` — browser-side wrapper (`cryoSmartFetch`, `cryoSmartJson`, `cryoSmartBytes`, `fetchProjectJobs` tries 4 candidate endpoints).
- Created `/src/lib/cryosmart/bundle.ts` — orchestrates JSON + HTML + SVG + Mermaid + preview.txt + PPTX + helper scripts + images/maps/final-results → single ZIP Blob via `makeZip`.
- Created `/src/lib/cryosmart/sample-data.ts` — synthetic 10-job cryo-EM pipeline (import movies → motion → CTF → blob picker → extract → 2D class → select 2D → ab initio → homo refine → optional hetero refine) for demo without a real CryoSmart instance.
- Copied 3 ChimeraX `.py` scripts + `rebuild_picture_flow_pptx.mjs` to `/public/helpers/` for individual download (all return 200 OK).
- Built UI components in `/src/app/components/cryosmart/`:
  - `site-chrome.tsx` (SiteHeader + SiteFooter sticky)
  - `data-source-card.tsx` (3 tabs: Upload JSON / Live Connect / Try Sample)
  - `configure-card.tsx` (project ID + start job + 4 option checkboxes + trace button + log)
  - `lineage-preview-card.tsx` (4 stat cards + 4 tabs: Overview / Report iframe / Mermaid source / Preview text)
  - `download-card.tsx` (ZIP build with progress bar + warnings + re-download)
  - `help-card.tsx` (4 accordions: feasibility verdict, how-to-export JSON, ChimeraX helpers, port-vs-replace table)
- Rewrote `/src/app/page.tsx` — hero section + 5-card vertical workflow with teal/emerald/slate palette (NO indigo/blue per UI rules).
- Fixed 4 TS errors (buildSummary signature, duplicate TraceOptions export, ClassMap.preview_url → cls.mrc_preview_url).
- Fixed sample data: added particle output group to J10 homo_refine (so Final Particles shows 42,100 instead of —).
- Updated stat card sub-text to be meaningful ("no particle output" / "no exposure output" instead of "unknown").

Stage Summary:
- **Verification via agent-browser (all passed)**:
  - Page loads cleanly, no console errors.
  - Try Sample → loads 10-job sample → Trace Lineage → 10 nodes, 10 edges, stats show 42,100 / — / 3.12 Å / 10.
  - Report tab renders the standalone HTML report in a sandboxed iframe.
  - Mermaid tab shows the `flowchart LR` source.
  - Build & download ZIP → produces `CryoSmart_P52_J10_lineage.zip` with "Bundle ready" + Re-download button.
  - Help accordion: all 4 helper files listed and individually downloadable (200 OK).
  - Proxy API route `/api/cryosmart/[...path]?base=...` returns proper 502 JSON for unreachable CryoSmart host (expected in sandbox).
  - VLM visual analysis: "high-quality, polished web interface with no apparent layout bugs or broken components".
- **Lint**: 0 errors. **TypeScript**: 0 errors. **Dev server**: stable on port 3000.
- **Files produced**: 7 cryosmart lib modules (~7000 LOC ported), 6 UI components, 1 API route, 4 public helper scripts, updated page.tsx + worklog.md.

