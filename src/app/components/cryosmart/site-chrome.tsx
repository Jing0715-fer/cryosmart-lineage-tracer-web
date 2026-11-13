"use client";

import { ExternalLink, FileText, Keyboard } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { navigateToModule, type ModuleTabId } from "./module-nav";

/** v3.76: the header nav now drives the horizontal module tabs (the old
 *  in-page anchors cannot reach a section hidden inside another tab). */
export function SiteHeader({
  activeTab,
}: {
  activeTab?: ModuleTabId;
  onNavigate?: (tab: ModuleTabId) => void;
}) {
  const navItems: Array<{ label: string; tab: ModuleTabId }> = [
    { label: "Data Source", tab: "data" },
    { label: "Flow Figure", tab: "flow" },
    { label: "Download", tab: "download" },
    { label: "Help", tab: "help" },
  ];
  const go = (tab: ModuleTabId) => navigateToModule(tab);
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-slate-800/70 dark:bg-slate-950/80 dark:supports-[backdrop-filter]:bg-slate-950/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2.5" />
              <circle cx="5" cy="6" r="1.5" />
              <circle cx="19" cy="6" r="1.5" />
              <circle cx="5" cy="18" r="1.5" />
              <circle cx="19" cy="18" r="1.5" />
              <path d="M6.5 7 L10 11" />
              <path d="M17.5 7 L14 11" />
              <path d="M6.5 17 L10 13" />
              <path d="M17.5 17 L14 13" />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => go("data")}
            className="flex flex-col items-start leading-tight"
            title="回到数据模块"
          >
            <span className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              CryoSmart Lineage Tracer <span className="text-teal-600 dark:text-teal-400">Web</span>
            </span>
            <span className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:block">
              Cross-browser reimplementation · v3.41
            </span>
          </button>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <button
              key={item.tab}
              type="button"
              onClick={() => go(item.tab)}
              className={
                "hidden rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors md:inline-block " +
                (activeTab === item.tab
                  ? "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100")
              }
            >
              {item.label}
            </button>
          ))}

          {/* Keyboard shortcuts help */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                <Keyboard className="h-3.5 w-3.5" />
                Keyboard Shortcuts
              </div>
              <Separator className="mb-2" />
              <ul className="space-y-1.5 text-[11.5px]">
                <ShortcutRow keys={["Ctrl", "Enter"]} label="Trace lineage" />
                <ShortcutRow keys={["Ctrl", "S"]} label="Build & download ZIP" />
                <ShortcutRow keys={["?"]} label="Jump to help" />
                <ShortcutRow keys={["Esc"]} label="Close dialog (built-in)" />
              </ul>
            </PopoverContent>
          </Popover>

          {/* Theme toggle */}
          <ThemeToggle />

          <a
            href="https://www.cgl.ucsf.edu/chimerax/"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="ChimeraX (external)"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[9px] text-slate-400">+</span>}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {k}
            </kbd>
          </span>
        ))}
      </div>
    </li>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
            <FileText className="h-3.5 w-3.5" />
            <span>
              Reimplementation of the <span className="font-medium text-slate-700 dark:text-slate-300">CryoSmart Lineage Tracer 3.0</span> Chrome extension as a cross-browser web app.
            </span>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-slate-500 dark:text-slate-400">
            <span>Works in Chrome · Firefox · Safari · Edge</span>
            <span className="h-3 w-px bg-slate-300 dark:bg-slate-700" />
            <span>No extension install required</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
