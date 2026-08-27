/**
 * Runs the EXACT shipped v3.6 capture script inside a mock CryoSmart DOM,
 * posting to the REAL app at http://localhost:3000.
 *  - 46 jobs (>15 → LINEAGE_MODE ON)
 *  - jobLogs LAZY via jobLogStore.getLogsByJob (async, state-populating)
 *  - log_image bytes: final-round ok, old-round 404
 *  - web UI simulated: posts request-logs once jobs land (traced lineage J40-J46)
 */
import fs from "node:fs";

const APP = "http://localhost:3000";
const RC = console; // real console (script console is mocked)

const panel = fs.readFileSync(
  "/home/z/my-project/src/app/components/cryosmart/smart-capture-panel.tsx",
  "utf8"
);
const start = panel.indexOf("const captureScript = `");
const end = panel.indexOf("`.trim();", start);
const raw = panel.slice(start + "const captureScript = `".length, end);
const captureScript = eval(("`" + raw + "`").replace("${webAppUrl}", "${APP}"));
RC.log("[harness] script:", captureScript.length, "chars · v3.6:", captureScript.includes("v3.6"));

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

const jobLogs = {};
const jobLogStore = {
  $id: "jobLogStore",
  $state: { jobLogs },
  getLogsByJob(uid) {
    return new Promise((resolve) => {
      setTimeout(() => {
        jobLogs[uid] = [
          { type: "text", text: "round 1 note", flags: [] },
          { type: "image", text: "Selected 21 classes", imgfiles: [{ fileid: `${uid}_sel_r1`, filename: "sel_r1.png" }] },
          { type: "image", text: "Excluded 179 classes", imgfiles: [{ fileid: `${uid}_exc_r1`, filename: "exc_r1.png" }] },
          { type: "image", text: "Selected 21 classes", imgfiles: [{ fileid: `${uid}_sel_r2`, filename: "sel_r2.png" }] },
          { type: "image", text: "Excluded 179 classes", imgfiles: [{ fileid: `${uid}_exc_r2`, filename: "exc_r2.png" }] },
        ];
        resolve(undefined);
      }, 15);
    });
  },
};
const projectsInMap = {
  PE2E: { uid: "PE2E", experiments: [{ uid: "EXP1", jobs }] },
};
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
        // Bun's native Response.blob() returns a NATIVE Blob whose `bytes`
        // is a METHOD (Promise<Uint8Array>) — stringifying it produced
        // "data:...;base64,function bytes() {...}" and the server rightly
        // rejected every batch. Handle both native and mock Blobs.
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
const posted = { logs: [], images: [] };
globalThis.fetch = async function (url, opts) {
  const u = String(url);
  if (u.startsWith(APP)) {
    const path = u.slice(APP.length);
    if (path.includes("/logs") && opts?.method === "POST") posted.logs.push(JSON.parse(opts.body));
    if (path.includes("/images") && opts?.method === "POST") posted.images.push(JSON.parse(opts.body));
    if (path.includes("/complete") && opts?.method === "POST") setTimeout(checkResults, 1500);
    return realFetch(url, opts);
  }
  if (u.startsWith("/api/log_image/")) {
    if (!u.includes("_r1")) return new Response(imageBytes, { status: 200, headers: { "Content-Type": "image/png" } });
    return new Response("gone", { status: 404 });
  }
  return new Response("not found", { status: 404 });
};

let sessionToken = null;
async function simulateWebUI() {
  for (let i = 0; i < 300 && !sessionToken; i++) {
    for (const l of logBuffer) {
      const m = l.match(/Live progress page: .*imported=([^&\s]+)/);
      if (m) { sessionToken = m[1]; break; }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!sessionToken) {
    RC.error("[harness] no session token. Script console so far:");
    for (const l of logBuffer) RC.log(l);
    process.exit(1);
  }
  RC.log("[harness] token:", sessionToken);
  for (let i = 0; i < 150; i++) {
    const st = await (await realFetch(`${APP}/api/cryosmart/import/session/${sessionToken}`)).json();
    if (st.has_data) {
      const lineage = ["J40", "J41", "J42", "J43", "J44", "J45", "J46"];
      const resp = await realFetch(`${APP}/api/cryosmart/import/session/${sessionToken}/request-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: lineage }),
      });
      const j = await resp.json();
      RC.log("[harness] request-logs posted →", JSON.stringify(j.log_request));
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  RC.error("[harness] jobs never landed");
}

function checkResults() {
  fs.writeFileSync('/home/z/my-project/.harness/posted-images.json', JSON.stringify(posted.images, null, 2));
  const flatLogs = posted.logs.flatMap((b) => b.items.map((it) => ({ uid: it.uid, n: it.images.length })));
  const totalRefs = flatLogs.reduce((n, it) => n + it.n, 0);
  const bytesStored = posted.images.reduce((n, b) => n + b.items.length, 0);
  RC.log("\n===== RESULTS =====");
  RC.log("jobs scanned:", flatLogs.length, JSON.stringify(flatLogs));
  RC.log("total log-image refs:", totalRefs, "· image BYTES uploaded:", bytesStored);
  const oldRoundLeaked = posted.logs.some((b) => b.items.some((it) => it.images.some((im) => String(im.fileid).includes("_r1"))));
  const scannedUids = new Set(flatLogs.map((it) => it.uid));
  const outside = [...scannedUids].filter((u) => parseInt(u.slice(1)) < 40);
  RC.log("old-round refs leaked:", oldRoundLeaked, "· scanned OUTSIDE lineage:", outside.length ? outside : "none");
  realFetch(`${APP}/api/cryosmart/import/session/${sessionToken}/data`)
    .then((r) => r.json())
    .then((d) => {
      const withLogs = Object.keys(d.data.job_log_images || {}).length;
      const refCount = Object.values(d.data.job_log_images || {}).reduce((n, a) => n + a.length, 0);
      const uploadedIds = (d.data.uploaded_image_ids || []).length;
      RC.log("session: jobsWithLogs =", withLogs, "· refs =", refCount, "· uploaded ids =", uploadedIds);
      RC.log("\n----- script console -----");
      for (const l of logBuffer) RC.log(l);
      RC.log("--------------------------");
      // v3.8: bytes must be STORED server-side too (not merely POSTED) —
      // the graph/report render from the session image store.
      const ok = refCount === 14 && uploadedIds === 14 && bytesStored === 14 && !oldRoundLeaked && outside.length === 0;
      RC.log(ok ? "\n✅ HARNESS PASS — v3.8 lineage capture works end-to-end" : "\n❌ HARNESS FAIL");
      process.exit(ok ? 0 : 2);
    });
}

const mod = new Function(captureScript + "\n//# sourceURL=v36.js");
simulateWebUI().catch((e) => RC.error("[harness] web-ui sim failed:", e));
Promise.resolve().then(() => mod());
setTimeout(() => { RC.error("[harness] TIMEOUT (330s)"); for (const l of logBuffer) RC.log(l); process.exit(3); }, 330000);
