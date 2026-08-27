/**
 * Smart Capture Panel - Web UI Component
 *
 * Provides instructions for capturing CryoSmart metadata via browser console.
 * The capture script runs inside CryoSmart to access Vue store.
 *
 * Staged capture flow (v3):
 *   0. Open about:blank synchronously → popup can NEVER be blocked.
 *   1. POST /api/cryosmart/import/session        → token (tiny request)
 *      → navigate the already-open tab to /?imported=<token>
 *   2. POST .../jobs    → the web app renders the graph immediately
 *   3. POST .../logs    → log-image batches stream in with live progress
 *   4. POST .../complete → UI stops polling and refreshes with final data
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
// CryoSmart Smart Capture v3.1 — safe log-action calibration (auth/destructive store actions excluded)
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
      if (Array.isArray(job.image_logs) && job.image_logs.length) {
        entry.image_logs = job.image_logs;
      }
      jobs.push(entry);
    }
  }

  if (jobs.length === 0) {
    alert('No jobs found in project ' + projectId); return;
  }

  console.log('Extracted', jobs.length, 'jobs with full metadata');

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
        captured_at: new Date().toISOString()
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
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      if (!log) continue;
      var files = log.imgfiles || (log.type === 'image' ? log.files : null);
      if (!files || !files.length) continue;
      for (var f = 0; f < files.length; f++) {
        var file = files[f];
        var fid = typeof file === 'string' ? file : (file && (file.fileid || file.file_id || file.id));
        if (!fid) continue;
        var name = (file && (file.name || file.filename)) || log.name || log.title || ('log_image_' + out.length);
        out.push({ fileid: fid, name: name, text: log.text || null, flags: log.flags || null });
      }
    }
    return out;
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

  function httpLogProbe(uid) {
    var paths = [
      '/api/job/get_job_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_job_log?job_uid=' + encodeURIComponent(uid),
      '/api/job/logs?job_uid=' + encodeURIComponent(uid),
      '/api/logs?job_uid=' + encodeURIComponent(uid),
      '/api/log/get_logs?job_uid=' + encodeURIComponent(uid)
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
  function flushLogs(force) {
    if (!batch.length) return Promise.resolve();
    if (!force && batch.length < 5 && Date.now() - lastFlush < 2500) return Promise.resolve();
    var items = batch; batch = [];
    lastFlush = Date.now();
    return post('/logs', { items: items }).catch(function(e) {
      console.warn('[CryoSmart] Log batch upload failed (non-fatal):', e && e.message);
    });
  }

  // ── STEP 2: harvest cached logs + upload jobs ──────────────────────
  // Cached logs are embedded onto each job as raw 'image_logs' entries
  // (full fidelity: type/text/flags/imgfiles) before the jobs POST, so the
  // graph renders with log images immediately where available.
  var pending = [];
  for (var i2 = 0; i2 < jobs.length; i2++) {
    var jobEntry = jobs[i2];
    var uid = jobEntry.uid;
    var cached = readLogState(uid);
    if (cached && cached.length) {
      var rawLogs = [];
      for (var c = 0; c < cached.length; c++) {
        var ce = cached[c];
        if (ce && (ce.type === 'image' || (ce.imgfiles && ce.imgfiles.length))) rawLogs.push(ce);
      }
      if (rawLogs.length) jobEntry.image_logs = rawLogs;
      batch.push({ uid: uid, images: extractLogImages(cached) });
    } else if (jobEntry.image_logs && jobEntry.image_logs.length) {
      batch.push({ uid: uid, images: extractLogImages(jobEntry.image_logs) });
    } else {
      pending.push(uid);
    }
  }
  console.log('[CryoSmart] Logs already loaded for ' + (jobs.length - pending.length) + ' job(s); ' + pending.length + ' to scan.');

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
  await flushLogs(true);

  // ── STEP 3: scan remaining jobs for log images (streamed) ─────────
  async function scanLogs() {
    if (pending.length === 0) return;

    var actions = findLogActions();
    console.log('[CryoSmart] Log loader candidates:', actions.map(function(a) { return a.name; }).join(', ') || 'none');

    var calibUid = pending[0];
    var winning = null;   // {action, shapeIdx, mode:'state'|'return'} or {http:true}
    var shapes = [calibUid, { job_uid: calibUid }, { uid: calibUid }, [calibUid]];

    outer:
    for (var a = 0; a < actions.length; a++) {
      for (var s = 0; s < shapes.length; s++) {
        var ret = null;
        try {
          ret = actions[a].fn.call(actions[a].store, shapes[s]);
        } catch (e) {}
        // (a) the call RESOLVES to the logs directly (return value)
        if (ret && typeof ret.then === 'function') {
          var resolved = await withTimeout(ret.catch(function() {}), 1500);
          if (looksLikeLogs(resolved)) {
            winning = { action: actions[a], shapeIdx: s, mode: 'return' };
            batch.push({ uid: calibUid, images: extractLogImages(resolved) });
            break outer;
          }
        } else if (looksLikeLogs(ret)) {
          winning = { action: actions[a], shapeIdx: s, mode: 'return' };
          batch.push({ uid: calibUid, images: extractLogImages(ret) });
          break outer;
        }
        // (b) the call POPULATES a log-shaped state keyed by uid
        var logs = await waitForLogs(calibUid, 800);
        if (logs) {
          winning = { action: actions[a], shapeIdx: s, mode: 'state' };
          batch.push({ uid: calibUid, images: extractLogImages(logs) });
          break outer;
        }
      }
    }

    if (!winning) {
      var probe = await httpLogProbe(calibUid);
      if (probe) {
        winning = { http: true };
        batch.push({ uid: calibUid, images: extractLogImages(probe) });
      }
    }

    if (!winning) {
      console.log('[CryoSmart] Could not trigger lazy log loading on this build — finishing without per-job log images. ' +
        '(Tip: open one job detail view in CryoSmart, then re-run the script to harvest its cached logs.)');
      return;
    }
    await flushLogs(true);
    console.log('[CryoSmart] Log loading works via ' +
      (winning.http ? 'HTTP endpoint' : 'store action "' + winning.action.name + '" (' + winning.mode + ')') +
      ' — scanning ' + pending.length + ' job(s)...');

    // Replay for every remaining job (time-boxed, streamed to the UI).
    var t0 = Date.now(), BUDGET_MS = 120000;
    for (var j = 1; j < pending.length; j++) {
      var uid2 = pending[j];
      if (Date.now() - t0 > BUDGET_MS) {
        console.log('[CryoSmart] Log collection time budget reached — stopping after ' + j + ' job(s).');
        break;
      }
      var logs2 = readLogState(uid2);
      if (!logs2) {
        if (winning.http) {
          logs2 = await httpLogProbe(uid2);
        } else {
          var arg = [uid2, { job_uid: uid2 }, { uid: uid2 }, [uid2]][winning.shapeIdx];
          try {
            var rr = winning.action.fn.call(winning.action.store, arg);
            if (rr && typeof rr.then === 'function') {
              var rv = await withTimeout(rr.catch(function() {}), 1500);
              if (looksLikeLogs(rv)) logs2 = rv;
            }
          } catch (e) {}
          if (!logs2) logs2 = await waitForLogs(uid2, 1200);
          if (!logs2) logs2 = await httpLogProbe(uid2);   // per-job HTTP fallback
        }
      }
      batch.push({ uid: uid2, images: logs2 ? extractLogImages(logs2) : [] });
      await flushLogs(false);
      if ((j + 1) % 20 === 0) console.log('[CryoSmart] Log scan progress: ' + (j + 1) + '/' + pending.length + ' job(s)...');
    }
    await flushLogs(true);
  }

  try {
    await scanLogs();
  } catch (e) {
    console.warn('[CryoSmart] Log collection failed (non-fatal):', e && e.message);
  }

  // ── STEP 4: mark the session complete ──────────────────────────────
  // The web UI stops polling and refreshes with the final data snapshot.
  try { await post('/complete', {}); } catch (e) {}
  console.log('[CryoSmart] Capture complete. Live page:', appUrl);
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
                    <li>Open CryoSmart and navigate to your project</li>
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
            <p className="text-[13px] font-medium text-emerald-700">Live progress!</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              A new tab opens <strong>immediately</strong> and shows the capture
              progress in real time — the lineage graph renders as soon as job
              metadata lands, then log images stream in.
            </p>
            <p className="mt-0.5 text-[11px] text-teal-600">
              Maps, tile images and job log images are captured together, with session credentials (auth + cookie) forwarded for downloads.
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
