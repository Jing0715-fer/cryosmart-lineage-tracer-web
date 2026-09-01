/**
 * v328-output-fallback.mjs — regression for the two v3.28 fixes.
 *
 * User report: "如果 log image 缺失，应该用 output group image 代替" and
 * "从 72 个 job 中抓取日志和图片，只有 40 多个完成了，30 多个没有进行
 *  —— 这个才是主要问题，需要彻底解决".
 *
 * Covers:
 *   A. capture script structure — job-scaled scan ceilings (the flat 5-min
 *      budget deterministically cut a 72-job traced scan at 41), per-job
 *      fault isolation (a throwing job must not kill the scan loop), and
 *      the v3.28 markers.
 *   B. outputPreviewFallbackImages — the selection rules: log images
 *      present → none; import/select2D/class/map blocks already render
 *      images → none; otherwise the job's ui_tile + output_group previews
 *      (capped at 6).
 *   C. reportMediaBlock — the "Output group 预览 (N)" substitution block
 *      renders exactly when B returns assets; markFailed's h3 count
 *      rewrite still matches the heading; imageMode none strips it.
 *   D. image-embed.ts — the prefetch scope mirrors the rendered fallback
 *      (data:-URL passthrough proves collection without a network).
 *   E. lineage.ts jobNode integration — a real JobMetadata whose
 *      ui_tile_images carry SESSION urls (post mergeLogImagesIntoRaw
 *      shape) flows into the fallback block with its src intact.
 *
 * Run:  bun .harness/v328-output-fallback.mjs   (from the repo root)
 * Pure unit tests — no server, no browser.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log(`  ok - ${msg}`); }
function bad(msg) { fail++; console.log(`  BAD - ${msg}`); }
function check(cond, msg, detail) {
  (cond ? ok : bad)(msg);
  if (!cond && detail) console.log(`       ${detail}`);
}

const script = fs.readFileSync("/tmp/capture-script-check.js", "utf8");
const reportHtml = await import("../src/lib/cryosmart/report-html.ts");
const lineage = await import("../src/lib/cryosmart/lineage.ts");
const imageEmbed = await import("../src/lib/cryosmart/image-embed.ts");
const { outputPreviewFallbackImages, reportMediaBlock, OUTPUT_PREVIEW_FALLBACK_LIMIT } = reportHtml;

/* ── A. capture script structure ─────────────────────────────────── */
console.log("── A. capture script (v3.28 scan coverage fixes) ──");
{
  check(script.length > 50000, "script extracted (run extract-capture-script.cjs first)");
  try { new Function(script); check("script parses (new Function)", true); }
  catch (e) { check("script parses (new Function)", false, e.message); }

  check(script.includes("Smart Capture v3.29"), "script self-identifies as v3.29 (current)");
  check(
    /BUDGET_MS = budgetMs \|\| Math\.max\(300000, pending\.length \* 150000\);/.test(script),
    "traced-pass ceiling scales: max(300s, jobs x 150s)",
  );
  check(
    script.includes("scanLogs(Math.max(1200000, rest3.length * 150000))"),
    "rest-pass ceiling scales: max(1200s, jobs x 150s)",
  );
  check(
    !script.includes("scanLogs(1200000);") &&
      !/BUDGET_MS = budgetMs \|\| 300000;/.test(script),
    "old flat ceilings (300s / 1200s) gone",
  );
  // the per-job loop survives a throwing job
  const perJobTry = script.indexOf("var logs2 = null, imgs2 = [];");
  const loopHead = script.indexOf("for (var j = 0; j < pending.length; j++) {");
  check(
    perJobTry > loopHead && perJobTry < loopHead + 2000,
    "per-job retrieval wrapped inside the scan loop",
  );
  check(
    script.includes("images: imgs2 });") && script.includes("(recorded as no-log; the scan continues)"),
    "a throwing job streams an empty batch and the scan continues",
  );
  check(
    script.includes("nothing is lost"),
    "budget-cut console line explains the rest pass picks the jobs up",
  );
  // empty-batch streaming still counted exactly
  check(
    script.includes("if (!logs2 || !logs2.length) noLog.push(uid2);"),
    "no-log bookkeeping intact for the slow-log rescue",
  );

  const panelSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "components", "cryosmart", "smart-capture-panel.tsx"),
    "utf8"
  );
  check(panelSrc.includes("v3.28"), "panel source carries the v3.28 comment trail");
  const chromeSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "components", "cryosmart", "site-chrome.tsx"),
    "utf8"
  );
  check(chromeSrc.includes("v3.29"), "site banner bumped to v3.29");
  const hookSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "components", "cryosmart", "use-imported-metadata.ts"),
    "utf8"
  );
  check(
    hookSrc.includes("the report shows their output-group previews instead"),
    "final summary explains the fallback where the user reads it",
  );
}

/* ── fixtures ─────────────────────────────────────────────────────── */
const img = (kind, name, n) => ({
  kind, name,
  url: `http://x/${kind}-${n}`,
  src: `http://x/${kind}-${n}`,
  original_url: `http://x/${kind}-${n}`,
});
const baseNode = (over = {}) => ({
  uid: "J1", job_type: "ctf_refine", project_uid: "P", title: "t",
  status: "completed", parents: [], children: [],
  images: [], maps: [], classes: [], output_groups: {},
  ...over,
});

/* ── B. outputPreviewFallbackImages selection rules ──────────────── */
console.log("── B. outputPreviewFallbackImages selection ──");
{
  const previews = [img("ui_tile", "tile_a", 1), img("ui_tile", "tile_b", 2), img("output_group", "volume_main", 3)];
  let r = outputPreviewFallbackImages(baseNode({ images: previews }));
  check(r.length === 3 && r.every((a) => a.kind === "ui_tile" || a.kind === "output_group"),
    "no-log job → its ui_tile + output_group assets are the fallback", JSON.stringify(r.map((a) => a.name)));

  r = outputPreviewFallbackImages(baseNode({ images: [img("log_image", "fsc", 1), ...previews] }));
  check(r.length === 0, "job WITH log images → no fallback (log block renders)");

  r = outputPreviewFallbackImages(baseNode({
    job_type: "import_micrographs",
    images: previews,
    representative_micrograph_images: previews.slice(0, 1),
  }));
  check(r.length === 0, "import job with micrograph previews → no fallback (micrograph block renders)");

  r = outputPreviewFallbackImages(baseNode({
    job_type: "import_micrographs",
    images: previews,
    representative_micrograph_images: [],
  }));
  check(r.length === 3, "import job whose micrograph block is empty → fallback applies");

  r = outputPreviewFallbackImages(baseNode({
    job_type: "select_2D",
    select_2d: { particles_selected: 10 },
    images: [
      img("ui_tile", "templates_selected", 1),
      img("ui_tile", "templates_excluded", 2),
      img("ui_tile", "particles_selected", 3),
      img("ui_tile", "extra_tile", 4),
    ],
  }));
  check(r.length === 1 && r[0].name === "extra_tile",
    "select_2D: the three template tiles are excluded (Select 2D block renders them)", JSON.stringify(r.map((a) => a.name)));

  r = outputPreviewFallbackImages(baseNode({
    images: previews,
    classes: [{ class_index: 0, mrc_preview_url: "http://x/c0", maps: [] }],
  }));
  check(r.length === 0, "class job with mrc previews → no fallback (classes table renders them)");

  r = outputPreviewFallbackImages(baseNode({
    images: previews,
    classes: [{ class_index: 0, mrc_preview_url: null, maps: [] }],
  }));
  check(r.length === 3, "class job whose table rows have NO previews → fallback applies");

  r = outputPreviewFallbackImages(baseNode({
    images: previews,
    maps: [{ group: "volume_0", result_name: "map", preview_url: "http://x/pv", group_type: "volume" }],
  }));
  check(r.length === 0, "map job with preview-bearing maps → no fallback (map grid renders them)");

  r = outputPreviewFallbackImages(baseNode({
    images: previews,
    maps: [{ group: "volume_0", result_name: "map", preview_url: null, group_type: "volume" }],
  }));
  check(r.length === 3, "map job whose maps carry no previews → fallback applies");

  const eight = Array.from({ length: 8 }, (_, i) => img("ui_tile", `tile_${i}`, i));
  r = outputPreviewFallbackImages(baseNode({ images: eight }));
  check(r.length === OUTPUT_PREVIEW_FALLBACK_LIMIT && r[5].name === "tile_5",
    `fallback capped at ${OUTPUT_PREVIEW_FALLBACK_LIMIT} (8 tiles → 6)`);

  r = outputPreviewFallbackImages(baseNode({}));
  check(r.length === 0, "job with no images at all → no fallback (nothing to show)");
}

/* ── C. reportMediaBlock renders the substitution ────────────────── */
console.log("── C. reportMediaBlock fallback rendering ──");
{
  const previews = [img("ui_tile", "tile_a", 1), img("output_group", "volume_main", 3)];
  const html = reportMediaBlock(baseNode({ uid: "J7", images: previews }));
  check(html.includes("Output group 预览 (2) — 未捕获到 log 图像，以输出预览代替"),
    "no-log job renders the substitution block with its count + explanation");
  check(html.includes("imgs-block") && html.includes('src="http://x/ui_tile-1"') && html.includes('src="http://x/output_group-3"'),
    "fallback figures carry the ui_tile + output_group srcs in an imgs-block");

  const withLogs = reportMediaBlock(baseNode({
    uid: "J8",
    images: [img("log_image", "fsc", 1), ...previews],
  }));
  check(withLogs.includes("Log images (1)") && !withLogs.includes("Output group 预览"),
    "job with log images keeps the log block and gets NO fallback block");

  const none = reportMediaBlock(baseNode({ uid: "J9", images: previews }), { imageMode: "none" });
  check(!none.includes("<img") && !none.includes("Output group 预览"),
    "imageMode none strips the fallback block (no imgs at all)");

  // markFailed's h3 count rewrite must still parse the new heading shape
  const h3 = "Output group 预览 (4) — 未捕获到 log 图像，以输出预览代替";
  const m = h3.match(/\((\d+)(?:\s*\/\s*(\d+))?\)/);
  check(!!m && m[1] === "4", "markFailed count regex matches the fallback heading");
  check(h3.replace(m[0], "(3)").startsWith("Output group 预览 (3)"),
    "count rewrite leaves the rest of the heading intact");

  // the empty-batch no-log job with no previews renders nothing extra
  const bare = reportMediaBlock(baseNode({ uid: "J10" }));
  check(!bare.includes("Output group 预览") && !bare.includes("<img"),
    "no-preview job renders no fallback (and no broken img)");
}

/* ── D. image-embed prefetch mirrors the fallback scope ──────────── */
console.log("── D. image-embed prefetch scope ──");
{
  const data = (s) => `data:image/png;base64,${s}`;
  const summary = {
    project_uid: "P", start_uid: "J1",
    nodes: [
      baseNode({ uid: "J1", images: [
        { kind: "ui_tile", name: "tile_a", url: data("TILE1"), src: data("TILE1"), original_url: data("TILE1") },
      ] }),
      baseNode({ uid: "J2", images: [
        { kind: "log_image", name: "fsc", url: data("LOG1"), src: data("LOG1"), original_url: data("LOG1") },
      ] }),
      // select_2D: templates_selected is NOT collected — the Select 2D block
      // owns it and this fixture's select_2d carries no image of its own
      baseNode({ uid: "J3", job_type: "select_2D", select_2d: { particles_selected: 9 }, images: [
        { kind: "ui_tile", name: "templates_selected", url: data("SEL1"), src: data("SEL1"), original_url: data("SEL1") },
      ] }),
    ],
    start_job: baseNode({ uid: "J0", images: [
      { kind: "output_group", name: "volume_main", url: data("START1"), src: data("START1"), original_url: data("START1") },
    ] }),
  };
  const out = await imageEmbed.prefetchImagesForReport(null, summary);
  check(out[data("TILE1")] === data("TILE1"), "no-log node's ui_tile fallback src is collected (embeds)");
  check(out[data("LOG1")] === data("LOG1"), "log node's log image still collected");
  check(out[data("START1")] === data("START1"), "start job's output_group fallback collected too");
  check(!(data("SEL1") in out), "excluded select_2D template tile is NOT collected (dedupe mirrored)");
}

/* ── E. jobNode integration (real data path) ─────────────────────── */
console.log("── E. jobNode → fallback integration ──");
{
  const sessionTile = "http://localhost:3000/api/cryosmart/import/session/TOK/image/F1";
  const job = {
    uid: "J9", job_type: "ctf_refine", project_uid: "P", title: "ctf",
    ui_tile_images: [{ name: "tile_a", fileid: sessionTile }],
    output_group_images: { volume_main: "F2" },
  };
  const node = lineage.jobNode(job, "http://cs.example:8080", "P");
  const fallback = outputPreviewFallbackImages(node);
  check(fallback.length === 2, "jobNode output: both preview assets selected", JSON.stringify(fallback.map((a) => a.name)));
  check(fallback[0].src === sessionTile, "session-URL tile src passes through logImageUrl untouched");
  check(fallback[1].src === "http://cs.example:8080/api/log_image/F2",
    "bare-fileid output group resolves to the canonical log_image URL");
  const html = reportMediaBlock(node);
  check(html.includes("Output group 预览 (2)") && html.includes(sessionTile) && html.includes("api/log_image/F2"),
    "reportMediaBlock renders both through the real jobNode path");

  // and a job WITH log_images (capture-script stream shape) gets no fallback
  const job2 = {
    ...job,
    log_images: [{ fileid: "F9", name: "fsc.png", text: "fsc", src: "data:image/png;base64,ZZ" }],
  };
  const node2 = lineage.jobNode(job2, "http://cs.example:8080", "P");
  const logKinds = node2.images.filter((a) => a.kind === "log_image");
  check(logKinds.length === 1, "log_images refs become log_image assets (logSrc preferred)");
  check(outputPreviewFallbackImages(node2).length === 0, "same job with log images → no fallback");
  const html2 = reportMediaBlock(node2);
  check(html2.includes("Log images (1)") && !html2.includes("Output group 预览"), "log block renders, fallback silent");
}

/* ── F. the fallback block ships in EVERY report template ────────── */
console.log("── F. fallback across all 8 templates ──");
{
  const { buildLineageHtmlV2 } = reportHtml;
  const { REPORT_TEMPLATES } = await import("../src/lib/cryosmart/report-style.ts");
  const previews = [img("ui_tile", "tile_a", 1), img("output_group", "volume_main", 3)];
  const summary = {
    project_uid: "P", start_uid: "J1",
    nodes: [baseNode({ uid: "J1", images: previews })],
    edges: [],
    start_job: baseNode({ uid: "J1", images: previews }),
  };
  for (const t of REPORT_TEMPLATES) {
    let html = "";
    try { html = buildLineageHtmlV2(summary, { template: t.id, imageMode: "embed" }); }
    catch (e) { check(false, `template ${t.id} builds`, e.message); continue; }
    check(
      html.includes("Output group 预览 (2)") && html.includes('src="http://x/ui_tile-1"'),
      `template ${t.id}: fallback block + figures render`,
    );
    const imgs = (html.match(/<img/g) || []).length;
    check(imgs >= 2, `template ${t.id}: both fallback <img> tags present (${imgs})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed${fail ? " — FIX BEFORE SHIPPING" : ""}`);
process.exit(fail ? 1 : 0);
