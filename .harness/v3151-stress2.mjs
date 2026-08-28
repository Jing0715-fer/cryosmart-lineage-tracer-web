#!/usr/bin/env bun
/**
 * v3.15.1 stress seeder v2: 80 log images with DISTINCT non-collapsible
 * titles (letters, not trailing digits) so the numbered-series collapse
 * keeps them ALL — the bundle build then fires 160+ rapid progress events
 * (report prefetch + PPTX + images phases), reproducing the user's
 * "Maximum update depth exceeded" ZIP-download conditions.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tags = Array.from({ length: 30 }, (_, i) =>
  String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26))
);

const J1 = {
  uid: "J1", job_type: "import_movies", status: "completed", project_uid: "P315T",
  title: "import", created_at: "2026-08-28T10:00:00Z", completed_at: "2026-08-28T10:05:00Z",
  parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [
    { name: "movies", type: "exposure", title: "movies", contains: [{ type: "movie.blob", name: "movie" }] },
  ], params_spec: {}, output_group_images: {},
  ui_tile_images: [{ name: "tile_mic", fileid: "tile_mic", num_cols: 1, num_rows: 1 }],
};
const J2 = {
  uid: "J2", job_type: "hetero_refine", status: "completed", project_uid: "P315T",
  title: "hetero refine stress v2", created_at: "2026-08-28T11:00:00Z", completed_at: "2026-08-28T12:00:00Z",
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

const logRefs = [];
const imgBytes = [];
for (const t of tags) {
  logRefs.push({ fileid: `c0_${t}`, name: `fsc_zero_${t}.png`, text: `class 0 FSC snapshot ${t}`, flags: null });
  imgBytes.push({ fileid: `c0_${t}`, data: `data:image/png;base64,${PNG}`, name: `fsc_zero_${t}.png` });
  logRefs.push({ fileid: `c1_${t}`, name: `fsc_one_${t}.png`, text: `class 1 FSC snapshot ${t}`, flags: null });
  imgBytes.push({ fileid: `c1_${t}`, data: `data:image/png;base64,${PNG}`, name: `fsc_one_${t}.png` });
}
for (let i = 0; i < 20; i++) {
  const t = tags[i];
  logRefs.push({ fileid: `gen_${t}`, name: `scale_${t}.png`, text: `Per particle scale sample ${t}`, flags: null });
  imgBytes.push({ fileid: `gen_${t}`, data: `data:image/png;base64,${PNG}`, name: `scale_${t}.png` });
}
imgBytes.push({ fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" });

const main = async () => {
  const sess = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P315T", cryosmart_origin: "http://192.168.202.11:8080",
      source: "sim", end_job_uid: "J2", lineage_mode: true,
    }),
  }).then((r) => r.json());
  console.log("TOKEN=" + sess.token);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P315T", jobs: [J1, J2] }),
  });
  console.log("jobs posted");

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J2", images: logRefs }] }),
  });
  console.log(`class log refs posted (${logRefs.length})`);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: imgBytes }),
  });
  console.log(`image bytes posted (${imgBytes.length})`);
  await sleep(800);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  await sleep(800);
  console.log("complete (saved to history)");
};
main().catch((e) => { console.error(e); process.exit(1); });
