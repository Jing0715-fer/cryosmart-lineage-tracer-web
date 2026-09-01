"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Microscope,
  Circle,
  Box,
  Layers,
  Clock,
  ArrowRight,
  GitBranch,
  Activity,
  Hash,
  X,
  Filter,
  Zap,
} from "lucide-react";
import type { LineageSummary, LineageNode, LineageEdge } from "@/lib/cryosmart/types";
import { JobCompareButton } from "./job-compare-button";

interface Props {
  summary: LineageSummary | null;
}

type JobKind = "exposure" | "particle" | "volume" | "other";

function nodeKind(node: LineageNode): JobKind {
  if (node.volume_count != null || /refine|abinit|volume|class_3D/i.test(node.job_type || "")) return "volume";
  if (node.particle_count != null || /particle|picker|topaz/i.test(node.job_type || "")) return "particle";
  if (node.micrograph_count != null || /micrograph|ctf|exposure/i.test(node.job_type || "")) return "exposure";
  return "other";
}

const KIND_CONFIG: Record<JobKind, { color: string; bg: string; border: string; icon: React.ReactNode; label: string }> = {
  exposure: { color: "text-cyan-700", bg: "bg-cyan-50", border: "border-cyan-200", icon: <Microscope className="h-3.5 w-3.5" />, label: "Micrograph" },
  particle: { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", icon: <Circle className="h-3.5 w-3.5" />, label: "Particle" },
  volume: { color: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200", icon: <Box className="h-3.5 w-3.5" />, label: "Map" },
  other: { color: "text-slate-700", bg: "bg-slate-50", border: "border-slate-200", icon: <Layers className="h-3.5 w-3.5" />, label: "Other" },
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function formatRelativeTime(dateVal: unknown): string {
  if (!dateVal) return "";
  const dateStr = typeof dateVal === "string"
    ? dateVal
    : typeof dateVal === "number"
    ? String(dateVal)
    : (dateVal as { $date?: string | number })?.$date
    ? String((dateVal as { $date: string | number }).$date)
    : "";
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = diff / (1000 * 60 * 60);
    if (hours < 1) return "just now";
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    const days = hours / 24;
    if (days < 30) return `${Math.floor(days)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

export function JobExplorerCard({ summary }: Props) {
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<JobKind | "all">("all");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const nodes = summary?.nodes || [];
  const edges = summary?.edges || [];

  // Build edge maps for quick lookup.
  const incomingByTarget = useMemo(() => {
    const m = new Map<string, LineageEdge[]>();
    for (const e of edges) {
      const arr = m.get(e.target) || [];
      arr.push(e);
      m.set(e.target, arr);
    }
    return m;
  }, [edges]);

  const outgoingBySource = useMemo(() => {
    const m = new Map<string, LineageEdge[]>();
    for (const e of edges) {
      const arr = m.get(e.source) || [];
      arr.push(e);
      m.set(e.source, arr);
    }
    return m;
  }, [edges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LineageNode>();
    for (const n of nodes) m.set(n.uid, n);
    return m;
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (filterKind !== "all") {
      result = result.filter((n) => nodeKind(n) === filterKind);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (n) =>
          n.uid?.toLowerCase().includes(q) ||
          n.job_type?.toLowerCase().includes(q) ||
          n.title?.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => (a.uid_num ?? 0) - (b.uid_num ?? 0));
  }, [nodes, filterKind, search]);

  const selectedNode = selectedUid ? nodeMap.get(selectedUid) : null;
  const selectedIncoming = selectedUid ? incomingByTarget.get(selectedUid) || [] : [];
  const selectedOutgoing = selectedUid ? outgoingBySource.get(selectedUid) || [] : [];

  if (!summary) {
    return (
      <Card id="job-explorer" className="scroll-mt-28 opacity-60">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-300 text-[13px] font-bold text-white">
              <GitBranch className="h-4 w-4" />
            </span>
            <CardTitle className="text-lg">Job Explorer</CardTitle>
          </div>
          <CardDescription className="mt-1.5 pl-9 text-[13px]">
            Interactive browser of all traced jobs — search, filter, and inspect each job&apos;s metadata, sources, and outputs in a detail drawer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-32 items-center justify-center text-[12px] text-slate-400">
          <div className="flex flex-col items-center gap-2">
            <GitBranch className="h-6 w-6 text-slate-300" />
            <span>Trace lineage above to explore jobs here.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const kindCounts = {
    exposure: nodes.filter((n) => nodeKind(n) === "exposure").length,
    particle: nodes.filter((n) => nodeKind(n) === "particle").length,
    volume: nodes.filter((n) => nodeKind(n) === "volume").length,
    other: nodes.filter((n) => nodeKind(n) === "other").length,
  };

  return (
    <Card id="job-explorer" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">
            <GitBranch className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">Job Explorer</CardTitle>
          <Badge variant="secondary" className="ml-1 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {nodes.length} jobs
          </Badge>
          <div className="ml-auto">
            <JobCompareButton summary={summary} />
          </div>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Search, filter, and inspect each traced job in an interactive drawer. Click any card to see full metadata, upstream sources, and downstream outputs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search + filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by UID, job type, or title…"
              className="h-8 pl-8 text-[12.5px]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <FilterChip active={filterKind === "all"} onClick={() => setFilterKind("all")} label="All" count={nodes.length} />
            {(["exposure", "particle", "volume"] as JobKind[]).map((k) => (
              <FilterChip
                key={k}
                active={filterKind === k}
                onClick={() => setFilterKind(k)}
                label={KIND_CONFIG[k].label}
                count={kindCounts[k]}
                icon={KIND_CONFIG[k].icon}
              />
            ))}
          </div>
        </div>

        {/* Job grid */}
        {filteredNodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center text-[12px] text-slate-400">
            No jobs match your search. Try clearing the filter or search term.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredNodes.slice(0, 60).map((node) => {
              const kind = nodeKind(node);
              const cfg = KIND_CONFIG[kind];
              const isStart = node.uid === summary.start_uid;
              const incoming = incomingByTarget.get(node.uid) || [];
              const outgoing = outgoingBySource.get(node.uid) || [];
              return (
                <button
                  key={node.uid}
                  onClick={() => setSelectedUid(node.uid)}
                  className={`group relative overflow-hidden rounded-lg border bg-white p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    isStart ? "border-teal-400 ring-1 ring-teal-200" : cfg.border
                  }`}
                >
                  {/* Left color bar */}
                  <div className={`absolute left-0 top-0 h-full w-1 ${cfg.bg.replace("/50", "")}`} />

                  <div className="pl-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12.5px] font-bold text-slate-800">{node.uid}</span>
                      <span className={`flex items-center gap-1 text-[9.5px] font-medium ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] font-mono text-slate-500">{node.job_type}</div>
                    {node.title && (
                      <div className="mt-1 truncate text-[10.5px] text-slate-400" title={node.title}>{node.title}</div>
                    )}

                    {/* Metrics */}
                    <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9.5px] text-slate-500">
                      {node.particle_count != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Activity className="h-2.5 w-2.5" />
                          {formatNumber(node.particle_count)}
                        </span>
                      )}
                      {node.micrograph_count != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Microscope className="h-2.5 w-2.5" />
                          {formatNumber(node.micrograph_count)}
                        </span>
                      )}
                      {node.resolution_A != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5" />
                          {node.resolution_A}Å
                        </span>
                      )}
                      {node.pixel_size_A != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Hash className="h-2.5 w-2.5" />
                          {node.pixel_size_A}Å
                        </span>
                      )}
                    </div>

                    {/* Connection counts */}
                    <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-400">
                      <span className="inline-flex items-center gap-0.5">
                        <ArrowRight className="h-2.5 w-2.5 rotate-180" />
                        {incoming.length} in
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        {outgoing.length} out
                        <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                      {isStart && (
                        <span className="ml-auto rounded bg-teal-100 px-1 py-0 text-[8px] font-bold text-teal-700">
                          START
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredNodes.length > 60 && (
              <div className="col-span-full rounded-lg border border-dashed border-slate-200 bg-slate-50 p-2 text-center text-[11px] text-slate-400">
                Showing first 60 of {filteredNodes.length} jobs. Use search to narrow down.
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Detail Drawer */}
      <Sheet open={!!selectedUid} onOpenChange={(open) => { if (!open) setSelectedUid(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {selectedNode && (
            <>
              <SheetHeader className="space-y-0">
                <div className="flex items-center gap-2">
                  {(() => {
                    const kind = nodeKind(selectedNode);
                    const cfg = KIND_CONFIG[kind];
                    return (
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${cfg.bg} ${cfg.color}`}>
                        {cfg.icon}
                      </span>
                    );
                  })()}
                  <div>
                    <SheetTitle className="text-[16px] font-bold text-slate-900">
                      {selectedNode.uid}
                      {selectedNode.uid === summary.start_uid && (
                        <span className="ml-2 rounded bg-teal-100 px-1.5 py-0 text-[9px] font-bold text-teal-700">
                          START JOB
                        </span>
                      )}
                    </SheetTitle>
                    <SheetDescription className="font-mono text-[11px]">{selectedNode.job_type}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-4 space-y-4 px-4 pb-8">
                {/* Title */}
                {selectedNode.title && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Title</div>
                    <div className="mt-0.5 text-[13px] text-slate-700">{selectedNode.title}</div>
                  </div>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-2">
                  <MetricBox label="Particles" value={formatNumber(selectedNode.particle_count)} icon={<Activity className="h-3 w-3" />} />
                  <MetricBox label="Micrographs" value={formatNumber(selectedNode.micrograph_count)} icon={<Microscope className="h-3 w-3" />} />
                  <MetricBox label="Volumes" value={formatNumber(selectedNode.volume_count)} icon={<Box className="h-3 w-3" />} />
                  <MetricBox label="Resolution" value={selectedNode.resolution_A ? `${selectedNode.resolution_A} Å` : "—"} icon={<Zap className="h-3 w-3" />} />
                  <MetricBox label="Pixel Size" value={selectedNode.pixel_size_A ? `${selectedNode.pixel_size_A} Å` : "—"} icon={<Hash className="h-3 w-3" />} />
                  <MetricBox label="Classes" value={selectedNode.classes?.length ? String(selectedNode.classes.length) : "—"} icon={<Layers className="h-3 w-3" />} />
                </div>

                {/* Timestamps */}
                {selectedNode.created_at && (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3" />
                    Created {formatRelativeTime(selectedNode.created_at)}
                    {selectedNode.completed_at && (
                      <span className="text-slate-400">· completed {formatRelativeTime(selectedNode.completed_at)}</span>
                    )}
                  </div>
                )}

                <Separator />

                {/* Upstream sources */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <ArrowRight className="h-3 w-3 rotate-180" />
                    Upstream Sources ({selectedIncoming.length})
                  </div>
                  {selectedIncoming.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-400">
                      No upstream sources — this is a root/leaf job.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedIncoming.map((edge, i) => {
                        const srcNode = nodeMap.get(edge.source);
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedUid(edge.source)}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-left transition-colors hover:bg-slate-50"
                          >
                            <span className="font-mono text-[12px] font-bold text-teal-700">{edge.source}</span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span className="truncate text-[10.5px] text-slate-500">{srcNode?.job_type || edge.input_type}</span>
                            <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[9px]">
                              {edge.kind || edge.input_type || "parent"}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Downstream outputs */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <ArrowRight className="h-3 w-3" />
                    Downstream Outputs ({selectedOutgoing.length})
                  </div>
                  {selectedOutgoing.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-400">
                      No downstream consumers — this is a terminal job.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedOutgoing.map((edge, i) => {
                        const tgtNode = nodeMap.get(edge.target);
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedUid(edge.target)}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-left transition-colors hover:bg-slate-50"
                          >
                            <span className="font-mono text-[12px] font-bold text-teal-700">{edge.target}</span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span className="truncate text-[10.5px] text-slate-500">{tgtNode?.job_type || edge.input_type}</span>
                            <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[9px]">
                              {edge.kind || edge.input_type || "parent"}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Class splits (if any) */}
                {selectedNode.classes && selectedNode.classes.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        <Layers className="h-3 w-3" />
                        Class Splits ({selectedNode.classes.length})
                      </div>
                      <div className="overflow-hidden rounded-md border border-slate-200">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-2 py-1.5">Class</th>
                              <th className="px-2 py-1.5">Particles</th>
                              <th className="px-2 py-1.5">%</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedNode.classes.map((cls, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-2 py-1.5 font-mono text-slate-700">{cls.class_index}</td>
                                <td className="px-2 py-1.5 font-mono text-slate-600">{formatNumber(cls.particle_count)}</td>
                                <td className="px-2 py-1.5 font-mono text-slate-600">
                                  {cls.particle_percent != null ? `${cls.particle_percent.toFixed(1)}%` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

                {/* Parents/children arrays */}
                {(selectedNode.parents?.length || selectedNode.children?.length) ? (
                  <>
                    <Separator />
                    <div className="grid grid-cols-2 gap-3">
                      {selectedNode.parents && selectedNode.parents.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Parents</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedNode.parents.map((p) => (
                              <button
                                key={p}
                                onClick={() => setSelectedUid(p)}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200"
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedNode.children && selectedNode.children.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Children</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedNode.children.map((c) => (
                              <button
                                key={c}
                                onClick={() => setSelectedUid(c)}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200"
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-teal-600 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {icon}
      {label}
      <span className={`rounded-full px-1 text-[9px] ${active ? "bg-white/20" : "bg-white/70 text-slate-500"}`}>{count}</span>
    </button>
  );
}

function MetricBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide text-slate-400">
        <span className="text-teal-500">{icon}</span>
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] font-semibold text-slate-800">{value}</div>
    </div>
  );
}
