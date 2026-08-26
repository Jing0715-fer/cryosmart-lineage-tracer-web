/**
 * Smart Capture Panel - Web UI Component
 * 
 * Provides instructions for capturing CryoSmart metadata via browser console.
 * The capture script runs inside CryoSmart to access Vue store.
 */

import { useState, useCallback, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Zap,
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
    // /api/cryosmart/import on this app, then opens /?imported=... in a new tab.
    if (typeof window !== "undefined" && window.location && window.location.origin) {
      setWebAppUrl(window.location.origin);
    }
  }, []);

  // Capture script that runs inside CryoSmart (via browser console)
  // This version captures complete job metadata AND session info for maps/images.
  // It also force-loads the LAZY jobLogs state (normally only fetched when a
  // job's detail view is opened) and extracts every log image fileid.
  const captureScript = `
(async function() {
  var APP = '${webAppUrl}';
  
  // Find CryoSmart Vue app
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
  
  // Get session info for map/image downloads
  var cryosmartOrigin = window.location.origin;
  var cryosmartAuth = null;
  var cryosmartCookie = null;
  
  // Try to get WebSocket token from socketManager
  if (socketStore.socketManager && socketStore.socketManager.token) {
    cryosmartAuth = 'Bearer ' + socketStore.socketManager.token;
  }
  
  // Capture the browser cookie for this CryoSmart origin. Many CryoSmart
  // deployments authenticate /api/log_image requests via the session cookie
  // (not the WS token), so without it the server-side proxy gets 401s.
  // document.cookie only exposes non-HttpOnly cookies — the session cookie
  // may be HttpOnly; in that case an empty string is sent and the proxy
  // relies on the auth token instead.
  try {
    cryosmartCookie = document.cookie || null;
  } catch (e) {
    cryosmartCookie = null;
  }
  
  // Find the project
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

  var jobLogs = socketStore.jobLogs || {};

  function getImageLogs(jobUid) {
    var logs = (jobLogs[projectId + '-' + jobUid] || []);
    return logs.filter(function(log) {
      return log.type === 'image' || (log.imgfiles && log.imgfiles.length > 0);
    }).map(function(log) {
      return {
        _id: log._id,
        text: log.text,
        imgfiles: log.imgfiles || [],
        index: log.index,
        created_at: log.created_at,
        flags: log.flags || []
      };
    });
  }

  var allUids = [];
  for (var exp of (project.experiments || [])) {
    for (var job of (exp.jobs || [])) { allUids.push(job.uid); }
  }
  console.log('Found', allUids.length, 'jobs, pre-loading logs...');
  if (socketStore.getLogsByJob) {
    for (var i = 0; i < allUids.length; i++) {
      try { socketStore.getLogsByJob(projectId, allUids[i]); } catch(e) {}
    }
  }
  await new Promise(function(r) { setTimeout(r, 4000); });
  jobLogs = socketStore.jobLogs || {};
  console.log('jobLogs keys after load:', Object.keys(jobLogs).length);

  // Extract all jobs from all experiments
  var jobs = [];
  for (var exp of (project.experiments || [])) {
    for (var job of (exp.jobs || [])) {
      jobs.push({
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
        image_logs: getImageLogs(job.uid)
      });
    }
  }
  
  if (jobs.length === 0) {
    alert('No jobs found in project ' + projectId); return;
  }
  
  console.log('Extracted', jobs.length, 'jobs with full metadata');
  console.log('CryoSmart session: origin=' + cryosmartOrigin
    + ', auth=' + (cryosmartAuth ? 'Bearer [token]' : 'none')
    + ', cookie=' + (cryosmartCookie && cryosmartCookie.length ? cryosmartCookie.length + ' chars captured' : 'none'));
  
  // ─── Log image collection ──────────────────────────────────────────
  // store.jobLogs is LAZY: the SPA only fetches a job's logs when you open
  // that job's detail view. To capture log images for EVERY job we:
  //   1. Harvest logs already present in store.jobLogs.
  //   2. Find the store action that loads logs (any store function whose
  //      name matches /log/i) and CALIBRATE its exact call shape on one
  //      job — trying uid / {job_uid} / {uid} / [uid] and watching
  //      store.jobLogs[uid] until it appears.
  //   3. Replay the winning call for every remaining job (time-boxed).
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
        var name = (file && file.name) || log.name || log.title || ('log_image_' + out.length);
        // Carry the log entry's text + flags so the web app can derive
        // friendlier names and categories (plots/fsc/slice) downstream.
        out.push({ fileid: fid, name: name, text: log.text || null, flags: log.flags || null });
      }
    }
    return out;
  }
  
  function findLogActions(store) {
    var found = [];
    var names = {};
    var obj = store;
    for (var depth = 0; depth < 4 && obj; depth++) {
      try {
        var own = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < own.length; i++) names[own[i]] = 1;
      } catch (e) {}
      try { obj = Object.getPrototypeOf(obj); } catch (e) { break; }
    }
    for (var name in names) {
      if (!/(log|detail)/i.test(name)) continue;
      try {
        if (typeof store[name] === 'function') found.push({ name: name, fn: store[name] });
      } catch (e) {}
    }
    // Prefer actions with "log" in the name over generic "detail" loaders.
    found.sort(function(a, b) {
      var la = /log/i.test(a.name) ? 0 : 1, lb = /log/i.test(b.name) ? 0 : 1;
      return la - lb;
    });
    return found;
  }
  
  function waitForLogs(store, uid, ms) {
    return new Promise(function(resolve) {
      var t0 = Date.now();
      (function check() {
        try {
          var logs = store.jobLogs && store.jobLogs[uid];
          if (logs && logs.length) return resolve(logs);
        } catch (e) {}
        if (Date.now() - t0 >= ms) return resolve(null);
        setTimeout(check, 120);
      })();
    });
  }
  
  function httpLogProbe(uid) {
    var paths = [
      '/api/job/get_job_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_logs?job_uid=' + encodeURIComponent(uid),
      '/api/job/get_job_log?job_uid=' + encodeURIComponent(uid),
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
            return Array.isArray(arr) && arr.length ? arr : null;
          })
          .catch(function() { return null; });
      });
    }, Promise.resolve(null));
  }
  
  async function collectLogImages(store, jobs) {
    var result = {};
    var hasState = false;
    try { hasState = 'jobLogs' in store; } catch (e) {}
    if (!hasState) {
      console.log('[CryoSmart] jobLogs state not found on this CryoSmart build — skipping log images.');
      return result;
    }
    
    // 1. Harvest logs already loaded (jobs whose detail view was opened).
    var pending = [];
    for (var i = 0; i < jobs.length; i++) {
      var uid = jobs[i].uid;
      var existing = store.jobLogs && store.jobLogs[uid];
      if (existing && existing.length) {
        var imgs = extractLogImages(existing);
        if (imgs.length) result[uid] = imgs;
      } else {
        pending.push(uid);
      }
    }
    console.log('[CryoSmart] Logs already loaded for ' + (jobs.length - pending.length) + ' job(s); ' + pending.length + ' to force-load.');
    if (pending.length === 0) return result;
    
    // 2. Calibrate the loader call on the first pending job.
    var actions = findLogActions(store);
    console.log('[CryoSmart] Log loader candidates:', actions.map(function(a) { return a.name; }).join(', ') || 'none');
    
    var calibUid = pending[0];
    var winning = null;   // { action, shapeIdx } or { http: true }
    var shapes = [calibUid, { job_uid: calibUid }, { uid: calibUid }, [calibUid]];
    
    outer:
    for (var a = 0; a < actions.length; a++) {
      for (var s = 0; s < shapes.length; s++) {
        try {
          var r = actions[a].fn.call(store, shapes[s]);
          if (r && typeof r.then === 'function') r.catch(function() {});
        } catch (e) {}
        var logs = await waitForLogs(store, calibUid, 800);
        if (logs) {
          winning = { action: actions[a], shapeIdx: s };
          var cImgs = extractLogImages(logs);
          if (cImgs.length) result[calibUid] = cImgs;
          break outer;
        }
      }
    }
    
    if (!winning) {
      var probe = await httpLogProbe(calibUid);
      if (probe) {
        winning = { http: true };
        var pImgs = extractLogImages(probe);
        if (pImgs.length) result[calibUid] = pImgs;
      }
    }
    
    if (!winning) {
      console.log('[CryoSmart] Could not trigger lazy log loading on this build — capturing without log images. ' +
        '(Tip: open one job detail view in CryoSmart, then re-run the script.)');
      return result;
    }
    console.log('[CryoSmart] Log loading works via ' + (winning.http ? 'HTTP endpoint' : 'store action "' + winning.action.name + '"') + ' — collecting...');
    
    // 3. Replay for every remaining job (time-boxed, progress logged).
    var t0 = Date.now(), BUDGET_MS = 60000;
    for (var j = 1; j < pending.length; j++) {
      var uid2 = pending[j];
      if (result[uid2]) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        console.log('[CryoSmart] Log collection time budget reached — stopping after ' + j + ' job(s).');
        break;
      }
      var logs2 = null;
      var cached = store.jobLogs && store.jobLogs[uid2];
      if (cached && cached.length) {
        logs2 = cached;
      } else if (winning.http) {
        logs2 = await httpLogProbe(uid2);
      } else {
        var arg = [uid2, { job_uid: uid2 }, { uid: uid2 }, [uid2]][winning.shapeIdx];
        try {
          var rr = winning.action.fn.call(store, arg);
          if (rr && typeof rr.then === 'function') rr.catch(function() {});
        } catch (e) {}
        logs2 = await waitForLogs(store, uid2, 1200);
        if (!logs2) logs2 = await httpLogProbe(uid2);   // per-job HTTP fallback
      }
      if (logs2) {
        var imgs2 = extractLogImages(logs2);
        if (imgs2.length) result[uid2] = imgs2;
      }
      if ((j + 1) % 10 === 0) console.log('[CryoSmart] Log loading progress: ' + (j + 1) + '/' + pending.length + ' job(s)...');
    }
    
    var withImages = Object.keys(result).length;
    console.log('[CryoSmart] Log images collected for ' + withImages + ' of ' + jobs.length + ' job(s)');
    return result;
  }
  
  // ─── Upload (async: log collection runs first) ─────────────────────
  (async function upload() {
    var logImages = {};
    try {
      logImages = await collectLogImages(socketStore, jobs);
    } catch (e) {
      console.warn('[CryoSmart] Log image collection failed (non-fatal):', e && e.message);
    }
    
    console.log('Uploading', jobs.length, 'jobs to', APP);
    fetch(APP + '/api/cryosmart/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_uid: projectId,
        experiment_uid: project.experiments[0]?.uid,
        jobs: jobs,
        job_log_images: logImages,
        source: 'CryoSmart SPA Vue Store',
        captured_at: new Date().toISOString(),
        cryosmart_origin: cryosmartOrigin,
        cryosmart_auth: cryosmartAuth,
        cryosmart_cookie: cryosmartCookie
      })
    }).then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok && res.token) {
          console.log('Success! Opening web app...');
          var nLogs = Object.keys(logImages).length;
          console.log('Captured ' + res.count + ' jobs' + (nLogs ? ' + log images for ' + nLogs + ' job(s)' : '') + '.');
          if (res.has_session) {
            console.log('Session available for map/image downloads (auth + cookie forwarded to server-side proxy).');
          }
          window.open(APP + '/?imported=' + res.token + '&pid=' + projectId, '_blank');
        } else {
          alert('Upload failed: ' + (res.error || 'Unknown error'));
        }
      }).catch(function(e) {
        alert('Upload failed: ' + e.message);
      });
  })();
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
        eval(captureScript);
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
            <p className="text-[13px] font-medium text-emerald-700">Done!</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              A new tab will open with your complete lineage data loaded
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
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] text-emerald-400" suppressHydrationWarning>
            <code suppressHydrationWarning>{captureScript}</code>
          </pre>
        </details>
      </div>
    );
  }