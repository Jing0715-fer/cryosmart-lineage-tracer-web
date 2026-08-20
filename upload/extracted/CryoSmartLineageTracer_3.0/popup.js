const projectIdEl = document.getElementById("projectId");
const startJobEl = document.getElementById("startJob");
const jobsJsonEl = document.getElementById("jobsJson");
const exportBtn = document.getElementById("exportBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadPptxEl = document.getElementById("downloadPptx");
const downloadImagesEl = document.getElementById("downloadImages");
const downloadMapsEl = document.getElementById("downloadMaps");
const downloadFinalResultsEl = document.getElementById("downloadFinalResults");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");

const MAP_SUFFIXES = [
  "volume.map"
];

const PICKING_JOB_TYPES = new Set([
  "manual_picker",
  "blob_picker_gpu",
  "auto_blob_picker_gpu",
  "template_picker_gpu",
  "deep_picker_train",
  "deep_picker_inference",
  "filament_tracer_gpu",
  "topaz_train",
  "topaz_extract"
]);

const PARTICLE_AUX_JOB_TYPES = new Set([
  "extract_micrographs_multi",
  "extract_micrographs_cpu_parallel",
  "remove_duplicate_particles",
  "particle_sets",
  "downsample_particles",
  "standardize_particle_psize",
  "check_corrupt_particles",
  "reassign_particles_mics",
  "class_probability_filter"
]);

const REPICK_PARTICLE_PRODUCER_TYPES = new Set([
  "manual_picker",
  "blob_picker_gpu",
  "auto_blob_picker_gpu",
  "template_picker_gpu",
  "deep_picker_inference",
  "filament_tracer_gpu",
  "topaz_extract"
]);

const REPICK_SETUP_JOB_TYPES = new Set([
  "topaz_train",
  "deep_picker_train",
  "topaz_cross_validation",
  "create_templates"
]);

const MAJOR_JOB_TYPES = new Set([
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
  "relion_3d_classification"
]);

const SMALL_JOB_TYPES = new Set([
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
  "relion_bayesian_polish"
]);

let lastSummary = null;
let lastProjectMetadata = null;
const REPORT_NORMALIZED_EDGES_CACHE = new WeakMap();

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function normalizeJobUid(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("请输入起始 Job，例如 427 或 J427。");
  return /^J/i.test(text) ? text.toUpperCase() : `J${text}`;
}

function parseRoute(url) {
  const match = String(url || "").match(/#\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/?#]+))?/i);
  return {
    projectId: match ? match[1] : "",
    experimentId: match && match[2] ? match[2] : "",
    jobId: match && match[3] ? match[3] : ""
  };
}

function plainDate(value) {
  return value && typeof value === "object" && "$date" in value ? value.$date : value;
}

function outputGroups(job, type) {
  const groups = Array.isArray(job.output_result_groups) ? job.output_result_groups : [];
  return type ? groups.filter((group) => group.type === type) : groups;
}

function maxGroupNumItems(job, type) {
  const values = outputGroups(job, type)
    .map((group) => group.num_items)
    .filter((value) => Number.isInteger(value));
  return values.length ? Math.max(...values) : null;
}

function paramSpecNumber(job, names) {
  const params = (job && job.params_spec) || {};
  for (const name of names) {
    const entry = params[name];
    const value = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function outputSummaryNumber(job, patterns) {
  for (const group of outputGroups(job)) {
    const summary = group && group.summary && typeof group.summary === "object" ? group.summary : {};
    for (const [key, value] of Object.entries(summary)) {
      if (!patterns.some((pattern) => pattern.test(key))) continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function pixelSizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100
    ? Math.round(number * 10000) / 10000
    : null;
}

function pixelSizeFromJob(job) {
  return pixelSizeNumber(outputSummaryNumber(job, [/psize[_-]?A$/i, /pixel[^a-z0-9]*size/i])) ||
    pixelSizeNumber(paramSpecNumber(job, ["psize_A", "pixel_size_A", "pixel_size", "micrograph_pixel_size_A"]));
}

function formatPixelSize(value) {
  const number = pixelSizeNumber(value);
  if (!number) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function pixelSizeText(node) {
  const text = formatPixelSize(node && node.pixel_size_A);
  return text ? `${text} Å/px` : "";
}

function isExtractMicrographsJob(jobOrNode) {
  return /extract_micrographs/i.test((jobOrNode && jobOrNode.job_type) || "");
}

function extractionParams(job) {
  const rawBox = paramSpecNumber(job, ["box_size_pix", "box_size", "extraction_box_size_pix", "extraction_box_size"]);
  const extractedBox = paramSpecNumber(job, ["bin_size_pix", "downsample_box_size_pix", "crop_size_pix"]);
  const inferredExtractedBox = rawBox && !extractedBox && isExtractMicrographsJob(job) ? rawBox : extractedBox;
  const bin = rawBox && inferredExtractedBox ? rawBox / inferredExtractedBox : null;
  return {
    box_size_pix: rawBox,
    extracted_box_size_pix: inferredExtractedBox,
    bin_factor: Number.isFinite(bin) ? bin : null,
    bin_inferred: Boolean(rawBox && !extractedBox && isExtractMicrographsJob(job))
  };
}

function formatBinFactor(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.01 ? String(rounded) : value.toFixed(2).replace(/\.?0+$/, "");
}

function extractionParamText(node) {
  const p = node && node.extraction_params;
  if (!p) return "";
  const parts = [];
  if (p.box_size_pix) parts.push(`原始 pixel ${formatBinFactor(p.box_size_pix)} px`);
  if (p.extracted_box_size_pix) parts.push(`提取 box ${formatBinFactor(p.extracted_box_size_pix)} px`);
  if (p.bin_factor) parts.push(`bin ${formatBinFactor(p.bin_factor)}${p.bin_inferred ? " (推断)" : ""}`);
  return parts.join(" · ");
}

function extractionBinText(node) {
  const p = node && node.extraction_params;
  if (!p || !p.bin_factor) return "";
  return `bin ${formatBinFactor(p.bin_factor)}`;
}

function normalizeExtractionParamsForNode(node) {
  if (!node || !node.extraction_params) return;
  const p = node.extraction_params;
  if (p.bin_factor) return;
  if (p.box_size_pix && !p.extracted_box_size_pix && isExtractMicrographsJob(node)) {
    p.extracted_box_size_pix = p.box_size_pix;
    p.bin_factor = 1;
    p.bin_inferred = true;
  }
}

function resolutionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 20 ? Math.round(number * 100) / 100 : null;
}

function parseResolutionText(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:resolution|res|FSC[^:]{0,40})[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)[^.;]{0,60}(?:resolution|FSC|res)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = match && resolutionNumber(match[1]);
    if (number) return number;
  }
  return null;
}

function resolutionFromObject(value, keyPath = "", depth = 0, seen = new Set()) {
  if (value === null || value === undefined || depth > 7) return null;
  if (typeof value === "number") {
    return /resolution|fsc|res[_-]?a/i.test(keyPath) && !/threshold|cutoff/i.test(keyPath)
      ? resolutionNumber(value)
      : null;
  }
  if (typeof value === "string") {
    if (/resolution|FSC|angstrom|Å|\bA\b/i.test(value) || /resolution|fsc/i.test(keyPath)) {
      return parseResolutionText(value) || (/resolution|fsc/i.test(keyPath) ? resolutionNumber(value) : null);
    }
    return null;
  }
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = resolutionFromObject(item, keyPath, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    const path = keyPath ? `${keyPath}.${key}` : key;
    const found = resolutionFromObject(item, path, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function resolutionFromJob(job) {
  if (!/nonuniform|homo_refine|local_refine|local_resolution|fsc3D|sharpen|reslog/i.test((job && job.job_type) || "")) {
    return null;
  }
  return resolutionNumber(job && job.radwn_final_A) ||
    resolutionNumber(job && job.final_resolution_A) ||
    resolutionNumber(job && job.resolution_A) ||
    resolutionNumber(job && job.fsc_resolution_A) ||
    resolutionNumber(job && job.gold_standard_fsc_resolution_A) ||
    resolutionFromObject(job && job.overview_assets && job.overview_assets.resolution_A, "overview_assets.resolution_A") ||
    resolutionFromObject(job && job.overview_assets, "overview_assets", 0) ||
    resolutionFromObject(job && job.output_result_groups, "output_result_groups", 0);
}

function resolutionText(node) {
  const value = node && resolutionNumber(node.resolution_A);
  return value ? `${formatBinFactor(value)} Å` : "";
}

function logImageUrl(baseUrl, fileid) {
  if (!fileid) return null;
  return `${String(baseUrl || "").replace(/\/$/, "")}/api/log_image/${fileid}`;
}

function resultFileUrl(baseUrl, projectId, jobId, groupName, resultName) {
  return `${String(baseUrl || "").replace(/\/$/, "")}/api/log_image/download_result_file/${projectId}/${jobId}.${groupName}.${resultName}`;
}

function resultPreviewImageUrl(baseUrl, projectId, jobId, name) {
  if (!baseUrl || !projectId || !jobId || !name) return null;
  return `${String(baseUrl || "").replace(/\/$/, "")}/api/log_image/download_result_file/${projectId}/${jobId}.${name}.png`;
}

function outputGroupsByName(job) {
  const index = new Map();
  for (const group of outputGroups(job)) {
    if (group && group.name) index.set(group.name, group);
  }
  return index;
}

function outputGroupIndex(job) {
  const byName = outputGroupsByName(job);
  const total = byName.get("particles_all_classes") && byName.get("particles_all_classes").num_items;
  const index = {};

  for (const group of outputGroups(job)) {
    if (!group || !group.name) continue;
    const idx = parseClassIndex(group.name);
    const count = group.num_items;
    const item = {
      name: group.name,
      type: group.type,
      title: group.title || group.name,
      count: Number.isInteger(count) ? count : null,
      class_index: idx,
      percent: null,
      paired_particle_count: null,
      paired_particle_percent: null
    };

    if (group.name.startsWith("particles_class_") && Number.isInteger(count) && Number.isInteger(total) && total) {
      item.percent = Math.round(count / total * 10000) / 100;
    }

    if (group.name.startsWith("volume_class_") && idx !== null) {
      const paired = byName.get(`particles_class_${idx}`);
      if (paired && Number.isInteger(paired.num_items)) {
        item.paired_particle_count = paired.num_items;
        if (Number.isInteger(total) && total) {
          item.paired_particle_percent = Math.round(paired.num_items / total * 10000) / 100;
        }
      }
    }

    index[group.name] = item;
  }

  return index;
}

function imageAssets(job, baseUrl, projectId = "") {
  const assets = [];
  const pid = projectId || job.project_uid;
  for (const item of job.ui_tile_images || []) {
    const url = logImageUrl(baseUrl, item.fileid);
    if (!url) continue;
    assets.push({
      kind: "ui_tile",
      name: item.name || "image",
      url,
      src: url,
      original_url: resultPreviewImageUrl(baseUrl, pid, job.uid, item.name || "image"),
      num_cols: item.num_cols,
      num_rows: item.num_rows
    });
  }

  for (const [name, fileid] of Object.entries(job.output_group_images || {})) {
    const url = logImageUrl(baseUrl, fileid);
    if (!url) continue;
    assets.push({
      kind: "output_group",
      name,
      url,
      src: url,
      original_url: resultPreviewImageUrl(baseUrl, pid, job.uid, name)
    });
  }

  return assets;
}

function mapAssets(job, baseUrl, projectId) {
  const assets = [];
  const outputImages = job.output_group_images || {};
  for (const group of outputGroups(job)) {
    if (!["volume", "mask"].includes(group.type) || !group.name) continue;
    const previewUrl = logImageUrl(baseUrl, outputImages[group.name]);
    for (const item of group.contains || []) {
      if (item.type !== "volume.blob" || !item.name) continue;
      assets.push({
        group: group.name,
        group_title: group.title || group.name,
        group_type: group.type,
        result_name: item.name,
        download_url: resultFileUrl(baseUrl, projectId, job.uid, group.name, item.name),
        preview_url: previewUrl,
        preview_src: previewUrl,
        preview_original_url: resultPreviewImageUrl(baseUrl, projectId || job.project_uid, job.uid, group.name)
      });
    }
  }
  return assets;
}

function selected2dSummary(job, baseUrl) {
  if (job.job_type !== "select_2D") return null;
  const byName = outputGroupsByName(job);
  const images = new Map(imageAssets(job, baseUrl, job.project_uid).map((item) => [item.name, item]));
  const overviewSelected = job.overview_assets && job.overview_assets.select_2d;
  const selectedClassesImage = overviewSelected && overviewSelected.selected_classes_image
    ? {
        url: overviewSelected.selected_classes_image,
        src: overviewSelected.selected_classes_src || overviewSelected.selected_classes_image,
        original_url: overviewSelected.selected_classes_original_url || overviewSelected.selected_classes_image
      }
    : images.get("templates_selected");
  const selectedParticlesImage = images.get("particles_selected");
  const excludedClassesImage = images.get("templates_excluded");
  return {
    particles_selected: byName.get("particles_selected") ? byName.get("particles_selected").num_items : null,
    particles_excluded: byName.get("particles_excluded") ? byName.get("particles_excluded").num_items : null,
    classes_selected: overviewSelected && Number.isInteger(overviewSelected.classes_selected)
      ? overviewSelected.classes_selected
      : (byName.get("templates_selected") ? byName.get("templates_selected").num_items : null),
    classes_excluded: byName.get("templates_excluded") ? byName.get("templates_excluded").num_items : null,
    selected_classes_image: selectedClassesImage ? selectedClassesImage.url : null,
    selected_classes_src: selectedClassesImage ? selectedClassesImage.src : null,
    selected_classes_original_url: selectedClassesImage ? selectedClassesImage.original_url : null,
    selected_classes_source: overviewSelected && overviewSelected.source
      ? overviewSelected.source
      : (selectedClassesImage ? "metadata_templates_selected" : null),
    selected_classes_log_text: overviewSelected && overviewSelected.log_text ? overviewSelected.log_text : null,
    selected_classes_log_timestamp: overviewSelected && overviewSelected.log_timestamp ? overviewSelected.log_timestamp : null,
    selected_particles_image: selectedParticlesImage ? selectedParticlesImage.url : null,
    selected_particles_src: selectedParticlesImage ? selectedParticlesImage.src : null,
    selected_particles_original_url: selectedParticlesImage ? selectedParticlesImage.original_url : null,
    excluded_classes_image: excludedClassesImage ? excludedClassesImage.url : null,
    excluded_classes_src: excludedClassesImage ? excludedClassesImage.src : null,
    excluded_classes_original_url: excludedClassesImage ? excludedClassesImage.original_url : null
  };
}

function jobNode(job, baseUrl = "", projectId = "") {
  const images = baseUrl ? imageAssets(job, baseUrl, projectId || job.project_uid) : [];
  const classes = baseUrl ? classSplits(job, baseUrl) : [];
  const node = {
    uid: job.uid,
    uid_num: job.uid_num,
    project_uid: job.project_uid,
    job_type: job.job_type,
    title: job.title,
    status: job.status,
    created_at: plainDate(job.created_at),
    completed_at: plainDate(job.completed_at),
    parents: job.parents || [],
    children: job.children || [],
    particle_count: maxGroupNumItems(job, "particle"),
    micrograph_count: maxGroupNumItems(job, "exposure"),
    pixel_size_A: pixelSizeFromJob(job),
    volume_count: maxGroupNumItems(job, "volume"),
    class_count: classes.length || null,
    resolution_A: resolutionFromJob(job),
    extraction_params: extractionParams(job),
    output_groups: baseUrl ? outputGroupIndex(job) : {},
    images,
    maps: baseUrl ? mapAssets(job, baseUrl, projectId || job.project_uid) : [],
    classes,
    select_2d: baseUrl ? selected2dSummary(job, baseUrl) : null
  };
  if (job.job_type === "import_micrographs") {
    node.representative_micrograph_images = images.filter((item) => item.kind === "ui_tile").slice(0, 3);
  }
  return node;
}

function connectionEdges(job) {
  const edges = [];
  for (const inputGroup of job.input_slot_groups || []) {
    for (const connection of inputGroup.connections || []) {
      if (!connection.job_uid) continue;
      edges.push({
        source: connection.job_uid,
        target: job.uid,
        input_type: inputGroup.type,
        input_name: inputGroup.name,
        input_title: inputGroup.title,
        source_group: connection.group_name,
        slots: (connection.slots || []).map((slot) => ({
          slot_name: slot.slot_name,
          source_group: slot.group_name,
          result_name: slot.result_name,
          result_type: slot.result_type,
          version: slot.version
        }))
      });
    }
  }
  return edges;
}

function fallbackParentEdges(job, explicitSources) {
  return (job.parents || [])
    .filter((uid) => !explicitSources.has(uid))
    .map((uid) => ({
      source: uid,
      target: job.uid,
      input_type: "parent",
      input_name: "parent",
      input_title: "Parent job",
      source_group: null,
      slots: []
    }));
}

function collectUpstream(projectJobs, startUid) {
  const seen = new Map();
  const edges = [];
  const queue = [startUid];

  while (queue.length) {
    const uid = queue.shift();
    if (seen.has(uid)) continue;
    const job = projectJobs.get(uid);
    if (!job) continue;
    seen.set(uid, job);

    const explicit = connectionEdges(job);
    const sources = new Set(explicit.map((edge) => edge.source));
    const jobEdges = explicit.concat(fallbackParentEdges(job, sources));
    edges.push(...jobEdges);

    for (const edge of jobEdges) {
      if (!seen.has(edge.source)) queue.push(edge.source);
    }
  }

  return { nodes: seen, edges };
}

function mapDownloadUrls(baseUrl, projectId, jobId) {
  const root = String(baseUrl || "http://192.168.4.3:8080").replace(/\/$/, "");
  return Object.fromEntries(MAP_SUFFIXES.map((suffix) => [
    suffix,
    `${root}/api/log_image/download_result_file/${projectId}/${jobId}.${suffix}`
  ]));
}

function parseClassIndex(name) {
  const match = String(name || "").match(/class[_-](\d+)/);
  return match ? Number(match[1]) : null;
}

function classSplits(job, baseUrl) {
  const type = job.job_type || "";
  if (!type.includes("abinit") && !type.includes("hetero") && !type.includes("class_3D")) return [];

  let total = null;
  const classes = new Map();
  const outputImages = job.output_group_images || {};

  for (const group of outputGroups(job, "particle")) {
    if (group.name === "particles_all_classes") {
      total = group.num_items;
      continue;
    }
    const idx = parseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    classes.get(idx).particle_count = group.num_items;
  }

  for (const group of outputGroups(job, "volume")) {
    const idx = parseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    const entry = classes.get(idx);
    entry.volume_group = group.name;
    entry.mrc_preview_url = logImageUrl(baseUrl, outputImages[group.name]);
    entry.mrc_preview_src = entry.mrc_preview_url;
    entry.mrc_preview_original_url = resultPreviewImageUrl(baseUrl, job.project_uid, job.uid, group.name);
    entry.maps = (group.contains || [])
      .filter((item) => item.type === "volume.blob" && item.name === "map")
      .map((item) => ({
        result_name: item.name,
        download_url: `${baseUrl.replace(/\/$/, "")}/api/log_image/download_result_file/${job.project_uid}/${job.uid}.${group.name}.${item.name}`
      }));
  }

  return Array.from(classes.entries()).sort((a, b) => a[0] - b[0]).map(([idx, entry]) => ({
    class_index: idx,
    particle_count: Number.isInteger(entry.particle_count) ? entry.particle_count : null,
    particle_percent: Number.isInteger(entry.particle_count) && Number.isInteger(total) && total
      ? Math.round(entry.particle_count / total * 10000) / 100
      : null,
    total_particles: total,
    volume_group: entry.volume_group || null,
    mrc_preview_url: entry.mrc_preview_url || null,
    mrc_preview_src: entry.mrc_preview_src || null,
    mrc_preview_original_url: entry.mrc_preview_original_url || null,
    maps: entry.maps || []
  }));
}

function edgeKind(edge) {
  if (["particle", "volume", "mask", "template", "exposure"].includes(edge.input_type)) return edge.input_type;
  const types = (edge.slots || []).map((slot) => slot.result_type || "").join(" ");
  for (const kind of ["particle", "volume", "mask", "template", "exposure"]) {
    if (types.includes(kind)) return kind;
  }
  return edge.input_type || "parent";
}

function focusedEdgeLabel(kinds) {
  const order = ["particle", "volume", "mask", "template", "exposure", "parent"];
  const labels = {
    particle: "particles",
    volume: "map",
    mask: "mask",
    template: "template",
    exposure: "micrographs",
    parent: "parent"
  };
  return order.filter((kind) => kinds.has(kind)).map((kind) => labels[kind]).join(" + ");
}

function importance(job, startUid) {
  if (job.uid === startUid && !/nonuniform_refine/i.test(job.job_type || "")) return "final";
  if (MAJOR_JOB_TYPES.has(job.job_type)) return "major";
  if (SMALL_JOB_TYPES.has(job.job_type)) return "small";
  if (maxGroupNumItems(job, "particle") || maxGroupNumItems(job, "volume")) return "major";
  return "small";
}

function nodeLabel(job) {
  const node = jobNode(job);
  const parts = [node.uid, node.job_type || ""];
  if (node.particle_count !== null) parts.push(`${node.particle_count} particles`);
  if (node.micrograph_count !== null) parts.push(`${node.micrograph_count} micrographs`);
  return parts.join("<br/>").replace(/"/g, "'");
}

function focusedMermaid(nodes, edges, startUid) {
  const lines = ["flowchart LR"];
  const sortedNodes = Array.from(nodes.values()).sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0));

  for (const job of sortedNodes) {
    const cls = importance(job, startUid);
    lines.push(cls === "final"
      ? `  ${job.uid}[["${nodeLabel(job)}"]]`
      : `  ${job.uid}["${nodeLabel(job)}"]`);
    lines.push(`  class ${job.uid} ${cls};`);
  }

  const merged = new Map();
  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (!merged.has(key)) merged.set(key, { source: edge.source, target: edge.target, kinds: new Set() });
    merged.get(key).kinds.add(edgeKind(edge));
  }

  for (const item of Array.from(merged.values())) {
    lines.push(`  ${item.source} -- "${focusedEdgeLabel(item.kinds)}" --> ${item.target}`);
  }

  lines.push("  classDef final fill:#fee2e2,stroke:#b91c1c,stroke-width:3px,color:#111827;");
  lines.push("  classDef major fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#111827;");
  lines.push("  classDef small fill:#f3f4f6,stroke:#9ca3af,stroke-width:1px,color:#4b5563,font-size:11px;");
  return `${lines.join("\n")}\n`;
}

function normalizeLineageSummary(summary) {
  if (!summary || !Array.isArray(summary.nodes)) return summary;
  for (const node of summary.nodes) normalizeExtractionParamsForNode(node);
  if (summary.start_job) normalizeExtractionParamsForNode(summary.start_job);
  if (Array.isArray(summary.import_or_leaf_jobs)) {
    for (const node of summary.import_or_leaf_jobs) normalizeExtractionParamsForNode(node);
  }
  const startNode = summary.nodes.find((node) => node.uid === summary.start_uid) || summary.start_job;
  const finalResolution = resolutionNumber(summary.final_resolution_A) ||
    resolutionNumber(startNode && startNode.resolution_A) ||
    resolutionFromObject(startNode, "", 0);
  summary.final_resolution_A = finalResolution || null;
  summary.micrograph_pixel_size_A = pixelSizeNumber(summary.micrograph_pixel_size_A) ||
    pixelSizeNumber((summary.nodes || []).find((node) => pixelSizeNumber(node.pixel_size_A))?.pixel_size_A) ||
    pixelSizeNumber((summary.import_or_leaf_jobs || []).find((node) => pixelSizeNumber(node.pixel_size_A))?.pixel_size_A) ||
    null;
  summary.resolution_note = finalResolution
    ? "从 metadata/Overview 文本中解析得到。"
    : (summary.resolution_note || "未在 metadata/Overview 中找到分辨率；可从 FSC txt/xml 继续补充。");
  return summary;
}

function buildSummary(data, projectId, startUid, baseUrl) {
  const projectJobs = new Map(
    data.filter((job) => job.project_uid === projectId && job.uid).map((job) => [job.uid, job])
  );
  if (!projectJobs.has(startUid)) {
    const latest = Array.from(projectJobs.values())
      .filter((job) => Number.isInteger(job.uid_num))
      .sort((a, b) => a.uid_num - b.uid_num)
      .slice(-20)
      .map((job) => [job.uid_num, job.uid, job.job_type]);
    throw new Error(`${projectId}/${startUid} 不在当前 metadata 中。项目内 jobs=${projectJobs.size}，最新=${JSON.stringify(latest.at(-1))}`);
  }

  const { nodes, edges } = collectUpstream(projectJobs, startUid);
  const startJob = projectJobs.get(startUid);
  const nodeList = Array.from(nodes.values())
    .sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0))
    .map((job) => jobNode(job, baseUrl, projectId));
  const classJobs = nodeList
    .filter((node) => Array.isArray(node.classes) && node.classes.length)
    .map((node) => ({ uid: node.uid, job_type: node.job_type, classes: node.classes }));
  const importJobs = Array.from(nodes.values())
    .filter((job) => (job.job_type || "").startsWith("import_") || !(job.parents || []).length)
    .map((job) => jobNode(job, baseUrl, projectId));

  return normalizeLineageSummary({
    ok: true,
    project_uid: projectId,
    base_url: baseUrl,
    start_uid: startUid,
    start_job: jobNode(startJob, baseUrl, projectId),
    final_particle_count: maxGroupNumItems(startJob, "particle"),
    final_micrograph_count: maxGroupNumItems(startJob, "exposure"),
    final_resolution_A: resolutionFromJob(startJob),
    resolution_note: "需要从 CryoSmart metadata/log/FSC 结果补充；jobs metadata 通常没有最终分辨率。",
    map_download_urls: mapDownloadUrls(baseUrl, projectId, startUid),
    nodes: nodeList,
    edges,
    import_or_leaf_jobs: importJobs,
    class_split_jobs: classJobs,
    focused_mermaid: focusedMermaid(nodes, edges, startUid)
  });
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取 JSON 文件失败。"));
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(new Error(`JSON 解析失败：${err.message}`));
      }
    };
    reader.readAsText(file);
  });
}

function normalizeJobsPayload(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.jobs)) return value.jobs;
  throw new Error("metadata 文件里没有 jobs 数组。");
}

async function tryFetchProjectJobs(projectId) {
  const tabs = await chromeCall(chrome.tabs.query, { active: true, currentWindow: true });
  const url = tabs && tabs[0] && tabs[0].url;
  const origin = new URL(url || "http://192.168.4.3:8080").origin;
  const endpoints = [
    `${origin}/api/projects/${projectId}/jobs`,
    `${origin}/api/jobs?project_uid=${projectId}`,
    `${origin}/api/projects/${projectId}/metadata`,
    `${origin}/api/meteor/jobs?project_uid=${projectId}`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) continue;
      const value = await response.json();
      if (Array.isArray(value)) return { data: value, baseUrl: origin, endpoint };
      if (Array.isArray(value.jobs)) return { data: value.jobs, baseUrl: origin, endpoint };
    } catch (err) {
      // Try the next candidate endpoint.
    }
  }
  throw new Error("没有找到可用的 CryoSmart jobs API。请选择导出的 jobs JSON。");
}

async function sendContentMessage(action, payload) {
  const tabs = await chromeCall(chrome.tabs.query, { active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) throw new Error("没有找到当前 CryoSmart 标签页。");

  async function send() {
    return chromeCall(chrome.tabs.sendMessage, tab.id, { action, ...payload });
  }

  try {
    return await send();
  } catch (err) {
    if (!/receiving end|could not establish connection/i.test(err.message)) {
      throw err;
    }
    await chromeCall(chrome.scripting.executeScript, {
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    return send();
  }
}

async function traceFromCurrentPage(projectId, startUid) {
  return sendContentMessage("traceCryoSmartLineageFromPage", { projectId, startJob: startUid });
}

async function exportProjectMetadataFromCurrentPage(projectId) {
  return sendContentMessage("exportCryoSmartProjectMetadata", { projectId });
}

async function scanFinalResultsFromCurrentPage(projectId, startUid) {
  return sendContentMessage("scanCryoSmartFinalResults", { projectId, startJob: startUid });
}

async function fetchAssetFromCurrentPage(url) {
  const result = await sendContentMessage("fetchCryoSmartAsset", { url });
  if (!result || !result.ok || !result.summary || !result.summary.data_url) {
    throw new Error((result && result.error) || `页面下载失败：${url}`);
  }
  return result.summary;
}

function makePreview(summary) {
  if (summary.preview) return summary.preview;
  const lines = [];
  lines.push(`${summary.project_uid}/${summary.start_uid}`);
  lines.push(`类型: ${summary.start_job.job_type}`);
  lines.push(`最终颗粒数: ${summary.final_particle_count ?? "未知"}`);
  lines.push(`最终分辨率: ${summary.final_resolution_A ? `${formatBinFactor(summary.final_resolution_A)} Å` : "待从 FSC/metadata 补充"}`);
  lines.push("");
  lines.push("Map 下载:");
  for (const [name, url] of Object.entries(summary.map_download_urls)) {
    lines.push(`- ${name}: ${url}`);
  }
  lines.push("");
  lines.push("Ab initio / hetero class:");
  for (const item of summary.class_split_jobs) {
    lines.push(`- ${item.uid} ${item.job_type}`);
    for (const cls of item.classes) {
      lines.push(`  class ${cls.class_index}: ${cls.particle_count} particles (${cls.particle_percent}%) maps=${cls.maps.map((m) => m.result_name).join(", ")}`);
    }
  }
  lines.push("");
  lines.push("Micrograph 源头:");
  for (const job of summary.import_or_leaf_jobs) {
    lines.push(`- ${job.uid} ${job.job_type}: ${job.micrograph_count ?? "?"} micrographs${pixelSizeText(job) ? `, pixel ${pixelSizeText(job)}` : ""}`);
  }
  return lines.join("\n");
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "overwrite" }, () => {
    URL.revokeObjectURL(url);
  });
}

function downloadText(filename, text, type = "application/json") {
  downloadBlob(filename, new Blob([text], { type }));
}

function mimeForExtension(ext) {
  switch (String(ext || "").toLowerCase()) {
    case "png": return "image/png";
    case "pdf": return "application/pdf";
    case "xml": return "application/xml";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

function sniffExtension(bytes, mime = "", sourceUrl = "") {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const lowerMime = String(mime || "").toLowerCase();
  const lowerUrl = String(sourceUrl || "").toLowerCase();
  if (arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47) return "png";
  if (arr.length >= 4 && arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46) return "pdf";
  if (lowerMime.includes("png")) return "png";
  if (lowerMime.includes("pdf")) return "pdf";
  if (lowerMime.includes("xml")) return "xml";
  if (lowerMime.startsWith("text/")) return "txt";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(arr.slice(0, 512)).trimStart();
  if (head.startsWith("<")) return "xml";
  const urlExt = lowerUrl.match(/\.(png|pdf|txt|xml)(?:[?#]|$)/);
  if (urlExt) return urlExt[1];
  if (head) return "txt";
  return null;
}

function replaceFilenameExtension(filename, ext) {
  const wanted = String(ext || "").replace(/^\./, "").toLowerCase();
  if (!wanted) return filename;
  const parts = String(filename || "download").split("/");
  const base = parts.pop() || "download";
  const nextBase = /\.[A-Za-z0-9]{1,6}$/.test(base)
    ? base.replace(/\.[^.]+$/, `.${wanted}`)
    : `${base}.${wanted}`;
  parts.push(nextBase);
  return parts.join("/");
}

async function correctedDownloadBlob(filename, blob, sourceUrl) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = sniffExtension(bytes, blob.type, sourceUrl);
  const correctedName = ext ? replaceFilenameExtension(filename, ext) : filename;
  const correctedType = ext ? mimeForExtension(ext) : (blob.type || "application/octet-stream");
  return {
    filename: correctedName,
    blob: new Blob([bytes], { type: correctedType })
  };
}

async function downloadBundledText(filename, bundledName, type = "text/plain") {
  const url = chrome.runtime.getURL(bundledName);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取插件内置文件：${bundledName}`);
  downloadText(filename, await response.text(), type);
}

function safePart(value) {
  return String(value || "item")
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function localImageFilename(nodeUid, name) {
  return `images/${safePart(nodeUid)}/${safePart(name)}.png`;
}

function mapPreviewImageName(group) {
  const value = String(group || "volume");
  if (/^(volume|map)$/i.test(value)) return "volume";
  return value.replace(/\.map$/i, "");
}

function dedupeUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const url of urls || []) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function addReportImageAsset(assets, nodeUid, name, url, fallbackUrls = []) {
  const urls = dedupeUrls([url, ...fallbackUrls]);
  if (!urls.length) return;
  assets.push({
    url: urls[0],
    urls,
    filename: localImageFilename(nodeUid, name),
    mode: "fetch-image"
  });
}

function downloadRemoteDirect(url, filename) {
  if (!url || !filename) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "overwrite"
    }, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(downloadId);
    });
  });
}

async function downloadFetchedAsset(item) {
  if (!item || !item.url || !item.filename) return null;
  if (item.mode === "fetch-image") {
    const urls = dedupeUrls([...(item.urls || []), item.url]);
    for (const url of urls) {
      const image = await fetchPptImage({ key: item.filename, url });
      if (!image) continue;
      const blob = new Blob([image.bytes], { type: image.mime || "image/png" });
      downloadBlob(item.filename, blob);
      return item.filename;
    }
    throw new Error(`图片下载失败：${item.filename}`);
  }

  const urls = dedupeUrls([...(item.urls || []), item.url]);
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const corrected = item.mode === "fetch-file"
        ? await correctedDownloadBlob(item.filename, blob, url)
        : { filename: item.filename, blob };
      downloadBlob(corrected.filename, corrected.blob);
      return corrected.filename;
    } catch (err) {
      try {
        const asset = await fetchAssetFromCurrentPage(url);
        const parsed = bytesFromDataUri(asset.data_url);
        if (!parsed) throw new Error("bad data url");
        const blob = new Blob([parsed.bytes], { type: parsed.mime || asset.content_type || "application/octet-stream" });
        const corrected = item.mode === "fetch-file"
          ? await correctedDownloadBlob(item.filename, blob, url)
          : { filename: item.filename, blob };
        downloadBlob(corrected.filename, corrected.blob);
        return corrected.filename;
      } catch (innerErr) {
        // Try the next URL candidate.
      }
    }
  }
  throw new Error(`文件下载失败：${item.filename}`);
}

async function downloadRemoteBatch(downloads) {
  const clean = (downloads || []).filter((item) => item && item.url && item.filename);
  if (!clean.length) return { ok: true, count: 0 };

  const fetched = clean.filter((item) => /^fetch/.test(item.mode || ""));
  const direct = clean.filter((item) => !/^fetch/.test(item.mode || ""));
  let fetchCount = 0;
  const errors = [];
  for (const item of fetched) {
    try {
      await downloadFetchedAsset(item);
      fetchCount += 1;
    } catch (err) {
      errors.push(`${item.filename}: ${err.message}`);
    }
  }

  if (!direct.length) return { ok: true, count: fetchCount, errors };

  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "downloadCryoSmartFiles", downloads: direct }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    });
    if (!result || !result.ok) throw new Error((result && result.error) || "后台下载队列失败");
    return { ...result, count: (result.count || 0) + fetchCount, errors };
  } catch (err) {
    let count = fetchCount;
    for (const item of direct) {
      try {
        await downloadRemoteDirect(item.url, item.filename);
        count += 1;
      } catch (innerErr) {
        errors.push(`${item.filename}: ${innerErr.message}`);
      }
    }
    return { ok: true, count, fallback: true, errors };
  }
}

function collectReportImages(summary) {
  const assets = [];
  for (const node of summary.nodes || []) {
    if (node.job_type === "import_micrographs") {
      for (const image of node.representative_micrograph_images || []) {
        addReportImageAsset(assets, node.uid, image.local_name || image.name || "image", image.original_url || image.src || image.url, [image.src, image.url]);
      }
    }
    if (node.select_2d) {
      const s = node.select_2d;
      const items = [
        ["selected_classes", s.selected_classes_original_url || s.selected_classes_src || s.selected_classes_image, [s.selected_classes_src, s.selected_classes_image]],
        ["excluded_classes", s.excluded_classes_original_url || s.excluded_classes_src || s.excluded_classes_image, [s.excluded_classes_src, s.excluded_classes_image]],
        ["selected_particles", s.selected_particles_original_url || s.selected_particles_src || s.selected_particles_image, [s.selected_particles_src, s.selected_particles_image]]
      ];
      for (const [name, url, fallbacks] of items) {
        addReportImageAsset(assets, node.uid, name, url, fallbacks);
      }
    }
    for (const cls of node.classes || []) {
      addReportImageAsset(assets, node.uid, cls.volume_group || `class_${cls.class_index}`, cls.mrc_preview_original_url || cls.mrc_preview_src || cls.mrc_preview_url, [cls.mrc_preview_src, cls.mrc_preview_url]);
    }
    for (const item of normalMapAssets(node)) {
      addReportImageAsset(assets, node.uid, mapPreviewImageName(item.group), item.preview_original_url || item.preview_src || item.preview_url, [item.preview_src, item.preview_url]);
    }
  }
  return dedupeAssets(assets);
}

function collectReportMaps(summary) {
  const assets = [];
  for (const [name, url] of Object.entries(summary.map_download_urls || {})) {
    assets.push({
      url,
      filename: `maps/${safePart(summary.start_uid)}/BJ.${safePart(summary.project_uid)}.${safePart(summary.start_uid)}.${safePart(name)}.mrc`
    });
  }
  for (const node of summary.nodes || []) {
    for (const item of normalMapAssets(node)) {
      const suffix = `${item.group}.${item.result_name || "map"}`;
      assets.push({
        url: item.download_url,
        filename: `maps/${safePart(node.uid)}/BJ.${safePart(summary.project_uid || node.project_uid)}.${safePart(node.uid)}.${safePart(suffix)}.mrc`
      });
    }
  }
  return dedupeAssets(assets);
}

function finalResultDownloads(scanSummary) {
  return (scanSummary && scanSummary.items || [])
    .filter((item) => item && item.url && item.relativePath)
    .map((item) => ({
      url: item.url,
      filename: `Final_Result/${item.relativePath}`,
      mode: item.kind === "final_map" ? "direct" : "fetch-file"
    }));
}

function finalResultMetadata(summary, scanSummary) {
  const metrics = (scanSummary && scanSummary.metrics) || {};
  return {
    project_uid: summary.project_uid,
    start_uid: summary.start_uid,
    base_url: summary.base_url || (scanSummary && scanSummary.baseUrl) || "",
    final_particle_count: summary.final_particle_count ?? null,
    final_resolution_A: metrics.fsc_resolution_A || summary.final_resolution_A || null,
    guinier_b_factor: metrics.guinier_b_factor || null,
    micrograph_pixel_size_A: pixelSizeNumber(summary.micrograph_pixel_size_A) || null,
    graphs: (scanSummary && scanSummary.graphs) || {},
    missing_required: (scanSummary && scanSummary.missingRequired) || [],
    warnings: (scanSummary && scanSummary.warnings) || [],
    files: (scanSummary && scanSummary.items || []).map((item) => ({
      kind: item.kind,
      group: item.group || item.suffix || "",
      iteration: item.iteration || null,
      relative_path: item.relativePath,
      url: item.url
    }))
  };
}

function finalResultMetadataText(data) {
  const lines = [];
  lines.push(`${data.project_uid}/${data.start_uid} final results`);
  lines.push(`final particles: ${data.final_particle_count !== null && data.final_particle_count !== undefined ? fmt(data.final_particle_count) : "unknown"}`);
  lines.push(`FSC resolution: ${data.final_resolution_A ? `${formatBinFactor(data.final_resolution_A)} Å` : "unknown"}`);
  lines.push(`Guinier B-factor: ${data.guinier_b_factor !== null && data.guinier_b_factor !== undefined ? data.guinier_b_factor : "unknown"}`);
  lines.push(`micrograph pixel size: ${data.micrograph_pixel_size_A ? `${formatPixelSize(data.micrograph_pixel_size_A)} Å/px` : "unknown"}`);
  lines.push("");
  lines.push("graph iterations:");
  for (const [key, graph] of Object.entries(data.graphs || {})) {
    lines.push(`- ${key}: Iteration ${traceSafeIteration(graph.iteration)}`);
  }
  if (data.warnings && data.warnings.length) {
    lines.push("");
    lines.push("warnings:");
    for (const warning of data.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

function traceSafeIteration(value) {
  return value === null || value === undefined ? "unknown" : String(value).padStart(3, "0");
}

function dedupeAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = asset && (asset.filename || asset.url);
    if (!asset || !asset.url || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(value) {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : escHtml(value);
}

function summaryNodeMap(summary) {
  return new Map((summary.nodes || []).map((node) => [node.uid, node]));
}

function summaryKind(edge) {
  if (edge.kind) return edge.kind;
  if (edge.input_type) return edgeKind({ input_type: edge.input_type, slots: edge.slots || [] });
  if (Array.isArray(edge.kinds) && edge.kinds.length) return edge.kinds[0];
  return "parent";
}

function htmlKindClass(kind) {
  return {
    particle: "particle",
    volume: "volume",
    mask: "volume",
    exposure: "exposure",
    template: "template"
  }[kind] || "other";
}

function htmlKindLabel(kind) {
  return {
    particle: "particles",
    volume: "map",
    mask: "mask",
    exposure: "micrographs",
    template: "2D classes/templates",
    parent: "parent"
  }[kind] || kind || "";
}

function htmlNodeKind(node) {
  const type = node.job_type || "";
  if (node.volume_count !== null && node.volume_count !== undefined) return "volume";
  if (/refine|abinit|volume|class_3D/i.test(type)) return "volume";
  if (node.particle_count !== null && node.particle_count !== undefined) return "particle";
  if (/particle|picker|topaz/i.test(type)) return "particle";
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) return "exposure";
  if (/micrograph|ctf|exposure/i.test(type)) return "exposure";
  return "other";
}

function htmlMetricChips(node) {
  const chips = [];
  if (node.particle_count !== null && node.particle_count !== undefined) chips.push(["颗粒数", node.particle_count]);
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) chips.push(["照片数", node.micrograph_count]);
  if (pixelSizeText(node)) chips.push(["pixel size", pixelSizeText(node)]);
  if (node.volume_count !== null && node.volume_count !== undefined) chips.push(["volume 数", node.volume_count]);
  return chips.map(([label, value]) => `<span class="metric">${label}: ${fmt(value)}</span>`).join("");
}

function htmlCompactMetric(node) {
  if (!node) return "";
  const parts = [];
  if (node.particle_count !== null && node.particle_count !== undefined) parts.push(`颗粒数 ${fmt(node.particle_count)}`);
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) parts.push(`照片数 ${fmt(node.micrograph_count)}`);
  if (pixelSizeText(node)) parts.push(`pixel ${pixelSizeText(node)}`);
  if (node.volume_count !== null && node.volume_count !== undefined) parts.push(`volume 数 ${fmt(node.volume_count)}`);
  return parts.join("; ");
}

function htmlJobRef(uid, nodeMap) {
  const node = nodeMap.get(uid);
  return node
    ? `<a href="#${escHtml(uid)}">${escHtml(uid)} ${escHtml(node.job_type || "")}</a>`
    : escHtml(uid);
}

function htmlGroupLabel(edge) {
  return edge.source_group || edge.input_name || "";
}

function htmlRelationPills(edge) {
  const kind = summaryKind(edge);
  const cls = htmlKindClass(kind);
  const groups = [];
  const group = htmlGroupLabel(edge);
  if (group) groups.push(group);
  return `<span class="edge-pills"><span class="kind-pill kind-${cls}">${escHtml(htmlKindLabel(kind))}</span>${groups.map((item) => `<span class="group-pill group-${cls}">${escHtml(item)}</span>`).join("")}</span>`;
}

function groupedHtmlEdges(edges, peerKey) {
  const grouped = new Map();
  for (const edge of edges) {
    const peer = edge[peerKey];
    if (!peer) continue;
    const kind = summaryKind(edge);
    const group = htmlGroupLabel(edge);
    const key = `${peer}\t${kind}\t${group}`;
    if (!grouped.has(key)) grouped.set(key, { ...edge, kind, peer });
  }
  return Array.from(grouped.values());
}

function htmlSmallSourceHops(peerUid, kind, edges, nodeMap) {
  const peer = nodeMap.get(peerUid);
  if (!peer || importance(peer, "") !== "small") return "";
  const incoming = edges.filter((edge) => edge.target === peerUid && summaryKind(edge) === kind).slice(0, 3);
  if (!incoming.length) return "";
  return `<div class="hop-stack">${incoming.map((edge) => {
    const source = nodeMap.get(edge.source);
    const cls = htmlKindClass(summaryKind(edge));
    const metric = htmlCompactMetric(source);
    return `<div class="hop-row hop-${cls}"><span class="hop-label">上一层来源</span><span class="hop-main">${htmlJobRef(edge.source, nodeMap)} <span class="muted">-> ${escHtml(peerUid)}</span></span>${htmlRelationPills(edge)}${metric ? `<span class="hop-metric">${metric}</span>` : ""}</div>`;
  }).join("")}</div>`;
}

function htmlSourceRows(node, summary, nodeMap) {
  const edges = summary.edges || [];
  const incoming = groupedHtmlEdges(edges.filter((edge) => edge.target === node.uid), "source");
  const outgoing = groupedHtmlEdges(edges.filter((edge) => edge.source === node.uid), "target");
  if (!incoming.length && !outgoing.length) return "";
  const inHtml = incoming.length ? `<div class="source-col"><b>来源</b>${incoming.map((edge) => `<div class="source-row"><span>${htmlJobRef(edge.source, nodeMap)}</span>${htmlRelationPills(edge)}</div>${htmlSmallSourceHops(edge.source, summaryKind(edge), edges, nodeMap)}`).join("")}</div>` : "";
  const outHtml = outgoing.length ? `<div class="source-col source-col-out"><b>流向</b>${outgoing.slice(0, 10).map((edge) => `<div class="source-row source-row-out"><span>${htmlJobRef(edge.target, nodeMap)}</span>${htmlRelationPills(edge)}</div>`).join("")}</div>` : "";
  return `<div class="source-grid">${inHtml}${outHtml}</div>`;
}

function htmlClassTable(node, summary) {
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  if (!classJob || !classJob.classes || !classJob.classes.length) return "";
  const rows = classJob.classes.map((cls) => {
    const links = (cls.maps || []).map((map) => `<a href="${escHtml(map.download_url)}" target="_blank">${escHtml(map.result_name)}</a>`).join(" ");
    return `<tr><td>${escHtml(cls.class_index)}</td><td>${cls.particle_count === null || cls.particle_count === undefined ? "" : fmt(cls.particle_count)}</td><td>${cls.particle_percent === null || cls.particle_percent === undefined ? "" : escHtml(cls.particle_percent)}</td><td>${links}</td></tr>`;
  }).join("");
  return `<h3>Class / MRC 来源</h3><table><tr><th>Class</th><th>Particles</th><th>%</th><th>Map downloads</th></tr>${rows}</table>`;
}

function htmlMapTable(node, summary) {
  if (node.uid !== summary.start_uid || !summary.map_download_urls) return "";
  const rows = Object.entries(summary.map_download_urls).map(([name, url]) => (
    `<tr><td>${escHtml(name)}</td><td><a href="${escHtml(url)}" target="_blank">download</a></td></tr>`
  )).join("");
  return `<h3>MRC Maps</h3><table><tr><th>Result</th><th>Download</th></tr>${rows}</table>`;
}

function buildLineageHtml(summary) {
  const nodeMap = summaryNodeMap(summary);
  const nodes = (summary.nodes || []).filter((node) => {
    const cls = importance(node, summary.start_uid);
    return cls === "major" || cls === "final";
  });
  const css = [
    "body{font-family:'Times New Roman',Times,serif;margin:24px;color:#17202a;background:#f8fafc}",
    "h1,h2,h3{margin:0 0 10px} h3{font-size:16px;margin-top:14px} a{color:#0b74de;text-decoration:none}",
    ".muted{color:#64748b}.metric{display:inline-block;margin:0 8px 8px 0;padding:3px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;font-size:12px}",
    ".flow{position:relative;margin-left:12px}.flow::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:3px;background:#cbd5e1}.flow-card{position:relative;background:white;border:1px solid #d8e0ea;border-left:5px solid #0284c7;border-radius:8px;margin:14px 0 14px 34px;padding:14px}.flow-card::before{content:'';position:absolute;left:-31px;top:24px;width:24px;height:3px;background:#38bdf8}.flow-card::after{content:'';position:absolute;left:-39px;top:18px;width:14px;height:14px;border-radius:50%;background:#0284c7;border:3px solid #e0f2fe}",
    ".card-exposure{background:#f7fef9;border-left-color:#16a34a}.card-exposure::before{background:#16a34a}.card-exposure::after{background:#16a34a;border-color:#dcfce7}.card-particle{background:#fffdf4;border-left-color:#d97706}.card-particle::before{background:#d97706}.card-particle::after{background:#d97706;border-color:#fef3c7}.card-volume{background:#f8faff;border-left-color:#2563eb}.card-volume::before{background:#2563eb}.card-volume::after{background:#2563eb;border-color:#e0e7ff}",
    ".source-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin:10px 0}.source-col-out{background:#f8fafc;border:1px solid #edf2f7;border-radius:8px;padding:8px}.source-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0;padding:6px 8px;background:#fff;border:1px solid #dbe5ee;border-radius:6px}.source-row-out{background:#fbfdff;border-color:#edf2f7}",
    ".hop-stack{display:grid;gap:5px;margin:0 0 8px 18px;padding-left:12px;border-left:2px solid #dbe5ee}.hop-row{display:grid;grid-template-columns:auto minmax(210px,1fr) auto auto;align-items:center;gap:8px;padding:6px 8px;border:1px solid #dbe5ee;border-radius:6px;background:#fbfdff;font-size:12px}.hop-label{font-size:11px;color:#64748b;background:#eef2f7;border:1px solid #dbe5ee;border-radius:999px;padding:1px 7px}.hop-main{font-weight:600}.hop-metric{justify-self:end;color:#475569;white-space:nowrap}.hop-particle{background:#fffdf4;border-color:#fcd34d}.hop-volume{background:#f8faff;border-color:#a5b4fc}.hop-exposure{background:#f7fef9;border-color:#86efac}",
    ".edge-pills{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.kind-pill,.group-pill{white-space:nowrap;border-radius:999px;padding:2px 7px;font-size:12px}.kind-pill{color:#475569;background:#eef2f7;border:1px solid #dbe5ee}.group-pill{color:#334155;background:#f8fafc;border:1px solid #cbd5e1}.kind-particle,.group-particle{background:#fef3c7;border-color:#fcd34d;color:#78350f}.kind-volume,.group-volume{background:#e0e7ff;border-color:#a5b4fc;color:#1e3a8a}.kind-exposure,.group-exposure{background:#dcfce7;border-color:#86efac;color:#14532d}.kind-template,.group-template{background:#f1f5f9;border-color:#cbd5e1;color:#334155}",
    "table{border-collapse:collapse;width:100%;font-size:13px} th,td{border-bottom:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top}"
  ].join("\n");
  const cards = nodes.map((node) => `<article id="${escHtml(node.uid)}" class="flow-card card-${htmlNodeKind(node)}"><h2>${escHtml(node.uid)} ${escHtml(node.job_type || "")}</h2><div>${htmlMetricChips(node)}</div>${htmlSourceRows(node, summary, nodeMap)}${htmlClassTable(node, summary)}${htmlMapTable(node, summary)}</article>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CryoSmart ${escHtml(summary.project_uid)} ${escHtml(summary.start_uid)} Lineage</title><style>${css}</style></head><body><h1>CryoSmart Lineage Report: ${escHtml(summary.project_uid)}/${escHtml(summary.start_uid)}</h1><p class="muted">Nodes: ${(summary.nodes || []).length} | data edges: ${(summary.edges || []).length}</p><h2>Main Data Chain</h2><div class="flow">${cards}</div></body></html>`;
}

function reportJobNum(uid) {
  const match = String(uid || "").match(/J(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function reportEdgeKind(edge) {
  return summaryKind(edge);
}

function reportKindFamily(kind) {
  if (kind === "mask") return "volume";
  if (kind === "exposure") return "exposure";
  if (kind === "particle") return "particle";
  if (kind === "volume") return "volume";
  if (kind === "template" || kind === "ml_model" || kind === "model") return "template";
  return kind || "other";
}

function reportKindLabel(kind) {
  return {
    particle: "颗粒",
    volume: "map",
    mask: "mask",
    exposure: "照片",
    template: "template",
    ml_model: "model",
    model: "model",
    parent: "parent"
  }[kind] || kind || "";
}

function reportIsPickingNode(node) {
  return PICKING_JOB_TYPES.has(node && node.job_type);
}

function reportIsRepickParticleProducer(node) {
  return Boolean(
    node &&
    REPICK_PARTICLE_PRODUCER_TYPES.has(node.job_type) &&
    node.particle_count !== null &&
    node.particle_count !== undefined
  );
}

function reportIsRepickSetupNode(node) {
  return REPICK_SETUP_JOB_TYPES.has(node && node.job_type);
}

function reportIsParticleAuxNode(node) {
  return PARTICLE_AUX_JOB_TYPES.has(node && node.job_type);
}

function reportIsVolumeSourceNode(node) {
  const type = (node && node.job_type) || "";
  return Boolean(
    node && (
      node.volume_count !== null && node.volume_count !== undefined ||
      /homo_abinit|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|volume|map|align_3D|homo_reconstruct|sym_expand|particle_subtract/i.test(type)
    )
  );
}

function reportHasRepickSeed(uid, state, visited = new Set(), depth = 0) {
  if (!uid || visited.has(uid) || depth > 8) return false;
  if (state.repickSeedMemo && state.repickSeedMemo.has(uid)) return state.repickSeedMemo.get(uid);
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  const finish = (value) => {
    if (state.repickSeedMemo) state.repickSeedMemo.set(uid, value);
    return value;
  };
  if (reportIsVolumeSourceNode(node)) return finish(true);
  if (reportIsRepickParticleProducer(node)) return finish(false);

  const incoming = state.incomingByTarget.get(uid) || [];
  for (const edge of incoming) {
    const source = state.nodeMap.get(edge.source);
    if (edge.family === "volume" || edge.kind === "mask") return finish(true);
    if (edge.family === "particle" && reportIsVolumeSourceNode(source)) return finish(true);
    if (reportIsRepickSetupNode(node) || reportIsRepickSetupNode(source) || edge.family === "particle") {
      if (reportHasRepickSeed(edge.source, state, new Set(visited), depth + 1)) return finish(true);
    }
  }
  return finish(false);
}

function reportFeedsVolumeMainline(uid, state, visited = new Set(), depth = 0) {
  if (!uid || visited.has(uid) || depth > 10) return false;
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return false;
  if (depth > 0 && reportIsVolumeSourceNode(node)) return true;
  const outgoing = state.outgoingBySource ? state.outgoingBySource.get(uid) || [] : [];
  for (const edge of outgoing) {
    const target = state.nodeMap.get(edge.target);
    if (!target) continue;
    if (edge.family === "particle" || edge.family === "volume" || edge.family === "template" || /model/i.test(edge.kind || "")) {
      if (reportFeedsVolumeMainline(edge.target, state, new Set(visited), depth + 1)) return true;
    }
  }
  return false;
}

function reportRepickSeedSourceRounds(incoming, state, visited = new Set()) {
  return incoming.map((edge) => {
    const sourceNode = state.nodeMap.get(edge.source);
    const directSeed = edge.family === "volume" ||
      edge.kind === "mask" ||
      (edge.family === "particle" && reportIsVolumeSourceNode(sourceNode));
    const inheritedSeed = reportIsRepickSetupNode(sourceNode) && reportHasRepickSeed(edge.source, state);
    if (!directSeed && !inheritedSeed) return null;
    return reportLineageRound(edge.source, state, new Set(visited));
  }).filter((value) => Number.isInteger(value));
}

function reportMaxRoundFromEdges(edges, state, visited) {
  const rounds = edges.map((edge) => reportLineageRound(edge.source, state, new Set(visited)));
  return rounds.length ? Math.max(...rounds) : 0;
}

function reportParticleSourceRound(incoming, state, visited) {
  const particleIncoming = incoming.filter((edge) => edge.family === "particle");
  return particleIncoming.length ? reportMaxRoundFromEdges(particleIncoming, state, visited) : null;
}

function reportLineageRound(uid, state, visited = new Set()) {
  if (!uid || visited.has(uid)) return 0;
  if (state.roundMemo && state.roundMemo.has(uid)) return state.roundMemo.get(uid);
  visited.add(uid);
  const node = state.nodeMap.get(uid);
  if (!node) return 0;
  const type = node.job_type || "";
  const finish = (value) => {
    if (state.roundMemo) state.roundMemo.set(uid, value);
    return value;
  };

  if (/import_(movies|micrographs)/i.test(type)) return finish(0);
  if (/import_particles/i.test(type)) return finish(1);

  const incoming = state.incomingByTarget.get(uid) || [];
  const maxSourceRound = reportMaxRoundFromEdges(incoming, state, visited);
  const particleSourceRound = reportParticleSourceRound(incoming, state, visited);
  const seedSourceRounds = reportRepickSeedSourceRounds(incoming, state, visited);
  const seedRound = seedSourceRounds.length ? Math.max(...seedSourceRounds) : null;

  if (reportIsRepickSetupNode(node)) {
    if (seedRound !== null && reportFeedsVolumeMainline(uid, state)) {
      return finish(Math.max(2, seedRound + 1));
    }
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1));
  }

  if (reportIsRepickParticleProducer(node)) {
    const setupSourceRounds = incoming
      .filter((edge) => reportIsRepickSetupNode(state.nodeMap.get(edge.source)))
      .map((edge) => reportLineageRound(edge.source, state, new Set(visited)));
    if (setupSourceRounds.length) {
      return finish(Math.max(1, ...setupSourceRounds));
    }
    if (seedRound !== null && reportFeedsVolumeMainline(uid, state)) {
      return finish(Math.max(2, seedRound + 1));
    }
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || seedRound || 1));
  }

  if (reportIsPickingNode(node)) {
    return finish(Math.max(1, (particleSourceRound ?? maxSourceRound) || 1));
  }

  if (reportIsParticleAuxNode(node)) {
    return finish(particleSourceRound ?? maxSourceRound);
  }

  if (/class_2D|select_2D|rebalance_classes_2D|class_probability_filter/i.test(type)) {
    return finish(Math.max(1, particleSourceRound ?? maxSourceRound));
  }

  if (/homo_abinit|import_volumes|import_templates|create_templates|hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|align_3D|homo_reconstruct|sym_expand|particle_subtract|volume_tools|volume_alignment|local_resolution|sharpen|fsc3D|cryodrgn|relion|helix|auto3Dre/i.test(type)) {
    return finish(particleSourceRound ?? maxSourceRound);
  }

  return finish(particleSourceRound ?? maxSourceRound);
}

function reportNodeIsMajor(node, summary) {
  const type = node.job_type || "";
  if (node.uid === summary.start_uid) return true;
  if (MAJOR_JOB_TYPES.has(type)) return true;
  if (/local_refine|topaz_train|topaz_extract/i.test(type)) return true;
  if (node.particle_count !== null && node.particle_count !== undefined) return true;
  if (node.volume_count !== null && node.volume_count !== undefined) return true;
  return false;
}

function reportStageName(node, summary, state) {
  const type = node.job_type || "";
  if (/import_(movies|micrographs)/i.test(type)) return "Micrographs";
  const round = state ? reportLineageRound(node.uid, state) : 0;
  if (round > 0) {
    return `Round ${round}`;
  }
  return "Auxiliary";
}

function reportIsPostMapExtraction(node, state) {
  if (!node || !/extract_micrographs/i.test(node.job_type || "")) return false;
  const incoming = state.incomingByTarget.get(node.uid) || [];
  return incoming.some((edge) => {
    const source = state.nodeMap.get(edge.source);
    return /class_\d+/i.test(edge.group || "") || edge.family === "volume" || reportIsVolumeSourceNode(source);
  });
}

function reportIsParticlePipelineNode(node) {
  const type = (node && node.job_type) || "";
  return /import_particles|picker|topaz|extract_micrographs|remove_duplicate|particle_sets|downsample|standardize_particle|check_corrupt|reassign_particles/i.test(type);
}

function reportIsSelect2DNode(node) {
  return Boolean(node && (node.select_2d || /select_2D/i.test(node.job_type || "")));
}

function reportHasUpstreamSelectInSameRound(uid, state, round, visited = new Set(), depth = 0) {
  if (!uid || visited.has(uid) || depth > 10) return false;
  visited.add(uid);
  for (const edge of state.incomingByTarget.get(uid) || []) {
    const source = state.nodeMap.get(edge.source);
    if (!source || reportLineageRound(source.uid, state) !== round) continue;
    if (reportIsSelect2DNode(source)) return true;
    if (reportIsParticlePipelineNode(source) || reportIsPickingNode(source) || reportIsParticleAuxNode(source) || reportIsRepickSetupNode(source)) {
      if (reportHasUpstreamSelectInSameRound(source.uid, state, round, new Set(visited), depth + 1)) return true;
    }
  }
  return false;
}

function reportRoundParticleNodes(summary, state, round, postSelect = null) {
  return reportRoundNodes(summary, state, round, reportIsParticlePipelineNode)
    .filter((node) => {
      if (postSelect === null) return true;
      return reportHasUpstreamSelectInSameRound(node.uid, state, round) === postSelect;
    });
}

function reportPhaseName(node, summary, state) {
  const type = node.job_type || "";
  if (/import_(movies|micrographs)/i.test(type)) return "导入 / 预处理";
  if (/class_2D|select_2D|rebalance_classes_2D|class_probability_filter/i.test(type)) return "2D";
  if (/homo_abinit|import_volumes|import_templates|create_templates/i.test(type)) return "初始建模";
  if (/hetero|nonuniform|homo_refine|local_refine|class_3D|var_3D|align_3D|homo_reconstruct|sym_expand|particle_subtract|volume_tools|volume_alignment|local_resolution|sharpen|fsc3D|cryodrgn|relion|helix|auto3Dre/i.test(type)) {
    return "refine / final";
  }
  if (reportIsPostMapExtraction(node, state)) return "refine / final";
  if (reportIsParticlePipelineNode(node)) {
    const round = state ? reportLineageRound(node.uid, state) : 0;
    if (round > 0 && state && reportHasUpstreamSelectInSameRound(node.uid, state, round)) {
      return "再挑颗粒 / 提取";
    }
    return "挑颗粒 / 提取";
  }
  return "附属";
}

function reportNodeCardKind(node) {
  const kind = htmlNodeKind(node);
  return kind === "exposure" ? "micrograph" : kind;
}

function reportMetricText(node, compact = false) {
  const parts = [];
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) parts.push(`照片 ${fmt(node.micrograph_count)}`);
  if (pixelSizeText(node)) parts.push(`pixel ${pixelSizeText(node)}`);
  if (node.particle_count !== null && node.particle_count !== undefined) parts.push(`颗粒 ${fmt(node.particle_count)}`);
  if (node.class_count !== null && node.class_count !== undefined) parts.push(`class ${fmt(node.class_count)}`);
  if (node.volume_count !== null && node.volume_count !== undefined) parts.push(`volume ${fmt(node.volume_count)}`);
  const res = resolutionText(node);
  if (res) parts.push(res);
  const bin = extractionBinText(node);
  if (bin) parts.push(bin);
  return compact ? parts.join(" · ") : parts.join(" · ");
}

function reportPictureParticleMetricText(node) {
  const parts = [];
  if (node.particle_count !== null && node.particle_count !== undefined) parts.push(`颗粒 ${fmt(node.particle_count)}`);
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) parts.push(`照片 ${fmt(node.micrograph_count)}`);
  const bin = extractionBinText(node);
  if (bin) parts.push(bin);
  return parts.join(" · ");
}

function reportNormalizedEdges(summary) {
  if (summary && REPORT_NORMALIZED_EDGES_CACHE.has(summary)) return REPORT_NORMALIZED_EDGES_CACHE.get(summary);
  const edges = (summary.edges || []).map((edge) => ({
    ...edge,
    kind: reportEdgeKind(edge),
    family: reportKindFamily(reportEdgeKind(edge)),
    group: htmlGroupLabel(edge)
  }));
  if (summary) REPORT_NORMALIZED_EDGES_CACHE.set(summary, edges);
  return edges;
}

function reportGroupedIncoming(summary, nodeUid) {
  const grouped = new Map();
  for (const edge of reportNormalizedEdges(summary).filter((item) => item.target === nodeUid)) {
    const key = `${edge.source}\t${edge.kind}`;
    if (!grouped.has(key)) {
      grouped.set(key, { source: edge.source, kind: edge.kind, family: edge.family, groups: [] });
    }
    if (edge.group && !grouped.get(key).groups.includes(edge.group)) {
      grouped.get(key).groups.push(edge.group);
    }
  }
  return Array.from(grouped.values()).sort((a, b) => reportJobNum(a.source) - reportJobNum(b.source));
}

function reportGroupedOutgoing(summary, nodeUid) {
  const grouped = new Map();
  for (const edge of reportNormalizedEdges(summary).filter((item) => item.source === nodeUid)) {
    const key = `${edge.target}\t${edge.kind}`;
    if (!grouped.has(key)) {
      grouped.set(key, { target: edge.target, kind: edge.kind, family: edge.family, groups: [] });
    }
    if (edge.group && !grouped.get(key).groups.includes(edge.group)) {
      grouped.get(key).groups.push(edge.group);
    }
  }
  return Array.from(grouped.values()).sort((a, b) => reportJobNum(a.target) - reportJobNum(b.target));
}

function reportTraceVisibleSources(sourceUid, family, visible, incomingByTarget, visited = new Set(), depth = 0) {
  const memo = incomingByTarget.__traceVisibleMemo;
  const memoKey = `${sourceUid}\t${family}`;
  const useMemo = visited.size === 0 && memo;
  if (useMemo && memo.has(memoKey)) return memo.get(memoKey);
  if (!sourceUid || visited.has(sourceUid) || depth > 8) return [];
  visited.add(sourceUid);
  if (visible.has(sourceUid)) {
    const result = [sourceUid];
    if (useMemo) memo.set(memoKey, result);
    return result;
  }
  const allIncoming = incomingByTarget.get(sourceUid) || [];
  let incoming = allIncoming.filter((edge) => edge.family === family);
  if (!incoming.length) incoming = allIncoming;
  if (!incoming.length) return [];
  const results = [];
  for (const edge of incoming) {
    results.push(...reportTraceVisibleSources(edge.source, family, visible, incomingByTarget, new Set(visited), depth + 1));
  }
  const result = Array.from(new Set(results)).sort((a, b) => reportJobNum(a) - reportJobNum(b));
  if (useMemo) memo.set(memoKey, result);
  return result;
}

function reportVisibleOutlineNodes(summary, nodeMap) {
  const nodes = (summary.nodes || []).filter((node) => {
    if (reportNodeIsMajor(node, summary)) return true;
    return false;
  });
  return nodes.sort((a, b) => (a.uid_num || reportJobNum(a.uid)) - (b.uid_num || reportJobNum(b.uid)));
}

function reportBuildLineageState(summary) {
  const nodeMap = summaryNodeMap(summary);
  const edges = reportNormalizedEdges(summary);
  const incomingByTarget = new Map();
  const outgoingBySource = new Map();
  for (const edge of edges) {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target).push(edge);
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    outgoingBySource.get(edge.source).push(edge);
  }
  incomingByTarget.__traceVisibleMemo = new Map();
  const outlineNodes = reportVisibleOutlineNodes(summary, nodeMap);
  const visible = new Set(outlineNodes.map((node) => node.uid));
  return {
    nodeMap,
    edges,
    incomingByTarget,
    outgoingBySource,
    outlineNodes,
    visible,
    roundMemo: new Map(),
    repickSeedMemo: new Map()
  };
}

function reportOutlineRefs(uid, state) {
  const refs = new Map();
  for (const edge of state.incomingByTarget.get(uid) || []) {
    for (const source of reportTraceVisibleSources(edge.source, edge.family, state.visible, state.incomingByTarget)) {
      if (!state.visible.has(source) || source === uid) continue;
      const key = `${source}\t${edge.family}`;
      if (!refs.has(key)) refs.set(key, [source, edge.family]);
    }
  }
  const familyOrder = { exposure: 1, micrograph: 1, particle: 2, volume: 3, template: 4, other: 5 };
  return Array.from(refs.values()).sort((a, b) => {
    const byJob = reportJobNum(a[0]) - reportJobNum(b[0]);
    if (byJob) return byJob;
    return (familyOrder[a[1]] || 9) - (familyOrder[b[1]] || 9);
  });
}

function reportSourceTrace(targetUid, sourceUid, family, state) {
  if (state.visible.has(sourceUid)) return "";
  const refs = [];
  for (const edge of state.incomingByTarget.get(sourceUid) || []) {
    if (edge.family === family) {
      refs.push(...reportTraceVisibleSources(edge.source, family, state.visible, state.incomingByTarget));
    }
  }
  if (!refs.length) {
    for (const edge of state.incomingByTarget.get(sourceUid) || []) {
      refs.push(...reportTraceVisibleSources(edge.source, family, state.visible, state.incomingByTarget));
    }
  }
  const dedupedRefs = Array.from(new Set(refs))
    .filter((uid) => uid !== sourceUid && state.visible.has(uid))
    .sort((a, b) => reportJobNum(a) - reportJobNum(b));
  if (!dedupedRefs.length) return "";
  const route = `${escHtml(targetUid)} &larr; ${escHtml(sourceUid)} &larr; ${dedupedRefs.map(escHtml).join(" / ")}`;
  const lines = dedupedRefs.map((uid) => {
    const node = state.nodeMap.get(uid) || {};
    const metric = reportMetricText(node, true);
    return `<div class="up-line">${escHtml(uid)} ${escHtml(node.job_type || "")}${metric ? ` ${escHtml(metric)}` : ""}</div>`;
  }).join("");
  return `<div class="up-route">${route}</div><div class="up-list">${lines}</div>`;
}

function reportMiniNode(node, state) {
  const kind = reportNodeCardKind(node);
  const refs = reportOutlineRefs(node.uid, state).map(([uid, family]) => (
    `<i class="ref-pill ${escHtml(family === "exposure" ? "micrograph" : family)}">${escHtml(uid)}</i>`
  )).join("");
  const metric = reportMetricText(node, true);
  return `<a class="mini-node ${escHtml(kind)}" href="#card-${escHtml(node.uid)}"><b>${escHtml(node.uid)}</b><span>${escHtml(node.job_type || "")}</span>${metric ? `<em>${escHtml(metric)}</em>` : ""}<p class="mini-refs">${refs}</p></a>`;
}

function reportOutline(summary, state) {
  const byStage = new Map();
  for (const node of state.outlineNodes) {
    const stage = reportStageName(node, summary, state);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(node);
  }
  const roundStages = Array.from(byStage.keys())
    .filter((stage) => /^Round \d+$/i.test(stage))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const stageOrder = ["Micrographs", ...roundStages, "Auxiliary"];
  const phaseOrder = ["导入 / 预处理", "挑颗粒 / 提取", "2D", "再挑颗粒 / 提取", "初始建模", "refine / final", "附属"];
  return stageOrder
    .filter((stage) => (byStage.get(stage) || []).length)
    .map((stage, idx, stages) => {
      const nodes = byStage.get(stage) || [];
      const byPhase = new Map();
      for (const node of nodes) {
        const phase = reportPhaseName(node, summary, state);
        if (!byPhase.has(phase)) byPhase.set(phase, []);
        byPhase.get(phase).push(node);
      }
      const phaseHtml = phaseOrder
        .filter((phase) => (byPhase.get(phase) || []).length)
        .map((phase) => {
          const phaseNodes = byPhase.get(phase).map((node) => reportMiniNode(node, state)).join("");
          return `<div class="phase"><div class="phase-label">${escHtml(phase)}</div><div class="stage-grid">${phaseNodes}</div></div>`;
        }).join("");
      const arrow = idx < stages.length - 1 ? `<div class="stage-arrow">&darr;</div>` : "";
      return `<div class="stage"><h3>${escHtml(stage)}</h3>${phaseHtml}</div>${arrow}`;
    }).join("");
}

function reportSourceTable(node, summary, state) {
  const incoming = reportGroupedIncoming(summary, node.uid);
  if (!incoming.length) return "";
  const rows = incoming.map((edge) => {
    const source = state.nodeMap.get(edge.source) || {};
    const kindCls = htmlKindClass(edge.kind);
    const groups = edge.groups.join(", ");
    const metric = reportMetricText(source, true);
    return `<tr><td class="kind-cell ${escHtml(kindCls)}"><i></i>${escHtml(reportKindLabel(edge.kind))}</td><td><a href="#card-${escHtml(edge.source)}">${escHtml(edge.source)} ${escHtml(source.job_type || "")}</a>${metric ? `<em>${escHtml(metric)}</em>` : ""}</td><td>${escHtml(groups)}</td><td class="up-cell">${reportSourceTrace(node.uid, edge.source, edge.family, state)}</td></tr>`;
  }).join("");
  return `<div class="source-block"><h3>来源</h3><table class="source-table"><thead><tr><th>类型</th><th>直接来源</th><th>引用</th><th>合并上游</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function reportOutgoingBox(node, summary, state) {
  const outgoing = reportGroupedOutgoing(summary, node.uid);
  if (!outgoing.length) return `<aside class="job-out"><h3>输出到</h3><span class="quiet">最终节点</span></aside>`;
  const rows = outgoing.slice(0, 8).map((edge) => {
    const target = state.nodeMap.get(edge.target) || {};
    return `<div><b>${escHtml(reportKindLabel(edge.kind))}</b> -> ${escHtml(edge.target)} ${escHtml(target.job_type || "")}</div>`;
  }).join("");
  return `<aside class="job-out"><h3>输出到</h3>${rows}</aside>`;
}

function reportClassTable(node, summary) {
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  if (!classJob || !Array.isArray(classJob.classes) || !classJob.classes.length) return "";
  const headers = classJob.classes.map((cls) => `<th>class ${escHtml(cls.class_index)}</th>`).join("");
  const counts = classJob.classes.map((cls) => `<td>${cls.particle_count === null || cls.particle_count === undefined ? "" : fmt(cls.particle_count)}</td>`).join("");
  const percents = classJob.classes.map((cls) => `<td>${cls.particle_percent === null || cls.particle_percent === undefined ? "" : `${escHtml(cls.particle_percent)}%`}</td>`).join("");
  const previews = classJob.classes.map((cls) => (
    `<td>${cls.mrc_preview_url ? `<a href="${escHtml(cls.mrc_preview_original_url || cls.mrc_preview_url)}" target="_blank">${reportImgTag(node.uid, cls.volume_group || `class_${cls.class_index}`, cls.mrc_preview_src || cls.mrc_preview_url, "class-preview", `class ${cls.class_index} map preview`)}</a>` : ""}</td>`
  )).join("");
  const maps = classJob.classes.map((cls) => {
    const link = (cls.maps || []).find((item) => item.result_name === "map") || (cls.maps || [])[0];
    return `<td>${link ? `<a href="${escHtml(link.download_url)}" target="_blank">map</a>` : ""}</td>`;
  }).join("");
  const downloadUrls = classJob.classes
    .flatMap((cls) => cls.maps || [])
    .filter((item) => item.result_name === "map" || !item.result_name)
    .map((item) => item.download_url)
    .filter(Boolean);
  const button = downloadUrls.length
    ? `<button type="button" class="download-all" data-urls="${escHtml(downloadUrls.join("|"))}">一键下载 map</button>`
    : "";
  return `<div class="class-toolbar"><span>Class / Map</span></div><div class="classes horizontal-view"><div class="horizontal-table"><table><tbody><tr><th>Class</th>${headers}</tr><tr><th>颗粒</th>${counts}</tr><tr><th>%</th>${percents}</tr><tr><th>预览</th>${previews}</tr><tr><th>Map</th>${maps}</tr></tbody></table></div></div>${downloadUrls.length ? `<div class="download-head"><b>普通 map: ${downloadUrls.length} 个</b>${button}</div>` : ""}`;
}

function normalMapAssets(node) {
  return (node.maps || []).filter((item) => {
    const group = String(item.group || "");
    const volumeGroup = item.group_type ? item.group_type === "volume" : !/mask/i.test(group);
    return volumeGroup && (item.result_name === "map" || item.download_url.endsWith(".map"));
  });
}

function reportImgTag(nodeUid, name, remoteSrc, className = "", alt = "image") {
  if (!remoteSrc) return "";
  const localSrc = localImageFilename(nodeUid, name);
  const cls = className ? ` class="${escHtml(className)}"` : "";
  return `<img${cls} src="${escHtml(localSrc)}" data-remote-src="${escHtml(remoteSrc)}" onerror="this.onerror=null;this.src=this.dataset.remoteSrc" alt="${escHtml(alt)}">`;
}

function reportImageBoxes(nodeUid, images, limit = 4) {
  const good = (images || []).filter((item) => item && item.url && item.src).slice(0, limit);
  if (!good.length) return "";
  return `<div class="imgs">${good.map((item) => (
    `<figure class="imgbox"><a href="${escHtml(item.original_url || item.url)}" target="_blank">${reportImgTag(nodeUid, item.local_name || item.name || "image", item.src || item.url, "", item.name || "image")}</a><figcaption>${escHtml(item.name || "image")} <a href="${escHtml(item.original_url || item.url)}" target="_blank">打开</a></figcaption></figure>`
  )).join("")}</div>`;
}

function reportMediaBlock(node) {
  const chunks = [];
  if (node.job_type === "import_micrographs" && Array.isArray(node.representative_micrograph_images)) {
    const html = reportImageBoxes(node.uid, node.representative_micrograph_images, 3);
    if (html) chunks.push(`<div class="media-block"><h3>原始 micrographs 预览</h3>${html}</div>`);
  }

  if (node.select_2d) {
    const s = node.select_2d;
    const chips = [];
    if (s.particles_selected !== null && s.particles_selected !== undefined) chips.push(`<span class="chip particle">保留颗粒: ${fmt(s.particles_selected)}</span>`);
    if (s.particles_excluded !== null && s.particles_excluded !== undefined) chips.push(`<span class="chip particle">排除颗粒: ${fmt(s.particles_excluded)}</span>`);
    if (s.classes_selected !== null && s.classes_selected !== undefined) chips.push(`<span class="chip">selected classes: ${fmt(s.classes_selected)}</span>`);
    if (s.classes_excluded !== null && s.classes_excluded !== undefined) chips.push(`<span class="chip">excluded classes: ${fmt(s.classes_excluded)}</span>`);
    const images = [
      s.selected_classes_image ? { name: "templates_selected", local_name: "selected_classes", url: s.selected_classes_image, src: s.selected_classes_src || s.selected_classes_image, original_url: s.selected_classes_original_url } : null,
      s.excluded_classes_image ? { name: "templates_excluded", local_name: "excluded_classes", url: s.excluded_classes_image, src: s.excluded_classes_src || s.excluded_classes_image, original_url: s.excluded_classes_original_url } : null,
      s.selected_particles_image ? { name: "particles_selected", local_name: "selected_particles", url: s.selected_particles_image, src: s.selected_particles_src || s.selected_particles_image, original_url: s.selected_particles_original_url } : null
    ].filter(Boolean);
    chunks.push(`<div class="media-block"><h3>Select 2D</h3><div class="metrics">${chips.join("")}</div>${reportImageBoxes(node.uid, images, 3)}</div>`);
  }

  return chunks.join("");
}

function reportMapDownloads(node, summary) {
  if (Array.isArray(node.classes) && node.classes.length) return "";
  const maps = normalMapAssets(node);
  if (!maps.length) return "";
  const urls = maps.map((item) => item.download_url).join("|");
  const rows = maps.map((item) => {
    const preview = item.preview_url
      ? `<a href="${escHtml(item.preview_original_url || item.preview_url)}" target="_blank">${reportImgTag(node.uid, mapPreviewImageName(item.group), item.preview_src || item.preview_url, "map-preview", `${item.group} preview`)}</a>`
      : "";
    return `<tr><td>${escHtml(item.group)}</td><td>${preview}</td><td><a href="${escHtml(item.download_url)}" target="_blank">map</a></td></tr>`;
  }).join("");
  return `<div class="map-block"><h3>Map / MRC</h3><div class="download-head"><b>普通 map: ${maps.length} 个</b><button type="button" class="download-all" data-urls="${escHtml(urls)}">一键下载 map</button></div><table class="map-table"><thead><tr><th>Group</th><th>预览</th><th>下载</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function reportFirstMicrographNode(summary) {
  return (summary.nodes || []).find((node) => node.job_type === "import_micrographs" && node.micrograph_count !== null) ||
    (summary.nodes || []).find((node) => /micrograph/i.test(node.job_type || ""));
}

function reportSelectedClassIndices(nodeUid, summary, state) {
  const selected = new Set();
  for (const edge of state.edges.filter((item) => item.source === nodeUid)) {
    const group = edge.group || "";
    const idx = parseClassIndex(group);
    if (idx !== null && (edge.family === "particle" || edge.family === "volume")) {
      selected.add(idx);
    }
  }
  return selected;
}

function reportRoundNodes(summary, state, round, predicate) {
  return (summary.nodes || [])
    .filter((node) => reportLineageRound(node.uid, state) === round)
    .filter(predicate)
    .sort((a, b) => reportJobNum(a.uid) - reportJobNum(b.uid));
}

function reportPictureImg(nodeUid, name, remoteSrc, className = "", alt = "image") {
  return reportImgTag(nodeUid, name, remoteSrc, className, alt);
}

function reportPictureMicrographs(summary) {
  const node = reportFirstMicrographNode(summary);
  if (!node) return "";
  const imgs = (node.representative_micrograph_images || []).slice(0, 3);
  const imgHtml = imgs.length
    ? `<div class="pf-mic-imgs">${imgs.map((item) => reportPictureImg(node.uid, item.local_name || item.name || "image", item.src || item.url, "", item.name || "micrograph")).join("")}</div>`
    : "";
  const preprocess = (summary.nodes || [])
    .filter((item) => SMALL_JOB_TYPES.has(item.job_type) && /ctf|motion|curate|exposure/i.test(item.job_type || ""))
    .slice(0, 4)
    .map((item) => `${item.uid} ${item.job_type}`)
    .join("; ");
  return `<div class="pf-start"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-big">${fmt(node.micrograph_count)} micrographs${pixelSizeText(node) ? ` · ${escHtml(pixelSizeText(node))}` : ""}</div>${imgHtml}<div class="pf-note">${escHtml(node.uid)} ${escHtml(node.job_type || "")}${preprocess ? ` · preprocessing: ${escHtml(preprocess)}` : ""}</div></a></div>`;
}

function reportPictureSelect2D(node) {
  const s = node.select_2d;
  if (!s) return "";
  const input = node.particle_count || s.particles_selected || null;
  const selected = s.particles_selected;
  const ratio = Number.isInteger(input) && Number.isInteger(selected) && input
    ? `${Math.round(selected / input * 1000) / 10}%`
    : "";
  const img = s.selected_classes_image
    ? `<div class="pf-select-img">${reportPictureImg(node.uid, "selected_classes", s.selected_classes_src || s.selected_classes_image, "", "templates selected")}</div>`
    : "";
  return `<div class="pf-step pf-select"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(node.uid)} select_2D</div><div class="pf-note">input: ${input ? fmt(input) : "?"} particles</div><div class="pf-note">selected classes: ${s.classes_selected ?? "?"}</div><div class="pf-note">output: ${selected ? fmt(selected) : "?"} particles${ratio ? `, ${ratio}` : ""}</div>${img}</a></div>`;
}

function reportPictureParticleSteps(summary, state, round, label = "挑颗粒 / 提取", postSelect = null) {
  const nodes = reportRoundParticleNodes(summary, state, round, postSelect);
  if (!nodes.length) return "";
  const items = nodes.map((node) => {
    const metric = reportPictureParticleMetricText(node);
    return `<a class="pf-particle-step" href="#card-${escHtml(node.uid)}"><b>${escHtml(node.uid)}</b><span>${escHtml(node.job_type || "")}</span>${metric ? `<em>${escHtml(metric)}</em>` : ""}</a>`;
  }).join("");
  return `<div class="pf-particle-block"><div class="pf-subhead">${escHtml(label)}</div><div class="pf-particle-steps">${items}</div></div>`;
}

function reportPictureClassJob(node, summary, state) {
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  if (!classJob || !classJob.classes || !classJob.classes.length) return "";
  const selected = reportSelectedClassIndices(node.uid, summary, state);
  const total = classJob.classes.find((item) => Number.isInteger(item.total_particles))?.total_particles || node.particle_count;
  const toGroups = state.edges
    .filter((edge) => edge.source === node.uid && parseClassIndex(edge.group) !== null)
    .map((edge) => `${edge.target} ${edge.group}`)
    .filter(Boolean);
  const tiles = classJob.classes.map((cls) => {
    const isSelected = selected.has(cls.class_index);
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${escHtml(cls.particle_percent)}%` : "";
    const count = cls.particle_count !== null && cls.particle_count !== undefined ? `${fmt(cls.particle_count)} particles` : "";
    const img = cls.mrc_preview_url
      ? reportPictureImg(node.uid, cls.volume_group || `class_${cls.class_index}`, cls.mrc_preview_src || cls.mrc_preview_url, "", `class ${cls.class_index}`)
      : "";
    return `<figure class="pf-class ${isSelected ? "selected" : ""}">${img}<figcaption>class ${escHtml(cls.class_index)}</figcaption><b>${pct}</b><span>${count}</span></figure>`;
  }).join("");
  return `<div class="pf-map-job"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(node.uid)} ${escHtml(node.job_type || "")}</div><div class="pf-note">input: ${total ? fmt(total) : "?"} particles${selected.size ? ` · selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}` : ""}</div>${toGroups.length ? `<div class="pf-note">to: ${escHtml(toGroups.slice(0, 4).join("; "))}</div>` : ""}<div class="pf-classes">${tiles}</div></a></div>`;
}

function reportPictureNormalMap(node) {
  const maps = normalMapAssets(node);
  if (!maps.length) return "";
  const item = maps.find((map) => map.preview_url) || maps[0];
  const preview = item.preview_url
    ? reportPictureImg(node.uid, mapPreviewImageName(item.group), item.preview_src || item.preview_url, "", `${item.group} preview`)
    : "";
  return `<div class="pf-final"><a class="pf-link" href="#card-${escHtml(node.uid)}"><div class="pf-step-title">${escHtml(node.uid)} ${escHtml(node.job_type || "")}</div>${preview ? `<div class="pf-final-img">${preview}</div>` : ""}<div class="pf-big">${node.particle_count !== null && node.particle_count !== undefined ? `${fmt(node.particle_count)} particles` : "final map"}</div>${summaryResolutionLine(node)}</a></div>`;
}

function summaryResolutionLine(node) {
  const res = resolutionText(node);
  return res ? `<div class="pf-note">${escHtml(res)}</div>` : "";
}

function reportPictureRound(summary, state, round) {
  const selectNodes = reportRoundNodes(summary, state, round, (node) => node.select_2d);
  const mapNodes = reportRoundNodes(summary, state, round, (node) => {
    const hasClasses = (summary.class_split_jobs || []).some((item) => item.uid === node.uid && item.classes && item.classes.length);
    return hasClasses || normalMapAssets(node).length;
  });
  const preParticleSteps = reportPictureParticleSteps(summary, state, round, "挑颗粒 / 提取", selectNodes.length ? false : null);
  const postParticleSteps = selectNodes.length ? reportPictureParticleSteps(summary, state, round, "再挑颗粒 / 提取", true) : "";
  if (!preParticleSteps && !selectNodes.length && !postParticleSteps && !mapNodes.length) return "";
  const steps = [];
  if (preParticleSteps) steps.push(preParticleSteps);
  for (const node of selectNodes) steps.push(reportPictureSelect2D(node));
  if (postParticleSteps) steps.push(postParticleSteps);
  for (const node of mapNodes) {
    const html = (summary.class_split_jobs || []).some((item) => item.uid === node.uid)
      ? reportPictureClassJob(node, summary, state)
      : reportPictureNormalMap(node);
    if (html) steps.push(html);
  }
  return `<div class="pf-round"><div class="pf-round-head"><h3>Round ${round}${round > 1 ? " repicking" : ""}</h3></div>${steps.join('<div class="pf-arrow">↓</div>')}</div>`;
}

function reportPictureFlow(summary, state) {
  const rounds = Array.from(new Set((summary.nodes || [])
    .map((node) => reportLineageRound(node.uid, state))
    .filter((round) => round > 0)))
    .sort((a, b) => a - b);
  const roundHtml = rounds.map((round) => reportPictureRound(summary, state, round)).filter(Boolean).join('<div class="pf-arrow">↓</div>');
  if (!roundHtml) return "";
  return `<div class="picture-flow"><div class="picture-head"><h2>Picture Flow</h2><span>SVG 会随报告单独导出</span></div>${reportPictureMicrographs(summary)}<div class="pf-arrow">↓</div>${roundHtml}</div>`;
}

function reportJobCard(node, summary, state) {
  const kind = reportNodeCardKind(node);
  const chips = [];
  if (node.micrograph_count !== null && node.micrograph_count !== undefined) chips.push(`<span class="chip micrograph">照片: ${fmt(node.micrograph_count)}</span>`);
  if (node.particle_count !== null && node.particle_count !== undefined) chips.push(`<span class="chip particle">颗粒: ${fmt(node.particle_count)}</span>`);
  if (node.volume_count !== null && node.volume_count !== undefined) chips.push(`<span class="chip volume">volume: ${fmt(node.volume_count)}</span>`);
  const res = resolutionText(node);
  if (res) chips.push(`<span class="chip volume">resolution: ${escHtml(res)}</span>`);
  const extractParams = extractionParamText(node);
  if (extractParams) chips.push(`<span class="chip aux">${escHtml(extractParams)}</span>`);
  const main = `<div class="job-main"><div class="job-head"><h2>${escHtml(node.uid)} ${escHtml(node.job_type || "")}</h2><div class="metrics">${chips.join("")}</div></div>${reportSourceTable(node, summary, state)}${reportMediaBlock(node)}${reportClassTable(node, summary)}${reportMapDownloads(node, summary)}</div>`;
  return `<section class="job-card ${escHtml(kind)}" id="card-${escHtml(node.uid)}">${main}${reportOutgoingBox(node, summary, state)}</section>`;
}

function buildLineageHtmlV2(summary) {
  const state = reportBuildLineageState(summary);
  const cards = (summary.nodes || [])
    .slice()
    .sort((a, b) => (a.uid_num || reportJobNum(a.uid)) - (b.uid_num || reportJobNum(b.uid)))
    .map((node) => reportJobCard(node, summary, state))
    .join("");
  const css = `:root{--bg:#f6f8fb;--panel:#fff;--text:#17202e;--muted:#59687d;--line:#d6e0ec;--micro:#16a05d;--micro-bg:#e9fbef;--particle:#d99300;--particle-bg:#fff5d8;--volume:#4d64e8;--volume-bg:#edf1ff;--small-bg:#f4f7fa}*{box-sizing:border-box;font-family:"Times New Roman",Times,serif}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.35 "Times New Roman",Times,serif}a{color:#086ad8;text-decoration:none}header{position:sticky;top:0;z-index:5;background:rgba(246,248,251,.95);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}.top{min-height:58px;display:flex;align-items:center;gap:16px;padding:8px 14px}.title h1{margin:0;font-size:19px}.title p{margin:1px 0 0;color:var(--muted)}.workspace{display:grid;grid-template-columns:minmax(460px,34vw) minmax(780px,1fr);gap:10px;padding:10px;align-items:start}.pane{background:var(--panel);border:1px solid var(--line);border-radius:8px}.flow-pane{position:sticky;top:72px;max-height:calc(100vh - 82px);overflow:auto}.pane-head,.chain-head{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line)}.pane-head h2,.chain-head h2{margin:0;font-size:16px}.legend{display:flex;gap:5px;margin-left:auto}.legend span{padding:2px 7px;border-radius:999px;font-size:11px;border:1px solid}.legend .micrograph{color:#087a42;background:var(--micro-bg);border-color:#8ee6af}.legend .particle{color:#8a5a00;background:var(--particle-bg);border-color:#f0c56b}.legend .volume{color:#293faf;background:var(--volume-bg);border-color:#aebaff}.outline{padding:10px}.stage{border:1px solid #dde7f1;border-radius:8px;background:#fbfdff;padding:8px;margin-bottom:8px}.stage h3{margin:0 0 6px;font-size:12px;color:#526174}.phase{display:grid;grid-template-columns:86px minmax(0,1fr);gap:7px;align-items:start;border-top:1px solid #edf2f7;padding-top:7px;margin-top:7px}.phase:first-of-type{border-top:0;padding-top:0;margin-top:0}.phase-label{font-size:11px;font-weight:800;color:#536174;line-height:1.2;padding-top:4px}.stage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:7px}.mini-node{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:6px;align-items:start;border:2px solid #cbd7e6;border-radius:7px;background:white;padding:6px;min-height:64px;color:#142033}.mini-node.micrograph{border-color:var(--micro);background:var(--micro-bg)}.mini-node.particle{border-color:var(--particle);background:var(--particle-bg)}.mini-node.volume{border-color:var(--volume);background:var(--volume-bg)}.mini-node.small,.mini-node.other{border-color:#c9d4e2;background:var(--small-bg)}.mini-node b{font-size:15px;display:block;grid-column:1}.mini-node span{font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-column:1}.mini-node em{font-style:normal;font-size:10px;color:#46566c;display:block;grid-column:1}.mini-node p{grid-column:2;grid-row:1 / span 3;margin:0;display:grid;grid-template-columns:repeat(2,max-content);justify-content:end;align-content:start;gap:2px 3px;min-width:54px}.ref-pill{display:block;border-radius:4px;padding:1px 3px;min-width:24px;text-align:center;font-size:8px;line-height:1.15;font-style:normal;font-weight:800;border:1px solid;white-space:nowrap}.ref-pill.exposure,.ref-pill.micrograph{color:#087a42;background:#dcfce7;border-color:#86efac}.ref-pill.particle{color:#8a5a00;background:#fff3c4;border-color:#f0c56b}.ref-pill.volume{color:#293faf;background:#e8edff;border-color:#aebaff}.ref-pill.template,.ref-pill.other{color:#526174;background:#eef2f7;border-color:#cbd5e1}.stage-arrow{text-align:center;color:#8491a3;font-weight:800;font-size:18px;margin:-3px 0 5px}.picture-flow{margin:10px;border:1px solid #dde7f1;border-radius:8px;background:#fff;padding:10px}.picture-head{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #eee6d8;padding-bottom:6px;margin-bottom:8px}.picture-head h2{margin:0;font-size:15px}.picture-head span{font-size:11px;color:#6b7280}.pf-start,.pf-round,.pf-step,.pf-map-job,.pf-final{background:#fff;border:1px solid #e2e8f0;border-radius:7px;padding:8px;margin:0 0 8px}.pf-big{font-size:19px;color:#111;text-align:center}.pf-note{font-size:11px;color:#475569;line-height:1.35;text-align:center}.pf-mic-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:7px 0}.pf-mic-imgs img{width:100%;aspect-ratio:4/3;object-fit:contain;border:1px solid #d6dee9;background:#fff}.pf-arrow{text-align:center;font-size:20px;line-height:1;color:#222;margin:3px 0 7px}.pf-round-head h3{margin:0 0 7px;font-size:20px}.pf-subhead{font-size:12px;font-weight:800;text-align:center;margin:0 0 5px;color:#263447}.pf-particle-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:7px;margin-bottom:8px}.pf-particle-step{display:block;border:1px solid #e2e8f0;border-left:3px solid var(--particle);border-radius:7px;background:#fffaf0;padding:6px;color:#142033}.pf-particle-step b{display:block;font-size:13px}.pf-particle-step span{display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pf-particle-step em{display:block;font-style:normal;font-size:11px;color:#475569}.pf-step-title{font-weight:800;font-size:13px;text-align:center;margin-bottom:3px}.pf-select-img img{display:block;width:100%;max-height:170px;object-fit:contain;border:1px solid #dbe5f0;background:#fff;margin-top:6px}.pf-classes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:7px}.pf-class{margin:0;padding:5px;border:2px solid transparent;background:#fff;text-align:center;min-height:126px}.pf-class.selected{border-color:#111}.pf-class img{display:block;width:100%;height:78px;object-fit:contain;background:#fff}.pf-class figcaption{font-size:10px;color:#334155}.pf-class b{display:block;font-size:15px;color:#111}.pf-class span{display:block;font-size:10px;color:#526174}.pf-final-img img{display:block;width:180px;max-width:100%;height:150px;object-fit:contain;border:1px solid #dbe5f0;background:#fff;margin:6px auto}.chain-head .hint{color:var(--muted);margin-left:auto}.cards{padding:10px;display:grid;gap:18px}.job-card{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:10px;border:1px solid var(--line);border-left-width:4px;border-radius:7px;background:#fff;padding:10px}.job-card.micrograph{border-left-color:var(--micro)}.job-card.particle{border-left-color:var(--particle)}.job-card.volume{border-left-color:var(--volume)}.job-card.other{border-left-color:#94a3b8}.job-head{display:flex;align-items:center;gap:10px}.job-head h2{margin:0;min-width:210px;font-size:17px;line-height:1.1}.metrics{display:flex;flex-wrap:wrap;gap:5px}.chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;border:1px solid var(--line);background:#f8fbff;font-size:12px;white-space:nowrap}.chip.micrograph{background:var(--micro-bg);border-color:#8ee6af;color:#087a42}.chip.particle{background:var(--particle-bg);border-color:#f0c56b;color:#8a5a00}.chip.volume,.chip.class{background:var(--volume-bg);border-color:#aebaff;color:#293faf}.chip.aux{background:#f8fafc;border-color:#cbd5e1;color:#334155}.source-block,.media-block,.map-block{margin-top:8px;border-top:1px solid #edf2f7;padding-top:7px}h3{margin:0 0 4px;font-size:12px;color:#263447}.source-table{width:100%;border-collapse:collapse;font-size:11px}.source-table th,.source-table td{border:1px solid #e3ebf4;padding:4px 6px;vertical-align:middle}.source-table th{background:#f8fafc;color:#526174}.kind-cell{width:54px;text-align:center;font-weight:800}.kind-cell i{width:8px;height:8px;border-radius:999px;display:inline-block;margin-right:4px}.kind-cell.exposure i{background:var(--micro)}.kind-cell.particle i{background:var(--particle)}.kind-cell.volume i{background:var(--volume)}.kind-cell.template i,.kind-cell.other i{background:#8793a6}.source-table em{font-style:normal;color:#607086;margin-left:6px}.up-cell{color:#475569;line-height:1.35}.up-route{display:block;font-weight:800;color:#263447;border-bottom:2px solid #9aa8ba;margin-bottom:3px;padding-bottom:2px}.up-list{display:grid;gap:2px}.up-line{display:block}.job-out{border-left:1px solid #edf2f7;padding-left:8px;color:#334155}.job-out div{margin:0 0 5px;padding:4px 6px;background:#f8fafc;border:1px solid #e1e9f2;border-radius:6px}.quiet{color:#7b8798}.class-toolbar{margin-top:7px;display:flex;align-items:center;gap:5px}.class-toolbar span{font-weight:700;font-size:12px;color:#263447;margin-right:auto}.classes{margin-top:5px;border:1px solid #dbe5f0;border-radius:6px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:5px 6px;border-bottom:1px solid #e7edf5;text-align:left}th{background:#f8fafc}.horizontal-table th:first-child{left:0;position:sticky;z-index:2}.horizontal-table td,.horizontal-table th{min-width:74px;text-align:center}.download-head{display:flex;align-items:center;gap:8px;margin-top:6px}.download-all{border:1px solid #cbd7e6;background:#fff;color:#40516a;border-radius:6px;padding:3px 7px;font-size:11px;cursor:pointer}.download-links{margin-top:5px;display:flex;gap:5px;flex-wrap:wrap}.download-links a{padding:3px 6px;border:1px solid #b7c5ff;border-radius:6px;background:#f1f4ff;font-size:11px}.imgs{display:flex;gap:8px;flex-wrap:wrap}.imgbox{width:160px;margin:0;padding:6px;border:1px solid #dbe5f0;border-radius:6px;background:#fbfdff}.imgbox img{display:block;width:100%;height:112px;object-fit:contain;background:#fff;border:1px solid #edf2f7}.imgbox figcaption{margin-top:4px;font-size:11px;color:#536174}.class-preview,.map-preview{max-width:92px;max-height:68px;object-fit:contain;border:1px solid #dbe5f0;background:#fff}.map-table td{vertical-align:middle}@media(max-width:1180px){.workspace{grid-template-columns:1fr}.flow-pane{position:relative;top:auto}.job-card{grid-template-columns:minmax(0,1fr) 230px}}`;
  const script = `document.addEventListener("click",(event)=>{const button=event.target.closest(".download-all");if(!button)return;const urls=(button.dataset.urls||"").split("|").filter(Boolean);urls.forEach((url,index)=>setTimeout(()=>window.open(url,"_blank"),index*160));});`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>CryoSmart ${escHtml(summary.project_uid)} ${escHtml(summary.start_uid)} Lineage</title><style>${css}</style></head><body><header><div class="top"><div class="title"><h1>CryoSmart Lineage: ${escHtml(summary.project_uid)} / ${escHtml(summary.start_uid)}</h1><p>${(summary.nodes || []).length} nodes · ${(summary.edges || []).length} data links · visible main-node tracing</p></div></div></header><main class="workspace"><section class="pane flow-pane"><div class="pane-head"><h2>Lineage Outline</h2><div class="legend"><span class="micrograph">micrographs</span><span class="particle">particles</span><span class="volume">map</span></div></div><div class="outline">${reportOutline(summary, state)}</div>${reportPictureFlow(summary, state)}</section><section class="pane chain-pane"><div class="chain-head"><h2>Main Data Chain</h2><span class="hint">小节点会折叠到可见主节点；左侧标签只指向左侧已有节点。</span></div><div class="cards">${cards}</div></section></main><script>${script}</script></body></html>`;
}

const SVG_A4_WIDTH = 794;
const SVG_A4_HEIGHT = 1123;
const SVG_A4_CENTER_X = SVG_A4_WIDTH / 2;

function svgText(x, y, text, size = 13, weight = 400, anchor = "middle") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Times New Roman, Times, serif" font-size="${size}" font-weight="${weight}" fill="#172033">${escHtml(text)}</text>`;
}

function svgArrow(y1, y2, label = "") {
  const labelText = label ? svgText(SVG_A4_CENTER_X, y1 + 22, label, 12, 600) : "";
  return `<line x1="${SVG_A4_CENTER_X}" y1="${y1}" x2="${SVG_A4_CENTER_X}" y2="${y2 - 12}" stroke="#222" stroke-width="2"/><path d="M${SVG_A4_CENTER_X} ${y2} l-8 -13 h16 z" fill="#222"/>${labelText}`;
}

function svgImageHref(nodeUid, name, imageDataMap = null) {
  const key = pptImageKey(nodeUid, name);
  if (imageDataMap && imageDataMap.has(key)) return escHtml(imageDataMap.get(key));
  return escHtml(localImageFilename(nodeUid, name));
}

function svgClassGrid(node, classJob, selected, startY, imageDataMap = null) {
  let out = "";
  const classCount = classJob.classes.length;
  const cols = classCount <= 6 ? classCount : 3;
  const tileW = classCount <= 6 ? 104 : 176;
  const tileH = classCount <= 6 ? 118 : 132;
  const gapX = classCount <= 6 ? 12 : 22;
  const gapY = 20;
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  for (let i = 0; i < classJob.classes.length; i += 1) {
    const cls = classJob.classes[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = left + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const name = cls.volume_group || `class_${cls.class_index}`;
    const isSelected = selected.has(cls.class_index);
    out += `<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="0" fill="#fff" stroke="${isSelected ? "#111" : "transparent"}" stroke-width="${isSelected ? 3 : 1}"/>`;
    out += `<image href="${svgImageHref(node.uid, name, imageDataMap)}" x="${x + 12}" y="${y + 6}" width="${tileW - 24}" height="${classCount <= 6 ? 56 : 74}" preserveAspectRatio="xMidYMid meet"/>`;
    out += svgText(x + tileW / 2, y + (classCount <= 6 ? 76 : 94), `class ${cls.class_index}${isSelected ? " selected" : ""}`, 11, 500);
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${cls.particle_percent}%` : "";
    const count = cls.particle_count !== null && cls.particle_count !== undefined ? `${fmt(cls.particle_count)} particles` : "";
    out += svgText(x + tileW / 2, y + (classCount <= 6 ? 94 : 114), pct, 17, 500);
    out += svgText(x + tileW / 2, y + (classCount <= 6 ? 108 : 128), count, 10, 400);
  }
  const rows = Math.ceil(classJob.classes.length / cols);
  return { svg: out, height: rows * tileH + Math.max(0, rows - 1) * gapY };
}

function svgParticleStepBlock(summary, state, round, label, postSelect, startY) {
  const nodes = reportRoundParticleNodes(summary, state, round, postSelect);
  if (!nodes.length) return { svg: "", height: 0 };
  let out = svgText(SVG_A4_CENTER_X, startY, label, 14, 700);
  const cols = Math.min(3, nodes.length);
  const gap = 12;
  const cardW = (SVG_A4_WIDTH - 96 - Math.max(0, cols - 1) * gap) / cols;
  const cardH = 56;
  const gridW = cols * cardW + Math.max(0, cols - 1) * gap;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  const y0 = startY + 16;
  nodes.slice(0, 12).forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = left + col * (cardW + gap);
    const y = y0 + row * (cardH + 10);
    const metric = reportPictureParticleMetricText(node);
    out += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="6" fill="#fffaf0" stroke="#d99300" stroke-width="1.6"/>`;
    out += svgText(x + cardW / 2, y + 18, `${node.uid} ${node.job_type || ""}`, 11, 700);
    if (metric) out += svgText(x + cardW / 2, y + 37, metric, 10, 400);
  });
  const rows = Math.ceil(Math.min(nodes.length, 12) / cols);
  return { svg: out, height: 16 + rows * cardH + Math.max(0, rows - 1) * 10 };
}

function buildPictureFlowSvg(summary, imageDataMap = null) {
  const state = reportBuildLineageState(summary);
  const width = SVG_A4_WIDTH;
  let y = 34;
  let body = "";
  body += svgText(width / 2, y, `CryoSmart ${summary.project_uid}/${summary.start_uid} Picture Flow`, 20, 700);
  y += 28;

  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    body += svgText(width / 2, y, `${fmt(microNode.micrograph_count)} micrographs`, 20, 500);
    y += 12;
    if (pixelSizeText(microNode)) {
      body += svgText(width / 2, y, `pixel ${pixelSizeText(microNode)}`, 11, 400);
      y += 14;
    }
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 118;
    const startX = width / 2 - (imgs.length * imgW + Math.max(0, imgs.length - 1) * 12) / 2;
    for (let i = 0; i < imgs.length; i += 1) {
      body += `<image href="${svgImageHref(microNode.uid, imgs[i].local_name || imgs[i].name || "image", imageDataMap)}" x="${startX + i * (imgW + 12)}" y="${y}" width="${imgW}" height="${imgW}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    y += imgs.length ? imgW + 24 : 20;
    body += svgText(width / 2, y, `${microNode.uid} ${microNode.job_type}`, 12, 500);
    y += 18;
  }

  const rounds = Array.from(new Set((summary.nodes || [])
    .map((node) => reportLineageRound(node.uid, state))
    .filter((round) => round > 0)))
    .sort((a, b) => a - b);

  for (const round of rounds) {
    body += svgArrow(y, y + 46, round > 1 ? `Round ${round} repicking` : `Round ${round}`);
    y += 70;
    body += svgText(width / 2, y, `Round ${round}${round > 1 ? " repicking" : ""}`, 21, 600);
    y += 24;

    const selectNodes = reportRoundNodes(summary, state, round, (node) => node.select_2d);
    const preParticleBlock = svgParticleStepBlock(summary, state, round, "Picking / extraction", selectNodes.length ? false : null, y);
    if (preParticleBlock.svg) {
      body += preParticleBlock.svg;
      y += preParticleBlock.height + 18;
      body += svgArrow(y, y + 42, "");
      y += 62;
    }
    for (const node of selectNodes) {
      const s = node.select_2d;
      const input = node.particle_count || s.particles_selected || null;
      const selected = s.particles_selected;
      const ratio = Number.isInteger(input) && Number.isInteger(selected) && input ? `${Math.round(selected / input * 1000) / 10}%` : "";
      body += svgText(width / 2, y, `${node.uid} select_2D`, 15, 700);
      y += 18;
      body += svgText(width / 2, y, `input ${input ? fmt(input) : "?"} particles; selected ${s.classes_selected ?? "?"} classes; output ${selected ? fmt(selected) : "?"}${ratio ? ` (${ratio})` : ""}`, 12, 400);
      y += 10;
      if (s.selected_classes_image) {
        body += `<image href="${svgImageHref(node.uid, "selected_classes", imageDataMap)}" x="${(width - 360) / 2}" y="${y}" width="360" height="150" preserveAspectRatio="xMidYMid meet"/>`;
        y += 166;
      } else {
        y += 12;
      }
      body += svgArrow(y, y + 42, "");
      y += 62;
    }

    const postParticleBlock = selectNodes.length ? svgParticleStepBlock(summary, state, round, "Repicking / extraction", true, y) : { svg: "", height: 0 };
    if (postParticleBlock.svg) {
      body += postParticleBlock.svg;
      y += postParticleBlock.height + 18;
      body += svgArrow(y, y + 42, "");
      y += 62;
    }

    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some((item) => item.uid === node.uid && item.classes && item.classes.length);
      return hasClasses || normalMapAssets(node).length;
    });
    for (let i = 0; i < mapNodes.length; i += 1) {
      const node = mapNodes[i];
      const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
      body += svgText(width / 2, y, `${node.uid} ${node.job_type}`, 16, 700);
      y += 20;
      if (classJob) {
        const selected = reportSelectedClassIndices(node.uid, summary, state);
        const total = classJob.classes.find((item) => Number.isInteger(item.total_particles))?.total_particles || node.particle_count;
        body += svgText(width / 2, y, `input ${total ? fmt(total) : "?"} particles${selected.size ? `; selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}` : ""}`, 12, 400);
      y += 14;
      const grid = svgClassGrid(node, classJob, selected, y, imageDataMap);
      body += grid.svg;
      y += grid.height + 22;
    } else {
      const item = normalMapAssets(node).find((map) => map.preview_url) || normalMapAssets(node)[0];
      if (item && item.preview_url) {
          body += `<image href="${svgImageHref(node.uid, mapPreviewImageName(item.group), imageDataMap)}" x="${(width - 170) / 2}" y="${y}" width="170" height="150" preserveAspectRatio="xMidYMid meet"/>`;
          y += 162;
        }
        if (node.particle_count !== null && node.particle_count !== undefined) {
          body += svgText(width / 2, y, `${fmt(node.particle_count)} particles`, 18, 500);
          y += 22;
        }
      }
      if (i < mapNodes.length - 1) {
        body += svgArrow(y, y + 42, "");
        y += 62;
      }
    }
  }

  const contentHeight = y + 28;
  const margin = 22;
  const scale = Math.min(1, (SVG_A4_HEIGHT - margin * 2) / contentHeight);
  const xOffset = (SVG_A4_WIDTH - SVG_A4_WIDTH * scale) / 2;
  const yOffset = scale < 1 ? margin : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${SVG_A4_WIDTH} ${SVG_A4_HEIGHT}"><rect width="100%" height="100%" fill="#fff"/><g transform="translate(${xOffset} ${yOffset}) scale(${scale})">${body}</g></svg>`;
}

const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPT_EMU = 914400;
const PPT_W = 8.27;
const PPT_H = 11.69;
const PPT_MARGIN = 0.34;
const PPT_PAPER_FONT_SIZE = 6;
const PPT_TWO_COLUMN_RATIO = 1.12;
const PPT_COLORS = {
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
  white: "FFFFFF"
};

function pptXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pptEmu(value) {
  return Math.round(value * PPT_EMU);
}

function pptFontSize(value) {
  return Math.max(100, Math.round(value * 100));
}

function pptColor(value) {
  return String(value || PPT_COLORS.text).replace(/^#/, "").toUpperCase();
}

function pptFillXml(fill) {
  return fill ? `<a:solidFill><a:srgbClr val="${pptColor(fill)}"/></a:solidFill>` : "<a:noFill/>";
}

function pptLineXml(line, width = 1) {
  return line
    ? `<a:ln w="${Math.round(width * 12700)}"><a:solidFill><a:srgbClr val="${pptColor(line)}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
}

function pptKindStyle(kind) {
  if (kind === "micrograph") return { fill: PPT_COLORS.microFill, line: PPT_COLORS.microLine };
  if (kind === "particle") return { fill: PPT_COLORS.particleFill, line: PPT_COLORS.particleLine };
  if (kind === "volume") return { fill: PPT_COLORS.volumeFill, line: PPT_COLORS.volumeLine };
  return { fill: PPT_COLORS.otherFill, line: PPT_COLORS.otherLine };
}

function pptNewSlide(title = "") {
  return { title, items: [] };
}

function pptAddShape(slide, x, y, w, h, options = {}) {
  slide.items.push({ type: "shape", x, y, w, h, ...options });
}

function pptAddText(slide, x, y, w, h, text, options = {}) {
  pptAddShape(slide, x, y, w, h, { ...options, text, fill: options.fill || null, line: options.line || null });
}

function pptAddImage(slide, key, x, y, w, h, options = {}) {
  if (!key) return;
  slide.items.push({ type: "image", key, x, y, w, h, ...options });
}

function pptAddHeader(slide, title, subtitle = "") {
  pptAddText(slide, PPT_MARGIN, 0.22, PPT_W - PPT_MARGIN * 2, 0.34, title, {
    fontSize: 20,
    bold: true,
    align: "center"
  });
  if (subtitle) {
    pptAddText(slide, PPT_MARGIN, 0.56, PPT_W - PPT_MARGIN * 2, 0.22, subtitle, {
      fontSize: 10.5,
      color: PPT_COLORS.muted,
      align: "center"
    });
  }
}

function pptNodeLabel(node, compact = false) {
  const metric = reportMetricText(node, true);
  if (compact) return `${node.uid}\n${node.job_type || ""}${metric ? `\n${metric}` : ""}`;
  return `${node.uid} ${node.job_type || ""}${metric ? `\n${metric}` : ""}`;
}

function pptAddNodeCard(slide, node, x, y, w, h, options = {}) {
  const kind = reportNodeCardKind(node);
  const style = pptKindStyle(kind);
  pptAddShape(slide, x, y, w, h, {
    fill: style.fill,
    line: style.line,
    lineWidth: options.lineWidth || 1.7,
    text: pptNodeLabel(node, true),
    fontSize: options.fontSize || 9.5,
    bold: true,
    align: "left",
    valign: "mid"
  });
}

function pptAddMetricCard(slide, x, y, w, h, title, lines, kind = "other") {
  const style = pptKindStyle(kind);
  pptAddShape(slide, x, y, w, h, {
    fill: style.fill,
    line: style.line,
    lineWidth: 1.2,
    text: [title, ...(lines || [])].filter(Boolean).join("\n"),
    fontSize: 10,
    bold: true,
    align: "left",
    valign: "mid"
  });
}

function pptImageKey(nodeUid, name) {
  return `${safePart(nodeUid)}/${safePart(name)}`;
}

function pptAddImageRequest(map, nodeUid, name, url, fallbackUrls = []) {
  const urls = dedupeUrls([url, ...fallbackUrls]);
  if (!urls.length) return;
  const key = pptImageKey(nodeUid, name);
  if (!map.has(key)) map.set(key, { key, url: urls[0], urls });
}

function collectPptImageRequests(summary) {
  const requests = new Map();
  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    for (const image of (microNode.representative_micrograph_images || []).slice(0, 3)) {
      pptAddImageRequest(requests, microNode.uid, image.local_name || image.name || "image", image.original_url || image.src || image.url, [image.src, image.url]);
    }
  }
  for (const node of summary.nodes || []) {
    if (node.select_2d) {
      const s = node.select_2d;
      pptAddImageRequest(requests, node.uid, "selected_classes", s.selected_classes_original_url || s.selected_classes_src || s.selected_classes_image, [s.selected_classes_src, s.selected_classes_image]);
    }
    for (const cls of node.classes || []) {
      pptAddImageRequest(requests, node.uid, cls.volume_group || `class_${cls.class_index}`, cls.mrc_preview_original_url || cls.mrc_preview_src || cls.mrc_preview_url, [cls.mrc_preview_src, cls.mrc_preview_url]);
    }
    for (const item of normalMapAssets(node)) {
      pptAddImageRequest(requests, node.uid, mapPreviewImageName(item.group), item.preview_original_url || item.preview_src || item.preview_url, [item.preview_src, item.preview_url]);
    }
  }
  return Array.from(requests.values());
}

function bytesFromDataUri(uri) {
  const match = String(uri || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

function sniffImageMime(bytes, fallback = "image/png") {
  if (bytes && bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes && bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return fallback || "image/png";
}

function imageExtFromMime(mime) {
  const value = String(mime || "").toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("gif")) return "gif";
  if (value.includes("svg")) return "svg";
  return "png";
}

async function imageDimensionsFromBlob(blob) {
  if (!blob || typeof createImageBitmap !== "function") return { width: 1, height: 1 };
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width || 1, height: bitmap.height || 1 };
    if (bitmap.close) bitmap.close();
    return dims;
  } catch (err) {
    return { width: 1, height: 1 };
  }
}

async function fetchPptImage(request) {
  const urls = dedupeUrls([...(request.urls || []), request.url]);
  for (const candidateUrl of urls) {
    try {
      const dataUri = bytesFromDataUri(candidateUrl);
      if (dataUri) {
        const blob = new Blob([dataUri.bytes], { type: dataUri.mime });
        const dims = await imageDimensionsFromBlob(blob);
        return {
          key: request.key,
          bytes: dataUri.bytes,
          mime: dataUri.mime,
          ext: imageExtFromMime(dataUri.mime),
          width: dims.width,
          height: dims.height
        };
      }
      const response = await fetch(candidateUrl, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = sniffImageMime(bytes, blob.type || response.headers.get("content-type") || "image/png");
      if (!/^image\//i.test(mime)) continue;
      const dims = await imageDimensionsFromBlob(new Blob([bytes], { type: mime }));
      return {
        key: request.key,
        bytes,
        mime,
        ext: imageExtFromMime(mime),
        width: dims.width,
        height: dims.height
      };
    } catch (err) {
      try {
        const asset = await fetchAssetFromCurrentPage(candidateUrl);
        const parsed = bytesFromDataUri(asset.data_url);
        if (!parsed) continue;
        const mime = sniffImageMime(parsed.bytes, parsed.mime || asset.content_type || "image/png");
        if (!/^image\//i.test(mime)) continue;
        const blob = new Blob([parsed.bytes], { type: mime });
        const dims = await imageDimensionsFromBlob(blob);
        return {
          key: request.key,
          bytes: parsed.bytes,
          mime,
          ext: imageExtFromMime(mime),
          width: dims.width,
          height: dims.height
        };
      } catch (innerErr) {
        // Try the next URL candidate for the same image.
      }
    }
  }
  return null;
}

async function fetchPptImages(summary) {
  const images = new Map();
  for (const request of collectPptImageRequests(summary)) {
    const image = await fetchPptImage(request);
    if (image) images.set(request.key, image);
  }
  return images;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pptImageDataUriMap(images) {
  const map = new Map();
  for (const [key, image] of images.entries()) {
    map.set(key, `data:${image.mime};base64,${bytesToBase64(image.bytes)}`);
  }
  return map;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("SVG 图片渲染失败"));
    image.src = src;
  });
}

async function renderSvgToPngImage(svgTextValue) {
  const scale = 2;
  const blob = new Blob([svgTextValue], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    const canvas = document.createElement("canvas");
    canvas.width = SVG_A4_WIDTH * scale;
    canvas.height = SVG_A4_HEIGHT * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!outBlob) throw new Error("无法生成 PPT 图片。");
    const bytes = new Uint8Array(await outBlob.arrayBuffer());
    return {
      key: "picture_flow_a4",
      bytes,
      mime: "image/png",
      ext: "png",
      width: canvas.width,
      height: canvas.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pptAlign(value) {
  return {
    left: "l",
    center: "ctr",
    right: "r",
    l: "l",
    ctr: "ctr",
    r: "r"
  }[value] || "l";
}

function pptTextXml(text, options = {}) {
  const lines = String(text ?? "").split(/\n/);
  const align = pptAlign(options.align || "left");
  const size = pptFontSize(options.fontSize || 12);
  const color = pptColor(options.color || PPT_COLORS.text);
  const bold = options.bold ? ' b="1"' : "";
  const paragraphs = lines.map((line) => (
    `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${size}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Times New Roman"/><a:cs typeface="Times New Roman"/></a:rPr><a:t>${pptXml(line)}</a:t></a:r></a:p>`
  )).join("");
  return `<p:txBody><a:bodyPr wrap="square" anchor="${options.valign || "mid"}" lIns="45720" rIns="45720" tIns="22860" bIns="22860"/><a:lstStyle/>${paragraphs}</p:txBody>`;
}

function pptShapeXml(id, item) {
  const fill = pptFillXml(item.fill);
  const line = pptLineXml(item.line, item.lineWidth || 1);
  const text = item.text !== undefined ? pptTextXml(item.text, item) : "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${pptEmu(item.x)}" y="${pptEmu(item.y)}"/><a:ext cx="${pptEmu(item.w)}" cy="${pptEmu(item.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>${text}</p:sp>`;
}

function pptContainBox(image, x, y, w, h) {
  const iw = image && image.width ? image.width : 1;
  const ih = image && image.height ? image.height : 1;
  const ratio = iw / ih;
  const boxRatio = w / h;
  if (ratio > boxRatio) {
    const fitH = w / ratio;
    return { x, y: y + (h - fitH) / 2, w, h: fitH };
  }
  const fitW = h * ratio;
  return { x: x + (w - fitW) / 2, y, w: fitW, h };
}

function pptImageXml(id, item, relId, image) {
  const box = item.fit === "cover" ? item : pptContainBox(image, item.x, item.y, item.w, item.h);
  const name = `CryoSmartImage:${item.key || `Image ${id}`}`;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${pptXml(name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${pptEmu(box.x)}" y="${pptEmu(box.y)}"/><a:ext cx="${pptEmu(box.w)}" cy="${pptEmu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function pptSlideXml(slide, imageRelIds, images) {
  let id = 2;
  const items = slide.items.map((item) => {
    const currentId = id;
    id += 1;
    if (item.type === "image") {
      const relId = imageRelIds.get(item.key);
      const image = images.get(item.key);
      if (!relId || !image) return "";
      return pptImageXml(currentId, item, relId, image);
    }
    return pptShapeXml(currentId, item);
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${pptFillXml(PPT_COLORS.white)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${items}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function pptSlideRelsXml(slideImageRels) {
  const imageRels = slideImageRels.map((rel) => (
    `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${pptXml(rel.mediaName)}"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imageRels}</Relationships>`;
}

function pptAddImageFrame(slide, key, x, y, w, h, label = "") {
  pptAddShape(slide, x, y, w, h, { fill: PPT_COLORS.white, line: PPT_COLORS.line, lineWidth: 0.8 });
  pptAddImage(slide, key, x + 0.03, y + 0.03, w - 0.06, h - 0.2);
  if (label) {
    pptAddText(slide, x, y + h - 0.17, w, 0.15, label, { fontSize: 7.5, color: PPT_COLORS.muted, align: "center" });
  }
}

function buildPptOverviewSlide(summary, state) {
  const slide = pptNewSlide("Overview");
  pptAddHeader(slide, `CryoSmart ${summary.project_uid}/${summary.start_uid}`, `${(summary.nodes || []).length} nodes · Picture Flow`);
  const microNode = reportFirstMicrographNode(summary);
  let y = 0.95;
  if (microNode) {
    pptAddText(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.28, `${fmt(microNode.micrograph_count)} micrographs${pixelSizeText(microNode) ? ` · ${pixelSizeText(microNode)}` : ""}`, { fontSize: 18, bold: true, align: "center" });
    y += 0.38;
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 1.75;
    const gap = 0.16;
    const startX = (PPT_W - imgs.length * imgW - Math.max(0, imgs.length - 1) * gap) / 2;
    imgs.forEach((image, index) => {
      pptAddImageFrame(slide, pptImageKey(microNode.uid, image.local_name || image.name || "image"), startX + index * (imgW + gap), y, imgW, imgW, image.name || "");
    });
    y += imgs.length ? imgW + 0.42 : 0.34;
    pptAddText(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.22, `${microNode.uid} ${microNode.job_type || ""}`, { fontSize: 10.5, color: PPT_COLORS.muted, align: "center" });
    y += 0.42;
  }
  const rounds = Array.from(new Set((summary.nodes || [])
    .map((node) => reportLineageRound(node.uid, state))
    .filter((round) => round > 0)))
    .sort((a, b) => a - b);
  const cardW = (PPT_W - PPT_MARGIN * 2 - 0.18) / 2;
  rounds.forEach((round, index) => {
    const x = PPT_MARGIN + (index % 2) * (cardW + 0.18);
    const row = Math.floor(index / 2);
    const roundNodes = reportRoundNodes(summary, state, round, () => true);
    const particles = roundNodes.find((node) => node.particle_count !== null && node.particle_count !== undefined)?.particle_count;
    const maps = roundNodes.filter((node) => normalMapAssets(node).length || (summary.class_split_jobs || []).some((item) => item.uid === node.uid)).length;
    pptAddMetricCard(slide, x, y + row * 0.82, cardW, 0.66, `Round ${round}${round > 1 ? " repicking" : ""}`, [
      `${roundNodes.length} jobs`,
      particles ? `${fmt(particles)} particles` : "",
      maps ? `${maps} map/refine jobs` : ""
    ].filter(Boolean), round > 1 ? "particle" : "volume");
  });
  return slide;
}

function buildPptRoundSlide(summary, state, round) {
  const slide = pptNewSlide(`Round ${round}`);
  pptAddHeader(slide, `Round ${round}${round > 1 ? " repicking" : ""}`, "Picking / extraction, 2D selection and inputs");
  let y = 0.92;
  const selectNodes = reportRoundNodes(summary, state, round, (node) => node.select_2d);
  const addParticleSection = (nodes, title) => {
    if (!nodes.length) return;
    pptAddText(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.22, title, { fontSize: 13, bold: true });
    y += 0.3;
    const cols = 2;
    const gap = 0.14;
    const cardW = (PPT_W - PPT_MARGIN * 2 - gap) / cols;
    const cardH = 0.62;
    nodes.slice(0, 10).forEach((node, index) => {
      const x = PPT_MARGIN + (index % cols) * (cardW + gap);
      const yy = y + Math.floor(index / cols) * (cardH + 0.1);
      pptAddNodeCard(slide, node, x, yy, cardW, cardH, { fontSize: 8.8 });
    });
    y += Math.ceil(Math.min(nodes.length, 10) / cols) * (cardH + 0.1) + 0.16;
  };
  const preParticleNodes = reportRoundParticleNodes(summary, state, round, selectNodes.length ? false : null);
  const postParticleNodes = selectNodes.length ? reportRoundParticleNodes(summary, state, round, true) : [];
  addParticleSection(preParticleNodes, "Picking / extraction");
  for (const node of selectNodes.slice(0, 2)) {
    const s = node.select_2d;
    const input = node.particle_count || s.particles_selected || null;
    const selected = s.particles_selected;
    const ratio = Number.isInteger(input) && Number.isInteger(selected) && input ? `${Math.round(selected / input * 1000) / 10}%` : "";
    pptAddMetricCard(slide, PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 0.58, `${node.uid} select_2D`, [
      `input ${input ? fmt(input) : "?"} particles`,
      `selected ${s.classes_selected ?? "?"} classes; output ${selected ? fmt(selected) : "?"}${ratio ? ` (${ratio})` : ""}`
    ], "particle");
    y += 0.72;
    if (s.selected_classes_image) {
      pptAddImageFrame(slide, pptImageKey(node.uid, "selected_classes"), PPT_MARGIN, y, PPT_W - PPT_MARGIN * 2, 2.0, "templates_selected");
      y += 2.16;
    }
  }
  addParticleSection(postParticleNodes, "Repicking / extraction");
  if (!preParticleNodes.length && !selectNodes.length && !postParticleNodes.length) {
    pptAddText(slide, PPT_MARGIN, 1.2, PPT_W - PPT_MARGIN * 2, 0.5, "No particle/2D summary for this round.", { fontSize: 16, color: PPT_COLORS.muted, align: "center" });
  }
  return slide;
}

function buildPptClassSlide(summary, state, node) {
  const slide = pptNewSlide(`${node.uid} ${node.job_type || ""}`);
  const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
  const selected = reportSelectedClassIndices(node.uid, summary, state);
  const metric = reportMetricText(node, true);
  pptAddHeader(slide, `${node.uid} ${node.job_type || ""}`, metric);
  if (!classJob || !classJob.classes || !classJob.classes.length) return slide;
  const total = classJob.classes.find((item) => Number.isInteger(item.total_particles))?.total_particles || node.particle_count;
  pptAddText(slide, PPT_MARGIN, 0.86, PPT_W - PPT_MARGIN * 2, 0.22, `input ${total ? fmt(total) : "?"} particles${selected.size ? ` · selected class ${Array.from(selected).sort((a, b) => a - b).join(", ")}` : ""}`, {
    fontSize: 10.5,
    color: PPT_COLORS.muted,
    align: "center"
  });
  const count = classJob.classes.length;
  const cols = count <= 6 ? count : 3;
  const gapX = 0.12;
  const gapY = 0.15;
  const tileW = (PPT_W - PPT_MARGIN * 2 - Math.max(0, cols - 1) * gapX) / cols;
  const rows = Math.ceil(count / cols);
  const tileH = Math.min(1.65, (PPT_H - 1.35 - 0.35 - Math.max(0, rows - 1) * gapY) / rows);
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const startX = (PPT_W - gridW) / 2;
  const startY = 1.22;
  classJob.classes.forEach((cls, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const isSelected = selected.has(cls.class_index);
    pptAddShape(slide, x, y, tileW, tileH, {
      fill: PPT_COLORS.white,
      line: isSelected ? "111111" : PPT_COLORS.line,
      lineWidth: isSelected ? 2.2 : 0.7
    });
    pptAddImage(slide, pptImageKey(node.uid, cls.volume_group || `class_${cls.class_index}`), x + 0.06, y + 0.06, tileW - 0.12, tileH - 0.56);
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${cls.particle_percent}%` : "";
    const particles = cls.particle_count !== null && cls.particle_count !== undefined ? fmt(cls.particle_count) : "";
    pptAddText(slide, x + 0.04, y + tileH - 0.45, tileW - 0.08, 0.16, `class ${cls.class_index}${isSelected ? " selected" : ""}`, { fontSize: 7.5, bold: true, align: "center" });
    pptAddText(slide, x + 0.04, y + tileH - 0.27, tileW - 0.08, 0.17, pct, { fontSize: 11, bold: true, align: "center" });
    pptAddText(slide, x + 0.04, y + tileH - 0.11, tileW - 0.08, 0.11, particles, { fontSize: 6.8, color: PPT_COLORS.muted, align: "center" });
  });
  return slide;
}

function buildPptMapSlide(node) {
  const slide = pptNewSlide(`${node.uid} ${node.job_type || ""}`);
  const maps = normalMapAssets(node);
  const item = maps.find((map) => map.preview_url) || maps[0];
  pptAddHeader(slide, `${node.uid} ${node.job_type || ""}`, reportMetricText(node, true));
  if (item && item.preview_url) {
    pptAddImageFrame(slide, pptImageKey(node.uid, mapPreviewImageName(item.group)), 1.8, 1.2, 4.65, 4.0, `${item.group} preview`);
  }
  if (node.particle_count !== null && node.particle_count !== undefined) {
    pptAddText(slide, PPT_MARGIN, 5.55, PPT_W - PPT_MARGIN * 2, 0.32, `${fmt(node.particle_count)} particles`, { fontSize: 18, bold: true, align: "center" });
  }
  return slide;
}

function pptLogicalScale(contentHeight, ops = []) {
  const margin = 22;
  if (contentHeight / SVG_A4_HEIGHT > PPT_TWO_COLUMN_RATIO) {
    const gutter = 34;
    const target = contentHeight / 2;
    const candidates = ops
      .filter((op) => op.type === "break" && op.y > SVG_A4_HEIGHT * 0.28 && op.y < contentHeight - SVG_A4_HEIGHT * 0.18)
      .map((op) => op.y);
    const splitY = candidates.length
      ? candidates.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best), candidates[0])
      : target;
    const columnWidth = (SVG_A4_WIDTH - gutter) / 2;
    const columnHeight = Math.max(splitY, contentHeight - splitY);
    return {
      mode: "columns",
      splitY,
      scaleX: columnWidth / SVG_A4_WIDTH,
      scaleY: Math.min(1, (SVG_A4_HEIGHT - margin * 2) / Math.max(columnHeight, 1)),
      yOffset: margin,
      leftX: 0,
      rightX: columnWidth + gutter
    };
  }
  const scale = Math.min(1, (SVG_A4_HEIGHT - margin * 2) / Math.max(contentHeight, 1));
  return {
    mode: "single",
    scale,
    scaleX: scale,
    scaleY: scale,
    xOffset: 0,
    yOffset: Math.min(22, Math.max(0, (SVG_A4_HEIGHT - Math.min(contentHeight, SVG_A4_HEIGHT)) / 2))
  };
}

function pptLogicalBox(op, scaleInfo) {
  const secondColumn = scaleInfo.mode === "columns" && op.y >= scaleInfo.splitY;
  const baseX = scaleInfo.mode === "columns"
    ? (secondColumn ? scaleInfo.rightX : scaleInfo.leftX)
    : scaleInfo.xOffset;
  const localY = secondColumn ? op.y - scaleInfo.splitY : op.y;
  return {
    x: (baseX + op.x * scaleInfo.scaleX) / SVG_A4_WIDTH * PPT_W,
    y: (scaleInfo.yOffset + localY * scaleInfo.scaleY) / SVG_A4_HEIGHT * PPT_H,
    w: op.w * scaleInfo.scaleX / SVG_A4_WIDTH * PPT_W,
    h: op.h * scaleInfo.scaleY / SVG_A4_HEIGHT * PPT_H
  };
}

function pptLogicalX(value, scaleInfo) {
  return (scaleInfo.xOffset + value * scaleInfo.scaleX) / SVG_A4_WIDTH * PPT_W;
}

function pptLogicalY(value, scaleInfo) {
  return (scaleInfo.yOffset + value * scaleInfo.scaleY) / SVG_A4_HEIGHT * PPT_H;
}

function pptLogicalW(value, scaleInfo) {
  return value * scaleInfo.scaleX / SVG_A4_WIDTH * PPT_W;
}

function pptLogicalH(value, scaleInfo) {
  return value * scaleInfo.scaleY / SVG_A4_HEIGHT * PPT_H;
}

function pptLogicalFont(value, scaleInfo) {
  return PPT_PAPER_FONT_SIZE;
}

function pptLogicalText(ops, x, y, w, h, text, options = {}) {
  ops.push({ type: "text", x, y, w, h, text, ...options });
}

function pptLogicalShape(ops, x, y, w, h, options = {}) {
  ops.push({ type: "shape", x, y, w, h, ...options });
}

function pptLogicalImage(ops, key, x, y, w, h, options = {}) {
  ops.push({ type: "image", key, x, y, w, h, ...options });
}

function pptLogicalArrow(ops, y, label = "") {
  pptLogicalText(ops, SVG_A4_CENTER_X - 20, y, 40, 22, "↓", { fontSize: 9, fixedFontSize: 9, bold: true, align: "center", color: "111111" });
  if (label) {
    pptLogicalText(ops, SVG_A4_CENTER_X - 120, y + 21, 240, 16, label, { fontSize: PPT_PAPER_FONT_SIZE, bold: true, align: "center", color: "111111" });
    ops.push({ type: "break", y: y + 40 });
    return 40;
  }
  ops.push({ type: "break", y: y + 28 });
  return 28;
}

function pptLogicalImageFrame(ops, key, x, y, w, h, label = "", fit = "contain") {
  pptLogicalImage(ops, key, x, y, w, h, { fit });
}

function pptLogicalNodeCard(ops, node, x, y, w, h) {
  const metric = reportPictureParticleMetricText(node) || reportMetricText(node, true);
  pptLogicalText(ops, x, y, w, h, `${node.job_type || ""}${metric ? `\n${metric}` : ""}`, {
    fontSize: PPT_PAPER_FONT_SIZE,
    bold: true,
    align: "center",
    color: "111111"
  });
}

function pptLogicalClassGrid(ops, node, classJob, selected, startY) {
  const classCount = classJob.classes.length;
  const cols = classCount <= 6 ? classCount : 4;
  const tileW = classCount <= 6 ? 104 : 84;
  const tileH = classCount <= 6 ? 112 : 96;
  const gapX = classCount <= 6 ? 12 : 14;
  const gapY = 15;
  const gridW = cols * tileW + Math.max(0, cols - 1) * gapX;
  const left = (SVG_A4_WIDTH - gridW) / 2;
  classJob.classes.forEach((cls, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = left + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);
    const name = cls.volume_group || `class_${cls.class_index}`;
    const isSelected = selected.has(cls.class_index);
    if (isSelected) {
      pptLogicalShape(ops, x, y, tileW, tileH, {
        fill: null,
        line: "111111",
        lineWidth: 1.1
      });
    }
    pptLogicalImage(ops, pptImageKey(node.uid, name), x + 9, y + 6, tileW - 18, classCount <= 6 ? 52 : 45);
    const pct = cls.particle_percent !== null && cls.particle_percent !== undefined ? `${cls.particle_percent}%` : "";
    const count = cls.particle_count !== null && cls.particle_count !== undefined ? fmt(cls.particle_count) : "";
    pptLogicalText(ops, x + 4, y + (classCount <= 6 ? 66 : 58), tileW - 8, 12, pct, {
      fontSize: PPT_PAPER_FONT_SIZE,
      bold: true,
      align: "center",
      color: "111111"
    });
    pptLogicalText(ops, x + 4, y + (classCount <= 6 ? 82 : 74), tileW - 8, 10, count, {
      fontSize: PPT_PAPER_FONT_SIZE,
      color: "111111",
      align: "center"
    });
  });
  const rows = Math.ceil(classJob.classes.length / cols);
  return rows * tileH + Math.max(0, rows - 1) * gapY;
}

function buildPictureFlowPptObjectOps(summary, state) {
  const ops = [];
  let y = 28;
  pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 25, "CryoSmart Picture Flow", {
    fontSize: 20,
    bold: true,
    align: "center"
  });
  y += 34;

  const microNode = reportFirstMicrographNode(summary);
  if (microNode) {
    pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 24, `${fmt(microNode.micrograph_count)} micrographs${pixelSizeText(microNode) ? ` · ${pixelSizeText(microNode)}` : ""}`, {
      fontSize: 18,
      align: "center"
    });
    y += 28;
    const imgs = (microNode.representative_micrograph_images || []).slice(0, 3);
    const imgW = 112;
    const gap = 14;
    const startX = SVG_A4_CENTER_X - (imgs.length * imgW + Math.max(0, imgs.length - 1) * gap) / 2;
    imgs.forEach((img, index) => {
      pptLogicalImageFrame(ops, pptImageKey(microNode.uid, img.local_name || img.name || "image"), startX + index * (imgW + gap), y, imgW, imgW, "", "contain");
    });
    y += imgs.length ? imgW + 18 : 16;
  }

  const rounds = Array.from(new Set((summary.nodes || [])
    .map((node) => reportLineageRound(node.uid, state))
    .filter((round) => round > 0)))
    .sort((a, b) => a - b);

  for (const round of rounds) {
    y += pptLogicalArrow(ops, y, round > 1 ? `Round ${round} repicking` : `Round ${round}`);
    pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 24, `Round ${round}${round > 1 ? " repicking" : ""}`, {
      fontSize: 20,
      bold: true,
      align: "center"
    });
    y += 30;

    const selectNodes = reportRoundNodes(summary, state, round, (node) => node.select_2d);
    const addParticleOps = (nodes, title) => {
      if (!nodes.length) return false;
      pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 14, title, {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111"
      });
      y += 18;
      const cols = Math.min(3, nodes.length);
      const gap = 9;
      const cardW = (SVG_A4_WIDTH - 80 - Math.max(0, cols - 1) * gap) / cols;
      const cardH = 48;
      const startX = 40;
      nodes.slice(0, 9).forEach((node, index) => {
        const x = startX + (index % cols) * (cardW + gap);
        const yy = y + Math.floor(index / cols) * (cardH + 8);
        pptLogicalNodeCard(ops, node, x, yy, cardW, cardH);
      });
      y += Math.ceil(Math.min(nodes.length, 9) / cols) * (cardH + 8) + 12;
      return true;
    };

    const hasPreParticleOps = addParticleOps(reportRoundParticleNodes(summary, state, round, selectNodes.length ? false : null), "Picking / extraction");
    if (hasPreParticleOps) y += pptLogicalArrow(ops, y);
    for (const node of selectNodes) {
      const s = node.select_2d;
      const input = node.particle_count || s.particles_selected || null;
      const selected = s.particles_selected;
      const ratio = Number.isInteger(input) && Number.isInteger(selected) && input
        ? `${Math.round(selected / input * 1000) / 10}%`
        : "";
      pptLogicalText(ops, 50, y + 8, SVG_A4_WIDTH - 100, 16, "select_2D", {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111"
      });
      pptLogicalText(ops, 50, y + 24, SVG_A4_WIDTH - 100, 12, `${s.classes_selected ?? "?"} classes · ${selected ? fmt(selected) : "?"} particles${ratio ? ` · ${ratio}` : ""}`, {
        fontSize: PPT_PAPER_FONT_SIZE,
        align: "center",
        color: "111111"
      });
      if (s.selected_classes_image) {
        pptLogicalImage(ops, pptImageKey(node.uid, "selected_classes"), 122, y + 42, 550, 96);
      }
      y += s.selected_classes_image ? 160 : 58;
      y += pptLogicalArrow(ops, y);
    }

    if (selectNodes.length) {
      const hasPostParticleOps = addParticleOps(reportRoundParticleNodes(summary, state, round, true), "Repicking / extraction");
      if (hasPostParticleOps) y += pptLogicalArrow(ops, y);
    }

    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some((item) => item.uid === node.uid && item.classes && item.classes.length);
      return hasClasses || normalMapAssets(node).length;
    });
    for (let index = 0; index < mapNodes.length; index += 1) {
      const node = mapNodes[index];
      const classJob = (summary.class_split_jobs || []).find((item) => item.uid === node.uid);
      pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 18, `${node.job_type || ""}`, {
        fontSize: PPT_PAPER_FONT_SIZE,
        bold: true,
        align: "center",
        color: "111111"
      });
      y += 20;
      if (classJob) {
        const selected = reportSelectedClassIndices(node.uid, summary, state);
        y += pptLogicalClassGrid(ops, node, classJob, selected, y) + 18;
      } else {
        const item = normalMapAssets(node).find((map) => map.preview_url) || normalMapAssets(node)[0];
        if (item && item.preview_url) {
          pptLogicalImageFrame(ops, pptImageKey(node.uid, mapPreviewImageName(item.group)), SVG_A4_CENTER_X - 78, y, 156, 126, "");
          y += 140;
        }
        if (node.particle_count !== null && node.particle_count !== undefined) {
          pptLogicalText(ops, 40, y, SVG_A4_WIDTH - 80, 20, `${fmt(node.particle_count)} particles`, {
            fontSize: PPT_PAPER_FONT_SIZE,
            align: "center",
            color: "111111"
          });
          y += 24;
        }
      }
      if (index < mapNodes.length - 1) {
        y += pptLogicalArrow(ops, y);
      }
    }
  }
  return { ops, contentHeight: y + 26 };
}

function buildPptObjectPictureFlowSlide(summary) {
  const state = reportBuildLineageState(summary);
  const { ops, contentHeight } = buildPictureFlowPptObjectOps(summary, state);
  const slide = pptNewSlide("Picture Flow");
  const scaleInfo = pptLogicalScale(contentHeight, ops);
  for (const op of ops) {
    if (op.type === "break") continue;
    const { x, y, w, h } = pptLogicalBox(op, scaleInfo);
    if (op.type === "image") {
      pptAddImage(slide, op.key, x, y, w, h, { fit: op.fit || "contain" });
    } else if (op.type === "text") {
      pptAddText(slide, x, y, w, h, op.text, {
        fontSize: op.fixedFontSize || pptLogicalFont(op.fontSize || 11, scaleInfo),
        bold: op.bold,
        color: op.color,
        align: op.align || "left",
        valign: op.valign || "mid"
      });
    } else {
      pptAddShape(slide, x, y, w, h, {
        fill: op.fill,
        line: op.line,
        lineWidth: (op.lineWidth || 1) * Math.min(scaleInfo.scaleX || 1, scaleInfo.scaleY || 1),
        text: op.text,
        fontSize: op.fixedFontSize || pptLogicalFont(op.fontSize || 9, scaleInfo),
        bold: op.bold,
        color: op.color,
        align: op.align || "left",
        valign: op.valign || "mid"
      });
    }
  }
  if (scaleInfo.mode === "columns") {
    pptAddText(slide, PPT_W / 2 - 0.16, PPT_H - 0.42, 0.32, 0.2, "→", {
      fontSize: 9,
      bold: true,
      align: "center",
      color: "111111"
    });
  }
  return slide;
}

function buildPictureFlowPptSlides(summary) {
  const state = reportBuildLineageState(summary);
  const slides = [buildPptOverviewSlide(summary, state)];
  const rounds = Array.from(new Set((summary.nodes || [])
    .map((node) => reportLineageRound(node.uid, state))
    .filter((round) => round > 0)))
    .sort((a, b) => a - b);
  for (const round of rounds) {
    slides.push(buildPptRoundSlide(summary, state, round));
    const mapNodes = reportRoundNodes(summary, state, round, (node) => {
      const hasClasses = (summary.class_split_jobs || []).some((item) => item.uid === node.uid && item.classes && item.classes.length);
      return hasClasses || normalMapAssets(node).length;
    });
    for (const node of mapNodes) {
      const hasClasses = (summary.class_split_jobs || []).some((item) => item.uid === node.uid && item.classes && item.classes.length);
      slides.push(hasClasses ? buildPptClassSlide(summary, state, node) : buildPptMapSlide(node));
    }
  }
  return slides;
}

function pptUniqueSlideImageKeys(slide, images) {
  return Array.from(new Set(slide.items
    .filter((item) => item.type === "image" && images.has(item.key))
    .map((item) => item.key)));
}

function pptContentTypesXml(slideCount, imageExts) {
  const imageDefaults = Array.from(new Set(imageExts)).map((ext) => {
    const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
    return `<Default Extension="${pptXml(ext)}" ContentType="${type}"/>`;
  }).join("");
  const slides = Array.from({ length: slideCount }, (_, index) => (
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides}</Types>`;
}

function pptRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function pptPresentationXml(slideCount) {
  const slideIds = Array.from({ length: slideCount }, (_, index) => (
    `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${pptEmu(PPT_W)}" cy="${pptEmu(PPT_H)}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function pptPresentationRelsXml(slideCount) {
  const slideRels = Array.from({ length: slideCount }, (_, index) => (
    `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`;
}

function pptSlideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${pptFillXml(PPT_COLORS.white)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
}

function pptSlideMasterRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
}

function pptSlideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function pptSlideLayoutRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
}

function pptThemeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CryoSmart"><a:themeElements><a:clrScheme name="CryoSmart"><a:dk1><a:srgbClr val="17202E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="526174"/></a:dk2><a:lt2><a:srgbClr val="F6F8FB"/></a:lt2><a:accent1><a:srgbClr val="16A05D"/></a:accent1><a:accent2><a:srgbClr val="D99300"/></a:accent2><a:accent3><a:srgbClr val="4D64E8"/></a:accent3><a:accent4><a:srgbClr val="CBD7E6"/></a:accent4><a:accent5><a:srgbClr val="8EE6AF"/></a:accent5><a:accent6><a:srgbClr val="F0C56B"/></a:accent6><a:hlink><a:srgbClr val="086AD8"/></a:hlink><a:folHlink><a:srgbClr val="293FAF"/></a:folHlink></a:clrScheme><a:fontScheme name="Times"><a:majorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface="Times New Roman"/></a:majorFont><a:minorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface="Times New Roman"/></a:minorFont></a:fontScheme><a:fmtScheme name="Simple"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function pptCoreXml(summary) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>CryoSmart ${pptXml(summary.project_uid)}/${pptXml(summary.start_uid)} Picture Flow</dc:title><dc:creator>CryoSmart Lineage Tracer</dc:creator><cp:lastModifiedBy>CryoSmart Lineage Tracer</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function pptAppXml(slideCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>CryoSmart Lineage Tracer</Application><PresentationFormat>A4 Portrait</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipU16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function zipU32(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { time, date: (year << 9) | (month << 5) | day };
}

function makeZip(files, mimeType) {
  const now = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = utf8Bytes(file.name);
    const data = file.data instanceof Uint8Array ? file.data : utf8Bytes(file.data);
    const crc = zipCrc32(data);
    const localHeader = concatBytes([
      zipU32(0x04034b50), zipU16(20), zipU16(0), zipU16(0), zipU16(now.time), zipU16(now.date),
      zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(nameBytes.length), zipU16(0), nameBytes
    ]);
    localParts.push(localHeader, data);
    const centralHeader = concatBytes([
      zipU32(0x02014b50), zipU16(20), zipU16(20), zipU16(0), zipU16(0), zipU16(now.time), zipU16(now.date),
      zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(nameBytes.length), zipU16(0), zipU16(0),
      zipU16(0), zipU16(0), zipU32(0), zipU32(offset), nameBytes
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);
  const end = concatBytes([
    zipU32(0x06054b50), zipU16(0), zipU16(0), zipU16(files.length), zipU16(files.length),
    zipU32(central.length), zipU32(local.length), zipU16(0)
  ]);
  return new Blob([local, central, end], { type: mimeType });
}

async function buildPictureFlowPptx(summary) {
  const images = await fetchPptImages(summary);
  const slides = [buildPptObjectPictureFlowSlide(summary)];
  const mediaParts = new Map();
  let mediaIndex = 1;
  for (const slide of slides) {
    for (const key of pptUniqueSlideImageKeys(slide, images)) {
      if (!mediaParts.has(key)) {
        const image = images.get(key);
        const mediaName = `image${mediaIndex}.${image.ext}`;
        mediaIndex += 1;
        mediaParts.set(key, { ...image, mediaName });
      }
    }
  }

  const files = [];
  files.push({ name: "[Content_Types].xml", data: pptContentTypesXml(slides.length, Array.from(mediaParts.values()).map((item) => item.ext)) });
  files.push({ name: "_rels/.rels", data: pptRootRelsXml() });
  files.push({ name: "docProps/core.xml", data: pptCoreXml(summary) });
  files.push({ name: "docProps/app.xml", data: pptAppXml(slides.length) });
  files.push({ name: "ppt/presentation.xml", data: pptPresentationXml(slides.length) });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: pptPresentationRelsXml(slides.length) });
  files.push({ name: "ppt/slideMasters/slideMaster1.xml", data: pptSlideMasterXml() });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: pptSlideMasterRelsXml() });
  files.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: pptSlideLayoutXml() });
  files.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: pptSlideLayoutRelsXml() });
  files.push({ name: "ppt/theme/theme1.xml", data: pptThemeXml() });

  slides.forEach((slide, index) => {
    const rels = [];
    const relIdMap = new Map();
    let relIndex = 2;
    for (const key of pptUniqueSlideImageKeys(slide, images)) {
      const part = mediaParts.get(key);
      if (!part) continue;
      const relId = `rId${relIndex}`;
      relIndex += 1;
      relIdMap.set(key, relId);
      rels.push({ id: relId, mediaName: part.mediaName });
    }
    files.push({ name: `ppt/slides/slide${index + 1}.xml`, data: pptSlideXml(slide, relIdMap, images) });
    files.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: pptSlideRelsXml(rels) });
  });

  for (const part of mediaParts.values()) {
    files.push({ name: `ppt/media/${part.mediaName}`, data: part.bytes });
  }
  return makeZip(files, PPTX_CONTENT_TYPE);
}

async function initDefaults() {
  try {
    const tabs = await chromeCall(chrome.tabs.query, { active: true, currentWindow: true });
    const route = parseRoute(tabs && tabs[0] && tabs[0].url);
    if (route.projectId) projectIdEl.value = route.projectId;
    if (route.jobId) startJobEl.value = route.jobId.replace(/^J/i, "");
  } catch (err) {
    // Defaults are optional.
  }
}

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  analyzeBtn.disabled = true;
  downloadBtn.disabled = true;
  previewEl.value = "";
  statusEl.textContent = "正在导出 Project metadata：插件会逐个打开 Job 的 Metadata 页面，请不要操作当前 CryoSmart 标签页。";

  try {
    const projectId = String(projectIdEl.value || "").trim();
    if (!projectId) throw new Error("请输入 Project，例如 P52。");
    const result = await exportProjectMetadataFromCurrentPage(projectId);
    if (!result || !result.ok) throw new Error((result && result.error) || "导出失败。");

    lastProjectMetadata = result.summary;
    const base = `CryoSmart_${projectId}_project_metadata`;
    downloadText(`${base}.json`, JSON.stringify(lastProjectMetadata, null, 2), "application/json");
    previewEl.value = [
      `${projectId} metadata 导出完成`,
      `发现 Job: ${lastProjectMetadata.discovered_job_count}`,
      `成功解析: ${lastProjectMetadata.parsed_job_count}`,
      `失败: ${lastProjectMetadata.failed_job_count}`,
      "",
      "现在可以直接点“追溯颗粒和 Map 来源”。"
    ].join("\n");
    statusEl.textContent = `导出完成：解析 ${lastProjectMetadata.parsed_job_count}/${lastProjectMetadata.discovered_job_count} 个 Job。`;
  } catch (err) {
    statusEl.textContent = `失败：${err.message}`;
  } finally {
    exportBtn.disabled = false;
    analyzeBtn.disabled = false;
  }
});

analyzeBtn.addEventListener("click", async () => {
  analyzeBtn.disabled = true;
  exportBtn.disabled = true;
  downloadBtn.disabled = true;
  statusEl.textContent = "正在读取 metadata 并追溯...";
  previewEl.value = "";

  try {
    const projectId = String(projectIdEl.value || "").trim();
    const startUid = normalizeJobUid(startJobEl.value);
    if (!projectId) throw new Error("请输入 Project，例如 P52。");

    let data;
    let baseUrl = "http://192.168.4.3:8080";
    if (jobsJsonEl.files && jobsJsonEl.files[0]) {
      data = normalizeJobsPayload(await readJsonFile(jobsJsonEl.files[0]));
      lastSummary = buildSummary(data, projectId, startUid, baseUrl);
    } else if (lastProjectMetadata && Array.isArray(lastProjectMetadata.jobs)) {
      data = lastProjectMetadata.jobs;
      lastSummary = buildSummary(data, projectId, startUid, baseUrl);
    } else {
      statusEl.textContent = "正在按需打开上游 Job 的 Metadata 页面...";
      const pageResult = await traceFromCurrentPage(projectId, startUid);
      if (!pageResult || !pageResult.ok) {
        throw new Error((pageResult && pageResult.error) || "页面读取失败。");
      }
      if (pageResult.summary && Array.isArray(pageResult.summary.raw_jobs)) {
        lastSummary = buildSummary(pageResult.summary.raw_jobs, projectId, startUid, pageResult.summary.base_url || baseUrl);
      } else {
        lastSummary = pageResult.summary;
      }
    }
    lastSummary = normalizeLineageSummary(lastSummary);

    previewEl.value = makePreview(lastSummary);
    statusEl.textContent = `追溯完成：${lastSummary.nodes.length} 个节点，${lastSummary.edges.length} 条关系。`;
    downloadBtn.disabled = false;
  } catch (err) {
    statusEl.textContent = `失败：${err.message}`;
  } finally {
    analyzeBtn.disabled = false;
    exportBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!lastSummary) return;
  downloadBtn.disabled = true;
  const base = `CryoSmart_${lastSummary.project_uid}_${lastSummary.start_uid}_lineage`;
  downloadText(`${base}/${base}.json`, JSON.stringify(lastSummary, null, 2), "application/json");
  downloadText(`${base}/${base}_report.html`, buildLineageHtmlV2(lastSummary), "text/html");
  downloadText(`${base}/${base}_picture_flow.svg`, buildPictureFlowSvg(lastSummary), "image/svg+xml");
  downloadText(`${base}/${base}.mmd`, lastSummary.focused_mermaid, "text/plain");
  downloadText(`${base}/${base}_preview.txt`, makePreview(lastSummary), "text/plain");
  try {
    await downloadBundledText(`${base}/rebuild_picture_flow_pptx.mjs`, "rebuild_picture_flow_pptx.mjs", "text/javascript");
  } catch (err) {
    console.warn("Could not export rebuild PPTX script", err);
  }
  try {
    await downloadBundledText(`${base}/CryoSmart_align_maps_check_view.py`, "CryoSmart_align_maps_check_view.py", "text/x-python");
    await downloadBundledText(`${base}/CryoSmart_export_current_view_ppt.py`, "CryoSmart_export_current_view_ppt.py", "text/x-python");
    await downloadBundledText(`${base}/CryoSmart_auto_align_export_ppt.py`, "CryoSmart_auto_align_export_ppt.py", "text/x-python");
  } catch (err) {
    console.warn("Could not export ChimeraX Python scripts", err);
  }

  if (downloadPptxEl && downloadPptxEl.checked) {
    try {
      statusEl.textContent = "正在生成 PPTX：A4 单页 Picture Flow，图片会嵌入文件。";
      const pptx = await buildPictureFlowPptx(lastSummary);
      downloadBlob(`${base}/${base}_picture_flow.pptx`, pptx);
    } catch (err) {
      statusEl.textContent = `基础报告已导出；PPTX 生成失败：${err.message}`;
    }
  }

  const remoteDownloads = [];
  if (downloadImagesEl && downloadImagesEl.checked) {
    for (const asset of collectReportImages(lastSummary)) {
      remoteDownloads.push({ ...asset, filename: `${base}/${asset.filename}` });
    }
  }
  if (downloadMapsEl && downloadMapsEl.checked) {
    for (const asset of collectReportMaps(lastSummary)) {
      remoteDownloads.push({ ...asset, filename: `${base}/${asset.filename}` });
    }
  }
  if (downloadFinalResultsEl && downloadFinalResultsEl.checked) {
    try {
      statusEl.textContent = "正在扫描最终 Job 的 Overview：查找最新 FSC / Direction / Guinier，并准备最终 Map。";
      const finalScan = await scanFinalResultsFromCurrentPage(lastSummary.project_uid, lastSummary.start_uid);
      if (!finalScan || !finalScan.ok) throw new Error((finalScan && finalScan.error) || "最终结果扫描失败。");
      const finalMeta = finalResultMetadata(lastSummary, finalScan.summary);
      downloadText(`${base}/Final_Result/final_result_summary.json`, JSON.stringify(finalMeta, null, 2), "application/json");
      downloadText(`${base}/Final_Result/final_result_summary.txt`, finalResultMetadataText(finalMeta), "text/plain");
      for (const asset of finalResultDownloads(finalScan.summary)) {
        remoteDownloads.push({ ...asset, filename: `${base}/${asset.filename}` });
      }
      if (finalMeta.final_resolution_A && !lastSummary.final_resolution_A) {
        lastSummary.final_resolution_A = finalMeta.final_resolution_A;
      }
    } catch (err) {
      downloadText(`${base}/Final_Result/final_result_error.txt`, `最终结果包未完成：${err.message}`, "text/plain");
      statusEl.textContent = `基础报告已导出；最终结果包扫描失败：${err.message}`;
    }
  }
  if (remoteDownloads.length) {
    const remoteResult = await downloadRemoteBatch(remoteDownloads);
    if (remoteResult.errors && remoteResult.errors.length) {
      downloadText(`${base}/download_warnings.txt`, remoteResult.errors.join("\n"), "text/plain");
    }
  }
  if (!statusEl.textContent.includes("PPTX 生成失败") && !statusEl.textContent.includes("最终结果包扫描失败")) {
    statusEl.textContent = "下载已开始：HTML / SVG / PPTX / JSON、ChimeraX Python 脚本，以及勾选的图片、map 会陆续进入下载列表。";
  }
  downloadBtn.disabled = false;
});

initDefaults();
