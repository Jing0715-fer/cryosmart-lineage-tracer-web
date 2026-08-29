/**
 * E2E staged-capture simulator: creates a session with a discriminating
 * topology and streams logs/images/complete with pauses so agent-browser
 * can verify the LIVE progress strip in the Lineage Preview card.
 *
 * Topology (P8E):
 *   J1 import_movies  (source; ui_tile_images: 1 tile "tile_mic")
 *   J2 nu_refine      (input: J1 exposure→particles; volume output group with
 *                       map + map_sharp + map_half_A + map_half_B → 4 maps;
 *                       output_group_images.volume = "vol_prev")
 *   J3 hetero_refine  (FINAL — end_job_uid; inputs: TWO connections from J2
 *                       [particles + volume → PARALLEL edges J2→J3 to verify
 *                       line dedupe] and one from J1)
 *
 * Log images: J2 + J3 get multi-round entries (same titles twice) — only the
 * LAST round must survive; bytes uploaded for final-round fileids only.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) create session
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P8E",
      cryosmart_origin: "http://192.168.202.11:8080",
      cryosmart_auth: "Bearer sim-token",
      source: "sim",
      end_job_uid: "J3",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  console.log("TOKEN=" + token);

  const J1 = {
    uid: "J1", job_type: "import_movies", status: "completed", project_uid: "P8E",
    title: "import", created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-20T10:05:00Z",
    parents: [], children: ["J2", "J3"], input_slot_groups: [], output_result_groups: [
      { name: "movies", type: "exposure", title: "movies", contains: [{ type: "movie.blob", name: "movie" }] },
    ], params_spec: {}, output_group_images: {},
    ui_tile_images: [{ name: "tile_mic", fileid: "tile_mic", num_cols: 2, num_rows: 2 }],
  };
  const J2 = {
    uid: "J2", job_type: "nu_refine", status: "completed", project_uid: "P8E",
    title: "nu refine", created_at: "2026-08-21T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
    parents: ["J1"], children: ["J3"],
    input_slot_groups: [
      { name: "particles", type: "particle", title: "particles", connections: [{ job_uid: "J1", group_name: "movies" }] },
    ],
    output_result_groups: [
      { name: "volume", type: "volume", title: "volume", contains: [
        { type: "volume.blob", name: "map" },
        { type: "volume.blob", name: "map_sharp" },
        { type: "volume.blob", name: "map_half_A" },
        { type: "volume.blob", name: "map_half_B" },
      ] },
    ],
    params_spec: {}, output_group_images: { volume: "vol_prev" }, ui_tile_images: [],
  };
  const J3 = {
    uid: "J3", job_type: "hetero_refine", status: "completed", project_uid: "P8E",
    title: "hetero refine", created_at: "2026-08-22T10:00:00Z", completed_at: "2026-08-22T12:00:00Z",
    parents: ["J2"], children: [],
    // TWO connections from J2 → parallel edges (same source→target pair)
    input_slot_groups: [
      { name: "particles", type: "particle", title: "particles", connections: [{ job_uid: "J2", group_name: "volume" }] },
      { name: "volume", type: "volume", title: "volume", connections: [{ job_uid: "J2", group_name: "volume" }, { job_uid: "J1", group_name: "movies" }] },
    ],
    output_result_groups: [
      { name: "volume", type: "volume", title: "volume", contains: [{ type: "volume.blob", name: "map" }] },
    ],
    params_spec: {}, output_group_images: { volume: "j3_vol_prev" }, ui_tile_images: [],
  };

  // 2) upload jobs
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P8E", jobs: [J1, J2, J3] }),
  });
  console.log("jobs posted");

  // 3) let the browser land + auto-trace (25s window)
  await sleep(25000);

  // 4) stream log batches (multi-round: older rounds first — must be dropped)
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J2", images: [
      { fileid: "j2_fsc_r1", name: "fsc_r1.png", text: "FSC curve", flags: null },
      { fileid: "j2_fsc_r2", name: "fsc_r2.png", text: "FSC curve", flags: null },
    ] }] }),
  });
  console.log("logs batch 1 (J2, dup-title rounds)");
  await sleep(12000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J3", images: [
      { fileid: "j3_sel_r1", name: "sel_r1.png", text: "Selected 21 classes", flags: null },
      { fileid: "j3_sel_r2", name: "sel_r2.png", text: "Selected 21 classes", flags: null },
      { fileid: "j3_exc_r2", name: "exc_r2.png", text: "Excluded 179 classes", flags: null },
    ] }] }),
  });
  console.log("logs batch 2 (J3, dup-title rounds)");
  await sleep(12000);

  // 5) upload bytes for final-round refs + volume previews + tile
  await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "j2_fsc_r2", data: `data:image/png;base64,${PNG}`, name: "fsc_r2.png" },
      { fileid: "j3_sel_r2", data: `data:image/png;base64,${PNG}`, name: "sel_r2.png" },
      { fileid: "j3_exc_r2", data: `data:image/png;base64,${PNG2}`, name: "exc_r2.png" },
      { fileid: "vol_prev", data: `data:image/png;base64,${PNG2}`, name: "vol_prev.png" },
      { fileid: "j3_vol_prev", data: `data:image/png;base64,${PNG}`, name: "j3_vol_prev.png" },
      { fileid: "tile_mic", data: `data:image/png;base64,${PNG}`, name: "tile_mic.png" },
    ] }),
  });
  console.log("image bytes posted");

  // 6) complete
  await sleep(4000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete");
}
main().catch((e) => { console.error(e); process.exit(1); });
