/**
 * CryoSmart lineage-tracing constants.
 *
 * Ported verbatim from
 * `CryoSmartLineageTracer_3.0/popup.js` (top-level `const` declarations).
 * These are pure, dependency-free values that can be imported by any
 * server-side or client-side module.
 */

/** File-name suffixes treated as downloadable maps (relative to a job's result group). */
export const MAP_SUFFIXES: readonly string[] = ["volume.map"];

/** Job types that produce particle picks (manual or auto pickers). */
export const PICKING_JOB_TYPES: Set<string> = new Set([
  "manual_picker",
  "blob_picker_gpu",
  "auto_blob_picker_gpu",
  "template_picker_gpu",
  "deep_picker_train",
  "deep_picker_inference",
  "filament_tracer_gpu",
  "topaz_train",
  "topaz_extract",
]);

/** Particle "auxiliary" job types — downstream of picking, not pickers themselves. */
export const PARTICLE_AUX_JOB_TYPES: Set<string> = new Set([
  "extract_micrographs_multi",
  "extract_micrographs_cpu_parallel",
  "remove_duplicate_particles",
  "particle_sets",
  "downsample_particles",
  "standardize_particle_psize",
  "check_corrupt_particles",
  "reassign_particles_mics",
  "class_probability_filter",
]);

/** Picking job types that can produce particles for a "repick" round. */
export const REPICK_PARTICLE_PRODUCER_TYPES: Set<string> = new Set([
  "manual_picker",
  "blob_picker_gpu",
  "auto_blob_picker_gpu",
  "template_picker_gpu",
  "deep_picker_inference",
  "filament_tracer_gpu",
  "topaz_extract",
]);

/** Setup job types used to "seed" a repick round (e.g. train a model). */
export const REPICK_SETUP_JOB_TYPES: Set<string> = new Set([
  "topaz_train",
  "deep_picker_train",
  "topaz_cross_validation",
  "create_templates",
]);

/** Job types considered "major" lineage nodes (shown by default in the outline). */
export const MAJOR_JOB_TYPES: Set<string> = new Set([
  "import_movies",
  "import_micrographs",
  "import_particles",
  "import_volumes",
  "import_templates",
  "import_result_group",
  "manual_picker",
  "blob_picker_gpu",
  "auto_blob_picker_gpu",
  "template_picker_gpu",
  "deep_picker_train",
  "deep_picker_inference",
  "filament_tracer_gpu",
  "topaz_train",
  "topaz_extract",
  "extract_micrographs_multi",
  "extract_micrographs_cpu_parallel",
  "remove_duplicate_particles",
  "particle_sets",
  "downsample_particles",
  "standardize_particle_psize",
  "check_corrupt_particles",
  "reassign_particles_mics",
  "class_2D",
  "select_2D",
  "rebalance_classes_2D",
  "class_probability_filter",
  "homo_abinit",
  "homo_refine",
  "hetero_refine",
  "homo_refine_new",
  "nonuniform_refine_new",
  "nonuniform_refine",
  "new_local_refine",
  "naive_local_refine",
  "local_refine",
  "class_3D",
  "align_3D",
  "homo_reconstruct",
  "sym_expand",
  "particle_subtract",
  "var_3D",
  "var_3D_disp",
  "auto3Dre_pipeline_ctrl",
  "auto3Dre_rank",
  "auto3Dre_select_ranked_ptcls",
  "cryodrgn",
  "helix_search",
  "helix_initmodel",
  "helix_refine",
  "helix_symmetrize",
  "relion_auto_refine",
  "relion_3d_classification",
]);

/** Job types considered "small" lineage nodes (pre-processing, helpers, etc.). */
export const SMALL_JOB_TYPES: Set<string> = new Set([
  "motion_correction_motioncor2",
  "patch_motion_correction_multi",
  "local_motion_correction",
  "local_motion_correction_multi",
  "rigid_motion_correction",
  "rigid_motion_correction_multi",
  "ctf_estimation",
  "patch_ctf_estimation_multi",
  "ctf_estimation_gctf",
  "patch_ctf_extract",
  "ctf_refine_global",
  "ctf_refine_local",
  "curate_exposures",
  "exposure_sets",
  "exposure_tools",
  "exposure_groups",
  "inspect_simple",
  "volume_tools",
  "volume_alignment_tools",
  "local_resolution",
  "local_filter",
  "sharpen",
  "deep_emhancer",
  "fsc3D",
  "reslog",
  "validation",
  "generate_thumbs",
  "topaz_denoise",
  "topaz_cross_validation",
  "junk_filter",
  "create_templates",
  "basic_workflow",
  "extensive_workflow",
  "simulator",
  "simulator_gpu",
  "model_building",
  "relion_create_mask",
  "relion_post_processing",
  "relion_bayesian_polish",
]);

/** MIME type for the generated PPTX bundle. */
export const PPTX_CONTENT_TYPE: string =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** One inch in PowerPoint EMU units. */
export const PPT_EMU: number = 914400;

/** PPT slide width in inches (A4 portrait). */
export const PPT_W: number = 8.27;

/** PPT slide height in inches (A4 portrait). */
export const PPT_H: number = 11.69;

/** PPT page margin in inches. */
export const PPT_MARGIN: number = 0.34;

/** Font size used for paper-print rendering of PPT text. */
export const PPT_PAPER_FONT_SIZE: number = 6;

/** Aspect-ratio threshold above which the SVG content is split into two columns. */
export const PPT_TWO_COLUMN_RATIO: number = 1.12;

/** Color palette used by the PPT renderer (hex strings without leading `#`). */
export const PPT_COLORS = {
  text: "17202E",
  muted: "526174",
  line: "D6E0EC",
  microFill: "E9FBEF",
  microLine: "16A05D",
  particleFill: "FFF5D8",
  particleLine: "D99300",
  volumeFill: "EDF1FF",
  volumeLine: "4D64E8",
  otherFill: "F4F7FA",
  otherLine: "CBD7E6",
  white: "FFFFFF",
} as const;

export type PptColorName = keyof typeof PPT_COLORS;

/** A4 SVG canvas width in pixels (210mm at ~96dpi). */
export const SVG_A4_WIDTH: number = 794;

/** A4 SVG canvas height in pixels (297mm at ~96dpi). */
export const SVG_A4_HEIGHT: number = 1123;

/** Horizontal center of the A4 SVG canvas. */
export const SVG_A4_CENTER_X: number = SVG_A4_WIDTH / 2;

/** Default CryoSmart base URL (matches the value baked into popup.js). */
export const DEFAULT_BASE_URL: string = "http://192.168.4.3:8080";
