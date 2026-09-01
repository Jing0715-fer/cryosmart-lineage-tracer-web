#!/usr/bin/env node
/**
 * v3.27 — complete-report pass verification.
 *
 * Part A (structural): the capture script gained a complete-report pass —
 * after the traced lineage's images stream, the script widens the session's
 * log request to EVERY captured job ({all:true}, same endpoint as the app's
 * Fetch-all button) and scans the remaining jobs. The re-trace grace window
 * shrank 3 min → 60s, the byte-drain ceiling grew 420s → 600s, the rest pass
 * gets a 20-minute scan budget, and __csCaptureFinish() stops the scan at
 * the next job boundary.
 *
 * Part B (behavioural, live dev server): drive the script's exact REST
 * sequence for a 6-job lineage capture —
 *   session(lineage_mode) → /jobs → app trace {jobs:[2]} → /logs for the 2
 *   traced jobs → SCRIPT WIDENING {all:true} → /logs for the 4 remaining
 *   jobs → /complete
 * and assert the progress numbers the strip renders at every hop:
 * denominator extends 2 → 6, done follows, the final status explains itself
 * (request covers every job → the summary's "untraced" count is 0).
 *
 * Run:  bun .harness/v327-complete-report.mjs   (needs the dev server on :3000)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`); }
}

/* ── Part A: script structure ───────────────────────────────────── */
console.log("── A. capture script (v3.27 complete-report pass) ──");
{
  const script = fs.readFileSync("/tmp/capture-script-check.js", "utf8");
  check("script loaded (run extract-capture-script.cjs first)", script.length > 50000);

  // syntax
  try { new Function(script); check("script parses (new Function)", true); }
  catch (e) { check("script parses (new Function)", false, e.message); }

  // the widening POST precedes the rest-pass scan
  const widenIdx = script.indexOf("post('/request-logs', { all: true })");
  const restScanIdx = script.indexOf("scanLogs(1200000)");
  check("script posts {all:true} to /request-logs", widenIdx > 0);
  check("rest pass calls scanLogs with a 20-min budget", restScanIdx > 0);
  check("widening POST happens BEFORE the rest-pass scan", widenIdx > 0 && restScanIdx > widenIdx);

  // rest pass filters to unscanned jobs only
  const restFilterIdx = script.indexOf("ALL_UIDS.filter(function(u) { return !scanned[u]; })");
  check("rest pass filters to unscanned jobs (ALL_UIDS − scanned)", restFilterIdx > 0);

  // grace window + drain ceilings
  check("re-trace grace window is 60s (was 3 min)", script.includes("Date.now() + 60000;   // v3.7: 45s"));
  check("old 3-min grace constant gone", !script.includes("Date.now() + 180000;"));
  check("byte-drain ceiling is 600s (was 420s)", script.includes("drainImageUploads(600000);"));
  check("old 420s drain constant gone", !script.includes("drainImageUploads(420000)"));

  // FINISH_NOW stops the scan mid-loop at a job boundary
  const finBreak = script.indexOf("if (FINISH_NOW) {");
  const scanLoop = script.indexOf("for (var j = 0; j < pending.length; j++) {");
  check(
    "FINISH_NOW breaks the per-job scan loop",
    finBreak > 0 && scanLoop > 0 && finBreak > scanLoop && finBreak < scanLoop + 400,
    `finBreak=${finBreak} scanLoop=${scanLoop}`
  );

  // scanLogs budget is caller-extensible
  check("scanLogs takes a budgetMs argument", /async function scanLogs\(budgetMs\) \{/.test(script));
  check("default budget still 300s", /BUDGET_MS = budgetMs \|\| 300000;/.test(script));

  // the completion summary reports the ACTUAL scanned count
  check(
    "completion summary counts scanned jobs (not just the traced list)",
    script.includes("var scannedCount = Object.keys(scanned).length;") &&
      script.includes("job(s) scanned for log images"),
  );

  // honest UI wording in the component itself
  const panelSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "components", "cryosmart", "smart-capture-panel.tsx"),
    "utf8"
  );
  check(
    "panel copy promises lineage-first + every remaining job",
    panelSrc.includes("for the traced lineage first, then for every remaining"),
  );
}

/* ── Part B: live REST flow (dev server) ────────────────────────── */
console.log("── B. live REST flow (localhost:3000) ──");
const BASE = "http://localhost:3000";
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
  // 1. session + jobs (the script's STEP 1 + STEP 2)
  const sess = await post("/api/cryosmart/import/session", {
    project_uid: "P327",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v327 harness",
  });
  check("session created (lineage_mode)", sess.body?.ok === true && !!sess.body?.token);
  const token = sess.body.token;

  const jobs = [1, 2, 3, 4, 5, 6].map((i) => ({
    uid: `J${i}`,
    job_type: i === 1 ? "import_movies" : i <= 3 ? "relion_refine" : "relion_class2d",
    status: "SUCCEEDED",
  }));
  const up = await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
  check("6 jobs uploaded", up.body?.ok === true && up.body?.total_jobs === 6);

  // 2. app's Trace Lineage publishes the 2-job lineage request
  const tr = await post(`/api/cryosmart/import/session/${token}/request-logs`, {
    jobs: ["J2", "J3"],
  });
  check("trace request (2 jobs) ok", tr.body?.ok === true && tr.body?.log_jobs_total === 2);

  // 3. script scans the traced lineage — J2 with an image, J3 empty
  const l1 = await post(`/api/cryosmart/import/session/${token}/logs`, {
    items: [
      { uid: "J2", images: [{ fileid: "f-327-a", name: "fsc.png" }] },
      { uid: "J3", images: [] },
    ],
  });
  check("traced batches streamed (done 2/2)", l1.body?.log_jobs_done === 2 && l1.body?.log_jobs_total === 2);
  check("1 log image counted", l1.body?.log_images_count === 1);

  // 4. THE v3.27 STEP: the script widens the request to every job
  const widen = await post(`/api/cryosmart/import/session/${token}/request-logs`, { all: true });
  check("script {all:true} widening ok", widen.body?.ok === true);
  check(
    "log request now covers all 6 jobs",
    Array.isArray(widen.body?.log_request?.jobs) && widen.body?.log_request?.jobs.length === 6,
    JSON.stringify(widen.body?.log_request)
  );
  check("progress denominator extends 2 → 6", widen.body?.log_jobs_total === 6);
  check("done stays at 2 (work remains, strip resumes fetching 2/6)", widen.body?.log_jobs_done === 2);
  check("revision bumped (change signal for watchers)", (widen.body?.log_request?.revision ?? 0) > (tr.body?.log_request?.revision ?? 0));

  // 5. script scans the remaining 4 jobs — J1 empty, J4 with an image,
  //    J5 with an image, J6 empty
  const l2 = await post(`/api/cryosmart/import/session/${token}/logs`, {
    items: [
      { uid: "J1", images: [] },
      { uid: "J4", images: [{ fileid: "f-327-b", name: "class0.png" }] },
      { uid: "J5", images: [{ fileid: "f-327-c", name: "class1.png" }, { fileid: "f-327-d", name: "class2.png" }] },
      { uid: "J6", images: [] },
    ],
  });
  check("rest batches streamed (done 6/6)", l2.body?.log_jobs_done === 6 && l2.body?.log_jobs_total === 6);
  check("4 distinct log images total", l2.body?.log_images_count === 4);
  check("3 jobs with images", l2.body?.log_jobs_with_images === 3);

  // 6. complete — the app renders its final summary from THIS snapshot
  const done = await post(`/api/cryosmart/import/session/${token}/complete`, {});
  check("complete ok", done.body?.ok === true && done.body?.status === "complete");

  const fin = await get(`/api/cryosmart/import/session/${token}`);
  const s = fin.body;
  const req = s?.log_request?.jobs ?? [];
  const jobsCount = s?.total_jobs ?? 0;
  const withLogs = s?.log_jobs_with_images ?? 0;
  const nLogs = s?.log_images_count ?? 0;
  // the hook's final-message math, verbatim
  const untraced = Math.max(0, jobsCount - req.length);
  const noLogCount = Math.max(0, req.length - withLogs);
  const wholeProject = req.length >= jobsCount && jobsCount > 0;
  check("final status keeps the widened request", req.length === 6 && jobsCount === 6);
  check("summary math: untraced = 0 (complete-report pass covered everyone)", untraced === 0);
  check("summary math: 3 no-log jobs named", noLogCount === 3);
  check("whole-project wording applies (no 'traced' prefix)", wholeProject === true);
  check(
    "final message renders as expected",
    `Captured ${jobsCount} jobs + ${nLogs} log images from ${withLogs} of the ${req.length} ${wholeProject ? "" : "traced "}jobs` ===
      "Captured 6 jobs + 4 log images from 3 of the 6 jobs",
  );

  console.log(
    `\nv327-complete-report: ${passed} passed, ${failed} failed`
  );
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
