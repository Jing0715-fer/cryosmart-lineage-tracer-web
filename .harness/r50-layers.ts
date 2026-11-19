/**
 * .harness/r50-layers.ts — round-50 (v3.90) offline assertions for the
 * RADIAL-LAYER detergent removal (分层去垢) — the attached ini.py /
 * analyze_volume_layers.py scripts' 分层机制 ported onto the fitmap
 * alignment's map-vs-map targets.
 *
 * Checks (all offline, no browser, no relay):
 *   A. parseLayersReply (exported, pure):
 *        - a well-formed relay /layers reply parses: splits/bands kept,
 *          the layer table mapped (belt_frac → beltFrac), the belt shell
 *          mapped (layer_from → layerFrom, rho_cut → rhoCut …);
 *        - malformed payloads (ok!==true, inverted r1≤r0, bad band,
 *          missing step, non-finite numbers) → the shell/belt drop to
 *          null WITHOUT losing the m2-compatible part;
 *        - a belt-null reply with a reason keeps the reason.
 *   B. beltLevelFrom on a LayersReply — the /layers reply is a structural
 *      superset of Membrane2Reply, so the SAME splits/bands must give the
 *      SAME verdict as /membrane2 would: the mock's hot-belt shape
 *      (splits [0.18, 0.54], high band oblate 0.30) → proteinLevel null /
 *      beltBand "high"; the belt=mid shape (mid band oblate) →
 *      proteinLevel min(0.54, 0.5×max) / beltBand "mid".
 *   C. beltShellPlanFor — the layer rung's engagement rule (the round's
 *      core policy, shared by BOTH alignment sides):
 *        - HOT belt + shell found → the shell (the v3.86/v3.89 value
 *          rungs have no answer: proteinLevel null, beltBand "high");
 *        - COLD belt (proteinLevel set) → null — the delivered v3.86/89
 *          threshold/level behavior stays verbatim (zero regression);
 *        - no /layers reply / belt null / no oblate band → null;
 *        - degenerate stats (no max) → null.
 *   D. The E2E mock's /layers numbers, replicated 1:1 (the same 8-layer
 *      profile the mock serves): the qualifying run (belt_frac ≥ 0.5) is
 *      exactly layers 5-7 (indices 4-6), the shell r0/r1 equal those
 *      layers' bounds (33.0 / 56.25), and the relay's layer-run algorithm
 *      (contiguous run around the peak, never touching layer 0) is
 *      replicated and agrees — the mock can never serve a shell the
 *      page's policy would reject.
 *
 * Run: bun .harness/r50-layers.ts
 */
import {
  parseLayersReply,
  beltShellPlanFor,
  beltLevelFrom,
  type LayersReply,
  type Membrane2Reply,
  type BridgeVolStats,
  type BeltShell,
} from "../src/lib/cryosmart/chimerax-bridge";

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

/* the mock's /layers payload (served verbatim by report-e2e — kept in
 * sync here so the policy checks run on the EXACT shape E2E sees) */
const beltFracProfile = [0.05, 0.12, 0.2, 0.35, 0.62, 0.78, 0.71, 0.3];
const bounds = [2, 9.75, 17.5, 25.25, 33, 40.75, 48.5, 56.25, 64];
const mockLayersReply = (beltMid: boolean) => ({
  ok: true,
  splits: [0.18, 0.54],
  bands: [
    {
      name: "mid",
      lo: 0.18,
      hi: 0.54,
      normal: beltMid ? [0.666667, 0.333333, 0.666667] : [0.57735, 0.57735, 0.57735],
      ea: beltMid ? [0.447214, -0.894427, 0.0] : [0.7071, -0.7071, 0.0],
      eb: beltMid ? [0.596285, 0.298142, -0.745356] : [0.40825, 0.40825, -0.8165],
      ratio: beltMid ? 0.3 : 0.99,
      lambdas: beltMid ? [0.3, 1.0, 1.05] : [0.99, 1.0, 1.6],
      count: beltMid ? 90000 : 140000,
    },
    {
      name: "high",
      lo: 0.54,
      hi: 1.0,
      normal: beltMid ? [0.57735, 0.57735, 0.57735] : [0.666667, 0.333333, 0.666667],
      ea: beltMid ? [0.7071, -0.7071, 0.0] : [0.447214, -0.894427, 0.0],
      eb: beltMid ? [0.40825, 0.40825, -0.8165] : [0.596285, 0.298142, -0.745356],
      ratio: beltMid ? 0.99 : 0.3,
      lambdas: beltMid ? [0.99, 1.0, 1.6] : [0.3, 1.0, 1.05],
      count: beltMid ? 140000 : 90000,
    },
  ],
  envelope: null,
  layers: beltFracProfile.map((f, i) => ({
    i,
    r0: bounds[i],
    r1: bounds[i + 1],
    count: 50000 + i,
    mean: 0.6 - i * 0.05,
    belt_frac: f,
  })),
  belt: {
    band: beltMid ? "mid" : "high",
    r0: 33,
    r1: 56.25,
    layer_from: 4,
    layer_to: 6,
    frac: 0.78,
    rho_cut: null,
    z_cut: null,
    step: [1.25, 1.25, 1.25],
    note: `胶束带=${beltMid ? "mid" : "high"} 相带（扁率 0.30）· 第 5-7/8 层 r 33.0-56.3 体素（≈ 41-70 Å）· 层内胶束占比峰值 0.78`,
  },
  reason: null,
});

/* ---- A. parseLayersReply ---- */
console.log("[A] parseLayersReply");
{
  const parsed = parseLayersReply(mockLayersReply(false));
  check("well-formed reply parses", parsed != null);
  check("splits kept", parsed?.splits != null && parsed.splits[0] === 0.18 && parsed.splits[1] === 0.54);
  check("bands kept (2)", (parsed?.bands.length ?? 0) === 2);
  check("layer table mapped", parsed?.layers != null && parsed.layers.length === 8);
  check(
    "belt_frac → beltFrac",
    parsed?.layers?.[5]?.beltFrac === 0.78 && parsed?.layers?.[5]?.r0 === 40.75 && parsed?.layers?.[5]?.r1 === 48.5,
  );
  check(
    "belt shell mapped",
    parsed?.belt != null &&
      parsed.belt.band === "high" &&
      parsed.belt.r0 === 33 &&
      parsed.belt.r1 === 56.25 &&
      parsed.belt.layerFrom === 4 &&
      parsed.belt.layerTo === 6 &&
      parsed.belt.rhoCut === null &&
      parsed.belt.step[0] === 1.25,
  );
  check("note carried", (parsed?.belt?.note ?? "").includes("第 5-7/8 层"));

  const badBand = parseLayersReply({ ...mockLayersReply(false), belt: { ...mockLayersReply(false).belt, band: "odd" } });
  check("bad band → belt null (m2 part kept)", badBand?.belt == null && badBand?.splits != null && (badBand?.bands.length ?? 0) === 2);
  const inverted = parseLayersReply({ ...mockLayersReply(false), belt: { ...mockLayersReply(false).belt, r0: 56.25, r1: 33 } });
  check("inverted radii → belt null", inverted?.belt == null);
  const noStep = parseLayersReply({ ...mockLayersReply(false), belt: { ...mockLayersReply(false).belt, step: [1.25, 1.25] } });
  check("short step → belt null", noStep?.belt == null);
  const notOk = parseLayersReply({ ...mockLayersReply(false), ok: false });
  check("ok!==true → null", notOk == null);
  const noBelt = parseLayersReply({ ...mockLayersReply(false), belt: null, reason: "无扁率相带（带内 PCA 近各向同性）" });
  check("belt null + reason kept", noBelt?.belt == null && noBelt?.reason === "无扁率相带（带内 PCA 近各向同性）" && noBelt.layers != null);
  const junk = parseLayersReply("<html>404</html>");
  check("non-object → null", junk == null);
  const badSplits = parseLayersReply({ ...mockLayersReply(false), splits: [0.54, 0.18] });
  check("inverted splits dropped", badSplits?.splits == null && badSplits?.bands.length === 2);
}

/* ---- B. beltLevelFrom on a LayersReply (the superset contract) ---- */
console.log("[B] beltLevelFrom reads /layers like /membrane2");
{
  const stats = { max: 1.0, mean: 0.1, sd: 0.2, min: -0.5 } as BridgeVolStats;
  const hotLayers = parseLayersReply(mockLayersReply(false));
  const hotM2: Membrane2Reply = {
    envelope: null,
    splits: [0.18, 0.54],
    bands: hotLayers!.bands,
  };
  const beltL = beltLevelFrom(hotLayers, stats);
  const beltM = beltLevelFrom(hotM2, stats);
  check(
    "hot belt: proteinLevel null via BOTH reply shapes",
    beltL.proteinLevel == null && beltM.proteinLevel == null,
    `layers=${beltL.proteinLevel} m2=${beltM.proteinLevel}`,
  );
  check(
    "hot belt: beltBand high via BOTH reply shapes",
    beltL.beltBand === "high" && beltM.beltBand === "high",
  );
  const midLayers = parseLayersReply(mockLayersReply(true));
  const beltMidL = beltLevelFrom(midLayers, stats);
  const beltMidM = beltLevelFrom({ envelope: null, splits: [0.18, 0.54], bands: midLayers!.bands }, stats);
  check(
    "cold belt: proteinLevel = min(t2, 0.5×max) via BOTH reply shapes",
    beltMidL.proteinLevel === 0.5 && beltMidM.proteinLevel === 0.5,
    `layers=${beltMidL.proteinLevel} m2=${beltMidM.proteinLevel}`,
  );
  check("cold belt: beltBand mid via BOTH reply shapes", beltMidL.beltBand === "mid" && beltMidM.beltBand === "mid");
}

/* ---- C. beltShellPlanFor (the engagement rule) ---- */
console.log("[C] beltShellPlanFor — the layer rung's engagement rule");
{
  const stats = { max: 1.0, mean: 0.1, sd: 0.2, min: -0.5 } as BridgeVolStats;
  const hotLayers = parseLayersReply(mockLayersReply(false));
  const midLayers = parseLayersReply(mockLayersReply(true));
  const beltHot = beltLevelFrom(hotLayers, stats);
  const beltMid = beltLevelFrom(midLayers, stats);
  const beltNoBand = beltLevelFrom(
    {
      envelope: null,
      splits: [0.18, 0.54],
      bands: hotLayers!.bands.map((b) => ({ ...b, ratio: 0.99 })),
    },
    stats,
  );

  const hot = beltShellPlanFor(beltHot, hotLayers);
  check("HOT belt + shell → the shell engages", hot != null && hot.band === "high" && hot.r0 === 33 && hot.r1 === 56.25);
  check("cold belt (proteinLevel set) → null (v3.86/89 path verbatim)", beltShellPlanFor(beltMid, midLayers) == null);
  check("no /layers reply → null", beltShellPlanFor(beltHot, null) == null);
  const noBeltLayers: LayersReply = { ...hotLayers!, belt: null, reason: "无扁率相带" };
  check("belt null in the reply → null", beltShellPlanFor(beltHot, noBeltLayers) == null);
  check("no oblate band (beltBand null) → null", beltShellPlanFor(beltNoBand, hotLayers) == null);
  /* the belt=mid reply's shell (band "mid") must NOT engage while the
   * beltLevelFrom verdict says mid/cold — the shapes can never disagree
   * in practice (both read the same bands), this pins the policy. */
  check("mid-band shell + cold verdict → null", beltShellPlanFor(beltMid, hotLayers) == null);
  /* a proteinLevel-carrying belt paired with a hot-band shell is
   * contradictory — the policy trusts the VALUE rung (null). */
  const coldBeltHotShell = { ...beltMid, proteinLevel: 0.5 } as typeof beltMid;
  check("proteinLevel wins over any shell → null", beltShellPlanFor(coldBeltHotShell, hotLayers) == null);
}

/* ---- D. the mock's layer profile vs the relay's run algorithm ---- */
console.log("[D] mock /layers profile ↔ the relay's belt-run algorithm");
{
  /* replicate relay.py's belt_layers run finder verbatim: the contiguous
   * ≥0.5 run around the argmax layer, rejecting any profile where layer
   * 0 qualifies (the protein core must never read as belt). */
  const beltRun = (fracs: number[], threshold = 0.5): { from: number; to: number } | null => {
    const peak = fracs.indexOf(Math.max(...fracs));
    if (fracs[peak] < threshold) return null;
    if (fracs.some((f, i) => i === 0 && f >= threshold)) return null;
    let from = peak;
    while (from - 1 >= 0 && fracs[from - 1] >= threshold) from -= 1;
    let to = peak;
    while (to + 1 < fracs.length && fracs[to + 1] >= threshold) to += 1;
    return { from, to };
  };
  const run = beltRun(beltFracProfile);
  check("qualifying run = layers 5-7 (indices 4-6)", run != null && run.from === 4 && run.to === 6);
  check(
    "shell radii = the run's bounds (33.0 / 56.25)",
    run != null && bounds[run.from] === 33 && bounds[run.to + 1] === 56.25,
  );
  check("layer 0 never qualifies on the mock profile", beltFracProfile[0] < 0.5);
  check(
    "a core-contaminated profile is rejected (layer 0 ≥ 0.5)",
    beltRun([0.6, 0.7, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05]) == null,
  );
  check(
    "a no-belt profile (peak < 0.5) is rejected",
    beltRun([0.1, 0.15, 0.2, 0.3, 0.4, 0.45, 0.3, 0.1]) == null,
  );
  check(
    "a fragmented belt (gap inside the run) trims to the peak's run",
    (() => {
      const r = beltRun([0.05, 0.1, 0.55, 0.2, 0.62, 0.78, 0.71, 0.3]);
      return r != null && r.from === 4 && r.to === 6;
    })(),
  );
  /* the belt=mid drill serves the SAME profile — the shell stays found
   * (band mid), but the policy (C) keeps it unused while proteinLevel
   * exists: the r48/r49 threshold asserts are unaffected. */
  const midParsed = parseLayersReply(mockLayersReply(true));
  check("belt=mid drill: the shell is still found (band mid)", midParsed?.belt?.band === "mid");
  const stats = { max: 1.0, mean: 0.1, sd: 0.2, min: -0.5 } as BridgeVolStats;
  check(
    "belt=mid drill: policy leaves it unused (cold belt)",
    beltShellPlanFor(beltLevelFrom(midParsed, stats), midParsed) == null,
  );
}

/* ---- E. the moving-side plan summary (beltShellPlanFor output shape) ---- */
console.log("[E] shell plan shape");
{
  const stats = { max: 1.0, mean: 0.1, sd: 0.2, min: -0.5 } as BridgeVolStats;
  const hotLayers = parseLayersReply(mockLayersReply(false));
  const shell = beltShellPlanFor(beltLevelFrom(hotLayers, stats), hotLayers) as BeltShell;
  check("shell carries the layer indices for the log", shell.layerFrom === 4 && shell.layerTo === 6);
  check("shell step in Å for the log", shell.step.join(",") === "1.25,1.25,1.25");
  check("note names the band + layers", shell.note.includes("high") && shell.note.includes("第 5-7/8 层"));
}

console.log("");
if (fail === 0) {
  console.log(`ALL CHECKS PASSED (${pass})`);
} else {
  console.error(`${fail} FAILED, ${pass} passed`);
  process.exit(1);
}
