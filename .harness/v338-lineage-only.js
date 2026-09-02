// v3.38 behavior test — LINEAGE-ONLY scan + REST probes OFF by default +
// embed resume cache (app side is verified separately in the browser E2E).
// User directives this round:
//   (a) "几个报错的404尝试还有必要保留吗?" — no: REST log probing is now
//       opt-in only (default off, __csRestProbe()/localStorage opt back in).
//   (b) "只扫 Trace 谱系的 ~72 个 job就可以了，不需要谱系扫完后自动
//       {all:true} 扩大请求，扫全部剩余 job" — the v3.27 complete-report
//       pass is REMOVED; untraced jobs are skipped with one console line.
//   (c) "获取全部log image后嵌入report过程中卡住，进度一直是0" — app-side
//       deferral + resume cache (lineage-preview-card.tsx / image-embed.ts);
//       the script side must END the capture promptly so the app can settle.
const fs = require('fs');
const src = fs.readFileSync('/tmp/capture-script-evaluated.js', 'utf8');

let fails = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { fails++; console.error('FAIL: ' + label); }
  else console.log('ok  : ' + label);
}

// ── 1. the {all:true} auto-widening pass is GONE ──
ok(!/post\('\/request-logs',\s*\{\s*all:\s*true\s*\}\)/.test(src),
  'no auto {all:true} widening POST remains in executable code');
ok(src.indexOf("Complete-report pass — fetching log images for the remaining") === -1 &&
   src.indexOf("re-trying to widen the log request") === -1,
  'complete-report scan + widen-retry phases removed');
ok(src.indexOf("phase('rest'") === -1,
  "no 'rest' phase POSTs (the strip never enters the all-job pass)");
ok(/Lineage-only mode — '\s*\+\s*rest3\.length/.test(src),
  'untraced remainder is REPORTED (one console line) instead of scanned');
ok(/__csCaptureAll\(\) in this console, or click "Fetch all N jobs"/.test(src),
  'the console line names both opt-ins (__csCaptureAll + strip button)');

// __csCaptureAll and the strip button STILL work as manual opt-ins:
ok(src.indexOf('window.__csCaptureAll = function()') !== -1,
  '__csCaptureAll hook still present (manual fetch-all)');
ok(src.indexOf("pending = ALL_UIDS.slice();") !== -1,
  'CAPTURE_ALL_LATE branch still swaps pending to every job');
ok(src.indexOf('CAPTURE_ALL_LATE') !== -1 && src.indexOf('drain') !== -1,
  'drain still adopts late request-widening (strip Fetch-all button)');

// ── 2. REST probes default OFF ──
ok(/var REST_LOG_PROBES = false;/.test(src) &&
   /localStorage\.getItem\('cryosmartProbeRestLogs'\) === '1'/.test(src),
  'REST probing gated behind localStorage cryosmartProbeRestLogs (default off)');
ok(src.indexOf('window.__csRestProbe = function(uid)') !== -1,
  '__csRestProbe one-off hook present');
ok(src.indexOf("not probed by default") !== -1,
  'default-off is explained in one console line');
// calibration / per-job / rescue HTTP fallbacks all route through the gate:
ok((src.match(/await httpLogProbe\(/g) || []).length >= 3,
  'all three httpLogProbe call sites remain (they now short-circuit off)');
ok(/logAllDeadNoted = true;\s*\n\s*return Promise\.resolve\(null\);/.test(src),
  'default-off marks the fallback loop dead so calibration skips it entirely');

// ── 3. capture ENDS promptly (drain ceiling 300s, not 600s) ──
ok(/drainImageUploads\(300000\)/.test(src) && !/drainImageUploads\(600000\)/.test(src),
  'byte drain ceiling 600s → 300s (lineage-only queue)');
ok(/grace', 'lineage scan complete — brief re-trace window \(15s\), then completing the capture…'/.test(src),
  'grace window wording: completes the capture (no all-job scan follows)');
ok(/\(lineage-only by design\)'/.test(src),
  'final summary carries "lineage-only by design" + the opt-in hint');
ok(/Smart Capture v3\.38/.test(src), 'v3.38 banner present');

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
