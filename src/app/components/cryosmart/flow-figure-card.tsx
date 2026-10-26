"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  type FlowTransport,
  type MapRender,
} from "@/lib/cryosmart/chimerax-bridge";
import {
  buildFlowFigureModel,
  buildDemoFigureModel,
  fetchFigureImages,
  fetchFscXmlText,
  fscPng,
  uniformLetterbox,
  figureFootnote,
  type FlowFigureModel,
} from "@/lib/cryosmart/workflow-figure";
import { buildWorkflowPptx } from "@/lib/cryosmart/workflow-pptx";
import { downloadBlob } from "@/lib/cryosmart/bundle";
import { cryoSmartBytes } from "@/lib/cryosmart/proxy-client";

type FigureMode = "chimerax" | "preview" | "demo";

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

export function FlowFigureCard({ summary, loaded }: { summary: LineageSummary | null; loaded: LoadedMetadata | null }) {
  const [mode, setMode] = useState<FigureMode>("demo");
  const [bridge, setBridge] = useState<FlowTransport | null>(null);
  const [bridgeProbing, setBridgeProbing] = useState(false);
  const [bridgeTried, setBridgeTried] = useState(false);
  const [step, setStep] = useState<StepState>(IDLE);
  const [includeFsc, setIncludeFsc] = useState(false);
  // v3.45: default "10" — the widest numeric value (folding off for every
  // lineage with ≤10 stages, which covers the real P208 8-stage model that
  // used to ship with 2 collapsed stages). "0" = the “全部” selector entry
  // (never fold, even beyond 10).
  const [maxGroups, setMaxGroups] = useState("10");
  const [result, setResult] = useState<{ url: string; size: number; filename: string } | null>(null);
  const [thumbs, setThumbs] = useState<{ key: string; url: string }[]>([]);
  const [renderReport, setRenderReport] = useState<MapRender[]>([]);
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
  /* Generate                                                          */
  /* ---------------------------------------------------------------- */

  const uploadAsset = useCallback(async (key: string, bytes: Uint8Array, onLog?: (s: string) => void) => {
    const name = `${key.replace(/\//g, ".")}.mrc`;
    onLog?.(`  上传中转 ${name} (${fmtSize(bytes.byteLength)})`);
    const res = await fetch(`/api/cryosmart/flow-figure/asset?name=${encodeURIComponent(name)}&mime=application/octet-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes as BlobPart,
    });
    if (!res.ok) throw new Error(`asset relay HTTP ${res.status}`);
    const data = (await res.json()) as { url: string };
    return `${window.location.origin}${data.url}`;
  }, []);

  const generate = useCallback(async () => {
    if (step.busy) return;
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
    setResult(null);
    setThumbs([]);
    setRenderReport([]);
    setStep({ busy: true, phase: "准备", pct: 2, logs: [], error: null });

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
        });
      }
      pushLog(`阶段模型: ${model.groups.length} 组 · 参考 ${model.referenceKey ?? "—"}`);
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
      const mapItems = model.groups.flat().filter((i) => i.mapKey && i.map?.downloadUrl);
      const uniqueMaps = new Map(mapItems.map((i) => [i.mapKey as string, i]));

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
        pushLog(`桥接: ${transport.kind} ${transport.host}:${transport.port}${transport.canFetchFiles ? "" : " (仅命令，无截图回传)"}`);

        if (transport.kind === "rest") {
          // The official REST server cannot serve rendered PNGs back —
          // run the alignment diagnostics, then fall back to previews.
          pushLog("官方 REST 通道无法回传截图 — 将仅输出对齐/手性诊断，图片退回预览。");
        }

        /* map sources: direct CryoSmart URL first, asset relay as fallback */
        const referenceKey = model.referenceKey;
        const referenceItem = uniqueMaps.get(referenceKey ?? "");
        if (!referenceItem) throw new Error("参考地图缺失，无法对齐。");
        const refUrl = referenceItem.map?.downloadUrl as string;

        setStep((s) => ({ ...s, phase: "探测 ChimeraX 直接读取 CryoSmart", pct: 10 }));
        const probe = await bridgeOpenProbe(transport, refUrl);
        const sourceFor = new Map<string, string>();
        if (probe.ok && probe.modelId != null) {
          await bridgeExec(transport, `close #${probe.modelId}`);
          for (const [key, item] of uniqueMaps) sourceFor.set(key, item.map?.downloadUrl as string);
          pushLog("ChimeraX 可直接读取内网地图 — 直连模式");
        } else {
          // v3.45 (user report — “ChimeraX 直接读取失败(HTTP 401) → 改走应用
          // 中转”之后再无下文): direct reads 401 whenever CryoSmart sits
          // behind login (ChimeraX carries no cookies — expected). The
          // app-relay path then needs THIS PAGE to download the bytes, which
          // needs a session — fail with an actionable message instead of an
          // opaque mid-loop error, isolate per-map failures so one bad map
          // no longer kills the whole figure, and stream download progress
          // (each MRC is 100–300 MB — the strip used to sit at one phase
          // word for minutes).
          if (!session) {
            throw new Error(
              `ChimeraX 无法直读内网地图（${probe.error ?? "no model"}），且当前载入的数据没有可代下载的 CryoSmart 凭据 — 请在已登录的 CryoSmart 页重新运行 Smart Capture（或恢复一次带凭据的快照），也可改用「会话预览图」模式。`,
            );
          }
          pushLog(
            `ChimeraX 直接读取失败(${probe.error ?? "no model"}) → 改走应用中转：页面下载 MRC → 应用暂存 → ChimeraX 读取（每个 map 100–300 MB，请稍候）`,
          );
          setStep((s) => ({ ...s, phase: "下载并中转 MRC 文件", pct: 12 }));
          let done = 0;
          const failedKeys: string[] = [];
          for (const [key, item] of uniqueMaps) {
            done += 1;
            setStep((s) => ({ ...s, phase: `中转地图 ${done}/${uniqueMaps.size}`, pct: 10 + (done / Math.max(1, uniqueMaps.size)) * 35 }));
            try {
              const bytes = await cryoSmartBytes(session, item.map?.downloadUrl as string, {
                timeoutMs: 300_000,
                onBytes: (total) => setStep((s) => ({ ...s, phase: `下载 ${key} · ${fmtSize(total)}（${done}/${uniqueMaps.size}）` })),
              });
              sourceFor.set(key, await uploadAsset(key, bytes, pushLog));
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

        /* align + chirality + screenshots */
        const maps = [...uniqueMaps.values()]
          .filter((i) => i.mapKey !== referenceKey)
          .map((i) => ({
            key: i.mapKey as string,
            uid: i.uid,
            group: i.map?.group ?? "volume",
            sourceUrl: sourceFor.get(i.mapKey as string) ?? "",
          }))
          .filter((m) => m.sourceUrl);

        const renderRes = await renderFigureMaps(transport, {
          reference: {
            key: referenceKey as string,
            uid: referenceItem.uid,
            group: referenceItem.map?.group ?? "volume",
            sourceUrl: sourceFor.get(referenceKey as string) ?? refUrl,
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
          setStep((s) => ({ ...s, phase: "统一裁剪白边", pct: 90 }));
          const trimmed = await uniformLetterbox(rendered, 2, 1600);
          for (const [key, bytes] of trimmed) images.set(key, bytes);
        }
      } else if (mode === "preview") {
        setStep((s) => ({ ...s, phase: "收集会话预览图", pct: 30 }));
        let done = 0;
        for (const [key, item] of uniqueMaps) {
          done += 1;
          setStep((s) => ({ ...s, phase: `预览图 ${done}/${uniqueMaps.size}`, pct: 30 + (done / Math.max(1, uniqueMaps.size)) * 50 }));
          const url = item.map?.previewUrl;
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
      setStep((s) => ({ ...s, phase: "组装 16:9 流程图 PPTX", pct: 94 }));
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
      const blob = buildWorkflowPptx(model, { images, footnote });
      const project = mode === "demo" ? "Demo" : `${summary?.project_uid ?? "P"}_${summary?.start_uid ?? "J"}`;
      const filename = `CryoSmart_${project}_workflow.pptx`;
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      setResult({ url, size: blob.size, filename });
      downloadBlob(blob, filename);
      setStep((s) => ({ ...s, busy: false, phase: "完成", pct: 100 }));
      toast.success(`流程图已生成: ${filename} (${fmtSize(blob.size)})`);

      /* preview thumbnails */
      const previewThumbs: { key: string; url: string }[] = [];
      const shown = new Set<string>();
      for (const group of model.groups) {
        for (const item of group) {
          const key = item.mapKey ?? item.imageUrl ?? null;
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
      setThumbs(previewThumbs.slice(0, 6));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStep((s) => ({ ...s, busy: false, error: message }));
      toast.error(`流程图生成失败: ${message}`);
    }
  }, [step.busy, mode, summary, session, bridge, probeBridge, relayCommand, uploadAsset, pushLog, maxGroups, includeFsc, bridgeHosts]);

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
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-slate-500 dark:text-slate-400">16:9 PPTX</Badge>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          按参考 Workflow.pptx 版式一键生成流程图：所有 map 由 ChimeraX 渲染，先拟合到参考地图保证朝向一致，再做 90° 视角统一，手性（z-flip）逐图检查并翻正；输出 16:9 PPTX。
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
          <div className="ml-auto flex items-center gap-4">
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
                    若 ChimeraX 无法直读内网地图，会自动改走应用中转（页面下载 MRC → 应用暂存 → ChimeraX 读取）。ChimeraX 1.12 的 MCP 同样由本地 REST server 支撑，但官方 CORS 仅放行 localhost 网页；此桥用同一内部机制，Origin 校验锁定为本应用。高级：
                    <a className="underline" href="/helpers/CryoSmart_flow_relay.py" download>下载桥脚本</a>。
                  </span>
                </div>
              </div>
            )}
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
            </div>
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
            流程图中的每张 map 先在 ChimeraX 里做 5 候选拟合（original / x·y·z 180° 旋转 / z-flip），按 <code className="font-mono">fit search 15</code> 相关性选最优 ——
            z-flip 胜出即手性相反、已自动翻正；参考地图做 90° 视角白区评分后统一应用到所有地图，保证朝向与比例一致。图片上的 <code className="font-mono">CryoSmartImage:&lt;uid&gt;/&lt;group&gt;</code> 标记保持与桌面 helper 脚本互换兼容。
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
