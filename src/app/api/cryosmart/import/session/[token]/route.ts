import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * GET /api/cryosmart/import/session/<token>
 *
 * Live progress snapshot for the staged Smart Capture flow. Polled by the
 * web UI (~1/s) while the capture script streams data:
 *   status: awaiting_jobs → collecting_logs → complete
 *   has_data: true once jobs are uploaded (graph can render)
 *   log_jobs_done / log_jobs_total / log_images_count: log collection progress
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const session = getImportSession(token);
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Session not found or expired. Re-run the CryoSmart capture script.",
      },
      { status: 404, headers: IMPORT_SESSION_CORS }
    );
  }
  return NextResponse.json(sessionProgress(session), {
    headers: IMPORT_SESSION_CORS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
