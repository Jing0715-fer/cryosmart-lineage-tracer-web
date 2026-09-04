import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  addLogBatchToSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
  type LogImageRef,
  type FscXmlPayload,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/logs
 *
 * STEP 3 of the staged Smart Capture flow: stream log-image batches as the
 * capture script scans jobs. Each POST advances log_jobs_done so the web UI
 * can show live progress.
 *
 * Request body (either shape):
 *   { items: [{ uid: "J374", images: [{ fileid, name, text, flags }],
 *              fsc_xml: { xml: "<?xml…" } }, ...] }
 *   { job_uid: "J374", images: [...], fsc_xml: {...} }   // single-job form
 *
 * `images` may be empty — the job still counts as scanned.
 * v3.40: `fsc_xml` (optional) carries the job's FSC-curve XML — either the
 * probed text (`xml`) or a bare `{ fileid }` ref. It is stored per job and
 * lands in the report's one-click download (5 maps + 1 XML).
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
  const items: Array<{ uid: string; images: LogImageRef[]; fsc_xml?: FscXmlPayload | null }> = [];

  if (Array.isArray(obj.items)) {
    for (const raw of obj.items) {
      const it = raw as Record<string, unknown>;
      if (!it || typeof it.uid !== "string") continue;
      items.push({
        uid: it.uid,
        images: Array.isArray(it.images) ? (it.images as LogImageRef[]) : [],
        fsc_xml: (it.fsc_xml && typeof it.fsc_xml === "object"
          ? (it.fsc_xml as FscXmlPayload)
          : null),
      });
    }
  } else if (typeof obj.job_uid === "string") {
    items.push({
      uid: obj.job_uid,
      images: Array.isArray(obj.images) ? (obj.images as LogImageRef[]) : [],
      fsc_xml: (obj.fsc_xml && typeof obj.fsc_xml === "object"
        ? (obj.fsc_xml as FscXmlPayload)
        : null),
    });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No log items found in the payload." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  addLogBatchToSession(session, items);

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
