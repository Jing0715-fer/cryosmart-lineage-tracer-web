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
  // We can use a more readable multi-line format here since it's pasted
  // into the Console, not embedded in a URL. But keep it compact-ish.
  return `// CryoSmart Lineage Tracer — Console Capture
// Paste this into the Console (F12) on your CryoSmart project page.
// It fetches the project's jobs and sends them to the Lineage Tracer web app.
(function(){
  var APP = ${JSON.stringify(appOrigin)};
  var href = location.href;
  var m = href.match(/\\/projects\\/([^\\/?#]+)/i);
  if (!m) { console.error('No /projects/<PID> in URL:', href); alert('Open this CryoSmart project page first (URL like http://your-cryosmart/#/projects/P259), then re-run this snippet.'); return; }
  var pid = m[1];
  var origin = location.origin;
  console.log('[CryoSmart] Capturing project', pid, 'from', origin);
  var endpoints = [
    'api/projects/' + pid + '/jobs',
    'api/jobs?project_uid=' + pid,
    'api/projects/' + pid + '/metadata',
    'api/meteor/jobs?project_uid=' + pid
  ];
  var errors = [];
  function tryNext(i) {
    if (i >= endpoints.length) {
      console.error('[CryoSmart] All endpoints failed:', errors);
      alert('Could not fetch jobs from ' + origin + '.\\nTried:\\n' + endpoints.map(function(p){return '  ' + origin + '/' + p;}).join('\\n') + '\\n\\nErrors:\\n' + errors.map(function(e){return '  ' + e;}).join('\\n') + '\\n\\nOpen DevTools → Network, refresh the CryoSmart page, find the XHR that returns the job list, and report its path.');
      return;
    }
    var path = endpoints[i];
    console.log('[CryoSmart] Trying', origin + '/' + path, '(' + (i+1) + '/' + endpoints.length + ')');
    fetch(origin + '/' + path, { credentials: 'include' })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) {
        var jobs = Array.isArray(d) ? d : (d.jobs || d.items || d.data);
        if (!jobs || !jobs.length) throw new Error('no jobs in response');
        console.log('[CryoSmart] Found', jobs.length, 'jobs via', path);
        console.log('[CryoSmart] Uploading to web app...');
        return fetch(APP + '/api/cryosmart/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_uid: pid, source_url: href, jobs: jobs })
        }).then(function(r) { return r.json(); });
      })
      .then(function(res) {
        if (!res || !res.ok || !res.token) throw new Error((res && res.error) || 'upload failed');
        console.log('[CryoSmart] Done! ' + res.count + ' jobs captured. Opening web app...');
        window.open(APP + '/?imported=' + encodeURIComponent(res.token) + '&pid=' + encodeURIComponent(pid), '_blank');
      })
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
