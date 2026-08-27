/**
 * Bookmarklet generator.
 *
 * Produces a `javascript:` URL the user drags to their bookmarks bar.
 * When clicked while on a CryoSmart project page, it:
 *   1. Detects the project ID from the URL hash.
 *   2. Fetches the project's jobs metadata from CryoSmart (same-origin,
 *      so the browser auto-attaches the user's session cookie — even HttpOnly).
 *   3. Tries four candidate REST endpoints (the same ones the original
 *      Chrome extension's popup.js:tryFetchProjectJobs probes).
 *   4. POSTs the captured jobs to our /api/cryosmart/import route,
 *      receives a token.
 *   5. Opens this web app with ?imported=<token>, which auto-loads the data.
 *
 * The bookmarklet is intentionally small and self-contained (no external
 * dependencies) so it works in every browser.
 */

export interface BookmarkletConfig {
  /** Origin of THIS web app, e.g. "http://localhost:3000" or "https://lineage.example.com". */
  appOrigin: string;
}

/** Build the bookmarklet's JS source (NOT yet URI-encoded). */
export function buildBookmarkletSource(appOrigin: string): string {
  // Compact ES5 source — kept small (~5KB) for bookmark URL length limits.
  // Checks location.href, location.hash, opener.location, document.referrer
  // so the project ID is found regardless of browser routing the javascript:
  // bookmark to a fresh about:blank document.
  return [
    "(function(){",
    "var APP=" + JSON.stringify(appOrigin) + ";",
    "var H=[],M=null,S='';",
    "try{H.push(location.href)}catch(e){}",
    "try{H.push(location.hash)}catch(e){}",
    "try{if(opener){H.push(opener.location.href);H.push(opener.location.hash)}}catch(e){}",
    "try{H.push(document.referrer)}catch(e){}",
    "for(var i=0;i<H.length&&!M;i++){var h=H[i];if(!h||h==='about:blank')continue;M=h.match(/\\/projects\\/([^\\/?#]+)/i);if(M)S=h}",
    "if(!M){alert('No CryoSmart project ID found.\\n\\nLooked at:\\n'+H.filter(function(s){return s}).join(', ')+'\\n\\nExpected URL like http://your-cryosmart/#/projects/P259\\n\\nIf you ARE on such a page, your browser ran the bookmark in a blank tab. Try:\\n1. Re-install: delete the bookmark, drag the Capture CryoSmart button from the web app\\'s Bookmarklet tab again.\\n2. Click it from the bookmarks BAR (not a menu).');return}",
    "var pid=M[1],origin='',CK='';",
    "try{CK=document.cookie||''}catch(e){}",
    "try{if(!CK&&opener)CK=opener.document.cookie||''}catch(e){}",
    "try{if(opener)origin=opener.location.origin}catch(e){}",
    "if(!origin){var mm=S.match(/^(https?:\\/\\/[^\\/?#]+)/i);if(mm)origin=mm[1]}",
    "if(!origin)origin=location.origin;",
    "function sh(m,k){try{var b=document.body||function(){var x=document.createElement('body');document.documentElement.appendChild(x);return x}();var d=document.getElementById('cs')||function(){var x=document.createElement('div');x.id='cs';x.style.cssText='position:fixed;top:12px;left:12px;z-index:2147483647;padding:12px 14px;border-radius:8px;font:13px/1.5 sans-serif;max-width:420px;white-space:pre-wrap;word-break:break-word';b.appendChild(x);return x}();d.textContent=m;d.style.background=k==='err'?'#7f1d1d':k==='ok'?'#065f46':'#0f172a';d.style.color=k==='err'?'#fecaca':k==='ok'?'#d1fae5':'#e2e8f0'}catch(e){alert(m)}}",
    "sh('Capturing '+pid+' from '+origin+'...');",
    "var C=['api/projects/'+pid+'/jobs','api/jobs?project_uid='+pid,'api/projects/'+pid+'/metadata','api/meteor/jobs?project_uid='+pid],J=null,i=0,ERR=[];",
    "function TN(){",
    "if(i>=C.length){var m='No jobs endpoint on '+origin+'.\\n\\nTried:\\n';for(var k=0;k<C.length;k++)m+='  '+origin+'/'+C[k]+'\\n';if(ERR.length){m+='\\nErrors:\\n';for(var e=0;e<ERR.length;e++)m+='  '+ERR[e]+'\\n'}m+='\\nFix: open DevTools→Network on CryoSmart, refresh, find the /api/ XHR with jobs, report its path.';sh(m,'err');return}",
    "var p=C[i++];",
    "sh('Trying '+origin+'/'+p+' ('+i+'/'+C.length+')...');",
    "fetch(origin+'/'+p,{credentials:'include'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){var a=Array.isArray(d)?d:d.jobs||d.items||d.data;if(!a||!a.length)throw new Error('no jobs (keys: '+(d&&typeof d==='object'?Object.keys(d).join(','):'?')+')');J=a;UP()}).catch(function(e){ERR.push(p+': '+e.message);TN()})",
    "}",
    "function UP(){",
    "sh('Uploading '+J.length+' jobs...');",
    "fetch(APP+'/api/cryosmart/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_uid:pid,source_url:S,jobs:J,cryosmart_origin:origin,cryosmart_cookie:CK||null})}).then(function(r){return r.json()}).then(function(res){if(!res||!res.ok||!res.token)throw new Error((res&&res.error)||'upload failed');sh('Captured '+res.count+' jobs. Opening web app...','ok');var u=APP+'/?imported='+encodeURIComponent(res.token)+'&pid='+encodeURIComponent(pid);setTimeout(function(){window.open(u,'_blank');var s=document.getElementById('cs');if(s)s.remove()},800)}).catch(function(e){sh('Upload failed: '+e.message,'err')})",
    "}",
    "TN()",
    "})()",
  ].join("");
}

/** URI-encode the source into a `javascript:` URL safe for a bookmark. */
export function buildBookmarkletUrl(appOrigin: string): string {
  const src = buildBookmarkletSource(appOrigin);
  // `encodeURIComponent` is correct for bookmarklets; modern browsers accept it.
  return "javascript:" + encodeURIComponent(src);
}

/**
 * Build a Console Snippet — plain JavaScript the user pastes into the
 * CryoSmart page's DevTools Console (F12 → Console). This is the MOST
 * RELIABLE capture method because:
 *
 *   - It runs in the exact page context (never about:blank).
 *   - No javascript: URL encoding/length limits.
 *   - No bookmark installation needed.
 *   - Cookies are auto-attached (same-origin).
 *
 * The snippet is a self-contained IIFE that:
 *   1. Detects the project ID from location.href.
 *   2. Fetches the jobs metadata from CryoSmart (same-origin, cookies included).
 *   3. POSTs the jobs to /api/cryosmart/import on this web app.
 *   4. Opens this web app with ?imported=<token>.
 *   5. Logs progress to the Console so the user sees what's happening.
 */
export function buildConsoleSnippet(appOrigin: string): string {
  return `// CryoSmart Lineage Tracer — Console Capture
// Paste into CryoSmart project page console (F12).
//
// Strategy: REUSE the SPA's already-open WebSocket (Pinia socketStore) to
// fetch every job's full detail v2 (including input_slot_groups) — CryoSmart's
// REST API does NOT expose job detail, only the SPA's WS does. No new WS
// handshake needed (the SPA already has a valid token + cookies).

(function(){
  // Self-defense against Hermes/chat markdown link injection.
  // If this snippet was copied from a chat renderer that wraps URLs in
  // a markdown link syntax, strip the prefix before anything else.
  // We construct the backtick via String.fromCharCode to avoid any literal
  // backtick characters in this snippet (which would otherwise terminate
  // the TypeScript template literal that wraps it).
  var BACKTICK = String.fromCharCode(96);
  function stripChatPrefix(s) {
    if (typeof s !== 'string') return s;
    if (s.indexOf('@url:') !== 0) return s;
    s = s.slice(6); // strip '@url:'
    if (s.charAt(0) === BACKTICK) s = s.slice(1);
    if (s.charAt(s.length - 1) === BACKTICK) s = s.slice(0, -1);
    return s;
  }
  var APP = stripChatPrefix('${appOrigin}');
  var href = stripChatPrefix(location.href);
    var m = href.match(new RegExp("\\/projects\\/([^\\/?#]+)", "i"));
  if (!m) { alert('Open a CryoSmart project page first'); return; }
  var pid = m[1];
  var origin = location.origin;
  console.log('[CryoSmart] Capturing', pid, 'from', origin);

  // --- 1. Grab the SPA's Pinia socketStore (and its WS manager) ---
  function getSocketStore() {
    try {
      var el = document.querySelector('#q-app');
      if (!el || !el.__vue_app__) throw new Error('#q-app.__vue_app__ not found');
      var pinia = el.__vue_app__.config.globalProperties.$pinia;
      if (!pinia || !pinia._s) throw new Error('$pinia not found');
      var store = pinia._s.get('socketStore');
      if (!store) throw new Error('socketStore not found');
      return store;
    } catch (e) {
      throw new Error('Cannot access SPA WebSocket — are you on a CryoSmart page? (' + e.message + ')');
    }
  }
  // The WS manager: some builds expose it as "ws", others as "socketManager".
  function smOf(store) {
    var sm = store.ws || store.socketManager;
    if (!sm) throw new Error('socketManager not available');
    return sm;
  }

  // --- 2. Wrap SPA's core_method in a Promise (it's callback-based) ---
  function rpc(sm, method, params) {
    return new Promise(function(resolve, reject){
      try {
        sm.core_method(method, params, function(err, data){
          if (err) reject(new Error(method + ': ' + (err.msg || JSON.stringify(err))));
          else resolve(data);
        });
      } catch (e) {
        reject(new Error(method + ' threw: ' + e.message));
      }
    });
  }
  // Try multiple param shapes for a core_method call (server may expect
  // different shapes for the same method name across versions).
  async function tryRpcAttempts(sm, method, attempts, uidForLog) {
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      try {
        var data = await rpc(sm, method, a.args);
        if (a.label !== 'arr') {
          console.log('[CryoSmart] get_job for', uidForLog, 'worked with shape:', a.label);
        }
        return data;
      } catch (e) {
        if (i === attempts.length - 1) {
          console.warn('[CryoSmart] get_job', uidForLog, 'failed all shapes:', e.message);
          return null;
        }
      }
    }
    return null;
  }



  // --- 3. Collect every job uid for this project (HTTP, not WS) ---
  // get_clear_job_list is an HTTP endpoint (axios in SPA), not a WS RPC method.
  // Call it directly from this page context so cookies auto-attach (no CORS).
  async function collectJobUids() {
    // Try the real endpoint first
    var urls = [
      '/api/job/get_clear_job_list?project_uid=' + encodeURIComponent(pid),
      '/api/job/get_current_jobs?project_uid=' + encodeURIComponent(pid) + '&limit=500',
      '/api/job/get_job_history?project_uid=' + encodeURIComponent(pid) + '&limit=500&show_deleted=true&sort_field=created_at&desc=false'
    ];
    var allJobs = [];
    var seen = {};
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], {credentials: 'include'});
        if (!r.ok) continue;
        var d = await r.json();
        var arr = [];
        if (d && d.data) {
          if (Array.isArray(d.data)) {
            arr = d.data;
          } else if (typeof d.data === 'object') {
            for (var k in d.data) {
              if (Array.isArray(d.data[k])) {
                for (var j = 0; j < d.data[k].length; j++) arr.push(d.data[k][j]);
              }
            }
          }
        } else if (Array.isArray(d)) {
          arr = d;
        }
        for (var n = 0; n < arr.length; n++) {
          var job = arr[n];
          if (!job || !job.uid) continue;
          if (job.project_uid && job.project_uid !== pid) continue;
          if (!seen[job.uid]) {
            seen[job.uid] = true;
            allJobs.push(job);
          }
        }
        console.log('[CryoSmart] ' + urls[i] + ': ' + arr.length + ' jobs (' + allJobs.length + ' unique)');
      } catch (e) {
        console.warn('[CryoSmart] ' + urls[i] + ' failed: ' + e.message);
      }
    }
    // Also try the CSV endpoint to make sure we have every UID
    try {
      var r2 = await fetch('/api/project/get_compound_time_project?project_id=' + encodeURIComponent(pid), {credentials: 'include'});
      if (r2.ok) {
        var csv = await r2.text();
        var lines = csv.split(String.fromCharCode(10)); if (lines.length === 1) lines = csv.split(String.fromCharCode(13, 10));
        var headerCols = lines[0].split(',');
        var projCol = headerCols.indexOf('Project');
        var jobCol = headerCols.indexOf('Job');
        if (projCol >= 0 && jobCol >= 0) {
          for (var li = 1; li < lines.length; li++) {
            var c = lines[li].split(',');
            if (c[projCol] === pid && c[jobCol] && !seen[c[jobCol]]) {
              seen[c[jobCol]] = true;
              allJobs.push({uid: c[jobCol], project_uid: pid, job_type: 'unknown', status: 'unknown', _from_csv: true});
            }
          }
          console.log('[CryoSmart] CSV added: now ' + allJobs.length + ' unique jobs');
        }
      }
    } catch (e) {
      console.warn('[CryoSmart] CSV endpoint failed: ' + e.message);
    }
    if (!allJobs.length) throw new Error('No jobs found via any endpoint');
    return allJobs;
  }

  // --- 4. Skip WS enrichment — CryoSPARC server has a bug in get_job RPC handler
  // (TypeError: argument of type 'NoneType' is not iterable at sanitize_id).
  // Without input_slot_groups, lineage edges cannot be drawn, but the
  // individual job nodes (with type/status/created_at) ARE still useful.
  async function fetchAllJobDetails(sm, jobs) {
    var withMeta = jobs.filter(function(j){ return j.job_type && j.job_type !== 'unknown'; });
    var csvOnly = jobs.filter(function(j){ return !withMeta.includes(j); });
    console.log('[CryoSmart] ' + jobs.length + ' jobs total: ' + withMeta.length + ' with metadata, ' + csvOnly.length + ' CSV-only placeholders');
    console.log('[CryoSmart] Note: line graphs require input_slot_groups (CryoSPARC server bug prevents WS get_job). Job NODES only.');
    return jobs;
  }

  // --- 4b. Force-load the LAZY jobLogs & extract log image fileids ---
  // store.jobLogs only fills in when a job's detail view is opened in the
  // SPA. We find the store's log-loading action, CALIBRATE its call shape
  // on one job, then replay it for every job. HTTP probe as fallback.
  // Best-effort — failure never aborts the capture.
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
    // SAFETY: calibration actually CALLS these actions in the user's SPA.
    // "login"/"logout" contain "log" and must NEVER be candidates (a real
    // CryoSmart session was once destroyed this way); same for clear/reset
    // actions (clearLogsByJob) and setters/creators. Read-only loaders only.
    var AUTH_RE = /(login|logout|signin|sign_out|signout|sign_in|signup|register|auth|token|password|session|permission|role)/i;
    var DESTRUCTIVE_RE = /(clear|reset|remove|delet|drop|purge|wipe|destroy|disconnect)/i;
    var WRITE_PREFIX_RE = /^(set|create|update|add|new|init|connect|close|send|post|put|append|push|save|write)/i;
    var READ_PREFIX_RE = /^(get|fetch|load|request|query|list|pull|read|show|open)/i;
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
      if (!/(log|detail)/i.test(name)) continue;   // must mention logs/details
      if (AUTH_RE.test(name)) continue;            // login/logout/… — NEVER call
      if (DESTRUCTIVE_RE.test(name)) continue;     // clearLogsByJob etc.
      if (WRITE_PREFIX_RE.test(name)) continue;    // setLogs/updateLogs etc.
      try {
        if (typeof store[name] === 'function') found.push({ name: name, fn: store[name] });
      } catch (e) {}
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
            return Array.isArray(arr) && arr.length ? arr : null;
          })
          .catch(function() { return null; });
      });
    }, Promise.resolve(null));
  }

  // ── v3.2 helpers: deep-scan + timeouts + log coercion ──────────
  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function(resolve) { setTimeout(function() { resolve(undefined); }, ms); })
    ]);
  }

  function looksLikeLogs(v) {
    return Array.isArray(v) && v.length > 0 && v.some(function(x) {
      return x && ((x.imgfiles && x.imgfiles.length) || x.type === 'image' || x.text || x.files);
    });
  }

  function coerceLogs(v) {
    if (!v) return v;
    if (Array.isArray(v)) return v;
    if (Array.isArray(v.data)) return v.data;
    if (Array.isArray(v.logs)) return v.logs;
    if (Array.isArray(v.result)) return v.result;
    return v;
  }

  // Deep-scan: walk every store's state and collect EVERY array holding
  // entries with non-empty 'imgfiles' (the image-log signature) — catches
  // logs that land in shapes other than jobLogs/logs/job_logs maps.
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

  function pickByUid(fresh, uid) {
    for (var i = 0; i < fresh.length; i++) {
      var p = '.' + (fresh[i].path || '') + '.';
      if (p.indexOf('.' + uid + '.') !== -1) return fresh[i];
    }
    return fresh[0];
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
      var uid = jobs[i] && jobs[i].uid;
      if (!uid) continue;
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

    // 2. v3.2: calibrate the loader call on up to 3 image-rich jobs, with a
    //    deep state scan that catches logs landing in ANY store shape.
    var actions = findLogActions(store);
    console.log('[CryoSmart] Log loader candidates:', actions.map(function(a) { return a.name; }).join(', ') || 'none');
    for (var d3 = 0; d3 < actions.length && d3 < 2; d3++) {
      try {
        console.log('[CryoSmart] Loader "' + actions[d3].name + '" source (diagnostics):\\n' + String(actions[d3].fn).slice(0, 900));
      } catch (e) {}
    }

    var typeByUid = {};
    for (var t3 = 0; t3 < jobs.length; t3++) typeByUid[jobs[t3].uid] = jobs[t3].job_type || '';
    var RICH_RE = /refine|class|3d|2d|reconstruct|sharpen|nu|motion|ctf|mask|build/i;
    var calibPool = pending.slice().sort(function(x, y) {
      return (RICH_RE.test(typeByUid[y] || '') ? 1 : 0) - (RICH_RE.test(typeByUid[x] || '') ? 1 : 0);
    });
    var calibTries = Math.min(3, calibPool.length);

    function shapesFor(uid) {
      var row = null;
      for (var i = 0; i < jobs.length; i++) if (jobs[i].uid === uid) { row = jobs[i]; break; }
      var sh = [uid, { job_uid: uid }, { uid: uid }, [uid]];
      if (row) sh.push(row);
      sh.push({ uid: uid, project_uid: pid });
      return sh;
    }

    var scanned = {};
    var winning = null;   // { action, shapeIdx, mode } or { http: true }

    outer:
    for (var ci = 0; ci < calibTries && !winning; ci++) {
      var calibUid = calibPool[ci];
      var shapes = shapesFor(calibUid);
      for (var a = 0; a < actions.length; a++) {
        for (var s = 0; s < shapes.length; s++) {
          var base = snapshotLogs([store]);
          var ret = null;
          try {
            ret = actions[a].fn.call(store, shapes[s]);
          } catch (e) {}
          if (ret && typeof ret.then === 'function') {
            var resolved = coerceLogs(await withTimeout(ret.catch(function() {}), 1500));
            if (looksLikeLogs(resolved)) {
              winning = { action: actions[a], shapeIdx: s, mode: 'return' };
              var rImgs = extractLogImages(resolved);
              if (rImgs.length) result[calibUid] = rImgs;
              scanned[calibUid] = true;
              break outer;
            }
          } else if (looksLikeLogs(coerceLogs(ret))) {
            winning = { action: actions[a], shapeIdx: s, mode: 'return' };
            var rImgs2 = extractLogImages(coerceLogs(ret));
            if (rImgs2.length) result[calibUid] = rImgs2;
            scanned[calibUid] = true;
            break outer;
          }
          var deadline = Date.now() + 1400;
          while (Date.now() < deadline) {
            var fresh = diffLogs([store], base);
            if (fresh.length) {
              var pick = pickByUid(fresh, calibUid);
              winning = { action: actions[a], shapeIdx: s, mode: 'diff' };
              var fImgs = extractLogImages(pick.arr);
              if (fImgs.length) result[calibUid] = fImgs;
              scanned[calibUid] = true;
              console.log('[CryoSmart] Logs landed in state at "' + pick.path + '" — deep-scan mode.');
              break outer;
            }
            var logs = await waitForLogs(store, calibUid, 300);
            if (logs) {
              winning = { action: actions[a], shapeIdx: s, mode: 'state' };
              var cImgs = extractLogImages(logs);
              if (cImgs.length) result[calibUid] = cImgs;
              scanned[calibUid] = true;
              break outer;
            }
            await new Promise(function(r) { setTimeout(r, 120); });
          }
        }
      }
    }

    if (!winning) {
      for (var pi = 0; pi < calibTries && !winning; pi++) {
        var probe = await httpLogProbe(calibPool[pi]);
        if (probe) {
          winning = { http: true };
          var pImgs = extractLogImages(probe);
          if (pImgs.length) result[calibPool[pi]] = pImgs;
          scanned[calibPool[pi]] = true;
        }
      }
    }

    if (!winning) {
      console.log('[CryoSmart] Could not trigger lazy log loading on this build — capturing without log images. ' +
        '(Tip: open one job detail view in CryoSmart, then re-run the script.)');
      console.log('[CryoSmart] ── Diagnostics (paste this whole block back to the maintainer) ──');
      try { console.log('store state keys: [' + Object.keys(store.$state || store).slice(0, 40).join(', ') + ']'); } catch (e) {}
      return result;
    }
    console.log('[CryoSmart] Log loading works via ' +
      (winning.http ? 'HTTP endpoint' : 'store action "' + winning.action.name + '" (' + winning.mode + ')') +
      ' — collecting...');

    // 3. Replay for every remaining job (time-boxed, progress logged).
    var t0 = Date.now(), BUDGET_MS = 60000;
    for (var j2 = 0; j2 < pending.length; j2++) {
      var uid2 = pending[j2];
      if (scanned[uid2] || result[uid2]) continue;
      if (Date.now() - t0 > BUDGET_MS) {
        console.log('[CryoSmart] Log collection time budget reached — stopping after ' + j2 + '/' + pending.length + ' job(s).');
        break;
      }
      var logs2 = null;
      try {
        if (store.jobLogs && store.jobLogs[uid2] && store.jobLogs[uid2].length) logs2 = store.jobLogs[uid2];
      } catch (e) {}
      if (!logs2) {
        if (winning.http) {
          logs2 = await httpLogProbe(uid2);
        } else {
          var arg = shapesFor(uid2)[winning.shapeIdx];
          var base2 = snapshotLogs([store]);
          try {
            var rr = winning.action.fn.call(store, arg);
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
              var fresh2 = diffLogs([store], base2);
              if (fresh2.length) { logs2 = pickByUid(fresh2, uid2).arr; break; }
              try {
                if (store.jobLogs && store.jobLogs[uid2] && store.jobLogs[uid2].length) { logs2 = store.jobLogs[uid2]; break; }
              } catch (e) {}
              await new Promise(function(r) { setTimeout(r, 120); });
            }
          }
          if (!logs2) logs2 = await httpLogProbe(uid2);   // per-job HTTP fallback
        }
      }
      if (logs2) {
        var imgs2 = extractLogImages(logs2);
        if (imgs2.length) result[uid2] = imgs2;
      }
      if ((j2 + 1) % 10 === 0) console.log('[CryoSmart] Log loading progress: ' + (j2 + 1) + '/' + pending.length + ' job(s)...');
    }

    console.log('[CryoSmart] Log images collected for ' + Object.keys(result).length + ' of ' + jobs.length + ' job(s)');
    return result;
  }

  // --- 5. Upload to web app (with session: origin + WS token + browser cookie) ---
  // CryoSmart authenticates /api/log_image with the session cookie, not the
  // WS token — so we capture document.cookie too (non-HttpOnly cookies only).
  function captureSession(store) {
    var origin = location.origin;
    var auth = null;
    var cookie = null;
    try {
      if (store && store.socketManager && store.socketManager.token) {
        auth = 'Bearer ' + store.socketManager.token;
      }
    } catch (e) {}
    try { cookie = document.cookie || null; } catch (e) {}
    console.log('[CryoSmart] Session: origin=' + origin
      + ', auth=' + (auth ? 'Bearer [token]' : 'none')
      + ', cookie=' + (cookie && cookie.length ? cookie.length + ' chars' : 'none'));
    return { origin: origin, auth: auth, cookie: cookie };
  }

  function upload(jobs, logImages, store) {
    var session = captureSession(store);
    console.log('[CryoSmart] Uploading', jobs.length, 'jobs to', APP);
    return fetch(APP + '/api/cryosmart/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        project_uid: pid,
        source_url: href,
        jobs: jobs,
        job_log_images: logImages || {},
        cryosmart_origin: session.origin,
        cryosmart_auth: session.auth,
        cryosmart_cookie: session.cookie
      })
    })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(res){
      if (!res.ok) throw new Error(res.error || 'upload failed');
      var nLogs = Object.keys(logImages || {}).length;
      console.log('[CryoSmart] ✓ ' + res.count + ' jobs captured' + (nLogs ? ' + log images for ' + nLogs + ' job(s)' : '') + '. Opening web app...');
      window.open(APP + '/?imported=' + encodeURIComponent(res.token) + '&pid=' + encodeURIComponent(pid), '_blank');
    });
  }

  // --- main ---
  (async function(){
    try {
      var store = getSocketStore();
      var sm = smOf(store);
      var jobs = await collectJobUids();
      jobs = await fetchAllJobDetails(sm, jobs);
      var logImages = {};
      try {
        logImages = await collectLogImages(store, jobs);
      } catch (e) {
        console.warn('[CryoSmart] Log image collection failed (non-fatal):', e && e.message);
      }
      await upload(jobs, logImages, store);
    } catch (err) {
      console.error('[CryoSmart] Failed:', err);
      alert('CryoSmart capture failed: ' + (err && err.message));
    }
  })();
})();
`;
}

/**
 * Heuristic: detect if we're running on https and the user gave us an http app origin.
 * In that case the bookmarklet's fetch to an http app would be blocked as mixed content
 * when run on an https CryoSmart page. We warn about this.
 */
export function detectMixedContentIssue(
  appOrigin: string,
  cryosmartPageOrigin: string
): boolean {
  const appProto = appOrigin.split(":")[0];
  const cryoProto = cryosmartPageOrigin.split(":")[0];
  // Problem: app on http, cryosmart on https → mixed-content downgrade blocked.
  return appProto === "http" && cryoProto === "https";
}
