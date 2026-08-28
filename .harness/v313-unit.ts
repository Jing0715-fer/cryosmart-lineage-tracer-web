/**
 * v3.13 unit check (bun .harness/v313-unit.ts):
 *   1. NUMBERED-SERIES collapse — refs whose title/file name ends in a bare
 *      2–4 digit number ("Per particle scale factors 007") keep only the
 *      HIGHEST number per series (user report: 000–007 all captured).
 *   2. Marker-based iterations still collapse ("Iteration 008") and the two
 *      mechanisms must not delete each other (scale factors top = 7 while
 *      the job's explicit-marker iterations top = 8 — BOTH survive).
 *   3. Class / group galleries are NEVER collapsed (volume_class_10,
 *      trefoil for group 01/02, mic0/mic1, class_000 files mid-name).
 *   4. image_logs entries collapse by TITLE, and numbered FILES inside ONE
 *      entry collapse to the last file.
 * Runs against the real src/lib/cryosmart/lineage.ts via bun's TS loader.
 */
import { imageAssets } from "../src/lib/cryosmart/lineage.ts";
import type { JobMetadata } from "../src/lib/cryosmart/types.ts";

const NOW = new Date().toISOString();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

const BASE = "http://192.168.202.11:8080";
const ref = (fileid: string, text: string, name?: string) =>
  ({ fileid, text, name: name || text } as never);

/* ── 1+2+3: log_images refs ─────────────────────────────────────────── */
const job = {
  uid: "J43",
  project_uid: "P259",
  job_type: "nonuniform_refine_new",
  title: "nu ref",
  status: "completed",
  created_at: NOW,
  completed_at: NOW,
  parents: [],
  children: [],
  input_slot_groups: [],
  output_result_groups: [],
  params_spec: {},
  output_group_images: {},
  ui_tile_images: [],
  log_images: [
    // numbered series, number in TITLE (the user's exact case)
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
      ref(`sf_${n}`, `Per particle scale factors ${String(n).padStart(3, "0")}`)
    ),
    // numbered series, NO title — number only in the file name
    ...[0, 1, 2].map((n) =>
      ref(`nm_${n}`, "", `noise_model_${String(n).padStart(3, "0")}.png`)
    ),
    // numberless title + numbered files = CLASS GALLERY shape — must NOT
    // collapse (the file-name fallback never applies when a title exists)
    ...[0, 1].map((n) =>
      ref(`fc_${n}`, "Final classes", `J4_final_${String(n).padStart(3, "0")}.png`)
    ),
    // explicit-marker iterations — top is 8 (higher than scale factors' 7):
    // the two mechanisms must NOT merge into one global max.
    ref(`rs_000`, "Real Space Slices Iteration 000"),
    ref(`rs_008`, "Real Space Slices Iteration 008"),
    // guarded galleries — must ALL survive
    ref(`vc_0`, "volume_class_0.png"),
    ref(`vc_1`, "volume_class_1.png"),
    ref(`vc_10`, "volume_class_10.png"),
    ref(`tf_01`, "trefoil (Z3) for group 01"),
    ref(`tf_02`, "trefoil (Z3) for group 02"),
    ref(`m0`, "mic0.png"),
    ref(`m1`, "mic1.png"),
    ref(`cls`, "Class_000_Initial_Structure_Real-Space.png"),
    // series seen only ONCE passes through untouched
    ref(`solo`, "Guinier Plot 007"),
  ],
} as unknown as JobMetadata;

const assets = imageAssets(job, BASE, "P259");
const logAssets = assets.filter((a) => a.kind === "log_image");
const names = logAssets.map((a) => a.name);
const has = (s: string) => names.some((n) => n.includes(s));

console.log("log_image refs →", names.length, "assets:");
console.log("  ", names.join(" | "));

check("scale factors: only 007 survives", has("scale factors 007") && !has("scale factors 006") && !has("scale factors 000"));
check("titleless series: only noise_model_002 survives (name-based series)",
  names.filter((n) => n.includes("noise_model")).length === 1);
check("numberless title + numbered files = class gallery, ALL kept",
  names.filter((n) => n === "Final classes").length === 2);
check("explicit iterations: only 008 survives", has("Real Space Slices Iteration 008") && !has("Iteration 000"));
check("no cross-series deletion (scale 007 kept although max marker = 008)", has("scale factors 007"));
check("volume_class_N gallery kept (0, 1 AND 10)", has("volume_class_0") && has("volume_class_1") && has("volume_class_10"));
check("trefoil group 01+02 both kept", has("group 01") && has("group 02"));
check("mic0 + mic1 both kept (1-digit suffixes never collapse)", has("mic0") && has("mic1"));
check("Class_000 mid-name file kept", has("Class_000"));
check("single-occurrence 'Guinier Plot 007' kept", has("Guinier Plot 007"));

/* ── 4: image_logs entries ──────────────────────────────────────────── */
const job2 = {
  ...job,
  uid: "J39",
  log_images: [],
  image_logs: [
    // entries whose TITLES carry the series number
    ...[0, 1, 2].map((n) => ({
      type: "image",
      text: `Defocus change across all particles ${String(n).padStart(3, "0")}`,
      flags: ["plots"],
      imgfiles: [{ fileid: `dc_${n}`, filename: `defocus_${String(n).padStart(3, "0")}.png` }],
    })),
    // a NUMBERLESS-title entry with numbered files = CLASS GALLERY — every
    // file survives (deliberately NOT collapsed; a real numbered series
    // always carries its number in the ref's title or own name).
    {
      type: "image",
      text: "Final classes",
      imgfiles: [
        { fileid: "f0", filename: "J4_final_000.png" },
        { fileid: "f1", filename: "J4_final_001.png" },
      ],
    },
    // a class gallery entry with volume_class files — every file survives
    {
      type: "image",
      text: "class gallery",
      imgfiles: [
        { fileid: "g0", filename: "volume_class_0.png" },
        { fileid: "g1", filename: "volume_class_1.png" },
        { fileid: "g2", filename: "volume_class_2.png" },
      ],
    },
  ],
} as unknown as JobMetadata;

const assets2 = imageAssets(job2, BASE, "P259");
const entries = assets2.filter((a) => a.kind === "image_log");
const names2 = entries.map((a) => a.name);
console.log("image_log entries →", names2.length, "assets:");
console.log("  ", names2.join(" | "));

check("entry titles: only Defocus … 002 survives",
  names2.filter((n) => n.includes("Defocus")).length === 1 && names2.some((n) => n.includes("002")));
check("numberless-title entry keeps ALL its numbered files (class gallery)",
  entries.filter((a) => (a.log_text || "").includes("Final classes")).length === 2);
check("class gallery entry keeps all 3 volume_class files",
  entries.filter((a) => (a.log_text || "").includes("class gallery")).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
