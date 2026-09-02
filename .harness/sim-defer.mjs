/** Deferral check: create session + jobs + refs, NO complete yet. */
const APP = "http://localhost:3000";
const jobs = [1, 2, 3].map((i) => ({
  uid: `J${i}`, job_type: i === 1 ? "import_micrographs" : "nu_refine",
  status: "completed", project_uid: "PDF",
  title: `job ${i}`, created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
  parents: i === 1 ? [] : [`J${i - 1}`], children: i === 3 ? [] : [`J${i + 1}`],
  input_slot_groups: i === 1 ? [] : [{ name: "particles", type: "particle", title: "particles", connections: [{ job_uid: `J${i - 1}`, group_name: "movies" }] }],
  output_result_groups: [{ name: "volume", type: "volume", title: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
  params_spec: {}, output_group_images: {}, ui_tile_images: [],
}));
const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PDF", cryosmart_origin: "http://localhost:9999", source: "sim", end_job_uid: "J3", lineage_mode: true }),
});
const { token } = await createResp.json();
console.log("TOKEN=" + token);
await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PDF", jobs }),
});
console.log("jobs posted (NOT completing — capture still live)");
