"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Package, Loader2, Download, AlertTriangle, CheckCircle2, FileArchive, Settings2, FileBox, Boxes, FileCheck2, PresentationIcon } from "lucide-react";
import type { LineageSummary } from "@/lib/cryosmart/types";
import { buildBundle, downloadBlob, type BundleProgress, type BundleResult } from "@/lib/cryosmart/bundle";
import type { LoadedMetadata } from "./data-source-card";

/** localStorage key for the build selections.
 *  Persists the 4 download-bundle checkboxes across page reloads. The
 *  normalized lineage summary is deliberately NOT persisted here anymore:
 *  it was write-only (nothing ever read it back — restoring the summary
 *  would fight the page-level state anyway) and cost a tens-of-KB
 *  re-serialize on every keystroke of the selection state. If the user
 *  wants the trace back after a reload they re-run Smart Capture or
 *  restore from Capture History. */
const LAST_BUILD_KEY = "cryosmart_last_build_v1";

interface PersistedBuild {
  selections: BundleSelections;
  builtAt: number;
}

function readPersistedBuild(): PersistedBuild | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_BUILD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedBuild>;
    if (!parsed || typeof parsed !== "object") return null;
    const selections = parsed.selections && typeof parsed.selections === "object"
      ? {
          includePptx: !!(parsed.selections as BundleSelections).includePptx,
          includeImages: !!(parsed.selections as BundleSelections).includeImages,
          includeMaps: !!(parsed.selections as BundleSelections).includeMaps,
          includeFinalResults: !!(parsed.selections as BundleSelections).includeFinalResults,
        }
      : DEFAULT_SELECTIONS;
    return {
      selections,
      builtAt: typeof parsed.builtAt === "number" ? parsed.builtAt : 0,
    };
  } catch {
    return null;
  }
}

function writePersistedBuild(p: PersistedBuild): void {
  try {
    localStorage.setItem(LAST_BUILD_KEY, JSON.stringify(p));
  } catch {
    // quota exceeded or storage disabled — best-effort
  }
}

/** User-facing toggles for what to include in the next build. */
export interface BundleSelections {
  includePptx: boolean;
  includeImages: boolean;
  includeMaps: boolean;
  includeFinalResults: boolean;
}

const DEFAULT_SELECTIONS: BundleSelections = {
  includePptx: true,
  includeImages: true,
  includeMaps: false,
  includeFinalResults: true,
};

interface Props {
  summary: LineageSummary | null;
  loaded: LoadedMetadata | null;
}

const BUNDLE_FILES = [
  { name: "CryoSmart_*_lineage.json", desc: "Full normalized lineage summary", always: true },
  { name: "CryoSmart_*_lineage_report.html", desc: "Standalone interactive HTML report", always: true },
  { name: "CryoSmart_*_picture_flow.svg", desc: "A4 SVG picture flow", always: true },
  { name: "CryoSmart_*.mmd", desc: "Mermaid graph source", always: true },
  { name: "CryoSmart_*_preview.txt", desc: "Plain text preview", always: true },
  { name: "rebuild_picture_flow_pptx.mjs", desc: "Standalone Node PPTX rebuilder", always: true },
  { name: "CryoSmart_align_maps_check_view.py", desc: "ChimeraX alignment script", always: true },
  { name: "CryoSmart_export_current_view_ppt.py", desc: "ChimeraX export script", always: true },
  { name: "CryoSmart_auto_align_export_ppt.py", desc: "ChimeraX one-shot pipeline", always: true },
  { name: "CryoSmart_*_picture_flow.pptx", desc: "Picture flow PPTX (OOXML)", always: false, option: "includePptx" as const },
  { name: "images/*", desc: "Preview images", always: false, option: "includeImages" as const },
  { name: "maps/*", desc: "Map / MRC files", always: false, option: "includeMaps" as const },
  { name: "Final_Result/*", desc: "Final results package", always: false, option: "includeFinalResults" as const },
  { name: "download_warnings.txt", desc: "Errors log", always: false },
];

export function DownloadCard({ summary, loaded }: Props) {
  // Selections are restored from localStorage so the user's previous
  // choices survive a page reload — but ONLY in an effect AFTER mount.
  // "use client" components are still SSR-rendered: reading localStorage
  // in the useState initializer used to produce a client initial state
  // that differed from the server HTML (persisted selections ≠ defaults),
  // i.e. a React hydration mismatch on every reload for returning users.
  const [selections, setSelections] = useState<BundleSelections>(DEFAULT_SELECTIONS);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<BundleProgress | null>(null);
  const [result, setResult] = useState<BundleResult | null>(null);
  /** Bumped on every fresh "Build & download" click; ties the abort flag
   *  to the currently-running build so a stale catch can't dismiss a
   *  newer run. */
  const buildEpochRef = useRef(0);

  // Restore persisted selections AFTER hydration (see the useState note
  // above), then persist every subsequent change.
  useEffect(() => {
    const persisted = readPersistedBuild();
    if (persisted?.selections) {
      setSelections((prev) =>
        JSON.stringify(prev) === JSON.stringify(persisted.selections)
          ? prev
          : persisted.selections
      );
    }
  }, []);

  useEffect(() => {
    writePersistedBuild({
      selections,
      builtAt: Date.now(),
    });
  }, [selections]);

  // DERIVED, never stored: true when a build left a stale `progress`
  // behind without an active build and without a finished result — i.e.
  // the run crashed (process death, navigation, unhandled rejection) and
  // the ZIP was lost. Previously this lived in a useState written from a
  // useEffect keyed on [building, progress, result]; during a real build
  // the progress callback fires a fresh object per image (hundreds per
  // run), each one re-ran the effect and re-issued setBuildCrashed(false),
  // and the resulting update storm tripped React's nested-update guard
  // ("Maximum update depth exceeded" — the ZIP-download crash). Deriving
  // it instead makes an update loop structurally impossible: no state,
  // no effect, no setState.
  const buildCrashed = !building && progress !== null && result === null;

  const updateSelection = useCallback(<K extends keyof BundleSelections>(
    key: K,
    value: BundleSelections[K]
  ) => {
    setSelections((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleBuild = useCallback(async () => {
    if (!summary) {
      toast.error("Trace lineage first.");
      return;
    }
    const epoch = ++buildEpochRef.current;
    setBuilding(true);
    setResult(null);
    setProgress({ phase: "init", current: 0, total: 1, message: "Starting…" });
    try {
      const res = await buildBundle(
        summary,
        {
          includePptx: selections.includePptx,
          includeImages: selections.includeImages,
          includeMaps: selections.includeMaps,
          includeFinalResults: selections.includeFinalResults,
          session: loaded?.session || null,
        },
        (p) => {
          // Drop progress events from a stale build (defensive — a
          // cancel would normally clear the timer, but a long-running
          // PPTX build that finishes after the user has already
          // dismissed the result card should not overwrite it).
          if (buildEpochRef.current !== epoch) return;
          setProgress(p);
        }
      );
      if (buildEpochRef.current !== epoch) return;
      setResult(res);
      setProgress({ phase: "done", current: 1, total: 1, message: "Done." });
      downloadBlob(res.blob, res.filename);
      toast.success(`Downloaded ${res.filename} (${res.fileCount} files)`);
    } catch (err) {
      if (buildEpochRef.current !== epoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Bundle build failed: ${msg}. The build state is lost — click Build again to retry. Raw data + image bytes are not re-captured automatically; rerun Smart Capture only if the lineage itself is gone.`);
    } finally {
      if (buildEpochRef.current === epoch) {
        setBuilding(false);
      }
    }
  }, [summary, selections, loaded]);

  const enabled = !!summary;
  const phaseLabel = progress?.phase === "report" ? "Generating reports"
    : progress?.phase === "probe" ? "Checking CryoSmart reachability"
    : progress?.phase === "pptx" ? "Building PPTX"
    : progress?.phase === "images" ? "Fetching preview images"
    : progress?.phase === "maps" ? "Fetching maps"
    : progress?.phase === "final" ? "Scanning final results"
    : progress?.phase === "zip" ? "Zipping"
    : progress?.phase === "done" ? "Done"
    : "Idle";
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Card id="download" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">4</span>
          <CardTitle className="text-lg">Download Bundle</CardTitle>
        </div>
        <CardDescription className="mt-1.5 pl-9 text-[13px]">
          Choose what to include, then build a single ZIP containing the JSON, HTML, SVG, Mermaid, preview text, PPTX, and ChimeraX helper scripts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <Settings2 className="h-3 w-3" />
            Bundle contents
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {BUNDLE_FILES.map((f) => {
              const isOptional = !f.always;
              const optKey = (f as { option?: keyof BundleSelections }).option;
              const optOn = optKey ? selections[optKey] : false;
              const dimmed = isOptional && !optOn;
              return (
                <div
                  key={f.name}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px] ${
                    f.always
                      ? "border-slate-200 bg-slate-50"
                      : dimmed
                        ? "border-dashed border-slate-200 bg-white opacity-50"
                        : "border-teal-200 bg-teal-50/40"
                  }`}
                >
                  <FileArchive className={`h-3.5 w-3.5 shrink-0 ${f.always ? "text-slate-500" : "text-teal-500"}`} />
                  <span className="font-mono text-slate-700">{f.name}</span>
                  <span className="ml-auto truncate text-[10.5px] text-slate-500">{f.desc}</span>
                  {f.always ? (
                    <Badge variant="outline" className="ml-1 shrink-0 border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[9px] text-emerald-700">always</Badge>
                  ) : (
                    <Badge variant="outline" className={`ml-1 shrink-0 px-1.5 py-0 text-[9px] ${optOn ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-300 bg-slate-100 text-slate-500"}`}>
                      {optOn ? "included" : "optional"}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SelectionCheckbox
              checked={selections.includePptx}
              onChecked={(v) => updateSelection("includePptx", v)}
              icon={<PresentationIcon className="h-3.5 w-3.5" />}
              title="Picture Flow PPTX"
              desc="Single A4 slide with embedded preview images (hand-rolled OOXML, no pptxgenjs). Capped at 50 embedded images to keep the build bounded."
              tag="recommended"
            />
            <SelectionCheckbox
              checked={selections.includeImages}
              onChecked={(v) => updateSelection("includeImages", v)}
              icon={<FileBox className="h-3.5 w-3.5" />}
              title="Preview images"
              desc="Micrograph / select-2D / class / map preview PNGs (requires Smart Capture session)"
              tag={loaded?.session ? "session" : "no session"}
            />
            <SelectionCheckbox
              checked={selections.includeMaps}
              onChecked={(v) => updateSelection("includeMaps", v)}
              icon={<Boxes className="h-3.5 w-3.5" />}
              title="Map / MRC files"
              desc="Normal volume.map for every traced job (requires Smart Capture session)"
              tag={loaded?.session ? "session" : "no session"}
            />
            <SelectionCheckbox
              checked={selections.includeFinalResults}
              onChecked={(v) => updateSelection("includeFinalResults", v)}
              icon={<FileCheck2 className="h-3.5 w-3.5" />}
              title="Final results package"
              desc="FSC / Guinier / Direction plots + final maps from the start job (requires Smart Capture session)"
              tag={loaded?.session ? "session" : "no session"}
            />
          </div>
        </div>

        {buildCrashed && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-800">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Previous build did not finish
            </div>
            <p className="mt-1 leading-snug">
              The ZIP assembly is in-memory and cannot be resumed across reloads. Your trace is preserved — just click <strong>Build &amp; download ZIP</strong> to start a fresh build. The lineage data is intact; only the partial ZIP output was lost.
            </p>
          </div>
        )}

        {building && progress && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 font-medium text-teal-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phaseLabel}
              </span>
              <span className="font-mono text-[11px] text-teal-700">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5 bg-teal-100" />
            <div className="mt-1.5 truncate font-mono text-[10.5px] text-teal-700">{progress.message}</div>
          </div>
        )}

        {result && !building && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-[12px]">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-slate-800">Bundle ready</span>
              <span className="font-mono text-slate-600">{result.filename}</span>
              <span className="ml-auto text-[11px] text-slate-500">{result.fileCount} files</span>
            </div>
            {result.warnings.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  {result.warnings.length} warning(s)
                </div>
                <ScrollArea className="mt-1 max-h-24">
                  <pre className="whitespace-pre-wrap font-mono text-[10px] text-amber-700">{result.warnings.join("\n")}</pre>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleBuild}
            disabled={!enabled || building}
            className="h-9 bg-teal-600 text-[13px] hover:bg-teal-700"
          >
            {building ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />}
            {building ? "Building…" : "Build & download ZIP"}
          </Button>
          {result && !building && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[13px]"
              onClick={() => downloadBlob(result.blob, result.filename)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Re-download
            </Button>
          )}
          {!enabled && (
            <span className="text-[11px] text-slate-400">
              Trace lineage above to enable
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SelectionCheckbox({
  checked,
  onChecked,
  icon,
  title,
  desc,
  tag,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  tag?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
        checked ? "border-teal-300 bg-teal-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onChecked(v === true)} className="mt-0.5" />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">{icon}</span>
          <span className="text-[12.5px] font-medium text-slate-800">{title}</span>
          {tag && (
            <Badge
              variant="outline"
              className={`ml-auto px-1.5 py-0 text-[9.5px] font-medium uppercase ${
                tag === "recommended" ? "border-teal-300 bg-teal-50 text-teal-700" :
                "border-slate-300 bg-slate-50 text-slate-500"
              }`}
            >
              {tag}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{desc}</p>
      </div>
    </label>
  );
}
