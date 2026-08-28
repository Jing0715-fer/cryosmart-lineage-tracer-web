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
 *
 * v3.9: re-running the script in the same CryoSmart tab no longer loses
 * log images — the store's loader CACHE-HITS on jobs a previous run
 * already loaded (no new state, no diff), so v3.8 streamed "N/N jobs
 * scanned · 0 images". The deep-scan now attributes ALREADY-CACHED log
 * arrays to their jobs (state-path segment match, then entry job_uid),
 * harvesting them without a single extra API call.
 *
 * v3.10: per-job log attribution + PDF guard. The real build delivers job
 * logs over a SHARED WebSocket event stream (insert_events) whose entries
 * carry their own job_uid. v3.8/v3.9 attributed whatever array the diff saw
 * first to whichever job was being scanned, so every job "owned" the same
 * images (the 320-image capture = ~16 refs x 20 jobs), and once the stream
 * grew past the 300-entry scan cap the LAST-scanned jobs (hetero_refine /
 * homo_abinit / nu_refine — end of the pipeline, end of the scan order)
 * got nothing. Attribution now demands EVIDENCE (path uid, single-uid
 * content, entry job_uid slicing, or appearance/growth during THIS loader
 * call), the scan cap is 2000, and result-PDF files inside imgfiles are
 * skipped (browsers cannot render PDFs in <img> — they were the
 * "duplicate title that never loads" in the report).
 *
 * v3.11: LAST-ITERATION + strict image whitelist. (1) Long refinement jobs
 * emit the same plots EVERY iteration ("Iteration 000" … "Iteration 027"),
 * and the per-title round filter cannot see that (every "Iteration NNN" is
 * a distinct title; per-iteration file names differ too) — nu_refine
 * captured 112 images and multi-round jobs showed their FIRST (000)
 * iteration's plots. Iteration numbers are now parsed from titles AND file
 * names, and only the HIGHEST iteration's refs are kept. (2) Result files
 * of ANY non-image kind (XML / TXT / CSV / JSON / maps …) are filtered by
 * a strict image whitelist, not just PDFs. (3) hetero_refine / homo_abinit
 * rescue: entries whose images live in `files` instead of `imgfiles` are
 * collected too, log maps keyed by the FULL uid ("BJ.P259.J45") are
 * readable, and huge-payload jobs whose logs land AFTER their scan window
 * get a bounded slow-delivery re-poll before the session completes.
 *
 * v3.12: CONTENT-TYPE-INDEPENDENT byte upload. The real CryoSmart server
 * serves /api/log_image/ responses with NO Content-Type — a typeless blob
 * read through FileReader becomes data:application/octet-stream, which the
 * app server's image/*-only check rejected, so a capture could stream 128
 * refs and store ZERO bytes ("graph和report中都没有加载出来图片"). The
 * script now sniffs the real image type from the BYTES (magic signatures,
 * with the ref's own filetype/extension as fallback) and builds the data
 * URL itself; the app server likewise sniffs+accepts any-mime data URLs
 * (this also rescues STALE v3.10/v3.11 script copies still open in the
 * user's CryoSmart tab). Map previews (output_group_images) and card tiles
 * (ui_tile_images) ride the SAME byte pipeline — over the HTTPS preview
 * their direct intranet URLs are mixed-content-blocked, so without stored
 * bytes the report's map section showed nothing.
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

/**
 * Copy text to the clipboard with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined in secure contexts (https,
 * http://localhost, http://127.0.0.1). When the web app is reached over a
 * LAN IP (e.g. http://192.168.x.x:3000), `navigator.clipboard` is undefined
 * and `writeText` throws. Fall back to a hidden textarea + execCommand,
 * which still works in every desktop browser even without a secure context.
 * Returns true on success.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
// CryoSmart Smart Capture v3.12 — LAST-ITERATION, LAST-ROUND, PER-JOB log
// images. Job metadata uploads for the WHOLE project immediately (fast),
// but log images are fetched ONLY for the jobs the traced lineage needs:
// the script waits for the web app's Trace Lineage action to publish the
// lineage job list to the session, then scans just those jobs (a 46-job
// project with 900+ images typically needs only ~10 jobs). Multi-round
// jobs keep ONLY their latest round's log entries (re-runs re-emit the
// same titles and the older rounds' files are gone from the server) AND
// only their FINAL iteration's images (titles/file names carry iteration
// numbers — "Iteration 000" is the FIRST, previously what you got; only
// non-image result files that <img> can never render are dropped: PDF /
// XML / TXT / CSV / maps). Run the script from the END JOB's page and the
// app auto-traces — zero manual setup. Console escape hatches while it
// waits: __csCaptureAll() (fetch every job's logs) and __csCaptureFinish()
// (stop now). Still uploads log-image BYTES same-origin (6 workers, 240s
// drain — v3.4) and keeps the deep-scan log calibration that finds logs
// in ANY store state shape (v3.2). v3.7: 20-minute wait window + 3-minute
// re-trace grace, honest image-byte counters, loud zero-image diagnostics.
// v3.8: the web app refreshes the graph + report LIVE as images stream
// in, and /complete is retried so one lost POST cannot strand the session.
// v3.9: logs already cached in ANY store state shape are attributed to
// their jobs by the deep scan — re-running in the same tab no longer
// yields "0 images captured". v3.10: logs arriving through a SHARED
// event stream are attributed by EVIDENCE (state-path uid, single-uid
// content, entry job_uid slicing, or appearance/growth during THIS loader
// call) — never by "first array the diff saw" — so each job owns ONLY its
// own images. v3.11: iteration-number parsing keeps only the final
// iteration of long refine runs (nu_refine 112 images -> its last
// iteration's set), a strict image whitelist drops every non-image result
// file, and hetero_refine / homo_abinit are rescued three ways: files[]
// entries are collected (not just imgfiles), full-uid log map keys
// ("BJ.P259.J45") are readable, and slow huge-payload deliveries get a
// bounded re-poll before the session completes. v3.12: image bytes are
// uploaded regardless of the server's Content-Type (the real server sends
// NONE — a typeless blob read via FileReader used to produce
// data:application/octet-stream, which the app rejected, storing 0 of 128
// images); the type is sniffed from the bytes' magic signatures, and map
// previews + card tiles ride the same pipeline.
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
  //
  // ── v3.10 helpers: per-job attribution + PDF guard ────────────────
  // The real build delivers job logs over a SHARED WebSocket event
  // stream (insert_events): entries from many jobs accumulate in ONE
  // array. v3.8/v3.9 attributed whatever array the diff saw FIRST to
  // whichever job was being scanned — every job then "owned" the same
  // images (the 320-image capture: ~16 refs x 20 jobs), and once the
  // stream passed the 300-entry scan cap the LAST-scanned jobs
  // (hetero_refine / homo_abinit / nu_refine — end of the pipeline, end
  // of the scan order) got NOTHING. Attribution now demands EVIDENCE.

  // ── v3.11: file-kind whitelist + iteration parsing ────────────────

  // Extension of a file name (lowercased, no dot) or "" when absent.
  // NOTE: every regex backslash inside this template literal must be
  // DOUBLE-escaped (\\. in the source → \. in the script) — a single
  // \. becomes a bare dot and /^image\//i degenerates into a division.
  function fileExtOf(s) {
    var m = String(s || '').match(/\\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  // The image extensions a browser can actually render inside <img>.
  var IMG_EXT_RE = /^(png|jpe?g|gif|svg|bmp|webp|tiff?|ico|avif)$/;

  // True for result files that are NOT renderable images. CryoSmart log
  // entries carry the job's full result manifest next to the PNG
  // previews: PDFs, XML/TXT/CSV data dumps, sometimes even maps. None of
  // those render in an <img>, so each one became a broken "duplicate
  // title" box in the report (v3.10 only knew about PDFs — XML and TXT
  // kept leaking through). A file is KEPT only when its evidence says
  // image: filetype image/*, or a known image extension. NO evidence at
  // all (numeric fileid, title-like name) → keep — that is the classic
  // ref shape that has always worked.
  function isNonImageFile(file) {
    if (!file) return false;
    var isObj = typeof file === 'object';
    var ft = isObj ? (file.filetype || file.file_type || file.type) : null;
    if (typeof ft === 'string' && ft) {
      if (/^image\\//i.test(ft)) return false;                      // image/png …
      if (/xml|pdf|json|csv|text|plain|txt|html|markdown|javascript|yaml|zip|gzip|tar/i.test(ft)) return true;
      // Unknown mime (incl. application/octet-stream) — let the name decide.
    }
    var fn = isObj ? (file.filename || file.name || '') : String(file);
    var ext = fileExtOf(fn);
    if (!ext) return false;                                        // no evidence → keep
    return !IMG_EXT_RE.test(ext);
  }

  // Iteration / round number buried in a title or file name:
  // "Iteration 000", "iter 12", "iter_003.png", "round 2", "cycle 5".
  // EXPLICIT markers only — trailing digits without a marker
  // ("class_004.png") index classes, not iterations, and must never be
  // treated as rounds (that would delete hetero/abinit class galleries).
  function iterNumOf(s) {
    if (typeof s !== 'string' || !s) return null;
    var m = s.match(/(?:^|[^a-z0-9])(?:iter(?:ation)?|round|cycle)[\\s_:.\\-]*([0-9]{1,4})/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // Iteration evidence of one imgfiles entry: the entry title first,
  // then the file's own names.
  function fileIterOf(file) {
    if (!file) return null;
    var s = (typeof file === 'object' && (file.filename || file.name)) ||
            (typeof file === 'string' ? file : '');
    return iterNumOf(s);
  }

  // The job a log entry belongs to (job_uid / jobUid / job_id / jobId).
  function entryJobUid(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var u = entry.job_uid || entry.jobUid || entry.job_id || entry.jobId;
    return (typeof u === 'string' && u) ? u : null;
  }

  // "J12" === "J12"; full-id forms like "BJ.P259.J12" also match "J12".
  function uidEquals(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return ('.' + a + '.').indexOf('.' + b + '.') !== -1 ||
           ('.' + b + '.').indexOf('.' + a + '.') !== -1;
  }

  // Slice one job's entries out of a (possibly shared) log array.
  // keepUidless: keep entries carrying no job uid (the array was already
  // attributed by path/appearance evidence). Strict mode (shared streams)
  // keeps ONLY entries naming this job.
  function filterByUid(logs, uid, keepUidless) {
    if (!Array.isArray(logs) || !uid) return logs;
    var out = [];
    var changed = false;
    for (var i = 0; i < logs.length; i++) {
      var eu = entryJobUid(logs[i]);
      var keep = eu === null ? !!keepUidless : uidEquals(eu, uid);
      if (keep) out.push(logs[i]);
      else changed = true;
    }
    return changed ? out : logs;
  }

  // Round key for the LAST-ROUND-ONLY filter: the entry's title, or (for
  // title-less entries) the joined FILE NAMES it emits — re-runs re-emit
  // the same file names with new fileids, so identical sets are rounds of
  // the same log; different names (class 1 vs class 2 galleries) stay
  // distinct keys.
  function roundKeyOf(log) {
    if (!log) return null;
    if (typeof log.text === 'string' && log.text.trim()) return log.text.trim();
    var files = log.imgfiles || log.files;   // v3.11: files[] entries too
    if (files && files.length) {
      var names = [];
      for (var f = 0; f < files.length; f++) {
        var file = files[f];
        var n = (file && (file.filename || file.name)) || (typeof file === 'string' ? file : '');
        names.push(String(n || ''));
      }
      var joined = names.join('|');
      if (joined.replace(/\\|/g, '')) return '\\u0001files:' + joined;
    }
    return null;
  }

  function extractLogImages(logs, uid) {
    var out = [];
    if (!Array.isArray(logs)) return out;
    // v3.10: logs captured through a SHARED event stream can carry entries
    // from several jobs — keep only this job's entries (uid-less entries
    // stay: the caller already attributed the array by evidence).
    if (uid) logs = filterByUid(logs, uid, true);

    // PASS 1 — candidates: entries with at least one renderable IMAGE file
    // (v3.11 whitelist). Some job types (hetero_refine / homo_abinit on
    // this build) deliver their images under "files" instead of
    // "imgfiles", so both are read. Non-image files never produce a ref —
    // and never cost a byte fetch.
    var cand = [];
    var maxIter = null;
    for (var i = 0; i < logs.length; i++) {
      var lg = logs[i];
      if (!lg) continue;
      var files = lg.imgfiles || lg.files || null;
      if (!files || !files.length) continue;
      var keep = [];
      for (var f = 0; f < files.length; f++) {
        var file = files[f];
        var fid = typeof file === 'string' ? file : (file && (file.fileid || file.file_id || file.id));
        if (!fid) continue;
        if (isNonImageFile(file)) continue;   // PDF / XML / TXT / CSV / …
        keep.push(file);
      }
      if (keep.length) {
        cand.push({ log: lg, files: keep });
        var ei = iterNumOf(lg.text);
        for (var f2 = 0; f2 < keep.length; f2++) {
          var fi = ei !== null ? ei : fileIterOf(keep[f2]);
          if (fi !== null && (maxIter === null || fi > maxIter)) maxIter = fi;
        }
      }
    }

    // PASS 2 — LAST-ITERATION filter (v3.11). Long refinement jobs emit
    // the same plots EVERY iteration ("Iteration 000" … "Iteration 027"):
    // each "Iteration NNN" is a distinct title and per-iteration file
    // names differ, so the per-title round filter in PASS 3 could not see
    // them — nu_refine shipped 112 images and the FIRST (000) iteration
    // was what survived on newest-first streams. Keep only refs from the
    // HIGHEST iteration seen in this job's logs; refs with no iteration
    // evidence (class galleries, final results) always stay.
    var refList = [];
    for (var p = 0; p < cand.length; p++) {
      var c = cand[p];
      var ei2 = iterNumOf(c.log.text);
      for (var f3 = 0; f3 < c.files.length; f3++) {
        var file2 = c.files[f3];
        var it = ei2 !== null ? ei2 : fileIterOf(file2);
        if (maxIter !== null && it !== null && it < maxIter) continue;
        refList.push({ ci: p, log: c.log, file: file2 });
      }
    }

    // PASS 3 — LAST-ROUND-per-title filter (v3.6): multi-round jobs
    // (re-run in CryoSmart) re-emit the SAME titles once per round and
    // only the FINAL round's files still exist on the server — older
    // rounds' fileids 404, so neither dead refs nor their bytes are ever
    // fetched/uploaded. Runs AFTER the iteration filter so a re-run
    // multi-iteration job collapses to its final round's final iteration.
    // Keyed per ENTRY (ci), never per ref: an entry's whole file set
    // shares one round, and a per-ref key would keep only the entry's
    // LAST file.
    var lastCandByKey = Object.create(null);
    for (var r = 0; r < refList.length; r++) {
      var key = roundKeyOf(refList[r].log);
      if (key !== null) lastCandByKey[key] = refList[r].ci;
    }
    for (var q = 0; q < refList.length; q++) {
      var key2 = roundKeyOf(refList[q].log);
      if (key2 !== null && lastCandByKey[key2] !== refList[q].ci) continue;   // older round — skip
      var log = refList[q].log;
      var file3 = refList[q].file;
      var fid2 = typeof file3 === 'string' ? file3 : (file3 && (file3.fileid || file3.file_id || file3.id));
      var name = (file3 && (file3.name || file3.filename)) || log.name || log.title || ('log_image_' + out.length);
      out.push({
        fileid: fid2, name: name, text: log.text || null, flags: log.flags || null,
        filetype: (file3 && (file3.filetype || file3.type)) || null,
        filename: (file3 && (file3.filename || file3.name)) || null
      });
    }
    return out;
  }

  // v3.6: LAST-ROUND-ONLY filter for RAW image-log entries (entry-level).
  // Same rationale as extractLogImages above, applied to the raw entries
  // embedded on jobs (STEP 2) — keep only the last entry per title.
  // v3.11: earlier-ITERATION entries are dropped first (same rule as
  // extractLogImages PASS 2 — the title or the imgfiles file names carry
  // the iteration number).
  function entryIterOf(entry) {
    if (!entry) return null;
    var it = iterNumOf(typeof entry.text === 'string' ? entry.text : '');
    if (it === null && Array.isArray(entry.imgfiles)) {
      for (var ef = 0; ef < entry.imgfiles.length; ef++) {
        var fit = fileIterOf(entry.imgfiles[ef]);
        if (fit !== null && (it === null || fit > it)) it = fit;
      }
    }
    return it;
  }
  function lastRoundEntries(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    var maxIt = null;
    for (var i = 0; i < arr.length; i++) {
      var it = entryIterOf(arr[i]);
      if (it !== null && (maxIt === null || it > maxIt)) maxIt = it;
    }
    var pool = arr;
    if (maxIt !== null) {
      pool = arr.filter(function(entry) {
        var et = entryIterOf(entry);
        return et === null || et === maxIt;
      });
    }
    var lastByText = Object.create(null);
    for (var j = 0; j < pool.length; j++) {
      var t = pool[j] && typeof pool[j].text === 'string' && pool[j].text.trim();
      if (t) lastByText[t] = j;
    }
    return pool.filter(function(entry, k) {
      var t = entry && typeof entry.text === 'string' && entry.text.trim();
      return !t || lastByText[t] === k;
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
  // (jobLogs / logs / job_logs / logsByJob keyed by job uid).
  // v3.11: some builds key these maps by the FULL uid ("BJ.P259.J45")
  // while the scan works with "J45" — an exact-key lookup missed them
  // every time, so those jobs (hetero_refine / homo_abinit on this build)
  // looked log-less. A suffix match rescues them.
  function readLogState(uid) {
    var stateKeys = ['jobLogs', 'logs', 'job_logs', 'logsByJob'];
    for (var i = 0; i < stores.length; i++) {
      for (var k = 0; k < stateKeys.length; k++) {
        try {
          var m = stores[i][stateKeys[k]];
          if (!m || typeof m !== 'object') continue;
          if (m[uid] && m[uid].length) return m[uid];
          for (var key in m) {
            if (!Object.prototype.hasOwnProperty.call(m, key)) continue;
            if (typeof key !== 'string' || key === uid || key.length <= uid.length) continue;
            if (key.slice(-(uid.length + 1)) !== '.' + uid) continue;
            if (Array.isArray(m[key]) && m[key].length) return m[key];
          }
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
        var e = arr[i];
        if (!e) continue;
        if (e.imgfiles && e.imgfiles.length) return true;
        // v3.11: some job types (hetero_refine / homo_abinit) deliver
        // their image entries with "files" instead of "imgfiles".
        if (Array.isArray(e.files) && e.files.length &&
            (e.type === 'image' || typeof e.text === 'string' || e.flags)) return true;
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
        // v3.10: cap 300 → 2000. A shared insert_events stream grows past
        // 300 entries once ~20 jobs are loaded — the old cap made it
        // INVISIBLE to the deep scan, so the last-scanned jobs (hetero /
        // abinit / nu-refine at the end of the pipeline) got no log images.
        if (node.length > 0 && node.length <= 2000 && hasImgEntries(node)) {
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
  // replaced arrays and in-place pushes. v3.10 records WHERE growth began
  // (from = baseline length; 0 for brand-new arrays) so attribution can
  // slice just the appended tail when nothing else identifies the owner.
  function diffLogs(storeList, base) {
    var fresh = scanForImageLogArrays(storeList);
    var out = [];
    for (var i = 0; i < fresh.length; i++) {
      var hit = null;
      for (var b = 0; b < base.length; b++) {
        if (base[b].arr === fresh[i].arr) { hit = base[b]; break; }
      }
      if (!hit) out.push({ arr: fresh[i].arr, path: fresh[i].path, from: 0, isNew: true });
      else if (fresh[i].arr.length > hit.len) out.push({ arr: fresh[i].arr, path: fresh[i].path, from: hit.len, isNew: false });
    }
    return out;
  }

  // v3.10: EVIDENCE-BASED attribution. An array counts as THIS job's logs
  // only with proof — (1) the state path names the job, (2) every
  // uid-carrying entry in it names this job, (3) it is a shared stream
  // whose entries name jobs (slice this job's entries out), or (4) it
  // appeared/grew as a result of THIS loader call (new array → whole;
  // grown → the appended tail). The v3.8 fresh[0] fallback smeared one
  // shared array over every scanned job — the "all jobs show the same
  // log images" bug.
  function pickByUid(fresh, uid) {
    var i, e, arr, one, mixed, eu;
    // (1) state-path segment names the job ("…logsByJob.J12")
    for (i = 0; i < fresh.length; i++) {
      var p = '.' + (fresh[i].path || '') + '.';
      if (p.indexOf('.' + uid + '.') !== -1) return { arr: fresh[i].arr, path: fresh[i].path };
    }
    // (2) single-uid array whose entries all name this job
    for (i = 0; i < fresh.length; i++) {
      arr = fresh[i].arr; one = null; mixed = false;
      for (e = 0; e < arr.length; e++) {
        eu = entryJobUid(arr[e]);
        if (eu === null) continue;
        if (one === null) one = eu;
        else if (one !== eu) { mixed = true; break; }
      }
      if (one !== null && !mixed && uidEquals(one, uid)) return { arr: arr, path: fresh[i].path };
    }
    // (3) shared stream: entries name their jobs — slice this job's out
    for (i = 0; i < fresh.length; i++) {
      arr = fresh[i].arr;
      var names = false;
      for (e = 0; e < arr.length; e++) {
        if (entryJobUid(arr[e]) !== null) { names = true; break; }
      }
      if (!names) continue;
      var mine = filterByUid(arr, uid, false);
      if (mine.length) return { arr: mine, path: fresh[i].path + '[' + uid + ']' };
    }
    // (4) call evidence: arrays that appeared or grew during THIS loader
    // call. New array → the whole array; grown → only the appended tail.
    var best = null;
    for (i = 0; i < fresh.length; i++) {
      var cand = fresh[i].isNew ? fresh[i].arr : fresh[i].arr.slice(fresh[i].from);
      if (!cand.length) continue;
      var imgs = 0;
      for (e = 0; e < cand.length; e++) {
        var c = cand[e];
        if (c && ((c.imgfiles && c.imgfiles.length) ||
                  (Array.isArray(c.files) && c.files.length))) imgs++;
      }
      if (imgs > 0 && (!best || imgs > best.imgs)) best = { arr: cand, path: fresh[i].path, imgs: imgs };
    }
    return best;
  }

  // v3.9: attribute ALREADY-CACHED logs to a job, wherever they live.
  // Re-running this script in the same CryoSmart tab finds every array the
  // previous run loaded — but the store's loader then CACHE-HITS (returns
  // nothing, state unchanged), the diff-based calibration sees "no new
  // logs", and v3.8 shipped "N/N jobs scanned · 0 images". Match by state
  // path segment first ("logStore.logsByJob.J12"), then by the entries'
  // own job_uid field — single-uid arrays only, so a shared event stream
  // is never misattributed to every job.
  function deepLogsFor(uid) {
    var all = scanForImageLogArrays(stores);
    var i, e, en, eu;
    for (i = 0; i < all.length; i++) {
      var p = '.' + (all[i].path || '') + '.';
      if (p.indexOf('.' + uid + '.') !== -1) return all[i].arr;
    }
    for (i = 0; i < all.length; i++) {
      var arr = all[i].arr, one = null, mixed = false;
      for (e = 0; e < arr.length; e++) {
        en = arr[e];
        if (!en || typeof en !== 'object') continue;
        eu = en.job_uid || en.jobUid || en.uid;
        if (eu === undefined || eu === null || eu === '') continue;
        if (one === null) one = String(eu);
        else if (one !== String(eu)) { mixed = true; break; }
      }
      if (one !== null && !mixed && one === uid) return arr;
    }
    // v3.10: shared event stream — slice this job's entries out (strict:
    // uid-less entries cannot be attributed from cache). This is what
    // rescues a re-run when the previous run loaded every job into ONE
    // insert_events array.
    for (i = 0; i < all.length; i++) {
      var sarr = all[i].arr, namesAny = false;
      for (e = 0; e < sarr.length; e++) {
        if (entryJobUid(sarr[e]) !== null) { namesAny = true; break; }
      }
      if (!namesAny) continue;
      var mine = filterByUid(sarr, uid, false);
      if (mine.length) return mine;
    }
    return null;
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
  var refsByUid = {};         // v3.11: refs streamed per job (zero-ref diagnostics)
  function flushLogs(force) {
    if (!batch.length) return Promise.resolve();
    if (!force && batch.length < 5 && Date.now() - lastFlush < 2500) return Promise.resolve();
    var items = batch; batch = [];
    lastFlush = Date.now();
    queueImageUploads(items);
    for (var q3 = 0; q3 < items.length; q3++) {
      var n3 = ((items[q3] && items[q3].images) || []).length;
      logRefsStreamed += n3;
      var u3 = items[q3] && items[q3].uid;
      if (u3) refsByUid[u3] = (refsByUid[u3] || 0) + n3;
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

  // v3.12: resolve the real image type from the BYTES, never from the
  // server's Content-Type. The real CryoSmart deployment serves
  // /api/log_image/ responses with NO type at all — a typeless blob read
  // through FileReader yields data:application/octet-stream, which the app
  // server (v3.11 and older) rejected. A capture could stream 128 image
  // refs and store ZERO bytes, so the graph and report showed no images.
  function sniffImageMime(b) {
    if (!b || b.length < 4) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) ||
        (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00)) return 'image/tiff';
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01) return 'image/x-icon';
    // SVG is text: skip whitespace/BOM, then look for an xml/svg open tag.
    for (var si = 0; si < Math.min(32, b.length); si++) {
      var sc = b[si];
      if (sc === 0x3C) {
        var sHead = '';
        for (var sk = si; sk < Math.min(si + 12, b.length); sk++) sHead += String.fromCharCode(b[sk]);
        var sLo = sHead.toLowerCase();
        if (sLo.indexOf('<svg') === 0 || sLo.indexOf('<?xml') === 0) return 'image/svg+xml';
        break;
      }
      if (sc !== 0x20 && sc !== 0x09 && sc !== 0x0A && sc !== 0x0D && sc !== 0xEF && sc !== 0xBB && sc !== 0xBF) break;
    }
    return null;
  }

  // v3.12: the ref itself usually knows the type (filetype / filename
  // extension) — the last-resort hint when neither bytes nor server tell us.
  function refMimeHint(ref) {
    if (!ref) return null;
    var ft = typeof ref.filetype === 'string' ? ref.filetype.toLowerCase() : '';
    if (ft.indexOf('image/') === 0) return ft;
    var ftShort = ft === 'jpg' ? 'jpeg' : (ft === 'tif' ? 'tiff' : (ft === 'svg' ? 'svg+xml' : ft));
    if (ftShort === 'png' || ftShort === 'jpeg' || ftShort === 'gif' || ftShort === 'bmp' ||
        ftShort === 'webp' || ftShort === 'tiff' || ftShort === 'ico' || ftShort === 'avif' || ftShort === 'svg+xml') {
      return 'image/' + ftShort;
    }
    var nm = String(ref.filename || ref.name || '').toLowerCase();
    var dot = nm.lastIndexOf('.');
    if (dot >= 0 && dot < nm.length - 1) {
      var ext = nm.slice(dot + 1);
      var extM = ext === 'jpg' ? 'jpeg' : (ext === 'tif' ? 'tiff' : (ext === 'svg' ? 'svg+xml' : ext));
      if (extM === 'png' || extM === 'jpeg' || extM === 'gif' || extM === 'bmp' ||
          extM === 'webp' || extM === 'tiff' || extM === 'ico' || extM === 'avif' || extM === 'svg+xml') {
        return 'image/' + extM;
      }
    }
    return null;
  }

  function fetchImageData(ref) {
    if (!ref || !ref.fileid) return Promise.resolve(null);
    return fetch('/api/log_image/' + encodeURIComponent(ref.fileid), { credentials: 'include' })
      .then(function(r) { return r.ok ? r.blob() : null; })
      .then(function(b) {
        if (!b || b.size === 0 || b.size > IMG_MAX_BYTES) return null;
        if (!b.arrayBuffer) return null;
        return b.arrayBuffer().then(function(buf) {
          var bytes = new Uint8Array(buf);
          // Type priority: magic bytes > server Content-Type (when image/*)
          // > the ref's own filetype/extension evidence.
          var mime = sniffImageMime(bytes) ||
            (b.type && b.type.indexOf('image/') === 0 ? b.type : null) ||
            refMimeHint(ref);
          if (!mime) return null;
          var bin = '';
          var CH = 32768;
          for (var i = 0; i < bytes.length; i += CH) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
          }
          return 'data:' + mime + ';base64,' + btoa(bin);
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

  // v3.12: map previews (output_group_images) and card tiles
  // (ui_tile_images) ride along as bare fileids in the JOBS payload —
  // without their BYTES the report's map section and the graph cards show
  // nothing over the HTTPS preview (direct intranet URLs are
  // mixed-content-blocked; the app server cannot reach the intranet to
  // proxy them). Queue them through the SAME byte pipeline as log images.
  var assetQueued = {};
  var imgQueuedIds = {};
  function enqueueRef(ref) {
    if (!ref || !ref.fileid || imgQueuedIds[ref.fileid]) return;
    imgQueuedIds[ref.fileid] = 1;
    imgQueue.push(ref);
  }
  function pumpImgWorkers() {
    while (imgWorkers < IMG_WORKERS && imgQueue.length) { imgWorkers++; imgWorker(); }
  }
  function queueJobAssets(uid) {
    if (assetQueued[uid]) return;
    assetQueued[uid] = 1;    var je = null;
    for (var i = 0; i < jobs.length; i++) {
      if (jobs[i] && jobs[i].uid === uid) { je = jobs[i]; break; }
    }
    if (!je) return;
    var added = 0;
    var ogi = je.output_group_images || {};
    for (var k in ogi) {
      if (!Object.prototype.hasOwnProperty.call(ogi, k)) continue;
      var v = ogi[k];
      // Plain fileids only — path-shaped values (/demo/x.png) and data/URL
      // values are served by other means and are not /api/log_image/ ids.
      if (typeof v === 'string' && v && v.indexOf('/') === -1 &&
          v.indexOf('data:') !== 0 && v.indexOf('http') !== 0) {
        enqueueRef({ fileid: v, name: k });
        added++;
      }
    }
    var tiles = je.ui_tile_images || [];
    for (var t = 0; t < tiles.length; t++) {
      var tw = tiles[t];
      if (tw && typeof tw.fileid === 'string' && tw.fileid && tw.fileid.indexOf('/') === -1) {
        enqueueRef({ fileid: tw.fileid, name: tw.name || null });
        added++;
      }
    }
    if (added) pumpImgWorkers();
  }

  function queueImageUploads(items) {
    for (var i = 0; i < items.length; i++) {
      var imgs = items[i] && items[i].images;
      if (!imgs) continue;
      for (var k = 0; k < imgs.length; k++) enqueueRef(imgs[k]);
    }
    pumpImgWorkers();
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
        // v3.11: "files"-shaped image entries ride along too.
        if (ce && (ce.type === 'image' || (ce.imgfiles && ce.imgfiles.length) ||
                   (Array.isArray(ce.files) && ce.files.length))) rawLogs.push(ce);
      }
      // v3.6: keep only the LAST round per title (older rounds 404);
      // v3.11: and only the final ITERATION of multi-iteration runs.
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
      // v3.9: cached in ANY state shape — a previous script run or an
      // opened job view may hold logs the classic keys never expose
      // (the re-run "0 images" regression).
      var deep = deepLogsFor(uid);
      if (deep && deep.length) return deep;
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
              batch.push({ uid: calibUid, images: extractLogImages(resolved, calibUid) });
              scanned[calibUid] = true;
              queueJobAssets(calibUid);
              break outer;
            }
          } else if (looksLikeLogs(coerceLogs(ret))) {
            winning = { action: actions[a], shapeIdx: s, mode: 'return' };
            batch.push({ uid: calibUid, images: extractLogImages(coerceLogs(ret), calibUid) });
            scanned[calibUid] = true;
            queueJobAssets(calibUid);
            break outer;
          }
          // (b) v3.2 deep-scan: logs landed in ANY store state shape (this
          //     build may deliver logs over WebSocket), plus the classic
          //     jobLogs/logs/job_logs keyed maps.
          var deadline = Date.now() + 1400;
          while (Date.now() < deadline) {
            var fresh = diffLogs(stores, base);
            if (fresh.length) {
              // v3.10: only accept calibration when an array is
              // ATTRIBUTABLE to the calibration job (evidence rules in
              // pickByUid). The loader may populate state without any
              // array naming this job — keep polling, then fall through
              // to the next action/shape; the per-job scan re-tries via
              // deepLogsFor + HTTP anyway.
              var pick = pickByUid(fresh, calibUid);
              if (pick) {
                winning = { action: actions[a], shapeIdx: s, mode: 'diff' };
                batch.push({ uid: calibUid, images: extractLogImages(pick.arr, calibUid) });
                scanned[calibUid] = true;
                queueJobAssets(calibUid);
                console.log('[CryoSmart] Logs landed in state at "' + pick.path + '" — deep-scan mode.');
                break outer;
              }
            }
            var logs = readLogState(calibUid);
            if (logs) {
              winning = { action: actions[a], shapeIdx: s, mode: 'state' };
              batch.push({ uid: calibUid, images: extractLogImages(logs, calibUid) });
              scanned[calibUid] = true;
              queueJobAssets(calibUid);
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
          batch.push({ uid: calibPool[pi], images: extractLogImages(probe, calibPool[pi]) });
          scanned[calibPool[pi]] = true;
          queueJobAssets(calibPool[pi]);
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
    } else if (pending.length - lazy.length > 0) {
      console.log('[CryoSmart] ' + (pending.length - lazy.length) + ' job(s) already have logs cached in memory (previous run or opened views)' +
        ' — harvesting them without extra API calls.');
    } else {
      console.log('[CryoSmart] Harvesting in-memory logs for ' + pending.length + ' job(s)...');
    }

    // Scan every pending job (time-boxed, streamed to the UI). Unified
    // retrieval: in-memory logs first (free), then the calibrated loader
    // (return value → ALL store state → per-job HTTP probe). Jobs with no
    // readable logs still stream an EMPTY batch so the progress count stays
    // exact — and the lineage-scoped total equals the request size.
    var t0 = Date.now(), BUDGET_MS = 180000;
    var noLog = [];   // v3.11: jobs whose logs never became readable
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
              if (fresh2.length) {
                // v3.10: attribution needs evidence — an unattributable
                // grown array (another job's late delivery) must not be
                // smeared onto this job. Keep polling until the deadline,
                // then fall through to the HTTP probe.
                var pick2 = pickByUid(fresh2, uid2);
                if (pick2) { logs2 = pick2.arr; break; }
              }
              var st2 = readLogState(uid2);
              if (st2) { logs2 = st2; break; }
              await new Promise(function(r) { setTimeout(r, 140); });
            }
          }
          if (!logs2) logs2 = await httpLogProbe(uid2);   // per-job HTTP fallback
        }
      }
      // v3.9 last chance: the loader may have populated state just after
      // the diff window expired, or the job's logs were cached by an
      // earlier run in a shape only the deep scan can see. Never stream an
      // empty batch while a matching array sits in memory.
      if (!logs2) {
        var lateLogs = deepLogsFor(uid2);
        if (lateLogs && lateLogs.length) logs2 = lateLogs;
      }
      scanned[uid2] = true;
      queueJobAssets(uid2);
      if (!logs2 || !logs2.length) noLog.push(uid2);
      batch.push({ uid: uid2, images: logs2 ? extractLogImages(logs2, uid2) : [] });
      await flushLogs(false);
      if ((j + 1) % 20 === 0) console.log('[CryoSmart] Log scan progress: ' + (j + 1) + '/' + pending.length + ' job(s)...');
    }

    // v3.11: SLOW-LOG RESCUE. Huge-payload jobs (hetero_refine /
    // homo_abinit with hundreds of class + iteration entries) can
    // deliver their logs AFTER the per-job 1.3s diff window expired —
    // the job streamed an empty batch and would show zero log images
    // forever. Give the loader one more call, then re-poll every store
    // shape for up to 40s before giving up.
    if (noLog.length) {
      console.log('[CryoSmart] ' + noLog.length + ' job(s) had no readable logs yet (large payloads can be slow) — re-checking for up to 40s…');
      if (winning && !winning.http) {
        for (var n1 = 0; n1 < noLog.length; n1++) {
          try {
            var nret = winning.action.fn.call(winning.action.store, shapesFor(noLog[n1])[winning.shapeIdx]);
            if (nret && typeof nret.then === 'function') nret.catch(function() {});
          } catch (e) {}
        }
      }
      var rescueEnd = Date.now() + 40000;
      while (noLog.length && Date.now() < rescueEnd) {
        await sleepMs(2000);
        var stillMissing = [];
        for (var n2 = 0; n2 < noLog.length; n2++) {
          var mu = noLog[n2];
          var ml = readLogState(mu) || deepLogsFor(mu) || cachedLogsFor(mu);
          if (ml && ml.length) {
            var mImg = extractLogImages(ml, mu);
            if (mImg.length) {
              console.log('[CryoSmart] Late logs arrived for ' + mu + ' (' + mImg.length + ' image ref(s)).');
              batch.push({ uid: mu, images: mImg });
              await flushLogs(false);
              continue;
            }
          }
          stillMissing.push(mu);
        }
        noLog = stillMissing;
      }
      if (noLog.length) {
        console.warn('[CryoSmart] No readable logs for: ' + noLog.join(', ') +
          '. Tip: open ONE of those job detail views in CryoSmart, then re-run the script — its cached logs are harvested without extra API calls.');
      }
      await flushLogs(true);
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
  } else if ((logRefsStreamed || 0) === 0 && knownRequested) {
    console.warn('[CryoSmart] ⚠ ZERO log images were found for the ' + knownRequested.length + ' traced job(s).' +
      '\\n   Those jobs may genuinely have no image logs — or this build keeps them where the' +
      '\\n   script cannot read them. Tip: open ONE job detail view in CryoSmart, then re-run' +
      '\\n   the script (v3.11 harvests logs cached by earlier runs and views).');
  }
  // v3.11: per-job zero-ref list — the hetero/abinit "no log images" class
  // of bugs is now visible at capture time instead of in the report.
  var scannedUids = Object.keys(scanned);
  var zeroRefUids = scannedUids.filter(function(u) { return !((refsByUid[u] || 0) > 0); });
  if (zeroRefUids.length && knownRequested) {
    console.log('[CryoSmart] Note: ' + zeroRefUids.length + ' scanned job(s) produced no log images: ' +
      zeroRefUids.join(', ') + '. (import/ctf-style jobs usually have none; refine/abinit jobs should —' +
      ' if one of those is listed, open its job view in CryoSmart and re-run the script.)');
  }
  console.log('[CryoSmart] Capture complete' +
    (LINEAGE_MODE && knownRequested && !CAPTURE_ALL_LATE
      ? ' — lineage-scoped: ' + knownRequested.length + ' of ' + ALL_UIDS.length + ' jobs scanned'
      : '') +
    ' · ' + (logRefsStreamed || 0) + ' log image(s) · ' + imgUploaded + ' with bytes' +
    " · multi-round/multi-iteration jobs keep only their FINAL round + iteration's log images" +
    ' · non-image result files (pdf/xml/txt/…) are never captured' +
    '. Live page:', appUrl);
})();
`.trim();

  const handleCopyScript = useCallback(async () => {
    const ok = await copyToClipboard(captureScript);
    if (ok) {
      setCopied(true);
      toast.success('Script copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(
        'Copy failed — script printed to the browser console. Open DevTools and copy from there.'
      );
      // eslint-disable-next-line no-console
      console.log('=== Capture Script ===\n' + captureScript + '\n=== /Capture Script ===');
    }
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
              are skipped; multi-round jobs fetch only their
              <strong>final round + final iteration's</strong> images and
              non-image result files (pdf/xml/txt) are never fetched,
              saving minutes on large projects.
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
