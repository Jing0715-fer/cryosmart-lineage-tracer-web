import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Flow-figure asset relay (v3.41).
 *
 * When the user's ChimeraX cannot fetch a volume map straight from the
 * intranet CryoSmart server (auth/cookies live in the browser, not in
 * ChimeraX), the PAGE downloads the .mrc bytes with the user's session and
 * POSTs them here; ChimeraX then `open`s the returned public URL. Assets are
 * kept in memory with a sliding 45-minute TTL and an aggregate size cap.
 */

interface AssetEntry {
  bytes: Uint8Array;
  name: string;
  mime: string;
  createdAt: number;
}

const TTL_MS = 45 * 60 * 1000;
const MAX_TOTAL_BYTES = 900 * 1024 * 1024;
const MAX_ASSET_BYTES = 600 * 1024 * 1024;

function store(): Map<string, AssetEntry> {
  const g = globalThis as typeof globalThis & { __cryoFlowAssets?: Map<string, AssetEntry> };
  if (!g.__cryoFlowAssets) g.__cryoFlowAssets = new Map<string, AssetEntry>();
  return g.__cryoFlowAssets;
}

function sweep() {
  const s = store();
  const now = Date.now();
  for (const [id, entry] of s) {
    if (now - entry.createdAt > TTL_MS) s.delete(id);
  }
  let total = 0;
  for (const entry of s.values()) total += entry.bytes.byteLength;
  while (total > MAX_TOTAL_BYTES && s.size) {
    // Evict the oldest entry.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [id, entry] of s) {
      if (entry.createdAt < oldestAt) {
        oldestAt = entry.createdAt;
        oldestKey = id;
      }
    }
    if (!oldestKey) break;
    total -= s.get(oldestKey)?.bytes.byteLength ?? 0;
    s.delete(oldestKey);
  }
}

export async function POST(req: NextRequest) {
  sweep();
  const name = req.nextUrl.searchParams.get("name") || "map.mrc";
  const mime = req.nextUrl.searchParams.get("mime") || "application/octet-stream";
  const buf = await req.arrayBuffer().catch(() => null);
  if (!buf || !buf.byteLength) {
    return Response.json({ error: "empty body" }, { status: 400 });
  }
  if (buf.byteLength > MAX_ASSET_BYTES) {
    return Response.json({ error: "asset too large", size: buf.byteLength }, { status: 413 });
  }
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  store().set(id, { bytes: new Uint8Array(buf), name, mime, createdAt: Date.now() });
  const url = `/api/cryosmart/flow-figure/asset?id=${id}&name=${encodeURIComponent(name)}`;
  return Response.json({ id, url, bytes: buf.byteLength, name });
}

export async function GET(req: NextRequest) {
  sweep();
  const id = req.nextUrl.searchParams.get("id") || "";
  const entry = store().get(id);
  if (!entry) {
    return Response.json({ error: "asset not found or expired" }, { status: 404 });
  }
  return new Response(entry.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(entry.bytes.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(entry.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
