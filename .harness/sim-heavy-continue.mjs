/** Stream all logs+bytes for the heavy sim session s4, then complete. */
const APP = "http://localhost:3000";
const TOKEN = "s4-1d7f6782b889d7a4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { deflateSync as zlib } from "node:zlib";
const B64 = (() => {
  const W = 120, H = 120;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = (x * 7 + y * 13) & 0xff;
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
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
})();
const DATA_URL = `data:image/png;base64,${B64}`;

const JOBS = 72;
const IMGS_PER_JOB = [4, 5, 6, 3, 4];
let n = 0;
for (let i = 2; i <= JOBS; i += 8) {
  const logItems = [];
  const imgItems = [];
  for (let j = i; j < Math.min(i + 8, JOBS + 1); j++) {
    const cnt = IMGS_PER_JOB[j % IMGS_PER_JOB.length];
    const images = [];
    for (let k = 0; k < cnt; k++) {
      const fid = `J${j}_log_${k}`;
      images.push({ fileid: fid, name: `img_${k}.png`, text: `log ${k}`, flags: null });
      imgItems.push({ fileid: fid, data: DATA_URL, name: `img_${k}.png` });
      n++;
    }
    logItems.push({ uid: `J${j}`, images });
  }
  const r1 = await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/logs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: logItems }),
  });
  const r2 = await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/images`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: imgItems }),
  });
  console.log(`batch J${i}-${Math.min(i + 7, JOBS)}: logs ${r1.status}, images ${r2.status} (${n} total)`);
  await sleep(1500);
}
console.log("all refs+bytes streamed:", n);
await sleep(2000);
await fetch(`${APP}/api/cryosmart/import/session/${TOKEN}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
console.log("complete");
