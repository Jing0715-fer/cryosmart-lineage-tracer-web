"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Workflow,
  Play,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  Link2,
  Info,
  Boxes,
  RefreshCw,
} from "lucide-react";
import type { LineageSummary } from "@/lib/cryosmart/types";
import type { LoadedMetadata } from "./data-source-card";
import {
  probeFlowBridge,
  renderFigureMaps,
  bridgeOpenProbe,
  bridgeExec,
  bridgeStagedLookup,
  stagedMapFilename,
  type FlowTransport,
  type MapRender,
} from "@/lib/cryosmart/chimerax-bridge";
import {
  buildFlowFigureModel,
  buildDemoFigureModel,
  applyManualSelection,
  fetchFigureImages,
  fetchFscXmlText,
  fscPng,
  uniformLetterbox,
  figureFootnote,
  figureMapSources,
  type FlowFigureModel,
} from "@/lib/cryosmart/workflow-figure";
import { buildWorkflowPptx } from "@/lib/cryosmart/workflow-pptx";
import { CHIMERA_MODEL_COLORS, chimeraClassColor } from "@/lib/cryosmart/chimera-colors";
import { cryoSmartBytes, buildProxyAbsoluteUrl, probeCryosmartReachable } from "@/lib/cryosmart/proxy-client";
import { FLOW_ENGINE_VERSION } from "@/lib/cryosmart/flow-engine-version";

type FigureMode = "chimerax" | "preview" | "demo";
/** v3.59 (round-18): the deck layout style — 标准 (rich) vs 极简 (the
 * upload/workflow.pptx reference look). */
type FigureStyle = "standard" | "minimal";

interface StepState {
  busy: boolean;
  phase: string;
  pct: number;
  logs: string[];
  error: string | null;
}

const IDLE: StepState = { busy: false, phase: "", pct: 0, logs: [], error: null };

function fmtSize(bytes: number): string {
  if (!bytes) return "0 MB";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1073741824).toFixed(2)} GB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** v3.50: anchor-click a download — works for blob: URLs and same-origin
 *  server URLs alike (server URLs survive sandboxed preview iframes where
 *  in-page blob downloads can silently no-op: the visible link remains
 *  clickable / save-as-able / copyable either way). */
function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function FlowFigureCard({ summary, loaded }: { summary: LineageSummary | null; loaded: LoadedMetadata | null }) {
  const [mode, setMode] = useState<FigureMode>("demo");
  const [bridge, setBridge] = useState<FlowTransport | null>(null);
  const [bridgeProbing, setBridgeProbing] = useState(false);
  const [bridgeTried, setBridgeTried] = useState(false);
  const [step, setStep] = useState<StepState>(IDLE);
  const [includeFsc, setIncludeFsc] = useState(false);
  // v3.54 (round-13): 简化模式 — omit small-subset 2D / initial-model
  // bootstrap steps, funnel the displayed particle counts 多→少, and ignore
  // a default-12 Å ab-initio final's resolution info
  // (BuildModelOptions.simplified). v3.55 (round-14): default-12 Å
  // ab-initio stages are omitted ENTIRELY (the flow connects straight to
  // the following refinement stage). Default OFF: the full-fidelity figure
  // stays the default.
  const [simplified, setSimplified] = useState(false);
  // v3.59 (round-18): 版式 — 标准 or 极简 (BuildPptxOptions.style).
  const [figStyle, setFigStyle] = useState<FigureStyle>("standard");
  // v3.59 (round-18 手动模式): checkbox list of which jobs' images to
  // include. `manualSel` is keyed by job uid; absent = checked.
  const [manual, setManual] = useState(false);
  const [manualSel, setManualSel] = useState<Record<string, boolean>>({});
  // v3.45: default "10" — the widest numeric value (folding off for every
  // lineage with ≤10 stages, which covers the real P208 8-stage model that
  // used to ship with 2 collapsed stages). "0" = the “全部” selector entry
  // (never fold, even beyond 10).
  const [maxGroups, setMaxGroups] = useState("10");
  const [result, setResult] = useState<{
    url: string;
    /** v3.50: fallback in-page blob link (kept for contexts where the
     *  server route somehow fails). */
    blobUrl: string;
    /** v3.50: real server URL from the in-memory artifact store. */
    serverUrl: string | null;
    size: number;
    filename: string;
  } | null>(null);
  const [thumbs, setThumbs] = useState<{ key: string; url: string }[]>([]);
  const [renderReport, setRenderReport] = useState<MapRender[]>([]);
  /** v3.50: server engine version when THIS page bundle is older (stale
   *  tab from a previous dev-server session) — non-null shows the refresh
   *  banner and blocks 生成. */
  const [staleEngine, setStaleEngine] = useState<string | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const hasSummary = !!summary;
  const session = loaded?.session ?? null;
  const relayCommand = typeof window !== "undefined" ? `open ${window.location.origin}/api/cryosmart/flow-figure/relay.py` : "";

  /** v3.44: ChimeraX may run on a different machine than the browser (often
   *  the CryoSmart server). Probe the browser machine first, then the page
   *  host, then the CryoSmart server host from the loaded lineage. */
  const bridgeHosts = useMemo(() => {
    const hosts: string[] = ["127.0.0.1"];
    try {
      if (typeof window !== "undefined" && window.location.hostname) hosts.push(window.location.hostname);
    } catch {}
    const base = summary?.base_url || loaded?.session?.baseUrl || "";
    try {
      const h = new URL(base).hostname;
      if (h) hosts.push(h);
    } catch {}
    return [...new Set(hosts)];
  }, [summary, loaded]);
  const cryoSmartHost = useMemo(() => {
    const base = summary?.base_url || loaded?.session?.baseUrl || "";
    try {
      return new URL(base).hostname;
    } catch {
      return "";
    }
  }, [summary, loaded]);

  const pushLog = useCallback((line: string) => {
    setStep((s) => ({ ...s, logs: [...s.logs.slice(-300), line] }));
  }, []);

  const probeBridge = useCallback(
    async (quiet = true) => {
      setBridgeProbing(true);
      try {
        const res = await probeFlowBridge({ timeoutMs: 4000, hosts: bridgeHosts });
        setBridge(res.transport);
        if (res.transport && !quiet) {
          toast.success(`ChimeraX 桥已连接 (${res.transport.kind} ${res.transport.host}:${res.transport.port})`);
        }
        if (!res.transport) {
          for (const line of res.logs.slice(0, 15)) pushLog(`探测 ${line}`);
        }
        return res.transport;
      } finally {
        setBridgeProbing(false);
        setBridgeTried(true);
      }
    },
    [bridgeHosts, pushLog],
  );

  useEffect(() => {
    // Default mode: real data → ChimeraX (falls back automatically), none → demo.
    setMode(hasSummary ? "chimerax" : "demo");
  }, [hasSummary]);

  /** v3.50: compare this bundle's embedded engine version against the LIVE
   *  server route. The dev server restarts between sessions while old tabs
   *  keep running old JS against the new routes — the round-9 log carried
   * `缩略图获取失败` WITHOUT v3.48+'s “ — <err>” suffix, i.e. it came from a
   * v3.47-era bundle re-running the long-fixed `save image` bug. At mount +
   * at every generate we refuse to run a stale bundle. */
  const checkEngineFresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/cryosmart/flow-figure/version", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: string };
      return data.version && data.version !== FLOW_ENGINE_VERSION ? data.version : null;
    } catch {
      return null; // transient network failure must never block a run
    }
  }, []);

  useEffect(() => {
    void checkEngineFresh().then((serverVersion) => setStaleEngine(serverVersion));
  }, [checkEngineFresh]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const copyRelay = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(relayCommand);
      toast.success("已复制 — 在 ChimeraX Command Line 中粘贴并回车");
    } catch {
      toast.error("复制失败，请手动复制命令");
    }
  }, [relayCommand]);

  /* ---------------------------------------------------------------- */
  /* v3.59 手动模式: the stage checklist                               */
  /* ---------------------------------------------------------------- */

  /** The candidate catalog — the figure model as it WOULD be built with
   * the current 阶段数/简化设置. Only computed while 手动勾选 is on (the
   * build is pure and cheap, but pointless when the toggle is off). The
   * checklist then lets the user trim it job by job. */
  const manualCatalog = useMemo<FlowFigureModel | null>(() => {
    if (!manual) return null;
    if (mode === "demo") return buildDemoFigureModel();
    if (!summary) return null;
    try {
      const parsed = Number(maxGroups);
      return buildFlowFigureModel(summary, {
        maxGroups: Number.isFinite(parsed) ? parsed : 10,
        simplified,
      });
    } catch {
      return null;
    }
  }, [manual, mode, summary, maxGroups, simplified]);

  const catalogItems = useMemo(() => {
    const out: Array<{ uid: string; label: string; thumbs: number }> = [];
    if (!manualCatalog) return out;
    for (const g of manualCatalog.groups) {
      for (const it of g) {
        out.push({
          uid: it.uid,
          label: it.label,
          thumbs: it.classes?.length ?? (it.mapKey || it.imageUrl ? 1 : 0),
        });
      }
    }
    return out;
  }, [manualCatalog]);

  /** New catalog entries default to CHECKED (手动勾选 starts as a superset
   * the user trims); entries the user already decided keep their value. */
  useEffect(() => {
    if (!manual) return;
    setManualSel((prev) => {
      const next: Record<string, boolean> = {};
      for (const it of catalogItems) next[it.uid] = prev[it.uid] ?? true;
      return next;
    });
  }, [manual, catalogItems]);

  const checkedCount = catalogItems.filter((it) => manualSel[it.uid] !== false).length;

  /* ---------------------------------------------------------------- */
  /* Generate                                                          */
  /* ---------------------------------------------------------------- */

  /** v3.47: stage a downloaded MRC on the CHIMERAX machine via the
   *  bridge's POST /stage and return the LOCAL path ChimeraX can open.
   *  The old "页面中转" uploaded bytes into the app's in-memory asset
   *  store and then handed ChimeraX an http URL back — rejected by
   *  ChimeraX ("UserError: Format 'mrc' not supported for database
   *  'http'") on every rung, and a plain open of the suffix-less asset
   *  URL pops the save-file dialog that blocks the whole UI thread (the
   *  round-5/6 “保存map的窗口”). Staging to a local file is the only
   *  ChimeraX-proof fallback path.
   *
   *  v3.56 (round-15): the staged file is named with stagedMapFilename()
   *  — the SAME name the /staged lookup probes — so the upload lands in
   *  the relay's PERSISTENT map cache and every later run opens this map
   *  directly from disk instead of re-downloading it. */
  const stageViaRelay = useCallback(
    async (transport: FlowTransport, key: string, url: string, bytes: Uint8Array, onLog?: (s: string) => void) => {
      const name = stagedMapFilename(key, url);
      onLog?.(`  上传中转 ${name} (${fmtSize(bytes.byteLength)})`);
      if (transport.kind !== "relay" || !transport.canStage) {
        throw new Error(
          `当前 ChimeraX 桥不支持本地暂存（旧版 relay 脚本，无 /stage）— 请在 ChimeraX 中重新运行一次: ${relayCommand}，然后重试`,
        );
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 600_000);
      try {
        const res = await fetch(`${transport.base}/stage?name=${encodeURIComponent(name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-Filename": name },
          body: bytes as BlobPart,
          signal: ctrl.signal,
          mode: "cors",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`relay /stage HTTP ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; path?: string };
        if (!data.ok || !data.path) throw new Error("relay /stage 未返回暂存路径");
        onLog?.(`  暂存完成 → ${data.path}（已入本地缓存 — 下次运行直接从本地打开，不再重复下载）`);
        return data.path;
      } finally {
        clearTimeout(timer);
      }
    },
    [relayCommand],
  );

  const generate = useCallback(async () => {
    if (step.busy) return;
    /* v3.50: stale-bundle gate — a page older than the live server refuses
     * to run (its bridge JS predates the current save/fix ladder and its
     * failures are indistinguishable from real bugs in pasted logs). */
    const serverVersion = await checkEngineFresh();
    if (serverVersion) {
      const msg = `本页面是旧版本（引擎 v${FLOW_ENGINE_VERSION}），服务端已更新到 v${serverVersion} — 请刷新页面（或关闭旧标签页重新打开本应用）后再生成。`;
      setStaleEngine(serverVersion);
      setStep({ ...IDLE, error: msg });
      toast.error(msg);
      return;
    }
    setStaleEngine(null);
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
    setResult(null);
    setThumbs([]);
    setRenderReport([]);
    setStep({ busy: true, phase: "准备", pct: 2, logs: [], error: null });
    pushLog(`流程图引擎 v${FLOW_ENGINE_VERSION}`);

    try {
      /* 1. figure model */
      let model: FlowFigureModel;
      if (mode === "demo") {
        model = buildDemoFigureModel();
      } else {
        if (!summary) throw new Error("尚未载入谱系数据 — 请先完成 Smart Capture 与 Trace Lineage。");
        // v3.45: "0" (the “全部” option) → 0, which buildFlowFigureModel maps
        // to Infinity (never fold). Anything unparseable falls back to 10.
        const parsedGroups = Number(maxGroups);
        model = buildFlowFigureModel(summary, {
          maxGroups: Number.isFinite(parsedGroups) ? parsedGroups : 10,
          simplified,
        });
      }
      /* v3.59 手动模式: trim the model to the checked jobs BEFORE any
       * image work — unchecked stages neither render nor download. The
       * reference/finalStats fixups live in applyManualSelection. */
      if (manual) {
        if (!catalogItems.length) {
          throw new Error("手动勾选: 当前设置下没有可勾选的阶段 — 请先调整阶段数/简化模式或载入谱系数据");
        }
        model = applyManualSelection(model, (uid) => manualSel[uid] !== false);
        if (!model.groups.length) {
          throw new Error("手动勾选: 至少需要勾选一个 job 才能生成流程图");
        }
        pushLog(`手动勾选: 保留 ${model.groups.length}/${catalogItems.length} 个阶段（${checkedCount} 个 job）`);
      }
      if (figStyle === "minimal") {
        pushLog("极简版式: 参考 workflow.pptx — 竖向单列 · 固定长度直箭头 · 选中 class 细框 · 箭头旁标注留存颗粒数 · 不显示 job id/页脚");
      } else {
        pushLog("标准版式: 竖向单列 · 固定长度直箭头 · job id 标注 · 每 class 统计");
      }
      if (mode !== "demo" && simplified) {
        // v3.55: self-diagnosing run log — the simplified pipeline's four
        // guarantees, named up front (the per-stage omissions/hidings then
        // arrive as ⚠ model warnings below).
        pushLog(
          "简化模式: 已开启 — 少量数据的 2D 步骤将省略 · Maximum resolution 为默认 12 Å 的 ab-initio 阶段将整体省略（直接衔接后续精修） · 颗粒数按「从多到少」显示",
        );
      }
      const multiClassGroups = model.groups.filter((g) => g.some((i) => (i.classes?.length ?? 0) > 1));
      const mapTotal = model.groups.flat().reduce(
        (s, i) => s + (i.classes?.length ?? (i.mapKey || i.imageUrl ? 1 : 0)),
        0,
      );
      pushLog(
        `阶段模型: ${model.groups.length} 组 · ${mapTotal} 张缩略图` +
          (multiClassGroups.length ? ` · ${multiClassGroups.length} 个多 class 行（每行并排: ${multiClassGroups.map((g) => g[0].uid).join(" + ")}）` : "") +
          ` · 参考 ${model.referenceKey ?? "—"}`,
      );
      for (const w of model.warnings) pushLog(`⚠ ${w}`);
      const parallel = model.groups.filter((g) => g.length > 1);
      for (const g of parallel) {
        pushLog(`并行分支组: ${g.map((i) => `${i.uid} ${i.label}`).join(" + ")}`);
      }

      const images = new Map<string, Uint8Array>();
      const imageUrls: string[] = [];
      for (const group of model.groups) for (const item of group) if (item.imageUrl) imageUrls.push(item.imageUrl);

      /* 2. per-mode thumbnails */
      let chiralityMeta = { corrected: 0, consistent: 0, ambiguous: 0, failed: 0, view: "" };
      const uniqueMaps = figureMapSources(model);
      // v3.54 (round-13): Chimera classic 的默认打开色序 —— class 0 灰、
      // class 1 淡黄、class 2 淡青、class 3 淡蓝、class 4-7 淡品红/淡红/
      // 淡绿/棕褐（用户粘贴的 16-bit 列表，v3.52/53 的“紫”是对
      // #b333ffffffff 的误读），class 8+ 循环；单图阶段 = 该 job 的
      // “class 0” → 灰。打印在日志里便于对照 Chimera 核对（配色经
      // volume #<id> color 应用）。
      const classDepth = Math.max(0, ...[...uniqueMaps.values()].map((m) => m.classIndex + 1));
      if (uniqueMaps.size > 0) {
        pushLog(
          `地图配色: Chimera 默认打开色序 — class 0-${classDepth - 1} 依次 ${CHIMERA_MODEL_COLORS.slice(
            0,
            classDepth,
          )
            .map((c) => `${c.hex}（${c.label}）`)
            .join("、")}`,
        );
      }

      if (mode === "chimerax") {
        setStep((s) => ({ ...s, phase: "连接 ChimeraX", pct: 6 }));
        let transport = bridge ?? (await probeBridge());
        if (!transport) {
          throw new Error(
            `未找到 ChimeraX 桥（已探测 ${bridgeHosts.join(", ")} 的 8927-8929 / 8765 / 8650；8080 是 CryoSmart Web 自己的端口，桥不会在那里）。请先在 ChimeraX 中运行一次: ` +
              relayCommand +
              " （详见下方说明），或改用「会话预览图 / 演示样例」模式。",
          );
        }

        /* v3.50: re-validate the CACHED bridge before every run. ChimeraX
         * restarts (or a re-opened relay.py) create a NEW mkdtemp workdir
         * while the OLD one still exists on disk — a stale cached transport
         * would then save PNGs into the dead workdir ("successfully") while
         * /file resolves the NEW one: clean save + /file 404 for every
         * screenshot, round-9's exact symptom as a REAL latent bug (not
         * just the stale-page bundle). Ping is one cheap request; on any
         * workdir change the save-rung cache resets with it. v3.56: the
         * ping's cache/cacheDir flags are refreshed in the same breath. */
        if (transport.kind === "relay") {
          try {
            const res = await fetch(`${transport.base}/ping`, { cache: "no-store" });
            if (res.ok) {
              const data = (await res.json()) as { workdir?: string; stage?: boolean; cache?: boolean; cacheDir?: string };
              if (typeof data.workdir === "string" && data.workdir !== transport.workdir) {
                transport = {
                  ...transport,
                  workdir: data.workdir,
                  canStage: !!data.stage,
                  canCache: !!data.cache,
                  cacheDir: data.cacheDir,
                  saveMode: undefined,
                  cdDone: false,
                };
                setBridge(transport);
                pushLog(`桥接工作目录已更新: ${data.workdir}（ChimeraX/桥已重启 — 已自动重新校准）`);
              } else {
                const next = { ...transport, canStage: !!data.stage, canCache: !!data.cache, cacheDir: data.cacheDir };
                if (next.canStage !== transport.canStage || next.canCache !== transport.canCache || next.cacheDir !== transport.cacheDir) {
                  transport = next;
                  setBridge(transport);
                }
              }
            } else {
              // The cached bridge died (ChimeraX closed) — re-probe.
              const fresh = await probeBridge();
              if (fresh) transport = fresh;
            }
          } catch {
            // Relay unreachable on the cached base — full re-probe.
            const fresh = await probeBridge();
            if (fresh) transport = fresh;
          }
          if (!transport) {
            throw new Error(`先前连接的 ChimeraX 桥已不可达（ChimeraX 已关闭？）— 请重新打开 ChimeraX 并运行一次: ${relayCommand}`);
          }
        }
        pushLog(
          `桥接: ${transport.kind} ${transport.host}:${transport.port}` +
            (transport.kind === "relay" && transport.workdir ? ` · 工作目录 ${transport.workdir}` : "") +
            `${transport.canFetchFiles ? "" : " (仅命令，无截图回传)"}`,
        );

        if (transport.kind === "rest") {
          // The official REST server cannot serve rendered PNGs back —
          // run the alignment diagnostics, then fall back to previews.
          pushLog("官方 REST 通道无法回传截图 — 将仅输出对齐/手性诊断，图片退回预览。");
        }

        /* map sources — v3.56 (round-15 “已有 map 直接从本地打开，不重复下载”):
         * the ladder gained a rung 0 that runs FIRST and needs no network:
         * the relay's PERSISTENT map cache (fixed system-temp dir, survives
         * ChimeraX restarts). Every hit yields a LOCAL path ChimeraX opens
         * directly; only the MISSES walk the old ladder (direct → proxy →
         * page relay, whose /stage uploads now land in the cache under the
         * same canonical name, so the NEXT run hits it). */
        const referenceKey = model.referenceKey;
        const referenceItem = uniqueMaps.get(referenceKey ?? "");
        if (!referenceItem) throw new Error("参考地图缺失，无法对齐。");
        const sourceFor = new Map<string, string>();

        if (transport.kind === "relay" && transport.canCache) {
          setStep((s) => ({ ...s, phase: "检查 ChimeraX 本地地图缓存", pct: 8 }));
          let hits = 0;
          let hitBytes = 0;
          for (const [key, item] of uniqueMaps) {
            const hit = await bridgeStagedLookup(transport, stagedMapFilename(key, item.downloadUrl));
            if (hit) {
              sourceFor.set(key, hit.path);
              hits += 1;
              hitBytes += hit.size;
              pushLog(`✓ 地图 ${key} 已在本地缓存（${fmtSize(hit.size)}）— 直接打开本地文件，跳过下载`);
            }
          }
          pushLog(
            hits > 0
              ? `本地缓存命中 ${hits}/${uniqueMaps.size} 张（共 ${fmtSize(hitBytes)}）${
                  hits === uniqueMaps.size ? " — 本次运行零下载" : " — 未命中的地图按 直连/代理/中转 阶梯获取（中转后自动入缓存）"
                }`
              : `本地缓存未命中（0/${uniqueMaps.size}）— 首次运行按 直连/代理/中转 阶梯获取，中转后自动入缓存`,
          );
        } else if (transport.kind === "relay") {
          pushLog("当前桥脚本未启用地图缓存（旧版 relay.py，无 /staged）— 本次仍会下载地图；建议在 ChimeraX 重新运行一次 relay.py 启用缓存，之后重复生成不再重复下载");
        }

        const missedKeys = [...uniqueMaps.keys()].filter((k) => !sourceFor.has(k));
        if (missedKeys.length === 0) {
          pushLog(`地图来源就绪: 全部 ${uniqueMaps.size} 张来自本地缓存 — 直接进入对齐渲染`);
        } else {
          /* probe target — the reference when IT missed, else the first
           * missed map (a cached reference need not be re-probed over the
           * network; any missed map's URL answers the same connectivity
           * question). */
          const probeKey = missedKeys.includes(referenceKey as string) ? (referenceKey as string) : missedKeys[0];
          const probeUrl = uniqueMaps.get(probeKey)!.downloadUrl;

          setStep((s) => ({ ...s, phase: "探测 ChimeraX 直接读取 CryoSmart", pct: 10 }));
          const probe = await bridgeOpenProbe(transport, probeUrl);
          if (probe.ok && probe.modelId != null) {
            await bridgeExec(transport, `close #${probe.modelId}`);
            for (const key of missedKeys) sourceFor.set(key, uniqueMaps.get(key)!.downloadUrl);
            pushLog(
              `ChimeraX 可直接读取内网地图 — 直连模式（仅 ${missedKeys.length} 张未缓存地图走直连${sourceFor.size > missedKeys.length ? "；已缓存的直接打开本地文件" : ""}）`,
            );
          } else {
            // v3.45 (user report — “ChimeraX 直接读取失败(HTTP 401) → 改走应用
            // 中转”之后再无下文): direct reads 401 whenever CryoSmart sits
            // behind login (ChimeraX carries no cookies — expected).
            if (!session) {
              throw new Error(
                `ChimeraX 无法直读内网地图（${probe.error ?? "no model"}），且当前载入的数据没有可代下载的 CryoSmart 凭据 — 请在已登录的 CryoSmart 页重新运行 Smart Capture（或恢复一次带凭据的快照），也可改用「会话预览图」模式。`,
              );
            }

            /* v3.46 map-source ladder, step 2 — 应用代理直连. The round-5 log
             * showed the page relay uploading 8 maps (≈650 MB through the
             * BROWSER: page download + re-POST per map) only for ChimeraX to
             * then read them back from the app anyway. The app proxy already
             * attaches CryoSmart credentials SERVER-side, and ChimeraX proved
             * it can reach the app (it fetched relay.py from there) — so let
             * ChimeraX `open` the proxy URL directly: one transfer chain per
             * map, browser untouched. (v3.47: the open is now a PLAIN
             * `open <proxy-url>` — the URL path ends in `.mrc`, so ChimeraX
             * web-fetches and sniffs the suffix; the previous `format mrc`
             * append was rejected by ChimeraX for http sources on every
             * build — the user's round-6 root cause.) v3.56: only the MISSED
             * maps walk here — cache hits already hold LOCAL paths. */
            const hasCreds = !!(session.cookie || session.auth);
            let proxyMode = false;
            if (hasCreds) {
              pushLog(
                `ChimeraX 直接读取失败(${probe.error ?? "no model"}) → 尝试应用代理直连（ChimeraX → 本应用 → CryoSmart，凭据由应用服务端附加）…`,
              );
              setStep((s) => ({ ...s, phase: "预检应用服务器可达 CryoSmart", pct: 11 }));
              const reachable = await probeCryosmartReachable(session, 8000);
              if (!reachable) {
                throw new Error(
                  `应用服务器无法连接 CryoSmart (${session.baseUrl}) — 代理直连与页面中转都不可用。请确认 CryoSmart 在线且本应用所在机器可访问它，然后重试；或改用「会话预览图」模式。`,
                );
              }
              const proxyUrlFor = (url: string) =>
                buildProxyAbsoluteUrl(session, url, { origin: window.location.origin, timeoutMs: 300_000 });
              const proxyRefUrl = proxyUrlFor(probeUrl);
              if (proxyRefUrl) {
                setStep((s) => ({ ...s, phase: "探测 ChimeraX 经应用代理读取", pct: 12 }));
                const probe2 = await bridgeOpenProbe(transport, proxyRefUrl);
                if (probe2.ok && probe2.modelId != null) {
                  await bridgeExec(transport, `close #${probe2.modelId}`);
                  for (const key of missedKeys) {
                    const pu = proxyUrlFor(uniqueMaps.get(key)!.downloadUrl);
                    if (pu) sourceFor.set(key, pu);
                    else pushLog(`⚠ 地图 ${key} 无法构建代理 URL，将跳过`);
                  }
                  proxyMode = true;
                  pushLog(
                    `ChimeraX 可经应用代理直读地图 — 代理直连模式（${missedKeys.length} 张未缓存地图，无需浏览器下载/中转大文件）`,
                  );
                } else {
                  pushLog(`⚠ 应用代理直读失败(${probe2.error ?? "no model"})`);
                }
              }
            } else {
              pushLog(`ChimeraX 直接读取失败(${probe.error ?? "no model"})，且会话无凭据 — 跳过代理直连`);
            }

            /* v3.47 ladder step 3 (last resort) — the page relay, now with a
             * REAL local staging: page downloads each MRC via the app proxy,
             * POSTs it to the bridge's /stage (since v3.56 into the PERSISTENT
             * map cache), ChimeraX opens the returned LOCAL path. The old
             * version POSTed the bytes into the app's in-memory asset store
             * and handed ChimeraX a suffix-less http URL back — rejected by
             * ChimeraX on every build (format mrc unsupported for http;
             * plain open pops the save dialog that blocks /exec).
             * v3.56: only the MISSED maps download — and each upload lands
             * in the cache, so this step shrinks to zero on every later run
             * of the same workflow. */
            if (!proxyMode) {
              pushLog(
                `→ 改走页面中转：页面下载 MRC → 桥接暂存为 ChimeraX 本地文件 → ChimeraX 打开本地路径（每个 map 100–300 MB，请稍候；暂存后自动进入本地缓存，下次运行不再重复下载）`,
              );
              if (transport.kind !== "relay" || !transport.canStage) {
                throw new Error(
                  `当前 ChimeraX 桥不支持本地暂存（旧版 relay 脚本，无 /stage 端点）。请在 ChimeraX 中重新运行一次: ${relayCommand}（无需重启 ChimeraX），然后重试；或改用「会话预览图」模式。`,
                );
              }
              setStep((s) => ({ ...s, phase: "下载并中转 MRC 文件", pct: 12 }));
              let done = 0;
              const failedKeys: string[] = [];
              for (const key of missedKeys) {
                const item = uniqueMaps.get(key)!;
                done += 1;
                setStep((s) => ({ ...s, phase: `中转地图 ${done}/${missedKeys.length}`, pct: 10 + (done / Math.max(1, missedKeys.length)) * 35 }));
                try {
                  const bytes = await cryoSmartBytes(session, item.downloadUrl, {
                    timeoutMs: 300_000,
                    onBytes: (total) => setStep((s) => ({ ...s, phase: `下载 ${key} · ${fmtSize(total)}（${done}/${missedKeys.length}）` })),
                  });
                  sourceFor.set(key, await stageViaRelay(transport, key, item.downloadUrl, bytes, pushLog));
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  if (key === referenceKey) {
                    throw new Error(
                      `参考地图下载失败（${msg}）— 无法对齐。请确认 CryoSmart 已在同一浏览器中登录、本应用仍在运行，然后重试；或改用「会话预览图」模式。`,
                    );
                  }
                  failedKeys.push(key);
                  pushLog(`⚠ 地图 ${key} 中转失败，已跳过（${msg}）`);
                }
              }
              if (failedKeys.length) {
                pushLog(`⚠ 共 ${failedKeys.length} 个地图未能中转，流程图将缺少对应阶段（其余阶段照常渲染）。`);
              }
            }
          }
        }

        /* align + chirality + screenshots */
        const maps = [...uniqueMaps.values()]
          .filter((m) => m.key !== referenceKey)
          .map((m) => ({
            key: m.key,
            uid: m.uid,
            group: m.group,
            // v3.52: per-class Chimera default open-color (see chimera-colors.ts).
            color: chimeraClassColor(m.classIndex),
            sourceUrl: sourceFor.get(m.key) ?? "",
          }))
          .filter((m) => m.sourceUrl);

        /* v3.47: the reference MUST have a working source before entering
         * the alignment pipeline — the old `?? refUrl` silent fallback sent
         * ChimeraX the direct (401) URL and produced an unexplained open
         * failure after 650 MB of uploads. */
        const referenceSource = sourceFor.get(referenceKey as string);
        if (!referenceSource) {
          throw new Error(
            `参考地图 ${referenceKey} 无可用来源（直连/代理/中转均未成功）— 无法对齐。请根据上方日志中各环节的失败原因处理后重试；或改用「会话预览图」模式。`,
          );
        }
        // v3.53 (round-12): 自诊日志 —— 本次运行的两项渲染约定（透明背景 +
        // volume color 着色）都在日志里留底，粘贴来的日志可自证版本。
        pushLog("地图渲染: 透明背景（save transparentBackground true）· 配色经 volume #<id> color 应用（不透明表面）");

        const renderRes = await renderFigureMaps(transport, {
          reference: {
            key: referenceKey as string,
            uid: referenceItem.uid,
            group: referenceItem.group,
            // v3.52: the reference map's own class color (single-map final
            // stage → grey; a class map keeps its palette position).
            color: chimeraClassColor(uniqueMaps.get(referenceKey as string)?.classIndex ?? 0),
            sourceUrl: referenceSource,
          },
          maps,
          onLog: pushLog,
          onProgress: (p) => setStep((s) => ({ ...s, phase: p.phase, pct: Math.max(s.pct, p.pct ?? s.pct) })),
        });

        const rendered = new Map<string, Uint8Array>();
        for (const r of renderRes.renders) {
          if (r.png) rendered.set(r.key, r.png);
        }
        setRenderReport(renderRes.renders);
        chiralityMeta = {
          corrected: renderRes.renders.filter((r) => r.chirality === "corrected").length,
          consistent: renderRes.renders.filter((r) => r.chirality === "consistent").length,
          ambiguous: renderRes.renders.filter((r) => r.chirality === "ambiguous").length,
          failed: renderRes.renders.filter((r) => r.chirality === "unknown" || r.candidate === "none").length,
          view: renderRes.view.desc,
        };

        if (rendered.size) {
          setStep((s) => ({ ...s, phase: "统一取景裁边（保留透明背景）", pct: 90 }));
          const trimmed = await uniformLetterbox(rendered, 2, 1600);
          for (const [key, bytes] of trimmed) images.set(key, bytes);
        }
      } else if (mode === "preview") {
        setStep((s) => ({ ...s, phase: "收集会话预览图", pct: 30 }));
        let done = 0;
        for (const [key, item] of uniqueMaps) {
          done += 1;
          setStep((s) => ({ ...s, phase: `预览图 ${done}/${uniqueMaps.size}`, pct: 30 + (done / Math.max(1, uniqueMaps.size)) * 50 }));
          const url = item.previewUrl;
          if (!url) continue;
          try {
            images.set(key, await cryoSmartBytes(session, url));
          } catch {
            pushLog(`⚠ 预览图获取失败: ${key}`);
          }
        }
      } else {
        setStep((s) => ({ ...s, phase: "加载演示图片", pct: 40 }));
      }

      /* captured images (2D montage / demo thumbs) */
      if (imageUrls.length) {
        setStep((s) => ({ ...s, phase: "收集谱系截图", pct: Math.max(s.pct, 55) }));
        const fetched = await fetchFigureImages(imageUrls, mode === "demo" ? null : session);
        for (const [url, bytes] of fetched) images.set(url, bytes);
      }

      /* optional FSC panel */
      if (includeFsc && mode !== "demo") {
        setStep((s) => ({ ...s, phase: "绘制 FSC 曲线", pct: 82 }));
        const xml = await fetchFscXmlText(model.fscXml, session);
        const png = await fscPng(xml, summary?.micrograph_pixel_size_A ?? null);
        if (png) {
          images.set("__fsc__", png);
          model.groups.push([{ uid: "FSC", label: "FSC", stats: [], mapKey: null, map: null, imageUrl: "__fsc__" }]);
        } else {
          pushLog("⚠ 未能解析 FSC XML（缺少曲线数据）");
        }
      }

      /* 3. assemble pptx */
      setStep((s) => ({ ...s, phase: "组装竖版流程图 PPTX", pct: 94 }));
      const footnote =
        mode === "demo"
          ? "CryoSmart Workflow Figure (demo) · 参考 Workflow.pptx 版式"
          : figureFootnote({
              referenceKey: model.referenceKey,
              corrected: chiralityMeta.corrected,
              consistent: chiralityMeta.consistent,
              ambiguous: chiralityMeta.ambiguous,
              failed: chiralityMeta.failed,
              view: chiralityMeta.view || null,
              mode: mode === "chimerax" ? "ChimeraX aligned" : "session previews",
            });
      const blob = buildWorkflowPptx(model, { images, footnote, style: figStyle });
      const project = mode === "demo" ? "Demo" : `${summary?.project_uid ?? "P"}_${summary?.start_uid ?? "J"}`;
      const filename = `CryoSmart_${project}_workflow.pptx`;
      const blobUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.push(blobUrl);
      /* v3.50 (round-9 “pptx文件下载不了”): the finished PPTX is ALSO
       * uploaded to the app's in-memory artifact store so the user gets a
       * REAL same-origin URL. In-page blob: downloads silently no-op in
       * some sandboxed preview iframes; a server URL can be re-clicked,
       * right-click “链接另存为”, opened in a new tab, or copied, and it
       * survives a page reload (45-minute TTL, same as the map store). */
      let serverUrl: string | null = null;
      try {
        const up = await fetch(
          `/api/cryosmart/flow-figure/asset?name=${encodeURIComponent(filename)}&mime=${encodeURIComponent(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          )}`,
          { method: "POST", body: blob },
        );
        if (up.ok) {
          const data = (await up.json()) as { url?: string };
          if (data.url) serverUrl = `${data.url}&download=1`;
        }
      } catch {
        /* non-fatal — the blob fallback stays */
      }
      if (!serverUrl) pushLog("⚠ 服务端下载链接生成失败 — 将仅用页面内下载（关闭本页后链接即失效）");
      const downloadHref = serverUrl ?? blobUrl;
      triggerDownload(downloadHref, filename);
      setResult({ url: downloadHref, blobUrl, serverUrl, size: blob.size, filename });
      setStep((s) => ({ ...s, busy: false, phase: "完成", pct: 100 }));
      toast.success(`流程图已生成: ${filename} (${fmtSize(blob.size)})`);

      /* preview thumbnails */
      const previewThumbs: { key: string; url: string }[] = [];
      const shown = new Set<string>();
      for (const group of model.groups) {
        for (const item of group) {
          // v3.51: every class slot gets its own preview thumb.
          const keys = item.classes?.length
            ? item.classes.map((c) => c.mapKey)
            : [item.mapKey ?? item.imageUrl ?? null];
          for (const key of keys) {
            if (!key || shown.has(key)) continue;
            const bytes = images.get(key) ?? (item.imageUrl ? images.get(item.imageUrl) : null);
            if (bytes) {
              shown.add(key);
              const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
              objectUrlsRef.current.push(u);
              previewThumbs.push({ key, url: u });
            }
          }
        }
      }
      setThumbs(previewThumbs.slice(0, 6));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStep((s) => ({ ...s, busy: false, error: message }));
      toast.error(`流程图生成失败: ${message}`);
    }
  }, [step.busy, mode, summary, session, bridge, probeBridge, relayCommand, stageViaRelay, pushLog, maxGroups, includeFsc, simplified, figStyle, manual, manualSel, catalogItems, checkedCount, bridgeHosts, checkEngineFresh]);

  const canGenerate = !step.busy && (mode === "demo" || !!summary);
  const bridgeBadge = useMemo(() => {
    if (bridgeProbing) return <Badge variant="outline" className="gap-1 text-[10px]"><Loader2 className="h-3 w-3 animate-spin" />探测中</Badge>;
    if (bridge) return <Badge className="gap-1 bg-emerald-100 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" />{bridge.kind} {bridge.host}:{bridge.port}</Badge>;
    if (bridgeTried) return <Badge variant="outline" className="gap-1 text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3" />未连接</Badge>;
    return <Badge variant="outline" className="text-[10px] text-slate-400">待探测</Badge>;
  }, [bridge, bridgeProbing, bridgeTried]);

  return (
    <Card id="flow-figure" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
            <Workflow className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Workflow Figure · 一键流程图</CardTitle>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-slate-500 dark:text-slate-400">竖版 PPTX</Badge>
          {/* v3.50: engine version — printed in every run log, so a pasted log
           * names its own bundle version (a log without the 流程图引擎 line is
           * a pre-3.50 stale page by definition). */}
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-teal-700 dark:text-teal-300">引擎 v{FLOW_ENGINE_VERSION}</Badge>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          竖向单列排版，箭头固定尺寸、直线连接；所有 map 由 ChimeraX 渲染并统一朝向与手性。可选「极简版式」（参考 workflow.pptx：选中 class 细框 + 箭头旁留存颗粒数标注）与「手动勾选」需要展示的 job。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* mode selector */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["chimerax", "ChimeraX 渲染", "对齐 + 手性检查 + 截图"],
            ["preview", "会话预览图", "使用已捕获的预览图"],
            ["demo", "演示样例", "无需 ChimeraX / 谱系"],
          ] as Array<[FigureMode, string, string]>).map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                if (m === "chimerax" && !bridge && !bridgeProbing) void probeBridge();
              }}
              className={`rounded-lg border px-3 py-2 text-left transition-all ${
                mode === m
                  ? "border-teal-300 bg-teal-50/70 shadow-sm dark:border-teal-700 dark:bg-teal-950/30"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
              } ${m === "chimerax" && !hasSummary ? "cursor-not-allowed opacity-50" : ""}`}
              disabled={m === "chimerax" && !hasSummary}
              title={hint}
            >
              <span className={`block text-[12.5px] font-semibold ${mode === m ? "text-teal-800 dark:text-teal-300" : "text-slate-700 dark:text-slate-200"}`}>{label}</span>
              <span className="block text-[10.5px] text-slate-500 dark:text-slate-400">{hint}</span>
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-4">
            {/* v3.59: 版式 selector — 标准 vs 极简 (BuildPptxOptions.style). */}
            <div className="flex items-center gap-2" title="极简版式参考 workflow.pptx：无 job id/页脚，选中 class 加细框，箭头旁标注留存颗粒数与百分比；标准版式保留 job id 与每 class 统计">
              <Label className="text-[11.5px] text-slate-600 dark:text-slate-300">版式</Label>
              <Select value={figStyle} onValueChange={(v) => setFigStyle(v as FigureStyle)}>
                <SelectTrigger className="h-8 w-[82px] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">标准</SelectItem>
                  <SelectItem value="minimal">极简</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* v3.59: 手动模式 — check which jobs' images appear. */}
            <div className="flex items-center gap-2" title="开启后可在下方勾选需要体现在流程图里的 job（未勾选的阶段不渲染、不下载）">
              <Switch id="flow-manual" checked={manual} onCheckedChange={setManual} />
              <Label htmlFor="flow-manual" className="text-[11.5px] text-slate-600 dark:text-slate-300">
                手动勾选
              </Label>
            </div>
            <div className="flex items-center gap-2" title="省略少量数据的 2D 步骤；省略 Maximum resolution 为默认 12 Å 的 ab-initio 阶段（直接显示后续精修，如 hetero refine）；合并相邻同颗粒数的 non-uniform；隐藏破坏「从多到少」的计数">
              <Switch
                id="flow-simplified"
                checked={simplified}
                onCheckedChange={setSimplified}
                disabled={mode === "demo"}
              />
              <Label
                htmlFor="flow-simplified"
                className={`text-[11.5px] ${mode === "demo" ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"}`}
              >
                简化模式
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="flow-fsc" checked={includeFsc} onCheckedChange={setIncludeFsc} />
              <Label htmlFor="flow-fsc" className="text-[11.5px] text-slate-600 dark:text-slate-300">附 FSC 曲线</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[11.5px] text-slate-600 dark:text-slate-300">阶段数</Label>
              <Select value={maxGroups} onValueChange={setMaxGroups}>
                <SelectTrigger className="h-8 w-[70px] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["4", "5", "6", "7", "8", "9", "10"].map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                  {/* v3.45: “全部” — never fold, even beyond 10 stages. */}
                  <SelectItem value="0">全部</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* v3.59 手动模式: the job checklist. Each row = one job in the
         * figure model built with the CURRENT 阶段数/简化 settings;
         * unchecked jobs are dropped before any image work. */}
        {manual && (
          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-800 dark:bg-teal-950/20">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">勾选需要体现的 job</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-teal-700 dark:text-teal-300">
                {checkedCount}/{catalogItems.length}
              </Badge>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const it of catalogItems) next[it.uid] = true;
                    setManualSel(next);
                  }}
                >
                  全选
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const it of catalogItems) next[it.uid] = false;
                    setManualSel(next);
                  }}
                >
                  清空
                </Button>
              </div>
            </div>
            {catalogItems.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                {mode === "demo" ? "演示样例没有可勾选的阶段。" : "当前设置下没有可勾选的阶段 — 请先载入谱系数据，或调整阶段数/简化模式。"}
              </p>
            ) : (
              <ScrollArea className="mt-2 max-h-48 rounded-md border border-teal-100 bg-white dark:border-teal-900 dark:bg-slate-900">
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {catalogItems.map((it) => (
                    <label
                      key={it.uid}
                      className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <Checkbox
                        checked={manualSel[it.uid] !== false}
                        onCheckedChange={(v) => setManualSel((prev) => ({ ...prev, [it.uid]: !!v }))}
                      />
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {it.uid}
                      </span>
                      <span className="flex-1 truncate text-[12px] text-slate-700 dark:text-slate-200">{it.label}</span>
                      <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                        {it.thumbs > 1 ? `${it.thumbs} 张图` : it.thumbs === 1 ? "1 张图" : "无图"}
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            )}
            {checkedCount === 0 && catalogItems.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">至少需要勾选一个 job 才能生成流程图。</p>
            )}
          </div>
        )}

        {/* ChimeraX bridge panel */}
        {mode === "chimerax" && (
          <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50/70 to-emerald-50/40 p-3 dark:border-teal-800 dark:from-teal-950/20 dark:to-emerald-950/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">ChimeraX 桥状态</span>
              {bridgeBadge}
              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => void probeBridge(false)} disabled={bridgeProbing}>
                <RefreshCw className={`h-3 w-3 ${bridgeProbing ? "animate-spin" : ""}`} /> 测试连接
              </Button>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {bridge
                  ? bridge.canFetchFiles
                    ? "完整能力：命令 + 统计 + 截图回传"
                    : "官方 REST：仅命令诊断（无截图回传，图片将退回预览）"
                  : "在 ChimeraX 里运行一次下面的命令即可（之后保持 ChimeraX 打开）"}
              </span>
            </div>
            {!bridge && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11.5px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {relayCommand}
                  </code>
                  <Button size="sm" className="h-8 gap-1 bg-teal-600 text-[11.5px] hover:bg-teal-700" onClick={copyRelay}>
                    <Copy className="h-3.5 w-3.5" /> 复制
                  </Button>
                </div>
                <div className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    端口说明：此桥 open 之后在 ChimeraX 内部监听 <b>8927/8928/8929</b>；备选的官方 REST 需在 ChimeraX 里运行 <code className="font-mono">remotecontrol rest start</code>（默认 8765/8650）。
                    <b>8080 是 CryoSmart Web 自己的端口，ChimeraX 桥不会、也不能运行在那里</b>——在 8080 上检测不到属正常。本页会同时探测
                    {bridgeHosts.map((h) => (
                      <code key={h} className="mx-0.5 rounded bg-slate-200 px-1 font-mono text-[10px] dark:bg-slate-800">{h}</code>
                    ))}
                    的上述端口（ChimeraX 装在{cryoSmartHost ? `服务器 ${cryoSmartHost} 上` : "服务器上"}也能找到——relay 监听全部网卡，可跨机访问；仅需放行系统防火墙）。
                    若 ChimeraX 无法直读内网地图，将依次自动降级：<b>应用代理直连</b>（推荐 — ChimeraX 直接读取本应用转发的地图，凭据由服务端附加，不经浏览器）→ <b>页面中转</b>（页面下载 MRC → 桥接暂存为本地文件并自动进入持久缓存 → ChimeraX 读取）。每次生成前都会先查 ChimeraX 本地缓存（v3.56）：中转过/打开过的 map 留存在 ChimeraX 机器的固定缓存目录（跨 ChimeraX 重启保留），命中的地图直接从本地打开，不再重复下载。ChimeraX 1.12 的 MCP 同样由本地 REST server 支撑，但官方 CORS 仅放行 localhost 网页；此桥用同一内部机制，Origin 校验锁定为本应用。高级：
                    <a className="underline" href="/helpers/CryoSmart_flow_relay.py" download>下载桥脚本</a>。
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* v3.50: stale-page banner — a tab from an older dev-server session
         * must not re-run old bridge JS against the new server. */}
        {staleEngine && (
          <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2.5 text-[12px] text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              本页面是<strong>旧版本</strong>（引擎 v{FLOW_ENGINE_VERSION}），服务端已更新到 v{staleEngine} — 请
              <strong>刷新页面</strong>（或关闭旧标签页重新打开本应用）后再生成，否则流程图会按旧逻辑失败。
            </span>
          </div>
        )}

        {/* generate */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="h-9 gap-2 bg-teal-600 px-5 text-[13px] font-semibold hover:bg-teal-700"
            onClick={() => void generate()}
            disabled={!canGenerate}
          >
            {step.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {step.busy ? "生成中…" : "生成流程图 PPTX"}
          </Button>
          {step.busy && (
            <div className="flex min-w-[220px] flex-1 items-center gap-3">
              <Progress value={step.pct} className="h-2 flex-1" />
              <span className="whitespace-nowrap text-[11.5px] text-slate-500 dark:text-slate-400">{step.phase} · {Math.round(step.pct)}%</span>
            </div>
          )}
        </div>

        {/* error */}
        {step.error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/70 p-2.5 text-[12px] text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all">{step.error}</span>
          </div>
        )}

        {/* live log */}
        {step.logs.length > 0 && (
          <ScrollArea className="h-40 rounded-md border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="space-y-0.5 p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              {step.logs.map((line, i) => (
                <div key={i} className={line.startsWith("⚠") || line.includes("失败") ? "text-amber-600 dark:text-amber-400" : line.startsWith("!") ? "text-rose-500" : ""}>
                  {line}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* result */}
        {result && (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300">{result.filename}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-slate-500 dark:text-slate-400">{fmtSize(result.size)}</Badge>
              <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-[11px]">
                <a href={result.url} download={result.filename}>
                  <Download className="h-3 w-3" /> 再次下载
                </a>
              </Button>
              {result.serverUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => {
                    const abs = new URL(result.serverUrl as string, window.location.origin).href;
                    void navigator.clipboard
                      .writeText(abs)
                      .then(() => toast.success("下载链接已复制（45 分钟内有效，可在新标签页中粘贴直达）"))
                      .catch(() => toast.error("复制失败 — 请右键“再次下载”选择“复制链接地址”"));
                  }}
                >
                  <Link2 className="h-3 w-3" /> 复制链接
                </Button>
              )}
            </div>
            {/* v3.50 (round-9 “pptx文件下载不了”): in sandboxed preview iframes
             * an auto blob download can silently no-op. The PPTX now ALSO
             * lives on the server, so even when the auto-click is blocked the
             * link above works (re-click / save-as / copy / new tab). */}
            {typeof window !== "undefined" && window.self !== window.top && (
              <div className="flex items-start gap-1.5 rounded-md border border-emerald-200 bg-white/70 p-2 text-[11px] leading-relaxed text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  若文件未自动开始下载：请点击「再次下载」；仍无反应时，可复制链接后在预览面板顶部点
                  <strong>「在新标签页打开」</strong>，在新页面的地址栏粘贴并回车即可下载（链接 45 分钟内有效）。
                </span>
              </div>
            )}
            {thumbs.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {thumbs.map((t) => (
                  <figure key={t.key} className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    <img src={t.url} alt={t.key} className="aspect-[2/1] w-full object-contain" />
                    <figcaption className="truncate px-1.5 py-1 text-[9.5px] text-slate-500 dark:text-slate-400">{t.key}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {renderReport.length > 0 && (
              <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <tr>
                      <th className="px-2 py-1.5">Map</th>
                      <th className="px-2 py-1.5">选中候选</th>
                      <th className="px-2 py-1.5">相关性</th>
                      <th className="px-2 py-1.5">手性</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
                    {renderReport.map((r) => (
                      <tr key={r.key}>
                        <td className="px-2 py-1.5 font-mono text-[10.5px] text-slate-700 dark:text-slate-200">{r.key}</td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{r.candidate}</td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{r.score != null ? r.score.toFixed(4) : "—"}</td>
                        <td className="px-2 py-1.5">
                          {r.chirality === "corrected" ? (
                            <Badge className="bg-amber-100 px-1.5 py-0 text-[9.5px] text-amber-700 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300">已翻正 (flip_z)</Badge>
                          ) : r.chirality === "consistent" ? (
                            <Badge className="bg-emerald-100 px-1.5 py-0 text-[9.5px] text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">一致</Badge>
                          ) : r.chirality === "ambiguous" ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9.5px] text-slate-500">对称/不可判定</Badge>
                          ) : (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9.5px] text-rose-500">失败</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* how it works */}
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            竖向单列排版（画布高度随阶段数自动加长），阶段间一律为<b>固定尺寸的直线箭头</b>（无折线/肘线）；每张 map 先在 ChimeraX 里做 5 候选拟合（original / x·y·z 180° 旋转 / z-flip），按 <code className="font-mono">fit search 15</code> 相关性选最优 ——
            z-flip 胜出即手性相反、已自动翻正；参考地图做 90° 视角白区评分后统一应用到所有地图，保证朝向与比例一致。极简版式另会在「喂给下一阶段」的 class 周围画细框，并在箭头旁标注留存颗粒数与百分比。图片上的 <code className="font-mono">CryoSmartImage:&lt;uid&gt;/&lt;group&gt;</code> 标记保持与桌面 helper 脚本互换兼容。
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
