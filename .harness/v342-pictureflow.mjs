/**
 * v3.42 harness (bun): Picture Flow branch completeness + download ladder.
 *
 * Rebuilds the user's P208 J498 topology (the uploaded sample report) and
 * asserts the three previously-invisible upstream branches now render:
 *   1. class_2D steps (J393/J410/J479/J481) between extract and select_2D
 *   2. import_volumes side-input card (J446) before J448
 *   3. hetero_refine junction provenance note (J484 来自 J420/J448/J483)
 * plus the multi-import list, the deduped 5-map set, and the download
 * ladder attributes (data-purls / download).
 *
 * Run: bun .harness/v342-pictureflow.mjs
 */
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("ok  : " + label); } else { fail++; console.log("FAIL: " + label); } };

const { buildSummary } = await import("../src/lib/cryosmart/lineage.ts");
const { buildLineageHtmlV2 } = await import("../src/lib/cryosmart/report-html.ts");

const BASE = "http://192.168.202.11:8080";
const APP = "http://localhost:3000";

/* --- helpers ---------------------------------------------------- */
const exposureGroup = (n) => [{ name: "micrographs", type: "exposure", num_items: n, contains: [] }];
const particleGroup = (n) => [{ name: "particles", type: "particle", num_items: n, contains: [] }];
const volumeGroup = (contains) => [{ name: "volume", type: "volume", num_items: contains.length, contains: contains.map((name) => ({ type: "volume.blob", name })) }];
const slots = (uid, group) => ({ job_uid: uid, group_name: group, slots: [] });
const inGroup = (type, conns) => ({ type, name: type, title: type, connections: conns });
const job = (uid, num, type, extra = {}) => ({
  uid, uid_num: num, project_uid: "P208", job_type: type,
  title: type, status: "completed", parents: [], children: [],
  input_slot_groups: [], output_result_groups: [],
  params_spec: {}, output_group_images: {}, ui_tile_images: [],
  ...extra,
});

/* --- P208-shaped dataset (trimmed to the interesting topology) --- */
const jobs = [
  job("J370", 370, "import_micrographs", { output_result_groups: exposureGroup(233), parents: [] }),
  job("J371", 371, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J370")])], parents: ["J370"] }),
  job("J375", 375, "import_micrographs", { output_result_groups: exposureGroup(500), parents: [] }),
  job("J376", 376, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J375")])], parents: ["J375"] }),
  job("J384", 384, "import_micrographs", { output_result_groups: exposureGroup(150), parents: [] }),
  job("J390", 390, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J384")])], parents: ["J384"] }),
  job("J391", 391, "blob_picker_gpu", { input_slot_groups: [inGroup("exposure", [slots("J390")])], parents: ["J390"], output_result_groups: particleGroup(113232) }),
  job("J392", 392, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J391")])], parents: ["J391"], output_result_groups: particleGroup(98636) }),
  job("J393", 393, "class_2D", { input_slot_groups: [inGroup("particle", [slots("J392")])], parents: ["J392"], output_result_groups: [
    { name: "classes", type: "volume", num_items: 50, contains: [] }, ...particleGroup(98636),
  ] }),
  job("J394", 394, "select_2D", { input_slot_groups: [inGroup("particle", [slots("J393")]), inGroup("template", [slots("J393", "classes")])], parents: ["J393"], output_result_groups: [
    { name: "particles_selected", type: "particle", num_items: 27879, contains: [] },
    { name: "templates_selected", type: "volume", num_items: 20, contains: [] },
  ] }),
  job("J404", 404, "import_micrographs", { output_result_groups: exposureGroup(4810), parents: [] }),
  job("J405", 405, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J404")])], parents: ["J404"] }),
  job("J407", 407, "topaz_train", { input_slot_groups: [inGroup("exposure", [slots("J405"), slots("J390")]), inGroup("particle", [slots("J394")])], parents: ["J405", "J390", "J394"], output_result_groups: exposureGroup(150) }),
  job("J408", 408, "topaz_extract", { input_slot_groups: [inGroup("exposure", [slots("J407"), slots("J371"), slots("J376"), slots("J390")]), inGroup("ml_model", [slots("J407")])], parents: ["J407", "J371", "J376", "J390"], output_result_groups: particleGroup(1440334) }),
  job("J409", 409, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J408")])], parents: ["J408"], output_result_groups: particleGroup(1417446) }),
  job("J410", 410, "class_2D", { input_slot_groups: [inGroup("particle", [slots("J409")])], parents: ["J409"], output_result_groups: [{ name: "classes", type: "volume", num_items: 40, contains: [] }] }),
  job("J414", 414, "select_2D", { input_slot_groups: [inGroup("particle", [slots("J410")])], parents: ["J410"], output_result_groups: [
    { name: "particles_selected", type: "particle", num_items: 615636, contains: [] },
    { name: "templates_selected", type: "volume", num_items: 34, contains: [] },
  ] }),
  job("J419", 419, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J414")])], parents: ["J414"], output_result_groups: particleGroup(600110) }),
  job("J420", 420, "homo_abinit", { input_slot_groups: [inGroup("particle", [slots("J419")])], parents: ["J419"], output_result_groups: [
    { name: "particles_class_0", type: "particle", num_items: 176730, contains: [] },
    { name: "particles_class_1", type: "particle", num_items: 193601, contains: [] },
    { name: "particles_class_2", type: "particle", num_items: 229779, contains: [] },
    { name: "volume_class_0", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
    ...volumeGroup([]).slice(0, 0),
  ] }),
  job("J422", 422, "homo_reconstruct", { input_slot_groups: [inGroup("particle", [slots("J420", "particles_class_1")])], parents: ["J420"], output_result_groups: particleGroup(193601) }),
  job("J424", 424, "homo_abinit", { input_slot_groups: [inGroup("particle", [slots("J422")])], parents: ["J422"], output_result_groups: [
    { name: "particles_class_0", type: "particle", num_items: 80093, contains: [] },
    { name: "volume_class_0", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
  ] }),
  job("J431", 431, "homo_abinit", { input_slot_groups: [inGroup("particle", [slots("J424", "particles_class_0")])], parents: ["J424"], output_result_groups: [
    { name: "particles_class_1", type: "particle", num_items: 25898, contains: [] },
    { name: "volume_class_1", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
  ] }),
  job("J443", 443, "homo_reconstruct", { input_slot_groups: [inGroup("particle", [slots("J431", "particles_class_1")])], parents: ["J431"], output_result_groups: particleGroup(25898) }),
  // THE hidden round-0 volume-template branch: import_volumes feeding J448
  job("J446", 446, "import_volumes", { parents: [], output_result_groups: volumeGroup(["map"]) }),
  job("J448", 448, "nonuniform_refine_new", {
    input_slot_groups: [inGroup("particle", [slots("J443")]), inGroup("volume", [slots("J446")])],
    parents: ["J443", "J446"],
    output_result_groups: volumeGroup(["map", "map_sharp", "map_half_A", "map_half_B", "mask_refine", "mask_fsc", "mask_fsc_auto", "precision"])
      .concat([{ name: "mask", type: "mask", num_items: 1, contains: [{ type: "mask.blob", name: "mask_refine" }] }]),
    fsc_xml: { name: "J448.volume.fsc.xml", xml: '<?xml version="1.0"?><fsc job="J448"><curve><p x="0.05" y="1.0"/><p x="0.3" y="0.143"/></curve></fsc>' },
  }),
  job("J474", 474, "import_micrographs", { output_result_groups: exposureGroup(5562), parents: [] }),
  job("J475", 475, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J474")])], parents: ["J474"] }),
  job("J477", 477, "blob_picker_gpu", { input_slot_groups: [inGroup("exposure", [slots("J475")])], parents: ["J475"], output_result_groups: particleGroup(4142713) }),
  job("J478", 478, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J477")])], parents: ["J477"], output_result_groups: particleGroup(3616757) }),
  job("J479", 479, "class_2D", { input_slot_groups: [inGroup("particle", [slots("J478")])], parents: ["J478"], output_result_groups: [{ name: "classes", type: "volume", num_items: 60, contains: [] }] }),
  job("J480", 480, "select_2D", { input_slot_groups: [inGroup("particle", [slots("J479")])], parents: ["J479"], output_result_groups: [
    { name: "particles_selected", type: "particle", num_items: 1045797, contains: [] },
    { name: "templates_selected", type: "volume", num_items: 51, contains: [] },
  ] }),
  job("J481", 481, "class_2D", { input_slot_groups: [inGroup("particle", [slots("J480")])], parents: ["J480"], output_result_groups: [{ name: "classes", type: "volume", num_items: 45, contains: [] }] }),
  job("J482", 482, "select_2D", { input_slot_groups: [inGroup("particle", [slots("J481")])], parents: ["J481"], output_result_groups: [
    { name: "particles_selected", type: "particle", num_items: 496532, contains: [] },
    { name: "templates_selected", type: "volume", num_items: 43, contains: [] },
  ] }),
  job("J483", 483, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J482")])], parents: ["J482"], output_result_groups: particleGroup(484145) }),
  // THE junction job: J420 particles+map, J448 map, J483 particles
  job("J484", 484, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J420", "particles_class_0"), slots("J420", "particles_class_1"), slots("J420", "particles_class_2"), slots("J483")]),
      inGroup("volume", [slots("J448"), slots("J420", "volume_class_0")]),
    ],
    parents: ["J420", "J483", "J448"],
    output_result_groups: [
      { name: "particles_class_3", type: "particle", num_items: 469090, contains: [] },
      { name: "volume_class_3", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
    ],
  }),
  job("J485", 485, "nonuniform_refine_new", { input_slot_groups: [inGroup("particle", [slots("J484", "particles_class_3")]), inGroup("volume", [slots("J484", "volume_class_3")])], parents: ["J484"], output_result_groups: volumeGroup(["map", "map_sharp", "map_half_A", "map_half_B"]) }),
  job("J493", 493, "homo_abinit", { input_slot_groups: [inGroup("particle", [slots("J485")]), inGroup("volume", [slots("J485")])], parents: ["J485"], output_result_groups: [
    { name: "particles_class_0", type: "particle", num_items: 118334, contains: [] },
    { name: "volume_class_0", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
  ] }),
  job("J494", 494, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J493")]), inGroup("volume", [slots("J493", "volume_class_0")])],
    parents: ["J493"],
    output_result_groups: [
      { name: "particles_class_1", type: "particle", num_items: 293462, contains: [] },
      { name: "volume_class_1", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
    ],
  }),
  job("J497", 497, "nonuniform_refine_new", { input_slot_groups: [inGroup("particle", [slots("J494", "particles_class_1")]), inGroup("volume", [slots("J494", "volume_class_1")])], parents: ["J494"], output_result_groups: volumeGroup(["map", "map_sharp"]) }),
  job("J498", 498, "deep_emhancer", { input_slot_groups: [inGroup("volume", [slots("J497")])], parents: ["J497"], output_result_groups: volumeGroup(["map"]) }),
];

const summary = buildSummary(jobs, "P208", "J498", BASE);
ok((summary.nodes || []).length >= 35, `summary built with ${summary.nodes?.length} nodes`);

const html = buildLineageHtmlV2(summary, {
  session: { baseUrl: BASE, cookie: "session=abc" },
  webAppOrigin: APP,
  images: true,
});

/* --- 1. class_2D steps in the flow -------------------------------- */
for (const uid of ["J393", "J410", "J479", "J481"]) {
  ok(html.includes(`pf-step pf-class2d`) && html.includes(`>${uid} class_2D</div>`),
    `class_2D step ${uid} rendered in the Picture Flow`);
}
ok(html.includes("J394 select_2D 从中挑选"), "class_2D card chains to its consumer (J394)");
ok((html.match(/pf-step pf-class2d/g) || []).length === 4, "exactly 4 class_2D steps (no dupes from other predicates)");

/* --- 2. import_volumes side-input card --------------------------- */
ok(html.includes("J446 import_volumes"), "J446 import_volumes visible in the flow");
ok(html.includes("pf-side"), "dashed 分支输入 side card rendered");
ok(html.includes("分支输入 → J448"), "side card names its consumer (J448)");
const sidePos = html.indexOf('class="pf-side"');
const j448Pos = html.indexOf(">J448 ");
ok(sidePos > 0 && j448Pos > sidePos, "side card sits before the J448 step");

/* --- 3. hetero junction provenance note ------------------------- */
ok(html.includes("来自: J420(颗粒)"), "J484 来自 note lists J420 (particles)");
ok(html.includes("J448(map)"), "J484 来自 note lists J448 (map)");
ok(html.includes("J483(颗粒)"), "J484 来自 note lists J483 (particles)");
// single-source steps must NOT carry the note (junction-only gate)
const j422Step = html.slice(html.indexOf(">J422 "), html.indexOf(">J422 ") + 900);
ok(!j422Step.includes("来自:"), "single-source J422 has no 来自 note (junction-only)");

/* --- 4. multi-import list ----------------------------------------- */
// v3.47: headline = the SUM over every import job (233+500+150+4,810+5,562
// = 11,255), a caption names how many import jobs were totalled, and the
// main import's own count stays visible in the note (每个 job 的数量 + 总数量).
ok(html.includes("11,255 micrographs"), "headline is the SUM of all import counts (11,255)");
ok(html.includes("共 5 个导入作业合计"), "caption names the 5 totalled import jobs");
ok(html.includes("5,562 micrographs"), "main import J474's own count is spelled out in the note (5,562)");
ok(html.includes(">J474 import_micrographs"), "headline identity is J474 (largest import)");
ok(html.includes("其他 micrograph 导入（4）"), "other-imports list shows the remaining 4 branches");
for (const uid of ["J370", "J375", "J384", "J404"]) {
  ok(html.includes(`pf-import-row`) && html.includes(`<b>${uid}</b>`), `import row ${uid} listed`);
}

/* --- 5. map set + download ladder --------------------------------- */
const j448Card = html.slice(html.indexOf('id="card-J448"'), html.indexOf('id="card-J474"'));
ok((j448Card.match(/class="map-cell"/g) || []).length === 5, "J448 map grid has exactly 5 cells (mask_refine dedup, precision out)");
ok(!j448Card.includes("precision"), "no precision cell in J448");
const dlBtn = (j448Card.match(/<button[^>]*class="download-all"[^>]*>/) || [])[0] || "";
ok(dlBtn.includes('data-urls='), "J448 one-click button carries data-urls");
ok(dlBtn.includes('data-purls='), "J448 one-click button carries the v3.42 proxied twins (data-purls)");
const purls = dlBtn.match(/data-purls="([^"]*)"/);
ok(!!purls && decodeURIComponent(purls[1]).split("|").filter((u) => u.includes("/download_result_file/")).length === 5,
  "data-purls holds 5 app-proxied map twins (data: FSC entry carries none)");
ok(j448Card.includes('download target="_blank">下载 map'), "per-cell map links carry the download attribute");
ok(j448Card.includes("一键下载 map + FSC XML"), "button label includes FSC XML");
// FSC chip downloads as a file (data: URL + download attr)
ok(/class="map-dl" href="data:text\/xml[^"]*" download="BJ\.P208\.J448\.volume\.fsc\.xml"/.test(j448Card),
  "FSC chip has download attr (data: navigation no longer blocked)");

/* --- 6. class table download attr --------------------------------- */
const j420Card = html.slice(html.indexOf('id="card-J420"'), html.indexOf('id="card-J422"'));
ok(j420Card.includes('<a href="' + BASE + '/api/log_image/download_result_file/P208/J420.volume_class_0.map" download'), "class table map link carries download attr");

/* --- 7. class_2D flow steps land between extract and select_2D ---- */
const flowStart = html.indexOf('class="picture-flow"');
const flowHtml = html.slice(flowStart, html.indexOf('class="pane chain-pane"'));
const pos = (uid) => flowHtml.indexOf(">" + uid + " ");
ok(pos("J392") < pos("J393") && pos("J393") < pos("J394"), "flow order extract → class_2D → select_2D");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
