/* Offline sanity check (r47): trimPngAlpha's new `pad` parameter —
 * (1) default pad 2 keeps the v3.75 semantics (crop + in-canvas breathing);
 * (2) pad 40 synthesizes transparent margins BEYOND the canvas when the
 * content touched the edges (the round-47 edge-crop case), content intact
 * and centered; (3) round-trips through a PNG decode of our own making.
 * Run: bun .harness/r47-trim-pad.ts */
import { trimPngAlpha } from "../src/lib/cryosmart/png-trim";
import { inflateSync } from "node:zlib";

let failures = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

/* ---- tiny PNG builder (RGBA, filter-0 rows) ---- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
const buildPng = (w: number, h: number, paint: (x: number, y: number) => [number, number, number, number] | null) => {
  const stride = w * 4;
  const raw = new Uint8Array(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + stride);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const px = paint(x, y);
      const i = o + 1 + x * 4;
      if (px) raw.set(px, i);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(require("node:zlib").deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
};
const decodeRgba = (png: Uint8Array): { w: number; h: number; px: Uint8Array } => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  const idats: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (type === "IDAT") idats.push(png.subarray(pos + 8, pos + 8 + len));
    pos = pos + 8 + len + 4;
  }
  const zlen = idats.reduce((s, c) => s + c.length, 0);
  const zbuf = new Uint8Array(zlen);
  let zo = 0;
  for (const c of idats) {
    zbuf.set(c, zo);
    zo += c.length;
  }
  const raw = inflateSync(zbuf);
  const stride = w * 4;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    // our own encoder always uses filter 0 — but the trimmer's output too
    const o = y * (1 + stride);
    const filter = raw[o];
    const row = raw.subarray(o + 1, o + 1 + stride);
    for (let x = 0; x < stride; x++) {
      let v = row[x];
      if (filter === 1) v = (v + (x >= 4 ? px[y * stride * 1 + x - 4] : 0)) & 0xff;
      else if (filter === 2) v = (v + (y > 0 ? px[(y - 1) * stride + x] : 0)) & 0xff;
      else if (filter === 3) v = (v + ((x >= 4 ? px[y * stride + x - 4] : 0) + (y > 0 ? px[(y - 1) * stride + x] : 0)) / 2) & 0xff;
      else if (filter === 4) {
        const a = x >= 4 ? px[y * stride + x - 4] : 0;
        const b = y > 0 ? px[(y - 1) * stride + x] : 0;
        const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      px[y * stride + x] = v;
    }
  }
  return { w, h, px };
};

/* ---- case 1: default pad 2 — interior content, in-canvas breathing ---- */
{
  const png = buildPng(40, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [255, 0, 0, 255] : null));
  const res = await trimPngAlpha(png);
  ok(res.trimmed, "interior content trims", `${res.width}x${res.height}`);
  ok(res.width === 14 && res.height === 14, "default pad 2: content 10×10 + 2px each side = 14×14", `${res.width}x${res.height}`);
  const dec = decodeRgba(res.bytes);
  const center = dec.px[(7 * dec.w + 7) * 4 + 3];
  const corner = dec.px[0 * dec.w * 0 + 3];
  ok(center === 255, "content survives at the centre (alpha 255)");
  ok(corner === 0, "corner is the transparent breathing pad");
}
/* ---- case 2: pad 40 with content TOUCHING the canvas edges ---- */
{
  const png = buildPng(60, 50, (x, y) => (x >= 0 && x < 60 && y >= 0 && y < 50 ? [0, 128, 255, 255] : null));
  const res = await trimPngAlpha(png, 8, 40);
  ok(res.trimmed, "edge-touching content trims with pad", `${res.width}x${res.height}`);
  ok(res.width === 60 + 80 && res.height === 50 + 80, "synthesized margins: 60+80 × 50+80", `${res.width}x${res.height}`);
  const dec = decodeRgba(res.bytes);
  let allOpaque = true;
  let marginClear = true;
  for (let y = 0; y < dec.h; y++) {
    for (let x = 0; x < dec.w; x++) {
      const a = dec.px[(y * dec.w + x) * 4 + 3];
      const inContent = x >= 40 && x < 40 + 60 && y >= 40 && y < 40 + 50;
      if (inContent && a !== 255) allOpaque = false;
      if (!inContent && a !== 0) marginClear = false;
    }
  }
  ok(allOpaque, "content intact and opaque at offset (40,40)");
  ok(marginClear, "the 40px synthesized margin is fully transparent");
}
/* ---- case 3: pad 40 with content touching only ONE edge ---- */
{
  const png = buildPng(60, 50, (x, y) => (x >= 0 && x < 30 && y >= 5 && y < 45 ? [255, 255, 0, 255] : null));
  const res = await trimPngAlpha(png, 8, 40);
  const dec = decodeRgba(res.bytes);
  // content 30×40 at canvas (0,5): left pad fully synthesized, right pad
  // partially in-canvas — the decode must show opaque EXACTLY on the content.
  let bounds = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  for (let y = 0; y < dec.h; y++) {
    for (let x = 0; x < dec.w; x++) {
      if (dec.px[(y * dec.w + x) * 4 + 3] > 8) {
        bounds.x0 = Math.min(bounds.x0, x);
        bounds.y0 = Math.min(bounds.y0, y);
        bounds.x1 = Math.max(bounds.x1, x);
        bounds.y1 = Math.max(bounds.y1, y);
      }
    }
  }
  ok(res.width === 30 + 80 && res.height === 40 + 80, "one-edge case: 110×120", `${res.width}x${res.height}`);
  ok(bounds.x0 === 40 && bounds.y0 === 40 && bounds.x1 === 69 && bounds.y1 === 79, "content sits exactly at the 40px inset", JSON.stringify(bounds));
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL TRIM-PAD ASSERTIONS PASSED");
process.exit(failures ? 1 : 0);
