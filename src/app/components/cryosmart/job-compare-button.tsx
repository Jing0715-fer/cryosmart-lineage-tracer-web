"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitCompare,
  Activity,
  Microscope,
  Box,
  Zap,
  Hash,
  Layers,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
} from "lucide-react";
import type { LineageSummary, LineageNode } from "@/lib/cryosmart/types";

interface Props {
  summary: LineageSummary;
}

type Diff = "up" | "down" | "same" | "none";

/**
 * Compare two jobs side-by-side. Triggered by a "Compare" button in the
 * Job Explorer card header. Opens a dialog with two job selectors and a
 * metric diff table showing deltas with up/down/same arrows.
 */
export function JobCompareButton({ summary }: Props) {
  const [open, setOpen] = useState(false);
  const [uidA, setUidA] = useState<string>("");
  const [uidB, setUidB] = useState<string>("");

  const nodes = summary.nodes || [];
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0)),
    [nodes]
  );

  const nodeA = uidA ? nodes.find((n) => n.uid === uidA) : null;
  const nodeB = uidB ? nodes.find((n) => n.uid === uidB) : null;

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v && !uidA && sortedNodes.length > 0) {
      setUidA(sortedNodes[0].uid);
      if (sortedNodes.length > 1) setUidB(sortedNodes[sortedNodes.length - 1].uid);
    }
  };

  const swap = () => {
    setUidA(uidB);
    setUidB(uidA);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-teal-300 bg-teal-50/50 text-[12px] text-teal-700 hover:bg-teal-100 hover:text-teal-800 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-400 dark:hover:bg-teal-900"
        >
          <GitCompare className="h-3.5 w-3.5" />
          Compare
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <GitCompare className="h-4 w-4 text-teal-600" />
            Compare Jobs
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Select two jobs to see a side-by-side metric diff. Useful for comparing
            particle counts / resolution before and after a refinement step.
          </DialogDescription>
        </DialogHeader>

        {/* Job selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 py-2">
          <div className="space-y-1">
            <label className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Job A
            </label>
            <select
              value={uidA}
              onChange={(e) => setUidA(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12.5px] font-mono text-slate-800 outline-none focus:border-teal-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">— select —</option>
              {sortedNodes.map((n) => (
                <option key={n.uid} value={n.uid}>
                  {n.uid} · {n.job_type}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={swap}
            title="Swap A and B"
            disabled={!uidA || !uidB}
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Button>
          <div className="space-y-1">
            <label className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Job B
            </label>
            <select
              value={uidB}
              onChange={(e) => setUidB(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12.5px] font-mono text-slate-800 outline-none focus:border-teal-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">— select —</option>
              {sortedNodes.map((n) => (
                <option key={n.uid} value={n.uid}>
                  {n.uid} · {n.job_type}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Separator />

        {/* Diff content */}
        {nodeA && nodeB ? (
          <DiffTable nodeA={nodeA} nodeB={nodeB} />
        ) : (
          <div className="flex h-32 items-center justify-center text-[12px] text-slate-400">
            Select two jobs above to compare.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiffTable({ nodeA, nodeB }: { nodeA: LineageNode; nodeB: LineageNode }) {
  const rows: Array<{
    label: string;
    icon: React.ReactNode;
    valueA: number | null | undefined;
    valueB: number | null | undefined;
    format: (n: number) => string;
    unit?: string;
    invertGood?: boolean; // true for resolution (lower is better)
  }> = [
    { label: "Particles", icon: <Activity className="h-3.5 w-3.5" />, valueA: nodeA.particle_count, valueB: nodeB.particle_count, format: (n) => n.toLocaleString(), unit: "" },
    { label: "Micrographs", icon: <Microscope className="h-3.5 w-3.5" />, valueA: nodeA.micrograph_count, valueB: nodeB.micrograph_count, format: (n) => n.toLocaleString(), unit: "" },
    { label: "Volumes", icon: <Box className="h-3.5 w-3.5" />, valueA: nodeA.volume_count, valueB: nodeB.volume_count, format: (n) => n.toLocaleString(), unit: "" },
    { label: "Classes", icon: <Layers className="h-3.5 w-3.5" />, valueA: nodeA.classes?.length, valueB: nodeB.classes?.length, format: (n) => String(n), unit: "" },
    { label: "Resolution", icon: <Zap className="h-3.5 w-3.5" />, valueA: nodeA.resolution_A, valueB: nodeB.resolution_A, format: (n) => n.toFixed(2), unit: "Å", invertGood: true },
    { label: "Pixel Size", icon: <Hash className="h-3.5 w-3.5" />, valueA: nodeA.pixel_size_A, valueB: nodeB.pixel_size_A, format: (n) => n.toFixed(4), unit: "Å/px" },
  ];

  return (
    <div className="space-y-3 py-2">
      {/* Job header cards */}
      <div className="grid grid-cols-2 gap-3">
        <JobHeaderCard node={nodeA} />
        <JobHeaderCard node={nodeB} />
      </div>

      {/* Diff table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Metric</th>
              <th className="px-3 py-2 font-mono font-medium text-teal-700 dark:text-teal-400">{nodeA.uid}</th>
              <th className="px-3 py-2 font-mono font-medium text-emerald-700 dark:text-emerald-400">{nodeB.uid}</th>
              <th className="px-3 py-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {rows.map((row) => {
              const diff = computeDiff(row.valueA, row.valueB);
              const delta = computeDelta(row.valueA, row.valueB, row.invertGood);
              return (
                <tr key={row.label} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="text-teal-500">{row.icon}</span>
                      {row.label}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">
                    {row.valueA != null ? row.format(row.valueA) : "—"}
                    {row.unit && row.valueA != null && <span className="ml-0.5 text-[9px] text-slate-400">{row.unit}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">
                    {row.valueB != null ? row.format(row.valueB) : "—"}
                    {row.unit && row.valueB != null && <span className="ml-0.5 text-[9px] text-slate-400">{row.unit}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <DiffBadge diff={diff} delta={delta} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Job type + title comparison */}
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="text-[9.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Job Type (A)</div>
          <div className="mt-0.5 font-mono text-slate-700 dark:text-slate-200">{nodeA.job_type}</div>
          {nodeA.title && <div className="mt-1 truncate text-slate-500 dark:text-slate-400" title={nodeA.title}>{nodeA.title}</div>}
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="text-[9.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Job Type (B)</div>
          <div className="mt-0.5 font-mono text-slate-700 dark:text-slate-200">{nodeB.job_type}</div>
          {nodeB.title && <div className="mt-1 truncate text-slate-500 dark:text-slate-400" title={nodeB.title}>{nodeB.title}</div>}
        </div>
      </div>

      {/* Extraction params diff */}
      {(nodeA.extraction_params || nodeB.extraction_params) && (
        <div className="rounded-md border border-slate-200 bg-slate-50/40 p-2.5 text-[11px] dark:border-slate-700 dark:bg-slate-900/30">
          <div className="mb-1.5 text-[9.5px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Extraction Params
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="text-slate-600 dark:text-slate-300">
              <div>Box: {nodeA.extraction_params?.box_size_pix ?? "—"}px</div>
              <div>Extracted: {nodeA.extraction_params?.extracted_box_size_pix ?? "—"}px</div>
              <div>Bin: {nodeA.extraction_params?.bin_factor ?? "—"}{nodeA.extraction_params?.bin_inferred ? " (inferred)" : ""}</div>
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              <div>Box: {nodeB.extraction_params?.box_size_pix ?? "—"}px</div>
              <div>Extracted: {nodeB.extraction_params?.extracted_box_size_pix ?? "—"}px</div>
              <div>Bin: {nodeB.extraction_params?.bin_factor ?? "—"}{nodeB.extraction_params?.bin_inferred ? " (inferred)" : ""}</div>
            </div>
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="flex items-center gap-3 text-[10.5px] text-slate-500 dark:text-slate-400">
        <Clock className="h-3 w-3" />
        {nodeA.created_at && <span>A: {formatDate(nodeA.created_at)}</span>}
        {nodeB.created_at && <span>B: {formatDate(nodeB.created_at)}</span>}
      </div>
    </div>
  );
}

function JobHeaderCard({ node }: { node: LineageNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[14px] font-bold text-slate-800 dark:text-slate-100">{node.uid}</span>
        <Badge variant="outline" className="font-mono text-[9px] text-slate-500 dark:text-slate-400">
          {node.job_type}
        </Badge>
      </div>
      {node.title && (
        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" title={node.title}>
          {node.title}
        </div>
      )}
    </div>
  );
}

function computeDiff(a: number | null | undefined, b: number | null | undefined): Diff {
  if (a == null || b == null) return "none";
  if (a === b) return "same";
  return b > a ? "up" : "down";
}

function computeDelta(a: number | null | undefined, b: number | null | undefined, invertGood?: boolean): { value: number; pct: number | null; good: boolean } | null {
  if (a == null || b == null || a === 0) return null;
  const value = b - a;
  const pct = a !== 0 ? Math.round((value / Math.abs(a)) * 1000) / 10 : null;
  // "good" = improvement. For most metrics up is good; for resolution lower is better.
  const good = invertGood ? value < 0 : value > 0;
  return { value, pct, good };
}

function DiffBadge({ diff, delta }: { diff: Diff; delta: { value: number; pct: number | null; good: boolean } | null }) {
  if (diff === "none" || !delta) {
    return <span className="text-[10px] text-slate-400 dark:text-slate-500">—</span>;
  }
  if (diff === "same") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
        <Minus className="h-3 w-3" /> same
      </span>
    );
  }
  const Icon = delta.good ? TrendingUp : TrendingDown;
  const color = delta.good
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  const sign = delta.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10.5px] font-mono font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}{delta.value.toLocaleString()}
      {delta.pct != null && (
        <span className="opacity-70">({sign}{delta.pct}%)</span>
      )}
    </span>
  );
}

function formatDate(dateVal: unknown): string {
  if (!dateVal) return "";
  const s = typeof dateVal === "string"
    ? dateVal
    : typeof dateVal === "number"
    ? String(dateVal)
    : (dateVal as { $date?: string | number })?.$date
    ? String((dateVal as { $date: string | number }).$date)
    : "";
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return "";
  }
}
