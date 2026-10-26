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
 * The alignment / handedness protocol is a faithful port of the proven
 * `CryoSmart_auto_align_export_ppt.py` desktop helper:
 *   - 5 candidate hypotheses per map: original, rot_x_180, rot_y_180,
 *     rot_z_180, flip_z (`volume flip #N axis z modelId <next>`)
 *   - scoring: `measure correlation` → `fit #v in #ref` → `fit #v in #ref
 *     search 15`; score = fit_search ?? fit ?? measure
 *   - chirality verdict from the flip_z candidate vs. the best rigid one
 *   - one-time 90° view optimisation on the reference map by thumbnail
 *     white-space coverage, applied to every map
 *   - per-map export at 1600×1200 supersample 3 on white background
 */

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
}

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
        const data = (await res.json()) as { ok?: boolean; workdir?: string; version?: string };
        if (data?.ok) {
          logs.push(`relay ${host}:${port} → OK (ChimeraX ${data.version ?? "?"})`);
          return {
            transport: { kind: "relay", host, port, base, workdir: data.workdir, canFetchFiles: true },
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

export function parseOpenModelId(text: string): number | null {
  const m = /as\s+#(\d+(?:\.\d+)?)/i.exec(text);
  if (m) return parseInt(m[1], 10);
  return null;
}

function quotePath(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function safeKeyPart(value: string): string {
  return String(value || "item").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

/* ------------------------------------------------------------------ */
/* Thumbnail coverage scoring (browser port of score_current_view)     */
/* ------------------------------------------------------------------ */

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
  let white = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
  }
  const total = width * height;
  return total ? (total - white) / total : 0;
}

/* ------------------------------------------------------------------ */
/* Alignment + chirality + render engine                               */
/* ------------------------------------------------------------------ */

const LEVEL_RATIO = 0.25;
const STEP = 1;
const FIT_SEARCH = 15;
const CHIRALITY_EPSILON = 0.01;
const THUMB_SIZE = 220;
const SNAPSHOT_W = 1600;
const SNAPSHOT_H = 1200;

export type ChiralityStatus = "consistent" | "corrected" | "ambiguous" | "unknown";

export interface FigureMapRequest {
  /** Canonical map key: "<uid>/<group>" (matches the PPTX image markers). */
  key: string;
  uid: string;
  group: string;
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

async function exec(t: FlowTransport, command: string, opts: RenderMapsOptions, soft = false): Promise<ExecResult> {
  const r = await bridgeExec(t, command);
  if (r.error && !soft) {
    opts.onLog?.(`! ${command} → ${r.error}`);
  }
  return r;
}

/**
 * Full pipeline: open reference → standardise the 90° view → per-map
 * 5-candidate alignment + handedness check → per-map screenshot.
 */
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

  /* ---- 1. reference ---- */
  progress("打开参考地图", 4);
  let refLevel: number | null = null;
  const openRef = await exec(t, `open ${quotePath(opts.reference.sourceUrl)}`, opts);
  const refId = parseOpenModelId(openRef.text);
  if (refId == null) {
    throw new Error(`无法在 ChimeraX 中打开参考地图 (${opts.reference.sourceUrl})${openRef.error ? `: ${openRef.error}` : ""}`);
  }
  openIds.add(refId);
  log(`参考地图 ${opts.reference.key} → model #${refId}`);

  const refStats = await bridgeVolStats(t, refId);
  if (refStats) {
    refLevel = refStats.max * LEVEL_RATIO;
    await exec(t, `volume #${refId} level ${refLevel.toFixed(4)} step ${STEP}`, opts, true);
  } else {
    // Official-REST transport: try a sigma level, fall back to defaults.
    const sdTry = await exec(t, `volume #${refId} level 2 sd step ${STEP} style surface`, opts, true);
    if (sdTry.error) await exec(t, `volume #${refId} step ${STEP} style surface`, opts, true);
  }
  await exec(t, "set bgColor white", opts, true);
  await exec(t, "view pad 0.25", opts, true);
  await exec(t, "wait 1", opts, true);

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
      await exec(t, `save image ${quotePath(`${t.workdir}/${thumb}`)} width ${THUMB_SIZE} height ${THUMB_SIZE} supersample 1 transparentBackground false`, opts, true);
      try {
        const bytes = await bridgeFile(t, thumb);
        const score = await thumbnailCoverageScore(bytes);
        log(`  视角 ${v.desc}: 覆盖率 ${score.toFixed(4)}`);
        if (score > best) {
          best = score;
          view = { ...v, score };
        }
      } catch {
        log(`  视角 ${v.desc}: 缩略图获取失败`);
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

  /* ---- 3. per-map 5-candidate alignment ---- */
  const renders: MapRender[] = [];
  const all = [opts.reference, ...opts.maps];
  const perMapPct = 70 / Math.max(1, all.length);
  let pct = 15;

  for (const req of all) {
    if (threw(opts.signal)) throw new Error("aborted");
    const isReference = req.key === opts.reference.key;
    if (isReference) {
      renders.push({
        key: req.key,
        uid: req.uid,
        group: req.group,
        candidate: "reference",
        score: 1,
        chirality: "consistent",
        rows: [],
        png: null,
        modelId: refId,
      });
      openIds.add(refId);
      continue;
    }
    progress(`对齐 ${req.key}（5 候选 × 相关性评分）`, pct);
    pct += perMapPct * 0.75;

    const rows: CandidateRow[] = [];
    const openedByCandidate = new Map<string, number>();
    let chosen: { row: CandidateRow; modelId: number } | null = null;

    for (const spec of [
      { name: "original", kind: "original" as const },
      { name: "rot_x_180", kind: "rotate" as const, axis: "x" },
      { name: "rot_y_180", kind: "rotate" as const, axis: "y" },
      { name: "rot_z_180", kind: "rotate" as const, axis: "z" },
      { name: "flip_z", kind: "flip" as const, axis: "z" },
    ]) {
      if (threw(opts.signal)) throw new Error("aborted");
      let activeId: number | null = null;
      let note: string | undefined;
      try {
        const openRes = await exec(t, `open ${quotePath(req.sourceUrl)}`, opts, true);
        activeId = parseOpenModelId(openRes.text);
        if (activeId == null) throw new Error(openRes.error || openRes.text.slice(0, 200) || "open produced no model");
        openIds.add(activeId);

        const stats = await bridgeVolStats(t, activeId);
        const level = stats ? stats.max * LEVEL_RATIO : refLevel;
        if (level != null) {
          await exec(t, `volume #${activeId} level ${level.toFixed(4)} step ${STEP}`, opts, true);
        } else {
          const sdTry = await exec(t, `volume #${activeId} level 2 sd step ${STEP} style surface`, opts, true);
          if (sdTry.error) await exec(t, `volume #${activeId} step ${STEP} style surface`, opts, true);
        }

        if (spec.kind === "rotate") {
          await exec(t, `turn ${spec.axis} 180 models #${activeId} center #${activeId}`, opts, true);
          await exec(t, "wait 1", opts, true);
        } else if (spec.kind === "flip") {
          const next = await bridgeNextModelId(t);
          if (next != null) {
            const flipRes = await exec(t, `volume flip #${activeId} axis ${spec.axis} modelId ${next}`, opts, true);
            const flipped = parseOpenModelId(flipRes.text) ?? next;
            openIds.delete(activeId);
            await exec(t, `close #${activeId}`, opts, true);
            activeId = flipped;
            openIds.add(flipped);
          } else {
            // Official-REST transport: no nextid endpoint — let ChimeraX pick.
            const flipRes = await exec(t, `volume flip #${activeId} axis ${spec.axis}`, opts, true);
            const ids = Array.from(flipRes.text.matchAll(/#(\d+(?:\.\d+)?)/g)).map((m) => parseInt(m[1], 10));
            const fresh = ids.find((id) => id !== activeId && !openIds.has(id));
            if (fresh == null) throw new Error(flipRes.error || "flip model id not detected");
            openIds.delete(activeId);
            await exec(t, `close #${activeId}`, opts, true);
            activeId = fresh;
            openIds.add(fresh);
          }
          const stats2 = await bridgeVolStats(t, activeId);
          const level2 = stats2 ? stats2.max * LEVEL_RATIO : refLevel;
          if (level2 != null) {
            await exec(t, `volume #${activeId} level ${level2.toFixed(4)} step ${STEP}`, opts, true);
          }
        }

        const preRes = await exec(t, `measure correlation #${activeId} inMap #${refId}`, opts, true);
        const pre = parseCorrelation(preRes.text) ?? parseCorrelation(preRes.error);
        const fit1Res = await exec(t, `fit #${activeId} in #${refId}`, opts, true);
        let fit1 = parseCorrelation(fit1Res.text);
        const fit2Res = await exec(t, `fit #${activeId} in #${refId} search ${FIT_SEARCH}`, opts, true);
        let fit2 = parseCorrelation(fit2Res.text);
        if (fit2 == null) fit2 = parseCorrelation(fit2Res.error);
        if (fit1 == null && fit2 == null) {
          const reMeasure = await exec(t, `measure correlation #${activeId} inMap #${refId}`, opts, true);
          fit1 = parseCorrelation(reMeasure.text);
        }
        const score = fit2 ?? fit1 ?? pre;
        const row: CandidateRow = { candidate: spec.name, score, pre, fit1, fit2, ok: score != null, note };
        rows.push(row);
        if (activeId != null) openedByCandidate.set(spec.name, activeId);
        log(`  ${req.key} · ${spec.name}: score=${score ?? "—"} (pre=${pre ?? "—"}, fit=${fit1 ?? "—"}, fit15=${fit2 ?? "—"})`);
      } catch (err) {
        rows.push({ candidate: spec.name, score: null, pre: null, fit1: null, fit2: null, ok: false, note: String(err).slice(0, 160) });
        log(`  ${req.key} · ${spec.name}: 失败 — ${String(err).slice(0, 120)}`);
        if (activeId != null) {
          await exec(t, `close #${activeId}`, opts, true);
          openIds.delete(activeId);
        }
      }
    }

    const valid = rows.filter((r) => r.ok && r.score != null && openedByCandidate.has(r.candidate));
    const bestRow = valid.sort((a, b) => (b.score as number) - (a.score as number))[0] ?? null;
    if (bestRow) {
      const bestId = openedByCandidate.get(bestRow.candidate) as number;
      // Close the losing candidates.
      for (const [name, id] of openedByCandidate) {
        if (name !== bestRow.candidate) {
          await exec(t, `close #${id}`, opts, true);
          openIds.delete(id);
        }
      }
      chosen = { row: bestRow, modelId: bestId };

      const flipScore = rows.find((r) => r.candidate === "flip_z")?.score ?? null;
      let chirality: ChiralityStatus = "unknown";
      if (bestRow.candidate === "flip_z") {
        chirality = "corrected";
      } else if (flipScore != null && Math.abs((bestRow.score as number) - flipScore) <= CHIRALITY_EPSILON) {
        chirality = "ambiguous";
      } else {
        chirality = "consistent";
      }
      log(`  → ${req.key} 选中 ${bestRow.candidate} (score=${bestRow.score})，手性: ${chirality}`);
      renders.push({
        key: req.key,
        uid: req.uid,
        group: req.group,
        candidate: bestRow.candidate,
        score: bestRow.score,
        chirality,
        rows,
        png: null,
        modelId: chosen.modelId,
      });
    } else {
      log(`  → ${req.key}: 所有候选失败（无法对齐）`);
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

  /* ---- 4. screenshots ---- */
  if (t.canFetchFiles && t.workdir) {
    progress("逐图导出高清截图 (1600×1200)", 88);
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
      await exec(
        t,
        `save image ${quotePath(`${t.workdir}/${name}`)} width ${SNAPSHOT_W} height ${SNAPSHOT_H} supersample 3 transparentBackground false`,
        opts,
        true,
      );
      try {
        r.png = await bridgeFile(t, name);
        log(`  截图完成: ${r.key}`);
      } catch (err) {
        log(`  截图获取失败 ${r.key}: ${String(err).slice(0, 100)}`);
      }
      await exec(t, `hide #${showId} models`, opts, true);
    }
    for (const id of openIds) {
      await exec(t, `show #${id} models`, opts, true);
    }
  } else {
    for (const r of renders) r.png = null;
  }

  progress("ChimeraX 渲染完成", 100);
  return { renders, view, referenceKey: opts.reference.key, logs };
}

/**
 * Quick probe: can ChimeraX itself fetch this URL (e.g. a CryoSmart
 * intranet URL)? Returns the opened model id (to close afterwards) or null.
 */
export async function bridgeOpenProbe(
  t: FlowTransport,
  url: string,
): Promise<{ ok: boolean; modelId: number | null; error?: string }> {
  const res = await bridgeExec(t, `open ${quotePath(url)}`);
  const id = parseOpenModelId(res.text);
  return { ok: id != null, modelId: id, error: res.error ?? undefined };
}
