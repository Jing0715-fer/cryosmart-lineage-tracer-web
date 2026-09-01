import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  setLogRequest,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/request-logs
 *
 * v3.5 lineage-scoped capture: called by the WEB UI's Trace Lineage action
 * right after a summary is built. The job list (the traced lineage) is
 * stored on the session; the capture script — which uploaded job metadata
 * for the whole project but has NOT fetched any log images yet — polls the
 * session status, sees `log_request`, and then scans ONLY those jobs
 * (instead of every job in the project, which on real projects means 900+
 * image fetches, most of them outside the lineage the user traces).
 *
 * Re-traces union into the existing list; jobs already scanned are skipped
 * client-side. Fire-and-forget from the UI (a failure just means the old
 * capture-everything behaviour — never a failed trace).
 *
 * Request body: { jobs: ["J46", "J38", ...] } — or { all: true }, the
 * v3.26 "Fetch all jobs" button's form: union EVERY captured job uid into
 * the request so the script scans the whole project (the uids live
 * server-side on the session; the browser never needs to know them).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const session = getImportSession(token);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found or expired." },
      { status: 404, headers: IMPORT_SESSION_CORS }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  const bodyObj = body as { jobs?: unknown; all?: unknown } | null;
  let jobs: unknown;
  if (bodyObj?.all === true) {
    // { all: true } — every job captured in this session. An empty capture
    // falls through to the 400 below (nothing to request).
    jobs = Array.isArray(session.data.jobs)
      ? (session.data.jobs as Array<{ uid?: unknown }>)
          .map((j) => (j && typeof j.uid === "string" ? j.uid : null))
          .filter((u): u is string => !!u)
      : [];
  } else {
    jobs = bodyObj?.jobs;
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No jobs array found in the payload." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }
  if (jobs.length > 5000) {
    return NextResponse.json(
      { ok: false, error: "jobs array too large." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  setLogRequest(session, jobs);

  return NextResponse.json(sessionProgress(session), {
    headers: IMPORT_SESSION_CORS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
