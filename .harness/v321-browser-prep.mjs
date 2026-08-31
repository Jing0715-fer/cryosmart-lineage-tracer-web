/**
 * v3.21 browser-E2E prep — 6-job lineage with THREE class_2D siblings
 * (C1/C2/C3) so the left outline's stage-grid has multiple mini-nodes in
 * ONE phase — the visual case for the 2-jobs-per-row outline fix.
 * A1/A2 import_micrographs (with ui tiles) → E1 extract → C1..C3 class_2D
 * → R1 nonuniform_refine_new (volume map group).
 *
 * Run: bun .harness/v321-browser-prep.mjs   (prints {token} on success)
 */
const APP = "http://localhost:3000";

// 8x8 solid-color PNGs (same helper as v320).
function solidPng(r, g, b) {
  const w = 8, h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < x + w && x < w; x++) {
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
  ihdr[8] = 8; ihdr[9] = 2;
  return "data:image/png;base64," + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", require("zlib").deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const NOW = new Date().toISOString();
const P = { params_spec: {}, output_group_images: {}, ui_tile_images: [] };
const jobs = [
  {
    uid: "J1", project_uid: "PX21", job_type: "import_micrographs",
    title: "J1 import", status: "completed", created_at: NOW, completed_at: NOW,
    parents: [], children: ["J3"], input_slot_groups: [], output_result_groups: [],
    ...P,
    ui_tile_images: [
      { name: "mic1", fileid: "U1", num_cols: 1, num_rows: 1 },
      { name: "mic2", fileid: "U2", num_cols: 1, num_rows: 1 },
    ],
  },
  {
    uid: "J2", project_uid: "PX21", job_type: "import_micrographs",
    title: "J2 import", status: "completed", created_at: NOW, completed_at: NOW,
    parents: [], children: ["J3"], input_slot_groups: [], output_result_groups: [],
    ...P,
    ui_tile_images: [{ name: "mic", fileid: "U3", num_cols: 1, num_rows: 1 }],
  },
  {
    uid: "J3", project_uid: "PX21", job_type: "extract_particles",
    title: "J3 extract", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["J1", "J2"], children: ["J4", "J5", "J6"], input_slot_groups: [],
    output_result_groups: [], ...P,
  },
  {
    uid: "J4", project_uid: "PX21", job_type: "class_2D",
    title: "J4 2D", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["E1"], children: ["R1"], input_slot_groups: [], output_result_groups: [], ...P,
  },
  {
    uid: "J5", project_uid: "PX21", job_type: "class_2D",
    title: "J5 2D", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["E1"], children: ["R1"], input_slot_groups: [], output_result_groups: [], ...P,
  },
  {
    uid: "J6", project_uid: "PX21", job_type: "class_2D",
    title: "J6 2D", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["E1"], children: ["R1"], input_slot_groups: [], output_result_groups: [], ...P,
  },
  {
    uid: "J7", project_uid: "PX21", job_type: "nonuniform_refine_new",
    title: "J7 refine", status: "completed", created_at: NOW, completed_at: NOW,
    parents: ["J4", "J5", "J6"], children: [],
    input_slot_groups: [],
    output_result_groups: [{
      name: "volume", type: "volume", title: "volume",
      contains: [
        { type: "volume.blob", name: "map" },
        { type: "volume.blob", name: "map_sharp" },
      ],
    }],
    params_spec: {}, ui_tile_images: [],
    output_group_images: { volume: "U4" },
  },
];

const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX21", cryosmart_origin: "http://localhost:3999",
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J7", lineage_mode: true,
  }),
})).json();
const token = created.token;

await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX21", jobs }),
});

const items = [
  { fileid: "U1", data: solidPng(180, 60, 60), name: "mic1.png" },
  { fileid: "U2", data: solidPng(60, 140, 90), name: "mic2.png" },
  { fileid: "U3", data: solidPng(70, 90, 190), name: "mic.png" },
  { fileid: "U4", data: solidPng(200, 170, 60), name: "volume.png" },
];
const up = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items }),
})).json();
if (!up.ok) { console.error("upload failed", up); process.exit(1); }

await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
console.log(JSON.stringify({ token }));
