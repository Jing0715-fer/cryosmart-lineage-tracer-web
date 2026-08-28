/**
 * v3.16 browser-E2E helper — creates the staged session the browser will
 * restore (3 refine jobs × 4 volume maps = 12 .mrc downloads) against the
 * fake upstream on :3999. Prints the token; exits.
 *
 * Run: bun .harness/v316-browser-prep.mjs
 */
const APP = "http://localhost:3000";
const CRYO = "http://localhost:3999";

const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX7", job_type, title: `${uid} ${job_type}`,
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
    project_uid: "PX7", cryosmart_origin: CRYO,
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J4", lineage_mode: true,
  }),
})).json();
console.log(created.token);
