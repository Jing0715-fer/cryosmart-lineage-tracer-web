#!/usr/bin/env bun
/**
 * v3.15 regression suite — class-grouped log images + links-only import fix.
 *
 * Covers:
 *  A. Class extraction (logImageClassIndexOf / groupLogImagesByClass /
 *     imageAssets class_index wiring) — title marker, bare-number title,
 *     class-gallery files, negative cases (rounds / series / "classes").
 *  B. Report HTML class grouping — hetero job renders .cls-sec sections +
 *     .imgs-c compact grid; flat jobs get the compact grid too.
 *  C. Links-only JSON import — THREE delivery paths:
 *     1. byte reuse from the still-present source entry (same instance),
 *     2. remote_image_urls persisted + on-demand proxy fetch by the
 *        history image endpoint (verified against a local test origin),
 *     3. embedded imports unchanged (regression guard).
 *  D. Graph modal grouping source (groupLogImagesByClass drives the tabs —
 *     same function as A, exercised through imageAssets on a hetero job).
 */
const BASE = "http://localhost:3000";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ FAIL: ${m}`); };
const j = (r) => r.json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. Class extraction unit tests ───────────────────────────────────
console.log("── A. Class extraction ──");
{
  const { logImageClassIndexOf, groupLogImagesByClass, imageAssets } = await import(
    "../src/lib/cryosmart/lineage.ts"
  );

  // Title / filename markers.
  logImageClassIndexOf("class 2 FSC", null) === 2 ? ok('"class 2 FSC" → 2') : bad("class 2 FSC");
  logImageClassIndexOf("Class 1", null) === 1 ? ok('"Class 1" → 1') : bad("Class 1");
  logImageClassIndexOf(null, "class_0_volume.png") === 0 ? ok("class_0_volume.png → 0") : bad("class_0_volume.png");
  logImageClassIndexOf(null, "0_class_3_fsc.png") === 3 ? ok("0_class_3_fsc.png → 3") : bad("0_class_3_fsc.png");

  // Negatives: series/rounds/entity words must NOT be classes.
  logImageClassIndexOf("Per particle scale factors 007", null) === null
    ? ok("numbered series title → null") : bad("series title misread as class");
  logImageClassIndexOf("Selected 21 classes", null) === null
    ? ok('"Selected 21 classes" → null') : bad("classes-plural misread");
  logImageClassIndexOf("Excluded 179 classes", null) === null
    ? ok('"Excluded 179 classes" → null') : bad("Excluded classes misread");

  // groupLogImagesByClass behavior.
  const mk = (kind, src, ci) => ({ kind, name: src, url: "u/" + src, src, original_url: "u/" + src, class_index: ci });
  const flat = groupLogImagesByClass([mk("log_image", "a", undefined), mk("log_image", "b", undefined)]);
  flat === null ? ok("no class info → flat (null)") : bad("no class info should be flat");
  const single = groupLogImagesByClass([mk("log_image", "a", 0)]);
  single === null ? ok("one class only → flat (null)") : bad("single class should be flat");
  const grouped = groupLogImagesByClass([
    mk("log_image", "a", 1), mk("log_image", "b", 0), mk("log_image", "c", undefined), mk("log_image", "d", 1),
  ]);
  grouped && grouped.length === 3 &&
    grouped[0].key === "class-0" && grouped[0].images.length === 1 &&
    grouped[1].key === "class-1" && grouped[1].images.length === 2 &&
    grouped[2].key === "general" && grouped[2].images.length === 1
    ? ok("grouped: class-0(1) + class-1(2) + general(1), sorted, general last")
    : bad(`unexpected groups: ${JSON.stringify(grouped?.map((g) => [g.key, g.images.length]))}`);

  // imageAssets wiring on a hetero job (refs + image_logs gallery).
  const job = {
    uid: "J9", job_type: "hetero_refine", project_uid: "P1",
    log_images: [
      { fileid: "h0", name: "fsc_0.png", text: "class 0 FSC", flags: null, src: "s/h0" },
      { fileid: "h1", name: "fsc_1.png", text: "class 1 FSC", flags: null, src: "s/h1" },
      { fileid: "hgen", name: "scale.png", text: "Per particle scale factors 007", flags: null, src: "s/hgen" },
    ],
    image_logs: [
      { _id: "e1", type: "image", text: "Final classes",
        imgfiles: [
          { fileid: "g0", filename: "J9_final_000.png", filetype: "image/png" },
          { fileid: "g1", filename: "J9_final_001.png", filetype: "image/png" },
        ] },
      { _id: "e2", type: "image", text: "2",
        imgfiles: [{ fileid: "b2", filename: "slice.png", filetype: "image/png" }] },
    ],
  };
  const assets = imageAssets(job, "http://x");
  const bySrc = Object.fromEntries(assets.map((a) => [a.src, a]));
  bySrc["s/h0"]?.class_index === 0 && bySrc["s/h1"]?.class_index === 1
    ? ok('hetero refs: "class 0/1 FSC" → class_index 0/1')
    : bad(`ref class wiring: ${bySrc["s/h0"]?.class_index}/${bySrc["s/h1"]?.class_index}`);
  bySrc["s/hgen"]?.class_index == null
    ? ok("series title ref stays unclassed") : bad("series ref misclassed");
  bySrc["http://x/api/log_image/g0"]?.class_index === 0 &&
  bySrc["http://x/api/log_image/g1"]?.class_index === 1
    ? ok('gallery files "J9_final_000/001.png" under "Final classes" → 0/1')
    : bad(`gallery class wiring: ${bySrc["http://x/api/log_image/g0"]?.class_index}/${bySrc["http://x/api/log_image/g1"]?.class_index}`);
  bySrc["http://x/api/log_image/b2"]?.class_index === 2
    ? ok('bare-number title "2" → class 2') : bad("bare-number title misclassed");

  // Non-class job: heuristics OFF (gallery/bare-number), explicit marker ON.
  const refine = {
    uid: "J8", job_type: "nu_refine", project_uid: "P1",
    log_images: [
      { fileid: "r1", name: "final_000.png", text: "Final classes", flags: null, src: "s/r1" },
      { fileid: "r2", name: "x.png", text: "3", flags: null, src: "s/r2" },
      { fileid: "r3", name: "y.png", text: "class 1 plot", flags: null, src: "s/r3" },
    ],
  };
  const ra = imageAssets(refine, "http://x");
  const rBySrc = Object.fromEntries(ra.map((a) => [a.src, a]));
  rBySrc["s/r1"]?.class_index == null && rBySrc["s/r2"]?.class_index == null
    ? ok("nu_refine: gallery/bare-number heuristics gated OFF")
    : bad("non-class job got heuristic classes");
  rBySrc["s/r3"]?.class_index === 1
    ? ok('nu_refine: explicit "class 1 plot" still → 1') : bad("explicit marker lost on non-class job");
}

// ── B. Report HTML class grouping ────────────────────────────────────
console.log("── B. Report class grouping ──");
{
  const { buildLineageHtmlV2 } = await import("../src/lib/cryosmart/report-html.ts");
  const node = {
    uid: "J9", job_type: "hetero_refine", project_uid: "P1", title: "hetero",
    status: "completed", parents: [], children: [],
    images: [
      { kind: "log_image", name: "fsc_0.png", url: "http://x/0", src: "http://x/0", original_url: "http://x/0", class_index: 0 },
      { kind: "log_image", name: "fsc_1.png", url: "http://x/1", src: "http://x/1", original_url: "http://x/1", class_index: 1 },
      { kind: "log_image", name: "scale.png", url: "http://x/2", src: "http://x/2", original_url: "http://x/2" },
    ],
    maps: [], classes: [], output_groups: {},
  };
  const html = buildLineageHtmlV2({
    project_uid: "P1", start_job_uid: "J9", nodes: [node], edges: [],
  });
  html.includes("cls-sec") && html.includes("cls-head") && html.includes("imgs-c")
    ? ok("hetero report: .cls-sec sections + .imgs-c compact grid emitted")
    : bad("class sections missing from report HTML");
  html.includes("Class 0") && html.includes("Class 1") && html.includes("General")
    ? ok("class labels present (Class 0 / Class 1 / General)")
    : bad("class labels missing");
  (html.match(/<div class="imgs-c">/g) || []).length === 3
    ? ok("3 compact grids (one per group)") : bad(`expected 3 imgs-c grids, got ${(html.match(/<div class="imgs-c">/g) || []).length}`);
  html.includes(".imgs-c{display:grid") && html.includes(".imgbox.sm{")
    ? ok("compact CSS shipped") : bad("compact CSS missing");
  html.includes("cls-sec") && html.includes("m2[1]")
    ? ok("markFailed carries the per-class count decrement") : bad("markFailed not extended");

  // Flat job: no cls-sec, but compact grid + legacy cap format retained.
  const flatNode = {
    uid: "J7", job_type: "nu_refine", project_uid: "P1", title: "refine",
    status: "completed", parents: [], children: [],
    images: [
      { kind: "log_image", name: "fsc.png", url: "http://x/f", src: "http://x/f", original_url: "http://x/f" },
    ],
    maps: [], classes: [], output_groups: {},
  };
  const flatHtml = buildLineageHtmlV2({ project_uid: "P1", start_job_uid: "J7", nodes: [flatNode], edges: [] });
  !flatHtml.includes('class="cls-sec"') && flatHtml.includes('class="imgs-c"')
    ? ok("flat job: no class sections, compact grid used") : bad("flat job layout wrong");
}

// ── C1. Links-only import: BYTE REUSE from the source entry ─────────
console.log("── C1. Links-only import → byte reuse ──");
let exportedJson = null;
let sourceEntryId = null;
{
  const sess = await fetch(`${BASE}/api/cryosmart/import/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P315", cryosmart_origin: "http://10.9.9.9:8080" }),
  }).then(j);
  sourceEntryId = sess.token;
  const job = {
    uid: "J1", job_type: "homo_abinit", status: "completed", project_uid: "P315",
    title: "abinit", parents: [], children: [], input_slot_groups: [],
    output_result_groups: [], params_spec: {},
  };
  await fetch(`${BASE}/api/cryosmart/import/session/${sourceEntryId}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P315", jobs: [job] }),
  });
  await fetch(`${BASE}/api/cryosmart/import/session/${sourceEntryId}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J1", images: [
      { fileid: "c1_img_a", name: "a.png", text: "class 0 FSC", flags: null },
      { fileid: "c1_img_b", name: "b.png", text: "class 1 FSC", flags: null },
    ] }] }),
  });
  await sleep(600);
  await fetch(`${BASE}/api/cryosmart/import/session/${sourceEntryId}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "c1_img_a", data: `data:image/png;base64,${PNG_B64}`, name: "a.png" },
      { fileid: "c1_img_b", data: `data:image/png;base64,${PNG_B64}`, name: "b.png" },
    ] }),
  });
  await sleep(600);
  await fetch(`${BASE}/api/cryosmart/import/session/${sourceEntryId}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  await sleep(800);

  // Export LINKS-ONLY (no embed).
  const exp = await fetch(`${BASE}/api/cryosmart/history/${sourceEntryId}/export`).then(j);
  exp.format === "cryosmart-capture/v1" && exp.images.length === 2 && exp.images.every((i) => !i.data)
    ? ok("links-only export: 2 images, no embedded bytes")
    : bad(`export shape wrong: ${JSON.stringify(exp.images?.map((i) => Object.keys(i)))}`);
  exportedJson = exp;

  // Import WITHOUT deleting the source → bytes must be REUSED.
  const imp = await fetch(`${BASE}/api/cryosmart/history/import`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exportedJson),
  }).then(j);
  imp.ok && imp.reused_images === 2
    ? ok(`import reused ${imp.reused_images} images from the source entry`)
    : bad(`reuse failed: ${JSON.stringify({ ok: imp.ok, reused: imp.reused_images, linked: imp.linked_images })}`);
  imp.entry?.counts?.images === 2 ? ok("entry counts.images = 2 (bytes present)") : bad(`counts.images=${imp.entry?.counts?.images}`);

  // The reused bytes actually SERVE.
  const img = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}/image/c1_img_a`);
  img.status === 200 && /png/i.test(img.headers.get("content-type") || "")
    ? ok("reused image served from disk (200 image/png)")
    : bad(`reused image fetch: status=${img.status} ct=${img.headers.get("content-type")}`);

  // Restore payload: the FRONTEND merge (toLoadedFromHistory) rewrites refs
  // to same-origin srcs — exercise that exact client pipeline.
  const detail = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}`).then(j);
  const { toLoadedFromHistory } = await import(
    "../src/app/components/cryosmart/use-imported-metadata.ts"
  );
  const loaded = toLoadedFromHistory(detail, imp.entry.id);
  const restoredRef = (loaded.raw.jobs || []).find((x) => x.uid === "J1")?.log_images?.[0];
  detail.data?.uploaded_image_ids?.includes("c1_img_a") &&
  restoredRef?.src === `/api/cryosmart/history/${imp.entry.id}/image/c1_img_a`
    ? ok("restore pipeline: uploaded ids + same-origin ref srcs")
    : bad(`restore payload wrong: uploaded=${JSON.stringify(detail.data?.uploaded_image_ids)} ref=${JSON.stringify(restoredRef)}`);
}

// ── C2. Links-only import: REMOTE on-demand proxy fetch ─────────────
console.log("── C2. Links-only import → on-demand remote fetch ──");
{
  // Local origin standing in for the intranet CryoSmart server.
  const PORT = 3999;
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/log_image/rmt_1") {
        return new Response(Buffer.from(PNG_B64, "base64"), {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
      if (url.pathname === "/api/log_image/svg_evil") {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
          { headers: { "Content-Type": "image/svg+xml" } },
        );
      }
      return new Response("nope", { status: 404 });
    },
  });

  try {
    const payload = {
      format: "cryosmart-capture/v1",
      app: "cryosmart-lineage-tracer-web",
      exported_at: new Date().toISOString(),
      capture: {
        id: "nonexistent-source-entry", project_uid: "P315R", experiment_uid: null,
        source_url: null, captured_at: new Date().toISOString(), end_job_uid: "J1",
        lineage_mode: false, cryosmart_origin: `http://127.0.0.1:${PORT}`,
      },
      counts: { jobs: 1, log_images: 2, images: 2, maps: 0 },
      url_templates: { log_image: "", download_result_file: "", note: "" },
      jobs: [{
        uid: "J1", job_type: "hetero_refine", status: "completed", project_uid: "P315R",
        title: "hetero", parents: [], children: [], input_slot_groups: [],
        output_result_groups: [], params_spec: {},
      }],
      job_log_images: { J1: [
        { fileid: "rmt_1", name: "a.png", text: "class 0 FSC" },
        { fileid: "svg_evil", name: "evil.svg", text: "evil" },
      ] },
      images: [
        { fileid: "rmt_1", name: "a.png", mime: "image/png", size: 70, url: `http://127.0.0.1:${PORT}/api/log_image/rmt_1` },
        { fileid: "svg_evil", name: "evil.svg", mime: "image/svg+xml", size: 80, url: `http://127.0.0.1:${PORT}/api/log_image/svg_evil` },
      ],
      maps: [],
    };
    const imp = await fetch(`${BASE}/api/cryosmart/history/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(j);
    imp.ok && imp.reused_images === 0 && imp.linked_images === 2
      ? ok("cross-instance import: 0 reused, 2 links persisted")
      : bad(`import counts: ${JSON.stringify({ ok: imp.ok, reused: imp.reused_images, linked: imp.linked_images })}`);

    // On-demand fetch: raster accepted (octet-stream sniffed → png).
    const r1 = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}/image/rmt_1`);
    r1.status === 200 && /png/i.test(r1.headers.get("content-type") || "")
      ? ok("remote link fetched on demand → 200 image/png (bytes sniffed)")
      : bad(`remote fetch: status=${r1.status} ct=${r1.headers.get("content-type")}`);

    // SVG payload REJECTED at the remote fallback (stored-XSS guard).
    const r2 = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}/image/svg_evil`);
    r2.status === 404
      ? ok("remote SVG payload rejected (raster-only sniff)")
      : bad(`svg_evil status=${r2.status}`);

    // Restore payload: the frontend merge must rewrite REMOTE-LINKED ids to
    // the same-origin history image endpoint (the links-only fix).
    const detail = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}`).then(j);
    const { toLoadedFromHistory } = await import(
      "../src/app/components/cryosmart/use-imported-metadata.ts"
    );
    const loaded = toLoadedFromHistory(detail, imp.entry.id);
    const restoredRef = (loaded.raw.jobs || []).find((x) => x.uid === "J1")?.log_images?.[0];
    detail.data?.remote_image_ids?.includes("rmt_1") &&
    restoredRef?.src === `/api/cryosmart/history/${imp.entry.id}/image/rmt_1`
      ? ok("links-only restore: remote ids rewritten to same-origin srcs")
      : bad(`remote restore wrong: remoteIds=${JSON.stringify(detail.data?.remote_image_ids)} ref=${JSON.stringify(restoredRef)}`);

    // Re-export keeps the URL index (chain exports).
    const reExp = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}/export`).then(j);
    reExp.images.some((i) => i.fileid === "rmt_1" && i.url.includes("3999"))
      ? ok("re-export preserves the link entries")
      : bad(`re-export lost links: ${JSON.stringify(reExp.images)}`);
  } finally {
    server.stop(true);
  }
}

// ── C3. Embedded import regression guard ────────────────────────────
console.log("── C3. Embedded import unchanged ──");
{
  const exp = await fetch(`${BASE}/api/cryosmart/history/${sourceEntryId}/export?embed=1`).then(j);
  exp.images.every((i) => i.data?.startsWith("data:image/png"))
    ? ok("embedded export carries data: URLs")
    : bad("embedded export lost data");
  const imp = await fetch(`${BASE}/api/cryosmart/history/import`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exp),
  }).then(j);
  imp.ok && imp.embedded_images === 2
    ? ok(`embedded import restored ${imp.embedded_images} images`)
    : bad(`embedded import: ${JSON.stringify({ ok: imp.ok, embedded: imp.embedded_images })}`);
  const img = await fetch(`${BASE}/api/cryosmart/history/${imp.entry.id}/image/c1_img_a`);
  img.status === 200 ? ok("embedded image serves from disk") : bad(`embedded serve status=${img.status}`);
}

// Cleanup: remove every entry this suite created.
{
  const list = await fetch(`${BASE}/api/cryosmart/history`).then(j);
  for (const e of list.entries || []) {
    if (e.project_uid === "P315" || e.project_uid === "P315R") {
      await fetch(`${BASE}/api/cryosmart/history/${e.id}`, { method: "DELETE" });
    }
  }
  console.log("── cleanup done ──");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
