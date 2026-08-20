const TRACE_JOB_TYPES = [
  ["nonuniform_refine_new", /nonuniform[_ ]refine[_ ]new/i],
  ["nonuniform_refine", /nonuniform[_ ]refine/i],
  ["homo_refine_new", /homo[_ ]refine[_ ]new/i],
  ["homo_refine", /homo[_ ]refine/i],
  ["new_local_refine", /new[_ ]local[_ ]refine|local[_ ]refine/i],
  ["hetero_refine", /hetero[_ ]refine/i],
  ["homo_abinit", /homo[_ ]abinit|ab[- ]?init/i],
  ["class_2D", /class[_ ]?2d/i],
  ["class_3D", /class[_ ]?3d/i],
  ["select_2D", /select[_ ]?2d/i],
  ["topaz_cross_validation", /topaz[_ ]cross[_ ]validation/i],
  ["topaz_train", /topaz[_ ]train/i],
  ["topaz_extract", /topaz[_ ]extract/i],
  ["extract_micrographs_multi", /extract[_ ]micrographs[_ ]multi/i],
  ["remove_duplicate_particles", /remove[_ ]duplicate[_ ]particles/i],
  ["blob_picker_gpu", /blob[_ ]picker/i],
  ["auto_blob_picker_gpu", /auto[_ ]blob[_ ]picker/i],
  ["template_picker_gpu", /template[_ ]picker/i],
  ["deep_picker_train", /deep[_ ]picker[_ ]train/i],
  ["deep_picker_inference", /deep[_ ]picker[_ ]inference/i],
  ["filament_tracer_gpu", /filament[_ ]tracer/i],
  ["manual_picker", /manual[_ ]picker/i],
  ["ctf_refine_global", /ctf[_ ]refine[_ ]global/i],
  ["ctf_refine_local", /ctf[_ ]refine[_ ]local/i],
  ["ctf_estimation", /ctf[_ ]estimation|patch[_ ]ctf/i],
  ["curate_exposures", /curate[_ ]exposures/i],
  ["import_movies", /import[_ ]movies/i],
  ["import_micrographs", /import[_ ]micrographs/i],
  ["import_particles", /import[_ ]particles/i],
  ["import_volumes", /import[_ ]volumes/i],
  ["volume_tools", /volume[_ ]tools/i],
  ["volume_alignment_tools", /volume[_ ]alignment/i],
  ["homo_reconstruct", /homo[_ ]reconstruct/i],
  ["sym_expand", /sym[_ ]expand/i],
  ["particle_subtract", /particle[_ ]subtract/i],
  ["var_3D", /var[_ ]?3d/i]
];

const TRACE_MAJOR_TYPES = new Set([
  "import_movies",
  "import_micrographs",
  "import_particles",
  "import_volumes",
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
  "class_3D",
  "select_2D",
  "rebalance_classes_2D",
  "class_probability_filter",
  "homo_abinit",
  "hetero_refine",
  "homo_refine",
  "homo_refine_new",
  "nonuniform_refine_new",
  "nonuniform_refine",
  "new_local_refine",
  "naive_local_refine",
  "homo_reconstruct",
  "align_3D",
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

const TRACE_SMALL_TYPES = new Set([
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
  "junk_filter"
]);

const TRACE_MAP_SUFFIXES = [
  "volume.map"
];

const TRACE_FINAL_GRAPH_TARGETS = [
  {
    key: "fsc",
    title: "FSC",
    titleRegex: /\bFSC\s+Iteration\s+(\d{1,4})\b/gi,
    folderPrefix: "FSC_Iteration",
    fileBase: "FSC",
    exts: ["png", "pdf", "txt", "xml"]
  },
  {
    key: "direction_distribution",
    title: "Direction Distribution",
    titleRegex: /\b(?:Viewing\s+Direction\s+Distribution|Posterior\s+Precision\s+Directional\s+Distribution|Directional?\s+Distribution|Direction\s+Distribution)\s+Iteration\s+(\d{1,4})\b/gi,
    folderPrefix: "Direction Distribution Iteration",
    fileBase: "Direction Distribution",
    exts: ["png", "pdf"]
  },
  {
    key: "guinier",
    title: "Guinier Plot",
    titleRegex: /\bGuinier\s+Plot\s+Iteration\s+(\d{1,4})\b/gi,
    folderPrefix: "Guinier_Plot_Iteration",
    fileBase: "Guinier_Plot",
    exts: ["png", "pdf"]
  }
];

const TRACE_FINAL_MAP_TARGETS = [
  { suffix: "volume.map" },
  { suffix: "volume.map_sharp" },
  { suffix: "volume.map_half_A" },
  { suffix: "volume.map_half_B" },
  { suffix: "volume.mask_refine" },
  { suffix: "mask.mask_refine" }
];

function traceSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function traceNormalizeJsonText(text) {
  return String(text || "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

function traceFindJsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function traceExtractMetadataObject(text) {
  const normalized = traceNormalizeJsonText(text);
  const first = normalized.indexOf("{");
  if (first < 0) throw new Error("Metadata 页面里没有找到 JSON 开头。");
  const end = traceFindJsonEnd(normalized, first);
  if (end < 0) throw new Error("Metadata JSON 没有完整结束。");
  const rawJson = normalized.slice(first, end);
  const job = JSON.parse(rawJson);
  if (!job.uid) {
    const uidMatch = normalized.match(/\bJ\d+\b/i);
    if (uidMatch) job.uid = uidMatch[0].toUpperCase();
  }
  if (!Number.isInteger(job.uid_num)) {
    job.uid_num = traceJobNum(job.uid);
  }
  return { job, rawJson };
}

function traceRoute() {
  const match = location.href.match(/#\/projects\/([^/]+)(?:\/([^/]+))?(?:\/(J\d+))?/i);
  return {
    projectId: match ? match[1] : "",
    experimentId: match && match[2] ? match[2] : "",
    jobId: match && match[3] ? match[3].toUpperCase() : ""
  };
}

function traceJobNum(uid) {
  const match = String(uid || "").match(/J(\d+)/i);
  return match ? Number(match[1]) : null;
}

function traceNormalizeJob(value) {
  const text = String(value || "").trim();
  return /^J/i.test(text) ? text.toUpperCase() : `J${text}`;
}

function traceVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function traceFindClickableByText(text) {
  const wanted = text.toLowerCase();
  const elements = Array.from(document.querySelectorAll("a, button, [role='button'], [tabindex], div, span"));
  const candidates = elements
    .filter((el) => traceVisible(el))
    .filter((el) => (el.innerText || el.textContent || "").trim().toLowerCase().includes(wanted))
    .sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length);

  for (const el of candidates) {
    return el.closest("a, button, [role='button'], [tabindex]") || el;
  }
  return null;
}

function traceFindJobElement(uid) {
  const re = new RegExp(`\\b${uid}\\b`, "i");
  const elements = Array.from(document.querySelectorAll("a, button, [role='button'], [tabindex], div, span"));
  const candidates = elements
    .filter((el) => traceVisible(el))
    .filter((el) => re.test((el.innerText || el.textContent || "").trim()))
    .sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length);

  for (const el of candidates) {
    return el.closest("a, button, [role='button'], [tabindex]") || el;
  }
  return null;
}

async function traceWaitForRoute(uid, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (traceRoute().jobId === uid) return true;
    await traceSleep(250);
  }
  return false;
}

async function traceWaitForProject(projectId, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const route = traceRoute();
    if (route.projectId === projectId && !route.jobId) return true;
    await traceSleep(250);
  }
  return false;
}

async function traceOpenProject(projectId) {
  location.hash = `#/projects/${projectId}`;
  await traceWaitForProject(projectId, 12000);
  await traceSleep(900);
}

async function traceOpenJob(uid, projectId, experimentId) {
  uid = traceNormalizeJob(uid);
  if (traceRoute().jobId === uid) return true;

  if (experimentId) {
    location.hash = `#/projects/${projectId}/${experimentId}/${uid}`;
    if (await traceWaitForRoute(uid, 10000)) {
      await traceSleep(900);
      return true;
    }
  }

  const viewAll = traceFindClickableByText("View All");
  if (viewAll) {
    viewAll.click();
    await traceSleep(700);
  }

  const jobEl = traceFindJobElement(uid);
  if (!jobEl) return false;
  jobEl.click();
  if (await traceWaitForRoute(uid, 15000)) {
    await traceSleep(1000);
    return true;
  }
  return false;
}

async function traceClickTab(name) {
  const tab = traceFindClickableByText(name);
  if (!tab) return false;
  tab.click();
  await traceSleep(1000);
  return true;
}

function traceAbsoluteUrl(value) {
  try {
    return new URL(value, location.origin).href;
  } catch (err) {
    return "";
  }
}

function traceElementLogText(el) {
  let best = "";
  let node = el;
  while (node && node !== document.body && node.parentElement) {
    const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    if (/Selected\s+\d+\s+classes/i.test(text) && (!best || text.length < best.length)) best = text;
    node = node.parentElement;
  }
  if (best) return best;
  const containers = [
    el.closest("[class*='item']"),
    el.closest("[class*='row']"),
    el.closest("tr"),
    el.closest("li"),
    el.closest(".log"),
    el.closest("[class*='log']"),
    el.closest("div")
  ].filter(Boolean);
  for (const container of containers) {
    const text = (container.innerText || container.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

function traceNearestSelectedClassText(el) {
  let node = el;
  while (node && node !== document.body && node.parentElement) {
    const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    if (/Selected\s+\d+\s+classes/i.test(text)) return text;
    if (/Excluded\s+\d+\s+classes/i.test(text)) return "";
    node = node.parentElement;
  }
  return "";
}

function traceLogContainerCandidates() {
  const nodes = Array.from(document.querySelectorAll("li, tr, [class*='log'], [class*='item'], [class*='row'], div"));
  return nodes
    .filter((el) => traceVisible(el))
    .map((el, index) => ({
      el,
      index,
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
    }))
    .filter((item) => /Selected\s+\d+\s+classes/i.test(item.text))
    .sort((a, b) => {
      const areaA = a.el.getBoundingClientRect().width * a.el.getBoundingClientRect().height;
      const areaB = b.el.getBoundingClientRect().width * b.el.getBoundingClientRect().height;
      return areaA - areaB || a.index - b.index;
    });
}

function traceSelectedClassesTimestamp(text) {
  const match = String(text || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!match) return 0;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ).getTime() || 0;
}

function traceIsPngLogLink(link) {
  const label = (link.innerText || link.textContent || link.getAttribute("aria-label") || "").trim().toLowerCase();
  const href = link.getAttribute("href") || "";
  if (label === "pdf" || /\bpdf\b/i.test(label) || /\.pdf(?:$|\?)/i.test(href)) return false;
  return label === "png" || /\[png\]|\bpng\b/i.test(label) || /(?:^|[._-])png(?:$|[._-])/i.test(href);
}

function traceFirstPngLikeLogLink(container) {
  const links = Array.from((container && container.querySelectorAll ? container : document).querySelectorAll("a[href*='/api/log_image/']"));
  return links.find(traceIsPngLogLink) || links.find((link) => {
    const label = (link.innerText || link.textContent || link.getAttribute("aria-label") || "").trim().toLowerCase();
    const href = link.getAttribute("href") || "";
    return !/download_result_file|\.pdf(?:$|\?)|\bpdf\b/i.test(`${href} ${label}`);
  }) || null;
}

function traceSelectImageSourceRank(source) {
  const value = String(source || "");
  if (value === "png_link_direct") return 0;
  if (value === "png_link") return 1;
  if (value === "png_link_fallback") return 2;
  if (value === "inline_image") return 3;
  if (value === "image_fallback") return 4;
  return 9;
}

function traceSelectImagePenalty(item) {
  const text = String((item && item.text) || "");
  let penalty = traceSelectImageSourceRank(item && item.source) * 10;
  if (!/Selected\s+\d+\s+classes/i.test(text)) penalty += 200;
  if (/Excluded\s+\d+\s+classes/i.test(text)) penalty += 80;
  if (/Job complete|Checking outputs|Loaded output dset|Passing through outputs/i.test(text)) penalty += 60;
  if (text.length > 900) penalty += 40;
  if (text.length > 2200) penalty += 80;
  return penalty;
}

function traceBestSelectImageCandidate(candidates) {
  return (candidates || [])
    .filter((item) => item && item.url)
    .sort((a, b) => {
      const penaltyA = traceSelectImagePenalty(a);
      const penaltyB = traceSelectImagePenalty(b);
      return (penaltyA - penaltyB) || (b.timestamp - a.timestamp) || (a.index - b.index);
    })[0] || null;
}

function traceCollectOverviewSelect2DImage() {
  const candidates = [];
  const seen = new Set();
  function pushCandidate(item) {
    if (!item || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    candidates.push(item);
  }
  const pngLinks = Array.from(document.querySelectorAll("a[href*='/api/log_image/']"))
    .filter(traceIsPngLogLink);
  for (const link of pngLinks) {
    const text = traceNearestSelectedClassText(link);
    const match = text.match(/Selected\s+(\d+)\s+classes/i);
    if (!match) continue;
    pushCandidate({
      url: traceAbsoluteUrl(link.getAttribute("href") || ""),
      text,
      classes_selected: Number(match[1]),
      timestamp: traceSelectedClassesTimestamp(text),
      index: candidates.length,
      source: "png_link_direct"
    });
  }
  for (const container of traceLogContainerCandidates()) {
    const match = container.text.match(/Selected\s+(\d+)\s+classes/i);
    const pngLink = traceFirstPngLikeLogLink(container.el);
    const img = container.el.querySelector("img[src*='/api/log_image/']");
    const rawUrl = (pngLink && pngLink.getAttribute("href")) || (img && img.getAttribute("src")) || "";
    if (!rawUrl || /download_result_file|\.pdf(?:$|\?)/i.test(rawUrl)) continue;
    pushCandidate({
      url: traceAbsoluteUrl(rawUrl),
      text: container.text,
      classes_selected: Number(match[1]),
      timestamp: traceSelectedClassesTimestamp(container.text),
      index: container.index,
      source: pngLink ? "png_link" : "inline_image"
    });
  }
  const elements = Array.from(document.querySelectorAll("a[href*='/api/log_image/'], img[src*='/api/log_image/']"));
  for (const el of elements) {
    const rawUrl = el.getAttribute("href") || el.getAttribute("src") || "";
    if (!rawUrl || /download_result_file|\.pdf(?:$|\?)/i.test(rawUrl)) continue;
    const text = traceElementLogText(el);
    const label = (el.innerText || el.textContent || el.getAttribute("alt") || "").trim().toLowerCase();
    if (label === "pdf" || /\bpdf\b/i.test(label)) continue;
    const match = text.match(/Selected\s+(\d+)\s+classes/i);
    if (!match) continue;
    pushCandidate({
      url: traceAbsoluteUrl(rawUrl),
      text,
      classes_selected: Number(match[1]),
      timestamp: traceSelectedClassesTimestamp(text),
      index: candidates.length,
      source: el.tagName === "A" ? "png_link_fallback" : "image_fallback"
    });
  }
  return traceBestSelectImageCandidate(candidates);
}

function traceScrollableElements() {
  const elements = [document.scrollingElement || document.documentElement];
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    const canScroll = /(auto|scroll)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`);
    if (!canScroll) continue;
    if (element.scrollHeight <= element.clientHeight + 80) continue;
    elements.push(element);
  }
  return Array.from(new Set(elements))
    .filter(Boolean)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
}

function traceSetScrollTop(scroller, value) {
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    window.scrollTo(0, value);
  } else {
    scroller.scrollTop = value;
  }
}

function traceGetScrollTop(scroller) {
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }
  return scroller.scrollTop;
}

function traceGetMaxScrollTop(scroller) {
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
  }
  return scroller.scrollHeight - scroller.clientHeight;
}

async function traceScanOverviewSelect2DImage() {
  const candidates = [];
  const seen = new Set();
  function harvest() {
    const item = traceCollectOverviewSelect2DImage();
    if (item && item.url && !seen.has(item.url)) {
      seen.add(item.url);
      candidates.push({ ...item, index: candidates.length });
    }
  }

  harvest();
  for (const label of ["Show from top", "Show from bottom"]) {
    const button = traceFindClickableByText(label);
    if (button) {
      button.click();
      await traceSleep(850);
      harvest();
    }
  }

  const scrollers = traceScrollableElements().slice(0, 5);
  for (const scroller of scrollers) {
    const maxTop = traceGetMaxScrollTop(scroller);
    if (maxTop <= 0) continue;
    const amount = Math.max(220, Math.floor((scroller.clientHeight || window.innerHeight) * 0.72));

    for (const start of [0, maxTop]) {
      traceSetScrollTop(scroller, start);
      await traceSleep(180);
      harvest();

      let stalled = 0;
      let previousTop = -1;
      for (let step = 0; step < 90; step += 1) {
        const currentTop = traceGetScrollTop(scroller);
        const nextTop = start === 0
          ? Math.min(maxTop, currentTop + amount)
          : Math.max(0, currentTop - amount);
        if (Math.abs(nextTop - currentTop) < 3) break;
        traceSetScrollTop(scroller, nextTop);
        await traceSleep(110);
        harvest();
        const afterTop = traceGetScrollTop(scroller);
        if (Math.abs(afterTop - previousTop) < 3) stalled += 1;
        else stalled = 0;
        previousTop = afterTop;
        if (stalled >= 6) break;
      }
    }
  }

  return traceBestSelectImageCandidate(candidates);
}

function traceParseResolutionText(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:resolution|res|FSC[^:]{0,40})[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)[^.;]{0,60}(?:resolution|FSC|res)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = match && Number(match[1]);
    if (Number.isFinite(number) && number >= 1 && number <= 20) return Math.round(number * 100) / 100;
  }
  return null;
}

function traceCollectOverviewResolution() {
  return traceParseResolutionText(document.body.innerText || "");
}

async function traceReadCurrentOverviewAssets() {
  await traceClickTab("Overview");
  let selected = null;
  let resolution = null;
  const started = Date.now();
  let lastTextLength = 0;
  let lastChanged = Date.now();
  let maybeSelect2D = false;
  while (Date.now() - started < 10000) {
    const bodyText = document.body.innerText || "";
    if (bodyText.length !== lastTextLength) {
      lastTextLength = bodyText.length;
      lastChanged = Date.now();
    }
    maybeSelect2D = maybeSelect2D || /select[_ ]?2D|Selected\s+\d+\s+classes/i.test(bodyText);
    selected = traceCollectOverviewSelect2DImage();
    resolution = resolution || traceCollectOverviewResolution();
    if (selected && Date.now() - lastChanged > 700) break;
    if (!maybeSelect2D && Date.now() - started > 2300) break;
    await traceSleep(300);
  }
  if (maybeSelect2D) {
    const scanned = await traceScanOverviewSelect2DImage();
    if (scanned) selected = scanned;
  }
  const assets = {};
  if (selected) {
    assets.select_2d = {
      selected_classes_image: selected.url,
      selected_classes_src: selected.url,
      selected_classes_original_url: selected.url,
      classes_selected: selected.classes_selected,
      source: "overview_log_selected_classes",
      log_text: selected.text,
      log_timestamp: selected.timestamp || null
    };
  }
  if (resolution) assets.resolution_A = resolution;
  return assets;
}

async function traceWaitForMetadataText(timeoutMs = 15000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    last = document.body.innerText || "";
    if (/"input_slot_groups"|"output_result_groups"|"job_type"|"uid"/.test(last) && last.includes("{")) {
      return last;
    }
    await traceSleep(300);
  }
  return last || document.body.innerText || "";
}

function traceCollectProjectJobIds() {
  const ids = new Set();
  const elements = Array.from(document.querySelectorAll("a, button, [role='button'], [tabindex], div, span"));
  for (const el of elements) {
    if (!traceVisible(el)) continue;
    const text = (el.innerText || el.textContent || "").trim();
    if (!text || text.length > 160) continue;
    let match;
    const re = /\bJ(\d+)\b/gi;
    while ((match = re.exec(text))) ids.add(`J${match[1]}`);
  }
  return Array.from(ids).sort((a, b) => (traceJobNum(a) || 0) - (traceJobNum(b) || 0));
}

async function traceExpandProjectJobs() {
  const viewAll = traceFindClickableByText("View All");
  if (viewAll) {
    viewAll.click();
    await traceSleep(1000);
  }
  for (let i = 0; i < 8; i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await traceSleep(250);
  }
  window.scrollTo(0, 0);
  await traceSleep(300);
}

async function traceReadCurrentMetadataJob(projectId) {
  const route = traceRoute();
  await traceClickTab("Metadata");
  const metadataText = await traceWaitForMetadataText();
  const { job, rawJson } = traceExtractMetadataObject(metadataText);
  if (!job.project_uid) job.project_uid = projectId;
  if (!job.uid && route.jobId) job.uid = route.jobId;
  if (!Number.isInteger(job.uid_num)) job.uid_num = traceJobNum(job.uid);
  return { job, rawJsonLength: rawJson.length };
}

async function traceExportProjectMetadata(projectId) {
  await traceOpenProject(projectId);
  await traceExpandProjectJobs();
  const jobIds = traceCollectProjectJobIds();
  if (!jobIds.length) throw new Error("Project 页没有找到 Job 编号；请先打开 View All 后重试。");

  const jobs = [];
  const failures = [];
  let experimentId = "";

  for (const uid of jobIds) {
    await traceOpenProject(projectId);
    await traceExpandProjectJobs();
    const opened = await traceOpenJob(uid, projectId, "");
    if (!opened) {
      failures.push({ uid, error: "没有打开这个 Job 页面" });
      continue;
    }
    const route = traceRoute();
    experimentId = route.experimentId || experimentId;
    try {
      const overviewAssets = await traceReadCurrentOverviewAssets();
      const item = await traceReadCurrentMetadataJob(projectId);
      if (item.job && item.job.uid) {
        if (overviewAssets && Object.keys(overviewAssets).length) {
          item.job.overview_assets = overviewAssets;
        }
        jobs.push(item.job);
      } else {
        failures.push({ uid, error: "Metadata JSON 里没有 uid" });
      }
    } catch (err) {
      failures.push({ uid, error: err.message });
    }
  }

  const unique = new Map();
  for (const job of jobs) unique.set(job.uid, job);
  const sortedJobs = Array.from(unique.values()).sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0));
  return {
    ok: true,
    source: "cryosmart-project-metadata-export",
    project_uid: projectId,
    experiment_uid: experimentId,
    exported_at: new Date().toISOString(),
    discovered_job_count: jobIds.length,
    parsed_job_count: sortedJobs.length,
    failed_job_count: failures.length,
    failed_jobs: failures,
    jobs: sortedJobs
  };
}

function traceGuessJobType(text) {
  for (const [type, regex] of TRACE_JOB_TYPES) {
    if (regex.test(text)) return type;
  }
  return "";
}

function traceMaxNumberBeforeWord(text, words) {
  let best = null;
  const wordPattern = words.join("|");
  const regexes = [
    new RegExp(`([0-9][0-9,]*)\\s*(?:${wordPattern})`, "gi"),
    new RegExp(`(?:${wordPattern})[^0-9]{0,40}([0-9][0-9,]*)`, "gi")
  ];
  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(text))) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) best = best === null ? value : Math.max(best, value);
    }
  }
  return best;
}

function tracePixelSizeFromText(text) {
  const match = String(text || "").replace(/\s+/g, " ").match(/(?:psize[_-]?A|pixel\s*size)[^0-9]{0,40}([0-9]+(?:\.[0-9]+)?)/i);
  return tracePixelSizeNumber(match && match[1]);
}

function traceContextsForUid(text, uid) {
  const contexts = [];
  const re = new RegExp(`\\b${uid}\\b`, "gi");
  let match;
  while ((match = re.exec(text))) {
    const start = Math.max(0, match.index - 180);
    const end = Math.min(text.length, match.index + 240);
    contexts.push(text.slice(start, end).replace(/\s+/g, " ").trim());
  }
  return contexts.slice(0, 8);
}

function traceKindFromContext(context) {
  const lower = context.toLowerCase();
  const kinds = new Set();
  if (/particle|particles|alignments|blob|pick/.test(lower)) kinds.add("particle");
  if (/volume|map|half|refine|mask_fsc/.test(lower)) kinds.add("volume");
  if (/mask/.test(lower)) kinds.add("mask");
  if (/micrograph|exposure|ctf/.test(lower)) kinds.add("exposure");
  if (/template/.test(lower)) kinds.add("template");
  return Array.from(kinds);
}

function traceExtractSources(text, currentUid) {
  const currentNum = traceJobNum(currentUid);
  const seen = new Map();
  const re = /\bJ\d+\b/g;
  let match;
  while ((match = re.exec(text))) {
    const uid = match[0].toUpperCase();
    if (uid === currentUid) continue;
    const num = traceJobNum(uid);
    if (currentNum !== null && num !== null && num >= currentNum) continue;
    const context = text.slice(Math.max(0, match.index - 180), Math.min(text.length, match.index + 240)).replace(/\s+/g, " ").trim();
    if (!seen.has(uid)) seen.set(uid, { uid, contexts: [], kinds: new Set() });
    const item = seen.get(uid);
    if (item.contexts.length < 8) item.contexts.push(context);
    for (const kind of traceKindFromContext(context)) item.kinds.add(kind);
  }
  return Array.from(seen.values()).map((item) => ({
    uid: item.uid,
    contexts: item.contexts,
    kinds: Array.from(item.kinds)
  }));
}

function traceClassSplitsFromText(job, baseUrl) {
  if (!/abinit|hetero/i.test(job.job_type || "")) return [];
  const text = `${job.tabs.outputs || ""}\n${job.tabs.metadata || ""}`;
  const rows = [];
  const total = traceMaxNumberBeforeWord(text, ["particles_all_classes", "All particles", "particles"]);

  for (let i = 0; i < 10; i += 1) {
    const patterns = [
      new RegExp(`particles[_ ]class[_ ]0*${i}([\\s\\S]{0,500})`, "i"),
      new RegExp(`class\\s+${i}([\\s\\S]{0,500})`, "i"),
      new RegExp(`volume[_ ]class[_ ]0*${i}([\\s\\S]{0,500})`, "i")
    ];
    const chunk = patterns.map((regex) => text.match(regex)).find(Boolean);
    if (!chunk) continue;
    const context = chunk[0];
    const count = traceMaxNumberBeforeWord(context, ["particles", "particle"]) || null;
    const percent = count && total ? Math.round(count / total * 10000) / 100 : null;
    const volumeGroup = new RegExp(`volume[_ ]class[_ ]0*${i}`, "i").test(text) ? `volume_class_${i}` : null;
    rows.push({
      class_index: i,
      particle_count: count,
      particle_percent: percent,
      total_particles: total,
      volume_group: volumeGroup,
      maps: volumeGroup ? [
        { result_name: "map", download_url: `${baseUrl}/api/log_image/download_result_file/${job.project_uid}/${job.uid}.${volumeGroup}.map` }
      ] : []
    });
  }
  return rows;
}

async function traceReadCurrentJob(projectId, baseUrl) {
  const route = traceRoute();
  const uid = route.jobId;
  const tabs = {};

  await traceClickTab("Inputs and Parameters");
  tabs.inputs = document.body.innerText || "";
  await traceClickTab("Outputs");
  tabs.outputs = document.body.innerText || "";
  await traceClickTab("Metadata");
  tabs.metadata = document.body.innerText || "";
  await traceClickTab("Overview");
  tabs.overview = document.body.innerText || "";

  const allText = Object.values(tabs).join("\n");
  const sourceText = `${tabs.inputs}\n${tabs.metadata}`;
  const job = {
    uid,
    uid_num: traceJobNum(uid),
    project_uid: projectId,
    job_type: traceGuessJobType(allText),
    title: (allText.match(/New Job\s+J\d+/i) || [uid])[0],
    status: /completed/i.test(allText) ? "completed" : "",
    particle_count: traceMaxNumberBeforeWord(allText, ["particles", "particle"]),
    micrograph_count: traceMaxNumberBeforeWord(allText, ["micrographs", "micrograph", "exposures"]),
    pixel_size_A: tracePixelSizeFromText(allText),
    volume_count: /volume|map/i.test(allText) ? 1 : null,
    raw_text_length: allText.length,
    tabs,
    sources: traceExtractSources(sourceText, uid)
  };
  job.class_splits = traceClassSplitsFromText(job, baseUrl);
  return job;
}

function traceImportance(job, startUid) {
  if (job.uid === startUid && !/nonuniform_refine/i.test(job.job_type || "")) return "final";
  if (TRACE_MAJOR_TYPES.has(job.job_type)) return "major";
  if (TRACE_SMALL_TYPES.has(job.job_type)) return "small";
  if (job.particle_count || job.volume_count) return "major";
  return "small";
}

function traceFocusedMermaid(nodes, edges, startUid) {
  const lines = ["flowchart LR"];
  const sorted = Array.from(nodes.values()).sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0));
  for (const job of sorted) {
    const label = [job.uid, job.job_type || "", job.particle_count ? `${job.particle_count} particles` : "", job.micrograph_count ? `${job.micrograph_count} micrographs` : ""]
      .filter(Boolean)
      .join("<br/>")
      .replace(/"/g, "'");
    const cls = traceImportance(job, startUid);
    lines.push(cls === "final" ? `  ${job.uid}[["${label}"]]` : `  ${job.uid}["${label}"]`);
    lines.push(`  class ${job.uid} ${cls};`);
  }

  const merged = new Map();
  for (const edge of edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const key = `${edge.source}->${edge.target}`;
    if (!merged.has(key)) merged.set(key, { source: edge.source, target: edge.target, kinds: new Set() });
    for (const kind of edge.kinds || ["parent"]) merged.get(key).kinds.add(kind);
  }

  const labels = { particle: "particles", volume: "map", mask: "mask", exposure: "micrographs", template: "template", parent: "parent" };
  const order = ["particle", "volume", "mask", "template", "exposure", "parent"];
  for (const item of merged.values()) {
    const label = order.filter((kind) => item.kinds.has(kind)).map((kind) => labels[kind]).join(" + ");
    lines.push(`  ${item.source} -- "${label || "source"}" --> ${item.target}`);
  }

  lines.push("  classDef final fill:#fee2e2,stroke:#b91c1c,stroke-width:3px,color:#111827;");
  lines.push("  classDef major fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#111827;");
  lines.push("  classDef small fill:#f3f4f6,stroke:#9ca3af,stroke-width:1px,color:#4b5563,font-size:11px;");
  return `${lines.join("\n")}\n`;
}

function traceMapUrls(baseUrl, projectId, jobUid) {
  return Object.fromEntries(TRACE_MAP_SUFFIXES.map((suffix) => [
    suffix,
    `${baseUrl}/api/log_image/download_result_file/${projectId}/${jobUid}.${suffix}`
  ]));
}

function traceOutputGroups(job, type) {
  const groups = Array.isArray(job.output_result_groups) ? job.output_result_groups : [];
  return type ? groups.filter((group) => group.type === type) : groups;
}

function traceMaxGroupNumItems(job, type) {
  const values = traceOutputGroups(job, type)
    .map((group) => group.num_items)
    .filter((value) => Number.isInteger(value));
  return values.length ? Math.max(...values) : null;
}

function traceParamSpecNumber(job, names) {
  const params = (job && job.params_spec) || {};
  for (const name of names) {
    const entry = params[name];
    const value = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function traceOutputSummaryNumber(job, patterns) {
  for (const group of traceOutputGroups(job)) {
    const summary = group && group.summary && typeof group.summary === "object" ? group.summary : {};
    for (const [key, value] of Object.entries(summary)) {
      if (!patterns.some((pattern) => pattern.test(key))) continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function tracePixelSizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100
    ? Math.round(number * 10000) / 10000
    : null;
}

function tracePixelSizeFromJob(job) {
  return tracePixelSizeNumber(traceOutputSummaryNumber(job, [/psize[_-]?A$/i, /pixel[^a-z0-9]*size/i])) ||
    tracePixelSizeNumber(traceParamSpecNumber(job, ["psize_A", "pixel_size_A", "pixel_size", "micrograph_pixel_size_A"]));
}

function traceMetadataJobNode(job) {
  return {
    uid: job.uid,
    uid_num: job.uid_num || traceJobNum(job.uid),
    project_uid: job.project_uid,
    job_type: job.job_type || "",
    title: job.title || "",
    status: job.status || "",
    created_at: job.created_at,
    completed_at: job.completed_at,
    parents: job.parents || [],
    children: job.children || [],
    particle_count: traceMaxGroupNumItems(job, "particle"),
    micrograph_count: traceMaxGroupNumItems(job, "exposure"),
    pixel_size_A: tracePixelSizeFromJob(job),
    volume_count: traceMaxGroupNumItems(job, "volume")
  };
}

function traceMetadataEdgeKind(edge) {
  if (["particle", "volume", "mask", "template", "exposure"].includes(edge.input_type)) return edge.input_type;
  const types = (edge.slots || []).map((slot) => slot.result_type || "").join(" ");
  for (const kind of ["particle", "volume", "mask", "template", "exposure"]) {
    if (types.includes(kind)) return kind;
  }
  return edge.input_type || "parent";
}

function traceMetadataConnectionEdges(job) {
  const edges = [];
  for (const inputGroup of job.input_slot_groups || []) {
    for (const connection of inputGroup.connections || []) {
      if (!connection.job_uid) continue;
      const edge = {
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
      };
      edge.kind = traceMetadataEdgeKind(edge);
      edge.kinds = [edge.kind];
      edges.push(edge);
    }
  }
  return edges;
}

function traceMetadataFallbackParentEdges(job, explicitSources) {
  return (job.parents || [])
    .filter((uid) => !explicitSources.has(uid))
    .map((uid) => ({
      source: uid,
      target: job.uid,
      input_type: "parent",
      input_name: "parent",
      input_title: "Parent job",
      source_group: null,
      slots: [],
      kind: "parent",
      kinds: ["parent"]
    }));
}

function traceParseClassIndex(name) {
  const match = String(name || "").match(/class[_-](\d+)/);
  return match ? Number(match[1]) : null;
}

function traceMetadataClassSplits(job, baseUrl) {
  const type = job.job_type || "";
  if (!type.includes("abinit") && !type.includes("hetero")) return [];

  let total = null;
  const classes = new Map();

  for (const group of traceOutputGroups(job, "particle")) {
    if (group.name === "particles_all_classes") {
      total = group.num_items;
      continue;
    }
    const idx = traceParseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    classes.get(idx).particle_count = group.num_items;
  }

  for (const group of traceOutputGroups(job, "volume")) {
    const idx = traceParseClassIndex(group.name);
    if (idx === null) continue;
    if (!classes.has(idx)) classes.set(idx, {});
    const entry = classes.get(idx);
    entry.volume_group = group.name;
    entry.maps = (group.contains || [])
      .filter((item) => item.type === "volume.blob")
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
    maps: (entry.maps || []).filter((item) => item.result_name === "map")
  }));
}

function tracePreview(summary) {
  const lines = [];
  lines.push(`${summary.project_uid}/${summary.start_uid}`);
  lines.push(`来源：按需打开上游 Job Metadata`);
  lines.push(`最终颗粒数：${summary.final_particle_count ?? "待确认"}`);
  lines.push(`照片/micrograph 数：${summary.final_micrograph_count ?? "上游节点中查看"}`);
  lines.push("");
  lines.push("读取到的节点：");
  for (const node of summary.nodes) {
    lines.push(`- ${node.uid} ${node.job_type || "unknown"} particles=${node.particle_count ?? "?"} micrographs=${node.micrograph_count ?? "?"}`);
  }
  lines.push("");
  lines.push("Ab / Hetero class:");
  for (const item of summary.class_split_jobs) {
    lines.push(`- ${item.uid} ${item.job_type}`);
    for (const cls of item.classes) {
      lines.push(`  class ${cls.class_index}: ${cls.particle_count || "?"} particles (${cls.particle_percent ?? "?"}%)`);
    }
  }
  return lines.join("\n");
}

function tracePadIteration(iteration) {
  return String(iteration).padStart(3, "0");
}

function traceFinalGraphFolderName(target, iteration) {
  const iter = tracePadIteration(iteration);
  return /\s/.test(target.folderPrefix)
    ? `${target.folderPrefix} ${iter}`
    : `${target.folderPrefix}_${iter}`;
}

function traceDecodeEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function traceFinalMapFileName(jobInfo, suffix) {
  return `BJ.${jobInfo.projectId}.${jobInfo.jobId}.${suffix}.mrc`;
}

function traceFinalEnsureGraphRecord(store, target, iteration) {
  const key = `${target.key}:${iteration}`;
  if (!store.has(key)) {
    store.set(key, {
      key: target.key,
      title: target.title,
      iteration,
      links: {},
      texts: []
    });
  }
  return store.get(key);
}

function traceFinalFindLogContainer(anchor) {
  let node = anchor;
  for (let depth = 0; node && depth < 8; depth += 1) {
    if (node.matches && node.matches("tr, li, .column, .q-item, .q-card, .row, [class*='log'], [class*='item']")) {
      const text = node.innerText || "";
      if (/Iteration\s+\d{1,4}|Selected\s+\d+\s+classes|Guinier|FSC/i.test(text)) return node;
    }
    node = node.parentElement;
  }
  return anchor.closest("tr") || anchor.closest("li") || anchor.parentElement;
}

function traceFinalHarvestGraphCandidates(store) {
  const anchors = Array.from(document.querySelectorAll('a[href*="/api/log_image/"]'))
    .filter((anchor) => !anchor.href.includes("/download_result_file/"));

  for (const anchor of anchors) {
    const label = (anchor.innerText || anchor.textContent || "").toLowerCase();
    const container = traceFinalFindLogContainer(anchor);
    const text = container ? (container.innerText || "") : "";

    for (const target of TRACE_FINAL_GRAPH_TARGETS) {
      const titleRegex = new RegExp(target.titleRegex.source, "i");
      const titleMatch = text.match(titleRegex);
      if (!titleMatch) continue;

      let ext = "";
      const extMatch = label.match(/\[(png|pdf|txt|xml)\]|\b(png|pdf|txt|xml)\b/i);
      if (extMatch) {
        ext = (extMatch[1] || extMatch[2] || "").toLowerCase();
      } else if (container) {
        const containerAnchors = Array.from(container.querySelectorAll('a[href*="/api/log_image/"]'))
          .filter((item) => !item.href.includes("/download_result_file/"));
        const afterTitle = text.slice((titleMatch.index || 0) + titleMatch[0].length, (titleMatch.index || 0) + titleMatch[0].length + 260);
        const labels = Array.from(afterTitle.matchAll(/\[(png|pdf|txt|xml)\]|\b(png|pdf|txt|xml)\b/gi))
          .map((match) => (match[1] || match[2] || "").toLowerCase())
          .filter((item) => target.exts.includes(item));
        const index = containerAnchors.indexOf(anchor);
        if (index >= 0 && labels[index]) ext = labels[index];
      }
      if (!target.exts.includes(ext)) continue;

      const record = traceFinalEnsureGraphRecord(store, target, Number(titleMatch[1]));
      record.links[ext] = traceAbsoluteUrl(anchor.getAttribute("href") || anchor.href);
      const cleanText = text.replace(/\s+/g, " ").trim();
      if (cleanText && !record.texts.includes(cleanText)) record.texts.push(cleanText);
    }
  }
}

function traceFinalHasOverviewLogs() {
  const bodyText = document.body ? document.body.innerText || "" : "";
  return Boolean(
    document.querySelector('[id^="logs-"]') ||
    document.querySelector('a[href*="/api/log_image/"]') ||
    /Job complete|Start Iteration|Iteration\s+\d{1,4}|Guinier|FSC/i.test(bodyText)
  );
}

async function traceFinalWaitForOverviewLogs(timeoutMs = 45000) {
  const started = Date.now();
  let previousLength = 0;
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    const textLength = (document.body && document.body.innerText || "").length;
    if (textLength !== previousLength) {
      previousLength = textLength;
      stableSince = Date.now();
    }
    if (traceFinalHasOverviewLogs() && Date.now() - stableSince > 700) return true;
    await traceSleep(350);
  }
  return traceFinalHasOverviewLogs();
}

async function traceFinalScanGraphsByScrolling(store) {
  await traceFinalWaitForOverviewLogs();
  traceFinalHarvestGraphCandidates(store);

  for (const label of ["Show from top", "Show from bottom"]) {
    const button = traceFindClickableByText(label);
    if (button) {
      button.click();
      await traceSleep(900);
      traceFinalHarvestGraphCandidates(store);
    }
  }

  const scrollers = traceScrollableElements().slice(0, 5);
  for (const scroller of scrollers) {
    const maxTop = traceGetMaxScrollTop(scroller);
    if (maxTop <= 0) continue;
    const amount = Math.max(260, Math.floor((scroller.clientHeight || window.innerHeight) * 0.72));

    traceSetScrollTop(scroller, 0);
    await traceSleep(220);
    let stalled = 0;
    let previousTop = -1;
    for (let step = 0; step < 180; step += 1) {
      traceFinalHarvestGraphCandidates(store);
      const currentTop = traceGetScrollTop(scroller);
      if (currentTop >= maxTop - 4) break;
      traceSetScrollTop(scroller, Math.min(maxTop, currentTop + amount));
      await traceSleep(120);
      const nextTop = traceGetScrollTop(scroller);
      if (Math.abs(nextTop - previousTop) < 3) stalled += 1;
      else stalled = 0;
      previousTop = nextTop;
      if (stalled >= 6) break;
    }
  }

  traceFinalHarvestGraphCandidates(store);
}

function traceFinalResolutionFromText(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:FSC|resolution|res)[^0-9]{0,60}([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:Å|A\b|angstrom)[^.;]{0,80}(?:FSC|resolution|res)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = match && Number(match[1]);
    if (Number.isFinite(number) && number >= 1 && number <= 20) return Math.round(number * 100) / 100;
  }
  return null;
}

function traceFinalBFactorFromText(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:B[-\s]*factor|bfactor)[^-\d]{0,40}(-?\d+(?:\.\d+)?)/i,
    /(?:estimated\s+B)[^-\d]{0,40}(-?\d+(?:\.\d+)?)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = match && Number(match[1]);
    if (Number.isFinite(number) && Math.abs(number) <= 10000) return Math.round(number * 100) / 100;
  }
  return null;
}

function traceFinalCollectGraphItemsFromStore(store, warnings) {
  const items = [];
  const missingRequired = [];
  const graphs = {};
  const metrics = {
    fsc_resolution_A: null,
    guinier_b_factor: null
  };

  for (const target of TRACE_FINAL_GRAPH_TARGETS) {
    const latest = Array.from(store.values())
      .filter((candidate) => candidate.key === target.key)
      .filter((candidate) => target.exts.every((ext) => candidate.links[ext]))
      .sort((a, b) => b.iteration - a.iteration)[0];

    if (!latest) {
      warnings.push(`未找到完整的 ${target.title} 文件组。`);
      missingRequired.push(target.title);
      continue;
    }

    const combinedText = latest.texts.join(" | ");
    graphs[target.key] = {
      title: target.title,
      iteration: latest.iteration,
      links: latest.links,
      text: combinedText.slice(0, 4000)
    };
    if (target.key === "fsc") metrics.fsc_resolution_A = traceFinalResolutionFromText(combinedText);
    if (target.key === "guinier") metrics.guinier_b_factor = traceFinalBFactorFromText(combinedText);

    const folderName = traceFinalGraphFolderName(target, latest.iteration);
    for (const ext of target.exts) {
      items.push({
        kind: "graph",
        group: target.key,
        iteration: latest.iteration,
        url: latest.links[ext],
        relativePath: `${folderName}/${target.fileBase}.${ext}`
      });
    }
  }

  return { items, missingRequired, graphs, metrics };
}

function traceFinalCollectMapItems(jobInfo, warnings) {
  const items = [];
  const anchors = Array.from(document.querySelectorAll('a[href*="/api/log_image/download_result_file/"]'));
  const linkBySuffix = new Map();

  for (const anchor of anchors) {
    const href = anchor.href;
    const fileName = traceDecodeEntities(decodeURIComponent(href.split("/").pop() || ""));
    if (!fileName.startsWith(`${jobInfo.jobId}.`)) continue;

    for (const target of TRACE_FINAL_MAP_TARGETS) {
      if (fileName === `${jobInfo.jobId}.${target.suffix}`) {
        linkBySuffix.set(target.suffix, href);
      }
    }
  }

  for (const target of TRACE_FINAL_MAP_TARGETS) {
    const constructed = `${location.origin}/api/log_image/download_result_file/${jobInfo.projectId}/${jobInfo.jobId}.${target.suffix}`;
    const url = linkBySuffix.get(target.suffix) || constructed;
    items.push({
      kind: "final_map",
      suffix: target.suffix,
      url,
      relativePath: `Map/${traceFinalMapFileName(jobInfo, target.suffix)}`
    });
  }

  if (linkBySuffix.size === 0) {
    warnings.push("当前页面未显示最终 Map 的 Outputs 链接，已按 Project/Job 自动拼接最终 Map 地址。");
  }

  return items;
}

async function traceScanFinalResults(projectId, startJob) {
  const startUid = traceNormalizeJob(startJob);
  let route = traceRoute();
  const pid = projectId || route.projectId;
  if (!pid) throw new Error("没有识别到 Project ID。请在 CryoSmart 项目或 Job 页面运行。");
  let experimentId = route.experimentId;

  if (route.jobId !== startUid) {
    const opened = await traceOpenJob(startUid, pid, experimentId);
    if (!opened) throw new Error(`没有打开最终 Job ${startUid}；请先停在 CryoSmart 项目页或目标 Job 页面。`);
  }

  route = traceRoute();
  experimentId = route.experimentId || experimentId;
  await traceClickTab("Overview");

  const warnings = [];
  const graphStore = new Map();
  await traceFinalScanGraphsByScrolling(graphStore);
  const graphResult = traceFinalCollectGraphItemsFromStore(graphStore, warnings);
  const jobInfo = {
    projectId: pid,
    experimentId: experimentId || route.experimentId || "",
    jobId: startUid
  };

  return {
    ok: true,
    projectId: pid,
    experimentId: jobInfo.experimentId,
    jobId: startUid,
    baseUrl: location.origin,
    items: [
      ...graphResult.items,
      ...traceFinalCollectMapItems(jobInfo, warnings)
    ],
    graphs: graphResult.graphs,
    metrics: graphResult.metrics,
    missingRequired: graphResult.missingRequired,
    warnings
  };
}

async function traceLineageFromPage(startJob, requestedProject) {
  const startUid = traceNormalizeJob(startJob);
  let route = traceRoute();
  const projectId = requestedProject || route.projectId;
  const baseUrl = location.origin;
  const nodes = new Map();
  const rawJobs = new Map();
  const edges = [];
  const queue = [startUid];
  const enqueued = new Set(queue);
  let experimentId = route.experimentId;

  for (let step = 0; queue.length && step < 80; step += 1) {
    const uid = queue.shift();
    const opened = await traceOpenJob(uid, projectId, experimentId);
    if (!opened) {
      nodes.set(uid, {
        uid,
        uid_num: traceJobNum(uid),
        project_uid: projectId,
        job_type: "",
        title: uid,
        status: "not_opened",
        particle_count: null,
        micrograph_count: null,
        sources: []
      });
      continue;
    }
    route = traceRoute();
    experimentId = route.experimentId || experimentId;
    const overviewAssets = await traceReadCurrentOverviewAssets();
    const item = await traceReadCurrentMetadataJob(projectId);
    const job = item.job;
    if (overviewAssets && Object.keys(overviewAssets).length) {
      job.overview_assets = overviewAssets;
    }
    rawJobs.set(uid, job);
    nodes.set(uid, traceMetadataJobNode(job));

    const explicit = traceMetadataConnectionEdges(job);
    const sources = new Set(explicit.map((edge) => edge.source));
    const jobEdges = explicit.concat(traceMetadataFallbackParentEdges(job, sources));
    edges.push(...jobEdges);

    for (const edge of jobEdges) {
      if (!enqueued.has(edge.source)) {
        queue.push(edge.source);
        enqueued.add(edge.source);
      }
    }
  }

  const startNode = nodes.get(startUid) || {};
  const nodeList = Array.from(nodes.values()).sort((a, b) => (a.uid_num || 0) - (b.uid_num || 0));
  const importJobs = nodeList.filter((job) => /import_micrographs/.test(job.job_type || "") || !(job.parents || []).length);
  const classJobs = Array.from(rawJobs.values())
    .map((job) => ({ uid: job.uid, job_type: job.job_type, classes: traceMetadataClassSplits(job, baseUrl) }))
    .filter((item) => item.classes.length);
  const summary = {
    ok: true,
    source: "metadata-lineage-page-crawl",
    project_uid: projectId,
    base_url: baseUrl,
    experiment_uid: experimentId,
    start_uid: startUid,
    start_job: startNode,
    final_particle_count: startNode.particle_count ?? null,
    final_micrograph_count: startNode.micrograph_count ?? null,
    final_resolution_A: null,
    resolution_note: "按需 metadata 追溯模式暂未解析 FSC 分辨率。",
    map_download_urls: traceMapUrls(baseUrl, projectId, startUid),
    nodes: nodeList,
    edges,
    raw_jobs: Array.from(rawJobs.values()).sort((a, b) => (a.uid_num || traceJobNum(a.uid)) - (b.uid_num || traceJobNum(b.uid))),
    import_or_leaf_jobs: importJobs,
    class_split_jobs: classJobs,
    focused_mermaid: traceFocusedMermaid(nodes, edges, startUid)
  };
  summary.preview = tracePreview(summary);
  return summary;
}

function traceBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}

async function traceFetchAsset(url) {
  if (!url) throw new Error("missing asset url");
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const blob = await response.blob();
  return {
    url,
    status: response.status,
    content_type: blob.type || response.headers.get("content-type") || "",
    size: blob.size,
    data_url: await traceBlobToDataUrl(blob)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["traceCryoSmartLineageFromPage", "exportCryoSmartProjectMetadata", "scanCryoSmartFinalResults", "fetchCryoSmartAsset"].includes(message.action)) return false;
  let task;
  if (message.action === "fetchCryoSmartAsset") {
    task = traceFetchAsset(message.url);
  } else if (message.action === "exportCryoSmartProjectMetadata") {
    task = traceExportProjectMetadata(message.projectId);
  } else if (message.action === "scanCryoSmartFinalResults") {
    task = traceScanFinalResults(message.projectId, message.startJob);
  } else {
    task = traceLineageFromPage(message.startJob, message.projectId);
  }
  task
    .then((summary) => sendResponse({ ok: true, summary }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
