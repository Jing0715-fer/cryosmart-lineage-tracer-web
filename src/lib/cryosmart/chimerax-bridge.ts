/**
 * ChimeraX flow bridge — browser-side client for the one-click workflow
 * figure (v3.41).
 *
 * Transports (auto-probed, in order):
 *   1. "relay" — the in-ChimeraX bridge script (CryoSmart_flow_relay.py,
 *      opened from the web app once). Full capability: run commands, read
 *      per-model volume statistics, fetch rendered PNGs. Uses the same
 *      internal mechanism as ChimeraX's official `mcp` bridge
 *      (session.ui.thread_safe + log capture), but its CORS allow-list is
 *      locked to this web app's origin.
 *   2. "rest"  — the official ChimeraX REST server (`mcp start` /
 *      `remotecontrol rest start`). Command execution + JSON log output
 *      work, but ChimeraX only serves its own static files, so rendered
 *      PNGs cannot be fetched back over this transport (alignment +
 *      chirality diagnostics still work).
 *
 * The alignment / handedness protocol (v3.66 — see the version history
 * below for how it evolved from the desktop helper's 8-candidate
 * ladder):
 *   - runtime command probe: the first fit call discovers which fitting
 *     shape this ChimeraX runs (fitmap/inMap documented → … → fit/in)
 *     and `measure correlation` does the same (inMap → positional) — a
 *     hard-coded spelling can never silently kill the fit again
 *   - TWO HANDS per map: the pristine original + ONE `volume flip` z
 *     mirror (created before any fitting) — every rotation is reached
 *     by the global search, not by pre-turned re-opens. v3.69: the
 *     mirror hand is CONDITIONAL — when the original hand's pose is
 *     already validated (masked correlation ≥ the target, lowpass or
 *     full-res), its whole ladder is skipped: the expensive half of the
 *     per-map work, with zero quality loss (a pose at the target
 *     correlation cannot be beaten by a wrong-handed mirror)
 *   - TWO TRACKS per hand on a σ8→σ3 Å `volume gaussian` pyramid over
 *     NOISE-MASKED reference clones (v3.67: `volume threshold … set 0` —
 *     the signal envelope only): 局部细化 (local fitmap from the
 *     incoming pose, coarse→fine) and 全局搜索 (fitmap search 30 random
 *     placements at σ8, refined at σ3); fits run `metric correlation
 *     envelope true`; the winner by σ3 masked correlation is applied to
 *     the FULL-RESOLUTION map via matrixget/matrixset (round-trip probed
 *     on the reference first), polished with one full-res local fit
 *     against the MASKED full-res reference and scored with a masked
 *     full-res `measure correlation` — the honest ranking number for
 *     both hands
 *   - chirality verdict from the flip hand vs. the original hand
 *   - one-time 90° view optimisation on the reference map by thumbnail
 *     coverage scoring, applied to every map
 *   - per-map export at 1600×1200 supersample 3 on a TRANSPARENT background
 *     (v3.53; the alpha channel rides all the way into the PPTX)
 *
 * v3.48 (round-7): screenshots are saved with plain `save <png-path> width …
 * height … supersample … transparentBackground false` — ChimeraX has NO
 * `save image` subcommand (the filename suffix drives the format; `save
 * image <path>` makes `save` treat the suffix-less word "image" as the
 * filename and error out, which silently 404'd every PNG fetch on the
 * user's real build). Same shape as the proven desktop helper.
 *
 * v3.50 (round-9): the save→/file chain no longer trusts ONE path shape.
 * A clean `save` whose PNG /file then 404s (the user's round-7/9 symptom —
 * on the round-9 log the page bundle was stale and re-ran the v3.47
 * `save image` bug, but a genuine path/tokenizer divergence is equally
 * possible and was previously undiagnosable) now walks a ladder of save
 * rungs until /file actually returns bytes:
 *   abs     — `save "<workdir-sep>/<name>" …` (desktop-helper shape)
 *   abs-fwd — same but every backslash flipped to "/" (Windows Python
 *             accepts forward slashes; tokenizer-proof)
 *   cd-rel  — `cd "<workdir>"` ONCE, then `save "<name>" …` (bare relative
 *             name — nothing to mangle; ChimeraX's own `cd` resolves the
 *             workdir on ITS side, so the file must land where /file looks)
 * The winning rung is cached on the transport and reused for every later
 * save of the run. Exhausting the ladder logs the workdir + tried rungs so
 * a pasted log is self-diagnosing.
 *
 * v3.52 (round-11 “颜色依次…”): every map is colored with Chimera's own
 * default multi-model "open" palette — the request carries the color of
 * the map's class position (see chimera-colors.ts; v3.54 corrected the
 * values to the user's pasted Chimera classic 16-bit list — grey / pale
 * yellow / pale cyan / pale blue / pale magenta / pale salmon / pale
 * green / tan, cycling). A multi-class row now
 * reads exactly like the job's maps opened together in Chimera, instead
 * of v3.51's uniform gray that made classes indistinguishable.
 *
 * v3.53 (round-12 “背景透明 + 颜色没生效 + 透明感”): two REAL-machine fixes
 * verified against the official ChimeraX command docs:
 *   - TRANSPARENT BACKGROUND: `set bgColor` explicitly ignores transparency
 *     ("images can be saved with a (completely) transparent background using
 *     the save command option transparentBackground true" — set.html). Every
 *     save now passes transparentBackground true and the `set bgColor black`
 *     command is GONE, so exported PNGs carry an alpha channel exactly like
 *     the reference deck's own media (corner (0,0,0,0)) and the user's
 *     ChimeraX background is left untouched.
 *   - COLOR COMMAND: `color #<id> <hex>` targets ATOMS and silently no-ops on
 *     volume models — the user's round-12 deck came back with every map in
 *     ChimeraX's default gray despite the palette being sent. The volume
 *     command's OWN color option is used instead: `volume #<id> color <hex>`
 *     ("if one color is specified but no levels, the color applies to all
 *     existing levels and becomes the default color for the volume model"
 *     — volume.html). Surfaces stay opaque solids; the perceived
 *     translucency was gray-on-black contrast.
 *
 * v3.54 (round-13): the palette values themselves are corrected in
 * chimera-colors.ts — the request still carries a #rrggbb hex applied via
 * `volume #<id> color`, but class 2 is now PALE CYAN #b2ffff (the user's
 * 16-bit "#b333ffffffff" was mis-read as violet #b333ff in v3.52/53) and
 * classes 4-7 are pale magenta / pale salmon / pale green / tan per the
 * user's pasted Chimera classic 16-bit list, cycling past class 7. The
 * transport / alignment / save pipeline here is unchanged.
 *
 * v3.55 (round-14 “开始截图之前要先关闭掉过去已打开的 map”): renderFigureMaps
 * now (0) closes every ALREADY-OPEN volume model before the reference map
 * loads — precisely via the relay's new GET /volumes (volume models only),
 * falling back to `close all` on relays that predate the endpoint — and
 * (5) closes every model the run itself opened once the screenshots are
 * exported. Previous runs used to leave their aligned models open, and the
 * screenshot loop's hide-all step only covered the CURRENT run's ids, so
 * the last run's maps swept into every screenshot.
 *
 * v3.56 (round-15 “已有 map 直接从本地打开，不重复下载”): the relay's
 * staging dir is now a PERSISTENT map cache at a fixed system-temp path —
 * it survives ChimeraX restarts and relay re-opens. The card checks it per
 * map (stagedMapFilename + bridgeStagedLookup) BEFORE any download ladder
 * rung; a hit yields a LOCAL path ChimeraX opens directly (zero network).
 * The bridge transports advertise it via ping's `cache` flag (canCache).
 *
 * v3.65 (round-24 “增加设置一个本地目录先下载map，再让chimera从指定目录
 * 中打开map进行对齐截图，如果目录中已有所需文件就跳过下载”): the
 * acquisition ladder INVERTED — the relay ITSELF (the ChimeraX machine's
 * own Python, no ChimeraX command involved) downloads each still-uncached
 * map URL ONCE into the persistent cache dir (POST /fetch; a file already
 * in the dir skips the download outright) and hands ChimeraX the LOCAL
 * path, so this module's candidate opens read DISK, never network —
 * regardless of ChimeraX's own web-fetcher quirks (v3.64's converge-via-
 * ChimeraX-save still re-downloaded whenever a save rung failed
 * silently). Transports advertise it via ping's `fetch` flag
 * (canFetchMaps); relays without it keep the v3.56–63 URL-direct ladder.
 *
 * v3.66 (round-25 “map的对齐还是存在问题，需要继续优化对齐的算法”): the
 * pose search was REBUILT around the real ChimeraX fitting command. The
 * v3.56–65 ladder sent `fit #v in #ref [search 15]` — `fit` is NOT a
 * stock ChimeraX command (`fitmap #v inMap #ref [search N]` is), so on
 * every real machine both fit calls errored “unknown command”, the
 * soft flag swallowed the error, and `score = fit2 ?? fit1 ?? pre`
 * silently degraded to the STATIC pose correlation — the alignment
 * NEVER moved a map; only the 8 fixed pre-rotations ever changed a pose
 * (exactly the maps that looked right) while anything needing real
 * optimisation stayed mis-aligned. The new engine:
 *   - RUNTIME COMMAND PROBE: the first fit call walks
 *     fitmap/inMap (documented) → fitmap/in → fit/inMap → fit/in and
 *     remembers + logs the first shape this ChimeraX actually runs; no
 *     hard-coded spelling can break the deck again. `measure correlation`
 *     gets the same treatment (inMap primary — the form that has parsed
 *     on the real machine since v3.56 — positional fallback).
 *   - TWO HANDS instead of 8 pre-turned candidates: the pristine map +
 *     ONE `volume flip` z-mirror (created before any fitting). Every
 *     rotation — 90°, arbitrary tilts, anything — is reached by the
 *     global search instead of by whichever 180° turns happened to be
 *     in the fixed candidate list.
 *   - TWO TRACKS per hand on a σ4→σ2 vgaussian pyramid (matrix transfer
 *     matrixget/matrixset round-trip probed on the reference first):
 *     局部细化 = local fitmap from the incoming pose (same-pipeline
 *     maps start near-aligned — the likeliest basin), coarse→fine;
 *     全局搜索 = `fitmap … search 30` random placements at σ4
 *     (arbitrary rotations), transferred to σ2 and refined. The better
 *     track by σ2 correlation is applied to the FULL-RESOLUTION map,
 *     polished with one full-res local fit and scored with a full-res
 *     `measure correlation` (the row's `post` — the honest ranking
 *     number for both hands).
 *   - SAFETY: after every hand the relay's /volumes is swept so a
 *     fitmap-search stray copy can never leak into the screenshots
 *     (round-14 disease); a search timeout/hiccup disables the search
 *     for the rest of the run instead of stalling every hand.
 *   - DEGRADATIONS (each still ≥ the v3.65 static ladder): no fitmap →
 *     static scoring with a loud log; no search → local-only; no matrix
 *     round-trip → no clones, full-res ladder local-only; no vgaussian →
 *     full-res ladder with bookkeeping; official REST → full-res ladder.
 *
 * v3.67 (round-26 “fit 命令执行了，但有的 map 对齐成功有的没有 — 可能噪音
 * 太大，能否屏蔽掉噪音再对齐？”): NOISE-MASKED fitting with correctly-
 * spelled commands, verified against the official ChimeraX docs
 * (volume.html / fitmap.html / measure.html):
 *   - SMOOTHING SPELLING BUG (the silent killer): v3.64–66 sent
 *     `vgaussian #id sigma N` — NOT a documented ChimeraX command. The
 *     real one is `volume gaussian <spec> sDev σ` (σ in the map's
 *     PHYSICAL units, Å; `vop gaussian` on legacy builds). On the real
 *     machine every smoothing call errored and gaussianSmooth returned
 *     null, so the ENTIRE lowpass pyramid silently degraded to
 *     FULL-RESOLUTION fits — exactly the noise-dominated regime where
 *     only the already-near-aligned maps happened to converge while
 *     everything else stalled in a noise local optimum. The smoother is
 *     now a RUNTIME-PROBED command shape (volume gaussian sDev → vop
 *     gaussian sDev → vgaussian sDev → vgaussian sigma — same pattern
 *     as the v3.66 fit probe), σ is in Å (8 Å coarse / 3 Å fine — no
 *     voxel-size dependence), and a build with no smoothing at all now
 *     STILL gets masked full-resolution fits (below).
 *   - NOISE MASKING (the user's request): `volume threshold #ref
 *     minimum <max·0.125> set 0` clones of the reference at EVERY scale
 *     (σ-coarse, σ-fine, full-resolution) — everything below half the
 *     display contour level is zeroed, so the fit targets are the
 *     reference's SIGNAL ENVELOPE only. fitmap samples the reference at
 *     ALL grid points “regardless of what step level and threshold are
 *     used to display the ref-model” (fitmap docs) — the un-masked
 *     far-field solvent noise is precisely what used to reward wrong
 *     poses and inflate scores on noisy maps.
 *   - fitmap now runs `metric correlation envelope true` explicitly: the
 *     map-in-map default metric is OVERLAP (a scale-carrying inner
 *     product), and envelope defaults to FALSE when the fit map has not
 *     been shown as an isosurface — i.e. every v3.66 fit scored ALL
 *     NONZERO points of the (noisy) moving map. envelope true samples
 *     only the moving map's above-contour points (their level is set
 *     explicitly), and correlation (cosine) makes the objective
 *     scale-free. The keywords ride the same runtime probe as the
 *     command shape (dropped cleanly on a build that rejects them).
 *   - the FULL-RESOLUTION polish + the ranking score `post` now run
 *     against the MASKED full-res reference — v3.66 polished and scored
 *     against the RAW reference, so the local full-res fit could walk a
 *     noisy map off the basin the pyramid had just found, and the
 *     whole-box correlation ranked the two hands partly by noise.
 *     `measure correlation` already samples envelope-true (the first
 *     map's above-level points) — against the masked reference its
 *     number is a pure signal-agreement score, for honest hand ranking.
 *
 * v3.68 (round-27 “能设置成如果 correlation 没有达到指定目标，则增加
 * 搜索轮次吗？”): TARGET-DRIVEN ADAPTIVE SEARCH ROUNDS — the global
 *   search escalates until the correlation target is met:
 *   - CORR_TARGET (default 0.85, overridable per run via
 *     RenderMapsOptions.corrTarget) is now BOTH the round-1 skip
 *     threshold (a local track already at the target needs no random
 *     search — v3.67 skipped at 0.80, letting 0.80–0.85 maps through
 *     unsearched) AND the ESCALATION TRIGGER: while the best fine-scale
 *     correlation (local track vs. best search round so far) stays
 *     below the target, MORE global-search rounds run — each round a
 *     FRESH random-placement sample of pose space with an ESCALATING
 *     count (SEARCH_PLACEMENTS × round = 30 → 60 → 90 …), capped at
 *     SEARCH_MAX_ROUNDS (3, RenderMapsOptions.searchMaxRounds) per
 *     hand. The best round's pose (by σ-fine masked correlation) is
 *     the one transferred to the full-resolution map — a map that
 *     reaches the target in round 1 pays exactly the v3.67 price.
 *   - The per-search /exec timeout SCALES with the placement count
 *     (300 s at 30 → 450 s at 60 → 600 s at 90, capped 10 min) so a
 *     bigger appended round can never be killed by the round-1
 *     timeout (the relay /exec has no server-side timeout — only this
 *     client-side abort matters).
 *   - HONEST LOGGING: the run log states the active target + the
 *     escalation schedule up front, every appended round logs WHY it
 *     ran and what it found, and a post-ladder line explains a
 *     full-resolution score that stays below target (lowpass already
 *     at target = full-res noise/resolution difference, more rounds
 *     cannot help; lowpass below target too = rounds exhausted, the
 *     map is genuinely hard against this reference).
 */

import { chimeraClassColor } from "./chimera-colors";

export type BridgeKind = "relay" | "rest";

export interface FlowTransport {
  kind: BridgeKind;
  /** Host the bridge answered on ("127.0.0.1" = the browser's machine,
   *  otherwise e.g. the CryoSmart server's hostname — ChimeraX may live
   *  on a different machine than the browser). */
  host: string;
  port: number;
  base: string;
  /** Relay only: ChimeraX-side scratch dir where PNGs get saved. */
  workdir?: string;
  /** Whether rendered PNG bytes can be fetched back. */
  canFetchFiles: boolean;
  /** v3.47: relay-only — the bridge script advertises POST /stage (write
   *  uploaded bytes into the ChimeraX-side workdir and return a local
   *  path ChimeraX can `open`). Without it, the page-relay map fallback
   *  cannot run and the user must re-open the updated relay.py once. */
  canStage?: boolean;
  /** v3.56: relay-only — the bridge script advertises the PERSISTENT map
   *  cache (GET /staged lookup at a fixed system-temp path that survives
   * ChimeraX restarts / relay re-opens). Without it the card skips the
   *  cache check and every run re-downloads its maps as before. */
  canCache?: boolean;
  /** v3.56: the bridge's persistent map-cache dir (log/diagnostics). */
  cacheDir?: string;
  /** v3.65: relay-only — the bridge script advertises POST /fetch: the
   *  relay ITSELF downloads a map URL into the persistent local cache dir
   *  (skip when the file is already there) and returns the LOCAL path, so
   *  ChimeraX opens only LOCAL files for the 8-candidate alignment +
   *  screenshots. Relays without it fall back to the legacy URL-direct
   *  ladder (with an upgrade hint in the run log). */
  canFetchMaps?: boolean;
  /** v3.70: relay-only — the bridge script advertises POST /cachedir:
   *  the persistent map-cache dir can be SWITCHED at runtime from the
   *  card's 桥接面板 下载目录 input (absolute path on the ChimeraX
   *  machine; created when missing; the switch fails cleanly when the
   *  dir is unwritable). Relays without it keep the fixed system-temp
   *  cache dir and the input shows an upgrade hint. */
  canSetCacheDir?: boolean;
  /** v3.72: relay-only — the bridge script advertises POST /deliver:
   *  delivery files (chirality-corrected maps / plots / fsc.xml) can be
   *  written into the user's 交付目录 on the ChimeraX machine (local
   *  cache copy / url download / embedded bytes, plus a stat probe the
   *  ChimeraX flip+save path verifies with). Relays without it skip the
   *  delivery phase with an upgrade hint. */
  canDeliver?: boolean;
  /** v3.77: relay-only — the bridge script advertises GET /membrane
   *  (density-weighted PCA of an open volume above a level — the
   *  membrane-normal detection that stands the detergent disk in the
   *  screen XZ plane for membrane-protein screenshots) plus the /volstats
   *  Otsu key. Relays without it fall back to the 90° coverage view with
   *  an upgrade hint. */
  canMembrane?: boolean;
  /** v3.82: relay-only — the bridge script advertises GET /membrane2 (the
   *  3-phase density split + per-band PCAs — the detergent-BELT torus is
   *  the orientation feature that survives on column+disk particles like
   *  TMEM175 where the whole-envelope PCA reads near-isotropic). Relays
   *  without it simply skip the band cameras — the probe-only standing
   *  scan still finds the side view, so THIS flag is an accelerator, not
   *  a requirement. */
  canMembrane2?: boolean;
  /** v3.50: which save rung last produced a /file-fetchable PNG — cached
   *  per transport so later saves go straight to the working shape. */
  saveMode?: SaveMode;
  /** v3.50: `cd <workdir>` already executed for this transport (the cd
   *  persists in ChimeraX's process cwd). */
  cdDone?: boolean;
}

export type SaveMode = "abs" | "abs-fwd" | "cd-rel";

export interface ProbeOptions {
  relayPorts?: number[];
  restPorts?: number[];
  /** v3.44: hosts to probe in order. ChimeraX may run on a different
   *  machine than the browser (e.g. on the CryoSmart server), and the
   *  relay binds all interfaces, so the caller passes 127.0.0.1 + the
   *  CryoSmart server host. Default: ["127.0.0.1"]. */
  hosts?: string[];
  timeoutMs?: number;
}

export const DEFAULT_RELAY_PORTS = [8927, 8928, 8929];
/** ChimeraX's official REST server (remotecontrol rest start) candidates.
 *  NOTE: 8080 is CryoSmart Web's own port — kept LAST purely as a candidate
 *  for exotic setups; the bridge never "runs on 8080 by default". */
export const DEFAULT_REST_PORTS = [8765, 8650, 8080];
export const DEFAULT_PROBE_HOSTS = ["127.0.0.1"];

export interface ProbeResult {
  transport: FlowTransport | null;
  logs: string[];
}

/* ------------------------------------------------------------------ */
/* Low-level transport                                                 */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, mode: "cors", cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe for a usable bridge: relay first (full capability), then the
 * official REST server (command-only). v3.44: every port is probed on every
 * candidate host (default 127.0.0.1; callers add the CryoSmart server host
 * for setups where ChimeraX runs on the server machine).
 */
export async function probeFlowBridge(opts: ProbeOptions = {}): Promise<ProbeResult> {
  const logs: string[] = [];
  const relayPorts = opts.relayPorts ?? DEFAULT_RELAY_PORTS;
  const restPorts = opts.restPorts ?? DEFAULT_REST_PORTS;
  const hosts = opts.hosts?.length ? [...new Set(opts.hosts)] : DEFAULT_PROBE_HOSTS;
  const timeoutMs = opts.timeoutMs ?? 4000;

  for (const host of hosts) {
    for (const port of relayPorts) {
      const base = `http://${host}:${port}`;
      try {
        const res = await fetchWithTimeout(`${base}/ping`, { method: "GET" }, timeoutMs);
        if (!res.ok) {
          logs.push(`relay ${host}:${port} → HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { ok?: boolean; workdir?: string; version?: string; stage?: boolean; cache?: boolean; cacheDir?: string; fetch?: boolean; cachedir_set?: boolean; deliver?: boolean; membrane?: boolean; membrane2?: boolean };
        if (data?.ok) {
          logs.push(
            `relay ${host}:${port} → OK (ChimeraX ${data.version ?? "?"}${data.stage ? ", /stage" : ""}${data.cache ? ", 地图缓存" : ""}${data.fetch ? ", 本地目录下载" : ""}${data.cachedir_set ? ", 可自定义目录" : ""}${data.deliver ? ", 交付下载" : ""}${data.membrane ? ", 膜法线检测" : ""}${data.membrane2 ? ", 胶束带检测" : ""})`,
          );
          return {
            transport: {
              kind: "relay",
              host,
              port,
              base,
              workdir: data.workdir,
              canFetchFiles: true,
              canStage: !!data.stage,
              canCache: !!data.cache,
              cacheDir: data.cacheDir,
              canFetchMaps: !!data.fetch,
              canSetCacheDir: !!data.cachedir_set,
              canDeliver: !!data.deliver,
              canMembrane: !!data.membrane,
              canMembrane2: !!data.membrane2,
            },
            logs,
          };
        }
        logs.push(`relay ${host}:${port} → unexpected payload`);
      } catch (err) {
        logs.push(`relay ${host}:${port} → ${err instanceof Error ? err.name : "unreachable"}`);
      }
    }
  }

  for (const host of hosts) {
    for (const port of restPorts) {
      const base = `http://${host}:${port}`;
      try {
        // The official REST server ships a static CLI page — used for liveness
        // by ChimeraX's own MCP bridge (a /run probe can fail on a busy UI).
        const res = await fetchWithTimeout(`${base}/cmdline.html`, { method: "GET" }, timeoutMs);
        if (res.ok) {
          logs.push(`rest ${host}:${port} → OK (official REST server, no file return)`);
          return { transport: { kind: "rest", host, port, base, canFetchFiles: false }, logs };
        }
        logs.push(`rest ${host}:${port} → HTTP ${res.status}`);
      } catch (err) {
        logs.push(`rest ${host}:${port} → ${err instanceof Error ? err.name : "unreachable"}`);
      }
    }
  }

  return { transport: null, logs };
}

export interface ExecResult {
  text: string;
  error: string | null;
}

/** Run one ChimeraX command and return its captured log text + error. */
export async function bridgeExec(t: FlowTransport, command: string, timeoutMs = 180_000): Promise<ExecResult> {
  if (t.kind === "relay") {
    const res = await fetchWithTimeout(
      `${t.base}/exec`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      },
      timeoutMs,
    );
    if (!res.ok) throw new Error(`relay /exec HTTP ${res.status}`);
    const data = (await res.json()) as { text?: string; error?: string | null };
    return { text: String(data.text ?? ""), error: data.error ?? null };
  }
  // Official REST server — form-encoded POST to /run.
  const body = new URLSearchParams({ command });
  const res = await fetchWithTimeout(
    `${t.base}/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`rest /run HTTP ${res.status}`);
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("json")) {
    const data = (await res.json()) as {
      "python values"?: unknown[];
      "log messages"?: Record<string, string[]>;
      error?: { type?: string; message?: string } | null;
    };
    const logMsgs: string[] = [];
    for (const list of Object.values(data["log messages"] ?? {})) {
      if (Array.isArray(list)) logMsgs.push(...list);
    }
    const pyVals = (data["python values"] ?? []).map((v) => (v == null ? "" : String(v)));
    const text = [...pyVals, ...logMsgs].join("\n");
    return { text, error: data.error ? `${data.error.type ?? "Error"}: ${data.error.message ?? ""}` : null };
  }
  return { text: await res.text(), error: null };
}

/** Relay-only: fetch a PNG ChimeraX saved into the bridge workdir. */
export async function bridgeFile(t: FlowTransport, name: string, timeoutMs = 60_000): Promise<Uint8Array> {
  if (t.kind !== "relay" || !t.workdir) throw new Error("file fetch requires the relay transport");
  const res = await fetchWithTimeout(
    `${t.base}/file?name=${encodeURIComponent(name)}`,
    { method: "GET" },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`relay /file HTTP ${res.status} (${name})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Relay-only: volume statistics (max/mean/sd) for uniform contour levels. */
export interface BridgeVolStats {
  max: number;
  mean: number;
  sd: number;
  /** v3.77: the Otsu threshold over the full grid (relay ≥ v3.77) — the
   *  DOMINANT class split (solvent/signal for a normal masked map,
   *  protein/detergent-belt when the micelle is the hottest feature). */
  otsu?: number;
  /** v3.77: the near-zero voxel fraction (|v| < 0.002·max) — high on
   *  masked postprocessed maps (solvent exactly 0), low on raw noisy
   *  ones; the 自适应 display level rides Otsu only for masked maps. */
  zeroFrac?: number;
  /** v3.79 (round-39 “用最大的25%会不会更好？”): the relay-suggested
   *  DISPLAY level — the threshold keeping the DENSEST 25% of the
   *  molecular-envelope voxels (envelope = voxels at/above the Otsu
   *  split) inside the surface. First rung of the 自适应 chain. */
  suggested?: number;
  /** v3.79: envelope voxel fraction (above-Otsu / total) — diagnostics
   *  for the run log. */
  envFrac?: number;
  /** v3.81 (round-41): the SECOND Otsu over the envelope sub-histogram
   * (values ≥ otsu) — the protein/detergent-phase split. On the delivered
   * P283 deck the literal 0.25×max sat inside the noise/micelle band (a
   * map's max is a single hot spike — noise or detergent head — so every
   * max-ratio rule inherits its position), and the v3.79
   * top-25%-of-envelope sat in the detergent-only regime; 0.85×otsu2
   * sits between the two. */
  otsu2?: number;
  /** v3.81: the envelope-count ladder (relay ≥ v3.81) — levels rising
   * from ~otsu to ~max with the above-level voxel count at each rung
   * (monotone decreasing). The page picks each map's display level by
   * matching the REFERENCE's above-level count (same particle ⇒ same
   * envelope mass), which automatically lifts a noisy map's level above
   * its noise floor whatever its max happened to be. */
  envLevels?: number[];
  envCounts?: number[];
}

export async function bridgeVolStats(
  t: FlowTransport,
  modelId: number,
): Promise<BridgeVolStats | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(`${t.base}/volstats?id=${modelId}`, { method: "GET" }, 120_000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      max?: number;
      mean?: number;
      sd?: number;
      otsu?: number;
      otsu2?: number;
      zero_frac?: number;
      env_levels?: number[];
      env_counts?: number[];
      suggested_level?: number;
      env_frac?: number;
    };
    if (typeof data.max !== "number") return null;
    const numList = (v: unknown): number[] | undefined =>
      Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number" && Number.isFinite(x))
        ? (v as number[])
        : undefined;
    return {
      max: data.max,
      mean: data.mean ?? 0,
      sd: data.sd ?? 0,
      otsu: typeof data.otsu === "number" && Number.isFinite(data.otsu) ? data.otsu : undefined,
      otsu2: typeof data.otsu2 === "number" && Number.isFinite(data.otsu2) ? data.otsu2 : undefined,
      zeroFrac: typeof data.zero_frac === "number" && Number.isFinite(data.zero_frac) ? data.zero_frac : undefined,
      envLevels: numList(data.env_levels),
      envCounts: numList(data.env_counts),
      suggested:
        typeof data.suggested_level === "number" && Number.isFinite(data.suggested_level)
          ? data.suggested_level
          : undefined,
      envFrac: typeof data.env_frac === "number" && Number.isFinite(data.env_frac) ? data.env_frac : undefined,
    };
  } catch {
    return null;
  }
}

/** Relay-only: next free model id (needed by `volume flip ... modelId`). */
export async function bridgeNextModelId(t: FlowTransport): Promise<number | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(`${t.base}/nextid`, { method: "GET" }, 30_000);
    if (!res.ok) return null;
    const data = (await res.json()) as { next?: number };
    return typeof data.next === "number" ? data.next : null;
  } catch {
    return null;
  }
}

/** v3.77: the membrane-normal PCA reply (relay GET /membrane — computed
 * inside ChimeraX on the OPEN model, so the page never ships map bytes). */
export interface MembraneAxis {
  ok: boolean;
  /** Unit eigenvector of the SMALLEST variance — the membrane normal
   *  (grid i→x, j→y, k→z; the reference sits untransformed in the scene,
   *  so this is a scene-frame direction). */
  normal: [number, number, number];
  /** In-plane unit axes (largest / middle variance) — a right-handed
   *  basis with the normal (ea × eb = normal). */
  ea: [number, number, number];
  eb: [number, number, number];
  /** λmin/λmid — oblateness. A disk (membrane protein + micelle) sits
   *  well below 1; a globular particle sits near 1 (the caller rejects
   *  those and keeps the coverage view). */
  ratio: number;
  /** Above-level voxel count / grid size (diagnostics). */
  count: number;
  total: number;
}

/** v3.77: density-weighted PCA above `level` on an open volume — null on
 * any failure (old relay 404, endpoint error, malformed reply); callers
 * degrade to the coverage view. */
export async function bridgeMembraneAxis(
  t: FlowTransport,
  modelId: number,
  level: number,
): Promise<MembraneAxis | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(
      `${t.base}/membrane?id=${modelId}&level=${encodeURIComponent(level)}`,
      { method: "GET" },
      180_000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<MembraneAxis> & { error?: string };
    if (!data?.ok || !Array.isArray(data.normal) || data.normal.length !== 3 || typeof data.ratio !== "number") {
      return null;
    }
    const unitVec = (v: unknown): [number, number, number] | null => {
      if (!Array.isArray(v) || v.length !== 3) return null;
      const a = v.map(Number);
      if (a.some((x) => !Number.isFinite(x))) return null;
      const len = Math.hypot(a[0], a[1], a[2]);
      return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : null;
    };
    const normal = unitVec(data.normal);
    const ea = unitVec(data.ea);
    const eb = unitVec(data.eb);
    if (!normal || !ea || !eb) return null;
    return {
      ok: true,
      normal,
      ea,
      eb,
      ratio: data.ratio,
      count: typeof data.count === "number" ? data.count : 0,
      total: typeof data.total === "number" ? data.total : 0,
    };
  } catch {
    return null;
  }
}

/** v3.82: one density band from the relay's 3-phase split (GET /membrane2) —
 * a contiguous value window plus the band's own PCA. The detergent BELT is a
 * flat torus living in ONE band (whichever phase it is — the belt can be
 * hotter OR colder than the protein); its smallest-variance principal axis
 * IS the membrane normal whatever the particle's overall shape, which is
 * exactly what the whole-envelope /membrane PCA loses on a column+disk
 * particle like TMEM175 (head + transmembrane column read near-isotropic
 * together). `ratio` (λmin/λmid) is the band's OBLATENESS — a torus/disk
 * band sits far below 1; a band that mostly caught protein mass sits near
 * 1 and is not trusted as an orientation source. */
export interface MembraneBand {
  /** "mid" (between the two splits) or "high" (above the upper split). */
  name: string;
  /** Band value window [lo, hi). */
  lo: number;
  hi: number;
  normal: [number, number, number];
  ea: [number, number, number];
  eb: [number, number, number];
  /** λmin/λmid of THIS band's PCA — the oblateness confidence. */
  ratio: number;
  count: number;
}

/** v3.82: the /membrane2 reply — the 3-phase split levels, every band's
 * PCA (sorted by the page), and the legacy whole-envelope PCA (computed at
 * the solvent split) for diagnostics / the old fallback path. */
export interface Membrane2Reply {
  envelope: MembraneAxis | null;
  bands: MembraneBand[];
  /** The two split levels [solvent|mid, mid|high], when computable. */
  splits: [number, number] | null;
}

/** v3.82: the 3-phase split + per-band PCAs (relay GET /membrane2). Null on
 * any failure (old relay 404 / endpoint error / malformed reply) — callers
 * degrade to the probe-only standing scan, which needs NO relay support. */
export async function bridgeMembrane2(
  t: FlowTransport,
  modelId: number,
): Promise<Membrane2Reply | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(
      `${t.base}/membrane2?id=${modelId}`,
      { method: "GET" },
      180_000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      bands?: Array<Record<string, unknown>>;
      envelope?: Record<string, unknown>;
      splits?: unknown;
    };
    if (!data?.ok || !Array.isArray(data.bands)) return null;
    const unitVec = (v: unknown): [number, number, number] | null => {
      if (!Array.isArray(v) || v.length !== 3) return null;
      const a = v.map(Number);
      if (a.some((x) => !Number.isFinite(x))) return null;
      const len = Math.hypot(a[0], a[1], a[2]);
      return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : null;
    };
    const bands: MembraneBand[] = [];
    for (const b of data.bands) {
      const normal = unitVec(b.normal);
      const ea = unitVec(b.ea);
      const eb = unitVec(b.eb);
      const ratio = Number(b.ratio);
      const lo = Number(b.lo);
      const hi = Number(b.hi);
      if (!normal || !ea || !eb || !Number.isFinite(ratio) || !Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      bands.push({
        name: String(b.name ?? "band"),
        lo,
        hi,
        normal,
        ea,
        eb,
        ratio,
        count: Number(b.count) || 0,
      });
    }
    let envelope: MembraneAxis | null = null;
    if (data.envelope && typeof data.envelope.ratio === "number") {
      const normal = unitVec(data.envelope.normal);
      const ea = unitVec(data.envelope.ea);
      const eb = unitVec(data.envelope.eb);
      if (normal && ea && eb) {
        envelope = {
          ok: true,
          normal,
          ea,
          eb,
          ratio: Number(data.envelope.ratio),
          count: Number(data.envelope.count) || 0,
          total: Number(data.envelope.total) || 0,
        };
      }
    }
    let splits: [number, number] | null = null;
    if (Array.isArray(data.splits) && data.splits.length === 2 && data.splits.every((x) => typeof x === "number")) {
      splits = [Number(data.splits[0]), Number(data.splits[1])];
    }
    return { envelope, bands, splits };
  } catch {
    return null;
  }
}

/** v3.55 (round-14): one currently-open volume model in ChimeraX. */
export interface BridgeVolumeRef {
  /** ChimeraX id_string ("1", "2.1"…) — for `close #<id>`. */
  id: string;
  /** Model name (its map filename / URL) — for the run log. */
  name: string;
}

/** v3.56: a map's cache filename on the ChimeraX machine — the page and
 *  the relay agree on this shape for BOTH the /staged lookup and the
 *  /stage upload, so a map staged once is found on every later run.
 *
 *  The 8-hex suffix is a djb2 fingerprint of the map's download URL: a
 *  re-run CryoSmart job produces new URLs, so its maps can NEVER be
 *  confused with the previous run's cached copies (a stale-content hit
 *  is impossible by construction), while the same URL across runs is
 *  recognized as the same map and skipped outright.
 *  v3.72: `ext` generalizes the suffix beyond maps — the delivery set
 *  (FSC/Guinier/orientation pngs, fsc.xml) and the drag-dropped reference
 *  anchor (.pdb/.cif) also cache under canonical names, so the SAME
 *  name must be derivable on every rung (/staged probe, /fetch download,
 *  /stage upload) for those file types too. */
export function stagedMapFilename(key: string, url: string, ext = "mrc"): string {
  const base = String(key || "map")
    .replace(/[^A-Za-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "map";
  let h = 5381;
  const u = String(url || "");
  for (let i = 0; i < u.length; i++) {
    h = ((h * 33) ^ u.charCodeAt(i)) >>> 0;
  }
  const suffix = String(ext || "mrc").replace(/[^A-Za-z0-9]/g, "") || "mrc";
  return `${base}.${h.toString(16).padStart(8, "0").slice(-8)}.${suffix}`;
}

/** v3.56: a relay map-cache hit — the ChimeraX-openable LOCAL path. */
export interface BridgeStagedHit {
  path: string;
  size: number;
  mtime: number;
}

/** v3.56 (round-15 “已有 map 直接从本地打开，不重复下载”): is this map
 *  already in the relay's PERSISTENT map cache? Returns the local path the
 *  bridge can `open` directly, or null when: not a relay, the relay predates
 *  the /staged endpoint (HTTP 404 → unknown route), the map is absent, or
 *  the probe failed transiently. Callers fall back to the existing
 *  download ladder (direct → proxy → page relay) on null — and a page-relay
 *  /stage upload re-populates the cache under the SAME filename so the NEXT
 *  run hits it. */
export async function bridgeStagedLookup(
  t: FlowTransport,
  name: string,
  timeoutMs = 15_000,
): Promise<BridgeStagedHit | null> {
  if (t.kind !== "relay" || !t.canCache) return null;
  try {
    const res = await fetchWithTimeout(
      `${t.base}/staged?name=${encodeURIComponent(name)}`,
      { method: "GET" },
      timeoutMs,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      exists?: boolean;
      path?: string;
      size?: number;
      mtime?: number;
    };
    if (!data?.ok || !data.exists || typeof data.path !== "string" || typeof data.size !== "number") {
      return null;
    }
    return { path: data.path, size: data.size, mtime: typeof data.mtime === "number" ? data.mtime : 0 };
  } catch {
    return null;
  }
}

/** v3.65: the outcome of a relay POST /fetch — the ChimeraX-openable
 *  LOCAL path of the map inside the relay's persistent cache dir
 *  (status "hit" = the file was already there and the download was
 *  skipped outright). */
export interface BridgeFetchResult {
  ok: boolean;
  status?: "hit" | "downloaded";
  path?: string;
  size?: number;
  error?: string;
}

/** v3.65 (round-24 “增加设置一个本地目录先下载map，再让chimera从指定目录
 *  中打开map进行对齐截图，如果目录中已有所需文件就跳过下载”): have the
 *  RELAY (the ChimeraX machine's own Python — no ChimeraX command involved)
 *  download a map URL ONCE into its persistent local map-cache dir and
 *  return the LOCAL path. ChimeraX afterwards opens ONLY that local file
 *  for the 8-candidate alignment ladder and the screenshots, so no
 *  candidate open can ever re-fetch over the network; a file already in
 *  the dir skips the download entirely. The canonical `name` comes from
 *  stagedMapFilename() — the SAME name rung 0's /staged probe and the
 *  /stage upload use — so every rung and every later run converge on the
 *  same cached file. Never throws; failures come back as { ok: false,
 *  error } so the caller can walk its ladder. */
export async function bridgeFetchMap(
  t: FlowTransport,
  url: string,
  name: string,
  timeoutMs = 600_000,
): Promise<BridgeFetchResult> {
  if (t.kind !== "relay") return { ok: false, error: "not a relay transport" };
  try {
    const res = await fetchWithTimeout(
      `${t.base}/fetch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name }),
      },
      timeoutMs,
    );
    if (!res.ok) return { ok: false, error: `relay /fetch HTTP ${res.status}` };
    const data = (await res.json()) as BridgeFetchResult;
    if (!data?.ok || typeof data.path !== "string" || !data.path) {
      return { ok: false, error: data?.error || "relay /fetch 未返回本地路径" };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** v3.70 (round-29 “没看到UI中输入下载路径的窗口”): switch the relay's
 * persistent map-cache dir at runtime — body {"dir": <absolute path>}.
 * The relay creates the dir when missing, probes writability, and only
 * then commits the switch (every later /fetch, /stage and /staged uses
 * the new dir); files already cached in the OLD dir are NOT moved — the
 * reply carries `previous` so the UI can tell the user. Never throws;
 * failures come back as { ok: false, error }. */
export interface BridgeCacheDirResult {
  ok: boolean;
  /** The committed dir (== the requested one on success). */
  dir?: string;
  /** The dir in effect before the switch. */
  previous?: string;
  /** Number of files already in the NEW dir. */
  cached?: number;
  error?: string;
}
export async function bridgeSetCacheDir(
  t: FlowTransport,
  dir: string,
  timeoutMs = 30_000,
): Promise<BridgeCacheDirResult> {
  if (t.kind !== "relay") return { ok: false, error: "not a relay transport" };
  try {
    const res = await fetchWithTimeout(
      `${t.base}/cachedir`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      },
      timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as BridgeCacheDirResult | null;
    if (!res.ok) return { ok: false, error: data?.error || `relay /cachedir HTTP ${res.status}` };
    return data ?? { ok: false, error: "relay /cachedir 无响应" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Relay-only v3.55 (round-14 “开始截图之前要先关闭掉过去已打开的 map”):
 *  list every currently-open VOLUME model. Returns `null` when the
 *  transport is not a relay or the relay predates the /volumes endpoint
 *  (HTTP 404 / unexpected payload) — callers then fall back to `close all`.
 *  This is the precise half of the leftover-cleanup: only volume maps are
 *  closed, so an atomic model the user is looking at stays untouched. */
export async function bridgeVolumeIds(
  t: FlowTransport,
  timeoutMs = 30_000,
): Promise<BridgeVolumeRef[] | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(`${t.base}/volumes`, { method: "GET" }, timeoutMs);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; volumes?: BridgeVolumeRef[] };
    if (!data?.ok || !Array.isArray(data.volumes)) return null;
    return data.volumes.filter((v) => typeof v?.id === "string" && !!v.id);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* v3.72 delivery writes (relay POST /deliver)                         */
/* ------------------------------------------------------------------ */

/** v3.72: one relay POST /deliver request — exactly one of src / url /
 *  data_base64 (or stat alone for the existence probe). */
export interface BridgeDeliverPayload {
  /** Copy this LOCAL absolute path (a map's cache file) → dst. */
  src?: string;
  /** Download this URL straight → dst (plots / fsc.xml — small files). */
  url?: string;
  /** Write these base64 bytes → dst (embedded fsc.xml text). Sent on the
   *  WIRE as the relay's snake_case key `data_base64` (see the mapping in
   *  bridgeDeliverFile — round-33 review: the raw camelCase key never
   *  reached the relay's payload.get("data_base64") and broke every
   *  embedded-xml delivery with “缺少 src/url/data_base64 之一”). */
  dataBase64?: string;
  /** Full destination path on the ChimeraX machine (dir + filename). */
  dst?: string;
  /** Probe-only mode: does this path exist (+ size)? */
  stat?: string;
}

/** v3.72: the reply of every relay POST /deliver call. */
export interface BridgeDeliverResult {
  ok: boolean;
  path?: string;
  size?: number;
  /** stat-mode only: whether the probed path exists. */
  exists?: boolean;
  error?: string;
}

/** v3.72 (round-31 交付文件下载): write ONE delivery file into the user's
 *  交付目录 on the ChimeraX machine via the relay's POST /deliver — local
 *  cache copy (maps, byte-identical) / direct URL download (plots, xml) /
 *  embedded base64 bytes (captured fsc.xml). Never throws; failures come
 *  back as { ok: false, error } so the per-file delivery loop can log and
 *  continue with the remaining files. */
export async function bridgeDeliverFile(
  t: FlowTransport,
  payload: BridgeDeliverPayload,
  timeoutMs = 600_000,
): Promise<BridgeDeliverResult> {
  if (t.kind !== "relay") return { ok: false, error: "not a relay transport" };
  try {
    /* v3.74 (round-33 review): the relay's /deliver contract reads the
     * SNAKE_CASE key `data_base64`; the TS-side field stays camelCase —
     * map it at the wire boundary (undefined fields drop out of the JSON
     * body) so captured fsc.xml text delivers without a relay round-trip. */
    const wire =
      payload.dataBase64 != null
        ? { ...payload, dataBase64: undefined, data_base64: payload.dataBase64 }
        : payload;
    const res = await fetchWithTimeout(
      `${t.base}/deliver`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire),
      },
      timeoutMs,
    );
    const data = (await res.json().catch(() => null)) as BridgeDeliverResult | null;
    if (!res.ok) return { ok: false, error: data?.error || `relay /deliver HTTP ${res.status}` };
    return data ?? { ok: false, error: "relay /deliver 无响应" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** v3.72: does this path exist on the ChimeraX machine (+ size)? Used to
 *  verify a ChimeraX `save` actually landed after a chirality flip+save —
 *  the save command can report success while writing nowhere (the same
 *  silent-failure class the v3.50 save→fetch ladder guards against). */
export async function bridgeDeliverStat(
  t: FlowTransport,
  path: string,
  timeoutMs = 15_000,
): Promise<BridgeDeliverResult> {
  return bridgeDeliverFile(t, { stat: path }, timeoutMs);
}

/** v3.72: the outcome of one chirality-corrected (flipped) map delivery —
 *  ChimeraX opens the cached RAW map, creates its z-mirror (`volume flip`,
 *  the SAME command the two-hand alignment ladder uses), saves the flipped
 *  grid as MRC into the 交付目录 (explicit `format mrc`; v3.76 the delivery
 *  names now carry the .mrc suffix — {base}.volume.map_sharp.mrc — which
 *  the explicit format makes redundant-but-harmless), closes both models
 *  and verifies the written file via /deliver stat. */
export async function deliverFlippedMap(
  t: FlowTransport,
  localSrc: string,
  dst: string,
  onLog?: (line: string) => void,
): Promise<BridgeDeliverResult> {
  if (t.kind !== "relay") return { ok: false, error: "not a relay transport" };
  const softExec = async (command: string, timeoutMs: number): Promise<ExecResult> => {
    try {
      return await bridgeExec(t, command, timeoutMs);
    } catch (err) {
      return { text: "", error: err instanceof Error ? err.message : String(err) };
    }
  };
  const open = await bridgeOpenModel(t, localSrc, 300_000, "map");
  const srcId = open.modelId;
  if (srcId == null) {
    return { ok: false, error: `打开地图失败: ${open.error || logSnippet(open.text) || "未返回 model id"}` };
  }
  let flipId: number | null = null;
  try {
    const next = await bridgeNextModelId(t);
    let res = next != null ? await softExec(`volume flip #${srcId} axis z modelId ${next}`, 180_000) : null;
    if (res && !res.error) {
      /* v3.74: trust the explicit modelId — parsing the log could grab the
       * SOURCE map's id (or a submodel's) instead of the new volume (the
       * same hardening gaussianSmooth got in v3.67). */
      flipId = next;
    } else {
      res = await softExec(`volume flip #${srcId} axis z`, 180_000);
      if (res && !res.error) {
        const ids = Array.from(res.text.matchAll(/#(\d+(?:\.\d+)?)/g)).map((m) => parseInt(m[1], 10));
        flipId = ids.find((id) => id !== srcId) ?? null;
      }
    }
    if (flipId == null || flipId === srcId) {
      throw new Error(`volume flip 未返回新模型（${res?.error || logSnippet(res?.text) || "无输出"}）`);
    }
    // Forward slashes inside the quoted path survive every command
    // tokenizer (v3.50's lesson) — Windows Python opens them natively.
    const savePath = quotePath(dst.replace(/\\/g, "/"));
    const save = await softExec(`save ${savePath} models #${flipId} format mrc`, 600_000);
    if (save.error) {
      throw new Error(`ChimeraX save 失败: ${logSnippet(save.error, 160)}`);
    }
    const stat = await bridgeDeliverStat(t, dst);
    if (!stat.ok) {
      throw new Error(`保存后验证失败: ${stat.error ?? "未知错误"}`);
    }
    if (!stat.exists || !stat.size) {
      throw new Error(`保存后目标文件不存在或为空: ${dst}`);
    }
    onLog?.(`    翻转保存完成 → ${dst}（${Math.round((stat.size ?? 0) / 1048576)} MB）`);
    return { ok: true, path: dst, size: stat.size };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (flipId != null) await softExec(`close #${flipId}`, 60_000);
    await softExec(`close #${srcId}`, 60_000);
  }
}

export interface OpenModelResult {
  modelId: number | null;
  /** ChimeraX-side exception text ("UserError: …"), null when open ran clean. */
  error: string | null;
  /** Captured open log text (for diagnostics + legacy-format id parsing). */
  text: string;
  /** True when the id came from the /nextid delta, not from the log text
   *  (legacy builds whose open output names no model at all). */
  viaDelta: boolean;
}

/** v3.46: open a MAP url/path in ChimeraX and robustly recover its model id.
 *
 * v3.47 (user round-6 report — “UserError: Format 'mrc' not supported for
 * database 'http'. Supported formats are: web fetch or HTML” on EVERY
 * ladder rung): ChimeraX's http database does not register the mrc format
 * AT ALL — `open <http-url> format mrc` is rejected no matter the
 * credentials (the earlier 401 was a separate, earlier failure). What
 * ChimeraX CAN do with an http source is web-fetch it and sniff the
 * URL-path suffix, so the command shape now depends on the source:
 *   - http URL ending in `.mrc`  → plain `open <url>` (web fetch + suffix
 *     sniff — the direct CryoSmart and app-proxy URLs both qualify);
 *   - http URL WITHOUT `.mrc`   → refused app-side, NEVER sent: a plain
 *     open there makes ChimeraX pop its save-file dialog (the round-5/6
 *     “保存map的窗口”) whose modal then blocks every /exec on the UI
 *     thread, and `format mrc` is rejected for http — such URLs must be
 *     staged to a local file first (relay POST /stage);
 *   - local file path           → `open <path> format mrc` (mrc IS
 *     registered for the file database).
 * Over a command that never even runs there is no id to parse — but the
 * three-tier parse + /nextid delta fallback (v3.46) stay for the opens
 * that DO run, and an AbortError (relay request hung — e.g. a leftover
 * modal save dialog) now surfaces as an actionable timeout error instead
 * of a bare "The operation was aborted". */
export async function bridgeOpenModel(
  t: FlowTransport,
  source: string,
  timeoutMs = 300_000,
  /** v3.71: "map" (default — the pre-3.71 guards: non-map-suffix http
   *  URLs rejected, local paths force `format mrc`) vs. "auto" (the
   *  reference-hand ANCHOR — a PDB/mmCIF atomic model or any
   *  ChimeraX-sniffable file: http URLs of ANY suffix are allowed and a
   *  local path only forces `format mrc` when its suffix is MRC-family,
   * so .pdb/.cif paths get ChimeraX's own suffix sniffing). */
  openKind: "map" | "auto" = "map",
): Promise<OpenModelResult> {
  const isHttp = /^https?:\/\//i.test(source);
  // Suffix sniffing uses the URL's PATH basename (ChimeraX's web fetch
  // names the temp file after the path's last segment) — a map suffix that
  // only appears inside the query string (e.g. the app asset route's
  // ?name=J498.volume.mrc) does NOT count: the path ends in "asset", so
  // ChimeraX would pop its save-file dialog. CryoSmart names its maps
  // *.map (volume.map, volume_class_0.map…) — .map/.mrc/.mrcs/.ccp4 are
  // ALL registered MRC-family suffixes for ChimeraX's suffix sniffer.
  const MAP_SUFFIX_RE = /\.(mrc|mrcs|map|ccp4)$/i;
  let httpPathMap = false;
  if (isHttp) {
    try {
      httpPathMap = MAP_SUFFIX_RE.test(new URL(source).pathname);
    } catch {
      httpPathMap = /\.(?:mrc|mrcs|map|ccp4)(?:\?|#|$)/i.test(source);
    }
  }
  if (openKind === "map" && isHttp && !httpPathMap) {
    return {
      modelId: null,
      error:
        "ChimeraX 不能直接打开无地图后缀的 http URL（format mrc 对 http 数据源不受支持，不带 format 又会弹出保存对话框）— 需先经桥接 /stage 暂存为本地文件再 open",
      text: "",
      viaDelta: false,
    };
  }
  // v3.71 "auto" kind: a local path only forces `format mrc` for
  // MRC-family suffixes (a .pdb/.cif anchor must ride ChimeraX's own
  // suffix sniffing, not be parsed as a volume).
  const forceMrc = openKind === "map" ? !isHttp : !isHttp && MAP_SUFFIX_RE.test(source);
  const command = `open ${quotePath(source)}${forceMrc ? " format mrc" : ""}`;
  const nextBefore = await bridgeNextModelId(t);
  let res: ExecResult;
  try {
    res = await bridgeExec(t, command, timeoutMs);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        modelId: null,
        error: `ChimeraX 命令超时（>${Math.round(timeoutMs / 1000)}s 未返回）— 很可能被一个模态窗口阻塞（如先前遗留的“保存文件”对话框）；请切到 ChimeraX 手动关闭该弹窗后重试`,
        text: "",
        viaDelta: false,
      };
    }
    throw err;
  }
  let modelId = parseOpenModelId(res.text);
  let viaDelta = false;
  if (modelId == null && !res.error && nextBefore != null) {
    const nextAfter = await bridgeNextModelId(t);
    if (nextAfter != null && nextAfter > nextBefore) {
      modelId = nextAfter - 1;
      viaDelta = true;
    }
  }
  return { modelId, error: res.error, text: res.text, viaDelta };
}

/* ------------------------------------------------------------------ */
/* Parsers (port of the desktop helper's regexes)                      */
/* ------------------------------------------------------------------ */

export function parseCorrelation(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /correlation\s*=?\s*([-+]?\d*\.?\d+)/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value >= -1 && value <= 1 ? value : null;
}

/** v3.71: fitmap's ATOMIC-fit score — "Average map value = 0.0618" (the
 * atom-in-map analogue of the map-map correlation). Used by the
 * reference-hand verification (EMalign anchor fits): an ATOMIC anchor
 * reports this number instead of a correlation, and it IS comparable
 * across the two hands of the SAME reference because a z-flip preserves
 * the value distribution. */
export function parseAvgMapValue(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /average map value\s*=?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/** Extract the opened model id from an `open` command's log text.
 *
 * v3.46 (user round-5: “无法在 ChimeraX 中打开参考地图 (asset-url)” with NO
 * error suffix — the open had clearly NOT raised, the map was sitting open
 * in ChimeraX, only the id went unparsed): ChimeraX prints the model id in
 * DIFFERENT shapes across versions —
 *   modern (≥ ~1.6):  "Opened x.mrc as #3.1, grid size 200,200,200, …"
 *   legacy (≤ 1.13):  "Opened x.mrc, grid size 200,200,200, grid spacing
 *                      1.06,1.06,1.06 on 1 model (id #3)"
 * and some builds log only a bare mention. The old single-regex parse
 * ("as #N") silently returned null on every legacy build, turning a
 * successful open into a fatal “无法打开参考地图”. Order: modern "as #N",
 * legacy "(id #N)" / "id #N", then the LAST bare "#N" mention. */
export function parseOpenModelId(text: string): number | null {
  if (!text) return null;
  const mModern = /as\s+#(\d+(?:\.\d+)?)/i.exec(text);
  if (mModern) return parseInt(mModern[1], 10);
  const mLegacy = /\(\s*id\s*#(\d+(?:\.\d+)?)\s*\)/i.exec(text) || /\bid\s+#(\d+(?:\.\d+)?)\b/i.exec(text);
  if (mLegacy) return parseInt(mLegacy[1], 10);
  const ids = [...text.matchAll(/#(\d+(?:\.\d+)?)/g)];
  if (ids.length) return parseInt(ids[ids.length - 1][1], 10);
  return null;
}

/** Collapse a ChimeraX log snippet to one short line (error diagnostics). */
function logSnippet(text: string, max = 160): string {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function quotePath(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function safeKeyPart(value: string): string {
  return String(value || "item").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

/** v3.48: join a bridge workdir + filename using the workdir's OWN separator.
 *  Windows relays report workdirs like "C:\Users\…\cryoflow_x" — building
 *  the save path with the native separator matches the proven desktop
 *  helper exactly (ChimeraX/Python accept either, but a canonical path
 *  removes one variable when diagnosing over a log). */
function joinWorkdirPath(workdir: string, name: string): string {
  const base = String(workdir || "").replace(/[\\/]+$/, "");
  return base + (base.includes("\\") ? "\\" : "/") + name;
}

/** v3.50: same join but ALWAYS with "/" — Windows Python accepts forward
 *  slashes everywhere, and a quoted forward-slash path survives any
 *  command tokenizer that eats backslashes. */
function joinWorkdirPathFwd(workdir: string, name: string): string {
  const base = String(workdir || "").replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return `${base}/${name}`;
}

/* ------------------------------------------------------------------ */
/* v3.50: save→fetch ladder                                            */
/* ------------------------------------------------------------------ */

export interface SaveShotOptions {
  width: number;
  height: number;
  supersample: number;
}

export class SaveShotError extends Error {
  /** "save" = the ChimeraX save/cd command raised; "fetch" = every rung
   * saved clean but /file still could not return the bytes. */
  kind: "save" | "fetch";
  constructor(message: string, kind: "save" | "fetch") {
    super(message);
    this.name = "SaveShotError";
    this.kind = kind;
  }
}

/** v3.50: save a screenshot PNG into the bridge workdir and fetch its
 *  bytes back, walking the save-rung ladder until /file actually returns
 *  bytes (see the header comment). The winning rung is cached on the
 *  transport. Throws SaveShotError — call sites format the log message
 * from .kind, so a pasted log names the true failure layer. */
export async function saveAndFetchPng(
  t: FlowTransport,
  name: string,
  opts: SaveShotOptions,
  exec: (command: string) => Promise<ExecResult>,
  onNote?: (line: string) => void,
): Promise<Uint8Array> {
  if (t.kind !== "relay" || !t.workdir) throw new SaveShotError("file save requires the relay transport", "save");
  // v3.53: transparentBackground true — the ONLY documented way to get an
  // alpha-channel export (set bgColor ignores transparency; the old
  // explicit `false` here baked an opaque black canvas into every PNG).
  const saveArgs = ` width ${opts.width} height ${opts.height} supersample ${opts.supersample} transparentBackground true`;
  const allModes: SaveMode[] = [
    "abs",
    ...(String(t.workdir).includes("\\") ? (["abs-fwd"] as SaveMode[]) : []),
    "cd-rel",
  ];
  // The cached winning rung goes FIRST (one clean attempt in the happy
  // path), but the rest of the ladder still follows — a previously-working
  // save shape must never be a dead end when the environment changes.
  const order: SaveMode[] = t.saveMode
    ? [t.saveMode, ...allModes.filter((m) => m !== t.saveMode)]
    : allModes;
  const tried: string[] = [];
  let lastSaveError: string | null = null;
  for (const mode of order) {
    tried.push(mode);
    let path = "";
    if (mode === "abs") path = quotePath(joinWorkdirPath(t.workdir, name));
    else if (mode === "abs-fwd") path = quotePath(joinWorkdirPathFwd(t.workdir, name));
    if (mode === "cd-rel") {
      if (!t.cdDone) {
        const cd = await exec(`cd ${quotePath(t.workdir)}`);
        if (cd.error) {
          lastSaveError = cd.error;
          continue; // cd failed — next rung (or exhaustion diagnostics)
        }
        t.cdDone = true;
      }
      path = quotePath(name); // bare relative name — nothing to mangle
    }
    const saveRes = await exec(`save ${path}${saveArgs}`);
    if (saveRes.error) {
      lastSaveError = saveRes.error;
      continue; // this rung's command shape failed — try the next one
    }
    try {
      const bytes = await bridgeFile(t, name);
      if (t.saveMode !== mode) {
        t.saveMode = mode;
        if (mode !== "abs") {
          onNote?.(
            `  （已改用 ${mode === "cd-rel" ? "cd + 相对路径" : "正斜杠路径"}方式保存截图 — 后续沿用）`,
          );
        }
      }
      return bytes;
    } catch (err) {
      if (mode !== order[order.length - 1]) continue; // /file missed — next rung
      throw new SaveShotError(
        `保存命令未报错但 /file 未找到 ${name}（workdir=${t.workdir}；已尝试 ${tried.join(" → ")} 全部未命中：${String(err).slice(0, 120)}）`,
        "fetch",
      );
    }
  }
  throw new SaveShotError(
    `${lastSaveError ? logSnippet(lastSaveError, 160) : `所有保存方式均失败（已尝试 ${tried.join(" → ")}）`}`,
    "save",
  );
}

/* ------------------------------------------------------------------ */
/* Thumbnail coverage scoring (browser port of score_current_view)     */
/* ------------------------------------------------------------------ */

/** v3.51: sample the canvas background from the four corners — works for
 *  the new black renders AND legacy white ones. */
function cornerBg(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const pts: Array<[number, number]> = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [255, 255, 255];
}

/** Fraction of the canvas NOT covered by the (sampled) background — the old
 *  white-only counter generalized to any opaque background, then to ALPHA
 *  (v3.53): fully transparent pixels ARE the background; the old loop skipped
 *  them without counting, so a transparent render scored coverage 1.0 for
 *  every view and picked views blind. */
async function thumbnailCoverageScore(png: Uint8Array): Promise<number> {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return 0;
  const blob = new Blob([png as BlobPart], { type: "image/png" });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = cornerBg(data, width, height);
  let bgCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 10) {
      bgCount++;
      continue;
    }
    if (
      Math.abs(data[i] - bg[0]) <= 25 &&
      Math.abs(data[i + 1] - bg[1]) <= 25 &&
      Math.abs(data[i + 2] - bg[2]) <= 25
    ) {
      bgCount++;
    }
  }
  const total = width * height;
  return total ? (total - bgCount) / total : 0;
}

/** v3.82 (round-42 角度/level 探针闭环): everything the page needs to judge
 * a probe render, measured on the REAL pixels browser-side:
 *   - connected-component labelling of the foreground (downsampled when the
 *     thumbnail is large): the MAIN component is the particle;
 *   - `frag` — the FRAGMENTATION: 1 − mainArea/totalForeground. A snowball
 *     render (level below the noise floor) and free-micelle blobs read HIGH
 *     whatever the map's max was — the level KNEE picks the lowest level
 *     whose fragmentation is clean, replacing every blind histogram rule
 *     (max-ratio / Otsu variants all inherit a single hot spike's position);
 *   - `mainCov` — the main component's coverage of the canvas (a too-high
 *     level shrinks the particle to a spongy core → the knee's sponge guard);
 *   - `standing` — the main component's mass-centroid offset from its own
 *     bbox centre along the VERTICAL, normalized by its height (positive =
 *     mass toward the top). A membrane protein standing in the side view is
 *     vertically ASYMMETRIC (head/belt mass at one end — the belt alone can
 *     outweigh the whole protein on detergent-heavy particles like P283's
 *     TMEM175); face-down (top view) and lying views read ≈ 0. This is the
 *     primary side-view discriminator for the scan — anisotropy alone
 *     maximises the LONG axis HORIZONTAL (a lying view, exactly the v3.81
 *     failure);
 *   - `aniso`/`aspect` of the MAIN component only (stray blobs no longer
 *     swing the second moments).
 * Returns null when the browser canvas is unavailable. */
export interface RenderShape {
  aniso: number;
  aspect: number;
  coverage: number;
  frag: number;
  mainCov: number;
  standing: number;
  /** v3.86: ENCLOSED background components inside the main component's
   *  silhouette (flood-fill from the border; anything unreachable is a
   *  hole). A clean protein surface reads 0–2 (a face-on torus/pore = 1);
   *  a lace/sponge/cauliflower render at a level below its noise floor
   *  reads many — the v3.85 frag metric could not see these (the speckle
   *  is CONNECTED, so fragmentation stayed ≈0 on the delivered
   *  cauliflower reference). */
  holes: number;
  /** v3.86: boundary roughness of the main component — the isoperimetric
   *  ratio P²/(4π·A) (circle = 1, filled square ≈ 1.27, a wiggle-edged
   *  noise silhouette ≫ 2.5). Diagnostics in the run log; NOT a gate
   *  (legit concave silhouettes — head+column+belt — also read high). */
  rough: number;
  /** v3.89: the downsampled MAIN-component silhouette mask (binary,
   *  labels==main only — the pose-comparable shape; stray dust/speckle
   *  components are excluded so a noisy map can still pose-match its
   *  clean reference). This is what every map's render is IoU-matched
   *  against the reference's cached mask with (the round-49 orientation
   * fix). null on degenerate renders (fg < 16 → nothing to compare). */
  mask?: { w: number; h: number; data: Uint8Array } | null;
}

/** v3.89: silhouette agreement between two probe masks — the intersection
 * over the union of the two main-component masks (both on the SAME
 * downsampled probe grid). 1.0 = identical silhouettes; a same-pose
 * same-pipeline map reads ≈ 0.6–0.9 (level/envelope differences), a
 * 90°-yawed or face-on map reads well below. Pure + exported for the
 * offline harness. */
export function maskIou(
  a: { w: number; h: number; data: Uint8Array },
  b: { w: number; h: number; data: Uint8Array },
): number | null {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) return null;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i];
    const y = b.data[i];
    if (x || y) union++;
    if (x && y) inter++;
  }
  return union > 0 ? inter / union : null;
}

async function measureRender(png: Uint8Array): Promise<RenderShape | null> {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
  const blob = new Blob([png as BlobPart], { type: "image/png" });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = cornerBg(data, width, height);
  /* downsample the foreground mask when the probe is big (the knee/roll
   * probes render 320px; 160 is plenty for component shape metrics and
   * keeps the labelling cheap). */
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  const mw = Math.floor(width / stride);
  const mh = Math.floor(height / stride);
  const mask = new Uint8Array(mw * mh);
  let fg = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const sx = x * stride + ((stride / 2) | 0);
      const sy = y * stride + ((stride / 2) | 0);
      const i = (Math.min(sy, height - 1) * width + Math.min(sx, width - 1)) * 4;
      const isBg =
        data[i + 3] <= 10 ||
        (Math.abs(data[i] - bg[0]) <= 25 &&
          Math.abs(data[i + 1] - bg[1]) <= 25 &&
          Math.abs(data[i + 2] - bg[2]) <= 25);
      if (!isBg) {
        mask[y * mw + x] = 1;
        fg++;
      }
    }
  }
  if (fg < 16) return { aniso: 1, aspect: 0, coverage: 0, frag: 1, mainCov: 0, standing: 0, holes: 0, rough: 0, mask: null };
  /* connected components (4-neighbour BFS, iterative stack) */
  const labels = new Int32Array(mw * mh).fill(-1);
  const comps: Array<{ area: number; minX: number; minY: number; maxX: number; maxY: number; sx: number; sy: number; sxx: number; syy: number; sxy: number }> = [];
  const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] >= 0) continue;
    const id = comps.length;
    const c = { area: 0, minX: mw, minY: mh, maxX: -1, maxY: -1, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
    stack.push(p);
    labels[p] = id;
    while (stack.length) {
      const q = stack.pop() as number;
      const qx = q % mw;
      const qy = (q / mw) | 0;
      c.area++;
      if (qx < c.minX) c.minX = qx;
      if (qx > c.maxX) c.maxX = qx;
      if (qy < c.minY) c.minY = qy;
      if (qy > c.maxY) c.maxY = qy;
      c.sx += qx;
      c.sy += qy;
      c.sxx += qx * qx;
      c.syy += qy * qy;
      c.sxy += qx * qy;
      if (qx > 0 && mask[q - 1] && labels[q - 1] < 0) { labels[q - 1] = id; stack.push(q - 1); }
      if (qx < mw - 1 && mask[q + 1] && labels[q + 1] < 0) { labels[q + 1] = id; stack.push(q + 1); }
      if (qy > 0 && mask[q - mw] && labels[q - mw] < 0) { labels[q - mw] = id; stack.push(q - mw); }
      if (qy < mh - 1 && mask[q + mw] && labels[q + mw] < 0) { labels[q + mw] = id; stack.push(q + mw); }
    }
    comps.push(c);
  }
  if (!comps.length) return { aniso: 1, aspect: 0, coverage: 0, frag: 1, mainCov: 0, standing: 0, holes: 0, rough: 0, mask: null };
  let main = comps[0];
  let mainLabel = 0;
  for (let ci = 0; ci < comps.length; ci++) {
    if (comps[ci].area > main.area) {
      main = comps[ci];
      mainLabel = ci;
    }
  }
  const frag = Math.max(0, 1 - main.area / fg);
  const n = main.area;
  const mx = main.sx / n;
  const my = main.sy / n;
  const vxx = Math.max(main.sxx / n - mx * mx, 1e-9);
  const vyy = Math.max(main.syy / n - my * my, 1e-9);
  const vxy = main.sxy / n - mx * my;
  const tr = vxx + vyy;
  const det = vxx * vyy - vxy * vxy;
  const disc = Math.sqrt(Math.max((tr * tr) / 4 - det, 0));
  const lMax = tr / 2 + disc;
  const lMin = Math.max(tr / 2 - disc, 1e-9);
  const bw = main.maxX - main.minX + 1;
  const bh = main.maxY - main.minY + 1;
  /* screen y grows DOWNWARD: mass above the bbox centre → my < centre →
   * standing > 0 means "heavy end up". */
  const standing = bh > 1 ? ((main.minY + main.maxY + 1) / 2 - my) / bh : 0;
  /* v3.86 (a): boundary roughness of the main component — perimeter =
   *  its pixels with a 4-neighbour background pixel (or the canvas edge);
   *  the isoperimetric ratio P²/(4π·A) (circle 1, square ≈1.27,
   *  wiggle/noise edges ≫2.5). Diagnostics only — logged per knee rung. */
  let perimeter = 0;
  for (let y = main.minY; y <= main.maxY; y++) {
    for (let x = main.minX; x <= main.maxX; x++) {
      const p = y * mw + x;
      if (labels[p] !== mainLabel) continue;
      const bgNeighbor =
        x === 0 || !mask[p - 1] || x === mw - 1 || !mask[p + 1] || y === 0 || !mask[p - mw] || y === mh - 1 || !mask[p + mw];
      if (bgNeighbor) perimeter++;
    }
  }
  const rough = perimeter > 0 && n > 0 ? (perimeter * perimeter) / (4 * Math.PI * n) : 0;
  /* v3.86 (b): ENCLOSED holes — flood-fill the background from the border;
   *  every background component NOT reached is a hole inside the
   *  silhouette (sponge voids / noise gaps). */
  const bgReach = new Uint8Array(mw * mh);
  const bgStack: number[] = [];
  for (let x = 0; x < mw; x++) {
    for (const y of [0, mh - 1]) {
      const p = y * mw + x;
      if (!mask[p] && !bgReach[p]) {
        bgReach[p] = 1;
        bgStack.push(p);
      }
    }
  }
  for (let y = 0; y < mh; y++) {
    for (const x of [0, mw - 1]) {
      const p = y * mw + x;
      if (!mask[p] && !bgReach[p]) {
        bgReach[p] = 1;
        bgStack.push(p);
      }
    }
  }
  while (bgStack.length) {
    const q = bgStack.pop() as number;
    const qx = q % mw;
    const qy = (q / mw) | 0;
    const push = (r: number) => {
      if (!mask[r] && !bgReach[r]) {
        bgReach[r] = 1;
        bgStack.push(r);
      }
    };
    if (qx > 0) push(q - 1);
    if (qx < mw - 1) push(q + 1);
    if (qy > 0) push(q - mw);
    if (qy < mh - 1) push(q + mw);
  }
  let holes = 0;
  const holeSeen = new Uint8Array(mw * mh);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] || bgReach[p] || holeSeen[p]) continue;
    holes++;
    const hStack: number[] = [p];
    holeSeen[p] = 1;
    while (hStack.length) {
      const q = hStack.pop() as number;
      const qx = q % mw;
      const qy = (q / mw) | 0;
      const push = (r: number) => {
        if (!mask[r] && !bgReach[r] && !holeSeen[r]) {
          holeSeen[r] = 1;
          hStack.push(r);
        }
      };
      if (qx > 0) push(q - 1);
      if (qx < mw - 1) push(q + 1);
      if (qy > 0) push(q - mw);
      if (qy < mh - 1) push(q + mw);
    }
  }
  /* v3.89: the main component's own mask — the pose-comparable
   * silhouette (dust/speckle components excluded; the labels array already
   * partitions the foreground). */
  const mainMask = new Uint8Array(mw * mh);
  for (let p = 0; p < mainMask.length; p++) mainMask[p] = labels[p] === mainLabel ? 1 : 0;
  return {
    aniso: Math.sqrt(Math.max(lMax, 1e-9) / lMin),
    aspect: bw / bh,
    coverage: fg / (mw * mh),
    frag,
    mainCov: main.area / (mw * mh),
    standing,
    holes,
    rough,
    mask: { w: mw, h: mh, data: mainMask },
  };
}

/* ------------------------------------------------------------------ */
/* Alignment + chirality + render engine                               */
/* ------------------------------------------------------------------ */

const LEVEL_RATIO = 0.25;
/** v3.85 (round-45 “好像这个level的问题更加严重了，是数据调整的方向反了？
 *  参考这个脚本中计算map level的方式改进一下” — the user's own
 *  auto_color_locres.py): the DISPLAY contour anchors at
 *  em_map.data.full_matrix().max() × 0.15 with `surface dust size 8.08`
 *  cleaning the small disconnected junk. The v3.82 knee swept the ladder
 *  BOTTOM-UP and took the LOWEST "clean" rung (+ a refinement probe
 *  DOWNWARD, back toward the dirty band) — i.e. it optimised toward the
 *  noise floor, the exact reverse of the expert workflow, and its frag
 *  metric (share of foreground pixels outside the main component)
 *  under-counted visually-prominent micelles → the round-44 deck came
 *  back speckled on most maps. v3.85: anchor at the script's 0.15×max,
 *  dust the surface, VERIFY with a render probe, and adjust only in the
 *  right direction (fragmented → the clean rung closest to the anchor,
 *  searching UP; hollow → closest BELOW) — never back into the dirty
 *  band. Alignment FIT levels stay at the tuned 0.25×max (LEVEL_RATIO). */
const SCRIPT_LEVEL_RATIO = 0.15;
/** v3.85: the dust size straight out of auto_color_locres.py
 *  (`surface dust #<id> size 8.08`) — hides disconnected surface bits
 *  smaller than this; re-issued after every level change so the probes
 *  measure exactly what the screenshots will show. */
const DUST_SIZE_A = 8.08;
const STEP = 1;
const CHIRALITY_EPSILON = 0.01;
/** v3.67 multi-scale lowpass ladder — ÅNGSTRÖM units (`volume gaussian
 * sDev σ` takes the map's physical units, so the pyramid no longer
 * depends on voxel size). The GLOBAL search runs at σ 8 Å (FWHM ≈ 19 Å
 * — the molecular envelope, wide smooth basins where random placements
 * converge), refinement and the track decision at σ 3 Å (FWHM ≈ 7 Å —
 * enough detail to discriminate poses, still washing the
 * high-frequency noise that dragged full-resolution fits into wrong
 * local optima). */
const SIGMA_COARSE_A = 8;
const SIGMA_FINE_A = 3;
/** v3.67 NOISE MASK: fit targets are `volume threshold #ref minimum
 * <max·MASK_RATIO> set 0` clones of the reference — everything below
 * half the display contour level is zeroed, so only the reference's
 * SIGNAL ENVELOPE rewards a pose (fitmap samples the reference at ALL
 * grid points regardless of its display threshold — the un-masked
 * far-field solvent noise is exactly what used to reward wrong poses
 * and inflate scores on noisy maps). */
const MASK_RATIO = 0.5 * LEVEL_RATIO;
/** v3.81 (round-41 “截图角度还是top view，不是side view”): the v3.77–80
 * oblateness GATE is REMOVED. The user selecting 膜蛋白视图=自动 IS the
 * statement “this is a membrane protein”; the gate (λmin/λmid < 0.75)
 * then second-guessed it on the real reference — whose envelope at the
 * too-low 0.25×max level carried protein-column + noise + micelle mass
 * and read “globular”, silently discarding the membrane view and
 * delivering the coverage ladder's face-down pick. The exact delivered
 * failure. The ratio is now LOGGED as diagnostics only. */
/** v3.81: probe acceptance for a side-view camera — the 2D second-moment
 * ANISOTROPY (sqrt(λmax/λmin) of the foreground mask) must beat the
 * TOP-BASELINE probe (the camera looking straight down the PCA normal —
 * guaranteed face-on, anisotropy ≈ 1 for any flattened particle) by
 * this factor, or clear the absolute bar. Unlike the v3.80 bbox-aspect
 * band rule it survives column+disk shapes (TMEM175's side silhouette
 * is NOT a wide band) and stray speckle (second moments barely move for
 * a few stray blobs, while a bbox jumps to the strays). */
const MEMBRANE_ANISO_ABS = 1.15;
const MEMBRANE_ANISO_REL = 1.06;
/** v3.81: the acceptance floor for the turn-grid SCAN winner (slightly
 * laxer — the scan grid quantises to ~11°; anything this low falls back
 * with a clear log). */
const MEMBRANE_SCAN_MIN_ANISO = 1.1;
/** v3.82 (round-42 “角度和level还是不对”): the STANDING thresholds — the
 * mass-centroid vertical offset (measureRender.standing) of a standing
 * membrane particle (head/belt asymmetric along the normal) is the
 * PRIMARY side-view signal, because anisotropy alone maximises the long
 * axis HORIZONTAL (the lying view — the delivered v3.81 failure on
 * TMEM175: big soluble head + belt-heavy transmembrane half read
 * near-isotropic at the too-low level, the PCA normal was arbitrary, and
 * the aniso-vs-top probes could not tell the oblique camera from a side
 * view). STANDING_ACCEPT gates the direct camera candidates;
 * STANDING_SCAN_NEED gates the turn-grid scan winner (the grid quantises
 * to ~11°). Both sit well under the ≈0.10–0.20 a clean standing mushroom
 * reads and far above the ≈0.02 a face-down disc reads. */
const STANDING_ACCEPT = 0.06;
const STANDING_SCAN_NEED = 0.08;
/** v3.82: a class map whose render at the shared camera reads below this
 * gets its OWN orientation assist (its fitmap alignment landed off-axis —
 * the delivered J9/J48 ab-initio obliques). v3.89: the assist is now the
 * LAST tier of the silhouette matching (see SILHOUETTE_GOOD below) — it
 * still stands a map up when nothing yaw-like can match the reference. */
const STANDING_ASSIST_TRIGGER = 0.05;
/** v3.89 (round-49 “中间过程的map角度还是不对 — J9 斜视 / J48 俯视，与
 *  参考图侧视不一致”): the REFERENCE-ANCHORED SILHOUETTE MATCHING
 *  thresholds. Every non-reference map's probe render at the shared camera
 *  is IoU-matched (maskIou, main-component masks) against the reference's
 *  CACHED shared-view silhouette:
 *    tier 1 — IoU ≥ SILHOUETTE_GOOD at the shared view: the fitmap pose
 *      shows the reference's face; keep it (most maps stop here);
 *    tier 2 — yaw scan (turn y ±30…180 around the screen vertical) with
 *      the best IoU ≥ GOOD: the fit landed yawed (the deck-8 J48 end-on
 *      views); apply the winning yaw — the map shows its OWN side view in
 *      the reference's viewing frame (what the reader compares);
 *    tier 3 — the v3.82 standing assist (own belt-PCA camera / standing
 *      scan) + the same yaw scan around IT: a face-down or tilted fit no
 *      yaw can rescue; the assist stands it up and the yaw scan fixes the
 *      belt camera's in-plane degeneracy, then the better of tiers 2/3
 *      wins by IoU.
 *  Below SILHOUETTE_WEAK even at the best yaw the map genuinely does not
 *  look like the reference (a junk class / a near-symmetric blob) — the
 *  shared view is KEPT (the reader still sees the same viewing direction)
 *  and the log says so honestly. The standing sign fix (turn x 180) still
 *  rolls a chosen view whose heavy end contradicts the reference's.
 *  Calibration (the E2E mock shapes): same-pose head-radius variants
 *  IoU ≈ 0.75+, disc-vs-standing ≈ 0.55, head-up-vs-head-down ≈ 0.45. */
const SILHOUETTE_GOOD = 0.6;
const SILHOUETTE_WEAK = 0.3;
/** v3.89: the yaw scan order — the 90° family first (the dominant
 *  fit-failure mode: end-on vs side), then 45°/30° obliques, early-exit
 *  as soon as a candidate clears SILHOUETTE_GOOD. Camera-space turns only
 *  — every model keeps its fitted pose (the delivered maps stay aligned). */
const SILHOUETTE_YAWS = [90, -90, 180, 45, -45, 135, -135, 30, -30, 60, -60, 120, -120, 150, -150];
/** v3.82: the level KNEE ladder (×max, log-spaced) — v3.85 (round-45):
 *  probed only AFTER the script anchor 0.15×max (auto_color_locres.py)
 *  fails its verification; the pick is the clean rung CLOSEST to the
 *  anchor. The old bottom-up “lowest clean” sweep (+ the downward
 *  refinement) optimised toward the noise floor — the reverse of the
 *  expert workflow (see kneeLevelFor). Ratios reach 0.9 because a
 *  noise-spike max can push every map-specific histogram rule into the
 *  noise band (the delivered J48 snowballs sat at 0.25×max below their
 *  noise floor). */
const LEVEL_KNEE_RATIOS = [0.05, 0.08, 0.12, 0.18, 0.26, 0.36, 0.5, 0.7, 0.9];
/** v3.82: the knee cleanliness bars — fragmentation (1 − main/foreground)
 * ≤ KNEE_FRAG_MAX kills snowball speckle AND free micelle blobs (they are
 * disconnected components); mainCov ≥ KNEE_MAIN_MIN_FRAC × the ladder's
 * best kills the sponge regime (a too-high level hollows the particle
 * into a small porous core — the delivered J41-class3 sponge). */
const KNEE_FRAG_MAX = 0.08;
const KNEE_MAIN_MIN_FRAC = 0.45;
/** v3.86 (round-46 “不同的map可能需要给不同的倍率才行”): the knee cleanliness
 *  bar for ENCLOSED holes (measureRender.holes) — a clean protein surface
 *  silhouette reads 0–2 (a face-on torus/pore = 1), a lace/sponge/noise-gap
 *  render reads many. The v3.85 frag bar could not see these: the delivered
 *  round-45 reference was a CONNECTED cauliflower at 0.15×max (below the
 *  noise floor of a sharpened map) and passed every fragmentation check. */
const KNEE_HOLE_MAX = 6;
/** v3.86: the FAST-PATH main-coverage floor — the knee probes re-frame
 *  with bare `view` (the silhouette fills the frame), so a healthy
 *  particle reads ≫10% of the probe whatever its size; a degenerate
 *  hollow/thin-shell render (the belt=mid drill's ring at 1.7%, a
 *  too-high level on a sparse hot tail) reads ≪5%. Without this floor
 *  the anchor fast-path accepted the drill's 0.54 ring (frag 0, holes 1)
 *  and never walked to the clean 0.5 rung. */
const KNEE_FAST_MAIN_MIN = 0.03;
/** v3.86: band oblateness (λmin/λmid) at or below which a density band from
 *  the relay's 3-phase split counts as the DETERGENT BELT (a flat torus);
 *  a band that mostly caught protein mass sits near 1. */
const BELT_OBLATE_MAX = 0.6;
/** v3.86: sanity bars on the 3-phase splits — a solvent split above half
 *  the max or a mid|high split above 0.9×max means otsu₂ degenerated on
 *  this map's histogram (single-phase map, noise spike, …) and the split
 *  must not drive anything. */
const BELT_SPLIT_T1_MAX_RATIO = 0.5;
const BELT_SPLIT_T2_MAX_RATIO = 0.9;
/** v3.86: the display anchor's clamp (×max) and the ALIGNMENT mask cap —
 *  the mask target must keep enough mass for fitmap to score, so a
 *  protein-only threshold never rises above half the map's max. */
const ANCHOR_MIN_RATIO = 0.02;
const ANCHOR_MAX_RATIO = 0.9;
const MASK_LEVEL_CAP_RATIO = 0.5;
/** v3.80: the scan grids — coarse elevation × azimuth about the screen
 * axes (named-axis `turn x/y` only, valid on every ChimeraX build; the
 * ±-symmetric elevation set makes the undocumented turn DIRECTION
 * irrelevant), then two halving refinement rounds around the best
 * cell. Azimuth [0°, 180°) suffices: the band aspect is symmetric
 * under ψ → ψ+180°. */
const MEMBRANE_SCAN_ELEVATIONS = [0, 45, 90, -45, -90];
const MEMBRANE_SCAN_AZIMUTHS = [0, 45, 90, 135];
/** v3.82: the in-plane ROLL refinement grid (named `turn z` from the
 * standing winner) — the disk's LONG in-plane axis should end up
 * horizontal (round-38 “去垢剂盘放在xz平面”); the roll maximises the
 * silhouette's width aspect. */
const ROLL_SCAN_ANGLES = [0, 30, 60, 90, -30, -60, -90];
/** v3.66: random placements for the global fitmap search's FIRST
 * round — covers arbitrary rotations (90°/any tilt), the pose space the
 * fixed 180°-pre-turn candidates of v3.63 could never reach. v3.68:
 * every APPENDED round escalates the count (SEARCH_PLACEMENTS × round). */
const SEARCH_PLACEMENTS = 30;
/** v3.68 (round-27 “能设置成如果 correlation 没有达到指定目标，则增加
 * 搜索轮次吗？”): the ALIGNMENT TARGET correlation. It is BOTH the
 * round-1 SKIP threshold (a local track already at the target needs no
 * random search — v3.67 skipped at 0.80, letting 0.80–0.85 maps through
 * unsearched) AND the ESCALATION trigger: while the best fine-scale
 * correlation stays below the target, MORE global-search rounds run,
 * each a fresh random-placement sample with an escalating count, until
 * the target is met or SEARCH_MAX_ROUNDS is exhausted. v3.69 (round-28
 * “correlation 达到一定数值就可以跳过某些之前必须要做的对比工作”)
 * adds the two EARLY EXITS on the same number: a map whose INCOMING
 * pose already measures ≥ target skips the fits outright (静止达标),
 * and an original hand that validated a pose skips the MIRROR hand
 * entirely (镜像跳过). 0.85: the masked σ3 Å cosine of a
 * genuinely-aligned same-pipeline map sits well above this. Override
 * per run via RenderMapsOptions.corrTarget. */
const CORR_TARGET = 0.85;
/** v3.68: the per-hand cap on global-search rounds (placements escalate
 * 30 → 60 → 90 … = SEARCH_PLACEMENTS × round). A fully-failing map
 * costs at most 180 placements total; a map that reaches the target in
 * round 1 pays exactly the v3.67 price. Override via
 * RenderMapsOptions.searchMaxRounds. */
const SEARCH_MAX_ROUNDS = 3;
/** v3.66: the global search can legitimately run minutes on big maps —
 * it gets its own (longer) /exec timeout; a timeout disables the search
 * for the rest of the run instead of stalling every hand. v3.68: the
 * timeout now SCALES with the placement count (300 s at 30 → 450 s at
 * 60 → 600 s at 90, capped at 10 min) so a bigger appended round can
 * never be killed by the round-1 timeout. */
const FIT_SEARCH_TIMEOUT_MS = 300_000;
/** v3.71 (round-30 “可以增加用EMalign先确定reference的手性是否正确吗？
 * 或者手动指定reference的手性是否正确”): the margin the MIRROR-hand
 * score must exceed the original-hand score by (fitting the same
 * known-hand anchor into the reference vs. its z-flip) before the
 * reference is declared mirrored — keeps a noisy / symmetric anchor fit
 * from flipping the reference on a coin toss. */
const HAND_VERIFY_MARGIN = 0.05;
const THUMB_SIZE = 220;
const SNAPSHOT_W = 1600;
const SNAPSHOT_H = 1200;
/** v3.52 (round-11 “颜色依次…”): per-request Chimera default open-color
 *  for the map's class position (grey → pale yellow → violet → lavender →
 *  tan → …). A single-map stage = class 1 = grey. Missing → grey. */
function requestColor(req: { color?: string }): string {
  return /^#[0-9a-fA-F]{6}$/.test(req.color ?? "") ? (req.color as string) : chimeraClassColor(0);
}

/** v3.77 (round-37 “level不能太高，要不看到都是去垢剂，看不到内部的helix
 * 细节了”) → v3.79 (round-39 “用最大的25%会不会更好？”) → v3.80 (round-40
 * “level的选择还是不正常”) → v3.81 (round-41 “level取得还是不好，还是会看
 * 到胶束”): the screenshot DISPLAY contour level for one map, from its own
 * volume statistics. The FIT levels stay at the tuned 0.25×max — this policy
 * only re-levels a model right before ITS screenshot, so alignment behavior
 * is untouched.
 *
 * v3.80 delivered the LITERAL 0.25×max everywhere and the user's deck came
 * back speckled with free micelles: a map's max is a SINGLE hot spike
 * (noise on raw ab-initio volumes, detergent heads on the reference), so
 * every max-ratio rule lands wherever that spike happens to sit — below the
 * noise floor on the class maps (the speckle), at/above the micelle band on
 * the reference. v3.81 replaces the guessing with a SELF-CALIBRATING
 * chain:
 *   1. reference: min(0.25×max, 0.85×otsu2) — otsu2 is the second Otsu
 *      over the envelope (protein/detergent-phase split), so on a
 *      hot-detergent map the level drops into the protein window while a
 *      normal map keeps the long-accepted 0.25×max (otsu2 is high, the
 *      min picks 0.25×max);
 *   2. every other map: the level whose above-level voxel count equals
 *      the reference's at ITS chosen level (same particle ⇒ same envelope
 *      mass — the exact workflow of an expert contouring each map to the
 *      same size as the reference). Count-matching is spike-immune by
 *      construction: a noisy map must RAISE its level until only the
 *      reference-mass envelope remains, which is by definition above its
 *      noise floor.
 * Old relays (no otsu2/ladder keys) degrade to 0.25×max + an upgrade
 * hint in the log; manual mode keeps the ratio×max override (the ratio
 * then anchors the reference, class maps still count-match when the
 * ladder exists). */
export interface DisplayLevelChoice {
  level: number;
  /** Which rung produced the level — for the run log. */
  rule: string;
  /** v3.81: the reference-envelope anchor this level matched (diagnostics
   * for the run log; null when the ladder was unavailable). */
  matchedCount?: number;
}

/** v3.81: the reference's envelope anchor — its chosen display level and
 * the above-level voxel count every other map's level will match. */
export interface LevelAnchor {
  level: number;
  count: number | null;
}

/** v3.81: above-level voxel count at `level`, interpolated on the relay's
 * envelope ladder (monotone decreasing counts over rising levels). null
 * when the ladder is missing or the level is outside it. */
function envelopeCountAt(stats: BridgeVolStats, level: number): number | null {
  const lv = stats.envLevels;
  const ct = stats.envCounts;
  if (!lv || !ct || lv.length !== ct.length || lv.length < 2) return null;
  if (level <= lv[0]) return ct[0];
  if (level >= lv[lv.length - 1]) return ct[ct.length - 1];
  for (let i = 1; i < lv.length; i++) {
    if (level <= lv[i]) {
      const l0 = lv[i - 1];
      const l1 = lv[i];
      const c0 = ct[i - 1];
      const c1 = ct[i];
      const t = (level - l0) / (l1 - l0 || 1e-12);
      return c0 + t * (c1 - c0);
    }
  }
  return ct[ct.length - 1];
}

/** v3.81 → v3.85 (round-45): the map's OWN auto rule is now the
 * user's auto_color_locres.py rule VERBATIM — full-matrix max × 0.15
 * (`em_map.data.full_matrix().max() * 0.15`). The v3.79–81
 * min(0.25×max, 0.85×otsu₂) clamp is gone — the `surface dust` cleanup
 * handles the small disconnected junk those histogram rules were
 * fighting, and every max-ratio fight was really a fight against one
 * hot spike that the dust now hides. */
function autoLevelFor(stats: BridgeVolStats): DisplayLevelChoice | null {
  if (!Number.isFinite(stats.max) || stats.max <= 0) return null;
  return {
    level: stats.max * SCRIPT_LEVEL_RATIO,
    rule: "0.15×max（auto_color_locres 脚本规则）",
  };
}

function displayLevelFor(
  stats: BridgeVolStats | null,
  policy: ContourLevelPolicy,
  refAnchor?: LevelAnchor | null,
): DisplayLevelChoice | null {
  if (!stats || !Number.isFinite(stats.max) || stats.max <= 0) return null;
  if (policy.mode === "manual") {
    /* clamped to the documented manual range (UI placeholder 0.01–0.9).
     * v3.82: the ratio applies DIRECTLY to every map (v3.80 semantics) —
     * the v3.81 experiment anchored the class maps by envelope-count
     * matching, and on the delivered P283 deck that delivered a sponge
     * (J41 class 3) and snowballs (J48): map value scalings differ, so a
     * matched count lands at the wrong level. The probe knee (auto mode)
     * is the calibrated path; manual is the expert override. */
    const ratio = Math.min(Math.max(Number.isFinite(policy.ratio) ? policy.ratio : LEVEL_RATIO, 0.01), 0.9);
    return { level: stats.max * ratio, rule: `手动 ${ratio}×max` };
  }
  /* auto AND classic (the classic option stays accepted so stored
   * settings keep working): NON-PROBE fallback only (REST transport /
   * volstats hiccup) — on probe-capable transports the rendered knee
   * decides. Falls back to the map's own v3.81 auto rule. */
  void refAnchor;
  return autoLevelFor(stats);
}

/** v3.86 (round-46 “角度和align还是存在一些问题…另外不同的map可能需要
 *  给不同的倍率才行”): the PER-MAP belt-band adaptive anchor, derived from
 *  the map's OWN 3-phase histogram split (relay /membrane2, otsu₂ over the
 *  full matrix). The fixed 0.15×max script rule delivered a CONNECTED
 *  cauliflower on the sharpened reference (its max is a noise-boosted
 *  spike, so 0.15×max sat BELOW the noise floor) while the frag probe
 *  stayed ≈0 — a fixed multiplier cannot serve maps with different value
 *  scalings. The split adapts per map:
 *    - t1 = the solvent|signal boundary — nothing below it is signal;
 *    - t2 = the mid|high boundary — when the detergent belt occupies the
 *      MID band (colder than protein), t2 is the classic “raise the level
 *      to hide the micelle” value: above it only protein renders;
 *    - the OBLATE band (λmin/λmid ≤ BELT_OBLATE_MAX) identifies WHICH
 *      phase the belt is in (a flat torus); when the belt is the HIGH
 *      band (hot detergent) no threshold can hide it — anchor at the
 *      noise floor t1 instead and say so honestly.
 * `proteinLevel` (the belt-hiding threshold, capped at half-max) feeds
 *  BOTH the display knee anchor and the ALIGNMENT mask targets (the
 *  user's “align 去掉去垢剂后进行” — belt-phase density zeroed out of
 *  the fitmap target so belt-on-belt overlap no longer rewards arbitrary
 *  in-plane rolls). */
export interface BeltLevelInfo {
  /** [solvent|mid, mid|high] splits (absolute values) — null when the
   *  split was missing or degenerate. */
  t1: number | null;
  t2: number | null;
  /** which phase the oblate belt band sits in — null when no band is
   *  oblate enough to be the belt. */
  beltBand: "mid" | "high" | null;
  beltRatio: number | null;
  /** the protein-only threshold when the belt sits BELOW the protein
   *  (belt = mid band): min(t2, MASK_LEVEL_CAP_RATIO×max). Null when the
   *  belt is hotter than the protein or no belt was found. */
  proteinLevel: number | null;
  /** the DISPLAY anchor (absolute value; NaN when nothing is known —
   *  callers fall back to their own rule). */
  anchor: number;
  /** the anchor's provenance for the run log. */
  anchorRule: string;
}

/** v3.86: derive the belt-band anchor from a /membrane2 reply + the
 *  model's own /volstats — pure, exported for the offline harness. */
export function beltLevelFrom(
  m2: Membrane2Reply | null,
  stats: BridgeVolStats | null,
): BeltLevelInfo {
  const out: BeltLevelInfo = {
    t1: null,
    t2: null,
    beltBand: null,
    beltRatio: null,
    proteinLevel: null,
    anchor: NaN,
    anchorRule: "",
  };
  const max = stats?.max ?? 0;
  const script = max > 0 ? max * SCRIPT_LEVEL_RATIO : NaN;
  if (!m2 || !m2.splits || max <= 0 || !Number.isFinite(max)) {
    out.anchor = script;
    out.anchorRule = "脚本规则 0.15×max（无三相分割 — 旧桥或信封过小）";
    return out;
  }
  const [t1, t2] = m2.splits;
  if (
    !(t2 > t1) ||
    !(t1 > 0) ||
    t1 > max * BELT_SPLIT_T1_MAX_RATIO ||
    t2 > max * BELT_SPLIT_T2_MAX_RATIO
  ) {
    out.anchor = script;
    out.anchorRule = "脚本规则 0.15×max（三相分割退化 — 直方图无三相结构）";
    return out;
  }
  out.t1 = t1;
  out.t2 = t2;
  const bands = (m2.bands ?? []).filter((b) => b.count >= 64);
  const belt = bands.filter((b) => b.ratio > 0 && b.ratio <= BELT_OBLATE_MAX).sort((a, b) => a.ratio - b.ratio)[0] ?? null;
  if (belt) {
    out.beltBand = belt.name === "high" ? "high" : "mid";
    out.beltRatio = belt.ratio;
  }
  if (belt && out.beltBand === "mid") {
    /* belt colder than protein: t2 hides it (the classic micelle-hiding
     * level), the script level kept when it already sits above t2. */
    out.proteinLevel = Math.min(t2, max * MASK_LEVEL_CAP_RATIO);
    out.anchor = Math.max(script, t2);
    out.anchorRule = `胶束带自适应（三相分割 t1=${t1.toFixed(4)} / t2=${t2.toFixed(4)}；${belt.name} 相带扁率 ${belt.ratio.toFixed(2)} = 胶束 → 锚点 t2 隐去胶束）`;
  } else if (belt && out.beltBand === "high") {
    /* hot detergent: no threshold can hide the belt (protein would vanish
     * first) — the anchor only clears the noise floor, honestly logged. */
    out.anchor = Math.max(script, t1);
    out.anchorRule = `噪声底自适应（三相分割 t1=${t1.toFixed(4)} / t2=${t2.toFixed(4)}；${belt.name} 相带扁率 ${belt.ratio.toFixed(2)} = 胶束且比蛋白更热 — 阈值无法隐去胶束，锚点过噪声底 t1）`;
  } else {
    out.anchor = Math.max(script, t1);
    out.anchorRule = `噪声底自适应（三相分割 t1=${t1.toFixed(4)} / t2=${t2.toFixed(4)}；无扁率相带 → 锚点 max(0.15×max, t1) 过噪声底）`;
  }
  out.anchor = Math.min(Math.max(out.anchor, max * ANCHOR_MIN_RATIO), max * ANCHOR_MAX_RATIO);
  return out;
}

export type ChiralityStatus = "consistent" | "corrected" | "ambiguous" | "unknown";

export interface FigureMapRequest {
  /** Canonical map key: "<uid>/<group>" (matches the PPTX image markers). */
  key: string;
  uid: string;
  group: string;
  /** v3.52: Chimera default open-color for this map's class position
   *  ("#b2b2b2" class 1 …) — sent as `color #<id> <hex>`; grey if absent. */
  color?: string;
  /** Absolute URL ChimeraX can `open` (CryoSmart intranet URL or app asset). */
  sourceUrl: string;
}

export interface CandidateRow {
  candidate: string;
  score: number | null;
  pre: number | null;
  fit1: number | null;
  fit2: number | null;
  ok: boolean;
  note?: string;
  /** v3.64: FULL-RESOLUTION correlation measured on the ORIGINAL map
   * AFTER the lowpass-found pose was applied to it (null when the lowpass
   * path was not used) — proves the transferred angle works at the
   * resolution that actually gets screenshotted. v3.66: this is the
   * HONEST ranking score — both hands are compared by it. v3.67:
   * measured against the NOISE-MASKED full-res reference (signal
   * envelope only), so the number ranks poses by signal agreement,
   * not by how much far-field noise happens to correlate. */
  post?: number | null;
}

export interface MapRender {
  key: string;
  uid: string;
  group: string;
  candidate: string;
  score: number | null;
  chirality: ChiralityStatus;
  rows: CandidateRow[];
  png: Uint8Array | null;
  /** ChimeraX model id of the kept (best) candidate — used for screenshots. */
  modelId: number | null;
}

export interface RenderProgress {
  phase: string;
  pct?: number;
  log?: string;
}

export interface RenderMapsOptions {
  reference: FigureMapRequest;
  maps: FigureMapRequest[];
  onProgress?: (p: RenderProgress) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  /** v3.71: how the reference's OWN biological hand is established
   *  BEFORE per-map alignment (the default ladder only judges hands
   *  RELATIVE to the reference; anchor/manual ground the figure's hand
   *  — see ReferenceHandPolicy). */
  referenceHand?: ReferenceHandPolicy;
  /** v3.68: the alignment-target correlation — while the best
   *  fine-scale correlation (local track vs. best search round) stays
   *  below it, more global-search rounds run with escalating placement
   *  counts. v3.69: the same number also gates the early exits — an
   *  incoming pose already at the target skips the fits, and a
   *  validated original hand skips the mirror hand. Default
   *  CORR_TARGET (0.85); clamped to [0.1, 0.999]. */
  corrTarget?: number;
  /** v3.68: the per-hand cap on global-search rounds (placements
   *  escalate SEARCH_PLACEMENTS × round). Default SEARCH_MAX_ROUNDS
   *  (3); clamped to [1, 6]. */
  searchMaxRounds?: number;
  /** v3.77/v3.78: the membrane-protein view orientation (see
   *  MembraneViewOptions) — stands the detergent disk in the screen XZ
   *  plane (membrane normal vertical, disk long axis horizontal) via the
   *  relay's /membrane PCA before the screenshots. */
  membraneView?: MembraneViewOptions;
  /** v3.77: the screenshot DISPLAY contour level policy (see
   *  ContourLevelPolicy / displayLevelFor). Alignment fit levels are
   *  unaffected. */
  contourLevel?: ContourLevelPolicy;
}

/** v3.71 (round-30 “可以增加用EMalign先确定reference的手性是否正确吗？
 * 或者手动指定reference的手性是否正确”): how the reference map's OWN
 * biological handedness is established BEFORE any per-map alignment.
 * The v3.66–70 ladder only ever judged hands RELATIVE to the reference —
 * if the reference itself is mirrored (e.g. a wrong-hand ab-initio
 * initial model poisoned the whole project), every map aligns
 * consistently into a MIRRORED figure and nothing in the pipeline can
 * tell. Three policies ground the hand instead:
 *  - "auto": no verification (default; pre-3.71 behavior — the
 *    reference is taken as-is and every map's hand reads relative to
 *    it).
 *  - "anchor": EMalign-style verification — a KNOWN-HAND anchor
 *    (a PDB/mmCIF atomic model, or an already-published map of correct
 *    hand; `anchor` = a path/URL the ChimeraX machine can open) is
 *    fitted into the reference AND its z-flip with the SAME fit
 *    command; the better-scoring hand IS the reference's true hand
 *    (fitmap reports `correlation` for map anchors and `Average map
 *    value` for atomic ones — both comparable across the two hands
 *    because a z-flip preserves the value distribution). A mirrored
 *    verdict (score margin HAND_VERIFY_MARGIN) swaps the canonical
 *    reference to the flipped copy BEFORE the view scoring, the σ
 *    pyramid, the noise masks and every per-map fit, so the whole
 *    figure stands on the biologically-correct hand.
 *  - "manual": the user asserts the hand — "correct" keeps the
 *    reference as-is; "mirrored" flips it once up front (same swap).
 * Once the hand is established, every per-map chirality verdict also
 * gains its biological meaning (matched without flip ⇒ the raw map's
 * own hand is correct; needed flip_z ⇒ it was mirrored). */
export interface ReferenceHandPolicy {
  mode: "auto" | "anchor" | "manual";
  /** anchor mode: an absolute path on the ChimeraX machine, or a URL
   *  ChimeraX can open (PDB/mmCIF model or a known-hand map). */
  anchor?: string;
  /** manual mode: the user's assertion about the reference's hand. */
  manual?: "correct" | "mirrored";
}

/** v3.77 (round-37 “map的角度可能需要择优后再截图，尤其是膜蛋白…包内区
 *  朝下，包外区朝上”) / v3.78 (round-38 “之前说错了，应该是去垢剂盘放在
 *  xz平面”): the membrane-protein screenshot orientation — the classic
 *  SIDE view. */
export interface MembraneViewOptions {
  /** "auto": density-weighted PCA on the reference (relay /membrane, run
   *  inside ChimeraX on the open model) finds the membrane normal — the
   *  smallest-variance principal axis of the oblate protein+micelle
   *  particle. The camera is built so the normal runs VERTICALLY on
   *  screen (screen up) and the disk's longest in-plane axis runs
   *  horizontally: the detergent disk stands in the screen XZ plane, the
   *  belt reads as a horizontal band and the transmembrane helices cross
   *  it vertically (包内区朝下、包外区朝上 — which of ±normal is the
   *  extracellular side cannot be derived from density; see flip). The
   *  v3.77 top-down view (camera straight down the normal) hid the
   *  protein under the micelle slab and is gone. v3.81: the oblateness
   *  ratio guard is REMOVED (selecting auto IS the membrane statement —
   *  the ratio is logged as diagnostics); falls back to the turn-grid
   *  scan (save+fetch only) when the relay predates /membrane or the
   *  endpoint errors, and to the 90° coverage ladder only when the
   *  camera commands are rejected AND the scan finds no side view.
   *  "off": pre-3.77 coverage scoring (best for soluble proteins). */
  mode: "off" | "auto";
  /** Roll 180° about the screen horizontal axis so the OTHER membrane
   *  side points up (the protein's other face shows — a rolled-over
   *  disk): once the disk stands in the XZ plane, WHICH side (包内/包外)
   *  is up cannot be derived from density alone — the default picks the
   *  normal sign deterministically (first significant component in
   *  map-frame Y/Z/X order ≥ 0, reproducible per map); flip when the
   *  biology says the other side belongs up (e.g. 包外区 should point
   *  up but points down). */
  flip?: boolean;
}

/** v3.77: the screenshot DISPLAY contour level policy (see
 *  displayLevelFor). Fit levels stay 0.25×max — only the visible contour
 *  changes, never the fit targets. */
export type ContourLevelPolicy =
  | { mode: "auto" }
  | { mode: "classic" }
  | { mode: "manual"; ratio: number };

/** v3.72 (round-31 交付文件下载 — 所有的 map 都要是纠正过手性的): the
 *  structured form of the v3.71 reference-hand verdict, read by the
 *  delivery phase: when the canonical reference was swapped to its
 *  z-flipped copy (`flipped: true`), the RAW delivery maps are
 *  biologically MIRRORED and every delivered map must be z-flipped the
 *  same way; `known: false` is the auto policy (relative chirality only
 *  — maps deliver as-is, consistent with the reference the figure used). */
export interface ReferenceHandVerdict {
  /** Was the reference's own hand established (anchor/manual policy)? */
  known: boolean;
  /** True when the canonical reference became the z-flipped copy — the
   *  raw reference map (and every same-hand raw map) is mirrored. */
  flipped: boolean;
  /** v3.74 (round-33 review): the manual-mirrored policy FAILED to flip
   *  the reference in-figure (flipReference threw) — the run rendered
   *  against the still-mirrored reference. The raw maps are mirrored all
   *  the same (they matched the mirrored reference as-is), so the
   *  delivery phase flips every map for THIS verdict too — a state
   *  `flipped: true` alone could not express. */
  flipFailed?: boolean;
  /** Human-readable verdict ("EMalign 验证镜像 · 已翻正（0.31 vs 0.94）" …). */
  verdict: string;
}

export interface RenderMapsResult {
  renders: MapRender[];
  view: { desc: string; x: number; y: number; score: number };
  referenceKey: string;
  logs: string[];
  /** v3.72: the reference-hand verdict (structured form of the reference
   *  render row's candidate note) — drives the delivery chirality flip. */
  referenceHand: ReferenceHandVerdict;
  /** v3.77: the membrane-view outcome (only set when membraneView was
   *  requested) — surfaced in the run report / result panel. */
  membrane?: MembraneViewReport;
}

/** v3.77: what the membrane orientation actually did (or why it didn't). */
export interface MembraneViewReport {
  applied: boolean;
  /** λmin/λmid from the reference PCA (null when detection never ran). */
  ratio: number | null;
  /** The detected membrane normal (scene frame, reference grid axes). */
  normal: [number, number, number] | null;
  /** v3.82: how the applied orientation was found/verified (the run log
   * line suffix — "胶束带 PCA 直连 · 站立度 0.14" / "turn 网格扫描 · 站立度
   * 0.12" / "文档相机直连（探针无法区分）" …). */
  via?: string;
  /** v3.82: the applied orientation's STANDING score (mass-centroid
   * vertical offset of the verified render) — null when unmeasured. */
  standing?: number;
  /** Human-readable summary for the run log / result panel. */
  note: string;
}

function threw(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function exec(
  t: FlowTransport,
  command: string,
  opts: RenderMapsOptions,
  soft = false,
  timeoutMs?: number,
): Promise<ExecResult> {
  // v3.66: exec never throws — a transient relay hiccup or a timeout on
  // ONE command (close/level/fit) must not kill a multi-minute render
  // run; the error rides back as ExecResult.error and every caller
  // already degrades on it. `timeoutMs` overrides bridgeExec's 180 s
  // default (the global fitmap search gets 300 s).
  let r: ExecResult;
  try {
    r = await bridgeExec(t, command, timeoutMs);
  } catch (err) {
    r = { text: "", error: err instanceof Error ? err.message : String(err) };
  }
  if (r.error && !soft) {
    opts.onLog?.(`! ${command} → ${r.error}`);
  }
  return r;
}

/**
 * Full pipeline: open reference → standardise the 90° view → per-map
 * two-hand two-track alignment + handedness check (v3.66) → per-map
 * screenshot.
 */

/** v3.67 candidate command shapes for Gaussian smoothing / threshold
 * masking — the run probes them lazily (exactly like the v3.66 fit
 * command probe). v3.64–66 hard-coded `vgaussian #id sigma N`, which is
 * NOT a documented ChimeraX command — the real one is `volume gaussian
 * <spec> sDev σ` (σ in the map's physical units, Å), with `vop gaussian`
 * on legacy builds — so on the real machine every smoothing call errored
 * and the whole lowpass pyramid silently degraded to FULL-RESOLUTION
 * fits: the noise-dominated regime where only the already-near-aligned
 * maps happened to converge. */
const VOL_GAUSSIAN_SHAPES = [
  { cmd: "volume gaussian", kw: "sDev" },
  { cmd: "vop gaussian", kw: "sDev" },
  { cmd: "vgaussian", kw: "sDev" },
  { cmd: "vgaussian", kw: "sigma" },
];
/** v3.67: threshold-zero clone shapes (`volume threshold #id minimum L
 * set 0` — values below L become exactly 0: the noise mask). */
const VOL_THRESHOLD_SHAPES = ["volume threshold", "vop threshold"];

export async function renderFigureMaps(
  t: FlowTransport,
  opts: RenderMapsOptions,
): Promise<RenderMapsResult> {
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(line);
    opts.onLog?.(line);
  };
  const progress = (phase: string, pct?: number) => opts.onProgress?.({ phase, pct });
  const openIds = new Set<number>();

  /* ---- 0. v3.55 (round-14 “开始截图之前要先关闭掉过去已打开的 map”) ----
   * Every earlier run left its aligned models open in ChimeraX, and this
   * run's hide-all step only covered ITS OWN openIds — so the previous
   * run's maps swept into every screenshot. Close what is open NOW, BEFORE
   * the reference map loads: precisely over the relay's /volumes (volume
   * models only — anything else the user has open stays), falling back to
   * `close all` when the relay predates /volumes (or on the official REST
   * transport, which can run commands but has no file listing). */
  progress("清理 ChimeraX 已打开的地图", 2);
  const leftoverVols = await bridgeVolumeIds(t);
  if (leftoverVols != null) {
    if (leftoverVols.length) {
      for (const v of leftoverVols) {
        await exec(t, `close #${v.id}`, opts, true);
      }
      log(`已关闭 ChimeraX 中残留的 ${leftoverVols.length} 个地图（上次运行/手动打开: ${leftoverVols.map((v) => `#${v.id}`).join(" ")}) — 本次截图不再混入旧图`);
    } else {
      log("ChimeraX 中无残留地图 — 截图环境干净");
    }
  } else {
    await exec(t, "close all", opts, true);
    log("已执行 close all 关闭既有模型（旧版桥脚本无 /volumes 精确清单 — 建议在 ChimeraX 重新运行一次 relay.py 获取精确清理），本次截图不再混入旧图");
  }

  /* ---- 1. reference ---- */
  progress("打开参考地图", 4);
  let refLevel: number | null = null;
  const openRef = await bridgeOpenModel(t, opts.reference.sourceUrl);
  // v3.71: `let` — the reference-hand policy below may SWAP the canonical
  // reference to its z-flipped copy (an anchor/manual "mirrored" verdict)
  // BEFORE anything downstream (view scoring, σ pyramid, noise masks,
  // per-map fits, screenshots) reads it.
  let refId = openRef.modelId;
  if (refId == null) {
    // v3.46: include WHAT ChimeraX actually said — the round-5 report carried
    // no error suffix at all (open clean, id unparsed), which was
    // undiagnosable from the outside.
    const detail = openRef.error
      ? `: ${openRef.error}`
      : ` — ChimeraX 未报错但未返回 model id（输出: ${logSnippet(openRef.text) || "(空)"}）`;
    throw new Error(`无法在 ChimeraX 中打开参考地图 (${opts.reference.sourceUrl})${detail}`);
  }
  openIds.add(refId);
  log(`参考地图 ${opts.reference.key} → model #${refId}${openRef.viaDelta ? "（id 经增量探测确认）" : ""}`);

  const refStats = await bridgeVolStats(t, refId);
  if (refStats) {
    refLevel = refStats.max * LEVEL_RATIO;
    await exec(t, `volume #${refId} level ${refLevel.toFixed(4)} step ${STEP}`, opts, true);
  } else {
    // Official-REST transport: try a sigma level, fall back to defaults.
    const sdTry = await exec(t, `volume #${refId} level 2 sd step ${STEP} style surface`, opts, true);
    if (sdTry.error) await exec(t, `volume #${refId} step ${STEP} style surface`, opts, true);
  }
  // v3.53 (round-12): NO set bgColor command — saves pass transparentBackground
  // true, so the PNGs carry an alpha channel (the reference deck's own media:
  // corner (0,0,0,0)) and the user's ChimeraX background is left untouched.
  // The reference map is colored via `volume #<id> color <hex>` — the volume
  // command's own option ("if one color is specified but no levels, the color
  // applies to all existing levels and becomes the default color for the
  // volume model" — ChimeraX volume docs); the previous `color #<id> <hex>`
  // targets ATOMS and silently no-ops on volume models, which is why the
  // user's round-12 deck came back with every map still default gray.
  const refColor = requestColor(opts.reference);
  await exec(t, `volume #${refId} color ${refColor}`, opts, true);
  await exec(t, "view pad 0.25", opts, true);
  await exec(t, "wait 1", opts, true);

  /* ---- 1.5 v3.71 (round-30 “可以增加用EMalign先确定reference的手性
   * 是否正确吗？或者手动指定reference的手性是否正确”): the reference
   * HAND policy — see ReferenceHandPolicy. Establishes the reference's
   * OWN biological hand BEFORE the view scoring, the σ pyramid, the
   * noise masks and every per-map fit, because everything downstream
   * reads `refId`: a "mirrored" verdict swaps the canonical reference to
   * its z-flipped copy ONCE, right here (and nothing downstream can
   * tell the difference — a flip of the flip is the original). */
  let refHandKnown = false;
  let refIsCorrectHand = true;
  let refHandVerdict = "";
  /* v3.72: did the canonical reference BECOME the z-flipped copy? The
   *  delivery phase reads this — a flipped reference means the raw
   *  delivery maps are mirrored and must be flipped on delivery. */
  let refFlipped = false;
  /* v3.74 (round-33 review): the manual-mirrored policy FAILED to flip the
   *  reference (flipReference threw) — the run continues against the still
   *  MIRRORED reference. The raw maps are then mirrored exactly like the
   *  flipped-verdict case (they match the mirrored reference as-is), so
   *  the delivery phase must STILL z-flip every map — `flipFailed` carries
   *  that "known-mirrored but not corrected in-figure" state across, where
   *  `flipped: true` alone ("the reference became the flipped copy") could
   *  not express it. */
  let refFlipFailed = false;
  /** Create the reference's z-flip copy, re-apply its display settings
   * and swap it in as the CANONICAL reference (the original closes).
   * Returns false when the flip fails (the run then keeps the original
   * and says so loudly). */
  const flipReference = async (): Promise<boolean> => {
    try {
      // local capture: `let refId` loses its null-narrowing inside a
      // closure (TS resets `let` narrowing there) — re-establish it once.
      const srcId = refId;
      if (srcId == null) throw new Error("参考地图无 model id");
      let fid: number | null = null;
      const next = await bridgeNextModelId(t);
      let res = next != null
        ? await exec(t, `volume flip #${srcId} axis z modelId ${next}`, opts, true)
        : null;
      if (res && !res.error) {
        /* v3.74: trust the explicit modelId — parsing the log could grab
         * the SOURCE map's id (or a submodel's) instead of the new volume. */
        fid = next;
      } else {
        res = await exec(t, `volume flip #${srcId} axis z`, opts, true);
        if (res && !res.error) fid = parseOpenModelId(res.text);
      }
      if (fid == null || fid === srcId) throw new Error("flip produced no model");
      if (refLevel != null) {
        await exec(t, `volume #${fid} level ${refLevel.toFixed(4)} step ${STEP}`, opts, true);
      }
      await exec(t, `volume #${fid} color ${refColor}`, opts, true);
      await exec(t, `close #${srcId}`, opts, true);
      openIds.delete(srcId);
      openIds.add(fid);
      refId = fid;
      refFlipped = true;
      return true;
    } catch (err) {
      log(`⚠ 翻转参考地图失败 — ${logSnippet(String(err), 140)}`);
      return false;
    }
  };
  {
    const policy = opts.referenceHand;
    if (policy?.mode === "manual") {
      if (policy.manual === "mirrored") {
        progress("按用户指定翻正参考手性", 6);
        log("参考手性: 按用户指定为镜像 — 生成前先把参考翻正（视角评分、低通金字塔、噪声屏蔽与全部对齐/截图都以翻正后的参考为基准）");
        if (await flipReference()) {
          refHandKnown = true;
          refIsCorrectHand = true;
          refHandVerdict = "手动指定镜像 · 已翻正";
          log(`参考手性: 已翻正 → model #${refId} — 流程图按生物学正确手性呈现`);
        } else {
          refHandKnown = true;
          refIsCorrectHand = false;
          refFlipFailed = true;
          refHandVerdict = "手动指定镜像 · 翻正失败（交付时仍将翻正）";
          log("⚠ 参考仍为镜像手性 — 各 map 的手性判定改按镜像参考推算（流程图将呈镜像视图）；交付阶段的全部 map 仍会经 z-flip 翻正后写出");
        }
      } else {
        refHandKnown = true;
        refIsCorrectHand = true;
        refHandVerdict = "手动指定正确";
        log("参考手性: 按用户指定为正确 — 以参考原样为基准（各 map 双手性对比判定相对手性）");
      }
    } else if (policy?.mode === "anchor" && policy.anchor && policy.anchor.trim()) {
      const anchorSrc = policy.anchor.trim();
      progress("验证参考手性（EMalign · 参照物对齐）", 6);
      log(`参考手性验证（EMalign）: 参照物 ${anchorSrc} — 将分别拟合进参考原手与其 z 镜像，得分高的一侧即参考的真实手性`);
      let anchorId: number | null = null;
      let flipRefId: number | null = null;
      try {
        if (threw(opts.signal)) throw new Error("aborted");
        // "auto" open kind: a PDB/mmCIF anchor (any-suffix URL, sniffed
        // local path) opens as-is instead of being forced to `format mrc`.
        const openA = await bridgeOpenModel(t, anchorSrc, 300_000, "auto");
        anchorId = openA.modelId;
        if (anchorId == null) {
          throw new Error(openA.error || logSnippet(openA.text) || "参照物打开失败（ChimeraX 未返回 model id）");
        }
        openIds.add(anchorId);
        {
          const next = await bridgeNextModelId(t);
          let fres = next != null
            ? await exec(t, `volume flip #${refId} axis z modelId ${next}`, opts, true)
            : null;
          if (fres && !fres.error) {
            flipRefId = parseOpenModelId(fres.text) ?? next;
          } else {
            fres = await exec(t, `volume flip #${refId} axis z`, opts, true);
            if (fres && !fres.error) flipRefId = parseOpenModelId(fres.text);
          }
          if (flipRefId == null || flipRefId === refId) throw new Error("参考 z 镜像副本生成失败");
          openIds.add(flipRefId);
        }
        /* The verification's OWN fit probe — deliberately SEPARATE from
         * the run-scoped fitShape the per-map ladder probes: an ATOMIC
         * anchor may reject `metric correlation envelope true`, and that
         * rejection must not degrade the main ladder's map-map fits.
         * Metric shapes come first (map anchors score better with the
         * cosine metric); bare shapes catch atomic anchors. */
        let vShape: { cmd: string; kw: string; extra: string } | null | undefined;
        const VERIFY_FIT_SHAPES: Array<{ cmd: string; kw: string; extra: string }> = [
          { cmd: "fitmap", kw: "inMap", extra: " metric correlation envelope true" },
          { cmd: "fitmap", kw: "in", extra: " metric correlation envelope true" },
          { cmd: "fitmap", kw: "inMap", extra: "" },
          { cmd: "fitmap", kw: "in", extra: "" },
          { cmd: "fit", kw: "inMap", extra: "" },
          { cmd: "fit", kw: "in", extra: "" },
        ];
        const vFit = async (cand: number, target: number, search: number): Promise<ExecResult | null> => {
          if (vShape === null) return null;
          for (const s of vShape ? [vShape] : VERIFY_FIT_SHAPES) {
            const r = await exec(
              t,
              `${s.cmd} #${cand} ${s.kw} #${target}${s.extra} search ${search}`,
              opts,
              true,
              FIT_SEARCH_TIMEOUT_MS,
            );
            if (!r.error) {
              if (vShape === undefined) {
                vShape = s;
                log(`参照物拟合命令: ${s.cmd} #N ${s.kw} #N${s.extra || ""} search N ✓ — 手性验证以该形态拟合`);
              }
              return r;
            }
          }
          if (vShape === undefined) {
            vShape = null;
            log("⚠ 参照物拟合命令（fitmap/fit）全部不可用 — 无法验证参考手性");
          }
          return null;
        };
        /** Score one verification fit: fitmap's own reported number
         * first (`correlation` for map anchors, `Average map value` for
         * an atomic anchor — both comparable across the two hands of the
         * SAME reference because a z-flip preserves the value
         * distribution), `measure correlation` as the last resort. */
        const vScore = async (cand: number, target: number, r: ExecResult | null): Promise<number | null> => {
          if (r) {
            const v = parseCorrelation(r.text) ?? parseAvgMapValue(r.text) ?? parseCorrelation(r.error);
            if (v != null) return v;
          }
          for (const s of ["inMap", "pos"] as const) {
            const cmd = s === "inMap"
              ? `measure correlation #${cand} inMap #${target}`
              : `measure correlation #${cand} #${target}`;
            const mr = await exec(t, cmd, opts, true);
            const v = parseCorrelation(mr.text) ?? parseCorrelation(mr.error);
            if (v != null) return v;
          }
          return null;
        };
        const rOrig = await vFit(anchorId, refId, SEARCH_PLACEMENTS);
        const corrO = rOrig ? await vScore(anchorId, refId, rOrig) : null;
        const rFlip = await vFit(anchorId, flipRefId, SEARCH_PLACEMENTS);
        const corrF = rFlip ? await vScore(anchorId, flipRefId, rFlip) : null;
        if (corrO != null && corrF != null) {
          log(`参考手性验证（EMalign）: 参照物拟合 参考原手 ${corrO.toFixed(4)} vs z 镜像 ${corrF.toFixed(4)}`);
          if (corrF > corrO + HAND_VERIFY_MARGIN && flipRefId != null) {
            log(`→ 判定: 参考为镜像手性（镜像得分高出 ${(corrF - corrO).toFixed(4)} ≥ 保证金 ${HAND_VERIFY_MARGIN}）— 翻正参考后再进行全部对齐`);
            /* the flip copy BECOMES the canonical reference — the same
             * swap as flipReference(), minus creating a second flip. */
            if (refLevel != null) {
              await exec(t, `volume #${flipRefId} level ${refLevel.toFixed(4)} step ${STEP}`, opts, true);
            }
            await exec(t, `volume #${flipRefId} color ${refColor}`, opts, true);
            await exec(t, `close #${refId}`, opts, true);
            openIds.delete(refId);
            refId = flipRefId;
            flipRefId = null; // consumed — the cleanup must not close it
            refHandKnown = true;
            refIsCorrectHand = true;
            refFlipped = true;
            refHandVerdict = `EMalign 验证镜像 · 已翻正（原手 ${corrO.toFixed(3)} vs 镜像 ${corrF.toFixed(3)}）`;
            log(`参考手性: 已翻正 → model #${refId} — 视角评分、低通金字塔、噪声屏蔽与全部对齐/截图均以翻正后的参考为基准`);
          } else {
            refHandKnown = true;
            refIsCorrectHand = true;
            refHandVerdict = `EMalign 验证正确（原手 ${corrO.toFixed(3)} vs 镜像 ${corrF.toFixed(3)}）`;
            log(`→ 判定: 参考手性正确（原手得分未低于镜像 − ${HAND_VERIFY_MARGIN}）— 保持原样，流程图按正确手性呈现`);
          }
        } else {
          log(
            `⚠ 参照物拟合未能读出可比较得分（原手 ${corrO != null ? corrO.toFixed(4) : "—"} / 镜像 ${corrF != null ? corrF.toFixed(4) : "—"}）— 参考手性验证失败，退回自动模式（参考原样，各 map 双手性对比判定相对手性）`,
          );
        }
      } catch (err) {
        log(`⚠ 参考手性验证失败 — ${logSnippet(String(err), 160)}；退回自动模式（参考原样，各 map 双手性对比判定相对手性）`);
      } finally {
        /* the anchor and the unused flip copy close NOW — the
         * view-scoring thumbnails render the whole scene, and a leftover
         * anchor would contaminate the coverage scores (and every
         * screenshot after it). Stray fitmap-search copies are swept the
         * same way the per-map hands do (relay /volumes; anything
         * outside openIds closes). */
        if (anchorId != null) {
          await exec(t, `close #${anchorId}`, opts, true);
          openIds.delete(anchorId);
        }
        if (flipRefId != null) {
          await exec(t, `close #${flipRefId}`, opts, true);
          openIds.delete(flipRefId);
        }
        if (t.kind === "relay") {
          const vols = await bridgeVolumeIds(t);
          if (vols != null) {
            const legit = new Set([...openIds].map(String));
            for (const v of vols) {
              if (!legit.has(v.id)) {
                await exec(t, `close #${v.id}`, opts, true);
                log(`  已关闭验证产生的多余地图模型 #${v.id}（${logSnippet(v.name, 60)}）— 不进入视角评分与截图`);
              }
            }
          }
        }
      }
    } else if (policy?.mode === "anchor") {
      log("参考手性: 参照物验证已选但未填写参照物路径/URL — 按自动模式处理（参考原样，各 map 双手性对比判定相对手性）");
    }
  }

  /* ---- 2. standardise the view: v3.82 probe-closed loop — the
   * reference's DISPLAY level is picked from RENDERED knees (fragmentation
   * + sponge guards on real probe pixels), the membrane side view from
   * belt-band PCA (new relay) or a probe-only STANDING turn-scan that
   * works on EVERY relay since v3.50, both verified by rendered probes;
   * the 90° coverage ladder stays for membrane mode off (the right
   * choice for soluble proteins). ---- */
  let view = { desc: "base", x: 0, y: 0, score: 0 };
  /** v3.77: per-model DISPLAY contour levels — recorded when each model's
   * stats are fetched, applied right before ITS screenshot. The FIT
   * levels stay at the tuned 0.25×max; only the visible contour rides the
   * contourLevel policy. v3.82: on probe-capable transports in auto mode
   * these are only a FALLBACK — the per-map knee (rendered + measured at
   * export time) is the primary. */
  const displayLevelById = new Map<number, number>();
  const contourPolicy: ContourLevelPolicy = opts.contourLevel ?? { mode: "auto" };
  /** v3.82: per-model /volstats recorded at open time — the screenshot
   * loop's knee ladder needs each map's max without re-fetching. */
  const statsById = new Map<number, BridgeVolStats | null>();
  /** v3.81: the reference's display level + its above-level envelope
   * count — DIAGNOSTICS ONLY under v3.82 (the probe knee decides levels;
   * the count-matching experiment of round-41 delivered sponges and
   * snowballs on the real P283 maps). */
  let refAnchor: LevelAnchor | null = null;
  const setDisplayLevel = async (id: number): Promise<void> => {
    const lvl = displayLevelById.get(id);
    if (lvl == null) return;
    await exec(t, `volume #${id} level ${lvl.toFixed(4)} step ${STEP}`, opts, true);
    /* v3.85: the script's dust cleanup rides EVERY display level — the
     * screenshots must never show the small disconnected junk. */
    await exec(t, `surface dust #${id} size ${DUST_SIZE_A}`, opts, true);
  };
  /** v3.77: the membrane-view outcome, surfaced through the result. */
  let membraneReport: MembraneViewReport | null = null;
  /** v3.82: probe capability (relay transport with PNG return) — gates the
   * knee ladders, the standing probes and the per-map orientation assist. */
  const probeCapable = !!(t.canFetchFiles && t.workdir);
  /** v3.82: auto mode + probes → levels come from rendered knees. */
  const kneeMode = probeCapable && contourPolicy.mode !== "manual";
  /** v3.82: re-apply the run's SHARED view (membrane camera command or
   * coverage-ladder turns) — every map's screenshot starts from it; a map
   * whose own standing probe fails gets its own orientation instead. */
  let applySharedView: (() => Promise<void>) | null = null;
  /** v3.82: the reference render's STANDING sign at the final orientation
   * (+1 heavy end up / −1 heavy end down) — per-map assists roll 180° to
   * MATCH it so the whole figure shows the same end up. */
  let refStandingSign: number | null = null;
  /* ---- v3.82 (round-42) PROBE MACHINERY — hoisted to the run scope so
   * BOTH the view phase (reference level knee + membrane orientation)
   * and the screenshot loop (per-map knees + per-map standing assists)
   * share one implementation. No relay endpoint is required beyond
   * save+fetch (present since v3.50) — the round-39/40/41 chains all
   * depended on relay-side keys the user's ChimeraX never got. ---- */
  /* ---- v3.82 shared probe machinery: render + measure (no camera
   * assumptions — works on any relay with save+fetch, i.e. every relay
   * since v3.50; the round-39/40/41 chains all depended on relay-side
   * keys the user's ChimeraX apparently never got). ---- */
  const renderProbe = async (name: string): Promise<RenderShape | null> => {
    try {
      const bytes = await saveAndFetchPng(
        t,
        name,
        { width: THUMB_SIZE, height: THUMB_SIZE, supersample: 1 },
        (c) => exec(t, c, opts, true),
        log,
      );
      return await measureRender(bytes);
    } catch (err) {
      log(`  探针 ${name}: 缩略图获取失败 — ${logSnippet(String(err), 120)}`);
      return null;
    }
  };
  /** one orientation probe: restore the base view, apply the candidate,
   * RE-FRAME (bare `view` — translate/zoom/clip only, never rotates; a
   * camera swap can strand the previous framing and render an
   * empty/off-centre probe — the silent verification failure v3.80
   * shipped), render and measure. */
  const probeOrientation = async (
    name: string,
    apply: () => Promise<boolean>,
  ): Promise<RenderShape | null> => {
    await exec(t, "view _cfbase", opts, true);
    if (!(await apply())) return null;
    await exec(t, "wait 1", opts, true);
    await exec(t, "view", opts, true);
    await exec(t, "wait 1", opts, true);
    return renderProbe(name);
  };

  /* ---- v3.82 → v3.85 → v3.86 (round-46 “角度和align还是存在一些问题
   *  …不同的map可能需要给不同的倍率才行”): the DISPLAY level anchors at
   *  each map's OWN 3-phase histogram split (beltLevelFrom above — the
   *  per-map “倍率”), dusts the surface, and a render probe VERIFIES it.
   *  The v3.85 fixed 0.15×max anchor sits BELOW the noise floor on
   *  sharpened/noisy maps (their max is a noise-boosted spike) and its
   *  frag verification could not see the resulting CONNECTED cauliflower
   *  — v3.86's anchor adapts per map (t2 hides a cold belt / t1 clears
   *  the noise floor) and the probe gains the ENCLOSED-hole bar (lace /
   *  sponge / noise-gap renders) plus boundary-roughness diagnostics.
   *  Order:
   *    1. anchor (belt-adaptive, dusted) — clean → done;
   *    2. anchor dirty → probe the ladder rungs (dusted) and pick the
   *       clean rung CLOSEST to the anchor — UP when the dirt was noise,
   *       DOWN when the anchor hollowed the particle;
   *    3. nothing clean even with dust → the minimum-frag rung (tie →
   *       closer to the anchor) with an honest warning. ---- */
  const kneeLevelFor = async (
    id: number,
    stats: BridgeVolStats | null,
    tag: string,
    m2In?: Membrane2Reply | null,
  ): Promise<{ level: number; rule: string } | null> => {
    if (!stats || !Number.isFinite(stats.max) || stats.max <= 0) return null;
    const max = stats.max;
    /* v3.86: the per-map belt anchor — the caller may pass a pre-fetched
     * /membrane2 reply (the reference fetches it once for level + cameras
     * + alignment masks); every other map fetches its own here. */
    const m2 = m2In !== undefined ? m2In : (t.canMembrane2 ? await bridgeMembrane2(t, id) : null);
    const belt = beltLevelFrom(m2, stats);
    let anchorLevel = Number.isFinite(belt.anchor) && belt.anchor > 0 ? belt.anchor : max * SCRIPT_LEVEL_RATIO;
    /* v3.87 (round-47 “目前最终map的level选的0.25倍，但是前面的map目前
     * 也都是0.25吗？感觉可能需要优化一下”) → v3.88 (round-48 “中间过程
     * 的map还是受到了胶束影响？”): EVERY non-reference map now floors its
     * display anchor at the REFERENCE's final probe-verified display RATIO
     * — v3.87 only did this for no-split maps (old relay), so on a
     * /membrane2 relay each intermediate kept its OWN anchor and the
     * delivered round-48 deck still showed micelle-fused blobs (J9's
     * solid ball, J41-4's flat detergent ellipsoid) and J48 snow at
     * levels the reference had long left behind. Same-pipeline maps share
     * their histogram character, so the level the reference PROVED clean
     * is the per-map 倍率链 floor; a map whose own protein band sits
     * HIGHER keeps its own anchor (max, never min). The ladder + render
     * probes still verify, and a rung BELOW the floor only wins when no
     * rung at/above it is clean (a genuinely fainter protein — the
     * sponge bar would reject an over-levelled pick anyway). */
    let refRatioRule: string | null = null;
    let refRatioFloor: number | null = null;
    if (tag !== "ref" && refId != null) {
      const refLvl = displayLevelById.get(refId) ?? null;
      const refSt = statsById.get(refId) ?? null;
      if (refLvl != null && refSt && Number.isFinite(refSt.max) && refSt.max > 0) {
        const r = Math.min(Math.max(refLvl / refSt.max, ANCHOR_MIN_RATIO), ANCHOR_MAX_RATIO);
        refRatioFloor = r;
        if (anchorLevel < max * r - 1e-9) {
          anchorLevel = max * r;
          refRatioRule = `参考图倍率 ${r.toFixed(3)}×max 下限（本图自身锚点更低 — 中间图与最终图同倍率链，胶束包络/噪声相带不进截图）`;
        } else {
          refRatioRule = `本图锚点已达 ${belt.t1 != null ? "蛋白/胶束分割" : "脚本"}水平（≥ 参考图倍率 ${r.toFixed(3)}×max — 保留本图锚点）`;
        }
      }
    }
    const anchorRatio = anchorLevel / max;
    if (belt.t1 != null && belt.t2 != null) {
      log(`  三相分割: t1=${belt.t1.toFixed(4)}（噪声底）· t2=${belt.t2.toFixed(4)}（${belt.beltBand ? `胶束=${belt.beltBand} 相带（扁率 ${belt.beltRatio?.toFixed(2)}）` : "无胶束相带"}）→ 锚点 ${anchorRatio.toFixed(3)}×max${refRatioRule ? ` · ${refRatioRule}` : ""}`);
    } else {
      log(`  三相分割不可用（${belt.anchorRule}）→ 锚点 ${anchorRatio.toFixed(3)}×max${refRatioRule ? ` · ${refRatioRule}` : ""}`);
    }
    type Rung = { level: number; ratio: number; s: RenderShape | null };
    const rungs: Rung[] = [];
    const probeLevel = async (level: number): Promise<RenderShape | null> => {
      await exec(t, `volume #${id} level ${level.toFixed(4)} step ${STEP}`, opts, true);
      /* v3.85: the script's dust cleanup — the probe must measure EXACTLY
       * what the screenshot will show (dust hides the disconnected bits,
       * so the frag metric judges the DUSTED render, not the raw one). */
      await exec(t, `surface dust #${id} size ${DUST_SIZE_A}`, opts, true);
      await exec(t, "wait 1", opts, true);
      await exec(t, "view", opts, true);
      await exec(t, "wait 1", opts, true);
      return renderProbe(`_knee_${tag}_${level.toFixed(4)}.png`);
    };
    const note = (r: Rung, extra = "") =>
      r.s
        ? `  level ${(r.level / max).toFixed(3)}×max${extra}: 碎片率 ${(r.s.frag * 100).toFixed(1)}% · 孔洞 ${r.s.holes} · 主体覆盖 ${(r.s.mainCov * 100).toFixed(1)}% · 边界粗糙度 ${r.s.rough.toFixed(2)}${
            r.s.frag > KNEE_FRAG_MAX ? "（斑点/游离胶束未清）" : r.s.holes > KNEE_HOLE_MAX ? "（镂空/噪声间隙未清）" : ""
          }`
        : "";
    const cleanShape = (s: RenderShape, bestMain: number): boolean =>
      s.frag <= KNEE_FRAG_MAX && s.holes <= KNEE_HOLE_MAX && s.mainCov >= KNEE_MAIN_MIN_FRAC * bestMain;
    /* rung 1 — the v3.86 anchor, probed FIRST (with dust). The clean bar
     * needs no ladder: frag ≤ bar AND holes ≤ bar AND the absolute
     * mainCov floor (the probe re-frames, so a healthy particle always
     * fills ≫3% of it — a degenerate hollow shell must trigger the walk,
     * not ride the fast path; the ladder's RELATIVE 45%-of-best sponge
     * bar only exists once the walk has run). */
    const anchorShape = await probeLevel(anchorLevel);
    const anchorRung: Rung = { level: anchorLevel, ratio: anchorRatio, s: anchorShape };
    rungs.push(anchorRung);
    if (anchorShape) log(note(anchorRung, `（锚点 · surface dust ${DUST_SIZE_A} Å）`));
    const anchorClean =
      anchorShape != null &&
      anchorShape.frag <= KNEE_FRAG_MAX &&
      anchorShape.holes <= KNEE_HOLE_MAX &&
      anchorShape.mainCov >= KNEE_FAST_MAIN_MIN;
    if (anchorClean && anchorShape) {
      return {
        level: anchorLevel,
        rule: `${refRatioRule ?? `${belt.anchorRule} + surface dust ${DUST_SIZE_A} Å`}（探针验证通过：碎片率 ${(anchorShape.frag * 100).toFixed(1)}%，孔洞 ${anchorShape.holes}，主体覆盖 ${(anchorShape.mainCov * 100).toFixed(1)}%）`,
      };
    }
    /* rung 2 — the anchor was dirty: probe the rest of the ladder
     * (dusted) and pick the clean rung CLOSEST to the anchor. */
    for (const ratio of LEVEL_KNEE_RATIOS) {
      if (threw(opts.signal)) break;
      if (Math.abs(ratio - anchorRatio) < 0.015) continue; // anchor already probed
      const level = max * ratio;
      const s = await probeLevel(level);
      const r: Rung = { level, ratio, s };
      rungs.push(r);
      if (s) log(note(r));
    }
    const measured = rungs.filter((r) => r.s);
    if (!measured.length) return null;
    const bestMain = Math.max(...measured.map((r) => r.s!.mainCov));
    const dist = (r: Rung) => Math.abs(r.ratio - anchorRatio);
    const anchorWhy = !anchorShape
      ? "探针不可用"
      : anchorShape.frag > KNEE_FRAG_MAX
        ? `碎片率 ${(anchorShape.frag * 100).toFixed(1)}%`
        : anchorShape.holes > KNEE_HOLE_MAX
          ? `孔洞 ${anchorShape.holes}`
          : anchorShape.mainCov < KNEE_FAST_MAIN_MIN
            ? `主体覆盖 ${(anchorShape.mainCov * 100).toFixed(1)}%（镂空/薄壳）`
            : "主体覆盖偏低";
    const cleanRungs = measured.filter((r) => cleanShape(r.s!, bestMain));
    if (cleanRungs.length) {
      /* v3.88: rungs BELOW the reference-ratio floor only qualify when
       * nothing at/above it is clean — a connected protein+micelle blob
       * passes the frag/holes bars, so the floor (not just the bars) is
       * what keeps the detergent envelope out of the intermediates. */
      const atOrAboveFloor = cleanRungs.filter(
        (r) => refRatioFloor == null || r.ratio >= refRatioFloor - 0.005,
      );
      const pool = atOrAboveFloor.length ? atOrAboveFloor : cleanRungs;
      const pick = pool.reduce((a, b) => (dist(a) < dist(b) || (dist(a) === dist(b) && a.ratio > b.ratio) ? a : b));
      const floorNote =
        refRatioFloor == null
          ? ""
          : pick.ratio + 1e-9 >= refRatioFloor
            ? ` · ≥参考图倍率 ${refRatioFloor.toFixed(3)}×max`
            : ` · 低于参考图倍率 ${refRatioFloor.toFixed(3)}×max（该下限以上无干净档位）`;
      return {
        level: pick.level,
        rule: `探针校验 ${pick.ratio.toFixed(2)}×max（锚点 ${anchorRatio.toFixed(3)}×max 处${anchorWhy}未清 — 就近${pick.ratio > anchorRatio ? "上调" : "下调"}${floorNote}）`,
      };
    }
    /* rung 3 — nothing clean even with dust: the minimum-frag rung
     * (tie → closer to the anchor), honestly logged. v3.88: prefer rungs
     * at/above the reference floor (same pool rule as rung 2). */
    const dirtOf = (r: Rung) => (r.s ? r.s.frag + Math.min(r.s.holes, 50) * 0.004 : Number.POSITIVE_INFINITY);
    const floorPool = measured.filter((r) => refRatioFloor == null || r.ratio >= refRatioFloor - 0.005);
    const dirtPool = floorPool.length ? floorPool : measured;
    const pick = dirtPool.reduce((a, b) => (dirtOf(a) < dirtOf(b) || (dirtOf(a) === dirtOf(b) && dist(a) <= dist(b)) ? a : b));
    log(`  ⚠ 所有 level 档位均有碎片/镂空（最干净 碎片 ${(pick.s ? (pick.s.frag * 100).toFixed(1) : "—")}% / 孔洞 ${pick.s?.holes ?? "—"}）— 就近取最干净档，可改用手动 level`);
    return {
      level: pick.level,
      rule: `最低碎片 ${(pick.s ? (pick.s.frag * 100).toFixed(1) : "—")}%（${pick.ratio.toFixed(2)}×max 档 · 锚点 ${anchorRatio.toFixed(3)}×max 亦未通过）`,
    };
  };

  /** v3.82: the STANDING scan — turn x/y grid + two halving
   * refinements maximising |standing| (the vertical mass asymmetry),
   * then an azimuth roll refinement maximising the silhouette WIDTH
   * (the disk's long axis horizontal, round-38). Falls back to the
   * v3.81 anisotropy criterion when the particle is too symmetric to
   * stand (an oblate disk reads standing ≈ 0 from every angle but
   * anisotropy still peaks edge-on). Probe-only: needs no relay
   * endpoint at all. */
  const scanForStanding = async (
    why: string,
    tag: string,
    topAnisoParam: number | null,
  ): Promise<{ x: number; y: number; standing: number; via: string } | null> => {
    log(`膜平面扫描（${why}）: 基准视角起 turn x/y 网格（目标：站立度 = 上下质量不对称最大）+ 两轮减半细化 + 滚转对齐盘长轴`);
    type Cell = { x: number; y: number; standing: number; aniso: number; aspect: number };
    /* object wrapper — `let best` assigned only inside the closure defeats
     * TS's control-flow narrowing (the v3.80 scan used the same trick). */
    const bestBox: { cell: Cell | null } = { cell: null };
    const tryCell = async (x: number, y: number, cellTag: string): Promise<void> => {
      if (threw(opts.signal)) return;
      const s = await probeOrientation(`_mprobe_${tag}${cellTag}.png`, async () => {
        if (x) await exec(t, `turn x ${x}`, opts, true);
        if (y) await exec(t, `turn y ${y}`, opts, true);
        return true;
      });
      if (!s) return;
      log(`  扫描格 x=${x}° y=${y}°: 站立度 ${s.standing >= 0 ? "+" : ""}${s.standing.toFixed(3)} · 各向异性 ${s.aniso.toFixed(2)}`);
      const cur = bestBox.cell;
      if (!cur || Math.abs(s.standing) > Math.abs(cur.standing)) {
        bestBox.cell = { x, y, standing: s.standing, aniso: s.aniso, aspect: s.aspect };
      }
    };
    for (const x of MEMBRANE_SCAN_ELEVATIONS) {
      for (const y of MEMBRANE_SCAN_AZIMUTHS) {
        await tryCell(x, y, `g${x}_${y}`);
      }
    }
    for (const step of [22.5, 11.25]) {
      if (!bestBox.cell || threw(opts.signal)) break;
      const cx = bestBox.cell.x;
      const cy = bestBox.cell.y;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
        await tryCell(cx + dx, cy + dy, `r${String(step).replace(".", "_")}_${dx}_${dy}`);
      }
    }
    const winner = bestBox.cell;
    let viaStanding = true;
    if (!winner) {
      log("  扫描未获得任何可测探针");
      return null;
    }
    if (Math.abs(winner.standing) < STANDING_SCAN_NEED) {
      /* symmetric particle: standing is flat everywhere — the old
       * anisotropy criterion still finds the edge-on (side) view. */
      const anisoOk =
        winner.aniso >= MEMBRANE_ANISO_ABS ||
        (topAnisoParam != null && winner.aniso >= MEMBRANE_ANISO_REL * topAnisoParam && winner.aniso >= MEMBRANE_SCAN_MIN_ANISO);
      if (!anisoOk) {
        log(
          `  扫描未找到侧视视角（最佳站立度 ${winner.standing.toFixed(3)} < ${STANDING_SCAN_NEED}，各向异性 ${winner.aniso.toFixed(2)} 亦未达标）`,
        );
        return null;
      }
      viaStanding = false;
    }
    /* roll refinement: at fixed elevation, extra azimuth spins the
     * standing particle about its own (now vertical) axis — pick the
     * azimuth whose silhouette is WIDEST (the disk/dimer long axis
     * horizontal). */
    let rollY = winner.y;
    let rollAspect = winner.aspect;
    for (const dy of [45, 90, 135, -45, -90, -135]) {
      if (threw(opts.signal)) break;
      const s = await probeOrientation(`_mprobe_${tag}roll${dy}.png`, async () => {
        if (winner.x) await exec(t, `turn x ${winner.x}`, opts, true);
        await exec(t, `turn y ${winner.y + dy}`, opts, true);
        return true;
      });
      if (!s) continue;
      log(`  滚转格 dy=${dy}°: 宽高比 ${s.aspect.toFixed(2)} · 站立度 ${s.standing >= 0 ? "+" : ""}${s.standing.toFixed(3)}`);
      if (Math.abs(s.standing) >= STANDING_SCAN_NEED * 0.8 && s.aspect > rollAspect) {
        rollAspect = s.aspect;
        rollY = winner.y + dy;
      }
    }
    await exec(t, "view _cfbase", opts, true);
    if (winner.x) await exec(t, `turn x ${winner.x}`, opts, true);
    await exec(t, `turn y ${rollY}`, opts, true);
    await exec(t, "wait 1", opts, true);
    await exec(t, "view", opts, true);
    await exec(t, "wait 1", opts, true);
    return {
      x: winner.x,
      y: rollY,
      standing: winner.standing,
      via: viaStanding
        ? `turn 网格扫描 · 站立度 ${Math.abs(winner.standing).toFixed(2)}`
        : `turn 网格扫描 · 各向异性 ${winner.aniso.toFixed(2)}（对称颗粒，站立度不可辨）`,
    };
  };

  /* v3.86 (round-46 “align是能去掉去垢剂后进行吗？”): the reference's
   *  3-phase split + belt anchor, run-scoped so BOTH the probe view phase
   *  (display anchor + membrane cameras) and the ALIGNMENT mask phase
   *  (2.5 — belt-phase density zeroed out of the fitmap targets) read the
   *  SAME /membrane2 reply. Populated inside the probe-capable branch;
   *  beltLevelFrom(null, …) on REST/no-split transports keeps
   *  proteinLevel null and the masks at their classic v3.67 ratios. */
  let refMem2: Membrane2Reply | null = null;
  let refBeltInfo: BeltLevelInfo = beltLevelFrom(null, null);

  if (probeCapable) {
    /* v3.80 (round-40 “map的朝向还是不对”): the base view is made
     * DETERMINISTIC first — `view orient` aligns the scene axes with the
     * screen axes (X right, Y up, Z toward the viewer, per the view
     * command docs; like every view change it never touches model
     * positions, so the fitmap/matrix bookkeeping below is safe). The
     * coverage ladder, the membrane scan and every per-map assist now
     * always start from the same known base. */
    await exec(t, "view orient", opts, true);
    await exec(t, "wait 1", opts, true);
    await exec(t, "view name _cfbase", opts, true);
    await exec(t, "wait 1", opts, true);

    /* ---- 2a. the reference's DISPLAY level (the membrane probes below
     * and every screenshot ride it). Manual mode keeps the user's ratio —
     * the expert override, applied verbatim to every map (v3.80
     * semantics; the round-41 count-matching anchor is gone). ---- */
    const refDispStats = await bridgeVolStats(t, refId);
    statsById.set(refId, refDispStats);
    const refMax = refDispStats?.max ?? refStats?.max ?? null;
    /* v3.86: the reference's 3-phase split — fetched ONCE here and reused
     * THREE ways: the display knee's belt-adaptive anchor, the membrane
     * camera candidates (2b) and the ALIGNMENT masks' detergent removal
     * (2.5, refBeltInfo.proteinLevel). */
    refMem2 = t.canMembrane2 ? await bridgeMembrane2(t, refId) : null;
    refBeltInfo = beltLevelFrom(refMem2, refDispStats ?? refStats);
    let refDisplayLevel: number | null = null;
    if (contourPolicy.mode === "manual" && refMax) {
      const ratio = Math.min(Math.max(Number.isFinite(contourPolicy.ratio) ? contourPolicy.ratio : LEVEL_RATIO, 0.01), 0.9);
      refDisplayLevel = refMax * ratio;
      log(`参考图截图 level ${refDisplayLevel.toFixed(4)}（手动 ${ratio}×max）`);
    } else if (kneeMode && refDispStats) {
      progress("参考图 level 探针（胶束带自适应锚点 + 逐档渲染验证）", 8);
      const knee = await kneeLevelFor(refId, refDispStats, "ref", refMem2);
      if (knee) {
        refDisplayLevel = knee.level;
        log(`参考图截图 level ${knee.level.toFixed(4)}（${knee.rule}）`);
      }
    }
    if (refDisplayLevel == null) {
      /* no probes / no stats: the v3.85 script rule (non-probe fallback —
       * REST transports and volstats hiccups). */
      const refDisplayChoice = displayLevelFor(refDispStats, contourPolicy);
      refDisplayLevel = refDisplayChoice?.level ?? refLevel ?? 0.15 * (refMax ?? 1);
      if (refDisplayChoice) log(`参考图截图 level ${refDisplayChoice.level.toFixed(4)}（${refDisplayChoice.rule}）`);
    }
    displayLevelById.set(refId, refDisplayLevel);
    if (refDispStats && refDisplayLevel != null) {
      const anchorCount = envelopeCountAt(refDispStats, refDisplayLevel);
      if (anchorCount != null && anchorCount > 0) {
        refAnchor = { level: refDisplayLevel, count: anchorCount };
        log(`参考包络计数 ${Math.round(anchorCount).toLocaleString("en-US")} 体素（诊断值 — v3.82 各图 level 由渲染探针逐图决定）`);
      }
    }
    await exec(t, `volume #${refId} level ${refDisplayLevel.toFixed(4)} step ${STEP}`, opts, true);
    /* v3.85: the script's dust cleanup — the reference's membrane probes
     * and its screenshot must both measure/show the DUSTED surface. */
    await exec(t, `surface dust #${refId} size ${DUST_SIZE_A}`, opts, true);

    /* ---- 2b. the membrane side view. v3.82 chain, every step probe-
     * verified, no relay upgrade REQUIRED:
     *   1. BELT-BAND cameras (/membrane2, relay ≥ v3.82): the detergent
     *      belt is a flat torus in ONE density band whichever phase it is
     *      — its PCA normal is the membrane normal even when the whole
     *      particle reads isotropic (TMEM175's disease);
     *   2. the legacy whole-envelope PCA camera (/membrane);
     *   3. the STANDING turn-grid scan — pure probe renders, finds the
     *      orientation whose vertical mass profile is most asymmetric
     *      (head/belt at one end), then rolls the disk's long axis
     *      horizontal;
     *   4. the documented camera direct (honest log) when the commands
     *      work but the probes cannot distinguish;
     *   5. the 90° coverage ladder (membrane off). ---- */
    let membraneApplied = false;
    if (opts.membraneView?.mode === "auto") {
      progress("膜蛋白侧视定向（胶束带 PCA + 渲染探针验证）", 9);
      /** the face-on baseline's anisotropy for the axes source currently
       * being tried (candidates may also clear the absolute bars). */
      let topAniso: number | null = null;
      const accepts = (s: RenderShape | null): boolean => {
        if (!s) return false;
        if (Math.abs(s.standing) >= STANDING_ACCEPT) return true;
        if (s.aniso >= MEMBRANE_ANISO_ABS) return true;
        return topAniso != null && s.aniso >= MEMBRANE_ANISO_REL * topAniso && s.aniso >= MEMBRANE_SCAN_MIN_ANISO;
      };
      /* the current camera TRANSLATION is KEPT (every probe re-frames
       * with bare `view` anyway). Bare `view matrix` reports the camera
       * as 12 comma-separated numbers, row-major 3×4, translation at
       * indices 3/7/11 (view command docs). */
      let camTrans: [number, number, number] = [0, 0, 0];
      {
        const vm = await exec(t, "view matrix", opts, true);
        if (!vm.error) {
          const m = /camera[^\d\-+]*((?:[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?[\s,]+){11}[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(vm.text);
          if (m) {
            const nums = m[1].match(/[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)?.map(Number) ?? [];
            if (nums.length >= 12 && [3, 7, 11].every((i) => Number.isFinite(nums[i]))) {
              camTrans = [nums[3], nums[7], nums[11]];
            }
          }
        }
      }
      const scaleVec = (v: [number, number, number], s2: number): [number, number, number] => [
        v[0] * s2,
        v[1] * s2,
        v[2] * s2,
      ];
      const crossVec = (
        a: [number, number, number],
        b: [number, number, number],
      ): [number, number, number] => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      /** build the side/top camera command from an axes source — the
       * deterministic up side: the normal's first significant component in
       * map-frame Y/Z/X order is forced >= 0 (same map, same side up);
       * `flip` negates it (the user's 上下翻转 setting). */
      const cameraCommands = (
        src: { normal: [number, number, number]; ea: [number, number, number]; eb: [number, number, number] },
      ): { side: string; sideT: string; top: string } => {
        let n: [number, number, number] = [...src.normal];
        for (const i of [1, 2, 0] as const) {
          if (Math.abs(n[i]) > 1e-6) {
            if (n[i] < 0) n = scaleVec(n, -1);
            break;
          }
        }
        if (opts.membraneView?.flip) n = scaleVec(n, -1);
        const xAxis = src.ea;
        const yAxis = n;
        const zRaw = crossVec(xAxis, yAxis);
        const zLen = Math.hypot(zRaw[0], zRaw[1], zRaw[2]);
        const zAxis: [number, number, number] = zLen > 1e-9 ? scaleVec(zRaw, 1 / zLen) : zRaw;
        const rotCols: [number, number, number][] = [
          [xAxis[0], yAxis[0], zAxis[0]],
          [xAxis[1], yAxis[1], zAxis[1]],
          [xAxis[2], yAxis[2], zAxis[2]],
        ];
        const rotRows: [number, number, number][] = [xAxis, yAxis, zAxis];
        const rotTop: [number, number, number][] = [
          [src.ea[0], src.eb[0], yAxis[0]],
          [src.ea[1], src.eb[1], yAxis[1]],
          [src.ea[2], src.eb[2], yAxis[2]],
        ];
        const fmt = (rot: [number, number, number][]): string =>
          `view matrix camera ${[
            rot[0][0], rot[0][1], rot[0][2], camTrans[0],
            rot[1][0], rot[1][1], rot[1][2], camTrans[1],
            rot[2][0], rot[2][1], rot[2][2], camTrans[2],
          ]
            .map((v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6))
            .join(",")}`;
        return { side: fmt(rotCols), sideT: fmt(rotRows), top: fmt(rotTop) };
      };
      const tryCamera = async (
        label: string,
        cmd: string,
      ): Promise<{ s: RenderShape | null; rejected: boolean }> => {
        const s = await probeOrientation(`_mprobe_${label}.png`, async () => {
          const res = await exec(t, cmd, opts, true);
          if (res.error) {
            log(`  膜视图 ${label}: 相机命令被拒 — ${logSnippet(res.error, 140)}`);
            return false;
          }
          return true;
        });
        if (s) {
          log(
            `  膜视图 ${label} 探针: 站立度 ${s.standing >= 0 ? "+" : ""}${s.standing.toFixed(3)} · 各向异性 ${s.aniso.toFixed(2)} · 宽高比 ${s.aspect.toFixed(2)} · 碎片率 ${(s.frag * 100).toFixed(1)}%`,
          );
        }
        return { s, rejected: s == null };
      };
      /* the candidate axes sources, most trustworthy first — v3.86:
       * reuses the 2a fetch (no second /membrane2 call). */
      const mem2 = refMem2;
      const bands = (mem2?.bands ?? [])
        .filter((b) => b.count >= 64 && b.ratio > 0 && b.ratio < 1)
        .sort((a, b) => a.ratio - b.ratio);
      if (mem2) {
        if (bands.length) {
          log(
            `胶束带检测: ${bands
              .map((b) => `${b.name} 相带 [${b.lo.toFixed(3)}, ${b.lo < b.hi ? b.hi.toFixed(3) : "max"}] 扁率 ${b.ratio.toFixed(2)}（${Math.round(b.count).toLocaleString("en-US")} 体素）`)
              .join(" · ")}${mem2.splits ? ` — 三相分割 ${mem2.splits.map((v) => v.toFixed(3)).join(" / ")}` : ""}`,
          );
        } else {
          log("胶束带检测: 无可用密度相带（信封过小或分割退化）— 改用整体 PCA / 站立度扫描");
        }
      } else if (t.canMembrane) {
        log("当前桥脚本无 /membrane2（胶束带检测，v3.82 桥新增）— 先试整体 PCA 相机，站立度扫描全程可用（无需升级桥）");
      }
      /* legacy envelope PCA — needed as a candidate source on OLD relays
       * and as a secondary source on new ones. */
      const envSrc = mem2?.envelope ?? (t.canMembrane ? await bridgeMembraneAxis(t, refId, refDisplayLevel ?? refLevel ?? 0) : null);
      const sources: Array<{ label: string; src: { normal: [number, number, number]; ea: [number, number, number]; eb: [number, number, number] }; ratio: number; band: MembraneBand | null }> = [];
      for (const b of bands.slice(0, 2)) {
        sources.push({ label: `band-${b.name}`, src: { normal: b.normal, ea: b.ea, eb: b.eb }, ratio: b.ratio, band: b });
      }
      if (envSrc) sources.push({ label: "env", src: { normal: envSrc.normal, ea: envSrc.ea, eb: envSrc.eb }, ratio: envSrc.ratio, band: null });
      let via = "";
      let viaStanding: number | null = null;
      let viaRatio: number | null = null;
      let viaNormal: [number, number, number] | null = null;
      let sharedCamCmd: string | null = null;
      let camOk = false;
      let bandNote = "";
      /** v3.82: the scan winner's turns (the shared view for scan-found
       * orientations — re-applied per map). */
      let scanTurns: { x: number; y: number } | null = null;
      for (const source of sources) {
        const cmds = cameraCommands(source.src);
        /* the face-on baseline for THIS source (rejected command → null;
         * candidates then need the absolute bars). */
        const topR = await tryCamera(`${source.label}top`, cmds.top);
        const prevTop = topAniso;
        topAniso = topR.s?.aniso ?? null;
        if (topR.s) {
          log(`  膜视图 ${source.label} 俯视基线: 站立度 ${topR.s.standing >= 0 ? "+" : ""}${topR.s.standing.toFixed(3)} · 各向异性 ${topR.s.aniso.toFixed(2)}`);
        }
        const a1 = await tryCamera(`${source.label}cam`, cmds.side);
        camOk = camOk || !a1.rejected;
        if (accepts(a1.s)) {
          via = `${source.label} 相机直连 · 探针验证（站立度 ${Math.abs(a1.s!.standing).toFixed(2)}${topAniso != null ? ` vs 俯视 ${Math.abs(topR.s!.standing).toFixed(2)}` : ""}）`;
          viaStanding = a1.s!.standing;
          viaRatio = source.ratio;
          viaNormal = source.src.normal;
          sharedCamCmd = cmds.side;
          bandNote = source.band ? `胶束${source.band.name}相带 PCA（扁率 ${source.band.ratio.toFixed(2)}）` : `整体 PCA（λmin/λmid=${source.ratio.toFixed(2)}，诊断值）`;
          break;
        }
        const a2 = await tryCamera(`${source.label}camT`, cmds.sideT);
        camOk = camOk || !a2.rejected;
        if (accepts(a2.s)) {
          via = `${source.label} 相机转置候选 · 探针验证（站立度 ${Math.abs(a2.s!.standing).toFixed(2)}）`;
          viaStanding = a2.s!.standing;
          viaRatio = source.ratio;
          viaNormal = source.src.normal;
          sharedCamCmd = cmds.sideT;
          bandNote = source.band ? `胶束${source.band.name}相带 PCA（扁率 ${source.band.ratio.toFixed(2)}）` : `整体 PCA（λmin/λmid=${source.ratio.toFixed(2)}，诊断值）`;
          break;
        }
        topAniso = prevTop;
      }
      if (!via) {
        const scan = await scanForStanding("精确相机探针未呈站立侧视剪影", "s", topAniso);
        if (scan) {
          via = scan.via;
          viaStanding = scan.standing;
          viaRatio = envSrc?.ratio ?? null;
          viaNormal = envSrc?.normal ?? null;
          bandNote = "探针网格扫描（无需桥端点）";
          scanTurns = { x: scan.x, y: scan.y };
          if (opts.membraneView?.flip) {
            await exec(t, "turn x 180", opts, true);
            await exec(t, "wait 1", opts, true);
            viaStanding = -viaStanding;
          }
        }
      }
      if (!via && camOk && sharedCamCmd == null) {
        /* v3.81 semantics, kept as the last camera resort: the documented
         * camera COMMAND WORKED but no probe could distinguish the views
         * (a near-isotropic particle at this level). Applying the
         * documented camera is still better than the coverage face-down
         * pick — logged honestly. */
        const src = sources[0];
        if (src) {
          const cmds = cameraCommands(src.src);
          await exec(t, "view _cfbase", opts, true);
          const res = await exec(t, cmds.side, opts, true);
          if (!res.error) {
            await exec(t, "wait 1", opts, true);
            sharedCamCmd = cmds.side;
            via = "文档相机直连（探针无法区分 — 剪影近各向同性，按文档约定取向）";
            viaStanding = null;
            viaRatio = src.ratio;
            viaNormal = src.src.normal;
            bandNote = src.band ? `胶束${src.band.name}相带 PCA（扁率 ${src.band.ratio.toFixed(2)}）` : "整体 PCA（诊断值）";
          }
        }
      }
      if (via) {
        /* re-frame: translate/zoom/clip only — rotation preserved */
        if (sharedCamCmd) {
          const cmd = sharedCamCmd;
          applySharedView = async () => {
            await exec(t, "view _cfbase", opts, true);
            await exec(t, cmd, opts, true);
          };
          await exec(t, "view _cfbase", opts, true);
          await exec(t, cmd, opts, true);
        } else if (scanTurns) {
          const turns = scanTurns;
          applySharedView = async () => {
            await exec(t, "view _cfbase", opts, true);
            if (turns.x) await exec(t, `turn x ${turns.x}`, opts, true);
            await exec(t, `turn y ${turns.y}`, opts, true);
          };
        }
        await exec(t, "view", opts, true);
        await exec(t, "wait 1", opts, true);
        membraneApplied = true;
        view = {
          desc: `膜侧面视图${opts.membraneView?.flip ? " · 翻转" : ""}`,
          x: scanTurns?.x ?? 0,
          y: scanTurns?.y ?? 0,
          score: viaRatio ?? 0,
        };
        /* the final orientation's standing sign — per-map assists match it. */
        if (viaStanding != null) refStandingSign = Math.sign(viaStanding) || 1;
        membraneReport = {
          applied: true,
          ratio: viaRatio,
          normal: viaNormal,
          via,
          standing: viaStanding ?? undefined,
          note: `去垢剂盘立于画面 XZ 平面（${via}；${bandNote}）${
            opts.membraneView?.flip ? "，并按设置上下翻转 180°（另一面朝上）" : ""
          }`,
        };
        log(
          `膜视图 ✓: ${membraneReport.note}；默认朝上的一面按地图坐标 +Y/+Z/+X 首要分量确定（可复现）— 密度无法判断包内/包外，若朝上的不是包外区，在「膜蛋白视图」勾选「上下翻转 180°」后重新生成`,
        );
      } else {
        await exec(t, "view _cfbase", opts, true);
        log(
          "⚠ 膜视图不可用: 相机命令被拒且网格扫描未找到站立/侧视剪影 — 退回覆盖率择优视角。请确认 ChimeraX 版本支持 view matrix camera（1.13+）",
        );
        membraneReport = {
          applied: false,
          ratio: envSrc?.ratio ?? null,
          normal: envSrc?.normal ?? null,
          note: "相机命令被拒且扫描未检出站立/侧视剪影 — 未应用膜取向，已退回覆盖率择优",
        };
      }
    }
    if (!membraneApplied) {
      progress("视角自动评分（基准 + Y±90 + X±90）", 10);
      const views: Array<{ desc: string; x: number; y: number }> = [
        { desc: "base", x: 0, y: 0 },
        { desc: "y+90", x: 0, y: 90 },
        { desc: "y-90", x: 0, y: -90 },
        { desc: "x+90", x: 90, y: 0 },
        { desc: "x-90", x: -90, y: 0 },
      ];
      let best = -1;
      for (const v of views) {
        await exec(t, "view _cfbase", opts, true);
        if (v.x) await exec(t, `turn x ${v.x}`, opts, true);
        if (v.y) await exec(t, `turn y ${v.y}`, opts, true);
        await exec(t, "wait 1", opts, true);
        const thumb = `_thumb_${v.desc.replace(/[^a-z0-9]/gi, "")}.png`;
        // v3.48 (round-7): plain `save <png-path> …` — `save image` is NOT a
        // ChimeraX command (errors were swallowed by the soft flag and only
        // surfaced as /file 404; now the real error reaches the log).
        // v3.50 (round-9): the save→fetch rides the rung ladder — abs →
        // abs-fwd → cd+relative — so a path/tokenizer divergence self-heals
        // instead of failing every thumbnail with a bare /file 404.
        try {
          const bytes = await saveAndFetchPng(
            t,
            thumb,
            { width: THUMB_SIZE, height: THUMB_SIZE, supersample: 1 },
            (c) => exec(t, c, opts, true),
            log,
          );
          const score = await thumbnailCoverageScore(bytes);
          log(`  视角 ${v.desc}: 覆盖率 ${score.toFixed(4)}`);
          if (score > best) {
            best = score;
            view = { ...v, score };
          }
        } catch (err) {
          const saveFailed = err instanceof SaveShotError && err.kind === "save";
          const detail = err instanceof Error ? err.message : String(err);
          log(`  视角 ${v.desc}: 缩略图${saveFailed ? "保存" : "获取"}失败 — ${logSnippet(detail, 140)}`);
        }
      }
      await exec(t, "view _cfbase", opts, true);
      if (view.x) await exec(t, `turn x ${view.x}`, opts, true);
      if (view.y) await exec(t, `turn y ${view.y}`, opts, true);
      await exec(t, "wait 1", opts, true);
      log(`最佳视角: ${view.desc} (X=${view.x}°, Y=${view.y}°, 覆盖率 ${view.score.toFixed(4)})`);
      applySharedView = async () => {
        await exec(t, "view _cfbase", opts, true);
        if (view.x) await exec(t, `turn x ${view.x}`, opts, true);
        if (view.y) await exec(t, `turn y ${view.y}`, opts, true);
      };
    }
  } else {
    log("当前传输不支持文件回传 — 使用基准视角（对齐/手性诊断仍有效）");
  }

  /* ---- 2.5 v3.66: matrix-transfer probe + the TWO-SCALE lowpassed
   * reference (σ coarse for the global search, σ fine for refinement
   * and the track decision). Created AFTER the view scoring so the
   * coverage thumbnails never render them; closed before the screenshot
   * phase. The matrixget→matrixset ROUND TRIP is probed on the reference
   * first (its pose is identity, so applying its own matrix is a no-op):
   * the whole clone pyramid + two-track pose bookkeeping depends on it,
   * and a build where it fails degrades cleanly to the full-resolution
   * ladder instead of losing fitted poses mid-run. On the official REST
   * transport (no workdir) the probe writes a bare relative filename —
   * ChimeraX resolves it against its own cwd. */
  const lowpass = t.kind === "relay" && !!t.workdir;
  const xfPath = (name: string) => (t.workdir ? joinWorkdirPathFwd(t.workdir, name) : name);
  let matrixOk = false;
  {
    const probePath = xfPath("xf_probe_ref.txt");
    const g = await exec(t, `matrixget "${probePath}" models #${refId}`, opts, true);
    const s = g.error ? null : await exec(t, `matrixset "${probePath}" models #${refId}`, opts, true);
    matrixOk = !g.error && !!s && !s.error;
    if (!matrixOk) {
      log(
        `⚠ 矩阵转移（matrixget/matrixset）不可用 — 低通副本与双轨迹比较停用，退回全分辨率直接拟合（${logSnippet(
          g.error ?? s?.error ?? "无返回",
          100,
        )}）`,
      );
    }
  }
  /** v3.66: save a model's current pose matrix into the bridge file area —
   * null when the capture failed (the caller keeps the live pose and
   * notes it). `tag` carries the map key + hand + seed, so names are
   * unique per pose and a re-run simply overwrites its own files. */
  const matrixSave = async (id: number, tag: string): Promise<string | null> => {
    if (!matrixOk) return null;
    const p = xfPath(`xf_${safeKeyPart(tag)}.txt`);
    const r = await exec(t, `matrixget "${p}" models #${id}`, opts, true);
    return r.error ? null : p;
  };
  const matrixLoad = async (id: number, path: string): Promise<boolean> => {
    if (!matrixOk) return false;
    const r = await exec(t, `matrixset "${path}" models #${id}`, opts, true);
    return !r.error;
  };
  /** v3.67: run-scoped Gaussian smoothing — probes the command shape on
   * first use (volume gaussian sDev → vop gaussian sDev → vgaussian sDev
   * → vgaussian sigma) and remembers the winner; returns the NEW clone's
   * model id, or null when no shape runs (every caller degrades). The
   * `modelId <next>` form (relay /nextid) is tried first so the id is
   * known even on builds that log nothing — a clean modelId-form run
   * returns `next` outright (ChimeraX honors modelId; parsing the log
   * could grab the SOURCE map's id instead). The plain form falls back
   * to log parsing ONLY — never the stale /nextid guess (the v3.63
   * phantom-id disease). */
  let gaussianShape: { cmd: string; kw: string } | null | undefined;
  const gaussianSmooth = async (id: number, sigma: number): Promise<number | null> => {
    if (gaussianShape === null) return null;
    const shapes = gaussianShape ? [gaussianShape] : VOL_GAUSSIAN_SHAPES;
    for (const s of shapes) {
      const next = await bridgeNextModelId(t);
      let res = next != null
        ? await exec(t, `${s.cmd} #${id} ${s.kw} ${sigma} modelId ${next}`, opts, true)
        : null;
      if (res && !res.error) {
        if (gaussianShape === undefined) {
          gaussianShape = s;
          log(`平滑命令: ${s.cmd} #N ${s.kw} σ ✓ — 低通金字塔以该命令形态生成`);
        }
        return next;
      }
      res = await exec(t, `${s.cmd} #${id} ${s.kw} ${sigma}`, opts, true);
      if (res && !res.error) {
        if (gaussianShape === undefined) {
          gaussianShape = s;
          log(`平滑命令: ${s.cmd} #N ${s.kw} σ ✓ — 低通金字塔以该命令形态生成`);
        }
        return parseOpenModelId(res.text);
      }
    }
    if (gaussianShape === undefined) {
      gaussianShape = null;
      log("⚠ 高斯平滑命令（volume/vop/vgaussian gaussian）全部不可用 — 本次无低通金字塔，拟合在（屏蔽后的）全分辨率参考上进行");
    }
    return null;
  };

  /** v3.67: run-scoped NOISE-MASK builder — `volume threshold #id
   * minimum <level> set 0` clone with every value below `level` zeroed
   * (the signal envelope). Same shape probing + id bookkeeping as
   * gaussianSmooth. Null when the threshold command is unavailable. */
  let thresholdShape: string | null | undefined;
  const thresholdZero = async (id: number, level: number): Promise<number | null> => {
    if (thresholdShape === null) return null;
    const shapes = thresholdShape ? [thresholdShape] : VOL_THRESHOLD_SHAPES;
    for (const cmd of shapes) {
      const next = await bridgeNextModelId(t);
      let res = next != null
        ? await exec(t, `${cmd} #${id} minimum ${level.toFixed(5)} set 0 modelId ${next}`, opts, true)
        : null;
      if (res && !res.error) {
        if (thresholdShape === undefined) {
          thresholdShape = cmd;
          log(`阈值屏蔽命令: ${cmd} #N minimum … set 0 ✓ — 参考图信号包络以外的噪声将被置零`);
        }
        return next;
      }
      res = await exec(t, `${cmd} #${id} minimum ${level.toFixed(5)} set 0`, opts, true);
      if (res && !res.error) {
        if (thresholdShape === undefined) {
          thresholdShape = cmd;
          log(`阈值屏蔽命令: ${cmd} #N minimum … set 0 ✓ — 参考图信号包络以外的噪声将被置零`);
        }
        return parseOpenModelId(res.text);
      }
    }
    if (thresholdShape === undefined) {
      thresholdShape = null;
      log("⚠ 阈值命令（volume/vop threshold）不可用 — 无法屏蔽参考图噪声，拟合在未屏蔽参考上进行");
    }
    return null;
  };

  let refSmoothC: number | null = null;
  let refSmoothF: number | null = null;
  /** v3.67: the NOISE-MASKED fit targets — threshold-set-0 clones of the
   * reference (σ-coarse / σ-fine / full-resolution). Fitting and scoring
   * prefer these; each falls back to its unmasked parent (and the
   * full-res target to the raw reference) on builds without the
   * threshold command. */
  let refMaskC: number | null = null;
  let refMaskF: number | null = null;
  let refMaskFull: number | null = null;
  if (lowpass && matrixOk) {
    refSmoothC = await gaussianSmooth(refId, SIGMA_COARSE_A);
    if (refSmoothC != null) {
      refSmoothF = await gaussianSmooth(refId, SIGMA_FINE_A);
    }
  }
  /* v3.86 (round-46 “align是能去掉去垢剂后进行吗？”) — DETERGENT
   * REMOVAL for the ALIGNMENT TARGETS. The noise-mask clones are built at
   * each model's OWN protein-band boundary (that model's /membrane2
   * split) instead of the flat 0.125×max: with the belt phase zeroed out
   * of the target, fitmap's cosine metric no longer rewards belt-on-belt
   * overlap — the flat detergent torus used to dominate the objective and
   * lock in arbitrary in-plane rolls (the delivered “align 存在问题”).
   * The moving map keeps its belt (only dilutes, never biases — its
   * points over the zeroed region contribute nothing). Graceful no-ops:
   * hot-belt maps (belt = high band — a threshold cannot hide it), old
   * relays (no /membrane2) and degenerate splits all keep the classic
   * v3.67 mask level, each logged honestly. */
  /* v3.87 (round-47 “可能是在不正确的level下进行align？…目前最终map的
   * level选的0.25倍，但是前面的map目前也都是0.25吗？”): the OLD-RELAY
   * ALIGNMENT MASK rung. The v3.86 detergent removal reads each model's
   * /membrane2 split — an old relay.py (the round-46 guidance said no
   * re-open needed) has none, so the user's real run silently kept the
   * flat 0.125×max targets (belt + noise included) and EVERY intermediate
   * map fit off-axis (the delivered (6) deck: only the reference stands).
   * Without a split, the best available protein-band proxy is the
   * REFERENCE's OWN probe-verified display level — the knee just proved it
   * renders clean (noise floor cleared, cold belt hidden, main coverage
   * verified), so masking the fit targets there zeroes exactly the density
   * the screenshots do not show. Hot belts (detergent above the display
   * level) survive — logged honestly, same as v3.86's hot-belt case. */
  const refDispLevel = displayLevelById.get(refId) ?? null;
  const refDispRatio =
    refDispLevel != null && refStats && Number.isFinite(refStats.max) && refStats.max > 0
      ? refDispLevel / refStats.max
      : null;
  const maskNotes: string[] = [];
  if (opts.membraneView?.mode === "auto" && t.kind === "relay" && !t.canMembrane2) {
    log(
      "⚠ 当前桥脚本无 /membrane2 三相分割 — 对齐屏蔽退回参考图渲染验证 level（低于该值的噪声/冷胶束密度不参与拟合）；在 ChimeraX 重新运行一次 relay.py 可启用完整三相分割（无需重启 ChimeraX）",
    );
  }
  for (const [sid, fine] of [
    [refSmoothC, false],
    [refSmoothF, true],
  ] as Array<[number | null, boolean]>) {
    if (sid == null) continue;
    const sStats = await bridgeVolStats(t, sid);
    if (!sStats) continue;
    await exec(t, `volume #${sid} level ${(sStats.max * LEVEL_RATIO).toFixed(4)} step ${STEP}`, opts, true);
    let maskLevel = sStats.max * MASK_RATIO;
    if (t.canMembrane2) {
      /* the clone's OWN split — Gaussian smoothing reshapes the histogram,
       * so the unsmoothed reference's t2 must not be reused verbatim. */
      const m2c = await bridgeMembrane2(t, sid);
      const beltC = beltLevelFrom(m2c, sStats);
      if (beltC.proteinLevel != null) {
        maskLevel = Math.max(maskLevel, beltC.proteinLevel);
        maskNotes.push(`${fine ? "细" : "粗"}尺度屏蔽 ${maskLevel.toFixed(4)}（${(maskLevel / sStats.max).toFixed(3)}×max · 蛋白相带以下置零）`);
      } else if (beltC.beltBand === "high") {
        maskNotes.push(`${fine ? "细" : "粗"}尺度屏蔽保持 ${(maskLevel / sStats.max).toFixed(3)}×max（胶束相较蛋白更热 — 阈值无法去除）`);
      }
    } else if (refDispRatio != null) {
      /* v3.87: the old-relay rung — the reference's clean display ratio
       * (probe-verified above) replaces the flat 0.125×max, scaled onto the
       * smoothed clone's own max (smoothing reshapes the histogram). */
      const ratio = Math.min(refDispRatio, MASK_LEVEL_CAP_RATIO);
      maskLevel = Math.max(maskLevel, sStats.max * ratio);
      maskNotes.push(
        `${fine ? "细" : "粗"}尺度屏蔽 ${maskLevel.toFixed(4)}（${(maskLevel / sStats.max).toFixed(3)}×max · 参考图渲染验证 level — 旧桥无三相分割）`,
      );
    }
    const mask = await thresholdZero(sid, maskLevel);
    if (fine) refMaskF = mask;
    else refMaskC = mask;
  }
  // v3.67: the full-resolution masked reference needs no smoothing
  // pyramid — even the degraded fallbacks (no gaussian / no matrix
  // round-trip) still get noise-masked fitting. v3.86: the full-res mask
  // rides the reference's OWN protein-band boundary (beltLevelFrom was
  // computed on this exact model in 2a).
  if (refStats) {
    let maskLevel = refStats.max * MASK_RATIO;
    if (refBeltInfo.proteinLevel != null) {
      maskLevel = Math.max(maskLevel, refBeltInfo.proteinLevel);
      maskNotes.push(`全分辨率屏蔽 ${maskLevel.toFixed(4)}（${(maskLevel / refStats.max).toFixed(3)}×max · 胶束相带以下置零）`);
    } else if (refBeltInfo.beltBand === "high") {
      maskNotes.push("全分辨率屏蔽保持经典比例（参考胶束相较蛋白更热 — 阈值无法去除）");
    } else if (!t.canMembrane2 && refDispLevel != null) {
      /* v3.87: the old-relay rung — the reference's probe-verified display
       * level replaces the flat 0.125×max (see the clone loop above). */
      const capped = Math.min(refDispLevel, refStats.max * MASK_LEVEL_CAP_RATIO);
      if (capped > maskLevel) {
        maskLevel = capped;
        maskNotes.push(
          `全分辨率屏蔽 ${maskLevel.toFixed(4)}（${(maskLevel / refStats.max).toFixed(3)}×max · 参考图渲染验证 level — 旧桥无三相分割）`,
        );
      }
    }
    refMaskFull = await thresholdZero(refId, maskLevel);
  }
  if (maskNotes.length) {
    const oldRung = maskNotes.some((n) => n.includes("参考图渲染验证"));
    log(
      `${oldRung ? "对齐目标已按参考图渲染验证 level 屏蔽（旧桥无三相分割）" : "对齐目标已按三相分割去除胶束相"}: ${maskNotes.join(" · ")} — fitmap 不再奖励胶束-胶束重叠，姿态由蛋白质密度决定`,
    );
  }
  if (refSmoothF != null && refMaskF != null) {
    log(
      `低通参考已生成（σ${SIGMA_COARSE_A}Å → #${refSmoothC}，σ${SIGMA_FINE_A}Å → #${refSmoothF}），噪声屏蔽拟合目标也已生成（粗 #${refMaskC ?? "—"} / 细 #${refMaskF}${refMaskFull != null ? ` / 全分辨率 #${refMaskFull}` : ""}）— 参考图信号包络以外全部置零，fitmap 只在信号区域内寻找最优姿态，背景噪声不再参与对齐`,
    );
  } else if (refSmoothF != null) {
    log(
      `低通参考已生成（σ${SIGMA_COARSE_A}Å → #${refSmoothC}，σ${SIGMA_FINE_A}Å → #${refSmoothF}）— 阈值屏蔽不可用，拟合在平滑后（未屏蔽）参考上进行`,
    );
  } else if (refSmoothC != null) {
    log(`低通参考仅 σ${SIGMA_COARSE_A}Å 可用（#${refSmoothC}）— 搜索与细化都在粗尺度进行`);
  } else if (refMaskFull != null) {
    log(`⚠ 无法生成低通参考（平滑命令不可用）— 使用全分辨率噪声屏蔽参考 #${refMaskFull} 直接拟合`);
  } else {
    log("⚠ 低通参考与噪声屏蔽副本均不可用 — 退回全分辨率直接拟合（未屏蔽）");
  }

  /* ---- 3. per-map alignment (v3.66: fitmap probe + 双手性 × 双轨迹) ---- */
  const renders: MapRender[] = [];
  const all = [opts.reference, ...opts.maps];
  const perMapPct = 45 / Math.max(1, all.length);
  let pct = 15;

  /* v3.66 run-scoped engine state. `fitShape` is the fitting command
   * shape THIS ChimeraX actually runs — probed lazily by the first fit
   * call through [fitmap/inMap (the documented form) → fitmap/in →
   * fit/inMap → fit/in]; every later fit reuses the winner. The
   * v3.56–65 ladder hard-coded `fit #v in #ref [search 15]` — NOT a
   * stock ChimeraX command — so on real machines both fit calls errored
   * “unknown command”, the soft flag swallowed it, and score = fit2 ??
   * fit1 ?? pre silently degraded to the STATIC pose correlation: the
   * alignment never moved a map (the persistent 对齐不准确). The probe
   * works on any build and logs the winning shape so a pasted log is
   * self-diagnosing. */
  const FIT_SHAPES = [
    { cmd: "fitmap", kw: "inMap" },
    { cmd: "fitmap", kw: "in" },
    { cmd: "fit", kw: "inMap" },
    { cmd: "fit", kw: "in" },
  ];
  let fitShape: { cmd: string; kw: string } | null | undefined;
  /** v3.67: the metric/envelope keywords appended to every fit — probed
   * WITH the command shape (see runFit); "" when this ChimeraX rejects
   * them (the bare v3.66 command). */
  let fitArgs: string | undefined;
  let searchOk: boolean | undefined;
  let measureShape: "inMap" | "pos" | undefined;

  const fitText = (cand: number, ref: number, search?: number) =>
    `${fitShape?.cmd} #${cand} ${fitShape?.kw} #${ref}${fitArgs ?? ""}${search ? ` search ${search}` : ""}`;

  /** v3.66: `measure correlation` with the same runtime-shape care — the
   * inMap form is what has parsed on the real machine since v3.56; the
   * positional form keeps other builds alive. */
  const measureCorr = async (a: number, b: number): Promise<number | null> => {
    const shapes: Array<"inMap" | "pos"> = measureShape ? [measureShape] : ["inMap", "pos"];
    for (const s of shapes) {
      const cmd = s === "inMap" ? `measure correlation #${a} inMap #${b}` : `measure correlation #${a} #${b}`;
      const r = await exec(t, cmd, opts, true);
      const v = parseCorrelation(r.text) ?? parseCorrelation(r.error);
      if (v != null) {
        measureShape = s;
        return v;
      }
    }
    return null;
  };

  /** One fitting call (LOCAL optimisation when `search` is omitted — a
   * successful fit MOVES the fitted model to its optimum). Probes the
   * command shape AND the metric/envelope keywords on first use; returns
   * null when nothing runs on this ChimeraX (the caller degrades to
   * static scoring). v3.67: `metric correlation envelope true` — the
   * map-in-map default metric is OVERLAP (a scale-carrying inner
   * product), and envelope defaults to FALSE for maps not shown as
   * isosurfaces (i.e. every v3.66 fit scored ALL NONZERO points of the
   * noisy moving map); the cosine metric + above-level sampling make
   * the objective scale-free and signal-only. A build that rejects the
   * keywords falls back to the bare command. */
  const runFit = async (cand: number, ref: number, search?: number): Promise<ExecResult | null> => {
    if (fitShape === null) return null;
    if (fitShape && fitArgs !== undefined) {
      // v3.68: the search timeout SCALES with the placement count — 30
      // placements keep the v3.66 300 s, every appended round's bigger
      // search gets proportional headroom (+150 s per extra 30
      // placements, capped at 10 min — the relay /exec has no
      // server-side timeout, only this client-side abort matters).
      const tmo = search
        ? Math.min(
            600_000,
            Math.round(FIT_SEARCH_TIMEOUT_MS * (1 + (search - SEARCH_PLACEMENTS) / (SEARCH_PLACEMENTS * 2))),
          )
        : undefined;
      return await exec(t, fitText(cand, ref, search), opts, true, tmo);
    }
    const fails: string[] = [];
    for (const args of [" metric correlation envelope true", ""]) {
      for (const s of FIT_SHAPES) {
        const cmd = `${s.cmd} #${cand} ${s.kw} #${ref}${args}`;
        const r = await exec(t, cmd, opts, true);
        if (!r.error) {
          fitShape = s;
          fitArgs = args;
          log(
            `拟合命令: ${s.cmd} #N ${s.kw} #N${args ? " metric correlation envelope true" : ""} ✓ — 本 ChimeraX 以该形态做位姿搜索${args ? "（余弦度量，只采样移动图高于阈值的数据点）" : ""}`,
          );
          return r;
        }
        fails.push(`${s.cmd} ${s.kw}${args ? "+metric/envelope" : ""}: ${logSnippet(r.error, 80)}`);
      }
    }
    log(`⚠ 拟合命令（fitmap/fit）全部不可用 — 本次退化为静止姿态评分（不移动地图）。探测详情: ${fails.join("；")}`);
    fitShape = null;
    fitArgs = undefined;
    return null;
  };

  /** v3.66: the global random-placement search — arbitrary rotations and
   * translations, each locally optimised by ChimeraX, the best pose left
   * on the model. Covers the 90°/arbitrary-tilt poses the fixed
   * 180°-pre-turn candidates of v3.63 could never reach. A FIRST failure
   * (unsupported keyword / timeout) disables the search for the whole
   * run; a mid-run failure after an earlier success just degrades the
   * current hand. v3.68: takes the round's PLACEMENT count — the
   * adaptive ladder escalates it per appended round (30 → 60 → 90 …). */
  const runSearch = async (cand: number, ref: number, placements: number): Promise<ExecResult | null> => {
    if (searchOk === false || fitShape == null) return null;
    const r = await runFit(cand, ref, placements);
    if (r && !r.error) {
      if (searchOk === undefined) {
        searchOk = true;
        log(`全局搜索可用（${fitShape.cmd} … search ${placements} 随机放置，未达目标按轮次递增）`);
      }
      return r;
    }
    if (searchOk === true) return r;
    searchOk = false;
    log(`⚠ 全局搜索不可用（${logSnippet(r?.error ?? "无返回", 120)}）— 本次仅做局部拟合`);
    return null;
  };

  /** v3.66 SAFETY NET: close any volume model that appeared outside the
   * engine's bookkeeping (e.g. a stray fitmap-search copy) — a stray
   * would ride the screenshot phase (the round-14 disease). Relay only
   * (needs /volumes). `extra` lists ids legitimately open besides
   * openIds right now (the reference's smooth clones). */
  const sweepStrayVolumes = async (extra: Array<number | null>): Promise<void> => {
    if (t.kind !== "relay") return;
    const vols = await bridgeVolumeIds(t);
    if (vols == null) return;
    const legit = new Set<string>([...openIds].map((id) => String(id)));
    for (const id of extra) if (id != null) legit.add(String(id));
    for (const v of vols) {
      if (!legit.has(v.id)) {
        await exec(t, `close #${v.id}`, opts, true);
        log(`  已关闭多余地图模型 #${v.id}（${logSnippet(v.name, 60)}）— 拟合产生的副本不会进入截图`);
      }
    }
  };

  /* v3.68: resolved adaptive-search parameters — the target correlation
   * and the per-hand round cap (clamped), announced once so a pasted run
   * log carries the escalation schedule it actually ran with. */
  const corrTarget =
    typeof opts.corrTarget === "number" && Number.isFinite(opts.corrTarget)
      ? Math.min(0.999, Math.max(0.1, opts.corrTarget))
      : CORR_TARGET;
  const searchMaxRounds =
    typeof opts.searchMaxRounds === "number" && Number.isFinite(opts.searchMaxRounds)
      ? Math.min(6, Math.max(1, Math.round(opts.searchMaxRounds)))
      : SEARCH_MAX_ROUNDS;
  log(
    `对齐目标: 相关性 ≥ ${corrTarget} — 未达标自动追加全局搜索轮次（最多 ${searchMaxRounds} 轮，随机放置 ${Array.from(
      { length: searchMaxRounds },
      (_, i) => SEARCH_PLACEMENTS * (i + 1),
    ).join(" → ")}）；达标即止：初始姿态达标跳过拟合，原手达标跳过镜像手性对比`,
  );

  /** v3.89 (round-49 “中间过程的map角度还是不对”): the MOVING side's fit
   * sampling level. fitmap `envelope true` samples the moving map above
   * its CURRENT DISPLAY level, and the open-time level was the flat
   * 0.25×max — on the deck-8 intermediates the detergent micelle (mid-band
   * density, t1 < ρ < t2) sat almost entirely ABOVE that level, so every
   * fit sampled a big blob of micelle points that could overlap the
   * reference anywhere (micelle-on-protein rewards → yawed/tipped poses
   * that still pass the correlation bars — the J48 end-on / J9 oblique
   * renders). The moving model's OWN 3-phase split gives the protein-only
   * threshold (proteinLevel = t2, capped at half-max): when it sits above
   * the classic level, the fit samples protein only, mirroring the v3.86
   * reference-side detergent removal — the alignment now runs 去掉去垢剂
   * on BOTH sides. The display level is unaffected (the knee re-decides it
   * at export time). */
  const fitSamplingLevelFor = async (
    id: number,
    stats: BridgeVolStats | null,
    classic: number | null,
  ): Promise<{ level: number | null; rule: string | null }> => {
    if (classic == null || !stats || !Number.isFinite(stats.max) || stats.max <= 0) return { level: classic, rule: null };
    if (!t.canMembrane2) return { level: classic, rule: null };
    const m2 = await bridgeMembrane2(t, id);
    const belt = beltLevelFrom(m2, stats);
    if (belt.proteinLevel == null || !Number.isFinite(belt.proteinLevel)) return { level: classic, rule: null };
    if (belt.proteinLevel <= classic + 1e-9) return { level: classic, rule: null };
    return { level: belt.proteinLevel, rule: "本图蛋白/胶束分界 t2 — 移动侧同样不采样胶束密度" };
  };

  for (const req of all) {
    if (threw(opts.signal)) throw new Error("aborted");
    const isReference = req.key === opts.reference.key;
    if (isReference) {
      renders.push({
        key: req.key,
        uid: req.uid,
        group: req.group,
        // v3.71: the reference row carries the hand-policy verdict so the
        // report table shows WHAT grounded the figure's hand (e.g.
        // “EMalign 验证镜像 · 已翻正（0.31 vs 0.94）"); plain "reference"
        // in auto mode (pre-3.71 look).
        candidate: refHandVerdict ? `reference · ${refHandVerdict}` : "reference",
        score: 1,
        chirality: "consistent",
        rows: [],
        png: null,
        modelId: refId,
      });
      openIds.add(refId);
      continue;
    }
    progress(`对齐 ${req.key}（局部细化 + 全局搜索 · 达标即止）`, pct);
    pct += perMapPct * 0.75;

    const rows: CandidateRow[] = [];
    // v3.52: this map's Chimera default open-color (class position) — both
    // hands (incl. the flipped copy) render in it, so the screenshot
    // matches the class maps opened together in Chimera. v3.53: applied via
    // `volume #<id> color` — the volume command's color option; `color #<id>`
    // never touched volume surfaces on the real machine.
    const mapColor = requestColor(req);
    const fileStem = safeKeyPart(req.key.replace(/\//g, "__"));

    /* v3.66: the map opens ONCE (the v3.63–65 ladder re-opened it for
     * each of the 8 candidates) and the z-flip hand is created from the
     * PRISTINE model before any fitting — `volume flip` bakes mirrored
     * DATA, so it must not inherit a fitted pose. */
    const hands: Array<{ name: "original" | "flip_z"; modelId: number }> = [];
    {
      let origId: number | null = null;
      /* v3.89: the original hand's protein-banded fit sampling level —
       * hoisted so the flip hand can carry it over (the flip preserves
       * the value distribution). */
      let origFitLevel: number | null = null;
      let origFitMax: number | null = null;
      try {
        const openRes = await bridgeOpenModel(t, req.sourceUrl);
        origId = openRes.modelId;
        if (origId == null) {
          throw new Error(openRes.error || logSnippet(openRes.text) || "open produced no model");
        }
        openIds.add(origId);
        const stats = await bridgeVolStats(t, origId);
        const classicLevel = stats ? stats.max * LEVEL_RATIO : refLevel;
        /* v3.89: the FIT sampling level — the moving model's own protein
         * band when it sits above the classic 0.25×max (the micelle must
         * not ride the fitmap envelope); the DISPLAY level is decided at
         * export time by the knee (or the policy below in manual mode). */
        const fit0 = await fitSamplingLevelFor(origId, stats, classicLevel);
        const level = fit0.level;
        origFitLevel = level;
        origFitMax = stats && Number.isFinite(stats.max) && stats.max > 0 ? stats.max : null;
        if (fit0.rule && level != null) {
          log(`  ${req.key}: 拟合采样 level ${level.toFixed(4)}（${fit0.rule}）`);
        }
        /* v3.77 → v3.82: the DISPLAY level for this map's screenshot. In
         * kneeMode (auto + probes) the level is decided AT EXPORT TIME by
         * the rendered knee ladder — nothing to preselect here. Otherwise
         * (manual / REST) the policy rule records it now. The fit level
         * below stays 0.25×max unless protein-banded; only the visible
         * contour rides the policy. */
        statsById.set(origId, stats);
        if (!kneeMode) {
          const mapDisplayChoice = displayLevelFor(stats, contourPolicy, refAnchor);
          if (mapDisplayChoice) {
            displayLevelById.set(origId, mapDisplayChoice.level);
            log(`  ${req.key}: 截图 level ${mapDisplayChoice.level.toFixed(4)}（${mapDisplayChoice.rule}）`);
          }
        }
        if (level != null) {
          await exec(t, `volume #${origId} level ${level.toFixed(4)} step ${STEP}`, opts, true);
        } else {
          const sdTry = await exec(t, `volume #${origId} level 2 sd step ${STEP} style surface`, opts, true);
          if (sdTry.error) await exec(t, `volume #${origId} step ${STEP} style surface`, opts, true);
        }
        await exec(t, `volume #${origId} color ${mapColor}`, opts, true);
        hands.push({ name: "original", modelId: origId });
      } catch (err) {
        log(`  ${req.key}: 打开地图失败 — ${String(err).slice(0, 160)}`);
        rows.push({
          candidate: "original",
          score: null,
          pre: null,
          fit1: null,
          fit2: null,
          ok: false,
          note: String(err).slice(0, 160),
        });
      }

      /* the flipped hand — v3.63's `volume flip` with v3.66 hardening: a
       * command ERROR no longer yields a phantom id (v3.63 trusted
       * /nextid blindly; a failed flip then addressed a non-existent
       * model for the rest of that candidate's ladder). */
      if (origId != null) {
        try {
          let flipId: number | null = null;
          const next = await bridgeNextModelId(t);
          let flipRes = next != null
            ? await exec(t, `volume flip #${origId} axis z modelId ${next}`, opts, true)
            : null;
          if (flipRes && !flipRes.error) {
            /* v3.74: trust the explicit modelId — parsing the log could
             * grab the SOURCE map's id (or a submodel's) instead of the
             * new volume (same hardening as flipReference above). */
            flipId = next;
          } else {
            flipRes = await exec(t, `volume flip #${origId} axis z`, opts, true);
            if (flipRes && !flipRes.error) {
              const ids = Array.from(flipRes.text.matchAll(/#(\d+(?:\.\d+)?)/g)).map((m) => parseInt(m[1], 10));
              flipId = ids.find((id) => id !== origId && !openIds.has(id)) ?? null;
            }
          }
          if (flipId == null) throw new Error("flip produced no model");
          openIds.add(flipId);
          const stats2 = await bridgeVolStats(t, flipId);
          /* v3.89: the flip preserves the value distribution, so the
           * original hand's protein band carries over (scaled by the two
           * maxima — identical in practice); only an independent fallback
           * when the original never got one. */
          const classic2 = stats2 ? stats2.max * LEVEL_RATIO : refLevel;
          const level2 =
            origFitLevel != null && origFitMax != null && stats2 && Number.isFinite(stats2.max) && stats2.max > 0
              ? origFitLevel * (stats2.max / origFitMax)
              : (await fitSamplingLevelFor(flipId, stats2, classic2)).level;
          /* v3.77 → v3.82: display level for the flipped hand's screenshot
           * (same policy as the original — the flip preserves the value
           * distribution, so the two levels coincide; kneeMode decides at
           * export time). */
          statsById.set(flipId, stats2);
          if (!kneeMode) {
            const flipDisplayChoice = displayLevelFor(stats2, contourPolicy, refAnchor);
            if (flipDisplayChoice) displayLevelById.set(flipId, flipDisplayChoice.level);
          }
          if (level2 != null) {
            await exec(t, `volume #${flipId} level ${level2.toFixed(4)} step ${STEP}`, opts, true);
          }
          await exec(t, `volume #${flipId} color ${mapColor}`, opts, true);
          hands.push({ name: "flip_z", modelId: flipId });
        } catch (err) {
          log(`  ${req.key}: 生成 z 翻转副本失败（手性检查仅剩原手）— ${String(err).slice(0, 140)}`);
          rows.push({
            candidate: "flip_z",
            score: null,
            pre: null,
            fit1: null,
            fit2: null,
            ok: false,
            note: String(err).slice(0, 140),
          });
        }
      }
    }

    /* v3.66: the TWO-TRACK pose ladder per hand. Working pair = the σ
     * pyramid clones when the reference clones + matrix transfer are
     * healthy, else the full-resolution models. Track 局部细化 fits
     * locally from the incoming pose (same-pipeline maps start
     * near-aligned — the likeliest basin), coarse→fine; track 全局搜索
     * runs the random-placement search at the coarsest available scale,
     * then refines at the finest. The better track (by correlation at
     * the finest scale) is applied to the FULL-RESOLUTION hand via
     * matrixget/matrixset, polished with one full-res local fit and
     * verified with a full-res measure correlation (the row's `post` —
     * the honest ranking number for BOTH hands). The full-res hand model
     * is the screenshot target either way.
     *
     * v3.69 (round-28 “correlation 达到一定数值就可以跳过某些之前
     * 必须要做的对比工作”): TARGET-GATED EARLY EXITS — the ladder only
     * pays for work the correlation says is still needed:
     *   - 静止达标: a hand whose INCOMING pose already measures ≥
     *     corrTarget on its working pair skips the local fit AND the
     *     search — fitting cannot improve a pose the metric already
     *     endorses; the pose is captured (matrixget) for the transfer.
     *   - 镜像跳过: an original hand that VALIDATED a pose (lowpass or
     *     full-res correlation ≥ corrTarget) skips the flip_z hand's
     *     ENTIRE ladder — a pose at the target cannot be beaten by a
     *     wrong-handed mirror, so the comparison is pure waste. The
     *     flip copy is still CREATED upfront (one cheap `volume flip`
     *     BEFORE any fitting — flipping a fitted model bakes its pose,
     *     the v3.63 disease) and simply never fitted; the loser-close
     *     loop closes it as usual, and chirality reads 一致 — justified:
     *     a wrong-handed map cannot reach the masked target. */
    let priorHandMetTarget = false;
    let priorHandMetWhy = "";
    let flipHandSkipped = false;
    for (const hand of hands) {
      if (threw(opts.signal)) throw new Error("aborted");
      /* v3.69 镜像跳过: the mirror hand is CONDITIONAL — skipped when the
       * original hand already reached the target. The row keeps a loud
       * note for the report; the flip MODEL itself is closed by the
       * loser-close loop after the selection. */
      if (hand.name === "flip_z" && priorHandMetTarget) {
        flipHandSkipped = true;
        rows.push({
          candidate: "flip_z",
          score: null,
          pre: null,
          fit1: null,
          fit2: null,
          ok: false,
          note: `跳过 — 原手${priorHandMetWhy}，镜像对比属冗余工作`,
        });
        log(
          `  ${req.key} · flip_z: 原手${priorHandMetWhy} — 跳过镜像手性对比（省去该手的平滑、双轨迹拟合与最多 ${searchMaxRounds} 轮全局搜索）`,
        );
        continue;
      }
      const handId = hand.modelId;
      let smoothC: number | null = null;
      let smoothF: number | null = null;
      let pre: number | null = null;
      let corr1: number | null = null;
      let corr2: number | null = null;
      let post: number | null = null;
      let track = "静止";
      let note: string | undefined;
      try {
        if (lowpass && matrixOk && refSmoothC != null) {
          smoothC = await gaussianSmooth(handId, SIGMA_COARSE_A);
          if (smoothC != null) {
            smoothF = await gaussianSmooth(handId, SIGMA_FINE_A);
          }
          for (const sid of [smoothC, smoothF]) {
            if (sid == null) continue;
            const sStats = await bridgeVolStats(t, sid);
            if (sStats) {
              /* v3.89: each σ-clone's OWN 3-phase split (Gaussian smoothing
               * reshapes the histogram — the same reason the reference's
               * mask clones re-split); the protein band when it sits above
               * the classic 0.25×max, so the pyramid fits sample protein
               * only on the moving side too. */
              const sFit = await fitSamplingLevelFor(sid, sStats, sStats.max * LEVEL_RATIO);
              const sLevel = sFit.level ?? sStats.max * LEVEL_RATIO;
              await exec(t, `volume #${sid} level ${sLevel.toFixed(4)} step ${STEP}`, opts, true);
            }
            await exec(t, `volume #${sid} color ${mapColor}`, opts, true);
          }
        }
        /* v3.67: every fit target is the MASKED reference clone when one
         * exists (signal envelope only), falling back to its unmasked
         * parent — the moving side is sampled above its explicit contour
         * level (`envelope true`), so far-field noise contributes on
         * NEITHER side of the objective. */
        const refCt = refMaskC ?? refSmoothC;
        const refFt = refMaskF ?? refSmoothF;
        const refFullT = refMaskFull ?? refId;
        const pairC = smoothC != null && refCt != null ? { a: smoothC, b: refCt } : null;
        const pairF = smoothF != null && refFt != null ? { a: smoothF, b: refFt } : null;
        const pairFull = { a: handId, b: refFullT };
        const workPair = pairF ?? pairC ?? pairFull;

        pre = await measureCorr(workPair.a, workPair.b);

        /* ---- 轨迹 1 · 局部细化 ---- */
        let xf1: string | null = null;
        if (fitShape !== null) {
          const target = pairF ?? pairC ?? pairFull;
          if (pre != null && pre >= corrTarget) {
            /* v3.69 静止达标: the incoming pose ALREADY measures ≥ target
             * on this pair (masked cosine — the same number every later
             * decision reads) — fitting cannot improve a pose the metric
             * already endorses, so capture it as-is; the search gate
             * (corr1 ≥ target) then skips track 2 as well. */
            corr1 = pre;
            xf1 = await matrixSave(target.a, `${fileStem}_${hand.name}_s1`);
            track = "静止达标";
            log(`  ${req.key} · ${hand.name}: 初始姿态相关性 ${pre.toFixed(4)} ≥ ${corrTarget} — 跳过局部拟合与全局搜索`);
          } else {
            if (pairC && pairF) {
              await runFit(pairC.a, pairC.b);
              const xfc = await matrixSave(pairC.a, `${fileStem}_${hand.name}_s1c`);
              if (xfc) await matrixLoad(pairF.a, xfc);
            }
            const r1 = await runFit(target.a, target.b);
            if (r1) {
              corr1 = await measureCorr(target.a, target.b);
              xf1 = await matrixSave(target.a, `${fileStem}_${hand.name}_s1`);
              track = "局部细化";
            }
          }
        }

        /* ---- 轨迹 2 · 全局搜索（任意旋转角，v3.68 目标驱动的自适应轮次）----
         * Round 1 runs unless the local track already reached the
         * target; while the best fine-scale correlation stays BELOW the
         * target, MORE rounds run with ESCALATING placement counts
         * (SEARCH_PLACEMENTS × round) — the user's “correlation 未达标
         * 就增加搜索轮次”. Every round is a FRESH random-placement
         * sample of pose space (fitmap search re-places the model each
         * time); the best round's pose (by σ-fine masked correlation)
         * is the one kept for the full-res transfer. Stops on: target
         * reached / round cap / the search erroring (a first failure
         * disables it for the run, a later one just ends this hand's
         * escalation). */
        let xf2: string | null = null;
        let searchRounds = 0;
        if (fitShape !== null && searchOk !== false) {
          const searchPair = pairC ?? pairF ?? pairFull;
          const searchTarget = pairF ?? pairC ?? pairFull;
          const fmtCorr = (v: number) => (v > -0.5 ? v.toFixed(4) : "—");
          const bestFine = () => Math.max(corr1 ?? -1, corr2 ?? -1);
          if (corr1 != null && corr1 >= corrTarget) {
            if (track !== "静止达标") {
              log(`  ${req.key} · ${hand.name}: 局部细化已达目标（corr=${corr1.toFixed(4)} ≥ ${corrTarget}）— 跳过全局搜索`);
            }
          }
          while (searchRounds < searchMaxRounds && bestFine() < corrTarget) {
            const round = searchRounds + 1;
            const placements = SEARCH_PLACEMENTS * round;
            if (round > 1) {
              log(
                `  ${req.key} · ${hand.name}: 最佳相关性 ${fmtCorr(bestFine())} 未达目标 ${corrTarget} — 追加第 ${round}/${searchMaxRounds} 轮全局搜索（${placements} 个随机放置）`,
              );
            }
            const rN = await runSearch(searchPair.a, searchPair.b, placements);
            if (!rN || rN.error) break;
            searchRounds = round;
            if (pairC && pairF) {
              const xfc = await matrixSave(pairC.a, `${fileStem}_${hand.name}_s2c_r${round}`);
              if (xfc) await matrixLoad(pairF.a, xfc);
            }
            await runFit(searchTarget.a, searchTarget.b);
            const corrN = await measureCorr(searchTarget.a, searchTarget.b);
            if (corrN != null && (corr2 == null || corrN > corr2 + 1e-6)) {
              corr2 = corrN;
              xf2 = await matrixSave(searchTarget.a, `${fileStem}_${hand.name}_s2_r${round}`);
            }
            log(
              `  ${req.key} · ${hand.name}: 第 ${round} 轮全局搜索（${placements} 放置）→ corr=${corrN != null ? corrN.toFixed(4) : "—"}（最佳 ${fmtCorr(bestFine())} ${
                bestFine() >= corrTarget
                  ? `≥ ${corrTarget} 已达标 ✓`
                  : `< ${corrTarget}${searchRounds >= searchMaxRounds ? "，轮次已用尽" : ""}`
              }）`,
            );
          }
        }

        /* ---- 胜出轨迹 → 应用回全分辨率 map ---- */
        let corr = corr1;
        let xf = xf1;
        if (corr2 != null && (corr1 == null || corr2 > corr1 + 1e-6)) {
          corr = corr2;
          xf = xf2;
          track = searchRounds > 1 ? `全局搜索×${searchRounds}轮` : "全局搜索";
        }
        if (xf) {
          const applied = await matrixLoad(handId, xf);
          if (!applied) note = "最优姿态矩阵应用失败 — 保持当前姿态继续细化";
        } else if ((pairF || pairC) && fitShape !== null) {
          note = "低通姿态捕获失败 — 全分辨率地图按原姿态继续细化";
        }
        /* v3.67 full-resolution polish + the honest score — BOTH against
         * the MASKED full-res reference. v3.66 polished and scored
         * against the RAW reference: the local full-res fit could walk a
         * noisy map off the basin the pyramid had just found, and the
         * whole-box correlation ranked the two hands partly by noise.
         * With the mask the polish objective is signal-only, and `post`
         * measures the signal envelope alone (u = the hand's above-level
         * points — set at open; v = the masked reference). */
        if (fitShape !== null) {
          await runFit(handId, refFullT);
        }
        post = await measureCorr(handId, refFullT);
        const score = post ?? corr ?? pre;
        if (fitShape == null) note = "拟合命令不可用 — 静止姿态评分";
        /* v3.68: when the FULL-RESOLUTION score stays below the target,
         * say WHY no further search round can help — either the lowpass
         * pose already reached the target (the gap is full-res
         * noise/resolution difference, not a wrong pose) or the rounds
         * were exhausted (the map is genuinely hard against this
         * reference). */
        if (post != null && post < corrTarget) {
          const fineBest = Math.max(corr1 ?? -1, corr2 ?? -1);
          log(
            `  ${req.key} · ${hand.name}: 全分辨率相关性 ${post.toFixed(4)} 低于目标 ${corrTarget} — ${
              fineBest >= corrTarget
                ? `低通最优姿态已达 ${fineBest.toFixed(4)}，差距来自全分辨率噪声/分辨率差异，追加搜索轮次无益`
                : `低通最佳 ${fineBest > -0.5 ? fineBest.toFixed(4) : "—"} 亦未达标（搜索轮次已用尽或搜索不可用）— 该地图与参考的可对齐性有限`
            }`,
          );
        }
        /* v3.69: did THIS hand validate a pose at the target? — the
         * answer gates the MIRROR hand (see the flip_z skip at the top of
         * the loop). Both scales count: a lowpass correlation at the
         * target proves the pose (any full-res gap is then noise), a
         * full-res one proves it twice over. */
        const fineBestHand = Math.max(corr1 ?? -1, corr2 ?? -1);
        if (post != null && post >= corrTarget) {
          priorHandMetTarget = true;
          priorHandMetWhy = `全分辨率相关性 ${post.toFixed(4)} ≥ ${corrTarget}`;
        } else if (fineBestHand >= corrTarget) {
          priorHandMetTarget = true;
          priorHandMetWhy = `低通相关性 ${fineBestHand.toFixed(4)} ≥ ${corrTarget}`;
        }
        rows.push({
          candidate: hand.name,
          score,
          pre,
          fit1: corr1,
          fit2: corr2,
          ok: score != null,
          note,
          post,
        });
        log(
          `  ${req.key} · ${hand.name}: score=${score ?? "—"} (静止=${pre ?? "—"}, 局部=${corr1 ?? "—"}, 全局=${corr2 ?? "—"}, 全分辨率=${post ?? "—"}, 轨迹=${track})${note ? ` — ${note}` : ""}`,
        );
      } catch (err) {
        rows.push({
          candidate: hand.name,
          score: null,
          pre: null,
          fit1: null,
          fit2: null,
          ok: false,
          note: String(err).slice(0, 160),
        });
        log(`  ${req.key} · ${hand.name}: 失败 — ${String(err).slice(0, 140)}`);
      } finally {
        if (smoothC != null) await exec(t, `close #${smoothC}`, opts, true);
        if (smoothF != null) await exec(t, `close #${smoothF}`, opts, true);
        await sweepStrayVolumes([refSmoothC, refSmoothF, refMaskC, refMaskF, refMaskFull]);
      }
    }

    const handById = new Map<string, number>(hands.map((h) => [h.name as string, h.modelId]));
    const valid = rows.filter((r) => r.ok && r.score != null && handById.has(r.candidate));
    const bestRow = valid.sort((a, b) => (b.score as number) - (a.score as number))[0] ?? null;
    if (bestRow) {
      const bestId = handById.get(bestRow.candidate) as number;
      // Close the losing hand's model.
      for (const [name, id] of handById) {
        if (name !== bestRow.candidate) {
          await exec(t, `close #${id}`, opts, true);
          openIds.delete(id);
        }
      }

      /* v3.66: chirality — the FLIP HAND winning means the map needed
       * the mirror (已翻正); ε-close scores mean ambiguous (a symmetric
       * map reads the same in both hands). */
      const flipRow = rows.find((r) => r.candidate === "flip_z" && r.score != null) ?? null;
      let chirality: ChiralityStatus = "unknown";
      if (bestRow.candidate === "flip_z") {
        chirality = "corrected";
      } else if (flipRow && Math.abs((bestRow.score as number) - (flipRow.score as number)) <= CHIRALITY_EPSILON) {
        chirality = "ambiguous";
      } else {
        chirality = "consistent";
      }
      log(`  → ${req.key} 选中 ${bestRow.candidate}（score=${bestRow.score}），手性: ${chirality}${flipHandSkipped ? "（翻转手已按达标跳过）" : ""}，配色 ${mapColor}`);
      /* v3.71: with the reference's OWN hand established (anchor/manual
       * policy), the per-map verdict gains its BIOLOGICAL meaning — the
       * canonical reference is the correct hand (a mirrored verdict
       * flipped it up front), so a map that matched WITHOUT the flip is
       * itself correct-handed and one that needed flip_z was mirrored in
       * the raw data. The rare non-flipped mirror reference (the manual
       * flip FAILED) inverts the reading — noted in the log. */
      if (refHandKnown) {
        const mapHandCorrect = (bestRow.candidate !== "flip_z") === refIsCorrectHand;
        /* v3.74: the manual-mirrored FLIP-FAILED branch (refIsCorrectHand
         * false, refFlipFailed true) renders the maps as-is against the
         * still-mirrored reference — "已自动翻正展示" would be a lie; the
         * correction happens at DELIVERY time (every map z-flipped), and
         * the log says exactly that. */
        if (refFlipFailed) {
          log(
            `    生物学手性: 原始 map 与镜像参考同手（即均为镜像）— 因参考翻正失败，展示保持镜像；交付阶段将统一 z-flip 翻正`,
          );
        } else {
          log(
            `    生物学手性: ${mapHandCorrect ? "正确 ✓ — 与经验证的参考手性一致" : "镜像 — 原始 map 手性有误，已自动翻正展示"}`,
          );
        }
      }
      renders.push({
        key: req.key,
        uid: req.uid,
        group: req.group,
        candidate: bestRow.candidate,
        score: bestRow.score,
        chirality,
        rows,
        png: null,
        modelId: bestId,
      });
    } else {
      for (const id of handById.values()) {
        await exec(t, `close #${id}`, opts, true);
        openIds.delete(id);
      }
      log(`  → ${req.key}: 所有手性候选失败（无法对齐）`);
      renders.push({
        key: req.key,
        uid: req.uid,
        group: req.group,
        candidate: "none",
        score: null,
        chirality: "unknown",
        rows,
        png: null,
        modelId: null,
      });
    }
  }

  /* ---- 3.5 v3.64/v3.66/v3.67: close the lowpassed reference clones
   * AND their noise-mask clones — the pose search is done and the
   * screenshots below must render ONLY the full-resolution originals
   * (none of the clones were ever in openIds, so the hide-all loop
   * would have missed them). */
  for (const sid of [refSmoothC, refSmoothF, refMaskC, refMaskF, refMaskFull]) {
    if (sid != null) {
      await exec(t, `close #${sid}`, opts, true);
    }
  }
  refSmoothC = null;
  refSmoothF = null;
  refMaskC = null;
  refMaskF = null;
  refMaskFull = null;

  /* ---- 4. screenshots — v3.82: per-map level KNEE + per-map orientation
   * assist + per-map re-framing, before the same 1600×1200 export. ---- */
  if (t.canFetchFiles && t.workdir) {
    const shotTargets = renders.filter((r) => r.modelId != null);
    const shotTotal = Math.max(1, shotTargets.length);
    let shotDone = 0;
    progress("逐图导出高清截图 (1600×1200)", 60);
    for (const id of openIds) {
      await exec(t, `hide #${id} models`, opts, true);
    }
    await exec(t, "wait 1", opts, true);
    /* ---- v3.89: the reference's shared-view SILHOUETTE, cached once
     * before the per-map loop — every non-reference map's probe render is
     * IoU-matched (maskIou, main-component masks) against it (the
     * round-49 orientation fix: the deck-8 intermediates read
     * oblique/end-on while the reference stood, because each map's own
     * low anchor + fit pose + assist camera diverged from the reference's
     * viewing frame; the fit correlation cannot be trusted alone for
     * low-resolution blobs). The reference's display level is the run's
     * decided one (the knee re-run below is deterministic and lands on
     * the same rung — the ref-ratio floor keeps its own anchor). ---- */
    let refSilhouette: { mask: { w: number; h: number; data: Uint8Array }; standing: number } | null = null;
    if (applySharedView && refId != null && openIds.has(refId)) {
      const refLvl = displayLevelById.get(refId);
      if (refLvl != null) {
        await exec(t, `volume #${refId} level ${refLvl.toFixed(4)} step ${STEP}`, opts, true);
        await exec(t, `surface dust #${refId} size ${DUST_SIZE_A}`, opts, true);
      }
      await exec(t, `show #${refId} models`, opts, true);
      await applySharedView();
      await exec(t, "wait 1", opts, true);
      await exec(t, "view", opts, true);
      await exec(t, "wait 1", opts, true);
      const sil = await renderProbe("_refsil_shared.png");
      if (sil?.mask) {
        refSilhouette = { mask: sil.mask, standing: sil.standing };
        log(
          `参考图轮廓已缓存（共享视角 · 站立度 ${sil.standing >= 0 ? "+" : ""}${sil.standing.toFixed(3)}）— 各图按轮廓 IoU 与参考图同面呈现`,
        );
      } else {
        log("⚠ 参考图轮廓探针失败 — 各图保持共享视角（无轮廓匹配）");
      }
      await exec(t, `hide #${refId} models`, opts, true);
    }
    for (const r of renders) {
      if (threw(opts.signal)) throw new Error("aborted");
      const showId = r.modelId;
      if (showId == null) continue;
      await exec(t, `show #${showId} models`, opts, true);
      /* v3.82 (a): the per-map level KNEE — this map's own ladder of
       * rendered probes (fragmentation kills snowball speckle and the
       * free micelle blobs; the main-coverage floor kills the sponge).
       * The round-41/42 delivered deck had J48 snowballs and a J41
       * sponge at the same "0.25×max" rule: every map's noise floor sits
       * at a different place, so every map gets its own rendered knee.
       * Manual mode / non-probe transports keep the precomputed policy
       * level (setDisplayLevel). */
      if (kneeMode) {
        const stats = statsById.get(showId) ?? (await bridgeVolStats(t, showId));
        const knee = await kneeLevelFor(showId, stats, safeKeyPart(r.key.replace(/\//g, "__")));
        if (knee) {
          await exec(t, `volume #${showId} level ${knee.level.toFixed(4)} step ${STEP}`, opts, true);
          /* v3.85: re-issue the dust after the final level application —
           * the knee's probe already dusted, but a fresh `volume level`
           * recomputes the surface, so the dust rides along again
           * (deterministic, cheap). */
          await exec(t, `surface dust #${showId} size ${DUST_SIZE_A}`, opts, true);
          log(`  ${r.key}: 截图 level ${knee.level.toFixed(4)}（${knee.rule}）`);
        } else {
          await setDisplayLevel(showId);
        }
      } else {
        await setDisplayLevel(showId);
      }
      await exec(t, "wait 1", opts, true);
      /* v3.82 (b) → v3.89: the orientation — re-derive the run's shared
       * view (the previous map's matching may have moved the camera),
       * then the REFERENCE-ANCHORED SILHOUETTE MATCHING (see
       * SILHOUETTE_GOOD above): tier 1 keeps the shared view when the
       * map's render already matches the reference's silhouette; tier 2
       * scans camera yaws (the model poses stay fitted); tier 3 stands
       * the map up its own way (the v3.82 assists) and yaw-scans around
       * THAT; the best IoU wins and the standing sign is rolled to the
       * reference's. The alignment correlation in the log stays the
       * honest record of the 3D fit quality. */
      if (applySharedView) await applySharedView();
      const isRefRow = r.key === opts.reference.key;
      if (applySharedView && refSilhouette && !isRefRow) {
        const tagKey = safeKeyPart(r.key.replace(/\//g, "__"));
        type SilCand = {
          apply: () => Promise<void>;
          yaw: number;
          iou: number;
          standing: number | null;
          via: string;
        };
        const probeCand = async (
          base: () => Promise<void>,
          yaw: number,
          via: string,
        ): Promise<SilCand | null> => {
          await base();
          if (yaw) await exec(t, `turn y ${yaw}`, opts, true);
          await exec(t, "wait 1", opts, true);
          await exec(t, "view", opts, true);
          await exec(t, "wait 1", opts, true);
          const s = await renderProbe(`_sil_${tagKey}_y${yaw < 0 ? "m" : ""}${Math.abs(yaw)}.png`);
          if (!s || !s.mask) return null;
          const iou = maskIou(s.mask, refSilhouette.mask);
          if (iou == null) return null;
          return { apply: base, yaw, iou, standing: s.standing, via };
        };
        const sharedBase = async () => {
          if (applySharedView) await applySharedView();
        };
        let best: SilCand | null = await probeCand(sharedBase, 0, "共享视角");
        if (best && best.iou >= SILHOUETTE_GOOD) {
          log(`  ${r.key}: 视角轮廓与参考一致（IoU ${best.iou.toFixed(2)}）— 共享侧视`);
        } else {
          /* tier 2: the yaw scan around the shared view — camera-space
           * turns only, the model keeps its fitted pose (90° family
           * first, early-exit at GOOD). */
          for (const yaw of SILHOUETTE_YAWS) {
            if (threw(opts.signal)) break;
            const c = await probeCand(sharedBase, yaw, `共享视角 + 偏航 ${yaw}°`);
            if (c && (!best || c.iou > best.iou + 0.01)) best = c;
            if (best && best.iou >= SILHOUETTE_GOOD) break;
          }
          if (best && best.yaw !== 0 && best.iou >= SILHOUETTE_GOOD) {
            log(
              `  ${r.key}: ✓ 视角轮廓匹配: 偏航 ${best.yaw}°（IoU ${best.iou.toFixed(2)}）— 本图以参考图同面呈现（fitmap 落点偏航，姿态本身未改动）`,
            );
          } else if (best && best.yaw !== 0 && best.iou >= SILHOUETTE_WEAK) {
            log(
              `  ${r.key}: 视角轮廓最佳偏航 ${best.yaw}°（IoU ${best.iou.toFixed(2)}，中等相似 — 分辨率/包络差异所致）— 采用该视角`,
            );
          }
          /* tier 3: the standing assist (own belt-PCA camera / standing
           * scan) + the same yaw scan around it — a face-down or tilted
           * fit no camera yaw can rescue; the assist stands the map up
           * in its own frame and the yaw scan fixes the belt camera's
           * in-plane degeneracy, then the better of tiers 2/3 wins. */
          if (!best || best.iou < SILHOUETTE_GOOD) {
            const assistBases: Array<{ label: string; apply: () => Promise<void> }> = [];
            if (t.canMembrane2) {
              const m2 = await bridgeMembrane2(t, showId);
              const band = (m2?.bands ?? [])
                .filter((b) => b.count >= 64 && b.ratio > 0 && b.ratio < 1)
                .sort((a, b) => a.ratio - b.ratio)[0];
              if (band) {
                let n: [number, number, number] = [...band.normal];
                for (const i of [1, 2, 0] as const) {
                  if (Math.abs(n[i]) > 1e-6) {
                    if (n[i] < 0) n = [n[0] * -1, n[1] * -1, n[2] * -1];
                    break;
                  }
                }
                const xAxis = band.ea;
                const zRaw: [number, number, number] = [
                  xAxis[1] * n[2] - xAxis[2] * n[1],
                  xAxis[2] * n[0] - xAxis[0] * n[2],
                  xAxis[0] * n[1] - xAxis[1] * n[0],
                ];
                const zLen = Math.hypot(zRaw[0], zRaw[1], zRaw[2]);
                const zAxis: [number, number, number] = zLen > 1e-9 ? [zRaw[0] / zLen, zRaw[1] / zLen, zRaw[2] / zLen] : zRaw;
                let camTrans: [number, number, number] = [0, 0, 0];
                const vm = await exec(t, "view matrix", opts, true);
                if (!vm.error) {
                  const m = /camera[^\d\-+]*((?:[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?[\s,]+){11}[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(vm.text);
                  if (m) {
                    const nums = m[1].match(/[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)?.map(Number) ?? [];
                    if (nums.length >= 12 && [3, 7, 11].every((i) => Number.isFinite(nums[i]))) {
                      camTrans = [nums[3], nums[7], nums[11]];
                    }
                  }
                }
                const camCmd = `view matrix camera ${[
                  xAxis[0], n[0], zAxis[0], camTrans[0],
                  xAxis[1], n[1], zAxis[1], camTrans[1],
                  xAxis[2], n[2], zAxis[2], camTrans[2],
                ]
                  .map((v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6))
                  .join(",")}`;
                const camRes = await exec(t, camCmd, opts, true);
                if (!camRes.error) {
                  assistBases.push({
                    label: "本图胶束带 PCA 相机",
                    apply: async () => {
                      await exec(t, "view _cfbase", opts, true);
                      await exec(t, camCmd, opts, true);
                    },
                  });
                }
              }
            }
            if (!assistBases.length) {
              const scan = await scanForStanding("轮廓匹配未达标，按本图自身密度立正", `a_${tagKey}_`, null);
              if (scan) {
                assistBases.push({
                  label: scan.via,
                  apply: async () => {
                    await exec(t, "view _cfbase", opts, true);
                    if (scan.x) await exec(t, `turn x ${scan.x}`, opts, true);
                    await exec(t, `turn y ${scan.y}`, opts, true);
                  },
                });
              }
            }
            for (const base of assistBases) {
              let assistBest: SilCand | null = await probeCand(base.apply, 0, `${base.label} 立正`);
              if (!assistBest || assistBest.iou < SILHOUETTE_GOOD) {
                for (const yaw of SILHOUETTE_YAWS) {
                  if (threw(opts.signal)) break;
                  const c = await probeCand(base.apply, yaw, `${base.label} 立正 + 偏航 ${yaw}°`);
                  if (c && (!assistBest || c.iou > assistBest.iou + 0.01)) assistBest = c;
                  if (assistBest && assistBest.iou >= SILHOUETTE_GOOD) break;
                }
              }
              if (assistBest && (!best || assistBest.iou > best.iou + 0.01)) {
                best = assistBest;
                log(
                  `  ${r.key}: ✓ 立正后轮廓匹配: ${assistBest.via}（IoU ${assistBest.iou.toFixed(2)}）— 与参考图同面呈现`,
                );
              }
            }
          }
          if (best && best.iou < SILHOUETTE_WEAK) {
            log(
              `  ${r.key}: ⚠ 本图与参考轮廓差异大（最佳 IoU ${best.iou.toFixed(2)} < ${SILHOUETTE_WEAK} — 垃圾类/近对称图）— 保持参考共享视角`,
            );
            best = await probeCand(sharedBase, 0, "共享视角");
          }
        }
        /* apply the chosen camera state (idempotent re-apply + yaw); a
         * null best (every probe failed / aborted mid-scan) falls back
         * to the shared view so the camera never rests mid-scan. */
        if (best && best.via !== "共享视角") {
          await best.apply();
          if (best.yaw) await exec(t, `turn y ${best.yaw}`, opts, true);
          await exec(t, "wait 1", opts, true);
        } else if (!best) {
          await sharedBase();
          await exec(t, "wait 1", opts, true);
        }
        /* the standing sign fix — a chosen view whose heavy end
         * contradicts the reference's rolls 180° (the reference's own
         * up-side is the figure's convention). */
        if (
          best &&
          refStandingSign != null &&
          best.standing != null &&
          Math.abs(best.standing) >= STANDING_ACCEPT &&
          Math.sign(best.standing) !== refStandingSign
        ) {
          await exec(t, "turn x 180", opts, true);
          await exec(t, "wait 1", opts, true);
          log(`  ${r.key}: 已上下翻转 180° 对齐参考图朝向（本图重端与参考相反）`);
        }
      } else if (opts.membraneView?.mode === "auto") {
        /* the v3.82 standing check — still the fallback for the reference
         * row itself and for runs without a cached reference silhouette
         * (probe machinery unavailable); the assist paths are unchanged. */
        await exec(t, "wait 1", opts, true);
        await exec(t, "view", opts, true);
        await exec(t, "wait 1", opts, true);
        const check = await renderProbe(`_view_${safeKeyPart(r.key.replace(/\//g, "__"))}.png`);
        if (check && Math.abs(check.standing) < STANDING_ASSIST_TRIGGER) {
          log(`  ${r.key}: 共享视角下站立度 ${check.standing.toFixed(3)} 偏低 — 尝试按本图自身密度立正`);
          let assisted = false;
          /* assist path 1: this map's own belt-band camera (/membrane2) */
          if (t.canMembrane2) {
            const m2 = await bridgeMembrane2(t, showId);
            const band = (m2?.bands ?? [])
              .filter((b) => b.count >= 64 && b.ratio > 0 && b.ratio < 1)
              .sort((a, b) => a.ratio - b.ratio)[0];
            if (band) {
              /* camera with the deterministic up-side; roll 180° afterwards
               * when the standing sign contradicts the reference's. */
              let n: [number, number, number] = [...band.normal];
              for (const i of [1, 2, 0] as const) {
                if (Math.abs(n[i]) > 1e-6) {
                  if (n[i] < 0) n = [n[0] * -1, n[1] * -1, n[2] * -1];
                  break;
                }
              }
              const xAxis = band.ea;
              const zRaw: [number, number, number] = [
                xAxis[1] * n[2] - xAxis[2] * n[1],
                xAxis[2] * n[0] - xAxis[0] * n[2],
                xAxis[0] * n[1] - xAxis[1] * n[0],
              ];
              const zLen = Math.hypot(zRaw[0], zRaw[1], zRaw[2]);
              const zAxis: [number, number, number] = zLen > 1e-9 ? [zRaw[0] / zLen, zRaw[1] / zLen, zRaw[2] / zLen] : zRaw;
              /* the current camera translation, as in the view phase */
              let camTrans: [number, number, number] = [0, 0, 0];
              const vm = await exec(t, "view matrix", opts, true);
              if (!vm.error) {
                const m = /camera[^\d\-+]*((?:[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?[\s,]+){11}[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(vm.text);
                if (m) {
                  const nums = m[1].match(/[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)?.map(Number) ?? [];
                  if (nums.length >= 12 && [3, 7, 11].every((i) => Number.isFinite(nums[i]))) {
                    camTrans = [nums[3], nums[7], nums[11]];
                  }
                }
              }
              const camCmd = `view matrix camera ${[
                xAxis[0], n[0], zAxis[0], camTrans[0],
                xAxis[1], n[1], zAxis[1], camTrans[1],
                xAxis[2], n[2], zAxis[2], camTrans[2],
              ]
                .map((v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6))
                .join(",")}`;
              const probe = await probeOrientation(`_mprobe_assist_${safeKeyPart(r.key.replace(/\//g, "__"))}.png`, async () => {
                const res = await exec(t, camCmd, opts, true);
                return !res.error;
              });
              if (probe && Math.abs(probe.standing) >= STANDING_ACCEPT) {
                if (refStandingSign != null && Math.sign(probe.standing) !== refStandingSign) {
                  await exec(t, "turn x 180", opts, true);
                  await exec(t, "wait 1", opts, true);
                }
                assisted = true;
                log(`  ${r.key}: ✓ 已按本图胶束带 PCA 立正（站立度 ${Math.abs(probe.standing).toFixed(2)}${refStandingSign != null && Math.sign(probe.standing) !== refStandingSign ? "，并翻转对齐参考图朝向" : ""}）— 与参考帧存在姿态差异（fitmap 相关性见上）`);
              }
            }
          }
          /* assist path 2: this map's own standing scan (probe-only) */
          if (!assisted) {
            const scan = await scanForStanding("共享视角未立正，按本图扫描", `a_${safeKeyPart(r.key.replace(/\//g, "__"))}_`, null);
            if (scan) {
              if (refStandingSign != null && Math.sign(scan.standing) !== refStandingSign) {
                await exec(t, "turn x 180", opts, true);
                await exec(t, "wait 1", opts, true);
              }
              assisted = true;
              log(`  ${r.key}: ✓ 已按本图站立度扫描立正（${scan.via}${refStandingSign != null && Math.sign(scan.standing) !== refStandingSign ? "，并翻转对齐参考图朝向" : ""}）— 与参考帧存在姿态差异（fitmap 相关性见上）`);
            } else {
              log(`  ${r.key}: ⚠ 本图亦无法立正（颗粒过对称或信噪比低）— 保持共享视角`);
            }
          }
        } else if (check) {
          log(`  ${r.key}: 站立度 ${check.standing >= 0 ? "+" : ""}${check.standing.toFixed(3)} ✓（共享侧视）`);
        }
      }
      /* v3.82 (c): re-frame per map — bare `view` fits the DISPLAYED
       * model (translate/zoom/clip only, never rotates), so each map
       * fills the frame instead of riding the reference's framing (a
       * wide hetero class used to risk clipping). */
      await exec(t, "view", opts, true);
      await exec(t, "wait 1", opts, true);
      const name = `render_${safeKeyPart(r.key.replace(/\//g, "__"))}.png`;
      // v3.48: plain `save <png-path> …` — see the thumbnail note above; the
      // save's ChimeraX error now reaches the log instead of hiding behind
      // the subsequent /file 404. v3.50: rides the save→fetch rung ladder
      // (abs → abs-fwd → cd+rel), and the failure layer is named in the
      // message: 保存失败 = ChimeraX raised; 未找到 = saved clean but /file
      // could not return it (workdir included for diagnosis).
      try {
        r.png = await saveAndFetchPng(
          t,
          name,
          { width: SNAPSHOT_W, height: SNAPSHOT_H, supersample: 3 },
          (c) => exec(t, c, opts, true),
          log,
        );
        log(`  截图完成: ${r.key}`);
      } catch (err) {
        const saveFailed = err instanceof SaveShotError && err.kind === "save";
        const detail = err instanceof Error ? err.message : String(err);
        log(
          `  截图获取失败 ${r.key}: ${saveFailed ? `保存失败 — ${logSnippet(detail, 160)}` : logSnippet(detail, 180)}`,
        );
      }
      shotDone += 1;
      // v3.49 (round-8): the card owns the last stretch (裁剪白边 90 →
      // 组装 94 → 完成 100) — this pipeline used to report 100 here, so the
      // progress bar read "完成" while the PPTX was still assembling.
      progress(`导出截图 ${shotDone}/${shotTotal}`, Math.min(88, 60 + Math.round((26 * shotDone) / shotTotal)));
      await exec(t, `hide #${showId} models`, opts, true);
    }
    for (const id of openIds) {
      await exec(t, `show #${id} models`, opts, true);
    }
  } else {
    for (const r of renders) r.png = null;
  }

  /* ---- 5. v3.55 (round-14): cleanup — close every model THIS run opened.
   * The screenshots are already exported, and the aligned in-memory models
   * are of no further use — leaving them open was exactly how the NEXT
   * run's screenshots got polluted (step 0 above now guards against the
   * already-open leftovers; this step keeps ChimeraX clean after every
   * run so both halves of the problem are covered). */
  if (openIds.size) {
    for (const id of openIds) {
      await exec(t, `close #${id}`, opts, true);
    }
    log(`运行结束: 已关闭本次打开的 ${openIds.size} 个模型 — ChimeraX 保持干净，下次运行不会混入旧图`);
  }

  progress("ChimeraX 渲染完成", 88);
  return {
    renders,
    view,
    referenceKey: opts.reference.key,
    logs,
    referenceHand: { known: refHandKnown, flipped: refFlipped, flipFailed: refFlipFailed, verdict: refHandVerdict },
    membrane: membraneReport ?? undefined,
  };
}

/**
 * Quick probe: can ChimeraX itself fetch this URL (e.g. a CryoSmart
 * intranet URL, or an app-proxy URL with server-side credentials)?
 * Returns the opened model id (to close afterwards) or null. v3.46: rides
 * bridgeOpenModel, so legacy open output formats and id-less logs are
 * handled here too, and the captured text is returned for diagnostics.
 */
export async function bridgeOpenProbe(
  t: FlowTransport,
  url: string,
): Promise<{ ok: boolean; modelId: number | null; error?: string; text?: string }> {
  const res = await bridgeOpenModel(t, url);
  return { ok: res.modelId != null, modelId: res.modelId, error: res.error ?? undefined, text: res.text };
}

/* ------------------------------------------------------------------ */
/* v3.81: reference-level PREVIEW (round-41 “level取得还是不好”)        */
/* ------------------------------------------------------------------ */

/** v3.81: one candidate display level for the preview picker — the auto
 * choice plus a spread of manual ratios, each with a real render of the
 * REFERENCE map at that level (what the screenshots would show). */
export interface LevelPreviewItem {
  /** "auto" = the run's auto chain (min(0.25×max, 0.85×otsu₂)); "ratio" =
   * a manual ×max candidate. */
  kind: "auto" | "ratio";
  /** level / max — comparable across maps (the pick is stored as this). */
  ratio: number;
  /** The actual level value applied (null when stats were unavailable). */
  level: number | null;
  /** Which rule produced the level — the caption under the thumbnail. */
  rule: string;
  /** The rendered thumbnail at this level (null when the save failed). */
  png: Uint8Array | null;
}

/** v3.81: the outcome of previewReferenceLevels. */
export interface LevelPreviewResult {
  items: LevelPreviewItem[];
  stats: BridgeVolStats | null;
}

/** v3.81 (round-41): render the REFERENCE map at a ladder of candidate
 * display levels so the user can PICK the level with their own eyes
 * before the multi-minute run — the fourth straight round of level
 * complaints (mean+2.5σ / envelope-25% / 0.25×max each failed on a
 * different map family) made one thing clear: every blind rule guesses,
 * and the user's own ChimeraX workflow is "drag the level slider until
 * it looks right". The picked ratio feeds back as contourLevel=manual
 * (the reference then anchors the envelope-count match for the class
 * maps). The preview is non-destructive: currently-open volume models
 * are hidden and restored, the preview model itself is closed, and
 * nothing else in ChimeraX is touched.
 *
 * `sourceUrl` must be a ChimeraX-openable source (typically the local
 * cache path the card resolved via /staged or /fetch — the SAME source
 * the run will open). */
export async function previewReferenceLevels(
  t: FlowTransport,
  sourceUrl: string,
  opts: { onLog?: (line: string) => void; signal?: AbortSignal } = {},
): Promise<LevelPreviewResult> {
  if (t.kind !== "relay" || !t.canFetchFiles || !t.workdir) {
    throw new Error("level 预览需要 relay 桥（带回传）— 请先连接 ChimeraX 桥");
  }
  const log = opts.onLog ?? (() => {});
  const ex = async (cmd: string): Promise<ExecResult> => {
    try {
      return await bridgeExec(t, cmd);
    } catch (err) {
      return { text: "", error: err instanceof Error ? err.message : String(err) };
    }
  };
  /* hide the user's currently-open volumes (restored at the end) so the
   * probes render ONLY the reference. */
  const others = (await bridgeVolumeIds(t)) ?? [];
  const openRes = await bridgeOpenModel(t, sourceUrl);
  const id = openRes.modelId;
  if (id == null) {
    throw new Error(`无法在 ChimeraX 中打开参考地图（${openRes.error || logSnippet(openRes.text) || "未返回 model id"}）`);
  }
  const items: LevelPreviewItem[] = [];
  try {
    for (const v of others) {
      if (v.id !== String(id)) await ex(`hide #${v.id} models`);
    }
    await ex("wait 1");
    const stats = await bridgeVolStats(t, id);
    if (stats) await ex(`volume #${id} color ${chimeraClassColor(0)}`);
    /* candidate levels: the auto chain FIRST, then the manual ratio
     * ladder; near-duplicates (>88% agreement) are skipped. v3.86: the
     * BELT-BAND adaptive anchor (the level the auto screenshots will
     * actually ride) leads the list. */
    const candidates: Array<{ kind: "auto" | "ratio"; level: number; rule: string; srcRatio: number }> = [];
    if (stats) {
      const m2 = t.canMembrane2 ? await bridgeMembrane2(t, id) : null;
      const belt = beltLevelFrom(m2, stats);
      if (Number.isFinite(belt.anchor) && belt.anchor > 0) {
        candidates.push({ kind: "auto", level: belt.anchor, rule: belt.anchorRule, srcRatio: NaN });
      }
      const auto = autoLevelFor(stats);
      if (auto && !(belt.t1 != null && belt.t2 != null)) candidates.push({ kind: "auto", level: auto.level, rule: auto.rule, srcRatio: NaN });
    }
    if (stats) {
      for (const ratio of [0.06, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5]) {
        const level = stats.max * ratio;
        if (candidates.some((c) => Math.abs(c.level - level) < 0.12 * Math.max(c.level, level))) continue;
        candidates.push({ kind: "ratio", level, rule: `手动 ${ratio}×max`, srcRatio: ratio });
      }
    }
    if (!candidates.length) {
      throw new Error("无法读取参考图统计（/volstats）— 请确认桥脚本已更新并在 ChimeraX 重新 open");
    }
    for (let i = 0; i < candidates.length; i++) {
      if (opts.signal?.aborted) break;
      const c = candidates[i];
      await ex(`volume #${id} level ${c.level.toFixed(4)} step ${STEP}`);
      /* v3.85: preview what the screenshots would show — dusted. */
      await ex(`surface dust #${id} size ${DUST_SIZE_A}`);
      /* a deterministic, level-comparable framing for every candidate */
      await ex("view orient");
      await ex("wait 1");
      await ex("view");
      await ex("wait 1");
      let png: Uint8Array | null = null;
      try {
        png = await saveAndFetchPng(
          t,
          `_lvlprev_${i}.png`,
          { width: 320, height: 320, supersample: 2 },
          ex,
          log,
        );
      } catch (err) {
        log(`  level 预览 ${c.rule}: 渲染失败 — ${logSnippet(String(err), 120)}`);
      }
      items.push({
        kind: c.kind,
        ratio: stats && stats.max > 0 ? c.level / stats.max : c.srcRatio,
        level: c.level,
        rule: c.rule,
        png,
      });
    }
    return { items, stats };
  } finally {
    await ex(`close #${id}`);
    for (const v of others) {
      if (v.id !== String(id)) await ex(`show #${v.id} models`);
    }
  }
}
