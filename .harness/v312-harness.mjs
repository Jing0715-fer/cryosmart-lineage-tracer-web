/**
 * v3.12 harness — models the user's REAL failure from the latest
 * feedback: "24/24 jobs scanned · 128 images captured 但是graph和report中
 * 都没有加载出来图片". Session s46 evidence: log_images_count=128,
 * log_images_uploaded=0, uploaded_image_ids=[] — every /images POST
 * returned 200 yet ZERO bytes were stored.
 *
 * ROOT CAUSE: the real CryoSmart server serves /api/log_image/ responses
 * with NO Content-Type. fetchImageData allowed typeless blobs, and
 * Chrome's FileReader turns a typeless blob into
 * data:application/octet-stream;base64,... — which the store's
 * image/*-only regex rejected. The harness mock always sent
 * Content-Type: image/png, hiding the bug.
 *
 * This harness models the REAL server:
 *   - /api/log_image/<id> responses carry NO Content-Type (typeless blob)
 *   - one file is served WITH Content-Type: application/octet-stream
 *   - J46's refs have NO filetype field (only the .png filename hint)
 *
 * v3.12 script must: sniff the real type from the BYTES and upload valid
 * data:image/* URLs. The app store must ALSO accept octet-stream data URLs
 * whose bytes sniff as images (stale v3.10/v3.11 scripts get rescued).
 *
 * NEW in v3.12: map previews (output_group_images) and card tiles
 * (ui_tile_images) ride the same byte pipeline:
 *   J40: output_group_images { volume_map_sharp: J40_vol, half_map_A: J40_half_a }
 *   J41: ui_tile_images [ { name: 'tile.png', fileid: 'J41_tile' } ]
 *   J5 (NOT in lineage): output_group_images { decoy: J5_decoy } — never fetched
 *
 * PASS: 11 log refs (same expectations as v3.11) + 11 stored log bytes +
 *       3 asset ids stored + stale-script octet rescue (direct POST) +
 *       garbage-octet rejection + /image/<id> serves image/png +
 *       log_images_uploaded <= log_images_count + 0 J5_decoy fetches.
 */
import fs from "node:fs";

const APP = "http://localhost:3000";
const RC = console;

const panel = fs.readFileSync(
  "/home/z/my-project/src/app/components/cryosmart/smart-capture-panel.tsx",
  "utf8"
);
const start = panel.indexOf("const captureScript = `");
const end = panel.indexOf("`.trim();", start);
const raw = panel.slice(start + "const captureScript = `".length, end);
const captureScript = eval(("`" + raw + "`").replace("${webAppUrl}", "${APP}"));
RC.log("[harness] script:", captureScript.length, "chars · v3.12:", captureScript.includes("v3.12"));

const NOW = Date.now();
const jobs = [];
for (let i = 1; i <= 46; i++) {
  const types = ["import_movies", "motion_corr", "ctf_est", "select_2D", "class_2D", "homo_abinit", "hetero_refine", "nu_refine"];
  jobs.push({
    uid: "J" + i,
    job_type: types[i % types.length],
    status: "completed",
    title: "job " + i,
    created_at: new Date(NOW - (46 - i) * 3600e3).toISOString(),
    completed_at: new Date(NOW - (46 - i) * 3600e3 + 60e3).toISOString(),
    parents: i > 1 ? ["J" + (i - 1)] : [],
    children: i < 46 ? ["J" + (i + 1)] : [],
    input_slot_groups: i > 1 ? [{ source_group: "particles", source_job: "J" + (i - 1), input_name: "particles" }] : [],
    output_result_groups: [],
    params_spec: {},
    output_group_images: {},
    ui_tile_images: [],
  });
}
// Give the lineage jobs their scenario job types.
const typeOf = { J40: "nu_refine", J41: "hetero_refine", J42: "homo_abinit", J43: "select_2D", J44: "motion_corr", J45: "class_3d", J46: "nu_refine" };
for (const j of jobs) if (typeOf[j.uid]) j.job_type = typeOf[j.uid];
// v3.12: map previews + card tiles on lineage jobs (bytes must upload),
// plus a DECOY map on non-lineage J5 (must NEVER be fetched).
const j40 = jobs.find((j) => j.uid === "J40");
j40.output_group_images = { volume_map_sharp: "J40_vol", half_map_A: "J40_half_a" };
const j41 = jobs.find((j) => j.uid === "J41");
j41.ui_tile_images = [{ name: "tile.png", fileid: "J41_tile", num_cols: 1, num_rows: 1 }];
const j5 = jobs.find((j) => j.uid === "J5");
j5.output_group_images = { decoy: "J5_decoy" };

// ── The REAL-build model: ONE shared insert_events stream ──────────
const eventStream = [];
for (let i = 0; i < 340; i++) eventStream.push({ type: "text", text: "old event " + i });
for (let p = 1; p <= 5; p++) {
  eventStream.push({
    type: "image",
    job_uid: "P" + p,
    text: "Old view " + p,
    imgfiles: [{ fileid: "P" + p + "_old", filename: "old" + p + ".png" }],
  });
}

// J45's logs cached under a FULL-uid key (classic map shape).
const logsByJob = {
  "BJ.P259.J45": [
    { type: "text", text: "class 3d start" },
    { type: "image", text: "Class gallery", imgfiles: [
      { fileid: "J45_cls0", filename: "J45_class_000.png", filetype: "image/png" },
      { fileid: "J45_cls1", filename: "J45_class_001.png", filetype: "image/png" },
    ] },
  ],
};

const uidOf = (arg) => {
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) return typeof arg[0] === "string" ? arg[0] : null;
  if (arg && typeof arg === "object") {
    const u = arg.job_uid || arg.uid;
    return typeof u === "string" ? u : null;
  }
  return null;
};

/** One job's log delivery. withUid=false models uid-less insert_events. */
function entriesFor(uid, withUid) {
  const tag = (e) => (withUid ? { ...e, job_uid: uid } : e);
  const out = [];
  for (let k = 0; k < 12; k++) out.push(tag({ type: "text", text: "log line " + uid + "-" + k }));
  if (uid === "J40") {
    // nu_refine: one entry per ITERATION, all files per iteration.
    for (let it = 0; it <= 3; it++) {
      const n = String(it).padStart(3, "0");
      out.push(tag({ type: "image", text: "Iteration " + n, imgfiles: [
        { fileid: "J40_fsc_i" + it, filename: "J40_fsc_iter_" + n + ".png", filetype: "image/png" },
        { fileid: "J40_ang_i" + it, filename: "J40_angdist_iter_" + n + ".png", filetype: "image/png" },
        { fileid: "J40_xml_i" + it, filename: "J40_data_iter_" + n + ".xml", filetype: "text/xml" },
        { fileid: "J40_txt_i" + it, filename: "J40_result_iter_" + n + ".txt", filetype: "text/plain" },
        { fileid: "J40_pdf_i" + it, filename: "J40_report_iter_" + n + ".pdf", filetype: "application/pdf" },
      ] }));
    }
  } else if (uid === "J41") {
    // hetero_refine: images under `files`, NOT `imgfiles`.
    out.push(tag({ type: "image", text: "Class gallery", files: [
      { fileid: "J41_cls0", filename: "J41_class_000.png", filetype: "image/png" },
      { fileid: "J41_cls1", filename: "J41_class_001.png", filetype: "image/png" },
      { fileid: "J41_meta", filename: "J41_meta.xml", filetype: "application/xml" },
    ] }));
  } else if (uid === "J42") {
    // homo_abinit: class averages gallery.
    out.push(tag({ type: "image", text: "Class averages", imgfiles: [
      { fileid: "J42_avg0", filename: "J42_classavg_000.png", filetype: "image/png" },
      { fileid: "J42_avg1", filename: "J42_classavg_001.png", filetype: "image/png" },
    ] }));
  } else if (uid === "J43") {
    // select_2D re-run: same title twice, older round's fileid is dead.
    out.push(tag({ type: "image", text: "Selected 21 classes", imgfiles: [
      { fileid: "J43_sel_r1", filename: "sel.png", filetype: "image/png" },
      { fileid: "J43_report1", filename: "report.pdf", filetype: "pdf" },
    ] }));
    out.push(tag({ type: "image", text: "Selected 21 classes", imgfiles: [
      { fileid: "J43_sel_r2", filename: "sel.png", filetype: "image/png" },
      { fileid: "J43_report2", filename: "report.pdf", filetype: "pdf" },
    ] }));
    out.push(tag({ type: "image", text: "FSC plot", imgfiles: [{ fileid: "J43_fsc", filename: "fsc.png", filetype: "image/png" }] }));
  } else if (uid === "J45" || uid === "J44") {
    // J45: classic map (pre-populated above) — deliver nothing new.
    // J44: text-only (no image logs at all).
  } else if (uid === "J46") {
    // End job: UID-LESS, TITLE-LESS entries with iter-numbered file names,
    // delivered during its own loader call (tail attribution path).
    for (let it = 0; it <= 2; it++) {
      const n = String(it).padStart(3, "0");
      out.push({ type: "image", imgfiles: [
        { fileid: "J46_p" + it, filename: "J46_plot_iter_" + n + ".png" },
      ] });
    }
  } else {
    out.push(tag({ type: "image", text: "Selected classes", imgfiles: [
      { fileid: uid + "_sel", filename: "sel.png", filetype: "image/png" },
    ] }));
  }
  return out;
}

const loaded = {};   // loader cache: second call for the same uid is a no-op
const logStore = {
  $id: "logStore",
  $state: { events: eventStream, logsByJob },
  getLogsByJob(arg) {
    const uid = uidOf(arg);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!uid) { resolve(undefined); return; }
        if (loaded[uid]) { resolve(undefined); return; }   // cache-hit (re-run)
        loaded[uid] = true;
        // homo_abinit delivers LATE — past every per-job window (3.5s).
        const delay = uid === "J42" ? 3500 : 15;
        setTimeout(() => {
          eventStream.push(...entriesFor(uid, uid !== "J46"));
          resolve(undefined);   // logs arrive via "WebSocket", never returned
        }, delay);
        resolve(undefined);
      }, 15);
    });
  },
};
const projectsInMap = { PE2E: { uid: "PE2E", experiments: [{ uid: "EXP1", jobs }] } };
const socketStore = {
  $id: "socketStore",
  $state: { projectsInMap },
  projectsInMap,
  socketManager: { token: "test-token", ws: null },
};
const piniaStores = new Map([
  ["socketStore", socketStore],
  ["logStore", logStore],
]);
const qApp = {
  __vue_app__: {
    config: {
      globalProperties: {
        $pinia: { _s: piniaStores },
        $router: { currentRoute: { value: { params: {} } } },
      },
    },
  },
};

const logBuffer = [];
const clog = (...a) => logBuffer.push(a.map(String).join(" "));
globalThis.document = {
  querySelector: (sel) => (sel === "#q-app" ? qApp : null),
  cookie: "session=abc",
  createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }),
};
globalThis.window = {
  open: () => null,
  location: { origin: "http://192.168.202.11:8080", href: "http://192.168.202.11:8080/#/projects/PE2E/jobs/J46" },
  addEventListener() {},
};
globalThis.location = globalThis.window.location;
globalThis.alert = (m) => clog("[alert]", m);
globalThis.console = { log: clog, warn: clog, error: clog };
globalThis.FileReader = class {
  readAsDataURL(blob) {
    setTimeout(async () => {
      try {
        const buf =
          typeof blob?.bytes === "function"
            ? await blob.bytes()
            : Buffer.from(blob?.bytes ?? blob);
        this.result = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
        this.onload({ result: this.result });
      } catch (e) {
        if (this.onerror) this.onerror(e);
      }
    });
  }
};
globalThis.Blob = class {
  constructor(parts) { this.bytes = Buffer.from(parts[0]); this.size = this.bytes.length; this.type = "image/png"; }
  arrayBuffer() { return Promise.resolve(this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength)); }
};

const realFetch = globalThis.fetch;
const imageBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c626001000000ffff03000006000557bfabd4" +
  "0000000049454e44ae426082",
  "hex"
);
// Minimal JPEG magic (FF D8 FF E0 …) — used by one file to prove the
// sniffer picks jpeg, not a hard-coded png.
const jpegBytes = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000000000000000ffd9",
  "hex"
);
const logImageFetches = [];
globalThis.fetch = async function (url, opts) {
  const u = String(url);
  if (u.startsWith(APP)) {
    if (u.includes("/images") && opts?.method === "POST") {
      const body = JSON.parse(opts.body);
      const r = await realFetch(url, opts);
      const j = await r.clone().json().catch(() => null);
      RC.log("[harness] /images →", JSON.stringify(body.items.map((i) => i.fileid)), "⇐", JSON.stringify(j));
      return r;
    }
    return realFetch(url, opts);
  }
  if (u.startsWith("/api/log_image/")) {
    logImageFetches.push(u);
    if (u.includes("_r1")) return new Response("gone", { status: 404 });
    // THE REAL SERVER: NO Content-Type on most files (typeless blob);
    // J42_avg1 arrives with an explicit application/octet-stream type;
    // J43_fsc arrives as JPEG bytes — the sniffer must pick image/jpeg.
    if (u.includes("J42_avg1")) return new Response(imageBytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
    if (u.includes("J43_fsc")) return new Response(jpegBytes, { status: 200 });
    return new Response(imageBytes, { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

const LINEAGE = ["J40", "J41", "J42", "J43", "J44", "J45", "J46"];
const EXPECT_REFS = { J40: 2, J41: 2, J42: 2, J43: 2, J44: 0, J45: 2, J46: 1 };
const tokens = [];
function scanTokens() {
  for (const l of logBuffer) {
    const m = l.match(/Live progress page: .*imported=([^&\s]+)/);
    if (m && !tokens.includes(m[1])) tokens.push(m[1]);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sessionStatus(token) {
  try {
    const r = await realFetch(`${APP}/api/cryosmart/import/session/${token}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function awaitRun(label) {
  let token = null;
  for (let i = 0; i < 400 && !token; i++) { scanTokens(); token = tokens[0] || null; if (!token) await sleep(100); }
  if (!token) { RC.error(`[${label}] no session token`); process.exit(1); }
  RC.log(`[${label}] token: ${token}`);

  let requested = false;
  for (let i = 0; i < 300 && !requested; i++) {
    const st = await sessionStatus(token);
    if (st && st.has_data) {
      const resp = await realFetch(`${APP}/api/cryosmart/import/session/${token}/request-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: LINEAGE }),
      });
      const j = await resp.json();
      RC.log(`[${label}] request-logs posted →`, JSON.stringify(j.log_request));
      requested = true;
    } else await sleep(150);
  }
  if (!requested) { RC.error(`[${label}] jobs never landed`); process.exit(1); }

  // Wait for ALL 7 distinct jobs scanned AND the rescued refs (the rescue
  // streams a second batch for J42 after its late delivery).
  const TOTAL_REFS = Object.values(EXPECT_REFS).reduce((a, b) => a + b, 0);
  let ready = false;
  for (let i = 0; i < 600 && !ready; i++) {
    const st = await sessionStatus(token);
    if (st && st.log_jobs_done === LINEAGE.length && st.log_images_count >= TOTAL_REFS) ready = true;
    else await sleep(250);
  }
  if (!ready) RC.warn(`[${label}] never reached ${LINEAGE.length} scanned + ${TOTAL_REFS} refs`);

  try { globalThis.window.__csCaptureFinish(); } catch (e) { RC.warn(`[${label}] finish hook failed: ${e.message}`); }

  for (let i = 0; i < 600; i++) {
    const st = await sessionStatus(token);
    if (st && st.status === "complete") break;
    await sleep(250);
  }

  const d = await (await realFetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
  const perJob = d.data.job_log_images || {};
  const withLogs = Object.keys(perJob);
  const refs = withLogs.reduce((n, k) => n + perJob[k].length, 0);
  const uploaded = (d.data.uploaded_image_ids || []).length;
  RC.log(`[${label}] jobsWithLogs = ${withLogs.length} · refs = ${refs} · uploaded ids = ${uploaded}`);
  const foreign = [];
  for (const [uid, list] of Object.entries(perJob)) {
    for (const r of list) if (!String(r.fileid).startsWith(uid + "_")) foreign.push(uid + "←" + r.fileid);
  }
  if (foreign.length) RC.log(`[${label}] ⚠ FOREIGN refs: ${foreign.join(", ")}`);
  return { token, perJob, withLogs: withLogs.length, refs, uploaded, foreign };
}

const mod = new Function(captureScript + "\n//# sourceURL=v312.js");

(async () => {
  const p1 = awaitRun("run1");
  mod();
  const r1 = await p1;

  RC.log("\n===== RESULTS =====");
  RC.log(`run1: jobsWithLogs=${r1.withLogs} refs=${r1.refs} uploaded=${r1.uploaded} foreign=${r1.foreign.length}`);
  for (const uid of LINEAGE) {
    RC.log(`  ${uid}: ${JSON.stringify((r1.perJob[uid] || []).map((r) => r.fileid))}`);
  }
  const badFetches = logImageFetches.filter((u) => /_xml|_txt|_pdf|_report|_meta|_r1/.test(u));
  const decoyFetches = logImageFetches.filter((u) => u.includes("J5_decoy"));
  RC.log(`byte fetches total: ${logImageFetches.length} · non-image/dead fetches: ${badFetches.length} · decoy fetches: ${decoyFetches.length} (want 14/0/0)`);
  const rescueLine = logBuffer.some((l) => l.includes("Late logs arrived for J42"));
  const zeroRefNote = logBuffer.some((l) => l.includes("no log images") && l.includes("J44"));
  const doneNote = logBuffer.some((l) => l.includes("8/7"));   // must NOT exist
  RC.log(`rescue line for J42: ${rescueLine} · zero-ref note lists J44: ${zeroRefNote} · "8/7" bug: ${doneNote}`);

  // ── STALE-SCRIPT RESCUE: post bytes exactly as an old v3.10/v3.11
  // script would after fetching a TYPELESS response — the store must
  // sniff the PNG out of the octet-stream data URL and store it, while
  // rejecting non-image garbage outright.
  const pngB64 = imageBytes.toString("base64");
  const textB64 = Buffer.from("this is not an image, just text garbage").toString("base64");
  const staleResp = await realFetch(`${APP}/api/cryosmart/import/session/${r1.token}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { fileid: "stale_octet", data: `data:application/octet-stream;base64,${pngB64}`, name: "stale.png" },
      { fileid: "garbage_octet", data: `data:application/octet-stream;base64,${textB64}`, name: "garbage.txt" },
    ] }),
  });
  const staleJson = await staleResp.json();
  RC.log(`stale-script rescue POST → stored: ${staleJson.stored} (want 1 — garbage rejected)`);

  // ── SERVING CHECKS: stored bytes serve same-origin with a real image
  // Content-Type (the browser-facing half of the fix).
  const serve = async (id) => {
    const r = await realFetch(`${APP}/api/cryosmart/import/session/${r1.token}/image/${encodeURIComponent(id)}`);
    return { status: r.status, type: r.headers.get("content-type") };
  };
  const sVol = await serve("J40_vol");
  const sTile = await serve("J41_tile");
  const sFsc = await serve("J43_fsc");
  const sStale = await serve("stale_octet");
  const sGarbage = await serve("garbage_octet");
  RC.log(`serve → J40_vol: ${sVol.status} ${sVol.type} · J41_tile: ${sTile.status} ${sTile.type} · J43_fsc: ${sFsc.status} ${sFsc.type} · stale_octet: ${sStale.status} ${sStale.type} · garbage_octet: ${sGarbage.status}`);

  const finalData = await (await realFetch(`${APP}/api/cryosmart/import/session/${r1.token}/data`)).json();
  const ids = new Set(finalData.data.uploaded_image_ids || []);
  const assetsStored = ["J40_vol", "J40_half_a", "J41_tile", "stale_octet"].filter((id) => ids.has(id));
  RC.log(`uploaded ids: ${ids.size} · assets stored: ${assetsStored.join(",") || "NONE"} · log_images_uploaded=${finalData.log_images_uploaded} / log_images_count=${finalData.log_images_count}`);

  const perJobOk = LINEAGE.every((uid) => (r1.perJob[uid] || []).length === EXPECT_REFS[uid]);
  const j40Ok = JSON.stringify((r1.perJob.J40 || []).map((r) => r.fileid)) === JSON.stringify(["J40_fsc_i3", "J40_ang_i3"]);
  const j46Ok = JSON.stringify((r1.perJob.J46 || []).map((r) => r.fileid)) === JSON.stringify(["J46_p2"]);
  const j43Ok = JSON.stringify((r1.perJob.J43 || []).map((r) => r.fileid)) === JSON.stringify(["J43_sel_r2", "J43_fsc"]);
  const ok =
    r1.withLogs === 6 && r1.refs === 11 && r1.uploaded === 14 && r1.foreign.length === 0 &&
    perJobOk && j40Ok && j46Ok && j43Ok &&
    badFetches.length === 0 && decoyFetches.length === 0 && rescueLine && zeroRefNote && !doneNote &&
    staleJson.stored === 1 &&
    sVol.status === 200 && sVol.type === "image/png" &&
    sTile.status === 200 && sTile.type === "image/png" &&
    sFsc.status === 200 && sFsc.type === "image/jpeg" &&
    sStale.status === 200 && sStale.type === "image/png" &&
    sGarbage.status === 404 &&
    assetsStored.length === 4 &&
    finalData.log_images_uploaded === 11 && finalData.log_images_count === 11;
  RC.log(ok ? "\n✅ HARNESS PASS — typeless-server byte sniffing + map/tile asset pipeline + stale-script octet rescue" : "\n❌ HARNESS FAIL");
  RC.log("\n----- script console (tail) -----");
  for (const l of logBuffer.slice(-26)) RC.log(l);
  RC.log("---------------------------------");
  process.exit(ok ? 0 : 2);
})().catch((e) => { RC.error("[harness] fatal:", e); process.exit(3); });

setTimeout(() => { RC.error("[harness] TIMEOUT (300s)"); for (const l of logBuffer) RC.log(l); process.exit(3); }, 300000);
