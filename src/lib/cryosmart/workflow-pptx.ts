/**
 * 16:9 workflow-figure PPTX builder (v3.41).
 *
 * Format modelled after the user's reference `upload/Workflow.pptx`
 * (WPS-authored, single 12192000 × 6858000 EMU slide):
 *   - 8 pt Arial text runs (East-Asian font 微软雅黑), black on white
 *   - a header text row: "N Micrographs" → "Auto pick" → "N particles"
 *   - map thumbnails (3.1 × 1.56 in, no border) with right-aligned labels
 *     above them, stacked vertically for parallel branches with tiny
 *     vertical arrows between
 *   - 2-line stat boxes ("32.9%" / "1638k particles") beside each thumbnail
 *   - straightConnector1 (w=12700, triangle tail) between aligned stages,
 *     bentConnector3 (arrow tail) for cross-height transitions
 *   - final resolution text bottom-right ("C1, 3.46 Å" style)
 *   - a thin-black-border empty frame when a thumbnail is unavailable
 *
 * Map thumbnails keep the `name="CryoSmartImage:<uid>/<group>"` marker on
 * <p:cNvPr> (same contract as the A4 picture-flow PPTX) so the desktop
 * ChimeraX helpers remain interchangeable.
 *
 * Hand-rolled OOXML + the existing pure-TS ZIP writer — no dependencies.
 */

import { makeZip, type ZipFileEntry } from "./zip";
import { PPTX_CONTENT_TYPE } from "./constants";
import { imageDims, type FlowFigureModel, type FlowFigureItem } from "./workflow-figure";

/* ------------------------------------------------------------------ */
/* Units & slide constants                                             */
/* ------------------------------------------------------------------ */

const EMU = 914400;
const SLIDE_W_EMU = 12192000;
const SLIDE_H_EMU = 6858000;
const SLIDE_W_IN = SLIDE_W_EMU / EMU; // 13.333…
const SLIDE_H_IN = SLIDE_H_EMU / EMU; // 7.5

const IN = (v: number) => Math.round(v * EMU);
const FONT = "Arial";
const EA_FONT = "微软雅黑";

/* ------------------------------------------------------------------ */
/* Logical ops                                                         */
/* ------------------------------------------------------------------ */

type Align = "l" | "ctr" | "r";

interface TextOp {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Array<{ t: string; align: Align }>;
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

interface ConnOp {
  kind: "conn";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bent?: boolean;
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
    .map((line) => `<a:p><a:pPr algn="${line.align}"/><a:r>${rPr(op)}<a:t>${esc(line.t)}</a:t></a:r><a:endParaRPr lang="zh-CN" altLang="en-US" sz="${op.sz ?? 800}"><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:endParaRPr></a:p>`)
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="文本框 ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function frameXml(id: number, op: FrameOp): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="矩形 ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p></p:txBody></p:sp>`;
}

function connXml(id: number, op: ConnOp): string {
  const offX = Math.min(op.x1, op.x2);
  const offY = Math.min(op.y1, op.y2);
  const extX = Math.abs(op.x2 - op.x1);
  const extY = Math.abs(op.y2 - op.y1);
  const flipH = op.x2 < op.x1 ? ' flipH="1"' : "";
  const flipV = op.y2 < op.y1 ? ' flipV="1"' : "";
  const prst = op.bent ? "bentConnector3" : "straightConnector1";
  const tail = op.bent ? '<a:tailEnd type="arrow"/>' : '<a:tailEnd type="triangle"/>';
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="连接符 ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH}${flipV}><a:off x="${IN(offX)}" y="${IN(offY)}"/><a:ext cx="${IN(extX)}" cy="${IN(extY)}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>${tail}</a:ln></p:spPr></p:cxnSp>`;
}

function picXml(id: number, op: PicOp, relId: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="CryoSmartImage:${esc(op.mediaKey)}" descr="${esc(op.descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${IN(op.x)}" y="${IN(op.y)}"/><a:ext cx="${IN(op.w)}" cy="${IN(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface BuildPptxOptions {
  /** Bottom-left footnote (alignment / handedness summary). */
  footnote?: string | null;
  /** Thumbnail image bytes keyed by `item.mapKey` OR `item.imageUrl`. */
  images: Map<string, Uint8Array>;
}

interface ItemPlacement {
  item: FlowFigureItem;
  label: Box;
  image: Box;
  stats: Box | null;
  groupCx: number;
}

function estimateTextWidth(text: string): number {
  return Math.max(0.6, text.length * 0.062 + 0.22);
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

export function buildWorkflowPptx(
  fig: FlowFigureModel,
  options: BuildPptxOptions,
): Blob {
  const ops: Op[] = [];
  const pics: PicOp[] = [];
  const MARGIN_X = 0.45;
  const contentW = SLIDE_W_IN - 2 * MARGIN_X;

  /* ---- header band: "N Micrographs" → "Auto pick" → "N particles" ---- */
  const headerItems = [
    fig.headerStats.micrographs,
    fig.headerStats.pick,
    fig.headerStats.particles,
  ].filter((t): t is string => !!t);
  if (headerItems.length) {
    const widths = headerItems.map(estimateTextWidth);
    const ARROW = 0.36;
    const total = widths.reduce((a, b) => a + b, 0) + ARROW * (headerItems.length - 1);
    let hx = (SLIDE_W_IN - total) / 2;
    const aligns: Align[] = ["ctr", "r", "ctr"];
    headerItems.forEach((text, i) => {
      ops.push({
        kind: "text",
        x: hx,
        y: 0.52,
        w: widths[i],
        h: 0.26,
        lines: [{ t: text, align: aligns[i] ?? "ctr" }],
      });
      hx += widths[i];
      if (i < headerItems.length - 1) {
        ops.push({
          kind: "conn",
          x1: hx + 0.02,
          y1: 0.65,
          x2: hx + ARROW - 0.02,
          y2: 0.65,
        });
        hx += ARROW;
      }
    });
  }

  /* ---- stage groups ---- */
  const groups = fig.groups.filter((g) => g.length > 0);
  const n = Math.max(1, groups.length);
  const slot = contentW / n;
  const statsSide = n <= 3;
  const IMG_RATIO = 0.5; // 2:1 thumbnails
  const imgW = Math.max(1.2, Math.min(3.12, slot - (statsSide ? 1.18 : 0.38)));
  const imgH = imgW * IMG_RATIO;
  const labelH = 0.22;
  const statsW = 0.95;
  const statsH = 0.42;
  const statsUnderH = 0.24;
  const itemH = labelH + imgH + (statsSide ? 0 : statsUnderH);
  const gap = 0.3;
  const bandTop = 1.35;
  const bandBottom = 6.78;

  const placements: ItemPlacement[][] = [];
  const groupContentW = imgW + (statsSide ? statsW + 0.08 : 0);

  groups.forEach((group, gi) => {
    const groupH = group.length * itemH + (group.length - 1) * gap;
    const top = bandTop + Math.max(0, (bandBottom - bandTop - groupH) / 2);
    const itemX = MARGIN_X + gi * slot + (slot - groupContentW) / 2;
    const list: ItemPlacement[] = [];
    let cur = top;
    group.forEach((item, ii) => {
      const label: Box = { x: itemX, y: cur, w: imgW, h: labelH };
      const image: Box = { x: itemX, y: cur + labelH, w: imgW, h: imgH };
      const stats: Box | null = item.stats.length
        ? statsSide
          ? { x: itemX + imgW + 0.08, y: image.y + imgH / 2 - statsH / 2, w: statsW, h: statsH }
          : { x: itemX, y: image.y + imgH + 0.01, w: imgW, h: statsUnderH }
        : null;
      list.push({ item, label, image, stats, groupCx: itemX + imgW / 2 });
      cur += itemH + (ii < group.length - 1 ? gap : 0);
    });
    placements.push(list);
  });

  /* emit per-group shapes */
  placements.forEach((list, gi) => {
    list.forEach((p, ii) => {
      ops.push({
        kind: "text",
        ...p.label,
        lines: [{ t: p.item.label, align: "r" }],
      } as TextOp);
      // Thumbnail or placeholder frame.
      const bytes =
        (p.item.mapKey && options.images.get(p.item.mapKey)) ||
        (p.item.imageUrl && options.images.get(p.item.imageUrl)) ||
        null;
      if (bytes) {
        const dims = imageDims(bytes);
        const placed = containBox(p.image, Math.max(0.05, dims.width / Math.max(1, dims.height)));
        pics.push({
          kind: "pic",
          x: placed.x,
          y: placed.y,
          w: placed.w,
          h: placed.h,
          mediaKey: p.item.mapKey || p.item.imageUrl || `img-${gi}-${ii}`,
          descr: `image-${p.item.uid}`,
          bytes,
        });
      } else {
        ops.push({ kind: "frame", ...p.image });
      }
      if (p.stats) {
        ops.push({
          kind: "text",
          ...p.stats,
          lines: p.item.stats.map((t) => ({ t, align: "ctr" as Align })),
        } as TextOp);
      }
      if (ii < list.length - 1) {
        // Tiny vertical arrow between stacked branches.
        const nextLabel = list[ii + 1].label;
        ops.push({
          kind: "conn",
          x1: p.groupCx,
          y1: p.image.y + p.image.h + 0.02,
          x2: p.groupCx,
          y2: nextLabel.y - 0.02,
        });
      }
    });
  });

  /* connectors between groups */
  for (let gi = 0; gi + 1 < placements.length; gi++) {
    const src = placements[gi];
    const tgt = placements[gi + 1];
    const srcItem = src[src.length - 1];
    const tgtItem = tgt[0];
    const srcRight = srcItem.image.x + srcItem.image.w + (statsSide ? statsW + 0.08 : 0);
    const srcY = srcItem.image.y + srcItem.image.h / 2;
    const tgtLeft = tgtItem.image.x;
    const tgtY = tgtItem.image.y + tgtItem.image.h / 2;
    const bent = Math.abs(srcY - tgtY) > 0.06;
    ops.push({
      kind: "conn",
      x1: srcRight + 0.03,
      y1: srcY,
      x2: tgtLeft - 0.03,
      y2: tgtY,
      bent,
    });
  }

  /* header → first stage vertical arrow */
  if (headerItems.length && placements.length) {
    const first = placements[0][0];
    ops.push({
      kind: "conn",
      x1: first.groupCx,
      y1: 0.84,
      x2: first.groupCx,
      y2: first.label.y - 0.03,
    });
  }

  /* final stats ("3.46 Å") under the last group */
  if (fig.finalStats && placements.length) {
    const lastGroup = placements[placements.length - 1];
    const lastItem = lastGroup[lastGroup.length - 1];
    const cx = lastItem.image.x + lastItem.image.w / 2;
    const y = lastItem.stats && !statsSide ? lastItem.stats.y + lastItem.stats.h + 0.05 : lastItem.image.y + lastItem.image.h + (lastItem.item.stats.length && !statsSide ? statsUnderH + 0.05 : 0.05);
    ops.push({
      kind: "text",
      x: Math.max(MARGIN_X, cx - 0.7),
      y,
      w: 1.4,
      h: 0.24,
      lines: [{ t: fig.finalStats, align: "ctr" }],
    });
  }

  /* footnote */
  if (options.footnote) {
    ops.push({
      kind: "text",
      x: MARGIN_X,
      y: SLIDE_H_IN - 0.34,
      w: contentW,
      h: 0.2,
      sz: 750,
      color: "808080",
      lines: [{ t: options.footnote, align: "l" }],
    });
  }

  return assemble(ops, pics, fig);
}

/* ------------------------------------------------------------------ */
/* Package assembly                                                    */
/* ------------------------------------------------------------------ */

function assemble(ops: Op[], pics: PicOp[], fig: FlowFigureModel): Blob {
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
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CryoSmart Lineage Tracer</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>1</Slides></Properties>`,
    },
    {
      name: "ppt/presentation.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${SLIDE_W_EMU}" cy="${SLIDE_H_EMU}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    },
    {
      name: "ppt/theme/theme1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="0D9488"/></a:accent1><a:accent2><a:srgbClr val="666666"/></a:accent2><a:accent3><a:srgbClr val="999999"/></a:accent3><a:accent4><a:srgbClr val="CCCCCC"/></a:accent4><a:accent5><a:srgbClr val="333333"/></a:accent5><a:accent6><a:srgbClr val="777777"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${EA_FONT}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
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
