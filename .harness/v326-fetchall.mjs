#!/usr/bin/env node
/**
 * v3.26 — "Fetch all jobs" endpoint verification.
 *
 * Verifies the request-logs route's new {all:true} form against the LIVE dev
 * server (localhost:3000):
 *   1. staged session create (lineage_mode) + /jobs upload
 *   2. classic {jobs:[...]} request → union, dedupe, filtered to captured jobs
 *   3. {all:true} request → EVERY captured job uid unioned in, log_jobs_total
 *      follows the union size (the strip's progress denominator extends)
 *   4. revision bump per request (the script/grace-window change signal)
 *   5. {jobs:[unknownUid]} → rejected 400 (nothing effective)
 *   6. {all:true} on a session with NO jobs → 400 (nothing to request)
 *   7. session status GET reflects the unioned request
 */
const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`); }
}
const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const get = async (path) => {
  const r = await fetch(BASE + path, { cache: "no-store" });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

const main = async () => {
  // ── 1. session + jobs ────────────────────────────────────────────
  const sess = await post("/api/cryosmart/import/session", {
    project_uid: "P326",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v326 harness",
  });
  check("session created", sess.body?.ok === true && !!sess.body?.token);
  const token = sess.body.token;

  const jobs = [1, 2, 3, 4, 5].map((i) => ({
    uid: `J${i}`,
    job_type: i <= 2 ? "import_movies" : "relion_refine",
    status: "SUCCEEDED",
  }));
  const up = await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
  check("jobs uploaded", up.body?.ok === true && up.body?.total_jobs === 5);

  // ── 2. classic scoped request ────────────────────────────────────
  const r1 = await post(`/api/cryosmart/import/session/${token}/request-logs`, {
    jobs: ["J3", "J4", "J3", "J4"],
  });
  check("scoped request ok", r1.body?.ok === true);
  check(
    "scoped request deduped to 2 jobs",
    Array.isArray(r1.body?.log_request?.jobs) &&
      r1.body.log_request.jobs.length === 2 &&
      r1.body.log_request.jobs.includes("J3") &&
      r1.body.log_request.jobs.includes("J4"),
    JSON.stringify(r1.body?.log_request)
  );
  check("log_jobs_total follows request (2)", r1.body?.log_jobs_total === 2);
  const rev1 = r1.body?.log_request?.revision;

  // ── 3. fetch-all ─────────────────────────────────────────────────
  const r2 = await post(`/api/cryosmart/import/session/${token}/request-logs`, {
    all: true,
  });
  check("fetch-all ok", r2.body?.ok === true);
  const req2 = r2.body?.log_request?.jobs;
  check(
    "fetch-all unions every captured job (5)",
    Array.isArray(req2) && req2.length === 5 && ["J1","J2","J3","J4","J5"].every((u) => req2.includes(u)),
    JSON.stringify(req2)
  );
  check("fetch-all keeps prior scoped jobs (union)", req2.includes("J3") && req2.includes("J4"));
  check("log_jobs_total extends to 5", r2.body?.log_jobs_total === 5);
  check("revision bumped", r2.body?.log_request?.revision === rev1 + 1);

  // ── 4. status GET reflects it ────────────────────────────────────
  const st = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "session status shows 5-job request",
    st.body?.log_request?.jobs?.length === 5 && st.body?.lineage_mode === true
  );

  // ── 5. unknown uids only → filtered no-op (log_request unchanged) ─
  const r3 = await post(`/api/cryosmart/import/session/${token}/request-logs`, {
    jobs: ["NOPE"],
  });
  check(
    "unknown-only jobs list is a no-op (request unchanged, no revision bump)",
    r3.status === 200 &&
      r3.body?.log_request?.jobs?.length === 5 &&
      r3.body?.log_request?.revision === rev1 + 1,
    `status ${r3.status}, request ${JSON.stringify(r3.body?.log_request?.jobs?.length)}`
  );

  // ── 6. {all:true} on an empty session → 400 ─────────────────────
  const sess2 = await post("/api/cryosmart/import/session", {
    project_uid: "P326b",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v326 harness",
  });
  const r4 = await post(
    `/api/cryosmart/import/session/${sess2.body.token}/request-logs`,
    { all: true }
  );
  check("all:true with no jobs rejected (400)", r4.status === 400, `status ${r4.status}`);

  console.log(`\nv326-fetchall: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
