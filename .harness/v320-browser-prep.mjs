/**
 * v3.20 browser-E2E prep — staged session with UI-TILE images (the exact
 * asset class the user reported missing from the report), uploaded as
 * real PNG bytes, completed, and SNAPSHOTTED to capture history so the
 * browser test can exercise the restore-from-history → blob-report path
 * (the v3.19 regression: history image URLs were relative and broke in
 * the blob: new-tab context → ui title images vanished silently).
 *
 * Lineage: PX20 / J1 import_micrographs (3 ui tiles) → J2 refine (1 map,
 * preview via output_group_images).
 *
 * Run: bun .harness/v320-browser-prep.mjs   (prints nothing on success)
 */
const APP = "http://localhost:3000";

// 8x8 solid-color PNGs so screenshots/VLM can SEE distinct tiles.
function solidPng(r, g, b) {
  // Minimal 8x8 RGB PNG via raw chunks.
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter byte
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
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
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", require("zlib").deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}

const NOW = new Date().toISOString();
const jobs = [
  {
    uid: "J1", project_uid: "PX20", job_type: "import_micrographs",
    title: "J1 import", status: "completed", created_at: NOW, completed_at: NOW,
    parents: [], children: ["J2"], input_slot_groups: [],
    output_result_groups: [], params_spec: {}, output_group_images: {},
    ui_tile_images: [
      { name: "mic1", fileid: "T1", num_cols: 1, num_rows: 1 },
      { name: "mic2", fileid: "T2", num_cols: 1, num_rows: 1 },
      { name: "mic3", fileid: "T3", num_cols: 1, num_rows: 1 },
    ],
  },
  {
    uid: "J2", project_uid: "PX20", job_type: "nonuniform_refine_new",
    title: "J2 refine", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["J1"], children: [],
    input_slot_groups: [{
      name: "particles", type: "particle",
      connections: [{ job_uid: "J1", group_name: "exposure" }],
    }],
    output_result_groups: [{
      name: "volume", type: "volume", title: "volume",
      contains: [
        { type: "volume.blob", name: "map" },
        { type: "volume.blob", name: "map_sharp" },
      ],
    }],
    params_spec: {}, output_group_images: { volume: "T4" },
    ui_tile_images: [],
  },
];

const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX20", cryosmart_origin: "http://localhost:3999",
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J2", lineage_mode: true,
  }),
})).json();
const token = created.token;

await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX20", jobs }),
});

const items = [
  { fileid: "T1", data: solidPng(180, 60, 60), name: "mic1.png" },
  { fileid: "T2", data: solidPng(60, 140, 90), name: "mic2.png" },
  { fileid: "T3", data: solidPng(70, 90, 190), name: "mic3.png" },
  { fileid: "T4", data: solidPng(200, 170, 60), name: "volume.png" },
];
const up = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items }),
})).json();
if (!up.ok) { console.error("upload failed", up); process.exit(1); }

await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});

// Snapshot to capture history — the browser test RESTORES from here so the
// report's image URLs are history URLs (`/api/cryosmart/history/<id>/image/…`).
const snap = await (await fetch(`${APP}/api/cryosmart/history`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
})).json();
if (!snap.ok) { console.error("history snapshot failed", snap); process.exit(1); }
console.log(JSON.stringify({ token, historyId: snap.entry?.id ?? token }));
