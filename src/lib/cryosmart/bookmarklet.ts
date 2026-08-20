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
  return [
    "(function(){",
    "  var APP=" + JSON.stringify(appOrigin) + ";",
    "  var hash=String(location.hash||'');",
    "  var m=hash.match(/#\\/projects\\/([^/?#]+)/i);",
    "  if(!m){alert('Please click this bookmarklet while on a CryoSmart project page (URL like http://your-cryosmart/#/projects/P52).');return;}",
    "  var pid=m[1];",
    "  var origin=location.origin;",
    "  var cand=[",
    "    'api/projects/'+encodeURIComponent(pid)+'/jobs',",
    "    'api/jobs?project_uid='+encodeURIComponent(pid),",
    "    'api/projects/'+encodeURIComponent(pid)+'/metadata',",
    "    'api/meteor/jobs?project_uid='+encodeURIComponent(pid)",
    "  ];",
    "  function show(msg,kind){try{var d=document.getElementById('cryo-bm-status');if(!d){d=document.createElement('div');d.id='cryo-bm-status';d.style.cssText='position:fixed;top:12px;left:12px;z-index:2147483647;background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font:13px/1.5 -apple-system,Segoe UI,sans-serif;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,.4)';document.body.appendChild(d);}d.textContent=msg;if(kind==='err'){d.style.background='#7f1d1d';d.style.color='#fecaca';}else if(kind==='ok'){d.style.background='#065f46';d.style.color='#d1fae5';}else{d.style.background='#0f172a';d.style.color='#e2e8f0';}}catch(e){alert(msg);}}",
    "  show('Capturing CryoSmart metadata for '+pid+'...');",
    "  var jobs=null,src=null,i=0;",
    "  function tryNext(){",
    "    if(i>=cand.length){show('Could not find a jobs endpoint on '+origin+'. Tried:\\n'+cand.join('\\\\n')+'\\n\\nOpen DevTools → Network on the CryoSmart project page to find the real endpoint, then tell us.','err');return;}",
    "    var path=cand[i++];",
    "    show('Trying '+origin+'/'+path+' ('+i+'/'+cand.length+')...');",
    "    fetch(origin+'/'+path,{credentials:'include',headers:{'Accept':'application/json'}}).then(function(r){",
    "      if(!r.ok)throw new Error('HTTP '+r.status);",
    "      return r.json();",
    "    }).then(function(data){",
    "      var arr=null;",
    "      if(Array.isArray(data))arr=data;",
    "      else if(data&&typeof data==='object'&&Array.isArray(data.jobs))arr=data.jobs;",
    "      else if(data&&typeof data==='object'&&Array.isArray(data.items))arr=data.items;",
    "      if(!arr||!arr.length)throw new Error('no jobs in response');",
    "      jobs=arr;src=path;",
    "      upload();",
    "    }).catch(function(){tryNext();});",
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
