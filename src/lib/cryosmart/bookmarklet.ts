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
  var APP = 'http://localhost:3010';
  // Self-defense: strip @url: prefix that Hermes chat renderer may inject.
  // We construct the regex via String.fromCharCode to avoid any literal backtick
  // characters in this snippet (which would otherwise terminate the TypeScript
  // template literal that wraps it).
  var BACKTICK = String.fromCharCode(96);
  function stripChatPrefix(s) {
    if (typeof s !== 'string') return s;
    if (s.indexOf('@url:') !== 0) return s;
    s = s.slice(6); // strip '@url:'
    if (s.charAt(0) === BACKTICK) s = s.slice(1);
    if (s.charAt(s.length - 1) === BACKTICK) s = s.slice(0, -1);
    return s;
  }
  var APP = stripChatPrefix('http://localhost:3010');
  var href = stripChatPrefix(location.href);
    var m = href.match(new RegExp("\\/projects\\/([^\\/?#]+)", "i"));
  if (!m) { alert('Open a CryoSmart project page first'); return; }
  var pid = m[1];
  var origin = location.origin;
  console.log('[CryoSmart] Capturing', pid, 'from', origin);

  // --- 1. Grab the SPA's existing WS via Pinia socketStore ---
  function getSocketManager() {
    try {
      var el = document.querySelector('#q-app');
      if (!el || !el.__vue_app__) throw new Error('#q-app.__vue_app__ not found');
      var pinia = el.__vue_app__.config.globalProperties.$pinia;
      if (!pinia || !pinia._s) throw new Error('$pinia not found');
      var store = pinia._s.get('socketStore');
      if (!store) throw new Error('socketStore not found');
      var sm = store.ws;  // Pinia getter (lazy-creates if null)
      if (!sm) throw new Error('socketManager not available');
      return sm;
    } catch (e) {
      throw new Error('Cannot access SPA WebSocket — are you on a CryoSmart page? (' + e.message + ')');
    }
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

  // --- 5. Upload to web app (with session: origin + WS token + browser cookie) ---
  // CryoSmart authenticates /api/log_image with the session cookie, not the
  // WS token — so we capture document.cookie too (non-HttpOnly cookies only).
  function captureSession() {
    var origin = location.origin;
    var auth = null;
    var cookie = null;
    try {
      var store = document.querySelector('#q-app').__vue_app__.config.globalProperties.$pinia._s.get('socketStore');
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

  function upload(jobs) {
    var session = captureSession();
    console.log('[CryoSmart] Uploading', jobs.length, 'jobs to', APP);
    return fetch(APP + '/api/cryosmart/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        project_uid: pid,
        source_url: href,
        jobs: jobs,
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
      console.log('[CryoSmart] ✓ ' + res.count + ' jobs captured. Opening web app...');
      window.open(APP + '/?imported=' + encodeURIComponent(res.token) + '&pid=' + encodeURIComponent(pid), '_blank');
    });
  }

  // --- main ---
  try {
    var sm = getSocketManager();
    collectJobUids()
      .then(function(jobs){ return fetchAllJobDetails(sm, jobs); })
      .then(upload)
      .catch(function(err){
        console.error('[CryoSmart] Failed:', err);
        alert('CryoSmart capture failed: ' + err.message);
      });
  } catch (e) {
    alert(e.message);
  }
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
