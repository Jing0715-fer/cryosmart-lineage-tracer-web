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
  // Optional per-request upstream timeout (ms), clamped to 1s–5min. The
  // default 10s abort is right for JSON/data calls and small images, but
  // map / .mrc downloads routinely exceed it even on fast intranets — the
  // ZIP bundle builder passes a large `timeout` for those (every map used
  // to die with "aborted due to timeout" at 10s).
  const timeoutRaw = Number(url.searchParams.get("timeout") || "");
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.min(300_000, Math.max(1_000, Math.round(timeoutRaw)))
    : 10_000;

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
    if (key === "base" || key === "cookie" || key === "auth" || key === "timeout") continue;
    targetUrl.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "CryoSmartLineageTracer-Web/1.0",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  try {
    // Abort timeout (default 10s; see `timeout` above) — unreachable
    // intranet upstreams otherwise hang the request for minutes (this
    // route backs the image base64 pre-fetch and every proxied data call).
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    // STREAM the upstream body through instead of buffering it (v3.16).
    // With the old `await upstream.arrayBuffer()` the route waited for the
    // ENTIRE body (map / .mrc volumes can be tens–hundreds of MB) before
    // sending the first byte to the browser — every large download paid
    // BOTH network legs serially (CryoSmart→server, then server→browser),
    // roughly doubling per-file latency, and held a full extra copy in
    // server memory per concurrent download. Passing the ReadableStream
    // straight through lets both legs overlap and keeps peak memory at
    // chunk size. Connection-level failures still reject the fetch() above
    // (before headers arrive) so the 502 "Failed to reach" contract used
    // by probeCryosmartReachable() and the bundle's unreachable-mid-run
    // detection is unchanged; a mid-body abort now surfaces as a network
    // error in the caller's arrayBuffer() instead, which every consumer
    // already treats as a per-item failure.
    return new NextResponse(upstream.body ?? null, {
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
