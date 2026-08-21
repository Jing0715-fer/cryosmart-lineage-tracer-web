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
    "var pid=M[1],origin='';",
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
    "fetch(APP+'/api/cryosmart/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_uid:pid,source_url:S,jobs:J})}).then(function(r){return r.json()}).then(function(res){if(!res||!res.ok||!res.token)throw new Error((res&&res.error)||'upload failed');sh('Captured '+res.count+' jobs. Opening web app...','ok');var u=APP+'/?imported='+encodeURIComponent(res.token)+'&pid='+encodeURIComponent(pid);setTimeout(function(){window.open(u,'_blank');var s=document.getElementById('cs');if(s)s.remove()},800)}).catch(function(e){sh('Upload failed: '+e.message,'err')})",
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
// Paste this into the Console (F12) on your CryoSmart project page.
(function(){
  var APP = ${JSON.stringify(appOrigin)};
  var href = location.href;
  var m = href.match(/\\/projects\\/([^\\/?#]+)/i);
  if (!m) { console.error('[CryoSmart] No /projects/<PID> in URL:', href); alert('Open this CryoSmart project page first (URL like http://your-cryosmart/#/projects/P259), then re-run this snippet.'); return; }
  var pid = m[1];
  var origin = location.origin;
  console.log('[CryoSmart] Capturing project', pid, 'from', origin);

  // Step 1: Auto-discover API endpoints from the page's network activity.
  // CryoSmart SPA loads job data via XHR — we scan performance entries to
  // find any URL that looks like an API call returning JSON, and try those.
  var discovered = [];
  try {
    var entries = performance.getEntriesByType('resource');
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].name;
      // Only same-origin requests that look like API calls.
      if (name.indexOf(origin) !== 0) continue;
      var relPath = name.slice(origin.length).replace(/^\\/+/, '');
      // Skip static assets (images, css, js, fonts).
      if (/\\.(png|jpg|jpeg|gif|svg|css|js|woff2?|ttf|ico|map)(\\?|$)/i.test(relPath)) continue;
      // Keep paths that look like API calls or contain 'job' or 'project'.
      if (relPath.indexOf('api/') === 0 || /job|project|exposure|metadata/i.test(relPath)) {
        if (discovered.indexOf(relPath) === -1) discovered.push(relPath);
      }
    }
  } catch(e) {}
  if (discovered.length) console.log('[CryoSmart] Discovered API endpoints from page activity:', discovered);

  // Step 2: Build candidate list — discovered endpoints first, then known
  // CryoSmart API patterns (verified from real deployments), then guesses.
  var endpoints = discovered.slice();
  var guesses = [
    // Real CryoSmart API endpoints (verified from deployment at 192.168.202.11:8080):
    'api/job/get_clear_job_list?project_uid=' + pid,
    'api/project/get_compound_time_project?project_id=' + pid,
    'api/job/get_clear_job_list?project_uid=' + pid + '&all=true',
    'api/job/get_job_list?project_uid=' + pid,
    'api/job/get_job_list?project_uid=' + pid + '&all=true',
    'api/project/get_project?project_id=' + pid,
    'api/project/get_project_info?project_id=' + pid,
    // Original guesses (for other CryoSmart deployments):
    'api/projects/' + pid + '/jobs',
    'api/jobs?project_uid=' + pid,
    'api/projects/' + pid + '/metadata',
    'api/meteor/jobs?project_uid=' + pid,
    'api/v1/projects/' + pid + '/jobs',
    'api/v1/projects/' + pid,
    'api/projects/' + pid,
    'api/project/' + pid + '/jobs',
    'v1/projects/' + pid + '/jobs',
    'projects/' + pid + '/jobs',
    'api/projects/' + pid + '/exposures',
    'api/projects/' + pid + '/exposures/jobs'
  ];
  for (var g = 0; g < guesses.length; g++) {
    if (endpoints.indexOf(guesses[g]) === -1) endpoints.push(guesses[g]);
  }

  var errors = [];
  function tryEndpoint(path) {
    var url = origin + '/' + path;
    console.log('[CryoSmart] Trying', url);
    return fetch(url, { credentials: 'include' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('json') === -1 && ct.indexOf('text') === -1) throw new Error('not JSON (content-type: ' + ct + ')');
        return r.json();
      })
      .then(function(d) {
        // Try every possible wrapper for the jobs array.
        var jobs = null;
        if (Array.isArray(d)) jobs = d;
        else if (d && typeof d === 'object') {
          jobs = d.jobs || d.items || d.data || d.results || d.exposures || d.nodes || d.pipeline || d.job_list || d.jobList;
          // Nested: { data: { jobs: [...] } }
          if (!jobs && d.data && typeof d.data === 'object') {
            var dd = d.data;
            jobs = dd.jobs || dd.items || dd.job_list || dd.jobList || dd.results;
          }
          // Nested: { result: { jobs: [...] } }
          if (!jobs && d.result && typeof d.result === 'object') {
            var rr = d.result;
            jobs = rr.jobs || rr.items || rr.job_list || rr.jobList || rr.results;
          }
          // Deep search: find any array property whose items look like jobs
          if (!jobs) {
            for (var k in d) {
              if (Array.isArray(d[k]) && d[k].length > 0) {
                var first = d[k][0];
                if (first && typeof first === 'object' && (first.uid || first.job_type || first.job_uid || first.project_uid)) {
                  jobs = d[k];
                  break;
                }
              }
            }
          }
        }
        if (!jobs || !Array.isArray(jobs) || !jobs.length) {
          throw new Error('no jobs array (keys: ' + (d && typeof d === 'object' ? Object.keys(d).join(',') : typeof d) + ')');
        }
        return jobs;
      });
  }

  function upload(jobs, source) {
    console.log('[CryoSmart] Found', jobs.length, 'jobs via', source);
    console.log('[CryoSmart] Uploading to web app...');
    return fetch(APP + '/api/cryosmart/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_uid: pid, source_url: href, jobs: jobs })
    })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res || !res.ok || !res.token) throw new Error((res && res.error) || 'upload failed');
        console.log('[CryoSmart] ✅ Done! ' + res.count + ' jobs captured. Opening web app...');
        window.open(APP + '/?imported=' + encodeURIComponent(res.token) + '&pid=' + encodeURIComponent(pid), '_blank');
      });
  }

  function tryNext(i) {
    if (i >= endpoints.length) {
      console.error('[CryoSmart] ❌ All endpoints failed:', errors);
      var msg = 'Could not fetch jobs from ' + origin + '.\\n\\n';
      msg += 'Tried ' + endpoints.length + ' endpoints:\\n';
      for (var e = 0; e < errors.length; e++) msg += '  ' + errors[e] + '\\n';
      msg += '\\nHow to fix:\\n';
      msg += '1. Open DevTools → Network tab on this CryoSmart page.\\n';
      msg += '2. Refresh the page (F5).\\n';
      msg += '3. Find the XHR/fetch request that returns the job list\\n';
      msg += '   (look for a JSON response containing job objects).\\n';
      msg += '4. Copy the full URL from the Network tab.\\n';
      msg += '5. In the Lineage Tracer web app, go to the Upload JSON tab\\n';
      msg += '   and paste the JSON response there manually.';
      alert(msg);
      return;
    }
    var path = endpoints[i];
    tryEndpoint(path)
      .then(function(jobs) { return upload(jobs, path); })
      .catch(function(e) {
        errors.push(path + ': ' + e.message);
        tryNext(i + 1);
      });
  }
  tryNext(0);
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
