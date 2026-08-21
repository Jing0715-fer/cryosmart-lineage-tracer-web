import { NextRequest, NextResponse } from "next/server";
import { putPending } from "@/lib/cryosmart/pending-store";

/**
 * POST /api/cryosmart/import
 *
 * Receives metadata captured by the bookmarklet (which runs inside the
 * CryoSmart tab, same-origin, so cookies are auto-attached).
 *
 * Request body shape:
 *   {
 *     project_uid: "P52",
 *     experiment_uid: "EXP1",
 *     source_url: "http://192.168.4.3:8080/#/projects/P52",
 *     jobs: [...]  // raw CryoSmart job metadata array
 *   }
 *
 * OR the request body can be the raw array directly:
 *   [ {...}, {...}, ... ]
 *
 * Returns:
 *   { ok: true, token: "12-a1b2c3d4", count: 47, expires_in: 600 }
 *
 * The token is single-use and expires in 10 minutes.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  let projectUid: string | undefined;
  let experimentUid: string | undefined;
  let jobs: unknown[] | undefined;
  let raw: unknown = body;
  let sourceUrl: string | undefined;

  if (Array.isArray(body)) {
    jobs = body;
  } else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) jobs = obj.jobs;
    if (typeof obj.project_uid === "string") projectUid = obj.project_uid;
    if (typeof obj.experiment_uid === "string") experimentUid = obj.experiment_uid;
    if (typeof obj.source_url === "string") sourceUrl = obj.source_url;
    // If the body is the export wrapper, jobs may already be inside.
    if (jobs === undefined && Array.isArray((obj as { jobs?: unknown[] }).jobs)) {
      jobs = (obj as { jobs: unknown[] }).jobs;
    }
  }

  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No jobs array found in the imported payload." },
      { status: 400 }
    );
  }

  // Try to infer project_uid from the source URL hash if missing.
  if (!projectUid && sourceUrl) {
    const m = sourceUrl.match(/#\/projects\/([^/?#]+)/i);
    if (m) projectUid = m[1];
  }
  if (!projectUid && jobs.length > 0) {
    const first = jobs[0] as Record<string, unknown> | undefined;
    if (first && typeof first.project_uid === "string") projectUid = first.project_uid;
  }

  const token = putPending({
    project_uid: projectUid,
    experiment_uid: experimentUid,
    jobs,
    raw,
    source_url: sourceUrl,
    captured_at: new Date().toISOString(),
    discovered_job_count: jobs.length,
  });

  return NextResponse.json({
    ok: true,
    token,
    count: jobs.length,
    project_uid: projectUid || null,
    expires_in: 600,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Cryosmart-Capture",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
