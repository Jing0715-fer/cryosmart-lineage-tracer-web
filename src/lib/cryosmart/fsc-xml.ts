/**
 * FSC-curve XML parser + canvas renderer (browser-safe).
 *
 * v3.41 — parses the `*.volume.fsc.xml` file captured by the Smart Capture
 * script (v3.40) into `FscCurve` points (same shape as `parseFscText`), and
 * renders a publication-style FSC plot to PNG bytes for the workflow-figure
 * PPTX. XML schemas vary between CryoSmart builds, so the parser is
 * deliberately tolerant:
 *
 *   1. List-style leaves:  <correlation>1.0 0.98 0.9 ...</correlation>
 *   2. Point-wise leaves:  <point><resolution>0.05</resolution><value>0.9</value></point> ...
 *   3. Multiple curves when wrapped in containers named curve/fsc/iteration/series.
 *
 * Axis auto-detection: the x array may be spatial frequency (cycles/px or
 * 1/Å) or resolution in Å — both are normalised to physical frequency (1/Å)
 * when a pixel size is supplied, otherwise raw frequency is kept.
 */

import type { FscCurve, FscParseResult } from "./fsc-parser";

const FSC_XML_THRESHOLD = 0.143;

export interface FscXmlParseOptions {
  /** Pixel size in Å — lets cycles/pixel data be converted to 1/Å. */
  pixelSizeA?: number | null;
}

interface LeafAccumulator {
  /** tag-name (lower-cased) → numeric values in document order */
  arrays: Map<string, number[]>;
}

function parseNumList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const v = Number(part);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function isCurveContainer(name: string): boolean {
  return /curve|fsc|iteration|series|graph/i.test(name);
}

function collectLeafNumbers(el: Element, acc: LeafAccumulator, scope: string): void {
  // Depth-first walk. A "leaf" is an element with no element children.
  let hasElementChild = false;
  for (let i = 0; i < el.children.length; i++) {
    hasElementChild = true;
    collectLeafNumbers(el.children[i], acc, scope);
  }
  if (hasElementChild) return;

  const directText = Array.from(el.childNodes)
    .filter((n) => n.nodeType === n.TEXT_NODE)
    .map((n) => n.textContent || "")
    .join(" ");
  const nums = parseNumList(directText);
  if (!nums.length) return;
  const key = `${scope}\u0000${el.tagName.toLowerCase()}`;
  const list = acc.arrays.get(key) || [];
  list.push(...nums);
  acc.arrays.set(key, list);
}

function scopeOf(el: Element | null): string {
  // Returns a scope id: containers that look like separate curves split the
  // document; everything else shares the "" scope.
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    if (isCurveContainer(cur.tagName)) parts.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
  }
  return parts.join("/");
}

function findCurveContainers(root: Element): Element[] {
  const containers: Element[] = [];
  const walk = (el: Element) => {
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children[i];
      if (isCurveContainer(c.tagName)) containers.push(c);
      walk(c);
    }
  };
  walk(root);
  return containers;
}

type AxisKind = "frequency" | "resolution" | "cycles-per-pixel";

function pickAxisPair(
  arrays: Map<string, number[]>,
  pixelSizeA: number | null,
): { points: Array<{ frequency: number; correlation: number }>; xKind: AxisKind } | null {
  const names = Array.from(arrays.keys());
  if (names.length < 2) return null;

  const scoreName = (n: string) => {
    if (/res|resolution|angst|freq|frequency|shell|\bx\b|\br\b/i.test(n)) return 3;
    if (/coord|index|bin/i.test(n)) return 2;
    return 0;
  };
  const corrScoreName = (n: string) => {
    if (/corr|fsc|coefficient|\bvalue\b|\by\b/i.test(n)) return 3;
    return 0;
  };

  // Best x candidate: highest-scoring name with the longest array.
  let xName: string | null = null;
  let xBest = -1;
  let yName: string | null = null;
  let yBest = -1;
  for (const n of names) {
    const len = (arrays.get(n) || []).length;
    const sx = scoreName(n) * 1e6 + len;
    if (sx > xBest && !/corr|fsc/i.test(n)) {
      xBest = sx;
      xName = n;
    }
    const sy = corrScoreName(n) * 1e6 + len;
    if (sy > yBest && !/res|freq|shell/i.test(n)) {
      yBest = sy;
      yName = n;
    }
  }
  if (!xName || !yName || xName === yName) {
    // Fallback: the two longest arrays (document order for x).
    const sorted = names
      .map((n) => ({ n, len: (arrays.get(n) || []).length }))
      .sort((a, b) => b.len - a.len);
    if (sorted.length < 2) return null;
    xName = sorted[0].n;
    yName = sorted[1].n;
  }

  const xs = arrays.get(xName) || [];
  const ys = arrays.get(yName) || [];
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;

  // Determine x axis kind.
  const max = Math.max(...xs);
  const min = Math.min(...xs);
  let xKind: AxisKind = "frequency";
  if (max > 1.2) {
    xKind = "resolution";
  } else if (max <= 0.51 && pixelSizeA && pixelSizeA > 0) {
    xKind = "cycles-per-pixel";
  }

  const points: Array<{ frequency: number; correlation: number }> = [];
  for (let i = 0; i < n; i++) {
    let frequency = xs[i];
    if (xKind === "resolution") {
      if (!(frequency > 0)) continue;
      frequency = 1 / frequency;
    } else if (xKind === "cycles-per-pixel") {
      frequency = frequency / (pixelSizeA as number);
    }
    const corr = Math.max(0, Math.min(1, ys[i]));
    points.push({ frequency, correlation: corr });
  }
  if (points.length < 4) return null;
  return { points, xKind };
}

function crossingFrequency(
  points: Array<{ frequency: number; correlation: number }>,
  threshold: number,
): number | null {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.correlation >= threshold && curr.correlation < threshold) {
      const t = (prev.correlation - threshold) / Math.max(1e-9, prev.correlation - curr.correlation);
      return prev.frequency + t * (curr.frequency - prev.frequency);
    }
  }
  return null;
}

/**
 * Parse FSC-curve XML into the same shape as `parseFscText`.
 */
export function parseFscXml(raw: string, opts: FscXmlParseOptions = {}): FscParseResult {
  const warnings: string[] = [];
  if (typeof DOMParser === "undefined") {
    return { curves: [], bestResolutionA: null, threshold: FSC_XML_THRESHOLD, warnings: ["DOMParser unavailable (non-browser context)"] };
  }
  const doc = new DOMParser().parseFromString(raw, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror");
  if (parseError.length) {
    return { curves: [], bestResolutionA: null, threshold: FSC_XML_THRESHOLD, warnings: ["XML parse error: " + (parseError[0].textContent || "").slice(0, 120)] };
  }
  const root = doc.documentElement;
  if (!root) {
    return { curves: [], bestResolutionA: null, threshold: FSC_XML_THRESHOLD, warnings: ["Empty XML document"] };
  }

  // Split into per-curve scopes when explicit curve containers exist.
  let scopes: Array<{ id: string; label: string; root: Element }> = [];
  const containers = findCurveContainers(root);
  if (containers.length > 1) {
    scopes = containers.map((c, i) => ({
      id: `scope-${i}`,
      label: c.getAttribute("iteration") || c.getAttribute("label") || c.getAttribute("name") || `${c.tagName} ${i + 1}`,
      root: c,
    }));
  } else {
    scopes = [{ id: "doc", label: "FSC", root }];
  }

  const curves: FscCurve[] = [];
  let bestRes: number | null = null;

  for (const scope of scopes) {
    const acc: LeafAccumulator = { arrays: new Map() };
    collectLeafNumbers(scope.root, acc, scope.id);
    const scoped = new Map<string, number[]>();
    for (const [k, v] of acc.arrays) {
      scoped.set(k.split("\u0000")[1] || k, v);
    }
    const picked = pickAxisPair(scoped, opts.pixelSizeA ?? null);
    if (!picked) {
      warnings.push(`Could not locate an FSC data pair in scope "${scope.label}"`);
      continue;
    }
    // Only keep curves that actually look like FSC (mostly non-increasing
    // after the peak, and at least some correlation > 0.2).
    const peak = Math.max(...picked.points.map((p) => p.correlation));
    if (peak < 0.2) {
      warnings.push(`Scope "${scope.label}" does not look like an FSC curve (peak ${peak.toFixed(3)})`);
      continue;
    }
    const iterMatch = /(\d+)/.exec(scope.label);
    const freq = crossingFrequency(picked.points, FSC_XML_THRESHOLD);
    let resA: number | null = null;
    if (freq != null && freq > 0) resA = 1 / freq;
    if (picked.xKind === "resolution" && resA == null) {
      // Crossing may have been clamped away — fall back to the smallest
      // resolution value present in the data.
      warnings.push(`Scope "${scope.label}": no 0.143 crossing found`);
    }
    if (resA != null && (bestRes == null || resA < bestRes)) bestRes = resA;
    curves.push({
      iteration: iterMatch ? parseInt(iterMatch[1], 10) : 0,
      resolutionA: resA,
      points: picked.points.map((p) => ({ frequency: p.frequency, correlation: p.correlation })),
      label: scope.label,
    });
  }

  curves.sort((a, b) => a.iteration - b.iteration);
  return { curves, bestResolutionA: bestRes, threshold: FSC_XML_THRESHOLD, warnings };
}

/* ------------------------------------------------------------------ */
/* Canvas rendering for the workflow-figure PPTX                      */
/* ------------------------------------------------------------------ */

export interface FscRenderOptions {
  width?: number;
  height?: number;
  threshold?: number;
  title?: string | null;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas.toBlob returned null"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, "image/png");
  });
}

/**
 * Render FSC curves to a white-background PNG (resolution on the x axis,
 * reversed so fine resolution is on the right — publication style).
 */
export async function renderFscCurvePng(curves: FscCurve[], opts: FscRenderOptions = {}): Promise<Uint8Array | null> {
  if (typeof document === "undefined" || !curves.length) return null;
  const W = Math.max(320, Math.round(opts.width ?? 960));
  const H = Math.max(200, Math.round(opts.height ?? 540));
  const scale = 2; // supersample
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const padL = 64;
  const padR = 16;
  const padT = 14;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const all = curves.flatMap((c) => c.points);
  if (!all.length) return null;
  const freqs = all.map((p) => p.frequency).filter((f) => Number.isFinite(f) && f > 0);
  const fMin = Math.min(...freqs);
  const fMax = Math.max(...freqs);
  if (!(fMax > fMin)) return null;

  // X axis: resolution (Å) = 1/f, reversed (coarse left → fine right).
  const resLeft = 1 / fMin;
  const resRight = 1 / fMax;
  const toX = (f: number) => {
    const r = 1 / f;
    const t = (resLeft - r) / (resLeft - resRight); // 0 at left, 1 at right
    return padL + t * plotW;
  };
  const toY = (c: number) => padT + (1 - Math.max(0, Math.min(1, c))) * plotH;

  // Grid
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let gy = 0; gy <= 4; gy++) {
    const y = padT + (gy / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
  for (let gx = 0; gx <= 4; gx++) {
    const x = padL + (gx / 4) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }

  // Threshold line
  const thr = opts.threshold ?? FSC_XML_THRESHOLD;
  ctx.strokeStyle = "#d97706";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, toY(thr));
  ctx.lineTo(padL + plotW, toY(thr));
  ctx.stroke();
  ctx.setLineDash([]);

  // Curves
  const palette = ["#0d9488", "#6366f1", "#db2777", "#a16207", "#334155"];
  curves.forEach((curve, i) => {
    ctx.strokeStyle = palette[i % palette.length];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (const p of curve.points) {
      if (!Number.isFinite(p.frequency) || p.frequency <= 0) continue;
      const x = toX(p.frequency);
      const y = toY(p.correlation);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });

  // Axes
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Tick labels (2 significant decimals on resolution)
  ctx.fillStyle = "#334155";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  for (let gx = 0; gx <= 4; gx++) {
    const r = resLeft + ((resRight - resLeft) * gx) / 4;
    ctx.fillText(`${r >= 10 ? r.toFixed(0) : r.toFixed(1)}`, padL + (gx / 4) * plotW, padT + plotH + 18);
  }
  ctx.textAlign = "right";
  for (let gy = 0; gy <= 4; gy++) {
    const v = 1 - gy / 4;
    ctx.fillText(v.toFixed(2), padL - 8, padT + (gy / 4) * plotH + 4);
  }
  ctx.textAlign = "center";
  ctx.fillText("Resolution (Å)", padL + plotW / 2, padT + plotH + 34);
  if (opts.title) {
    ctx.font = "13px Arial";
    ctx.fillText(opts.title, padL + plotW / 2, padT - 2 < 10 ? 10 : padT - 2);
  }
  ctx.textAlign = "left";
  ctx.font = "12px Arial";
  ctx.fillText(`FSC (${thr})`, padL + 6, toY(thr) - 6);

  return canvasToPngBytes(canvas);
}
