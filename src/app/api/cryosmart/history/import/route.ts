import { NextRequest, NextResponse } from "next/server";
import { importCaptureJson } from "@/lib/cryosmart/capture-history";

/**
 * POST /api/cryosmart/history/import
 *
 * Create a new capture-history entry from a portable
 * `cryosmart-capture/v1` JSON (exported by another instance of this app —
 * the migration path), or from a legacy `{ jobs: [...] }` project
 * metadata JSON (no images, jobs only).
 *
 * Embedded image bytes (images[].data) are written to the entry's binary
 * store, so a fully-embedded export restores pixel-perfect offline.
 * Links-only exports restore the metadata + refs; their images fall back
 * to the absolute CryoSmart URLs (renderable wherever the browser can
 * reach the intranet server).
 *
 * Returns the created entry summary.
 */

/** Hard cap on the request body (embedded-image exports can be large). */
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Import too large (${Math.round(contentLength / 1048576)} MB > 512 MB cap). Export without embedded images and keep the bytes on the original instance.`,
      },
      { status: 413 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body is not valid JSON." },
      { status: 400 }
    );
  }

  try {
    const result = await importCaptureJson(payload);
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unrecognized format — expected a cryosmart-capture/v1 export or a { jobs: [...] } project metadata JSON.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      entry: result.meta,
      embedded_images: result.embeddedImages,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Import failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
