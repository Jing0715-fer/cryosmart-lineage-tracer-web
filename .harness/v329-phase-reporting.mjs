#!/usr/bin/env node
/**
 * v3.29 — sub-step phase reporting + scan speed verification.
 *
 * The user's report: "Loaded 593 jobs — fetching log images for the traced
 * lineage 0/72… 0% · 0/72 jobs scanned · 0 images captured — it sits here a
 * long time before the fetch steps continue; add hints so it doesn't look
 * frozen, and speed the whole process up."
 *
 * Root cause: every strip counter sits at ZERO for the whole loader-
 * calibration stretch (lazy-job classification + action×shape calibration
 * + HTTP fallback probing — 30–120s on a real build) because /logs batches
 * are the only thing that moves counters, and none can stream before the
 * loader is found. Plus per-job fixed costs: 8 SEQUENTIAL probe paths
 * (worst case 8 × 15s), one full deep store walk PER pending job in the
 * lazy filter, a 3s trace-wait poll and a 60s re-trace grace window.
 *
 * Part A (structural, extracted script): the phase() helper (fire-and-
 * forget, change-rate-limited), a POST /phase at every long sub-step
 * (prepare / calibrating per combo / scan per job + slow-log wait / rescue
 * / grace / rest / drain), the CONCURRENT httpLogProbe (first-valid-wins,
 * no reduce chain), the ONE-WALK lazy filter (lazyScan shared), the cheap
 * quickLogsFor at the scan-loop top with deepLogsForIn as its deep half,
 * the 1.2s trace-wait poll and the 15s grace window.
 *
 * Part B (live REST, dev server :3000): POST /phase stores the sub-step
 * (script_phase / phase_detail / phase_at in the status GET), the POST
 * doubles as a heartbeat (updated_at bumps), caps are enforced (400 on a
 * missing phase, 404 on a dead token, 220-char detail truncation), and the
 * fields survive the whole staged flow (jobs → logs → complete).
 *
 * Part C (app sources): the poller reads the phase fields, replaces the
 * generic "fetching log images 0/N" line with the phase detail while no
 * job has streamed, feeds the strip's activity row (phaseDetail + liveness
 * age), counts phase POSTs as liveness in the stall fingerprint but NOT in
 * the progress-only one (frozen counters must still trip the upload-stall
 * hint), and dedupes render state on the phase fields.
 *
 * Run:  bun .harness/v329-phase-reporting.mjs   (needs the dev server on :3000)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

const script = fs.readFileSync("/tmp/capture-script-check.js", "utf8");
const panelSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "smart-capture-panel.tsx"),
  "utf8"
);
const hookSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "use-imported-metadata.ts"),
  "utf8"
);
const stripSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "lineage-preview-card.tsx"),
  "utf8"
);
const storeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "lib", "cryosmart", "import-session-store.ts"),
  "utf8"
);
const phaseRouteSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "api", "cryosmart", "import", "session", "[token]", "phase", "route.ts"),
  "utf8"
);
const chromeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "site-chrome.tsx"),
  "utf8"
);

/* ── Part A: capture script structure ─────────────────────────── */
console.log("── A. capture script (phase reporting + speed) ──");
{
  check("script extracted (run extract-capture-script.cjs first)", script.length > 50000);
  try { new Function(script); check("script parses (new Function)", true); }
  catch (e) { check("script parses (new Function)", false, e.message); }

  check("script self-identifies as v3.29", script.includes("Smart Capture v3.29"));

  // ── phase() helper: fire-and-forget + change-rate-limited ──
  const phaseFn = script.indexOf("function phase(kind, detail)");
  check("phase() helper defined", phaseFn > 0);
  check(
    "phase() rate-limited by CHANGE only (same phase+detail → no POST)",
    script.includes("if (key === __lastPhaseKey) return;"),
  );
  check(
    "phase() is fire-and-forget (never awaited, errors swallowed)",
    /post\('\/phase', \{ phase: String\(kind[^\n]+\n?[^}]*\}\)\n?\s*\.catch\(function\(\) \{\}\);/.test(script.replace(/\r/g, "")) ||
      script.includes("post('/phase', { phase: String(kind || '').slice(0, 40), detail: String(detail || '').slice(0, 220) })"),
  );
  check(
    "phase detail capped at 220 chars client-side",
    script.includes("String(detail || '').slice(0, 220)"),
  );

  // ── every long sub-step reports ──
  check("prepare phase (lazy classification)", script.includes("phase('prepare', 'checking '"));
  check(
    "calibration phase names the job + action + shape index",
    /phase\('calibrating', 'calibrating on ' \+ calibUid \+ ' — action "' \+ actions\[a\]\.name \+ '" arg shape ' \+ \(s \+ 1\) \+ '\/' \+ shapes\.length \+ '…'\);/.test(script),
  );
  check(
    "calibration HTTP fallback names the parallel probe",
    script.includes("phase('calibrating', 'probing HTTP log endpoints for '"),
  );
  check(
    "scan loop reports per job with index + uid + type",
    /phase\('scan', 'scanning ' \+ \(j \+ 1\) \+ '\/' \+ pending\.length \+ ' · ' \+ uid2 \+/.test(script),
  );
  check(
    "slow second-chance wait is named (the scan's longest single silence)",
    script.includes("' — logs are slow to arrive, waiting up to 20s…'"),
  );
  check(
    "rescue phase explains its fixed 90s window",
    script.includes("phase('rescue',") && script.includes("up to 90s"),
  );
  check("grace phase names the 15s re-trace window", script.includes("phase('grace',"));
  check(
    "rest pass names itself before the per-job phases take over",
    script.includes("phase('rest', 'complete-report pass — scanning the remaining '"),
  );
  check(
    "drain phase reports byte progress (ok + in flight)",
    script.includes("phase('drain', 'uploading image preview bytes — '"),
  );
  check(
    "drain phase updates only when a byte lands/fails (no 250ms spam)",
    script.includes("var dmark = imgUploaded + imgFailed;") &&
      script.includes("if (dmark !== drainMark) {"),
  );

  // ── SPEED: concurrent HTTP probe ──
  const probeFn = script.indexOf("function httpLogProbe(uid)");
  const probeBody = script.slice(probeFn, probeFn + 1800);
  check("httpLogProbe fires ALL paths concurrently", probeBody.includes("paths.forEach"));
  check(
    "first valid hit wins (early resolve, losers ignored)",
    probeBody.includes("won") && /!won\) \{ won = true; resolve\(arr\); \}/.test(probeBody),
  );
  check(
    "resolves null only after EVERY path settled",
    probeBody.includes("remaining === 0") && probeBody.includes("resolve(null)"),
  );
  check(
    "sequential reduce chain GONE (was 8 × 15s worst case per job)",
    !/paths\.reduce\(/.test(script),
  );
  check("per-path timeout still 15s", probeBody.includes("}, 15000)"));

  // ── SPEED: one-walk lazy filter + cheap loop-top check ──
  check(
    "lazy classification deep-scans the store ONCE and shares the result",
    script.includes("var lazyScan = scanForImageLogArrays(stores);") &&
      script.includes("cachedLogsFor(u, lazyScan)"),
  );
  check(
    "deepLogsForIn(all, uid) split exists (array list reusable)",
    script.includes("function deepLogsForIn(all, uid)") &&
      script.includes("deepLogsForIn(scanForImageLogArrays(stores), uid)"),
  );
  const scanLoop = script.indexOf("for (var j = 0; j < pending.length; j++) {");
  const quickUse = script.indexOf("logs2 = quickLogsFor(uid2);");
  check(
    "scan loop top uses quickLogsFor (no per-job deep walk)",
    quickUse > scanLoop && quickUse < scanLoop + 3000,
  );
  check(
    "quickLogsFor is the cheap variant (no deep walk inside)",
    script.includes("function quickLogsFor(uid)") && !/function quickLogsFor\(uid\)[\s\S]{0,600}deepLogsFor/.test(script),
  );
  const lateChance = script.indexOf("v3.9 last chance");
  check(
    "late-chance deep check retained (coverage unchanged)",
    lateChance > 0 && script.includes("var lateLogs = deepLogsFor(uid2);"),
  );

  // ── SPEED: faster polls / shorter grace ──
  check(
    "trace-wait poll is 1.2s (was 3s — the auto-trace lands seconds after jobs)",
    script.includes("await sleepMs(1200);"),
  );
  check("old 3s wait poll gone", !script.includes("await sleepMs(3000);"));
  check(
    "grace window is 15s (was 60s — coverage comes from the rest pass)",
    script.includes("Date.now() + 15000;") && script.includes("graceEnd = Date.now() + 15000"),
  );
  check("grace poll ticks at 1.5s (was 3s)", script.includes("await sleepMs(1500);"));

  // ── panel copy mentions the live sub-step line ──
  check(
    "panel copy explains the sub-step activity line",
    panelSrc.includes("exact current sub-step") && panelSrc.includes("liveness age"),
  );
  check("site banner is v3.29", chromeSrc.includes("v3.29"));
}

/* ── Part B: live REST flow (dev server) ───────────────────────── */
console.log("── B. live REST flow (localhost:3000) ──");
const BASE = "http://localhost:3000";
const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const get = async (p) => {
  const r = await fetch(BASE + p, { cache: "no-store" });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

const main = async () => {
  // 1. session — phase fields start empty
  const sess = await post("/api/cryosmart/import/session", {
    project_uid: "P329",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v329 harness",
  });
  check("session created", sess.body?.ok === true && !!sess.body?.token);
  const token = sess.body.token;
  const s0 = await get(`/api/cryosmart/import/session/${token}`);
  check("initial script_phase empty", s0.body?.script_phase === "" && s0.body?.phase_at === 0);

  // 2. the script's first phase POST (the pre-scan stretch)
  const before = s0.body?.updated_at ?? 0;
  const p1 = await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "calibrating",
    detail: "calibrating on J45 — action \"getJobDetail\" arg shape 2/6…",
  });
  check("phase POST ok", p1.status === 200 && p1.body?.ok === true);
  const s1 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "status GET exposes script_phase / phase_detail / phase_at",
    s1.body?.script_phase === "calibrating" &&
      String(s1.body?.phase_detail || "").includes("getJobDetail") &&
      (s1.body?.phase_at ?? 0) > 0,
  );
  check(
    "phase POST doubles as a heartbeat (updated_at bumps)",
    (s1.body?.updated_at ?? 0) >= before && (s1.body?.phase_at ?? 0) >= before,
  );

  // 3. error paths + caps
  const bad = await post(`/api/cryosmart/import/session/${token}/phase`, { detail: "no phase field" });
  check("missing phase → 400", bad.status === 400);
  const dead = await post("/api/cryosmart/import/session/never-a-token/phase", { phase: "scan" });
  check("dead token → 404", dead.status === 404);
  const long = "x".repeat(300);
  await post(`/api/cryosmart/import/session/${token}/phase`, { phase: "scan", detail: long });
  const s2 = await get(`/api/cryosmart/import/session/${token}`);
  check("detail truncated to 220 chars", (s2.body?.phase_detail || "").length === 220);
  check("phase kind updated", s2.body?.script_phase === "scan");

  // 4. phase changes are visible in successive polls + survive the flow
  const jobs = [1, 2, 3].map((i) => ({ uid: `J${i}`, job_type: "relion_refine", status: "SUCCEEDED" }));
  const up = await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
  check("jobs uploaded", up.body?.ok === true && up.body?.total_jobs === 3);
  await post(`/api/cryosmart/import/session/${token}/request-logs`, { jobs: ["J2"] });
  const p3 = await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "scan",
    detail: "scanning 1/1 · J2 (relion_refine)",
  });
  const l1 = await post(`/api/cryosmart/import/session/${token}/logs`, {
    items: [{ uid: "J2", images: [{ fileid: "f-329-a", name: "fsc.png" }] }],
  });
  check("log batch lands (1/1, 1 image)", l1.body?.log_jobs_done === 1 && l1.body?.log_images_count === 1);
  const s3 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "latest phase wins while counters coexist",
    s3.body?.script_phase === "scan" &&
      String(s3.body?.phase_detail || "").includes("scanning 1/1") &&
      s3.body?.log_jobs_done === 1,
  );
  const p4 = await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "drain",
    detail: "uploading image preview bytes — 0 ok · 1 in flight…",
  });
  check("drain phase POST ok", p4.status === 200);
  const done = await post(`/api/cryosmart/import/session/${token}/complete`, {});
  check("complete ok", done.body?.ok === true && done.body?.status === "complete");
  const s4 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "final status keeps the last phase (diagnostics: what the script was doing last)",
    s4.body?.status === "complete" && s4.body?.script_phase === "drain",
  );

  console.log(`\nPart B: ${passed} passed, ${failed} failed`);
};

/* ── Part C: app sources render the phase ─────────────────────── */
console.log("── C. app sources (poller + strip) ──");
{
  check(
    "SessionStatus declares script_phase / phase_detail / phase_at",
    hookSrc.includes("script_phase?: string;") &&
      hookSrc.includes("phase_detail?: string;") &&
      hookSrc.includes("phase_at?: number;"),
  );
  check(
    "ImportProgress carries phase / phaseDetail / phaseAt",
    hookSrc.includes("phase?: string | null;") &&
      hookSrc.includes("phaseDetail?: string | null;") &&
      hookSrc.includes("phaseAt?: number | null;"),
  );
  check(
    "0/N message override: the phase detail replaces the generic line while no job streamed",
    hookSrc.includes("sessionStatus.log_jobs_done === 0 && phaseDetail"),
  );
  check(
    "progress snapshot includes the phase fields",
    hookSrc.includes("phase: sessionStatus.script_phase || null,") &&
      hookSrc.includes("phaseAt: sessionStatus.phase_at || null,"),
  );

  // stall fingerprints: phase = liveness in the FULL sig, absent from progressSig
  const sigIdx = hookSrc.indexOf("const sig = [");
  const progressSigIdx = hookSrc.indexOf("const progressSig = [");
  const sigBlock = hookSrc.slice(sigIdx, sigIdx + 700);
  const progressSigBlock = hookSrc.slice(progressSigIdx, progressSigIdx + 700);
  check(
    "stall sig counts phase POSTs as liveness (no false 10-min timeout during calibration)",
    sigBlock.includes('sessionStatus.script_phase ?? ""') &&
      sigBlock.includes('sessionStatus.phase_detail ?? ""'),
  );
  check(
    "progress-only sig IGNORES phase (frozen counters still trip the upload-stall hint)",
    !progressSigBlock.includes("script_phase") && !progressSigBlock.includes("phase_detail"),
  );
  check(
    "render-state dedupe covers the phase fields (phases re-render, noise does not)",
    hookSrc.includes("p.phaseDetail === n.phaseDetail &&") &&
      hookSrc.includes("p.phaseAt === n.phaseAt"),
  );

  // strip: activity row + liveness age
  check(
    "strip renders the activity row with the phase detail",
    stripSrc.includes("progress?.phaseDetail &&") && stripSrc.includes("{progress.phaseDetail}"),
  );
  check(
    "strip activity clock ticks only while a phase detail is on screen",
    stripSrc.includes("useElapsedTick(phaseActive)") &&
      stripSrc.includes("const phaseActive =") &&
      stripSrc.includes("status === \"polling\""),
  );
  check(
    "ActivityAge shows 'Ns ago' fresh, amber 'quiet for Nm' when the sub-step went silent",
    stripSrc.includes("s ago") && stripSrc.includes("quiet for {mins}m"),
  );
  check(
    "activity row is announce-only (aria noise-free: no extra role/aria-live)",
    stripSrc.includes("aria-hidden=\"true\"") && stripSrc.includes("<ActivityAge"),
  );

  // store + route
  check(
    "session store carries scriptPhase / phaseDetail / phaseAt + setSessionPhase",
    storeSrc.includes("scriptPhase: string;") &&
      storeSrc.includes("export function setSessionPhase(") &&
      storeSrc.includes("session.phaseAt = Date.now();"),
  );
  check(
    "sessionProgress returns the phase fields",
    storeSrc.includes("script_phase: session.scriptPhase,") &&
      storeSrc.includes("phase_detail: session.phaseDetail,") &&
      storeSrc.includes("phase_at: session.phaseAt,"),
  );
  check(
    "/phase route enforces caps (40-char kind, 220-char detail) and 404s dead tokens",
    phaseRouteSrc.includes("slice(0, 40)") &&
      phaseRouteSrc.includes("slice(0, 220)") &&
      phaseRouteSrc.includes("Session not found or expired."),
  );
}

await main();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
