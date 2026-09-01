/**
 * v3.22 fixture — a 6-job lineage summary with inline data-URL images.
 * Shared by v322-preview-gen.mjs (writes per-template HTML) and the
 * share-url helper (loads it into the live app via #s= hash).
 */
/* ── micrograph-like PNG factory (v3.23: smooth noise fields + particle
 *    specks + Gaussian class blobs — renders like real cryo-EM data so
 *    template screenshots / VLM design reviews judge the real look) ── */
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
/* seeded xorshift rng */
const rng = (seed) => {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= (s >>> 17);
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
/* smooth low-frequency field: coarse random grid, smoothstep-upsampled */
function field(w, h, cell, seed) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const r = rng(seed);
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const sx = sm(fx - x0), sy = sm(fy - y0);
    const v00 = g[y0 * gw + x0], v10 = g[y0 * gw + x0 + 1];
    const v01 = g[(y0 + 1) * gw + x0], v11 = g[(y0 + 1) * gw + x0 + 1];
    return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
  };
}
/* dark speck field: sparse bright particles, like raw ice micrographs */
const specks = (w, h, seed, cell = 5, pow = 3) => {
  const f = field(w, h, cell, seed);
  return (x, y) => Math.pow(f(x, y), pow);
};
const W = 240, H = 180;
/* raw micrograph: ice gradient + particles + vignette + grain */
const micro = (seed, tint = [1.0, 1.02, 1.08]) => {
  const f = field(W, H, 22, seed);
  const sp = specks(W, H, seed ^ 0x9e37, 5, 3);
  const r = rng(seed ^ 0x51ed);
  return png(W, H, (x, y) => {
    const v = Math.max(0, Math.min(255,
      46 + 88 * f(x, y) + 130 * sp(x, y) + (r() - 0.5) * 14));
    const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
    const vig = 1 - 0.22 * Math.min(1, Math.sqrt(dx * dx + dy * dy));
    return [v * tint[0] * vig, v * tint[1] * vig, v * tint[2] * vig];
  });
};
/* 2D class average: dark bg + bright Gaussian core + faint ring + grain */
const cls = (i, n = 4) => {
  const sig = 14 + (i % n) * 5.5;
  const r = rng(0xabc0 + i * 97);
  const cx = W / 2, cy = H / 2;
  return png(W, H, (x, y) => {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const core = 235 * Math.exp(-d2 / (2 * sig * sig));
    const ring = 46 * Math.exp(-Math.pow(d2 / (2 * sig * sig) - 1.15, 2) / 0.12);
    const v = Math.max(0, Math.min(255, 14 + core + ring + (r() - 0.5) * 10));
    return [v * 0.98, v, v * 0.96];
  });
};
/* FSC curve plot: white bg, axes, descending correlation curve + band */
const plot = (seed, phase = 0) => {
  const r = rng(seed);
  const curve = (x) => H * (0.16 + 0.68 * Math.exp(-((x / W) * 2.6 + phase * 0.5)));
  return png(W, H, (x, y) => {
    let v = 252;
    // axes
    if (x < 3 || y > H - 3 || Math.abs(y - H * 0.16) < 1) v = 168;
    // curve + 3σ band
    const c = curve(x);
    const band = 4 + 8 * (x / W);
    if (Math.abs(y - c) < 1.6) v = 24;
    else if (Math.abs(y - c) < band) v = 210;
    // dots along the curve
    if (Math.abs(y - c) < 1.6 && x % 12 < 3) v = 8;
    v += (r() - 0.5) * 6;
    return [v, v, v];
  });
};
/* map/volume slice: dark bg + bright blob + green tint */
const vol = (seed) => {
  const r = rng(seed);
  const cx = W / 2, cy = H / 2, sig = 30;
  return png(W, H, (x, y) => {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const core = 205 * Math.exp(-d2 / (2 * sig * sig));
    const shell = 60 * Math.exp(-Math.pow(d2 / (2 * sig * sig) - 0.7, 2) / 0.1);
    const v = Math.max(0, Math.min(255, 16 + core + shell + (r() - 0.5) * 12));
    return [v * 0.72, v * 0.94, v * 0.86];
  });
};
/* select-2D montage: three small blobs on gray */
const sel = (seed) => {
  const r = rng(seed);
  const spots = [W * 0.26, W * 0.5, W * 0.74];
  return png(W, H, (x, y) => {
    let v = 40;
    for (const sx of spots) {
      const d2 = (x - sx) * (x - sx) + (y - H * 0.5) * (y - H * 0.5) * 1.6;
      v += 190 * Math.exp(-d2 / (2 * 20 * 20));
    }
    v += (r() - 0.5) * 10;
    v = Math.max(0, Math.min(255, v));
    return [v * 0.97, v, v * 0.98];
  });
};
const img = () => 0;
const M1 = micro(11, [1.0, 1.01, 1.06]);
const M2 = micro(23, [1.02, 1.0, 1.04]);
const M3 = micro(37, [0.99, 1.0, 1.1]);
const FSC0 = plot(101, 0);
const FSC1 = plot(103, 1);
const CLS = (i) => cls(i, 5);
const VOL = vol(7);
const SEL = sel(9);
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
