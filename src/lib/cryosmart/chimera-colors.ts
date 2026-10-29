/**
 * Chimera classic's built-in multi-model "open" color sequence (v3.54).
 *
 * Round-11/12 head (“颜色依次用这几种作为默认吧”) was confirmed from the
 * user's own Chimera, but round-13 supplies the AUTHORITATIVE full list —
 * the user pasted Chimera classic's own 16-bit RGBA model colors (4 hex
 * digits per channel, alpha last):
 *
 *   class 0 → #b333b333b333   grey         (0.70, 0.70, 0.70)
 *   class 1 → #ffffffffb333   pale yellow  (1.00, 1.00, 0.70)
 *   class 2 → #b333ffffffff   pale cyan    (0.70, 1.00, 1.00)
 *   class 3 → #b333b333ffff   pale blue    (0.70, 0.70, 1.00)
 *   class 4 → #ffffb333ffff   pale magenta (1.00, 0.70, 1.00)
 *   class 5 → #ffffb333b333   pale salmon  (1.00, 0.70, 0.70)
 *   class 6 → #b333ffffb333   pale green   (0.70, 1.00, 0.70)
 *   class 7 → #e666bfff9999   tan          (0.90, 0.75, 0.60)
 *   class 8 → CYCLES back to class 0 — Chimera's built-in list is exactly
 *             these 8 entries and repeats, so a 9th model gets grey again.
 *
 * v3.52/53's "#b333ff violet" for class 2 was a MIS-PARSE of the user's
 * 16-bit paste "#b333ffffffff" (read as RGB+alpha); the true 16-bit value
 * is pale cyan, and the entries after pale blue are pale magenta/salmon/
 * green — NOT the CSS named colors (tan #d2b48c, forest green …) that the
 * recollection-based tail previously guessed. The list below is the user's
 * round-13 paste, converted to the 8-bit hex ChimeraX's `volume #<id> color`
 * expects (16-bit ÷ 257, anchored on the user's own round-11 8-bit values
 * #b2b2b2 / #ffffb2 / #b2b2ff for the 0xb333 channels).
 */

export interface ChimeraColor {
  /** Chimera classic's own colorTable name for the color. */
  name: string;
  /** 8-bit hex actually sent to ChimeraX `volume #<id> color <hex>`. */
  hex: string;
  /** The user-confirmed Chimera classic 16-bit RGBA (4 hex digits/channel). */
  rgba16: string;
  /** Short Chinese label for logs. */
  label: string;
}

/** The default colors Chimera assigns per model position on open (v3.54:
 *  the exact 8-entry built-in list — cycles past class 7). */
export const CHIMERA_MODEL_COLORS: readonly ChimeraColor[] = [
  { name: "grey", hex: "#b2b2b2", rgba16: "#b333b333b333", label: "灰" },
  { name: "pale yellow", hex: "#ffffb2", rgba16: "#ffffffffb333", label: "淡黄" },
  { name: "pale cyan", hex: "#b2ffff", rgba16: "#b333ffffffff", label: "淡青" },
  { name: "pale blue", hex: "#b2b2ff", rgba16: "#b333b333ffff", label: "淡蓝" },
  { name: "pale magenta", hex: "#ffb2ff", rgba16: "#ffffb333ffff", label: "淡品红" },
  { name: "pale salmon", hex: "#ffb2b2", rgba16: "#ffffb333b333", label: "淡红" },
  { name: "pale green", hex: "#b2ffb2", rgba16: "#b333ffffb333", label: "淡绿" },
  { name: "tan", hex: "#e6bf99", rgba16: "#e666bfff9999", label: "棕褐" },
];

/**
 * 0-based class position → Chimera's i-th open color (class 0 = grey,
 * matching cryoSPARC's volume_class_N naming). Single-map stages pass 0
 * (grey). Past the 8-entry list the palette CYCLES (class 8 → grey) —
 * exactly what Chimera itself does with a 9th simultaneously-open model.
 */
export function chimeraClassColor(classIndex: number): string {
  const n = CHIMERA_MODEL_COLORS.length;
  const i =
    Number.isFinite(classIndex) && classIndex >= 0
      ? Math.floor(classIndex) % n
      : 0;
  return CHIMERA_MODEL_COLORS[i].hex;
}
