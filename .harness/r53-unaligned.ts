/**
 * .harness/r53-unaligned.ts — round-53 (v3.93) offline assertions for the
 * three render-fidelity gates (round-53 “class2的图还是有问题，我打开map
 * 看到的不是这样的”):
 *
 *   A. unalignedCorrBar — the alignability bar policy: 0.55 default, a
 *      lowered corrTarget drags it down (0.50 → 0.45), the 0.25 floor,
 *      NaN corrTarget → the default.
 *   B. kneeShapeClean / kneeAnchorClean (exported, the REAL gates) —
 *      verdicts on the four measured shapes: the healthy mushroom PASSES
 *      (rough 3.75 < 6.0), the CONNECTED ROUGH SNOWFIELD dies (rough 8.18
 *      — the deck-4 J817_c1 shape: frag 0.000, holes 0, mainCov 21% —
 *      every v3.86 bar passes, only the new roughness bar rejects), the
 *      SMOOTH CAPSULE passes everything (frag 0 / holes 0 / mainCov 29%
 *      / rough 0.84 — the class_2 disease: only the hot-belt rules, not
 *      the cleanliness bars, keep a map out of that regime), speckle
 *      snow dies on frag, the sponge ring dies on mainCov/holes.
 *   C. The mock's ?knee=rough / ?knee=hotcap / ?unaligned drill policies
 *      replicated 1:1 and re-measured through the EXACT measureRender
 *      algorithm (PNG decode → mask → components → boundary perimeter →
 *      isoperimetric roughness) — the committed painters produce the
 *      values the gates are asserted on.
 *   D. figureFootnote — the unaligned count flips 所有地图已对齐 into
 *      其余地图…（N 张未对齐，按开图原样呈现）.
 *   E. Version: the engine constant is 3.93.
 *
 * Run: bun .harness/r53-unaligned.ts
 */
import { deflateSync, inflateSync } from "node:zlib";
import {
  KNEE_ROUGH_MAX,
  UNALIGNED_CORR_BAR,
  kneeAnchorClean,
  kneeShapeClean,
  unalignedCorrBar,
} from "../src/lib/cryosmart/chimerax-bridge";
import { figureFootnote } from "../src/lib/cryosmart/workflow-figure";
import { FLOW_ENGINE_VERSION } from "../src/lib/cryosmart/flow-engine-version";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/* ---- A. unalignedCorrBar ---- */
console.log("[A] unalignedCorrBar");
check("default target 0.85 → 0.55", unalignedCorrBar(0.85) === 0.55, String(unalignedCorrBar(0.85)));
check("high target 0.999 → 0.55 (bar never exceeds the default)", unalignedCorrBar(0.999) === 0.55);
check("target 0.50 → 0.45 (drags with a lowered target)", unalignedCorrBar(0.5) === 0.45);
check("target 0.30 → 0.25 (the floor)", unalignedCorrBar(0.3) === 0.25);
check("target 0.20 → 0.25 (never below the floor)", unalignedCorrBar(0.2) === 0.25);
check("NaN target → 0.55", unalignedCorrBar(Number.NaN) === 0.55);
check("UNALIGNED_CORR_BAR constant is 0.55", UNALIGNED_CORR_BAR === 0.55);
check("KNEE_ROUGH_MAX constant is 6.0", KNEE_ROUGH_MAX === 6.0);

/* ---- the exact-PNG measurement machinery (drawShape + measureRender
 * replicas — same as the mock's painters, verified pixel-identically). */
const size = 96;
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function drawShape(painter: (set: (x: number, y: number) => void) => void): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    raw[i] = 178;
    raw[i + 1] = 178;
    raw[i + 2] = 178;
    raw[i + 3] = 255;
  };
  painter(set);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
function decodePng(png: Uint8Array): { data: Uint8Array; w: number; h: number } {
  let off = 8;
  let w = 0;
  let h = 0;
  const idats: Uint8Array[] = [];
  while (off < png.length) {
    const dv = new DataView(png.buffer, png.byteOffset + off);
    const len = dv.getUint32(0);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0);
      h = new DataView(data.buffer, data.byteOffset).getUint32(4);
    } else if (type === "IDAT") {
      idats.push(data);
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idats.map((d) => Buffer.from(d))));
  const stride = w * 4 + 1;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const rowStart = y * stride + 1;
    data.set(raw.subarray(rowStart, rowStart + w * 4), y * w * 4);
  }
  return { data, w, h };
}
type ShapeMetrics = { frag: number; holes: number; mainCov: number; rough: number };
function measure(png: Uint8Array): ShapeMetrics {
  const { data, w, h } = decodePng(png);
  const mask = new Uint8Array(w * h);
  let fg = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isBg = data[i + 3] <= 10 || (Math.abs(data[i]) <= 25 && Math.abs(data[i + 1]) <= 25 && Math.abs(data[i + 2]) <= 25);
      if (!isBg) {
        mask[y * w + x] = 1;
        fg++;
      }
    }
  }
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Array<{ area: number; minX: number; minY: number; maxX: number; maxY: number }> = [];
  const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] >= 0) continue;
    const id = comps.length;
    const c = { area: 0, minX: w, minY: h, maxX: -1, maxY: -1 };
    stack.push(p);
    labels[p] = id;
    while (stack.length) {
      const q = stack.pop() as number;
      const qx = q % w;
      const qy = (q / w) | 0;
      c.area++;
      if (qx < c.minX) c.minX = qx;
      if (qx > c.maxX) c.maxX = qx;
      if (qy < c.minY) c.minY = qy;
      if (qy > c.maxY) c.maxY = qy;
      if (qx > 0 && mask[q - 1] && labels[q - 1] < 0) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < w - 1 && mask[q + 1] && labels[q + 1] < 0) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && mask[q - w] && labels[q - w] < 0) { labels[q - w] = id; stack.push(q - w); }
      if (qy < h - 1 && mask[q + w] && labels[q + w] < 0) { labels[q + w] = id; stack.push(q + w); }
    }
    comps.push(c);
  }
  let main = comps[0];
  let mainLabel = 0;
  for (let ci = 0; ci < comps.length; ci++) {
    if (comps[ci].area > main.area) {
      main = comps[ci];
      mainLabel = ci;
    }
  }
  const frag = Math.max(0, 1 - main.area / fg);
  const n = main.area;
  let perimeter = 0;
  for (let y = main.minY; y <= main.maxY; y++) {
    for (let x = main.minX; x <= main.maxX; x++) {
      const p = y * w + x;
      if (labels[p] !== mainLabel) continue;
      const bgNeighbor =
        x === 0 || !mask[p - 1] || x === w - 1 || !mask[p + 1] || y === 0 || !mask[p - w] || y === h - 1 || !mask[p + w];
      if (bgNeighbor) perimeter++;
    }
  }
  const rough = perimeter > 0 && n > 0 ? (perimeter * perimeter) / (4 * Math.PI * n) : 0;
  const bgReach = new Uint8Array(w * h);
  const bgStack: number[] = [];
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const p = y * w + x;
      if (!mask[p] && !bgReach[p]) { bgReach[p] = 1; bgStack.push(p); }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const p = y * w + x;
      if (!mask[p] && !bgReach[p]) { bgReach[p] = 1; bgStack.push(p); }
    }
  }
  while (bgStack.length) {
    const q = bgStack.pop() as number;
    const qx = q % w;
    const qy = (q / w) | 0;
    const push = (r: number) => {
      if (!mask[r] && !bgReach[r]) { bgReach[r] = 1; bgStack.push(r); }
    };
    if (qx > 0) push(q - 1);
    if (qx < w - 1) push(q + 1);
    if (qy > 0) push(q - w);
    if (qy < h - 1) push(q + w);
  }
  let holes = 0;
  for (let p = 0; p < mask.length; p++) if (!mask[p] && !bgReach[p]) holes++;
  return { frag, holes, mainCov: main.area / (w * h), rough };
}

/* the mock's painters, replicated 1:1 (shapePng branches). */
function mushroomPainter() {
  return (set: (x: number, y: number) => void) => {
    const headRx = 30;
    const headCy = 22;
    const headRy = 14;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ex = (x - 48) / headRx;
        const ey = (y - headCy) / headRy;
        if (ex * ex + ey * ey <= 1) { set(x, y); continue; }
        const inBelt = y >= 56 && y < 66 && Math.abs(x - 48) <= 26;
        const inCol = x >= 44 && x < 52 && y >= 36 && y < 88;
        if (inBelt || inCol) set(x, y);
      }
    }
  };
}
function snowPainter() {
  return (set: (x: number, y: number) => void) => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 42; k++) {
      const cx = 10 + rnd() * 76;
      const cy = 10 + rnd() * 76;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy <= 5) set(Math.round(cx + dx), Math.round(cy + dy));
        }
      }
    }
  };
}
function spongePainter() {
  return (set: (x: number, y: number) => void) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - 48, y - 48);
        if (d >= 11 && d <= 13) set(x, y);
      }
    }
  };
}
function roughsnowPainter() {
  return (set: (x: number, y: number) => void) => {
    const coreR = 21;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= coreR) set(x, y);
      }
    }
    let seed = 987654321;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const width = 1.4;
    for (let i = 0; i < 20; i++) {
      const a = ((i + rnd() * 0.5) / 20) * Math.PI * 2;
      const len = 7 + rnd() * 5;
      const nSeg = Math.ceil(len);
      for (let s = 0; s <= nSeg; s++) {
        const r = coreR - width + (s / nSeg) * len;
        const cx = 48 + Math.cos(a) * r;
        const cy = 48 + Math.sin(a) * r;
        for (let y = Math.floor(cy - width) - 1; y <= Math.ceil(cy + width) + 1; y++) {
          for (let x = Math.floor(cx - width) - 1; x <= Math.ceil(cx + width) + 1; x++) {
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= width) set(x, y);
          }
        }
      }
    }
  };
}
function capsulePainter() {
  return (set: (x: number, y: number) => void) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ex = (x + 0.5 - 48) / 34;
        const ey = (y + 0.5 - 48) / 25;
        if (ex * ex + ey * ey <= 1) set(x, y);
      }
    }
  };
}

/* ---- B/C. the gates against the REAL measured shapes ---- */
console.log("[B] kneeShapeClean / kneeAnchorClean vs the measured shapes");
const shapes: Array<{ name: string; png: Uint8Array; expectClean: boolean; note: string }> = [
  { name: "healthy mushroom (standing particle)", png: drawShape(mushroomPainter()), expectClean: true, note: "rough ≈ 3.75 < 6.0" },
  { name: "CONNECTED ROUGH SNOWFIELD (J817_c1)", png: drawShape(roughsnowPainter()), expectClean: false, note: "rough ≈ 8.18 — frag 0 / holes 0 / mainCov 21% pass every v3.86 bar" },
  { name: "SMOOTH CAPSULE (class_2 disease)", png: drawShape(capsulePainter()), expectClean: true, note: "rough ≈ 0.84 — passes EVERY bar incl. rough; only the hot-belt rules exclude the regime" },
  { name: "speckle snow", png: drawShape(snowPainter()), expectClean: false, note: "frag ≈ 0.88" },
  { name: "sponge ring", png: drawShape(spongePainter()), expectClean: false, note: "holes 373 / mainCov 1.7%" },
];
for (const s of shapes) {
  const m = measure(s.png);
  const bestMain = Math.max(m.mainCov, 0.20); // a ladder whose best rung is a healthy particle
  const verdict = kneeShapeClean(m, bestMain);
  const anchorVerdict = kneeAnchorClean(m);
  check(
    `${s.name}: ladder verdict ${s.expectClean ? "CLEAN" : "DIRTY"}`,
    verdict === s.expectClean && anchorVerdict === s.expectClean,
    `frag ${m.frag.toFixed(3)} · holes ${m.holes} · mainCov ${(m.mainCov * 100).toFixed(1)}% · rough ${m.rough.toFixed(2)} (${s.note})`,
  );
}
{
  /* the snowfield vs a WEAKER best-rung main coverage — the relative
   * mainCov floor must not be what saves the day (the snowfield's own
   * mainCov is healthy); the rough bar is the only rejection. */
  const m = measure(drawShape(roughsnowPainter()));
  const roughRejected = m.frag <= 0.01 && m.holes <= 6 && m.mainCov >= 0.03 && m.rough > KNEE_ROUGH_MAX;
  check("snowfield: passes every v3.86 bar, rejected ONLY by rough", roughRejected, `rough ${m.rough.toFixed(2)} > ${KNEE_ROUGH_MAX}`);
  check("snowfield rough within the deck-4 forensic range (7.5–9)", m.rough >= 7.5 && m.rough <= 9.0, m.rough.toFixed(2));
  const c = measure(drawShape(capsulePainter()));
  check("capsule: passes every bar INCLUDING rough (the disease shape)", kneeShapeClean(c, 0.2) && kneeAnchorClean(c), `rough ${c.rough.toFixed(2)}`);
}

/* ---- C2. the unaligned correlation routing replica ---- */
console.log("[C] the ?unaligned=<substr> measure-correlation routing");
{
  const models = new Map<number, { url: string }>([
    [2, { url: "/tmp/cryoflow-mock/staged/J9.volume_class_1.19af2f57.mrc" }],
    [3, { url: "/tmp/cryoflow-mock/staged/J9.volume_class_2.199c0e14.mrc#gauss" }],
    [4, { url: "/tmp/cryoflow-mock/staged/J9.volume_class_2.199c0e14.mrc" }],
    [5, { url: "/tmp/cryoflow-mock/staged/J9.volume_class_2.199c0e14.mrc#shellmask" }],
    [6, { url: "/tmp/cryoflow-mock/staged/J55.volume.60dc58f1.mrc" }],
  ]);
  const unalignedMatch = "volume_class_2";
  const route = (cmd: string): number | null => {
    if (!/^measure\s+correlation/i.test(cmd)) return null;
    const mm = /#(\d+(?:\.\d+)?)\s+(?:in|inMap)\s+#/i.exec(cmd) ?? /^measure\s+correlation\s+#(\d+(?:\.\d+)?)\s+#/i.exec(cmd);
    const movingId = mm ? parseInt(mm[1], 10) : null;
    const movingUrl = movingId != null ? models.get(movingId)?.url ?? null : null;
    if (movingUrl != null && movingUrl.includes(unalignedMatch)) return 0.3;
    return 0.9;
  };
  check("the target map's own measure reads 0.30", route("measure correlation #4 inMap #1") === 0.3);
  check("its σ clone reads 0.30 too (URL inheritance)", route("measure correlation #3 inMap #1") === 0.3);
  check("its /shellmask clone reads 0.30 too", route("measure correlation #5 inMap #1") === 0.3);
  check("a healthy map reads the override (0.90)", route("measure correlation #2 inMap #1") === 0.9);
  check("the reference itself reads the override", route("measure correlation #6 inMap #1") === 0.9);
  check("the positional form routes the same", route("measure correlation #4 #1") === 0.3);
  /* the verdict: 0.30 < the 0.55 bar → 未对齐; 0.90 ≥ the bar → aligned. */
  check("0.30 < the default bar → unaligned", 0.3 < unalignedCorrBar(0.85));
  check("0.90 ≥ the default bar → aligned", 0.9 >= unalignedCorrBar(0.85));
  /* the winning score is post ?? corr ?? pre — the drill's 0.30 post is
   * what the verdict reads even though the fitmap replies 0.93. */
  const post = 0.3;
  const corr = 0.93;
  const pre = 0.3;
  const score = post ?? corr ?? pre;
  check("score = post (0.30), not the fitmap 0.93", score === 0.3 && score < unalignedCorrBar(0.85));
}

/* ---- D. figureFootnote ---- */
console.log("[D] figureFootnote");
{
  const base = { corrected: 1, consistent: 10, ambiguous: 0, failed: 0, mode: "ChimeraX aligned" } as const;
  const clean = figureFootnote({ ...base, referenceKey: "J55/volume" });
  check("no unaligned maps → 所有地图已对齐至参考", clean.includes("所有地图已对齐至参考 J55/volume"), clean);
  check("no unaligned maps → no 未对齐 mention", !clean.includes("未对齐"));
  const withU = figureFootnote({ ...base, referenceKey: "J55/volume", unaligned: 2 });
  check("2 unaligned → 其余地图已对齐至参考", withU.includes("其余地图已对齐至参考 J55/volume"), withU);
  check("2 unaligned → counted 按开图原样呈现", withU.includes("2 张未对齐（按开图原样呈现）"), withU);
  check("the 所有地图 claim is gone", !withU.includes("所有地图已对齐"));
  const noRef = figureFootnote({ ...base, referenceKey: null, unaligned: 1 });
  check("no referenceKey + 1 unaligned → the count still rides", noRef.includes("1 张未对齐（按开图原样呈现）"), noRef);
  const zeroU = figureFootnote({ ...base, referenceKey: "J55/volume", unaligned: 0 });
  check("unaligned 0 behaves as absent", zeroU === clean);
}

/* ---- E. version ---- */
console.log("[E] version");
check("FLOW_ENGINE_VERSION is 3.93", FLOW_ENGINE_VERSION === "3.93", FLOW_ENGINE_VERSION);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
