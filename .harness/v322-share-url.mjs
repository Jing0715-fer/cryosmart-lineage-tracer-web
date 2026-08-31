/** v3.22 — load a TRIMMED fixture (tiny 8×8 PNGs) into the live app via #s=. */
import { encodeSummaryToHash } from "../src/lib/cryosmart/share-url.ts";
import { summary } from "./v322-fixture.mjs";

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const tiny = () => {
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 90 + x * 8; raw[o + 1] = 120 + y * 8; raw[o + 2] = 150;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return "data:image/png;base64," + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Bun.gzipSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
};

const T = tiny();
const clone = JSON.parse(JSON.stringify(summary));
for (const node of clone.nodes) {
  for (const im of node.representative_micrograph_images || []) {
    im.src = T; im.url = T; im.original_url = T;
  }
  for (const im of node.images || []) { im.src = T; im.url = T; im.original_url = T; }
  for (const m of node.maps || []) {
    if (m.preview_src) m.preview_src = T;
    if (m.preview_url) m.preview_url = T;
    if (m.preview_original_url) m.preview_original_url = T;
  }
  if (node.select_2d) {
    for (const k of ["selected_classes_image", "selected_classes_src", "selected_classes_original_url"]) {
      if (node.select_2d[k]) node.select_2d[k] = T;
    }
  }
}
for (const job of clone.class_split_jobs || []) {
  for (const cls of job.classes || []) {
    if (cls.mrc_preview_src) cls.mrc_preview_src = T;
    if (cls.mrc_preview_url) cls.mrc_preview_url = T;
    if (cls.mrc_preview_original_url) cls.mrc_preview_original_url = T;
  }
}
const hash = await encodeSummaryToHash(clone);
if (hash.length > 60000) {
  console.log("TOO_LONG:" + hash.length);
} else {
  console.log(hash);
}
