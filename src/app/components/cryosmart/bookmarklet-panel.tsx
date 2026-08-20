"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ExternalLink,
  Info,
} from "lucide-react";
import { buildBookmarkletUrl, detectMixedContentIssue } from "@/lib/cryosmart/bookmarklet";
import type { LoadedMetadata } from "./data-source-card";

interface Props {
  loaded: LoadedMetadata | null;
  onLoad: (loaded: LoadedMetadata) => void;
}

export function BookmarkletPanel({ loaded, onLoad }: Props) {
  // The web app's own origin (where the user is viewing this page).
  const appOrigin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const [cryosmartUrl, setCryosmartUrl] = useState("http://192.168.4.3:8080");
  const [copied, setCopied] = useState(false);
  const [mixedWarning, setMixedWarning] = useState(false);

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

  // Check for mixed-content issue (web app on https, CryoSmart on http).
  useEffect(() => {
    setMixedWarning(detectMixedContentIssue(appOrigin, cryosmartOrigin));
  }, [appOrigin, cryosmartOrigin]);

  const copyBookmarklet = useCallback(async () => {
    if (!bookmarkletUrl) return;
    try {
      await navigator.clipboard.writeText(bookmarkletUrl);
      setCopied(true);
      toast.success("Bookmarklet code copied to clipboard");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Failed to copy. Drag the link to your bookmarks bar instead.");
    }
  }, [bookmarkletUrl]);

  const installInstructions = [
    "Open your browser's bookmarks bar (Ctrl/Cmd+Shift+B if hidden).",
    "Drag the \"Capture CryoSmart\" button below onto the bar — a bookmark appears.",
    "Open CryoSmart in a normal browser tab and log in.",
    "Navigate to any project page (URL like http://your-cryosmart/#/projects/P52).",
    "Click the \"Capture CryoSmart\" bookmark. A status box appears in the top-left corner.",
    "The web app opens in a new tab with the jobs already loaded — just click Trace Lineage.",
  ];

  return (
    <div className="space-y-3">
      {/* How it works banner */}
      <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-3">
        <div className="flex items-start gap-2.5">
          <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
          <div className="text-[12px] leading-relaxed text-teal-900">
            <span className="font-semibold">One-click capture, no cookie pasting.</span>{" "}
            This bookmark runs <em>inside</em> the CryoSmart tab (same-origin), so the browser
            automatically attaches your session cookie — including HttpOnly cookies. It fetches
            the project&apos;s job metadata, sends it here, and opens the web app with everything loaded.
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
            . Browsers block cross-protocol fetches (mixed content). If the bookmarklet can&apos;t reach the web app
            after capturing, either host this web app on HTTPS or use the Upload JSON / Live Connect modes instead.
          </div>
        </div>
      )}

      {/* The draggable bookmarklet */}
      <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 p-4">
        <Label className="mb-2 block text-[11.5px] uppercase tracking-wide text-slate-500">
          Drag this to your bookmarks bar
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {bookmarkletUrl ? (
            <a
              // NOTE: React intercepts `href="javascript:..."` and replaces it with a
              // blocked-error stub — which would also break drag-to-bookmark because
              // the browser reads the (stubbed) href on drop. We therefore set the
              // href via a ref + useEffect AFTER mount, bypassing React's sanitiser.
              href="#"
              ref={(el) => {
                if (el && bookmarkletUrl) {
                  // setAttribute bypasses React's javascript: URL guard
                  el.setAttribute("href", bookmarkletUrl);
                  // Also stash it on the DOM node so the dragstart handler can
                  // write the real URL into the dataTransfer payload (some browsers,
                  // notably Firefox, don't carry href through drag of javascript: URLs).
                  (el as HTMLAnchorElement & { _bookmarkletUrl?: string })._bookmarkletUrl = bookmarkletUrl;
                }
              }}
              onClick={(e) => {
                // Prevent in-page execution; we only want drag-to-install or copy-link.
                e.preventDefault();
                toast.info("Drag this link to your bookmarks bar to install it, or use Copy link.");
              }}
              onDragStart={(e) => {
                // Firefox & some Chromium versions need explicit text/uri-list data for
                // javascript: URLs to survive the drag into the bookmarks bar.
                const url = (e.currentTarget as HTMLAnchorElement & { _bookmarkletUrl?: string })._bookmarkletUrl;
                if (url) {
                  try {
                    e.dataTransfer.setData("text/uri-list", url);
                    e.dataTransfer.setData("text/plain", url);
                  } catch {
                    // ignore — IE/old browsers
                  }
                }
              }}
              draggable
              className="group inline-flex h-10 cursor-grab items-center gap-2 rounded-lg bg-gradient-to-br from-teal-600 to-emerald-600 px-4 text-[13px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:cursor-grabbing"
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
            {copied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Or right-click → <em>Copy link address</em>, then create a new bookmark manually and paste it as the URL.
        </p>
      </div>

      {/* CryoSmart URL field (informational, helps user know where to use it) */}
      <div className="space-y-1.5">
        <Label htmlFor="cryosmart-url-bm" className="text-[12px] text-slate-600">
          Your CryoSmart URL <span className="text-slate-400">(so you remember where to click the bookmark)</span>
        </Label>
        <Input
          id="cryosmart-url-bm"
          value={cryosmartUrl}
          onChange={(e) => setCryosmartUrl(e.target.value)}
          placeholder="http://192.168.4.3:8080"
          className="h-9 font-mono text-[13px]"
        />
        {cryosmartOrigin && (
          <p className="text-[10.5px] text-slate-500">
            After installing the bookmark above, navigate to{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">{cryosmartOrigin}</code>{" "}
            and click the bookmark on any project page.
          </p>
        )}
      </div>

      <Separator />

      {/* Step-by-step install instructions */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <MousePointerClick className="h-3 w-3" />
          How to use
        </div>
        <ol className="ml-1 space-y-1.5">
          {installInstructions.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-slate-600">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-700">
                {i + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Privacy note */}
      <div className="rounded-md border border-blue-200 bg-blue-50/50 p-2.5 text-[11px] text-blue-800">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">Privacy:</span> The bookmarklet only fetches data from
            your CryoSmart instance to your browser, then sends it to <em>this</em> web app (you can
            inspect the code by clicking <em>Copy link</em> and reading it). No third party sees
            your CryoSmart data or cookie. The imported metadata is held in server memory for up to
            10 minutes (single-use token) and is deleted the moment the web app reads it.
          </div>
        </div>
      </div>

      {/* Already-loaded indicator */}
      {loaded?.source === "bookmarklet" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-[12px] text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Auto-loaded</strong> {loaded.jobCount} jobs from{" "}
            <code className="rounded bg-emerald-100 px-1 font-mono text-[10.5px]">{loaded.cryosmartOrigin || "CryoSmart"}</code>
            . Proceed to the Configure step below.
          </span>
        </div>
      )}
    </div>
  );
}
