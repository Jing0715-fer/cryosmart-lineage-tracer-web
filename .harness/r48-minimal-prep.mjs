/**
 * v3.88 E2E staging: posts the round-48 MINIMAL-MODE lineage — the user's
 * REAL P283 / J55 shape (35 jobs, every count and edge from the uploaded
 * lineage report: J1→J3 blob 3,408,286 → J4 extract 2,860,632 → J6
 * class_2D → J7 select_2D 504,371 → J9/J10/J11/J12 → the topaz branch
 * J16→J17 1,947,991 → J18 1,826,975 → J20/J21/J29/J32 → J35 1,501,260 →
 * J38 → J40 630,498 → J41 → J42 416,605 → J43 → J48 → J50 187,655 → J55),
 * so the 极简 deck exercises exactly the round-48 feedback paths:
 *   - the funnel HEAD must be J6 class_2D (2,860,632 — the census winner,
 *     with its class-averages montage served by the mock's new plain
 *     /api/log_image route), then J9 (entry 504,371 = the J7 selection),
 *     then the 4× Hetero row (J12+J32+J38+J41), J48, J55;
 *   - the delivery drill: J42 carries the FSC/Guinier/Orientation log
 *     images (uploaded as bytes → same-origin session URLs, zero network)
 *     + the embedded fsc_xml text, while the refine job J55 carries NONE
 *     — the round-48 failure shape; the widened delivery pool must now
 *     deliver all four files.
 *
 * Run: bun .harness/r48-minimal-prep.mjs [drill-query]  → prints TOKEN=…
 */
const APP = process.env.APP_URL || "http://localhost:3011";
const MOCK = process.env.MOCK_URL || "http://127.0.0.1:3021";
const DRILL = process.argv[2] || process.env.DRILL || "";

const exposureGroup = (n) => [{ name: "micrographs", type: "exposure", num_items: n, contains: [] }];
const particleGroup = (n) => [{ name: "particles", type: "particle", num_items: n, contains: [] }];
const volumeGroup = () => [
  { name: "volume", type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
];
const selectGroups = (selected, excluded) => [
  { name: "particles_selected", type: "particle", num_items: selected, contains: [] },
  { name: "particles_excluded", type: "particle", num_items: excluded, contains: [] },
  { name: "templates_selected", type: "volume", num_items: 15, contains: [] },
  { name: "templates_excluded", type: "volume", num_items: 185, contains: [] },
];
const classSplitGroups = (classes) =>
  classes.flatMap(([idx, count]) => [
    { name: `particles_class_${idx}`, type: "particle", num_items: count, contains: [] },
    { name: `volume_class_${idx}`, type: "volume", num_items: 1, contains: [{ type: "volume.blob", name: "map" }] },
  ]);
const slots = (job_uid, group_name) => ({ job_uid, group_name, slots: [] });
const inGroup = (type, conns) => ({ type, name: type, title: type, connections: conns });
const job = (uid, num, type, extra = {}) => ({
  uid,
  uid_num: num,
  project_uid: "P283",
  job_type: type,
  title: type,
  status: "completed",
  parents: [],
  children: [],
  input_slot_groups: [],
  output_result_groups: [],
  params_spec: {},
  output_group_images: {},
  ui_tile_images: [],
  ...extra,
});

/* ── the real counts (lineage report + deck (6)/(7)) ── */
const jobs = [
  job("J1", 1, "import_micrographs", { output_result_groups: exposureGroup(6647), parents: [] }),
  job("J2", 2, "patch_ctf_estimation_multi", {
    input_slot_groups: [inGroup("exposure", [slots("J1", "micrographs")])],
    parents: ["J1"],
    output_result_groups: exposureGroup(6647),
  }),
  job("J3", 3, "blob_picker_gpu", {
    input_slot_groups: [inGroup("exposure", [slots("J1", "micrographs"), slots("J2", "micrographs")])],
    parents: ["J1", "J2"],
    output_result_groups: particleGroup(3408286),
  }),
  job("J4", 4, "extract_micrographs_multi", {
    input_slot_groups: [inGroup("particle", [slots("J3", "particles")])],
    parents: ["J3"],
    output_result_groups: particleGroup(2860632),
  }),
  /* the round-48 census winner — the 极简 head row */
  job("J6", 6, "class_2D", {
    input_slot_groups: [inGroup("particle", [slots("J4", "particles")])],
    parents: ["J4"],
    output_result_groups: [...particleGroup(2860632), { name: "classes", type: "volume", num_items: 200, contains: [] }],
    ui_tile_images: [{ name: "class_averages", fileid: "J6_class_averages.png", num_cols: 5, num_rows: 4 }],
  }),
  job("J7", 7, "select_2D", {
    input_slot_groups: [inGroup("particle", [slots("J6", "classes")])],
    parents: ["J6"],
    output_result_groups: [...particleGroup(2356261), ...selectGroups(504371, 1851890)],
  }),
  job("J9", 9, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J7", "particles_selected")])],
    parents: ["J7"],
    output_result_groups: [...particleGroup(504371), ...classSplitGroups([[0, 140591], [1, 182396], [2, 181384]])],
  }),
  job("J10", 10, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_0")]),
      inGroup("volume", [slots("J9", "volume_class_0")]),
    ],
    parents: ["J9"],
    output_result_groups: [...particleGroup(504371), ...classSplitGroups([[0, 151078], [1, 202743], [2, 150550]])],
  }),
  job("J11", 11, "homo_abinit", {
    input_slot_groups: [
      inGroup("particle", [slots("J10", "particles_class_0")]),
      inGroup("volume", [slots("J10", "volume_class_0")]),
    ],
    parents: ["J10"],
    output_result_groups: [...particleGroup(202743), ...classSplitGroups([[0, 80765], [1, 42699], [2, 79279]])],
  }),
  job("J12", 12, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J11", "particles_class_0")]),
      inGroup("volume", [slots("J11", "volume_class_0")]),
    ],
    parents: ["J11"],
    output_result_groups: [...particleGroup(202743), ...classSplitGroups([[0, 88630], [1, 38458], [2, 75655]])],
  }),
  job("J13", 13, "extract_micrographs_multi", {
    input_slot_groups: [
      inGroup("particle", [slots("J3", "particles")]),
      inGroup("particle", [slots("J12", "particles_class_0")]),
    ],
    parents: ["J3", "J12"],
    output_result_groups: particleGroup(163630),
  }),
  job("J14", 14, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J13", "particles")])],
    parents: ["J13"],
    output_result_groups: [...particleGroup(163630), ...classSplitGroups([[0, 61000], [1, 53000], [2, 49630]])],
  }),
  job("J15", 15, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J14", "particles_class_0")]),
      inGroup("volume", [slots("J14", "volume_class_0")]),
    ],
    parents: ["J14"],
    output_result_groups: [...particleGroup(163630), ...classSplitGroups([[0, 61000], [1, 53000], [2, 49630]])],
  }),
  job("J16", 16, "topaz_train", {
    input_slot_groups: [
      inGroup("exposure", [slots("J1", "micrographs")]),
      inGroup("particle", [slots("J13", "particles")]),
    ],
    parents: ["J1", "J13"],
    output_result_groups: [],
  }),
  job("J17", 17, "topaz_extract", {
    input_slot_groups: [inGroup("exposure", [slots("J16", "micrographs")])],
    parents: ["J16"],
    output_result_groups: particleGroup(1947991),
  }),
  job("J18", 18, "extract_micrographs_multi", {
    input_slot_groups: [
      inGroup("particle", [slots("J3", "particles")]),
      inGroup("particle", [slots("J17", "particles")]),
    ],
    parents: ["J3", "J17"],
    output_result_groups: particleGroup(1826975),
  }),
  job("J20", 20, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_1"), slots("J15", "particles_class_0"), slots("J18", "particles")]),
      inGroup("volume", [slots("J15", "volume_class_0")]),
    ],
    parents: ["J9", "J15", "J18"],
    output_result_groups: [...particleGroup(1826975), ...classSplitGroups([[0, 454834], [1, 334641], [2, 402861], [3, 634639]])],
  }),
  job("J21", 21, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_2"), slots("J18", "particles")]),
      inGroup("volume", [slots("J9", "volume_class_2")]),
    ],
    parents: ["J9", "J18"],
    output_result_groups: [...particleGroup(1826975), ...classSplitGroups([[0, 500000], [1, 400000], [2, 400000], [3, 526975]])],
  }),
  job("J22", 22, "class_2D", {
    input_slot_groups: [inGroup("particle", [slots("J18", "particles")])],
    parents: ["J18"],
    output_result_groups: [...particleGroup(1826975), { name: "classes", type: "volume", num_items: 200, contains: [] }],
  }),
  job("J23", 23, "select_2D", {
    input_slot_groups: [inGroup("particle", [slots("J22", "classes")])],
    parents: ["J22"],
    output_result_groups: [...particleGroup(1447207), 
      { name: "particles_selected", type: "particle", num_items: 379768, contains: [] },
      { name: "particles_excluded", type: "particle", num_items: 1067439, contains: [] },
      { name: "templates_selected", type: "volume", num_items: 23, contains: [] },
      { name: "templates_excluded", type: "volume", num_items: 177, contains: [] },
    ],
  }),
  job("J25", 25, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J23", "particles_selected")])],
    parents: ["J23"],
    output_result_groups: [...particleGroup(379768), ...classSplitGroups([[0, 130000], [1, 125000], [2, 124768]])],
  }),
  job("J28", 28, "import_volumes", {
    output_result_groups: volumeGroup(),
    parents: [],
  }),
  job("J29", 29, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_0"), slots("J18", "particles")]),
      inGroup("volume", [slots("J28", "volume")]),
    ],
    parents: ["J9", "J18", "J28"],
    output_result_groups: [...particleGroup(1826975), ...classSplitGroups([[0, 454834], [1, 334641], [2, 402861], [3, 634639]])],
  }),
  job("J30", 30, "nonuniform_refine_new", {
    input_slot_groups: [
      inGroup("particle", [slots("J13", "particles")]),
      inGroup("volume", [slots("J28", "volume")]),
    ],
    parents: ["J13", "J28"],
    output_result_groups: [...particleGroup(163630), ...volumeGroup()],
  }),
  job("J32", 32, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_1"), slots("J18", "particles")]),
      inGroup("volume", [slots("J30", "volume")]),
    ],
    parents: ["J9", "J18", "J30"],
    output_result_groups: [...particleGroup(1826975), ...classSplitGroups([[0, 454834], [1, 334641], [2, 402861], [3, 634639]])],
  }),
  job("J35", 35, "remove_duplicate_particles", {
    input_slot_groups: [
      inGroup("particle", [slots("J20", "particles_class_3"), slots("J21", "particles_class_3"), slots("J25", "particles_class_0"), slots("J29", "particles_class_3"), slots("J32", "particles_class_3")]),
    ],
    parents: ["J20", "J21", "J25", "J29", "J32"],
    output_result_groups: particleGroup(1501260),
  }),
  job("J36", 36, "extract_micrographs_multi", {
    input_slot_groups: [
      inGroup("particle", [slots("J3", "particles"), slots("J35", "particles")]),
    ],
    parents: ["J3", "J35"],
    output_result_groups: particleGroup(1501260),
  }),
  job("J38", 38, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_2"), slots("J30", "volume"), slots("J36", "particles")]),
      inGroup("volume", [slots("J30", "volume")]),
    ],
    parents: ["J9", "J30", "J36"],
    output_result_groups: [...particleGroup(1501260), ...classSplitGroups([[0, 331822], [1, 179091], [2, 307941], [3, 682406]])],
  }),
  job("J40", 40, "remove_duplicate_particles", {
    input_slot_groups: [inGroup("particle", [slots("J38", "particles_class_3")])],
    parents: ["J38"],
    output_result_groups: particleGroup(630498),
  }),
  job("J41", 41, "hetero_refine", {
    input_slot_groups: [
      inGroup("particle", [slots("J9", "particles_class_0"), slots("J30", "volume"), slots("J40", "particles")]),
      inGroup("volume", [slots("J30", "volume")]),
    ],
    parents: ["J9", "J30", "J40"],
    output_result_groups: [...particleGroup(630498), ...classSplitGroups([[0, 83644], [1, 76051], [2, 54198], [3, 416605]])],
  }),
  job("J42", 42, "nonuniform_refine_new", {
    input_slot_groups: [
      inGroup("particle", [slots("J41", "particles_class_3")]),
      inGroup("volume", [slots("J41", "volume_class_3")]),
    ],
    parents: ["J41"],
    output_result_groups: [...particleGroup(416605), ...volumeGroup()],
  }),
  job("J43", 43, "ctf_refine_global", {
    input_slot_groups: [inGroup("particle", [slots("J42", "volume")])],
    parents: ["J42"],
    output_result_groups: particleGroup(416605),
  }),
  job("J48", 48, "homo_abinit", {
    input_slot_groups: [inGroup("particle", [slots("J43", "particles")])],
    parents: ["J43"],
    output_result_groups: [...particleGroup(416605), ...classSplitGroups([[0, 187655], [1, 184116], [2, 44834]])],
  }),
  job("J50", 50, "homo_reconstruct", {
    input_slot_groups: [inGroup("particle", [slots("J48", "particles_class_0")])],
    parents: ["J48"],
    output_result_groups: [...particleGroup(187655), ...volumeGroup()],
  }),
  job("J55", 55, "nonuniform_refine_new", {
    input_slot_groups: [
      inGroup("particle", [slots("J50", "volume")]),
      inGroup("volume", [slots("J50", "volume")]),
    ],
    parents: ["J50"],
    output_result_groups: [...particleGroup(187655), ...volumeGroup()],
  }),
];

const main = async () => {
  const reset = await fetch(`${MOCK}/flow-e2e/reset?corr=0.9${DRILL ? `&${DRILL}` : ""}`).then((r) => r.json()).catch(() => null);
  console.log("mock reset:", JSON.stringify(reset));
  const createResp = await fetch(`${APP}/api/cryosmart/import/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_uid: "P283",
      cryosmart_origin: MOCK,
      cryosmart_cookie: "session=e2e-cookie",
      source: "r48-minimal-prep",
      end_job_uid: "J55",
      lineage_mode: true,
    }),
  });
  const { token } = await createResp.json();
  if (!token) {
    console.error("no token", createResp.status, await createResp.text());
    process.exit(1);
  }
  await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_uid: "P283", jobs }),
  });

  /* ── the round-48 delivery drill: the refine job J55 carries NO plot
   *    images while J42 (an ancestor) carries the FSC/Guinier/orientation
   *    log images as UPLOADED BYTES (zero-network session URLs) plus the
   *    embedded fsc.xml text — the exact shape the user's real capture
   *    had, and the reason the report showed the right curves while the
   *    delivered files failed. Pull the bytes from the mock's own
   *    plot/xml endpoints so the ratios match the webpage convention. */
  const plot = async (suffix) => {
    const r = await fetch(`${MOCK}/api/log_image/download_result_file/P283/J42.volume.${suffix}`, {
      headers: { Cookie: "session=e2e-cookie" },
    });
    if (!r.ok) throw new Error(`mock plot ${suffix}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const toDataUri = (bytes) =>
    "data:image/png;base64," + Buffer.from(bytes).toString("base64");
  const fscPng = await plot("fsc.png");
  const guinierPng = await plot("guinier_plot.png");
  const orientPng = await plot("orientation_distribution.png");
  const xmlText = await fetch(`${MOCK}/api/log_image/download_result_file/P283/J42.volume.fsc.xml`, {
    headers: { Cookie: "session=e2e-cookie" },
  }).then((r) => r.text());

  await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          uid: "J42",
          images: [
            { fileid: "fsc_1_FSC.png", name: "fsc_1_FSC.png", text: "FSC", flags: [] },
            { fileid: "guinier_1_Guinier_Plot.png", name: "guinier_1_Guinier_Plot.png", text: "Guinier Plot", flags: [] },
            { fileid: "orient_1_Orientation_Distribution.png", name: "orient_1_Orientation_Distribution.png", text: "Orientation Distribution", flags: [] },
          ],
          fsc_xml: { xml: xmlText, name: "TMEM175.volume.fsc.xml" },
        },
      ],
    }),
  });
  const imageItems = [
    ["fsc_1_FSC.png", fscPng],
    ["guinier_1_Guinier_Plot.png", guinierPng],
    ["orient_1_Orientation_Distribution.png", orientPng],
  ].map(([fileid, bytes]) => ({ fileid, data: toDataUri(bytes) }));
  const imgResp = await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: imageItems }),
  });
  if (!imgResp.ok) console.error("image upload failed", imgResp.status, await imgResp.text());
  else console.log("plot bytes uploaded:", JSON.stringify(await imgResp.json()));

  const complete = await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("TOKEN=" + token);
  console.log("jobs:", jobs.length, "complete:", complete.status);
};
main();
