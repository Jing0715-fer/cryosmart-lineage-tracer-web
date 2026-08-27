import { NextRequest, NextResponse } from "next/server";
import {
  createImportSession,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session
 *
 * STEP 1 of the staged Smart Capture flow. Creates an empty import session
 * and returns its token immediately (tiny payload → the capture script can
 * open the web app right away while it keeps gathering data).
 *
 * Request body:
 *   {
 *     project_uid: "P222",
 *     cryosmart_origin: "http://192.168.202.11:8080",
 *     cryosmart_auth: "Bearer eyJ..." | null,
 *     cryosmart_cookie: "..." | null,
 *     source: "CryoSmart SPA Vue Store",
 *     captured_at: "2026-..." (optional)
 *   }
 *
 * Then:
 *   POST /api/cryosmart/import/session/<token>/jobs     (step 2)
 *   POST /api/cryosmart/import/session/<token>/logs      (step 3, batched)
 *   POST /api/cryosmart/import/session/<token>/complete  (step 4)
 *   GET  /api/cryosmart/import/session/<token>           (UI progress poll)
 *   GET  /api/cryosmart/import/session/<token>/data      (UI data snapshot)
 */
export async function POST(req: NextRequest) {
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
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  const session = createImportSession({
    project_uid: str(obj.project_uid),
    experiment_uid: str(obj.experiment_uid),
    source_url: str(obj.source_url),
    captured_at: str(obj.captured_at),
    cryosmart_origin: str(obj.cryosmart_origin),
    cryosmart_auth: str(obj.cryosmart_auth),
    cryosmart_cookie: str(obj.cryosmart_cookie),
  });

  return NextResponse.json(
    {
      ok: true,
      token: session.token,
      status: session.status,
      expires_in: Math.round((session.expiresAt - Date.now()) / 1000),
    },
    { headers: IMPORT_SESSION_CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
