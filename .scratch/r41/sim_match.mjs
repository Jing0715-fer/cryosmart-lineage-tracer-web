// mirror of the page's envelopeCountAt + matchLevelForCount + autoLevelFor
const LEVEL_RATIO = 0.25;
function envelopeCountAt(stats, level) {
  const lv = stats.envLevels, ct = stats.envCounts;
  if (!lv || !ct || lv.length !== ct.length || lv.length < 2) return null;
  if (level <= lv[0]) return ct[0];
  if (level >= lv[lv.length - 1]) return ct[ct.length - 1];
  for (let i = 1; i < lv.length; i++) {
    if (level <= lv[i]) {
      const t = (level - lv[i - 1]) / (lv[i] - lv[i - 1] || 1e-12);
      return ct[i - 1] + t * (ct[i] - ct[i - 1]);
    }
  }
  return ct[ct.length - 1];
}
function matchLevelForCount(stats, target, floor) {
  const lv = stats.envLevels, ct = stats.envCounts;
  if (!lv || !ct || lv.length !== ct.length || lv.length < 2 || !(target > 0)) return null;
  let j = ct.findIndex((c) => c <= target);
  if (j === -1) return Math.max(lv[lv.length - 1], floor);
  if (j === 0) return Math.max(lv[0], floor);
  const l0 = lv[j - 1], l1 = lv[j], c0 = ct[j - 1], c1 = ct[j];
  let level;
  if (c0 > 0 && c1 > 0 && c0 !== c1) {
    const t = Math.log(c0 / target) / Math.log(c0 / c1);
    level = l0 + Math.min(Math.max(t, 0), 1) * (l1 - l0);
  } else level = l1;
  return Math.max(Math.min(level, stats.max * 0.9), Math.max(floor, lv[0]));
}
function autoLevelFor(stats) {
  const quarter = stats.max * LEVEL_RATIO;
  if (stats.otsu2 != null && stats.otsu > 0) {
    const floor = Math.max(stats.otsu, stats.max * 0.03);
    const level = Math.max(Math.min(quarter, 0.85 * stats.otsu2), Math.min(floor, stats.max * 0.9));
    return { level, rule: level === quarter ? "quarter" : "otsu2" };
  }
  return { level: quarter, rule: "legacy" };
}
const stats = {
  max: 1.0, otsu: 0.18, otsu2: 0.24,
  envLevels: [0.18, 0.2, 0.204, 0.24, 0.3, 0.36, 0.45, 0.55, 0.7, 0.9],
  envCounts: [500000, 260000, 240000, 150000, 90000, 60000, 35000, 20000, 8000, 2000],
};
const auto = autoLevelFor(stats);
console.log("AUTO ref level", auto.level.toFixed(4), auto.rule);
const N = envelopeCountAt(stats, auto.level);
console.log("anchorCount", N);
console.log("class matched", matchLevelForCount(stats, N, stats.otsu).toFixed(4));
// manual 0.35
const manual = 0.35;
const N2 = envelopeCountAt(stats, manual);
console.log("manual 0.35 anchor", N2, "-> class", matchLevelForCount(stats, N2, stats.otsu).toFixed(4));
