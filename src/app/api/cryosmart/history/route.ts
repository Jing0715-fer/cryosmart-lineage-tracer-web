import { NextRequest, NextResponse } from "next/server";
import { getImportSession } from "@/lib/cryosmart/import-session-store";
import { listHistoryEntries, saveSessionToHistory } from "@/lib/cryosmart/capture-history";

/**
 * GET /api/cryosmart/history
 *
 * List every persisted capture (newest first). Reads only the tiny
 * meta.json files — the heavy jobs/image data stays on disk until a
 * restore actually asks for it.
 */
export async function GET() {
  try {
    const entries = await listHistoryEntries();
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to list capture history: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cryosmart/history   body: { token }
 *
 * Manually snapshot a (live or completed) staged import session to the
 * capture history — the escape hatch for captures whose script stalled or
 * whose 45-min TTL is about to expire. Completed captures are ALSO saved
 * automatically (see the /complete route); a manual save with the same
 * token simply rewrites the same history entry.
 */
export async function POST(req: NextRequest) {
  let token = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    // fall through with empty token
  }
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing `token` (the staged-capture session token)." },
      { status: 400 }
    );
  }
  const session = getImportSession(token);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found or expired — re-run the capture script." },
      { status: 404 }
    );
  }
  if (!Array.isArray(session.data.jobs) || session.data.jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "This session has no job data yet — nothing to save." },
      { status: 400 }
    );
  }
  try {
    const meta = await saveSessionToHistory(session);
    if (!meta) {
      return NextResponse.json(
        { ok: false, error: "Nothing to save (no jobs)." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, entry: meta });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed to save capture: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
