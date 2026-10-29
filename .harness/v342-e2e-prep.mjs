/**
 * v3.42 E2E staging: posts the P208-shaped lineage (the user's uploaded
 * report topology) through the import-session API so the live app can
 * attach via /?imported=<token> and render the Report for browser
 * verification of the Picture Flow branch completeness + download ladder.
 *
 * Run: bun .harness/v342-e2e-prep.mjs   → prints TOKEN=...
 */
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

const main = async () => {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P208",
      cryosmart_origin: "http://192.168.202.11:8080",
      source: "sim",
      end_job_uid: "J498",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  if (!token) { console.error("no token", createResp.status); process.exit(1); }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P208", jobs }),
  });
  const complete = await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await fetch(`${APP}/api/cryosmart/import/session/${token}/data`).then((r) => r.json());
  console.log("TOKEN=" + token);
  console.log("nodes:", data?.summary?.nodes?.length ?? data?.jobs?.length ?? "?", "complete:", complete.status);
};

main().catch((err) => { console.error(err); process.exit(1); });
