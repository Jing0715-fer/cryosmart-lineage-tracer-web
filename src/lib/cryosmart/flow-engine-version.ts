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
 */
export const FLOW_ENGINE_VERSION = "3.51";
