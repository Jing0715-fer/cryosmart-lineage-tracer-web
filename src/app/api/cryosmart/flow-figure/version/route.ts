import { FLOW_ENGINE_VERSION } from "@/lib/cryosmart/flow-engine-version";

export const dynamic = "force-dynamic";

/**
 * Live engine version for the stale-page check (v3.50).
 *
 * The browser card embeds FLOW_ENGINE_VERSION in its bundle; before every
 * workflow-figure run (and once at mount) it fetches this route and compares.
 * A mismatch means the page is an old tab/bundle still running against a
 * newer server — the run is blocked with a refresh instruction instead of
 * silently misbehaving (the round-9 stale-tab failure mode).
 */
export async function GET() {
  return Response.json(
    { version: FLOW_ENGINE_VERSION, ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
