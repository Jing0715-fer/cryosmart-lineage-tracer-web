/**
 * v3.81 E2E staging: posts a SMALL map-bearing lineage (P380) through the
 * import-session API so the live app attaches via /?imported=<token>,
 * auto-traces from J9, and the Workflow Figure card renders real maps
 * through the mock relay (127.0.0.1:8927) — the v3.81 paths are then
 * asserted from the mock's command log + the page's run log:
 *   - level: reference min(0.25×max, 0.85×otsu₂) = 0.204, envelope-count
 *     anchor 240,000, every class map count-matched to 0.2040
 *   - membrane: view orient → TOP-baseline camera → documented side
 *     camera → _mprobe_top/_mprobe_cam probes (disc → band aniso),
 *     zero turns; camreject drill falls to the turn scan
 *   - level preview: 预览 level button → _lvlprev_ saves → pick 0.35 →
 *     manual anchor 65,000 → class maps 0.3482
 *
 * Prereq: reset the mock relay first —
 *   curl "http://127.0.0.1:3021/flow-e2e/reset?corr=0.9"
 * (optionally &membrane=camreject for the scan drill)
 *
 * Run: bun .harness/v381-e2e-prep.mjs   → prints TOKEN=... */
const APP = process.env.APP_URL || "http://localhost:3011";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:3021";

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

const jobs = [
  job("J1", 1, "import_micrographs", { output_result_groups: exposureGroup(4000), parents: [] }),
  job("J2", 2, "motion_correction", { input_slot_groups: [inGroup("exposure", [slots("J1")])], parents: ["J1"] }),
  job("J3", 3, "ctf_estimation", { input_slot_groups: [inGroup("exposure", [slots("J2")])], parents: ["J2"] }),
  job("J4", 4, "blob_picker_gpu", { input_slot_groups: [inGroup("exposure", [slots("J3")])], parents: ["J3"], output_result_groups: particleGroup(500000) }),
  job("J5", 5, "extract_micrographs", { input_slot_groups: [inGroup("particle", [slots("J4")])], parents: ["J4"], output_result_groups: particleGroup(480000) }),
  job("J6", 6, "class_2d", { input_slot_groups: [inGroup("particle", [slots("J5")])], parents: ["J5"], output_result_groups: [{ name: "classes", type: "volume", num_items: 30, contains: [] }] }),
  job("J7", 7, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J6", "particles")])],
    parents: ["J6"],
    output_result_groups: classSplitGroups([[0, 300000], [1, 120000], [2, 60000]]),
  }),
  job("J8", 8, "nonuniform_refine_new", {
    input_slot_groups: [inGroup("particle", [slots("J7", "particles_class_0")]), inGroup("volume", [slots("J7", "volume_class_0")])],
    parents: ["J7"],
    output_result_groups: volumeGroup(["map"]),
  }),
  job("J9", 9, "new_local_refine", {
    input_slot_groups: [inGroup("particle", [slots("J8")]), inGroup("volume", [slots("J8", "volume")])],
    parents: ["J8"],
    output_result_groups: volumeGroup(["map"]),
  }),
];

const main = async () => {
  /* the mock relay must be freshly reset (corr 0.9 → alignment ladder
   * short-circuits at the target; membrane drills optional) */
  const reset = await fetch(`${MOCK}/flow-e2e/reset?corr=0.9`).then((r) => r.json()).catch(() => null);
  console.log("mock reset:", JSON.stringify(reset));
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P380",
      cryosmart_origin: MOCK,
      cryosmart_cookie: "session=e2e-cookie",
      source: "v381-e2e-prep",
      end_job_uid: "J9",
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
