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
 * v3.33: big projects arrive as multiple CAPPED batches
 * ({ batch_index, batch_total } in the body). batch_total > 1 makes the
 * batch APPEND (uid-deduped); each response carries the merged
 * sessionProgress snapshot so the script (and the polling tab) see
 * total_jobs grow live.
 *
 * Request body:
 *   { project_uid?, experiment_uid?, source_url?, batch_index?,
 *     batch_total?, jobs: [...captured jobs] }
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

  // v3.33: batched uploads. The capture script caps each POST (~60 jobs /
  // ~250KB of JSON) so big projects survive the browser→preview-gateway
  // hop; a body declaring batch_total > 1 APPENDS (deduped by uid in the
  // store — a retried batch is idempotent) instead of replacing. Bodies
  // without batch fields keep the old single-shot replace semantics, so
  // older script copies behave exactly as before.
  const batchTotal =
    typeof obj.batch_total === "number" && Number.isFinite(obj.batch_total)
      ? obj.batch_total
      : 0;

  addJobsToSession(
    session,
    jobs,
    {
      project_uid: str(obj.project_uid) ?? session.data.project_uid,
      experiment_uid: str(obj.experiment_uid) ?? session.data.experiment_uid,
      source_url: str(obj.source_url) ?? session.data.source_url,
    },
    { append: batchTotal > 1 }
  );

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
