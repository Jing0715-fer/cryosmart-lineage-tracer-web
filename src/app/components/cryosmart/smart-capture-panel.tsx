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
  // This version captures complete job metadata AND session info for maps/images
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
  
  // Upload to web app with session info (origin + WS token + browser cookie)
  fetch(APP + '/api/cryosmart/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_uid: projectId,
      experiment_uid: project.experiments[0]?.uid,
      jobs: jobs,
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
              Maps and images can be downloaded when session info is available.
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