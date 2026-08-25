#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsonFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.readdirSync(here).find((name) => /_lineage\.json$/i.test(name));

if (!jsonFile) {
  console.error("No *_lineage.json found. Put this script in the CryoSmart lineage folder, or pass the JSON path.");
  process.exit(1);
}

const inputJson = path.resolve(here, jsonFile);
const reportDir = path.dirname(inputJson);
const summary = JSON.parse(fs.readFileSync(inputJson, "utf8"));
const baseName = path.basename(inputJson, ".json");
const outputFile = path.join(reportDir, `${baseName}_picture_flow_local.pptx`);

const SLIDE_W_IN = 8.27;
const SLIDE_H_IN = 11.69;
const EMU = 914400;
const FONT = "Times New Roman";
const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "";
}

function emu(value) {
  return Math.round(value * EMU);
}

function sz(points) {
  return Math.round(points * 100);
}

function nodeNum(uid) {
  const m = String(uid || "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function safePart(value) {
  return String(value || "item")
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function nodeByUid(uid) {
  return (summary.nodes || []).find((node) => node.uid === uid) || {};
}

function imagePath(uid, name) {
  const file = path.join(reportDir, "images", safePart(uid), `${safePart(name)}.png`);
  return fs.existsSync(file) ? file : null;
}

function firstExisting(paths) {
  return paths.find((file) => file && fs.existsSync(file)) || null;
}

function listNodePngs(uid) {
  const dir = path.join(reportDir, "images", safePart(uid));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.png$/i.test(name))
    .map((name) => path.join(dir, name));
}

function imageInfo(file) {
  const bytes = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase().replace(".", "") || "png";
  let width = 1;
  let height = 1;
  if (bytes.length > 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += 2 + len;
    }
  }
  return { file, bytes, ext: ext === "jpg" ? "jpeg" : ext, width, height };
}

function contain(info, x, y, w, h) {
  const ratio = info.width / Math.max(1, info.height);
  let bw = w;
  let bh = w / ratio;
  if (bh > h) {
    bh = h;
    bw = h * ratio;
  }
  return { x: x + (w - bw) / 2, y: y + (h - bh) / 2, w: bw, h: bh };
}

function selectedClassSet(uid) {
  const selected = new Set();
  for (const edge of summary.edges || []) {
    if (edge.source !== uid) continue;
    const values = [edge.source_group, ...(edge.slots || []).map((slot) => slot.source_group)];
    for (const value of values) {
      const m = String(value || "").match(/(?:particles|volume)_class_(\d+)/);
      if (m) selected.add(Number(m[1]));
    }
  }
  return selected;
}

function classJobs() {
  return (summary.class_split_jobs || [])
    .filter((job) => Array.isArray(job.classes) && job.classes.length)
    .sort((a, b) => nodeNum(a.uid) - nodeNum(b.uid));
}

function selectNodes() {
  return (summary.nodes || [])
    .filter((node) => node.select_2d)
    .sort((a, b) => nodeNum(a.uid) - nodeNum(b.uid));
}

function micrographNodes() {
  return (summary.nodes || [])
    .filter((node) => node.job_type === "import_micrographs")
    .sort((a, b) => nodeNum(a.uid) - nodeNum(b.uid));
}

function finalMapNodes() {
  const classIds = new Set(classJobs().map((job) => job.uid));
  return (summary.nodes || [])
    .filter((node) => !classIds.has(node.uid))
    .filter((node) => listNodePngs(node.uid).some((file) => /volume|map/i.test(path.basename(file))))
    .sort((a, b) => nodeNum(a.uid) - nodeNum(b.uid));
}

function addSlide(slides, title) {
  const slide = { title, ops: [], images: [] };
  slides.push(slide);
  addText(slide, 0.35, 0.28, SLIDE_W_IN - 0.7, 0.28, title, { fontSize: 10, bold: true, align: "center" });
  return slide;
}

function addText(slide, x, y, w, h, text, opts = {}) {
  slide.ops.push({ kind: "text", x, y, w, h, text: String(text || ""), opts });
}

function addRect(slide, x, y, w, h, opts = {}) {
  slide.ops.push({ kind: "rect", x, y, w, h, opts });
}

function addLine(slide, x1, y1, x2, y2, opts = {}) {
  slide.ops.push({ kind: "line", x1, y1, x2, y2, opts });
}

function addImage(slide, file, x, y, w, h, opts = {}) {
  if (!file || !fs.existsSync(file)) return null;
  const info = imageInfo(file);
  const box = opts.stretch ? { x, y, w, h } : contain(info, x, y, w, h);
  const id = opts.id || `img${slide.images.length + 1}_${safePart(path.basename(file, path.extname(file)))}`;
  slide.images.push({ id, ...info });
  slide.ops.push({ kind: "image", id, ...box });
  if (opts.border) addRect(slide, box.x, box.y, box.w, box.h, { line: "000000", width: 1.4 });
  return box;
}

function addArrowDown(slide, y) {
  const x = SLIDE_W_IN / 2;
  addLine(slide, x, y, x, y + 0.28, { color: "111111", width: 0.8, arrow: true });
}

function metricLine(node, extra = []) {
  const parts = [];
  if (Number.isFinite(node.micrograph_count)) parts.push(`${fmt(node.micrograph_count)} micrographs`);
  if (Number.isFinite(node.pixel_size_A)) parts.push(`pixel ${String(node.pixel_size_A).replace(/0+$/, "").replace(/\.$/, "")} A/px`);
  if (Number.isFinite(node.particle_count)) parts.push(`${fmt(node.particle_count)} particles`);
  if (Number.isFinite(node.resolution_A)) parts.push(`${node.resolution_A} A`);
  for (const item of extra) if (item) parts.push(item);
  return parts.join("  ");
}

function buildSlides() {
  const slides = [];
  let slide = addSlide(slides, `CryoSmart ${summary.project_uid || ""} / ${summary.start_uid || ""}`);
  let y = 0.78;

  function ensure(height) {
    if (y + height < SLIDE_H_IN - 0.35) return;
    slide = addSlide(slides, `CryoSmart ${summary.project_uid || ""} / ${summary.start_uid || ""}`);
    y = 0.78;
  }

  const micros = micrographNodes();
  if (micros.length) {
    ensure(1.45);
    addText(slide, 0.45, y, 7.4, 0.16, "Micrographs", { fontSize: 7, bold: true });
    y += 0.22;
    const shown = micros.slice(0, 3);
    const cellW = 2.28;
    shown.forEach((node, index) => {
      const x = 0.48 + index * 2.58;
      const imageName = ["imported_small", "imported_smaller", "imported_smallest", "imported_micrographs"].find((name) => imagePath(node.uid, name));
      addText(slide, x, y, cellW, 0.14, `${node.job_type}`, { fontSize: 6, bold: true, align: "center" });
      addText(slide, x, y + 0.14, cellW, 0.12, metricLine(node), { fontSize: 5, align: "center" });
      const file = imageName ? imagePath(node.uid, imageName) : null;
      addImage(slide, file, x + 0.28, y + 0.32, 1.72, 0.92, { id: `${node.uid}/${imageName || "image"}` });
    });
    y += 1.38;
    addArrowDown(slide, y - 0.12);
    y += 0.24;
  }

  for (const node of selectNodes()) {
    ensure(2.05);
    const s = node.select_2d || {};
    const input = Number(node.particle_count || s.particles_input || s.particles_selected || 0);
    const selected = Number(s.particles_selected || 0);
    const ratio = input && selected ? `${Math.round(selected / input * 1000) / 10}%` : "";
    addText(slide, 0.45, y, 7.4, 0.16, node.job_type || "select_2D", { fontSize: 7, bold: true, align: "center" });
    y += 0.16;
    addText(slide, 0.45, y, 7.4, 0.13, [
      input ? `${fmt(input)} particles` : "",
      s.classes_selected ? `${s.classes_selected} classes` : "",
      selected ? `${fmt(selected)} selected` : "",
      ratio
    ].filter(Boolean).join("  "), { fontSize: 5.8, align: "center" });
    y += 0.2;
    const file = firstExisting([
      imagePath(node.uid, "selected_classes"),
      imagePath(node.uid, "templates_selected"),
      ...listNodePngs(node.uid).filter((item) => /selected|template/i.test(path.basename(item)))
    ]);
    addImage(slide, file, 0.55, y, 7.15, 1.3, { id: `${node.uid}/selected_classes` });
    y += 1.46;
    addArrowDown(slide, y - 0.08);
    y += 0.22;
  }

  for (const job of classJobs()) {
    const node = nodeByUid(job.uid);
    const classes = job.classes.slice().sort((a, b) => a.class_index - b.class_index);
    const selected = selectedClassSet(job.uid);
    const columns = classes.length <= 6 ? 1 : 3;
    const itemW = columns === 1 ? 5.6 : 2.15;
    const itemH = columns === 1 ? 0.72 : 0.94;
    const totalRows = Math.ceil(classes.length / columns);
    ensure(0.55 + totalRows * itemH);
    addText(slide, 0.45, y, 7.4, 0.16, node.job_type || job.job_type, { fontSize: 7, bold: true, align: "center" });
    y += 0.16;
    addText(slide, 0.45, y, 7.4, 0.13, metricLine(node, [`${classes.length} classes`]), { fontSize: 5.8, align: "center" });
    y += 0.24;
    const startX = columns === 1 ? 1.35 : 0.55;
    classes.forEach((cls, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = startX + col * (itemW + 0.35);
      const iy = y + row * itemH;
      const file = imagePath(job.uid, cls.volume_group || `volume_class_${cls.class_index}`);
      addImage(slide, file, x, iy, columns === 1 ? 0.65 : 1.05, columns === 1 ? 0.55 : 0.62, { id: `${job.uid}/${cls.volume_group || `volume_class_${cls.class_index}`}`, border: selected.has(cls.class_index) });
      addText(slide, x + (columns === 1 ? 0.8 : 0), iy + (columns === 1 ? 0.08 : 0.66), columns === 1 ? 4.65 : 1.05, 0.12,
        [cls.particle_percent ? `${cls.particle_percent}%` : "", cls.particle_count ? fmt(cls.particle_count) : ""].filter(Boolean).join("  "),
        { fontSize: 6, align: columns === 1 ? "left" : "center" });
    });
    y += totalRows * itemH + 0.18;
    addArrowDown(slide, y - 0.08);
    y += 0.22;
  }

  for (const node of finalMapNodes()) {
    ensure(1.5);
    addText(slide, 0.45, y, 7.4, 0.16, node.job_type || node.uid, { fontSize: 7, bold: true, align: "center" });
    y += 0.16;
    addText(slide, 0.45, y, 7.4, 0.13, metricLine(node), { fontSize: 5.8, align: "center" });
    y += 0.22;
    const file = firstExisting([
      imagePath(node.uid, "volume"),
      ...listNodePngs(node.uid).filter((item) => /volume|map/i.test(path.basename(item)))
    ]);
    const imageName = file ? path.basename(file, path.extname(file)) : "volume";
    addImage(slide, file, 2.65, y, 2.95, 1.0, { id: `${node.uid}/${imageName}` });
    y += 1.22;
  }

  return slides;
}

function pptTextXml(id, op) {
  const align = op.opts.align === "center" ? "ctr" : op.opts.align === "right" ? "r" : "l";
  const bold = op.opts.bold ? ' b="1"' : "";
  const color = op.opts.color || "111111";
  const paragraphs = String(op.text || "").split(/\n/).map((line) => `
        <a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${sz(op.opts.fontSize || 6)}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/></a:rPr><a:t>${esc(line)}</a:t></a:r></a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(op.x)}" y="${emu(op.y)}"/><a:ext cx="${emu(op.w)}" cy="${emu(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function pptRectXml(id, op) {
  const line = op.opts.line || "111111";
  const width = Math.max(1, Math.round((op.opts.width || 1) * 12700));
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rect ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(op.x)}" y="${emu(op.y)}"/><a:ext cx="${emu(op.w)}" cy="${emu(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="${width}"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr></p:sp>`;
}

function pptLineXml(id, op) {
  const width = Math.max(1, Math.round((op.opts.width || 0.7) * 12700));
  const color = op.opts.color || "111111";
  const arrow = op.opts.arrow ? '<a:tailEnd type="triangle"/>' : "";
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${emu(Math.min(op.x1, op.x2))}" y="${emu(Math.min(op.y1, op.y2))}"/><a:ext cx="${emu(Math.abs(op.x2 - op.x1))}" cy="${emu(Math.abs(op.y2 - op.y1))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${arrow}</a:ln></p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style></p:cxnSp>`;
}

function pptImageXml(id, op, relId) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="CryoSmartImage:${esc(op.id || `Picture ${id}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(op.x)}" y="${emu(op.y)}"/><a:ext cx="${emu(op.w)}" cy="${emu(op.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function slideXml(slide, relIds) {
  let id = 2;
  const body = slide.ops.map((op) => {
    id += 1;
    if (op.kind === "text") return pptTextXml(id, op);
    if (op.kind === "rect") return pptRectXml(id, op);
    if (op.kind === "line") return pptLineXml(id, op);
    if (op.kind === "image") return pptImageXml(id, op, relIds.get(op.id));
    return "";
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRelsXml(rels) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels.map((rel) => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${rel.mediaName}"/>`).join("")}</Relationships>`;
}

function contentTypesXml(slides, media) {
  const mediaDefaults = Array.from(new Set(media.map((item) => item.ext))).map((ext) => {
    const type = ext === "jpeg" ? "image/jpeg" : "image/png";
    return `<Default Extension="${ext}" ContentType="${type}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${mediaDefaults}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function presentationXml(slides) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(SLIDE_W_IN)}" cy="${emu(SLIDE_H_IN)}" type="A4"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function presentationRelsXml(slides) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`;
}

function staticXmlFiles(slideCount) {
  return [
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(baseName)}</dc:title><dc:creator>CryoSmart Lineage Tracer</dc:creator><cp:lastModifiedBy>CryoSmart Lineage Tracer</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>CryoSmart Lineage Tracer</Application><PresentationFormat>A4</PresentationFormat><Slides>${slideCount}</Slides></Properties>` },
    { name: "ppt/slideMasters/slideMaster1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>` },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>` },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` },
    { name: "ppt/theme/theme1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="000000"/></a:accent1><a:accent2><a:srgbClr val="666666"/></a:accent2><a:accent3><a:srgbClr val="999999"/></a:accent3><a:accent4><a:srgbClr val="CCCCCC"/></a:accent4><a:accent5><a:srgbClr val="333333"/></a:accent5><a:accent6><a:srgbClr val="777777"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>` }
  ];
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value & 0xffff, 0);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data));
    const crc = crc32(data);
    const localHeader = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(localHeader, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += localHeader.length + data.length;
  }
  const localData = Buffer.concat(local);
  const centralData = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(localData.length), u16(0)]);
  return Buffer.concat([localData, centralData, end]);
}

const slides = buildSlides();
const files = [
  { name: "[Content_Types].xml", data: "" },
  { name: "_rels/.rels", data: rootRelsXml() },
  { name: "ppt/presentation.xml", data: presentationXml(slides) },
  { name: "ppt/_rels/presentation.xml.rels", data: presentationRelsXml(slides) },
  ...staticXmlFiles(slides.length)
];
const media = [];

slides.forEach((slide, index) => {
  const rels = [];
  const relIds = new Map();
  slide.images.forEach((image) => {
    const mediaName = `image${media.length + 1}.${image.ext}`;
    media.push({ ...image, mediaName });
    const relId = `rId${rels.length + 2}`;
    relIds.set(image.id, relId);
    rels.push({ id: relId, mediaName });
  });
  files.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slide, relIds) });
  files.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: slideRelsXml(rels) });
});

for (const item of media) {
  files.push({ name: `ppt/media/${item.mediaName}`, data: item.bytes });
}
files[0].data = contentTypesXml(slides, media);

fs.writeFileSync(outputFile, zip(files));
console.log(`Wrote ${outputFile}`);
