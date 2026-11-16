const fs = require("fs");
const file = "src/lib/cryosmart/chimerax-bridge.ts";
let src = fs.readFileSync(file, "utf8");
const startMarker = "/** v3.81: the map";
const endMarker = 'return { level: quarter, rule: "0.25\u00d7max\uff08\u6865\u811a\u672c\u8f83\u65e7\uff0c\u65e0 otsu\u2082 \u2014 \u5efa\u8bae ChimeraX \u91cd\u65b0 open relay.py\uff09" };';
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);
if (start < 0 || end < 0) throw new Error("markers not found: " + start + "," + end);
const replacement = `/** v3.81 \u2192 v3.85 (round-45): the map's OWN auto rule is now the
 * user's auto_color_locres.py rule VERBATIM \u2014 full-matrix max \u00d7 0.15
 * (\`em_map.data.full_matrix().max() * 0.15\`). The v3.79\u201381
 * min(0.25\u00d7max, 0.85\u00d7otsu\u2082) clamp is gone \u2014 the \`surface dust\` cleanup
 * handles the small disconnected junk those histogram rules were
 * fighting, and every max-ratio fight was really a fight against one
 * hot spike that the dust now hides. */
function autoLevelFor(stats: BridgeVolStats): DisplayLevelChoice | null {
  if (!Number.isFinite(stats.max) || stats.max <= 0) return null;
  return {
    level: stats.max * SCRIPT_LEVEL_RATIO,
    rule: "0.15\u00d7max\uff08auto_color_locres \u811a\u672c\u89c4\u5219\uff09",
  };
}`;
src = src.slice(0, start) + replacement + src.slice(end + endMarker.length);
fs.writeFileSync(file, src);
console.log("autoLevelFor replaced OK");
