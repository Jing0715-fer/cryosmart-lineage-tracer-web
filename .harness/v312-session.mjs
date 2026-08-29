/**
 * v3.12 web-side E2E session — the user's EXACT broken scenario, replayed
 * with the fix:
 *
 *   "Loaded 46 jobs … 24/24 jobs scanned · 128 images captured
 *    但是graph和report中都没有加载出来图片"
 *
 * Session s46 evidence: 128 refs streamed, 17 /images POSTs all HTTP 200,
 * yet ZERO bytes stored — because the real server's typeless responses made
 * the script post data:application/octet-stream URLs that the store's
 * image/*-only regex rejected.
 *
 * This simulator posts EVERY image byte as an OCTET-STREAM data URL (the
 * stale-script shape). The v3.12 store must sniff+accept them; the graph
 * modal and report must then render the images from same-origin
 * /image/<fileid> URLs.
 *
 *   - J2 (homo_abinit): image_logs across iterations 000..003 + final
 *     gallery — only the FINAL iteration renders; bytes as octet-stream.
 *   - J3 (hetero_refine): class gallery refs + xml/txt (filtered) with
 *     octet-stream bytes for the live ones.
 *   - J4 (nu_refine, end job): output_group_images maps (volume.map_sharp +
 *     half_map_A) WITH octet-stream bytes — the report's map grid must show
 *     previews; a ui_tile_images ref on J2 with bytes too.
 *   - One deliberately dead ref (no bytes) to prove the hide-on-error chain.
 */
const APP = "http://localhost:3000";
// 1x1 PNG, base64 — posted under an application/octet-stream data URL.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const OCTET = (b64) => `data:application/octet-stream;base64,${b64}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PX4",
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
    uid: "J1", job_type: "import_movies", status: "completed", project_uid: "PX4",
    title: "import", created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-20T10:05:00Z",
    parents: [], children: ["J2"], input_slot_groups: [], output_result_groups: [],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J2 = {
    uid: "J2", job_type: "homo_abinit", status: "completed", project_uid: "PX4",
    title: "abinit", created_at: "2026-08-21T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
    parents: ["J1"], children: ["J3"],
    input_slot_groups: [{ name: "movies", type: "exposure", connections: [{ job_uid: "J1", group_name: "movies" }] }],
    output_result_groups: [{ name: "particles", type: "particle", contains: [{ type: "particle.blob", name: "ptcls" }] }],
    params_spec: {}, output_group_images: {},
    ui_tile_images: [{ name: "J2_tile.png", fileid: "j2_tile", num_cols: 1, num_rows: 1 }],
  };
  const J3 = {
    uid: "J3", job_type: "hetero_refine", status: "completed", project_uid: "PX4",
    title: "hetero refine", created_at: "2026-08-22T10:00:00Z", completed_at: "2026-08-22T12:00:00Z",
    parents: ["J2"], children: ["J4"],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J2", group_name: "particles" }] }],
    output_result_groups: [{ name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
    params_spec: {}, output_group_images: {}, ui_tile_images: [],
  };
  const J4 = {
    uid: "J4", job_type: "nonuniform_refine_new", status: "completed", project_uid: "PX4",
    title: "nu refine", created_at: "2026-08-23T10:00:00Z", completed_at: "2026-08-23T12:00:00Z",
    parents: ["J3"], children: [],
    input_slot_groups: [{ name: "particles", type: "particle", connections: [{ job_uid: "J3", group_name: "volume" }] }],
    // REAL-build shape: output_group_images keys EQUAL output_result_groups
    // names (verified against the user's s46 capture: volume_class_0 ↔
    // volume_class_0), each volume group carrying one volume.blob result.
    output_result_groups: [
      { name: "volume.map_sharp", type: "volume", contains: [{ type: "volume.blob", name: "map" }] },
      { name: "half_map_A", type: "volume", contains: [{ type: "volume.blob", name: "map" }] },
    ],
    params_spec: {},
    output_group_images: { "volume.map_sharp": "j4_vol", "half_map_A": "j4_half_a" },
    ui_tile_images: [],
  };

  // J2 homo_abinit: per-iteration image_logs (000..003) + final gallery.
  const j2ImageLogs = [];
  for (let it = 0; it <= 3; it++) {
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
    body: JSON.stringify({ project_uid: "PX4", jobs: [J1, J2, J3, J4] }),
  });
  console.log("jobs posted (J2 image_logs iterations · J4 map refs · J2 tile)");

  // J3 hetero_refine: class gallery + non-image refs + one DEAD ref.
  const j3Images = [];
  for (let c = 0; c < 6; c++) {
    const n = String(c).padStart(3, "0");
    j3Images.push({ fileid: "j3_cls" + c, name: "J3_class_" + n + ".png", text: "Class " + n });
  }
  j3Images.push({ fileid: "j3_meta", name: "J3_meta.xml", filename: "J3_meta.xml", filetype: "application/xml", text: "Meta" });
  j3Images.push({ fileid: "j3_dead", name: "J3_gone.png", text: "Old round" });

  // J4 nu_refine: iterations 000..004 (only 004 survives).
  const j4Images = [];
  for (let it = 0; it <= 4; it++) {
    const n = String(it).padStart(3, "0");
    j4Images.push({ fileid: "j4_fsc_" + it, name: "J4_fsc_iter_" + n + ".png", text: "Iteration " + n });
    j4Images.push({ fileid: "j4_ang_" + it, name: "J4_angdist_iter_" + n + ".png", text: "Iteration " + n });
  }

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { uid: "J3", images: j3Images },
      { uid: "J4", images: j4Images },
    ] }),
  });
  console.log("logs posted (J3 gallery + dead ref · J4 5-iteration refs)");

  // EVERY byte posted as OCTET-STREAM — the stale-script shape the user's
  // real server produced. The v3.12 store must sniff + accept these.
  const liveItems = [];
  for (const f of ["j2_slice_3", "j2_avg0", "j2_avg1"]) {
    liveItems.push({ fileid: f, data: OCTET(PNG), name: f + ".png" });
  }
  liveItems.push({ fileid: "j2_tile", data: OCTET(PNG2), name: "J2_tile.png" });
  for (let c = 0; c < 6; c++) {
    liveItems.push({ fileid: "j3_cls" + c, data: OCTET(c % 2 ? PNG2 : PNG), name: "class.png" });
  }
  for (const f of ["j4_fsc_4", "j4_ang_4"]) {
    liveItems.push({ fileid: f, data: OCTET(PNG), name: f + ".png" });
  }
  // Map previews + tile — the v3.12 asset pipeline.
  liveItems.push({ fileid: "j4_vol", data: OCTET(PNG), name: "vol_sharp.png" });
  liveItems.push({ fileid: "j4_half_a", data: OCTET(PNG2), name: "half_a.png" });

  await sleep(500);
  const imgResp = await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: liveItems }),
  });
  const imgJson = await imgResp.json();
  console.log(`bytes posted (${liveItems.length} items) → stored: ${imgJson.stored} (want ${liveItems.length})`);

  await sleep(500);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete posted");
  console.log(`URL=${APP}/?imported=${token}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
