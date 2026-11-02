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
        const data = (await res.json()) as { ok?: boolean; workdir?: string; version?: string; stage?: boolean; cache?: boolean; cacheDir?: string; fetch?: boolean; cachedir_set?: boolean };
        if (data?.ok) {
          logs.push(
            `relay ${host}:${port} → OK (ChimeraX ${data.version ?? "?"}${data.stage ? ", /stage" : ""}${data.cache ? ", 地图缓存" : ""}${data.fetch ? ", 本地目录下载" : ""}${data.cachedir_set ? ", 可自定义目录" : ""})`,
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
export async function bridgeVolStats(
  t: FlowTransport,
  modelId: number,
): Promise<{ max: number; mean: number; sd: number } | null> {
  if (t.kind !== "relay") return null;
  try {
    const res = await fetchWithTimeout(`${t.base}/volstats?id=${modelId}`, { method: "GET" }, 120_000);
    if (!res.ok) return null;
    const data = (await res.json()) as { max?: number; mean?: number; sd?: number };
    if (typeof data.max !== "number") return null;
    return { max: data.max, mean: data.mean ?? 0, sd: data.sd ?? 0 };
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
 *  recognized as the same map and skipped outright. */
export function stagedMapFilename(key: string, url: string): string {
  const base = String(key || "map")
    .replace(/[^A-Za-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "map";
  let h = 5381;
  const u = String(url || "");
  for (let i = 0; i < u.length; i++) {
    h = ((h * 33) ^ u.charCodeAt(i)) >>> 0;
  }
  return `${base}.${h.toString(16).padStart(8, "0").slice(-8)}.mrc`;
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

/* ------------------------------------------------------------------ */
/* Alignment + chirality + render engine                               */
/* ------------------------------------------------------------------ */

const LEVEL_RATIO = 0.25;
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

export interface RenderMapsResult {
  renders: MapRender[];
  view: { desc: string; x: number; y: number; score: number };
  referenceKey: string;
  logs: string[];
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
        fid = parseOpenModelId(res.text) ?? next;
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
          refHandVerdict = "手动指定镜像 · 翻正失败";
          log("⚠ 参考仍为镜像手性 — 各 map 的手性判定改按镜像参考推算（流程图将呈镜像视图）");
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

  /* ---- 2. standardise the 90° view (reference only) ---- */
  let view = { desc: "base", x: 0, y: 0, score: 0 };
  if (t.canFetchFiles && t.workdir) {
    progress("视角自动评分（基准 + Y±90 + X±90）", 10);
    await exec(t, "view name _cfbase", opts, true);
    await exec(t, "wait 1", opts, true);
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
  for (const [sid, fine] of [
    [refSmoothC, false],
    [refSmoothF, true],
  ] as Array<[number | null, boolean]>) {
    if (sid == null) continue;
    const sStats = await bridgeVolStats(t, sid);
    if (!sStats) continue;
    await exec(t, `volume #${sid} level ${(sStats.max * LEVEL_RATIO).toFixed(4)} step ${STEP}`, opts, true);
    const mask = await thresholdZero(sid, sStats.max * MASK_RATIO);
    if (fine) refMaskF = mask;
    else refMaskC = mask;
  }
  // v3.67: the full-resolution masked reference needs no smoothing
  // pyramid — even the degraded fallbacks (no gaussian / no matrix
  // round-trip) still get noise-masked fitting.
  if (refStats) {
    refMaskFull = await thresholdZero(refId, refStats.max * MASK_RATIO);
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
      try {
        const openRes = await bridgeOpenModel(t, req.sourceUrl);
        origId = openRes.modelId;
        if (origId == null) {
          throw new Error(openRes.error || logSnippet(openRes.text) || "open produced no model");
        }
        openIds.add(origId);
        const stats = await bridgeVolStats(t, origId);
        const level = stats ? stats.max * LEVEL_RATIO : refLevel;
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
            flipId = parseOpenModelId(flipRes.text) ?? next;
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
          const level2 = stats2 ? stats2.max * LEVEL_RATIO : refLevel;
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
              await exec(t, `volume #${sid} level ${(sStats.max * LEVEL_RATIO).toFixed(4)} step ${STEP}`, opts, true);
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
        log(
          `    生物学手性: ${mapHandCorrect ? "正确 ✓ — 与经验证的参考手性一致" : "镜像 — 原始 map 手性有误，已自动翻正展示"}${refIsCorrectHand ? "" : "（注: 参考翻正失败，按镜像参考推算）"}`,
        );
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

  /* ---- 4. screenshots ---- */
  if (t.canFetchFiles && t.workdir) {
    const shotTargets = renders.filter((r) => r.modelId != null);
    const shotTotal = Math.max(1, shotTargets.length);
    let shotDone = 0;
    progress("逐图导出高清截图 (1600×1200)", 60);
    for (const id of openIds) {
      await exec(t, `hide #${id} models`, opts, true);
    }
    await exec(t, "wait 1", opts, true);
    for (const r of renders) {
      if (threw(opts.signal)) throw new Error("aborted");
      const showId = r.modelId;
      if (showId == null) continue;
      await exec(t, `show #${showId} models`, opts, true);
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
  return { renders, view, referenceKey: opts.reference.key, logs };
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
