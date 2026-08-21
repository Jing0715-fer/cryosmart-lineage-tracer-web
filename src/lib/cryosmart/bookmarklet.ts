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
  // Note: we use var/function (not const/arrow) for max browser compatibility,
  // and avoid template literals so the code is trivially ES5-compatible.
  //
  // The project ID is extracted from the full URL (location.href), not just
  // location.hash, because some CryoSmart deployments route via pushState
  // instead of the hash. We also check the hash separately. The project ID
  // pattern is permissive: anything matching `/projects/(Pxxx|EXPxxx/...)`
  // — the first path segment after `/projects/` that isn't a query/fragment.
  return [
    "(function(){",
    "  var APP=" + JSON.stringify(appOrigin) + ";",
    "  var href=String(location.href||'');",
    "  var hash=String(location.hash||'');",
    "  // Try to find a project ID in EITHER the full URL or just the hash.",
    "  // Matches /projects/<pid> where <pid> is any non-slash/non-query char.",
    "  // Examples that match:",
    "  //   http://host/#/projects/P259        → P259",
    "  //   http://host/app#/projects/P259/J5  → P259 (experiment J5 ignored)",
    "  //   http://host/projects/P259          → P259 (no hash, pushState)",
    "  //   http://host/#/projects/P259/EXP1   → P259",
    "  var m=href.match(/\\/projects\\/([^\\/?#]+)/i) || hash.match(/projects\\/([^\\/?#]+)/i);",
    "  if(!m||!m[1]){",
    "    alert('Could not detect a CryoSmart project ID in this URL.\\n\\n'",
    "      + 'Current URL: '+href+'\\n\\n'",
    "      + 'The bookmarklet expects a URL containing /projects/<PID>, for example:\\n'",
    "      + '  http://your-cryosmart/#/projects/P259\\n'",
    "      + '  http://your-cryosmart/#/projects/P259/EXP1/J5\\n\\n'",
    "      + 'If you ARE on such a page, the CryoSmart deployment may use a non-standard'",
    "      + ' route. Please open DevTools → Console and run: location.href — then report the URL.');",
    "    return;",
    "  }",
    "  var pid=m[1];",
    "  var origin=location.origin;",
    "  var cand=[",
    "    'api/projects/'+encodeURIComponent(pid)+'/jobs',",
    "    'api/jobs?project_uid='+encodeURIComponent(pid),",
    "    'api/projects/'+encodeURIComponent(pid)+'/metadata',",
    "    'api/meteor/jobs?project_uid='+encodeURIComponent(pid)",
    "  ];",
    "  function show(msg,kind){try{var d=document.getElementById('cryo-bm-status');if(!d){d=document.createElement('div');d.id='cryo-bm-status';d.style.cssText='position:fixed;top:12px;left:12px;z-index:2147483647;background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font:13px/1.5 -apple-system,Segoe UI,sans-serif;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.4)';document.body.appendChild(d);}d.textContent=msg;if(kind==='err'){d.style.background='#7f1d1d';d.style.color='#fecaca';}else if(kind==='ok'){d.style.background='#065f46';d.style.color='#d1fae5';}else{d.style.background='#0f172a';d.style.color='#e2e8f0';}}catch(e){alert(msg);}}",
    "  show('Capturing CryoSmart metadata for '+pid+' from '+origin+'...');",
    "  var jobs=null,src=null,i=0,errors=[];",
    "  function tryNext(){",
    "    if(i>=cand.length){",
    "      var msg='Could not find a jobs endpoint on '+origin+'.\\n\\nTried:\\n';",
    "      for(var k=0;k<cand.length;k++){msg+='  '+origin+'/'+cand[k]+'\\n';}",
    "      if(errors.length){msg+='\\nErrors:\\n';for(var e=0;e<errors.length;e++){msg+='  '+errors[e]+'\\n';}}",
    "      msg+='\\nHow to fix:\\n'",
    "        + '1. Open DevTools → Network on this CryoSmart project page.\\n'",
    "        + '2. Refresh the page.\\n'",
    "        + '3. Find the XHR call that returns the job list (look for /api/... with JSON response containing jobs).\\n'",
    "        + '4. Copy that path and report it — we can add it to the bookmarklet.';",
    "      show(msg,'err');",
    "      return;",
    "    }",
    "    var path=cand[i++];",
    "    show('Trying '+origin+'/'+path+' ('+i+'/'+cand.length+')...');",
    "    fetch(origin+'/'+path,{credentials:'include',headers:{'Accept':'application/json'}}).then(function(r){",
    "      if(!r.ok)throw new Error('HTTP '+r.status+' '+r.statusText);",
    "      return r.json();",
    "    }).then(function(data){",
    "      var arr=null;",
    "      if(Array.isArray(data))arr=data;",
    "      else if(data&&typeof data==='object'&&Array.isArray(data.jobs))arr=data.jobs;",
    "      else if(data&&typeof data==='object'&&Array.isArray(data.items))arr=data.items;",
    "      else if(data&&typeof data==='object'&&Array.isArray(data.data))arr=data.data;",
    "      if(!arr||!arr.length)throw new Error('no jobs array in response (got '+(data&&typeof data==='object'?Object.keys(data||{}).join(','):'non-object')+')');",
    "      jobs=arr;src=path;",
    "      upload();",
    "    }).catch(function(e){",
    "      errors.push(path+': '+(e&&e.message?e.message:String(e)));",
    "      tryNext();",
    "    });",
    "  }",
    "  function upload(){",
    "    show('Uploading '+jobs.length+' jobs to web app...');",
    "    fetch(APP+'/api/cryosmart/import',{method:'POST',headers:{'Content-Type':'application/json','X-Cryosmart-Capture':'bookmarklet'},body:JSON.stringify({project_uid:pid,experiment_uid:null,source_url:location.href,jobs:jobs})}).then(function(r){return r.json();}).then(function(res){",
    "      if(!res||!res.ok||!res.token){throw new Error((res&&res.error)||'upload failed');}",
    "      show('Captured '+res.count+' jobs. Opening web app...','ok');",
    "      var u=APP+'/?imported='+encodeURIComponent(res.token)+'&pid='+encodeURIComponent(pid);",
    "      setTimeout(function(){window.open(u,'_blank');var s=document.getElementById('cryo-bm-status');if(s)s.remove();},800);",
    "    }).catch(function(e){show('Upload failed: '+e.message,'err');});",
    "  }",
    "  tryNext();",
    "})();void(0)",
  ].join("\n");
}

/** URI-encode the source into a `javascript:` URL safe for a bookmark. */
export function buildBookmarkletUrl(appOrigin: string): string {
  const src = buildBookmarkletSource(appOrigin);
  // `encodeURIComponent` is correct for bookmarklets; modern browsers accept it.
  return "javascript:" + encodeURIComponent(src);
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
