/**
 * Share URL utilities — serialize a LineageSummary into a compressed,
 * URL-safe string that can be embedded in a URL hash fragment.
 *
 * Workflow:
 *   1. `encodeSummaryToHash(summary)` → "#s=<base64url-compressed-json>"
 *   2. User copies the URL and sends it to a colleague.
 *   3. On page load, `decodeSummaryFromHash(location.hash)` → the summary
 *      (or null if not present / invalid / corrupt).
 *
 * The compression is: JSON.stringify → UTF-8 → deflate-raw (native
 * `CompressionStream`) → base64url. We fall back to plain base64url if
 * CompressionStream is unavailable (older browsers).
 *
 * Size budget: a typical 10-50 job summary is 5-50 KB raw JSON, ~3-15 KB
 * compressed, ~4-20 KB base64url. URLs up to ~64 KB work in modern browsers;
 * beyond that we surface a warning instead of breaking the page.
 */

import type { LineageSummary } from "./types";

const HASH_PREFIX = "s=";
const MAX_URL_BYTES = 48000; // stay well under 64 KB browser limit

/* ---------------- encode ---------------- */

export async function encodeSummaryToHash(summary: LineageSummary): Promise<string> {
  // Strip heavy image bytes / preview URLs that bloat the payload without
  // being load-bearing for the lineage structure. The recipient can re-fetch
  // images via their own CryoSmart session if needed.
  const slim = stripHeavyFields(summary);
  const json = JSON.stringify(slim);
  const bytes = new TextEncoder().encode(json);

  let compressed: Uint8Array;
  try {
    compressed = await deflateRaw(bytes);
  } catch {
    compressed = bytes; // fallback: no compression
  }
  const b64 = base64UrlEncode(compressed);
  if (b64.length > MAX_URL_BYTES) {
    throw new Error(
      `Share URL too large (${b64.length} bytes > ${MAX_URL_BYTES}). The summary has ${summary.nodes?.length || 0} jobs — consider sharing the JSON file directly.`
    );
  }
  return HASH_PREFIX + b64;
}

/** Build the full shareable URL (origin + pathname + hash). */
export async function buildShareUrl(summary: LineageSummary, origin: string, pathname: string): Promise<string> {
  const hash = await encodeSummaryToHash(summary);
  return `${origin}${pathname}#${hash}`;
}

/* ---------------- decode ---------------- */

export async function decodeSummaryFromHash(hash: string): Promise<LineageSummary | null> {
  if (typeof window !== "undefined" && !hash && window.location) {
    hash = window.location.hash;
  }
  if (!hash || !hash.startsWith("#")) return null;
  const body = hash.slice(1);
  if (!body.startsWith(HASH_PREFIX)) return null;
  const b64 = body.slice(HASH_PREFIX.length);
  if (!b64) return null;

  let compressed: Uint8Array;
  try {
    compressed = base64UrlDecode(b64);
  } catch {
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = await inflateRaw(compressed);
  } catch {
    bytes = compressed; // fallback: assume uncompressed
  }

  let json: string;
  try {
    json = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }

  try {
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object" && Array.isArray(obj.nodes)) {
      return obj as LineageSummary;
    }
  } catch {
    // corrupt
  }
  return null;
}

/* ---------------- helpers ---------------- */

/** Strip fields that bloat the share payload (raw image bytes, preview URLs). */
function stripHeavyFields(summary: LineageSummary): LineageSummary {
  const clone = JSON.parse(JSON.stringify(summary)) as LineageSummary;
  // Drop image URLs — recipient can re-fetch via their session.
  if (Array.isArray(clone.nodes)) {
    for (const node of clone.nodes) {
      if (Array.isArray(node.images)) {
        node.images = node.images.map((img) => ({ ...img, url: "", src: "", original_url: "" }));
      }
      if (Array.isArray(node.representative_micrograph_images)) {
        node.representative_micrograph_images = node.representative_micrograph_images.map(
          (img) => ({ ...img, url: "", src: "", original_url: "" })
        );
      }
      if (Array.isArray(node.maps)) {
        node.maps = node.maps.map((m) => ({ ...m, download_url: "", preview_url: "" }));
      }
      if (Array.isArray(node.classes)) {
        for (const cls of node.classes) {
          cls.mrc_preview_url = null;
          if (Array.isArray(cls.maps)) {
            cls.maps = cls.maps.map((m) => ({ ...m, download_url: "" }));
          }
        }
      }
    }
  }
  // Keep focused_mermaid (it's small text, and central to the report).
  return clone;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    return bytes;
  }
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    return bytes;
  }
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    // Not deflate-raw — try raw (uncompressed) fallback.
    return bytes;
  }
}

/* base64url — URL-safe variant of base64 (+ → -, / → _, no padding) */
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
