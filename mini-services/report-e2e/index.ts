/**
 * report-e2e — verification mini-service for the report's 一键下载 rework
 * (multi-download browser blocking fix, v3.43).
 *
 * Routes:
 *   GET /         → a standalone report page embedding the REAL shipped
 *                   REPORT_HTML_V2_SCRIPT (imported straight from
 *                   src/lib/cryosmart/report-html.ts) with a download-all
 *                   button carrying: 2 data: map payloads + 1 data: FSC XML
 *                   (all fetchable → must pack ONE zip) and 1 dead http
 *                   URL with no proxied twin (must surface in the per-file
 *                   click-to-download retry row).
 *   GET /ziptest  → runs the shipped __csZipStore in-process on mixed
 *                   payloads (8 MB binary, 300 KB binary, text, empty,
 *                   UTF-8 filename) and writes /tmp/ziptest/out.zip +
 *                   expected payloads for verify_zip.py (python zipfile).
 *
 * v3.45 谱系补边 (lineage edge completion) E2E:
 *   GET /projects/P208/jobs/J498 → a mock CryoSmart SPA page embedding the
 *                   REAL capture script (extracted live from
 *                   smart-capture-panel.tsx, ${webAppUrl} → this origin).
 *                   The mock store reproduces the user's P208 situation:
 *                   the volume chain is fully detailed, J476 select_2d is
 *                   LIST-LEVEL (parents lists only the LAST dataset's
 *                   class_2d — the earlier dataset branch is invisible),
 *                   the earlier dataset's jobs are completely bare, and
 *                   J370 import_movies carries NO output counts. The mock
 *                   getJobDetail store action delivers the FULL detail
 *                   (mutating the store job in place, 25 ms async — the
 *                   store-mode evidence path), with MIXED uid formats
 *                   ("J472" vs "BJ.P208.J472") to exercise canonicalisation.
 *   GET /enrich-status → {jobs_landed} for the page's finish-poll.
 *   GET /enrich-check   → verdict over the /jobs payload the script
 *                   uploaded: J476 must now list BOTH dataset parents,
 *                   the earlier dataset chain (J385→…→J370) must be
 *                   connected, J370 must have output groups, the volume
 *                   chain must be intact, all 21 jobs uploaded, and the
 *                   'enrich' phase must have streamed.
 */
import { _REPORT_HTML_V2_SCRIPT } from "../../src/lib/cryosmart/report-html";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const PORT = 3021;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ------------------------------------------------------------------ */
/*  /ziptest — byte-level verification of the shipped zip writer      */
/* ------------------------------------------------------------------ */
let zipStoreFn: ((files: unknown[], onProgress?: (n: number) => void) => Promise<Blob>) | null =
  null;

function ensureZipStore() {
  if (zipStoreFn) return zipStoreFn;
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    addEventListener: () => {},
    createElement: () => {
      throw new Error("createElement should not run here");
    },
    body: {},
    documentElement: {},
  };
  g.window = { addEventListener: () => {}, alert: () => {} };
  (0, eval)(_REPORT_HTML_V2_SCRIPT);
  const fn = (globalThis as unknown as { __csZipStore?: unknown }).__csZipStore;
  if (typeof fn !== "function") throw new Error("__csZipStore not defined after eval");
  zipStoreFn = fn as typeof zipStoreFn;
  return zipStoreFn;
}

function pattern(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (seed + i * 7 + (i >>> 8) * 13) & 0xff;
  return b;
}

async function runZipTest(): Promise<Record<string, unknown>> {
  const zipStore = ensureZipStore();
  const big = new Blob([pattern(8 * 1024 * 1024, 3)]); // 8 MB binary
  const mid = new Blob([pattern(300 * 1024, 9)]); // 300 KB binary
  const txt = new Blob(["hello zip\nline2\n"]);
  const empty = new Blob([]);
  let progressCalls = 0;
  const zip = await zipStore(
    [
      { name: "dir/J606.volume.map", blob: big },
      { name: "J606.fsc.xml", blob: txt },
      { name: "\u62a5\u544a_\u6d4b\u8bd5.bin", blob: mid }, // UTF-8 name: 报告_测试.bin
      { name: "empty.txt", blob: empty },
    ],
    () => {
      progressCalls++;
    },
  );
  await Bun.write("/tmp/ziptest/out.zip", zip);
  await Bun.write("/tmp/ziptest/expected_big.bin", big);
  await Bun.write("/tmp/ziptest/expected_mid.bin", mid);
  return {
    zip_bytes: zip.size,
    progress_callbacks: progressCalls,
    expected_entries: 4,
    ok: true,
  };
}

/* ------------------------------------------------------------------ */
/*  / — standalone report page with the REAL embedded script           */
/* ------------------------------------------------------------------ */
function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

const mapA = dataUrl(pattern(180 * 1024, 21), "application/octet-stream");
const mapB = dataUrl(pattern(90 * 1024, 57), "application/octet-stream");
const fscXml = dataUrl(Buffer.from("<FSC><curve><point r=\"0.1\" c=\"0.99\"/></curve></FSC>"), "text/xml");

const pageHtml = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>v3.43 download-all E2E</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;background:#fff;color:#111;margin:0}
  .download-head{border:1px solid #ddd;border-radius:8px;padding:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .download-all{border:1px solid #b35612;background:#b35612;color:#fff;border-radius:6px;padding:8px 16px;cursor:pointer}
  .download-all:disabled{opacity:.6;cursor:wait}
  .map-dl{display:inline-block;padding:6px 12px;border:1px solid #b35612;border-radius:6px;color:#b35612;text-decoration:none;margin:2px}
</style></head>
<body><main>
  <h1>一键下载 v3.43 E2E</h1>
  <p>预期：点击按钮 → 抓取 2 个 data: map + 1 个 data: FSC XML → 打包成 1 个 zip 单次下载（浏览器不再拦截）；无法 fetch 的 mask_refine（http 无代理）出现在“逐个点击下载”重试行。</p>
  <div class="download-head"><b>map: 3 个 + FSC XML</b>
    <button type="button" class="download-all" data-zipname="BJ.P999.J606.maps.zip"
      data-urls="${mapA}|${mapB}|http://127.0.0.1:1/x/J606.volume.mask_refine|${fscXml}"
      data-purls="|||"
      data-names="BJ.P999.J606.volume.map.mrc|BJ.P999.J606.volume.map_sharp.mrc|BJ.P999.J606.volume.mask_refine.mrc|BJ.P999.J606.fsc.xml">一键下载 map + FSC XML</button>
  </div>
</main>
<script>${_REPORT_HTML_V2_SCRIPT}</script>
</body></html>`;

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ziptest") {
      return runZipTest().then(
        (json) => new Response(JSON.stringify(json), { headers: { "content-type": "application/json" } }),
        (err) => new Response(String(err), { status: 500 }),
      );
    }
    /* ── v3.45 谱系补边 E2E ─────────────────────────────────────────── */
    if (pathname === "/projects/P208/jobs/J498") {
      resetEnrichState();
      return new Response(enrichPageHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (req.method === "POST" && pathname === "/api/cryosmart/import/session") {
      return Response.json({ ok: true, token: ENRICH_TOKEN });
    }
    if (req.method === "POST" && pathname === `/api/cryosmart/import/session/${ENRICH_TOKEN}/jobs`) {
      return req
        .json()
        .then((body: { jobs?: unknown[] }) => {
          for (const job of (body.jobs || []) as Array<Record<string, unknown>>) {
            enrichUploadedJobs[String(job.uid)] = job;
          }
          enrichJobsLanded = true;
          return Response.json({ ok: true, count: Object.keys(enrichUploadedJobs).length });
        })
        .catch(() => Response.json({ ok: false }, { status: 400 }));
    }
    if (req.method === "POST" && pathname === `/api/cryosmart/import/session/${ENRICH_TOKEN}/phase`) {
      return req
        .json()
        .then((body: { phase?: string }) => {
          if (body.phase) enrichPhases.add(String(body.phase));
          return Response.json({ ok: true });
        })
        .catch(() => Response.json({ ok: true }));
    }
    if (req.method === "POST" && pathname.startsWith(`/api/cryosmart/import/session/${ENRICH_TOKEN}/`)) {
      return Response.json({ ok: true });
    }
    if (req.method === "GET" && pathname === `/api/cryosmart/import/session/${ENRICH_TOKEN}`) {
      return Response.json({ ok: true, status: "waiting", log_request: null, total_jobs: 21 });
    }
    if (pathname === "/enrich-status") {
      return Response.json({ jobs_landed: enrichJobsLanded });
    }
    if (pathname === "/enrich-check") {
      return new Response(JSON.stringify(enrichVerdict(), null, 2), {
        headers: { "content-type": "application/json" },
      });
    }
    /* ── v3.46 flow-figure E2E: mock CryoSmart map endpoint ────────── */
    if (pathname === "/favicon.ico") {
      // Any HTTP status proves reachability for probeCryosmartReachable.
      return new Response("mock cryosmart", { status: 404 });
    }
    if (pathname.startsWith("/api/log_image/download_result_file/")) {
      const cookie = req.headers.get("Cookie") || "";
      if (!cookie.includes("session=e2e-cookie")) {
        // Mimic the auth-protected CryoSmart the user reported (HTTP 401
        // for ChimeraX, which carries no cookies).
        return Response.json(
          { detail: "Authentication credentials were not provided." },
          { status: 401 },
        );
      }
      const bytes = mrcBytes(pathname);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }
    if (pathname === "/flow-e2e/capture.json") {
      return new Response(JSON.stringify(flowE2eCaptureDoc()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }
    if (pathname === "/flow-e2e/reset") {
      resetRelayState();
      const sp = new URL(req.url).searchParams;
      const blockHttp = sp.get("http") === "block";
      relayState.httpBlocked = blockHttp;
      // v3.48 drill switch: reject every legit `save "<path>.png"` so the
      // bridge's save-error surfacing (缩略图保存失败 / 保存失败 lines) can
      // be E2E-verified against a ChimeraX that cannot write files.
      const rejectSave = sp.get("save") === "reject";
      relayState.saveRejected = rejectSave;
      // v3.50 drill switch: absolute-path saves SUCCEED but land OUTSIDE
      // the workdir (the user's round-7/9 symptom: clean save + /file 404)
      // — only a bare RELATIVE save after `cd <workdir>` is fetchable.
      const file404 = sp.get("file404");
      relayState.divertAbsSave = file404 === "abs";
      // v3.50 drill: rotate the reported workdir — simulates ChimeraX/relay
      // restarting between page runs (new mkdtemp) while a stale page still
      // caches the old one; the card must re-validate before saving.
      if (sp.get("workdir") === "2") relayState.workdir = "/tmp/cryoflow-mock-2";
      // v3.68 E2E: ?corr=N overrides the mock's `measure correlation`
      // value — 0.9 exercises the target-reached paths (round-1 success /
      // search skipped entirely when the local track is already ≥ 0.85).
      const corrOverride = Number(sp.get("corr"));
      if (Number.isFinite(corrOverride) && corrOverride > -1 && corrOverride <= 1) {
        relayState.corrOverride = corrOverride;
      }
      // v3.80 E2E drill: ?membrane=camreject — every `view matrix camera`
      // errors so the page's membrane orientation must fall through the
      // transpose candidate to the turn-grid scan (probe-verified).
      const camReject = sp.get("membrane") === "camreject";
      relayState.camReject = camReject;
      // v3.82 E2E drills: ?relay=old (pre-3.82 relay — no /membrane2, the
      // page must run the legacy envelope camera then the probe-only
      // standing scan) / ?relay=nomembrane (pre-3.77 relay — neither
      // endpoint; the standing scan is the only orientation source).
      const relayMode = sp.get("relay") || "";
      relayState.relayMode = relayMode === "old" || relayMode === "nomembrane" ? relayMode : "";
      return Response.json({
        ok: true,
        http_blocked: blockHttp,
        save_rejected: rejectSave,
        file404_abs: relayState.divertAbsSave,
        workdir: relayState.workdir,
        corr: relayState.corrOverride,
        cam_reject: camReject,
        relay_mode: relayState.relayMode,
      });
    }
    if (pathname === "/flow-e2e/relay-stats") {
      return new Response(JSON.stringify(relayStats(), null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }
    /* v3.68 E2E: dump the raw command history (optional ?filter=substring)
     * — proves the adaptive ladder's escalating fitmap search counts
     * (30 → 60 → 90) actually reached the relay, not just the UI log. */
    if (pathname === "/flow-e2e/commands") {
      const filter = new URL(req.url).searchParams.get("filter") || "";
      const cmds = filter
        ? relayState.commands.filter((c) => c.includes(filter))
        : relayState.commands;
      return new Response(JSON.stringify({ count: cmds.length, commands: cmds }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(pageHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`report-e2e listening on http://localhost:${server.port} (/, /ziptest, /projects/P208/jobs/J498 → 谱系补边 E2E)`);

/* ================================================================== */
/*  v3.45 谱系补边 (lineage edge-completion) E2E harness               */
/* ================================================================== */

const ENRICH_TOKEN = "enrich-test";
let enrichUploadedJobs: Record<string, Record<string, unknown>> = {};
let enrichJobsLanded = false;
const enrichPhases = new Set<string>();

function resetEnrichState() {
  enrichUploadedJobs = {};
  enrichJobsLanded = false;
  enrichPhases.clear();
}

/** Extract the REAL capture script from the shipped TSX (same template
 *  unescaping Bun applies when parsing the module) with ${webAppUrl}
 *  substituted to this origin. */
function extractCaptureScript(): string {
  const tsx = readFileSync(
    join(import.meta.dir, "../../src/app/components/cryosmart/smart-capture-panel.tsx"),
    "utf8",
  ) as string;
  const startMarker = "const captureScript = `";
  const start = tsx.indexOf(startMarker);
  if (start < 0) throw new Error("captureScript start marker not found");
  const bodyStart = start + startMarker.length;
  const endMarker = "\n`.trim();";
  const end = tsx.indexOf(endMarker, bodyStart);
  if (end < 0) throw new Error("captureScript end marker not found");
  const raw = tsx.slice(bodyStart, end);
  // Template-literal semantics: parse it the way the bundler would.
  const script = new Function(
    "webAppUrl",
    "return `" + raw + "`;",
  )(ORIGIN) as string;
  if (!script.includes("谱系补边")) throw new Error("extracted script is not v3.45");
  return script;
}

const CAPTURE_SCRIPT_FOR_HARNESS = extractCaptureScript();

/* Mock P208 store — reproduces the real capture's partial-detail state.
 * isg = input_slot_groups (fully detailed jobs), parents-only = list-level,
 * bare = never opened. */
const V = (uid: string) => ({ type: "volume", name: "volume", connections: [{ job_uid: uid }] });
const P = (...uids: string[]) => ({ type: "particle", name: "particles", connections: uids.map((u) => ({ job_uid: u })) });
const M = (uid: string) => ({ type: "micrograph", name: "micrographs", connections: [{ job_uid: uid }] });
const OUT = (name: string, contains: Array<Record<string, string>>, num?: number) => ({
  name,
  num_items: num,
  contains,
});
const VOL_MAP = { type: "volume.blob", name: "map" };

function mkJob(uid: string, job_type: string, parents: string[], isg: unknown[] = [], outputs: unknown[] = []) {
  return {
    uid,
    job_type,
    title: `${job_type} ${uid}`,
    status: "completed",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T01:00:00Z",
    parents,
    children: [],
    input_slot_groups: isg,
    output_result_groups: outputs,
  };
}

/** The store's INITIAL state (what STEP 2 extraction sees). */
const MOCK_JOBS: Array<Record<string, unknown>> = [
  // volume chain — fully detailed (the user had these open)
  mkJob("J498", "deep_emhancer", ["J497"], [V("J497")], [OUT("volume", [VOL_MAP])]),
  mkJob("J497", "local_refine", ["J494", "J476"], [V("J494"), P("J476")], [OUT("volume", [VOL_MAP])]),
  mkJob("J494", "hetero_refine", ["J420", "J448"], [V("J420"), P("J448")], [OUT("volume_class_0", [VOL_MAP])]),
  mkJob("J448", "nonuniform_refine", ["J443", "J476"], [V("J443"), P("J476")], [OUT("volume", [VOL_MAP])]),
  mkJob("J443", "homo_refine", ["J422", "J476"], [V("J422"), P("J476")], [OUT("volume", [VOL_MAP])]),
  mkJob("J422", "homo_refine", ["J446", "J476"], [V("J446"), P("J476")], [OUT("volume", [VOL_MAP])]),
  mkJob("J446", "import_volumes", [], [], [OUT("volume", [{ type: "volume.blob", name: "imported_volume_1" }])]),
  // LAST dataset (J474) — the user worked on it recently: fully detailed
  mkJob("J476", "select_2d", ["J472"], [], [OUT("particle", [{ type: "particle.blob", name: "particles" }])]), // LIST-LEVEL (parents only!) — the gap
  mkJob("J472", "class_2d", ["J483"], [P("J483")], []),
  mkJob("J483", "extract_micrographs", ["J481"], [P("J481")], []),
  mkJob("J481", "picker", ["J478"], [M("J478")], []),
  mkJob("J478", "ctf_estimation", ["J475"], [M("J475")], []),
  mkJob("J475", "motion_correction", ["J474"], [M("J474")], []),
  mkJob("J474", "import_movies", [], [], [OUT("exposure", [{ type: "micrograph.blob", name: "micrographs" }], 5562)]),
  // EARLIER dataset (J370) — never opened: bare, count-less import
  mkJob("J420", "homo_abinit", [], [], [OUT("volume_class_0", [VOL_MAP])]), // bare: its J476 particle input is MISSING
  mkJob("J385", "class_2d", [], [], []),
  mkJob("J382", "extract_micrographs", [], [], []),
  mkJob("J379", "picker", [], [], []),
  mkJob("J376", "ctf_estimation", [], [], []),
  mkJob("J373", "motion_correction", [], [], []),
  mkJob("J370", "import_movies", [], [], []), // count-less import
];

/** getJobDetail responses — the FULL truth (mixed uid formats on J476 to
 *  exercise canonicalisation). */
const MOCK_DETAIL: Record<string, Record<string, unknown>> = {
  J420: { parents: ["J476"], input_slot_groups: [P("J476")] },
  J476: {
    parents: ["J385", "BJ.P208.J472"],
    input_slot_groups: [P("BJ.P208.J385", "J472")],
  },
  J385: { parents: ["J382"], input_slot_groups: [P("J382")] },
  J382: { parents: ["J379"], input_slot_groups: [P("J379")] },
  J379: { parents: ["J376"], input_slot_groups: [M("J376")] },
  J376: { parents: ["J373"], input_slot_groups: [M("J373")] },
  J373: { parents: ["J370"], input_slot_groups: [M("J370")] },
  J370: {
    parents: [],
    input_slot_groups: [],
    output_result_groups: [OUT("exposure", [{ type: "micrograph.blob", name: "micrographs" }], 233)],
  },
};

function mockStoreJs(): string {
  return `
window.__MOCK_STORE_JOBS__ = ${JSON.stringify(MOCK_JOBS)};
window.__MOCK_DETAIL__ = ${JSON.stringify(MOCK_DETAIL)};
function __mockStoreJobByBare(bare) {
  for (var i = 0; i < __MOCK_STORE_JOBS__.length; i++) {
    var j = __MOCK_STORE_JOBS__[i];
    var s = String(j.uid); var dot = s.lastIndexOf('.');
    if (dot >= 0) s = s.slice(dot + 1);
    if (s.replace(/^[A-Za-z]+/, '') === bare) return j;
  }
  return null;
}
var socketStoreMock = {
  $id: 'socketStore',
  projectsInMap: {
    P208: { uid: 'P208', experiments: [{ uid: 'E1', jobs: __MOCK_STORE_JOBS__ }] }
  },
  socketManager: { token: 'mock-token' },
  getJobDetail: function (payload) {
    var uid = null;
    if (typeof payload === 'string') uid = payload;
    else if (Array.isArray(payload)) uid = payload[0];
    else if (payload && typeof payload === 'object') uid = payload.job_uid || payload.uid;
    if (!uid) return Promise.resolve({ ok: false });
    var bare = String(uid).replace(/^[A-Za-z]+/, '');
    var detail = __MOCK_DETAIL__[bare] || __MOCK_DETAIL__['J' + bare];
    if (!detail) return Promise.resolve({ ok: false });
    var self = this;
    return new Promise(function (resolve) {
      setTimeout(function () {
        var storeJob = __mockStoreJobByBare(bare);
        if (storeJob) {
          if (detail.parents && detail.parents.length) storeJob.parents = detail.parents;
          if (detail.input_slot_groups) storeJob.input_slot_groups = detail.input_slot_groups;
          if (detail.output_result_groups) storeJob.output_result_groups = detail.output_result_groups;
        }
        resolve({ ok: true });
      }, 25);
    });
  },
  getLogsByJob: function () { return Promise.resolve([]); }   // decoy: log-only, must lose to getJobDetail
};
var piniaMock = { _s: new Map([['socketStore', socketStoreMock]]) };
var qApp = document.getElementById('q-app');
qApp.__vue_app__ = { config: { globalProperties: { $pinia: piniaMock } } };
window.alert = function () {};
`;
}

function enrichPageHtml(): string {
  const script = CAPTURE_SCRIPT_FOR_HARNESS.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>mock CryoSmart P208</title></head>
<body>
<div id="q-app"></div>
<p>v3.45 谱系补边 E2E — mock CryoSmart store loaded, capture script runs automatically.</p>
<script>${mockStoreJs()}</script>
<script>${script}</script>
<script>
(function () {
  var fallback = setTimeout(function () { if (window.__csCaptureFinish) window.__csCaptureFinish(); }, 25000);
  (function poll() {
    fetch('/enrich-status').then(function (r) { return r.json(); }).then(function (s) {
      if (s && s.jobs_landed) {
        clearTimeout(fallback);
        if (window.__csCaptureFinish) window.__csCaptureFinish();
      } else setTimeout(poll, 400);
    }).catch(function () { setTimeout(poll, 800); });
  })();
})();
</script>
</body></html>`;
}

function enrichVerdict(): Record<string, unknown> {
  const byBare: Record<string, Record<string, unknown>> = {};
  for (const job of Object.values(enrichUploadedJobs)) {
    const uid = String(job.uid || "");
    byBare[uid.replace(/^.*\./, "").replace(/^[A-Za-z]+/, "")] = job;
  }
  const parentsOf = (bare: string): string[] => {
    const j = byBare[bare];
    return Array.isArray(j?.parents) ? (j.parents as string[]) : [];
  };
  const hasParent = (bare: string, parentBare: string) =>
    parentsOf(bare).some((p) => String(p).replace(/^.*\./, "").replace(/^[A-Za-z]+/, "") === parentBare);
  const connsOf = (bare: string): string[] => {
    const j = byBare[bare];
    const groups = Array.isArray(j?.input_slot_groups) ? (j.input_slot_groups as Array<Record<string, unknown>>) : [];
    const out: string[] = [];
    for (const g of groups) {
      const conns = Array.isArray(g.connections) ? (g.connections as Array<Record<string, unknown>>) : [];
      for (const c of conns) out.push(String(c.job_uid || ""));
    }
    return out;
  };
  const chain =
    hasParent("385", "382") &&
    hasParent("382", "379") &&
    hasParent("379", "376") &&
    hasParent("376", "373") &&
    hasParent("373", "370");
  const volumeChain =
    hasParent("498", "497") &&
    hasParent("497", "494") &&
    hasParent("494", "420") &&
    hasParent("494", "448") &&
    hasParent("448", "443") &&
    hasParent("443", "422") &&
    hasParent("422", "446");
  const checks: Record<string, unknown> = {
    all_21_jobs_uploaded: Object.keys(byBare).length === 21,
    j476_both_dataset_parents: hasParent("476", "385") && hasParent("476", "472"),
    j476_isg_two_conns: connsOf("476").length === 2,
    j476_conns_canonical: connsOf("476").every((c) => c === "J385" || c === "J472"),
    j476_parents_canonical: parentsOf("476").every((p) => p === "J385" || p === "J472"),
    j420_gained_j476: hasParent("420", "476"),
    earlier_dataset_chain: chain,
    j370_gained_outputs: Array.isArray(byBare["370"]?.output_result_groups) && (byBare["370"].output_result_groups as unknown[]).length > 0,
    j474_untouched: Array.isArray(byBare["474"]?.output_result_groups) && (byBare["474"].output_result_groups as unknown[]).length > 0,
    volume_chain_intact: volumeChain,
    enrich_phase_streamed: enrichPhases.has("enrich"),
    jobs_landed: enrichJobsLanded,
  };
  const failed = Object.entries(checks)
    .filter(([, v]) => v !== true)
    .map(([k]) => k);
  return {
    ok: failed.length === 0,
    failed,
    checks,
    uploaded_uids: Object.keys(byBare).sort(),
    phases: [...enrichPhases].sort(),
  };
}

/* ================================================================== */
/*  v3.46 flow-figure E2E harness                                      */
/*                                                                    */
/*  Reproduces the user's round-5 environment end-to-end:              */
/*    • mock CryoSmart (this origin :3021) requires a cookie for map   */
/*      downloads → ChimeraX's direct read 401s exactly like the      */
/*      user's intranet CryoSmart;                                    */
/*    • a mock in-ChimeraX relay on :8927 speaks the REAL relay.py     */
/*      HTTP contract, but its `open` output uses the LEGACY ChimeraX  */
/*      format ("… on 1 model (id #N)") that broke parseOpenModelId    */
/*      (the round-5 “无法在 ChimeraX 中打开参考地图” root cause), and  */
/*      for J497-flavoured URLs it returns an ID-LESS log at all —     */
/*      exercising the /nextid delta fallback in bridgeOpenModel.      */
/*                                                                      */
/*      v3.47 REAL-ChimeraX emulation (the v3.46 mock accepted          */
/*      `format mrc` over http, which real ChimeraX NEVER does — so     */
/*      the round-6 ladder passed E2E and broke in the field):          */
/*        - `open <http-url> format mrc`  → the exact UserError          */
/*          "Format 'mrc' not supported for database 'http'"            */
/*        - suffix-less http open          → refused (real ChimeraX      */
/*          pops a save dialog + blocks the UI thread instead)          */
/*        - plain open on a .mrc-suffixed http URL → web fetch +        */
/*          legacy/id-less open (as before)                              */
/*        - local staged paths (via POST /stage) → legacy open text      */
/*        - /flow-e2e/reset?http=block → every http open 503s,          */
/*          drilling the page-relay → /stage → local-open rung          */
/* ================================================================== */

const RELAY_PORT = 8927;
const MOCK_APP_ORIGIN = "http://localhost:3000";

/** v3.53: transparent-background render with an opaque colored disc — the
 *  real pipeline now saves every screenshot with `transparentBackground
 *  true` AND colors each map via `volume #<id> color <hex>`, so the mock
 *  serves a PNG that mirrors BOTH: fully transparent margins (alpha 0 —
 *  the coverage scorer + letterbox must preserve it) and the disc in the
 *  color of the model currently shown (tracked from the volume-color +
 *  show/hide commands, so the E2E can assert the class palette survives
 *  all the way into the PPTX media). The old constant black-bg gray-disc
 *  PNG would have green-lit alpha regressions invisibly. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const DISC_PNG_CACHE = new Map<string, Uint8Array>();
function discPng(rgb: [number, number, number]): Uint8Array {
  const key = rgb.join(",");
  const cached = DISC_PNG_CACHE.get(key);
  if (cached) return cached;
  const size = 96;
  const r = 34;
  const cx = size / 2;
  const cy = size / 2;
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const i = row + 1 + x * 4;
      if (d <= r) {
        raw[i] = rgb[0];
        raw[i + 1] = rgb[1];
        raw[i + 2] = rgb[2];
        raw[i + 3] = 255;
      } else {
        raw[i] = 0;
        raw[i + 1] = 0;
        raw[i + 2] = 0;
        raw[i + 3] = 0;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = new Uint8Array(8 + 12 + 13 + 12 + 0 + 12);
  let off = 0;
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], off); off += 8;
  png.set(pngChunk("IHDR", ihdr), off); off += 25;
  const idat = deflateSync(raw);
  const withIdat = new Uint8Array(off + 12 + idat.length + 12);
  withIdat.set(png.subarray(0, off), 0);
  withIdat.set(pngChunk("IDAT", new Uint8Array(idat)), off);
  off += 12 + idat.length;
  withIdat.set(pngChunk("IEND", new Uint8Array(0)), off);
  DISC_PNG_CACHE.set(key, withIdat);
  return withIdat;
}
/* ---- v3.82: the probe-render family — the page now closes the loop on
 * REAL rendered pixels (measureRender: fragmentation / main coverage /
 * standing), so the mock arms a full level×orientation repertoire:
 *   snow    — level below the noise floor: dozens of disconnected specks
 *             (fragmentation ≈ 0.95 → the knee ladder must climb);
 *   sponge  — level too high: one tiny porous core (main coverage ≪ the
 *             ladder's best → the knee's sponge guard rejects);
 *   clean   — 0.12–0.5×max: the standing MUSHROOM when the camera shows
 *             the side view (head ellipse on top, belt band, column
 *             below → standing ≈ +0.12; flipped camera/turns → mirrored
 *             head-down variant, standing ≈ −0.12), the round DISC
 *             otherwise (standing ≈ 0.02, aniso ≈ 1.0);
 *   rollOk  — at the standing elevation, azimuth ≡ 0 (mod 180) renders
 *             the WIDE mushroom (aspect 1.5 — the disk's long axis
 *             horizontal), other azimuths the NARROW one (aspect 0.9) so
 *             the roll refinement has a real optimum to find. ---- */
function drawShape(
  rgb: [number, number, number],
  painter: (set: (x: number, y: number) => void) => void,
): Uint8Array {
  const size = 96;
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw[y * (size * 4 + 1)] = 0; // filter: none
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    raw[i] = rgb[0];
    raw[i + 1] = rgb[1];
    raw[i + 2] = rgb[2];
    raw[i + 3] = 255;
  };
  painter(set);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = new Uint8Array(8 + 12 + 13 + 0 + 12);
  let off = 0;
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], off); off += 8;
  png.set(pngChunk("IHDR", ihdr), off); off += 25;
  const idat = deflateSync(raw);
  const withIdat = new Uint8Array(off + 12 + idat.length + 12);
  withIdat.set(png.subarray(0, off), 0);
  withIdat.set(pngChunk("IDAT", new Uint8Array(idat)), off);
  off += 12 + idat.length;
  withIdat.set(pngChunk("IEND", new Uint8Array(0)), off);
  return withIdat;
}

const SHAPE_PNG_CACHE = new Map<string, Uint8Array>();
function shapePng(kind: string, rgb: [number, number, number]): Uint8Array {
  const key = `${kind}:${rgb.join(",")}`;
  const cached = SHAPE_PNG_CACHE.get(key);
  if (cached) return cached;
  let out: Uint8Array;
  if (kind === "snow") {
    out = drawShape(rgb, (set) => {
      // 42 scattered specks (r≈2.2px) — fragmentation ≈ 1 − 15/650 ≈ 0.98
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let k = 0; k < 42; k++) {
        const cx = 10 + rnd() * 76;
        const cy = 10 + rnd() * 76;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx * dx + dy * dy <= 5) set(Math.round(cx + dx), Math.round(cy + dy));
          }
        }
      }
    });
  } else if (kind === "sponge") {
    out = drawShape(rgb, (set) => {
      // a tiny ring (r 11–13) — one small main component
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          const d = Math.hypot(x - 48, y - 48);
          if (d >= 11 && d <= 13) set(x, y);
        }
      }
    });
  } else {
    // mushroomUp / mushroomDown / mushroomWide / mushroomNarrow — the
    // standing membrane particle: a mass-heavy head ellipse at one end +
    // a THIN LONG column + belt band at the other (the long thin tail is
    // what pushes the mass centroid ≈0.14 of the silhouette height away
    // from the bbox centre — measureRender.standing's signal; a stubby
    // column reads only ≈0.04 and would fail STANDING_ACCEPT).
    const down = kind === "mushroomDown";
    const wide = kind === "mushroomWide";
    const narrow = kind === "mushroomNarrow";
    const headRx = wide ? 40 : narrow ? 20 : 30;
    out = drawShape(rgb, (set) => {
      const headCy = down ? 74 : 22;
      const headRy = 14;
      /* the down variant is the EXACT mirror of up about y=48 (belt
       * 56..66 → 30..40, column 36..88 → 8..60) so |standing| matches. */
      const beltY0 = down ? 30 : 56;
      const beltY1 = beltY0 + 10;
      const colX0 = 44;
      const colX1 = 52;
      const colY0 = down ? 8 : 36;
      const colY1 = down ? 60 : 88;
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          const ex = (x - 48) / headRx;
          const ey = (y - headCy) / headRy;
          if (ex * ex + ey * ey <= 1) {
            set(x, y);
            continue;
          }
          const inBelt = y >= beltY0 && y < beltY1 && Math.abs(x - 48) <= (wide ? 36 : narrow ? 20 : 26);
          const inCol = x >= colX0 && x < colX1 && y >= Math.min(colY0, colY1) && y < Math.max(colY0, colY1);
          if (inBelt || inCol) set(x, y);
        }
      }
    });
  }
  SHAPE_PNG_CACHE.set(key, out);
  return out;
}

/** The render the mock serves for a save: transparent bg + the shown
 * model's volume-color (grey when nothing is on screen / uncolored). */
function mockRenderPng(): Uint8Array {
  const rgb =
    (relayState.shownModel != null && relayState.modelColors.get(relayState.shownModel)) ||
    ([178, 178, 178] as [number, number, number]);
  return discPng(rgb as [number, number, number]);
}

/** v3.82: the probe renders (every `_`-prefixed save) — driven by the
 * CURRENT per-model display level (snow below 0.12×max, sponge above
 * 0.5) and the standing/roll camera state (mushroom vs disc, wide vs
 * narrow). This is what the page's measureRender actually scores. */
function probeRenderPng(name: string): Uint8Array | null {
  if (!name.startsWith("_")) return null;
  const rgb: [number, number, number] =
    (relayState.shownModel != null && relayState.modelColors.get(relayState.shownModel)) ||
    [178, 178, 178];
  const level =
    relayState.shownModel != null ? relayState.modelLevels.get(relayState.shownModel) ?? 0.25 : 0.25;
  if (level < 0.12) return shapePng("snow", rgb as [number, number, number]);
  if (level > 0.5) return shapePng("sponge", rgb as [number, number, number]);
  const st = standingState();
  if (st === 0) return discPng(rgb as [number, number, number]);
  if (st < 0) return shapePng("mushroomDown", rgb as [number, number, number]);
  return shapePng(rollOkState() ? "mushroomWide" : "mushroomUp", rgb as [number, number, number]);
}

/** v3.82: is the current camera a STANDING side view? +1 head-up, −1
 * head-down, 0 not standing. The camera forms (view matrix camera with
 * the expected rotation — default up / flip down) set it directly; the
 * turn drills stand at viewX ≈ 90 (up) or ≈ 270 (a `turn x 180` flip). */
function standingState(): 0 | 1 | -1 {
  if (relayState.camDir === 1 || relayState.camDir === -1) return relayState.camDir;
  const x = ((relayState.viewX % 360) + 360) % 360;
  if (Math.abs(x - 90) < 1e-6) return 1;
  if (Math.abs(x - 270) < 1e-6) return -1;
  return 0;
}

/** v3.82: at a standing elevation, is the azimuth aligned with the
 * disk's long axis (y ≡ 0 mod 180)? — the roll refinement's optimum. */
function rollOkState(): boolean {
  const y = ((relayState.viewY % 180) + 180) % 180;
  return y < 5 || y > 175;
}

/* v3.80: the expected `view matrix camera` ROTATIONS for the mock's fixed
 * /membrane PCA reply — n = (2,1,2)/3 (the page's sign rule keeps +Y
 * first-significant), ea = (1,-2,0)/√5, z = ea×n = (-0.596285, -0.298143,
 * 0.745356); the rotation COLUMNS are [ea | n | z], exactly as the page
 * formats them (toFixed(6)). flip negates n (and z). */
const EXPECTED_CAM_ROT_DEFAULT = [
  [0.447214, 0.666667, -0.596285],
  [-0.894427, 0.333333, -0.298143],
  [0.0, 0.666667, 0.745356],
];
const EXPECTED_CAM_ROT_FLIP = [
  [0.447214, -0.666667, 0.596285],
  [-0.894427, -0.333333, 0.298143],
  [0.0, -0.666667, -0.745356],
];

/** Minimal plausible MRC2014 volume (8³ float32 + 1024-byte header). */
function mrcBytes(seedSource: string): Uint8Array {
  let seed = 0;
  for (let i = 0; i < seedSource.length; i++) seed = (seed * 31 + seedSource.charCodeAt(i)) & 0xffff;
  const buf = new Uint8Array(1024 + 8 * 8 * 8 * 4);
  const dv = new DataView(buf.buffer);
  dv.setInt32(0, 8, true); // nx
  dv.setInt32(4, 8, true); // ny
  dv.setInt32(8, 8, true); // nz
  dv.setInt32(12, 2, true); // mode = float32
  dv.setInt32(20, 1, true); // nxstart
  dv.setInt32(40, 8, true); // mx
  dv.setInt32(44, 8, true); // my
  dv.setInt32(48, 8, true); // mz
  dv.setFloat32(56, 100.0, true); // xlength
  for (let i = 0; i < 512; i++) dv.setFloat32(1024 + i * 4, Math.sin(i * 0.13 + seed) * 0.5, true);
  return buf;
}

/* ---- mock relay state (mirrors ChimeraX model ids: max+1) ---------- */
interface RelayOpenRecord {
  url: string;
  status: number;
  modelId: number | null;
  idless: boolean;
  /** v3.47: `open <http-url> format mrc` — real ChimeraX rejects these. */
  formatRejected?: boolean;
  /** v3.47: open of a local /stage'd path. */
  local?: boolean;
}
const relayState = {
  models: new Map<number, { url: string }>(),
  files: new Map<string, Uint8Array>(),
  opens: [] as RelayOpenRecord[],
  commands: [] as string[],
  /** v3.47: path -> staged bytes (what POST /stage wrote). */
  staged: new Map<string, { name: string; bytes: Uint8Array }>(),
  /** v3.70: the CURRENT persistent map-cache dir — POST /cachedir switches
   *  it at runtime (mirrors relay.py); staged bytes stay keyed by their
   *  full path so a switch does NOT "move" already-cached maps. */
  cacheDir: "/tmp/cryoflow-mock/staged",
  /** v3.72: every successful POST /deliver + `save … format mrc` write —
   *  keyed by the final dst path (the E2E asserts the delivered set). */
  delivered: new Map<string, { src: string; size: number }>(),
  /** v3.47: /flow-e2e/reset?http=block — all http opens fail 503. */
  httpBlocked: false,
  /** v3.48: `save image …` commands rejected (not a ChimeraX command). */
  saveImageRejected: 0,
  /** v3.48: /flow-e2e/reset?save=reject — every legit save errors (drill). */
  saveRejected: false,
  /** v3.50: ChimeraX process cwd — null until `cd <workdir>` succeeds; a
   *  RELATIVE save only lands in the workdir (i.e. /file-fetchable) after
   *  the cd. */
  cwd: null as string | null,
  /** v3.50: the CURRENT workdir /ping reports — /file, cd and relative
   *  saves all resolve against it; ?workdir=2 rotates it to simulate a
   *  ChimeraX/relay restart (new mkdtemp) between page runs. */
  workdir: "/tmp/cryoflow-mock",
  /** v3.50: /flow-e2e/reset?file404=abs — absolute-path saves succeed but
   *  divert OUTSIDE the workdir, recreating the user's clean-save +
   *  /file 404 symptom. */
  divertAbsSave: false,
  saveAbsDiverted: 0,
  cdOk: 0,
  saveRelativeOk: 0,
  saveRelativeMissed: 0,
  /** v3.52→v3.53: explicit surface-color commands received (`volume #<id>
   *  color <hex>` since v3.53 — the atom-only `color #<id> <hex>` still
   * counts if a stale page sends it, so regressions stay visible)… */
  colorCommands: 0,
  /** … and the distinct hex values in FIRST-SEEN order — the E2E asserts
   *  Chimera's default open palette (grey/pale yellow/violet/lavender/tan
   *  for classes 0-4) reached ChimeraX in class order. */
  colorHexes: [] as string[],
  /** v3.53: model id → RGB from `volume #<id> color <hex>` — drives the
   *  colored-disc save PNGs (mockRenderPng). */
  modelColors: new Map<number, [number, number, number]>(),
  /** v3.55: the model currently on screen (last `show #N models`), used to
   *  pick the disc color at save time. */
  shownModel: null as number | null,
  /** v3.53: saves that passed transparentBackground true / false. */
  saveTransparentBg: 0,
  saveOpaqueBg: 0,
  /** v3.53: `set bgColor` commands received — v3.53+ sends NONE (the E2E
   *  asserts 0; any nonzero means a stale page or a regression). */
  setBgColorCommands: 0,
  /** v3.55 (round-14): `close #N` / `close all` model ids actually closed
   *  (the page's pre-run leftover cleanup + post-run own-model cleanup) and
   *  the close-all count — the browser E2E asserts the run closed the staged
   *  leftover BEFORE the first open and its own models at the end. */
  closedIds: [] as number[],
  closeAllCommands: 0,
  /** v3.68 E2E: what `measure correlation` reports (reset ?corr=N). */
  corrOverride: 0.42,
  /** v3.80 E2E: accumulated NAMED-axis turn state (view _cfbase / view
   * orient / view matrix camera reset it) — drives the standing/roll
   * probe renders for the membrane-view scan drill. */
  viewX: 0,
  viewY: 0,
  /** v3.82 E2E: the CURRENT camera's standing state, set by an expected
   * `view matrix camera` rotation (+1 default up / −1 flip; 0 anything
   * else — the disc render). The turn state above drives the drills
   * (viewX ≈ 90 stands up, ≈ 270 = a `turn x 180` flip). */
  camDir: 0 as 0 | 1 | -1,
  /** v3.82 E2E: per-model display level from `volume #N level X` — the
   * probe renders are LEVEL-keyed (snow < 0.12, sponge > 0.5, clean in
   * between), exactly the knee ladder's decision surface. */
  modelLevels: new Map<number, number>(),
  /** v3.85 E2E: `surface dust #N size 8.08` commands received (the
   * auto_color_locres.py cleanup riding every display level). */
  dustCommands: 0,
  /** v3.82 E2E drill: "" (current relay: /membrane + /membrane2 + flags),
   * "old" (pre-3.82 relay: no /membrane2, flag off — the page must fall
   * to the legacy envelope camera then the standing scan), "nomembrane"
   * (pre-3.77 relay: neither endpoint — the standing scan is the ONLY
   * orientation source left). */
  relayMode: "" as "" | "old" | "nomembrane",
  /** v3.80 E2E drill: /flow-e2e/reset?membrane=camreject — every `view
   * matrix camera` errors, so the page must fall through transpose →
   * turn-grid scan (the round-39 silent-failure path, now recoverable). */
  camReject: false,
  cameraAccepts: 0,
  cameraRejects: 0,
};

function resetRelayState() {
  relayState.models.clear();
  relayState.files.clear();
  relayState.opens = [];
  relayState.commands = [];
  relayState.staged.clear();
  relayState.delivered.clear();
  relayState.httpBlocked = false;
  relayState.saveImageRejected = 0;
  relayState.saveRejected = false;
  relayState.cwd = null;
  relayState.workdir = "/tmp/cryoflow-mock";
  relayState.divertAbsSave = false;
  relayState.saveAbsDiverted = 0;
  relayState.cdOk = 0;
  relayState.saveRelativeOk = 0;
  relayState.saveRelativeMissed = 0;
  relayState.colorCommands = 0;
  relayState.colorHexes = [];
  relayState.modelColors.clear();
  relayState.shownModel = null;
  relayState.saveTransparentBg = 0;
  relayState.saveOpaqueBg = 0;
  relayState.setBgColorCommands = 0;
  relayState.closedIds = [];
  relayState.closeAllCommands = 0;
  relayState.corrOverride = 0.42;
  relayState.viewX = 0;
  relayState.viewY = 0;
  relayState.camDir = 0;
  relayState.modelLevels.clear();
  relayState.dustCommands = 0;
  relayState.relayMode = "";
  relayState.camReject = false;
  relayState.cameraAccepts = 0;
  relayState.cameraRejects = 0;
}

function relayNextModelId(): number {
  let max = 0;
  for (const id of relayState.models.keys()) if (id > max) max = id;
  return max + 1;
}

function relayStats() {
  const viaProxy = (u: string) => u.startsWith(`${MOCK_APP_ORIGIN}/api/cryosmart/`);
  const direct = (u: string) => !viaProxy(u) && u.includes(":3021/api/log_image/");
  return {
    opens: relayState.opens,
    files: [...relayState.files.keys()],
    commands: relayState.commands.length,
    http_blocked: relayState.httpBlocked,
    staged_files: [...relayState.staged.keys()],
    open_total: relayState.opens.length,
    open_direct_401: relayState.opens.filter((o) => direct(o.url) && o.status === 401).length,
    open_proxy_200: relayState.opens.filter((o) => viaProxy(o.url) && o.status === 200).length,
    open_asset: relayState.opens.filter((o) => u_hasAsset(o.url)).length,
    open_idless_resolved: relayState.opens.filter((o) => o.idless && o.modelId != null).length,
    open_legacy_text: relayState.opens.filter((o) => !o.idless && o.modelId != null).length,
    open_staged_local: relayState.opens.filter((o) => o.local && o.modelId != null).length,
    open_http_format_rejected: relayState.opens.filter((o) => o.formatRejected).length,
    save_image_rejected: relayState.saveImageRejected,
    save_rejected_mode: relayState.saveRejected,
    file404_abs_mode: relayState.divertAbsSave,
    workdir: relayState.workdir,
    save_absolute_diverted: relayState.saveAbsDiverted,
    cd_ok: relayState.cdOk,
    save_relative_ok: relayState.saveRelativeOk,
    save_relative_missed: relayState.saveRelativeMissed,
    color_commands: relayState.colorCommands,
    color_hexes: [...relayState.colorHexes],
    save_transparent_bg: relayState.saveTransparentBg,
    save_opaque_bg: relayState.saveOpaqueBg,
    set_bgcolor_commands: relayState.setBgColorCommands,
    dust_commands: relayState.dustCommands,
    // v3.55: leftover/own-model cleanup observability.
    close_ids_closed: [...relayState.closedIds],
    close_all_commands: relayState.closeAllCommands,
    models_open: relayState.models.size,
  };
}
function u_hasAsset(u: string): boolean {
  return u.includes("/api/cryosmart/flow-figure/asset");
}

/** The ChimeraX command simulator (legacy 1.13-style log output). */
async function relaySimulate(raw: string): Promise<{ text: string; error: string | null }> {
  const command = String(raw || "").trim();
  relayState.commands.push(command);

  // v3.53: record the REAL volume-surface coloring command `volume #<id>
  // color <hex>` (plus the legacy atom-only `color #<id> <hex>` so a stale
  // page's no-op attempt stays visible in the stats). The palette order
  // assert is the v3.54 user-pasted Chimera classic list: #b2b2b2 grey,
  // #ffffb2 pale yellow, #b2ffff pale cyan, #b2b2ff pale blue, #ffb2ff
  // pale magenta, … in class order.
  const volColorMatch = /^volume\s+#[\d.]+\s+color\s+(#[0-9a-fA-F]{6,8})\b/.exec(command);
  const atomColorMatch = /^color\s+#[\d.]+\s+(#[0-9a-fA-F]{6,8})\b/.exec(command);
  if (volColorMatch || atomColorMatch) {
    relayState.colorCommands += 1;
    const hex = (volColorMatch?.[1] ?? atomColorMatch?.[1] ?? "").slice(0, 7).toLowerCase();
    if (hex && !relayState.colorHexes.includes(hex)) relayState.colorHexes.push(hex);
    if (volColorMatch) {
      const idMatch = /^volume\s+#(\d+(?:\.\d+)?)\s+color\s+/i.exec(command);
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (idMatch && m) {
        relayState.modelColors.set(parseInt(idMatch[1], 10), [
          parseInt(m[1], 16),
          parseInt(m[2], 16),
          parseInt(m[3], 16),
        ]);
      }
    }
  }
  // v3.82: track the per-model DISPLAY level (`volume #N level X step 1`)
  // — the probe renders are level-keyed (snow / clean / sponge), which is
  // exactly what the page's knee ladder walks.
  const volLevelMatch = /^volume\s+#(\d+(?:\.\d+)?)\s+level\s+(-?[\d.eE+]+)\b/i.exec(command);
  if (volLevelMatch) {
    relayState.modelLevels.set(parseInt(volLevelMatch[1], 10), Number(volLevelMatch[2]));
  }
  // v3.85: count the script-rule dust cleanup (`surface dust #N size 8.08`)
  // — the E2E asserts it rides every display-level application.
  if (/^surface\s+dust\s+#\d+\s+size\s+8\.08\b/i.test(command)) {
    relayState.dustCommands += 1;
  }

  // v3.53: track the on-screen model (drives per-class disc colors on
  // save) and tripwire the retired `set bgColor` command.
  const showMatch = /^show\s+#(\d+)\s+models/i.exec(command);
  if (showMatch) relayState.shownModel = parseInt(showMatch[1], 10);
  const hideMatch = /^hide\s+#(\d+)\s+models/i.exec(command);
  if (hideMatch && relayState.shownModel === parseInt(hideMatch[1], 10)) {
    relayState.shownModel = null;
  }
  if (/^set\s+bgColor\b/i.test(command)) relayState.setBgColorCommands += 1;

  const openMatch = /^open\s+"([^"]+)"(?:\s+format\s+(\S+))?\s*$/i.exec(command);
  if (openMatch) {
    const url = openMatch[1];
    const explicitFormat = openMatch[2] ? openMatch[2].toLowerCase() : null;
    const isHttp = /^https?:\/\//i.test(url);
    // v3.47 REAL-ChimeraX emulation — the ladder must fail exactly like
    // the user's real build when a format is forced onto an http source.
    if (isHttp && explicitFormat === "mrc") {
      relayState.opens.push({ url, status: 415, modelId: null, idless: false, formatRejected: true });
      return {
        text: "",
        error:
          "UserError: Format 'mrc' not supported for database 'http'. Supported formats are: web fetch or HTML",
      };
    }
    // v3.47: suffix sniffing mirrors ChimeraX's web fetch — the URL PATH
    // basename must end in an MRC-family suffix (.map/.mrc/.mrcs/.ccp4;
    // CryoSmart names its maps volume.map); a suffix that only appears in
    // the query string (asset route ?name=…mrc) leaves the path suffix-less.
    let httpPathMap = false;
    try {
      httpPathMap = /\.(mrc|mrcs|map|ccp4)$/i.test(new URL(url).pathname);
    } catch {
      httpPathMap = /\.(?:mrc|mrcs|map|ccp4)(?:\?|#|$)/i.test(url);
    }
    if (isHttp && !httpPathMap) {
      // Real ChimeraX pops its save-file dialog here and blocks the UI
      // thread; the v3.47 card refuses suffix-less http opens app-side, so
      // reaching this branch is a regression.
      relayState.opens.push({ url, status: 406, modelId: null, idless: false });
      return { text: "", error: "UserError: suffix-less http URL (would pop a save dialog)" };
    }
    if (!isHttp) {
      // LOCAL file — must have arrived through POST /stage.
      const staged = relayState.staged.get(url);
      if (!staged) {
        relayState.opens.push({ url, status: 404, modelId: null, idless: false });
        return { text: "", error: `UserError: Unable to open ${url} — file not found on the ChimeraX machine (was it staged via /stage?)` };
      }
      const id = relayNextModelId();
      relayState.models.set(id, { url });
      // v3.82: a newly opened model DISPLAYS by default (ChimeraX
      // semantics) — the probe renders are level-keyed per shown model.
      relayState.shownModel = id;
      relayState.opens.push({ url, status: 200, modelId: id, idless: false, local: true });
      return {
        text: `Opened ${staged.name}, grid size 8,8,8, grid spacing 1.25,1.25,1.25 on 1 model (id #${id})`,
        error: null,
      };
    }
    if (relayState.httpBlocked) {
      // /flow-e2e/reset?http=block — pretend ChimeraX cannot reach the app
      // origin at all, so the ladder falls through to page relay + /stage.
      relayState.opens.push({ url, status: 503, modelId: null, idless: false });
      return { text: "", error: "UserError: HTTP Error 503: Service Unavailable" };
    }
    try {
      // ChimeraX's urllib fetch — NO cookies, no Origin.
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        relayState.opens.push({ url, status: res.status, modelId: null, idless: false });
        const reason = res.statusText || "error";
        return { text: "", error: `UserError: HTTP Error ${res.status}: ${reason}` };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const id = relayNextModelId();
      relayState.models.set(id, { url });
      // v3.82: a newly opened model DISPLAYS by default.
      relayState.shownModel = id;
      const idless = /\/J497\./.test(url);
      relayState.opens.push({ url, status: res.status, modelId: id, idless });
      if (idless) {
        // A build that logs the download but never the model id — only the
        // /nextid delta can recover it.
        return { text: `Downloaded ${url} (${bytes.byteLength} bytes)`, error: null };
      }
      // LEGACY ChimeraX (≤1.13) — no "as #N" anywhere. The v3.45 regex
      // returned null on this exact shape (round-5 root cause).
      return {
        text: `Opened map.mrc, grid size 8,8,8, grid spacing 1.25,1.25,1.25 on 1 model (id #${id})`,
        error: null,
      };
    } catch (err) {
      relayState.opens.push({ url, status: 0, modelId: null, idless: false });
      return { text: "", error: `UserError: ${String(err)}` };
    }
  }

  if (/^close\s+all\b/i.test(command)) {
    // v3.55: the page's fallback cleanup on relays predating /volumes.
    relayState.closeAllCommands += 1;
    for (const id of [...relayState.models.keys()]) {
      relayState.closedIds.push(id);
      relayState.models.delete(id);
    }
    return { text: "", error: null };
  }

  if (/^close\s+#\d+/i.test(command)) {
    for (const m of command.matchAll(/#(\d+)/g)) {
      const id = parseInt(m[1], 10);
      if (relayState.models.has(id)) relayState.closedIds.push(id);
      relayState.models.delete(id);
      // v3.82: closing the shown model leaves nothing displayed.
      if (relayState.shownModel === id) relayState.shownModel = null;
    }
    return { text: "", error: null };
  }

  const flipMatch = /^volume\s+flip\s+#(\d+)\s+axis\s+\w+(\s+modelId\s+(\d+))?/i.exec(command);
  if (flipMatch) {
    const src = relayState.models.get(parseInt(flipMatch[1], 10));
    const next = flipMatch[3] ? parseInt(flipMatch[3], 10) : relayNextModelId();
    relayState.models.set(next, { url: src?.url || "flipped" });
    return { text: `volume flip: new model (id #${next})`, error: null };
  }

  if (/^measure\s+correlation/i.test(command)) {
    // v3.68 E2E: the correlation value is configurable (/flow-e2e/reset?
    // corr=0.9) so the browser E2E can exercise BOTH adaptive paths — the
    // default 0.42 (below the 0.85 target → all 3 search rounds append)
    // and an override ≥ 0.85 (target reached in round 1 → later rounds
    // skip, and a local track already ≥ target skips the search entirely).
    return { text: `  correlation = ${relayState.corrOverride.toFixed(2)}`, error: null };
  }
  if (/^fit\s+#\d+\s+in\s+#\d+\s+search/i.test(command)) {
    return { text: "Fit map in map, 15 positions tried, correlation = 0.93", error: null };
  }
  if (/^fit\s+#\d+\s+in\s+#\d+/i.test(command)) {
    return { text: "Fit map in map, correlation = 0.87", error: null };
  }

  // v3.48 REAL-ChimeraX emulation — the round-7 lesson: this mock used to
  // accept `save image "<path>"` (the bridge's then-broken command), which
  // green-lit the E2E while the user's real ChimeraX rejected every
  // screenshot (relay /file 404, 覆盖率 0.0000). Real grammar (same as the
  // proven desktop helper): save "<filename.png>" [width N] [height N]
  // [supersample N] [transparentBackground true|false] — `save image …`
  // parses the suffix-less word "image" as the filename and ERRORS out.
  //
  // v3.50 emulation — WHERE the save lands decides whether /file can fetch
  // it back (the round-9 lesson: a clean save is no proof the file is in
  // the workdir):
  //   - ABSOLUTE path (any dir separator / drive letter) → lands at that
  //     path. Under the file404=abs drill that path is OUTSIDE the workdir
  //     — the mock stores nothing, /file 404s, exactly like a real ChimeraX
  //     whose path resolution diverged from the bridge's join.
  //   - RELATIVE bare name → lands in the process CWD; only /file-fetchable
  //     once `cd <workdir>` ran (the bridge's cd-rel rung).
  // v3.72: `save "<dst>" models #N [format mrc]` — deliverFlippedMap's
  // chirality-corrected MRC write (open cached map → volume flip → save
  // straight into the 交付目录). The mock writes REAL bytes to disk so the
  // page's /deliver {stat} verification finds them.
  const saveMrcMatch = /^save\s+"([^"]+)"\s+models\s+#(\d+)(?:\s+format\s+mrc)?\s*$/i.exec(command);
  if (saveMrcMatch) {
    const modelId = parseInt(saveMrcMatch[2], 10);
    const model = relayState.models.get(modelId);
    const dst = saveMrcMatch[1];
    try {
      const norm = dst.replace(/\\/g, "/");
      const dir = norm.slice(0, norm.lastIndexOf("/"));
      mkdirSync(dir, { recursive: true });
      const bytes = mrcBytes(model?.url || norm);
      writeFileSync(norm, bytes);
      relayState.delivered.set(norm, { src: `flip:${model?.url ?? "?"}`, size: bytes.length });
      return { text: `saved ${dst}`, error: null };
    } catch (err) {
      return { text: "", error: `OSError: ${String(err)}` };
    }
  }

  const cdMatch = /^cd\s+"([^"]+)"\s*$/i.exec(command);
  if (cdMatch) {
    if (cdMatch[1] === relayState.workdir) {
      relayState.cwd = cdMatch[1];
      relayState.cdOk += 1;
      return { text: "", error: null };
    }
    return { text: "", error: `UserError: cd: ${cdMatch[1]}: no such directory` };
  }
  const saveMatch =
    /^save\s+"([^"]+\.png)"(?:\s+width\s+\d+)?(?:\s+height\s+\d+)?(?:\s+supersample\s+\d+)?(?:\s+transparentBackground\s+(true|false))?\s*$/i.exec(command);
  if (saveMatch) {
    // v3.53: every save must ask for a transparent background now — the
    // E2E asserts save_opaque_bg stays 0.
    if (saveMatch[2] === "false") relayState.saveOpaqueBg += 1;
    else relayState.saveTransparentBg += 1;
    if (relayState.saveRejected) {
      return {
        text: "",
        error: "OSError: [Errno 28] No space left on device (simulated /flow-e2e/reset?save=reject drill)",
      };
    }
    const target = saveMatch[1];
    const isAbsolute = /[\\/]/.test(target) || /^[A-Za-z]:/.test(target);
    if (isAbsolute) {
      if (relayState.divertAbsSave) {
        // Clean save that landed OUTSIDE the workdir — /file will 404.
        relayState.saveAbsDiverted += 1;
        return { text: `saved ${target}`, error: null };
      }
      const name = target.split(/[\\/]/).pop() || "img.png";
      relayState.files.set(name, probeRenderPng(name) ?? mockRenderPng());
      return { text: `saved ${target}`, error: null };
    }
    // Relative save — ChimeraX writes into its process cwd.
    if (relayState.cwd === relayState.workdir) {
      relayState.saveRelativeOk += 1;
      relayState.files.set(target, probeRenderPng(target) ?? mockRenderPng());
    } else {
      relayState.saveRelativeMissed += 1;
    }
    return { text: `saved ${target}`, error: null };
  }
  if (/^save\s+image\b/i.test(command)) {
    relayState.saveImageRejected++;
    return {
      text: "",
      error:
        "UserError: 'image' has no recognizable file suffix; use: save <filename.png> width <px> height <px> supersample <n> transparentBackground false",
    };
  }

  // v3.79 contract guard: bare `view matrix` REPORTS the camera + model
  // matrices in the log (12 comma-separated numbers each — identity camera
  // here, which the page's membrane-view math reads and compensates for).
  if (/^view\s+matrix\s*$/i.test(command)) {
    return {
      text: "camera: 1.000000,0.000000,0.000000,0.000000,0.000000,1.000000,0.000000,0.000000,0.000000,0.000000,1.000000,0.000000",
      error: null,
    };
  }
  // v3.80→v3.82: view-state tracking for the probe renders — `view
  // orient` (deterministic base) and `view _cfbase` (restore) both reset
  // the accumulated turn state and the camera's standing direction.
  if (/^view\s+orient$/i.test(command) || /^view\s+_cfbase$/i.test(command)) {
    relayState.viewX = 0;
    relayState.viewY = 0;
    relayState.camDir = 0;
    return { text: "", error: null };
  }
  // v3.80→v3.82: NAMED-axis turns (the membrane scan uses only these —
  // `turn x 90`, `turn y 45`, `turn x -22.5` …). The accumulated state
  // drives the drill renders: viewX ≈ 90 stands the mushroom up (≈ 270 =
  // a `turn x 180` flip, head-down); the azimuth decides the roll variant.
  const namedTurnMatch = /^turn\s+([xyz])\s+(-?\d+(?:\.\d+)?)$/i.exec(command);
  if (namedTurnMatch) {
    const deg = Number(namedTurnMatch[2]);
    if (namedTurnMatch[1].toLowerCase() === "x") relayState.viewX += deg;
    else relayState.viewY += deg;
    relayState.camDir = 0;
    return { text: "", error: null };
  }
  // v3.79 contract guard: `view matrix camera` REQUIRES 12 (or 16)
  // comma-separated numbers — real ChimeraX rejects the 9-number
  // rotation-only form that v3.78 shipped (the delivered membrane view
  // silently fell back to the top-down coverage view). Any future
  // 9-number camera matrix fails loudly in E2E instead.
  // v3.80: additionally, the ROTATION is validated against the mock's
  // PCA reply (columns [ea | n | ea×n], default or flip) — the expected
  // membrane orientation arms the BAND probe render; anything else
  // (e.g. the transpose hedge) leaves the disc armed. ?membrane=camreject
  // errors every camera command so the page must fall to the scan.
  const vmcMatch = /^view\s+matrix\s+camera\s+([\d.,eE+\-\s]+)$/i.exec(command);
  if (vmcMatch) {
    const parts = vmcMatch[1].split(",").filter((s) => s.trim() !== "");
    const n = parts.length;
    if (n !== 12 && n !== 16) {
      relayState.cameraRejects += 1;
      return {
        text: "",
        error: `UserError: view matrix camera: expected 12 or 16 numbers, got ${n}`,
      };
    }
    if (relayState.camReject) {
      relayState.cameraRejects += 1;
      return {
        text: "",
        error: "UserError: view matrix camera: drill rejection (?membrane=camreject)",
      };
    }
    const nums = parts.map(Number);
    const rot = [
      [nums[0], nums[1], nums[2]],
      [nums[4], nums[5], nums[6]],
      [nums[8], nums[9], nums[10]],
    ];
    const closeTo = (want: number[][]) =>
      want.every((row, i) => row.every((v, j) => Math.abs(rot[i][j] - v) < 1e-4));
    /* v3.82: the expected rotation arms the STANDING mushroom probe
     * (camDir +1 head-up; the flip rotation −1 head-down); anything else
     * (the transpose hedge, the top baseline, a band camera built from a
     * different axes source) leaves the disc armed — the page's
     * measureRender.standing decides acceptance on real pixels. */
    if (closeTo(EXPECTED_CAM_ROT_DEFAULT)) relayState.camDir = 1;
    else if (closeTo(EXPECTED_CAM_ROT_FLIP)) relayState.camDir = -1;
    else relayState.camDir = 0;
    if (relayState.camDir !== 0) relayState.cameraAccepts += 1;
    relayState.viewX = 0;
    relayState.viewY = 0;
    return { text: "", error: null };
  }
  // v3.79: the membrane view now orients via a single screen-frame
  // `turn <axis> <angle>` (axis = 3 comma-separated numbers, angle in
  // degrees) — validate the shape so a malformed turn fails loudly.
  const turnVecMatch = /^turn\s+(-?[\d.eE+]+),(-?[\d.eE+]+),(-?[\d.eE+]+)\s+(-?[\d.eE+.]+)$/i.exec(command);
  if (turnVecMatch) {
    const u = [Number(turnVecMatch[1]), Number(turnVecMatch[2]), Number(turnVecMatch[3])];
    const len = Math.hypot(u[0], u[1], u[2]);
    if (!(len > 0.99 && len < 1.01)) {
      return { text: "", error: `UserError: turn: axis must be a unit vector (|u|=${len.toFixed(3)})` };
    }
    return { text: "", error: null };
  }

  // volume level/step, set bgColor, view *, turn *, wait, hide/show —
  // silent success, exactly like the real relay's captured empty log.
  return { text: "", error: null };
}

const relayServer = Bun.serve({
  port: RELAY_PORT,
  async fetch(req) {
    const u = new URL(req.url);
    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": req.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Filename",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "86400",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const reply = (code: number, body: unknown, ctype = "application/json") =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: code,
        headers: { ...cors, "Content-Type": ctype, "Cache-Control": "no-store" },
      });
    try {
      if (u.pathname === "/ping") {
        return reply(200, {
          ok: true,
          workdir: relayState.workdir,
          version: "1.13-mock-legacy",
          // v3.47: the card's page-relay rung requires POST /stage — this
          // flag mirrors the real relay.py's /ping field.
          stage: true,
          // v3.56: mirrors relay.py's persistent map cache — the card skips
          // the /staged cache check (and keeps re-downloading maps) when
          // the ping carries no `cache` flag.
          cache: true,
          // v3.65: mirrors relay.py's POST /fetch — the card's local-dir
          // download rung requires this flag (without it the ladder falls
          // back to direct/proxy/page-relay).
          fetch: true,
          // v3.70: mirrors relay.py's POST /cachedir — the 桥接面板's
          // 下载目录 input enables only when this flag is present.
          cachedir_set: true,
          // v3.72: mirrors relay.py's POST /deliver — the card's 交付文件
          // phase (delivery writes into the user's 交付目录) arms only when
          // this flag is present.
          deliver: true,
          // v3.77: mirrors relay.py's GET /membrane — the membrane-normal
          // PCA endpoint behind the 膜蛋白视图 (detergent disk standing in
          // the screen XZ plane, v3.78). Without the flag the page treats
          // this relay as legacy and falls back to the coverage view.
          // v3.82 ?relay=nomembrane drill: pre-3.77 relay — neither flag.
          membrane: relayState.relayMode !== "nomembrane",
          // v3.79: mirrors relay.py's /volstats suggested_level key (the
          // top-25%-of-envelope display threshold).
          vollevel: true,
          // v3.81: mirrors relay.py's /volstats otsu2 + env_levels/
          // env_counts (the envelope ladder behind the count-matched
          // display levels + the level preview).
          vollevel2: true,
          // v3.82: mirrors relay.py's GET /membrane2 (the 3-phase split +
          // per-band PCAs). Drills: ?relay=old drops it (pre-3.82 relay);
          // ?relay=nomembrane drops BOTH membrane flags (pre-3.77).
          membrane2: relayState.relayMode === "",
          cacheDir: relayState.cacheDir,
          cached: relayState.staged.size,
          volumes: relayState.models.size,
        });
      }
      if (u.pathname === "/staged") {
        // v3.56: mirrors relay.py's /staged — ?name= single-file cache
        // probe (the page runs it per map BEFORE downloading anything);
        // no name → full listing. The mock's staged bytes live in the
        // in-memory relayState.staged map (keyed by path).
        const name = u.searchParams.get("name") || "";
        const stagedPath = (n: string) => `${relayState.cacheDir}/${n}`;
        if (name) {
          const entry = relayState.staged.get(stagedPath(name));
          if (entry) {
            return reply(200, {
              ok: true,
              exists: true,
              path: stagedPath(name),
              size: entry.bytes.byteLength,
              mtime: Date.now() / 1000,
            });
          }
          return reply(200, { ok: true, exists: false });
        }
        const files = [...relayState.staged.entries()].map(([path, e]) => ({
          name: e.name,
          size: e.bytes.byteLength,
          mtime: Date.now() / 1000,
          path,
        }));
        return reply(200, {
          ok: true,
          dir: relayState.cacheDir,
          files,
          total: files.reduce((s, f) => s + f.size, 0),
        });
      }
      if (req.method === "POST" && u.pathname === "/fetch") {
        // v3.65: mirrors relay.py's /fetch — THIS relay downloads the map
        // URL once into the (v3.70: switchable) persistent cache dir and
        // returns the LOCAL path; a name already in the dir is a "hit"
        // (download skipped outright).
        const body = (await req.json().catch(() => ({}))) as { url?: string; name?: string };
        if (!body.url || !body.name) return reply(400, { ok: false, error: "missing url/name" });
        const safe =
          (body.name.split("/").pop() || "map.mrc").replace(/[^\w.\- ]+/g, "_") || "map.mrc";
        const path = `${relayState.cacheDir}/${safe}`;
        const existing = relayState.staged.get(path);
        if (existing) {
          return reply(200, { ok: true, status: "hit", path, size: existing.bytes.byteLength });
        }
        try {
          const res = await fetch(body.url, { redirect: "follow" });
          if (!res.ok) return reply(200, { ok: false, error: `HTTP ${res.status}` });
          const bytes = new Uint8Array(await res.arrayBuffer());
          relayState.staged.set(path, { name: safe, bytes });
          return reply(200, { ok: true, status: "downloaded", path, size: bytes.byteLength });
        } catch (err) {
          return reply(200, { ok: false, error: String(err) });
        }
      }
      if (req.method === "POST" && u.pathname === "/cachedir") {
        // v3.70: mirrors relay.py's /cachedir — switch the persistent
        // map-cache dir at runtime (the 桥接面板 下载目录 input). Absolute
        // paths only; staged bytes stay where they "are" (no moving).
        const body = (await req.json().catch(() => ({}))) as { dir?: string };
        const dir = (body.dir || "").trim();
        if (!dir) return reply(400, { ok: false, error: "missing dir" });
        if (!dir.startsWith("/")) {
          return reply(200, { ok: false, error: "需要绝对路径（如 D:\\maps 或 /data/maps）: " + dir });
        }
        const previous = relayState.cacheDir;
        relayState.cacheDir = dir;
        return reply(200, { ok: true, dir, previous, cached: relayState.staged.size });
      }
      if (req.method === "POST" && u.pathname === "/deliver") {
        // v3.72: mirrors relay.py's POST /deliver — write ONE delivery file
        // into the user's 交付目录 ({src,dst} cache copy | {url,dst} |
        // {data_base64,dst} | {stat} probe). The mock writes REAL files to
        // disk (atomic .part + rename) so the browser E2E can assert the
        // delivered set on the filesystem; src reads the in-memory staged
        // cache first (the mock /fetch never touches disk), then disk.
        const body = (await req.json().catch(() => ({}))) as Record<string, string>;
        if (body.stat) {
          try {
            if (existsSync(body.stat)) {
              return reply(200, { ok: true, exists: true, path: body.stat, size: statSync(body.stat).size });
            }
            return reply(200, { ok: true, exists: false, path: body.stat });
          } catch (err) {
            return reply(200, { ok: false, error: String(err) });
          }
        }
        const dst = (body.dst || "").trim();
        if (!dst) return reply(200, { ok: false, error: "missing dst" });
        if (!dst.startsWith("/")) {
          return reply(200, { ok: false, error: "需要绝对路径: " + dst });
        }
        const norm = dst.replace(/\\/g, "/");
        if (!norm.includes("/") || norm.endsWith("/")) {
          return reply(200, { ok: false, error: "dst 需为完整文件路径（含文件名）" });
        }
        const slash = norm.lastIndexOf("/");
        const dstdir = norm.slice(0, slash);
        const rawName = norm.slice(slash + 1);
        const safe = rawName.replace(/[<>:"|?*\x00-\x1f]/g, "").replace(/[.\s]+$/, "");
        if (!safe) return reply(200, { ok: false, error: "文件名无效: " + rawName });
        try {
          mkdirSync(dstdir, { recursive: true });
        } catch (err) {
          return reply(200, { ok: false, error: `交付目录不可用 ${dstdir}: ${String(err)}` });
        }
        const finalPath = `${dstdir}/${safe}`;
        const partPath = `${finalPath}.deliver.part`;
        const src = (body.src || "").trim();
        try {
          let bytes: Uint8Array | null = null;
          if (src) {
            const cached = relayState.staged.get(src);
            if (cached) bytes = cached.bytes;
            else if (existsSync(src)) bytes = new Uint8Array(readFileSync(src));
            else return reply(200, { ok: false, error: "源文件不存在: " + src });
          } else if (body.data_base64 || body.dataBase64) {
            // v3.74: accept both keys — mirrors the real relay.py's
            // `payload.get("data_base64") or payload.get("dataBase64")`.
            const b64 = body.data_base64 || body.dataBase64;
            bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            if (!bytes.length) return reply(200, { ok: false, error: "empty payload (0 bytes)" });
          } else if (body.url) {
            const res = await fetch(body.url, { redirect: "follow" });
            if (!res.ok) return reply(200, { ok: false, error: `HTTP ${res.status}` });
            bytes = new Uint8Array(await res.arrayBuffer());
          } else {
            return reply(200, { ok: false, error: "缺少 src/url/data_base64 之一" });
          }
          if (!bytes || !bytes.length) return reply(200, { ok: false, error: `nothing written for ${safe}` });
          writeFileSync(partPath, bytes);
          renameSync(partPath, finalPath);
          relayState.delivered.set(finalPath, { src: src || body.url || "data", size: bytes.length });
          return reply(200, { ok: true, path: finalPath, size: bytes.length });
        } catch (err) {
          try {
            if (existsSync(partPath)) rmSync(partPath);
          } catch {}
          return reply(200, { ok: false, error: String(err) });
        }
      }
      if (req.method === "POST" && u.pathname === "/stage") {
        // v3.47: mirrors relay.py's /stage — raw body bytes + X-Filename
        // (or ?name=), returns the ChimeraX-openable LOCAL path.
        const raw =
          u.searchParams.get("name") || req.headers.get("X-Filename") || "map.mrc";
        const safe =
          (raw.split("/").pop() || "map.mrc").replace(/[^\w.\- ]+/g, "_") || "map.mrc";
        const bytes = new Uint8Array(await req.arrayBuffer());
        const path = `${relayState.cacheDir}/${safe}`;
        relayState.staged.set(path, { name: safe, bytes });
        return reply(200, { ok: true, path, name: safe, size: bytes.byteLength });
      }
      if (u.pathname === "/nextid") return reply(200, { next: relayNextModelId() });
      if (u.pathname === "/volumes") {
        // v3.55: mirrors relay.py's /volumes — the page closes these ids
        // (and ONLY these) before opening the reference map.
        return reply(200, {
          ok: true,
          volumes: [...relayState.models.entries()].map(([id, m]) => ({
            id: String(id),
            name: m.url,
          })),
        });
      }
      if (u.pathname === "/volstats") {
        const id = Number(u.searchParams.get("id"));
        if (!relayState.models.has(id)) return reply(404, { error: `model #${id} not found` });
        /* v3.77 E2E: the OTSU threshold + NEAR-ZERO voxel fraction.
         * v3.80 E2E: suggested_level 0.26 is STILL served on purpose — an
         * old v3.79 relay would send it, and the page must IGNORE it.
         * v3.81 E2E: otsu2 0.24 + the envelope ladder — the page's auto
         * rule computes min(0.25×max, 0.85×otsu₂) = min(0.25, 0.204) =
         * 0.204 (the hot-detergent path: otsu₂ BELOW the quarter, so the
         * level drops into the protein window), the ladder interpolates
         * the reference's envelope count at 0.204 → exactly 240,000 (the
         * rung at 0.204), and every class map count-matches back to
         * 0.2040 — the per-map log lines read
         * “截图 level 0.2040（参考包络匹配 240,000）”. A manual/preview
         * ratio of 0.35 anchors 65,000 → class maps match to 0.3482. */
        return reply(200, {
          max: 1.0,
          mean: 0.1,
          sd: 0.2,
          min: -0.5,
          otsu: 0.18,
          otsu2: 0.24,
          zero_frac: 0.62,
          env_levels: [0.18, 0.2, 0.204, 0.24, 0.3, 0.36, 0.45, 0.55, 0.7, 0.9],
          env_counts: [500000, 260000, 240000, 150000, 90000, 60000, 35000, 20000, 8000, 2000],
          suggested_level: 0.26,
          env_frac: 0.06,
        });
      }
      if (u.pathname === "/membrane") {
        // v3.77/v3.78/v3.80/v3.81 E2E: mirrors relay.py's GET /membrane —
        // the density-weighted PCA over the open model's above-level
        // voxels. The mock returns a FIXED oblate particle (membrane
        // protein + detergent micelle): smallest-variance principal axis
        // n = (2,1,2)/3 IS the membrane normal, ea = (1,-2,0)/√5 is the
        // disk's LONG in-plane axis, eb = n × ea completes the
        // right-handed triad (ea × eb = n). v3.82: the ratio is 0.95 —
        // the whole-envelope PCA reads NEAR-ISOTROPIC on a column+disk
        // particle like TMEM175 (the round-41/42 delivered failure), so
        // the page must not trust it blindly; its camera is still tried
        // as a candidate and the mock arms the standing mushroom for the
        // exact expected rotation — the PROBE decides.
        // ?relay=nomembrane drill: 404 (pre-3.77 relay).
        if (relayState.relayMode === "nomembrane") {
          return reply(404, { error: "unknown route (pre-3.77 relay drill)" });
        }
        const mid = u.searchParams.get("id") || "";
        if (!mid) return reply(400, { error: "missing id" });
        if (!relayState.models.has(Number(mid))) {
          return reply(404, { error: `model #${mid} not found` });
        }
        return reply(200, {
          ok: true,
          normal: [0.666667, 0.333333, 0.666667],
          ea: [0.447214, -0.894427, 0.0],
          eb: [0.596285, 0.298142, -0.745356],
          ratio: 0.95,
          lambdas: [0.95, 1.0, 1.05],
          count: 120000,
          total: 512000,
        });
      }
      if (u.pathname === "/membrane2") {
        // v3.82 E2E: mirrors relay.py's GET /membrane2 — the 3-phase
        // split + per-band PCAs. The mock's particle is a HOT-BELT one
        // (the P283 regime): the "high" band IS the detergent belt (a
        // flat torus, oblateness 0.30, normal (2,1,2)/3) and the "mid"
        // band mostly caught protein mass (oblateness 0.99 — not
        // trusted). The page tries the most oblate band first; its
        // camera command matches EXPECTED_CAM_ROT_DEFAULT so the probe
        // arms the standing mushroom (head up; flip drill arms
        // head-down). The envelope rides along with ratio 0.95 —
        // near-isotropic, the honest TMEM175 diagnostic.
        // ?relay=old / ?relay=nomembrane drills: 404 (pre-3.82 relay).
        if (relayState.relayMode !== "") {
          return reply(404, { error: `unknown route (${relayState.relayMode} relay drill)` });
        }
        const mid = u.searchParams.get("id") || "";
        if (!mid) return reply(400, { error: "missing id" });
        if (!relayState.models.has(Number(mid))) {
          return reply(404, { error: `model #${mid} not found` });
        }
        return reply(200, {
          ok: true,
          splits: [0.18, 0.54],
          bands: [
            {
              name: "mid",
              lo: 0.18,
              hi: 0.54,
              normal: [0.57735, 0.57735, 0.57735],
              ea: [0.7071, -0.7071, 0.0],
              eb: [0.40825, 0.40825, -0.8165],
              ratio: 0.99,
              lambdas: [0.99, 1.0, 1.6],
              count: 140000,
            },
            {
              name: "high",
              lo: 0.54,
              hi: 1.0,
              normal: [0.666667, 0.333333, 0.666667],
              ea: [0.447214, -0.894427, 0.0],
              eb: [0.596285, 0.298142, -0.745356],
              ratio: 0.3,
              lambdas: [0.3, 1.0, 1.05],
              count: 90000,
            },
          ],
          envelope: {
            ok: true,
            normal: [0.666667, 0.333333, 0.666667],
            ea: [0.447214, -0.894427, 0.0],
            eb: [0.596285, 0.298142, -0.745356],
            ratio: 0.95,
            lambdas: [0.95, 1.0, 1.05],
            count: 250000,
            total: 512000,
          },
        });
      }
      if (u.pathname === "/file") {
        const name = u.searchParams.get("name") || "";
        const bytes = relayState.files.get(name);
        if (!bytes) return reply(404, { error: "file not found" });
        return new Response(bytes, {
          status: 200,
          headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      }
      if (u.pathname === "/exec") {
        let command = u.searchParams.get("command") || "";
        if (req.method === "POST") {
          try {
            const body = (await req.json()) as { command?: string };
            command = String(body?.command || "");
          } catch {
            command = "";
          }
        }
        if (!command) return reply(400, { error: "missing command" });
        const r = await relaySimulate(command);
        return reply(200, { text: r.text, error: r.error });
      }
      return reply(404, { error: "unknown route" });
    } catch (exc) {
      return reply(500, { error: String(exc) });
    }
  },
});
console.log(`mock ChimeraX relay listening on http://127.0.0.1:${relayServer.port} (legacy open output + J497 id-less mode)`);

/* ---- crafted P208 capture doc (post-谱系补边 full-detail state) ---- */
function flowE2eCaptureDoc(): Record<string, unknown> {
  const FV = (uid: string) => ({ type: "volume", name: "volume", connections: [{ job_uid: uid }] });
  const FP = (...uids: string[]) => ({
    type: "particle",
    name: "particles",
    connections: uids.map((x) => ({ job_uid: x })),
  });
  const FM = (uid: string) => ({ type: "micrograph", name: "micrographs", connections: [{ job_uid: uid }] });
  const VOUT = (name: string) => ({ name, type: "volume", contains: [{ type: "volume.blob", name: "map" }] });
  // v3.51: per-class particle groups — classSplits() pairs particles_class_N
  // with volume_class_N and derives the percentages from particles_all_classes.
  const PCLASS = (i: number, num: number) => ({
    name: `particles_class_${i}`,
    type: "particle",
    num_items: num,
    contains: [{ type: "particle.blob", name: "particles" }],
  });
  const PALL = (num: number) => ({
    name: "particles_all_classes",
    type: "particle",
    num_items: num,
    contains: [{ type: "particle.blob", name: "particles" }],
  });
  const POUT = (num: number) => ({
    name: "particles",
    type: "particle",
    num_items: num,
    contains: [{ type: "particle.blob", name: "particles" }],
  });
  const EOUT = (num: number) => ({
    name: "micrographs",
    type: "exposure",
    num_items: num,
    contains: [{ type: "micrograph.blob", name: "micrographs" }],
  });
  const mk = (
    uid: string,
    n: number,
    job_type: string,
    parents: string[],
    isg: unknown[],
    outputs: unknown[],
    extra: Record<string, unknown> = {},
  ) => ({
    uid,
    uid_num: n,
    project_uid: "P208",
    job_type,
    title: `${job_type} ${uid}`,
    status: "completed",
    created_at: `2026-02-01T00:${String(n % 60).padStart(2, "0")}:00Z`,
    completed_at: `2026-02-01T01:${String(n % 60).padStart(2, "0")}:00Z`,
    parents,
    children: [],
    input_slot_groups: isg,
    output_result_groups: outputs,
    ...extra,
  });
  const jobs = [
    mk("J498", 498, "deep_emhancer", ["J497"], [FV("J497")], [VOUT("volume")]),
    mk("J497", 497, "local_refine", ["J494", "J476"], [FV("J494"), FP("J476")], [VOUT("volume")]),
    mk("J494", 494, "hetero_refine", ["J420", "J448", "J455"], [FV("J420"), FP("J448"), FV("J455")], [
      // v3.52: a 5-class hetero split — the figure must show all five
      // classes side by side in one row (MAX_FIG_CLASSES was raised 4 → 8),
      // which drives the Chimera default open palette through classes 0-4
      // (v3.54 user-pasted values): grey #b2b2b2, pale yellow #ffffb2, pale
      // cyan #b2ffff, pale blue #b2b2ff, pale magenta #ffb2ff (relay-stats
      // color_hexes asserts exactly this order).
      VOUT("volume_class_0"),
      VOUT("volume_class_1"),
      VOUT("volume_class_2"),
      VOUT("volume_class_3"),
      VOUT("volume_class_4"),
      PCLASS(0, 90000),
      PCLASS(1, 40000),
      PCLASS(2, 30000),
      PCLASS(3, 12000),
      PCLASS(4, 8000),
      PALL(180000),
    ]),
    mk("J448", 448, "nonuniform_refine", ["J443", "J476"], [FV("J443"), FP("J476")], [VOUT("volume")]),
    mk("J443", 443, "homo_refine", ["J422", "J476"], [FV("J422"), FP("J476")], [VOUT("volume")]),
    mk("J422", 422, "homo_refine", ["J446", "J476"], [FV("J446"), FP("J476")], [VOUT("volume")]),
    mk("J446", 446, "import_volumes", [], [], [
      { name: "volume", type: "volume", contains: [{ type: "volume.blob", name: "imported_volume_1" }] },
    ]),
    mk("J476", 476, "select_2D", ["J385", "J472"], [FP("J385"), FP("J472")], [POUT(180000)]),
    mk("J472", 472, "class_2d", ["J483"], [FP("J483")], []),
    mk("J483", 483, "extract_micrographs", ["J481"], [FP("J481")], []),
    mk("J481", 481, "picker", ["J478"], [FM("J478")], []),
    mk("J478", 478, "ctf_estimation", ["J475"], [FM("J475")], []),
    mk("J475", 475, "motion_correction", ["J474"], [FM("J474")], []),
    mk("J474", 474, "import_movies", [], [], [EOUT(5562)]),
    mk("J420", 420, "homo_abinit", ["J476"], [FP("J476")], [
      // v3.51: a 2-class ab-initio split (2/3 + 1/3 of the particles).
      VOUT("volume_class_0"),
      VOUT("volume_class_1"),
      PCLASS(0, 80000),
      PCLASS(1, 40000),
      PALL(120000),
    ], {
      // v3.55 (round-14 简化模式 E2E): an EXPLICIT default 12 Å Maximum
      // resolution — the job survives the v3.54 subset rule (120,000 ≥
      // 0.5 × 180,000) but the simplified figure must now omit it BY THE
      // DEFAULT-12 Å RULE (the browser E2E asserts the warning + its
      // absence from the stage rows), mirroring P96's J33.
      params_spec: { maximum_resolution_A: { value: 12 } },
    }),
    // v3.54 (round-13 简化模式 E2E): a SMALL-SUBSET bootstrap ab-initio —
    // 20,000 of the lineage's max 180,000 particles (< SIMPLIFIED_SUBSET_
    // FRACTION × max) feeds J494 as an extra volume parent. Normal mode
    // renders it beside J420/J448 in the merge row; simplified mode MUST
    // omit it with a named warning (and its maps drop out of the render
    // set entirely).
    mk("J455", 455, "homo_abinit", ["J476"], [FP("J476")], [
      VOUT("volume_class_0"),
      VOUT("volume_class_1"),
      PCLASS(0, 12000),
      PCLASS(1, 8000),
      PALL(20000),
    ], {
      // v3.55: J455 carries a NON-default resolution (6 Å) so the E2E
      // proves the subset rule — not the resolution rule — is what drops
      // it (a default-12 value here would make both rules fire and the
      // distinguishing case invisible).
      params_spec: { maximum_resolution_A: { value: 6 } },
    }),
    mk("J385", 385, "class_2d", ["J382"], [FP("J382")], []),
    mk("J382", 382, "extract_micrographs", ["J379"], [FP("J379")], []),
    mk("J379", 379, "picker", ["J376"], [FM("J376")], []),
    mk("J376", 376, "ctf_estimation", ["J373"], [FM("J373")], []),
    mk("J373", 373, "motion_correction", ["J370"], [FM("J370")], []),
    mk("J370", 370, "import_movies", [], [], [EOUT(233)]),
  ];
  return {
    format: "cryosmart-capture/v1",
    project_uid: "P208",
    capture: {
      project_uid: "P208",
      captured_at: "2026-02-14T12:00:00Z",
      cryosmart_origin: ORIGIN,
      end_job_uid: "J498",
      lineage_mode: true,
      credentials: { cookie: "session=e2e-cookie" },
    },
    jobs,
    images: [],
    job_log_images: {},
  };
}
