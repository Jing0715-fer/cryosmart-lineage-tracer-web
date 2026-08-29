import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * GET /api/cryosmart/import/session/<token>/data
 *
 * Current data snapshot for the staged Smart Capture flow — same response
 * shape as the legacy GET /api/cryosmart/pending, but NON-destructive:
 *   - called once by the UI as soon as has_data=true (graph renders while
 *     log images keep streaming in), and again when status=complete.
 * The session itself is cleaned up by TTL.
 */
export async function GET(
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

  const d = session.data;
  return NextResponse.json(
    {
      ok: true,
      token,
      captured_at: d.captured_at || null,
      status: session.status,
      log_jobs_done: session.logJobsDone,
      log_jobs_total: session.logJobsTotal,
      log_images_count: session.logImagesCount,
      log_images_uploaded: session.logImagesUploaded,
      data: {
        project_uid: d.project_uid,
        experiment_uid: d.experiment_uid,
        jobs: d.jobs,
        raw: d.jobs ? { jobs: d.jobs } : undefined,
        source_url: d.source_url,
        captured_at: d.captured_at,
        discovered_job_count: d.discovered_job_count,
        // Session info for image/map proxy downloads
        cryosmart_origin: d.cryosmart_origin,
        cryosmart_auth: d.cryosmart_auth || undefined,
        cryosmart_cookie: d.cryosmart_cookie || undefined,
        // Log images streamed so far (may still grow until status=complete)
        job_log_images: session.jobLogImages,
        // Fileids whose BYTES were uploaded — the UI points these at the
        // same-origin /image/<fileid> endpoint instead of the (usually
        // mixed-content-blocked) direct CryoSmart URL.
        uploaded_image_ids: Array.from(session.imageStore.keys()),
      },
    },
    { headers: IMPORT_SESSION_CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
