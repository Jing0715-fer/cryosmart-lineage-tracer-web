/** Tiny local "CryoSmart" server: serves /api/log_image/<fileid> as PNG. */
import { createServer } from "node:http";
import { deflateSync as zlib } from "node:zlib";

const B64 = (() => {
  const W = 60, H = 60;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = (x * 11 + y * 7) & 0xff;
  }
  const crc32 = (buf) => {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
})();

createServer((req, res) => {
  const m = req.url.match(/^\/api\/log_image\/([^/?#]+)/);
  if (m) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": B64.length });
    res.end(B64);
    return;
  }
  res.writeHead(404); res.end("no");
}).listen(9999, () => console.log("fake cryosmart on :9999"));
