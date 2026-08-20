"use client";

import Link from "next/link";
import { Github, ExternalLink, FileText } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
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
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              CryoSmart Lineage Tracer <span className="text-teal-600">Web</span>
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:block">
              Cross-browser reimplementation · v1.0
            </span>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            href="#data-source"
            className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:inline-block"
          >
            Data Source
          </Link>
          <Link
            href="#configure"
            className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:inline-block"
          >
            Configure
          </Link>
          <Link
            href="#preview"
            className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:inline-block"
          >
            Preview
          </Link>
          <Link
            href="#download"
            className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:inline-block"
          >
            Download
          </Link>
          <Link
            href="#help"
            className="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:inline-block"
          >
            Help
          </Link>
          <a
            href="https://www.cgl.ucsf.edu/chimerax/"
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title="ChimeraX (external)"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            <span>
              Reimplementation of the <span className="font-medium text-slate-700">CryoSmart Lineage Tracer 3.0</span> Chrome extension as a cross-browser web app.
            </span>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-slate-500">
            <span>Works in Chrome · Firefox · Safari · Edge</span>
            <span className="h-3 w-px bg-slate-300" />
            <span>No extension install required</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
