import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Serves the in-ChimeraX flow bridge script with the CURRENT public origin
 * baked into its allow-list, so the browser page can talk to the bridge on
 * the user's machine (ChimeraX CORS-relay — same internal mechanism as the
 * official `mcp` bridge, but origin-locked to this web app).
 *
 * Usage from ChimeraX:
 *   open <origin>/api/cryosmart/flow-figure/relay.py
 */
export async function GET(req: NextRequest) {
  try {
    const file = path.join(process.cwd(), "public", "helpers", "CryoSmart_flow_relay.py");
    let src = await readFile(file, "utf8");
    const origin = req.nextUrl.origin;
    // The script ships with `ALLOWED_ORIGINS = ["__APP_ORIGIN__"]`.
    if (src.includes("__APP_ORIGIN__")) {
      src = src.replace('"__APP_ORIGIN__"', JSON.stringify(origin));
    }
    return new Response(src, {
      status: 200,
      headers: {
        "Content-Type": "text/x-python; charset=utf-8",
        "Content-Disposition": 'inline; filename="CryoSmart_flow_relay.py"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "relay script unavailable", message: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
