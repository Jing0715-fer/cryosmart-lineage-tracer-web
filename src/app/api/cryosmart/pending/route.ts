import { NextRequest, NextResponse } from "next/server";
import { takePending } from "@/lib/cryosmart/pending-store";

/**
 * GET /api/cryosmart/pending?token=<token>
 *
 * Returns the pending import data for a given token.
 * Single-use: data is deleted after first successful read.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
  }

  const entry = takePending(token);
  if (!entry) {
    return NextResponse.json({ ok: false, error: "Token not found or expired" }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      token,
      captured_at: entry.data.captured_at,
      data: {
        project_uid: entry.data.project_uid,
        experiment_uid: entry.data.experiment_uid,
        jobs: entry.data.jobs,
        raw: entry.data.raw,
        source_url: entry.data.source_url,
        captured_at: entry.data.captured_at,
        discovered_job_count: entry.data.discovered_job_count,
        // Include session info for image/map proxy downloads
        cryosmart_origin: entry.data.cryosmart_origin,
        cryosmart_auth: entry.data.cryosmart_auth || undefined,
        cryosmart_cookie: entry.data.cryosmart_cookie || undefined,
        // Log images force-loaded from the SPA's lazy jobLogs state
        job_log_images: entry.data.job_log_images,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export const dynamic = "force-dynamic";
