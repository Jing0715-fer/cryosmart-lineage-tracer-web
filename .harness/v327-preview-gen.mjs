/**
 * v3.27 preview generator — one standalone report HTML per template (8 ids)
 * with a BIG Lineage Outline (40 major nodes) into public/tmp-v327/ for
 * agent-browser scrollbar verification: the left .flow-pane must overflow
 * its max-height AND be scrollable (overflow:auto) — the v3.27 cascade fix.
 * Run: bun .harness/v327-preview-gen.mjs   (from the repo root)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildLineageHtmlV2 } from "../src/lib/cryosmart/report-html.ts";
import { REPORT_TEMPLATES } from "../src/lib/cryosmart/report-style.ts";

// tiny PNG data URL — image CONTENT doesn't matter here; this E2E tests
// the outline scrollbar, not image rendering.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const NO_PARAMS = { box_size_pix: null, extracted_box_size_pix: null, bin_factor: null, bin_inferred: false };
const base = (uid, job_type, extra = {}) => ({
  uid,
  uid_num: null,
  project_uid: "PX27",
  job_type,
  title: `${uid} ${job_type}`,
  status: "completed",
  created_at: null,
  completed_at: null,
  parents: [],
  children: [],
  particle_count: null,
  micrograph_count: null,
  pixel_size_A: null,
  volume_count: null,
  class_count: null,
  resolution_A: null,
  extraction_params: { ...NO_PARAMS },
  output_groups: {},
  images: [],
  maps: [],
  classes: [],
  select_2d: null,
  representative_micrograph_images: [],
  ...extra,
});

const logImages = (uid) => [
  { kind: "log_image", name: `${uid} fsc.png`, url: PNG, src: PNG, original_url: PNG },
  { kind: "log_image", name: `${uid} volume.png`, url: PNG, src: PNG, original_url: PNG },
];

const N = 40;
const nodes = [
  base("J1", "import_micrographs", {
    micrograph_count: 6400,
    pixel_size_A: 0.83,
    representative_micrograph_images: [
      { kind: "ui_tile", name: "mic1", url: PNG, src: PNG, original_url: PNG },
    ],
  }),
];
const edges = [];
for (let i = 2; i <= N; i++) {
  const type = i === N ? "relion_refine" : i % 3 === 0 ? "class_2D" : i % 3 === 1 ? "select_2D" : "relion_refine";
  nodes.push(
    base(`J${i}`, type, {
      particle_count: 100000 + i * 7,
      images: logImages(`J${i}`),
      ...(i === N
        ? {
            volume_count: 3,
            maps: [
              { name: `final.mrc`, url: PNG, src: PNG, group: "volume", group_type: "volume", result_name: "final", size_bytes: 12345 },
            ],
          }
        : {}),
    })
  );
  edges.push({ source: `J${i - 1}`, target: `J${i}`, input_type: "particles", slots: [] });
}

const summary = { project_uid: "PX27", start_uid: `J${N}`, nodes, edges };

mkdirSync("public/tmp-v327", { recursive: true });
for (const t of REPORT_TEMPLATES) {
  const html = buildLineageHtmlV2(summary, {
    template: t.id,
    fontScale: "standard",
    widthMode: "full",
    imageMode: "embed",
    titleOverride: "",
    subtitle: "v3.27 · Lineage Outline scrollbar verification (40-node outline)",
  });
  writeFileSync(`public/tmp-v327/${t.id}.html`, html);
  console.log(`wrote public/tmp-v327/${t.id}.html (${(html.length / 1024).toFixed(0)} KB)`);
}
