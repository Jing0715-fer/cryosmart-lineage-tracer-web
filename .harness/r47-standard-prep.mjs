/**
 * v3.87 E2E staging: posts the round-47 STANDARD-MODE lineage — the user's
 * real P283 shape (J6 class_2d → J10/J12/J32/J38/J41 hetero_refine ×
 * J11/J48 homo_abinit → J55 nonuniform final), 25 maps + reference, so the
 * 标准模式 deck exercises the paths the round-47 feedback hit:
 *   - drill A (default):        25 maps render, belt-band anchors as v3.86.
 *   - drill B (?relay=old&noise=high): old relay + raised noise floor —
 *     the reference walks 0.15 → 0.26, every map then anchors at 参考图倍率
 *     0.26×max (the v3.87 ref-ratio chaining) and the ALIGNMENT masks ride
 *     the reference's probe-verified display level (参考图渲染验证 level).
 *   - drill C (?auth=expire:J10,J11,J12,J32,J38): those uids' downloads
 *     401 on every ladder rung → 15 labelled 渲染失败 placeholders in the
 *     PPTX + the amber result-panel block with the 重新登录/重新 Smart
 *     Capture hint.
 *
 * Run: bun .harness/r47-standard-prep.mjs [drill-query]   → prints TOKEN=…
 * e.g. bun .harness/r47-standard-prep.mjs "relay=old&noise=high"
 */
const APP = process.env.APP_URL || "http://localhost:3011";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:3021";
const DRILL = process.argv[2] || process.env.DRILL || "";

const exposureGroup = (n) => [{ name: "micrographs", type: "exposure", num_items: n, contains: [] }];
const particleGroup = (n) => [{ name: "particles", type: "particle", num_items: n, contains: [] }];
const volumeGroup = () => [
  { name: "volume", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
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
  project_uid: "P380",
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

/* The user's real P283 class counts (from the (6) deck) keep the figure
 * stats realistic; only the map BYTES are mock-tiny. Each downstream job
 * takes the upstream class-0 particles + volume_class_0 (anchor = class 0). */
const jobs = [
  job("J1", 1, "import_micrographs", { output_result_groups: exposureGroup(6647), parents: [] }),
  job("J2", 2, "motion_correction", { input_slot_groups: [inGroup("exposure", [slots("J1")])], parents: ["J1"] }),
  job("J3", 3, "ctf_estimation", { input_slot_groups: [inGroup("exposure", [slots("J2")])], parents: ["J2"] }),
  job("J4", 4, "blob_picker_gpu", { input_slot_groups: [inGroup("exposure", [slots("J3")])], parents: ["J3"], output_result_groups: particleGroup(3408286) }),
  job("J5", 5, "extract_micrographs", { input_slot_groups: [inGroup("particle", [slots("J4")])], parents: ["J4"], output_result_groups: particleGroup(3408286) }),
  job("J6", 6, "class_2d", {
    input_slot_groups: [inGroup("particle", [slots("J5")])],
    parents: ["J5"],
    output_result_groups: [{ name: "classes", type: "volume", num_items: 23, contains: [] }],
  }),
  job("J10", 10, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J5")])],
    parents: ["J5"],
    output_result_groups: classSplitGroups([[0, 151078], [1, 202743], [2, 150550]]),
  }),
  job("J11", 11, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J10", "particles_class_0")]), inGroup("volume", [slots("J10", "volume_class_0")])],
    parents: ["J10"],
    output_result_groups: classSplitGroups([[0, 80765], [1, 42699], [2, 79279]]),
  }),
  job("J12", 12, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J11", "particles_class_0")]), inGroup("volume", [slots("J11", "volume_class_0")])],
    parents: ["J11"],
    output_result_groups: classSplitGroups([[0, 88630], [1, 38458], [2, 75655]]),
  }),
  job("J32", 32, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J12", "particles_class_0")]), inGroup("volume", [slots("J12", "volume_class_0")])],
    parents: ["J12"],
    output_result_groups: classSplitGroups([[0, 454834], [1, 334641], [2, 402861], [3, 634639]]),
  }),
  job("J38", 38, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J32", "particles_class_0")]), inGroup("volume", [slots("J32", "volume_class_0")])],
    parents: ["J32"],
    output_result_groups: classSplitGroups([[0, 331822], [1, 179091], [2, 307941], [3, 682406]]),
  }),
  job("J41", 41, "hetero_refine", {
    input_slot_groups: [inGroup("particle", [slots("J38", "particles_class_0")]), inGroup("volume", [slots("J38", "volume_class_0")])],
    parents: ["J38"],
    output_result_groups: classSplitGroups([[0, 83644], [1, 76051], [2, 54198], [3, 416605]]),
  }),
  job("J48", 48, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J41", "particles_class_0")]), inGroup("volume", [slots("J41", "volume_class_0")])],
    parents: ["J41"],
    output_result_groups: classSplitGroups([[0, 187655], [1, 184116], [2, 44834]]),
  }),
  job("J55", 55, "nonuniform_refine_new", {
    input_slot_groups: [inGroup("particle", [slots("J48", "particles_class_0")]), inGroup("volume", [slots("J48", "volume_class_0")])],
    parents: ["J48"],
    output_result_groups: volumeGroup(),
  }),
];

const main = async () => {
  const reset = await fetch(`${MOCK}/flow-e2e/reset?corr=0.9${DRILL ? `&${DRILL}` : ""}`).then((r) => r.json()).catch(() => null);
  console.log("mock reset:", JSON.stringify(reset));
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P380",
      cryosmart_origin: MOCK,
      cryosmart_cookie: "session=e2e-cookie",
      source: "r47-standard-prep",
      end_job_uid: "J55",
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
    body: JSON.stringify({ project_uid: "P380", jobs }),
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
