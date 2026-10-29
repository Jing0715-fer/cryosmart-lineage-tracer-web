/**
 * Flow-figure engine version (v3.50).
 *
 * The single source of truth for BOTH sides of the stale-page check:
 *   - the browser card embeds it at build time (`FLOW_ENGINE_VERSION`),
 *   - the live server route /api/cryosmart/flow-figure/version serves it.
 *
 * Why: the user's round-7/8/9 logs were byte-identical in shape — the round-9
 * paste carried `视角 base: 缩略图获取失败` WITHOUT the “ — <err>” suffix that
 * v3.48+ always appends, i.e. the page that produced it was still running the
 * v3.47-era bundle (its `save image` bug — long fixed — recreates the exact
 * “clean save + relay /file 404” symptom). A dev server that restarts between
 * sessions leaves old tabs alive with old JS; those tabs call the LIVE server
 * and mix old client behavior with new routes invisibly.
 *
 * Every page from this version on compares its embedded constant against the
 * live route at mount AND at the start of every 生成流程图 run; a mismatch
 * blocks the run with a 刷新页面 banner, and every run log prints its version
 * line so a pasted log is self-diagnosing (a log WITHOUT the line is pre-3.50
 * and stale by definition).
 *
 * v3.52 bump reason: the ChimeraX render pipeline changed COLOR semantics
 * (uniform gray → per-class Chimera default open-colors, grey/pale yellow/
 * violet/lavender…). Old pages would keep sending v3.51 behavior invisibly;
 * the version line in every run log also tells the user which palette a
 * pasted log was rendered with.
 *
 * v3.53 bump reason (round-12): three REAL-machine render fixes at once —
 * (1) every save now runs transparentBackground true (alpha-channel PNGs on
 * the white slide; `set bgColor` is no longer sent at all), (2) per-class
 * colors are applied via `volume #<id> color` instead of the atom-only
 * `color #<id>` that silently no-oped on the user's ChimeraX (their round-12
 * deck came back with every map still default gray), and (3) the header band
 * ("Micrographs → Auto pick → particles") is anchored to the first stage so
 * the entry connector no longer dangles from empty space. Old pages would
 * keep the black-background + gray-maps + dangling-connector look invisibly.
 *
 * v3.54 bump reason (round-13): (1) the per-class palette is corrected to
 * Chimera classic's OWN 16-bit model colors (the user pasted the true list:
 * #b333b333b333 grey, #ffffffffb333 pale yellow, #b333ffffffff PALE CYAN —
 * v3.52/53's "#b333ff violet" was a mis-parse of the 16-bit paste —
 * #b333b333ffff pale blue, #ffffb333ffff pale magenta, #ffffb333b333 pale
 * salmon, #b333ffffb333 pale green, #e666bfff9999 tan; cycles past class 7),
 * so every multi-class row renders with materially different colors; and
 * (2) a NEW 简化模式 — small-subset 2D / select-2D / ab-initio bootstrap
 * steps are omitted, displayed particle counts are funneled 多→少, and a
 * default-12 Å ab-initio final's resolution info is ignored. Old pages
 * would keep the stale violet/tan palette and cannot produce simplified
 * figures at all.
 */
export const FLOW_ENGINE_VERSION = "3.54";
