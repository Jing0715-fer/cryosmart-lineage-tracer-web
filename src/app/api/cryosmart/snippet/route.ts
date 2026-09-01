import { NextRequest, NextResponse } from "next/server";
import { buildConsoleSnippet } from "@/lib/cryosmart/bookmarklet";

/**
 * GET /api/cryosmart/snippet
 *
 * Returns the raw console capture snippet as plain text (no HTML escaping,
 * no markdown). The snippet-loader.html page fetches this URL and copies
 * the response to the clipboard, sidestepping any chat/markdown renderer
 * that would otherwise inject `@url:` markdown link syntax into the code.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.searchParams.get("origin") || "http://localhost:3010";
  const raw = buildConsoleSnippet(origin);
  return new NextResponse(raw, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Allow the snippet to be loaded from any origin (the loader HTML
      // is opened as a local file, which is a different origin from
      // localhost:3010 and would otherwise be blocked by CORS).
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
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
