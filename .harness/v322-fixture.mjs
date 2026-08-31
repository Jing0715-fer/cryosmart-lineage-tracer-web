/**
 * v3.22 fixture — a 6-job lineage summary with inline data-URL images.
 * Shared by v322-preview-gen.mjs (writes per-template HTML) and the
 * share-url helper (loads it into the live app via #s= hash).
 */
/* ── tiny PNG factory (8×8 / 64×48 solid or two-tone images) ────────── */
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
function png(w, h, fill) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const [r, g, b] = fill(x, y);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", Bun.gzipSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
const img = (fill) => png(96, 72, fill);
const M1 = img((x, y) => [70 + (x % 24) * 3, 80 + (y % 30) * 2, 96]);
const M2 = img((x, y) => [60, 100 + (x % 20) * 4, 120]);
const M3 = img((x, y) => [40 + (x % 30) * 2, 90, 150 + (y % 36) * 2]);
const FSC0 = img((x, y) => [200 - x, 60 + y * 2, 90]);
const FSC1 = img((x, y) => [160 - x, 40 + y * 2, 130]);
const CLS = (i) => img((x, y) => [90 + i * 20, 60 + (x % 24) * 3, 140 + i * 10]);
const VOL = img((x, y) => {
  const d = Math.abs(x - 48) + Math.abs(y - 36);
  return d < 26 ? [230, 190 - d * 2, 90] : [40, 60, 70];
});
const SEL = img((x, y) => [50 + (y % 20) * 6, 110, 90 + (x % 30) * 3]);
const tile = (kind, name, src, url) => ({ kind, name, url: url || src, src, original_url: url || src });

const NO_PARAMS = { box_size_pix: null, extracted_box_size_pix: null, bin_factor: null, bin_inferred: false };
const base = (uid, job_type, extra = {}) => ({
  uid,
  uid_num: null,
  project_uid: "PX22",
  job_type,
  title: `${uid} ${job_type}`,
  status: "completed",
  created_at: null,
  completed_at: null,
  parents: [],
  children: [],
  particle_count: null,
  micrograph_count: null,
  pixel_size_A: null,
  volume_count: null,
  class_count: null,
  resolution_A: null,
  extraction_params: { ...NO_PARAMS },
  output_groups: {},
  images: [],
  maps: [],
  classes: [],
  select_2d: null,
  representative_micrograph_images: [],
  ...extra,
});

const nodes = [
  base("J1", "import_micrographs", {
    micrograph_count: 6400,
    pixel_size_A: 0.834,
    representative_micrograph_images: [
      tile("ui_tile", "mic1", M1),
      tile("ui_tile", "mic2", M2),
    ],
  }),
  base("J2", "extract_particles", {
    particle_count: 512340,
    extraction_params: { box_size_pix: 360, extracted_box_size_pix: 180, bin_factor: 2, bin_inferred: false },
  }),
  base("J3", "class_2D", { particle_count: 512340, class_count: 50 }),
  base("J4", "select_2D", {
    particle_count: 512340,
    select_2d: {
      particles_selected: 298120,
      particles_excluded: 214220,
      classes_selected: 28,
      classes_excluded: 22,
      selected_classes_image: SEL,
      selected_classes_src: SEL,
      selected_classes_original_url: SEL,
      selected_classes_source: null,
      selected_classes_log_text: null,
      selected_classes_log_timestamp: null,
      selected_particles_image: null,
      selected_particles_src: null,
      selected_particles_original_url: null,
      excluded_classes_image: null,
      excluded_classes_src: null,
      excluded_classes_original_url: null,
    },
  }),
  base("J5", "homo_abinit", {
    particle_count: 298120,
    volume_count: 3,
    classes: [],
  }),
  base("J6", "nonuniform_refine_new", {
    particle_count: 298120,
    volume_count: 2,
    resolution_A: 3.21,
    maps: [
      {
        group: "volume",
        group_title: "volume",
        group_type: "volume",
        result_name: "map",
        download_url: "http://cryo.local/api/download/J6_volume_map",
        preview_url: VOL,
        preview_src: VOL,
        preview_original_url: VOL,
      },
      {
        group: "volume",
        group_title: "volume",
        group_type: "volume",
        result_name: "map_sharp",
        download_url: "http://cryo.local/api/download/J6_volume_map_sharp",
        preview_url: VOL,
        preview_src: VOL,
        preview_original_url: VOL,
      },
      {
        group: "mask",
        group_title: "mask",
        group_type: "mask",
        result_name: "mask",
        download_url: "http://cryo.local/api/download/J6_mask",
        preview_url: null,
        preview_src: null,
        preview_original_url: null,
      },
    ],
    images: [
      { ...tile("log_image", "fsc_class0.png", FSC0), class_index: 0 },
      { ...tile("log_image", "vol_class0.png", FSC0), class_index: 0 },
      { ...tile("log_image", "fsc_class1.png", FSC1), class_index: 1 },
      { ...tile("log_image", "orientation.png", FSC1) },
    ],
  }),
];

const edge = (source, target, input_type, group = null) => ({
  source,
  target,
  input_type,
  input_name: input_type,
  input_title: null,
  source_group: group,
  slots: [],
});
const edges = [
  edge("J1", "J2", "micrographs"),
  edge("J2", "J3", "particles"),
  edge("J3", "J4", "particles", "class 0..49"),
  edge("J4", "J5", "particles", "selected"),
  edge("J5", "J6", "volume", "class 0"),
];

const classSplit = (i) => ({
  class_index: i,
  particle_count: 60000 + i * 3910,
  particle_percent: (20.1 + i * 0.7).toFixed(1),
  total_particles: 298120,
  volume_group: `class_${i}`,
  mrc_preview_url: CLS(i),
  mrc_preview_src: CLS(i),
  mrc_preview_original_url: CLS(i),
  maps: [{ result_name: "map", download_url: `http://cryo.local/api/download/J5_class_${i}_map` }],
});

const summary = {
  ok: true,
  project_uid: "PX22",
  base_url: "http://cryo.local",
  start_uid: "J6",
  start_job: nodes[5],
  final_particle_count: 298120,
  final_micrograph_count: 6400,
  final_resolution_A: 3.21,
  resolution_note: "",
  map_download_urls: {
    "volume.map": "http://cryo.local/api/download/J6_volume_map",
    "volume.map_sharp": "http://cryo.local/api/download/J6_volume_map_sharp",
  },
  nodes,
  edges,
  import_or_leaf_jobs: [nodes[0]],
  class_split_jobs: [{ uid: "J5", job_type: "homo_abinit", classes: [classSplit(0), classSplit(1), classSplit(2)] }],
  focused_mermaid: "",
};

export { summary };
export default summary;
