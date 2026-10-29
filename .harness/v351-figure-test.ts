/**
 * v3.51→v3.55 figure-model + layout drill.
 *
 * Crafts a P96/J41-like LineageSummary (10 stage groups; 6 of them class
 * splits with 2-3 classes each) and runs the REAL model builder + REAL
 * workflow-PPTX layout. v3.54: thumbnails are SYNTHESIZED in-process
 * (transparent margins + a disc in the class's Chimera open-color), so the
 * drill no longer depends on /tmp leftovers, and a second pass builds the
 * SIMPLIFIED figure (small-subset bootstrap drops + 多→少 funnel) plus a
 * default-12 Å ab-initio-final case.
 *
 * v3.55 (round-14): (1) the chain now carries the REAL picking family
 * (J9 blob_picker 164,291 on the 217-photo subset / J25 topaz_extract
 * 1,634,842 over all photos / J26 extract 1,588,675) — the header's pick
 * count must read the MAINLINE 1635K, not the earliest subset pick;
 * (2) J33 carries an explicit default-12 Å Maximum resolution → the
 * simplified figure omits it entirely (hetero J31 → hetero J34 directly);
 * (3) J39 carries a NON-default 6 Å → the simplified figure KEEPS it;
 * (4) PPTX labels must carry the job id (name + gray 7 pt " · uid" run);
 * (5) abinitMaxResolutionFromJob unit checks ({value} wrapper / raw /
 * absent / non-abinit).
 *
 * Run: cd /home/z/my-project && bun .harness/v351-figure-test.ts
 *
 * v3.58 (round-17): the summary now models the REAL P96 DAG — J28 hetero
 * on the full 1.59M extract (particle-only classes 1/2, single volume)
 * feeding J29 dedup → J30 → J31, J36 ctf_refinement between the two
 * non-uniforms, J40 = homo_reconstruct. Asserts: the particle-first spine
 * must surface J28 (J27 < J28 < J31); 简化模式 merges J35→J37 (same
 * count) and omits the reconstruct-only J40; connector invariants —
 * axis-aligned segments only, no bentConnector, and NO segment may cross
 * a thumbnail or stats/label box (deck (6)'s wrap-crossing bug class).
 *
 * v3.59 (round-18): the layout was rebuilt after upload/workflow.pptx —
 * portrait 7.5-in canvas with DYNAMIC height, one straight spine of
 * FIXED 0.39 in arrows, a 极简 style (selection frames + retention
 * labels, no job ids/footnote), and the 手动模式 filter
 * (applyManualSelection). Asserts: every connector is a vertical
 * straightConnector1 of the fixed length on the spine x=3.75; the minimal
 * deck carries retention percentages (48.3%/77.0%/64.1%/55.2% on the P96
 * chain) and exactly 5 selection frames; manual drops re-anchor the
 * reference and drop the final Å with the final job.
 *
 * v3.60 (round-19): the four modes (手动/标准/简化/极简) collapse into
 * ONE card dropdown, and 极简 now ALSO caps the deck at 5 image rows
 * (simplified merging underneath, 阶段数 clamped 4/5, “全部”→5). This
 * section builds the EXACT model the 极简 UI produces —
 * buildFlowFigureModel({maxGroups: 5, simplified: true}) — and asserts
 * the fold ([J28, J34, J37, J39, J41]; the 3-class J31 is a single-ITEM
 * group, so only parallel groups survive the fold), the funnel still
 * reads 多→少, and the minimal deck on it carries the J28→J34 retention
 * label 37.2% (590,421 / 1,588,675 — the reference deck's own number),
 * 2 selection frames (J34 + J39, the only multi-slot rows with a next
 * rep), and the final Å.
 *
 * v3.61 (round-20 “极简模式还是有问题，很多上下游的job放在同一级了，
 * 应该是精选出几个job展示，上下游关系还是不能混乱”): 极简 is now the
 * CURATED MAINLINE — buildFlowFigureModel({…, minimal: true}) builds one
 * row per mainline map stage (no merge-assembly parallel groups, no
 * import_* seeds, no select_2D montage) and caps via curateMinimalFlow.
 * The P96 fold must stay EXACTLY [J28, J34, J37, J39, J41] (continuity
 * with the round-19-approved deck), and a NEW P268-like fixture (imported
 * reference volumes + a local refinement merging ≥2 map-bearing parents
 * + a small-subset 2D branch) reproduces the reported disease in the OLD
 * paths — the standard assembly crams [J230+J220] and [J270+J250] into
 * parallel rows, Import Volumes enters the funnel, and the round-19 极简
 * still carries the crammed row — while the curated mainline yields one
 * job per row.
 *
 * v3.62 (round-21 “对齐的算法还是不是对每个样品都有效 + 省略的步骤写为
 * 几×hetero refine + 极简变成4，5，6行 + 排版不太美观”): the 极简
 * mainline now MERGES consecutive same-type stages into ONE “N×” row
 * BEFORE the cap (P96: J28+J31+J34 → “3× Hetero refinement”; P268:
 * J240+J250 → “2× Hetero refinement”), the cap is 4/5/6, every gap the
 * deck omits gets a “omitted: N× <type>” note (model.omissions → the
 * PPTX), each row CENTRES its flow-anchor class on the spine (swap +
 * margin-clamped shift — the frame sits under the arrows for every
 * sample, even-count rows included), the inter-row pitch is uniform, and
 * all counts print full-separator (“1,634,842 particles”). A NEW P300
 * fixture (9-stage linear mainline, an even 2-class anchor row, a 6 Å
 * ab-initio the 6-row cap drops, and adjacent DIFFERENT-count
 * non-uniforms that merge only in 极简) drills the cap + omission notes +
 * frame-centring geometry.  */
import { buildFlowFigureModel, figureMapSources, applyManualSelection } from "../src/lib/cryosmart/workflow-figure";
import { chimeraClassColor } from "../src/lib/cryosmart/chimera-colors";
import { buildWorkflowPptx } from "../src/lib/cryosmart/workflow-pptx";
import { abinitMaxResolutionFromJob, jobNode } from "../src/lib/cryosmart/lineage";
import { deflateSync, inflateRawSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT_DIR = "/tmp/figtest";
const OUT = path.join(OUT_DIR, "out.pptx");
const OUT_SIMPLIFIED = path.join(OUT_DIR, "out-simplified.pptx");
const OUT_MINIMAL = path.join(OUT_DIR, "out-minimal.pptx");
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Tiny RGBA PNG writer — transparent margins + an opaque disc        */
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
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
/** One disc on a transparent canvas — the class-colored "map render". */
function discPng(rgb: [number, number, number], w = 320, h = 160, r = 52): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) {
        raw[i] = rgb[0];
        raw[i + 1] = rgb[1];
        raw[i + 2] = rgb[2];
        raw[i + 3] = 255;
      } else {
        raw[i] = raw[i + 1] = raw[i + 2] = raw[i + 3] = 0;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = new Uint8Array(deflateSync(raw));
  let png = new Uint8Array(8 + 25 + 12 + idat.length + 12 + 12);
  let off = 0;
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], off); off += 8;
  png.set(pngChunk("IHDR", ihdr), off); off += 25;
  png.set(pngChunk("IDAT", idat), off); off += 12 + idat.length;
  png.set(pngChunk("IEND", new Uint8Array(0)), off);
  return png;
}
/** The 2D-classification montage: a 4×2 grid of small grey discs. */
function montagePng(w = 320, h = 160): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  const cols = 4;
  const rows = 2;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      const cw = w / cols;
      const ch = h / rows;
      const cx = (Math.floor((x + 0.5) / cw) + 0.5) * cw;
      const cy = (Math.floor((y + 0.5) / ch) + 0.5) * ch;
      const inDisc = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= Math.min(cw, ch) * 0.35;
      raw[i] = raw[i + 1] = raw[i + 2] = inDisc ? 130 : 0;
      raw[i + 3] = inDisc ? 255 : 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = new Uint8Array(deflateSync(raw));
  let png = new Uint8Array(8 + 25 + 12 + idat.length + 12 + 12);
  let off = 0;
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], off); off += 8;
  png.set(pngChunk("IHDR", ihdr), off); off += 25;
  png.set(pngChunk("IDAT", idat), off); off += 12 + idat.length;
  png.set(pngChunk("IEND", new Uint8Array(0)), off);
  return png;
}

/* ------------------------------------------------------------------ */
/* Summary craft (P96/J41-like)                                        */
/* ------------------------------------------------------------------ */

const mapUrl = (uid: string, group: string) => `http://cryosmart.test/api/download/${uid}.${group}.map`;

const mkMapAsset = (uid: string, group: string) => ({
  group,
  group_title: group,
  group_type: "volume",
  result_name: "map",
  download_url: mapUrl(uid, group),
  preview_url: `http://cryosmart.test/api/log_image/${uid}_${group}`,
  preview_src: null,
  preview_original_url: null,
});

const mkClasses = (uid: string, rows: Array<[number, number, number]>) =>
  rows.map(([idx, pct, count]) => ({
    class_index: idx,
    particle_count: count,
    particle_percent: pct,
    total_particles: null,
    volume_group: `volume_class_${idx}`,
    mrc_preview_url: `http://cryosmart.test/api/log_image/${uid}_c${idx}`,
    mrc_preview_src: null,
    mrc_preview_original_url: null,
    maps: [{ result_name: "map", download_url: mapUrl(uid, `volume_class_${idx}`) }],
  }));

const mkNode = (
  uid: string,
  job_type: string,
  extra: Record<string, unknown> = {},
): any => ({
  uid,
  uid_num: Number(uid.replace("J", "")),
  project_uid: "P96",
  job_type,
  title: uid,
  status: "completed",
  created_at: null,
  completed_at: null,
  parents: [],
  children: [],
  particle_count: null,
  micrograph_count: null,
  pixel_size_A: 0.5,
  volume_count: null,
  class_count: null,
  resolution_A: null,
  extraction_params: {} as any,
  output_groups: {} as any,
  images: [] as any[],
  maps: [] as any[],
  classes: [] as any[],
  select_2d: null,
  fsc_xml: null,
  ...extra,
});

const J1 = mkNode("J1", "import_micrographs", { micrograph_count: 6060 });
/* v3.55 (round-14): the REAL P96 picking family — J9's 164,291 blob picks
 * came from only the 217-photo subset (the OLD header printed this number
 * and read absurdly low against the 766K-particle stages downstream);
 * J25 topaz_extract picked 1,634,842 over all 5,843 photos (mainline);
 * J26 extracted 1,588,675 of them. */
const J9 = mkNode("J9", "blob_picker_gpu", { particle_count: 164291, micrograph_count: 217 });
const J25 = mkNode("J25", "topaz_extract", { particle_count: 1634842, micrograph_count: 5843 });
const J26 = mkNode("J26", "extract_micrographs_multi", { particle_count: 1588675, micrograph_count: 5827 });
const J12 = mkNode("J12", "select_2D", {
  particle_count: 126228,
  select_2d: { particles_selected: 12259, classes_selected: 6 },
  images: [
    {
      kind: "log_image",
      name: "log_image",
      url: "http://cryosmart.test/api/log_image/j12",
      src: "http://cryosmart.test/api/log_image/j12",
      original_url: "http://cryosmart.test/api/log_image/j12",
    },
  ],
});
const J27 = mkNode("J27", "homo_abinit", {
  particle_count: 58048,
  // v3.55: NO Maximum-resolution parameter — absent = the cryoSPARC
  // default 12 Å → the simplified figure must drop it by the new rule.
  maps: [mkMapAsset("J27", "volume_class_0"), mkMapAsset("J27", "volume_class_1")],
  classes: mkClasses("J27", [
    [0, 50.0, 29024],
    [1, 35.0, 20317],
  ]),
});
/* v3.58 (round-17 “怎么缺少了 J28”): the REAL P96 mainline between the
 * extract and J31 — J28 hetero_refine ran on the FULL 1.59M extract with
 * J27's class-0 map as reference (3 particle classes, only class 0 has a
 * volume), its selected class 0 fed J29 dedup (769,822) → J30 → J31
 * (766,560). The old volume-first spine walk jumped J31 → J27 and never
 * saw J28; the particle-first walk must reach it. Classes 1/2 carry NO
 * map (volume_1) so the stage renders single-map. */
const J28 = mkNode("J28", "hetero_refine", {
  particle_count: 1588675,
  maps: [mkMapAsset("J28", "volume_class_0")],
  classes: [
    { class_index: 0, particle_count: 769822, particle_percent: 48.5, total_particles: null,
      volume_group: "volume_class_0",
      mrc_preview_url: "http://cryosmart.test/api/log_image/j28_c0",
      mrc_preview_src: null, mrc_preview_original_url: null,
      maps: [{ result_name: "map", download_url: mapUrl("J28", "volume_class_0") }] },
    { class_index: 1, particle_count: 402000, particle_percent: 25.3, total_particles: null,
      volume_group: "volume_class_1",
      mrc_preview_url: "http://cryosmart.test/api/log_image/j28_c1",
      mrc_preview_src: null, mrc_preview_original_url: null,
      maps: [] },
    { class_index: 2, particle_count: 416853, particle_percent: 26.2, total_particles: null,
      volume_group: "volume_class_2",
      mrc_preview_url: "http://cryosmart.test/api/log_image/j28_c2",
      mrc_preview_src: null, mrc_preview_original_url: null,
      maps: [] },
  ],
});
const J29 = mkNode("J29", "remove_duplicate_particles", { particle_count: 769822 });
const J30 = mkNode("J30", "inspect_particles_select", { particle_count: 766560 });
const J31 = mkNode("J31", "hetero_refine", {
  particle_count: 766560,
  maps: [mkMapAsset("J31", "volume_class_0"), mkMapAsset("J31", "volume_class_1"), mkMapAsset("J31", "volume_class_2")],
  classes: mkClasses("J31", [
    [0, 77, 590421],
    [1, 12, 91987],
    [2, 11, 84321],
  ]),
});
const J33 = mkNode("J33", "homo_abinit", {
  particle_count: 590421,
  // v3.55 (round-14): EXPLICIT default 12 Å — a mainline ab-initio whose
  // successor (J34) only SHRINKS (the count rule would keep it), but the
  // default-12 Å rule must omit the stage entirely (hetero J31 → hetero
  // J34 directly — the user's "直接显示 heterorefine" case).
  abinit_max_resolution_A: 12,
  maps: [mkMapAsset("J33", "volume_class_0"), mkMapAsset("J33", "volume_class_1")],
  classes: mkClasses("J33", [
    [0, 47, 277498],
    [1, 28, 165318],
  ]),
});
const J34 = mkNode("J34", "hetero_refine", {
  particle_count: 590421,
  // v3.58: the REAL 3-class split — class 0 (378,677) is the FLOW
  // ANCHOR feeding the non-uniform J37; the connector must leave from
  // under IT, not under the middle class.
  maps: [mkMapAsset("J34", "volume_class_0"), mkMapAsset("J34", "volume_class_1"), mkMapAsset("J34", "volume_class_2")],
  classes: mkClasses("J34", [
    [0, 64.1, 378677],
    [1, 18.6, 109606],
    [2, 17.3, 102138],
  ]),
});
const J35 = mkNode("J35", "nonuniform_refine_new", {
  particle_count: 378677,
  maps: [mkMapAsset("J35", "volume")],
});
/* v3.58: the CTF-refinement step between the two non-uniforms (no maps,
 * never a stage row) — J37's particles come from J36, its map from J35. */
const J36 = mkNode("J36", "ctf_refinement", { particle_count: 378677 });
const J37 = mkNode("J37", "nonuniform_refine_new", {
  particle_count: 378677,
  maps: [mkMapAsset("J37", "volume")],
});
const J39 = mkNode("J39", "homo_abinit", {
  particle_count: 378677,
  // v3.55 (round-14): a deliberately NON-default 6 Å Maximum resolution —
  // the user refined the initial-model generation, so the simplified
  // figure KEEPS this ab-initio (only the count rule could drop it, and
  // its successor only shrinks: 378,677 → J40's 209,127).
  // v3.58: the REAL 3-class split — class 2 (209,127) feeds J40/J41.
  abinit_max_resolution_A: 6,
  maps: [mkMapAsset("J39", "volume_class_0"), mkMapAsset("J39", "volume_class_1"), mkMapAsset("J39", "volume_class_2")],
  classes: mkClasses("J39", [
    [0, 4.2, 15755],
    [1, 40.6, 153795],
    [2, 55.2, 209127],
  ]),
});
/* v3.58 (round-17 “homo reconstruct only的job也可以忽略”): J40 is the REAL
 * reconstruct-only job (homo_reconstruct, single volume, 209,127) — kept
 * in the FULL figure, dropped by 简化模式. */
const J40 = mkNode("J40", "homo_reconstruct", {
  particle_count: 209127,
  maps: [mkMapAsset("J40", "volume")],
});
const J41 = mkNode("J41", "new_local_refine", {
  particle_count: 209127,
  resolution_A: 3.2,
  maps: [mkMapAsset("J41", "volume")],
});

/* v3.58: the REAL P96 DAG — particle edges (null input_type) vs volume
 * edges, mirroring the captured lineage: the extract feeds BOTH the 2D
 * branch (J12→J27) and J28; J27 supplies reference MAPS to J28 AND J31
 * while the particle mainline runs J28→J29→J30→J31. */
const nodes = [J1, J9, J25, J26, J12, J27, J28, J29, J30, J31, J33, J34, J35, J36, J37, J39, J40, J41];
const rawEdges: Array<[string, string, "volume" | null]> = [
  ["J1", "J9", null],
  ["J1", "J25", null],
  ["J25", "J26", null],
  ["J26", "J12", null],
  ["J12", "J27", null],
  ["J27", "J28", "volume"],
  ["J26", "J28", null],
  ["J28", "J29", null],
  ["J29", "J30", null],
  ["J30", "J31", null],
  ["J27", "J31", "volume"],
  ["J31", "J33", null],
  ["J31", "J33", "volume"],
  ["J33", "J34", null],
  ["J33", "J34", "volume"],
  ["J34", "J35", null],
  ["J34", "J35", "volume"],
  ["J35", "J36", null],
  ["J36", "J37", null],
  ["J35", "J37", "volume"],
  ["J37", "J39", null],
  ["J39", "J40", null],
  ["J39", "J40", "volume"],
  ["J40", "J41", null],
  ["J40", "J41", "volume"],
];
const edges = rawEdges.map(([source, target, kind]) => ({
  source,
  target,
  input_type: kind,
  input_name: kind,
  input_title: null,
  source_group: null,
  slots: [],
}));
const uidIndex = new Map(nodes.map((n, i) => [n.uid, i] as const));
for (const e of rawEdges) {
  const child = nodes[uidIndex.get(e[1])!];
  if (!child.parents.includes(e[0])) child.parents.push(e[0]);
  const parent = nodes[uidIndex.get(e[0])!];
  if (!parent.children.includes(e[1])) parent.children.push(e[1]);
}

const classJobs = [J27, J28, J31, J33, J34, J39].map((n) => ({
  uid: n.uid,
  job_type: n.job_type,
  classes: n.classes,
}));

const summary: any = {
  ok: true,
  project_uid: "P96",
  base_url: "http://cryosmart.test",
  start_uid: "J41",
  start_job: J41,
  final_particle_count: 209127,
  final_micrograph_count: 6060,
  final_resolution_A: 3.2,
  resolution_note: "",
  map_download_urls: {},
  nodes,
  edges,
  import_or_leaf_jobs: [J1],
  class_split_jobs: classJobs,
  focused_mermaid: "",
  micrograph_pixel_size_A: 0.5,
};

/* ------------------------------------------------------------------ */
/* Full-fidelity model + assertions                                    */
/* ------------------------------------------------------------------ */

const model = buildFlowFigureModel(summary, { maxGroups: 0 });
console.log("== groups ==", model.groups.length);
for (const g of model.groups) {
  console.log(
    " group:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : i.imageUrl ? "img" : "-"}]`).join(" + "),
  );
}
console.log("== reference ==", model.referenceKey);
console.log("== warnings ==", JSON.stringify(model.warnings));

const srcs = figureMapSources(model);
console.log("== figureMapSources ==", srcs.size, [...srcs.keys()].join(", "));

const byUid = (uid: string) => model.groups.flat().filter((i) => i.uid === uid);
const j31 = byUid("J31")[0];
const j41 = byUid("J41")[0];
const j12 = byUid("J12")[0];
const j28 = byUid("J28")[0];
const fail: string[] = [];
/* v3.58: [J12 montage] + spine [J27, J28, J31, J33, J34, J35, J37, J39,
 * J40, J41] = 11 groups — the particle-first walk must reach J28
 * THROUGH J30/J29 (the volume edge J31←J27 must not bypass it). */
if (model.groups.length !== 11) fail.push(`groups expected 11 got ${model.groups.length}`);
const spineUids = model.groups.flat().map((i) => i.uid).join(">");
if (!spineUids.includes("J28")) fail.push(`J28 missing from the full figure — got ${spineUids}`);
if (j28) {
  const idx = model.groups.findIndex((g) => g.some((i) => i.uid === "J28"));
  const idx31 = model.groups.findIndex((g) => g.some((i) => i.uid === "J31"));
  const idx27 = model.groups.findIndex((g) => g.some((i) => i.uid === "J27"));
  if (idx < 0 || idx31 < 0 || idx27 < 0 || !(idx27 < idx && idx < idx31))
    fail.push(`spine order wrong: expected J27 < J28 < J31, got indices ${idx27}/${idx}/${idx31}`);
  if (j28.classes?.length !== 1) fail.push(`J28 single-map expected (volume_1), got ${j28.classes?.length} slots`);
  if (j28.particleTotal !== 1588675) fail.push(`J28 particleTotal expected 1588675 got ${j28.particleTotal}`);
  if (j28.label !== "Hetero refinement") fail.push(`J28 label got ${j28.label}`);
} else fail.push("J28 item missing entirely");
if (!j31?.classes || j31.classes.length !== 3) fail.push(`J31 classes expected 3 got ${j31?.classes?.length}`);
if (j31 && j31.classes?.[0]?.stats.join("|") !== "77%|590,421 particles") fail.push(`J31 c0 stats got ${j31?.classes?.[0]?.stats.join("|")}`);
if (!j41?.classes || j41.classes.length !== 1) fail.push(`J41 classes expected 1 got ${j41?.classes?.length}`);
if (j41?.stats.length !== 1) fail.push(`J41 final stats should be particles-only, got ${j41?.stats.join("|")}`);
if (!j12?.imageUrl) fail.push("J12 montage imageUrl missing");
if (model.referenceKey !== "J41/volume") fail.push(`referenceKey got ${model.referenceKey}`);
/* v3.58: sources = J27:2 + J28:1 + J31:3 + J33:2 + J34:3 + J35:1 +
 * J37:1 + J39:3 + J40:1 + J41:1 = 18. */
if (srcs.size !== 18) fail.push(`figureMapSources expected 18 got ${srcs.size}`);
if (!srcs.has("J28/volume_class_0")) fail.push("J28/volume_class_0 missing from the render set");
if (model.headerStats.micrographs !== "6,060 Micrographs") fail.push(`header micrographs got ${model.headerStats.micrographs}`);
/* v3.55 (round-14): the MAINLINE pick — J25 topaz_extract's 1,634,842
 * (v3.62: fmtParticles never truncates to "1635K" anymore), NOT the
 * earliest subset pick J9's 164,291 (the old rule). */
if (model.headerStats.particles !== "1,634,842 particles") fail.push(`header particles got ${model.headerStats.particles}`);
if (model.finalStats !== "3.20 Å") fail.push(`finalStats got ${model.finalStats}`);

/* synthesized thumbnails: one class-colored disc per map source */
const images = new Map<string, Uint8Array>();
for (const [key, src] of srcs) {
  images.set(key, discPng(hexToRgb(chimeraClassColor(src.classIndex))));
}
images.set(j12.imageUrl as string, montagePng());

const blob = buildWorkflowPptx(model, {
  images,
  footnote:
    "所有地图已对齐至参考 J41/volume · 手性检查: 1 个已翻正，14 个一致 · 视角 y-90 · CryoSmart Workflow Figure (ChimeraX aligned)",
});
const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync(OUT, buf);
console.log("== pptx ==", OUT, buf.length, "bytes");

/* ------------------------------------------------------------------ */
/* v3.54 simplified model + assertions                                 */
/* ------------------------------------------------------------------ */

const model2 = buildFlowFigureModel(summary, { maxGroups: 0, simplified: true });
console.log("== simplified groups ==", model2.groups.length);
for (const g of model2.groups) {
  console.log(
    " s-group:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : i.imageUrl ? "img" : "-"}]`).join(" + "),
  );
}
console.log("== simplified warnings ==", JSON.stringify(model2.warnings, null, 1));

const sUids = new Set(model2.groups.flat().map((i) => i.uid));
/* v3.58: bootstrap drops (J12 subset, J27 absent-12, J33 explicit-12) +
 * NEW redundant drops (J35 merged into J37 — same 378,677; J40
 * reconstruct-only) → [J28, J31, J34, J37, J39, J41] = 6 groups. */
if (model2.groups.length !== 6)
  fail.push(`simplified groups expected 6 (J12/J27/J33/J35/J40 dropped) got ${model2.groups.length}`);
if (sUids.has("J12")) fail.push("simplified should drop the small-subset select_2D montage J12");
if (sUids.has("J27")) fail.push("simplified should drop the default-12 Å (absent param) ab-initio J27");
if (sUids.has("J33")) fail.push("simplified should drop the explicit default-12 Å ab-initio J33 (hetero J31 → hetero J34 directly)");
if (sUids.has("J35")) fail.push("simplified must MERGE the earlier non-uniform J35 into J37 (same particle count)");
if (sUids.has("J40")) fail.push("simplified must omit the reconstruct-only J40");
if (!sUids.has("J28")) fail.push("simplified must KEEP the particle-mainline hetero J28");
if (!sUids.has("J39")) fail.push("simplified must KEEP the deliberately non-default 6 Å ab-initio J39");
if (!model2.warnings.some((w) => w.includes("已省略少量数据步骤 J12") && w.includes("12,259"))) fail.push("missing J12 drop warning");
if (!model2.warnings.some((w) => w.includes("已省略 ab-initio 步骤 J27") && w.includes("12"))) fail.push("missing J27 default-12 drop warning");
if (!model2.warnings.some((w) => w.includes("已省略 ab-initio 步骤 J33") && w.includes("12.0"))) fail.push("missing J33 default-12 drop warning");
if (!model2.warnings.some((w) => w.includes("已合并连续 Non-uniform 精修 J35 → J37") && w.includes("颗粒数相同")))
  fail.push("missing J35→J37 non-uniform merge warning");
if (!model2.warnings.some((w) => w.includes("已省略仅重建步骤 J40"))) fail.push("missing J40 reconstruct-only drop warning");
if (model2.warnings.some((w) => w.includes("从多到少"))) fail.push("funnel hiding should NOT fire on the monotone P96 chain");

/* funnel: every kept stage's displayed count must be ≤ its predecessor's */
{
  const totals: Array<number | null> = model2.groups.map((g) => {
    const cs = g.map((it) => it.particleTotal ?? null).filter((v): v is number => v != null);
    return cs.length ? Math.max(...cs) : null;
  });
  let running: number | null = null;
  totals.forEach((t, i) => {
    if (t == null) return;
    if (running != null && t > running) fail.push(`simplified funnel broke at group ${i}: ${t} > ${running}`);
    running = t;
  });
  // every count line still displayed must not resurrect a hidden number
  const j41s = model2.groups.flat().find((i) => i.uid === "J41");
  if (j41s?.stats.join("|") !== "209,127 particles") fail.push(`simplified J41 stats got ${j41s?.stats.join("|")}`);
  const j31s = model2.groups.flat().find((i) => i.uid === "J31");
  if (j31s?.classes?.[0]?.stats.join("|") !== "77%|590,421 particles") fail.push(`simplified J31 c0 stats got ${j31s?.classes?.[0]?.stats.join("|")}`);
}

/* map sources shrink with the dropped stages (18 → 12: J27 2 + J33 2 +
 * J35 1 + J40 1 gone; J28's single map stays) */
const srcs2 = figureMapSources(model2);
console.log("== simplified figureMapSources ==", srcs2.size);
if (srcs2.size !== 12) fail.push(`simplified figureMapSources expected 12 got ${srcs2.size}`);
if (srcs2.has("J27/volume_class_0")) fail.push("J27 maps must be gone from the simplified render set");
if (srcs2.has("J33/volume_class_0")) fail.push("J33 maps must be gone from the simplified render set");
if (srcs2.has("J35/volume")) fail.push("J35 maps must be gone from the simplified render set (merged into J37)");
if (srcs2.has("J40/volume")) fail.push("J40 maps must be gone from the simplified render set (reconstruct-only)");
if (!srcs2.has("J28/volume_class_0")) fail.push("J28 maps must STAY in the simplified render set");

const images2 = new Map<string, Uint8Array>();
for (const [key, src] of srcs2) {
  images2.set(key, discPng(hexToRgb(chimeraClassColor(src.classIndex))));
}
const blob2 = buildWorkflowPptx(model2, {
  images: images2,
  footnote: "简化模式 · 所有地图已对齐至参考 J41/volume · CryoSmart Workflow Figure (ChimeraX aligned)",
});
const buf2 = Buffer.from(await blob2.arrayBuffer());
fs.writeFileSync(OUT_SIMPLIFIED, buf2);
console.log("== simplified pptx ==", OUT_SIMPLIFIED, buf2.length, "bytes");

/* ------------------------------------------------------------------
 * v3.59 (round-18): 手动模式 unit — applyManualSelection               */
/* ------------------------------------------------------------------ */

/* drop two middle stages: groups 11 → 9, J41 stays final → finalStats
 * and the J41/volume reference survive; the dropped stages' maps leave
 * the render set (18 → 14). */
const manualMid = applyManualSelection(model, (uid) => uid !== "J27" && uid !== "J33");
if (manualMid.groups.length !== 9)
  fail.push(`manual mid-drop groups expected 9 got ${manualMid.groups.length}`);
if (manualMid.finalStats !== "3.20 Å")
  fail.push(`manual mid-drop must KEEP the final Å (J41 kept), got ${manualMid.finalStats}`);
if (manualMid.referenceKey !== "J41/volume")
  fail.push(`manual mid-drop reference must stay J41/volume, got ${manualMid.referenceKey}`);
{
  const flat = manualMid.groups.flat().map((i) => i.uid);
  if (flat.includes("J27") || flat.includes("J33")) fail.push("manual mid-drop still carries a dropped uid");
  const srcsM = figureMapSources(manualMid);
  if (srcsM.size !== 14) fail.push(`manual mid-drop render set expected 14 got ${srcsM.size}`);
  if (srcsM.has("J27/volume_class_0") || srcsM.has("J33/volume_class_0"))
    fail.push("manual mid-drop render set still carries a dropped stage's map");
}
if (!manualMid.warnings.some((w) => w.includes("手动勾选") && w.includes("2 个阶段")))
  fail.push("manual mid-drop warning missing");

/* drop the FINAL job: the Å belongs to J41 and must go with it; the
 * reference re-anchors to the new last map-bearing stage J40; the render
 * set loses exactly J41/volume (18 → 17). */
const manualTail = applyManualSelection(model, (uid) => uid !== "J41");
if (manualTail.groups.length !== 10) fail.push(`manual tail-drop groups expected 10 got ${manualTail.groups.length}`);
if (manualTail.finalStats !== null) fail.push(`manual tail-drop must drop the J41 final Å, got ${manualTail.finalStats}`);
if (manualTail.referenceKey !== "J40/volume")
  fail.push(`manual tail-drop reference must re-anchor to J40/volume, got ${manualTail.referenceKey}`);
if (manualTail.referenceItem?.uid !== "J40") fail.push("manual tail-drop referenceItem must be J40's item");
if (!manualTail.warnings.some((w) => w.includes("最终阶段被取消勾选"))) fail.push("manual tail-drop warning missing");
if (figureMapSources(manualTail).size !== 17)
  fail.push(`manual tail-drop render set expected 17 got ${figureMapSources(manualTail).size}`);

/* keep NONE: empty groups + warning, nothing dangles. */
const manualNone = applyManualSelection(model, () => false);
if (manualNone.groups.length !== 0) fail.push("manual none-drop groups must be empty");
if (manualNone.referenceKey !== null || manualNone.finalStats !== null)
  fail.push("manual none-drop must null the reference and finalStats");

/* keep ALL: identity — no warning, no churn. */
const manualAll = applyManualSelection(model, () => true);
if (manualAll.groups.length !== model.groups.length)
  fail.push("manual keep-all must be an identity pass-through");
if (manualAll.warnings.length !== model.warnings.length)
  fail.push("manual keep-all must not add warnings");
console.log("== 手动模式 unit checks done ==");

/* ------------------------------------------------------------------
 * v3.59: 极简版式 deck — selection frames + retention labels
 * ------------------------------------------------------------------ */

/* The minimal deck builds from the FULL model (简化 off) so the whole
 * 11-stage chain renders small: every row is 2:1 at the reference's own
 * 1.58 in (only 3-class rows constrain the strip, and they still fit).
 * Retention labels after each row read the NEXT row's input:
 *   J12 12,259 → J27 58,048 (grew: count-only) → J28 1,588,675 (count-only)
 *   → J31 766,560 (48.3%) → J33 590,421 (77.0%) → J34 590,421 (100%:
 *   count-only) → J35 378,677 (64.1%) → J37 (count-only) → J39
 *   (count-only) → J40 209,127 (55.2%) → J41 (count-only). */
const blob3 = buildWorkflowPptx(model, { images, style: "minimal" });
const buf3 = Buffer.from(await blob3.arrayBuffer());
fs.writeFileSync(OUT_MINIMAL, buf3);
console.log("== minimal pptx ==", OUT_MINIMAL, buf3.length, "bytes");

/* ------------------------------------------------------------------
 * v3.60 (round-19): 极简模式 — 简化合并 + the row cap.
 * v3.61 (round-20): 极简 = the CURATED MAINLINE (minimal:true).
 * v3.62 (round-21 “省略的步骤可能需要写为几*hetero refine… + 极简变成
 * 4，5，6行”): the mainline now MERGES consecutive same-type stages
 * into ONE “N×” row BEFORE the cap. On the P96 chain the curated
 * mainline is [J27, J28, J31, J33, J34, J35, J37, J39, J40, J41];
 * the simplified drops leave [J28, J31, J34, J37, J39, J41]; the
 * same-type merge folds the consecutive hetero run J28+J31+J34 into
 * ONE “3× Hetero refinement” row (rep J34, 590,421) → 4 rows, under
 * the 4/5/6 cap with room to spare. The per-gap omission notes name
 * the 简化 drops that survived between kept rows: J35 (merged into
 * J37 by the 简化 pass) under the 3× row, and J40 (reconstruct-only)
 * under J39.
 * ------------------------------------------------------------------ */
const OUT_MINIMAL5 = path.join(OUT_DIR, "out-minimal5.pptx");
const modelMini = buildFlowFigureModel(summary, { maxGroups: 5, simplified: true, minimal: true });
console.log("== 极简 groups ==", modelMini.groups.length);
for (const g of modelMini.groups) {
  console.log(
    " m-group:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : i.imageUrl ? "img" : "-"}]`).join(" + "),
  );
}
if (modelMini.groups.length !== 4) fail.push(`极简 groups expected 4 (3× merged hetero row) got ${modelMini.groups.length}`);
const miniUids = modelMini.groups.flat().map((i) => i.uid).join(">");
if (miniUids !== "J34>J37>J39>J41")
  fail.push(`极简 rows expected J34>J37>J39>J41 (J28+J31+J34 merged into the J34 row) got ${miniUids}`);
const miniLabel = modelMini.groups[0][0].label;
if (miniLabel !== "3× Hetero refinement")
  fail.push(`极简 merged-row label expected "3× Hetero refinement" got ${miniLabel}`);
/* the merged row carries the LAST member's montage + count (J34: 3
 * classes, 590,421) — the merge must not disturb the funnel */
if (modelMini.groups[0][0].particleTotal !== 590421)
  fail.push(`极简 merged-row count expected J34's 590,421 got ${modelMini.groups[0][0].particleTotal}`);
if ((modelMini.groups[0][0].classes?.length ?? 0) !== 3)
  fail.push(`极简 merged-row montage expected J34's 3 classes got ${modelMini.groups[0][0].classes?.length}`);
/* per-gap omission notes: gap0 (3× row → J37) names the 简化-merged J35;
 * gap2 (J39 → J41) names the reconstruct-only J40; the J33 default-12
 * ab-initio inside the hetero run and the J27 bootstrap BEFORE the first
 * row have no gap to live in (run-log warnings only). */
if (!modelMini.omissions) fail.push("极简 model must carry per-gap omission notes");
else {
  const omJoin = modelMini.omissions.map((g) => g.map((o) => `${o.count}× ${o.label}`).join(" + "));
  console.log("== 极简 omissions ==", JSON.stringify(omJoin));
  if (omJoin[0] !== "1× Non-uniform refinement")
    fail.push(`极简 gap0 omissions expected "1× Non-uniform refinement" (J35) got ${omJoin[0]}`);
  if (omJoin[1] !== "") fail.push(`极简 gap1 omissions expected none (J37→J39), got ${omJoin[1]}`);
  if (omJoin[2] !== "1× Reconstruction")
    fail.push(`极简 gap2 omissions expected "1× Reconstruction" (J40) got ${omJoin[2]}`);
}
if (!modelMini.warnings.some((w) => w.includes("已合并主线上连续 3 个同类型阶段 J28 → J31 → J34 为一行「3× Hetero refinement」")))
  fail.push("极简 missing the J28→J31→J34 merge warning");
/* the merged fold must not break the 多→少 funnel either */
{
  const totals = modelMini.groups.map((g) => Math.max(...g.map((it) => it.particleTotal ?? 0)));
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[i - 1]) fail.push(`极简 funnel broke at group ${i}: ${totals[i]} > ${totals[i - 1]}`);
  }
}
const srcsMini = figureMapSources(modelMini);
if (srcsMini.size !== 8) fail.push(`极简 render set expected 8 (J34:3 + J37:1 + J39:3 + J41:1), got ${srcsMini.size}`);
if (srcsMini.has("J28/volume_class_0")) fail.push("极简 must NOT render the merged-away J28 map (the N× row shows J34's montage)");
if (srcsMini.has("J31/volume_class_0")) fail.push("极简 must NOT render the merged-away J31 maps");
const imagesMini = new Map<string, Uint8Array>();
for (const [key, src] of srcsMini) {
  imagesMini.set(key, discPng(hexToRgb(chimeraClassColor(src.classIndex))));
}
const blobMini = buildWorkflowPptx(modelMini, { images: imagesMini, style: "minimal" });
const bufMini = Buffer.from(await blobMini.arrayBuffer());
fs.writeFileSync(OUT_MINIMAL5, bufMini);
console.log("== 极简 pptx ==", OUT_MINIMAL5, bufMini.length, "bytes");

/* ------------------------------------------------------------------
 * v3.61 (round-20): the P268-like fixture — 极简 must CURATE the
 * mainline, never parallel-cram upstream/downstream jobs into one row.
 *
 * DAG (mirrors the shapes behind the user's garbled P268 deck):
 *   J201 import_micrographs (14,404) → J210 topaz_extract (4,812,000,
 *   the mainline pick) → J212 class_2D → J215 select_2D (12,259 — a
 *   small-subset 2D branch with a montage image) → J230 abinit on that
 *   selection (default-12, drops);
 *   J220 import_volumes (3 reference maps) feeds volume inputs ALL the
 *   way down (P268's “Import Volumes” rows);
 *   J240 hetero runs on the FULL extract (particle edge straight from
 *   J210, P96-J28 style) with J230's map as reference → classes c0
 *   1,900,000 feeds J250 hetero (1,900,000; 3 classes) → c0 1,178,700
 *   feeds J260 nonuniform (dual J250 parent: particles + reference map)
 *   → J270 nonuniform (dual J260 parent, same 1,178,700 → simplified
 *   merges) → J280 local_refine (1,000,000; ≥2 map-bearing DIRECT
 *   parents: J270 + J250's re-entering reference + J220 — the cramping
 *   merge) → J290 deepemhancer (2.70 Å).
 * ------------------------------------------------------------------ */
const J201 = mkNode("J201", "import_micrographs", { micrograph_count: 14404 });
const J210 = mkNode("J210", "topaz_extract", { particle_count: 4812000, micrograph_count: 14404 });
const J212 = mkNode("J212", "class_2D", { particle_count: 4812000 });
const J215 = mkNode("J215", "select_2D", {
  particle_count: 12259,
  select_2d: { particles_selected: 12259, classes_selected: 6 },
  images: [
    {
      kind: "log_image",
      name: "log_image",
      url: "http://cryosmart.test/api/log_image/j215",
      src: "http://cryosmart.test/api/log_image/j215",
      original_url: "http://cryosmart.test/api/log_image/j215",
    },
  ],
});
const J220 = mkNode("J220", "import_volumes", {
  maps: [mkMapAsset("J220", "volume_class_0"), mkMapAsset("J220", "volume_class_1"), mkMapAsset("J220", "volume_class_2")],
});
const J230 = mkNode("J230", "homo_abinit", {
  // ran on the 12,259-particle 2D selection; NO Maximum-resolution
  // parameter — absent = the cryoSPARC default 12 Å → simplified drops it.
  particle_count: 12259,
  maps: [mkMapAsset("J230", "volume_class_0"), mkMapAsset("J230", "volume_class_1")],
  classes: mkClasses("J230", [
    [0, 50.0, 6129],
    [1, 35.0, 4290],
  ]),
});
const J240 = mkNode("J240", "hetero_refine", {
  // the FULL-extract hetero (particle edge straight from J210) with
  // J230's map as reference — P96-J28's shape; its selected class 0
  // (1,900,000) feeds J250.
  particle_count: 4812000,
  maps: [mkMapAsset("J240", "volume_class_0"), mkMapAsset("J240", "volume_class_1"), mkMapAsset("J240", "volume_class_2")],
  classes: mkClasses("J240", [
    [0, 39.5, 1900000],
    [1, 31.2, 1500000],
    [2, 29.3, 1412000],
  ]),
});
const J250 = mkNode("J250", "hetero_refine", {
  particle_count: 1900000,
  maps: [mkMapAsset("J250", "volume_class_0"), mkMapAsset("J250", "volume_class_1"), mkMapAsset("J250", "volume_class_2")],
  classes: mkClasses("J250", [
    [0, 62.0, 1178700],
    [1, 21.1, 400000],
    [2, 16.9, 321300],
  ]),
});
const J260 = mkNode("J260", "nonuniform_refine_new", {
  // dual J250 parent: particles AND reference map — NOT a merge (one
  // map-bearing direct parent), so J250 stays fresh for J280's merge.
  particle_count: 1178700,
  maps: [mkMapAsset("J260", "volume")],
});
const J270 = mkNode("J270", "nonuniform_refine_new", {
  // dual J260 parent (particles + map); same count as J260 → simplified
  // merges the earlier one away.
  particle_count: 1178700,
  maps: [mkMapAsset("J270", "volume")],
});
const J280 = mkNode("J280", "new_local_refine", {
  // ≥2 map-bearing DIRECT parents (J270 + the re-entering J250 reference
  // + J220): the merge-assembly's cramping merge.
  particle_count: 1000000,
  maps: [mkMapAsset("J280", "volume")],
});
const J290 = mkNode("J290", "deepemhancer", {
  particle_count: 1000000,
  resolution_A: 2.7,
  maps: [mkMapAsset("J290", "volume")],
});
const nodes268 = [J201, J210, J212, J215, J220, J230, J240, J250, J260, J270, J280, J290];
const rawEdges268: Array<[string, string, "volume" | null]> = [
  ["J201", "J210", null],
  ["J210", "J212", null],
  ["J212", "J215", null],
  ["J215", "J230", null],
  ["J220", "J230", "volume"],
  ["J210", "J240", null],
  ["J230", "J240", "volume"],
  ["J220", "J240", "volume"],
  ["J240", "J250", null],
  ["J220", "J250", "volume"],
  ["J250", "J260", null],
  ["J250", "J260", "volume"],
  ["J260", "J270", null],
  ["J260", "J270", "volume"],
  ["J270", "J280", null],
  ["J250", "J280", "volume"],
  ["J220", "J280", "volume"],
  ["J280", "J290", "volume"],
];
const edges268 = rawEdges268.map(([source, target, kind]) => ({
  source,
  target,
  input_type: kind,
  input_name: kind,
  input_title: null,
  source_group: null,
  slots: [],
}));
const uidIndex268 = new Map(nodes268.map((n, i) => [n.uid, i] as const));
for (const e of rawEdges268) {
  const child = nodes268[uidIndex268.get(e[1])!];
  if (!child.parents.includes(e[0])) child.parents.push(e[0]);
  const parent = nodes268[uidIndex268.get(e[0])!];
  if (!parent.children.includes(e[1])) parent.children.push(e[1]);
}
const summary268: any = {
  ok: true,
  project_uid: "P268",
  base_url: "http://cryosmart.test",
  start_uid: "J290",
  start_job: J290,
  final_particle_count: 16000,
  final_micrograph_count: 14404,
  final_resolution_A: 2.7,
  resolution_note: "",
  map_download_urls: {},
  nodes: nodes268,
  edges: edges268,
  import_or_leaf_jobs: [J201],
  class_split_jobs: [J230, J240, J250].map((n) => ({ uid: n.uid, job_type: n.job_type, classes: n.classes })),
  focused_mermaid: "",
  micrograph_pixel_size_A: 0.5,
};

/* (a) the STANDARD assembly reproduces the reported disease: TWO parallel
 * rows cram an upstream + a downstream job onto the same level
 * ([J230+J220] then [J270+J250]), the imported volume J220 enters the
 * funnel, and J250 — a true mainline stage — renders ONLY inside the
 * crammed merge row (it never gets its own level). */
const std268 = buildFlowFigureModel(summary268, { maxGroups: 0 });
console.log("== P268 standard groups ==", std268.groups.length);
for (const g of std268.groups) {
  console.log(
    " p268-std:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : i.imageUrl ? "img" : "-"}]`).join(" + "),
  );
}
const parallels268 = std268.groups.filter((g) => g.length > 1);
if (parallels268.length < 2)
  fail.push(`P268 fixture must reproduce the cramping in the standard assembly (expected ≥2 parallel rows), got ${parallels268.length}`);
const cramA = parallels268.find((g) => g.some((i) => i.uid === "J230") && g.some((i) => i.uid === "J220"));
if (!cramA) fail.push("P268 standard: the ab-initio must be crammed beside the imported volumes [J230+J220]");
const cramB = parallels268.find((g) => g.some((i) => i.uid === "J270") && g.some((i) => i.uid === "J250"));
if (!cramB) fail.push("P268 standard: the nonuniform must be crammed beside its own upstream hetero [J270+J250]");
if (!std268.groups.flat().some((i) => i.uid === "J220"))
  fail.push("P268 standard: Import Volumes must be in the funnel (the reported disease)");
if (!std268.groups.flat().some((i) => i.uid === "J215"))
  fail.push("P268 standard: the 2D-selection montage row must be present (contrast with the 极简 build)");
if (std268.groups.some((g) => g.length === 1 && g[0].uid === "J250"))
  fail.push("P268 standard: J250 must render ONLY inside the crammed merge row (never its own level)");

/* (b) the round-19 极简 (simplified + 5-row cap, NO curation) still carries
 * the crammed row — the mandatory-parallel protection keeps [J270+J250]
 * while folding away the MAINLINE hetero J240 entirely: the exact
 * “很多上下游的job放在同一级，该展示的却没了” deck the user uploaded. */
const oldMini268 = buildFlowFigureModel(summary268, { maxGroups: 5, simplified: true });
if (!oldMini268.groups.some((g) => g.length > 1))
  fail.push("P268 fixture: round-19 极简 must still cram (reproduces the uploaded deck's bug)");
if (oldMini268.groups.flat().some((i) => i.uid === "J240"))
  fail.push("P268 fixture: round-19 极简 folded away the MAINLINE hetero J240 while keeping the crammed row (the reported bug)");
if (!oldMini268.groups.flat().some((i) => i.uid === "J215"))
  fail.push("P268 fixture: round-19 极简 must waste a row on the side-branch 2D montage J215 (the uploaded deck's noise)");

/* (c) the NEW 极简 (v3.61 curated mainline + v3.62 same-type merge) =
 * one job per row, the upstream→downstream order intact, Import Volumes /
 * the 2D side branch / the default-12 ab-initio all out, monotone
 * funnel. Expected: mainline [J230, J240, J250, J260, J270, J280, J290]
 * − J230 (default-12) − J260 (same-count nonuniform merge) = [J240, J250,
 * J270, J280, J290]; then the v3.62 same-type merge folds the CONSECUTIVE
 * hetero run J240+J250 into ONE “2× Hetero refinement” row (rep J250,
 * 1,900,000) → 4 rows [J250, J270, J280, J290], with the row-cap omission
 * note naming the 简化-merged J260 under the 2× row. */
const mini268 = buildFlowFigureModel(summary268, { maxGroups: 5, simplified: true, minimal: true });
console.log("== P268 极简 groups ==", mini268.groups.length);
console.log("== P268 极简 warnings ==", JSON.stringify(mini268.warnings, null, 1));
for (const g of mini268.groups) {
  console.log(
    " p268-mini:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : "-"}]`).join(" + "),
  );
}
if (mini268.groups.length !== 4) fail.push(`P268 极简 expected 4 rows (2× merged hetero row), got ${mini268.groups.length}`);
if (mini268.groups.some((g) => g.length > 1))
  fail.push("P268 极简: every row must be ONE job — no parallel cramping");
const mini268Uids = mini268.groups.flat().map((i) => i.uid).join(">");
if (mini268Uids !== "J250>J270>J280>J290")
  fail.push(`P268 极简 mainline expected J250>J270>J280>J290 (J240+J250 merged into the J250 row), got ${mini268Uids}`);
if (mini268.groups[0][0].label !== "2× Hetero refinement")
  fail.push(`P268 极简 merged-row label expected "2× Hetero refinement" got ${mini268.groups[0][0].label}`);
if (mini268.groups[0][0].particleTotal !== 1900000)
  fail.push(`P268 极简 merged-row count expected J250's 1,900,000 got ${mini268.groups[0][0].particleTotal}`);
if ((mini268.groups[0][0].classes?.length ?? 0) !== 3)
  fail.push(`P268 极简 merged-row montage expected J250's 3 classes got ${mini268.groups[0][0].classes?.length}`);
/* the omitted J260 (简化-merged non-uniform) is named under the 2× row */
if (!mini268.omissions || mini268.omissions[0]?.length !== 1 || mini268.omissions[0][0].label !== "Non-uniform refinement")
  fail.push(`P268 极简 gap0 omissions expected "1× Non-uniform refinement" (J260), got ${JSON.stringify(mini268.omissions?.[0])}`);
for (const absent of ["J220", "J215", "J230", "J240", "J260"])
  if (mini268.groups.flat().some((i) => i.uid === absent))
    fail.push(`P268 极简 must not carry ${absent} (import / side-2D / dropped bootstrap / merged-member / merged nonuniform)`);
{
  const totals = mini268.groups.map((g) => Math.max(...g.map((it) => it.particleTotal ?? 0)));
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[i - 1]) fail.push(`P268 极简 funnel broke at group ${i}: ${totals[i]} > ${totals[i - 1]}`);
  }
}
if (!mini268.warnings.some((w) => w.includes("已精选颗粒主线上的 7 个阶段")))
  fail.push("P268 极简: missing the mainline-curation banner warning");
if (!mini268.warnings.some((w) => w.includes("另排除 1 个导入/种子阶段")))
  fail.push("P268 极简: missing the import-seed exclusion warning");
if (!mini268.warnings.some((w) => w.includes("已省略 ab-initio 步骤 J230")))
  fail.push("P268 极简: missing the default-12 Å J230 drop warning");
if (!mini268.warnings.some((w) => w.includes("已合并连续 Non-uniform 精修 J260 → J270")))
  fail.push("P268 极简: missing the J260→J270 non-uniform merge warning");
if (!mini268.warnings.some((w) => w.includes("已合并主线上连续 2 个同类型阶段 J240 → J250 为一行「2× Hetero refinement」")))
  fail.push("P268 极简: missing the J240→J250 same-type merge warning");
if (mini268.headerStats.micrographs !== "14,404 Micrographs")
  fail.push(`P268 header micrographs got ${mini268.headerStats.micrographs}`);
/* v3.62: full separators — the uploaded P268 deck's “4812K particles” is
 * exactly the truncation this round retires. */
if (mini268.headerStats.particles !== "4,812,000 particles")
  fail.push(`P268 header particles got ${mini268.headerStats.particles}`);
if (mini268.finalStats !== "2.70 Å") fail.push(`P268 极简 finalStats got ${mini268.finalStats}`);
if (mini268.referenceKey !== "J290/volume") fail.push(`P268 极简 referenceKey got ${mini268.referenceKey}`);
const srcs268 = figureMapSources(mini268);
if (srcs268.size !== 6) fail.push(`P268 极简 render set expected 6 (3+1+1+1 over 4 rows), got ${srcs268.size}`);
if (srcs268.has("J240/volume_class_0"))
  fail.push("P268 极简 must NOT render the merged-away J240 maps (the N× row shows J250's montage)");
const OUT_MINIMAL_P268 = path.join(OUT_DIR, "out-minimal-p268.pptx");
const imagesP268 = new Map<string, Uint8Array>();
for (const [key, src] of srcs268) {
  imagesP268.set(key, discPng(hexToRgb(chimeraClassColor(src.classIndex))));
}
const blobP268 = buildWorkflowPptx(mini268, { images: imagesP268, style: "minimal" });
const bufP268 = Buffer.from(await blobP268.arrayBuffer());
fs.writeFileSync(OUT_MINIMAL_P268, bufP268);
console.log("== P268 极简 pptx ==", OUT_MINIMAL_P268, bufP268.length, "bytes");

/* ------------------------------------------------------------------
 * v3.62 (round-21): the P300 fixture — cap + omission notes + the
 * anchor-centring geometry on BOTH parities.
 *
 * A 9-stage LINEAR mainline (J310 hetero 5M/2cl → J320 hetero 3M/3cl →
 * J330 ab-initio (deliberate 6 Å, KEPT by 简化) → J340 hetero 1.5M/2cl
 * → J350 non-uniform 1.2M → J360 non-uniform 900K (DIFFERENT count — the
 * 简化 same-count rule must NOT merge it; the v3.62 极简 same-TYPE merge
 * folds the pair into “2× Non-uniform refinement”) → J370 local → J375
 * refinement → J380 DeepEMhancer 2.80 Å).
 *
 * Post-simplified rows: all 9. After the v3.62 same-type merge: 7
 * ([2× Hetero(J320), Ab-initio(J330), Hetero(J340), 2× Non-uniform(J360),
 * Local(J370), Refinement(J375), DeepEMhancer(J380)]) — J340 does NOT
 * merge into the 2× Hetero row (the kept ab-initio J330 sits between
 * them on the TRUE flow — flattening it would lie about the order).
 * The 6-row cap (first+last, fill from the END) drops exactly the
 * J330 ab-initio row → gap0 carries “omitted: 1× Ab-initio
 * reconstruction”. The kept J340 row (2 classes, anchor = c0 1,200,000 =
 * the max class feeding J350-family) centres its frame on the spine via
 * the EVEN-count nudge; the merged J320 row (3 classes, anchor = c2
 * 1,500,000) centres via the odd-count swap. Both frames must sit at
 * x = spine ±0.06 in the emitted slide XML.
 * ------------------------------------------------------------------ */
const mkNodeP300 = (uid: string, job_type: string, extra: Record<string, unknown> = {}) =>
  ({ ...mkNode(uid, job_type, extra), project_uid: "P300" });
const J300 = mkNodeP300("J300", "import_micrographs", { micrograph_count: 20000 });
const J305 = mkNodeP300("J305", "topaz_extract", { particle_count: 5000000, micrograph_count: 20000 });
const J310 = mkNodeP300("J310", "hetero_refine", {
  particle_count: 5000000,
  maps: [mkMapAsset("J310", "volume_class_0"), mkMapAsset("J310", "volume_class_1")],
  classes: mkClasses("J310", [
    [0, 60.0, 3000000],
    [1, 40.0, 2000000],
  ]),
});
const J320 = mkNodeP300("J320", "hetero_refine", {
  particle_count: 3000000,
  maps: [mkMapAsset("J320", "volume_class_0"), mkMapAsset("J320", "volume_class_1"), mkMapAsset("J320", "volume_class_2")],
  classes: mkClasses("J320", [
    [0, 33.3, 1000000],
    [1, 16.7, 500000],
    [2, 50.0, 1500000],
  ]),
});
const J330 = mkNodeP300("J330", "homo_abinit", {
  particle_count: 1500000,
  // deliberately NON-default 6 Å — 简化 KEEPS it; only the 6-row cap drops it
  abinit_max_resolution_A: 6,
  maps: [mkMapAsset("J330", "volume")],
});
const J340 = mkNodeP300("J340", "hetero_refine", {
  particle_count: 1500000,
  maps: [mkMapAsset("J340", "volume_class_0"), mkMapAsset("J340", "volume_class_1")],
  classes: mkClasses("J340", [
    [0, 80.0, 1200000],
    [1, 20.0, 300000],
  ]),
});
const J350 = mkNodeP300("J350", "nonuniform_refine_new", {
  particle_count: 1200000,
  maps: [mkMapAsset("J350", "volume")],
});
const J355 = mkNodeP300("J355", "remove_duplicate_particles", {
  // map-less dedup BETWEEN the two non-uniforms — the 简化 same-count /
  // ctf-only merge rule must NOT fire across it (a non-CTF intermediate
  // disqualifies), so the two non-uniforms stay adjacent on the DISPLAYED
  // mainline and only the v3.62 极简 same-TYPE merge folds them into
  // “2× Non-uniform refinement”.
  particle_count: 1100000,
});
const J360 = mkNodeP300("J360", "nonuniform_refine_new", {
  // DIFFERENT count from J350 — and with J355 between them, 简化 keeps
  // BOTH; the v3.62 极简 same-TYPE merge folds the pair.
  particle_count: 900000,
  maps: [mkMapAsset("J360", "volume")],
});
const J370 = mkNodeP300("J370", "new_local_refine", {
  particle_count: 900000,
  maps: [mkMapAsset("J370", "volume")],
});
const J375 = mkNodeP300("J375", "homo_refine", {
  particle_count: 900000,
  maps: [mkMapAsset("J375", "volume")],
});
const J380 = mkNodeP300("J380", "deepemhancer", {
  particle_count: 900000,
  resolution_A: 2.8,
  maps: [mkMapAsset("J380", "volume")],
});
const nodes300 = [J300, J305, J310, J320, J330, J340, J350, J355, J360, J370, J375, J380];
const rawEdges300: Array<[string, string, "volume" | null]> = [
  ["J300", "J305", null],
  ["J305", "J310", null],
  ["J310", "J320", null],
  ["J320", "J330", null],
  ["J330", "J340", null],
  ["J340", "J350", null],
  ["J350", "J355", null],
  ["J355", "J360", null],
  ["J360", "J370", null],
  ["J370", "J375", null],
  ["J375", "J380", null],
];
const edges300 = rawEdges300.map(([source, target, kind]) => ({
  source,
  target,
  input_type: kind,
  input_name: kind,
  input_title: null,
  source_group: null,
  slots: [],
}));
const uidIndex300 = new Map(nodes300.map((n, i) => [n.uid, i] as const));
for (const e of rawEdges300) {
  const child = nodes300[uidIndex300.get(e[1])!];
  if (!child.parents.includes(e[0])) child.parents.push(e[0]);
  const parent = nodes300[uidIndex300.get(e[0])!];
  if (!parent.children.includes(e[1])) parent.children.push(e[1]);
}
const summary300: any = {
  ok: true,
  project_uid: "P300",
  base_url: "http://cryosmart.test",
  start_uid: "J380",
  start_job: J380,
  final_particle_count: 900000,
  final_micrograph_count: 20000,
  final_resolution_A: 2.8,
  resolution_note: "",
  map_download_urls: {},
  nodes: nodes300,
  edges: edges300,
  import_or_leaf_jobs: [J300],
  class_split_jobs: [J310, J320, J340].map((n) => ({ uid: n.uid, job_type: n.job_type, classes: n.classes })),
  focused_mermaid: "",
  micrograph_pixel_size_A: 0.5,
};
const mini300 = buildFlowFigureModel(summary300, { maxGroups: 6, simplified: true, minimal: true });
console.log("== P300 极简 groups ==", mini300.groups.length);
for (const g of mini300.groups) {
  console.log(
    " p300-mini:",
    g.map((i) => `${i.uid}[${i.classes ? i.classes.map((c) => c.mapKey.split("/")[1]).join("+") : "-"}]`).join(" + "),
  );
}
if (mini300.groups.length !== 6)
  fail.push(`P300 极简 expected 6 rows (7 post-merge − 1 cap drop), got ${mini300.groups.length}`);
const p300Labels = mini300.groups.map((g) => g[0].label);
const wantP300 = [
  "2× Hetero refinement",
  "Hetero refinement",
  "2× Non-uniform refinement",
  "Local refinement",
  "Refinement",
  "DeepEMhancer",
];
for (let i = 0; i < wantP300.length; i++)
  if (p300Labels[i] !== wantP300[i]) fail.push(`P300 极简 row ${i} label expected "${wantP300[i]}" got "${p300Labels[i]}"`);
const p300Uids = mini300.groups.flat().map((i) => i.uid).join(">");
if (p300Uids !== "J320>J340>J360>J370>J375>J380")
  fail.push(`P300 极简 rows expected J320>J340>J360>J370>J375>J380 (the cap dropped the J330 ab-initio row), got ${p300Uids}`);
/* the CONSECUTIVE-ONLY merge rule: J310+J320 fold (adjacent), J340 stays
 * separate (the kept ab-initio J330 sits between them in the true flow) */
if (!mini300.warnings.some((w) => w.includes("已合并主线上连续 2 个同类型阶段 J310 → J320")))
  fail.push("P300: missing the J310→J320 merge warning");
if (!mini300.warnings.some((w) => w.includes("已合并主线上连续 2 个同类型阶段 J350 → J360")))
  fail.push("P300: missing the J350→J360 merge warning");
if (mini300.warnings.some((w) => w.includes("J320 → J340") || w.includes("J310 → J340")))
  fail.push("P300: the J340 hetero must NOT merge across the ab-initio (not consecutive)");
if (!mini300.warnings.some((w) => w.includes("已精选 6 行") || mini300.groups.length === 6))
  fail.push("P300: the 6-row cap must fire on the 7-row post-merge mainline");
/* gap0 (2× Hetero → J340) names the cap-dropped ab-initio; the 简化 pass
 * dropped nothing here (J350/J360 merged only as an 极简 N× row, whose
 * members are NOT omissions) */
if (!mini300.omissions || mini300.omissions[0]?.length !== 1 || mini300.omissions[0][0].label !== "Ab-initio reconstruction")
  fail.push(`P300 gap0 omissions expected "1× Ab-initio reconstruction", got ${JSON.stringify(mini300.omissions?.[0])}`);
for (let i = 1; i < 5; i++)
  if ((mini300.omissions?.[i] ?? []).length)
    fail.push(`P300 gap${i} omissions expected none, got ${JSON.stringify(mini300.omissions?.[i])}`);
{
  const totals = mini300.groups.map((g) => Math.max(...g.map((it) => it.particleTotal ?? 0)));
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[i - 1]) fail.push(`P300 极简 funnel broke at group ${i}: ${totals[i]} > ${totals[i - 1]}`);
  }
}
if (mini300.headerStats.particles !== "5,000,000 particles")
  fail.push(`P300 header particles got ${mini300.headerStats.particles}`);
if (mini300.finalStats !== "2.80 Å") fail.push(`P300 finalStats got ${mini300.finalStats}`);
const srcs300 = figureMapSources(mini300);
if (srcs300.size !== 9) fail.push(`P300 极简 render set expected 9 (J320:3 + J340:2 + J360:1 + J370:1 + J375:1 + J380:1), got ${srcs300.size}`);
const OUT_MINIMAL_P300 = path.join(OUT_DIR, "out-minimal-p300.pptx");
const imagesP300 = new Map<string, Uint8Array>();
for (const [key, src] of srcs300) {
  imagesP300.set(key, discPng(hexToRgb(chimeraClassColor(src.classIndex))));
}
const blobP300 = buildWorkflowPptx(mini300, { images: imagesP300, style: "minimal" });
const bufP300 = Buffer.from(await blobP300.arrayBuffer());
fs.writeFileSync(OUT_MINIMAL_P300, bufP300);
console.log("== P300 极简 pptx ==", OUT_MINIMAL_P300, bufP300.length, "bytes");

/* ------------------------------------------------------------------ */
/* v3.54 default-12 Å ab-initio final: resolution info ignored         */
/* ------------------------------------------------------------------ */

const J50 = mkNode("J50", "homo_abinit", {
  particle_count: 58048,
  resolution_A: 12,
  maps: [mkMapAsset("J50", "volume_class_0"), mkMapAsset("J50", "volume_class_1")],
  classes: mkClasses("J50", [
    [0, 50, 29024],
    [1, 35, 20317],
  ]),
});
const chain50 = [J1, J50];
const summary50: any = {
  ...summary,
  start_uid: "J50",
  start_job: J50,
  final_particle_count: 58048,
  final_resolution_A: 12,
  nodes: chain50,
  edges: [{ source: "J1", target: "J50", input_type: "volume", input_name: "volume", input_title: null, source_group: null, slots: [] }],
  class_split_jobs: [{ uid: "J50", job_type: "homo_abinit", classes: J50.classes }],
};
const full50 = buildFlowFigureModel(summary50, { maxGroups: 0 });
if (full50.finalStats !== "12.0 Å") fail.push(`ab-initio-final full-mode finalStats expected "12.0 Å" got ${full50.finalStats}`);
const simplified50 = buildFlowFigureModel(summary50, { maxGroups: 0, simplified: true });
if (simplified50.finalStats !== null) fail.push(`ab-initio-final simplified finalStats expected null got ${simplified50.finalStats}`);
if (!simplified50.warnings.some((w) => w.includes("已忽略") && w.includes("12.0 Å"))) fail.push("missing default-12 Å ignore warning");
if (!simplified50.groups.flat().some((i) => i.uid === "J50")) fail.push("the FINAL ab-initio must never be dropped");
console.log("== 12Å case ==", JSON.stringify({ full: full50.finalStats, simplified: simplified50.finalStats }));

/* ------------------------------------------------------------------ */
/* v3.55: job-id labels inside the emitted PPTX slide XML              */
/* ------------------------------------------------------------------ */

/* unzip the decks and inspect the slide's label runs */
function zipPartText(pptxPath: string, partName: string): string {
  const buf = fs.readFileSync(pptxPath);
  // minimal stored/deflate zip scan: find the wanted entry
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(off + 26);
      const extraLen = buf.readUInt16LE(off + 28);
      const compSize = buf.readUInt32LE(off + 18);
      const method = buf.readUInt16LE(off + 8);
      const nameStart = off + 30;
      const dataStart = nameStart + nameLen + extraLen;
      const name = buf.toString("utf8", nameStart, nameStart + nameLen);
      if (name === partName) {
        const raw = buf.subarray(dataStart, dataStart + compSize);
        if (method === 0) return raw.toString("utf8");
        return inflateRawSync(raw).toString("utf8");
      }
      off = dataStart + compSize - 1;
    }
    off += 1;
  }
  throw new Error(partName + " not found in " + pptxPath);
}
function slide1Xml(pptxPath: string): string {
  return zipPartText(pptxPath, "ppt/slides/slide1.xml");
}
const xmlFull = slide1Xml(OUT);
const xmlSimplified = slide1Xml(OUT_SIMPLIFIED);
const xmlMinimal = slide1Xml(OUT_MINIMAL);
const xmlMini = slide1Xml(OUT_MINIMAL5);
const xmlP268 = slide1Xml(OUT_MINIMAL_P268);
const xmlP300 = slide1Xml(OUT_MINIMAL_P300);
const EMU = 914400;
console.log("== slide xml uid-run checks ==");
if (!xmlFull.includes(" · J31") || !xmlFull.includes(" · J41"))
  fail.push("full deck labels missing the gray job-id runs (· J31 / · J41)");
if (!xmlFull.includes(" · J28")) fail.push("full deck missing the J28 stage label id");
if (!xmlFull.includes(" · J40")) fail.push("full deck missing the reconstruct-only J40 stage (kept in full mode)");
if (!xmlFull.includes('sz="700"') || !xmlFull.includes('val="808080"'))
  fail.push("full deck job-id runs missing the 7 pt gray styling");
if (!xmlSimplified.includes(" · J39") || !xmlSimplified.includes(" · J28")) fail.push("simplified deck missing the kept J39/J28 label ids");
if (xmlSimplified.includes(" · J33") || xmlSimplified.includes(" · J27"))
  fail.push("simplified deck must NOT label the dropped J27/J33 stages");
if (xmlSimplified.includes(" · J35")) fail.push("simplified deck must NOT label the merged-away non-uniform J35");
if (xmlSimplified.includes(" · J40")) fail.push("simplified deck must NOT label the dropped reconstruct-only J40");

/* ------------------------------------------------------------------
 * v3.59 (round-18): portrait spine layout invariants.                  */
/* ------------------------------------------------------------------ */
console.log("== v3.59 portrait / fixed-arrow / spine checks ==");
for (const [deckPath, deckXml, deck] of [
  [OUT, xmlFull, "full deck"],
  [OUT_SIMPLIFIED, xmlSimplified, "simplified deck"],
  [OUT_MINIMAL, xmlMinimal, "minimal deck"],
  [OUT_MINIMAL5, xmlMini, "极简 capped deck"],
  [OUT_MINIMAL_P268, xmlP268, "P268 极简 deck"],
  [OUT_MINIMAL_P300, xmlP300, "P300 极简 deck"],
] as Array<[string, string, string]>) {
  const presXml = zipPartText(deckPath, "ppt/presentation.xml");
  const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presXml);
  if (!sz) {
    fail.push(`${deck}: presentation.xml carries no sldSz`);
    continue;
  }
  const wIn = +sz[1] / EMU;
  const hIn = +sz[2] / EMU;
  if (+sz[1] !== 6858000) fail.push(`${deck}: portrait width must be 7.5 in, got ${wIn}`);
  if (hIn < 10) fail.push(`${deck}: slide height must be ≥ 10 in, got ${hIn}`);
  /* every shape must sit inside the canvas (the grown height covers all
   * content; nothing may fall off the bottom edge). */
  {
    let maxBottom = 0;
    for (const m of deckXml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/g)) {
      maxBottom = Math.max(maxBottom, (+m[2] + +m[4]) / EMU);
    }
    if (maxBottom > hIn + 0.01) fail.push(`${deck}: content bottom ${maxBottom.toFixed(2)} in exceeds the ${hIn.toFixed(2)} in canvas`);
  }
  /* connectors: ONLY vertical straightConnector1 arrows, fixed 0.39 in
   * length, 1 pt weight, triangle head, all on the spine x = 3.75. */
  const ARROW_EMU = 0.39 * EMU;
  const conns = [...deckXml.matchAll(/<p:cxnSp>.*?<\/p:cxnSp>/gs)].map((m) => m[0]);
  if (!conns.length) fail.push(`${deck}: no connectors emitted`);
  const expectedConns = (deckXml.match(/直接箭头连接符/g) || []).length;
  for (const cn of conns) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(cn);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(cn);
    if (!off || !ext) continue;
    if (+ext[1] !== 0) fail.push(`${deck}: connector must be vertical, got cx=${ext[1]}`);
    else if (Math.abs(+ext[2] - ARROW_EMU) > 400)
      fail.push(`${deck}: connector length must be the fixed 0.39 in (±0.0004), got ${+ext[2] / EMU}`);
    if (+off[1] !== Math.round(3.75 * EMU))
      fail.push(`${deck}: connector must sit on the spine x=3.75, got ${+off[1] / EMU}`);
    if (!/prst="straightConnector1"/.test(cn)) fail.push(`${deck}: connector is not a straightConnector1`);
    if (!/<a:ln w="12700">/.test(cn)) fail.push(`${deck}: connector line must be the fixed 1 pt (w=12700)`);
    if (!/<a:tailEnd type="triangle"\/>/.test(cn)) fail.push(`${deck}: connector must carry the triangle head`);
    if (/flipH="1"|flipV="1"/.test(cn)) fail.push(`${deck}: a downward spine arrow must not need flips`);
  }
  if (conns.length !== expectedConns)
    fail.push(`${deck}: ${expectedConns - conns.length} connectors are not 直接箭头连接符-named`);
}
/* header: the three texts, NO inter-item arrows in the band (the reference
 * dropped them); "Auto pick" raised between the two counts. */
for (const [deckXml, deck] of [
  [xmlFull, "full deck"],
  [xmlMinimal, "minimal deck"],
  [xmlMini, "极简 capped deck"],
  [xmlP268, "P268 极简 deck"],
  [xmlP300, "P300 极简 deck"],
] as Array<[string, string]>) {
  const texts = [...deckXml.matchAll(/<p:sp>.*?<\/p:sp>/gs)]
    .map((m) => {
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
      const t = [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((r) => r[1]).join("|");
      return { y: off ? +off[2] / EMU : -1, t };
    })
    .filter((s) => s.y < 0.9 && s.y >= 0.3);
  const byT = (frag: string) => texts.find((s) => s.t.includes(frag));
  const pick = byT("Auto pick");
  const micro = byT("Micrographs");
  const parts = byT("particles");
  if (!micro || !parts) fail.push(`${deck}: header band missing the counts`);
  if (pick && micro && micro.y - pick.y < 0.1)
    fail.push(`${deck}: header counts must sit BELOW the raised "Auto pick"`);
  if (pick && parts && parts.y - pick.y < 0.1)
    fail.push(`${deck}: header "N particles" must sit BELOW the raised "Auto pick"`);
  /* no connector inside the header band (y < 0.9): all connectors start
   * at/after the band's bottom. */
  for (const m of deckXml.matchAll(/<p:cxnSp>.*?<\/p:cxnSp>/gs)) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
    if (off && +off[2] / EMU < 0.8) fail.push(`${deck}: header band must carry no arrows`);
  }
}

/* minimal deck specifics: bare stage names (NO job-id runs), NO footnote,
 * the 5 selection frames (J27 c0 / J31 c0 / J33 c0 / J34 c0 / J39 c2),
 * the retention labels with the P96 percentages, and the final Å. */
if (xmlMinimal.includes(" · J")) fail.push("minimal deck must NOT carry job-id label runs");
if (xmlMinimal.includes("CryoSmart Workflow Figure")) fail.push("minimal deck must NOT carry the footnote");
{
  /* selection frames are the 矩形-named rects (text boxes are 文本框);
   * every synthesized image exists, so there are NO placeholder frames. */
  const frames = (xmlMinimal.match(/name="矩形 /g) || []).length;
  if (frames !== 5) fail.push(`minimal deck expected exactly 5 selection frames, got ${frames}`);
  for (const pct of ["48.3%", "77.0%", "64.1%", "55.2%"]) {
    if (!xmlMinimal.includes(pct)) fail.push(`minimal deck missing the retention label ${pct}`);
  }
  if (!xmlMinimal.includes("378,677 particles")) fail.push("minimal deck missing the 378,677 retention count");
  if (!xmlMinimal.includes("1,588,675 particles")) fail.push("minimal deck missing the 1,588,675 retention count");
  /* 100% transitions must print the count WITHOUT a percentage line. */
  if (xmlMinimal.includes("100.0%")) fail.push("minimal deck must not print a 100% retention line");
  if (!xmlMinimal.includes("3.20 Å")) fail.push("minimal deck missing the final resolution under the last map");
  /* the standard-only trimmings must be absent: no side stats boxes, no
   * per-class stats under thumbs (the 2:1 minimal rows carry only labels +
   * pics + frames + retention + Å text). */
  if (xmlMinimal.includes("77%")) fail.push("minimal deck must not render per-class stats lines");
}

/* 极简 capped deck specifics (v3.62): the SAME-TYPE MERGE folds J28+J31+J34
 * into ONE “3× Hetero refinement” row (rep J34, 590,421 — the J28→J34
 * retention 37.2% is gone with the run; the 64.1% label now follows the
 * merged row), 4 rows / 8 thumbnails / 2 selection frames (the 3× row's
 * J34 c0 + J39 c2, both CENTRED on the spine), the per-gap omission notes
 * for the 简化-merged J35 and the reconstruct-only J40, no job ids /
 * footnote, final Å kept. */
if (xmlMini.includes(" · J")) fail.push("极简 capped deck must NOT carry job-id label runs");
if (xmlMini.includes("CryoSmart Workflow Figure")) fail.push("极简 capped deck must NOT carry the footnote");
if (!xmlMini.includes(">3× Hetero refinement<")) fail.push("极简 capped deck missing the merged 3× Hetero refinement row label");
if (!xmlMini.includes("64.1%")) fail.push("极简 capped deck missing the 64.1% retention under the merged row");
if (!xmlMini.includes("378,677 particles")) fail.push("极简 capped deck missing the 378,677 retention count");
if (!xmlMini.includes("55.2%") || !xmlMini.includes("209,127 particles")) fail.push("极简 capped deck missing the 55.2% / 209,127 retention label");
if (xmlMini.includes("37.2%")) fail.push("极简 capped deck must not print the merged-away J28→J34 retention 37.2%");
if (xmlMini.includes("48.3%") || xmlMini.includes("77.0%"))
  fail.push("极简 capped deck must NOT carry the folded-away J31 labels (48.3%/77.0%)");
if (xmlMini.includes("100.0%")) fail.push("极简 capped deck must not print a 100% retention line");
if (!xmlMini.includes("3.20 Å")) fail.push("极简 capped deck missing the final resolution under the last map");
/* v3.62 round-21: the omitted steps are NAMED on the figure — J35 under
 * the 3× row, J40 under J39. */
if (!xmlMini.includes("omitted: 1× Non-uniform refinement"))
  fail.push("极简 capped deck missing the J35 gap note 'omitted: 1× Non-uniform refinement'");
if (!xmlMini.includes("omitted: 1× Reconstruction"))
  fail.push("极简 capped deck missing the J40 gap note 'omitted: 1× Reconstruction'");
if (!xmlMini.includes('sz="650"')) fail.push("极简 capped deck: the omission note must be the smaller gray run (sz=650)");
{
  const framesMini = (xmlMini.match(/name="矩形 /g) || []).length;
  if (framesMini !== 2) fail.push(`极简 capped deck expected exactly 2 selection frames (3× row J34 c0 + J39 c2), got ${framesMini}`);
  const picsMini = (xmlMini.match(/<p:pic>/g) || []).length;
  if (picsMini !== 8) fail.push(`极简 capped deck expected 8 thumbnails (3+1+3+1 over 4 rows), got ${picsMini}`);
  const connsMini = (xmlMini.match(/直接箭头连接符/g) || []).length;
  if (connsMini !== 4) fail.push(`极简 capped deck expected 4 fixed arrows (header→row1 + 3 inter-row), got ${connsMini}`);
}
/* v3.62: UNIFORM PITCH — every inter-row band keeps the retention-slot
 * height, so all row image-tops are equally spaced (the rows without a
 * retention label used to sit 0.29 in closer). */
{
  const imgTops = [...xmlMini.matchAll(/<p:pic>.*?<a:off x="(-?\d+)" y="(-?\d+)"/gs)].map((m) => +m[2] / EMU).sort((a, b) => a - b);
  const rowTops = [...new Set(imgTops.map((y) => Math.round(y * 100) / 100))];
  for (let i = 2; i < rowTops.length; i++) {
    const pitch = rowTops[i] - rowTops[i - 1];
    if (Math.abs(pitch - (rowTops[1] - rowTops[0])) > 0.02)
      fail.push(`极简 capped deck: inter-row pitch broke at row ${i} (${pitch.toFixed(2)} vs ${(rowTops[1] - rowTops[0]).toFixed(2)})`);
  }
}
/* v3.62: ANCHOR-CENTRED frames — both selection rectangles sit on the
 * spine x=3.75 (±0.06): the 3-class merged row swaps its anchor into the
 * centre slot, so the frame reads under the arrows for EVERY sample. */
{
  const frames = [...xmlMini.matchAll(/<p:sp>.*?<\/p:sp>/gs)]
    .filter((m) => /name="矩形 /.test(m[0]))
    .map((m) => {
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
      return off && ext ? { cx: (+off[1] + +ext[1] / 2) / EMU, cy: (+off[2] + +ext[3] / 2) / EMU } : null;
    })
    .filter((f): f is { cx: number; cy: number } => !!f);
  for (const f of frames)
    if (Math.abs(f.cx - 3.75) > 0.06)
      fail.push(`极简 capped deck: selection frame centre x=${f.cx.toFixed(2)} is OFF the spine 3.75 (anchor-centring failed)`);
}

/* P268 极简 deck specifics (v3.62 round-21): the curated mainline reads as
 * FOUR rows — “2× Hetero refinement” (J240+J250 merged; J250's 3-class
 * montage) → non-uniform → local → DeepEMhancer — with ONE selection
 * frame (J250 c0 1,178,700 feeding J270, CENTRED on the spine), the
 * exact retention labels of the merged funnel (62.0% / 84.8% + the
 * count-only 1,000,000 line), the J260 gap note under the 2× row, the
 * full-separator header (“4,812,000 particles”), NO Import Volumes text,
 * NO dropped-stage counts (58,048 / 12,259 never print), no job ids, no
 * footnote, and the final Å on the spine. */
{
  if (xmlP268.includes("Import Volumes")) fail.push("P268 极简 deck must NOT carry the Import Volumes label");
  if (xmlP268.includes(" · J")) fail.push("P268 极简 deck must NOT carry job-id label runs");
  if (xmlP268.includes("CryoSmart Workflow Figure")) fail.push("P268 极简 deck must NOT carry the footnote");
  if (!xmlP268.includes(">2× Hetero refinement<")) fail.push("P268 极简 deck missing the merged “2× Hetero refinement” row label");
  for (const frag of ["4,812,000 particles", "62.0%", "1,178,700 particles", "84.8%", "1,000,000 particles", "2.70 Å", "omitted: 1× Non-uniform refinement"])
    if (!xmlP268.includes(frag)) fail.push(`P268 极简 deck missing "${frag}"`);
  if (xmlP268.includes("39.5%")) fail.push("P268 极简 deck must not print the merged-away J240→J250 retention 39.5%");
  if (xmlP268.includes("12,259")) fail.push("P268 极简 deck must not print the dropped ab-initio / 2D-selection count");
  if (xmlP268.includes("100.0%")) fail.push("P268 极简 deck must not print a 100% retention line");
  const framesP268 = (xmlP268.match(/name="矩形 /g) || []).length;
  if (framesP268 !== 1) fail.push(`P268 极简 deck expected exactly 1 selection frame (the merged row's J250 c0), got ${framesP268}`);
  const picsP268 = (xmlP268.match(/<p:pic>/g) || []).length;
  if (picsP268 !== 6) fail.push(`P268 极简 deck expected 6 thumbnails (3+1+1+1 over 4 rows), got ${picsP268}`);
  const connsP268 = (xmlP268.match(/直接箭头连接符/g) || []).length;
  if (connsP268 !== 4) fail.push(`P268 极简 deck expected 4 fixed arrows (header→row1 + 3 inter-row), got ${connsP268}`);
  /* the merged row's frame must sit ON the spine (the 3-class anchor swap) */
  for (const m of xmlP268.matchAll(/<p:sp>.*?<\/p:sp>/gs)) {
    if (!/name="矩形 /.test(m[0])) continue;
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
    if (off && ext) {
      const cx = (+off[1] + +ext[1] / 2) / EMU;
      if (Math.abs(cx - 3.75) > 0.06)
        fail.push(`P268 极简 deck: the merged-row frame centre x=${cx.toFixed(2)} is OFF the spine 3.75`);
    }
  }
}

/* P300 极简 deck specifics (v3.62 round-21): the 6-row capped deck — the
 * gap note names the cap-dropped ab-initio, the retention labels read
 * 50.0% / 60.0% / count-only / count-only, BOTH selection frames (the
 * odd-count swap on the merged J320 row AND the even-count nudge on the
 * J340 2-class row) centre on the spine, and the 6 rows share ONE
 * uniform pitch. */
{
  for (const frag of [">2× Hetero refinement<", ">2× Non-uniform refinement<", "omitted: 1× Ab-initio reconstruction", "50.0%", "1,500,000 particles", "60.0%", "900,000 particles", "2.80 Å"])
    if (!xmlP300.includes(frag)) fail.push(`P300 极简 deck missing "${frag}"`);
  if (xmlP300.includes(" · J")) fail.push("P300 极简 deck must NOT carry job-id label runs");
  if (xmlP300.includes("100.0%")) fail.push("P300 极简 deck must not print a 100% retention line");
  if (xmlP300.includes(">Ab-initio reconstruction<"))
    fail.push("P300 极简 deck must not render the cap-dropped J330 ab-initio row (it only appears in the omission note)");
  const framesP300 = (xmlP300.match(/name="矩形 /g) || []).length;
  if (framesP300 !== 2) fail.push(`P300 极简 deck expected exactly 2 selection frames (J320 c2 + J340 c0), got ${framesP300}`);
  const picsP300 = (xmlP300.match(/<p:pic>/g) || []).length;
  if (picsP300 !== 9) fail.push(`P300 极简 deck expected 9 thumbnails (3+2+1+1+1+1 over 6 rows), got ${picsP300}`);
  const connsP300 = (xmlP300.match(/直接箭头连接符/g) || []).length;
  if (connsP300 !== 6) fail.push(`P300 极简 deck expected 6 fixed arrows (header→row1 + 5 inter-row), got ${connsP300}`);
  /* BOTH frames centred on the spine — the odd-count swap (J320) and the
   * even-count nudge (J340) must each land under the flow. */
  const frameCenters = [...xmlP300.matchAll(/<p:sp>.*?<\/p:sp>/gs)]
    .filter((m) => /name="矩形 /.test(m[0]))
    .map((m) => {
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[0]);
      return off && ext ? (+off[1] + +ext[1] / 2) / EMU : null;
    })
    .filter((v): v is number => v != null);
  for (const cx of frameCenters)
    if (Math.abs(cx - 3.75) > 0.06)
      fail.push(`P300 极简 deck: selection frame centre x=${cx.toFixed(2)} is OFF the spine 3.75`);
  /* UNIFORM PITCH across all 6 rows. */
  const imgTops = [...xmlP300.matchAll(/<p:pic>.*?<a:off x="(-?\d+)" y="(-?\d+)"/gs)].map((m) => +m[2] / EMU).sort((a, b) => a - b);
  const rowTops = [...new Set(imgTops.map((y) => Math.round(y * 100) / 100))];
  if (rowTops.length !== 6) fail.push(`P300 极简 deck expected 6 distinct row tops, got ${rowTops.length}`);
  for (let i = 2; i < rowTops.length; i++) {
    const pitch = rowTops[i] - rowTops[i - 1];
    if (Math.abs(pitch - (rowTops[1] - rowTops[0])) > 0.02)
      fail.push(`P300 极简 deck: inter-row pitch broke at row ${i} (${pitch.toFixed(2)} vs ${(rowTops[1] - rowTops[0]).toFixed(2)})`);
  }
}

/* ------------------------------------------------------------------
 * v3.58 (round-17 “连线还是会出现错位”): connector geometry invariants.
 * Every connector is an axis-aligned straightConnector1 (the bent wrap is
 * gone — assert that), and NO segment may cross the interior of a
 * thumbnail or a stats/label/Å text box (below the header band y<0.79,
 * whose inter-item arrows ride inside the band's own right-aligned text
 * slots). This is the invariant that deck (6) violated: the wrap
 * crossed J34's class-2 thumbnail and J37's side stats box. */
function slideGeometry(xml: string) {
  const EMU = 914400;
  const segRe = /<p:cxnSp>.*?<\/p:cxnSp>/gs;
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  let sawBent = false;
  let sawDiagonal = false;
  for (const m of xml.matchAll(segRe)) {
    const cn = m[0];
    if (/bentConnector/.test(cn)) sawBent = true;
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(cn);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(cn);
    if (!off || !ext) continue;
    const x = +off[1] / EMU, y = +off[2] / EMU, w = +ext[1] / EMU, h = +ext[2] / EMU;
    if (w === 0) segs.push({ x1: x, y1: y, x2: x, y2: y + h });
    else if (h === 0) segs.push({ x1: x, y1: y, x2: x + w, y2: y });
    else sawDiagonal = true;
  }
  const boxes: Array<{ x: number; y: number; w: number; h: number; tag: string }> = [];
  const spRe = /<p:sp>.*?<\/p:sp>/gs;
  for (const m of xml.matchAll(spRe)) {
    const sp = m[0];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(sp);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(sp);
    if (!off || !ext) continue;
    const y = +off[2] / EMU;
    if (y < 0.79) continue; // header band arrows live inside the band's own slots
    const text = (sp.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("|");
    boxes.push({ x: +off[1] / EMU, y, w: +ext[1] / EMU, h: +ext[2] / EMU, tag: text });
  }
  const picRe = /<p:pic>.*?<\/p:pic>/gs;
  for (const m of xml.matchAll(picRe)) {
    const pic = m[0];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(pic);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(pic);
    if (!off || !ext) continue;
    const descr = /descr="([^"]*)"/.exec(pic);
    boxes.push({ x: +off[1] / EMU, y: +off[2] / EMU, w: +ext[1] / EMU, h: +ext[2] / EMU, tag: descr ? descr[1] : "pic" });
  }
  return { segs, boxes, sawBent, sawDiagonal };
}
function assertNoConnectorCrossing(xml: string, deck: string) {
  const { segs, boxes, sawBent, sawDiagonal } = slideGeometry(xml);
  const TOL = 0.015;
  if (sawBent) fail.push(`${deck}: bentConnector still present — the wrap must be explicit segments`);
  if (sawDiagonal) fail.push(`${deck}: non-axis-aligned connector emitted`);
  for (const s of segs) {
    for (const b of boxes) {
      const inside =
        s.x1 === s.x2
          ? s.x1 > b.x + TOL && s.x1 < b.x + b.w - TOL && Math.max(s.y1, s.y2) > b.y + TOL && Math.min(s.y1, s.y2) < b.y + b.h - TOL
          : s.y1 > b.y + TOL && s.y1 < b.y + b.h - TOL && Math.max(s.x1, s.x2) > b.x + TOL && Math.min(s.x1, s.x2) < b.x + b.w - TOL;
      if (inside) {
        fail.push(`${deck}: connector segment (${s.x1.toFixed(2)},${s.y1.toFixed(2)})→(${s.x2.toFixed(2)},${s.y2.toFixed(2)}) crosses box "${b.tag}" (${b.x.toFixed(2)},${b.y.toFixed(2)}) ${b.w.toFixed(2)}x${b.h.toFixed(2)}`);
      }
    }
  }
}
console.log("== connector no-crossing checks ==");
assertNoConnectorCrossing(xmlFull, "full deck");
assertNoConnectorCrossing(xmlSimplified, "simplified deck");
assertNoConnectorCrossing(xmlMinimal, "minimal deck");
assertNoConnectorCrossing(xmlMini, "极简 capped deck");
assertNoConnectorCrossing(xmlP268, "P268 极简 deck");
assertNoConnectorCrossing(xmlP300, "P300 极简 deck");

/* ------------------------------------------------------------------ */
/* v3.55 unit: abinitMaxResolutionFromJob params_spec extraction        */
/* ------------------------------------------------------------------ */
{
  const mkJob = (job_type: string, params_spec?: Record<string, unknown>) =>
    ({ uid: "J900", job_type, params_spec }) as never;
  if (abinitMaxResolutionFromJob(mkJob("homo_abinit", { maximum_resolution_A: { value: 12 } })) !== 12)
    fail.push("abinitMaxResolutionFromJob: {value:12} wrapper not unwrapped");
  if (abinitMaxResolutionFromJob(mkJob("homo_abinit", { max_resolution: 6 })) !== 6)
    fail.push("abinitMaxResolutionFromJob: raw max_resolution 6 not read");
  if (abinitMaxResolutionFromJob(mkJob("homo_abinit")) !== null)
    fail.push("abinitMaxResolutionFromJob: absent param should be null");
  if (abinitMaxResolutionFromJob(mkJob("homo_abinit", { maximum_resolution_A: { value: 0.02 } })) !== null)
    fail.push("abinitMaxResolutionFromJob: implausible 0.02 should read as unknown");
  if (abinitMaxResolutionFromJob(mkJob("hetero_refine", { maximum_resolution_A: { value: 12 } })) !== null)
    fail.push("abinitMaxResolutionFromJob: non-abinit job must stay null");
  const node = jobNode(mkJob("homo_abinit", { abinit_max_resolution_A: { value: 9 } }) as never);
  if (node.abinit_max_resolution_A !== 9)
    fail.push(`jobNode.abinit_max_resolution_A expected 9 got ${node.abinit_max_resolution_A}`);
  console.log("== abinitMaxResolutionFromJob unit checks done ==");
}

if (fail.length) {
  console.error("ASSERT FAILURES:\n" + fail.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("ALL ASSERTIONS PASSED");
