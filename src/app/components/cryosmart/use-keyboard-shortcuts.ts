"use client";

import { useEffect } from "react";

interface ShortcutActions {
  onTrace?: () => void;
  onDownload?: () => void;
  onShowHelp?: () => void;
}

/**
 * Global keyboard shortcuts for the CryoSmart Lineage Tracer web app.
 *
 * - `Ctrl/Cmd + Enter` → Trace Lineage (the primary action)
 * - `Ctrl/Cmd + S`     → Build & download ZIP (prevents browser save)
 * - `?`                 → Scroll to Help section (when not in an input)
 *
 * (A `Ctrl/Cmd + K` / `/` “focus job search” pair used to be wired here,
 * but the Job Explorer search input was removed with the legacy
 * acquisition methods — the handlers targeted a selector that no longer
 * exists anywhere in the DOM.)
 */
export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // `e.target` is not always an Element (synthetic events dispatched on
      // `document`, some browser-internal keydowns) — guard before touching
      // Element-only APIs.
      const target = (e.target instanceof Element ? e.target : null) as HTMLElement | null;
      const isInput =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.getAttribute("role") === "textbox");

      // Cmd/Ctrl + Enter → Trace
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        actions.onTrace?.();
        // Also click the actual trace button if visible
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const traceButton = buttons.find((b) => b.textContent?.includes("Trace Lineage") && !b.disabled);
        traceButton?.click();
        return;
      }

      // Cmd/Ctrl + S → Download ZIP
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const downloadButton = buttons.find(
          (b) => b.textContent?.includes("Build") && b.textContent.includes("download ZIP") && !b.disabled
        );
        downloadButton?.click();
        actions.onDownload?.();
        return;
      }

      // `?` → Scroll to help (only when not in input)
      if (e.key === "?" && !isInput) {
        e.preventDefault();
        document.getElementById("help")?.scrollIntoView({ behavior: "smooth", block: "start" });
        actions.onShowHelp?.();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
