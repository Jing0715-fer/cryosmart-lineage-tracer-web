/**
 * Chimera classic's built-in multi-model "open" color sequence (v3.52).
 *
 * Round-11 (“颜色依次用这几种作为默认吧”): when Chimera opens a file with
 * several models at once — e.g. the volume_class_0..N maps of one
 * 3D-classification / hetero job — it auto-assigns each model the NEXT
 * color from a fixed built-in palette. The user asked for exactly that
 * sequence as the flow figure's per-class defaults (and confirmed its head
 * from their own Chimera):
 *
 *   class 1 → #b2b2b2 grey
 *   class 2 → #ffffb2 pale yellow
 *   class 3 → #b333ff violet
 *   class 4 → #b2b2ff lavender
 *   class 5+ → tan / forest green / sea green / cyan / dark cyan / blue /
 *              dark blue / slate blue / … (the same built-in list)
 *
 * A single-map stage is "class 1 of its job", so it renders grey — the same
 * thing you see when opening that one map in Chimera. v3.51's uniform
 * #8a8a8a gray made every class indistinguishable; the figure now looks
 * like the class maps opened together in Chimera, on the same black
 * background. Head values = user-confirmed; tail = Chimera's built-in list
 * (grey→slate blue is cross-checked, later entries cycle after 20).
 */

export interface ChimeraColor {
  /** Chimera's own colorTable name for the color. */
  name: string;
  /** Chimera's RGB value for that name (what `color #<id> <hex>` sends). */
  hex: string;
  /** Short Chinese label for logs. */
  label: string;
}

/** The default colors Chimera assigns per model position on open. */
export const CHIMERA_MODEL_COLORS: readonly ChimeraColor[] = [
  { name: "grey", hex: "#b2b2b2", label: "灰" },
  { name: "pale yellow", hex: "#ffffb2", label: "淡黄" },
  { name: "violet", hex: "#b333ff", label: "紫" },
  { name: "lavender", hex: "#b2b2ff", label: "淡紫" },
  { name: "tan", hex: "#d2b48c", label: "棕褐" },
  { name: "forest green", hex: "#228b22", label: "森林绿" },
  { name: "sea green", hex: "#2e8b57", label: "海洋绿" },
  { name: "cyan", hex: "#00ffff", label: "青" },
  { name: "dark cyan", hex: "#008b8b", label: "暗青" },
  { name: "blue", hex: "#0000ff", label: "蓝" },
  { name: "dark blue", hex: "#00008b", label: "暗蓝" },
  { name: "slate blue", hex: "#6a5acd", label: "石板蓝" },
  { name: "magenta", hex: "#ff00ff", label: "品红" },
  { name: "hot pink", hex: "#ff69b4", label: "亮粉" },
  { name: "pink", hex: "#ffc0cb", label: "粉" },
  { name: "red", hex: "#ff0000", label: "红" },
  { name: "orange", hex: "#ffa500", label: "橙" },
  { name: "brown", hex: "#a52a2a", label: "棕" },
  { name: "rosy brown", hex: "#bc8f8f", label: "玫瑰棕" },
  { name: "yellow", hex: "#ffff00", label: "黄" },
];

/**
 * 0-based class position → Chimera's i-th open color. Single-map stages
 * pass 0 (grey). Out-of-range / negative / non-finite values fall back to
 * the first color; positions past the palette cycle (never reached in
 * practice — MAX_FIG_CLASSES caps rows at 8).
 */
export function chimeraClassColor(classIndex: number): string {
  const n = CHIMERA_MODEL_COLORS.length;
  const i =
    Number.isFinite(classIndex) && classIndex >= 0
      ? Math.floor(classIndex) % n
      : 0;
  return CHIMERA_MODEL_COLORS[i].hex;
}
