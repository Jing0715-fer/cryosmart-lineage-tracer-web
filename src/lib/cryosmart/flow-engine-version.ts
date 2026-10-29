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
 *
 * v3.55 bump reason (round-14): four behavior changes at once — (1) the
 * header's "Auto pick → N particles" count is the MAINLINE pick (largest
 * pick/extract-family ancestor count) instead of the earliest pick job's
 * count (P96 printed the 217-photo subset pick 164,291 while every later
 * stage read 766,560+); (2) renderFigureMaps closes ALREADY-OPEN volume
 * models before screenshotting (relay /volumes; `close all` fallback on
 * old relays) and closes its own models afterwards, so a previous run's
 * maps can no longer sweep into the screenshots; (3) every stage label in
 * the PPTX carries its job id ("Hetero refinement · J31"); (4) simplified
 * mode omits an ab-initio STAGE entirely when its Maximum-resolution
 * parameter is the default 12 Å (or absent). Old pages would keep all four
 * behaviors invisibly.
 *
 * v3.56 bump reason (round-15 “已有 map 直接从本地打开，不重复下载”): the
 * relay's staging dir became a PERSISTENT map cache (fixed system-temp
 * path "cryoflow_map_cache" — survives ChimeraX restarts and relay
 * re-opens), the relay gained GET /staged (per-name cache lookup +
 * listing), /stage writes are ATOMIC, and the card now checks the cache
 * per map BEFORE any download ladder rung — a hit opens the LOCAL path
 * directly and only the misses walk direct → proxy → page relay (whose
 * uploads land in the cache under the same canonical name, so every later
 * run of the same workflow downloads nothing). Old pages have no cache
 * check and would keep re-downloading every map on every run.
 *
 * v3.57 bump reason (round-16, Windows-openability): the exported
 * workflow deck opened on Mac PowerPoint but Windows reported it as
 * corrupt until a Mac re-save (the theme carried ONE-entry
 * fillStyleLst/lnStyleLst/effectStyleLst/bgFillStyleLst — OOXML requires
 * exactly three of each — plus fonts without <a:cs>, and slideLayout1
 * had NO relationship to its slide master). Mac validates leniently and
 * its re-save writes a legal theme, which is why re-saved decks opened.
 * v3.57 writes the canonical Office style matrix, cs fonts, the required
 * layout→master relationship, master txStyles and layout clrMapOvr. Old
 * pages still produce the rejected package.
 *
 * v3.58 bump reason (round-17 “缺少 J28 + 合并 non-uniform + homo
 * reconstruct 忽略 + 连线错位”): (1) the stage spine now searches the
 * PARTICLE ancestry first — P96's J28 (hetero refinement on the full
 * 1.59M extract feeding J29 dedup → J30 → J31) was invisible because the
 * old walk followed the volume edge J31→J27 directly; (2) 简化模式 merges
 * adjacent non-uniform refinements (same particle count OR only CTF
 * refinement between them) into the LAST one and omits
 * homo-reconstruct-only stages (J40); (3) connectors attach at the flow
 * anchor — the upstream class whose particle count feeds the next stage —
 * with elbow routes when anchor/entry x differ, and the column wrap rides
 * a below-content lane + inter-column gutter instead of the crossing
 * bentConnector3. Old pages keep all three behaviors.
 *
 * v3.60 bump reason (round-19 “手动/标准/简化/极简合并为一个下拉框 +
 * 勾选框溢出重叠修复 + 极简最多 5 行”): (1) the four figure modes
 * (手动/标准/简化/极简) now live in ONE 模式 dropdown — the old separate
 * 版式 select + 手动勾选 switch + 简化模式 switch are gone, and 极简
 * now ALSO caps the deck at 5 image rows (简化 merging underneath, 阶段数
 * selector clamped to 4/5, “全部” falls back to 5); (2) the 手动
 * checklist no longer escapes its panel — the old shadcn ScrollArea
 * max-h-48 did not constrain the list (Radix Root has no overflow clip
 * and the viewport's height:100% resolves to auto), so a long job list
 * overlapped the content below; the list is now a native max-h-64
 * overflow-y-auto box. Old pages keep the three scattered controls and
 * the overflowing checklist.
 *
 * v3.61 bump reason (round-20 “极简模式还是有问题，很多上下游的job放在
 * 同一级了，应该是精选出几个job展示，上下游关系还是不能混乱”): the 极简
 * model is now a CURATED MAINLINE instead of the folded merge-assembly —
 * rows come from the particle mainline's map-bearing spine only (every
 * job in its OWN row, ancestor → final), the merge-contributor parallel
 * groups that crammed an upstream refinement and a downstream one onto
 * the same visual level (P268's “Import Volumes + Non-uniform
 * refinement” rows, counts jumping 17,887 → 43,977 → 2,084,655) are
 * never built, imported reference volumes (import_* seeds) and the
 * select_2D montage row no longer enter the 极简 funnel, and the ≤5 row
 * cap keeps first+last with the middle filling from the end
 * (curateMinimalFlow — same selection round-19 approved on the P96
 * chain: [J28, J34, J37, J39, J41]). Old pages keep the folded
 * merge-assembly 极简 (parallel rows intact).
 */
export const FLOW_ENGINE_VERSION = "3.61";
