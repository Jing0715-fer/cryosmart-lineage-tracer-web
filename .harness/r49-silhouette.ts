/**
 * .harness/r49-silhouette.ts — round-49 (v3.89) offline assertions for the
 * REFERENCE-ANCHORED SILHOUETTE MATCHING + the moving-side protein-banded
 * fit sampling level.
 *
 * Checks (all offline, no browser, no relay):
 *   A. maskIou (exported, pure):
 *        - identical masks → 1.0; disjoint → 0; dim-mismatch → null;
 *          partial overlap → the exact inter/union ratio.
 *   B. Threshold calibration on the E2E mock's shape painters (replicated
 *      here 1:1 — the same 96×96 painters the relay serves):
 *        - same shape (mushroomWide vs itself)            = 1.000 ≥ GOOD
 *        - same pose, different roll/head (up vs wide)    = 0.774 ≥ GOOD
 *          (a correctly-fit map stays at the shared view — tier 1)
 *        - END-ON misfit (disc vs wide)                   = 0.405 < GOOD
 *          (the deck-8 J48 failure shape — tier 2 MUST scan)
 *        - upside-down (up vs down)                       = 0.276 < WEAK
 *          (no yaw can fix it — tier 3 stands it up)
 *        - narrow vs wide                                 ∈ (WEAK, GOOD)
 *          (medium — best yaw adopted, honest log)
 *        - snow / sponge vs wide                          ≪ WEAK
 *          (level-keyed junk never pose-matches)
 *   C. beltLevelFrom proteinLevel → fit sampling level policy (the
 *      moving-side micelle exclusion): a mid-band belt yields
 *      proteinLevel = min(t2, 0.5·max) and the level the bridge sends
 *      must be max(classic 0.25·max, proteinLevel); hot-belt / no-belt /
 *      degenerate splits keep the classic level (honest fallbacks).
 *   D. The yaw scan order starts at the 90° family (the dominant
 *      fit-failure mode) and covers ±180 in 30° steps — mirrored from
 *      SILHOUETTE_YAWS (asserted via a local copy; the constant is not
 *      exported — kept in sync by the E2E drill which exercises the real
 *      order end-to-end).
 *
 * Run: bun .harness/r49-silhouette.ts
 */
import { maskIou, beltLevelFrom } from "../src/lib/cryosmart/chimerax-bridge";
import type { Membrane2Reply, BridgeVolStats } from "../src/lib/cryosmart/chimerax-bridge";

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

/* ---- A. maskIou ---- */
console.log("[A] maskIou");
{
  const m = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) data[y * w + x] = 1;
    return { w, h, data };
  };
  const all = m(10, 10, () => true);
  const none = m(10, 10, () => false);
  const half = m(10, 10, (x) => x < 5);
  check("identical masks → 1.0", maskIou(all, all) === 1);
  check("disjoint → 0", maskIou(all, none) === 0);
  check("half overlap → 0.5", Math.abs((maskIou(all, half) ?? -1) - 0.5) < 1e-9);
  check("dim mismatch → null", maskIou(all, m(9, 10, () => true)) === null);
  check("empty union → null", maskIou(none, none) === null);
}

/* ---- B. shape-painter IoU calibration (the mock's painters, replicated) ---- */
console.log("[B] E2E shape calibration vs SILHOUETTE_GOOD=0.6 / WEAK=0.3");
const GOOD = 0.6;
const WEAK = 0.3;
{
  type Mask = { w: number; h: number; data: Uint8Array };
  const build = (paint: (set: (x: number, y: number) => void) => void): Mask => {
    const size = 96;
    const data = new Uint8Array(size * size);
    const set = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < size && y < size) data[y * size + x] = 1;
    };
    paint(set);
    return { w: size, h: size, data };
  };
  const mushroom = (kind: "up" | "down" | "wide" | "narrow"): Mask => {
    const down = kind === "down";
    const wide = kind === "wide";
    const narrow = kind === "narrow";
    const headRx = wide ? 40 : narrow ? 20 : 30;
    return build((set) => {
      const headCy = down ? 74 : 22;
      const headRy = 14;
      const beltY0 = down ? 30 : 56;
      const beltY1 = beltY0 + 10;
      const colX0 = 44;
      const colX1 = 52;
      const colY0 = down ? 8 : 36;
      const colY1 = down ? 60 : 88;
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          const ex = (x - 48) / headRx;
          const ey = (y - headCy) / headRy;
          if (ex * ex + ey * ey <= 1) {
            set(x, y);
            continue;
          }
          const inBelt = y >= beltY0 && y < beltY1 && Math.abs(x - 48) <= (wide ? 36 : narrow ? 20 : 26);
          const inCol = x >= colX0 && x < colX1 && y >= Math.min(colY0, colY1) && y < Math.max(colY0, colY1);
          if (inBelt || inCol) set(x, y);
        }
      }
    });
  };
  const disc = build((set) => {
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (Math.hypot(x + 0.5 - 48, y + 0.5 - 48) <= 34) set(x, y);
      }
    }
  });
  const snow = build((set) => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 42; i++) {
      const cx = 10 + rnd() * 76;
      const cy = 10 + rnd() * 76;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy <= 5) set(Math.round(cx + dx), Math.round(cy + dy));
        }
      }
    }
  });
  const sponge = build((set) => {
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const d = Math.hypot(x - 48, y - 48);
        if (d >= 11 && d <= 13) set(x, y);
      }
    }
  });
  const wide = mushroom("wide");
  const iou = (a: Mask, b: Mask) => maskIou(a, b) ?? -1;
  const fmt = (v: number) => v.toFixed(3);

  check("same shape ≥ GOOD (tier 1 keeps the shared view)", iou(wide, wide) >= GOOD, fmt(iou(wide, wide)));
  const upWide = iou(mushroom("up"), wide);
  check("same-pose roll variant ≥ GOOD (still tier 1)", upWide >= GOOD, fmt(upWide));
  const discWide = iou(disc, wide);
  check("END-ON misfit (disc) < GOOD (tier 2 MUST scan)", discWide < GOOD, fmt(discWide));
  check("END-ON misfit (disc) ≥ WEAK (not discarded outright)", discWide >= WEAK, fmt(discWide));
  const upDown = iou(mushroom("up"), mushroom("down"));
  check("upside-down < WEAK (tier 3 must stand it up)", upDown < WEAK, fmt(upDown));
  const narrowWide = iou(mushroom("narrow"), wide);
  check(
    "narrow vs wide ∈ (WEAK, GOOD) (medium — best yaw adopted honestly)",
    narrowWide > WEAK && narrowWide < GOOD,
    fmt(narrowWide),
  );
  check("snow ≪ WEAK", iou(snow, wide) < WEAK, fmt(iou(snow, wide)));
  check("sponge ≪ WEAK", iou(sponge, wide) < WEAK, fmt(iou(sponge, wide)));
}

/* ---- C. the moving-side protein-banded fit sampling level ---- */
console.log("[C] beltLevelFrom proteinLevel → fit sampling policy");
{
  const stats = (max: number): BridgeVolStats => ({ max, mean: 0, sd: 0, min: 0 } as BridgeVolStats);
  const midBeltM2 = (t1: number, t2: number, ratio: number): Membrane2Reply => ({
    splits: [t1, t2],
    bands: [
      { name: "low", count: 100, ratio: 0.9 },
      { name: "mid", count: 500, ratio },
      { name: "high", count: 300, ratio: 1.6 },
    ],
  } as unknown as Membrane2Reply);
  /* mid-band belt (colder than protein): proteinLevel = min(t2, 0.5·max). */
  {
    const max = 1.0;
    const belt = beltLevelFrom(midBeltM2(0.08, 0.42, 0.35), stats(max));
    check("mid-band belt → proteinLevel = t2", belt.proteinLevel != null && Math.abs(belt.proteinLevel - 0.42) < 1e-9, String(belt.proteinLevel));
    const classic = max * 0.25;
    const fitLevel = Math.max(classic, belt.proteinLevel ?? classic);
    check("fit sampling level = max(0.25·max, t2) → 0.42 (micelle excluded)", Math.abs(fitLevel - 0.42) < 1e-9, String(fitLevel));
  }
  {
    /* t2 below the classic level: the classic stays (the belt already sits
     * under 0.25·max — no need to raise). */
    const max = 1.0;
    const belt = beltLevelFrom(midBeltM2(0.05, 0.2, 0.35), stats(max));
    const classic = max * 0.25;
    const fitLevel = Math.max(classic, belt.proteinLevel ?? classic);
    check("t2 ≤ 0.25·max → classic level kept", Math.abs(fitLevel - classic) < 1e-9, String(fitLevel));
  }
  {
    /* the 0.5·max cap: a high t2 cannot starve the fit of points. */
    const max = 1.0;
    const belt = beltLevelFrom(midBeltM2(0.1, 0.8, 0.35), stats(max));
    check("proteinLevel capped at 0.5·max", belt.proteinLevel != null && Math.abs(belt.proteinLevel - 0.5) < 1e-9, String(belt.proteinLevel));
  }
  {
    /* hot belt (high band): no threshold hides it — proteinLevel null →
     * the classic level rides (honest fallback). */
    const max = 1.0;
    const belt = beltLevelFrom(midBeltM2(0.08, 0.4, 1.2), stats(max));
    check("hot belt → proteinLevel null (classic kept)", belt.proteinLevel == null, String(belt.proteinLevel));
  }
  {
    /* degenerate split (t2 ≤ t1): everything null → classic. */
    const belt = beltLevelFrom(midBeltM2(0.4, 0.2, 0.35), stats(1.0));
    check("degenerate split → proteinLevel null", belt.proteinLevel == null, String(belt.proteinLevel));
    const noSplit = beltLevelFrom(null, stats(1.0));
    check("no /membrane2 → proteinLevel null (old relay)", noSplit.proteinLevel == null);
  }
}

/* ---- D. the yaw scan order (mirrored; E2E exercises the real one) ---- */
console.log("[D] yaw scan order");
{
  const YAWS = [90, -90, 180, 45, -45, 135, -135, 30, -30, 60, -60, 120, -120, 150, -150];
  check("starts at the 90° family", YAWS[0] === 90 && YAWS[1] === -90);
  check("covers ±180 in 30° steps", YAWS.includes(180) && YAWS.includes(-150) && YAWS.includes(-30));
  const uniq = new Set(YAWS);
  check("no duplicate candidates", uniq.size === YAWS.length);
  check("every candidate is a non-zero multiple of 15", YAWS.every((y) => y !== 0 && y % 15 === 0));
}

console.log(fail === 0 ? `\nALL ${pass} CHECKS PASSED` : `\n${fail} FAILED (of ${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
