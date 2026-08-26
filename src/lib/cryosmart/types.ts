/**
 * TypeScript types for the CryoSmart lineage-tracing core.
 *
 * These types describe the raw CryoSmart job payloads scraped by the
 * original Chrome extension (`popup.js`) plus the normalized shapes
 * produced by the lineage helpers in `./lineage.ts`.
 *
 * All raw payloads are typed loosely enough to survive the noisy
 * `$date` wrappers and `{value: ...}` param-spec wrappers that CryoSmart
 * emits, but tight enough that strict-mode TypeScript can follow the
 * data flow without `any`.
 */

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * A CryoSmart date stamp. Most timestamps arrive as
 * `{ $date: "<ISO string>" }` but some endpoints return a plain string
 * or numeric epoch. `plainDate()` in `lineage.ts` unwraps this.
 */
export type DateValue =
  | string
  | number
  | { $date: string | number };

/** Sentinel for "value present but meaningless / unknown". */
export type Nullable<T> = T | null;

/* ------------------------------------------------------------------ */
/* Raw CryoSmart job metadata                                         */
/* ------------------------------------------------------------------ */

/** A single value inside `params_spec` — usually a `{ value: ... }` wrapper. */
export type ParamSpecEntry =
  | { value?: unknown; [key: string]: unknown }
  | string
  | number
  | boolean
  | null;

/** `params_spec` is a free-form dictionary keyed by parameter name. */
export type ParamsSpec = Record<string, ParamSpecEntry>;

/** One element of `output_group_images` — `{ [groupName]: fileId }`. */
export type OutputGroupImages = Record<string, string>;

/** One tile in `ui_tile_images` — a small preview image attached to a job. */
export interface UiTileImage {
  name?: string | null;
  fileid?: string | null;
  num_cols?: number | null;
  num_rows?: number | null;
  [key: string]: unknown;
}

/** `overview_assets` is a free-form per-job overview blob. */
export type OverviewAssets = Record<string, unknown>;

/** Image log entry from CryoSmart jobLogs with type: 'image' */
export interface ImageLogFile {
  fileid: string;
  filename: string;
  filetype: string;
}

export interface ImageLogEntry {
  _id: string;
  created_at?: string;
  flags?: string[];
  imgfiles?: ImageLogFile[];
  index?: number;
  job_uid?: string;
  project_uid?: string;
  text?: string;
  type?: string;
}

/** A "slot" inside an input-slot-group connection. */
export interface Slot {
  slot_name?: string | null;
  group_name?: string | null;
  result_name?: string | null;
  result_type?: string | null;
  version?: string | number | null;
  [key: string]: unknown;
}

/** A connection between an input slot group and an upstream job/group. */
export interface Connection {
  job_uid?: string | null;
  group_name?: string | null;
  slots?: Slot[];
  [key: string]: unknown;
}

/** A group of input slots on a job (movies, particles, volumes, ...). */
export interface InputSlotGroup {
  type?: string | null;
  name?: string | null;
  title?: string | null;
  connections?: Connection[];
  [key: string]: unknown;
}

/** `output_result_groups[].contains[]` — a single output blob inside a group. */
export interface GroupContains {
  type?: string | null;
  name?: string | null;
  version?: string | number | null;
  [key: string]: unknown;
}

/** A summary dictionary attached to an output result group. */
export type OutputResultSummary = Record<string, unknown>;

/** One of `output_result_groups` on a CryoSmart job. */
export interface OutputResultGroup {
  name?: string;
  type?: string | null;
  title?: string | null;
  num_items?: number | null;
  summary?: OutputResultSummary;
  contains?: GroupContains[];
  [key: string]: unknown;
}

/**
 * The raw CryoSmart job object as returned by the REST/JSON export.
 * All fields are optional because CryoSmart's response shape varies by
 * endpoint version; the lineage helpers tolerate missing fields.
 */
export interface JobMetadata {
  uid?: string;
  uid_num?: number | null;
  project_uid?: string;
  job_type?: string;
  title?: string;
  status?: string;
  created_at?: DateValue;
  completed_at?: DateValue;
  parents?: string[];
  children?: string[];
  params_spec?: ParamsSpec;
  input_slot_groups?: InputSlotGroup[];
  output_result_groups?: OutputResultGroup[];
  output_group_images?: OutputGroupImages;
  ui_tile_images?: UiTileImage[];
  overview_assets?: OverviewAssets;
  /** Image logs from CryoSmart jobLogs (type: image) - internal result images */
  image_logs?: ImageLogEntry[];
  /** Best-effort resolution number, sometimes pre-computed by the server. */
  radwn_final_A?: number | null;
  final_resolution_A?: number | null;
  resolution_A?: number | null;
  fsc_resolution_A?: number | null;
  gold_standard_fsc_resolution_A?: number | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Normalized lineage shapes (output of helpers in `lineage.ts`)      */
/* ------------------------------------------------------------------ */

/** The post-processed slot shape used inside `LineageEdge.slots`. */
export interface LineageEdgeSlot {
  slot_name: string | null;
  source_group: string | null;
  result_name: string | null;
  result_type: string | null;
  version: string | number | null;
}

/** A single directed lineage edge between two jobs. */
export interface LineageEdge {
  source: string;
  target: string;
  input_type: string;
  input_name: string;
  input_title: string | null;
  source_group: string | null;
  slots: LineageEdgeSlot[];
  /** Optional pre-computed kind (e.g. set by `summaryKind`). */
  kind?: string;
  /** Optional multi-kind set (e.g. merged edges). */
  kinds?: string[];
}

/** A normalized lineage edge with `kind` / `family` / `group` filled in. */
export interface NormalizedLineageEdge extends LineageEdge {
  kind: string;
  family: EdgeFamily;
  group: string;
}

/** Family bucket used by the report layer (mask → volume, etc.). */
export type EdgeFamily =
  | "exposure"
  | "micrograph"
  | "particle"
  | "volume"
  | "mask"
  | "template"
  | "ml_model"
  | "model"
  | "parent"
  | "other";

/** Extraction parameters captured on a `LineageNode`. */
export interface ExtractionParams {
  box_size_pix: number | null;
  extracted_box_size_pix: number | null;
  bin_factor: number | null;
  bin_inferred: boolean;
}

/** One entry inside `output_groups` on a `LineageNode`. */
export interface OutputGroupIndexItem {
  name: string;
  type: string | null;
  title: string;
  count: number | null;
  class_index: number | null;
  percent: number | null;
  paired_particle_count: number | null;
  paired_particle_percent: number | null;
}

/** Index of output groups keyed by group name. */
export type OutputGroupIndex = Record<string, OutputGroupIndexItem>;

/** A preview image asset attached to a `LineageNode`. */
export interface ImageAsset {
  kind: "ui_tile" | "output_group" | "image_log";
  name: string;
  url: string;
  src: string;
  original_url: string;
  num_cols?: number | null;
  num_rows?: number | null;
  log_text?: string | null;
  log_flags?: string[] | null;
  category?: string | null;
}

/** A downloadable map asset attached to a `LineageNode`. */
export interface MapAsset {
  group: string;
  group_title: string;
  group_type: string;
  result_name: string;
  download_url: string;
  preview_url: string | null;
  preview_src: string | null;
  preview_original_url: string | null;
}

/** One downloadable map inside a `ClassSplit`. */
export interface ClassMap {
  result_name: string;
  download_url: string;
}

/** A class split from an `abinit` / `hetero` / `class_3D` job. */
export interface ClassSplit {
  class_index: number;
  particle_count: number | null;
  particle_percent: number | null;
  total_particles: number | null;
  volume_group: string | null;
  mrc_preview_url: string | null;
  mrc_preview_src: string | null;
  mrc_preview_original_url: string | null;
  maps: ClassMap[];
}

/** Summary of a `select_2D` job, used by the report/preview layers. */
export interface Select2DSummary {
  particles_selected: number | null;
  particles_excluded: number | null;
  classes_selected: number | null;
  classes_excluded: number | null;
  selected_classes_image: string | null;
  selected_classes_src: string | null;
  selected_classes_original_url: string | null;
  selected_classes_source: string | null;
  selected_classes_log_text: string | null;
  selected_classes_log_timestamp: string | null;
  selected_particles_image: string | null;
  selected_particles_src: string | null;
  selected_particles_original_url: string | null;
  excluded_classes_image: string | null;
  excluded_classes_src: string | null;
  excluded_classes_original_url: string | null;
}

/** A normalized lineage node produced by `jobNode()`. */
export interface LineageNode {
  uid: string;
  uid_num: number | null;
  project_uid: string;
  job_type: string;
  title: string;
  status: string;
  created_at: DateValue | null;
  completed_at: DateValue | null;
  parents: string[];
  children: string[];
  particle_count: number | null;
  micrograph_count: number | null;
  pixel_size_A: number | null;
  volume_count: number | null;
  class_count: number | null;
  resolution_A: number | null;
  extraction_params: ExtractionParams;
  output_groups: OutputGroupIndex;
  images: ImageAsset[];
  maps: MapAsset[];
  classes: ClassSplit[];
  select_2d: Select2DSummary | null;
  /** Only present on `import_micrographs` jobs. */
  representative_micrograph_images?: ImageAsset[];
}

/** A class-split job entry in `LineageSummary.class_split_jobs`. */
export interface ClassSplitJob {
  uid: string;
  job_type: string;
  classes: ClassSplit[];
}

/** Full summary of a project's lineage starting from a given job. */
export interface LineageSummary {
  ok: boolean;
  project_uid: string;
  base_url: string;
  start_uid: string;
  start_job: LineageNode;
  final_particle_count: number | null;
  final_micrograph_count: number | null;
  final_resolution_A: number | null;
  resolution_note: string;
  map_download_urls: Record<string, string>;
  nodes: LineageNode[];
  edges: LineageEdge[];
  import_or_leaf_jobs: LineageNode[];
  class_split_jobs: ClassSplitJob[];
  focused_mermaid: string;
  /** Micrograph-level pixel size, populated by `normalizeLineageSummary`. */
  micrograph_pixel_size_A?: number | null;
  /** Optional precomputed text preview. */
  preview?: string;
}

/* ------------------------------------------------------------------ */
/* Project export metadata                                            */
/* ------------------------------------------------------------------ */

/** Information about a job that failed to parse during a project export. */
export interface FailedJob {
  uid?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Top-level shape of a CryoSmart project export (the JSON file uploaded
 * by the user in "JSON upload mode").
 */
export interface ExportedProjectMetadata {
  jobs: JobMetadata[];
  project_uid: string;
  experiment_uid?: string;
  exported_at?: string | null;
  discovered_job_count?: number;
  parsed_job_count?: number;
  failed_job_count?: number;
  failed_jobs?: FailedJob[];
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Report-layer state (used by the report* family of helpers)        */
/* ------------------------------------------------------------------ */

/**
 * Map of incoming edges by target uid, augmented with a per-instance
 * trace memo. The memo is attached directly to the Map by the original
 * popup.js code (`incomingByTarget.__traceVisibleMemo = new Map()`).
 */
export interface IncomingByTargetMap
  extends Map<string, NormalizedLineageEdge[]> {
  __traceVisibleMemo?: Map<string, string[]>;
}

/** Mutable state object threaded through the `report*` helpers. */
export interface LineageReportState {
  nodeMap: Map<string, LineageNode>;
  edges: NormalizedLineageEdge[];
  incomingByTarget: IncomingByTargetMap;
  outgoingBySource: Map<string, NormalizedLineageEdge[]>;
  outlineNodes: LineageNode[];
  visible: Set<string>;
  roundMemo: Map<string, number>;
  repickSeedMemo: Map<string, boolean>;
}

