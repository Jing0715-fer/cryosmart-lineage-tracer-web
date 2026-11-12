/**
 * Portrait workflow-figure PPTX builder (v3.75; layout rebuilt for round-18).
 *
 * v3.75 (round-34 “按照class0,1,2从左到右顺序排列 · 保证所有模式的颗粒数
 * 都要显示 · 框不要比图大太多 · 箭头和文字避免重叠”): four layout
 * overhauls —
 *   (1) STRICT CLASS ORDER: the v3.62 anchor centre-swap is GONE. Class
 *       thumbnails render in their natural 0,1,2… order left→right (the
 *       strip stays centred on the spine); the flow-anchor selection
 *       frame simply lands on whichever class feeds the next stage.
 *   (2) COUNTS EVERYWHERE: 极简 rows now carry the same per-class stats
 *       under each thumbnail as 标准/简化 (the retention labels stay),
 *       and single-map rows put their stats UNDER the image (centred on
 *       the spine) instead of hanging to its right.
 *   (3) TIGHT FRAMES: every embedded PNG is alpha-trimmed to its content
 *       bbox (png-trim.ts — the 1600×800 ChimeraX renders carry ~50 %
 *       transparent margins), and the anchor frame hugs the PLACED
 *       image box, not the slot — the box is never materially bigger
 *       than the map it marks.
 *   (4) SPACING: per-class stats sit 0.09 in below the image (clear of
 *       the frame's 0.04 overhang), stage labels end 0.11 in left of
 *       the spine (arrow clearance), and a long footnote wraps onto a
 *       second line instead of running off the canvas.
 *
 * v3.73 (round-32 “简化和标准模式下的pptx报告也要参考极简的pptx进行优化，
 * 中间步骤只展示分类结果…也需要框出哪些类是下一步用到的”): the 极简
 * showcase conventions now run in EVERY style — the flow-anchor class (the
 * one feeding the next stage) gets the reference's thin selection rectangle
 * in 标准/简化 decks too, and per-gap “omitted: N×”
 * notes name the stages the classification-only middle filter dropped
 * (workflow-figure's dropNonClassificationMiddles + model.omissions).
 *
 * Format modelled after the user's NEW reference `upload/workflow.pptx`
 * (7.5 × 10 in PORTRAIT slide, verified against its own geometry):
 *   - header band top: "N Micrographs" + "Auto pick" (raised between) +
 *     "N particles" — the band ENDS at the spine, no inter-item arrows
 *   - ONE straight vertical SPINE (slide centre x = 3.75) carries the whole
 *     flow: every stage row is centred on it, every connector is a
 *     straightConnector1 of FIXED length 0.39 in / 1 pt / triangle head
 *     exactly like the reference's 直接箭头连接符 (round-18: “不要用之前的
 *     折线了，尽量固定箭头的大小和尺寸” — NO elbows, NO bentConnector3,
 *     NO column wrap; the misalignment class of rounds 12–17 is structurally
 *     impossible now)
 *   - each stage one ROW top→bottom: right-aligned 8 pt Arial label above
 *     the thumbnails, ending just LEFT of the spine (the reference's
 *     “2*Hetero refinement” box ends at 3.62 vs spine 3.69), so the arrow
 *     passing through the label band never touches the text
 *   - 极简 style additionally draws the reference's selection rectangles
 *     (thin black frame around the class whose particle count feeds the
 *     next stage — 矩形 26/28/43) and the arrow retention labels
 *     (“37.2% / 590,421 particles”) centred on the spine in the inter-row
 *     gap, and puts the final resolution (“C1, 2.70 Å”) under the last map
 *   - v3.62 (round-21 “对齐的算法还是不是对每个样品都有效 + 排版还是不太
 *     美观”): in 极简 style the flow-anchor class is centred ON the spine —
 *     the anchor swaps into the strip's centre slot and the strip shifts
 *     (margin-clamped) to land the frame exactly under the flow arrows, so
 *     the selection frame never floats off to the side like P268's third
 *     row; every inter-row gap keeps the SAME band height even without a
 *     retention label (uniform vertical rhythm), and stages the model
 *     omitted between two rows are named under the gap — “omitted: 2×
 *     Hetero refinement” (model.omissions, 极简 only)
 *   - v3.63 (round-22 “auto pick的箭头缺失”): the header band carries the
 *     reference's ONE horizontal pick arrow — “N Micrographs —Auto pick→
 *     N particles” (直接箭头连接符 12: 0.39 in / 1 pt / triangle, head
 *     pointing right, centred under the raised pick label at the counts'
 *     line height; v3.59 had dropped every inter-item arrow).
 *   - v3.63 (round-22 “每步展示的颗粒数和上一步的比例要重新用这一步
 *     除以上一步来计算”): the retention labels read ENTRY counts — a
 *     merged “N×” row divides by its FIRST member's input (the reference's
 *     own 37.2% = 590,421 ÷ 1,588,675), and a parallel classification
 *     merge row divides by the SUM of its jobs' counts (“平行合并的分类
 *     job要将两个job的颗粒数合并”).
 *   - 标准 style keeps the richer v3.55 conventions (job-id label runs,
 *     per-class stats under each thumbnail / side stats for single-map
 *     rows, footnote) — now on the same spine layout
 *   - the canvas is allowed to GROW (round-18: “可以根据需要改变画布
 *     大小”): width stays the reference's 7.5 in, height = max(10 in,
 *     content) rounded up to ¼ in — the slide is a figure strip, not a
 *     projector deck
 *   - a thin-black-border empty frame when a thumbnail is unavailable
 *
 * v3.57 (round-16, Windows-openability, kept): canonical Office style
 * matrix in the theme (exactly 3 fillStyleLst / lnStyleLst /
 * effectStyleLst / bgFillStyleLst entries), cs fonts, the required
 * slideLayout→slideMaster relationship, master txStyles, layout clrMapOvr.
 *
 * Map thumbnails keep the `name="CryoSmartImage:<uid>/<group>"` marker on
 * <p:cNvPr> (same contract as the A4 picture-flow PPTX) so the desktop
 * ChimeraX helpers remain interchangeable.
 *
 * Hand-rolled OOXML + the existing pure-TS ZIP writer — no dependencies.
 */

import { makeZip, type ZipFileEntry } from "./zip";
import { PPTX_CONTENT_TYPE } from "./constants";
import { trimPngAlpha } from "./png-trim";
import type { FlowFigureModel, FlowFigureItem } from "./workflow-figure";

/* ------------------------------------------------------------------ */
/* Units & slide constants                                             */
/* ------------------------------------------------------------------ */

const EMU = 914400;
/** v3.59: portrait reference width (upload/workflow.pptx sldSz cx). */
const PAGE_W_IN = 7.5;
/** Minimum slide height — the reference deck itself is 7.5 × 10. */
const MIN_SLIDE_H_IN = 10;

const IN = (v: number) => Math.round(v * EMU);
const FONT = "Arial";
const EA_FONT = "微软雅黑";

/* ------------------------------------------------------------------ */
/* Logical ops                                                         */
/* ------------------------------------------------------------------ */

type Align = "l" | "ctr" | "r";

/** One styled text run inside a paragraph (v3.55: the stage label's
 *  job-id run is smaller + gray next to the black stage name). */
interface TextRun {
  t: string;
  sz?: number;
  color?: string;
}

/** One paragraph: either the legacy single-string shape or explicit runs. */
interface TextLine {
  t?: string;
  runs?: TextRun[];
  align: Align;
}

interface TextOp {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  lines: TextLine[];
  sz?: number; // centi-points (800 = 8 pt)
  color?: string;
}

interface FrameOp {
  kind: "frame";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** v3.59: a connector is ALWAYS a straight arrow — fixed length, fixed
 *  weight (1 pt), triangle head, exactly like the reference. The old
 *  bent/elbow/plain-segment machinery is deleted. */
interface ConnOp {
  kind: "conn";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PicOp {
  kind: "pic";
  x: number;
  y: number;
  w: number;
  h: number;
  /** `CryoSmartImage:<key>` marker value. */
  mediaKey: string;
  /** `<p:cNvPr descr>` — e.g. "image-J606". */
  descr: string;
  bytes: Uint8Array;
}

type Op = TextOp | FrameOp | ConnOp | PicOp;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* XML builders                                                        */
/* ------------------------------------------------------------------ */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rPr(op: { sz?: number; color?: string }): string {
  const sz = op.sz ?? 800;
  const color = op.color ?? "000000";
  return `<a:rPr lang="en-US" altLang="zh-CN" sz="${sz}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:rPr>`;
}

function textXml(id: number, op: TextOp): string {
  const paragraphs = op.lines
    .map((line) => {
      const runs = (line.runs ?? [{ t: line.t ?? "" }]).map(
        (r) =>
          `<a:r>${rPr({ sz: r.sz ?? op.sz, color: r.color ?? op.color })}<a:t>${esc(r.t)}</a:t></a:r>`,
      );
      return `<a:p><a:pPr algn="${line.align}"/>${runs.join("")}<a:endParaRPr lang="zh-CN" altLang="en-US" sz="${op.sz ?? 800}"><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:endParaRPr></a:p>`;
    })
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="文本框 ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function frameXml(id: number, op: FrameOp): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="矩形 ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p></p:txBody></p:sp>`;
}

/** v3.59: fixed-weight (1 pt) straight connector with a triangle head —
 *  the reference deck's 直接箭头连接符. Only straight lines are emitted
 *  anywhere in the deck. */
function connXml(id: number, op: ConnOp): string {
  const offX = Math.min(op.x1, op.x2);
  const offY = Math.min(op.y1, op.y2);
  const extX = Math.abs(op.x2 - op.x1);
  const extY = Math.abs(op.y2 - op.y1);
  const flipH = op.x2 < op.x1 ? ' flipH="1"' : "";
  const flipV = op.y2 < op.y1 ? ' flipV="1"' : "";
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="直接箭头连接符 ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH}${flipV}><a:off x="${IN(offX)}" y="${IN(offY)}"/><a:ext cx="${IN(extX)}" cy="${IN(extY)}"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
}

function picXml(id: number, op: PicOp, relId: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="CryoSmartImage:${esc(op.mediaKey)}" descr="${esc(op.descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface BuildPptxOptions {
  /** Bottom-left footnote (alignment / handedness summary). 标准 style
   *  only — the 极简 reference carries none. */
  footnote?: string | null;
  /** Thumbnail image bytes keyed by `item.mapKey` OR `item.imageUrl`. */
  images: Map<string, Uint8Array>;
  /** v3.59 (round-18 极简模式): "minimal" = the upload/workflow.pptx
   *  reference look (no job ids, selection rectangles around the flow
   *  anchor class, arrow retention labels, final Å under the last map);
   *  "standard" (default) = the richer v3.55 conventions.
   *  v3.75: the styles share the per-class stats + the anchor frame;
   *  minimal keeps the bare labels, retention labels and no footnote. */
  style?: "standard" | "minimal";
}

function estimateTextWidth(text: string): number {
  return Math.max(0.6, text.length * 0.062 + 0.22);
}

/** v3.75: width estimate for the 7 pt footnote — CJK glyphs are full-em
 * (~0.096 in at 7 pt) while latin/digits average ~0.049 in. */
function footnoteTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 0.096 : 0.049;
  return w;
}

function containBox(box: Box, ratio: number): Box {
  let bw = box.w;
  let bh = box.w / ratio;
  if (bh > box.h) {
    bh = box.h;
    bw = box.h * ratio;
  }
  return { x: box.x + (box.w - bw) / 2, y: box.y + (box.h - bh) / 2, w: bw, h: bh };
}

export async function buildWorkflowPptx(
  fig: FlowFigureModel,
  options: BuildPptxOptions,
): Promise<Blob> {
  const minimal = options.style === "minimal";
  const ops: Op[] = [];
  const pics: PicOp[] = [];
  const MARGIN_X = 0.45;
  const contentW = PAGE_W_IN - 2 * MARGIN_X;
  /** v3.59: the single flow spine — slide centre, like the reference. */
  const SPINE = PAGE_W_IN / 2;
  /** v3.59: FIXED arrow geometry (reference: 0.39 in, 1 pt, triangle). */
  const ARROW_LEN = 0.39;

  /* ---- header band data: "N Micrographs" + "Auto pick" + "N particles".
   * v3.59: the reference's own header — the three texts on one line with
   * "Auto pick" RAISED between the two counts, the band ending at the
   * spine, and NO inter-item arrows (the old band chained horizontal
   * arrows; the new reference drops them). */
  const headerItems = [
    fig.headerStats.micrographs,
    fig.headerStats.pick,
    fig.headerStats.particles,
  ].filter((t): t is string => !!t);

  /* ---- stage groups ---- */
  const groups = fig.groups.filter((g) => g.length > 0);
  const LABEL_H = 0.26;
  /** parallel rows' label band (two lines) + the arrow standoff above it */
  const PLABEL_H = minimal ? 0.32 : 0.48;
  const ITEM_GAP = 0.16;
  /** v3.75: per-class stats band under EVERY multi-thumb row (极简 included
   *  — round-34 “保证所有模式的颗粒数都要显示”) — plus the single-map
   *  rows' stats, which now sit UNDER the image instead of hanging right. */
  const UNDER_H = 0.34;
  /** v3.75: image-bottom → stats-text gap — clears the anchor frame's
   *  0.04 in overhang with breathing room (round-34 review: the frame
   *  edge used to sit directly on the first stats line). */
  const STATS_TOP_GAP = 0.09;
  /** 极简 style: retention label height in the inter-row gap. */
  const RETAIN_H = 0.31;
  /** v3.62: 极简 — the fixed inter-row band = retention slot + omission
   *  line + padding. EVERY minimal gap keeps this height (label or not,
   * note or not), so the vertical rhythm is uniform down the whole
   * slide — the uploaded P268 deck's label-less rows used to sit 0.29 in
   * closer to their neighbours. */
  const OMIT_H = 0.16;
  const MIN_GAP_BAND = RETAIN_H + OMIT_H + 0.02;
  const REF_IMG_W = minimal ? 1.58 : 3.12;

  /** v3.56: expand an item into its thumbnail slots (classes, or the
   *  single mapKey/imageUrl slot for demo/FSC/montage/legacy items).
   *  The slot key must match where the BYTES live — real map stages
   *  (item.map != null) render under their mapKey, while demo/FSC/
   *  montage items carry their bytes under item.imageUrl. */
  const itemSlotsOf = (
    item: FlowFigureItem,
  ): Array<{ key: string | null; stats: string[]; groupTag?: string; count: number | null }> => {
    if (item.classes?.length) {
      const multi = item.classes.length > 1;
      return item.classes.map((c) => ({
        key: c.mapKey,
        stats: multi ? c.stats : item.stats.length ? item.stats : c.stats,
        groupTag: multi ? c.group : undefined,
        count: c.particleCount ?? null,
      }));
    }
    return [
      {
        key: item.map ? (item.mapKey ?? item.imageUrl) : (item.imageUrl ?? item.mapKey),
        stats: item.stats,
        count: item.particleTotal ?? null,
      },
    ];
  };
  const rowThumbTotal = (g: FlowFigureItem[]) =>
    g.reduce((s, it) => s + Math.max(1, itemSlotsOf(it).length), 0);
  const rowGapUnits = (g: FlowFigureItem[]) =>
    g.reduce((s, it) => s + Math.max(0, itemSlotsOf(it).length - 1), 0) + Math.max(0, g.length - 1);

  /** v3.59: SINGLE COLUMN — one row spans the slide width, thumbnails all
   *  the same size, capped by the reference width and by the widest row's
   *  share of the content width. No column solver, no readability floor:
   *  the canvas GROWS downward instead. (v3.75: the old single-map side
   *  stats reservation is gone — those stats moved UNDER the image.) */
  const imgW = Math.min(
    REF_IMG_W,
    ...groups.map(
      (g) => (contentW - rowGapUnits(g) * ITEM_GAP) / Math.max(1, rowThumbTotal(g)),
    ),
  );
  const imgH = imgW / 2;

  /* ---- v3.55 label runs: the 标准 style carries the job id; 极简 keeps
   *  the reference's bare stage name. */
  const UID_COLOR = "808080";
  const labelShowsUid = (item: FlowFigureItem) =>
    !!item.uid && item.uid !== item.label && !/^FSC$/i.test(item.uid);
  const estimateRunsWidth = (runs: TextRun[]): number =>
    runs.reduce((s, r) => s + Math.max(0.08, r.t.length * 0.058 * ((r.sz ?? 800) / 800) + 0.04), 0) + 0.08;
  const labelRunsOf = (item: FlowFigureItem): TextRun[] =>
    minimal || !labelShowsUid(item)
      ? [{ t: item.label }]
      : [
          { t: item.label },
          { t: ` · ${item.uid}`, sz: 700, color: UID_COLOR },
        ];

  interface PlacedSlot {
    thumb: Box;
    stats: Box | null;
    statsLines: string[];
    key: string | null;
    descr: string;
    /** v3.59: the numeric particle count behind this slot (flow-anchor
     *  selection + retention labels read it). */
    count: number | null;
  }
  interface PlacedItem {
    item: FlowFigureItem;
    /** the item's share of the strip (parallel labels use its right edge) */
    left: number;
    width: number;
    slots: PlacedSlot[];
  }
  interface PlacedRow {
    items: PlacedItem[];
    /** image strip top */
    top: number;
    /** bottom incl. 标准 under-thumb stats */
    bottom: number;
    parallel: boolean;
    /** 极简: the class slot whose count feeds the next stage — gets the
     *  reference's selection rectangle. */
    anchor: PlacedSlot | null;
  }

  /** v3.63 (round-22 “每步展示的颗粒数和上一步的比例要重新用这一步
   *  除以上一步来计算”): the count flowing INTO a displayed row — the
   *  retention labels divide THIS step by the PREVIOUS step, so a
   *  merged “N×” row reads its FIRST member's particleTotal
   *  (entryParticleCount) and a parallel classification merge row
   *  reads the SUM of its jobs' counts (“平行合并的分类job要将两个
   *  job的颗粒数合并”). Single rows fall back to their own
   *  particleTotal. */
  const rowEntryCount = (g: FlowFigureItem[]): number | null => {
    const entryOf = (it: FlowFigureItem): number | null => {
      const v = it.entryParticleCount ?? it.particleTotal ?? null;
      return v != null && v > 0 ? v : null;
    };
    if (g.length > 1) {
      const cs = g.map(entryOf).filter((v): v is number => v != null);
      return cs.length ? cs.reduce((a, b) => a + b, 0) : null;
    }
    return g.length ? entryOf(g[0]) : null;
  };
  /* v3.64 (round-23 “分类后指向deepemhancer这之间缺少颗粒数和比例”): a row
   * that reports NO count of its own INHERS the previous row's entry — a
   * stage that does not report particles passes them through unchanged, so
   * the gap into it still carries the count line (its percentage reads
   * 100% and stays suppressed). Without the forward-fill, a count-less
   * downstream row dropped BOTH lines and the funnel read as if the
   * particles vanished. */
  const repCounts: Array<number | null> = [];
  {
    let lastCount: number | null = null;
    for (const raw of groups.map(rowEntryCount)) {
      if (raw != null) lastCount = raw;
      repCounts.push(raw ?? lastCount);
    }
  }

  /* ---- flow-anchor precomputation (data-only, before placement) ----
   * The anchor = the class slot whose particle count feeds the next stage
   * (fallback: the largest-count slot). Computed per row UP FRONT because
   * the next row's ENTRY GAP depends on it: a framed row's incoming arrow
   * stops at the frame's top edge instead of the image top — the tip
   * would otherwise poke through the frame.
   *
   * v3.75 (round-34 “需要按照class0,1,2从左到右顺序排列”): the v3.62
   * centre-swap is REMOVED. The strip renders classes in their natural
   * 0,1,2… order (the classSlotsFor sort), centred on the spine; the
   * selection frame simply lands on whichever class feeds the next
   * stage, at its own position. The anchor is now pure DATA — no render
   * position, no strip shift. Parallel rows stay frame-less. */
  interface AnchorInfo {
    item: number;
    slot: number;
  }
  /* v3.73 (round-32 “也需要框出哪些类是下一步用到的”): the anchor
   *  precomputation + selection frame apply to EVERY style now —
   *  标准/简化 decks frame the class feeding the next stage exactly like
   *  the 极简 reference (per-class stats travel under the slots
   *  unchanged); parallel rows stay frame-less in every style. */
  const anchorInfoOf = (g: FlowFigureItem[], nextRep: number | null): AnchorInfo | null => {
    if (nextRep == null || g.length > 1 || rowThumbTotal(g) <= 1) return null;
    const flat: Array<{ item: number; slot: number; count: number | null }> = [];
    g.forEach((it, ii) =>
      itemSlotsOf(it).forEach((s, jj) => flat.push({ item: ii, slot: jj, count: s.count })),
    );
    const counted = flat.filter((f) => f.count != null);
    if (counted.length <= 1) return null;
    /* the anchor: the class whose count equals the next stage's input;
     * fallback = the largest-count class (best guess), null when no
     * counted class exists at all. */
    const maxCountSlot = ():
      | { item: number; slot: number; count: number | null }
      | null => {
      let best = -1;
      let out: { item: number; slot: number; count: number | null } | null = null;
      for (const f of counted) {
        if ((f.count as number) > best) {
          best = f.count as number;
          out = f;
        }
      }
      return best > 0 ? out : null;
    };
    const hit = counted.find((f) => f.count === nextRep) ?? maxCountSlot();
    if (!hit) return null;
    return { item: hit.item, slot: hit.slot };
  };
  const anchorInfos = groups.map((g, i) => anchorInfoOf(g, i + 1 < groups.length ? repCounts[i + 1] : null));

  /* ---- vertical placement: one cursor down the spine ---- */
  const rows: PlacedRow[] = [];
  /** distance from an arrow tip to the NEXT row's image top: single rows
   * put their label band in the arrow's shadow (text ends left of the
   * spine, reference-faithful) — v3.62: minimal style keeps ONE uniform
   * 0.07 standoff (framed or not) so every row sits at the same pitch;
   * parallel rows need the arrow to stop ABOVE their per-item label band
   * (a right item's label may reach the spine, so the band must not share
   * y with the arrow). */
  const entryGap = (i: number): number => {
    const g = groups[i];
    if (!g) return 0.01;
    if (g.length > 1) return PLABEL_H + 0.02;
    if (minimal) return 0.07;
    /* v3.73: a 标准/简化 row carrying an anchor frame gets the same 0.07
     *  standoff — the arrow tip must stop at the frame's top edge. */
    return anchorInfos[i] ? 0.07 : 0.01;
  };

  let headerBottom = 0;
  if (headerItems.length) {
    const widths = headerItems.map(estimateTextWidth);
    const SPACING = 0.18;
    const total = widths.reduce((a, b) => a + b, 0) + SPACING * (headerItems.length - 1);
    /* last item CENTRED on the spine (the reference's "1,588,675
     * particles" box centres at 3.66 vs spine 3.69), clamped at margin. */
    let bx = Math.max(MARGIN_X, SPINE + widths[widths.length - 1] / 2 - total);
    const headerSlots: Array<{ x: number; w: number }> = [];
    headerItems.forEach((text, i) => {
      const isPick = i === 1 && headerItems.length === 3;
      headerSlots.push({ x: bx, w: widths[i] });
      ops.push({
        kind: "text",
        x: bx,
        y: isPick ? 0.37 : 0.55,
        w: widths[i],
        h: 0.26,
        lines: [{ t: text, align: "ctr" }],
      });
      bx += widths[i] + SPACING;
    });
    /* v3.63 (round-22 “auto pick的箭头缺失”): the reference band carries ONE
     * horizontal arrow of the SAME fixed geometry (0.39 in / 1 pt /
     * triangle) under the raised pick label — the reading
     * “N Micrographs —Auto pick→ N particles” (workflow.pptx's
     * 直接箭头连接符 12: rot 270°, head pointing right, at the counts'
     * line height). v3.59 had dropped every inter-item arrow; the pick
     * arrow is back, centred under the “Auto pick” box. */
    if (headerItems.length === 3) {
      const pick = headerSlots[1];
      const ax = pick.x + pick.w / 2 - ARROW_LEN / 2;
      const ay = 0.55 + 0.26 / 2;
      ops.push({ kind: "conn", x1: ax, y1: ay, x2: ax + ARROW_LEN, y2: ay });
    }
    headerBottom = 0.55 + 0.26;
  }

  let cursor = 0.6;
  if (groups.length && headerItems.length) {
    const arrowStart = headerBottom + 0.02;
    ops.push({ kind: "conn", x1: SPINE, y1: arrowStart, x2: SPINE, y2: arrowStart + ARROW_LEN });
    cursor = arrowStart + ARROW_LEN + entryGap(0);
  }

  groups.forEach((group, i) => {
    const parallel = group.length > 1;
    const thumbsTotal = rowThumbTotal(group);
    /* v3.75: per-class stats render under the thumbnails in EVERY style
     * (round-34 “保证所有模式的颗粒数都要显示”) — 极简 included. The band is
     * reserved for multi-thumb rows (uniform pitch) AND for single-map rows
     * that carry stats (the stats now sit UNDER the image — without the
     * reservation the next row's arrow would run through the text box). */
    const hasUnderStats =
      thumbsTotal > 1 || group.some((it) => itemSlotsOf(it).some((s) => s.stats.length));
    const stripW = thumbsTotal * imgW + rowGapUnits(group) * ITEM_GAP;
    /* v3.75: the strip is ALWAYS centred on the spine — classes keep
     * their natural 0,1,2… order (the v3.62 anchor-shift is gone). */
    const x0 = SPINE - stripW / 2;

    const top = cursor;
    const imgBottom = top + imgH;
    const bottom = imgBottom + (hasUnderStats ? STATS_TOP_GAP + UNDER_H : 0);

    const items: PlacedItem[] = [];
    let x = x0;
    group.forEach((item, ii) => {
      const slots = itemSlotsOf(item);
      const itemW = slots.length * imgW + (slots.length - 1) * ITEM_GAP;
      /* v3.75 (round-34 “按照class0,1,2从左到右顺序排列”): NO anchor
       * swap — slots render in the natural class-index order the model
       * sorted them into (classSlotsFor). The selection frame lands on
       * the anchor class wherever it sits. */
      const placed: PlacedSlot[] = [];
      slots.forEach((s, pos) => {
        const tx = x + pos * (imgW + ITEM_GAP);
        const thumb: Box = { x: tx, y: top, w: imgW, h: imgH };
        /* v3.75: stats UNDER the image in every style — multi-thumb rows
         * under their own thumbnail, single-map rows centred on the spine
         * (the old 标准 right-hand hang read as orphaned text and the
         * 极简 deck showed no count at all). STATS_TOP_GAP clears the
         * anchor frame's 0.04 in overhang. */
        let stats: Box | null = null;
        if (s.stats.length) {
          stats =
            thumbsTotal === 1
              ? { x: SPINE - imgW / 2, y: imgBottom + STATS_TOP_GAP, w: imgW, h: 0.26 }
              : { x: tx, y: imgBottom + STATS_TOP_GAP, w: imgW, h: 0.26 };
        }
        placed.push({
          thumb,
          stats,
          statsLines: s.stats,
          key: s.key,
          descr:
            slots.length > 1 && s.groupTag ? `image-${item.uid}_${s.groupTag}` : `image-${item.uid}`,
          count: s.count,
        });
      });
      items.push({ item, left: x, width: itemW, slots: placed });
      x += itemW + ITEM_GAP;
    });

    /* resolve the precomputed anchor to its placed slot — its own
     * natural position (v3.75: no swap, no re-indexing). */
    const ai = anchorInfos[i];
    const anchor = ai ? items[ai.item]?.slots[ai.slot] ?? null : null;

    rows.push({ items, top, bottom, parallel, anchor });

    /* connector + 极简 retention label into the next row */
    if (i + 1 < groups.length) {
      const nextRep = repCounts[i + 1];
      /* v3.62 (round-21 “省略的步骤可能需要写为几*hetero refine或几*abinitio
       * 这样”): the gap note names every stage the model omitted between
       * the two adjacent rows, aggregated per displayed type (capped at 3
       * entries + ellipsis). */
      /* v3.73 (round-32): 标准/简化 decks carry the omission notes too —
       *  their classification-only middle filter names its drops on the
       *  slide exactly like 极简. */
      const oms = fig.omissions?.[i] ?? [];
      const note =
        oms.length > 0
          ? `omitted: ${oms
              .slice(0, 3)
              .map((o) => `${o.count}× ${o.label}`)
              .join(" · ")}${oms.length > 3 ? " · …" : ""}`
          : null;
      /* v3.62 (round-21 “排版还是不太美观”): UNIFORM minimal pitch — every
       * inter-row band keeps the SAME fixed height (retention slot +
       * omission-line slot) whether or not the gap carries a retention
       * label or a note, so rows never sit closer to some neighbours than
       * to others. 标准 keeps the fixed 0.12 connector gap. */
      /* v3.73: a 标准/简化 gap carrying an omission note widens to fit
       *  the note line above the arrow. */
      const gap = minimal ? MIN_GAP_BAND : note ? 0.3 : 0.12;
      const arrowStart = bottom + gap;
      ops.push({ kind: "conn", x1: SPINE, y1: arrowStart, x2: SPINE, y2: arrowStart + ARROW_LEN });
      cursor = arrowStart + ARROW_LEN + entryGap(i + 1);

      if (minimal && (nextRep != null || note)) {
        /* v3.59: the reference's arrow label — the retention percentage
         * and the particle count that continue down the funnel
         * ("37.2%" / "590,421 particles"), centred on the spine in the
         * gap. The percentage line is dropped when the flow did not
         * actually shrink (a single-map pass-through would read 100% —
         * noise, the reference never prints one).
         * v3.63 (round-22 “每步展示的颗粒数和上一步的比例要重新用这一步
         * 除以上一步来计算”): repCounts now carry ENTRY semantics
         * (rowEntryCount) — the count flowing INTO each row — so a
         * merged “N×” row divides by its FIRST member's input (the
         * reference's own 37.2% = 590,421 ÷ the 1,588,675 that entered
         * the 2*Hetero run, not the montage rep's 766,560), and a
         * parallel classification row divides by the SUM of its jobs'
         * counts. nextRep stays the NEXT row's entry — the count that
         * continues down the funnel. */
        const lines: TextLine[] = [];
        const repCur = repCounts[i];
        const pct = repCur && repCur > 0 && nextRep != null ? nextRep / repCur : null;
        if (nextRep != null && pct != null && pct < 0.995) {
          lines.push({ t: `${(pct * 100).toFixed(1)}%`, align: "ctr" });
        }
        if (nextRep != null) {
          lines.push({ t: `${nextRep.toLocaleString("en-US")} particles`, align: "ctr" });
        }
        if (lines.length) {
          const textW = Math.max(...lines.map((l) => estimateTextWidth(l.t ?? "")));
          const w = Math.max(1.05, textW + 0.06);
          ops.push({
            kind: "text",
            x: Math.max(MARGIN_X, SPINE - w / 2),
            y: bottom + 0.01,
            w,
            h: RETAIN_H,
            lines,
          });
        }
        /* v3.62: the omission note — its OWN small gray line in the fixed
         * slot under the retention text (same slot in every gap, note or
         * not). */
        if (note) {
          const noteW = Math.max(1.05, estimateRunsWidth([{ t: note, sz: 650 }]) + 0.06);
          ops.push({
            kind: "text",
            x: Math.max(MARGIN_X, SPINE - noteW / 2),
            /* v3.73: in 标准/简化 the note sits directly under the previous
             *  row (no retention label in this style). */
            y: minimal ? bottom + RETAIN_H + 0.02 : bottom + 0.03,
            w: noteW,
            h: OMIT_H - 0.01,
            lines: [{ runs: [{ t: note, sz: 650, color: "808080" }], align: "ctr" }],
          });
        }
      } else if (note) {
        /* v3.73: the 标准/简化 omission note — a small gray line centred on
         *  the spine in the widened gap, above the connector. */
        const noteW = Math.max(1.05, estimateRunsWidth([{ t: note, sz: 650 }]) + 0.06);
        ops.push({
          kind: "text",
          x: Math.max(MARGIN_X, SPINE - noteW / 2),
          y: bottom + 0.03,
          w: noteW,
          h: OMIT_H - 0.01,
          lines: [{ runs: [{ t: note, sz: 650, color: "808080" }], align: "ctr" }],
        });
      }
    }
  });

  /* ---- emit per-row shapes ---- */
  /* v3.75: per-slot PNG alpha-trim cache — the ChimeraX renders carry
   * huge transparent margins; trimming lets both the thumbnail and the
   * anchor frame hug the actual map (round-34 “框不要比图大太多”). */
  const trimCache = new Map<string, { bytes: Uint8Array; width: number; height: number }>();
  const trimmedBytes = async (
    key: string | null,
    bytes: Uint8Array,
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> => {
    if (!key) return { bytes, width: 1, height: 1 };
    const hit = trimCache.get(key);
    if (hit) return hit;
    const res = await trimPngAlpha(bytes);
    const out = { bytes: res.bytes, width: res.width, height: res.height };
    trimCache.set(key, out);
    return out;
  };
  /** the PLACED (contain-fitted) box of every slot that got real bytes —
   * the anchor frame hugs this, not the raw slot. */
  const placedBySlot = new Map<PlacedSlot, Box>();
  for (const row of rows) {
    for (const p of row.items) {
      if (row.parallel) {
        /* v3.55: parallel rows label each item right-aligned at its own
         * right edge; 标准 uses the compact two-line form (name / id) so
         * siblings never collide; 极简 prints the bare name. The arrow
         * stops ABOVE this band (entryGap), so the text may cross the
         * spine freely. */
        const labelLines: TextLine[] = minimal
          ? [{ align: "r", runs: [{ t: p.item.label, sz: 800 }] }]
          : labelShowsUid(p.item)
            ? [
                { align: "r", runs: [{ t: p.item.label, sz: 700 }] },
                { align: "r", runs: [{ t: p.item.uid, sz: 600, color: UID_COLOR }] },
              ]
            : [{ align: "r", runs: [{ t: p.item.label, sz: 700 }] }];
        ops.push({
          kind: "text",
          x: p.left,
          y: row.top - PLABEL_H,
          w: p.width,
          h: PLABEL_H - 0.04,
          lines: labelLines,
        } as TextOp);
      } else {
        /* single-item row: one right-aligned line ENDING just left of the
         * spine (the reference's “2*Hetero refinement” box ends at 3.62 vs
         * spine 3.69) — the spine arrow passes through the band without
         * ever touching the text. The box widens leftward, clamped to the
         * margin. v3.75: the clearance widened 0.07 → 0.11 in (round-34
         * “箭头和文字避免重叠”). */
        const runs = labelRunsOf(p.item);
        const estW = estimateRunsWidth(runs);
        const right = SPINE - 0.11;
        const lx = Math.max(MARGIN_X, right - estW - 0.06);
        ops.push({
          kind: "text",
          x: lx,
          y: row.top - 0.3,
          w: Math.max(0.4, right - lx),
          h: LABEL_H,
          lines: [{ align: "r", runs }],
        } as TextOp);
      }
      for (const [si, s] of p.slots.entries()) {
        /* thumbnail or placeholder frame */
        const bytes = (s.key && options.images.get(s.key)) || null;
        if (bytes) {
          const t = await trimmedBytes(s.key, bytes);
          const placed = containBox(s.thumb, Math.max(0.05, t.width / Math.max(1, t.height)));
          placedBySlot.set(s, placed);
          pics.push({
            kind: "pic",
            x: placed.x,
            y: placed.y,
            w: placed.w,
            h: placed.h,
            mediaKey: s.key || `img-${si}`,
            descr: s.descr,
            bytes: t.bytes,
          });
        } else {
          ops.push({ kind: "frame", ...s.thumb });
        }
        if (s.stats && s.statsLines.length) {
          ops.push({
            kind: "text",
            ...s.stats,
            lines: s.statsLines.map((t) => ({ t, align: "ctr" as Align })),
          } as TextOp);
        }
      }
    }
    /* v3.73 (round-32 “也需要框出哪些类是下一步用到的”): the selection
     *  rectangle around the flow-anchor class — EVERY style now (the 极简
     *  thin black frame; 标准/简化 frame the same slot above their own
     *  per-class stats). v3.75: the frame hugs the PLACED image box
     *  (post alpha-trim, post contain-fit) — never the empty slot. */
    if (row.anchor) {
      const t = placedBySlot.get(row.anchor) ?? row.anchor.thumb;
      ops.push({ kind: "frame", x: t.x - 0.04, y: t.y - 0.04, w: t.w + 0.08, h: t.h + 0.08 });
    }
  }

  /* ---- final stats ("C1, 3.46 Å") — under the last MAP-BEARING stage
   * (v3.55 rule: an appended FSC montage is a diagnostic panel, not the
   * final map). 极简 centres it on the spine (reference); 标准 keeps the
   * last thumbnail's centre. */
  let contentBottom = rows.length ? Math.max(...rows.map((r) => r.bottom)) : headerBottom;
  if (fig.finalStats && rows.length) {
    let statsRow: PlacedRow | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].items.some((it) => it.item.mapKey)) {
        statsRow = rows[i];
        break;
      }
    }
    if (statsRow) {
      if (minimal) {
        const w = 1.8;
        ops.push({
          kind: "text",
          x: SPINE - w / 2,
          y: statsRow.bottom + 0.1,
          w,
          h: 0.24,
          lines: [{ t: fig.finalStats, align: "ctr" }],
        });
        contentBottom = Math.max(contentBottom, statsRow.bottom + 0.34);
      } else {
        const lastItem = statsRow.items[statsRow.items.length - 1];
        const last = lastItem.slots[lastItem.slots.length - 1].thumb;
        ops.push({
          kind: "text",
          x: Math.max(MARGIN_X, last.x + last.w / 2 - 0.7),
          y: statsRow.bottom + 0.06,
          w: 1.4,
          h: 0.24,
          lines: [{ t: fig.finalStats, align: "ctr" }],
        });
        contentBottom = Math.max(contentBottom, statsRow.bottom + 0.3);
      }
    }
  }

  /* ---- canvas: width fixed at the reference's 7.5 in; height grows with
   * the content (round-18 “可以根据需要改变画布大小”), min 10 in, rounded
   * up to ¼ in. */
  /* footnote — 标准 style only (the 极简 reference carries none).
   * v3.75 (round-34 review): a long footnote WRAPS onto a second line
   * instead of running off the right edge — the segments split at the
   * " · " separators and are packed greedily by estimated width (CJK
   * glyphs count full-em); anything beyond two lines is truncated with
   * an ellipsis so the tail never crowds the canvas edge. */
  const footnoteLines: string[] = [];
  if (options.footnote && !minimal) {
    const segments = options.footnote.split(" · ");
    let line = "";
    for (const seg of segments) {
      const candidate = line ? `${line} · ${seg}` : seg;
      if (footnoteTextWidth(candidate) <= contentW || !line) {
        line = candidate;
      } else {
        footnoteLines.push(line);
        line = seg;
        if (footnoteLines.length === 2) break;
      }
    }
    if (footnoteLines.length < 2 && line) footnoteLines.push(line);
    else if (footnoteLines.length === 2 && line) footnoteLines[1] = `${footnoteLines[1]} · …`;
  }
  const footnoteH = footnoteLines.length > 1 ? 0.34 : 0.2;
  const tail = minimal ? 0.4 : options.footnote ? 0.5 + footnoteH : 0.45;
  const slideH = Math.max(MIN_SLIDE_H_IN, Math.ceil((contentBottom + tail) * 4) / 4);

  if (footnoteLines.length) {
    ops.push({
      kind: "text",
      x: MARGIN_X,
      y: slideH - 0.16 - footnoteH,
      w: contentW,
      h: footnoteH,
      sz: 700,
      color: "808080",
      lines: footnoteLines.map((t) => ({ t, align: "l" as Align })),
    });
  }

  return assemble(ops, pics, fig, slideH);
}

/* ------------------------------------------------------------------ */
/* Package assembly                                                    */
/* ------------------------------------------------------------------ */

function assemble(ops: Op[], pics: PicOp[], fig: FlowFigureModel, slideHIn: number): Blob {
  // Dedup media by marker key.
  const mediaByKey = new Map<string, Uint8Array>();
  for (const pic of pics) {
    if (!mediaByKey.has(pic.mediaKey)) mediaByKey.set(pic.mediaKey, pic.bytes);
  }
  const mediaNames = new Map<string, string>();
  const relFor = new Map<string, string>();
  let mediaIndex = 0;
  for (const key of mediaByKey.keys()) {
    mediaIndex += 1;
    mediaNames.set(key, `image${mediaIndex}.png`);
    relFor.set(key, `rId${mediaIndex + 1}`);
  }

  let id = 1;
  let body = ops
    .map((op) => {
      id += 1;
      if (op.kind === "text") return textXml(id, op);
      if (op.kind === "frame") return frameXml(id, op);
      if (op.kind === "conn") return connXml(id, op);
      return "";
    })
    .join("");
  pics.forEach((pic) => {
    id += 1;
    body += picXml(id, pic, relFor.get(pic.mediaKey) as string);
  });

  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  const mediaRelXml = [...mediaNames.entries()]
    .map(([key, name]) => `<Relationship Id="${relFor.get(key)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`)
    .join("");
  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${mediaRelXml}</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const now = new Date().toISOString();
  const files: ZipFileEntry[] = [
    { name: "[Content_Types].xml", data: contentTypes },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>CryoSmart Workflow ${esc(fig.projectLabel)}</dc:title><dc:creator>CryoSmart Lineage Tracer</dc:creator><cp:lastModifiedBy>CryoSmart Lineage Tracer</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CryoSmart Lineage Tracer</Application><PresentationFormat>Custom</PresentationFormat><Slides>1</Slides></Properties>`,
    },
    {
      /* v3.59: PORTRAIT canvas — width locked to the reference's 7.5 in,
       * height dynamic (buildWorkflowPptx). The `type` attribute is
       * OPTIONAL per CT_SlideSize and is omitted (no stock type matches a
       * grown canvas; the reference itself tags 7.5×10 as screen4x3). */
      name: "ppt/presentation.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${IN(PAGE_W_IN)}" cy="${IN(slideHIn)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    },
    {
      name: "ppt/theme/theme1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="0D9488"/></a:accent1><a:accent2><a:srgbClr val="666666"/></a:accent2><a:accent3><a:srgbClr val="999999"/></a:accent3><a:accent4><a:srgbClr val="CCCCCC"/></a:accent4><a:accent5><a:srgbClr val="333333"/></a:accent5><a:accent6><a:srgbClr val="777777"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="65000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="98000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="99000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:shade val="109000"/><a:satMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:shade val="98000"/><a:satMod val="102000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="90000"/><a:satMod val="101000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="rnd" cmpd="sqr" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln><a:ln w="12700" cap="rnd" cmpd="sqr" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln><a:ln w="19050" cap="rnd" cmpd="sqr" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst="orthographicFront"><a:rot rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d><a:sp3d/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="103000"/></a:schemeClr></a:gs></a:gsLst><a:lin scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="115000"/><a:shade val="98000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="103000"/><a:shade val="90000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`,
    },
    { name: "ppt/slides/slide1.xml", data: slideXml },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: slideRels },
  ];

  for (const [key, name] of mediaNames) {
    const bytes = mediaByKey.get(key);
    if (bytes) {
      files.push({ name: `ppt/media/${name}`, data: bytes });
    }
  }

  return makeZip(files, PPTX_CONTENT_TYPE);
}
