#!/usr/bin/env node
/**
 * v3.30 — byte-drain freeze resilience (dead image endpoint + throttled
 * background tab + silent widening failure).
 *
 * The user's report: "Loaded 593 jobs — uploading image previews 0/712 for
 * the traced lineage… 100% · 72/72 jobs scanned · 712 images captured —
 * stuck here again, and after a while it shows an error."
 *
 * Root causes verified here:
 *   A. fetchImageData's abort timer stopped at HEADERS — a mid-body stall
 *      hung r.blob()/arrayBuffer() forever (0 bytes, 0 failures, no phase
 *      posts → the app's 10-min stall detector declared the capture dead).
 *   B. Background-tab throttling: the capture tab's timers clamp to ~1/min,
 *      so legitimately-silent stretches (90s rescue, frozen-count drain)
 *      went multi-minute with zero heartbeats.
 *   C. The {all:true} widening POST was single-shot and its 4xx RESULT was
 *      never checked (post() resolves parsed JSON) — a silent failure left
 *      the strip's denominator at the traced lineage forever.
 *
 * Part A (structural, extracted script): the end-to-end abort deadline
 * (timer armed through the body read + base64), the retry catch INSIDE
 * run() (every attempt re-armed), the dead-endpoint circuit breaker
 * (24-consecutive-empty / 60-after-partial, fail-fast skip, breaker phase
 * + console), the 25s drain/rescue heartbeats with "waiting for the first
 * preview byte" wording, the setTimeout-gap throttle detection + named
 * note, the document.title mirror + final title, and the ×3 widened
 * request-logs POST with ok-check + fallback phase.
 *
 * Part B (live REST, dev server :3000): a drain phase with the
 * first-byte wording persists through /complete; the breaker-style drain
 * detail survives completion (what the app's final summary appends).
 *
 * Part C (app sources): the 0-byte message variant names the wait; the
 * final summary appends the last drain note when script_phase === 'drain'.
 *
 * Run:  bun .harness/v330-drain-resilience.mjs   (needs the dev server on :3000
 * and `node .harness/extract-capture-script.cjs` run first)
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
const chromeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "app", "components", "cryosmart", "site-chrome.tsx"),
  "utf8"
);

/* ── Part A: capture script structure ─────────────────────────── */
console.log("── A. capture script (bounded bodies + breaker + heartbeats) ──");
{
  check("script extracted (run extract-capture-script.cjs first)", script.length > 50000);
  try { new Function(script); check("script parses (new Function)", true); }
  catch (e) { check("script parses (new Function)", false, e.message); }

  check("script self-identifies as v3.30", script.includes("Smart Capture v3.30"));

  // ── 1. end-to-end fetch deadline ──
  const fnStart = script.indexOf("function fetchImageData(ref)");
  const fnEnd = script.indexOf("function flushImageBatch()");
  const fid = script.slice(fnStart, fnEnd);
  check("fetchImageData located", fnStart > 0 && fnEnd > fnStart);
  check(
    "abort timer armed for the WHOLE attempt (controller + setTimeout in fetchImageData)",
    fid.includes("new AbortController()") &&
      /setTimeout\(function\(\) \{ try \{ ctrl\.abort\(\); \} catch \(e2\) \{\} \}, 30000\)/.test(fid),
  );
  check(
    "the timer is cleared ONLY in the final settle handlers (not at headers)",
    fid.includes("function clearT()") &&
      fid.includes("function(v) { clearT(); return v; }") &&
      fid.includes("function(e) { clearT(); throw e; }") &&
      // exactly ONE clearTimeout — inside clearT's definition — and clearT()
      // appears exactly 3 times (the definition header + the two settle
      // handlers after the body read)
      fid.split("clearTimeout").length === 2 &&
      fid.split("clearT(").length === 4,
  );
  check(
    "the body read runs with the abort signal attached (bounded r.blob)",
    /if \(r\.ok\) return r\.blob\(\);[\s\S]{0,120}bounded: the armed abort signal/.test(fid) ||
      (fid.includes("return r.blob();") && fid.includes("bounded: the armed abort signal")),
  );
  check(
    "the signal is bound to the fetch (stalled body rejects on abort)",
    fid.includes("if (ctrl) o.signal = ctrl.signal;") && fid.includes("var o = { credentials: 'include' };"),
  );
  check(
    "retry catch lives INSIDE run() so every attempt re-arms it",
    fid.includes(".catch(function(e) {\n        // NOTE: attached INSIDE run()") &&
      /return run\(\);\s*\n\s*\}/.test(fid) &&
      !/return run\(\)\.catch/.test(fid),
  );
  check(
    "no fetchT in fetchImageData any more (headers-only timeout class is gone)",
    !fid.includes("fetchT('/api/log_image/'"),
  );

  // ── 2. dead-endpoint circuit breaker ──
  check(
    "breaker state declared (consecutive nulls + tripped + threshold 24)",
    script.includes("var imgConsecNull = 0;") &&
      script.includes("var imgBreakerTripped = false;") &&
      script.includes("var IMG_BREAKER_N = 24;"),
  );
  check(
    "tripImgBreaker fail-fasts the pending queue and counts them honestly",
    script.includes("function tripImgBreaker(why)") &&
      script.includes("imgFailed += skipped;") &&
      script.includes("imgQueue.length = 0;"),
  );
  check(
    "breaker trips on 24 straight empty fetches while ZERO bytes stored, or 60 after partial success",
    /imgUploaded === 0 && imgConsecNull >= IMG_BREAKER_N/.test(script) &&
      /imgConsecNull >= 60/.test(script),
  );
  check(
    "a successful fetch resets the breaker chain",
    /imgConsecNull = 0;\s*\n\s*\/\/ v3\.30: a live endpoint resets the breaker chain/.test(script.replace(/\r/g, "")) ||
      script.includes("imgConsecNull = 0;   // v3.30: a live endpoint resets the breaker chain"),
  );
  check(
    "breaker phase names the skip and the re-run path (refs are kept)",
    script.includes("phase('drain', 'the CryoSmart image endpoint is not responding — skipped the remaining '") &&
      script.includes("a re-run can fetch them"),
  );
  check(
    "drain resolve line names the breaker when it tripped",
    script.includes("imgBreakerTripped ? ' (the dead-endpoint breaker skipped the tail"),
  );
  check(
    "zero-bytes console diagnostic names the breaker + throttling advice",
    script.includes("imgBreakerTripped\n        ? '\\\\n   (the dead-endpoint breaker tripped") ||
      (script.includes("the dead-endpoint breaker tripped") && script.includes("backgrounded tabs are throttled by the browser")),
  );

  // ── 3. drain heartbeat + throttle detection ──
  const drainStart = script.indexOf("function drainImageUploads(budgetMs)");
  const drainEnd = script.indexOf("// ── STEP 2: embed cached logs");
  const drain = script.slice(drainStart, drainEnd);
  check("drainImageUploads located", drainStart > 0 && drainEnd > drainStart);
  check(
    "drain heartbeat cadence (25s) while the counts sit frozen",
    drain.includes("var lastBeatAt = drainStart;") && drain.includes("now - lastBeatAt >= 25000"),
  );
  check(
    "frozen-count heartbeat names the first-byte wait explicitly",
    drain.includes("waiting for the first preview byte — '") &&
      drain.includes("none answered yet"),
  );
  check(
    "heartbeat carries the elapsed quiet time (each POST is a fresh heartbeat)",
    drain.includes("' · quiet for ' + Math.round((now - drainStart) / 1000) + 's'"),
  );
  check(
    "a byte landing/ failing resets the heartbeat clock",
    /dmark !== drainMark[\s\S]{0,200}lastBeatAt = now;/.test(drain),
  );
  check(
    "setTimeout-gap throttle detection in the drain",
    drain.includes("var tickGap = now - lastCheckAt;") && drain.includes("tickGap > 8000"),
  );
  check(
    "throttle note names the browser clamp and the fix (keep the tab visible)",
    drain.includes("being throttled by the browser") && drain.includes("keep the tab visible for full speed"),
  );
  check(
    "throttle note posted once only",
    /!throttleNoted && tickGap > 8000/.test(drain) && drain.includes("var throttleNoted = false;"),
  );
  check(
    "drain in-flight count shared by both phase lines",
    drain.includes("var inFlight = imgQueue.length + imgWorkers + imgBatch.length;"),
  );

  // ── 4. rescue heartbeat ──
  check(
    "rescue heartbeat (25s cadence) through the late-log window",
    script.includes("var rescueBeat = Date.now();") && script.includes("rnow - rescueBeat >= 25000"),
  );
  check(
    "rescue heartbeat names the jobs still pending + time left",
    script.includes("job(s) still awaiting late log delivery — '") &&
      script.includes("s left of the rescue window…"),
  );
  check(
    "rescue sleep-drift throttle detection (backgrounded tab)",
    script.includes("var sleepStart = Date.now();") &&
      script.includes("Date.now() - sleepStart > 8000") &&
      script.includes("var rescueThrottle = false;"),
  );

  // ── 5. tab-title mirror ──
  check(
    "phase() mirrors the sub-step into document.title",
    script.includes("document.title = 'CryoSmart capture · ' + String(kind || '') + ': '"),
  );
  check(
    "completion sets a final outcome title",
    script.includes("document.title = 'CryoSmart capture · complete — '") &&
      script.includes("image(s) with bytes · see the web app tab'"),
  );

  // ── 6. {all:true} widening retry ──
  check(
    "widening POST retried up to 3 times",
    script.includes("for (var wr = 0; wr < 3 && !widened; wr++)"),
  );
  check(
    "widening RESULT checked (post() resolves 4xx JSON too)",
    script.includes("var pr = await post('/request-logs', { all: true });") &&
      script.includes("if (pr && pr.ok) widened = true;"),
  );
  check(
    "widening retry backoff (1s / 3s)",
    script.includes("await sleepMs(1000 + wr * 2000);"),
  );
  check(
    "failed widening posts an honest phase (totals may lag)",
    script.includes("phase('rest', 'could not widen the log request — scanning the remaining jobs anyway") &&
      script.includes("the progress totals may lag behind"),
  );
  check(
    "failed widening console names the app's Fetch-all escape hatch",
    script.includes("Could not widen the log request — scanning the remaining jobs anyway") &&
      script.includes('"Fetch all" button can still widen it'),
  );
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
  const beforeB = passed;
  // 1. the user's frozen shape in miniature: jobs + refs streamed, ZERO bytes
  const sess = await post("/api/cryosmart/import/session", {
    project_uid: "P330",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v330 harness",
  });
  check("session created", sess.body?.ok === true && !!sess.body?.token);
  const token = sess.body.token;
  const jobs = [1, 2, 3].map((i) => ({ uid: `J${i}`, job_type: "relion_refine", status: "SUCCEEDED" }));
  await post(`/api/cryosmart/import/session/${token}/jobs`, { jobs });
  await post(`/api/cryosmart/import/session/${token}/request-logs`, { jobs: ["J2", "J3"] });
  await post(`/api/cryosmart/import/session/${token}/logs`, {
    items: [
      { uid: "J2", images: [{ fileid: "f-330-a", name: "fsc.png" }, { fileid: "f-330-b", name: "ang.png" }] },
      { uid: "J3", images: [] },
    ],
  });
  const s1 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "the frozen shape: scan done, refs present, ZERO bytes uploaded",
    s1.body?.log_jobs_done === 2 && s1.body?.log_jobs_total === 2 &&
      s1.body?.log_images_count === 2 && s1.body?.log_images_uploaded === 0,
  );

  // 2. the drain heartbeat line lands and is readable in the next poll
  const hb = await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "drain",
    detail: "waiting for the first preview byte — 2 fetch(es) in flight, none answered yet · quiet for 45s",
  });
  check("drain heartbeat phase POST ok", hb.status === 200 && hb.body?.ok === true);
  const s2 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "first-byte heartbeat visible in the status GET",
    s2.body?.script_phase === "drain" &&
      String(s2.body?.phase_detail || "").includes("waiting for the first preview byte") &&
      String(s2.body?.phase_detail || "").includes("quiet for 45s"),
  );
  check(
    "heartbeat bumps updated_at (stall detector stays quiet)",
    (s2.body?.updated_at ?? 0) >= (s2.body?.phase_at ?? 0) - 5,
  );

  // 3. the breaker line persists through /complete — what the final
  //    summary appends when the script ends in the drain phase
  const brk = await post(`/api/cryosmart/import/session/${token}/phase`, {
    phase: "drain",
    detail: "the CryoSmart image endpoint is not responding — skipped the remaining 710 preview byte(s) (refs are kept; a re-run can fetch them)",
  });
  check("breaker phase POST ok", brk.status === 200);
  const done = await post(`/api/cryosmart/import/session/${token}/complete`, {});
  check("complete ok", done.body?.ok === true && done.body?.status === "complete");
  const s3 = await get(`/api/cryosmart/import/session/${token}`);
  check(
    "breaker drain note survives completion (final summary appends it)",
    s3.body?.status === "complete" && s3.body?.script_phase === "drain" &&
      String(s3.body?.phase_detail || "").includes("image endpoint is not responding"),
  );
  check(
    "ref data intact after the breaker (refs kept, bytes zero)",
    s3.body?.log_images_count === 2 && s3.body?.log_images_uploaded === 0,
  );

  // 4. a heartbeat-style phase also survives (slow-endpoint case)
  const sess2 = await post("/api/cryosmart/import/session", {
    project_uid: "P330B",
    cryosmart_origin: "http://cryosmart.invalid",
    lineage_mode: true,
    source: "v330 harness",
  });
  const t2 = sess2.body.token;
  await post(`/api/cryosmart/import/session/${t2}/jobs`, { jobs });
  await post(`/api/cryosmart/import/session/${t2}/request-logs`, { jobs: ["J1"] });
  await post(`/api/cryosmart/import/session/${t2}/logs`, {
    items: [{ uid: "J1", images: [{ fileid: "f-330-c", name: "x.png" }] }],
  });
  await post(`/api/cryosmart/import/session/${t2}/images`, {
    items: [{ fileid: "f-330-c", data: "data:image/png;base64,iVBORw0KGgo=" }],
  });
  await post(`/api/cryosmart/import/session/${t2}/phase`, {
    phase: "drain",
    detail: "uploading image preview bytes — 1 ok · 0 still in flight · quiet for 30s",
  });
  await post(`/api/cryosmart/import/session/${t2}/complete`, {});
  const s4 = await get(`/api/cryosmart/import/session/${t2}`);
  check(
    "healthy-drain heartbeat detail survives too (1 ok wording)",
    s4.body?.status === "complete" &&
      String(s4.body?.phase_detail || "").includes("uploading image preview bytes — 1 ok"),
  );

  console.log(`\nPart B: ${passed - beforeB} passed, ${failed} failed`);
};

/* ── Part C: app sources ──────────────────────────────────────── */
console.log("── C. app sources (poller message + final summary) ──");
{
  check(
    "0-byte message variant names the wait (endpoint slow/stalled, refs captured)",
    hookSrc.includes("no preview bytes yet (the CryoSmart image endpoint is slow or stalled; refs are captured)"),
  );
  check(
    "the variant applies only while upl === 0 (progress keeps the classic line)",
    hookSrc.includes("upl === 0\n                    ? `Loaded ${sessionStatus.total_jobs} jobs — uploading image previews 0/${imgs}"),
  );
  check(
    "final summary appends the last drain note (script_phase === 'drain')",
    hookSrc.includes('sessionStatus.script_phase === "drain"') &&
      hookSrc.includes("` — ${sessionStatus.phase_detail}`"),
  );
  check(
    "site banner is v3.30",
    chromeSrc.includes("v3.30"),
  );
  check(
    "panel changelog names the v3.30 story",
    panelSrc.includes("v3.30:\n// DEAD-ENDPOINT RESILIENCE"),
  );
}

const run = async () => {
  await main();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};
run().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
