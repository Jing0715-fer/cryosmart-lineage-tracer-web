/**
 * v3.76 (round-36 “完全重新设计UI界面，用横向标签显示每个模块”):
 * the horizontal-tab AppShell's navigation bus.
 *
 * The six modules now live in horizontal tabs (数据 / 追踪 / 预览 / 流程图 /
 * 下载 / 帮助). Every pre-existing anchor navigation — the header nav, the
 * hero buttons, the keyboard shortcuts, the auto-jumps after a trace / a
 * history restore / an imported capture — must first SWITCH the tab, then
 * scroll. Anchor <a href="#…"> links cannot do that (the target sits inside
 * a hidden tab), so all call sites route through this tiny module-level bus
 * instead:
 *
 *   navigateToModule("preview")          → switch tab + scroll to section
 *   navigateToModule("preview", { scroll: false })  → switch only
 *   scrollToModule("help")               → scroll only (tab already active)
 *
 * The page registers the single listener at mount; late callers (a capture
 * popup restoring minutes later) are fine because the bus keeps the latest
 * registration. `pendingScroll` covers the registration race at startup: a
 * navigateToModule() call that arrives BEFORE the page mounted is replayed
 * once the listener registers.
 */

/** The six tabs — values double as the URL hash (#module-<value>). */
export type ModuleTabId =
  | "data"
  | "configure"
  | "preview"
  | "flow"
  | "download"
  | "help";

/** The legacy anchor ids each tab owns (kept on the DOM so old deep links
 *  and any in-page scrollIntoView still land somewhere sensible). */
export const MODULE_TAB_IDS: readonly ModuleTabId[] = [
  "data",
  "configure",
  "preview",
  "flow",
  "download",
  "help",
];

/** Map an old anchor id (data-source / configure / preview / flow-figure /
 *  download / help) to its tab. Unknown ids → null. */
export function tabForAnchor(anchor: string): ModuleTabId | null {
  const a = String(anchor || "").replace(/^#/, "").toLowerCase();
  switch (a) {
    case "data-source":
    case "data":
    case "history":
      return "data";
    case "configure":
      return "configure";
    case "preview":
      return "preview";
    case "flow-figure":
    case "flow":
      return "flow";
    case "download":
      return "download";
    case "help":
      return "help";
    default:
      return null;
  }
}

type Listener = (tab: ModuleTabId, opts: { scroll: boolean; anchor?: string }) => void;

let listener: Listener | null = null;
let pendingScroll = false;

/** The page registers here at mount (idempotent). */
export function setModuleNavigator(fn: Listener | null): void {
  listener = fn;
}

/** Switch to a module's tab (and scroll to its section unless
 *  `opts.scroll === false`). Safe before the page mounts — the call is
 *  queued and replayed on registration. */
export function navigateToModule(
  tab: ModuleTabId,
  opts?: { scroll?: boolean; anchor?: string },
): void {
  const call = { scroll: opts?.scroll !== false, anchor: opts?.anchor };
  if (listener) {
    listener(tab, call);
  } else {
    // Pre-mount call (e.g. a restored hash evaluated before React mounts):
    // stash the tab so the page can pick it up as its initial tab.
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("cryoflow.pendingTab", tab);
        if (call.scroll) pendingScroll = true;
      } catch {
        /* private mode — ignore */
      }
    }
  }
}

/** Did a pre-mount navigation request a scroll? Consumed by the page once. */
export function consumePendingScroll(): boolean {
  const v = pendingScroll;
  pendingScroll = false;
  return v;
}

/** Scroll to a module section inside the CURRENT tab (no tab switch). */
export function scrollToModuleSection(anchor: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(anchor.replace(/^#/, ""));
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
