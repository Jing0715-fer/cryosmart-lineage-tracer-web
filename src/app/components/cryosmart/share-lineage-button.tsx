"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Share2,
  Copy,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Link as LinkIcon,
} from "lucide-react";
import { buildShareUrl } from "@/lib/cryosmart/share-url";
import type { LineageSummary } from "@/lib/cryosmart/types";

interface Props {
  summary: LineageSummary | null;
}

/**
 * Floating "Share" button (top-right of Lineage Preview). Click → dialog with
 * the shareable URL (compressed lineage summary in URL hash) + copy button +
 * QR code (canvas-rendered) for mobile sharing.
 *
 * The recipient opens the URL → useSharedSummary hook decodes the hash →
 * summary loads automatically without any data source.
 */
export function ShareLineageButton({ summary }: Props) {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const buildUrl = useCallback(async () => {
    if (!summary) return;
    setBuilding(true);
    setError("");
    try {
      const url = await buildShareUrl(summary, window.location.origin, window.location.pathname);
      setShareUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error("Share URL too large — use the JSON download instead.");
    } finally {
      setBuilding(false);
    }
  }, [summary]);

  // Re-build when dialog opens or summary changes.
  useEffect(() => {
    if (open && summary) buildUrl();
  }, [open, summary, buildUrl]);

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Share URL copied to clipboard");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Failed to copy. Select the URL and press Ctrl/Cmd+C.");
    }
  }, [shareUrl]);

  if (!summary) return null;

  const byteLen = shareUrl.length;
  const jobCount = summary.nodes?.length || 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-teal-300 bg-teal-50/50 text-[12px] text-teal-700 hover:bg-teal-100 hover:text-teal-800 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-400 dark:hover:bg-teal-900"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Share2 className="h-4 w-4 text-teal-600" />
            Share this lineage
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Generate a link that contains the full lineage ({jobCount} jobs). Anyone who opens it
            sees the same graph, stats, and report — no data source needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {building && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Compressing {jobCount} jobs…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11.5px] text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {error}
            </div>
          )}

          {shareUrl && !building && (
            <>
              {/* URL display */}
              <div>
                <Label text="Shareable URL" />
                <div className="flex items-stretch gap-1.5">
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-2 font-mono text-[10.5px] text-slate-700 outline-none focus:border-teal-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  />
                  <Button
                    size="sm"
                    onClick={copyUrl}
                    className="h-9 shrink-0 gap-1.5 bg-teal-600 text-[12px] hover:bg-teal-700"
                  >
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10.5px] text-slate-500 dark:text-slate-400">
                  <span>{(byteLen / 1024).toFixed(1)} KB</span>
                  <span>·</span>
                  <span>{jobCount} jobs</span>
                  {byteLen > 32000 && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      large
                    </Badge>
                  )}
                </div>
              </div>

              {/* QR code */}
              <div>
                <Label text="Scan to open on mobile" />
                <div className="flex justify-center rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <QrCodeCanvas text={shareUrl} size={160} />
                </div>
              </div>

              {/* Privacy note */}
              <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2 text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                <strong>Privacy:</strong> The lineage summary (project IDs, job types, particle
                counts) is encoded directly in the URL. Image/map URLs are stripped — recipients
                re-fetch via their own CryoSmart session. Don&apos;t share this link publicly if
                your CryoSmart project IDs are sensitive.
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 text-[12px]"
                  onClick={() => {
                    window.open(shareUrl, "_blank", "noopener");
                  }}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open in new tab
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 text-[12px]"
                  onClick={copyUrl}
                >
                  <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                  Copy link
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {text}
    </div>
  );
}

/**
 * QR code renderer — draws to a canvas via the `qrcode` npm package.
 * Color matches the teal brand.
 */
function QrCodeCanvas({ text, size }: { text: string; size: number }) {
  const [ok, setOk] = useState(false);
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, text, {
      width: size,
      margin: 1,
      color: { dark: "#0f766e", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }, (err: Error | null | undefined) => {
      if (!err) setOk(true);
    });
  }, [text, size]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <canvas ref={ref} width={size} height={size} className={ok ? "" : "opacity-0"} />
      {!ok && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
