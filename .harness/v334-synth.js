// v3.34 behavior test — signature-aware loader calls (synthCallArgs).
// Verifies: the get_job_streamlog popup root cause is eliminated, the
// correct-arg call IS synthesized, and unsatisfiable actions are skipped.
const fs = require('fs');
const src = fs.readFileSync('/tmp/capture-script-evaluated.js', 'utf8');

let fails = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { fails++; console.error('FAIL: ' + label); }
  else console.log('ok  : ' + label);
}

// ── extract the v3.34 helper block from the evaluated script ──
const start = src.indexOf('  function rowFor(uid) {');
const end = src.indexOf('  function waitForLogs(uid, ms) {');
if (start < 0 || end < 0) { console.error('FAIL: helper block not found in script'); process.exit(1); }
const block = src.slice(start, end);

const jobs = [{ uid: 'J578', job_type: 'hetero_refine', experiment_uid: 'E1', workspace_uid: 'E1' }];
const projectId = 'P259';

const factory = new Function(
  'jobs', 'projectId', block + '\nreturn { parseFnParams: parseFnParams, knownArgFor: knownArgFor, payloadKeyParamMap: payloadKeyParamMap, synthCallArgs: synthCallArgs };'
);
const h = factory(jobs, projectId);

const uid = 'J578';

// 1. THE BUG: unminified get_job_streamlog(project_uid, job_uid) — the
//    server's own signature. Old shapes sent neither → ServerError popup.
let r = h.synthCallArgs(function get_job_streamlog(project_uid, job_uid) {
  return sm.send('get_job_streamlog', { project_uid: project_uid, job_uid: job_uid });
}, uid);
ok(!r.skip && JSON.stringify(r.args) === JSON.stringify(['P259', 'J578']),
  'unminified (project_uid, job_uid) → [projectId, uid] — ' + JSON.stringify(r));

// 2. MINIFIED: params mangled to e/t, payload keys survive.
r = h.synthCallArgs(function (e, t) {
  return s.send('get_job_streamlog', { project_uid: e, job_uid: t });
}, uid);
ok(!r.skip && JSON.stringify(r.args) === JSON.stringify(['P259', 'J578']),
  'minified {project_uid: e, job_uid: t} → [projectId, uid] — ' + JSON.stringify(r));

// 3. MINIFIED PASSTHROUGH: single unknown param → SKIPPED (no blind call,
//    no server popup).
r = h.synthCallArgs(function (e) {
  return s.send('get_job_streamlog', e);
}, uid);
ok(!!r.skip && !r.args, 'minified passthrough fn(e) → skipped — ' + JSON.stringify(r));

// 4. destructured ({ job_uid, project_uid }) → exact-key object.
r = h.synthCallArgs(async ({ job_uid, project_uid }) => ({ job_uid, project_uid }), uid);
ok(!r.skip && JSON.stringify(r.args) === JSON.stringify([{ job_uid: 'J578', project_uid: 'P259' }]),
  'destructured ({job_uid, project_uid}) → exact object — ' + JSON.stringify(r));

// 5. zero-param action → called with no args.
r = h.synthCallArgs(function refreshLogs() { return null; }, uid);
ok(!r.skip && r.args.length === 0, 'zero-param action → [] — ' + JSON.stringify(r));

// 6. unknown required params → skipped (the old blind [uid] / {uid} shapes
//    are exactly what raised the missing-args TypeError).
r = h.synthCallArgs(function (a, b) { return a + b; }, uid);
ok(!!r.skip, 'unknown (a, b) → skipped — ' + JSON.stringify(r));

// 7. unknown params without a default are REQUIRED → skipped (conservative:
//    an unknown required param may be forwarded to the server); WITH a
//    default they are optional → called as undefined.
r = h.synthCallArgs(function getLogs(job_uid, opts) { return null; }, uid);
ok(!!r.skip, 'getLogs(job_uid, opts) no-default → skipped (unknown required param) — ' + JSON.stringify(r));
const withDefault = new Function('job_uid', 'opts = null', 'return null');
r = h.synthCallArgs(withDefault, uid);
ok(!r.skip && r.args.length === 2 && r.args[0] === 'J578' && r.args[1] === undefined,
  'getLogs(job_uid, opts = null) → [uid, undefined] — ' + JSON.stringify(r));

// 8. method shorthand source (String(fn) starts at the method name).
const ms = { async getLogs(uid) { return null; } };
r = h.synthCallArgs(ms.getLogs, uid);
ok(!r.skip && JSON.stringify(r.args) === JSON.stringify(['J578']),
  'method shorthand getLogs(uid) → [uid] — ' + JSON.stringify(r));
// 8b. camelCase jobUid lowercases into the known map.
const msCamel = { async getLogsByJob(jobUid) { return null; } };
r = h.synthCallArgs(msCamel.getLogsByJob, uid);
ok(!r.skip && r.args[0] === 'J578', 'getLogsByJob(jobUid) → [uid] — ' + JSON.stringify(r));

// 9. id → job uid.
const ms2 = { getLogDetail(id) { return null; } };
r = h.synthCallArgs(ms2.getLogDetail, uid);
ok(!r.skip && r.args[0] === 'J578', 'getLogDetail(id) → [uid] — ' + JSON.stringify(r));

// 10. experiment_uid supply.
r = h.synthCallArgs(function loadExpLogs(experiment_uid, job_uid) { return null; }, uid);
ok(!r.skip && r.args[0] === 'E1' && r.args[1] === 'J578',
  '(experiment_uid, job_uid) → [E1, uid] — ' + JSON.stringify(r));

// 11. rest-param only → treat as optional.
r = h.synthCallArgs(function emitAll(...rest) { return null; }, uid);
ok(!r.skip, '(...rest) → callable — ' + JSON.stringify(r));

// ── script-wide regressions ──
ok(src.indexOf('shapesFor') === -1, 'shapesFor removed from script');
ok(src.indexOf('shapeIdx') === -1, 'shapeIdx removed from script');
ok((src.match(/fn\.apply\(/g) || []).length === 3,
  'three signature-exact fn.apply call sites (calibration + per-job + rescue) — count ' + (src.match(/fn\.apply\(/g) || []).length);
ok(/Image store accepted/.test(src) && /r\.rejects/.test(src), 'postBatch reads r.rejects');
ok(/v3\.34/.test(src), 'v3.34 marker present');

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
