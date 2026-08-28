"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  History, RotateCcw, Download, Trash2, Upload, Save, Loader2,
  Info, FileJson, HardDriveDownload, RefreshCw,
} from "lucide-react";
import type { LoadedMetadata } from "./data-source-card";
import { toLoadedFromHistory, type PendingData } from "./use-imported-metadata";

/** Light entry summary from GET /api/cryosmart/history. */
interface HistoryEntrySummary {
  id: string;
  label: string;
  origin: "session" | "import";
  project_uid: string | null;
  captured_at: string | null;
  created_at: number;
  end_job_uid: string | null;
  lineage_mode: boolean;
  cryosmart_origin: string | null;
  counts: {
    jobs: number;
    log_images: number;
    images: number;
    maps: number;
  };
  bytes: number;
}

interface Props {
  /** Live staged-capture token — enables the "Save current capture" button. */
  importToken?: string | null;
  /** Called with the fully-merged dataset after a successful restore. */
  onRestore: (
    loaded: LoadedMetadata,
    anchorUid: string | null,
    entry: HistoryEntrySummary
  ) => void;
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string | null, fallback: number): string {
  const d = iso ? new Date(iso) : null;
  const t = d && !Number.isNaN(d.getTime()) ? d.getTime() : fallback;
  const dt = new Date(t);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function CaptureHistoryCard({ importToken, onRestore }: Props) {
  const [entries, setEntries] = useState<HistoryEntrySummary[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/cryosmart/history", { cache: "no-store" });
      const json = (await resp.json()) as { ok: boolean; entries?: HistoryEntrySummary[]; error?: string };
      if (json.ok && Array.isArray(json.entries)) {
        setEntries(json.entries);
      } else {
        setEntries([]);
      }
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clear any pending delete-confirmation timer on unmount.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  /** Save the LIVE staged-capture session to the history (manual snapshot). */
  const handleSave = useCallback(async () => {
    if (!importToken) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/cryosmart/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: importToken }),
      });
      const json = (await resp.json()) as {
        ok: boolean;
        entry?: HistoryEntrySummary;
        error?: string;
      };
      if (json.ok && json.entry) {
        toast.success(
          `Saved to capture history — ${json.entry.counts.jobs} jobs, ${json.entry.counts.images} images (${formatBytes(json.entry.bytes)})`
        );
        await refresh();
      } else {
        toast.error(json.error || "Failed to save the capture.");
      }
    } catch (err) {
      toast.error(`Failed to save the capture: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [importToken, refresh]);

  /** Restore a history entry into the live pipeline (graph/report/bundle). */
  const handleRestore = useCallback(
    async (id: string) => {
      setRestoringId(id);
      try {
        const resp = await fetch(`/api/cryosmart/history/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const json = (await resp.json()) as {
          ok: boolean;
          error?: string;
          entry?: {
            id: string;
            end_job_uid: string | null;
            lineage_mode: boolean;
            counts: HistoryEntrySummary["counts"];
          };
        } & PendingData;
        if (!json.ok || !json.entry) {
          toast.error(json.error || "Capture not found in history.");
          return;
        }
        const loaded = toLoadedFromHistory(json, id);
        onRestore(loaded, json.entry.end_job_uid ?? null, {
          id,
          label: "",
          origin: "session",
          project_uid: loaded.projectUid,
          captured_at: json.captured_at,
          created_at: Date.now(),
          end_job_uid: json.entry.end_job_uid ?? null,
          lineage_mode: json.entry.lineage_mode,
          cryosmart_origin: loaded.session?.baseUrl ?? null,
          counts: json.entry.counts,
          bytes: 0,
        });
        toast.success(
          `Restored capture — ${loaded.jobCount} jobs, ${json.entry.counts.log_images} log images, ${json.entry.counts.images} image files. Tracing lineage…`
        );
        // Auto-trace fires in ConfigureCard; give it a beat then show the result.
        setTimeout(() => {
          document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 900);
      } catch (err) {
        toast.error(`Restore failed: ${(err as Error).message}`);
      } finally {
        setRestoringId(null);
      }
    },
    [onRestore]
  );

  /** Delete with a two-click confirmation (no modal needed). */
  const handleDelete = useCallback(
    async (id: string) => {
      if (confirmDeleteId !== id) {
        setConfirmDeleteId(id);
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3500);
        return;
      }
      setConfirmDeleteId(null);
      try {
        const resp = await fetch(`/api/cryosmart/history/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const json = (await resp.json()) as {
          ok: boolean;
          entries?: HistoryEntrySummary[];
          error?: string;
        };
        if (json.ok) {
          setEntries(json.entries ?? []);
          toast.success("Capture deleted from history.");
        } else {
          toast.error(json.error || "Delete failed.");
        }
      } catch (err) {
        toast.error(`Delete failed: ${(err as Error).message}`);
      }
    },
    [confirmDeleteId]
  );

  /** Import a portable capture JSON (or legacy { jobs: [...] } metadata). */
  const handleImportFile = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const text = await file.text();
        const resp = await fetch("/api/cryosmart/history/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        });
        const json = (await resp.json()) as {
          ok: boolean;
          entry?: HistoryEntrySummary;
          embedded_images?: number;
          error?: string;
        };
        if (json.ok && json.entry) {
          toast.success(
            `Imported ${json.entry.label} — ${json.entry.counts.jobs} jobs` +
              (json.embedded_images
                ? `, ${json.embedded_images} embedded images restored.`
                : " (links only — no embedded image bytes in this file).")
          );
          await refresh();
        } else {
          toast.error(json.error || "Import failed — unrecognized file.");
        }
      } catch (err) {
        toast.error(`Import failed: ${(err as Error).message}`);
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refresh]
  );

  return (
    <Card id="capture-history" className="scroll-mt-28">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-700 text-[13px] font-bold text-white">
                <History className="h-4 w-4" />
              </span>
              <CardTitle className="text-lg">Capture History</CardTitle>
            </div>
            <CardDescription className="mt-1.5 pl-9 text-[13px]">
              Completed captures are saved automatically — restore one instead of
              re-running the capture script, or export it as a portable JSON and
              import it on another instance.
            </CardDescription>
          </div>
          {entries && entries.length > 0 && (
            <Badge variant="secondary" className="shrink-0 gap-1.5 bg-slate-100 text-slate-700 hover:bg-slate-100">
              <HardDriveDownload className="h-3.5 w-3.5" />
              {entries.length} saved
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Actions row ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {importToken && (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              className="h-8 bg-teal-600 text-[12.5px] hover:bg-teal-700"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save current capture
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12.5px]"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Import capture JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12.5px] text-slate-500"
            onClick={refresh}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* ── Entries list ────────────────────────────────────────── */}
        {entries === null ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center text-[12.5px] text-slate-500">
            No saved captures yet. Run a Smart Capture — every completed capture
            is archived here automatically, so the next session restart or expiry
            never costs you a re-capture.
          </div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300"
              >
                <div className="min-w-0 flex-1 basis-52">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-800">{e.label}</span>
                    <Badge
                      variant="outline"
                      className={`shrink-0 px-1.5 py-0 text-[9.5px] uppercase ${
                        e.origin === "import"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {e.origin === "import" ? "imported" : "auto-saved"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-mono">{formatWhen(e.captured_at, e.created_at)}</span>
                    <span>{e.counts.jobs} jobs</span>
                    <span>{e.counts.log_images} log images</span>
                    <span>{e.counts.images} image files</span>
                    {e.counts.maps > 0 && <span>{e.counts.maps} maps</span>}
                    {e.bytes > 0 && <span>{formatBytes(e.bytes)}</span>
                    }
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-8 bg-teal-600 text-[12.5px] hover:bg-teal-700"
                    disabled={restoringId === e.id}
                    onClick={() => handleRestore(e.id)}
                  >
                    {restoringId === e.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Restore
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-[12.5px]">
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuLabel className="text-[11px] text-slate-500">
                        Portable JSON metadata
                      </DropdownMenuLabel>
                      <DropdownMenuItem asChild>
                        <a
                          href={`/api/cryosmart/history/${encodeURIComponent(e.id)}/export`}
                          download
                          className="cursor-pointer"
                        >
                          <FileJson className="mr-2 h-3.5 w-3.5 text-slate-500" />
                          <div className="flex-1">
                            <div className="text-[12.5px]">Links only</div>
                            <div className="text-[10.5px] text-slate-500">
                              Small — absolute URLs for every image + map
                            </div>
                          </div>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href={`/api/cryosmart/history/${encodeURIComponent(e.id)}/export?embed=1`}
                          download
                          className="cursor-pointer"
                        >
                          <HardDriveDownload className="mr-2 h-3.5 w-3.5 text-slate-500" />
                          <div className="flex-1">
                            <div className="text-[12.5px]">With embedded images</div>
                            <div className="text-[10.5px] text-slate-500">
                              Self-contained ({e.bytes > 0 ? `~${formatBytes(e.bytes)}` : "size of the images"}) — no network needed
                            </div>
                          </div>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a
                          href={`/api/cryosmart/history/${encodeURIComponent(e.id)}/export?embed=1&credentials=1`}
                          download
                          className="cursor-pointer"
                        >
                          <FileJson className="mr-2 h-3.5 w-3.5 text-amber-600" />
                          <div className="flex-1">
                            <div className="text-[12.5px]">Embedded + credentials</div>
                            <div className="text-[10.5px] text-slate-500">
                              Also carries the captured CryoSmart login — handle with care
                            </div>
                          </div>
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 text-[12.5px] ${
                      confirmDeleteId === e.id
                        ? "text-red-600 hover:bg-red-50 hover:text-red-700"
                        : "text-slate-400 hover:text-red-600"
                    }`}
                    onClick={() => handleDelete(e.id)}
                    title={confirmDeleteId === e.id ? "Click again to confirm" : "Delete this capture"}
                  >
                    {confirmDeleteId === e.id ? (
                      "Confirm?"
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── How the export / migration works ────────────────────── */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px] leading-relaxed text-slate-600">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-700">
            <Info className="h-3.5 w-3.5 text-teal-600" />
            Migrating captures between projects / instances
          </div>
          <p>
            <strong>Export</strong> produces a <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10.5px]">cryosmart-capture/v1</code> JSON:
            full job metadata, log-image refs, and an <em>absolute</em> CryoSmart URL for every image and map.
            <strong> Import</strong> it above on any instance of this app to restore the graph + report there.
          </p>
          <p className="mt-1.5">
            <strong>Can the JSON alone re-download everything?</strong> Images and maps: <strong>yes</strong> — on any
            machine with network access to your CryoSmart server (intranet), using the URLs inside the file
            (include credentials in the export when the server requires login). With the <em>embedded</em> variant the
            images are fully self-contained — no network at all. Maps are large binaries and are never embedded;
            they always download from the CryoSmart server via their URLs.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
