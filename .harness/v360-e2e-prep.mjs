/**
 * v3.60 E2E staging: posts a LONG 16-job map-bearing lineage (P360) through
 * the import-session API so the live app attaches via /?imported=<token>,
 * auto-traces from J16, and the Workflow Figure card's 手动 checklist gets
 * ~9-10 rows — enough to exceed the fixed max-h-64 box and prove the
 * round-19 overflow fix (the list must CLIP + scroll INSIDE its panel,
 * never overlap the content below).
 *
 * Run: bun .harness/v360-e2e-prep.mjs   → prints TOKEN=...
 */
const APP = process.env.APP_URL || "http://localhost:3011";

/* --- capture-shape helpers (v342 style) ------------------------- */
const exposureGroup = (n) => [{ name: "micrographs", type: "exposure", num_items: n, contains: [] }];
const particleGroup = (n) => [{ name: "particles", type: "particle", num_items: n, contains: [] }];
const volumeGroup = (contains) => [
  { name: "volume", type: "volume", num_items: contains.length, contains: contains.map((name) => ({ type: "volume.blob", name })) },
];
const classSplitGroups = (classes) =>
  classes.flatMap(([idx, count]) => [
    { name: `particles_class_${idx}`, type: "particle", num_items: count, contains: [] },
    { name: `volume_class_${idx}`, type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
  ]);
const slots = (uid, group) => ({ job_uid: uid, group_name: group, slots: [] });
const inGroup = (type, conns) => ({ type, name: type, title: type, connections: conns });
const job = (uid, num, type, extra = {}) => ({
  uid,
  uid_num: num,
  project_uid: "P360",
  job_type: type,
  title: type,
  status: "completed",
  parents: [],
  children: [],
  input_slot_groups: [],
  output_result_groups: [],
  params_spec: {},
  output_group_images: {},
  ui_tile_images: [],
  ...extra,
});

const jobs = [
  job("J1", 1, "import_micrographs", { output_result_groups: exposureGroup(6060), parents: [] }),
  job("J2", 2, "patch_ctf_estimation_multi", { input_slot_groups: [inGroup("exposure", [slots("J1")])], parents: ["J1"] }),
  job("J3", 3, "blob_picker_gpu", { input_slot_groups: [inGroup("exposure", [slots("J2")])], parents: ["J2"], output_result_groups: particleGroup(1634842) }),
  job("J4", 4, "extract_micrographs_multi", { input_slot_groups: [inGroup("particle", [slots("J3")])], parents: ["J3"], output_result_groups: particleGroup(1588675) }),
  job("J5", 5, "class_2D", { input_slot_groups: [inGroup("particle", [slots("J4")])], parents: ["J4"], output_result_groups: [{ name: "classes", type: "volume", num_items: 50, contains: [] }] }),
  job("J6", 6, "select_2D", {
    input_slot_groups: [inGroup("particle", [slots("J5")]), inGroup("template", [slots("J5", "classes")])],
    parents: ["J5"],
    output_result_groups: [
      { name: "particles_selected", type: "particle", num_items: 1200000, contains: [] },
      { name: "templates_selected", type: "volume", num_items: 40, contains: [] },
    ],
  }),
  job("J7", 7, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J6", "particles_selected")])],
    parents: ["J6"],
    output_result_groups: classSplitGroups([[0, 600000], [1, 400000], [2, 200000]]),
  }),
  job("J8", 8, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J7", "particles_class_0")]), inGroup("template", [slots("J7", "volume_class_0")])],
    parents: ["J7"],
    output_result_groups: classSplitGroups([[0, 500000], [1, 100000]]),
  }),
  job("J9", 9, "nonuniform_refine_new", {
    input_slot_groups: [inGroup("particle", [slots("J8", "particles_class_0")]), inGroup("volume", [slots("J8", "volume_class_0")])],
    parents: ["J8"],
    output_result_groups: volumeGroup(["map"]),
  }),
  job("J10", 10, "ctf_refinement", {
    input_slot_groups: [inGroup("particle", [slots("J9")]), inGroup("volume", [slots("J9", "volume")])],
    parents: ["J9"],
  }),
  job("J11", 11, "nonuniform_refine_new", {
    input_slot_groups: [inGroup("particle", [slots("J10")]), inGroup("volume", [slots("J9", "volume")])],
    parents: ["J10", "J9"],
    output_result_groups: volumeGroup(["map"]),
  }),
  job("J12", 12, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J11")]), inGroup("volume", [slots("J11", "volume")])],
    parents: ["J11"],
    output_result_groups: classSplitGroups([[0, 380000], [1, 20000]]),
  }),
  job("J13", 13, "homo_reconstruct", {
    input_slot_groups: [inGroup("particle", [slots("J12", "particles_class_0")]), inGroup("volume", [slots("J12", "volume_class_0")])],
    parents: ["J12"],
    output_result_groups: volumeGroup(["map"]),
  }),
  job("J14", 14, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J13")]), inGroup("volume", [slots("J13", "volume")])],
    parents: ["J13"],
    params_spec: { maximum_resolution_A: { value: 6 } },
    output_result_groups: classSplitGroups([[0, 150000], [1, 30000], [2, 200000]]),
  }),
  job("J15", 15, "homo_reconstruct", {
    input_slot_groups: [inGroup("particle", [slots("J14", "particles_class_2")]), inGroup("volume", [slots("J14", "volume_class_2")])],
    parents: ["J14"],
    output_result_groups: volumeGroup(["map"]),
  }),
  job("J16", 16, "new_local_refine", {
    input_slot_groups: [inGroup("particle", [slots("J15")]), inGroup("volume", [slots("J15", "volume")])],
    parents: ["J15"],
    output_result_groups: volumeGroup(["map"]),
    params_spec: {},
  }),
];

const main = async () => {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P360",
      cryosmart_origin: APP,
      source: "v360-e2e-prep",
      end_job_uid: "J16",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  if (!token) {
    console.error("no token", createResp.status, await createResp.text());
    process.exit(1);
  }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P360", jobs }),
  });
  const complete = await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("TOKEN=" + token);
  console.log("jobs:", jobs.length, "complete:", complete.status);
};
main();
