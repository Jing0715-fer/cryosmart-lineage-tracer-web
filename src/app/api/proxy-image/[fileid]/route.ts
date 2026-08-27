import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin image proxy for CryoSmart `log_image` thumbnails.
 *
 * Why this exists:
 *   - The web app's lineage/report UI references CryoSmart preview images
 *     directly via `<img src="http://192.168.202.11:8080/api/log_image/<fileid>">`.
 *   - Some CryoSmart deployments reject cross-origin `<img>` requests that
 *     carry an external `Referer` (or require an authenticated session
 *     cookie that the browser won't send cross-origin). Routing the image
 *     through this Next.js server-side proxy removes both issues: the
 *     request is same-origin (so no CORS / Referer concerns), and the
 *     server forwards the session cookie / Authorization header to the
 *     upstream CryoSmart instance.
 *
 * Usage:
 *   GET /api/proxy-image/<fileid>?base=<encoded origin>&cookie=<encoded Cookie>&auth=<encoded Authorization>
 *
 * - `fileid` is the CryoSmart file ID (the same value the Vue store exposes
 *   on `ui_tile_images[i].fileid`, `output_group_images[key]`, or
 *   `jobLogs['P259-J{num}'][i].imgfiles[j].fileid`).
 * - `base` defaults to `http://192.168.202.11:8080` (the user's CryoSmart
 *   server). Pass an explicit `base` to target a different instance.
 * - `cookie` and `auth` are forwarded as `Cookie` and `Authorization`
 *   headers to the upstream CryoSmart request — the same scheme used by
 *   the existing `/api/cryosmart/[...path]` route.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ fileid: string }> }
) {
  const { fileid } = await ctx.params;

  if (!fileid) {
    return NextResponse.json(
      { ok: false, error: "Missing 'fileid' path segment." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const base = url.searchParams.get("base") || "http://192.168.202.11:8080";
  const cookie = url.searchParams.get("cookie") || "";
  const auth = url.searchParams.get("auth") || "";

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

  // Build the upstream URL: `${origin}/api/log_image/<fileid>`.
  // We use encodeURI on the fileid to keep MongoDB-style IDs intact while
  // still escaping any reserved chars. (CryoSmart fileids are 24-char hex
  // in practice, so this is a no-op for the common case.)
  const targetUrl = new URL(
    `${baseUrl.origin}/api/log_image/${encodeURIComponent(fileid)}`
  );

  const headers: Record<string, string> = {
    Accept: "image/*,*/*;q=0.8",
    "User-Agent": "CryoSmartLineageTracer-Web/1.0",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (auth) headers["Authorization"] = auth;

  try {
    // 10s abort timeout — when this server can't route to the user's
    // intranet CryoSmart, the connect attempt otherwise hangs the <img>
    // onerror chain for minutes (user-visible as "images take forever").
    // Failing fast lets the report/modal swap in their placeholders.
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const contentType =
      upstream.headers.get("content-type") || "image/png";
    const arrayBuf = await upstream.arrayBuffer();

    return new NextResponse(arrayBuf, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        // Cache successful image responses for a day in the browser and
        // CDN (CryoSmart fileids are immutable). 404 / 5xx are not cached
        // because `private, max-age=0` only applies to 2xx above.
        "Cache-Control":
          upstream.status >= 200 && upstream.status < 300
            ? "public, max-age=86400"
            : "no-store",
        // Same-origin so any future fetch() from the app can read the
        // bytes if needed (e.g. canvas readback). `<img>` rendering doesn't
        // need this but it's harmless and forward-compatible.
        "Access-Control-Allow-Origin": "*",
        "X-Cryosmart-Status": String(upstream.status),
        "X-Cryosmart-Url": targetUrl.href.slice(0, 400),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to reach CryoSmart at ${targetUrl.origin}: ${message}`,
      },
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
