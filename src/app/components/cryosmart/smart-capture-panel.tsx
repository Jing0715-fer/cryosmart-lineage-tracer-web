/**
 * Smart Capture Panel - Web UI Component
 *
 * Provides instructions for capturing CryoSmart metadata via browser console.
 * The capture script runs inside CryoSmart to access Vue store.
 *
 * Staged capture flow (v3.6):
 *   0. Open about:blank synchronously → popup can NEVER be blocked.
 *   1. POST /api/cryosmart/import/session        → token (tiny request)
 *      → navigate the already-open tab to /?imported=<token>
 *   2. POST .../jobs    → the web app renders the graph immediately
 *      (the app AUTO-TRACES when the script ran on a job page —
 *       end_job_uid — and publishes the lineage via .../request-logs)
 *   3. POST .../logs    → log-image batches stream in with live progress
 *      (ONLY for the requested lineage jobs, and ONLY the LAST round of
 *       multi-round jobs — older rounds' files no longer exist)
 *   4. POST .../complete → UI stops polling and refreshes with final data
 *
 * v3.7: the wait window for Trace Lineage is 20 minutes and re-traces are
 * picked up for 3 minutes after each scan (late traces no longer miss the
 * fetch); the final console line reports refs + uploaded bytes honestly
 * and a zero-image capture prints a loud warning with the fix.
 *
 * v3.8: the web app applies streamed log images PROGRESSIVELY (every batch
 * of refs + bytes re-renders the graph and report live — no more waiting
 * for the final /complete snapshot), and /complete itself is retried so a
 * single failed POST can no longer leave the UI polling forever.
 */

import { useState, useCallback, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ExternalLink,
  Copy,
  Check,
  ChevronRight,
  Info
} from "lucide-react";

interface Props {
  onCapture: (data: { jobs: unknown[]; projectUid: string; experimentUid: string }) => void;
}

export function SmartCapturePanel({ onCapture }: Props) {
  const [copied, setCopied] = useState(false);
  // webAppUrl MUST be resolved client-side only (window.location.origin).
  // Computing it during render with `typeof window !== 'undefined'` produces
  // a server/client mismatch (server sees a fallback like http://localhost:3002,
  // client sees the real origin) which propagates into the capture script
  // string and triggers a React hydration error inside the <pre><code> block.
  // Using useState + useEffect defers the URL to after hydration, so the
  // server and the first client render agree on the placeholder.
  const [webAppUrl, setWebAppUrl] = useState<string>("");
  useEffect(() => {
    // Same-origin is the correct target: the capture script POSTs back to
    // /api/cryosmart/import/session* on this app, then opens /?imported=...
    // in a new tab that shows LIVE capture progress.
    // Deferred one tick so the setState is not synchronous inside the
    // effect body (react-compiler restriction); the server and the first
    // client render still agree on the placeholder, so no hydration
    // mismatch inside the <pre><code> block.
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      if (window.location && window.location.origin) {
        setWebAppUrl(window.location.origin);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Capture script v3 that runs inside CryoSmart (via browser console).
  // Staged upload: the progress page opens IMMEDIATELY (step 0 opens
  // about:blank synchronously — popup blockers only honour window.open()
  // during the user-gesture window, but NAVIGATING an already-open window
  // is never blocked). The page then polls the import session and shows
  // live progress while the script streams jobs + log images.
  const captureScript = `
// CryoSmart Smart Capture v3.8 — LAST-ROUND log images. Job metadata
// uploads for the WHOLE project immediately (fast), but log images are
// fetched ONLY for the jobs the traced lineage needs: the script waits for
// the web app's Trace Lineage action to publish the lineage job list to
// the session, then scans just those jobs (a 46-job project with 900+
// images typically needs only ~10 jobs). Multi-round jobs keep ONLY their
// latest round's log entries — re-runs re-emit the same titles and the
// older rounds' files are gone from the server, so fetching them only
// produced broken report images and wasted time. Run the script from the
// END JOB's page and the app auto-traces — zero manual setup. Console
// escape hatches while it waits: __csCaptureAll() (fetch every job's
// logs) and __csCaptureFinish() (stop now). Still uploads log-image BYTES
// same-origin (6 workers, 240s drain — v3.4) and keeps the deep-scan log
// calibration that finds logs in ANY store state shape (v3.2). v3.7:
// 20-minute wait window + 3-minute re-trace grace (late traces no longer
// miss the fetch), honest image-byte counters, and a loud zero-image
// diagnostic so an empty capture is obvious in the console. v3.8: the web
// app refreshes the graph + report LIVE as images stream in (no more
// "captured 320 but nothing shows" while the script waits to complete),
// and /complete is retried so one lost POST cannot strand the session.
(async function() {
  var APP = '${webAppUrl}';

  // ── Find CryoSmart Vue app ─────────────────────────────────────────
  var qApp = document.querySelector('#q-app');
  if (!qApp || !qApp.__vue_app__) {
    alert('CryoSmart Vue app not found. Are you on a CryoSmart page?'); return;
  }

  var pinia = qApp.__vue_app__.config.globalProperties.$pinia;
  if (!pinia || !pinia._s) { alert('Pinia store not found'); return; }

  var socketStore = pinia._s.get('socketStore');
  if (!socketStore || !socketStore.projectsInMap) {
    alert('CryoSmart data not loaded. Please wait for the page to fully load.'); return;
  }

  // ── Session info for map/image downloads ───────────────────────────
  var cryosmartOrigin = window.location.origin;
  var cryosmartAuth = null;
  var cryosmartCookie = null;

  if (socketStore.socketManager && socketStore.socketManager.token) {
    cryosmartAuth = 'Bearer ' + socketStore.socketManager.token;
  }
  try {
    cryosmartCookie = document.cookie || null;
  } catch (e) {
    cryosmartCookie = null;
  }

  // ── Find the project ───────────────────────────────────────────────
  var urlMatch = location.href.match(/\\/projects\\/([^/?#]+)/i);
  var projectId = urlMatch ? urlMatch[1] : null;
  var project = projectId ? socketStore.projectsInMap[projectId] : null;

  if (!project) {
    var keys = Object.keys(socketStore.projectsInMap);
    if (keys.length === 0) { alert('No projects found'); return; }
    project = socketStore.projectsInMap[keys[0]];
    projectId = project.uid;
  }

  console.log('Extracting data for project:', projectId);

  // ── Extract all jobs (synchronous, fast) ───────────────────────────
  var jobs = [];
  for (var exp of (project.experiments || [])) {
    for (var job of (exp.jobs || [])) {
      var entry = {
        uid: job.uid,
        job_type: job.job_type,
        status: job.status,
        project_uid: projectId,
        experiment_uid: exp.uid,
        workspace_uid: exp.uid,
        title: job.title || job.description || '',
        created_at: job.created_at,
        completed_at: job.completed_at,
        parents: job.parents || [],
        children: job.children || [],
        input_slot_groups: job.input_slot_groups || [],
        output_result_groups: job.output_result_groups || [],
        params_spec: job.params_spec || {},
        output_group_images: job.output_group_images || {},
        ui_tile_images: (job.ui_tile_images || []).map(function(t) {
          return { name: t.name, fileid: t.fileid, num_cols: t.num_cols, num_rows: t.num_rows };
        }),
      };
      // Some builds embed raw log entries directly on the job object.
      // (v3.6: trimmed to the LAST round per title — older rounds' files
      //  no longer exist on the server.)
      if (Array.isArray(job.image_logs) && job.image_logs.length) {
        entry.image_logs = lastRoundEntries(job.image_logs);
      }
      jobs.push(entry);
    }
  }

  if (jobs.length === 0) {
    alert('No jobs found in project ' + projectId); return;
  }

  console.log('Extracted', jobs.length, 'jobs with full metadata');

  // ── v3.5: detect the job whose page the user is on ────────────────
  // It becomes the session's end_job_uid: the web app auto-fills Start
  // Job with it AND auto-traces the moment jobs land, so running the
  // script from the END JOB's page needs zero manual setup.
  function detectCurrentJobUid() {
    // (a) URL: /job/<uid>, /jobs/<uid>, ?job=<uid>, #/jobs/<uid> …
    var m = location.href.match(/[?&/]jobs?[=/]([A-Za-z]?[0-9][A-Za-z0-9_-]{0,40})/i);
    if (m) return m[1];
    // (b) Vue Router current-route params
    try {
      var router = qApp.__vue_app__.config.globalProperties.$router;
      var route = router && router.currentRoute && router.currentRoute.value;
      var params = route && route.params;
      if (params && typeof params === 'object') {
        var keys = ['job_uid', 'jobUid', 'jobId', 'job_id', 'uid', 'id'];
        for (var i = 0; i < keys.length; i++) {
          var v = params[keys[i]];
          if (v && typeof v === 'string') return v;
        }
      }
    } catch (e) {}
    // (c) pinia state: current/selected/active job pointers (read-only)
    var hit = null;
    try {
      pinia._s.forEach(function(s) {
        if (hit || !s) return;
        var st = s.$state || s;
        var ks = Object.keys(st);
        for (var k = 0; k < ks.length; k++) {
          if (!/^(current|selected|active)[_]?job/i.test(ks[k])) continue;
          var val = st[ks[k]];
          if (typeof val === 'string' && val) { hit = val; return; }
          if (val && typeof val === 'object' && typeof val.uid === 'string' && val.uid) { hit = val.uid; return; }
        }
      });
    } catch (e) {}
    return hit;
  }
  var currentJobUid = detectCurrentJobUid();
  if (currentJobUid) {
    var knownJob = null;
    for (var cj = 0; cj < jobs.length; cj++) {
      if (String(jobs[cj].uid).replace(/^J/i, '') === String(currentJobUid).replace(/^J/i, '')) { knownJob = jobs[cj].uid; break; }
    }
    currentJobUid = knownJob;   // null when the uid is not one of THIS project's jobs
  }
  // v3.5 lineage mode: on big projects log images are fetched ONLY for
  // the jobs the traced lineage needs (wait for Trace Lineage). Small
  // projects capture everything — the wait isn't worth it.
  var LINEAGE_MODE = jobs.length > 15;
  console.log('[CryoSmart] Page job: ' + (currentJobUid || 'not detected') +
    ' · lineage-scoped log capture: ' + (LINEAGE_MODE ? 'ON (' + jobs.length + ' jobs)' : 'off (small project)'));

  // ── STEP 0: open the progress tab NOW ──────────────────────────────
  // Popup blockers only honour window.open() during the brief user-gesture
  // window after pressing Enter. We open about:blank synchronously here —
  // BEFORE any await — and navigate it to the app once the session token
  // exists. Navigating an already-open window is never blocked, so the
  // progress page opens no matter how long the capture takes.
  var win = window.open('about:blank', '_blank');
  if (win) {
    try {
      win.document.open();
      win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>CryoSmart Capture</title>' +
        '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;' +
        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
        '.box{width:260px;text-align:center}' +
        '.ring{width:36px;height:36px;border:3px solid #99f6e4;border-top-color:#0d9488;' +
        'border-radius:50%;margin:0 auto 14px;animation:spin .9s linear infinite}' +
        '@keyframes spin{to{transform:rotate(360deg)}}' +
        'p{font-size:13px;line-height:1.6;color:#475569;margin:0}</style></head><body>' +
        '<div class="box"><div class="ring"></div>' +
        '<p><b style="color:#0f172a">CryoSmart Capture</b><br>' +
        'Connected to capture script — creating session…</p></div></body></html>');
      win.document.close();
    } catch (e) { /* cross-origin guard; navigation below still works */ }
  } else {
    console.warn('[CryoSmart] Popup blocked. The live progress URL will be printed below — open it manually.');
  }

  // ── STEP 1: create the import session (tiny request → token) ──────
  var sess = null;
  try {
    var r0 = await fetch(APP + '/api/cryosmart/import/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_uid: projectId,
        cryosmart_origin: cryosmartOrigin,
        cryosmart_auth: cryosmartAuth,
        cryosmart_cookie: cryosmartCookie,
        source: 'CryoSmart SPA Vue Store (staged)',
        captured_at: new Date().toISOString(),
        end_job_uid: currentJobUid || undefined,
        lineage_mode: LINEAGE_MODE
      })
    });
    sess = await r0.json();
  } catch (e) {
    if (win) win.close();
    alert('Failed to create capture session: ' + (e && e.message)); return;
  }
  if (!sess || !sess.ok || !sess.token) {
    if (win) win.close();
    alert('Capture session error: ' + (sess && sess.error ? sess.error : 'unknown')); return;
  }

  var token = sess.token;
  var appUrl = APP + '/?imported=' + token + '&pid=' + projectId;
  console.log('[CryoSmart] Live progress page:', appUrl);
  if (win) {
    try { win.location.replace(appUrl); }
    catch (e) { try { win.location.href = appUrl; } catch (e2) {} }
  }

  function post(path, body) {
    return fetch(APP + '/api/cryosmart/import/session/' + token + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function(r) { return r.json(); });
  }

  // ── Log-image machinery (used by STEP 3) ───────────────────────────
  // jobLogs is LAZY: the SPA only fetches a job's logs when its detail view
  // is opened. To capture log images for EVERY job we:
  //   1. Harvest logs already present in ANY pinia store.
  //   2. Find the log-loading action (scanning ALL stores, matching /log|detail/i)
  //      and CALIBRATE its exact call shape on one job — trying uid /
  //      {job_uid} / {uid} / [uid], inspecting BOTH the call's return value
  //      AND any log-shaped state it populates.
  //   3. Replay the winning call for every remaining job (time-boxed),
  //      streaming results to the server in batches so the UI shows live
  //      progress.
  //   4. Fallback: probe common HTTP log endpoints.
  // Best-effort — a failure just means fewer log images, never a failed
  // capture.
  function extractLogImages(logs) {
    var out = [];
    if (!Array.isArray(logs)) return out;
    // v3.6 LAST-ROUND-ONLY: multi-round jobs (re-run in CryoSmart) re-emit
    // the SAME log entries — same text title ("Selected 21 classes", …) —
    // once per round, and only the FINAL round's image files still exist on
    // the server: older rounds' fileids 404. Keep only the LAST entry per
    // title so neither dead refs nor their bytes are ever fetched/uploaded
    // (this is also what keeps multi-round log capture FAST).
    var lastIdxByText = Object.create(null);
    var eligible = [];
    for (var i = 0; i < logs.length; i++) {
      var lg = logs[i];
      if (!lg) continue;
      var files = lg.imgfiles || (lg.type === 'image' ? lg.files : null);
      if (!files || !files.length) continue;
      eligible.push(i);
      var key = (typeof lg.text === 'string' && lg.text.trim()) ? lg.text.trim() : null;
      if (key !== null) lastIdxByText[key] = i;
    }
    for (var p = 0; p < eligible.length; p++) {
      var li = eligible[p];
      var log = logs[li];
      var key2 = (typeof log.text === 'string' && log.text.trim()) ? log.text.trim() : null;
      if (key2 !== null && lastIdxByText[key2] !== li) continue;   // older round — skip
      var files2 = log.imgfiles || (log.type === 'image' ? log.files : null);
      for (var f = 0; f < files2.length; f++) {
        var file = files2[f];
        var fid = typeof file === 'string' ? file : (file && (file.fileid || file.file_id || file.id));
        if (!fid) continue;
        var name = (file && (file.name || file.filename)) || log.name || log.title || ('log_image_' + out.length);
        out.push({ fileid: fid, name: name, text: log.text || null, flags: log.flags || null });
      }
    }
    return out;
  }

  // v3.6: LAST-ROUND-ONLY filter for RAW image-log entries (entry-level).
  // Same rationale as extractLogImages above, applied to the raw entries
  // embedded on jobs (STEP 2) — keep only the last entry per title.
  function lastRoundEntries(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    var lastByText = Object.create(null);
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i] && typeof arr[i].text === 'string' && arr[i].text.trim();
      if (t) lastByText[t] = i;
    }
    return arr.filter(function(entry, i) {
      var t = entry && typeof entry.text === 'string' && entry.text.trim();
      return !t || lastByText[t] === i;
    });
  }

  function allStores() {
    var list = [];
    try {
      pinia._s.forEach(function(s) { if (s) list.push(s); });
    } catch (e) {}
    if (!list.length && socketStore) list.push(socketStore);
    return list;
  }
  var stores = allStores();

  // Read a job's cached logs from any store's log state
  // (jobLogs / logs / job_logs keyed by job uid).
  function readLogState(uid) {
    var stateKeys = ['jobLogs', 'logs', 'job_logs'];
    for (var i = 0; i < stores.length; i++) {
      for (var k = 0; k < stateKeys.length; k++) {
        try {
          var m = stores[i][stateKeys[k]];
          if (m && m[uid] && m[uid].length) return m[uid];
        } catch (e) {}
      }
    }
    return null;
  }

  function looksLikeLogs(v) {
    return Array.isArray(v) && v.length > 0 && v.some(function(x) {
      return x && ((x.imgfiles && x.imgfiles.length) || x.type === 'image' || x.text || x.files);
    });
  }

  function findLogActions() {
    // SAFETY: the calibration step below actually CALLS these actions inside
    // the user's SPA, so the candidate list must be strictly read-only.
    // "login"/"logout" both CONTAIN "log" and once destroyed a real
    // CryoSmart session during calibration — hence the hard blocklists:
    //   AUTH_RE        — never touch anything auth/session related
    //   DESTRUCTIVE_RE — never call clear/reset/delete-style actions
    //                    (e.g. clearLogsByJob wipes cached logs)
    //   WRITE_PREFIX   — never call setters/creators/connectors
    var AUTH_RE = /(login|logout|signin|sign_out|signout|sign_in|signup|register|auth|token|password|session|permission|role)/i;
    var DESTRUCTIVE_RE = /(clear|reset|remove|delet|drop|purge|wipe|destroy|disconnect)/i;
    var WRITE_PREFIX_RE = /^(set|create|update|add|new|init|connect|close|send|post|put|append|push|save|write)/i;
    var READ_PREFIX_RE = /^(get|fetch|load|request|query|list|pull|read|show|open)/i;
    var found = [];
    for (var i = 0; i < stores.length; i++) {
      var store = stores[i];
      // Skip stores that look like an auth/user/session store entirely.
      var storeId = '';
      try { storeId = String(store.$id || ''); } catch (e) {}
      if (AUTH_RE.test(storeId)) continue;
      var names = {};
      var obj = store;
      for (var depth = 0; depth < 4 && obj; depth++) {
        try {
          var own = Object.getOwnPropertyNames(obj);
          for (var n = 0; n < own.length; n++) names[own[n]] = 1;
        } catch (e) {}
        try { obj = Object.getPrototypeOf(obj); } catch (e) { break; }
      }
      for (var name in names) {
        if (!/(log|detail)/i.test(name)) continue;   // must mention logs/details
        if (AUTH_RE.test(name)) continue;            // login/logout/… — NEVER call
        if (DESTRUCTIVE_RE.test(name)) continue;     // clearLogsByJob etc.
        if (WRITE_PREFIX_RE.test(name)) continue;    // setLogs/updateLogs etc.
        try {
          if (typeof store[name] === 'function') found.push({ store: store, name: name, fn: store[name] });
        } catch (e) {}
      }
    }
    // Prefer explicit log fetchers (getLogsByJob) over generic detail loaders.
    found.sort(function(a, b) {
      var la = /log/i.test(a.name) ? 0 : 1, lb = /log/i.test(b.name) ? 0 : 1;
      if (la !== lb) return la - lb;
      var ra = READ_PREFIX_RE.test(a.name) ? 0 : 1, rb = READ_PREFIX_RE.test(b.name) ? 0 : 1;
      return ra - rb;
    });
    return found;
  }

  function waitForLogs(uid, ms) {
    return new Promise(function(resolve) {
      var t0 = Date.now();
      (function check() {
        var logs = readLogState(uid);
        if (logs) return resolve(logs);
        if (Date.now() - t0 >= ms) return resolve(null);
        setTimeout(check, 120);
      })();
    });
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function(resolve) { setTimeout(function() { resolve(undefined); }, ms); })
    ]);
  }

  // ── v3.2 deep-scan helpers ───────────────────────────────────────
  // Some builds deliver logs over WebSocket into state shapes OTHER than
  // the classic jobLogs/logs/job_logs maps. The deep scan walks every pinia
  // store and collects EVERY array holding entries with non-empty
  // 'imgfiles' (the image-log signature), wherever it lives.
  function coerceLogs(v) {
    if (!v) return v;
    if (Array.isArray(v)) return v;
    if (Array.isArray(v.data)) return v.data;
    if (Array.isArray(v.logs)) return v.logs;
    if (Array.isArray(v.result)) return v.result;
    return v;
  }

  function scanForImageLogArrays(storeList) {
    var results = [];
    var seen = (typeof WeakSet === 'function') ? new WeakSet() : null;
    var budget = { n: 0 };
    function hasImgEntries(arr) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].imgfiles && arr[i].imgfiles.length) return true;
      }
      return false;
    }
    function walk(node, path, depth) {
      if (budget.n > 6000 || depth > 6 || node === null || node === undefined) return;
      if (typeof node !== 'object') return;
      if (seen) {
        if (seen.has(node)) return;
        try { seen.add(node); } catch (e) {}
      }
      budget.n++;
      if (Array.isArray(node)) {
        if (node.length > 0 && node.length <= 300 && hasImgEntries(node)) {
          results.push({ arr: node, path: path });
        }
        if (node.length <= 60) {
          for (var i = 0; i < node.length; i++) walk(node[i], path + '[' + i + ']', depth + 1);
        }
        return;
      }
      try {
        var keys = Object.keys(node);
        for (var k = 0; k < keys.length && k < 80; k++) {
          walk(node[keys[k]], path + '.' + keys[k], depth + 1);
        }
      } catch (e) {}
    }
    for (var si = 0; si < storeList.length; si++) {
      var st = storeList[si];
      var sid = 'store' + si;
      try { sid = String(st.$id || sid); } catch (e) {}
      var root = st;
      try { if (st.$state) root = st.$state; } catch (e) {}
      walk(root, sid, 0);
    }
    return results;
  }

  function snapshotLogs(storeList) {
    return scanForImageLogArrays(storeList).map(function(f) {
      return { arr: f.arr, path: f.path, len: f.arr.length };
    });
  }

  // Arrays that are new or have GROWN vs the baseline — catches both
  // replaced arrays and in-place pushes.
  function diffLogs(storeList, base) {
    var fresh = scanForImageLogArrays(storeList);
    var out = [];
    for (var i = 0; i < fresh.length; i++) {
      var hit = null;
      for (var b = 0; b < base.length; b++) {
        if (base[b].arr === fresh[i].arr) { hit = base[b]; break; }
      }
      if (!hit || fresh[i].arr.length > hit.len) out.push(fresh[i]);
    }
    return out;
  }

  // Prefer a fresh array whose state path contains the job uid as a segment
  // (e.g. "logStore.logs.J12") when attributing logs to a job.
  function pickByUid(fresh, uid) {
    for (var i = 0; i < fresh.length; i++) {
      var p = '.' + (fresh[i].path || '') + '.';
      if (p.indexOf('.' + uid + '.') !== -1) return fresh[i];
    }
    return fresh[0];
  }

  function storeSummary(storeList) {
    var lines = [];
    for (var i = 0; i < storeList.length; i++) {
      var st = storeList[i];
      var sid = 'store' + i;
      try { sid = String(st.$id || sid); } catch (e) {}
      var keys = [];
      try { keys = Object.keys(st.$state || st).slice(0, 30); } catch (e) {}
      lines.push(sid + ': [' + keys.join(', ') + ']');
    }
    return lines.join('\\n');
  }

  function httpLogProbe(uid) {
    var paths = [
      '/api/job/get_job_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_job_log?job_uid=' + encodeURIComponent(uid),
      '/api/job/logs?job_uid=' + encodeURIComponent(uid),
      '/api/logs?job_uid=' + encodeURIComponent(uid),
      '/api/log/get_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/' + encodeURIComponent(uid) + '/logs',
      '/api/logs?job=' + encodeURIComponent(uid)
    ];
    return paths.reduce(function(chain, p) {
      return chain.then(function(logs) {
        if (logs) return logs;
        return fetch(p, { credentials: 'include' })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(d) {
            if (!d) return null;
            var arr = d.data || d.logs || (Array.isArray(d) ? d : null);
            return looksLikeLogs(arr) ? arr : null;
          })
          .catch(function() { return null; });
      });
    }, Promise.resolve(null));
  }

  // Streaming batch upload — the web UI shows live progress from these.
  var batch = [];
  var lastFlush = Date.now();
  var logRefsStreamed = 0;   // v3.7: total refs streamed (zero-image diagnostic)
  function flushLogs(force) {
    if (!batch.length) return Promise.resolve();
    if (!force && batch.length < 5 && Date.now() - lastFlush < 2500) return Promise.resolve();
    var items = batch; batch = [];
    lastFlush = Date.now();
    queueImageUploads(items);
    for (var q3 = 0; q3 < items.length; q3++) {
      logRefsStreamed += ((items[q3] && items[q3].images) || []).length;
    }
    return post('/logs', { items: items }).catch(function(e) {
      console.warn('[CryoSmart] Log batch upload failed (non-fatal):', e && e.message);
    });
  }

  // ── Image-BYTE upload (v3.3; v3.4 raises workers + budget) ───
  // The web app is typically opened over HTTPS; direct
  // http://<cryosmart>/api/log_image/<fileid> <img> loads are then
  // mixed-content blocked, and the app's server cannot reach this
  // intranet either. THIS tab is same-origin with CryoSmart, so we fetch
  // each image's bytes here and upload them to the session — the app then
  // serves them same-origin and they render everywhere (graph job detail,
  // HTML report, downloads).
  var IMG_MAX_BYTES = 4 * 1024 * 1024;      // skip images larger than ~4MB
  var IMG_WORKERS = 6;                        // concurrent byte fetchers (v3.4)
  var imgQueue = [];                          // pending refs
  var imgBatch = [];                          // fetched, awaiting POST
  var imgWorkers = 0;
  var imgPosted = 0;                          // in-flight POSTs
  var imgUploaded = 0, imgFailed = 0;
  var imgDone = false;

  function fetchImageData(ref) {
    if (!ref || !ref.fileid) return Promise.resolve(null);
    return fetch('/api/log_image/' + encodeURIComponent(ref.fileid), { credentials: 'include' })
      .then(function(r) { return r.ok ? r.blob() : null; })
      .then(function(b) {
        if (!b || b.size === 0 || b.size > IMG_MAX_BYTES) return null;
        if (b.type && b.type !== '' && b.type.indexOf('image/') !== 0) return null;
        return new Promise(function(res) {
          var fr = new FileReader();
          fr.onload = function() { res(String(fr.result) || null); };
          fr.onerror = function() { res(null); };
          fr.readAsDataURL(b);
        });
      })
      .catch(function() { return null; });
  }

  function flushImageBatch() {
    if (!imgBatch.length) return;
    var items = imgBatch; imgBatch = [];
    imgPosted++;
    post('/images', { items: items })
      .then(function(r) {
        // v3.7: count what the server actually STORED — a stored count of 0
        // used to fall through to items.length and report rejected uploads
        // as "ok", hiding byte-loss from the console summary.
        if (r && r.ok) {
          var storedCount = (typeof r.stored === 'number') ? r.stored : items.length;
          imgUploaded += storedCount;
          if (storedCount < items.length) {
            imgFailed += items.length - storedCount;
            console.warn('[CryoSmart] Image store accepted ' + storedCount + ' of ' + items.length +
              ' image(s) in a batch (size cap or invalid data URL).');
          }
        }
        else imgFailed += items.length;
      })
      .catch(function() { imgFailed += items.length; })
      .then(function() { imgPosted--; });
  }

  function imgWorker() {
    var ref = imgQueue.shift();
    if (!ref) { imgWorkers--; return; }
    fetchImageData(ref).then(function(data) {
      if (data) {
        imgBatch.push({ fileid: ref.fileid, data: data, name: ref.name || null });
        if (imgBatch.length >= 6) flushImageBatch();
      } else {
        imgFailed++;
      }
      imgWorker();
    });
  }

  function queueImageUploads(items) {
    for (var i = 0; i < items.length; i++) {
      var imgs = items[i] && items[i].images;
      if (!imgs) continue;
      for (var k = 0; k < imgs.length; k++) imgQueue.push(imgs[k]);
    }
    while (imgWorkers < IMG_WORKERS && imgQueue.length) { imgWorkers++; imgWorker(); }
  }

  // Wait (bounded) for every queued image to be fetched + posted.
  function drainImageUploads(budgetMs) {
    imgDone = true;
    var deadline = Date.now() + (budgetMs || 90000);
    return new Promise(function(resolve) {
      (function check() {
        flushImageBatch();
        if ((imgQueue.length === 0 && imgWorkers === 0 && imgPosted === 0) || Date.now() > deadline) {
          console.log('[CryoSmart] Image bytes uploaded: ' + imgUploaded + ' ok, ' + imgFailed + ' failed/skipped.');
          resolve();
          return;
        }
        setTimeout(check, 250);
      })();
    });
  }

  // ── STEP 2: embed cached logs + upload job metadata (fast) ────────
  // Cached log entries ride along INSIDE the jobs payload as raw
  // 'image_logs' entries (full fidelity: type/text/flags/imgfiles, refs
  // only — no bytes). v3.5 DEFERS their refs + byte uploads to the
  // lineage-scoped scan in STEP 3, so jobs outside the traced lineage
  // never cost fetch time. The graph renders instantly either way.
  var pending = jobs.map(function(j) { return j.uid; });
  for (var i2 = 0; i2 < jobs.length; i2++) {
    var jobEntry = jobs[i2];
    var cached = readLogState(jobEntry.uid);
    if (cached && cached.length) {
      var rawLogs = [];
      for (var c = 0; c < cached.length; c++) {
        var ce = cached[c];
        if (ce && (ce.type === 'image' || (ce.imgfiles && ce.imgfiles.length))) rawLogs.push(ce);
      }
      // v3.6: keep only the LAST round per title (older rounds 404).
      if (rawLogs.length) jobEntry.image_logs = lastRoundEntries(rawLogs);
    }
  }

  var up = null;
  try {
    up = await post('/jobs', {
      project_uid: projectId,
      experiment_uid: project.experiments && project.experiments[0] ? project.experiments[0].uid : undefined,
      jobs: jobs
    });
  } catch (e) {}

  if (!up || !up.ok) {
    // Fallback: legacy one-shot import so the user still gets the data.
    console.warn('[CryoSmart] Staged upload failed — falling back to legacy one-shot import.');
    try {
      var r1 = await fetch(APP + '/api/cryosmart/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_uid: projectId,
          experiment_uid: project.experiments && project.experiments[0] ? project.experiments[0].uid : undefined,
          jobs: jobs,
          job_log_images: {},
          source: 'CryoSmart SPA Vue Store',
          captured_at: new Date().toISOString(),
          cryosmart_origin: cryosmartOrigin,
          cryosmart_auth: cryosmartAuth,
          cryosmart_cookie: cryosmartCookie
        })
      });
      var res1 = await r1.json();
      if (res1.ok) console.log('[CryoSmart] Legacy import done:', res1.count, 'jobs');
      else alert('Upload failed: ' + (res1.error || 'unknown'));
    } catch (e) {
      alert('Upload failed: ' + (e && e.message));
    }
    return;
  }
  console.log('[CryoSmart] Uploaded ' + up.count + ' jobs — the graph should be rendering in the new tab now.');

  // ── STEP 3 (v3.5): wait for Trace Lineage, then scan ONLY those jobs ─
  // The expensive part of a capture is log-image fetching (real projects
  // carry 900+ images across 40+ jobs, most OUTSIDE the lineage the user
  // actually traces). v3.5 uploads job metadata for everyone but waits for
  // the web app's Trace Lineage action to publish the lineage job list to
  // the session, then fetches log images for just those jobs.
  //   Script run on the END JOB's page → the app auto-traces and this
  //   resolves within seconds. Script run on a project page → pick a
  //   Start Job in the app tab and click Trace Lineage.
  var ALL_UIDS = pending.slice();
  var knownRequested = null;
  var FINISH_NOW = false;
  var CAPTURE_ALL_LATE = false;
  window.__csCaptureAll = function() {
    CAPTURE_ALL_LATE = true;
    knownRequested = ALL_UIDS.slice();
    console.log('[CryoSmart] __csCaptureAll — fetching log images for EVERY job.');
  };
  window.__csCaptureFinish = function() {
    FINISH_NOW = true;
    console.log('[CryoSmart] __csCaptureFinish — completing without further log fetching.');
  };

  function fetchStatus(hb) {
    return fetch(APP + '/api/cryosmart/import/session/' + token + (hb ? '?hb=1' : ''), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }
  function sleepMs(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  if (LINEAGE_MODE) {
    var WAIT_MS = 20 * 60 * 1000;   // v3.7: 20 min — a slow first trace should not forfeit the log fetch
    var waitStart = Date.now();
    var misses = 0;
    console.log('[CryoSmart] Waiting for Trace Lineage — log images are fetched only for the traced lineage.');
    console.log('[CryoSmart]   escape hatches: __csCaptureAll() = every job · __csCaptureFinish() = stop now');
    while (!knownRequested && !FINISH_NOW) {
      if (Date.now() - waitStart > WAIT_MS) {
        console.log('[CryoSmart] No Trace Lineage within 20 min — completing without log images.');
        break;
      }
      var st = await fetchStatus(true);   // ?hb=1 heartbeat: tells the app this script is alive
      if (!st) {
        misses++;
        if (misses >= 5) { console.warn('[CryoSmart] Cannot reach the web app — completing.'); break; }
      } else {
        misses = 0;
        if (st.status === 'complete') break;
        if (st.log_request && st.log_request.jobs && st.log_request.jobs.length) {
          knownRequested = st.log_request.jobs.slice();
        }
      }
      await sleepMs(3000);
    }
    if (knownRequested) {
      if (CAPTURE_ALL_LATE) {
        pending = ALL_UIDS.slice();
        console.log('[CryoSmart] Fetching log images for ALL ' + pending.length + ' job(s) (__csCaptureAll).');
      } else {
        var uidSet = {};
        for (var q2 = 0; q2 < jobs.length; q2++) uidSet[jobs[q2].uid] = true;
        pending = knownRequested.filter(function(u) { return uidSet[u]; });
        console.log('[CryoSmart] Trace Lineage requested ' + pending.length + ' job(s) — fetching ONLY their log images (of ' + ALL_UIDS.length + ' total).');
      }
    } else {
      pending = [];   // timed out / __csCaptureFinish / app unreachable
    }
  }

  // Loader calibration result + already-streamed bookkeeping, shared
  // across scan passes (initial request + the re-trace grace window below).
  var winning = null;   // {action, shapeIdx, mode:'state'|'return'|'diff'} or {http:true}
  var scanned = {};

  async function scanLogs() {
    if (pending.length === 0) return;

    // In-memory logs (cached jobLogs state or embedded image_logs) cost
    // nothing to harvest; the loader CALIBRATION must only run on truly
    // lazy jobs — a pre-cached job would make whatever action was tried
    // first look like the working loader.
    function cachedLogsFor(uid) {
      var c = readLogState(uid);
      if (c && c.length) return c;
      for (var ii = 0; ii < jobs.length; ii++) {
        if (jobs[ii].uid === uid && Array.isArray(jobs[ii].image_logs) && jobs[ii].image_logs.length) {
          return jobs[ii].image_logs;
        }
      }
      return null;
    }
    function shapesFor(uid) {
      var row = null;
      for (var i = 0; i < jobs.length; i++) if (jobs[i].uid === uid) { row = jobs[i]; break; }
      var sh = [uid, { job_uid: uid }, { uid: uid }, [uid]];
      if (row) sh.push(row);
      sh.push({ uid: uid, project_uid: projectId });
      return sh;
    }
    var lazy = pending.filter(function(u) { return !scanned[u] && !cachedLogsFor(u); });
    console.log('[CryoSmart] Logs already in memory for ' + (pending.length - lazy.length) + ' job(s); ' + lazy.length + ' to load via the log API.');

    var socketMsgs = [];
    var unsniff = null;
    if (lazy.length > 0 && !winning) {
    var actions = findLogActions();
    console.log('[CryoSmart] Log loader candidates:', actions.map(function(a) { return a.name; }).join(', ') || 'none');

    // v3.2: sniff WebSocket message types while scanning — on some builds
    // the logs arrive via WS (e.g. insert_events); this shows what actually
    // flows when the loader is called.
    try {
      var sm = socketStore && socketStore.socketManager;
      var wsx = sm && sm.ws;
      if (wsx && typeof wsx.addEventListener === 'function') {
        var onWs = function(ev) {
          try {
            var d = ev.data;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
            var t = (d && (d.type || d.event || d.cmd || d.msg_type)) || String(d).slice(0, 40);
            socketMsgs.push(String(t));
            if (socketMsgs.length > 300) socketMsgs.shift();
          } catch (e) {}
        };
        wsx.addEventListener('message', onWs);
        unsniff = function() { try { wsx.removeEventListener('message', onWs); } catch (e) {} };
      }
    } catch (e) {}

    // v3.2 diagnostics: print the loader source — if auto-calibration still
    // fails, paste the console output back to the maintainer for an exact fix.
    for (var d2 = 0; d2 < actions.length && d2 < 2; d2++) {
      try {
        console.log('[CryoSmart] Loader "' + actions[d2].name + '" source (diagnostics):\\n' + String(actions[d2].fn).slice(0, 900));
      } catch (e) {}
    }

    // v3.2: calibrate on up to 3 LAZY jobs, image-rich job types FIRST.
    // The old script calibrated on J1 (import movies), which often has no
    // image logs at all — making a perfectly working loader look broken.
    var typeByUid = {};
    for (var t2 = 0; t2 < jobs.length; t2++) typeByUid[jobs[t2].uid] = jobs[t2].job_type || '';
    var RICH_RE = /refine|class|3d|2d|reconstruct|sharpen|nu|motion|ctf|mask|build/i;
    var calibPool = lazy.slice().sort(function(x, y) {
      return (RICH_RE.test(typeByUid[y] || '') ? 1 : 0) - (RICH_RE.test(typeByUid[x] || '') ? 1 : 0);
    });
    var calibTries = Math.min(3, calibPool.length);
    if (calibTries > 0) {
      console.log('[CryoSmart] Calibrating on job(s): ' + calibPool.slice(0, calibTries).join(', ') + ' (image-rich types first)');
    }

    outer:
    for (var ci = 0; ci < calibTries && !winning; ci++) {
      var calibUid = calibPool[ci];
      var shapes = shapesFor(calibUid);
      for (var a = 0; a < actions.length; a++) {
        for (var s = 0; s < shapes.length; s++) {
          var base = snapshotLogs(stores);
          var ret = null;
          try {
            ret = actions[a].fn.call(actions[a].store, shapes[s]);
          } catch (e) {}
          // (a) the call RESOLVES to the logs directly (return value)
          if (ret && typeof ret.then === 'function') {
            var resolved = coerceLogs(await withTimeout(ret.catch(function() {}), 1500));
            if (looksLikeLogs(resolved)) {
              winning = { action: actions[a], shapeIdx: s, mode: 'return' };
              batch.push({ uid: calibUid, images: extractLogImages(resolved) });
              scanned[calibUid] = true;
              break outer;
            }
          } else if (looksLikeLogs(coerceLogs(ret))) {
            winning = { action: actions[a], shapeIdx: s, mode: 'return' };
            batch.push({ uid: calibUid, images: extractLogImages(coerceLogs(ret)) });
            scanned[calibUid] = true;
            break outer;
          }
          // (b) v3.2 deep-scan: logs landed in ANY store state shape (this
          //     build may deliver logs over WebSocket), plus the classic
          //     jobLogs/logs/job_logs keyed maps.
          var deadline = Date.now() + 1400;
          while (Date.now() < deadline) {
            var fresh = diffLogs(stores, base);
            if (fresh.length) {
              var pick = pickByUid(fresh, calibUid);
              winning = { action: actions[a], shapeIdx: s, mode: 'diff' };
              batch.push({ uid: calibUid, images: extractLogImages(pick.arr) });
              scanned[calibUid] = true;
              console.log('[CryoSmart] Logs landed in state at "' + pick.path + '" — deep-scan mode.');
              break outer;
            }
            var logs = readLogState(calibUid);
            if (logs) {
              winning = { action: actions[a], shapeIdx: s, mode: 'state' };
              batch.push({ uid: calibUid, images: extractLogImages(logs) });
              scanned[calibUid] = true;
              break outer;
            }
            await new Promise(function(r) { setTimeout(r, 140); });
          }
        }
      }
    }

    if (!winning) {
      // HTTP fallback against every calibration candidate.
      for (var pi = 0; pi < calibTries && !winning; pi++) {
        var probe = await httpLogProbe(calibPool[pi]);
        if (probe) {
          winning = { http: true };
          batch.push({ uid: calibPool[pi], images: extractLogImages(probe) });
          scanned[calibPool[pi]] = true;
        }
      }
    }

    }   // end: loader calibration (runs only when lazy jobs exist)

    if (!winning && lazy.length > 0) {
      console.log('[CryoSmart] Could not trigger lazy log loading on this build — harvesting in-memory logs only. ' +
        '(Tip: open one job detail view in CryoSmart, then re-run the script to harvest its cached logs.)');
      console.log('[CryoSmart] ── Diagnostics (paste this whole block back to the maintainer) ──');
      try { console.log('pinia stores:\\n' + storeSummary(stores)); } catch (e) {}
      console.log('socket messages during scan (' + socketMsgs.length + '): ' + socketMsgs.slice(-60).join(', '));
    }
    await flushLogs(true);
    if (winning) {
      console.log('[CryoSmart] Log loading works via ' +
        (winning.http ? 'HTTP endpoint' : 'store action "' + winning.action.name + '" (' + winning.mode + ')') +
        ' — scanning ' + pending.length + ' job(s)...');
    } else {
      console.log('[CryoSmart] Harvesting in-memory logs for ' + pending.length + ' job(s)...');
    }

    // Scan every pending job (time-boxed, streamed to the UI). Unified
    // retrieval: in-memory logs first (free), then the calibrated loader
    // (return value → ALL store state → per-job HTTP probe). Jobs with no
    // readable logs still stream an EMPTY batch so the progress count stays
    // exact — and the lineage-scoped total equals the request size.
    var t0 = Date.now(), BUDGET_MS = 180000;
    for (var j = 0; j < pending.length; j++) {
      var uid2 = pending[j];
      if (scanned[uid2]) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        console.log('[CryoSmart] Log collection time budget reached — stopping after ' + j + '/' + pending.length + ' job(s).');
        break;
      }
      var logs2 = cachedLogsFor(uid2);
      if (!logs2 && winning) {
        if (winning.http) {
          logs2 = await httpLogProbe(uid2);
        } else {
          var arg = shapesFor(uid2)[winning.shapeIdx];
          var base2 = snapshotLogs(stores);
          try {
            var rr = winning.action.fn.call(winning.action.store, arg);
            if (rr && typeof rr.then === 'function') {
              var rv = coerceLogs(await withTimeout(rr.catch(function() {}), 1500));
              if (looksLikeLogs(rv)) logs2 = rv;
            } else if (looksLikeLogs(coerceLogs(rr))) {
              logs2 = coerceLogs(rr);
            }
          } catch (e) {}
          if (!logs2) {
            var deadline2 = Date.now() + 1300;
            while (Date.now() < deadline2) {
              var fresh2 = diffLogs(stores, base2);
              if (fresh2.length) { logs2 = pickByUid(fresh2, uid2).arr; break; }
              var st2 = readLogState(uid2);
              if (st2) { logs2 = st2; break; }
              await new Promise(function(r) { setTimeout(r, 140); });
            }
          }
          if (!logs2) logs2 = await httpLogProbe(uid2);   // per-job HTTP fallback
        }
      }
      scanned[uid2] = true;
      batch.push({ uid: uid2, images: logs2 ? extractLogImages(logs2) : [] });
      await flushLogs(false);
      if ((j + 1) % 20 === 0) console.log('[CryoSmart] Log scan progress: ' + (j + 1) + '/' + pending.length + ' job(s)...');
    }
    await flushLogs(true);
    if (unsniff) unsniff();
    if (socketMsgs.length) console.log('[CryoSmart] Socket messages during scan: ' + socketMsgs.slice(-60).join(', '));
  }

  try {
    await scanLogs();
  } catch (e) {
    console.warn('[CryoSmart] Log collection failed (non-fatal):', e && e.message);
  }

  // ── STEP 3.6 (v3.5): grace window for re-traces ────────────────────
  // A re-trace (different end job) unions its lineage into the session
  // request — pick those jobs up for a short window before completing.
  // __csCaptureAll() works here too (fetches every unscanned job).
  // v3.8: the web app already shows every scanned image (it refreshes the
  // graph + report LIVE as batches stream in) — this wait only decides
  // whether MORE jobs get scanned, so it is safe to let it run.
  if (LINEAGE_MODE && knownRequested && !FINISH_NOW) {
    if ((logRefsStreamed || 0) > 0) {
      console.log('[CryoSmart] All lineage log images streamed — they are already visible in the web app tab (the graph and report refresh live as bytes arrive).' +
        ' Waiting up to 3 more minutes for a possible re-trace before completing…');
    }
    var graceEnd = Date.now() + 180000;   // v3.7: 45s → 3 min — re-traces while reviewing land reliably
    var served = knownRequested.slice();
    while (Date.now() < graceEnd && !FINISH_NOW) {
      await sleepMs(3000);
      if (FINISH_NOW) break;
      if (CAPTURE_ALL_LATE) {
        var rest = ALL_UIDS.filter(function(u) { return !scanned[u]; });
        if (rest.length) {
          pending = rest;
          console.log('[CryoSmart] Fetching log images for the remaining ' + rest.length + ' job(s) (__csCaptureAll).');
          try { await scanLogs(); } catch (e) {}
        }
        break;
      }
      var stg = await fetchStatus(true);
      var reqg = (stg && stg.log_request && stg.log_request.jobs) || [];
      var extra = [];
      var servedSet = {};
      for (var s1 = 0; s1 < served.length; s1++) servedSet[served[s1]] = 1;
      for (var s2 = 0; s2 < reqg.length; s2++) if (!servedSet[reqg[s2]]) extra.push(reqg[s2]);
      if (extra.length) {
        served = reqg.slice();
        pending = extra;
        console.log('[CryoSmart] Re-trace detected — fetching ' + extra.length + ' more job(s).');
        try { await scanLogs(); } catch (e) {}
        graceEnd = Date.now() + 180000;
      }
    }
  }

  // ── STEP 3.5: wait for the image-byte uploads to land ──────────────
  // Refs are already streamed; the BYTES upload concurrently with the scan.
  // v3.4 gives them a 240s window — a real capture can carry 900+ images
  // and v3.3's 90s budget regularly expired mid-queue, leaving most bytes
  // unsent (report images then rendered broken because only refs existed).
  await drainImageUploads(240000);

  // ── STEP 4: mark the session complete ──────────────────────────────
  // The web UI stops polling and shows the final summary. v3.8 retries:
  // a single lost POST (network blip, tab backgrounded) used to leave the
  // UI polling forever with the images already safely stored.
  for (var ci = 0; ci < 3; ci++) {
    try { await post('/complete', {}); break; }
    catch (e) {
      if (ci === 2) console.warn('[CryoSmart] /complete failed after 3 tries:', e && e.message);
      else await sleepMs(2000);
    }
  }

  // v3.7: loud zero-image diagnostic — an empty capture (or empty bytes)
  // should be OBVIOUS in the console, not discovered later in the report.
  if (LINEAGE_MODE && !knownRequested) {
    console.warn('[CryoSmart] ⚠ No Trace Lineage ran during the wait window — ZERO log images were fetched.' +
      '\\n   The web app tab stayed open in "waiting for Trace Lineage" without a trace.' +
      '\\n   Fix: re-run this script, then pick a Start Job and click Trace Lineage in the app' +
      '\\n   (or run it from the FINAL job\\'s page so it auto-traces).');
  } else if (imgUploaded === 0 && (logRefsStreamed || 0) > 0) {
    console.warn('[CryoSmart] ⚠ ' + logRefsStreamed + ' log-image refs were captured but ZERO image bytes uploaded —' +
      '\\n   previews will be missing. The CryoSmart /api/log_image/ endpoint rejected every fetch' +
      '\\n   (expired session or removed files). Re-login to CryoSmart and re-run the script.');
  }
  console.log('[CryoSmart] Capture complete' +
    (LINEAGE_MODE && knownRequested && !CAPTURE_ALL_LATE
      ? ' — lineage-scoped: ' + knownRequested.length + ' of ' + ALL_UIDS.length + ' jobs scanned'
      : '') +
    ' · ' + (logRefsStreamed || 0) + ' log image(s) · ' + imgUploaded + ' with bytes' +
    " · multi-round jobs keep only their latest round's log images" +
    '. Live page:', appUrl);
})();
`.trim();

  const handleCopyScript = useCallback(() => {
    navigator.clipboard.writeText(captureScript);
    setCopied(true);
    toast.success('Script copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  }, [captureScript]);

  const handleOpenCryoSmart = useCallback(() => {
    window.open('http://192.168.202.11:8080', '_blank');
  }, []);

  const handleCapture = useCallback(() => {
    if (window.confirm('This will extract all job data from CryoSmart.\n\nMake sure CryoSmart is fully loaded, then click OK to continue.')) {
      try {
        // new Function (rather than eval) keeps the capture script out of the
        // enclosing scope and avoids the react-compiler eval restriction.
        new Function(captureScript)();
      } catch (e) {
        toast.error('Failed to run capture script: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }, [captureScript]);
  return (<div className="space-y-4">
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-700">
            1
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-medium">Open CryoSmart</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Navigate to CryoSmart in a new tab and log in
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-[11px]"
              onClick={handleOpenCryoSmart}
            >
              <ExternalLink className="mr-1.5 h-3 w-3" />
              Open CryoSmart
            </Button>
          </div>
        </div>

        <ChevronRight className="ml-[11px] h-4 w-4 text-slate-300" />

        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-700">
            2
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-medium">Capture Full Metadata</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              When on CryoSmart page, run the capture script to extract data
            </p>

            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div className="text-[11px] text-amber-800">
                  <strong>How to use:</strong>
                  <ol className="mt-1 ml-2 list-decimal space-y-0.5">
                    <li>Open CryoSmart and navigate to your project — best: the FINAL job's page (the tracer auto-anchors to it)</li>
                    <li>Wait for the page to fully load (jobs visible)</li>
                    <li>Press <kbd className="rounded bg-white px-1 font-mono text-[10px]">F12</kbd> to open Developer Tools</li>
                    <li>Click the <strong>Console</strong> tab</li>
                    <li>Copy the script below and paste it into the console</li>
                    <li>Press <kbd className="rounded bg-white px-1 font-mono text-[10px]">Enter</kbd> to run</li>
                  </ol>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-[11px]"
              onClick={handleCopyScript}
              disabled={copied || !webAppUrl}
            >
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3 w-3" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy Capture Script
                </>
              )}
            </Button>
          </div>
        </div>

        <ChevronRight className="ml-[11px] h-4 w-4 text-slate-300" />

        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
            3
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-medium text-emerald-700">Fully automatic</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              A new tab opens <strong>immediately</strong> and shows live
              progress. The lineage graph renders as soon as job metadata
              lands, auto-traces from your page job, and log images stream in
              <strong> only for the traced lineage</strong> — the other jobs
              are skipped, and multi-round jobs fetch only their
              <strong>latest round's</strong> images, saving minutes on
              large projects.
            </p>
            <p className="mt-0.5 text-[11px] text-teal-600">
              Maps, tile images and job log images are captured with session credentials (auth + cookie) forwarded for downloads.
            </p>
          </div>
        </div>

        <Separator className="my-3" />

        <details className="group">
          <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
            Show capture script
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] text-emerald-400" suppressHydrationWarning>
            <code suppressHydrationWarning>{captureScript}</code>
          </pre>
        </details>
      </div>
    );
  }
