/**
 * Sample CryoSmart project metadata — a synthetic but realistic cryo-EM
 * single-particle workflow. Used for demo / "try with sample data" button
 * so users can see the full pipeline without a real CryoSmart instance.
 *
 * Shape matches what `normalizeJobsPayload` in lineage.ts accepts:
 * either a top-level array of jobs OR `{ jobs: [...] }`.
 */

export interface SampleDataOptions {
  projectId?: string;
  startJob?: number;
}

export function buildSampleProjectMetadata(opts: SampleDataOptions = {}): { jobs: unknown[]; project_uid: string; experiment_uid: string } {
  const projectId = opts.projectId || "P52";
  const experimentId = "EXP1";

  const jobs: unknown[] = [];

  function job(partial: Record<string, unknown>): unknown {
    const uid = partial.uid as string;
    const uidNum = parseInt(uid.replace(/^J/i, ""), 10);
    return {
      uid,
      uid_num: uidNum,
      project_uid: projectId,
      status: "completed",
      created_at: { $date: `2025-01-${String(10 + uidNum).padStart(2, "0")}T10:00:00.000Z` },
      completed_at: { $date: `2025-01-${String(10 + uidNum).padStart(2, "0")}T11:30:00.000Z` },
      parents: [],
      children: [],
      params_spec: {},
      input_slot_groups: [],
      output_result_groups: [],
      output_group_images: {},
      ui_tile_images: [],
      overview_assets: {},
      ...partial,
    };
  }

  // J1: import_movies
  jobs.push(job({
    uid: "J1",
    job_type: "import_movies",
    title: "Import movies",
    parents: [],
    children: ["J2"],
    output_result_groups: [
      { name: "movies", type: "movie", num_items: 240, summary: {}, contains: [] },
    ],
  }));

  // J2: motion correction
  jobs.push(job({
    uid: "J2",
    job_type: "patch_motion_correction_multi",
    title: "Patch motion correction",
    parents: ["J1"],
    children: ["J3"],
    input_slot_groups: [
      {
        type: "movie",
        name: "movies",
        title: "Movies",
        connections: [{ job_uid: "J1", group_name: "movies", slots: [{ slot_name: "movie", group_name: "movies", result_name: "movie", result_type: "movie", version: 1 }] }],
      },
    ],
    output_result_groups: [
      { name: "micrographs", type: "exposure", num_items: 240, summary: { psize_A: 0.83 }, contains: [] },
    ],
  }));

  // J3: CTF estimation
  jobs.push(job({
    uid: "J3",
    job_type: "patch_ctf_estimation_multi",
    title: "Patch CTF estimation",
    parents: ["J2"],
    children: ["J4"],
    input_slot_groups: [
      {
        type: "exposure",
        name: "micrographs",
        title: "Micrographs",
        connections: [{ job_uid: "J2", group_name: "micrographs", slots: [{ slot_name: "micrograph", group_name: "micrographs", result_name: "micrograph", result_type: "exposure", version: 1 }] }],
      },
    ],
    output_result_groups: [
      { name: "micrographs", type: "exposure", num_items: 240, summary: { psize_A: 0.83 }, contains: [] },
    ],
  }));

  // J4: import_micrographs (leaf micrograph source)
  jobs.push(job({
    uid: "J4",
    job_type: "import_micrographs",
    title: "Import micrographs (representative)",
    parents: [],
    children: ["J5"],
    output_result_groups: [
      { name: "micrographs", type: "exposure", num_items: 240, summary: { psize_A: 0.83 }, contains: [] },
    ],
    output_group_images: {
      imported: "fileid_imported_micrograph_thumb_001",
    },
    ui_tile_images: [
      { name: "imported_small", fileid: "fileid_imported_micrograph_thumb_001", num_cols: 6, num_rows: 4 },
    ],
  }));

  // J5: blob_picker_gpu
  jobs.push(job({
    uid: "J5",
    job_type: "blob_picker_gpu",
    title: "Blob picker (GPU)",
    parents: ["J3", "J4"],
    children: ["J6"],
    input_slot_groups: [
      {
        type: "exposure",
        name: "micrographs",
        title: "Micrographs",
        connections: [{ job_uid: "J4", group_name: "micrographs", slots: [{ slot_name: "micrograph", group_name: "micrographs", result_name: "micrograph", result_type: "exposure", version: 1 }] }],
      },
    ],
    params_spec: {
      box_size_pix: { value: 256 },
      psize_A: { value: 0.83 },
    },
    output_result_groups: [
      { name: "particles", type: "particle", num_items: 156432, summary: {}, contains: [] },
    ],
  }));

  // J6: extract_micrographs_multi
  jobs.push(job({
    uid: "J6",
    job_type: "extract_micrographs_multi",
    title: "Extract micrographs (multi)",
    parents: ["J5"],
    children: ["J7"],
    input_slot_groups: [
      {
        type: "particle",
        name: "particles",
        title: "Particles",
        connections: [{ job_uid: "J5", group_name: "particles", slots: [{ slot_name: "particles", group_name: "particles", result_name: "particles", result_type: "particle", version: 1 }] }],
      },
    ],
    params_spec: {
      box_size_pix: { value: 256 },
      extraction_box_size_pix: { value: 128 },
    },
    output_result_groups: [
      { name: "particles", type: "particle", num_items: 156432, summary: { psize_A: 0.83 }, contains: [] },
    ],
  }));

  // J7: class_2D
  jobs.push(job({
    uid: "J7",
    job_type: "class_2D",
    title: "2D classification",
    parents: ["J6"],
    children: ["J8"],
    input_slot_groups: [
      {
        type: "particle",
        name: "particles",
        title: "Particles",
        connections: [{ job_uid: "J6", group_name: "particles", slots: [{ slot_name: "particles", group_name: "particles", result_name: "particles", result_type: "particle", version: 1 }] }],
      },
    ],
    output_result_groups: [
      { name: "particles_all_classes", type: "particle", num_items: 156432, summary: {}, contains: [] },
      { name: "particles_class_0", type: "particle", num_items: 23100, summary: {}, contains: [] },
      { name: "particles_class_1", type: "particle", num_items: 18900, summary: {}, contains: [] },
      { name: "particles_class_2", type: "particle", num_items: 15600, summary: {}, contains: [] },
      { name: "particles_class_3", type: "particle", num_items: 12400, summary: {}, contains: [] },
    ],
  }));

  // J8: select_2D
  jobs.push(job({
    uid: "J8",
    job_type: "select_2D",
    title: "Select 2D classes",
    parents: ["J7"],
    children: ["J9"],
    input_slot_groups: [
      {
        type: "particle",
        name: "particles",
        title: "Particles",
        connections: [{ job_uid: "J7", group_name: "particles_all_classes", slots: [{ slot_name: "particles", group_name: "particles_all_classes", result_name: "particles", result_type: "particle", version: 1 }] }],
      },
    ],
    output_result_groups: [
      { name: "particles_selected", type: "particle", num_items: 89400, summary: {}, contains: [] },
      { name: "particles_excluded", type: "particle", num_items: 67032, summary: {}, contains: [] },
    ],
    overview_assets: {
      select_2d: {
        selected_classes_image_fileid: "fileid_select2d_selected_thumb",
        excluded_classes_image_fileid: "fileid_select2d_excluded_thumb",
      },
    },
  }));

  // J9: homo_abinit (3 classes)
  jobs.push(job({
    uid: "J9",
    job_type: "homo_abinit",
    title: "Ab initio reconstruction (3 classes)",
    parents: ["J8"],
    children: ["J10"],
    input_slot_groups: [
      {
        type: "particle",
        name: "particles",
        title: "Particles",
        connections: [{ job_uid: "J8", group_name: "particles_selected", slots: [{ slot_name: "particles", group_name: "particles_selected", result_name: "particles", result_type: "particle", version: 1 }] }],
      },
    ],
    output_result_groups: [
      { name: "particles_all_classes", type: "particle", num_items: 89400, summary: {}, contains: [] },
      { name: "particles_class_0", type: "particle", num_items: 42100, summary: {}, contains: [] },
      { name: "particles_class_1", type: "particle", num_items: 28700, summary: {}, contains: [] },
      { name: "particles_class_2", type: "particle", num_items: 18600, summary: {}, contains: [] },
      { name: "volume_class_0", type: "volume", num_items: 1, summary: { psize_A: 0.83 }, contains: [{ type: "volume.blob", name: "map" }] },
      { name: "volume_class_1", type: "volume", num_items: 1, summary: { psize_A: 0.83 }, contains: [{ type: "volume.blob", name: "map" }] },
      { name: "volume_class_2", type: "volume", num_items: 1, summary: { psize_A: 0.83 }, contains: [{ type: "volume.blob", name: "map" }] },
    ],
  }));

  // J10: homo_refine_new (final)
  const startJob = opts.startJob || 10;
  if (startJob <= 10) {
    jobs.push(job({
      uid: "J10",
      job_type: "homo_refine_new",
      title: "Homogeneous refine (final)",
      parents: ["J9"],
      children: [],
      input_slot_groups: [
        {
          type: "particle",
          name: "particles",
          title: "Particles",
          connections: [{ job_uid: "J9", group_name: "particles_class_0", slots: [{ slot_name: "particles", group_name: "particles_class_0", result_name: "particles", result_type: "particle", version: 1 }] }],
        },
        {
          type: "volume",
          name: "volume",
          title: "Volume",
          connections: [{ job_uid: "J9", group_name: "volume_class_0", slots: [{ slot_name: "map", group_name: "volume_class_0", result_name: "map", result_type: "volume.blob", version: 1 }] }],
        },
      ],
      output_result_groups: [
        { name: "volume", type: "volume", num_items: 1, summary: { psize_A: 0.83, fsc_resolution_A: 3.12 }, contains: [{ type: "volume.blob", name: "map" }] },
        { name: "particles", type: "particle", num_items: 42100, summary: { psize_A: 0.83 }, contains: [] },
      ],
      radwn_final_A: 3.12,
      final_resolution_A: 3.12,
      overview_assets: { resolution_A: 3.12 },
    }));
  }

  // Optionally start from a deeper job — add J11 hetero_refine if requested
  if (startJob >= 11) {
    jobs.push(job({
      uid: "J11",
      job_type: "hetero_refine",
      title: "Heterogeneous refine (4 classes)",
      parents: ["J10"],
      children: [],
      input_slot_groups: [
        {
          type: "particle",
          name: "particles",
          title: "Particles",
          connections: [{ job_uid: "J10", group_name: "particles", slots: [{ slot_name: "particles", group_name: "particles", result_name: "particles", result_type: "particle", version: 1 }] }],
        },
        {
          type: "volume",
          name: "volume",
          title: "Volume",
          connections: [{ job_uid: "J10", group_name: "volume", slots: [{ slot_name: "map", group_name: "volume", result_name: "map", result_type: "volume.blob", version: 1 }] }],
        },
      ],
      output_result_groups: [
        { name: "particles_all_classes", type: "particle", num_items: 42100, summary: {}, contains: [] },
        { name: "particles_class_0", type: "particle", num_items: 18500, summary: {}, contains: [] },
        { name: "particles_class_1", type: "particle", num_items: 12400, summary: {}, contains: [] },
        { name: "particles_class_2", type: "particle", num_items: 7200, summary: {}, contains: [] },
        { name: "particles_class_3", type: "particle", num_items: 4000, summary: {}, contains: [] },
        { name: "volume_class_0", type: "volume", num_items: 1, summary: { psize_A: 0.83, fsc_resolution_A: 3.05 }, contains: [{ type: "volume.blob", name: "map" }] },
        { name: "volume_class_1", type: "volume", num_items: 1, summary: { psize_A: 0.83, fsc_resolution_A: 3.21 }, contains: [{ type: "volume.blob", name: "map" }] },
        { name: "volume_class_2", type: "volume", num_items: 1, summary: { psize_A: 0.83, fsc_resolution_A: 3.45 }, contains: [{ type: "volume.blob", name: "map" }] },
        { name: "volume_class_3", type: "volume", num_items: 1, summary: { psize_A: 0.83, fsc_resolution_A: 3.78 }, contains: [{ type: "volume.blob", name: "map" }] },
      ],
      final_resolution_A: 3.05,
    }));
  }

  return {
    jobs,
    project_uid: projectId,
    experiment_uid: experimentId,
  };
}

/** Convenience: return the sample as an `ExportedProjectMetadata`-shaped object. */
export function buildSampleExportedMetadata(opts: SampleDataOptions = {}): {
  ok: true;
  source: "sample-data";
  project_uid: string;
  experiment_uid: string;
  exported_at: string;
  discovered_job_count: number;
  parsed_job_count: number;
  failed_job_count: number;
  failed_jobs: never[];
  jobs: unknown[];
} {
  const sample = buildSampleProjectMetadata(opts);
  return {
    ok: true,
    source: "sample-data",
    project_uid: sample.project_uid,
    experiment_uid: sample.experiment_uid,
    exported_at: new Date().toISOString(),
    discovered_job_count: sample.jobs.length,
    parsed_job_count: sample.jobs.length,
    failed_job_count: 0,
    failed_jobs: [],
    jobs: sample.jobs,
  };
}
