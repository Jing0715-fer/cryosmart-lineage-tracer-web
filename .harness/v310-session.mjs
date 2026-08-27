/**
 * v3.10 web-side E2E session — the user's exact complaints as data:
 *   - J2 (class_2D): 1 live ref + 1 PDF ref (must vanish)
 *   - J3 (hetero_refine): its own 2 gallery refs + a SMEARED copy of J2's
 *     fileid (legacy misattribution — cross-job dedupe must strip it)
 *   - J4 (nu_refine, end job): two rounds of one title; the older round's
 *     fileid has NO bytes (dead) — only the final round may render
 * Posts everything fast and completes, then agent-browser verifies the
 * report + graph modal show PER-JOB images.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PX2",
      cryosmart_origin: "http://192.168.202.11:8080",
      cryosmart_auth: "Bearer sim-token",
      source: "sim",
      end_job_uid: "J4",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  console.log(`TOKEN=${token}`);

  const J1 = {
    uid: "J1", job_type: "import_movies", status: "completed", project_uid: "PX2",
    title: "import", created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-20T10:05:00Z",
    parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J2 = {
    uid: "J2", job_type: "class_2D", status: "completed", project_uid: "PX2",
    title: "class 2D", created_at: "2026-08-21T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
    parents: ["J1"], children: ["J3"],
    input_slot_groups: [{ name: "movies", type: "exposure", connections: [{ job_uid: "J1", group_name: "movies" }] }],
    output_result_groups: [{ name: "particles", type: "particle", contains: [{ type: "particle.blob", name: "ptcls" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J3 = {
    uid: "J3", job_type: "hetero_refine", status: "completed", project_uid: "PX2",
    title: "hetero refine", created_at: "2026-08-22T10:00:00Z", completed_at: "2026-08-22T12:00:00Z",
    parents: ["J2"], children: ["J4"],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J2", group_name: "particles" }] }],
    output_result_groups: [{ name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J4 = {
    uid: "J4", job_type: "nonuniform_refine_new", status: "completed", project_uid: "PX2",
    title: "nu refine", created_at: "2026-08-23T10:00:00Z", completed_at: "2026-08-23T12:00:00Z",
    parents: ["J3"], children: [],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J3", group_name: "volume" }] }],
    output_result_groups: [{ name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };

  await sleep(300);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PX2", jobs: [J1, J2, J3, J4] }),
  });
  console.log("jobs posted");

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { uid: "J2", images: [
        { fileid: "j2_sel", name: "sel.png", text: "Selected classes" },
        { fileid: "j2_report", name: "report.pdf", filename: "report.pdf", filetype: "pdf", text: "Report" },
      ] },
      { uid: "J3", images: [
        { fileid: "j2_sel", name: "sel.png", text: "Selected classes" },      // smeared — must be stripped (J2 owns it)
        { fileid: "j3_gallery_a", name: "class_1.png", text: "class 1" },
        { fileid: "j3_gallery_b", name: "class_2.png", text: "class 2" },
      ] },
      { uid: "J4", images: [
        { fileid: "j4_fsc_r1", name: "fsc.png", text: "FSC curve" },          // older round — dead fileid
        { fileid: "j4_fsc_r2", name: "fsc.png", text: "FSC curve" },          // final round
      ] },
    ] }),
  });
  console.log("logs posted (per-job refs + PDF + smeared + old round)");

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "j2_sel", data: `data:image/png;base64,${PNG}`, name: "sel.png" },
      { fileid: "j3_gallery_a", data: `data:image/png;base64,${PNG}`, name: "class_1.png" },
      { fileid: "j3_gallery_b", data: `data:image/png;base64,${PNG2}`, name: "class_2.png" },
      { fileid: "j4_fsc_r2", data: `data:image/png;base64,${PNG}`, name: "fsc.png" },
    ] }),
  });
  console.log("bytes posted (live refs only — PDF + old round never fetched)");

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete posted");
  console.log(`URL=${APP}/?imported=${token}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
