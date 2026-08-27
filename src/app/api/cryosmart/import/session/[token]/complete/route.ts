import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  completeImportSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/complete
 *
 * STEP 4 of the staged Smart Capture flow: the capture script is done
 * (all jobs scanned for log images, budget reached, or collection
 * unavailable on this build). The web UI stops polling and re-fetches the
 * final data snapshot.
 */
export async function POST(
  _req: NextRequest,
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

  completeImportSession(session);

  return NextResponse.json(
    sessionProgress(session),
    { headers: IMPORT_SESSION_CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
