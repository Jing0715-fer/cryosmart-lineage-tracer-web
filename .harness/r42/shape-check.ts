/* Offline sanity check: replicate measureRender's component/standing math
 * on the mock's shape family (no canvas — the masks are drawn directly). */
const S = 96;
function maskOf(painter: (set: (x: number, y: number) => void) => void): Uint8Array {
  const m = new Uint8Array(S * S);
  painter((x, y) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    m[y * S + x] = 1;
  });
  return m;
}
function measure(mask: Uint8Array) {
  const fg = mask.reduce((a, b) => a + b, 0);
  if (fg < 16) return { fg, frag: 1, mainCov: 0, standing: 0, aniso: 1, aspect: 0 };
  const labels = new Int32Array(S * S).fill(-1);
  const comps: Array<{ area: number; minX: number; minY: number; maxX: number; maxY: number; sx: number; sy: number; sxx: number; syy: number }> = [];
  const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] >= 0) continue;
    const id = comps.length;
    const c = { area: 0, minX: S, minY: S, maxX: -1, maxY: -1, sx: 0, sy: 0, sxx: 0, syy: 0 };
    stack.push(p);
    labels[p] = id;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % S;
      const qy = (q / S) | 0;
      c.area++;
      if (qx < c.minX) c.minX = qx;
      if (qx > c.maxX) c.maxX = qx;
      if (qy < c.minY) c.minY = qy;
      if (qy > c.maxY) c.maxY = qy;
      c.sx += qx;
      c.sy += qy;
      c.sxx += qx * qx;
      c.syy += qy * qy;
      if (qx > 0 && mask[q - 1] && labels[q - 1] < 0) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < S - 1 && mask[q + 1] && labels[q + 1] < 0) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && mask[q - S] && labels[q - S] < 0) { labels[q - S] = id; stack.push(q - S); }
      if (qy < S - 1 && mask[q + S] && labels[q + S] < 0) { labels[q + S] = id; stack.push(q + S); }
    }
    comps.push(c);
  }
  let main = comps[0];
  for (const c of comps) if (c.area > main.area) main = c;
  const frag = Math.max(0, 1 - main.area / fg);
  const n = main.area;
  const mx = main.sx / n;
  const my = main.sy / n;
  const vxx = Math.max(main.sxx / n - mx * mx, 1e-9);
  const vyy = Math.max(main.syy / n - my * my, 1e-9);
  const tr = vxx + vyy;
  const disc = Math.sqrt(Math.max((tr * tr) / 4 - vxx * vyy, 0));
  const lMax = tr / 2 + disc;
  const lMin = Math.max(tr / 2 - disc, 1e-9);
  const bw = main.maxX - main.minX + 1;
  const bh = main.maxY - main.minY + 1;
  const standing = bh > 1 ? ((main.minY + main.maxY + 1) / 2 - my) / bh : 0;
  return { fg, frag, mainCov: main.area / (S * S), standing, aniso: Math.sqrt(lMax / lMin), aspect: bw / bh };
}

// --- the mock's shape painters (mirror shapePng) ---
function discMask(): Uint8Array {
  return maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= 34) set(x, y);
    }
  });
}
function snowMask(): Uint8Array {
  return maskOf((set) => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 42; k++) {
      const cx = 10 + rnd() * 76;
      const cy = 10 + rnd() * 76;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy <= 5) set(Math.round(cx + dx), Math.round(cy + dy));
      }
    }
  });
}
function spongeMask(): Uint8Array {
  return maskOf((set) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 48, y - 48);
      if (d >= 11 && d <= 13) set(x, y);
    }
  });
}
function mushroomMask(kind: "up" | "down" | "wide" | "narrow"): Uint8Array {
  const down = kind === "down";
  const wide = kind === "wide";
  const narrow = kind === "narrow";
  const headRx = wide ? 40 : narrow ? 20 : 30;
  return maskOf((set) => {
    const headCy = down ? 74 : 22;
    const headRy = 14;
    const beltY0 = down ? 30 : 56;
    const beltY1 = beltY0 + 10;
    const colX0 = 44;
    const colX1 = 52;
    const colY0 = down ? 8 : 36;
    const colY1 = down ? 60 : 88;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ex = (x - 48) / headRx;
      const ey = (y - headCy) / headRy;
      if (ex * ex + ey * ey <= 1) { set(x, y); continue; }
      const inBelt = y >= beltY0 && y < beltY1 && Math.abs(x - 48) <= (wide ? 36 : narrow ? 20 : 26);
      const inCol = x >= colX0 && x < colX1 && y >= Math.min(colY0, colY1) && y < Math.max(colY0, colY1);
      if (inBelt || inCol) set(x, y);
    }
  });
}

const rows: Array<[string, ReturnType<typeof measure>]> = [
  ["disc", measure(discMask())],
  ["snow", measure(snowMask())],
  ["sponge", measure(spongeMask())],
  ["mushroomUp", measure(mushroomMask("up"))],
  ["mushroomDown", measure(mushroomMask("down"))],
  ["mushroomWide", measure(mushroomMask("wide"))],
  ["mushroomNarrow", measure(mushroomMask("narrow"))],
];
console.log("shape        fg    frag   mainCov  standing  aniso  aspect");
for (const [name, m] of rows) {
  console.log(
    name.padEnd(12) +
    String(m.fg).padStart(5) +
    m.frag.toFixed(3).padStart(7) +
    m.mainCov.toFixed(3).padStart(9) +
    m.standing.toFixed(3).padStart(9) +
    m.aniso.toFixed(2).padStart(7) +
    m.aspect.toFixed(2).padStart(8),
  );
}
// assertions against the v3.82 thresholds
const [disc, snow, sponge, up, down, wide, narrow] = rows.map((r) => r[1]);
const ok =
  snow.frag > 0.5 && // knee must climb above it
  sponge.mainCov < 0.45 * Math.max(disc.mainCov, up.mainCov) && // sponge guard
  Math.abs(up.standing) >= 0.08 && up.frag < 0.05 &&
  Math.abs(down.standing) >= 0.08 && down.standing < 0 &&
  Math.abs(disc.standing) < 0.03 && disc.aniso < 1.06 && disc.frag < 0.05 &&
  wide.aspect > up.aspect && up.aspect > narrow.aspect;
console.log(ok ? "ALL SHAPE ASSERTIONS PASSED" : "SHAPE ASSERTION FAILURE");
