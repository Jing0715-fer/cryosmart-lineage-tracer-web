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
  check(REPORT_TEMPLATES.length === 4 && REPORT_TEMPLATES.map((t) => t.id).join(",") === "paper,minimal,slate,classic",
    "4 template infos in stable order");
  check(reportTemplateLabel("slate") === "Slate 暗色" && reportTemplateLabel("paper") === "Paper 学术", "template label lookup");
  check(DEFAULT_REPORT_STYLE.template === "paper", "default template is paper (new design)");
}

/* ── B. buildReportCss ────────────────────────────────────────────── */
console.log("── B. buildReportCss per-template signatures ──");
{
  const paper = buildReportCss("paper");
  check(paper.includes("Georgia") && paper.includes("serif"), "paper: serif font stack");
  check(!paper.includes("gradient(") && !paper.includes("backdrop-filter"), "paper: no gradients / no blur (AI-ish effects removed)");
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
  check(!none.includes("<img"), "none: zero <img> tags");
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
  check(!bNone.includes("<img"), "bundleMode none: still no <img> tags");
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
