import { NextRequest, NextResponse } from "next/server";
import {
  getHistoryCapture,
  deleteHistoryEntry,
  listHistoryEntries,
} from "@/lib/cryosmart/capture-history";

/**
 * GET /api/cryosmart/history/<id>
 *
 * Full data snapshot of a persisted capture, in the SAME response shape
 * as GET /api/cryosmart/import/session/<token>/data — the web UI's
 * restore flow reuses the staged-capture merge logic verbatim (refs get
 * `src` URLs pointing at .../image/<fileid>, fileid-carrying job fields
 * are rewritten, ...), so a restored capture renders identically to a
 * live one: graph, modal, report and ZIP bundle all work unchanged.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const capture = await getHistoryCapture(id);
  if (!capture) {
    return NextResponse.json(
      { ok: false, error: "Capture not found in history." },
      { status: 404 }
    );
  }

  const logImageCount = Object.values(capture.job_log_images || {}).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0
  );
  // v3.15: fileids WITHOUT disk bytes but WITH an absolute CryoSmart URL
  // (links-only imports). The frontend unions them with uploaded_image_ids
  // so refs get same-origin srcs pointing at THIS route — which proxy-fetches
  // the remote URL when the disk lookup misses.
  const remoteImageIds = Object.keys(capture.remote_image_urls || {});

  return NextResponse.json({
    ok: true,
    token: id,
    captured_at: capture.captured_at || null,
    status: "complete",
    log_jobs_done: 0,
    log_jobs_total: 0,
    log_images_count: logImageCount,
    log_images_uploaded: (capture.image_files || []).length,
    log_images_linked: remoteImageIds.length,
    entry: {
      id: capture.id,
      label: capture.label,
      origin: capture.origin,
      end_job_uid: capture.end_job_uid,
      lineage_mode: capture.lineage_mode,
      counts: capture.counts,
    },
    data: {
      project_uid: capture.project_uid || undefined,
      experiment_uid: capture.experiment_uid || undefined,
      jobs: capture.jobs,
      raw: { jobs: capture.jobs },
      source_url: capture.source_url || undefined,
      captured_at: capture.captured_at || undefined,
      discovered_job_count: capture.jobs.length,
      // Session info for map/image proxy downloads (same semantics as the
      // live staged flow; maps likely need intranet reachability).
      cryosmart_origin: capture.cryosmart_origin || undefined,
      cryosmart_auth: capture.cryosmart_auth || undefined,
      cryosmart_cookie: capture.cryosmart_cookie || undefined,
      job_log_images: capture.job_log_images || {},
      uploaded_image_ids: (capture.image_files || []).map((f) => f.fileid),
      remote_image_ids: remoteImageIds,
    },
  });
}

/**
 * DELETE /api/cryosmart/history/<id>
 *
 * Remove one capture entry (meta + full data + image bytes) from disk.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const removed = await deleteHistoryEntry(id);
    if (!removed) {
      return NextResponse.json(
        { ok: false, error: "Capture not found in history." },
        { status: 404 }
      );
    }
    const entries = await listHistoryEntries();
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to delete capture: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
