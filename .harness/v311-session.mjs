/**
 * v3.11 web-side E2E session — the user's exact complaints as data:
 *   - J2 (homo_abinit): raw image_logs entries across iterations 000..004 —
 *     only the FINAL iteration may render (+ a final "Class averages" entry)
 *   - J3 (hetero_refine): 24-class gallery (trailing-digit names — NOT
 *     iterations) + xml/txt/pdf refs that must vanish + a files[] entry
 *   - J4 (nu_refine, end job): flattened refs spanning "Iteration 000".."005"
 *     each with png+xml+txt (an OLDER capture that leaked every iteration)
 * All live fileids get bytes; dead/foreign/non-image refs never do.
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
      project_uid: "PX3",
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
    uid: "J1", job_type: "import_movies", status: "completed", project_uid: "PX3",
    title: "import", created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-20T10:05:00Z",
    parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J2 = {
    uid: "J2", job_type: "homo_abinit", status: "completed", project_uid: "PX3",
    title: "abinit", created_at: "2026-08-21T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
    parents: ["J1"], children: ["J3"],
    input_slot_groups: [{ name: "movies", type: "exposure", connections: [{ job_uid: "J1", group_name: "movies" }] }],
    output_result_groups: [{ name: "particles", type: "particle", contains: [{ type: "particle.blob", name: "ptcls" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J3 = {
    uid: "J3", job_type: "hetero_refine", status: "completed", project_uid: "PX3",
    title: "hetero refine", created_at: "2026-08-22T10:00:00Z", completed_at: "2026-08-22T12:00:00Z",
    parents: ["J2"], children: ["J4"],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J2", group_name: "particles" }] }],
    output_result_groups: [{ name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J4 = {
    uid: "J4", job_type: "nonuniform_refine_new", status: "completed", project_uid: "PX3",
    title: "nu refine", created_at: "2026-08-23T10:00:00Z", completed_at: "2026-08-23T12:00:00Z",
    parents: ["J3"], children: [],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J3", group_name: "volume" }] }],
    output_result_groups: [{ name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };

  // J2 homo_abinit: raw image_logs entries (per-iteration + final gallery)
  // ride along INSIDE the jobs payload (the capture script embeds cached
  // raw entries exactly like this).
  const j2ImageLogs = [];
  for (let it = 0; it <= 4; it++) {
    const n = String(it).padStart(3, "0");
    j2ImageLogs.push({
      _id: "j2e" + it, type: "image", text: "Iteration " + n,
      imgfiles: [
        { fileid: "j2_slice_" + it, filename: "J2_slice_iter_" + n + ".png", filetype: "image/png" },
        { fileid: "j2_xml_" + it, filename: "J2_data_iter_" + n + ".xml", filetype: "text/xml" },
      ],
    });
  }
  j2ImageLogs.push({
    _id: "j2final", type: "image", text: "Class averages",
    imgfiles: [
      { fileid: "j2_avg0", filename: "J2_classavg_000.png", filetype: "image/png" },
      { fileid: "j2_avg1", filename: "J2_classavg_001.png", filetype: "image/png" },
    ],
  });
  J2.image_logs = j2ImageLogs;

  await sleep(300);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PX3", jobs: [J1, J2, J3, J4] }),
  });
  console.log("jobs posted (J2 carries image_logs with iterations)");

  // J3 hetero_refine: 24-class gallery + non-image refs + a files[] entry.
  const j3Images = [];
  for (let c = 0; c < 24; c++) {
    const n = String(c).padStart(3, "0");
    j3Images.push({ fileid: "j3_cls" + c, name: "J3_class_" + n + ".png", text: "Class " + n });
  }
  j3Images.push({ fileid: "j3_meta", name: "J3_meta.xml", filename: "J3_meta.xml", filetype: "application/xml", text: "Meta" });
  j3Images.push({ fileid: "j3_data", name: "J3_result.txt", filename: "J3_result.txt", filetype: "text/plain", text: "Data" });
  j3Images.push({ fileid: "j3_pdf", name: "J3_report.pdf", filename: "J3_report.pdf", filetype: "pdf", text: "Report" });

  // J4 nu_refine: flattened refs across 6 iterations (png + xml + txt each).
  const j4Images = [];
  for (let it = 0; it <= 5; it++) {
    const n = String(it).padStart(3, "0");
    j4Images.push({ fileid: "j4_fsc_" + it, name: "J4_fsc_iter_" + n + ".png", text: "Iteration " + n });
    j4Images.push({ fileid: "j4_ang_" + it, name: "J4_angdist_iter_" + n + ".png", text: "Iteration " + n });
    j4Images.push({ fileid: "j4_xml_" + it, name: "J4_data_iter_" + n + ".xml", filename: "J4_data_iter_" + n + ".xml", filetype: "text/xml", text: "Iteration " + n });
  }

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { uid: "J3", images: j3Images },
      { uid: "J4", images: j4Images },
    ] }),
  });
  console.log("logs posted (J3 24-class gallery + non-image refs · J4 6-iteration refs)");

  // Bytes for every LIVE ref (dead/non-image refs never get bytes).
  const liveItems = [];
  for (const f of ["j2_slice_4", "j2_avg0", "j2_avg1"]) {
    liveItems.push({ fileid: f, data: `data:image/png;base64,${PNG}`, name: f + ".png" });
  }
  for (let c = 0; c < 24; c++) {
    liveItems.push({ fileid: "j3_cls" + c, data: `data:image/png;base64,${c % 2 ? PNG2 : PNG}`, name: "class.png" });
  }
  for (const f of ["j4_fsc_5", "j4_ang_5"]) {
    liveItems.push({ fileid: f, data: `data:image/png;base64,${PNG}`, name: f + ".png" });
  }

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: liveItems }),
  });
  console.log(`bytes posted (${liveItems.length} live refs)`);

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete posted");
  console.log(`URL=${APP}/?imported=${token}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
