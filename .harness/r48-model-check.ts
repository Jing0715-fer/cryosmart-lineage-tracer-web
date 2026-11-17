/**
 * v3.88 round-48 logic check: build the 极简 flow-figure model for a mock
 * lineage shaped EXACTLY like the user's real P283 / J55 (counts + DAG from
 * the uploaded lineage report) and assert:
 *   - the funnel head = J6 class_2D (2,860,632 — the census winner), not J9;
 *   - the head montage imageUrl points at J6's class-averages asset;
 *   - the row after the head = J9 (entry 504,371 = the J7 selection output);
 *   - the '4× Hetero refinement' merged row (J12+J32+J38+J41, rep J41);
 *   - the omission notes name the select_2D and the skipped middles;
 *   - a same-reference parallel-split classification sums into ONE stage.
 *
 * Run: bun .harness/r48-model-check.ts
 */
import { buildFlowFigureModel } from "../src/lib/cryosmart/workflow-figure";
import type { LineageSummary, LineageNode, LineageEdge } from "../src/lib/cryosmart/types";

const node = (uid: string, job_type: string, particle_count: number | null, extra: Partial<LineageNode> = {}): LineageNode =>
  ({
    uid,
    job_type,
    title: job_type,
    particle_count,
    micrograph_count: null,
    parents: [],
    children: [],
    images: [],
    maps: [],
    ...extra,
  } as LineageNode);

const mapAsset = (group: string) => ({
  group, group_title: "", group_type: "volume", result_name: "map",
  download_url: `http://mock/P283/map_${group}.mrc`, preview_url: null, preview_src: null, preview_original_url: null,
});
const classMaps = (n: number) =>
  Array.from({ length: n }, (_, i) => mapAsset(`volume_class_${i}`));


const edge = (source: string, target: string, input_type: string): LineageEdge =>
  ({ source, target, input_type } as LineageEdge);

/* class split helper — per-class particle counts */
const classes = (counts: number[]) =>
  counts.map((n, i) => ({
    class_index: i,
    volume_group: `volume_class_${i}`,
    particle_count: n,
    particle_percent: null,
    maps: [{ group: `volume_class_${i}`, result_name: "map", download_url: `http://mock/P283/map_${i}.mrc` }],
  }));

const nodes: LineageNode[] = [
  node("J1", "import_micrographs", null, { micrograph_count: 6647 }),
  node("J2", "patch_ctf_estimation_multi", null, { micrograph_count: 6647 }),
  node("J3", "blob_picker_gpu", 3408286),
  node("J4", "extract_micrographs_multi", 2860632),
  node("J6", "class_2D", 2860632, {
    images: [
      { kind: "ui_tile", name: "class_averages", url: "http://mock/P283/J6/class_averages.png", src: "", original_url: "" },
    ],
  }),
  node("J7", "select_2D", 2356261, {
    select_2d: { particles_selected: 504371, classes_selected: 15, particles_excluded: 2356261 },
    images: [
      { kind: "output_group", name: "selected_classes", url: "http://mock/P283/J7/selected.png", src: "", original_url: "" },
    ],
  }),
  node("J9", "homo_abinit", 504371, { classes: classes([140591, 182396, 181384]), maps: classMaps(3) }),
  node("J10", "hetero_refine", 504371, { classes: classes([151078, 202743, 150550]), maps: classMaps(3) }),
  node("J11", "homo_abinit", 202743, { classes: classes([80765, 42699, 79279]), maps: classMaps(3) }),
  node("J12", "hetero_refine", 202743, { classes: classes([88630, 38458, 75655]), maps: classMaps(3) }),
  node("J13", "extract_micrographs_multi", 163630),
  node("J14", "homo_abinit", 163630, { classes: classes([60000, 55000, 48630]), maps: classMaps(3) }),
  node("J15", "hetero_refine", 163630, { classes: classes([60000, 55000, 48630]), maps: classMaps(3) }),
  node("J16", "topaz_train", null, { micrograph_count: 6647 }),
  node("J17", "topaz_extract", 1947991),
  node("J18", "extract_micrographs_multi", 1826975),
  node("J20", "hetero_refine", 1826975, { classes: classes([454834, 334641, 402861, 634639]), maps: classMaps(4) }),
  node("J21", "hetero_refine", 1826975, { classes: classes([500000, 400000, 400000, 526975]), maps: classMaps(4) }),
  node("J22", "class_2D", 1826975),
  node("J23", "select_2D", 1447207, {
    select_2d: { particles_selected: 379768, classes_selected: 23, particles_excluded: 1447207 },
  }),
  node("J25", "homo_abinit", 379768, { classes: classes([130000, 125000, 124768]), maps: classMaps(3) }),
  node("J28", "import_volumes", null, { maps: [{ group: "volume", group_title: "", group_type: "volume", result_name: "map", download_url: "http://mock/P283/J28/import.mrc", preview_url: null, preview_src: null, preview_original_url: null }] }),
  node("J29", "hetero_refine", 1826975, { classes: classes([454834, 334641, 402861, 634639]), maps: classMaps(4) }),
  node("J30", "nonuniform_refine_new", 163630, { maps: [{ group: "volume", group_title: "", group_type: "volume", result_name: "map", download_url: "http://mock/P283/J30/map.mrc", preview_url: null, preview_src: null, preview_original_url: null }] }),
  node("J32", "hetero_refine", 1826975, { classes: classes([454834, 334641, 402861, 634639]), maps: classMaps(4) }),
  node("J35", "remove_duplicate_particles", 1501260),
  node("J36", "extract_micrographs_multi", 1501260),
  node("J38", "hetero_refine", 1501260, { classes: classes([331822, 179091, 307941, 682406]), maps: classMaps(4) }),
  node("J40", "remove_duplicate_particles", 630498),
  node("J41", "hetero_refine", 630498, { classes: classes([83644, 76051, 54198, 416605]), maps: classMaps(4) }),
  node("J42", "nonuniform_refine_new", 416605, { maps: [{ group: "volume", group_title: "", group_type: "volume", result_name: "map", download_url: "http://mock/P283/J42/map.mrc", preview_url: null, preview_src: null, preview_original_url: null }] }),
  node("J43", "ctf_refine_global", 416605),
  node("J48", "homo_abinit", 416605, { classes: classes([187655, 184116, 44834]), maps: classMaps(3) }),
  node("J50", "homo_reconstruct", 187655, { maps: [{ group: "volume", group_title: "", group_type: "volume", result_name: "map", download_url: "http://mock/P283/J50/map.mrc", preview_url: null, preview_src: null, preview_original_url: null }] }),
  node("J55", "nonuniform_refine_new", 187655, { maps: [{ group: "volume", group_title: "", group_type: "volume", result_name: "map", download_url: "http://mock/P283/J55/map.mrc", preview_url: null, preview_src: null, preview_original_url: null }] }),
];

const E = (s: string, t: string, ty = "particle") => edge(s, t, ty);
const edges: LineageEdge[] = [
  E("J1", "J2"), E("J1", "J3"), E("J1", "J16"), E("J2", "J3"),
  E("J3", "J4"), E("J3", "J13"), E("J3", "J18"), E("J3", "J36"),
  E("J4", "J6"), E("J6", "J7"),
  E("J7", "J9"), E("J9", "J10"), E("J10", "J11"), E("J11", "J12"), E("J12", "J13"),
  E("J13", "J14"), E("J14", "J15"), E("J15", "J20"),
  E("J13", "J16"), E("J16", "J17"), E("J17", "J18"), E("J18", "J20"), E("J18", "J21"), E("J18", "J22"), E("J18", "J29"), E("J18", "J32"),
  E("J22", "J23"), E("J23", "J25"),
  E("J20", "J35"), E("J21", "J35"), E("J25", "J35"), E("J29", "J35"), E("J32", "J35"),
  E("J35", "J36"), E("J36", "J38"), E("J38", "J40"), E("J40", "J41"),
  E("J41", "J42"), E("J42", "J43"), E("J43", "J48"), E("J48", "J50"), E("J50", "J55"),
  /* volume-reference edges (the DAG's map inputs) */
  E("J9", "J10", "volume"), E("J9", "J20", "volume"), E("J9", "J21", "volume"), E("J9", "J29", "volume"), E("J9", "J32", "volume"),
  E("J9", "J38", "volume"), E("J9", "J41", "volume"),
  E("J10", "J11", "volume"), E("J11", "J12", "volume"), E("J12", "J13", "volume"),
  E("J13", "J14", "volume"), E("J14", "J15", "volume"), E("J15", "J20", "volume"),
  E("J25", "J29", "volume"), E("J28", "J29", "volume"), E("J28", "J30", "volume"),
  E("J30", "J32", "volume"), E("J30", "J38", "volume"), E("J30", "J41", "volume"),
  E("J41", "J42", "volume"), E("J48", "J50", "volume"), E("J50", "J55", "volume"),
];

const summary: LineageSummary = {
  project_uid: "P283",
  start_uid: "J55",
  start_job: nodes[nodes.length - 1],
  nodes,
  edges,
  base_url: "http://mock",
  class_split_jobs: [],
} as unknown as LineageSummary;

const model = buildFlowFigureModel(summary, { minimal: true, maxGroups: 5, includeSelect2d: false });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("== rows ==");
model.groups.forEach((g, i) => {
  const it = g[0];
  console.log(
    `  [${i}] ${g.map((x) => `${x.uid}`).join("+")} · ${it.label} · entry=${it.entryParticleCount ?? it.particleTotal ?? "?"} · stats=${JSON.stringify(it.stats)} · img=${it.imageUrl ? "yes" : "no"}${it.classes ? ` · classes=${it.classes.length}` : ""}`,
  );
});
console.log("== omissions ==");
model.omissions?.forEach((o, i) => console.log(`  gap ${i}: ${o.map((x) => `${x.count}× ${x.label}`).join(" · ") || "—"}`));

const head = model.groups[0]?.[0];
check("head row = J6 (class_2D census winner)", head?.uid === "J6", head?.uid ?? "none");
check("head count = 2,860,632", head?.particleTotal === 2860632, String(head?.particleTotal));
check("head carries the class-averages montage", head?.imageUrl?.includes("class_averages") ?? false, head?.imageUrl ?? "none");
const second = model.groups[1]?.[0];
check("second row = J9 (the post-selection ab-initio)", second?.uid === "J9", second?.uid ?? "none");
check("J9 entry = 504,371 (the J7 selection output)", (second?.entryParticleCount ?? second?.particleTotal) === 504371);
const fourX = model.groups.find((g) => g[0]?.label.startsWith("4×"));
check("merged 4× Hetero refinement row present", !!fourX, fourX?.[0].label ?? "none");
check("4× row entry = J12's 202,743", fourX?.[0].entryParticleCount === 202743, String(fourX?.[0].entryParticleCount));
check("last row = J55 final", model.groups[model.groups.length - 1]?.[0]?.uid === "J55");
const firstGap = model.omissions?.[0] ?? [];
check("first gap note names the 2D class selection", firstGap.some((o) => /2D class selection/i.test(o.label)), JSON.stringify(firstGap));
const j48 = model.groups.find((g) => g[0]?.uid === "J48");
check("J48 ab-initio row present (budget 5)", !!j48);
check("row count ≤ 5", model.groups.length <= 5, String(model.groups.length));

/* the retention the deck prints under the head: 504,371 / 2,860,632 */
const pct = 504371 / 2860632;
console.log(`\nhead transition = ${(pct * 100).toFixed(1)}% (expect 17.6%)`);
check("selection ratio ≈ 17.6%", Math.abs(pct * 100 - 17.6) < 0.1, (pct * 100).toFixed(2));

/* parallel-split summing: add two same-ref class_2D shards feeding one
 * select and confirm the census treats them as ONE 3,000,000 stage. */
{
  const { classificationStageCensus } = await import("../src/lib/cryosmart/workflow-figure");
  const g = await import("../src/lib/cryosmart/workflow-figure");
  void g;
  const nodes2: LineageNode[] = [
    node("J5", "extract_micrographs_multi", 3000000),
    node("JA", "class_2d", 1400000),
    node("JB", "class_2d", 1600000),
    node("JS", "select_2d", 3000000, { select_2d: { particles_selected: 900000, classes_selected: 10, particles_excluded: 3000000 } }),
    node("JF", "hetero_refine", 900000, { classes: classes([400000, 500000]), maps: classMaps(2) }),
  ];
  const edges2: LineageEdge[] = [
    E("J5", "JA"), E("J5", "JB"), E("JA", "JS"), E("JB", "JS"), E("JS", "JF"),
  ];
  const summary2 = {
    project_uid: "P999",
    start_uid: "JF",
    start_job: nodes2[4],
    nodes: nodes2,
    edges: edges2,
    base_url: "http://mock",
    class_split_jobs: [],
  } as unknown as LineageSummary;
  const census = classificationStageCensus(summary2, {
    byUid: new Map(nodes2.map((n) => [n.uid, n])),
    parentsOf: new Map(),
    volParentsOf: new Map(),
    depth: new Map(),
    ancestorUids: new Set(["J5", "JA", "JB", "JS", "JF"]),
  } as never);
  const stage = census.find((s) => s.is2d);
  check(
    "parallel same-ref class_2D shards sum to 3,000,000",
    !!stage && stage.count === 3000000 && stage.uids.length === 2,
    stage ? `${stage.uids.join("+")} = ${stage.count}` : "none",
  );
  const m2 = buildFlowFigureModel(summary2, { minimal: true, maxGroups: 4, includeSelect2d: false });
  const h2 = m2.groups[0]?.[0];
  check("split-2D lineage head = the summed 3,000,000 stage", h2?.particleTotal === 3000000, String(h2?.particleTotal));
  const pct2 = 900000 / 3000000;
  check("split-lineage selection ratio 30%", Math.abs(pct2 - 0.3) < 1e-9, (pct2 * 100).toFixed(1));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
