import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  addJobsToSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/jobs
 *
 * STEP 2 of the staged Smart Capture flow: upload the full jobs array.
 * As soon as this lands the web UI can render the lineage graph; the
 * capture script continues streaming log images in the background.
 *
 * Request body:
 *   { project_uid?, experiment_uid?, source_url?, jobs: [...captured jobs] }
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

  const obj = (body ?? {}) as Record<string, unknown>;
  const jobs = Array.isArray(obj.jobs) ? obj.jobs : undefined;
  if (!jobs || jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No jobs array found in the payload." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  addJobsToSession(session, jobs, {
    project_uid: str(obj.project_uid) ?? session.data.project_uid,
    experiment_uid: str(obj.experiment_uid) ?? session.data.experiment_uid,
    source_url: str(obj.source_url) ?? session.data.source_url,
  });

  return NextResponse.json(
    {
      ...sessionProgress(session),
      count: jobs.length,
    },
    { headers: IMPORT_SESSION_CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
