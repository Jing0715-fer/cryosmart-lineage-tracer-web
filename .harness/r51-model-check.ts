/**
 * v3.91 round-51 logic check: the flow figure for the user's REAL
 * P222 / J906 lineage (DAG + counts reconstructed from the uploaded
 * CryoSmart_P222_J906_lineage_report.html — 15 jobs) must NOT collapse
 * to the 3-job figure the user saw (J815 / J901 / J906). The old spine
 * DFS classified J897 (particles + reference map into J906) as a
 * volume-side parent and let the MASK branch J904 → J901 import_volumes
 * win the first-map race, so J817/J871/J895/J897 never entered the model.
 *
 * Asserts, per mode:
 *   - 手动 catalog (classificationMiddles:false): all 6 mainline jobs
 *     J815/J817/J871/J895/J897/J906, J901 Import Volumes ABSENT,
 *     J817 + J871 carry 3 class thumbnails each;
 *   - 标准 model: the same spine minus non-classification middles →
 *     [J815, J817, J871, J906] with omission notes for the dropped
 *     reconstruct + first local refine; reference = J906's map;
 *   - 极简 model: census head J805 class_2D (4,216,535 — the largest
 *     classification), J817/J871 present, final row J906, J901 absent;
 *   - the OLD bug shape is gone: no build lists J901 as a stage row.
 *
 * Run: bun .harness/r51-model-check.ts
 */
import { buildFlowFigureModel } from "../src/lib/cryosmart/workflow-figure";
import type { LineageSummary, LineageNode, LineageEdge } from "../src/lib/cryosmart/types";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) {
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

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

const mapAsset = (group: string, result = "map") => ({
  group,
  group_title: "",
  group_type: "volume",
  result_name: result,
  download_url: `http://mock/P222/map_${group}.mrc`,
  preview_url: null,
  preview_src: null,
  preview_original_url: null,
});
const classMaps = (n: number) =>
  Array.from({ length: n }, (_, i) => mapAsset(`volume_class_${i}`));

const edge = (source: string, target: string, input_type: string): LineageEdge =>
  ({ source, target, input_type } as LineageEdge);

const classes = (counts: number[]) =>
  counts.map((n, i) => ({
    class_index: i,
    volume_group: `volume_class_${i}`,
    particle_count: n,
    particle_percent: null,
    maps: [{ group: `volume_class_${i}`, result_name: "map", download_url: `http://mock/P222/map_${i}.mrc` }],
  }));

/* ---- the P222 / J906 DAG, exactly as the lineage report reads it ---- */
const nodes: LineageNode[] = [
  node("J784", "import_micrographs", null, { micrograph_count: 324 }),
  node("J789", "import_micrographs", null, { micrograph_count: 5993 }),
  node("J785", "patch_ctf_estimation_multi", null, { micrograph_count: 6317 }),
  node("J786", "blob_picker_gpu", 4832378),
  node("J787", "extract_micrographs_multi", 4216535),
  node("J805", "class_2D", 4216535, {
    images: [
      { kind: "ui_tile", name: "class_averages", url: "http://mock/P222/J805/class_averages.png", src: "", original_url: "" },
    ],
  }),
  node("J815", "select_2D", 3504799, {
    select_2d: { particles_selected: 3504799, classes_selected: 157, particles_excluded: 711736 },
    images: [
      { kind: "output_group", name: "templates_selected", url: "http://mock/P222/J815/templates_selected.png", src: "", original_url: "" },
    ],
  }),
  node("J816", "extract_micrographs_multi", 3496956),
  node("J817", "homo_abinit", 3496956, { classes: classes([1537414, 862940, 1096602]), maps: classMaps(3) }),
  node("J871", "homo_abinit", 1537414, { classes: classes([639561, 523066, 374787]), maps: classMaps(3) }),
  node("J895", "homo_reconstruct", 639561, { maps: [mapAsset("volume")] }),
  node("J897", "new_local_refine", 639561, { maps: [mapAsset("volume")] }),
  node("J901", "import_volumes", null, { maps: [mapAsset("imported_volume_1")] }),
  node("J904", "volume_tools", null), // mask producer — NO map assets (log images only)
  node("J906", "new_local_refine", 639561, { maps: [mapAsset("volume")] }),
];

const edges: LineageEdge[] = [
  edge("J784", "J785", "exposure"),
  edge("J789", "J785", "exposure"),
  edge("J785", "J786", "exposure"),
  edge("J786", "J787", "particle"),
  edge("J785", "J787", "exposure"),
  edge("J787", "J805", "particle"),
  edge("J805", "J815", "particle"),
  edge("J805", "J815", "template"),
  edge("J785", "J816", "exposure"),
  edge("J815", "J816", "particle"),
  edge("J816", "J817", "particle"),
  edge("J817", "J871", "particle"), // particles_class_0
  edge("J871", "J895", "particle"), // particles_class_0
  edge("J895", "J897", "particle"),
  edge("J895", "J897", "volume"), // reference map
  edge("J895", "J897", "mask"),
  edge("J897", "J906", "particle"),
  edge("J897", "J906", "volume"), // reference map — the dual-edge mainline parent
  edge("J904", "J906", "mask"), // the mask-only side branch
  edge("J901", "J904", "volume"), // volume_tools operated on the imported volume
];

const summary: LineageSummary = {
  start_uid: "J906",
  nodes,
  edges,
} as unknown as LineageSummary;

const flatUids = (m: ReturnType<typeof buildFlowFigureModel>) => m.groups.flatMap((g) => g.map((it) => it.uid));
const findItem = (m: ReturnType<typeof buildFlowFigureModel>, uid: string) =>
  m.groups.flatMap((g) => g).find((it) => it.uid === uid) ?? null;

/* ---------------- 手动 catalog (the checklist the user saw) --------------- */
console.log("\n[1] 手动 catalog (classificationMiddles:false)");
const manual = buildFlowFigureModel(summary, { maxGroups: 10, simplified: false, classificationMiddles: false });
{
  const uids = flatUids(manual);
  console.log(`  catalog: ${uids.join(" -> ")}`);
  check(
    ["J815", "J817", "J871", "J895", "J897", "J906"].every((u) => uids.includes(u)),
    "all six mainline jobs present (J815/J817/J871/J895/J897/J906)",
  );
  check(!uids.includes("J901"), "J901 Import Volumes is NOT a catalog stage (data input, side branch)");
  check(!uids.includes("J904"), "J904 volume_tools (mask producer, map-less) is NOT a catalog stage");
  const j817 = findItem(manual, "J817");
  const j871 = findItem(manual, "J871");
  check((j817?.classes?.length ?? 0) === 3, "J817 ab-initio row carries its 3 class thumbnails");
  check((j871?.classes?.length ?? 0) === 3, "J871 ab-initio row carries its 3 class thumbnails");
  check(manual.referenceKey?.startsWith("J906/") === true, "reference map = the final J906 map", String(manual.referenceKey));
  const order = uids.filter((u) => ["J815", "J817", "J871", "J895", "J897", "J906"].includes(u));
  check(
    JSON.stringify(order) === JSON.stringify(["J815", "J817", "J871", "J895", "J897", "J906"]),
    "mainline order reads ancestor → final",
  );
}

/* ------------------------- 标准 model (deck shape) ------------------------ */
console.log("\n[2] 标准 model (classificationMiddles:true)");
const standard = buildFlowFigureModel(summary, { maxGroups: 10, simplified: false, classificationMiddles: true });
{
  const uids = flatUids(standard);
  console.log(`  rows: ${uids.join(" -> ")}`);
  check(!uids.includes("J901"), "standard deck: J901 import stripped");
  check(uids.includes("J817") && uids.includes("J871"), "standard deck: both ab-initio classification rows render");
  check(uids[uids.length - 1] === "J906", "standard deck: final row = J906");
  const flatNotes = JSON.stringify(standard.omissions ?? []);
  check(
    /Reconstruction/.test(flatNotes) && /Local refinement/.test(flatNotes),
    "omission notes name the dropped J895 reconstruct + J897 local-refine middles",
    flatNotes.slice(0, 160),
  );
}

/* ------------------------- 极简 model (census head) ----------------------- */
console.log("\n[3] 极简 model (minimal:true)");
const minimal = buildFlowFigureModel(summary, { maxGroups: 6, simplified: true, minimal: true });
{
  const uids = flatUids(minimal);
  console.log(`  rows: ${uids.join(" -> ")}`);
  check(uids[0] === "J805", "funnel head = J805 class_2D (census winner, 4,216,535 classified)", uids[0]);
  check(!!findItem(minimal, "J805")?.imageUrl, "the head row is the 2D class-averages montage");
  const abinit = findItem(minimal, "J871");
  check(
    !!abinit && /2×/.test(abinit.label) && (abinit.classes?.length ?? 0) === 3,
    "both ab-initio stages ride ONE merged 2× Ab-initio row (J817 → J871, 3 classes)",
    abinit?.label ?? "missing",
  );
  check(
    minimal.warnings.some((w) => /J817 → J871/.test(w)),
    "the merge warning names J817 → J871",
  );
  const finalRow = minimal.groups[minimal.groups.length - 1].find((it) => it.uid === "J906");
  check(
    !!finalRow && /2×/.test(finalRow.label),
    "J897 merges into the final 2× Local refinement row",
    finalRow?.label ?? "missing",
  );
  check(uids[uids.length - 1] === "J906", "极简 final row = J906");
  check(!uids.includes("J901"), "极简: J901 import never a row");
  check(
    minimal.warnings.some((w) => /J805|2D/i.test(w)),
    "census warning names the J805 2D-classification head",
  );
}

/* --------------- the OLD bug shape, asserted dead in every mode ----------- */
console.log("\n[4] old-bug regression");
for (const [label, m] of [
  ["手动", manual],
  ["标准", standard],
  ["极简", minimal],
] as const) {
  const uids = flatUids(m);
  const collapsed =
    uids.length <= 3 && uids.includes("J901") && uids.includes("J906") && !uids.includes("J817");
  check(!collapsed, `${label} model is NOT the collapsed [J815/J901/J906] figure`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
