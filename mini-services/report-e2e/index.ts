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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
      const blockHttp = new URL(req.url).searchParams.get("http") === "block";
      relayState.httpBlocked = blockHttp;
      return Response.json({ ok: true, http_blocked: blockHttp });
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

/** 32×32 solid-red PNG (valid for createImageBitmap + canvas letterbox). */
const MOCK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NsQkAAAgDsB7W//Esr3AQAtmTaU9FIBAIBAKBQCAQfAkWAwwATMGYEdYAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

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
  /** v3.47: /flow-e2e/reset?http=block — all http opens fail 503. */
  httpBlocked: false,
};

function resetRelayState() {
  relayState.models.clear();
  relayState.files.clear();
  relayState.opens = [];
  relayState.commands = [];
  relayState.staged.clear();
  relayState.httpBlocked = false;
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
  };
}
function u_hasAsset(u: string): boolean {
  return u.includes("/api/cryosmart/flow-figure/asset");
}

/** The ChimeraX command simulator (legacy 1.13-style log output). */
async function relaySimulate(raw: string): Promise<{ text: string; error: string | null }> {
  const command = String(raw || "").trim();
  relayState.commands.push(command);

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

  if (/^close\s+#\d+/i.test(command)) {
    for (const m of command.matchAll(/#(\d+)/g)) relayState.models.delete(parseInt(m[1], 10));
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
    return { text: "  correlation = 0.42", error: null };
  }
  if (/^fit\s+#\d+\s+in\s+#\d+\s+search/i.test(command)) {
    return { text: "Fit map in map, 15 positions tried, correlation = 0.93", error: null };
  }
  if (/^fit\s+#\d+\s+in\s+#\d+/i.test(command)) {
    return { text: "Fit map in map, correlation = 0.87", error: null };
  }

  const saveMatch = /^save\s+image\s+"([^"]+)"/i.exec(command);
  if (saveMatch) {
    const name = saveMatch[1].split("/").pop() || "img.png";
    relayState.files.set(name, MOCK_PNG);
    return { text: `saved ${saveMatch[1]}`, error: null };
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
          workdir: "/tmp/cryoflow-mock",
          version: "1.13-mock-legacy",
          // v3.47: the card's page-relay rung requires POST /stage — this
          // flag mirrors the real relay.py's /ping field.
          stage: true,
          volumes: relayState.models.size,
        });
      }
      if (req.method === "POST" && u.pathname === "/stage") {
        // v3.47: mirrors relay.py's /stage — raw body bytes + X-Filename
        // (or ?name=), returns the ChimeraX-openable LOCAL path.
        const raw =
          u.searchParams.get("name") || req.headers.get("X-Filename") || "map.mrc";
        const safe =
          (raw.split("/").pop() || "map.mrc").replace(/[^\w.\- ]+/g, "_") || "map.mrc";
        const bytes = new Uint8Array(await req.arrayBuffer());
        const path = `/tmp/cryoflow-mock/staged/${safe}`;
        relayState.staged.set(path, { name: safe, bytes });
        return reply(200, { ok: true, path, name: safe, size: bytes.byteLength });
      }
      if (u.pathname === "/nextid") return reply(200, { next: relayNextModelId() });
      if (u.pathname === "/volstats") {
        const id = Number(u.searchParams.get("id"));
        if (!relayState.models.has(id)) return reply(404, { error: `model #${id} not found` });
        return reply(200, { max: 1.0, mean: 0.1, sd: 0.2, min: -0.5 });
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
    outputs: unknown[]
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
  });
  const jobs = [
    mk("J498", 498, "deep_emhancer", ["J497"], [FV("J497")], [VOUT("volume")]),
    mk("J497", 497, "local_refine", ["J494", "J476"], [FV("J494"), FP("J476")], [VOUT("volume")]),
    mk("J494", 494, "hetero_refine", ["J420", "J448"], [FV("J420"), FP("J448")], [VOUT("volume_class_0")]),
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
    mk("J420", 420, "homo_abinit", ["J476"], [FP("J476")], [VOUT("volume_class_0")]),
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
