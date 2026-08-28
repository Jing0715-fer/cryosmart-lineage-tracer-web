#!/usr/bin/env bun
/**
 * v3.15 browser-E2E seeder: stages a capture whose hetero_refine job carries
 * PER-CLASS log images ("class 0 FSC", "class 1 FSC", …) + a general plot,
 * uploads bytes for every ref, and completes the session (saved to history).
 * The browser then attaches via ?imported=<token> and the graph modal /
 * report must render the CLASS-GROUPED gallery.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const J1 = {
  uid: "J1", job_type: "import_movies", status: "completed", project_uid: "P315E",
  title: "import", created_at: "2026-08-28T10:00:00Z", completed_at: "2026-08-28T10:05:00Z",
  parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [
    { name: "movies", type: "exposure", title: "movies", contains: [{ type: "movie.blob", name: "movie" }] },
  ], params_spec: {}, output_group_images: {},
  ui_tile_images: [{ name: "tile_mic", fileid: "tile_mic", num_cols: 1, num_rows: 1 }],
};
const J2 = {
  uid: "J2", job_type: "hetero_refine", status: "completed", project_uid: "P315E",
  title: "hetero refine", created_at: "2026-08-28T11:00:00Z", completed_at: "2026-08-28T12:00:00Z",
  parents: ["J1"], children: [],
  input_slot_groups: [
    { name: "particles", type: "particle", title: "particles", connections: [{ job_uid: "J1", group_name: "movies" }] },
  ],
  output_result_groups: [
    { name: "particles_class_0", type: "particle", title: "class 0", contains: [{ type: "particle", name: "particles" }], num_items: 61000 },
    { name: "particles_class_1", type: "particle", title: "class 1", contains: [{ type: "particle", name: "particles" }], num_items: 39000 },
    { name: "volume_class_0", type: "volume", title: "class 0", contains: [{ type: "volume.blob", name: "map" }] },
    { name: "volume_class_1", type: "volume", title: "class 1", contains: [{ type: "volume.blob", name: "map" }] },
  ], params_spec: {}, output_group_images: {},
  ui_tile_images: [],
};

const main = async () => {
  const sess = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P315E", cryosmart_origin: "http://192.168.202.11:8080",
      source: "sim", end_job_uid: "J2", lineage_mode: true,
    }),
  }).then((r) => r.json());
  console.log("TOKEN=" + sess.token);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P315E", jobs: [J1, J2] }),
  });
  console.log("jobs posted");

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { uid: "J2", images: [
        { fileid: "cls0_fsc", name: "fsc_0.png", text: "class 0 FSC", flags: null },
        { fileid: "cls0_slice", name: "slice_0.png", text: "class 0 slices", flags: null },
        { fileid: "cls1_fsc", name: "fsc_1.png", text: "class 1 FSC", flags: null },
        { fileid: "cls1_slice", name: "slice_1.png", text: "class 1 slices", flags: null },
        { fileid: "scale_gen", name: "scale.png", text: "Per particle scale factors 007", flags: null },
      ] },
    ] }),
  });
  console.log("class log refs posted");

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "cls0_fsc", data: `data:image/png;base64,${PNG}`, name: "fsc_0.png" },
      { fileid: "cls0_slice", data: `data:image/png;base64,${PNG}`, name: "slice_0.png" },
      { fileid: "cls1_fsc", data: `data:image/png;base64,${PNG}`, name: "fsc_1.png" },
      { fileid: "cls1_slice", data: `data:image/png;base64,${PNG}`, name: "slice_1.png" },
      { fileid: "scale_gen", data: `data:image/png;base64,${PNG}`, name: "scale.png" },
      { fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" },
    ] }),
  });
  console.log("image bytes posted");
  await sleep(800);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  await sleep(800);
  console.log("complete (saved to history)");
};
main().catch((e) => { console.error(e); process.exit(1); });
