import { NextRequest, NextResponse } from "next/server";
import { putPending } from "@/lib/cryosmart/pending-store";
import {
  getImportSession,
  addJobsToSession,
  addLogBatchToSession,
  completeImportSession,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import
 *
 * Receives metadata captured from CryoSmart Vue store or bookmarklet.
 * Accepts session info for map/image downloading.
 *
 * Request body shape:
 *   {
 *     project_uid: "P52",
 *     experiment_uid: "EXP1",
 *     jobs: [...],
 *     source: "CryoSmart Console Capture v5",
 *     captured_at: "2026-08-25T...",
 *     cryosmart_origin: "http://192.168.202.11:8080",
 *     cryosmart_auth: "Bearer eyJ..."
 *   }
 */
/** CORS headers for cross-origin capture-script callers. Attached to EVERY
 *  response (success AND error) — with headers only on the success path, a
 *  bookmarklet on the CryoSmart origin gets an opaque 400/404 from the
 *  browser instead of the actionable error message. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cryosmart-Capture",
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: CORS }
    );
  }

  // `null` is valid JSON but crashes the property reads below (TypeError
  // → HTTP 500) — normalize it like the session routes do.
  const obj = (body ?? {}) as Record<string, unknown>;
  // A top-level array payload (legacy bookmarklet) is also accepted.
  const jobs = Array.isArray(obj.jobs) ? obj.jobs : Array.isArray(obj) ? (body as unknown[]) : undefined;
  const projectUid = typeof obj.project_uid === "string" ? obj.project_uid : undefined;
  const experimentUid = typeof obj.experiment_uid === "string" ? obj.experiment_uid : undefined;
  const sourceUrl = typeof obj.source_url === "string" ? obj.source_url : undefined;
  
  // CryoSmart session info for map/image downloads
  const cryosmartOrigin = typeof obj.cryosmart_origin === "string" ? obj.cryosmart_origin : undefined;
  const cryosmartAuth = typeof obj.cryosmart_auth === "string" ? obj.cryosmart_auth : undefined;
  const cryosmartCookie = typeof obj.cryosmart_cookie === "string" ? obj.cryosmart_cookie : undefined;

  // Log images captured from the SPA's lazy jobLogs state:
  // { [jobUid]: [{ fileid, name }, ...] }. Collected by the capture
  // scripts (store-action calibration + HTTP probe fallback) and merged
  // onto each job as `log_images` by the pending-import loader.
  const jobLogImages =
    obj.job_log_images &&
    typeof obj.job_log_images === "object" &&
    !Array.isArray(obj.job_log_images)
      ? (obj.job_log_images as Record<string, unknown>)
      : undefined;

  if (!jobs || jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No jobs array found in the imported payload." },
      { status: 400, headers: CORS }
    );
  }

  // Infer project_uid from source URL if missing
  let inferredPid = projectUid;
  if (!inferredPid && sourceUrl) {
    const m = sourceUrl.match(/#\/projects\/([^/?#]+)/i);
    if (m) inferredPid = m[1];
  }
  if (!inferredPid && jobs.length > 0) {
    const first = jobs[0] as Record<string, unknown>;
    if (typeof first.project_uid === "string") inferredPid = first.project_uid;
  }

  // ── Staged-session rescue (v3.14) ──────────────────────────────────
  // When the capture script's staged /jobs upload fails, it falls back to
  // this one-shot endpoint WITH its staged token in the body. Applying the
  // payload to that SAME session (instead of minting a new pending token
  // the app never learns about) means the progress tab that is already
  // polling the staged session picks everything up live — previously the
  // fallback was broken end-to-end: the app ground its full timeout on an
  // empty session while the CryoSmart console claimed "Legacy import done".
  if (typeof obj.token === "string" && obj.token) {
    const session = getImportSession(obj.token);
    if (session) {
      addJobsToSession(session, jobs, {
        project_uid: inferredPid,
        experiment_uid: experimentUid,
        source_url: sourceUrl,
        captured_at:
          typeof obj.captured_at === "string" ? obj.captured_at : new Date().toISOString(),
        cryosmart_origin: cryosmartOrigin ?? session.data.cryosmart_origin,
        cryosmart_auth: cryosmartAuth ?? session.data.cryosmart_auth,
        cryosmart_cookie: cryosmartCookie ?? session.data.cryosmart_cookie,
        discovered_job_count: jobs.length,
      });
      if (jobLogImages) {
        const items = Object.entries(jobLogImages)
          .filter(([, v]) => Array.isArray(v))
          .map(([uid, v]) => ({ uid, images: v as Array<Record<string, unknown>> }));
        if (items.length > 0) addLogBatchToSession(session, items);
      }
      completeImportSession(session);
      return NextResponse.json(
        {
          ok: true,
          token: obj.token,
          mode: "staged-rescue",
          count: jobs.length,
          project_uid: inferredPid || null,
          has_session: Boolean(cryosmartOrigin ?? session.data.cryosmart_origin),
        },
        { headers: CORS }
      );
    }
  }

  const token = putPending({
    project_uid: inferredPid,
    experiment_uid: experimentUid,
    jobs,
    raw: body,
    source_url: sourceUrl,
    captured_at: typeof obj.captured_at === "string" ? obj.captured_at : new Date().toISOString(),
    discovered_job_count: jobs.length,
    cryosmart_origin: cryosmartOrigin,
    cryosmart_auth: cryosmartAuth,
    cryosmart_cookie: cryosmartCookie,
    job_log_images: jobLogImages,
  });

  return NextResponse.json(
    {
      ok: true,
      token,
      count: jobs.length,
      project_uid: inferredPid || null,
      has_session: Boolean(cryosmartOrigin),
      expires_in: 600,
    },
    { headers: CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Max-Age": "86400" },
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
