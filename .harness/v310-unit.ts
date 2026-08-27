/**
 * v3.10 web-side unit check (bun script.ts):
 *   1. per-job log images: each job's node.images contains ONLY its own refs
 *   2. PDF refs/files are filtered from node.images
 *   3. cross-job fileid dedupe: a fileid smeared onto several jobs (legacy
 *      capture) renders on exactly ONE job
 *   4. last-round-only: dup-title refs keep the final round
 * Runs against the real src/lib/cryosmart/lineage.ts via bun's TS loader.
 */
import { buildSummary } from "../src/lib/cryosmart/lineage.ts";
import type { JobMetadata } from "../src/lib/cryosmart/types.ts";

const NOW = new Date().toISOString();
// NOTE: no uid_num — the dedupe must derive order from the uid string
// itself (real staged jobs don't always carry uid_num).
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
  mk("J2", "class_2D", ["J1"]),
  mk("J3", "hetero_refine", ["J2"]),
  mk("J4", "nonuniform_refine_new", ["J3"]),
];

// Per-job log_images — J2 also carries a PDF ref; J3 carries a SMEARED copy
// of J2's fileid (legacy misattribution); J4 carries two rounds of one title.
jobs[1].log_images = [
  { fileid: "j2_sel", name: "sel.png", text: "Selected classes" },
  { fileid: "j2_report", name: "report.pdf", filetype: "pdf", filename: "report.pdf", text: "Report" },
];
jobs[2].log_images = [
  { fileid: "j2_sel", name: "sel.png", text: "Selected classes" }, // foreign — must be stripped (J2 owns it)
  { fileid: "j3_gallery_a", name: "class_1.png", text: "class 1" },
  { fileid: "j3_gallery_b", name: "class_2.png", text: "class 2" },
];
jobs[3].log_images = [
  { fileid: "j4_fsc_r1", name: "fsc.png", text: "FSC curve" }, // older round — dead fileid
  { fileid: "j4_fsc_r2", name: "fsc.png", text: "FSC curve" }, // final round
];

const summary = buildSummary(jobs, "PX", "J4", "http://192.168.202.11:8080");
const logImgs = (uid: string) =>
  (summary.nodes.find((n) => n.uid === uid)?.images || [])
    .filter((im) => im.kind === "log_image")
    .map((im) => im.name);

const j2 = logImgs("J2");
const j3 = logImgs("J3");
const j4 = logImgs("J4");
console.log("J2 log images:", j2);
console.log("J3 log images:", j3);
console.log("J4 log images:", j4);

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + label);
  if (!cond) ok = false;
};

check(j2.length === 1 && j2[0] === "Selected classes", "J2: exactly its own 1 ref (PDF filtered)");
check(j3.length === 2 && j3[0] === "class 1" && j3[1] === "class 2", "J3: exactly its own 2 refs (smeared j2_sel stripped)");
check(j4.length === 1 && j4[0] === "FSC curve", "J4: only the LAST round of the dup-title pair");
check(!JSON.stringify([j2, j3, j4]).includes(".pdf"), "no PDF-named asset anywhere");
check(j2.length + j3.length + j4.length === 4, "total log images = 4 (per-job, no duplicates)");

// Idempotency: re-running buildSummary on the (mutated) jobs must not change counts.
const summary2 = buildSummary(jobs, "PX", "J4", "http://192.168.202.11:8080");
const count2 = summary2.nodes.reduce(
  (n, node) => n + node.images.filter((im) => im.kind === "log_image").length, 0
);
check(count2 === 4, `dedupe is idempotent (rebuild still ${count2} = 4)`);

// image_logs PDF filter (raw entries path)
const jobs2: JobMetadata[] = [
  mk("J1", "import_movies", []),
  mk("J2", "class_2D", ["J1"]),
];
jobs2[1].image_logs = [
  {
    _id: "l1", type: "image", text: "Result PDF",
    imgfiles: [
      { fileid: "j2_pdf", filename: "result.pdf", filetype: "pdf" },
      { fileid: "j2_png", filename: "result.png", filetype: "png" },
    ],
  },
];
const s2 = buildSummary(jobs2, "PX", "J2", "http://192.168.202.11:8080");
const k2 = (s2.nodes.find((n) => n.uid === "J2")?.images || []).filter((im) => im.kind === "image_log");
check(k2.length === 1, `image_logs: PDF file filtered, PNG kept (${k2.length} = 1)`);

console.log(ok ? "\n✅ UNIT CHECK PASS" : "\n❌ UNIT CHECK FAIL");
process.exit(ok ? 0 : 2);
