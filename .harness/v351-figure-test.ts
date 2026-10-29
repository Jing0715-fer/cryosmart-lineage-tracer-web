/**
 * v3.51→v3.54 figure-model + layout drill.
 *
 * Crafts a P96/J41-like LineageSummary (10 stage groups; 6 of them class
 * splits with 2-3 classes each) and runs the REAL model builder + REAL
 * workflow-PPTX layout. v3.54: thumbnails are SYNTHESIZED in-process
 * (transparent margins + a disc in the class's Chimera open-color), so the
 * drill no longer depends on /tmp leftovers, and a second pass builds the
 * SIMPLIFIED figure (small-subset bootstrap drops + 多→少 funnel) plus a
 * default-12 Å ab-initio-final case.
 *
 * Run: cd /home/z/my-project && bun .harness/v351-figure-test.ts
 */
import { buildFlowFigureModel, figureMapSources } from "../src/lib/cryosmart/workflow-figure";
import { chimeraClassColor } from "../src/lib/cryosmart/chimera-colors";
import { buildWorkflowPptx } from "../src/lib/cryosmart/workflow-pptx";
import { deflateSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const OUT_DIR = "/tmp/figtest";
const OUT = path.join(OUT_DIR, "out.pptx");
const OUT_SIMPLIFIED = path.join(OUT_DIR, "out-simplified.pptx");
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
const J12 = mkNode("J12", "select_2D", {
  particle_count: 164291,
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
  maps: [mkMapAsset("J27", "volume_class_0"), mkMapAsset("J27", "volume_class_1")],
  classes: mkClasses("J27", [
    [0, 50.0, 29024],
    [1, 35.0, 20317],
  ]),
});
const J31 = mkNode("J31", "hetero_refine", {
  particle_count: 766560,
  maps: [mkMapAsset("J31", "volume_class_0"), mkMapAsset("J31", "volume_class_1"), mkMapAsset("J31", "volume_class_2")],
  classes: mkClasses("J31", [
    [0, 77, 590411],
    [1, 12, 91987],
    [2, 11, 84321],
  ]),
});
const J33 = mkNode("J33", "homo_abinit", {
  particle_count: 590421,
  maps: [mkMapAsset("J33", "volume_class_0"), mkMapAsset("J33", "volume_class_1")],
  classes: mkClasses("J33", [
    [0, 47, 277498],
    [1, 28, 165318],
  ]),
});
const J34 = mkNode("J34", "hetero_refine", {
  particle_count: 590421,
  maps: [mkMapAsset("J34", "volume_class_0"), mkMapAsset("J34", "volume_class_1")],
  classes: mkClasses("J34", [
    [0, 64.1, 378680],
    [1, 22, 129893],
  ]),
});
const J35 = mkNode("J35", "nonuniform_refine_new", {
  particle_count: 378677,
  maps: [mkMapAsset("J35", "volume")],
});
const J37 = mkNode("J37", "nonuniform_refine_new", {
  particle_count: 378677,
  maps: [mkMapAsset("J37", "volume")],
});
const J39 = mkNode("J39", "homo_abinit", {
  particle_count: 378677,
  maps: [mkMapAsset("J39", "volume_class_0"), mkMapAsset("J39", "volume_class_1")],
  classes: mkClasses("J39", [
    [0, 4.2, 15904],
    [1, 40, 151471],
  ]),
});
const J40 = mkNode("J40", "hetero_refine", {
  particle_count: 209127,
  maps: [mkMapAsset("J40", "volume_class_0"), mkMapAsset("J40", "volume_class_1")],
  classes: mkClasses("J40", [
    [0, 55, 115020],
    [1, 45, 94107],
  ]),
});
const J41 = mkNode("J41", "new_local_refine", {
  particle_count: 209127,
  resolution_A: 3.2,
  maps: [mkMapAsset("J41", "volume")],
});

const chain = [J1, J12, J27, J31, J33, J34, J35, J37, J39, J40, J41];
const nodes = chain;
const edges = chain.slice(1).map((n, i) => ({
  source: chain[i].uid,
  target: n.uid,
  input_type: "volume",
  input_name: "volume",
  input_title: null,
  source_group: null,
  slots: [],
}));
for (let i = 0; i < chain.length; i++) {
  chain[i].parents = chain.slice(0, i).map((n) => n.uid).slice(-1);
  chain[i].children = chain.slice(i + 1).map((n) => n.uid).slice(0, 1);
}

const classJobs = [J27, J31, J33, J34, J39, J40].map((n) => ({
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
const fail: string[] = [];
if (model.groups.length !== 10) fail.push(`groups expected 10 got ${model.groups.length}`);
if (!j31?.classes || j31.classes.length !== 3) fail.push(`J31 classes expected 3 got ${j31?.classes?.length}`);
if (j31 && j31.classes?.[0]?.stats.join("|") !== "77%|590,411 particles") fail.push(`J31 c0 stats got ${j31?.classes?.[0]?.stats.join("|")}`);
if (!j41?.classes || j41.classes.length !== 1) fail.push(`J41 classes expected 1 got ${j41?.classes?.length}`);
if (j41?.stats.length !== 1) fail.push(`J41 final stats should be particles-only, got ${j41?.stats.join("|")}`);
if (!j12?.imageUrl) fail.push("J12 montage imageUrl missing");
if (model.referenceKey !== "J41/volume") fail.push(`referenceKey got ${model.referenceKey}`);
if (srcs.size !== 16) fail.push(`figureMapSources expected 16 got ${srcs.size}`);
if (model.headerStats.micrographs !== "6,060 Micrographs") fail.push(`header micrographs got ${model.headerStats.micrographs}`);
if (model.headerStats.particles !== "164,291 particles") fail.push(`header particles got ${model.headerStats.particles}`);
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
if (model2.groups.length !== 8) fail.push(`simplified groups expected 8 (J12+J27 dropped) got ${model2.groups.length}`);
if (sUids.has("J12")) fail.push("simplified should drop the small-subset select_2D montage J12");
if (sUids.has("J27")) fail.push("simplified should drop the small-subset ab-initio J27");
if (!sUids.has("J39")) fail.push("simplified must KEEP the mainline ab-initio J39 (its successor only shrinks)");
if (!model2.warnings.some((w) => w.includes("已省略少量数据步骤 J12") && w.includes("12,259"))) fail.push("missing J12 drop warning");
if (!model2.warnings.some((w) => w.includes("已省略少量数据步骤 J27") && w.includes("58,048"))) fail.push("missing J27 drop warning");
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
  if (j31s?.classes?.[0]?.stats.join("|") !== "77%|590,411 particles") fail.push(`simplified J31 c0 stats got ${j31s?.classes?.[0]?.stats.join("|")}`);
}

/* map sources shrink with the dropped stages (16 → 14) */
const srcs2 = figureMapSources(model2);
console.log("== simplified figureMapSources ==", srcs2.size);
if (srcs2.size !== 14) fail.push(`simplified figureMapSources expected 14 got ${srcs2.size}`);
if (srcs2.has("J27/volume_class_0")) fail.push("J27 maps must be gone from the simplified render set");

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

if (fail.length) {
  console.error("ASSERT FAILURES:\n" + fail.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("ALL ASSERTIONS PASSED");
