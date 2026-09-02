// v3.35 behavior test — RPC-LAYER ARGUMENT REPAIR.
// v3.34's harness passed 18/18 while production captured 0 images because
// it tested RAW functions. Real pinia store actions are WRAPPERS —
// String(store.action) is pinia's own "function () { const args =
// Array.from(arguments); … }" — so v3.34's signature synthesis saw a
// zero-parameter function and called every loader with NO arguments.
// This harness therefore drives the shipped block against a REAL pinia
// store (require('pinia')) end-to-end:
//   · the pinia-wrapped loader receives our guessed shapes again (v3.33
//     behavior restored — the mechanism that captured 903/320/128 images)
//   · the pre-v3.34 ServerError popup shape — a 2-param action called
//     with 1 arg forwarding (job_uid, undefined) to the wire — is
//     repaired into a complete (project_uid, job_uid) RPC at the socket
//     boundary and never reaches the server half-empty
//   · the SPA's own calls (outside our call windows) are untouched
//   · uncompletable payloads are swallowed before the wire
const fs = require('fs');
const src = fs.readFileSync('/tmp/capture-script-evaluated.js', 'utf8');

let fails = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { fails++; console.error('FAIL: ' + label); }
  else console.log('ok  : ' + label);
}

// ── extract the v3.35 block from the evaluated script ──
const start = src.indexOf('  function rowFor(uid) {');
const end = src.indexOf('  function waitForLogs(uid, ms) {');
if (start < 0 || end < 0) { console.error('FAIL: v3.35 block not found'); process.exit(1); }
const block = src.slice(start, end);

const jobs = [{ uid: 'J606', job_type: 'hetero_refine', experiment_uid: 'E1', workspace_uid: 'E1' }];
const projectId = 'P222';

// ── fake socket layer: records every frame that reaches "the wire" ──
const wire = [];
const wireJson = [];
const socketManager = {
  call: function (name, payload) { wire.push([name, payload]); return Promise.resolve(null); },
  emit: function (name, a, b) { wire.push([name, a, b]); return Promise.resolve(null); },
  ws: { send: function (data) { wireJson.push(data); } }
};
const socketStore = { socketManager: socketManager };

const factory = new Function(
  'jobs', 'projectId', 'socketStore',
  block + '\nreturn { rowFor: rowFor, shapesFor: shapesFor, repairUidFields: repairUidFields, repairArgs: repairArgs, payloadIncomplete: payloadIncomplete, ensureRpcPatch: ensureRpcPatch, armRepair: armRepair, rpcNotes: rpcNotes, getState: function() { return { blindCallActive: blindCallActive, ctx: blindCallCtx }; } };'
);
const h = factory(jobs, projectId, socketStore);

// ── 1. shapesFor: the v3.2–v3.33 shape list is back ──
const shapes = h.shapesFor('J606');
ok(Array.isArray(shapes) && shapes[0] === 'J606', 'shape[0] is the raw job uid (the historical winner)');
ok(shapes[1] && shapes[1].job_uid === 'J606', 'shape[1] is {job_uid}');
ok(shapes.length === 6, 'six shapes (uid, {job_uid}, {uid}, [uid], row, {uid, project_uid}) — got ' + shapes.length);
ok(shapes[5] && shapes[5].project_uid === 'P222', 'shape[5] carries {uid, project_uid}');

// ── 2. REAL pinia store: the wrapper must forward our guessed shape ──
const { createPinia, defineStore, setActivePinia } = require('pinia');
const pinia = createPinia();
setActivePinia(pinia);
let smRef = null;
const useLogStore = defineStore('logs', {
  state: () => ({ logsByJob: {} }),
  actions: {
    // the EXACT pre-v3.34 popup causer, as the real build has it:
    // a 2-parameter WS RPC action.
    get_job_streamlog(project_uid, job_uid) {
      return smRef.emit('get_job_streamlog', { project_uid: project_uid, job_uid: job_uid });
    },
    // the historical winner: a 1-parameter passthrough loader.
    getLogsByJob(e) {
      return smRef.call('get_job_logs', e);
    }
  }
});
smRef = socketManager;
const store = useLogStore();
ok(/function \(\) \{/.test(String(store.getLogsByJob)) || String(store.getLogsByJob).indexOf('Array.from(arguments)') !== -1,
  'pinia action String() is the WRAPPER (this is what broke v3.34): ' + String(store.getLogsByJob).slice(0, 60).replace(/\n/g, ' ') + '…');

// ── 3. arm the repair layer + wrap the socket manager ──
h.ensureRpcPatch();
ok(socketManager.call !== undefined && String(socketManager.call).indexOf('[native code]') === -1, 'socketManager.call is wrapped in place');

// ── 4. THE POPUP KILLER: 2-param action called with 1 arg (shape[0]) ──
wire.length = 0;
h.armRepair('J606');          // arms for ~1.2s around OUR call
store.get_job_streamlog('J606');   // v3.33 blind shape: uid into a 2-param action → payload {project_uid: jobUid, job_uid: undefined}
ok(wire.length === 1 && wire[0][1] && wire[0][1].project_uid === 'P222' && wire[0][1].job_uid === 'J606',
  'under-supplied {project_uid: <jobUid>, job_uid: undefined} was repaired into a complete payload BEFORE the wire — ' + JSON.stringify(wire));

// ── 5. THE IMAGE FIX: the historical winner is callable again ──
wire.length = 0;
h.armRepair('J606');
store.getLogsByJob('J606');   // v3.34 called this with ZERO arguments — 0 images
ok(wire.length === 1 && wire[0][0] === 'get_job_logs' && wire[0][1] === 'J606',
  'pinia-wrapped getLogsByJob(uid) reaches the wire with the job uid (v3.34 sent it with NO arguments) — ' + JSON.stringify(wire));

// ── 6. SPA's OWN traffic is untouched outside our windows ──
h.getState(); // ensure accessor exists
// disarm by waiting out the 1.2s window
setTimeout(async () => {
  const s1 = h.getState();
  ok(s1.blindCallActive === false, 'armRepair self-disarms after its 1.2s window');
  wire.length = 0;
  socketManager.call('get_job_logs', { job_uid: 'J606' });   // the SPA's own, correct call
  ok(wire.length === 1 && wire[0][1].job_uid === 'J606' && Object.keys(wire[0][1]).length === 1,
    'SPA payload outside our call window passes through byte-identical — ' + JSON.stringify(wire));
  // a payload the SPA itself sends with a legitimately null field while UNARMED also passes
  socketManager.call('list_projects', { project_uid: null });
  ok(wire.length === 2, 'unarmed null-field SPA call is not swallowed — ' + JSON.stringify(wire));

  // ── 7. payload repair fills undefined fields at the object level ──
  const p = { project_uid: 'P222', job_uid: undefined };
  h.armRepair('J606');
  h.repairUidFields(p, 0);
  ok(p.job_uid === 'J606', 'repairUidFields fills an undefined job_uid — ' + JSON.stringify(p));

  // confusion swap: our object shape fed the project slot the JOB uid
  const p2 = { project_uid: 'J606', job_uid: 'P222' };
  h.repairUidFields(p2, 0);
  ok(p2.project_uid === 'P222' && p2.job_uid === 'J606', 'repairUidFields undoes the project/job value swap — ' + JSON.stringify(p2));

  // ── 8. positional repair via repairArgs directly ──
  const args = ['get_job_streamlog', 'J606', undefined];
  h.repairArgs(args);
  ok(args[1] === 'P222' && args[2] === 'J606', 'repairArgs rebuilds the (project_uid, job_uid) positional pair — ' + JSON.stringify(args));

  // ── 9. fill vs swallow: fillable undefined fields are completed and
  //      sent; a payload that CANNOT be completed is swallowed before the
  //      wire (the half-empty RPC never reaches the server) ──
  wire.length = 0;
  h.armRepair('J606');
  socketManager.call('get_job_streamlog', { project_uid: 'P222', job_uid: undefined });
  ok(wire.length === 1 && wire[0][1].job_uid === 'J606',
    'fillable undefined field is completed and sent — ' + JSON.stringify(wire));
  ok(h.payloadIncomplete([{ job_uid: 'J606' }]) === false, 'payloadIncomplete passes a complete payload');
  ok(h.payloadIncomplete([{ project_uid: 'P222', job_uid: null }]) === true, 'payloadIncomplete flags empty uid fields');
  // unfillable: project context missing (capture outside a project page)
  const wire2 = [];
  const sm2 = { call: function (name, p) { wire2.push([name, p]); return Promise.resolve(null); } };
  const h2 = factory(jobs, null, { socketManager: sm2 });
  h2.ensureRpcPatch();
  h2.armRepair('J606');      // ctx.projectUid = null here
  sm2.call('get_job_streamlog', { project_uid: undefined, job_uid: 'J606' });
  ok(wire2.length === 0, 'UNCOMPLETABLE payload is SWALLOWED — never reaches the wire — ' + JSON.stringify(wire2));

  // ── 10. ws.send-level repair of a stringified confusion frame ──
  wireJson.length = 0;
  socketManager.ws.send(JSON.stringify({ rpc: 'get_job_streamlog', project_uid: 'J606' }));
  const frame = JSON.parse(wireJson[0]);
  ok(frame.project_uid === 'P222' && frame.job_uid === 'J606',
    'ws.send frame with job-uid-in-project-slot + missing job_uid is repaired — ' + wireJson[0]);

  // ── 11. script-wide regressions ──
  ok(/v3\.35/.test(src), 'v3.35 marker present in the shipped script');
  ok(src.indexOf('function synthCallArgs') === -1 && src.indexOf('function parseFnParams') === -1,
    'the v3.34 signature-synthesis functions are GONE (they parsed pinia wrappers and called loaders with zero arguments)');
  ok(/actions\[a\]\.fn\.call\(actions\[a\]\.store, shapes\[s\]\)/.test(src),
    'calibration calls actions with the winning-shape sweep again');
  ok(/ensureRpcPatch\(\);\s*\n\s*outer:/.test(src), 'ensureRpcPatch runs before the calibration sweep');
  ok(/winning\.action\.fn\.call\(winning\.action\.store, shapesFor\(noLog\[n1\]\)\[winning\.shapeIdx\]\)/.test(src),
    'paced rescue replays the winning shape');
  ok(/var arg = shapesFor\(uid2\)\[winning\.shapeIdx\];/.test(src), 'per-job retry replays the winning shape');
  ok(/armRepair\(calibUid\);/.test(src) && /armRepair\(uid2\);/.test(src) && /armRepair\(noLog\[n1\]\);/.test(src),
    'every loader call site is wrapped by armRepair');

  console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
  process.exit(fails ? 1 : 0);
}, 1300);
