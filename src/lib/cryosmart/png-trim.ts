/**
 * v3.75 (round-34 “优化框选中和图片的比例，框不要比图大太多”): browser-safe
 * transparent-margin PNG trim.
 *
 * The ChimeraX class renders are 1600×800 PNGs whose actual map content
 * occupies only ~45–55 % of the frame — `transparentBackground: true`
 * leaves huge alpha margins, so the workflow PPTX's selection frames
 * boxed a mostly-empty rectangle around a small floating map. Every
 * embedded PNG is now alpha-trimmed to its content bounding box (+2 px
 * pad) BEFORE layout, so the thumbnail AND its frame hug the map.
 *
 * Zero dependencies and runnable in the BROWSER (the workflow PPTX is
 * assembled client-side) as well as under bun/node:
 *   - inflate  : DecompressionStream("deflate")  — the Streams API's
 *                "deflate" is the zlib wrapper (RFC 1950) PNG IDAT uses;
 *   - deflate  : CompressionStream("deflate");
 *   - CRC-32   : table-based, hand-rolled.
 * When either stream constructor is missing (old Safari) or the PNG is
 * not plain 8-bit RGBA / non-interlaced / fully transparent / already
 * tight, the original bytes are returned untouched — trimming is always
 * a best-effort enhancement, never a failure.
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/* ------------------------------------------------------------------ */
/* CRC-32 (PNG chunk checksums)                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One length-typed-crc'd PNG chunk; `data` may be empty (IEND). */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/* ------------------------------------------------------------------ */
/* zlib (de)compression via the Streams API                            */
/* ------------------------------------------------------------------ */

function streamSupported(): boolean {
  return (
    typeof DecompressionStream !== "undefined" &&
    typeof CompressionStream !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof Response !== "undefined"
  );
}

async function pipeZlib(bytes: Uint8Array, deflate: boolean): Promise<Uint8Array> {
  const Through = (globalThis as { [k: string]: unknown })[
    deflate ? "CompressionStream" : "DecompressionStream"
  ] as new (format: string) => TransformStream<Uint8Array, Uint8Array>;
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new Through("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* PNG scanline unfiltering (8-bit, bpp = bytes per pixel)             */
/* ------------------------------------------------------------------ */

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo PNG row filters in place over the raw IDAT stream → tight RGBA. */
function unfilter(raw: Uint8Array, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const img = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + stride);
    const filter = raw[rowStart];
    const src = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const cur = img.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? img.subarray((y - 1) * stride, y * stride) : null;
    if (filter === 0) {
      cur.set(src);
    } else if (filter === 1) {
      for (let i = 0; i < stride; i++) cur[i] = (src[i] + (i >= bpp ? cur[i - bpp] : 0)) & 0xff;
    } else if (filter === 2) {
      if (prev) for (let i = 0; i < stride; i++) cur[i] = (src[i] + prev[i]) & 0xff;
      else cur.set(src);
    } else if (filter === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        cur[i] = (src[i] + ((left + up) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const ul = prev && i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (src[i] + paeth(left, up, ul)) & 0xff;
      }
    } else {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
  return img;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface TrimResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  trimmed: boolean;
}

/**
 * Trim a PNG's transparent margins. Only plain 8-bit RGBA (colorType 6),
 * non-interlaced PNGs are processed — everything else (RGB, palette,
 * 16-bit, interlaced, JPEG-misnamed…) is returned as-is. The returned
 * width/height always describe the OUTPUT bytes (cropped or original),
 * so callers can skip a separate IHDR parse.
 */
/** Alpha-trim a PNG to its content bounding box.
 *
 * v3.87 (round-47 “框也有问题” — renders touching/cut at the image
 * edges): `pad` adds a transparent margin of that many pixels AROUND the
 * content — synthesized beyond the original canvas when the content
 * touched it, so every placed thumbnail keeps a breathing gap from its
 * slot/selection frame. The v3.75 default (pad 2, clamped inside the
 * canvas) is unchanged for existing callers. */
export async function trimPngAlpha(
  bytes: Uint8Array,
  alphaThreshold = 8,
  pad = 2,
): Promise<TrimResult> {
  const original = (): TrimResult => {
    const dims = pngDimsOf(bytes);
    return { bytes, width: dims?.width ?? 1, height: dims?.height ?? 1, trimmed: false };
  };
  if (!isPng(bytes) || !streamSupported()) return original();

  /* chunk walk: IHDR + every IDAT */
  let w = 0;
  let h = 0;
  let colorType = -1;
  let bitDepth = -1;
  let interlace = -1;
  const idats: Uint8Array[] = [];
  let pos = 8;
  let sawEnd = false;
  while (pos + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const start = pos + 8;
    const end = start + len;
    if (end + 4 > bytes.length) return original();
    if (type === "IHDR" && len >= 13) {
      w = view.getUint32(start);
      h = view.getUint32(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "IDAT") {
      idats.push(bytes.subarray(start, end));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    pos = end + 4;
  }
  if (!w || !h || !idats.length || !sawEnd) return original();
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return original();

  /* inflate once */
  const zlen = idats.reduce((s, c) => s + c.length, 0);
  const zbuf = new Uint8Array(zlen);
  let zo = 0;
  for (const c of idats) {
    zbuf.set(c, zo);
    zo += c.length;
  }
  let raw: Uint8Array;
  try {
    raw = await pipeZlib(zbuf, false);
  } catch {
    return original();
  }
  const stride = w * 4;
  if (raw.length !== h * (1 + stride)) return original();

  /* unfilter (any of filters 0–4 per row) */
  let img: Uint8Array;
  try {
    img = unfilter(raw, w, h, 4);
  } catch {
    return original();
  }

  /* content bbox: any pixel with alpha above the threshold */
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      if (img[row + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return original(); // fully transparent — leave untouched
  /* The DESIRED output box (source coordinates): the tight content bbox
   * grown by `pad` px on every side — outW/outH are exactly content + 2×pad
   * (never double-padded, never wider). Where the box extends past the
   * original canvas the re-encode below synthesizes transparent pixels; the
   * in-canvas intersection is copied verbatim. */
  const padPx = Math.max(0, Math.min(256, Math.round(pad)));
  const cw0 = maxX - minX + 1;
  const ch0 = maxY - minY + 1;
  const outW = cw0 + 2 * padPx;
  const outH = ch0 + 2 * padPx;
  const originX = minX - padPx; // source x of output column 0
  const originY = minY - padPx; // source y of output row 0
  if (outW === w && outH === h && minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) {
    return original(); // content IS the canvas and pad adds nothing
  }

  /* re-encode: copy each row's in-canvas segment, transparent elsewhere */
  const outStride = outW * 4;
  const out = new Uint8Array(outH * (1 + outStride));
  for (let y = 0; y < outH; y++) {
    const o = y * (1 + outStride);
    out[o] = 0; // filter: none
    const sy = originY + y;
    if (sy < 0 || sy >= h) continue; // beyond the canvas — fully transparent row
    const segX0 = Math.max(0, originX);
    const segX1 = Math.min(w, originX + outW);
    if (segX1 <= segX0) continue;
    const dst = out.subarray(o + 1 + (segX0 - originX) * 4, o + 1 + (segX1 - originX) * 4);
    const src = img.subarray(sy * stride + segX0 * 4, sy * stride + segX1 * 4);
    dst.set(src);
  }
  let idat: Uint8Array;
  try {
    idat = await pipeZlib(out, true);
  } catch {
    return original();
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, outW);
  hv.setUint32(4, outH);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array(PNG_SIG);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return { bytes: png, width: outW, height: outH, trimmed: true };
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && PNG_SIG.every((b, i) => bytes[i] === b);
}

function pngDimsOf(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
