/**
 * v3.10 shared-stream harness — models the user's REAL build as diagnosed
 * from their symptoms (all jobs showing the SAME ~16 log images + the
 * last-scanned hetero/abinit/nu-refine jobs showing NONE, 320 refs total):
 *
 *   - job logs arrive over WebSocket insert_events into ONE SHARED array
 *     (logStore.$state.events) — entries carry their own job_uid.
 *   - The stream is PRE-POPULATED with >300 entries (a real project's
 *     accumulated events) — under the v3.9 300-entry scan cap the array was
 *     INVISIBLE, which is why late-scanned jobs starved.
 *   - imgfiles carry result PDFs next to the PNG previews (the "duplicate
 *     title whose twin never loads" report bug).
 *   - One job (J40) was re-run: same log title twice, older round's fileid
 *     is dead on the server.
 *   - One job (J45) delivers uid-LESS entries (attribution must fall back
 *     to the appended-tail rule; from CACHE they are honestly
 *     unattributable, so the re-run yields 6 of 7 jobs).
 *
 * Run 1 (fresh): every lineage job must own ONLY its own refs — 7 jobs,
 *   14 refs (sel + fsc per job, J40 keeps only its last round), 14 bytes
 *   uploaded, ZERO pdf fetches, ZERO dead-round fetches.
 * Run 2 (same tab, loader cache-hits): deep-scan rescue slices each job's
 *   entries out of the shared stream — 6 jobs (J45's uid-less entries
 *   cannot be attributed from cache), 12 refs, 12 bytes.
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
RC.log("[harness] script:", captureScript.length, "chars · v3.10:", captureScript.includes("v3.10"));

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

// ── The REAL-build model: ONE shared insert_events stream ──────────
const eventStream = [];
// Pre-populate past the old 300-entry cap (image-bearing entries from
// previously-viewed NON-lineage jobs keep the array "collectable").
for (let i = 0; i < 340; i++) eventStream.push({ type: "text", text: "old event " + i });
for (let p = 1; p <= 5; p++) {
  eventStream.push({
    type: "image",
    job_uid: "P" + p,
    text: "Old view " + p,
    imgfiles: [{ fileid: "P" + p + "_old", filename: "old" + p + ".png" }],
  });
}

const uidOf = (arg) => {
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) return typeof arg[0] === "string" ? arg[0] : null;
  if (arg && typeof arg === "object") {
    const u = arg.job_uid || arg.uid;
    return typeof u === "string" ? u : null;
  }
  return null;
};

/** One job's log delivery: text filler + image entries (+ result PDFs).
 *  withUid=false models uid-less insert_events (tail-attribution path). */
function entriesFor(uid, withUid) {
  const tag = (e) => (withUid ? { ...e, job_uid: uid } : e);
  const out = [];
  for (let k = 0; k < 12; k++) out.push(tag({ type: "text", text: "log line " + uid + "-" + k }));
  if (uid === "J40") {
    // re-run job: SAME title twice; the older round's fileid is dead.
    out.push(tag({ type: "image", text: "Selected 21 classes", imgfiles: [
      { fileid: uid + "_sel_r1", filename: "sel.png" },
      { fileid: uid + "_report1", filename: "report.pdf", filetype: "pdf" },
    ] }));
    out.push(tag({ type: "image", text: "Selected 21 classes", imgfiles: [
      { fileid: uid + "_sel_r2", filename: "sel.png" },
      { fileid: uid + "_report2", filename: "report.pdf", filetype: "pdf" },
    ] }));
  } else {
    out.push(tag({ type: "image", text: "Selected classes", imgfiles: [
      { fileid: uid + "_sel", filename: "sel.png" },
      { fileid: uid + "_report", filename: "report.pdf", filetype: "pdf" },
    ] }));
  }
  out.push(tag({ type: "image", text: "FSC plot", imgfiles: [{ fileid: uid + "_fsc", filename: "fsc.png" }] }));
  return out;
}

const loaded = {};   // loader cache: second call for the same uid is a no-op
const logStore = {
  $id: "logStore",
  $state: { events: eventStream },
  getLogsByJob(arg) {
    const uid = uidOf(arg);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!uid) { resolve(undefined); return; }
        if (loaded[uid]) { resolve(undefined); return; }   // cache-hit (re-run)
        loaded[uid] = true;
        eventStream.push(...entriesFor(uid, uid !== "J45"));  // J45: uid-less
        resolve(undefined);   // logs arrive via "WebSocket", never returned
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

async function awaitRun(label, runIndex) {
  let token = null;
  for (let i = 0; i < 400 && !token; i++) { scanTokens(); token = tokens[runIndex] || null; if (!token) await sleep(100); }
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

  for (let i = 0; i < 600; i++) {
    const st = await sessionStatus(token);
    if (st && st.log_jobs_total === LINEAGE.length && st.log_jobs_done === LINEAGE.length) break;
    await sleep(200);
  }

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
  // PER-JOB attribution: every ref of a job must start with that job's uid.
  const foreign = [];
  for (const [uid, list] of Object.entries(perJob)) {
    for (const r of list) if (!String(r.fileid).startsWith(uid + "_")) foreign.push(uid + "←" + r.fileid);
  }
  if (foreign.length) RC.log(`[${label}] ⚠ FOREIGN refs: ${foreign.join(", ")}`);
  return { token, perJob, withLogs: withLogs.length, refs, uploaded, foreign };
}

const mod = new Function(captureScript + "\n//# sourceURL=v310.js");

(async () => {
  const fetchCount0 = logImageFetches.length;
  const p1 = awaitRun("run1", 0);
  mod();
  const r1 = await p1;
  const run1Fetches = logImageFetches.slice(fetchCount0);

  await sleep(800);

  const fetchCount1 = logImageFetches.length;
  const p2 = awaitRun("run2", 1);
  mod();
  const r2 = await p2;

  RC.log("\n===== RESULTS =====");
  RC.log(`run1 (fresh):  jobsWithLogs=${r1.withLogs} refs=${r1.refs} uploaded=${r1.uploaded} foreign=${r1.foreign.length}`);
  RC.log(`run2 (cached): jobsWithLogs=${r2.withLogs} refs=${r2.refs} uploaded=${r2.uploaded} foreign=${r2.foreign.length}`);
  const pdfFetches = logImageFetches.filter((u) => /_report/.test(u));
  const r1Fetches = run1Fetches.filter((u) => /_r1/.test(u));
  RC.log(`pdf fetches: ${pdfFetches.length} (want 0) · dead-round fetches in run1: ${r1Fetches.length} (want 0)`);
  RC.log(`J40 refs: ${JSON.stringify((r1.perJob.J40 || []).map((r) => r.fileid))}`);
  RC.log(`J45 refs run1: ${JSON.stringify((r1.perJob.J45 || []).map((r) => r.fileid))}`);
  RC.log(`J45 in run2: ${JSON.stringify(Object.keys(r2.perJob))}`);
  RC.log("\n----- script console (tail) -----");
  for (const l of logBuffer.slice(-20)) RC.log(l);
  RC.log("---------------------------------");

  const ok =
    r1.withLogs === 7 && r1.refs === 14 && r1.uploaded === 14 && r1.foreign.length === 0 &&
    r2.withLogs === 6 && r2.refs === 12 && r2.uploaded === 12 && r2.foreign.length === 0 &&
    pdfFetches.length === 0 && r1Fetches.length === 0 &&
    (r1.perJob.J40 || []).length === 2 &&
    String((r1.perJob.J40 || [])[0]?.fileid) === "J40_sel_r2";
  RC.log(ok ? "\n✅ HARNESS PASS — per-job attribution + PDF filter + last-round + shared-stream rescue" : "\n❌ HARNESS FAIL");
  process.exit(ok ? 0 : 2);
})().catch((e) => { RC.error("[harness] fatal:", e); process.exit(3); });

setTimeout(() => { RC.error("[harness] TIMEOUT (420s)"); for (const l of logBuffer) RC.log(l); process.exit(3); }, 420000);
