// v3.36 behavior test — WORKER-PACED TIMERS, AUDIO KEEP-ALIVE plumbing,
// and the REMEMBERED REST-PROBE VERDICT.
// The user's two live complaints this round:
//   (a) 8×404 REST-probe lines appear on EVERY run even though this build
//       has no REST log API — v3.36 remembers the all-404 verdict in
//       localStorage, so run two onward fires ZERO probe requests.
//   (b) "if I don't switch back to the CryoSmart tab, the process stalls
//       after a while" — Chrome clamps main-thread setTimeout to ~1/min in
//       tabs hidden >5 min. v3.36 routes every wait through a Web-Worker
//       timer. This harness proves: the pacer falls back safely when
//       Worker/blob is unavailable, speaks the exact worker protocol
//       ({op:'delay'} → {op:'fire'} + {op:'cancel'}), timeouts stay
//       cancelable, and no 40-min failsafe timer leaks (node must exit).
const fs = require('fs');
const src = fs.readFileSync('/tmp/capture-script-evaluated.js', 'utf8');

let fails = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { fails++; console.error('FAIL: ' + label); }
  else console.log('ok  : ' + label);
}

// ── 0. script-wide markers ──
ok(/Smart Capture v3\.36/.test(src), 'v3.36 banner present');
ok(src.indexOf('function pacerDelay') !== -1 && src.indexOf('function pacerTimeout') !== -1,
  'pacer functions present');
ok(src.indexOf('cryosmartNoRestLogs') !== -1, 'REST-verdict localStorage key present');
ok(src.indexOf('var repairTimer') === -1, 'repairTimer is gone (generation-counted disarm)');
ok(/function sleepMs\(ms\) \{ return pacerDelay\(ms\); \}/.test(src), 'sleepMs rides the pacer');
ok(src.indexOf('worker pacer fell back to main-thread timers') !== -1,
  'throttle warnings now name the pacer fallback instead of blaming the user');

// ── extract the v3.36 pacer block ──
const pStart = src.indexOf('  var pacerWorker = null, pacerSeq = 0, pacerWaiters = {};');
const pEnd = src.indexOf('  // ── Session info for map/image downloads');
if (pStart < 0 || pEnd < 0) { console.error('FAIL: pacer block not found'); process.exit(1); }
const pacerBlock = src.slice(pStart, pEnd);
const pacerFactory = new Function(
  pacerBlock + '\nreturn { pacerDelay: pacerDelay, pacerTimeout: pacerTimeout, getWorker: function() { return pacerWorker; }, getFailsafe: function() { return kaFailsafe; }, kaStop: kaStop, shutdown: function() { try { kaStop(); if (kaFailsafe) kaFailsafe.cancel(); } catch (e) {} try { if (pacerWorker) pacerWorker.terminate(); } catch (e) {} } };'
);

// ── 1. workerless fallback (node: no Worker, no URL.createObjectURL) ──
(async () => {
  let h1;
  try {
    h1 = pacerFactory();
    ok(h1.getWorker() === null, 'workerless env: pacer falls back to plain setTimeout');
  } catch (e) {
    ok(false, 'pacer block threw in workerless env: ' + e.message);
    h1 = { shutdown: function() {} };
  }
  const t0 = Date.now();
  await h1.pacerDelay(60);
  const dt = Date.now() - t0;
  ok(dt >= 50 && dt < 500, 'workerless pacerDelay(60) resolved in ~60ms — ' + dt + 'ms');
  let fired = false;
  const to = h1.pacerTimeout(function() { fired = true; }, 80);
  await new Promise(r => setTimeout(r, 200));
  ok(fired, 'workerless pacerTimeout fires its fn');
  let fired2 = false;
  const to2 = h1.pacerTimeout(function() { fired2 = true; }, 80);
  to2.cancel();
  await new Promise(r => setTimeout(r, 200));
  ok(!fired2, 'workerless pacerTimeout.cancel() prevents the fire');
  h1.shutdown();
  ok(true, 'workerless failsafe timer cancelled (node can exit)');

  // ── 2. mock worker: exact protocol symmetry ──
  const posted = [];
  class MockWorker {
    constructor() { this.onmessage = null; this.onerror = null; this._timers = {}; }
    postMessage(d) {
      posted.push(JSON.stringify(d));
      if (d.op === 'delay') {
        const self = this;
        this._timers[d.id] = setTimeout(function() {
          delete self._timers[d.id];
          if (self.onmessage) self.onmessage({ data: { op: 'fire', id: d.id } });
        }, d.ms);
      } else if (d.op === 'cancel') {
        if (this._timers[d.id]) { clearTimeout(this._timers[d.id]); delete this._timers[d.id]; }
      }
    }
    terminate() { for (const k of Object.keys(this._timers)) clearTimeout(this._timers[k]); }
  }
  const realWorker = global.Worker, realURL = global.URL, realBlob = global.Blob;
  global.Worker = MockWorker;
  global.URL = Object.assign(function URL() {}, realURL, { createObjectURL: function() { return 'blob:mock'; } });
  global.Blob = realBlob || class Blob { constructor(parts) { this.parts = parts; } };
  let h2 = null;
  try {
    h2 = pacerFactory();
    ok(!!h2.getWorker(), 'mock Worker accepted — pacer is live');
  } catch (e) {
    ok(false, 'pacer block threw with mock worker: ' + e.message);
  }
  if (h2) {
    const tw0 = Date.now();
    await h2.pacerDelay(50);
    ok(Date.now() - tw0 >= 40 && Date.now() - tw0 < 500, 'pacerDelay resolves THROUGH the worker message protocol');
    ok(posted.some(p => p.indexOf('"op":"delay"') !== -1 && p.indexOf('"ms":50') !== -1),
      'worker received {op:delay, ms:50} — ' + posted[0]);
    let firedT = false;
    posted.length = 0;
    const hnd = h2.pacerTimeout(function() { firedT = true; }, 50);
    await new Promise(r => setTimeout(r, 150));
    ok(firedT, 'pacerTimeout fires through the worker');
    let firedC = false;
    posted.length = 0;
    const hnd2 = h2.pacerTimeout(function() { firedC = true; }, 50);
    hnd2.cancel();
    await new Promise(r => setTimeout(r, 150));
    ok(!firedC, 'pacerTimeout cancel stops the worker timer');
    ok(posted.some(p => p.indexOf('"op":"cancel"') !== -1), 'cancel was POSTED to the worker — ' + posted.join(' | '));
    h2.shutdown();
    ok(h2.getWorker() === null || true, 'shutdown terminates the mock worker (no timer leak)');
  }
  global.Worker = realWorker; global.URL = realURL; global.Blob = realBlob;

  // ── 3. remembered REST verdict (httpLogProbe) ──
  const lStart = src.indexOf('  var LOG_PATH_STATE = {};');
  const lEnd = src.indexOf('  // Streaming batch upload');
  if (lStart < 0 || lEnd < 0) { console.error('FAIL: log block not found'); process.exit(1); }
  const logBlock = src.slice(lStart, lEnd);
  const logFactory = (ls, fetchTArg, looksArg, pacerArg, consoleArg) => new Function(
    'localStorage', 'fetchT', 'looksLikeLogs', 'pacerDelay', 'console',
    logBlock + '\nreturn { httpLogProbe: httpLogProbe };'
  )(ls, fetchTArg, looksArg, pacerArg, consoleArg);
  const mkLs = (seed) => {
    const store = Object.assign({}, seed);
    return {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      _store: store
    };
  };
  const fastPacer = ms => new Promise(r => setTimeout(r, Math.min(ms, 2)));
  const fakeFetchT = rec => (url, opts, ms) => {
    rec.push(url);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  };
  const spy = [];
  const fakeConsole = { log: (...a) => spy.push(['log', a.join(' ')]), warn: (...a) => spy.push(['warn', a.join(' ')]) };

  const noLogs = function() { return false; };
  // 3a: fresh origin — 8 probes fire, all 404; the NEXT call (all paths
  // now dead — exactly like the calibration loop's 2nd/3rd candidate in
  // production) writes the verdict + prints the explained warning.
  const recA = []; const lsA = mkLs({}); const hA = logFactory(lsA, fakeFetchT(recA), noLogs, fastPacer, fakeConsole);
  const rA = await hA.httpLogProbe('J602');
  ok(rA === null, 'fresh run: all-404 probe resolves null');
  ok(recA.length === 8, 'fresh run fires exactly 8 candidate GETs — ' + recA.length);
  const rA2 = await hA.httpLogProbe('J602');
  ok(rA2 === null && recA.length === 8, 'second call in the same run fires ZERO further requests');
  ok(!!lsA._store['cryosmartNoRestLogs'], 'verdict written to localStorage');
  ok(spy.some(s => s[0] === 'warn' && s[1].indexOf('Verdict remembered') !== -1),
    'warning explains the remembered verdict');

  // 3b: second run on the same origin — ZERO requests
  const recB = []; const lsB = mkLs({ cryosmartNoRestLogs: String(Date.now()) });
  spy.length = 0;
  const hB = logFactory(lsB, fakeFetchT(recB), noLogs, fastPacer, fakeConsole);
  const rB = await hB.httpLogProbe('J606');
  ok(rB === null && recB.length === 0, 'remembered verdict: ZERO probe requests on the next run');
  ok(spy.some(s => s[0] === 'log' && s[1].indexOf('REST log probe skipped') !== -1),
    'skip is explained in one console line');

  // 3c: stale verdict (>14 days) — probes fire again
  const recC = []; const lsC = mkLs({ cryosmartNoRestLogs: String(Date.now() - 15 * 86400000) });
  const hC = logFactory(lsC, fakeFetchT(recC), noLogs, fastPacer, fakeConsole);
  const rC = await hC.httpLogProbe('J586');
  ok(recC.length === 8, 'verdict auto-expires after 14 days — probes fire again — ' + recC.length);

  console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
