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
 * Request body: { jobs: ["J46", "J38", ...] }
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

  const jobs = (body as { jobs?: unknown } | null)?.jobs;
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
