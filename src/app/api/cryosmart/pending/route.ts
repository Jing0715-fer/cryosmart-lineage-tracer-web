import { NextRequest, NextResponse } from "next/server";
import { takePending, peekPending } from "@/lib/cryosmart/pending-store";

/**
 * GET /api/cryosmart/pending?token=<token>
 *
 * Returns the bookmarklet-imported metadata for the given token.
 * Single-use: once read successfully, the token is consumed.
 *
 * Returns:
 *   - 200 { ok: true, data: { project_uid, jobs, ... } } on success
 *   - 404 { ok: false, error: "Token not found or already consumed." } on miss
 *   - 410 { ok: false, error: "Token expired." } on TTL expiry
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing 'token' query parameter." },
      { status: 400 }
    );
  }

  const entry = takePending(token);
  if (!entry) {
    // Distinguish "never existed / already consumed" from "expired".
    const peek = peekPending(token);
    if (peek.expired) {
      return NextResponse.json(
        { ok: false, error: "Token expired. Please re-run the bookmarklet." },
        { status: 410 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Token not found or already consumed. Please re-run the bookmarklet.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    token,
    captured_at: entry.data.captured_at || null,
    data: entry.data,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
