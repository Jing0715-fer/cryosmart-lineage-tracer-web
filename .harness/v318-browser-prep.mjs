/**
 * v3.18 browser-E2E prep — staged session with 12 maps (3 refine jobs × 4
 * volume maps) against the chunked fake upstream on :3999, jobs + complete
 * POSTed (the v316-browser-prep gap). Prints the token; exits.
 *
 * Run: bun .harness/v318-browser-prep.mjs
 */
const APP = "http://localhost:3000";
const CRYO = "http://localhost:3999";

const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX9", job_type, title: `${uid} ${job_type}`,
  status: "completed", created_at: NOW, completed_at: NOW,
  parents, children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles", type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [], params_spec: {}, output_group_images: {},
  ui_tile_images: [],
});
const volGroup = () => ({
  name: "volume", type: "volume", title: "volume", contains: [
    { type: "volume.blob", name: "map" },
    { type: "volume.blob", name: "map_sharp" },
    { type: "volume.blob", name: "map_half_A" },
    { type: "volume.blob", name: "map_half_B" },
  ],
});
const jobs = [
  mkJob("J1", "import_movies", []),
  mkJob("J2", "nonuniform_refine_new", ["J1"]),
  mkJob("J3", "nonuniform_refine_new", ["J2"]),
  mkJob("J4", "nonuniform_refine_new", ["J3"]),
];
jobs[1].output_result_groups = [volGroup()];
jobs[2].output_result_groups = [volGroup()];
jobs[3].output_result_groups = [volGroup()];

const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX9", cryosmart_origin: CRYO,
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J4", lineage_mode: true,
  }),
})).json();
const token = created.token;
await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX9", jobs }),
});
await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
console.log(token);
