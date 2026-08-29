/**
 * Progressive-application E2E simulator (v3.8 fix):
 * streams a staged capture with LONG pauses and NEVER calls /complete
 * until the very end, so agent-browser can prove the graph/report pick
 * up log images LIVE (before completion) — the exact user scenario
 * ("captured 320 but nothing shows").
 *
 * Timeline:
 *   t=0   create session (end_job_uid J3, lineage_mode) → TOKEN printed
 *   t=1   POST jobs (J1/J2/J3)
 *   t=18  logs batch 1: J2 2 refs (dup titles, last round wins web-side)
 *   t=24  bytes: j2_fsc_r2 + vol_prev + tile_mic
 *   t=30  logs batch 2: J3 3 refs (dup title r1/r2 + excluded)
 *   t=33  bytes: j3_sel_r2 + j3_exc_r2
 *   t=44  POST /complete
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P8P",
      cryosmart_origin: "http://192.168.202.11:8080",
      cryosmart_auth: "Bearer sim-token",
      source: "sim",
      end_job_uid: "J3",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  log(`TOKEN=${token}`);

  const J1 = {
    uid: "J1", job_type: "import_movies", status: "completed", project_uid: "P8P",
    title: "import", created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-20T10:05:00Z",
    parents: [], children: ["J2", "J3"], input_slot_groups: [], output_result_groups: [
      { name: "movies", type: "exposure", title: "movies", contains: [{ type: "movie.blob", name: "movie" }] },
    ], params_spec: {}, output_group_images: {},
    ui_tile_images: [{ name: "tile_mic", fileid: "tile_mic", num_cols: 2, num_rows: 2 }],
  };
  const J2 = {
    uid: "J2", job_type: "nu_refine", status: "completed", project_uid: "P8P",
    title: "nu refine", created_at: "2026-08-21T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
    parents: ["J1"], children: ["J3"],
    input_slot_groups: [
      { name: "particles", type: "particle", title: "particles", connections: [{ job_uid: "J1", group_name: "movies" }] },
    ],
    output_result_groups: [
      { name: "volume", type: "volume", title: "volume", contains: [
        { type: "volume.blob", name: "map" },
        { type: "volume.blob", name: "map_sharp" },
      ] },
    ],
    params_spec: {}, output_group_images: { volume: "vol_prev" }, ui_tile_images: [],
  };
  const J3 = {
    uid: "J3", job_type: "hetero_refine", status: "completed", project_uid: "P8P",
    title: "hetero refine", created_at: "2026-08-22T10:00:00Z", completed_at: "2026-08-22T12:00:00Z",
    parents: ["J2"], children: [],
    input_slot_groups: [
      { name: "particles", type: "particle", title: "particles", connections: [{ job_uid: "J2", group_name: "volume" }] },
    ],
    output_result_groups: [
      { name: "volume", type: "volume", title: "volume", contains: [{ type: "volume.blob", name: "map" }] },
    ],
    params_spec: {}, output_group_images: { volume: "j3_vol_prev" }, ui_tile_images: [],
  };

  await sleep(1000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P8P", jobs: [J1, J2, J3] }),
  });
  log("jobs posted");

  await sleep(17000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J2", images: [
      { fileid: "j2_fsc_r1", name: "fsc_r1.png", text: "FSC curve", flags: null },
      { fileid: "j2_fsc_r2", name: "fsc_r2.png", text: "FSC curve", flags: null },
    ] }] }),
  });
  log("logs batch 1 (J2: 2 refs) — browser should apply refs progressively NOW");

  await sleep(6000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "j2_fsc_r2", data: `data:image/png;base64,${PNG}`, name: "fsc_r2.png" },
      { fileid: "vol_prev", data: `data:image/png;base64,${PNG2}`, name: "vol_prev.png" },
      { fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" },
    ] }),
  });
  log("bytes 1 (j2_fsc_r2 + vol_prev + tile_mic) — J2 log image + map preview must be LIVE in the app NOW (no /complete yet)");

  await sleep(6000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J3", images: [
      { fileid: "j3_sel_r1", name: "sel_r1.png", text: "Selected 21 classes", flags: null },
      { fileid: "j3_sel_r2", name: "sel_r2.png", text: "Selected 21 classes", flags: null },
      { fileid: "j3_exc_r2", name: "exc_r2.png", text: "Excluded 179 classes", flags: null },
    ] }] }),
  });
  log("logs batch 2 (J3: 3 refs)");

  await sleep(3000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "j3_sel_r2", data: `data:image/png;base64,${PNG}`, name: "sel_r2.png" },
      { fileid: "j3_exc_r2", data: `data:image/png;base64,${PNG2}`, name: "exc_r2.png" },
      { fileid: "j3_vol_prev", data: `data:image/png;base64,${PNG}`, name: "j3_vol_prev.png" },
    ] }),
  });
  log("bytes 2 (J3 images) — J3 modal must show 2 log images NOW (still not complete)");

  await sleep(11000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  log("complete posted — strip should switch to the final summary");
}
main().catch((e) => { console.error(e); process.exit(1); });
