import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  sessionImageResponse,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * GET /api/cryosmart/import/session/<token>/image/<fileid>
 *
 * Serve one uploaded log-image byte blob, same-origin. This is the URL the
 * web UI's <img>/<image> tags point at when the capture script uploaded the
 * image's bytes — unlike direct `http://<cryosmart>/api/log_image/...` URLs
 * it works from an HTTPS page (no mixed content) and needs no intranet
 * access from either the browser or the app server.
 *
 * 404s once the session expires (15-min TTL); consumers fall back to the
 * direct CryoSmart URL in that case.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; fileid: string }> }
) {
  const { token, fileid } = await ctx.params;
  const session = getImportSession(token);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found or expired." },
      { status: 404, headers: IMPORT_SESSION_CORS }
    );
  }

  // fileid arrives URL-encoded from encodeURIComponent() on the client.
  let decoded = fileid;
  try {
    decoded = decodeURIComponent(fileid);
  } catch {
    // keep raw if malformed
  }

  const resp = sessionImageResponse(session, decoded) ?? sessionImageResponse(session, fileid);
  if (!resp) {
    return NextResponse.json(
      { ok: false, error: "Image not found in this session (bytes may not have been uploaded)." },
      { status: 404, headers: IMPORT_SESSION_CORS }
    );
  }
  return resp;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
