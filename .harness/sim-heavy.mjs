/**
 * HEAVY staged-capture simulator mirroring the user's real v3.38 run:
 * 72-job lineage chain, ~230 log images (~40KB each), refs streamed in
 * batches with bytes following, progressive /data churn, then /complete.
 *
 * Mirrors the real capture rhythm: ~4s per batch pair (refs + bytes), so
 * the app's poll loop applies progressive /data snapshots repeatedly
 * (dataVersion churn → summary rebuilds → embed-effect restarts), exactly
 * like the user's live run.
 */
import { deflateSync as zlib } from "node:zlib";
const APP = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ~40KB PNG (1x1 scaled): real-ish payload size for session-image fetches
const B64 = (() => {
  // Build a 160x160 RGB PNG with noise-ish rows (deflate-stored ≈ 75KB → base64 ≈ 100KB? keep smaller)
  const W = 120, H = 120;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter type 0
    for (let x = 0; x < W * 3; x++) {
      raw[y * (W * 3 + 1) + 1 + x] = (x * 7 + y * 13) & 0xff;
    }
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
})();
const DATA_URL = `data:image/png;base64,${B64}`;
console.log("image payload:", (B64.length / 1024).toFixed(1), "KB base64");

const JOBS = 72;
const IMGS_PER_JOB = [4, 5, 6, 3, 4]; // ~230 total

async function main() {
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "PHX",
      cryosmart_origin: "http://192.168.202.11:8080",
      cryosmart_auth: "Bearer sim-token",
      source: "sim",
      end_job_uid: `J${JOBS}`,
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  console.log("TOKEN=" + token);

  const jobs = [];
  for (let i = 1; i <= JOBS; i++) {
    jobs.push({
      uid: `J${i}`,
      job_type: i === 1 ? "import_micrographs" : i % 5 === 0 ? "class_3d" : i % 3 === 0 ? "hetero_refine" : "nu_refine",
      status: "completed", project_uid: "PHX",
      title: `job ${i}`, created_at: "2026-08-20T10:00:00Z", completed_at: "2026-08-21T12:00:00Z",
      parents: i === 1 ? [] : [`J${i - 1}`], children: i === JOBS ? [] : [`J${i + 1}`],
      input_slot_groups: i === 1 ? [] : [{ name: "particles", type: "particle", title: "particles", connections: [{ job_uid: `J${i - 1}`, group_name: "movies" }] }],
      output_result_groups: [{ name: "volume", type: "volume", title: "volume", contains: [{ type: "volume.blob", name: "map" }] }],
      params_spec: {}, output_group_images: { volume: `vol_${i}` }, ui_tile_images: [],
    });
  }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "PHX", jobs }),
  });
  console.log("jobs posted:", JOBS);

  // let the browser land + auto-trace
  await sleep(20000);

  // stream logs + bytes in batches (churn the data sig like the real capture)
  let n = 0;
  for (let i = 2; i <= JOBS; i += 4) {
    const logItems = [];
    const imgItems = [];
    for (let j = i; j < Math.min(i + 4, JOBS + 1); j++) {
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
    await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: logItems }),
    });
    await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: imgItems }),
    });
    if (i % 12 === 2) console.log(`streamed through J${Math.min(i + 3, JOBS)} — ${n} images`);
    await sleep(4000);
  }
  console.log("all refs+bytes streamed:", n);

  await sleep(3000);
  await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  console.log("complete");
}
main().catch((e) => { console.error(e); process.exit(1); });
