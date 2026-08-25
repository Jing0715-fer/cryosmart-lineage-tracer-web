import { NextRequest, NextResponse } from "next/server";

/**
 * CryoSmart backend proxy.
 *
 * Live-mode web app cannot directly fetch() CryoSmart from the browser because
 * of CORS + HttpOnly session cookies. This server-side route forwards an
 * authenticated request to the user's CryoSmart instance.
 *
 * Usage:
 *   GET /api/cryosmart/[...path]?base=<encoded origin>&cookie=<encoded cookie header>&auth=<encoded Authorization header>
 *
 * The `[...path]` segment becomes the CryoSmart URL path (e.g.
 * `api/projects/P52/jobs` → `${base}/api/projects/P52/jobs`).
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const url = new URL(req.url);
  const base = url.searchParams.get("base") || "";
  const cookie = url.searchParams.get("cookie") || "";
  const auth = url.searchParams.get("auth") || "";

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "Missing 'base' query parameter (CryoSmart origin, e.g. http://192.168.4.3:8080)." },
      { status: 400 }
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return NextResponse.json(
      { ok: false, error: `Invalid 'base' URL: ${base}` },
      { status: 400 }
    );
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    return NextResponse.json(
      { ok: false, error: `Unsupported protocol: ${baseUrl.protocol}` },
      { status: 400 }
    );
  }

  // Re-join the path segments WITHOUT re-encoding slashes (Next.js already
  // decodes the [...path] segments, but slashes inside a segment are kept).
  const cryosmartPath = path.map(encodeURIComponent).join("/").replace(/%2F/gi, "/");
  const targetUrl = new URL(baseUrl.origin + "/" + cryosmartPath);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "base" || key === "cookie" || key === "auth") continue;
    targetUrl.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "CryoSmartLineageTracer-Web/1.0",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
    });

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const arrayBuf = await upstream.arrayBuffer();

    return new NextResponse(arrayBuf, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Cryosmart-Status": String(upstream.status),
        "X-Cryosmart-Url": targetUrl.href.slice(0, 400),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Failed to reach CryoSmart at ${targetUrl.origin}: ${message}` },
      { status: 502 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
