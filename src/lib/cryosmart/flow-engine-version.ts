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
 *
 * v3.71 bump reason (round-30 "可以增加用EMalign先确定reference的手性
 * 是否正确吗？或者手动指定reference的手性是否正确"): REFERENCE-HAND
 * POLICY. The v3.66–70 two-hand ladder only ever judged hands RELATIVE
 * to the reference — a reference that is itself mirrored (e.g. a
 * wrong-hand ab-initio initial model poisoned the whole project)
 * aligned every map consistently into a MIRRORED figure, and nothing
 * in the pipeline could tell. The ChimeraX panel gained a 参考手性
 * selector with three policies, applied BEFORE the view scoring, the σ
 * pyramid, the noise masks and every per-map fit: (1) 自动 (default —
 * pre-3.71 behavior, relative chirality only); (2) EMalign 参照物验证
 * — a KNOWN-HAND anchor (PDB/mmCIF model or an already-published map;
 * path/URL the ChimeraX machine can open — bridgeOpenModel grew an
 * "auto" open kind: any-suffix http URLs and suffix-sniffed local
 * files instead of the forced `format mrc`) is fitted into the
 * reference AND its z-flip with a verification-LOCAL fit probe
 * (deliberately separate from the run-scoped fitShape — an ATOMIC
 * anchor may reject `metric correlation envelope true`, and that
 * rejection must not degrade the main ladder's map-map fits); the
 * better score (fitmap's correlation for map anchors / Average map
 * value for atomic ones, parseAvgMapValue, `measure correlation` as
 * the last resort — comparable across the two hands since a z-flip
 * preserves the value distribution) IS the reference's true hand, and
 * a mirrored verdict (margin HAND_VERIFY_MARGIN 0.05) swaps the
 * canonical reference to the flipped copy so the WHOLE figure — view,
 * pyramid, masks, fits, screenshots — stands on the biologically
 * correct hand; (3) 手动 — the user asserts the hand (correct =
 * as-is; mirrored = flip once up front). Once grounded, every per-map
 * verdict gains its biological meaning (matched without flip ⇒ the
 * raw map's hand is correct; needed flip_z ⇒ it was mirrored — logged
 * per map), and the render report's reference row carries the verdict
 * (e.g. "reference · EMalign 验证镜像 · 已翻正（0.31 vs 0.94）"). The
 * anchor and the unused mirror close BEFORE the view-scoring
 * thumbnails (a leftover anchor would contaminate the coverage
 * scores), stray fitmap copies are swept like the per-map hands, the
 * choice sticks in localStorage, and every failure path (anchor
 * unreachable / fit commands missing / scores unparseable / flip
 * failed) degrades to the auto behavior with a loud log. Old pages
 * keep the un-groundable relative-only chirality.
 *
 * v3.72 bump reason (round-31 "优化一下整体的UI界面，给参考pdb的部分
 * 可以直接拖动pdb进去。增加输入一个交付文件路径，可以下载没有sharp的map，
 * sharp过的map，两个half-map，FSC图，guinier plot图，角度分布图，Fsc.xml
 * 文件。如果最终job是deepemhancer的话就是下载deepemhancer上游的refine
 * job中的这些文件。所有的map都要是纠正过手性的，如果路径是
 * D:\Lijing\Tigr\Tigr\data，则文件名Tigr.volume.map_unsharp…"): DELIVERY
 * FILES + PDB DRAG-DROP + panel polish. (1) 交付文件下载 — the relay
 * gained POST /deliver ({src,dst} local copy | {url,dst} download |
 * {data_base64,dst} embedded bytes | {stat} probe; atomic .part+rename,
 * dir auto-created, Windows-illegal basename chars stripped) and the
 * card a 交付目录+前缀 input pair (remembered in localStorage; the
 * prefix auto-derives from the dir — D:\Lijing\Tigr\Tigr\data →
 * "Tigr" — and stays editable): after every ChimeraX run the delivery
 * phase writes the final result set into that dir —
 * {base}.volume.map_unsharp/_sharp/_half_A/_half_B, fsc.png,
 * guinier_plot.png, orientation_distribution.png, fsc.xml from the
 * FINAL job, or when the final job is DeepEMhancer/sharpen from its
 * UPSTREAM refine job (BFS past post-process parents to the nearest
 * map-bearing refinement) plus the DeepEMhancer output map itself as
 * {base}.volume.map-DeepEMhancer. CHIRALITY: every delivered map is
 * corrected — the render result's new structured referenceHand
 * verdict drives it (a reference that was verified/asserted MIRRORED
 * and flipped means the raw maps are mirrored, so each map is opened
 * in ChimeraX, `volume flip`-ed and saved as MRC straight into the
 * delivery dir — deliverFlippedMap, stat-verified; an unflipped
 * reference delivers byte-identical cache copies via /deliver {src}).
 * Maps ride the SAME cache ladder as the figure (本地缓存 → /fetch
 * 直连 → /fetch 经代理 → 页面中转 /stage — repeated runs download
 * nothing); plots/xml go {url,dst} or embedded bytes (captured fsc.xml
 * text needs no network); every file's outcome lands in the result
 * panel's 交付文件 report; per-file failures log and continue (the
 * PPTX is already in the user's hands before the phase starts). (2)
 * 参照物拖拽 — the 参考手性 panel is a drop target: a dragged
 * .pdb/.ent/.cif/.mmcif/.mrc/.map file uploads to the ChimeraX machine
 * via relay /stage under a canonical name (re-drops hit the cache),
 * its LOCAL path fills the 参照物 input and the policy switches to
 * EMalign 参照物验证 (stagedMapFilename grew an `ext` param so pdb/cif
 * uploads keep their suffix for ChimeraX's sniffer). (3) Panel polish
 * — the three mode buttons gained icon tiles, the how-it-works wall of
 * text became a scannable 版式/下载/对齐/手性/交付 list, and the
 * bridge panel's sections (下载目录 / 参考手性 / 交付文件) share one
 * visual frame. Old pages keep the v3.71 behavior (no delivery, no
 * drag-drop, no /deliver detection).
 *
 * v3.73 bump reason (round-32 “简化和标准模式下的pptx报告也要参考极简的pptx
 * 进行优化，中间步骤只展示分类结果，non-uniform或local refinement或import
 * volume等都省略掉。也需要框出哪些类是下一步用到的。整个项目的UI界面重新
 * 整体打磨一下…之前的打包下载部分的导出pptx部分的功能可以移除掉”):
 * (1) workflow-figure dropNonClassificationMiddles — the 标准/简化 merge
 * assembly now curates its MIDDLE rows from CLASSIFICATION jobs only
 * (the 极简 rule since v3.63): import_* members strip everywhere
 * (pure data inputs), a middle row survives only when EVERY item is
 * hetero_refine / homo_abinit / class_3D, Non-uniform / Local
 * refinement / homo refinement / post-processing middles drop with a
 * named warning, and model.omissions is computed for 标准/简化 too
 * (mainline = [2D montage?] + spine, imports included so their drops
 * get named) — BuildModelOptions.classificationMiddles defaults true,
 * manual catalogs/generate pass false (勾选 is the user's own trim).
 * (2) workflow-pptx — the flow-anchor selection frame (the class
 * feeding the next stage, centre-swapped onto the spine) now renders
 * in EVERY style, not just 极简; 标准/简化 gaps carry the
 * “omitted: N×” note (widened 0.3in band, note above the arrow); a
 * framed row's incoming arrow keeps the 0.07in standoff so the tip
 * stops at the frame edge. (3) bundle/download-card/help-card — the
 * legacy picture-flow PPTX export is REMOVED (includePptx option,
 * buildPictureFlowPptx, collectPptImages, the 4 desktop helpers
 * CryoSmart_auto_align_export_ppt.py / align_maps_check_view /
 * export_current_view_ppt + rebuild_picture_flow_pptx.mjs —
 * report-pptx.ts and the helper files deleted; the relay bridge
 * script stays the only downloadable). (4) flow-figure-card UI — the
 * bridge panel rebuilt as status bar + tile grid (地图本地目录 |
 * 参考手性 with the PDB drag zone, 交付文件 full-width), port info and
 * 工作原理 fold into <details>, mode hints/banners document the new
 * curation. Old pages keep the v3.72 behavior (full middles in
 * 标准/简化, no frames there, pptx still in the bundle).
 *
 * v3.74 bump reason (round-33 full code review + E2E): ten review fixes
 * across the v3.70–73 features, no behavior change on the happy path —
 * (1) CRITICAL: bridgeDeliverFile mapped the embedded-xml field to the
 * relay's contract key at the wire boundary (`dataBase64` →
 * `data_base64`) — the raw camelCase key never matched the relay's
 * payload.get("data_base64") and EVERY captured-fsc.xml delivery failed
 * with “缺少 src/url/data_base64 之一”; the relay now accepts both keys
 * (old bundles keep working). (2) ReferenceHandVerdict.flipFailed — the
 * manual-mirrored policy whose in-figure flip THREW used to render
 * against the still-mirrored reference AND deliver the raw (mirrored)
 * maps uncorrected (`flipped === true` could not express
 * known-mirrored-but-not-corrected); the delivery now z-flips every map
 * for that verdict too, the per-map 生物学手性 log line no longer claims
 * “已自动翻正展示”, and the verdict reads “翻正失败（交付时仍将翻正）”.
 * (3) The three `volume flip … modelId N` call sites trust the explicit
 * modelId instead of re-parsing the log (which could grab the SOURCE
 * map's id — the same hardening gaussianSmooth got in v3.67).
 * (4) The delivery reuses the FIGURE's already-downloaded local map
 * files when the URL matches (the final refine map doubles as the
 * alignment reference and map_unsharp) — no second 100–300 MB download,
 * no duplicate cache entry. (5) ensureCached's same-origin fallback now
 * checks res.ok — a 404/500 HTML error page used to be staged as the
 * "map" and silently delivered corrupt. (6) generate gained a
 * synchronous double-click guard (the busy state only landed after the
 * awaited freshness check; two rapid clicks started two full runs).
 * (7) The anchor drop zone caps dropped files at 400 MB (relay /stage's
 * own limit) and refuses concurrent drops; an empty 参照物 under the
 * EMalign policy now logs its auto degradation before the run.
 * (8) localStorage restore/persist race — both persist effects (ref-hand
 * + delivery) skip their first run (the initial empty state used to be
 * written over the stored value in the restore commit). (9) The
 * delivery filename prefix auto-fill reacts only to DIR changes now
 * (clearing the input to retype no longer bounces back). (10) The
 * render-report table scrolls (overflow-x-auto) instead of clipping on
 * narrow screens.
 *
 * v3.75 bump reason (round-34 “按照class0,1,2从左到右顺序排列 · 保证所有
 * 模式的颗粒数都要显示 · 极简选6行但输出只有一个分类job的图 · 框不要比
 * 图大太多 · 箭头和文字避免重叠”): the P222_J863 decks drove five layout
 * overhauls — (1) STRICT CLASS ORDER: the v3.62 anchor centre-swap is
 * removed; class thumbnails render in natural 0,1,2… order (strip
 * centred on the spine), the flow-anchor frame lands on whichever class
 * feeds the next stage. (2) COUNTS EVERYWHERE: the 简化 funnel pass
 * (which hid every count line downstream of a re-extraction — P222's
 * round-2 repick 172,802→1,593,094 suppressed ALL later counts, leaving
 * bare percentages) is deleted; 极简 rows now carry per-class stats under
 * each thumbnail like the other styles, and single-map rows put their
 * stats UNDER the image (centred on the spine) instead of hanging right.
 * (3) RICHER 极简: the 简化 shrink passes no longer run under 极简 (they
 * starved P222's pool to a 2-row deck on a 6-row budget), the curated
 * mainline prefers the LONGER of the two parent walks (the curated walk
 * can die at a repick boundary), and curateMinimalFlow forward-fills
 * classification rows upstream of the first row once the backward fill
 * leaves budget. (4) TIGHT FRAMES: every embedded PNG is alpha-trimmed
 * to its content bbox (png-trim.ts — the 1600×800 ChimeraX renders are
 * ~50 % transparent margin) and the anchor frame hugs the PLACED image
 * box, so the selection box is never materially bigger than the map.
 * (5) SPACING: per-class stats sit 0.09 in below the image (clear of
 * the frame's 0.04 overhang — the frame edge used to sit on the first
 * stats line), stage labels end 0.11 in left of the spine, and a long
 * footnote wraps to a second line instead of running off the canvas.
 * Old pages keep the v3.74 behaviour (swapped classes, count-less 简化
 * rows, sparse 极简 decks, loose frames) — refresh to pick this up.
 *
 * v3.76 bump reason (round-36 “完全重新设计UI界面，用横向标签显示每个模块…
 * 文件缺少mrc后缀，xml格式的fsc曲线文件缺失，图片格式的fsc曲线比例和原图
 * 不一样…宽度很窄”): (1) HORIZONTAL TAB SHELL — the seven stacked cards
 * became six sticky horizontal tabs (数据 / 追踪 / 预览 / 流程图 / 下载 /
 * 帮助), every TabsContent forceMount-ed + hidden so a tab switch NEVER
 * unmounts a module (bridge probe, delivery settings, logs, thumbnails
 * all survive); all legacy anchor jumps (header nav, hero buttons,
 * keyboard shortcuts, post-trace / post-restore / imported-capture
 * auto-jumps) route through the new module-nav bus (navigateToModule —
 * switch tab first, then scroll), and the URL hash mirrors the active
 * tab (#module-flow, restored on reload). (2) DELIVERY .mrc SUFFIX —
 * every delivered map is now {base}.volume.map_unsharp.mrc / _sharp.mrc /
 * _half_A.mrc / _half_B.mrc / map-DeepEMhancer.mrc (matches the ZIP
 * bundle naming; ChimeraX's flipped save writes the same bytes). (3)
 * fsc.xml NEVER SILENTLY MISSING — the embedded xml bytes became a
 * LADDER (direct data_base64 write → /stage the bytes + {src} copy on
 * relays since v3.47 → the captured http url / constructed
 * volume.fsc.xml rungs). (4) FSC PNG SHAPE — plot files are fetched
 * page-side and SHAPE-CHECKED before delivery (FSC must be ≥360 px wide
 * and landscape ≥1.05 w/h — the squeezed-narrow thumbnail that used to
 * land in the 交付目录 is skipped for the next rung), the captured-image
 * ladder is RANKED (main "FSC" curve outranks "FSC between half maps"
 * variants), and when no image rung passes the FSC is re-drawn from the
 * captured fsc.xml at the original plot's 4:3 landscape ratio (a
 * decodable-but-suspicious candidate still delivers as the last resort —
 * an off-ratio plot beats a missing file).
 *
 * v3.77 bump reason (round-37 “map的角度可能需要择优后再截图，尤其是膜蛋白，
 * level不能太高，要不看到都是去垢剂，看不到内部的helix细节了，并且最好是
 * 能把去垢剂的盘子放在xy轴平面上，并且包内区朝下，包外区朝上”): the
 * membrane-protein screenshot view. (1) 膜视图 — the relay gains GET
 * /membrane: a density-weighted PCA over the reference's above-threshold
 * voxels, computed INSIDE ChimeraX on the open model (numpy on
 * full_matrix — the page never ships map bytes). The protein+detergent
 * micelle particle is an oblate blob, so the smallest-variance principal
 * axis IS the membrane normal; the engine builds the camera basis
 * (view matrix camera, rows = in-plane × in-plane × normal) and looks
 * straight down it — the detergent disk lies flat in the screen XY
 * plane and, viewed top-down, the belt is a RING around the protein so
 * the internal helices stay visible (a side view puts the micelle slab
 * over them). The default up-facing side is deterministic (the normal's
 * reference-frame Z component is forced ≥ 0); 「上下翻转 180°」 views
 * the other face (which side is 包内/包外 cannot be derived from density
 * alone). Guards: λmin/λmid ≥ 0.75 (globular/fibrous) keeps the coverage
 * view; an old relay without /membrane, an endpoint error, or a
 * `view matrix camera` failure all fall back to the 90° coverage ladder
 * with a loud log. (2) 截图 level — /volstats gains the OTSU threshold
 * (the DOMINANT class split: solvent/signal on a normal masked map,
 * protein/detergent-belt when the micelle is the hottest feature) plus
 * the NEAR-ZERO voxel fraction (masked-vs-raw discriminator); the
 * screenshot display level becomes 0.85×otsu for masked postprocessed
 * maps (biased low so the protein stays inside the contour) and
 * mean+2.5σ for unmasked raw ones, clamped to [0.04, 0.35]×max (自适应,
 * default), with 经典 0.25×max and 手动倍数 as alternatives. On
 * membrane-protein maps the micelle density is often the strongest
 * feature, so the fixed 0.25×max wrapped only the detergent disk and
 * hid the protein — the envelope-based level keeps the helix detail
 * inside the ring. FIT levels stay 0.25×max (the tuned alignment
 * behavior is untouched); only the visible contour is re-set right
 * before each screenshot.
 *
 * v3.78 bump reason (round-38 “之前说错了，应该是去垢剂盘放在xz平面”):
 * the v3.77 membrane view aimed the camera straight DOWN the membrane
 * normal (disk flat in the screen XY plane — a top-down view). The
 * corrected orientation is the classic SIDE view: the camera basis is
 * rebuilt with the membrane normal on screen UP (camera row Y) and the
 * disk's longest in-plane principal axis (λmax, ea) on screen RIGHT
 * (row X; toward-viewer row Z = X × Y, renormalized — right-handed), so
 * the detergent disk surface stands in the screen XZ plane: the belt
 * renders as a horizontal band, the transmembrane helices cross it
 * vertically, 包内区朝下 / 包外区朝上. Which of ±normal is the
 * extracellular side is not derivable from density: the default sign
 * is deterministic (the normal's first significant component in
 * map-frame Y/Z/X order is forced ≥ 0 — same map, same side up), and
 * 「上下翻转 180°」 now rolls the view 180° about the screen horizontal
 * axis (rows [ea; −n; −ea×n]) so the OTHER membrane side points up
 * (the protein's other face shows — a rolled-over disk; the toggle's
 * meaning changed from “see the other face” to “put the other side
 * up”). The oblateness gate (λmin/λmid < 0.75), the /membrane endpoint
 * (orientation-agnostic — NO relay reload needed), the adaptive
 * contour level and every fallback (old relay / endpoint error /
 * non-oblate / view-matrix failure → 90° coverage ladder) are
 * unchanged; the UI tile, help card and relay comments now describe
 * the side view.
 *
 * v3.79 bump reason (round-39 “这个fsc图还是不对啊，反而变得更错了。map的
 * 朝向还是不对，并且level的选择还是不正常，目前是如何识别的？用最大的
 * 25%会不会更好？” — the delivered P283_J55 files): THREE root causes
 * found and fixed.
 * (1) 膜视图从未生效 — the v3.78 camera rode `view matrix camera` with
 * only NINE numbers, but ChimeraX REQUIRES 12 (3×3 rotation +
 * translation, per the view docs): every real ChimeraX rejected the
 * command and the run silently fell back to the coverage view, which
 * for an oblate particle picks the TOP-DOWN orientation (largest
 * silhouette) — exactly the delivered renders. The E2E mock's /exec
 * accepted anything, so the bug passed. Fix: the SAME target rotation
 * is now composed as ONE `turn <axis> <angle>` (screen-frame axis,
 * center-of-rotation pivot — no camera position needed), computed
 * after reading the base camera rotation from a bare `view matrix`
 * report (identity assumed when unparsable), so it works from any
 * base view. The base-camera parse reads the 12-number ROW-MAJOR 3×4
 * [rotation | translation] report correctly (rotation at indices
 * 0-2/4-6/8-10, translation interleaved at 3/7/11 — the first cut
 * read nums[0..8] flat and folded the translation into a degenerate
 * rotation; caught by the E2E command recording) and converts
 * scene→camera with R₀ᵀ (not R₀). The E2E mock now VALIDATES
 * `view matrix camera` arity (12/16) and the turn vector form (unit
 * axis) so this class of contract bug fails loudly in E2E.
 * (2) 截图 level — the auto policy's raw-map branch was mean+2.5σ,
 * which lands INSIDE the solvent-noise band on a 90 %+ solvent grid:
 * the delivered screenshots showed a snowball of disconnected noise
 * speckles (and that noise-level threshold fed the /membrane PCA a
 * near-spherical noise blob, compounding (1)). Per the user's
 * 「最大的25%」 proposal, the relay's /volstats now computes
 * suggested_level — the threshold keeping the DENSEST 25% of the
 * molecular-envelope voxels (envelope = at/above the Otsu
 * solvent/signal split) above the surface — and the page's 自适应
 * chain is suggested_level → 0.85×otsu (masked, relay v3.77–78) →
 * 0.25×max (older relays; mean+2.5σ is GONE), clamped [0.03,
 * 0.5]×max; every map's chosen level + rule is logged. /ping gains a
 * vollevel feature flag; the E2E mock's volstats serves 0.26.
 * (3) FSC PNG — the delivered TMEM175.volume.fsc.png was a 2047×497
 * matplotlib MAP-SLICE strip (a *fsc*-named job-folder file), not an
 * FSC curve; it sailed through the v3.76 w/h ≥ 1.05 shape check. Fix:
 * when the captured fsc.xml text is aboard, the curve is RE-DRAWN from
 * the XML FIRST (our own 4:3 publication-style render — correct data,
 * correct ratio, deterministic) and the image candidates only run when
 * the XML draw fails; image candidates are additionally checked for a
 * LIGHT background (plots are white; map renders/slice strips are
 * near-black — mean luminance < 110 rejected) and the FSC ratio band
 * is tightened to [1.0, 2.5]; a DARK candidate is never delivered,
 * even as the off-ratio last resort.
 *
 * v3.80 bump reason (round-40 “二和三这两个问题还是没有解决” — the
 * orientation AND the level, both still wrong after v3.79): TWO fixes,
 * both driven by re-reading the OFFICIAL ChimeraX command docs (view +
 * turn pages) instead of trusting unverifiable rotation conventions.
 * (1) 膜视图朝向 — the v3.79 single vector `turn` rode an UNDOCUMENTED
 * rotation-direction convention that no mock could validate, and a
 * relay without /membrane still silently fell back to the top-down
 * coverage view (the exact delivered failure). Now: `view orient` gives
 * a deterministic base (scene axes = screen axes: X right, Y up, Z
 * toward the viewer — documented); the target camera is set with the
 * DOCUMENTED 12-number `view matrix camera` (row-major 3×4, the
 * rotation COLUMNS are the camera axes in scene coordinates — columns
 * [ea | n | ea×n] put the disk long axis RIGHT, the membrane normal
 * UP); and the outcome is PROBE-VERIFIED: a small thumbnail render is
 * measured (silhouette bbox aspect — the detergent disk standing in
 * the screen XZ plane reads as a wide horizontal band, aspect ≥ 1.12;
 * face-down it is ~1), with a transpose candidate (hedges the opposite
 * matrix-direction reading) and then a coarse-to-fine NAMED-axis
 * `turn x/y` grid scan + two halving refinement rounds (±-symmetric
 * grid → turn direction convention is irrelevant; needs only
 * save+fetch → works even on old relays without /membrane) as the
 * final fallback. A wrong orientation can no longer be delivered
 * silently: either the probe confirms the band, or the run logs
 * exactly why it fell back. The reference is contoured at the DISPLAY
 * level BEFORE the probes so they measure the same surface the
 * screenshots render.
 * (2) 截图 level — v3.79 had misread 「最大的25%」 as a top-25%-of-
 * ENVELOPE-VOXELS quantile (a HIGH threshold hugging the protein core
 * + detergent-belt heads — exactly the 「只看到去垢剂」 regime the
 * user rejected). Now EVERY mode resolves to the LITERAL 0.25×max
 * (auto == classic; manual clamps to [0.01, 0.9] as documented),
 * computed page-side from /volstats max — no relay update needed for
 * the level at all. The relay's suggested_level walk is removed
 * (extra keys from old relays are ignored); the level select offers
 * 0.25×max（推荐）/ 手动倍数, stored classic settings map to auto.
 *
 * v3.81 bump reason (round-41 “level取得还是不好，还是会看到胶束，
 * 截图角度还是top view，不是side view” — the delivered P283_J55 deck
 * was STILL all top views with speckle + free micelles): THREE fixes.
 * (1) 截图 level — v3.80's literal 0.25×max landed inside the noise/
 * micelle band because a map's max is a SINGLE hot spike (noise on raw
 * ab-initio volumes, detergent heads on the reference) and every
 * max-ratio rule inherits its position. The chain is now
 * SELF-CALIBRATING: the reference takes min(0.25×max, 0.85×otsu₂)
 * (otsu₂ = the SECOND Otsu over the envelope = the protein/detergent
 * split, so hot-detergent maps drop into the protein window while
 * normal maps keep the long-accepted 0.25×max), and every other map
 * picks the level whose above-level voxel COUNT matches the reference
 * at its chosen level (same particle ⇒ same envelope mass — a noisy
 * map's matched level rises above its noise floor BY CONSTRUCTION, so
 * the speckle and the free-micelle snowballs are gone whatever its max
 * was). relay /volstats gains otsu2 + env_levels/env_counts (ping
 * "vollevel2"); old relays degrade to 0.25×max with an upgrade hint.
 * (2) level 预览 — a new 「预览 level（渲染参考图）」 button renders the
 * reference in ChimeraX at a ladder of candidate levels (auto + 0.06–
 * 0.5×max) and lets the user PICK with their own eyes before the
 * multi-minute run; the pick feeds back as 自动/手动×max (class maps
 * still count-match to it). Four straight rounds rejected every blind
 * rule — the preview ends the guessing.
 * (3) 膜视图朝向 — the v3.77–80 oblateness GATE (λmin/λmid < 0.75) is
 * REMOVED: on the delivered deck the reference's envelope at the
 * too-low 0.25×max carried protein-column + noise + micelle mass, read
 * “globular”, and silently discarded the membrane view the user had
 * selected — the coverage ladder then delivered its face-down pick
 * (the exact round-41 top view). Selecting 膜蛋白视图=自动 IS the
 * membrane statement now; the ratio is logged as diagnostics. The v3.80
 * bbox “wide band” probe criterion is replaced by the silhouette's 2D
 * second-moment ANISOTROPY vs a TOP-BASELINE probe (the camera looking
 * straight down the PCA normal — guaranteed face-on): a side candidate
 * must beat the baseline by 1.06× or clear 1.15 absolute, which works
 * for column+disk particles (TMEM175's side silhouette is NOT a wide
 * band) and survives stray speckle (second moments barely move; a bbox
 * jumps). Every probe now RE-FRAMES with bare `view` (a camera swap
 * could strand the old framing and render an empty probe — the exact
 * silent verification failure v3.80 shipped). When the probes cannot
 * distinguish (near-isotropic silhouette) the DOCUMENTED camera is
 * applied anyway with an honest log line — the coverage face-down pick
 * is never silently delivered for a membrane run again.
 *
 * v3.82 bump reason (round-42 “感觉角度和level还是不对” — VLM forensics on
 * the delivered CryoSmart_P283_J55_workflow (2).pptx: ALL 11 renders are
 * OBLIQUE (none a side view), the J48 ab-initio trio are snowballs, the
 * J41 class-3 is a sponge, the reference is fuzzy with the belt + stray
 * blobs): the round-41 chain was still ALL BLIND HISTOGRAM RULES + PCA
 * TRUST. THREE root-cause fixes, all closing the loop on RENDERED PIXELS
 * (probe renders + browser-side measurement — works on EVERY relay since
 * v3.50, so no relay re-open is REQUIRED for this fix):
 * (1) 截图 level — the LEVEL KNEE: per map, a 9-rung ladder (0.05→0.9×max)
 * is RENDERED and measured (connected-component FRAGMENTATION kills
 * snowball speckle AND free micelle blobs — they are disconnected
 * components, the round-41/42 「胶束」 complaint; the main component's
 * coverage floor kills the sponge regime); the knee is the LOWEST clean
 * level. Every blind rule (max-ratio / Otsu variants / the round-41
 * count-matching, which assumed equal map scalings and delivered the
 * sponge + snowballs) is retired to a non-probe fallback; manual mode is
 * the direct expert override (ratio×max on every map).
 * (2) 膜视朝向 — the STANDING signal + the BELT-BAND PCA. The whole-
 * envelope PCA reads near-isotropic on a column+disk particle (TMEM175:
 * big soluble head + belt-heavy TM half), so its smallest-variance axis
 * — and thus the v3.77–81 camera — was arbitrary (the delivered obliques;
 * the aniso-vs-top probes could not tell, and the documented-camera-
 * direct fallback applied the wrong orientation). Now: relay /membrane2
 * (v3.82 bridge, optional) splits the histogram into THREE phases and
 * PCAs each BAND — the detergent belt is a flat torus in one band
 * whichever phase it is, and its normal IS the membrane normal
 * (synthetic check: oblateness 0.147, normal exactly on-axis while the
 * envelope reads 0.955); and every candidate is PROBE-VERIFIED by the
 * render's STANDING score (the mass-centroid vertical offset — a
 * standing membrane particle is vertically asymmetric: head at one end,
 * belt at the other; anisotropy alone maximised the long axis
 * HORIZONTAL, a lying view). When no camera candidate stands (old relay
 * / symmetric particle), a probe-only STANDING turn-grid scan finds it
 * (elevation×azimuth + halving refinement + an azimuth ROLL pass that
 * maximises the silhouette width — the disk's long axis horizontal,
 * round-38), falling back to the anisotropy criterion for oblate
 * symmetric particles, then the documented camera, then coverage.
 * (3) 逐图立正 — every class map is re-checked AT ITS OWN SCREENSHOT: a
 * map whose fitmap alignment landed off-axis (the delivered J9/J48
 * obliques) gets its OWN orientation (its belt-band camera, else its own
 * standing scan), rolled to match the reference's up-side, logged
 * honestly (the fitmap correlation stays the record of fit quality);
 * each map is also re-framed so it fills the frame.
 *
 * v3.83 bump reason (round-43 “为何目前输出的fsc图比例不正常，宽度很窄”
 * — the delivered TMEM175.volume.fsc.png was the job folder's ORIGINAL
 * near-square 361×380 server-side matplotlib render, while the user's
 * webpage download of the SAME plot is a wide 516×303): the webpage
 * renders its FSC plot CLIENT-SIDE from the fsc.xml at 516×303 (RGB, no
 * metadata, different tick sampling — an independent render, NOT a
 * resize), so no URL can fetch a correctly-proportioned png — but the
 * v3.79 re-draw, which reproduces exactly that proportion from the XML,
 * only ran when the capture had EMBEDDED the xml TEXT; this lineage's
 * refine node carried a URL-ONLY fsc_xml, so the re-draw was skipped,
 * every image candidate failed the ratio gate (361×380 → w/h 0.95 <
 * 1.0), and the “off-ratio beats missing” fallback delivered the
 * near-square original. Fixes: (1) the re-draw's XML now rides a LADDER
 * — embedded text → captured fsc_xml.url (data: or CryoSmart http) →
 * the constructed download_result_file path (the same rungs that
 * deliver the .xml file itself, so any source that served the xml can
 * now feed the png re-draw); (2) the re-draw targets the WEBPAGE's
 * landscape ratio — 1032×606 = 2×516×303 — instead of the old 4:3
 * (1200×900), and the PPT's optional FSC panel uses the same size; (3)
 * every rung's failure is logged per-source (下载失败 / 非XML内容 /
 * 解析失败 / 暂存失败 / 写入失败), and the near-square original stays
 * only as the last-resort fallback with its honest 比例异常 warning.
 */
export const FLOW_ENGINE_VERSION = "3.83";
