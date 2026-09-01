import { NextRequest, NextResponse } from "next/server";
import {
  getImportSession,
  setSessionPhase,
  IMPORT_SESSION_CORS,
} from "@/lib/cryosmart/import-session-store";

/**
 * POST /api/cryosmart/import/session/<token>/phase
 *
 * v3.29 sub-step visibility. The staged capture's progress strip used to
 * show ONLY the aggregate counters (jobs scanned / image refs / uploaded
 * bytes) — all of which sit at ZERO for the entire loader-calibration
 * stretch (lazy-job classification + action×shape calibration + HTTP
 * fallback probing, easily 30–120s on a real 593-job build before the
 * FIRST /logs batch can stream). Users read that as "stuck at 0/72, 0%".
 *
 * The script now fire-and-forgets its current sub-step here:
 *   { phase: "calibrating", detail: "calibrating the log loader on J45 — action 'getJobDetail' arg shape 2/6…" }
 *   { phase: "scan",       detail: "scanning 13/72 · J13 (class_3d)" }
 *   { phase: "rescue" | "grace" | "rest" | "drain", detail: "…" }
 * and the status GET returns script_phase/phase_detail/phase_at, which the
 * strip renders with a liveness age ("3s ago"). Every POST also bumps
 * `updatedAt`, so phase updates double as heartbeats during stretches
 * where no counter can legitimately move (keeps the 10-min stall detector
 * from firing on a healthy calibration).
 *
 * Fire-and-forget semantics: a lost POST just leaves a stale detail line —
 * never an error worth surfacing.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const session = getImportSession(token);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found or expired." },
      { status: 404, headers: IMPORT_SESSION_CORS }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  const bodyObj = body as { phase?: unknown; detail?: unknown } | null;
  // Length caps: the detail is rendered in the strip — keep it a one-liner.
  const phase =
    typeof bodyObj?.phase === "string" ? bodyObj.phase.slice(0, 40).trim() : "";
  const detail =
    typeof bodyObj?.detail === "string" ? bodyObj.detail.slice(0, 220).trim() : "";
  if (!phase) {
    return NextResponse.json(
      { ok: false, error: "Missing phase." },
      { status: 400, headers: IMPORT_SESSION_CORS }
    );
  }

  setSessionPhase(session, phase, detail);
  return NextResponse.json({ ok: true }, { headers: IMPORT_SESSION_CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: IMPORT_SESSION_CORS });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
