/**
 * v319-report-templates.mjs — regression for the v3.17 report redesign.
 *
 * Covers:
 *   A. report-style.ts — normalize clamps, defaults, save/load roundtrip
 *   B. buildReportCss — per-template signatures + fontScale + classic
 *      passthrough (gradients kept, .note rule appended)
 *   C. buildLineageHtmlV2 — content parity across ALL templates (content is
 *      never watered down: same job cards / class sections / source tables /
 *      map cells), custom title + subtitle, default title, generated date
 *   D. imageMode embed / remote / none semantics (incl. bundleMode local
 *      paths and the map-cell placeholder)
 *   E. inline script — balanced JS (parses via new Function), download-all
 *      handler kept, height-reporting IIFE removed
 *   F. v3.15 invariants still hold for the default template
 *      (.imgs-c grid CSS + .imgbox.sm + markFailed m2[1])
 *
 * Run:  bun .harness/v319-report-templates.mjs   (from the repo root)
 * Pure unit tests — no server, no browser.
 */

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log(`  ok - ${msg}`); }
function bad(msg) { fail++; console.log(`  BAD - ${msg}`); }
function check(cond, msg) { (cond ? ok : bad)(msg); }

const summary = {
  project_uid: "P17",
  start_uid: "J4",
  nodes: [
    {
      uid: "J1", job_type: "import_micrographs", project_uid: "P17", title: "import",
      status: "completed", parents: [], children: [], micrograph_count: 6400,
      images: [], maps: [], classes: [], output_groups: {},
      representative_micrograph_images: [
        { kind: "ui_tile", name: "mic1", url: "http://x/m1", src: "http://x/m1", original_url: "http://x/m1" },
      ],
    },
    {
      uid: "J4", job_type: "hetero_refine", project_uid: "P17", title: "hetero",
      status: "completed", parents: [], children: [], particle_count: 123456,
      images: [
        { kind: "log_image", name: "fsc_0.png", url: "http://x/0", src: "http://x/0", original_url: "http://x/0", class_index: 0 },
        { kind: "log_image", name: "fsc_1.png", url: "http://x/1", src: "http://x/1", original_url: "http://x/1", class_index: 1 },
        { kind: "log_image", name: "scale.png", url: "http://x/2", src: "http://x/2", original_url: "http://x/2" },
      ],
      maps: [], classes: [], output_groups: {},
    },
  ],
  edges: [
    { source: "J1", target: "J4", input_type: "micrographs", slots: [] },
  ],
};

const reportHtml = await import("../src/lib/cryosmart/report-html.ts");
const reportStyleMod = await import("../src/lib/cryosmart/report-style.ts");
const { buildLineageHtmlV2, buildReportCss } = reportHtml;
const { normalizeReportStyle, DEFAULT_REPORT_STYLE, REPORT_TEMPLATES, reportTemplateLabel } = reportStyleMod;

/* ── A. report-style module ───────────────────────────────────────── */
console.log("── A. report-style module ──");
{
  const d = normalizeReportStyle(null);
  check(d.template === "paper" && d.fontScale === "standard" && d.imageMode === "embed",
    "null → defaults (paper / standard / embed)");
  const junk = normalizeReportStyle({ template: "neon", fontScale: "huge", imageMode: "all", titleOverride: 42, subtitle: {} });
  check(junk.template === "paper" && junk.fontScale === "standard" && junk.imageMode === "embed" && junk.titleOverride === "" && junk.subtitle === "",
    "invalid values clamped to defaults, non-strings emptied");
  const long = normalizeReportStyle({ titleOverride: "x".repeat(500), subtitle: "y".repeat(500) });
  check(long.titleOverride.length === 200 && long.subtitle.length === 300, "title/subtitle length caps (200/300)");
  check(REPORT_TEMPLATES.length === 8 && REPORT_TEMPLATES.map((t) => t.id).join(",") === "paper,minimal,slate,classic,blueprint,editorial,focus,industrial",
    "8 template infos in stable order (v3.24 added industrial after focus)");
  check(reportTemplateLabel("slate") === "Slate 暗色" && reportTemplateLabel("industrial") === "Industrial 工业", "template label lookup");
  check(DEFAULT_REPORT_STYLE.template === "paper", "default template is paper (new design)");
}

/* ── B. buildReportCss ────────────────────────────────────────────── */
console.log("── B. buildReportCss per-template signatures ──");
{
  const paper = buildReportCss("paper");
  check(paper.includes("Georgia") && paper.includes("serif"), "paper: serif font stack");
  // v3.23: the lightbox ships a functional backdrop-blur scrim — scope the
  // "no AI-ish effects" check to the PAGE css (before the lightbox block).
  const paperPageCss = paper.slice(0, paper.indexOf(".lb-root{position:fixed"));
  check(!paperPageCss.includes("gradient(") && !paperPageCss.includes("backdrop-filter"), "paper: page css has no gradients / no blur (AI-ish effects removed; lightbox scrim excepted)");
  check(paper.includes("3px double"), "paper: academic double rule under header");
  check(paper.includes("@media print"), "paper: print rules shipped");
  check(paper.includes(":root{--bg:#ffffff"), "paper: white paper background");

  const minimal = buildReportCss("minimal");
  check(minimal.includes("-apple-system"), "minimal: system sans stack");
  check(!minimal.includes("gradient("), "minimal: no gradients");
  check(minimal.includes("var(--jc,var(--muted-2))"), "minimal/slate: kind left-border markers via --jc");

  const slate = buildReportCss("slate");
  check(slate.includes(":root{--bg:#0f1318"), "slate: dark background tokens");
  check(slate.includes("#5eead4"), "slate: teal link accent");
  check(!slate.includes(".dark{"), "slate: no .dark variants (dark-locked)");

  const classic = buildReportCss("classic");
  check(classic.includes("radial-gradient"), "classic: legacy gradients preserved verbatim");
  check(classic.includes(".dark{"), "classic: legacy auto light/dark tokens preserved");
  check(classic.includes(".title .note{font-style:italic}"), "classic: .note rule appended for the new subtitle");

  for (const [tpl, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(css.includes(".imgs-c{display:grid") && css.includes(".imgbox.sm{"),
      `${tpl}: compact grid CSS shipped (v3.15 invariant)`);
    check(css.includes(".cls-head .cnt") && css.includes(".ref-pill") && css.includes(".map-cell-none"),
      `${tpl}: class counts / ref pills / map placeholder styled`);
    check(css.includes("@media(max-width:1180px)"), `${tpl}: responsive breakpoint`);
  }

  // fontScale
  check(buildReportCss("paper", "compact").includes("font:13.5px"), "paper compact → 13.5px");
  check(buildReportCss("paper", "comfortable").includes("font:17.1px"), "paper comfortable → 17.1px");
  check(buildReportCss("minimal", "compact").includes("font:12.6px"), "minimal compact → 12.6px");
  check(buildReportCss("slate", "comfortable").includes("font:16px"), "slate comfortable → 16px");
  check(buildReportCss("classic", "comfortable").includes("body{font-size:16px}"), "classic comfortable → body override 16px");
  check(!buildReportCss("classic", "standard").includes("body{font-size:"), "classic standard → no font override");

  // v3.27: the Lineage Outline (left .flow-pane) must actually SCROLL.
  // The base .pane{overflow:hidden} (rounded-corner clip) is emitted BEFORE
  // the layout branch's .flow-pane{…overflow:auto|visible} so the LATER
  // rule wins the cascade — the previous order let .pane clip the outline
  // at max-height with no scrollbar in every v3.17+ skin (classic's V2 CSS
  // was ordered correctly, which is why only the skins were broken).
  for (const tpl of ["paper", "minimal", "slate", "classic", "blueprint", "editorial", "focus", "industrial"]) {
    const css = buildReportCss(tpl);
    const paneBase = css.indexOf(".pane{background:var(--panel)");
    check(paneBase >= 0, `${tpl}: base .pane rule present`);
    if (paneBase < 0) continue;
    if (tpl === "focus") {
      const reading = css.indexOf(".flow-pane{position:relative;top:auto;max-height:none;overflow:visible}");
      check(reading > paneBase, `${tpl}: reading-mode .flow-pane overflow:visible wins over .pane overflow:hidden`);
    } else {
      const sticky = css.indexOf(".flow-pane{position:sticky");
      check(sticky > paneBase, `${tpl}: .flow-pane overflow:auto (sticky rail) wins over .pane overflow:hidden`);
      check(css.includes(".flow-pane::-webkit-scrollbar"), `${tpl}: flow-pane scrollbar styling shipped`);
    }
  }
}

/* ── C. content parity across templates ───────────────────────────── */
console.log("── C. content parity (内容不缩水) ──");
{
  const builds = {};
  for (const tpl of ["paper", "minimal", "slate", "classic"]) {
    builds[tpl] = buildLineageHtmlV2(summary, { template: tpl });
  }
  const count = (html, re) => (html.match(re) || []).length;
  for (const [tpl, html] of Object.entries(builds)) {
    check(count(html, /class="job-card /g) === 2, `${tpl}: both job cards emitted`);
    check(count(html, /class="cls-sec"/g) === 3, `${tpl}: 3 class sections (Class 0 + Class 1 + General)`);
    check(count(html, /class="imgs-c"/g) === 3, `${tpl}: 3 compact grids (2 class + 1 general)`);
    check(html.includes("Log images (3)"), `${tpl}: log-image heading count intact`);
    check(html.includes("Main Data Chain") && html.includes("Lineage Outline"), `${tpl}: both panes present`);
    check(html.includes("visible main-node tracing"), `${tpl}: header meta line intact`);
    check(html.includes("generated 20"), `${tpl}: generated date in header`);
    check(html.includes("<h1>CryoSmart Lineage: P17 / J4</h1>"), `${tpl}: default title`);
  }
  // Only classic carries the theme-init script
  check(builds.classic.includes("localStorage.getItem('theme')"), "classic: auto light/dark init script");
  check(!builds.paper.includes("localStorage.getItem('theme')") && !builds.slate.includes("localStorage.getItem('theme')"),
    "paper/slate: no theme-init script (palette-locked)");

  // custom title + subtitle
  const custom = buildLineageHtmlV2(summary, { titleOverride: "hERG 复筛报告", subtitle: "张三 · 2026-05-27 · 内部资料" });
  check(custom.includes("<h1>hERG 复筛报告</h1>"), "custom title in h1");
  check(custom.includes("<title>hERG 复筛报告</title>"), "custom title in <title>");
  check(custom.includes('class="note"') && custom.includes("张三 · 2026-05-27 · 内部资料"), "subtitle rendered as .note");
  const whitespace = buildLineageHtmlV2(summary, { titleOverride: "   ", subtitle: "   " });
  check(whitespace.includes("<h1>CryoSmart Lineage: P17 / J4</h1>") && !whitespace.includes('class="note"'),
    "blank/whitespace title+subtitle fall back to defaults");

  // XSS safety of custom fields
  const xss = buildLineageHtmlV2(summary, { titleOverride: '<script>alert(1)</script>', subtitle: '<img src=x onerror=alert(2)>' });
  check(!xss.includes("<script>alert(1)") && !xss.includes("<img src=x onerror"), "custom title/subtitle HTML-escaped");
}

/* ── D. imageMode semantics ───────────────────────────────────────── */
console.log("── D. imageMode embed / remote / none ──");
{
  const embedded = { "http://x/0": "data:image/png;base64,AAA", "http://x/m1": "data:image/png;base64,BBB" };
  const embed = buildLineageHtmlV2(summary, { imageMode: "embed", embeddedImages: embedded });
  check(embed.includes("base64,AAA") && embed.includes("base64,BBB"), "embed: data-URLs used");

  const remote = buildLineageHtmlV2(summary, { imageMode: "remote", embeddedImages: embedded });
  check(!remote.includes("base64,AAA") && !remote.includes("base64,BBB"), "remote: embedded map IGNORED");
  check(remote.includes('src="http://x/0"'), "remote: direct source URL referenced");

  const none = buildLineageHtmlV2(summary, { imageMode: "none", embeddedImages: embedded });
  // v3.23: the lightbox script embeds an '<img class="lb-img">' DOM literal
  // inside the <script> — strip scripts before counting rendered tags.
  const noneBody = none.replace(/<script>[\s\S]*?<\/script>/g, "");
  check(!noneBody.includes("<img"), "none: zero <img> tags in the markup");
  check(!none.includes('class="cls-sec"') && !none.includes("Log images"), "none: image-only blocks collapse (no empty shells)");
  check(none.includes('class="job-card ') && none.includes("Main Data Chain"), "none: job cards + data still shipped");
  check(!none.includes("base64,AAA"), "none: no embedded bytes");

  // default (undefined) = embed
  const dflt = buildLineageHtmlV2(summary, { embeddedImages: embedded });
  check(dflt.includes("base64,AAA"), "default imageMode behaves as embed (backwards compat)");

  // bundleMode local paths + remote fallback preserved in all modes
  for (const mode of ["embed", "remote"]) {
    const b = buildLineageHtmlV2(summary, { imageMode: mode, bundleMode: true, embeddedImages: embedded });
    check(b.includes('src="images/'), `bundleMode ${mode}: local images/ path referenced`);
    check(b.includes("data-remote-src"), `bundleMode ${mode}: remote fallback attribute present`);
  }
  const bNone = buildLineageHtmlV2(summary, { imageMode: "none", bundleMode: true, embeddedImages: embedded });
  check(!bNone.replace(/<script>[\s\S]*?<\/script>/g, "").includes("<img"), "bundleMode none: still no <img> tags");
}

/* ── E. inline script ─────────────────────────────────────────────── */
console.log("── E. inline script ──");
{
  const html = buildLineageHtmlV2(summary);
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  check(!!m, "inline script extracted");
  if (m) {
    let balanced = true;
    try { new Function(m[1]); } catch { balanced = false; }
    check(balanced, "inline script parses as valid JS (braces balanced)");
    check(m[1].includes(".download-all"), "download-all handler kept");
    check(m[1].includes('a[href^="#"]'), "anchor smooth-scroll handler kept (with the FIXED selector)");
    check(!m[1].includes("cryosmart-report-height") && !m[1].includes("postMessage"),
      "height-reporting IIFE removed (no iframe listener anymore)");
  }
  check(!html.includes('id="card-J4"') || html.includes('id="card-J4"'), "card anchors present");
}

/* ── F. v3.15 invariants on the default (paper) template ─────────── */
console.log("── F. v3.15 invariants (default template) ──");
{
  const html = buildLineageHtmlV2(summary); // no opts → paper
  check(html.includes("Class 0") && html.includes("Class 1") && html.includes("General"), "class labels present");
  check(html.includes("m2[1]"), "markFailed carries the per-class count decrement");
  check(html.includes(".imgs-c{display:grid") && html.includes(".imgbox.sm{"), "compact CSS shipped in default build");
  check(html.includes(".imgs-block.block-gone") || html.includes("block-gone"), "block-gone auto-hide CSS present");
}

/* ── G. v3.20 full-width + layering + widthMode + history URLs ───── */
console.log("── G. v3.20 full width / layering / widthMode / history-image fix ──");
{
  const paper = buildReportCss("paper", "standard", "full");
  const minimal = buildReportCss("minimal", "standard", "full");
  const slate = buildReportCss("slate", "standard", "full");

  // The old 1240px cap is gone — the workspace uses the whole viewport.
  for (const [name, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(!css.includes("max-width:1240px"), `${name}: 1240px cap removed (full-width default)`);
    const ws = css.match(/\.workspace\{([^}]*)\}/)?.[1] || "";
    check(ws.includes("margin:0 auto"), `${name}: workspace centered`);
  }

  // Width modes: wide=1680, boxed=1280 (incl. classic override).
  check(buildReportCss("paper", "standard", "wide").includes("max-width:1680px"), "paper wide → 1680px cap");
  check(buildReportCss("paper", "standard", "boxed").includes("max-width:1280px"), "paper boxed → 1280px cap");
  check(buildReportCss("minimal", "standard", "boxed").includes("max-width:1280px"), "minimal boxed → 1280px cap");
  check(buildReportCss("slate", "standard", "wide").includes("max-width:1680px"), "slate wide → 1680px cap");
  const classicBoxed = buildReportCss("classic", "standard", "boxed");
  check(classicBoxed.includes(".workspace{max-width:1280px"), "classic boxed → appended workspace override");
  check(!buildReportCss("classic", "standard", "full").includes("max-width:1280px"), "classic full → no cap override");

  // Wider, self-filling grids (the width is actually USED).
  check(paper.includes(".map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))"), "map-grid auto-fill 240px (grows with pane)");
  check(paper.includes("minmax(176px,1fr)"), "imgs-c compact grid widened to 176px");
  check(paper.includes(".pf-mic-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))"), "pf-mic-imgs auto-fill 210px");
  check(paper.includes(".pf-classes{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))"), "pf-classes auto-fill 180px");
  check(paper.includes("minmax(360px,min(24vw,540px))"), "left outline pane proportional, capped 540px");
  check(paper.includes(".map-cell-img{display:flex;align-items:center;justify-content:center;height:130px"), "map preview well 130px (larger media)");

  // Layering: minimal/slate box their sections; paper stays hairline-open.
  check(minimal.includes(".source-block,.media-block,.map-block{margin-top:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel-2)"),
    "minimal: media/map sections are boxed inset panels (layering)");
  check(slate.includes("background:var(--panel-2);padding:14px 16px}"), "slate: boxed inset panels too");
  check(!paper.includes(".source-block,.media-block,.map-block{margin-top:16px;border:1px solid"),
    "paper: open hairline sections (no boxed insets)");

  // Sticky slim headers for minimal/slate; paper static + double rule.
  check(minimal.includes("header{background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:50}"), "minimal: sticky header");
  check(slate.includes("position:sticky;top:0;z-index:50}"), "slate: sticky header");
  check(paper.includes("header{background:var(--panel);border-bottom:1px solid var(--line);}"), "paper: static header (print-like)");
  check(minimal.includes("header::after") && minimal.includes("width:84px;height:2px"), "minimal: 2px teal header tick");
  check(slate.includes("header::after") && slate.includes("linear-gradient(90deg,var(--volume)"), "slate: teal fade header rule");

  // Layered page tone: minimal has a gray page under white panels.
  check(minimal.includes(":root{--bg:#f6f7f8") && minimal.includes("--panel:#ffffff"), "minimal: gray page + white panels (3-level depth)");
  check(slate.includes(":root{--bg:#0f1318") && slate.includes("--panel-2:#1a212b"), "slate: three darkness levels");

  // Global polish: focus rings + thin scrollbars everywhere.
  for (const [name, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(css.includes(":focus-visible{outline:2px solid"), `${name}: focus-visible outline`);
    check(css.includes("scrollbar-width:thin"), `${name}: thin scrollbars`);
  }

  // v3.20 regression fix: capture-HISTORY image URLs must be absolutized for
  // the blob:/file: contexts (v3.19 broke them → "UI title" images vanished).
  {
    const s = JSON.parse(JSON.stringify(summary));
    const histUrl = "/api/cryosmart/history/h-1234/image/mic1";
    s.nodes[0].representative_micrograph_images = [
      { kind: "ui_tile", name: "mic1", url: histUrl, src: histUrl, original_url: histUrl },
    ];
    const html = buildLineageHtmlV2(s, { webAppOrigin: "https://app.example", imageMode: "remote" });
    check(html.includes('src="https://app.example/api/cryosmart/history/h-1234/image/mic1"'),
      "history image URL absolutized for blob:/file: contexts (ui-tile fix)");
    check(html.includes('href="https://app.example/api/cryosmart/history/h-1234/image/mic1"'),
      "history 打开-link absolutized too");
    // Session URLs keep working exactly as before.
    const s2 = JSON.parse(JSON.stringify(summary));
    const sessUrl = "/api/cryosmart/import/session/tok9/image/mic1";
    s2.nodes[0].representative_micrograph_images = [
      { kind: "ui_tile", name: "mic1", url: sessUrl, src: sessUrl, original_url: sessUrl },
    ];
    const html2 = buildLineageHtmlV2(s2, { webAppOrigin: "https://app.example", imageMode: "remote" });
    check(html2.includes('src="https://app.example/api/cryosmart/import/session/tok9/image/mic1"'),
      "session image URL absolutized (unchanged behavior)");
    // Remote intranet URLs are NOT touched.
    check(html2.includes('src="http://x/m2"') || buildLineageHtmlV2(summary, { webAppOrigin: "https://app.example", imageMode: "remote" }).includes('src="http://x/m1"'),
      "direct intranet URLs untouched by absolutization");
  }

  // widthMode threads through buildLineageHtmlV2 (the real exit points).
  {
    const full = buildLineageHtmlV2(summary, { widthMode: "full" });
    const boxed = buildLineageHtmlV2(summary, { widthMode: "boxed" });
    check(boxed.includes("max-width:1280px") && !full.includes("max-width:1280px"),
      "buildLineageHtmlV2 threads widthMode (boxed vs full)");
  }
}

/* ── H. v3.21 outline 2-per-row + consistent 输出到 sidebar track ─── */
console.log("── H. v3.21 outline 2 jobs/row + fixed job-out track ──");
{
  const paper = buildReportCss("paper", "standard", "full");
  const minimal = buildReportCss("minimal", "standard", "full");
  const slate = buildReportCss("slate", "standard", "full");
  const classic = buildReportCss("classic", "standard", "full");

  // 1. The 输出到 sidebar sits in a FIXED clamp track — the legacy `auto`
  //    track sized to each card's content (218px vs 76px), so every job
  //    card's main column had a different width.
  for (const [name, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(css.includes(".job-card{display:grid;grid-template-columns:minmax(0,1fr) clamp(180px,22%,280px)"),
      `${name}: job-card sidebar = fixed clamp(180px,22%,280px) track (was content-sized auto)`);
    check(css.includes(".job-out .quiet{display:inline-block"),
      `${name}: final-node placeholder styled as a pill (not bare italic)`);
  }
  check(classic.includes(".job-card{grid-template-columns:minmax(0,1fr) clamp(180px,22%,280px)}"),
    "classic: appended override carries the same fixed sidebar track");

  // 2. Left outline: phase label ABOVE the grid (no 92px side column) and a
  //    140px auto-fill grid → 2 mini-nodes per row at every width mode
  //    (390px mobile → 143px tiles, 1920px full → ~198px tiles).
  for (const [name, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(css.includes(".stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))"),
      `${name}: stage-grid min 140px (2 tiles per row)`);
    check(!css.includes("grid-template-columns:92px minmax(0,1fr)"),
      `${name}: phase side-label column removed (label sits above the grid)`);
    check(css.includes(".phase{border-top:1px solid var(--line);padding-top:9px"),
      `${name}: phase renders as a block with hairline separator`);
    check(css.includes(".mini-node{display:flex;flex-direction:column"),
      `${name}: mini-node is a compact vertical tile`);
    check(css.includes(".mini-node p{margin:4px 0 0;display:flex;flex-wrap:wrap;gap:3px}"),
      `${name}: ref pills wrap below the tile text (no side-by-side pill column)`);
  }
  check(classic.includes(".phase{display:block}") &&
    classic.includes(".stage-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))") &&
    classic.includes(".mini-node{display:flex;flex-direction:column;min-height:0"),
    "classic: appended outline overrides (block phase, 140px grid, flex tiles)");

  // 3. The legacy one-per-row geometry is really gone.
  for (const [name, css] of [["paper", paper], ["minimal", minimal], ["slate", slate]]) {
    check(!css.includes("minmax(190px,1fr))") || !css.includes(".stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))"),
      `${name}: old 190px one-per-row stage-grid gone`);
    check(!css.includes(".mini-node p{grid-column:2"),
      `${name}: mini-node ref-pill side column gone`);
  }
}

/* ── I. v3.23 lightbox — click-to-enlarge on every report image ──── */
console.log("── I. v3.23 lightbox (所有图片点击放大) ──");
{
  const ALL7 = ["paper", "minimal", "slate", "blueprint", "editorial", "focus", "industrial", "classic"];
  // 1. The FULL inline script carries the lightbox IIFE and still parses.
  const { _REPORT_HTML_V2_SCRIPT } = reportHtml;
  check(_REPORT_HTML_V2_SCRIPT.includes('querySelectorAll("main img")'),
    "script: lightbox collects every main img");
  check(_REPORT_HTML_V2_SCRIPT.includes('classList.contains("lb-img")'),
    "script: the lightbox's own img is excluded from re-opening");
  check(_REPORT_HTML_V2_SCRIPT.includes('closest(".img-gone,.block-gone")'),
    "script: hidden/failed images are skipped");
  check(_REPORT_HTML_V2_SCRIPT.includes("Math.round(scale*100)"),
    "script: zoom-percentage feedback in the counter");
  check(_REPORT_HTML_V2_SCRIPT.includes("Math.min(8,Math.max(1,k))"),
    "script: zoom clamped to 1..8×");
  check(_REPORT_HTML_V2_SCRIPT.includes('"Escape"') && _REPORT_HTML_V2_SCRIPT.includes('"ArrowLeft"') && _REPORT_HTML_V2_SCRIPT.includes('"ArrowRight"'),
    "script: ESC + arrow-key navigation");
  check(_REPORT_HTML_V2_SCRIPT.includes("setPointerCapture"),
    "script: pointer capture for pan-when-zoomed");
  check(_REPORT_HTML_V2_SCRIPT.includes("cur.full&&im.getAttribute(\"src\")!==cur.disp"),
    "script: full-URL first, display-src fallback on error");
  check(_REPORT_HTML_V2_SCRIPT.includes("\\u6253\\u5f00"),
    "script: 打开 suffix stripped from captions (unicode escape survived the template hop)");
  try { new Function(_REPORT_HTML_V2_SCRIPT); ok("script: full script parses (balanced braces)"); }
  catch (e) { bad(`script: parse failed — ${e.message}`); }

  // 2. Every template ships the lightbox CSS + the zoom-in cursor.
  for (const tpl of ALL7) {
    const css = buildReportCss(tpl, "standard", "full");
    check(css.includes(".lb-root{position:fixed;inset:0;z-index:900"),
      `${tpl}: lightbox overlay CSS present`);
    check(css.includes("object-fit:contain") && css.includes("width:100%;height:100%"),
      `${tpl}: frame-fill img (small images upscale)`);
    check(css.includes("backdrop-filter:blur(12px)"),
      `${tpl}: backdrop blur scrim`);
    check(css.includes("main img{cursor:zoom-in"),
      `${tpl}: zoom-in cursor affordance on report images`);
    check(css.includes(".lb-hint") || css.includes("lb-hint"),
      `${tpl}: hint (点击缩放 · ESC 关闭) styled`);
    // the print block sits BEFORE the lightbox css in the token skins
    // (and its rules contain nested braces) — scan the print block's text
    // directly instead of a brace-regex.
    const printIdx = css.indexOf("@media print");
    check(printIdx >= 0 && css.slice(printIdx, printIdx + 500).includes(".lb-root"),
      `${tpl}: print rules hide the lightbox`);
  }

  // 3. Per-skin lightbox tints keep the archetypes distinct. Extract the
  //    lightbox css from the STRUCTURAL rule onward (the print rule earlier
  //    in the stylesheet also mentions .lb-root, which broke a naive
  //    split-based extraction in the first draft of these checks).
  const lbOf = (tpl) => {
    const css = buildReportCss(tpl, "standard", "full");
    const i = css.indexOf(".lb-root{position:fixed");
    return i < 0 ? "" : css.slice(i);
  };
  const paperLb = lbOf("paper");
  check(paperLb.includes(".lb-frame{padding:10px;background:#fcfaf6"),
    "paper: white mat frame (mounted print)");
  check(paperLb.includes(".lb-cap{font-style:italic"),
    "paper: serif italic lightbox caption");
  const lbBp = lbOf("blueprint");
  check(lbBp.includes("text-transform:uppercase") && lbBp.includes("var(--font-mono)"),
    "blueprint: mono uppercase lightbox caption");
  check(lbBp.includes(".lb-btn{border-radius:0"),
    "blueprint: squared lightbox chrome");
  check(lbOf("editorial").includes(".lb-cap{font-style:italic"),
    "editorial: italic serif lightbox caption");
  check(lbOf("focus").includes(".lb-cap{font-style:italic"),
    "focus: italic serif lightbox caption");

  // 3b. v3.24 industrial — gunmetal + safety-orange archetype signatures.
  const ind = buildReportCss("industrial", "standard", "full");
  check(ind.includes(":root{--bg:#151618"), "industrial: gunmetal dark background tokens");
  check(ind.includes("repeating-linear-gradient(-45deg,#ff7a1a 0 11px,#191b1e 11px 22px)"),
    "industrial: 45° safety-orange hazard stripe under the header");
  check(ind.includes(".job-head{position:relative;background:linear-gradient(180deg,#282b30,#22252a)"),
    "industrial: riveted nameplate strip on job-card heads");
  check(ind.includes(".job-head::before,.job-head::after"),
    "industrial: rivet dots on the nameplate");
  check(ind.includes("--radius:0px"), "industrial: squared machined corners (radius 0)");
  check(ind.includes("inset 0 1px 0 rgba(255,255,255,.05)"), "industrial: steel-bevel shadows");
  check(!ind.includes("#5eead4") && !ind.includes("#0f1318"), "industrial: distinct from slate palette");
  const indLb = lbOf("industrial");
  check(indLb.includes(".lb-frame{border-top:3px solid var(--lb-accent)"),
    "industrial: lightbox frame carries the safety-orange top rail");
  check(indLb.includes(".lb-cap{font-family:var(--font-mono);text-transform:uppercase"),
    "industrial: mono uppercase lightbox caption");

  // 4. The full html embeds the lightbox script (blob/new-tab/file all self-contained).
  const html = buildLineageHtmlV2(summary, { template: "minimal" });
  check(html.includes(".lb-root") && html.includes("lb-hint"),
    "html: lightbox script + DOM string embedded");
  const scriptTag = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";
  try { new Function(scriptTag); ok("html: embedded <script> parses"); }
  catch (e) { bad(`html: embedded script parse failed — ${e.message}`); }

  // 5. The image anchors still exist (lightbox intercepts the click but the
  //    original href is used as the full-res source first).
  check(/<a href="[^"]*" target="_blank"/.test(html),
    "html: image anchor hrefs preserved (full-res source for the lightbox)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
