#!/usr/bin/env node
/**
 * v3.30 E2E prep — stages the user's FROZEN capture shape in miniature:
 * jobs uploaded, a traced-lineage request whose scan is COMPLETE, image
 * refs streamed, ZERO preview bytes, and a live drain phase with the
 * first-byte heartbeat detail. Optionally (--complete) posts the breaker
 * drain note + /complete so the final summary's drain append can be
 * verified.
 *
 * Usage:
 *   node v330-e2e-prep.mjs            → prints token (frozen state)
 *   node v330-e2e-prep.mjs complete   → prints token (completed w/ breaker note)
 */
const BASE = "http://localhost:3000";
const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  try { return await r.json(); } catch { return null; }
};

const jobs = [
  { uid: "J1", job_type: "import", status: "SUCCEEDED", title: "Import movies" },
  { uid: "J2", job_type: "motion_corr", status: "SUCCEEDED", title: "Motion correction" },
  { uid: "J3", job_type: "ctf", status: "SUCCEEDED", title: "CTF estimation" },
  { uid: "J4", job_type: "relion_refine", status: "SUCCEEDED", title: "Class 3D" },
  { uid: "J5", job_type: "nu_refine", status: "SUCCEEDED", title: "NU refine" },
  { uid: "J6", job_type: "postprocess", status: "SUCCEEDED", title: "Postprocess" },
];

const sess = await post("/api/cryosmart/import/session", {
  project_uid: "P330E2E",
  cryosmart_origin: "http://cryosmart.invalid",
  lineage_mode: true,
  end_job_uid: "J5",
  source: "v330 e2e prep",
});
const token = sess.token;

await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
await post(`/api/cryosmart/import/session/${token}/request-logs`, { jobs: ["J4", "J5"] });
// The traced scan COMPLETED and streamed refs — the user's 72/72 · 712 refs
// · 0 bytes, in miniature (4 refs, all without bytes).
await post(`/api/cryosmart/import/session/${token}/logs`, {
  items: [
    { uid: "J4", images: [{ fileid: "e2e-a", name: "fsc.png" }, { fileid: "e2e-b", name: "ang.png" }] },
    { uid: "J5", images: [{ fileid: "e2e-c", name: "class-avg.png" }, { fileid: "e2e-d", name: "iter.png" }] },
  ],
});
// The drain heartbeat line — what the script posts every 25s while the
// counts sit frozen at 0 bytes.
await post(`/api/cryosmart/import/session/${token}/phase`, {
  phase: "drain",
  detail: "waiting for the first preview byte — 4 fetch(es) in flight, none answered yet · quiet for 45s",
});

if (process.argv[2] === "complete") {
  await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "drain",
    detail: "the CryoSmart image endpoint is not responding — skipped the remaining 4 preview byte(s) (refs are kept; a re-run can fetch them)",
  });
  await post(`/api/cryosmart/import/session/${token}/complete`, {});
}

console.log(token);
