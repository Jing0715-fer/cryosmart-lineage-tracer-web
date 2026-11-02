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
 *
 * v3.62 bump reason (round-21 “对齐的算法还是不是对每个样品都有效 + 省略的
 * 步骤可能需要写为几*hetero refine或几*abinitio + 极简模式变成4，5，6行 +
 * 排版还是不太美观”, from the uploaded P268_J266 deck): (1) the 极简 mainline
 * now MERGES consecutive same-type stages into ONE row labelled “N×
 * <type>” (the reference deck's own “2*Hetero refinement” row — P268's
 * back-to-back Ab-initio reconstruction rows collapse into “2× Ab-initio
 * reconstruction”), keeping the most downstream member's montage + count;
 * (2) stages the 极简 deck OMITS (简化 drops + the row cap) are no longer
 * silent — each gap annotates “omitted: N× <type>” under the retention
 * label; (3) the row cap is now 4/5/6 (阶段数 offers all three, “全部”
 * → 6); (4) EVERY 极简 row centres its flow-anchor class on the spine —
 * the anchor swaps into the strip's centre slot and the strip shifts to
 * land it exactly under the arrow (odd counts exact, even counts nudged
 * + margin-clamped), so the selection frame always sits on the flow for
 * EVERY sample (P268's third row framed the LEFT class while the arrow
 * ran through the middle one); (5) uniform inter-row pitch (rows without
 * a retention label keep the same gap height) and full separator count
 * formatting (“4,812,000 particles”, not “4812K”). Old pages keep the
 * duplicated-stage rows, silent omissions, the 4/5-only cap, the
 * off-spine frames and the uneven pitch.

 * v3.63 bump reason (round-22 “极简模式中间精选的一定是分类的结果，不要选
 * non-uniform这种非分类的job，另外每部展示的颗粒数和上一步的比例要重新
 * 用这一步除以上一步来计算，平行合并的分类job要将两个job的颗粒数合并。
 * auto pick的箭头缺失，map的对齐还是需要优化，每个手性可能需要转180度
 * 再多搜索一次”): (1) the 极简 middle rows curate from CLASSIFICATION jobs
 * ONLY (hetero refinement / ab-initio / 3D classification —
 * isClassificationJobType); non-uniform / local-refinement middles are
 * never selected as showcase rows, they read in the “omitted: N×” gap
 * notes instead; (2) the retention labels now divide THIS step by the
 * PREVIOUS step's ENTRY count — a merged “N×” row's denominator is its
 * FIRST member's input (the reference deck's own 37.2% = 590,421 ÷ the
 * 1,588,675 that entered the 2*Hetero run), and ≥2 parallel
 * classification jobs reuniting at one merge render as ONE parallel row
 * whose entry count is the SUM of the two jobs' counts; (3) the header
 * band regains the reference's horizontal “Auto pick” arrow (0.39 in /
 * 1 pt / triangle, head pointing right under the raised pick label —
 * v3.59 had dropped it); (4) the ChimeraX alignment ladder searches 8
 * candidates instead of 5 — the flipped hand now ALSO gets the 180°
 * rotation search (flip_z_rot_{x,y,z}_180), closing the mirrored +
 * 180°-rotated pose class the 5-candidate ladder mis-aligned. Old pages
 * keep the non-classification middles, the wrong retention denominators,
 * the arrowless header band and the 5-candidate search.
 *
 * v3.64 bump reason (round-23 “目前还是会每次重复下载和保存map文件 +
 * map的对齐还是存在问题，可以先lowpass一下再找角度，找到后应用到原map上 +
 * 极简流程方面应该找到颗粒最多一个分类任务作为第一行 + 最终不应该用
 * deepEMhancer，而是deepemhancer前一步的map也需要展示，并且需要显示分辨率 +
 * 分类后指向deepemhancer这之间缺少颗粒数和比例”): (1) the direct and
 * proxy rungs of the map-source ladder attempted to CONVERGE ON THE
 * PERSISTENT CACHE by having CHIMERAX open each URL once and `save` the
 * model into the cache — the 8-candidate alignment read LOCAL files on a
 * successful save; (2) the ChimeraX pose search runs on vgaussian
 * LOWPASSED clones (sigma 2 voxels) of the candidate AND the reference —
 * the fit ladder runs smooth-vs-smooth (robust against the
 * high-frequency noise that dragged full-resolution fits into wrong
 * local optima), and the found pose is applied back onto the ORIGINAL
 * map via matrixget/matrixset, verified with a full-resolution
 * correlation (the candidate row's `post`); any vgaussian/matrix failure
 * degrades to the previous direct fit; (3) the 极简 deck's FIRST row is
 * the classification task carrying the MOST particles (a parallel merge
 * row reads the SUM, a merged N× row its first member's entry) —
 * everything upstream of it is left out; (4) post-processing
 * (DeepEMhancer / sharpen / density_mod) never enters the 极简 deck: the
 * final row shows the PRE-DeepEMhancer job's map and the spine carries
 * THAT job's resolution (the reference map switches to it too); (5) a
 * row that reports no count of its own inherits the previous row's
 * entry, so the gap between the last classification and the final row
 * never loses its particle count / ratio lines again.
 *
 * v3.65 bump reason (round-24 “目前还是会重新下载map，增加设置一个本地目录
 * 先下载map，再让chimera从指定目录中打开map进行对齐截图，如果目录中已有
 * 所需文件就跳过下载”): the download rung INVERTED — v3.64's
 * ChimeraX-open-then-save convergence still re-downloaded whenever the
 * save rung failed silently on the real machine. The RELAY itself (the
 * ChimeraX machine's own Python — no ChimeraX command, no ChimeraX
 * fetcher quirks) now downloads each still-uncached map ONCE into its
 * persistent local cache dir (new POST /fetch; a file already in the dir
 * skips the download outright and just returns its path) and hands
 * ChimeraX the LOCAL path — the candidate alignment and every
 * screenshot afterwards read DISK, never network. The direct rung
 * /fetch's the map's own URL; the proxy rung /fetch's the app-proxy URL
 * (credentials attached server-side, browser untouched); the
 * page-mediated /stage stays the last resort, and old relays without
 * /fetch keep the v3.56–63 URL-direct ladder with an upgrade hint.
 * /ping gained a "fetch": true flag (canFetchMaps), and the bridge panel
 * now surfaces the local map dir itself (下载一次、以后免下载).
 *
 * v3.66 bump reason (round-25 “map的对齐还是存在问题，需要继续优化对齐
 * 的算法”): the pose search was rebuilt around the REAL ChimeraX
 * fitting command — v3.56–65 hard-coded `fit #v in #ref [search 15]`,
 * which is NOT a stock ChimeraX command (`fitmap #v inMap #ref
 * [search N]` is), so on the real machine BOTH fit calls errored
 * “unknown command”, the soft flag swallowed the errors, and
 * score = fit2 ?? fit1 ?? pre silently degraded to the STATIC pose
 * correlation — the alignment NEVER moved a map; only the 8 fixed
 * pre-rotations ever changed a pose (why 180°-off maps “fixed
 * themselves” while everything else stayed mis-aligned). (1) RUNTIME
 * COMMAND PROBE: the first fit call walks fitmap/inMap (documented) →
 * fitmap/in → fit/inMap → fit/in, adopts + logs the first shape this
 * ChimeraX actually runs; `measure correlation` gets the same treatment
 * (inMap primary — the form that always parsed on the real machine —
 * positional fallback). (2) TWO HANDS replace the 8 pre-turned
 * candidates: the map opens ONCE and ONE `volume flip` z-mirror is
 * created from the pristine model (a flip command error no longer
 * yields the phantom /nextid). (3) TWO TRACKS per hand on a σ4→σ2
 * vgaussian pyramid, gated by a matrixget→matrixset round-trip probed
 * on the reference: 局部细化 = local fitmap from the incoming pose
 * (same-pipeline maps start near-aligned) coarse→fine; 全局搜索 =
 * `fitmap … search 30` random placements at σ4 — ARBITRARY rotations
 * (90°/any tilt), the pose space the fixed pre-turns could never
 * reach — transferred to σ2 and refined. The better track (by σ2
 * correlation, both poses captured via matrixget) is applied to the
 * FULL-RESOLUTION map via matrixset, polished with one full-res local
 * fit and scored with a full-res `measure correlation` (the row's
 * `post` — the honest ranking number for both hands; the search is
 * skipped when the local track already reached 0.85). (4) SAFETY: exec
 * never throws (one timeout can't kill the run; the global search gets
 * 300 s and disables itself for the run on failure), and after every
 * hand the relay's /volumes is swept so a stray fitmap-search copy can
 * never leak into the screenshots. (5) DEGRADATIONS, each ≥ the old
 * static ladder: no fitting command → static scoring with a loud log
 * naming every probe error; no search → local-only; no matrix
 * round-trip → no clones, full-res local-only; no vgaussian → full-res
 * ladder with bookkeeping; official REST → full-res ladder.
 * v3.67 bump reason (round-26 “fit 命令执行了，但有的 map 对齐成功有的
 * 没有，可能是噪音太大，能否屏蔽掉噪音再对齐”): the pose search now
 * MASKS THE NOISE and speaks the REAL command spellings (verified
 * against the official volume/fitmap/measure docs). (1) v3.64–66's
 * `vgaussian #id sigma N` is NOT a documented ChimeraX command — the
 * real one is `volume gaussian <spec> sDev σ` (σ in Å; `vop gaussian`
 * on legacy builds), so on the real machine every smoothing call
 * errored and the whole σ-pyramid silently degraded to FULL-RESOLUTION
 * fits: the noise-dominated regime where only the already-near-aligned
 * maps converged. The smoother is now runtime-probed (like the v3.66
 * fit probe) and σ is in Å (8 Å coarse / 3 Å fine). (2) NOISE MASKING:
 * `volume threshold #ref minimum <max·0.125> set 0` clones of the
 * reference at every scale (σ-coarse / σ-fine / full-res) — fitmap
 * samples the reference at ALL grid points regardless of its display
 * threshold, so the un-masked far-field solvent noise used to reward
 * wrong poses and inflate scores; the masked targets are the signal
 * envelope only. (3) fitmap now runs `metric correlation envelope
 * true` — the map-in-map default metric is OVERLAP and envelope
 * defaults to FALSE for maps not shown as isosurfaces (every v3.66 fit
 * scored ALL NONZERO points of the noisy moving map); the keywords
 * ride the runtime probe and degrade cleanly to the bare command. (4)
 * the full-resolution polish + the ranking score `post` run against
 * the MASKED full-res reference (v3.66 polished against the RAW
 * reference — the local full-res fit that could walk a noisy map off
 * the basin the pyramid had found — and ranked the two hands by
 * whole-box noise). Old pages keep the mis-spelled smoother and the
 * un-masked, overlap-based, all-points fits.
 *
 * v3.68 bump reason (round-27 “能设置成如果 correlation 没有达到指定
 * 目标，则增加搜索轮次吗？”): TARGET-DRIVEN ADAPTIVE SEARCH ROUNDS. The
 * global search no longer runs exactly once at a fixed `search 30` —
 * CORR_TARGET (default 0.85, RenderMapsOptions.corrTarget) is now BOTH
 * the round-1 skip threshold (a local track already at the target skips
 * the random search; v3.67 skipped at 0.80, letting 0.80–0.85 maps
 * through unsearched) AND the escalation trigger: while the best
 * fine-scale correlation (local track vs. best search round) stays
 * below the target, MORE global-search rounds run — each a FRESH
 * random-placement sample with an ESCALATING count (30 → 60 → 90 … =
 * SEARCH_PLACEMENTS × round), capped at SEARCH_MAX_ROUNDS (3,
 * RenderMapsOptions.searchMaxRounds) per hand; the best round's pose
 * (by σ-fine masked correlation) is the one transferred to the
 * full-resolution map, so a map that reaches the target in round 1
 * pays exactly the v3.67 price while a hard map gets up to 180
 * placements. The per-search /exec timeout SCALES with the placement
 * count (300 s → 450 s → 600 s, capped 10 min) so a bigger round can
 * never be killed by the round-1 timeout. The run log announces the
 * active target + escalation schedule up front, every appended round
 * logs WHY it ran and what it found, the winning hand's 轨迹 label
 * carries its round count (全局搜索×N轮), and a post-ladder line
 * explains a full-resolution score below target (lowpass already at
 * target = full-res noise/resolution difference, more rounds cannot
 * help; lowpass below target too = rounds exhausted, the map is
 * genuinely hard against this reference). Old pages keep the single
 * fixed 30-placement search.
 * v3.69 bump reason (round-28 “继续优化align的方法，既要保证效率又要
 * 保证效果，避免重复的无用的对比工作，比如correlation达到一定数值
 * 就可以跳过某些之前必须要做的对比工作”): TARGET-GATED EARLY EXITS —
 * the same CORR_TARGET number that v3.68 uses to ESCALATE the search
 * now also CUTS work the correlation says is unnecessary, so a map
 * that aligns easily pays the minimum price while a hard map keeps
 * the full v3.68 escalation: (1) 静止达标 — a hand whose INCOMING
 * pose already measures ≥ target on its working pair (masked cosine,
 * the same number every later decision reads) skips the local fit AND
 * the search entirely; the pose is captured as-is for the full-res
 * transfer + polish (fitting cannot improve a pose the metric already
 * endorses); (2) 镜像跳过 — an original hand that VALIDATED a pose
 * (lowpass OR full-res correlation ≥ target) skips the flip_z hand's
 * ENTIRE ladder (its smoothing, both tracks, up to N search rounds and
 * its polish — the expensive half of the per-map work): a pose at the
 * target cannot be beaten by a wrong-handed mirror, so the comparison
 * was pure waste; chirality then reads 一致, justified because a
 * wrong-handed map cannot reach the masked target against the
 * reference. The flip copy is still CREATED upfront (flipping a
 * FITTED model bakes its pose — the v3.63 disease) and is closed by
 * the loser-close loop as usual. Every skip logs WHY (which number
 * reached the target) and the per-map run log carries the 静止达标 /
 * 跳过镜像手性对比 verdicts, so a pasted log remains
 * self-diagnosing. Old pages keep paying the full double-hand price
 * for every map.
 * v3.70 bump reason (round-29 “目前是先将所有的map下载到一个指定目录中
 * 吗？如果目录中已有所需map就跳过下载，这个功能实现了吗？没有看到
 * UI中输入下载路径的窗口啊”): the download-once cache (v3.65, relay
 * POST /fetch into a PERSISTENT local dir, existing files skip the
 * download) existed but its directory was FIXED to
 * <system-temp>/cryoflow_map_cache with NO way to choose one — the
 * panel only DISPLAYED it. (1) the relay gained POST /cachedir
 * {"dir": <absolute path>}: it creates the dir when missing, probes
 * writability, and only then commits the switch — every later /fetch
 * download, /stage upload and /staged lookup uses the NEW dir; on any
 * failure the old dir stays and the error rides back (files already
 * cached in the old dir are NOT moved; the reply names the previous
 * dir so the UI can say so). /ping gained "cachedir_set": true so old
 * relays are detected. (2) the 桥接面板 now has a 下载目录 INPUT +
 * 应用 button right under the displayed dir — Enter applies too, the
 * prefill follows the live relay dir, success/failure shows inline,
 * and relays without /cachedir keep the input disabled with an
 * upgrade hint. (3) the choice is remembered in localStorage and
 * RE-APPLIED AUTOMATICALLY at the start of every ChimeraX run — a
 * ChimeraX restart resets the relay to the default system-temp dir,
 * the run log announces the restore. Old pages keep the read-only dir
 * display; old relays keep the fixed dir.
 */
export const FLOW_ENGINE_VERSION = "3.70";
