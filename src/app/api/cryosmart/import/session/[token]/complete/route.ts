import { NextRequest, NextResponse, after } from "next/server";
import {
  getImportSession,
  completeImportSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";
import { saveSessionToHistory } from "@/lib/cryosmart/capture-history";

/**
 * POST /api/cryosmart/import/session/<token>/complete
 *
 * STEP 4 of the staged Smart Capture flow: the capture script is done
 * (all jobs scanned for log images, budget reached, or collection
 * unavailable on this build). The web UI stops polling and re-fetches the
 * final data snapshot.
 *
 * v3.14: completing a capture ALSO snapshots it to the on-disk CAPTURE
 * HISTORY (after() — runs once the response is flushed, so the script is
 * never delayed by the multi-MB write). The user can then restore the
 * capture any time — sessions expire after 45 min, history does not.
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

  // Fire-and-forget history snapshot. Failures are logged but never
  // surface to the capture script — history is a bonus, not a gate.
  after(async () => {
    try {
      const meta = await saveSessionToHistory(session);
      if (meta) {
        console.log(
          `[history] saved capture ${meta.id} — ${meta.counts.jobs} jobs, ${meta.counts.log_images} log image refs, ${meta.counts.images} image files (${Math.round(meta.bytes / 1024)} KB)`
        );
      }
    } catch (err) {
      console.error("[history] auto-save failed:", err);
    }
  });

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
