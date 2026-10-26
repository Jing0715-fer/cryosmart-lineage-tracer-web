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
 *
 * v3.25: the body is now STREAMED through a ReadableStream in 256 KiB
 * chunks with an exact `Content-Length` (and `Content-Encoding: identity`
 * so no intermediary re-compresses it behind our backs). Big captures are
 * multi-megabyte JSON (590 jobs ≈ 7 MB) — with a plain NextResponse.json
 * the browser's fetch shows NOTHING until the whole body arrives, which
 * reads as "the popup page is frozen". With a readable body the frontend
 * drives its own progress UI via `response.body.getReader()` and shows
 * real "4.3 MB / 7.0 MB · 1.2 MB/s" feedback. Payload content is 100%
 * unchanged (same object, same JSON) — only the transfer is chunked.
 */
const STREAM_CHUNK_BYTES = 256 * 1024;

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
  const payload = JSON.stringify({
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
      // v3.40: FSC-curve XML per job (text or ref) — merged onto the jobs
      // as `fsc_xml` and consumed by the report's one-click download set
      // (5 maps + 1 XML) and the ZIP's Final_Result/FSC.
      job_fsc_xml: session.jobFscXml,
      // Fileids whose BYTES were uploaded — the UI points these at the
      // same-origin /image/<fileid> endpoint instead of the (usually
      // mixed-content-blocked) direct CryoSmart URL.
      uploaded_image_ids: Array.from(session.imageStore.keys()),
    },
  });

  const bytes = new TextEncoder().encode(payload);
  const total = bytes.byteLength;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < total; i += STREAM_CHUNK_BYTES) {
        controller.enqueue(bytes.subarray(i, Math.min(i + STREAM_CHUNK_BYTES, total)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Exact uncompressed length — the frontend's byte-progress math
      // (received / total) depends on this staying truthful.
      "Content-Length": String(total),
      // Forbid transparent compression: a gzipped transfer would make the
      // received byte count diverge from Content-Length and break progress.
      "Content-Encoding": "identity",
      "Cache-Control": "no-store",
      ...IMPORT_SESSION_CORS,
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
