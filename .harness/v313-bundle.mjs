/**
 * v3.13 headless bundle E2E — the user's EXACT broken download, replayed
 * with the fix:
 *
 *   "打包下载时出现了这些错误，导致结果包中缺失了很多内容"
 *   247 warnings: 221 × `Image images/… failed: CryoSmart 404 for
 *   /api/cryosmart/import/session/<token>/image/<fileid>: {"detail":"Not
 *   Found"}` + 26 × `Map … failed: CryoSmart 502 … aborted due to timeout`.
 *
 * Root causes fixed in v3.13:
 *   (1) bundle.ts forwarded session-image URLs through the CryoSmart proxy
 *       (→ FastAPI 404 on the CryoSmart server). They are fetched
 *       same-origin now — every image whose bytes were uploaded MUST land
 *       in the ZIP.
 *   (2) Maps went through the proxy with a 10s abort; when the app server
 *       cannot reach the intranet (this deployment) they all failed after
 *       grinding timeouts. Now: ONE reachability probe, fail-fast skip,
 *       and maps/DOWNLOAD_LINKS.txt carries the direct intranet URLs.
 *
 * Also verified end-to-end: the numbered-series collapse ("Per particle
 * scale factors 000–007" → only 007) in the built summary.
 *
 * Run: bun .harness/v313-bundle.mjs   (dev server must be on :3000)
 */
const APP = "http://localhost:3000";
const CRYO = "http://192.168.0.99:8080"; // unreachable intranet (as in the cloud preview)

// Relative fetches inside bundle/proxy-client must hit the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" && input.startsWith("/") ? APP + input : input;
  return realFetch(url, init);
};

const { buildBundle } = await import("../src/lib/cryosmart/bundle.ts");
const { buildSummary } = await import("../src/lib/cryosmart/lineage.ts");

// 1×1 PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const PNG_BYTES = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid,
  project_uid: "PX5",
  job_type,
  title: `${uid} ${job_type}`,
  status: "completed",
  created_at: NOW,
  completed_at: NOW,
  parents,
  children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles", type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [],
  params_spec: {},
  output_group_images: {},
  ui_tile_images: [],
});

const jobs = [
  mkJob("J1", "import_movies", []),
  mkJob("J2", "class_2D", ["J1"]),
  mkJob("J3", "hetero_refine", ["J2"]),
  mkJob("J4", "nonuniform_refine_new", ["J3"]),
];

// J4 (end/start job): numbered-series refs + iteration refs; J2: plain refs.
// Uploaded bytes: all J4/J2 refs EXCEPT one (dead ref → direct URL → skip).
const j4Refs = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
    fileid: `sf_${n}`,
    name: `Per particle scale factors ${String(n).padStart(3, "0")}`,
    text: `Per particle scale factors ${String(n).padStart(3, "0")}`,
  })),
  { fileid: "rs_000", name: "Real Space Slices Iteration 000", text: "Real Space Slices Iteration 000" },
  { fileid: "rs_008", name: "Real Space Slices Iteration 008", text: "Real Space Slices Iteration 008" },
  { fileid: "dead_ref", name: "Never Uploaded Plot", text: "Never Uploaded Plot" },
];
const j2Refs = [
  { fileid: "j2_avg", name: "class averages", text: "class averages" },
  { fileid: "j2_sel", name: "templates_selected", text: "Selected 21 classes" },
];
// J4 volume/mask outputs → map download URLs (the 26-map scenario).
jobs[3].output_result_groups = [
  { name: "volume", type: "volume", title: "volume", contains: [
    { type: "volume.blob", name: "map" },
    { type: "volume.blob", name: "map_sharp" },
    { type: "volume.blob", name: "map_half_A" },
    { type: "volume.blob", name: "map_half_B" },
  ]},
  { name: "mask", type: "mask", title: "mask", contains: [
    { type: "volume.blob", name: "mask_refine" },
  ]},
];
jobs[3].output_group_images = { volume: "vol_prev", fsc: "fsc_prev" };
jobs[2].output_group_images = {
  volume_class_0: "vc0_prev", volume_class_1: "vc1_prev", volume_class_2: "vc2_prev",
};

// ── 1. create the staged session and stream jobs + bytes ────────────
const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX5",
    cryosmart_origin: CRYO,
    cryosmart_auth: "Bearer sim",
    cryosmart_cookie: "session=sim",
    source: "sim",
    end_job_uid: "J4",
    lineage_mode: true,
  }),
})).json();
const token = created.token;
console.log("session:", token);

await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX5", jobs }),
});

await fetch(`${APP}/api/cryosmart/import/session/${token}/logs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    items: [
      { uid: "J4", images: j4Refs },
      { uid: "J2", images: j2Refs },
    ],
  }),
});

// Upload bytes for everything except `dead_ref` (and its 7 dead siblings —
// only sf_7 stays alive after the collapse, but upload ALL so the pre-fix
// behaviour would have fetched them all anyway).
const byteItems = [
  ...j4Refs.filter((r) => r.fileid !== "dead_ref"),
  ...j2Refs,
  { fileid: "vol_prev" }, { fileid: "fsc_prev" },
  { fileid: "vc0_prev" }, { fileid: "vc1_prev" }, { fileid: "vc2_prev" },
].map((r) => ({
  fileid: r.fileid,
  data: `data:image/png;base64,${PNG_B64}`,
  name: r.name || null,
}));
const upResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/images`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: byteItems }),
})).json();
check(`byte upload stored ${upResp.stored}/${byteItems.length}`, upResp.stored === byteItems.length);

await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});

// ── 2. fetch /data and decorate like the app does (mergeLogImagesIntoRaw) ──
const dataResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
const uploaded = new Set(dataResp.data.uploaded_image_ids);
const sessionBase = `/api/cryosmart/import/session/${token}/image/`;
const jobLogImages = dataResp.data.job_log_images;
const decorated = dataResp.data.jobs.map((job) => {
  const out = { ...job };
  if (Array.isArray(jobLogImages[job.uid])) {
    out.log_images = jobLogImages[job.uid].map((r) => ({
      ...r,
      src: uploaded.has(r.fileid) ? sessionBase + encodeURIComponent(r.fileid) : undefined,
    }));
  }
  if (out.output_group_images) {
    const ogi = {};
    for (const [k, v] of Object.entries(out.output_group_images)) {
      ogi[k] = uploaded.has(v) ? sessionBase + encodeURIComponent(v) : v;
    }
    out.output_group_images = ogi;
  }
  return out;
});

// ── 3. build the summary (collapse happens inside buildSummary) ─────
const summary = buildSummary(decorated, "PX5", "J4", CRYO);
const j4Node = summary.nodes.find((n) => n.uid === "J4");
const j4Names = (j4Node?.images || []).filter((i) => i.kind === "log_image").map((i) => i.name);
console.log("J4 log images after collapse:", j4Names.join(" | "));
check("summary collapses scale factors to only 007",
  j4Names.filter((n) => n.includes("scale factors")).length === 1 &&
  j4Names.some((n) => n.includes("007")));
check("summary keeps only Iteration 008", j4Names.some((n) => n.includes("Iteration 008")) &&
  !j4Names.some((n) => n.includes("Iteration 000")));

// ── 4. build the bundle with an UNREACHABLE CryoSmart origin ─────────
const t0 = Date.now();
const result = await buildBundle(
  summary,
  {
    includePptx: false,
    includeImages: true,
    includeMaps: true,
    includeFinalResults: false,
    session: { baseUrl: CRYO, cookie: "session=sim", auth: "Bearer sim" },
  },
  (p) => { if (p.phase !== "images" || p.current % 5 === 0) process.stdout.write(`    [${p.phase}] ${p.message}\r\x1b[K`); }
);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nbundle: ${result.filename} · ${result.fileCount} files · ${secs}s · ${result.warnings.length} warning(s)`);

// Parse the STORE-only ZIP: collect entry names from local file headers.
const zipBuf = new Uint8Array(await result.blob.arrayBuffer());
const names = [];
for (let i = 0; i < zipBuf.length - 30; i++) {
  if (zipBuf[i] === 0x50 && zipBuf[i + 1] === 0x4b && zipBuf[i + 2] === 0x03 && zipBuf[i + 3] === 0x04) {
    const nameLen = (zipBuf[i + 27] << 8) | zipBuf[i + 26];
    names.push(String.fromCharCode(...zipBuf.subarray(i + 30, i + 30 + nameLen)));
    i += 29 + nameLen; // skip past the header (data length unknown here; scan continues)
  }
}
console.log("ZIP entries:", names.length);
names.sort();

const imageEntries = names.filter((n) => n.startsWith("images/"));
const mapLinkIdx = names.indexOf("maps/DOWNLOAD_LINKS.txt");
const notUploadedIdx = names.indexOf("images/NOT_UPLOADED_LINKS.txt");

check("session-byte images land in the ZIP (the 221-image fix)",
  imageEntries.some((n) => n.includes("Per_particle_scale_factors_007")) &&
  imageEntries.some((n) => n.includes("Real_Space_Slices_Iteration_008")) &&
  imageEntries.some((n) => n.includes("class_averages")) &&
  imageEntries.some((n) => n.includes("Selected_21_classes")),
  JSON.stringify(imageEntries));
check("volume/fsc map previews land in the ZIP", imageEntries.some((n) => n.includes("volume.png")) && imageEntries.some((n) => n.includes("fsc.png")));
check("hetero class previews land in the ZIP (volume_class_0/1/2)",
  imageEntries.some((n) => n.includes("volume_class_0")) &&
  imageEntries.some((n) => n.includes("volume_class_1")) &&
  imageEntries.some((n) => n.includes("volume_class_2")));
check("no pre-collapse scale-factor rounds in the ZIP",
  !imageEntries.some((n) => /scale_factors_00[0-6]\.png$/.test(n)) &&
  !imageEntries.some((n) => n.includes("Iteration_000")));
check("maps/DOWNLOAD_LINKS.txt present (unreachable upstream)", mapLinkIdx !== -1);
check("images/NOT_UPLOADED_LINKS.txt present for the dead ref", notUploadedIdx !== -1);
check("warnings explain the unreachable-upstream skip",
  result.warnings.some((w) => /unreachable/i.test(w)),
  JSON.stringify(result.warnings));
check("no per-image 404 spam (max a handful of warnings)", result.warnings.length <= 6,
  `${result.warnings.length}: ${JSON.stringify(result.warnings)}`);

// Extract and inspect the two links files.
const extractFile = (name) => {
  // Re-scan: local header + data (STORE → sizes in the header).
  for (let i = 0; i < zipBuf.length - 30; i++) {
    if (zipBuf[i] === 0x50 && zipBuf[i + 1] === 0x4b && zipBuf[i + 2] === 0x03 && zipBuf[i + 3] === 0x04) {
      const nameLen = (zipBuf[i + 27] << 8) | zipBuf[i + 26];
      const nm = String.fromCharCode(...zipBuf.subarray(i + 30, i + 30 + nameLen));
      if (nm === name) {
        const size = (zipBuf[i + 25] << 24) | (zipBuf[i + 24] << 16) | (zipBuf[i + 23] << 8) | zipBuf[i + 22];
        const start = i + 30 + nameLen;
        return new TextDecoder().decode(zipBuf.subarray(start, start + size));
      }
      i += 29 + nameLen;
    }
  }
  return null;
};
const mapLinks = extractFile("maps/DOWNLOAD_LINKS.txt");
check("map links file lists the .mrc URLs (volume + sharp/half maps + mask)",
  !!mapLinks && mapLinks.includes("J4.volume.map") && mapLinks.includes("J4.volume.map_sharp") &&
  mapLinks.includes("J4.volume.map_half_A") && mapLinks.includes("J4.mask.mask_refine") &&
  mapLinks.includes(`${CRYO}/api/log_image/download_result_file/`),
  mapLinks ? mapLinks.slice(0, 300) : "missing");
const notUploaded = extractFile("images/NOT_UPLOADED_LINKS.txt");
check("not-uploaded links file lists the dead ref's direct URL",
  !!notUploaded && notUploaded.includes("Never_Uploaded_Plot") && notUploaded.includes(`${CRYO}/api/log_image/dead_ref`),
  notUploaded ? notUploaded.slice(0, 300) : "missing");

// The report HTML must embed the session bytes (base64) and carry the
// local images/ paths for the ZIP context.
const report = names.find((n) => n.endsWith("_report.html"));
const reportHtml = report ? extractFile(report) : null;
check("report HTML embedded base64 session images", !!reportHtml && reportHtml.includes("data:image/png;base64,"));
check("report HTML shows Log images block", !!reportHtml && reportHtml.includes("Log images ("));
check("report HTML references local bundle image paths", !!reportHtml && reportHtml.includes('src="images/J4/'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
