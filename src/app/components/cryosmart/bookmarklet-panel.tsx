"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bookmark,
  MousePointerClick,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Info,
  Terminal,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  buildBookmarkletUrl,
  buildConsoleSnippet,
  detectMixedContentIssue,
} from "@/lib/cryosmart/bookmarklet";
import type { LoadedMetadata } from "./data-source-card";

interface Props {
  loaded: LoadedMetadata | null;
  onLoad: (loaded: LoadedMetadata) => void;
}

export function BookmarkletPanel({ loaded, onLoad }: Props) {
  const [appOrigin, setAppOrigin] = useState("");
  useEffect(() => {
    setAppOrigin(window.location.origin);
  }, []);

  const [cryosmartUrl, setCryosmartUrl] = useState("http://192.168.4.3:8080");
  const [copied, setCopied] = useState<"snippet" | "bookmarklet" | null>(null);
  const [mixedWarning, setMixedWarning] = useState(false);
  const [showBookmarklet, setShowBookmarklet] = useState(false);

  const consoleSnippet = useMemo(() => {
    if (!appOrigin) return "";
    return buildConsoleSnippet(appOrigin);
  }, [appOrigin]);

  const bookmarkletUrl = useMemo(() => {
    if (!appOrigin) return "";
    return buildBookmarkletUrl(appOrigin);
  }, [appOrigin]);

  const cryosmartOrigin = useMemo(() => {
    try {
      return new URL(cryosmartUrl).origin;
    } catch {
      return "";
    }
  }, [cryosmartUrl]);

  useEffect(() => {
    setMixedWarning(detectMixedContentIssue(appOrigin, cryosmartOrigin));
  }, [appOrigin, cryosmartOrigin]);

  const copySnippet = useCallback(async () => {
    if (!consoleSnippet) return;
    try {
      await navigator.clipboard.writeText(consoleSnippet);
      setCopied("snippet");
      toast.success("Console snippet copied — paste it into CryoSmart's DevTools Console");
      setTimeout(() => setCopied(null), 3000);
    } catch {
      toast.error("Failed to copy. Select the code block and press Ctrl/Cmd+C.");
    }
  }, [consoleSnippet]);

  const copyBookmarklet = useCallback(async () => {
    if (!bookmarkletUrl) return;
    try {
      await navigator.clipboard.writeText(bookmarkletUrl);
      setCopied("bookmarklet");
      toast.success("Bookmarklet code copied");
      setTimeout(() => setCopied(null), 2500);
    } catch {
      toast.error("Failed to copy.");
    }
  }, [bookmarkletUrl]);

  return (
    <div className="space-y-3">
      {/* How it works banner */}
      <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3">
        <div className="flex items-start gap-2.5">
          <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
          <div className="text-[12px] leading-relaxed text-teal-900">
            <span className="font-semibold">Console Snippet — the reliable method.</span>{" "}
            Paste a small script into CryoSmart&apos;s DevTools Console. It runs in the exact
            page context (never <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px]">about:blank</code>),
            fetches the project&apos;s job metadata with your cookie auto-attached, and sends it here.
          </div>
        </div>
      </div>

      {/* Mixed-content warning */}
      {mixedWarning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">Heads up:</span> This web app is on{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[10.5px]">{appOrigin.split(":")[0]}</code>
            {" "}but your CryoSmart URL is{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[10.5px]">{cryosmartOrigin.split(":")[0]}</code>
            . Browsers may block cross-protocol fetches (mixed content). If the snippet can&apos;t
            reach the web app after capturing, either host this web app on HTTPS or use Upload JSON instead.
          </div>
        </div>
      )}

      {/* PRIMARY: Console Snippet */}
      <div className="rounded-lg border-2 border-teal-300 bg-teal-50/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-[11.5px] uppercase tracking-wide text-teal-700">
            <Terminal className="mr-1 inline h-3.5 w-3.5" />
            Console Snippet (recommended)
          </Label>
          <Badge className="bg-teal-100 text-[9px] text-teal-700 hover:bg-teal-100">most reliable</Badge>
        </div>

        {/* Step-by-step */}
        <ol className="mb-3 space-y-1">
          {[
            <>Open your CryoSmart project page (URL like <code className="rounded bg-teal-100 px-1 font-mono text-[10.5px]">http://192.168.202.11:8080/#/projects/P259</code>).</>,
            <>Press <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">F12</kbd> to open DevTools, go to the <strong>Console</strong> tab.</>,
            <>Click the <strong>Copy</strong> button below, then paste into the Console (Ctrl/Cmd+V) and press Enter.</>,
            <>Watch the Console log — it will show progress, then open this web app in a new tab with all jobs loaded.</>,
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700 dark:text-slate-300">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-700">
                {i + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>

        {/* The snippet code block */}
        <div className="relative">
          <pre className="max-h-44 overflow-y-auto rounded-md border border-slate-300 bg-slate-950 p-2.5 font-mono text-[10.5px] leading-relaxed text-emerald-200">
            {consoleSnippet || "Loading snippet…"}
          </pre>
          <Button
            onClick={copySnippet}
            disabled={!consoleSnippet}
            className="absolute right-2 top-2 h-7 gap-1 bg-teal-600 text-[11px] hover:bg-teal-700"
          >
            {copied === "snippet" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "snippet" ? "Copied!" : "Copy"}
          </Button>
        </div>

        <p className="mt-2 text-[10.5px] text-slate-500 dark:text-slate-400">
          The snippet is a self-contained JavaScript IIFE — it reads <code className="font-mono">location.href</code>,
          fetches your CryoSmart jobs (same-origin, cookies included), and POSTs them to this web app.
          No bookmark installation, no <code className="font-mono">about:blank</code> issues.
        </p>
      </div>

      <Separator />

      {/* CryoSmart URL field */}
      <div className="space-y-1.5">
        <Label htmlFor="cryosmart-url-bm" className="text-[12px] text-slate-600 dark:text-slate-300">
          Your CryoSmart URL <span className="text-slate-400">(for reference)</span>
        </Label>
        <Input
          id="cryosmart-url-bm"
          value={cryosmartUrl}
          onChange={(e) => setCryosmartUrl(e.target.value)}
          placeholder="http://192.168.4.3:8080"
          className="h-9 font-mono text-[13px]"
        />
      </div>

      <Separator />

      {/* SECONDARY: Bookmarklet (collapsible) */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-900/40">
        <button
          onClick={() => setShowBookmarklet(!showBookmarklet)}
          className="flex w-full items-center justify-between p-3 text-left"
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300">
            {showBookmarklet ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Bookmark className="h-3.5 w-3.5" />
            Bookmarklet method (alternative)
          </div>
          <Badge variant="outline" className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            may hit about:blank
          </Badge>
        </button>
        {showBookmarklet && (
          <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[11.5px] text-slate-600 dark:text-slate-400">
              The bookmarklet is a one-click method, but some browsers run it in a blank tab
              (<code className="font-mono text-[10.5px]">about:blank</code>) instead of the current page.
              If that happens to you, use the Console Snippet above instead.
            </p>
            {bookmarkletUrl ? (
              <a
                href="#"
                ref={(el) => {
                  if (el && bookmarkletUrl) {
                    el.setAttribute("href", bookmarkletUrl);
                    (el as HTMLAnchorElement & { _bookmarkletUrl?: string })._bookmarkletUrl = bookmarkletUrl;
                  }
                }}
                onClick={(e) => {
                  e.preventDefault();
                  toast.info("Drag this link to your bookmarks bar to install it, or use Copy link.");
                }}
                onDragStart={(e) => {
                  const url = (e.currentTarget as HTMLAnchorElement & { _bookmarkletUrl?: string })._bookmarkletUrl;
                  if (url) {
                    try {
                      e.dataTransfer.setData("text/uri-list", url);
                      e.dataTransfer.setData("text/plain", url);
                    } catch {
                      // ignore
                    }
                  }
                }}
                draggable
                className="group inline-flex h-10 cursor-grab items-center gap-2 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 px-4 text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:cursor-grabbing"
                title="Drag me to your bookmarks bar"
              >
                <Bookmark className="h-4 w-4" />
                Capture CryoSmart
                <span className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-normal">
                  drag me →
                </span>
              </a>
            ) : (
              <span className="text-[12px] text-slate-400">Loading bookmarklet…</span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[12px]"
              onClick={copyBookmarklet}
              disabled={!bookmarkletUrl}
            >
              {copied === "bookmarklet" ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
              {copied === "bookmarklet" ? "Copied" : "Copy link"}
            </Button>
          </div>
        )}
      </div>

      {/* Privacy note */}
      <div className="rounded-md border border-blue-200 bg-blue-50/50 p-2.5 text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">Privacy:</span> The snippet only fetches data from
            your CryoSmart instance to your browser, then sends it to <em>this</em> web app.
            No third party sees your CryoSmart data or cookie. The imported metadata is held
            in server memory for up to 10 minutes (single-use token) and is deleted on read.
          </div>
        </div>
      </div>

      {/* Already-loaded indicator */}
      {loaded?.source === "bookmarklet" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-[12px] text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Auto-loaded</strong> {loaded.jobCount} jobs from CryoSmart.
            Proceed to the Configure step below.
          </span>
        </div>
      )}
    </div>
  );
}
