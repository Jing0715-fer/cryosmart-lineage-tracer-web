/**
 * v3.16.1 browser-E2E prep — creates a session stuck in the user's exact
 * state: all jobs scanned, log refs streamed, but only SOME image bytes
 * uploaded, and NO /complete ever arriving (the "263/268 stuck" case).
 *
 * Run: bun .harness/v3161-stuck-prep.mjs   → prints <token> <nRefs> <nUploaded>
 */
const APP = "http://localhost:3000";

const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX8", job_type, title: `${uid} ${job_type}`,
  status: "completed", created_at: NOW, completed_at: NOW,
  parents, children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles", type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [], params_spec: {}, output_group_images: {},
  ui_tile_images: [],
});
const jobs = [
  mkJob("J1", "import_movies", []),
  mkJob("J2", "class_2D", ["J1"]),
  mkJob("J3", "hetero_refine", ["J2"]),
  mkJob("J4", "nonuniform_refine_new", ["J3"]),
];

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

// 8 log refs across the 4 jobs; bytes uploaded for only the first 5.
const logItems = [
  { uid: "J1", images: [{ fileid: "m1", name: "micrograph 1" }, { fileid: "m2", name: "micrograph 2" }] },
  { uid: "J2", images: [{ fileid: "c1", name: "class averages" }] },
  { uid: "J3", images: [
    { fileid: "h1", name: "Class 0 volume" },
    { fileid: "h2", name: "Class 1 volume" },
    { fileid: "h3", name: "Class 2 volume" },
  ] },
  { uid: "J4", images: [{ fileid: "f1", name: "FSC plot" }, { fileid: "f2", name: "Guinier plot" }] },
];
const uploadedIds = ["m1", "m2", "c1", "h1", "h2"]; // 5 of 8 — stuck

const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX8", cryosmart_origin: "http://192.168.0.99:8080",
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J4", lineage_mode: true,
  }),
})).json();
const token = created.token;

const jobsResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX8", jobs }),
})).json();
if (!jobsResp.ok) { console.error("jobs POST failed", jobsResp); process.exit(1); }

const logsResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: logItems }),
})).json();
if (!logsResp.ok) { console.error("logs POST failed", logsResp); process.exit(1); }

const imgResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    items: uploadedIds.map((id) => ({ fileid: id, data: `data:image/png;base64,${PNG_B64}`, name: null })),
  }),
})).json();
if (!imgResp.ok) { console.error("images POST failed", imgResp); process.exit(1); }

// NO /complete — the session stays "collecting_logs" forever, exactly like
// a script whose final POST failed (or whose tab was frozen mid-drain).
const st = await (await fetch(`${APP}/api/cryosmart/import/session/${token}`)).json();
console.log(`${token} status=${st.status} jobs=${st.total_jobs} scanned=${st.log_jobs_done}/${st.log_jobs_total} refs=${st.log_images_count} uploaded=${st.log_images_uploaded}`);
