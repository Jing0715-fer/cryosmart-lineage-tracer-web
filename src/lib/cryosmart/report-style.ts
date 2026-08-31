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

/** Visual template ids for `buildLineageHtmlV2`.
 *  v3.22 adds three STRUCTURALLY distinct skins on top of the four v3.17
 *  ones (not just recolours — each ships its own layout archetype):
 *   - blueprint : 工程记录簿 — squared mono panels, dotted-grid paper,
 *                 graphite title-block header, dashed connectors
 *   - editorial : 画报/年报 — serif display type, ink masthead band,
 *                 numbered stages & cards, generous cream whitespace
 *   - focus     : 沉浸阅读 — single-column document flow, horizontal
 *                 chapter rail at the top, warm paper measure */
export type ReportTemplateId =
  | "paper"
  | "minimal"
  | "slate"
  | "classic"
  | "blueprint"
  | "editorial"
  | "focus";

/** Base body font-size of the generated report. */
export type ReportFontScale = "compact" | "standard" | "comfortable";

/** Content width of the generated report page.
 *  - full   : use the whole browser width (default — wide monitors get no
 *             letterboxed blank margins)
 *  - wide   : cap at 1680px (very large screens keep a little breathing room)
 *  - boxed  : cap at 1280px (classic document measure, best for reading)
 */
export type ReportWidthMode = "full" | "wide" | "boxed";

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
  /** Content width preference (v3.20). */
  widthMode: ReportWidthMode;
  /** Custom report title; empty → default "CryoSmart Lineage: P / J". */
  titleOverride: string;
  /** Optional note line under the title (author / date / remark). */
  subtitle: string;
}

export const DEFAULT_REPORT_STYLE: ReportStyleConfig = {
  template: "paper",
  fontScale: "standard",
  imageMode: "embed",
  widthMode: "full",
  titleOverride: "",
  subtitle: "",
};

const TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "paper",
  "minimal",
  "slate",
  "classic",
  "blueprint",
  "editorial",
  "focus",
]);
const FONT_SCALES: ReadonlySet<string> = new Set([
  "compact",
  "standard",
  "comfortable",
]);
const IMAGE_MODES: ReadonlySet<string> = new Set(["embed", "remote", "none"]);
const WIDTH_MODES: ReadonlySet<string> = new Set(["full", "wide", "boxed"]);

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
    widthMode: (() => {
      const wm = value?.widthMode as ReportWidthMode | undefined;
      return wm && WIDTH_MODES.has(wm) ? wm : DEFAULT_REPORT_STYLE.widthMode;
    })(),
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
    desc: "衬线书册排版、双线题头、booktabs 表格，适合打印归档",
    swatch: {
      bg: "#ffffff",
      fg: "#1c1917",
      accent: "#7a2e2e",
      line: "#d6d1ca",
      fontClass: "font-serif",
    },
  },
  {
    id: "minimal",
    label: "Minimal 极简",
    desc: "无衬线、浅灰底白卡片、青绿点缀，屏幕阅读最干净",
    swatch: {
      bg: "#f7f7f8",
      fg: "#18181b",
      accent: "#0f766e",
      line: "#e4e4e7",
      fontClass: "font-sans",
    },
  },
  {
    id: "slate",
    label: "Slate 暗色",
    desc: "深色多层面板、青绿荧光点缀，暗室投屏友好",
    swatch: {
      bg: "#0f1318",
      fg: "#e6eaf0",
      accent: "#5eead4",
      line: "#333c4a",
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
  {
    id: "blueprint",
    label: "Blueprint 工程",
    desc: "等宽字标题黑块、方角面板、点阵纸面与虚线连线，实验记录簿风",
    swatch: {
      bg: "#f4f5f2",
      fg: "#23262b",
      accent: "#b3541e",
      line: "#cdd2cc",
      fontClass: "font-mono",
    },
  },
  {
    id: "editorial",
    label: "Editorial 画报",
    desc: "墨色报头、大号衬线标题、章节编号与奶油纸面，杂志式排版",
    swatch: {
      bg: "#f4efe6",
      fg: "#231f18",
      accent: "#9a3b26",
      line: "#d2c7ae",
      fontClass: "font-serif",
    },
  },
  {
    id: "focus",
    label: "Focus 阅读",
    desc: "单栏文档流、顶部横向章节导轨、暖纸阅读排版，适合通读",
    swatch: {
      bg: "#f7f3e9",
      fg: "#33302a",
      accent: "#31695c",
      line: "#ded4be",
      fontClass: "font-serif",
    },
  },
];

/** Label lookup for compact UI hints (e.g. the download card). */
export function reportTemplateLabel(id: ReportTemplateId): string {
  return REPORT_TEMPLATES.find((t) => t.id === id)?.label ?? id;
}
