/**
 * v3.13 browser E2E session — staged capture with:
 *   - J5 (end job, nu_refine): numbered-series refs 000–007 ("Per particle
 *     scale factors") + explicit "Iteration 008" refs + 26 total log images
 *     to prove the report's raised 24-image display cap.
 *   - J3 (hetero_refine): class-gallery refs (volume_class_0/1/2) + output
 *     group previews with bytes.
 *   - All bytes uploaded (PNG data URLs).
 * The page at /?imported=<token> must auto-trace (end_job_uid=J5), render
 * the graph, collapse the series in the report, and show "Log images
 * (24 / 26)" for J5.
 */
const APP = "http://localhost:3000";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGJgYGBgAAcAAf//BwAEhwAAAABJRU5ErkJggg==";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX6", job_type, title: `${uid} ${job_type}`,
  status: "completed", created_at: NOW, completed_at: NOW,
  parents, children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles", type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [], params_spec: {},
  output_group_images: {}, ui_tile_images: [],
});

const jobs = [
  mkJob("J1", "import_movies", []),
  mkJob("J2", "class_2D", ["J1"]),
  mkJob("J3", "hetero_refine", ["J2"]),
  mkJob("J4", "homo_abinit", ["J3"]),
  mkJob("J5", "nonuniform_refine_new", ["J4"]),
];
jobs[4].output_group_images = { volume: "vol_prev", fsc: "fsc_prev" };
jobs[2].output_group_images = { volume_class_0: "vc0", volume_class_1: "vc1", volume_class_2: "vc2" };

// J5 refs: 8× numbered series + 2× iteration-marker + 20 fillers = 30 refs,
// 26 expected to SURVIVE the filters (8→1 series, 2→1 iteration).
const j5Refs = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
    fileid: `sf_${n}`,
    name: `Per particle scale factors ${String(n).padStart(3, "0")}`,
    text: `Per particle scale factors ${String(n).padStart(3, "0")}`,
  })),
  { fileid: "rs_000", name: "Real Space Slices Iteration 000", text: "Real Space Slices Iteration 000" },
  { fileid: "rs_008", name: "Real Space Slices Iteration 008", text: "Real Space Slices Iteration 008" },
  ...Array.from({ length: 24 }, (_, i) => ({
    fileid: `fill_${i}`,
    name: `Final plot ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "2" : ""}`,
    text: `Final plot ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "2" : ""}`,
  })),
];
const j3Refs = [
  { fileid: "cls_gallery", name: "classes", text: "class gallery" },
  { fileid: "vc0_prev_ref", name: "volume_class_0", text: "volume_class_0" },
  { fileid: "vc1_prev_ref", name: "volume_class_1", text: "volume_class_1" },
  { fileid: "vc2_prev_ref", name: "volume_class_2", text: "volume_class_2" },
];

async function main() {
  const { token } = await (await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PX6",
      cryosmart_origin: "http://192.168.202.11:8080",
      cryosmart_auth: "Bearer sim",
      source: "sim",
      end_job_uid: "J5",
      lineage_mode: true,
    }),
  })).json();
  console.log(`TOKEN=${token}`);

  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PX6", jobs }),
  });
  console.log("jobs posted");

  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ uid: "J5", images: j5Refs }, { uid: "J3", images: j3Refs }] }),
  });
  console.log("log refs posted");

  const byteItems = [...j5Refs, ...j3Refs, { fileid: "vol_prev" }, { fileid: "fsc_prev" }]
    .map((r, i) => ({
      fileid: r.fileid,
      data: `data:image/png;base64,${i % 2 ? PNG : PNG2}`,
      name: r.name || null,
    }));
  const up = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: byteItems }),
  })).json();
  console.log("bytes stored:", up.stored);

  await sleep(300);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete; open:", `${APP}/?imported=${token}&pid=PX6`);
}
main().catch((e) => { console.error(e); process.exit(1); });
