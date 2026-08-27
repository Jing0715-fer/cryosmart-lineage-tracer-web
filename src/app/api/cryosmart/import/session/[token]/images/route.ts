import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  addImagesToSession,
  sessionProgress,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/images
 *
 * Upload the actual BYTES of captured log images. The capture script runs
 * inside the CryoSmart SPA (same-origin), so it is the only party that can
 * fetch `http://<cryosmart>/api/log_image/<fileid>` — the browser viewing
 * the web app over HTTPS cannot (mixed content), and the app server usually
 * cannot either (it sits outside the user's intranet). Uploaded bytes are
 * served back same-origin via GET .../image/<fileid>.
 *
 * Request body:
 *   { items: [{ fileid: "abc123", data: "data:image/png;base64,...", name?: "fsc.png" }] }
 *
 * Payload-size note: Next.js route handlers accept large JSON bodies; the
 * script uploads in small batches (≤8 images) and the store enforces a
 * per-image (~4 MB) and total (~192 MB) cap.
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
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems
    .map((raw) => raw as { fileid?: unknown; data?: unknown; name?: unknown })
    .filter(
      (it) =>
        it && typeof it === "object" && typeof it.fileid === "string" && typeof it.data === "string"
    );
  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No image items found in the payload." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  const stored = addImagesToSession(session, items);

  return NextResponse.json(
    { ...sessionProgress(session), stored },
    { headers: IMPORT_SESSION_CORS }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
