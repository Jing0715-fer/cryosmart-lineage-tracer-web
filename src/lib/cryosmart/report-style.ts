/**
 * report-style.ts — shared configuration for the HTML report's visual
 * template + customisation options (v3.17).
 *
 * The report is no longer rendered inside the web UI (the big preview
 * iframe was removed); the user picks a template + a few options in the
 * Report tab and then either opens the report in a new tab or downloads
 * the standalone HTML. The same configuration flows into the ZIP bundle's
 * `*_lineage_report.html`.
 *
 * This module is deliberately dependency-free (no imports) so both the
 * report builder (report-html.ts), the bundle builder (bundle.ts) and the
 * UI cards can import it without cycles.
 */

/** Visual template ids for `buildLineageHtmlV2`. */
export type ReportTemplateId = "paper" | "minimal" | "slate" | "classic";

/** Base body font-size of the generated report. */
export type ReportFontScale = "compact" | "standard" | "comfortable";

/**
 * How images are delivered in the generated report.
 *  - embed  : base64 data-URLs when available (self-contained, large file)
 *  - remote : reference the source URLs (small file, needs network/access)
 *  - none   : strip image tags entirely (smallest, data tables stay intact)
 */
export type ReportImageMode = "embed" | "remote" | "none";

/** User-configurable report options (persisted in localStorage). */
export interface ReportStyleConfig {
  template: ReportTemplateId;
  fontScale: ReportFontScale;
  imageMode: ReportImageMode;
  /** Custom report title; empty → default "CryoSmart Lineage: P / J". */
  titleOverride: string;
  /** Optional note line under the title (author / date / remark). */
  subtitle: string;
}

export const DEFAULT_REPORT_STYLE: ReportStyleConfig = {
  template: "paper",
  fontScale: "standard",
  imageMode: "embed",
  titleOverride: "",
  subtitle: "",
};

const TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "paper",
  "minimal",
  "slate",
  "classic",
]);
const FONT_SCALES: ReadonlySet<string> = new Set([
  "compact",
  "standard",
  "comfortable",
]);
const IMAGE_MODES: ReadonlySet<string> = new Set(["embed", "remote", "none"]);

/** Clamp an arbitrary (possibly persisted / stale) object to a valid config. */
export function normalizeReportStyle(
  value: Partial<ReportStyleConfig> | null | undefined
): ReportStyleConfig {
  const template = value?.template as ReportTemplateId | undefined;
  const fontScale = value?.fontScale as ReportFontScale | undefined;
  const imageMode = value?.imageMode as ReportImageMode | undefined;
  return {
    template:
      template && TEMPLATE_IDS.has(template) ? template : DEFAULT_REPORT_STYLE.template,
    fontScale:
      fontScale && FONT_SCALES.has(fontScale)
        ? fontScale
        : DEFAULT_REPORT_STYLE.fontScale,
    imageMode:
      imageMode && IMAGE_MODES.has(imageMode)
        ? imageMode
        : DEFAULT_REPORT_STYLE.imageMode,
    titleOverride:
      typeof value?.titleOverride === "string"
        ? value.titleOverride.slice(0, 200)
        : "",
    subtitle:
      typeof value?.subtitle === "string" ? value.subtitle.slice(0, 300) : "",
  };
}

/* ── localStorage persistence ───────────────────────────────────────── */

const REPORT_STYLE_KEY = "cryosmart_report_style_v1";

/** Read the persisted report style (client-side; returns defaults on SSR). */
export function loadReportStyle(): ReportStyleConfig {
  if (typeof window === "undefined") return { ...DEFAULT_REPORT_STYLE };
  try {
    const raw = window.localStorage.getItem(REPORT_STYLE_KEY);
    if (!raw) return { ...DEFAULT_REPORT_STYLE };
    const parsed = JSON.parse(raw) as Partial<ReportStyleConfig>;
    return normalizeReportStyle(parsed);
  } catch {
    return { ...DEFAULT_REPORT_STYLE };
  }
}

/** Persist the report style (best-effort; storage may be unavailable). */
export function saveReportStyle(style: ReportStyleConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPORT_STYLE_KEY, JSON.stringify(style));
  } catch {
    // quota exceeded / disabled — best effort only
  }
}

/* ── Template metadata for the UI picker ───────────────────────────── */

export interface ReportTemplateInfo {
  id: ReportTemplateId;
  /** Short Chinese label shown on the picker card. */
  label: string;
  /** One-line description. */
  desc: string;
  /** Mini-swatch styling hints for the picker card (Tailwind-ish values). */
  swatch: {
    /** Swatch background (CSS color). */
    bg: string;
    /** Primary ink (CSS color). */
    fg: string;
    /** Accent (links / markers) (CSS color). */
    accent: string;
    /** Hairline color. */
    line: string;
    /** Tailwind font-family utility class for the swatch title. */
    fontClass: string;
  };
}

export const REPORT_TEMPLATES: ReportTemplateInfo[] = [
  {
    id: "paper",
    label: "Paper 学术",
    desc: "衬线排版、纸面留白、书册式表格，适合打印与归档",
    swatch: {
      bg: "#ffffff",
      fg: "#1a1a1a",
      accent: "#7a2e2e",
      line: "#d4d4d4",
      fontClass: "font-serif",
    },
  },
  {
    id: "minimal",
    label: "Minimal 极简",
    desc: "系统无衬线、大量留白、近单色，屏幕阅读最干净",
    swatch: {
      bg: "#ffffff",
      fg: "#18181b",
      accent: "#0f766e",
      line: "#e8eaed",
      fontClass: "font-sans",
    },
  },
  {
    id: "slate",
    label: "Slate 暗色",
    desc: "深色面板、低对比文字、暗室演示与投屏友好",
    swatch: {
      bg: "#101418",
      fg: "#e7ebf0",
      accent: "#5eead4",
      line: "#2a313a",
      fontClass: "font-sans",
    },
  },
  {
    id: "classic",
    label: "Classic 旧版",
    desc: "v3.16 之前的原有样式（渐变、荧光、自动深浅色）",
    swatch: {
      bg: "#f8fafc",
      fg: "#0f172a",
      accent: "#0d9488",
      line: "#cbd5e1",
      fontClass: "font-sans",
    },
  },
];

/** Label lookup for compact UI hints (e.g. the download card). */
export function reportTemplateLabel(id: ReportTemplateId): string {
  return REPORT_TEMPLATES.find((t) => t.id === id)?.label ?? id;
}
