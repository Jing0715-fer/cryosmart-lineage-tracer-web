/* Offline sanity check (r46): beltLevelFrom's per-map anchor math + the
 * measureRender hole/rough replication — no canvas, masks drawn directly
 * (same approach as r42/shape-check.ts). Run: bun .harness/r46-belt.ts */
import { beltLevelFrom, type Membrane2Reply, type MembraneBand } from "../src/lib/cryosmart/chimerax-bridge";

let failures = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  if (cond) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/* ---------- beltLevelFrom ---------- */
console.log("beltLevelFrom (the per-map belt-band anchor):");
const band = (name: string, ratio: number, count = 90000): MembraneBand => ({
  name,
  lo: 0,
  hi: 1,
  normal: [0.666667, 0.333333, 0.666667],
  ea: [0.447214, -0.894427, 0.0],
  eb: [0.596285, 0.298142, -0.745356],
  ratio,
  count,
});
const m2 = (splits: [number, number] | null, bands: MembraneBand[]): Membrane2Reply => ({
  splits,
  bands,
  envelope: null,
});
const stats = (max: number) => ({ max, mean: 0.1, sd: 0.2 });

/* 1. hot belt (the mock's default): belt = high band → proteinLevel null,
 *    anchor clears the noise floor t1 (0.18 > script 0.15). */
{
  const b = beltLevelFrom(m2([0.18, 0.54], [band("mid", 0.99), band("high", 0.3)]), stats(1));
  ok(b.beltBand === "high", "hot belt detected (high band)", `beltBand=${b.beltBand}`);
  ok(b.proteinLevel === null, "hot belt: proteinLevel null (threshold cannot hide it)");
  ok(Math.abs(b.anchor - 0.18) < 1e-9, "hot belt anchor = max(0.15, t1=0.18)", `anchor=${b.anchor}`);
}
/* 2. cold belt (?belt=mid drill): belt = mid band → anchor t2 (hide the
 *    micelle), proteinLevel capped at 0.5×max. */
{
  const b = beltLevelFrom(m2([0.18, 0.54], [band("mid", 0.3), band("high", 0.99)]), stats(1));
  ok(b.beltBand === "mid", "cold belt detected (mid band)", `beltBand=${b.beltBand}`);
  ok(b.proteinLevel != null && Math.abs(b.proteinLevel - 0.5) < 1e-9, "cold belt proteinLevel = min(t2, 0.5×max) = 0.5", `proteinLevel=${b.proteinLevel}`);
  ok(Math.abs(b.anchor - 0.54) < 1e-9, "cold belt anchor = max(0.15, t2=0.54)", `anchor=${b.anchor}`);
}
/* 3. cold belt with a LOW t2 (protein band starts low): the cap keeps the
 *    mask target massy but the display anchor may ride t2 verbatim. */
{
  const b = beltLevelFrom(m2([0.05, 0.22], [band("mid", 0.3), band("high", 0.99)]), stats(1));
  ok(Math.abs(b.anchor - 0.22) < 1e-9, "low-t2 cold belt anchor = t2", `anchor=${b.anchor}`);
  ok(b.proteinLevel != null && Math.abs(b.proteinLevel - 0.22) < 1e-9, "low-t2 proteinLevel = t2 (under the 0.5 cap)", `proteinLevel=${b.proteinLevel}`);
}
/* 4. no oblate band (soluble protein / clean map): anchor = max(script, t1);
 *    on a clean map where the script rule already clears the noise floor it
 *    stays VERBATIM (round-45 semantics preserved). */
{
  const b = beltLevelFrom(m2([0.05, 0.3], [band("mid", 0.95), band("high", 0.9)]), stats(1));
  ok(b.beltBand === null, "no belt: both bands near-isotropic");
  ok(Math.abs(b.anchor - 0.15) < 1e-9, "clean map keeps the script anchor 0.15×max", `anchor=${b.anchor}`);
  ok(b.proteinLevel === null, "no belt: proteinLevel null");
}
/* 5. noisy soluble map: t1 above the script level → anchor lifts to t1. */
{
  const b = beltLevelFrom(m2([0.26, 0.6], [band("mid", 0.95), band("high", 0.9)]), stats(1));
  ok(Math.abs(b.anchor - 0.26) < 1e-9, "noisy no-belt map anchor = t1 (noise floor)", `anchor=${b.anchor}`);
}
/* 6. degenerate splits (t1 > 0.5×max — otsu broke): script fallback. */
{
  const b = beltLevelFrom(m2([0.7, 0.95], [band("mid", 0.3), band("high", 0.9)]), stats(1));
  ok(Math.abs(b.anchor - 0.15) < 1e-9, "degenerate split → script anchor", `anchor=${b.anchor} rule=${b.anchorRule}`);
}
/* 7. old relay (no membrane2) / no stats: script / NaN. */
{
  const b = beltLevelFrom(null, stats(1));
  ok(Math.abs(b.anchor - 0.15) < 1e-9, "null m2 → script anchor", `anchor=${b.anchor}`);
  const b2 = beltLevelFrom(m2([0.18, 0.54], [band("mid", 0.3)]), null);
  ok(Number.isNaN(b2.anchor), "null stats → NaN anchor (caller falls back)", `anchor=${b2.anchor}`);
}
/* 8. a t2 above 0.9×max is DEGENERATE by design (otsu broke on this
 *    histogram) → the script fallback, never a near-max anchor. */
{
  const b = beltLevelFrom(m2([0.1, 0.95], [band("mid", 0.3), band("high", 0.99)]), stats(1));
  ok(Math.abs(b.anchor - 0.15) < 1e-9, "t2 > 0.9×max → degenerate → script anchor", `anchor=${b.anchor}`);
}

/* ---------- measureRender holes/rough replication ---------- */
console.log("measureRender holes/rough (replicated):");
const S = 96;
function measure(mask: Uint8Array) {
  const mw = S;
  const mh = S;
  const fg = mask.reduce((a, b) => a + b, 0);
  const labels = new Int32Array(mw * mh).fill(-1);
  const comps: Array<{ area: number; minX: number; minY: number; maxX: number; maxY: number; sx: number; sy: number; sxx: number; syy: number; sxy: number }> = [];
  const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] >= 0) continue;
    const id = comps.length;
    const c = { area: 0, minX: mw, minY: mh, maxX: -1, maxY: -1, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
    stack.push(p);
    labels[p] = id;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % mw;
      const qy = (q / mw) | 0;
      c.area++;
      if (qx < c.minX) c.minX = qx;
      if (qx > c.maxX) c.maxX = qx;
      if (qy < c.minY) c.minY = qy;
      if (qy > c.maxY) c.maxY = qy;
      c.sx += qx; c.sy += qy; c.sxx += qx * qx; c.syy += qy * qy; c.sxy += qx * qy;
      if (qx > 0 && mask[q - 1] && labels[q - 1] < 0) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < mw - 1 && mask[q + 1] && labels[q + 1] < 0) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && mask[q - mw] && labels[q - mw] < 0) { labels[q - mw] = id; stack.push(q - mw); }
      if (qy < mh - 1 && mask[q + mw] && labels[q + mw] < 0) { labels[q + mw] = id; stack.push(q + mw); }
    }
    comps.push(c);
  }
  let main = comps[0];
  let mainLabel = 0;
  for (let ci = 0; ci < comps.length; ci++) {
    if (comps[ci].area > main.area) { main = comps[ci]; mainLabel = ci; }
  }
  const frag = Math.max(0, 1 - main.area / fg);
  const n = main.area;
  let perimeter = 0;
  for (let y = main.minY; y <= main.maxY; y++) {
    for (let x = main.minX; x <= main.maxX; x++) {
      const p = y * mw + x;
      if (labels[p] !== mainLabel) continue;
      const bgNeighbor =
        x === 0 || !mask[p - 1] || x === mw - 1 || !mask[p + 1] || y === 0 || !mask[p - mw] || y === mh - 1 || !mask[p + mw];
      if (bgNeighbor) perimeter++;
    }
  }
  const rough = perimeter > 0 && n > 0 ? (perimeter * perimeter) / (4 * Math.PI * n) : 0;
  const bgReach = new Uint8Array(mw * mh);
  const bgStack: number[] = [];
  for (let x = 0; x < mw; x++) {
    for (const y of [0, mh - 1]) {
      const p = y * mw + x;
      if (!mask[p] && !bgReach[p]) { bgReach[p] = 1; bgStack.push(p); }
    }
  }
  for (let y = 0; y < mh; y++) {
    for (const x of [0, mw - 1]) {
      const p = y * mw + x;
      if (!mask[p] && !bgReach[p]) { bgReach[p] = 1; bgStack.push(p); }
    }
  }
  while (bgStack.length) {
    const q = bgStack.pop()!;
    const qx = q % mw;
    const qy = (q / mw) | 0;
    const push = (r: number) => {
      if (!mask[r] && !bgReach[r]) { bgReach[r] = 1; bgStack.push(r); }
    };
    if (qx > 0) push(q - 1);
    if (qx < mw - 1) push(q + 1);
    if (qy > 0) push(q - mw);
    if (qy < mh - 1) push(q + mw);
  }
  let holes = 0;
  const holeSeen = new Uint8Array(mw * mh);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] || bgReach[p] || holeSeen[p]) continue;
    holes++;
    const hStack: number[] = [p];
    holeSeen[p] = 1;
    while (hStack.length) {
      const q = hStack.pop()!;
      const qx = q % mw;
      const qy = (q / mw) | 0;
      const push = (r: number) => {
        if (!mask[r] && !bgReach[r] && !holeSeen[r]) { holeSeen[r] = 1; hStack.push(r); }
      };
      if (qx > 0) push(q - 1);
      if (qx < mw - 1) push(q + 1);
      if (qy > 0) push(q - mw);
      if (qy < mh - 1) push(q + mw);
    }
  }
  return { frag, holes, rough, mainCov: main.area / (mw * mh) };
}
function maskOf(painter: (set: (x: number, y: number) => void) => void): Uint8Array {
  const m = new Uint8Array(S * S);
  painter((x, y) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    m[y * S + x] = 1;
  });
  return m;
}
/* filled square: rough ≈ 4/π ≈ 1.27, holes 0. */
{
  const r = measure(maskOf((set) => {
    for (let y = 20; y < 76; y++) for (let x = 20; x < 76; x++) set(x, y);
  }));
  ok(r.holes === 0, "filled square: 0 holes", `holes=${r.holes}`);
  ok(Math.abs(r.rough - 4 / Math.PI) < 0.05, "filled square rough ≈ 1.27", `rough=${r.rough.toFixed(3)}`);
}
/* ring (a face-on torus / pore): exactly 1 hole, passes the ≤6 bar. */
{
  const r = measure(maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 48, y - 48);
      if (d >= 20 && d <= 34) set(x, y);
    }
  }));
  ok(r.holes === 1, "ring: 1 hole (a legit pore — passes the ≤6 bar)", `holes=${r.holes}`);
}
/* blob with 3 punched holes: 3. */
{
  const r = measure(maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (Math.hypot(x - 48, y - 48) <= 34) {
        if (Math.hypot(x - 38, y - 40) < 5) continue;
        if (Math.hypot(x - 58, y - 42) < 5) continue;
        if (Math.hypot(x - 48, y - 60) < 5) continue;
        set(x, y);
      }
    }
  }));
  ok(r.holes === 3, "blob with 3 punched holes: 3", `holes=${r.holes}`);
}
/* a sponge/lace slab (9 punched windows): > 6 → the knee must reject. */
{
  const r = measure(maskOf((set) => {
    for (let y = 14; y < 80; y++) for (let x = 14; x < 80; x++) {
      const gx = Math.floor((x - 14) / 22);
      const gy = Math.floor((y - 14) / 22);
      if (x - 14 - gx * 22 >= 6 && x - 14 - gx * 22 < 16 && y - 14 - gy * 22 >= 5 && y - 14 - gy * 22 < 13) continue;
      set(x, y);
    }
  }));
  ok(r.holes > 6, `lace slab: ${r.holes} holes > 6 → the knee's new bar rejects it`, `holes=${r.holes}`);
}
/* a wiggle-edged "cauliflower" (spiky boundary): rough far above a clean
 * blob's, same area — the diagnostics line the knee now logs. */
{
  const clean = measure(maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (Math.hypot(x - 48, y - 48) <= 30) set(x, y);
    }
  }));
  const spiky = measure(maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.atan2(y - 48, x - 48);
      const r0 = 22 + 9 * Math.abs(Math.cos(a * 9));
      if (Math.hypot(x - 48, y - 48) <= r0) set(x, y);
    }
  }));
  ok(spiky.rough > clean.rough * 1.8, "spiky cauliflower rough ≫ clean blob rough", `clean=${clean.rough.toFixed(2)} spiky=${spiky.rough.toFixed(2)}`);
}
/* snow (42 disconnected specks): frag ≈ 1 — unchanged behavior. */
{
  const r = measure(maskOf((set) => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 42; k++) {
      const cx = 10 + rnd() * 76;
      const cy = 10 + rnd() * 76;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy <= 5) set(Math.round(cx + dx), Math.round(cy + dy));
      }
    }
  }));
  ok(r.frag > 0.8, "snow: frag ≫ the 0.08 bar (rejected as before)", `frag=${r.frag.toFixed(2)}`);
}

console.log(failures === 0 ? "\nALL BELT/HOLE ASSERTIONS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
