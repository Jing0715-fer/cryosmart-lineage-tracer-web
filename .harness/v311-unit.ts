/**
 * v3.11 web-side unit check (bun script.ts):
 *   1. LAST-ITERATION filter: refs spanning "Iteration 000".."Iteration 027"
 *      keep ONLY the highest iteration's refs (the 112-image nu_refine and
 *      "Iteration 000 only" bugs).
 *   2. Strict image whitelist: XML / TXT refs and imgfiles are filtered
 *      alongside PDFs (title-like names without extensions stay).
 *   3. Class-gallery safety: trailing digits WITHOUT an iteration marker
 *      ("class_004.png") are NOT iterations — all classes survive.
 *   4. image_logs entries carrying `files` (hetero/abinit shape) render.
 *   5. image_logs per-iteration entries keep only the final iteration.
 * Runs against the real src/lib/cryosmart/lineage.ts via bun's TS loader.
 */
import { buildSummary } from "../src/lib/cryosmart/lineage.ts";
import type { JobMetadata } from "../src/lib/cryosmart/types.ts";

const NOW = new Date().toISOString();
const mk = (uid: string, job_type: string, parents: string[]): JobMetadata => ({
  uid,
  project_uid: "PX",
  job_type,
  title: uid,
  status: "completed",
  created_at: NOW,
  completed_at: NOW,
  parents,
  children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles",
    type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [
    { name: "particles", type: "particle", contains: [{ type: "particle.blob", name: "ptcls" }] },
  ],
  params_spec: {},
  output_group_images: {},
  ui_tile_images: [],
});

const jobs: JobMetadata[] = [
  mk("J1", "import_movies", []),
  mk("J2", "nu_refine", ["J1"]),          // iteration-titled refs
  mk("J3", "hetero_refine", ["J2"]),      // XML/TXT refs + class gallery
  mk("J4", "homo_abinit", ["J3"]),        // files[] image_logs + iterations
  mk("J5", "select_2d", ["J4"]),          // start job — also file-name iters
];

// J2: per-iteration entries flattened as refs (v3.11 capture emits only the
// final iteration, but OLDER captures carry every round — web-side defense).
const j2Refs: Array<Record<string, unknown>> = [];
for (let it = 0; it <= 27; it++) {
  const n = String(it).padStart(3, "0");
  j2Refs.push({ fileid: "j2_fsc_" + it, name: "J2_fsc_iter_" + n + ".png", text: "Iteration " + n });
  j2Refs.push({ fileid: "j2_ang_" + it, name: "J2_angdist_iter_" + n + ".png", text: "Iteration " + n });
  j2Refs.push({ fileid: "j2_xml_" + it, name: "J2_data_iter_" + n + ".xml", text: "Iteration " + n });
}
jobs[1].log_images = j2Refs as never;

// J3: non-image refs of several kinds + a multi-class gallery whose file
// names carry trailing digits WITHOUT an iteration marker.
jobs[2].log_images = [
  { fileid: "j3_cls0", name: "J3_class_000.png", text: "Class gallery" },
  { fileid: "j3_cls1", name: "J3_class_001.png", text: "Class gallery" },
  { fileid: "j3_cls2", name: "J3_class_002.png", text: "Class gallery" },
  { fileid: "j3_meta", name: "J3_meta.xml", filetype: "application/xml", filename: "J3_meta.xml", text: "Meta" },
  { fileid: "j3_data", name: "J3_result.txt", filetype: "text/plain", filename: "J3_result.txt", text: "Data" },
  { fileid: "j3_pdf", name: "J3_report.pdf", filetype: "pdf", filename: "J3_report.pdf", text: "Report" },
  { fileid: "j3_plain", name: "FSC plot", text: "FSC plot" },  // title-like name — keep
] as never;

// J4: raw image_logs entries — `files` shape (hetero/abinit delivery) with
// per-iteration titles; only the final iteration's entries may survive.
jobs[3].image_logs = [
  { _id: "a1", type: "image", text: "Iteration 000", files: [
    { fileid: "j4_s0", filename: "J4_slice_iter_000.png", filetype: "image/png" },
  ] },
  { _id: "a2", type: "image", text: "Iteration 001", files: [
    { fileid: "j4_s1", filename: "J4_slice_iter_001.png", filetype: "image/png" },
    { fileid: "j4_x1", filename: "J4_data_iter_001.xml", filetype: "text/xml" },
  ] },
  { _id: "a3", type: "image", text: "Final classes", files: [
    { fileid: "j4_f0", filename: "J4_final_000.png", filetype: "image/png" },
    { fileid: "j4_f1", filename: "J4_final_001.png", filetype: "image/png" },
  ] },
] as never;

// J5: title-less refs whose FILE NAMES carry the iteration number.
jobs[4].log_images = [
  { fileid: "j5_p0", name: "J5_plot_iter_000.png" },
  { fileid: "j5_p1", name: "J5_plot_iter_001.png" },
  { fileid: "j5_p2", name: "J5_plot_iter_002.png" },
  { fileid: "j5_extra", name: "J5_final.png" },
] as never;

const summary = buildSummary(jobs, "PX", "J5", "http://192.168.202.11:8080");
const logImgs = (uid: string) =>
  (summary.nodes.find((n) => n.uid === uid)?.images || [])
    .filter((im) => im.kind === "log_image" || im.kind === "image_log")
    .map((im) => im.src);
const has = (list: string[], fid: string) => list.some((s) => s.includes(fid));

const j2 = logImgs("J2");
const j3 = logImgs("J3");
const j4 = logImgs("J4");
const j5 = logImgs("J5");
console.log("J2 (nu_refine):", j2.map((s) => s.split("/").pop()));
console.log("J3 (hetero):", j3.map((s) => s.split("/").pop()));
console.log("J4 (abinit files[]):", j4.map((s) => s.split("/").pop()));
console.log("J5 (file-name iters):", j5.map((s) => s.split("/").pop()));

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + label);
  if (!cond) ok = false;
};

check(
  j2.length === 2 && has(j2, "j2_fsc_27") && has(j2, "j2_ang_27") && !has(j2, "j2_fsc_0&") && !has(j2, "j2_fsc_26"),
  "J2: 56 iteration refs collapse to the FINAL iteration's 2 (Iteration 000-026 dropped)",
);
check(
  !["j3_meta", "j3_data", "j3_pdf"].some((f) => has(j3, f)),
  "J3: XML / TXT / PDF refs all filtered",
);
check(
  ["j3_cls0", "j3_cls1", "j3_cls2"].every((f) => has(j3, f)),
  "J3: class gallery survives intact (trailing digits are NOT iterations)",
);
check(has(j3, "j3_plain"), "J3: title-like name without extension kept");

check(
  j4.length === 3 && has(j4, "j4_s1") && has(j4, "j4_f0") && has(j4, "j4_f1") && !has(j4, "j4_s0") && !has(j4, "j4_x1"),
  "J4: files[] entries render; earlier iteration dropped; final-round entries kept; xml filtered",
);

check(
  j5.length === 2 && has(j5, "j5_p2") && has(j5, "j5_extra") && !has(j5, "j5_p0") && !has(j5, "j5_p1"),
  "J5: file-name iteration evidence keeps only iter_002 + the no-iteration ref",
);

console.log(ok ? "\n✅ v3.11 UNIT CHECK PASS" : "\n❌ v3.11 UNIT CHECK FAIL");
process.exit(ok ? 0 : 2);
