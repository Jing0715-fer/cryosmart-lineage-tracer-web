import { NextRequest, NextResponse } from "next/server";
import {
  getHistoryCapture,
  exportCaptureJson,
  exportFilename,
} from "@/lib/cryosmart/capture-history";

/**
 * GET /api/cryosmart/history/<id>/export
 *   ?embed=1        include every image's bytes as base64 data URLs
 *                   (self-contained; file grows to the size of the images)
 *   ?credentials=1  include the captured CryoSmart auth/cookie — needed
 *                   when the server requires login to re-download
 *
 * Download the portable `cryosmart-capture/v1` metadata document: jobs,
 * log-image refs, every image with its ABSOLUTE CryoSmart URL (plus
 * embedded bytes when asked), and every downloadable map's absolute URL.
 *
 * Can it re-download everything from the JSON alone? YES for images and
 * maps — provided the reading machine can reach the CryoSmart intranet
 * server (pass credentials when it requires login). With `embed=1` the
 * IMAGES become fully self-contained (no network needed at all); maps are
 * multi-MB/GB binaries and are never embedded — they always download via
 * their URLs from a machine with intranet access.
 */
export async function GET(
  req: NextRequest,
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

  const embed = req.nextUrl.searchParams.get("embed") === "1";
  const credentials = req.nextUrl.searchParams.get("credentials") === "1";

  try {
    const doc = await exportCaptureJson(capture, {
      embedImages: embed,
      includeCredentials: credentials,
    });
    const filename = exportFilename(capture);
    return new NextResponse(JSON.stringify(doc), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Export failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
