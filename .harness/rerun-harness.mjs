/**
 * RE-RUN regression harness — models the user's exact "0 images captured"
 * scenario:
 *   - jobLogStore keeps logs in a NON-CLASSIC state key (logsByJob) keyed
 *     by job uid — readLogState() (jobLogs/logs/job_logs) cannot see it.
 *   - getLogsByJob() CACHE-HITS on a second call: resolves undefined and
 *     leaves state UNCHANGED (exactly what the real build does after a
 *     previous script run already loaded every job's logs).
 *   - The script runs TWICE against the REAL dev server, in the SAME mock
 *     DOM (store persists between runs), each run with its own session.
 *
 * Run 1 (fresh store): loader + deep-scan diff → 14 refs (7 lineage jobs,
 *   last-round-only ×2 images each).
 * Run 2 (cached store): v3.8 shipped 24/24-style "N/N jobs scanned · 0
 *   images" — the fix must recover the SAME 14 refs from the cache.
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
RC.log("[harness] script:", captureScript.length, "chars · v3.9:", captureScript.includes("v3.9"));

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

// NON-CLASSIC log state: logsByJob.<uid> = [...] — invisible to readLogState.
const logsByJob = {};
// Extract the uid from any calibration shape (uid | {job_uid} | {uid} |
// [uid] | full job row) — the real build accepts several payload shapes.
function uidOf(arg) {
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) return typeof arg[0] === "string" ? arg[0] : null;
  if (arg && typeof arg === "object") {
    const u = arg.job_uid || arg.uid;
    return typeof u === "string" ? u : null;
  }
  return null;
}
const jobLogStore = {
  $id: "jobLogStore",
  $state: { logsByJob },
  getLogsByJob(arg) {
    const uid = uidOf(arg);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!uid) { resolve(undefined); return; }
        // CACHE-HIT: the previous run already loaded this job — the store
        // resolves immediately and does NOT touch state (real-build
        // behavior that produced "24/24 scanned · 0 images").
        if (logsByJob[uid]) { resolve(undefined); return; }
        logsByJob[uid] = [
          { type: "text", text: "round 1 note", flags: [] },
          { type: "image", text: "Selected 21 classes", imgfiles: [{ fileid: `${uid}_sel_r1`, filename: "sel_r1.png" }] },
          { type: "image", text: "Excluded 179 classes", imgfiles: [{ fileid: `${uid}_exc_r1`, filename: "exc_r1.png" }] },
          { type: "image", text: "Selected 21 classes", imgfiles: [{ fileid: `${uid}_sel_r2`, filename: "sel_r2.png" }] },
          { type: "image", text: "Excluded 179 classes", imgfiles: [{ fileid: `${uid}_exc_r2`, filename: "exc_r2.png" }] },
        ];
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
  ["jobLogStore", jobLogStore],
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
    if (!u.includes("_r1")) return new Response(imageBytes, { status: 200, headers: { "Content-Type": "image/png" } });
    RC.log("[harness] log_image 404:", u);
    return new Response("gone", { status: 404 });
  }
  return new Response("not found", { status: 404 });
};

const LINEAGE = ["J40", "J41", "J42", "J43", "J44", "J45", "J46"];
const tokens = [];   // session tokens in creation order
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

/** Drive one full capture run: request lineage logs, skip the grace
 *  window once the scan finishes, wait for /complete, return results. */
async function awaitRun(label, runIndex) {
  // 1. wait for this run's session token
  let token = null;
  for (let i = 0; i < 400 && !token; i++) { scanTokens(); token = tokens[runIndex] || null; if (!token) await sleep(100); }
  if (!token) { RC.error(`[${label}] no session token`); process.exit(1); }
  RC.log(`[${label}] token: ${token}`);

  // 2. simulate the web app: auto-trace posts the lineage request-logs
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

  // 3. wait for the log scan to cover every lineage job
  for (let i = 0; i < 600; i++) {
    const st = await sessionStatus(token);
    if (st && st.log_jobs_total === LINEAGE.length && st.log_jobs_done === LINEAGE.length) break;
    await sleep(200);
  }

  // 4. skip the 3-minute re-trace grace window (test speed-up only)
  try { globalThis.window.__csCaptureFinish(); } catch (e) { RC.warn(`[${label}] finish hook failed: ${e.message}`); }

  // 5. wait for /complete
  for (let i = 0; i < 600; i++) {
    const st = await sessionStatus(token);
    if (st && st.status === "complete") break;
    await sleep(250);
  }

  // 6. read the final session snapshot
  const d = await (await realFetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
  const withLogs = Object.keys(d.data.job_log_images || {});
  const refs = withLogs.reduce((n, k) => n + d.data.job_log_images[k].length, 0);
  const uploaded = (d.data.uploaded_image_ids || []).length;
  RC.log(`[${label}] jobsWithLogs = ${withLogs.length} · refs = ${refs} · uploaded ids = ${uploaded}`);
  return { token, withLogs: withLogs.length, refs, uploaded };
}

const mod = new Function(captureScript + "\n//# sourceURL=v39-rerun.js");

(async () => {
  // RUN 1 — fresh store (previous successful capture)
  const p1 = awaitRun("run1", 0);
  mod();   // fire-and-forget async IIFE
  const r1 = await p1;

  await sleep(800);   // let run 1 fully unwind

  // RUN 2 — same tab: every lineage job's logs already cached in the store
  const p2 = awaitRun("run2", 1);
  mod();
  const r2 = await p2;

  RC.log("\n===== RESULTS =====");
  RC.log(`run1 (fresh):  jobsWithLogs=${r1.withLogs} refs=${r1.refs} uploaded=${r1.uploaded}`);
  RC.log(`run2 (cached): jobsWithLogs=${r2.withLogs} refs=${r2.refs} uploaded=${r2.uploaded}`);
  RC.log("\n----- script console (tail) -----");
  for (const l of logBuffer.slice(-24)) RC.log(l);
  RC.log("---------------------------------");
  const ok = r1.withLogs === 7 && r1.refs === 14 && r1.uploaded === 14 &&
             r2.withLogs === 7 && r2.refs === 14 && r2.uploaded === 14;
  RC.log(ok ? "\n✅ HARNESS PASS — re-run captures cached log images" : "\n❌ HARNESS FAIL");
  process.exit(ok ? 0 : 2);
})().catch((e) => { RC.error("[harness] fatal:", e); process.exit(3); });

setTimeout(() => { RC.error("[harness] TIMEOUT (420s)"); for (const l of logBuffer) RC.log(l); process.exit(3); }, 420000);
