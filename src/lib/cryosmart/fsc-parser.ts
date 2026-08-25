/**
 * FSC (Fourier Shell Correlation) data parser.
 *
 * CryoSmart exports FSC curves as plain-text two-column data
 * (spatial frequency × correlation), typically downloaded from
 * `/api/log_image/download_result_file/{pid}/{jid}.fsc.txt` or
 * scraped from the Overview tab's "FSC Iteration NNNN" log rows.
 *
 * This module is browser-safe (pure string parsing, no DOM).
 */

export interface FscPoint {
  /** Spatial frequency (cycles/pixel or 1/Å depending on the source). */
  frequency: number;
  /** FSC correlation, 0..1. */
  correlation: number;
}

export interface FscCurve {
  /** Iteration number (e.g. 25), or 0 if unknown. */
  iteration: number;
  /** Resolution in Å at the FSC=0.143 threshold, if available. */
  resolutionA: number | null;
  /** The curve points. */
  points: FscPoint[];
  /** Label for the curve (e.g. "Iter 25"). */
  label: string;
}

export interface FscParseResult {
  curves: FscCurve[];
  /** Best (highest) resolution across all curves, in Å. */
  bestResolutionA: number | null;
  /** Threshold used (0.143 by convention; sometimes 0.5). */
  threshold: number;
  /** Any warnings encountered during parsing. */
  warnings: string[];
}

const FSC_THRESHOLD = 0.143;

/**
 * Parse FSC text data into one or more curves.
 *
 * Supported formats (auto-detected):
 *   1. Single curve: two columns separated by whitespace/comma.
 *      `0.000 1.000\n0.025 0.998\n...`
 *   2. Multiple curves with header lines starting with `#` or `Iteration`:
 *      `# Iteration 25\n0.000 1.000\n...\n# Iteration 24\n...`
 *   3. Resolution hint line: `# Resolution: 3.12 Å` or `resolution 3.12`
 *
 * Lines that don't parse as two numbers are silently skipped
 * (with a warning counted).
 */
export function parseFscText(raw: string): FscParseResult {
  const warnings: string[] = [];
  const lines = raw.split(/\r?\n/);
  const curves: FscCurve[] = [];
  let current: FscCurve | null = null;
  let bestRes: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Header / comment line.
    if (line.startsWith("#") || line.startsWith("//")) {
      const iterMatch = line.match(/iter(?:ation)?\s*#?\s*(\d+)/i);
      if (iterMatch) {
        // Flush previous curve.
        if (current && current.points.length > 0) curves.push(current);
        const iter = parseInt(iterMatch[1], 10);
        current = {
          iteration: iter,
          resolutionA: null,
          points: [],
          label: `Iter ${iter}`,
        };
        continue;
      }
      const resMatch = line.match(/res(?:olution)?\s*[:=]?\s*([\d.]+)\s*(?:Å|A)?/i);
      if (resMatch && current) {
        const r = parseFloat(resMatch[1]);
        if (Number.isFinite(r) && r > 0 && r < 100) {
          current.resolutionA = r;
          if (bestRes == null || r < bestRes) bestRes = r;
        }
      }
      continue;
    }

    // "Iteration N" header without #.
    const iterLine = line.match(/^iter(?:ation)?\s*#?\s*(\d+)/i);
    if (iterLine) {
      if (current && current.points.length > 0) curves.push(current);
      const iter = parseInt(iterLine[1], 10);
      current = {
        iteration: iter,
        resolutionA: null,
        points: [],
        label: `Iter ${iter}`,
      };
      continue;
    }

    // Two-column data line.
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    if (parts.length >= 2) {
      const freq = parseFloat(parts[0]);
      const corr = parseFloat(parts[1]);
      if (Number.isFinite(freq) && Number.isFinite(corr)) {
        if (!current) {
          current = { iteration: 0, resolutionA: null, points: [], label: "FSC" };
        }
        current.points.push({
          frequency: freq,
          correlation: Math.max(0, Math.min(1, corr)),
        });
        continue;
      }
    }
    // Unparseable line — count as warning but don't fail.
    warnings.push(`Skipped line ${i + 1}: "${line.slice(0, 60)}"`);
  }

  // Flush last curve.
  if (current && current.points.length > 0) curves.push(current);

  // Sort curves by iteration (ascending), keep "FSC" (iter 0) first.
  curves.sort((a, b) => {
    if (a.iteration === 0) return -1;
    if (b.iteration === 0) return 1;
    return a.iteration - b.iteration;
  });

  // Compute resolution from threshold crossing if not in header.
  for (const c of curves) {
    if (c.resolutionA == null) {
      const freq = thresholdCrossingFrequency(c.points, FSC_THRESHOLD);
      if (freq != null) {
        // Convert frequency (1/pixel) to resolution in Å.
        // We don't have the pixel size here, so we store the frequency
        // and let the UI compute Å if it has pixel size context.
        // For now, we leave resolutionA null and the UI shows "—".
      }
    }
  }

  return {
    curves,
    bestResolutionA: bestRes,
    threshold: FSC_THRESHOLD,
    warnings,
  };
}

/** Find the spatial frequency where the curve crosses the given threshold (descending). */
function thresholdCrossingFrequency(points: FscPoint[], threshold: number): number | null {
  if (points.length < 2) return null;
  // Walk from high freq to low freq (curves are usually ascending in freq,
  // descending in correlation past the peak).
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.correlation >= threshold && curr.correlation < threshold) {
      // Linear interpolation.
      const t = (prev.correlation - threshold) / (prev.correlation - curr.correlation);
      return prev.frequency + t * (curr.frequency - prev.frequency);
    }
  }
  return null;
}

/** Build a synthetic FSC curve for demo / "Try Sample" mode. */
export function buildSampleFscData(iteration: number = 25): FscCurve {
  const points: FscPoint[] = [];
  // Realistic FSC shape: starts at 1.0, stays high until ~0.4*Nyquist,
  // then drops sharply. Resolution ≈ 3.12 Å at FSC=0.143.
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const freq = i / N; // 0..1 (normalized spatial frequency)
    // Sigmoid-like dropoff.
    const dropoff = 0.45;
    const steepness = 18;
    const corr = 1 / (1 + Math.exp(steepness * (freq - dropoff)));
    // Add small noise.
    const noise = (Math.sin(i * 7.3) * 0.003);
    points.push({
      frequency: freq,
      correlation: Math.max(0, Math.min(1, corr + noise)),
    });
  }
  return {
    iteration,
    resolutionA: 3.12,
    points,
    label: `Iter ${iteration}`,
  };
}

/** Build multiple synthetic curves for demo (showing iteration progression). */
export function buildSampleFscMulti(): FscParseResult {
  const iters = [22, 23, 24, 25];
  const curves = iters.map((iter) => {
    const base = buildSampleFscData(iter);
    // Earlier iterations have slightly worse resolution (lower dropoff).
    const dropoffAdj = (25 - iter) * 0.015;
    base.points = base.points.map((p) => ({
      frequency: p.frequency,
      correlation: Math.max(0, Math.min(1, p.correlation - dropoffAdj * 0.3)),
    }));
    base.resolutionA = 3.12 + (25 - iter) * 0.06;
    return base;
  });
  return {
    curves,
    bestResolutionA: 3.12,
    threshold: FSC_THRESHOLD,
    warnings: [],
  };
}
