/**
 * v3.11 harness — models the user's REAL failure modes from the latest
 * feedback:
 *
 *   1. Multi-round jobs captured "Iteration 000" (the FIRST iteration) and
 *      nu_refine shipped 112 images: per-iteration entries carry DISTINCT
 *      titles ("Iteration 000" … "Iteration 003") and per-iteration file
 *      names, so the per-title round filter saw nothing to dedupe. The
 *      iteration parser must keep ONLY the highest iteration.
 *   2. XML / TXT result files still leaked through the PDF-only filter —
 *      a strict image whitelist must drop them (no ref, no byte fetch).
 *   3. hetero_refine delivered its images under `files` (not `imgfiles`)
 *      → invisible to the deep scan → ZERO log images. Must be collected.
 *   4. homo_abinit delivered its (huge) logs 3.5s after the loader call —
 *      past the 1.3s diff window → empty batch forever. The v3.11
 *      slow-log rescue must pick it up within its 40s re-poll.
 *   5. One job's logs live in a `logsByJob` map keyed by the FULL uid
 *      ("BJ.P259.J45") — the exact-key lookup missed it forever.
 *
 * Lineage = J40..J46 (7 jobs) on ONE shared insert_events stream:
 *   J40 nu_refine     4 iteration entries (2 png + xml + txt + pdf each)
 *                     → ONLY iter 003's 2 pngs (2 refs)
 *   J41 hetero_refine files[] entries: 2 class pngs + 1 xml
 *                     → 2 refs (class_000/001 trailing digits must NOT be
 *                       parsed as iterations — class-gallery safety)
 *   J42 homo_abinit   delivered +3.5s (past every window) → rescue → 2 refs
 *   J43 select_2D     re-run rounds (r1 dead) + pdf → last round's png + fsc
 *   J44 motion_corr   text-only logs → 0 refs (listed in zero-ref note)
 *   J45 class_3d      logs cached in logsByJob["BJ.P259.J45"] → 2 refs
 *   J46 nu_refine     uid-less title-less entries with iter-numbered FILE
 *                     names (tail attribution) → only iter_002 (1 ref)
 *
 * PASS: 6 jobs with refs, 11 refs total, 11 uploaded, 0 foreign refs,
 *       0 xml/txt/pdf byte fetches, 0 dead-round fetches, rescue console
 *       line present, zero-ref note lists J44.
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
RC.log("[harness] script:", captureScript.length, "chars · v3.11:", captureScript.includes("v3.11"));

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
};

const realFetch = globalThis.fetch;
const imageBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c626001000000ffff03000006000557bfabd4" +
  "0000000049454e44ae426082",
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
    return new Response(imageBytes, { status: 200, headers: { "Content-Type": "image/png" } });
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

const mod = new Function(captureScript + "\n//# sourceURL=v311.js");

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
  RC.log(`byte fetches total: ${logImageFetches.length} · non-image/dead fetches: ${badFetches.length} (want 0/0-ish)`);
  const rescueLine = logBuffer.some((l) => l.includes("Late logs arrived for J42"));
  const zeroRefNote = logBuffer.some((l) => l.includes("no log images") && l.includes("J44"));
  const doneNote = logBuffer.some((l) => l.includes("8/7"));   // must NOT exist
  RC.log(`rescue line for J42: ${rescueLine} · zero-ref note lists J44: ${zeroRefNote} · "8/7" bug: ${doneNote}`);

  const perJobOk = LINEAGE.every((uid) => (r1.perJob[uid] || []).length === EXPECT_REFS[uid]);
  const j40Ok = JSON.stringify((r1.perJob.J40 || []).map((r) => r.fileid)) === JSON.stringify(["J40_fsc_i3", "J40_ang_i3"]);
  const j46Ok = JSON.stringify((r1.perJob.J46 || []).map((r) => r.fileid)) === JSON.stringify(["J46_p2"]);
  const j43Ok = JSON.stringify((r1.perJob.J43 || []).map((r) => r.fileid)) === JSON.stringify(["J43_sel_r2", "J43_fsc"]);
  const ok =
    r1.withLogs === 6 && r1.refs === 11 && r1.uploaded === 11 && r1.foreign.length === 0 &&
    perJobOk && j40Ok && j46Ok && j43Ok &&
    badFetches.length === 0 && rescueLine && zeroRefNote && !doneNote;
  RC.log(ok ? "\n✅ HARNESS PASS — last-iteration + image whitelist + files[] + slow-log rescue + full-uid keys" : "\n❌ HARNESS FAIL");
  RC.log("\n----- script console (tail) -----");
  for (const l of logBuffer.slice(-26)) RC.log(l);
  RC.log("---------------------------------");
  process.exit(ok ? 0 : 2);
})().catch((e) => { RC.error("[harness] fatal:", e); process.exit(3); });

setTimeout(() => { RC.error("[harness] TIMEOUT (300s)"); for (const l of logBuffer) RC.log(l); process.exit(3); }, 300000);
