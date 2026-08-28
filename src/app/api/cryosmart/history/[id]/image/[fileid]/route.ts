import { NextRequest, NextResponse } from "next/server";
import {
  getHistoryCapture,
  historyImageResponse,
} from "@/lib/cryosmart/capture-history";

/**
 * GET /api/cryosmart/history/<id>/image/<fileid>
 *
 * Serve one persisted image byte blob, same-origin. History images are
 * IMMUTABLE (an entry is rewritten only as a whole), so they get a
 * one-year cache header — unlike the 45-min session-image endpoint.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; fileid: string }> }
) {
  const { id, fileid } = await ctx.params;
  const capture = await getHistoryCapture(id);
  if (!capture) {
    return NextResponse.json(
      { ok: false, error: "Capture not found in history." },
      { status: 404 }
    );
  }

  // fileid arrives URL-encoded from encodeURIComponent() on the client.
  let decoded = fileid;
  try {
    decoded = decodeURIComponent(fileid);
  } catch {
    // keep raw if malformed
  }

  const resp =
    (await historyImageResponse(capture, decoded, { allowRemote: true })) ??
    (await historyImageResponse(capture, fileid, { allowRemote: true }));
  if (!resp) {
    return NextResponse.json(
      { ok: false, error: "Image not found in this capture." },
      { status: 404 }
    );
  }
  return resp;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
