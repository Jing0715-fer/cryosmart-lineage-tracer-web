"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  UploadCloud,
  Zap,
  TrendingUp,
  X,
  Info,
} from "lucide-react";
import { parseFscText, buildSampleFscMulti, type FscParseResult, type FscCurve } from "@/lib/cryosmart/fsc-parser";
import { toast } from "sonner";

/**
 * FSC (Fourier Shell Correlation) plot viewer.
 *
 * Two modes:
 *   1. "Try Sample" — renders a synthetic multi-iteration FSC curve set
 *      so users can explore the viewer without real data.
 *   2. "Upload FSC txt" — paste or upload a CryoSmart FSC .txt file;
 *      we parse it client-side and render interactive Recharts.
 *
 * The viewer shows the 0.143 threshold line (gold standard FSC cutoff),
 * the best resolution, and lets users toggle individual iteration curves.
 */
export function FscPlotViewer() {
  const [data, setData] = useState<FscParseResult | null>(null);
  const [rawText, setRawText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [hiddenCurves, setHiddenCurves] = useState<Set<string>>(new Set());

  const loadSample = useCallback(() => {
    const sample = buildSampleFscMulti();
    setData(sample);
    setHiddenCurves(new Set());
    setRawText("");
    setShowPaste(false);
    toast.success(`Loaded sample FSC data: ${sample.curves.length} iterations`);
  }, []);

  const parseUploaded = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      setRawText(text);
      const result = parseFscText(text);
      if (result.curves.length === 0) {
        toast.error("No FSC curves found in the uploaded file.");
        return;
      }
      setData(result);
      setHiddenCurves(new Set());
      setShowPaste(false);
      toast.success(`Parsed ${result.curves.length} FSC curves from ${file.name}`);
    } catch (err) {
      toast.error(`Failed to parse: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const parsePastedText = useCallback(() => {
    if (!rawText.trim()) {
      toast.error("Paste some FSC text first.");
      return;
    }
    const result = parseFscText(rawText);
    if (result.curves.length === 0) {
      toast.error("No FSC curves found in the pasted text.");
      return;
    }
    setData(result);
    setHiddenCurves(new Set());
    setShowPaste(false);
    toast.success(`Parsed ${result.curves.length} FSC curves`);
  }, [rawText]);

  const toggleCurve = useCallback((label: string) => {
    setHiddenCurves((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  // Build merged data array for Recharts (one row per frequency point).
  const chartData = useMemo(() => {
    if (!data || data.curves.length === 0) return [];
    // Find max length across curves.
    const maxLen = Math.max(...data.curves.map((c) => c.points.length));
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number> = {};
      for (const curve of data.curves) {
        if (i < curve.points.length) {
          row[curve.label] = Math.round(curve.points[i].correlation * 10000) / 10000;
          // Use the first curve's frequency as the x-axis value.
          if (curve === data.curves[0]) {
            row.frequency = Math.round(curve.points[i].frequency * 10000) / 10000;
          }
        }
      }
      rows.push(row);
    }
    return rows;
  }, [data]);

  // Color palette for curves (teal/emerald/cyan family to match brand).
  const curveColors = ["#0d9488", "#10b981", "#06b6d4", "#14b8a6", "#22c55e", "#0ea5e9", "#84cc16", "#6366f1"];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 text-[12px] bg-teal-600 hover:bg-teal-700" onClick={loadSample}>
          <Activity className="mr-1.5 h-3.5 w-3.5" /> Try Sample FSC
        </Button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          <UploadCloud className="h-3.5 w-3.5" /> Upload .txt
          <input
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseUploaded(f);
              e.target.value = "";
            }}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[12px]"
          onClick={() => setShowPaste(!showPaste)}
        >
          {showPaste ? "Hide paste box" : "Paste text"}
        </Button>
        {data && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <Badge variant="secondary" className="bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
              {data.curves.length} curves
            </Badge>
            {data.bestResolutionA != null && (
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Zap className="mr-1 h-3 w-3" />
                {data.bestResolutionA} Å
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              threshold {data.threshold}
            </Badge>
          </>
        )}
      </div>

      {/* Paste box */}
      {showPaste && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Paste FSC text here. Supports formats like:\n# Iteration 25\n0.000 1.000\n0.025 0.998\n...\n# Iteration 24\n...`}
            className="h-32 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-[11px] text-slate-700 outline-none focus:border-teal-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
              {rawText.length} chars · {rawText.split(/\r?\n/).length} lines
            </span>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setRawText(""); }}>
                <X className="mr-1 h-3 w-3" /> Clear
              </Button>
              <Button size="sm" className="h-7 text-[11px] bg-teal-600 hover:bg-teal-700" onClick={parsePastedText}>
                Parse
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {data && chartData.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                <XAxis
                  dataKey="frequency"
                  type="number"
                  domain={[0, 1]}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  stroke="currentColor"
                  opacity={0.5}
                  label={{ value: "Spatial Frequency", position: "insideBottom", offset: -10, style: { fontSize: 11, fill: "currentColor" } }}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  stroke="currentColor"
                  opacity={0.5}
                  label={{ value: "FSC", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "currentColor" } }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--background, #fff)",
                    border: "1px solid var(--border, #e2e8f0)",
                    borderRadius: "6px",
                    fontSize: "11px",
                  }}
                  formatter={(value: number) => value.toFixed(4)}
                />
                <ReferenceLine y={data.threshold} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `0.143 (gold std)`, position: "right", style: { fontSize: 10, fill: "#f59e0b" } }} />
                {data.curves.map((curve, i) => (
                  <Line
                    key={curve.label}
                    type="monotone"
                    dataKey={curve.label}
                    stroke={curveColors[i % curveColors.length]}
                    strokeWidth={hiddenCurves.has(curve.label) ? 0 : 2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={true}
                  />
                ))}
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  formatter={(value) => {
                    const curve = data.curves.find((c) => c.label === value);
                    return (
                      <span style={{ opacity: hiddenCurves.has(value) ? 0.4 : 1, cursor: "pointer" }}>
                        {value}
                        {curve?.resolutionA != null && (
                          <span style={{ fontSize: 9, marginLeft: 4, color: "#64748b" }}> ({curve.resolutionA}Å)</span>
                        )}
                      </span>
                    );
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Curve toggles */}
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-700/60">
            {data.curves.map((curve, i) => (
              <button
                key={curve.label}
                onClick={() => toggleCurve(curve.label)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                  hiddenCurves.has(curve.label)
                    ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                    : "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: curveColors[i % curveColors.length] }} />
                {curve.label}
                {curve.resolutionA != null && <span className="opacity-70">{curve.resolutionA}Å</span>}
              </button>
            ))}
          </div>

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[10.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <Info className="mr-1 inline h-3 w-3" />
              {data.warnings.length} line(s) skipped during parsing.
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/40 text-[12px] text-slate-400 dark:border-slate-600 dark:bg-slate-900/40">
          <TrendingUp className="mb-2 h-8 w-8 text-slate-300" />
          <span>No FSC data loaded.</span>
          <span className="mt-1 text-[10.5px]">Click <strong className="text-teal-600">Try Sample FSC</strong> or upload a .txt file.</span>
        </div>
      )}

      {/* Info note */}
      <div className="rounded-md border border-blue-200 bg-blue-50/50 p-2 text-[10.5px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
        <Info className="mr-1 inline h-3 w-3" />
        <strong>FSC (Fourier Shell Correlation)</strong> measures the agreement between two half-maps.
        The <strong>0.143 threshold</strong> (gold standard) gives the resolution in Å where the maps
        are still reliably correlated. Lower resolution Å = better. Toggle curves by clicking the legend chips.
      </div>
    </div>
  );
}
