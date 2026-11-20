/**
 * .harness/r53-tune-rough.ts — offline tuner for the v3.93 ?knee=rough
 * drill's ROUGHSNOW shape. Replicates the mock's drawShape painter + the
 * engine's measureRender EXACTLY (mask, components, boundary-perimeter
 * roughness, enclosed holes) and sweeps candidate amplitudes so the
 * committed shape reads rough ≈ 8 (the deck-4 J817_c1 forensics value)
 * while passing every v3.86 bar (frag ≈ 0 connected, holes ≤ 6, mainCov
 * ≫ 3%).
 *
 * Run: bun .harness/r53-tune-rough.ts
 */
import { deflateSync, inflateSync } from "node:zlib";

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
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** decode the hand-rolled PNG back to RGBA (filter 0 rows only — as the
 * mock always writes). */
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

/** measureRender's shape metrics, replicated 1:1 (stride-1 path, the
 * 96px probes never downsample). */
function measure(png: Uint8Array) {
  const { data, w, h } = decodePng(png);
  const bg = [0, 0, 0];
  const mask = new Uint8Array(w * h);
  let fg = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isBg =
        data[i + 3] <= 10 ||
        (Math.abs(data[i] - bg[0]) <= 25 && Math.abs(data[i + 1] - bg[1]) <= 25 && Math.abs(data[i + 2] - bg[2]) <= 25);
      if (!isBg) {
        mask[y * w + x] = 1;
        fg++;
      }
    }
  }
  if (fg < 16) return { frag: 1, holes: 0, mainCov: 0, rough: 0, comps: 0 };
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
  return { frag, holes, mainCov: main.area / (w * h), rough, comps: comps.length };
}

/** the candidate painter: a connected blob whose boundary carries
 * high-frequency radial jitter (the CONNECTED noise surface). */
function roughsnowPainter(R: number, amp: number, steps: number) {
  return (set: (x: number, y: number) => void) => {
    let seed = 987654321;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const radii: number[] = [];
    for (let i = 0; i < steps; i++) radii.push(R + (rnd() * 2 - 1) * amp);
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      const r0 = radii[i];
      const r1 = radii[(i + 1) % steps];
      const nSeg = Math.max(2, Math.ceil((r0 + r1) / 2));
      for (let s = 0; s <= nSeg; s++) {
        const t = s / nSeg;
        const a = a0 + (a1 - a0) * t;
        const r = r0 + (r1 - r0) * t;
        set(Math.round(48 + Math.cos(a) * r), Math.round(48 + Math.sin(a) * r));
      }
    }
    // fill the interior (scanline: leftmost/rightmost set pixel per row)
    for (let y = 0; y < size; y++) {
      let minX = -1;
      let maxX = -1;
      for (let x = 0; x < size; x++) {
        // re-read the raw painter output via a closure trick is not
        // possible — instead fill analytically below.
      }
      void minX;
      void maxX;
    }
  };
}

/** simpler + exact: paint mask analytically (per pixel test against the
 * jittered polygon radius at that pixel's angle). */
function roughsnowMask(R: number, amp: number, steps: number) {
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const radii: number[] = [];
  for (let i = 0; i < steps; i++) radii.push(R + (rnd() * 2 - 1) * amp);
  return (set: (x: number, y: number) => void) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - 48;
        const dy = y + 0.5 - 48;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const i = Math.floor(((a / (Math.PI * 2) + 1) % 1) * steps) % steps;
        if (r <= radii[i]) set(x, y);
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

console.log("capsule (34/25 ellipse):");
console.log(" ", JSON.stringify(measure(drawShape(capsulePainter()))));

/** the snowfield painter: a solid core plus random BUMPS studding its
 * boundary (a connected noise surface — every bump touches the core so
 * frag stays 0, no enclosed voids so holes stay 0, but the boundary
 * perimeter explodes: the isoperimetric ratio reads around 8). */
function snowfieldPainter(coreR: number, bumps: number, rMin: number, rMax: number, spread: number) {
  return (set: (x: number, y: number) => void) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= coreR) set(x, y);
      }
    }
    let seed = 987654321;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let b = 0; b < bumps; b++) {
      const a = rnd() * Math.PI * 2;
      const rc = coreR - spread * 0.2 + rnd() * spread;
      const rb = rMin + rnd() * (rMax - rMin);
      const cx = 48 + Math.cos(a) * rc;
      const cy = 48 + Math.sin(a) * rc;
      for (let y = Math.floor(cy - rb) - 1; y <= Math.ceil(cy + rb) + 1; y++) {
        for (let x = Math.floor(cx - rb) - 1; x <= Math.ceil(cx + rb) + 1; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rb) set(x, y);
        }
      }
    }
  };
}

/** the snowfield painter v2: a solid core plus well-separated THIN
 * SPIKES (a connected noise surface — every spike root touches the core
 * so frag stays 0; the spike sides dominate the boundary pixel count so
 * the isoperimetric ratio reads around 8, the deck-4 J817_c1 value). */
function spikesPainter(coreR: number, spikes: number, lenMin: number, lenMax: number, width: number) {
  return (set: (x: number, y: number) => void) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= coreR) set(x, y);
      }
    }
    let seed = 987654321;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < spikes; i++) {
      const a = ((i + rnd() * 0.5) / spikes) * Math.PI * 2;
      const len = lenMin + rnd() * (lenMax - lenMin);
      const nSeg = Math.ceil(len);
      for (let s2 = 0; s2 <= nSeg; s2++) {
        const r = coreR - width + (s2 / nSeg) * len;
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

for (const cfg of [
  { coreR: 20, spikes: 20, lenMin: 6, lenMax: 10, width: 1.4 },
  { coreR: 20, spikes: 18, lenMin: 7, lenMax: 11, width: 1.4 },
  { coreR: 21, spikes: 22, lenMin: 6, lenMax: 10, width: 1.3 },
  { coreR: 19, spikes: 16, lenMin: 8, lenMax: 12, width: 1.5 },
  { coreR: 20, spikes: 24, lenMin: 5, lenMax: 9, width: 1.3 },
  { coreR: 21, spikes: 20, lenMin: 7, lenMax: 12, width: 1.4 },
]) {
  const m = measure(drawShape(spikesPainter(cfg.coreR, cfg.spikes, cfg.lenMin, cfg.lenMax, cfg.width)));
  console.log(
    JSON.stringify(cfg) + ": frag=" + m.frag.toFixed(3) + " holes=" + m.holes + " mainCov=" + (m.mainCov * 100).toFixed(1) + "% rough=" + m.rough.toFixed(2) + " comps=" + m.comps,
  );
}

/** the mock's existing shapes, replicated for the harness's cross-check. */
function mushroomPainter() {
  return (set: (x: number, y: number) => void) => {
    const headRx = 30;
    const headCy = 22;
    const headRy = 14;
    const beltY0 = 56;
    const beltY1 = beltY0 + 10;
    const colX0 = 44;
    const colX1 = 52;
    const colY0 = 36;
    const colY1 = 88;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ex = (x - 48) / headRx;
        const ey = (y - headCy) / headRy;
        if (ex * ex + ey * ey <= 1) { set(x, y); continue; }
        const inBelt = y >= beltY0 && y < beltY1 && Math.abs(x - 48) <= 26;
        const inCol = x >= colX0 && x < colX1 && y >= Math.min(colY0, colY1) && y < Math.max(colY0, colY1);
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
console.log("mushroomUp:", JSON.stringify(measure(drawShape(mushroomPainter()))));
console.log("snow (specks):", JSON.stringify(measure(drawShape(snowPainter()))));
console.log("sponge (ring):", JSON.stringify(measure(drawShape(spongePainter()))));
console.log("roughsnow (final):", JSON.stringify(measure(drawShape(spikesPainter(21, 20, 7, 12, 1.4)))));
console.log("capsule (final):", JSON.stringify(measure(drawShape(capsulePainter()))));
void roughsnowPainter;
void roughsnowMask;
