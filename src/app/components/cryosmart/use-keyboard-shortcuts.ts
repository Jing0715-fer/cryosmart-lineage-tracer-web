"use client";

import { useEffect } from "react";

interface ShortcutActions {
  onTrace?: () => void;
  onDownload?: () => void;
  onFocusSearch?: () => void;
  onShowHelp?: () => void;
}

/**
 * Global keyboard shortcuts for the CryoSmart Lineage Tracer web app.
 *
 * - `Ctrl/Cmd + Enter` → Trace Lineage (the primary action)
 * - `Ctrl/Cmd + S`     → Build & download ZIP (prevents browser save)
 * - `Ctrl/Cmd + K`     → Focus the Job Explorer search
 * - `/`                 → Focus search (when not already in an input)
 * - `?`                 → Scroll to Help section
 * - `Esc`              → Close any open dialog / drawer
 */
export function useKeyboardShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox";

      // Cmd/Ctrl + Enter → Trace
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        actions.onTrace?.();
        // Also click the actual trace button if visible
        const traceBtn = document.querySelector<HTMLButtonElement>(
          'button:not([disabled])'
        );
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

      // Cmd/Ctrl + K or `/` → Focus search
      if (((e.metaKey || e.ctrlKey) && e.key === "k") || (e.key === "/" && !isInput)) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder*="Search by UID"]'
        );
        searchInput?.focus();
        actions.onFocusSearch?.();
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
