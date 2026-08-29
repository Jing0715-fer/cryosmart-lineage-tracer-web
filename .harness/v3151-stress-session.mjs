#!/usr/bin/env bun
/**
 * v3.15.1 browser-E2E stress seeder: reproduces the ZIP-download
 * "Maximum update depth exceeded" conditions — a hetero_refine job with a
 * LARGE class-grouped gallery (80 log images across class 0 / class 1 /
 * general), so the bundle build fires 160+ rapid progress events
 * (images phase + PPTX phase) at the DownloadCard.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PER_CLASS = 30;
const GENERAL = 20;

const J1 = {
  uid: "J1", job_type: "import_movies", status: "completed", project_uid: "P315S",
  title: "import", created_at: "2026-08-28T10:00:00Z", completed_at: "2026-08-28T10:05:00Z",
  parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [
    { name: "movies", type: "exposure", title: "movies", contains: [{ type: "movie.blob", name: "movie" }] },
  ], params_spec: {}, output_group_images: {},
  ui_tile_images: [{ name: "tile_mic", fileid: "tile_mic", num_cols: 1, num_rows: 1 }],
};
const J2 = {
  uid: "J2", job_type: "hetero_refine", status: "completed", project_uid: "P315S",
  title: "hetero refine stress", created_at: "2026-08-28T11:00:00Z", completed_at: "2026-08-28T12:00:00Z",
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
for (let i = 0; i < PER_CLASS; i++) {
  logRefs.push({ fileid: `cls0_i${i}`, name: `fsc_0_${String(i).padStart(3, "0")}.png`, text: `class 0 FSC iteration ${i}`, flags: null });
  imgBytes.push({ fileid: `cls0_i${i}`, data: `data:image/png;base64,${PNG}`, name: `fsc_0_${i}.png` });
  logRefs.push({ fileid: `cls1_i${i}`, name: `fsc_1_${String(i).padStart(3, "0")}.png`, text: `class 1 FSC iteration ${i}`, flags: null });
  imgBytes.push({ fileid: `cls1_i${i}`, data: `data:image/png;base64,${PNG}`, name: `fsc_1_${i}.png` });
}
for (let i = 0; i < GENERAL; i++) {
  logRefs.push({ fileid: `gen_i${i}`, name: `scale_${String(i).padStart(3, "0")}.png`, text: `Per particle scale factors ${String(i).padStart(3, "0")}`, flags: null });
  imgBytes.push({ fileid: `gen_i${i}`, data: `data:image/png;base64,${PNG}`, name: `scale_${i}.png` });
}
imgBytes.push({ fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" });

const main = async () => {
  const sess = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P315S", cryosmart_origin: "http://192.168.202.11:8080",
      source: "sim", end_job_uid: "J2", lineage_mode: true,
    }),
  }).then((r) => r.json());
  console.log("TOKEN=" + sess.token);

  await fetch(`${APP}/api/cryosmart/import/session/${sess.token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P315S", jobs: [J1, J2] }),
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
