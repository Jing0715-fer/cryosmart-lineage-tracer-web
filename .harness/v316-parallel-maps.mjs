/**
 * v3.16 parallel map download E2E — the user's "打包 map 很慢" speed-up,
 * verified against a REAL local upstream:
 *
 *   1. Happy path — 12 .mrc maps served by a fake CryoSmart upstream
 *      (120ms server delay each). Before v3.16 the client downloaded maps
 *      SERIALLY through the buffering proxy: 12 × (read + two serial
 *      network legs). Now pooledMap keeps 4 in flight and the proxy
 *      streams, so the upstream sees overlapping requests and the whole
 *      batch lands in ~⌈12/4⌉ waves. Asserts:
 *        - all 12 maps inside the ZIP, byte-exact through the streaming
 *          proxy (pattern compare, not just presence)
 *        - max concurrent upstream requests ≥ 3 (parallelism proof)
 *        - upstream busy window < 55% of the serial baseline
 *        - zero map warnings, no DOWNLOAD_LINKS.txt
 *
 *   2. Mid-run death — the upstream starts returning 502 "failed to
 *      reach" bodies after 2 successes. The shared unreachableNow flag
 *      must flip ONCE, skip the queued maps WITHOUT further requests
 *      (arrivals stay ≤ 6), and record the remaining links.
 *
 * Run: bun .harness/v316-parallel-maps.mjs   (dev server must be on :3000)
 */
const APP = "http://localhost:3000";
const CRYO = "http://localhost:3999"; // fake upstream, started below
const MAP_DELAY_MS = 120;
const MAP_BYTES = 256 * 1024;

// Relative fetches inside bundle/proxy-client must hit the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" && input.startsWith("/") ? APP + input : input;
  return realFetch(url, init);
};

const { buildBundle } = await import("../src/lib/cryosmart/bundle.ts");
const { buildSummary } = await import("../src/lib/cryosmart/lineage.ts");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Fake CryoSmart upstream with concurrency stats ─────────────────── */
let inFlight = 0, maxInFlight = 0, arrivals = 0, successes = 0;
let firstArrival = 0, lastCompletion = 0;
/** After this many successful map arrivals, start 502ing with a
 *  "failed to reach" body (simulates the intranet dying mid-run).
 *  Infinity = happy path. */
let dieAfter = Infinity;

const patternBytes = (name) => {
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bytes = new Uint8Array(MAP_BYTES);
  for (let k = 0; k < bytes.length; k++) bytes[k] = (k * 7 + seed) & 0xff;
  return bytes;
};

const upstream = Bun.serve({
  port: 3999,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/favicon.ico") return new Response("ok");
    if (u.pathname.startsWith("/api/log_image/download_result_file/")) {
      const name = u.pathname.split("/").pop();
      const now = Date.now();
      const myIndex = ++arrivals; // captured at ARRIVAL — the death check
      // must judge by this request's own arrival slot, not the global
      // counter at completion time (with 4 concurrent arrivals the
      // counter is already 4 when the first request finishes).
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      if (!firstArrival) firstArrival = now;
      await sleep(MAP_DELAY_MS);
      inFlight--;
      lastCompletion = Date.now();
      if (myIndex > dieAfter) {
        // 502 whose body matches the proxy's connection-failure marker →
        // the client's unreachableNow flag must trip.
        return new Response(
          JSON.stringify({ error: "failed to reach (simulated mid-run death)" }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
      }
      successes++;
      return new Response(patternBytes(name), {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  },
});

/* ── Staged session + jobs with 12 map outputs ──────────────────────── */
const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX6", job_type, title: `${uid} ${job_type}`,
  status: "completed", created_at: NOW, completed_at: NOW,
  parents, children: [],
  input_slot_groups: parents.map((p) => ({
    name: "particles", type: "particle",
    connections: [{ job_uid: p, group_name: "particles" }],
  })),
  output_result_groups: [], params_spec: {}, output_group_images: {},
  ui_tile_images: [],
});
const volGroup = () => ({
  name: "volume", type: "volume", title: "volume", contains: [
    { type: "volume.blob", name: "map" },
    { type: "volume.blob", name: "map_sharp" },
    { type: "volume.blob", name: "map_half_A" },
    { type: "volume.blob", name: "map_half_B" },
  ],
});
const jobs = [
  mkJob("J1", "import_movies", []),
  mkJob("J2", "nonuniform_refine_new", ["J1"]),
  mkJob("J3", "nonuniform_refine_new", ["J2"]),
  mkJob("J4", "nonuniform_refine_new", ["J3"]),
];
jobs[1].output_result_groups = [volGroup()];
jobs[2].output_result_groups = [volGroup()];
jobs[3].output_result_groups = [volGroup()];

const created = await (await fetch(`${APP}/api/cryosmart/import/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    project_uid: "PX6", cryosmart_origin: CRYO,
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J4", lineage_mode: true,
  }),
})).json();
const token = created.token;
console.log("session:", token);
await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX6", jobs }),
});
await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});

const dataResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
const summary = buildSummary(dataResp.data.jobs, "PX6", "J4", CRYO);
const session = { baseUrl: CRYO, cookie: "session=sim", auth: "Bearer sim" };

/* ── ZIP entry scan / extract helpers (STORE-only) ──────────────────── */
const zipEntries = (buf) => {
  const names = [];
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = (buf[i + 27] << 8) | buf[i + 26];
      names.push(String.fromCharCode(...buf.subarray(i + 30, i + 30 + nameLen)));
      i += 29 + nameLen;
    }
  }
  return names;
};
const extractFile = (buf, name) => {
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = (buf[i + 27] << 8) | buf[i + 26];
      const nm = String.fromCharCode(...buf.subarray(i + 30, i + 30 + nameLen));
      if (nm === name) {
        const size = (buf[i + 25] << 24) | (buf[i + 24] << 16) | (buf[i + 23] << 8) | buf[i + 22];
        const start = i + 30 + nameLen;
        return buf.subarray(start, start + size);
      }
      i += 29 + nameLen;
    }
  }
  return null;
};

/* ── Run 1: happy path — 12 parallel map downloads ──────────────────── */
console.log("\n── Run 1: parallel maps against a live upstream ──");
const t0 = Date.now();
const result1 = await buildBundle(
  summary,
  { includePptx: false, includeImages: false, includeMaps: true, includeFinalResults: false, session },
  (p) => { if (p.phase === "maps") process.stdout.write(`    [maps] ${p.message}\r\x1b[K`); }
);
const elapsed1 = Date.now() - t0;
const busyMs = lastCompletion - firstArrival;
const serialBaseline = 12 * MAP_DELAY_MS;
console.log(`\nbundle: ${result1.fileCount} files · ${elapsed1}ms total · upstream busy ${busyMs}ms · maxInFlight ${maxInFlight} · arrivals ${arrivals}`);

const zip1 = new Uint8Array(await result1.blob.arrayBuffer());
const names1 = zipEntries(zip1);
const mapEntries = names1.filter((n) => n.startsWith("maps/"));

check("all 12 maps bundled", mapEntries.length === 12, `${mapEntries.length}: ${mapEntries.join(", ")}`);
check("no DOWNLOAD_LINKS.txt on the happy path", !names1.includes("maps/DOWNLOAD_LINKS.txt"));
check("zero map warnings", !result1.warnings.some((w) => /Map |unreachable/i.test(w)),
  JSON.stringify(result1.warnings));
check("requests overlapped upstream (maxInFlight ≥ 3 — parallel proof)", maxInFlight >= 3, `maxInFlight=${maxInFlight}`);
check(`upstream busy window < 55% of serial baseline (${serialBaseline}ms)`, busyMs < serialBaseline * 0.55, `busy=${busyMs}ms`);

// Byte-exact integrity through the streaming proxy: reproduce the server's
// pattern for one map and compare against the ZIP entry.
const probeName = "J2.volume.map";
const expected = patternBytes(probeName);
const got = extractFile(zip1, "maps/J2/BJ.PX6.J2.volume.map.mrc");
const intact = !!got && got.length === expected.length && expected.every((b, i) => got[i] === b);
check("streamed map bytes are byte-exact (pattern compare)", intact,
  got ? `len ${got.length} vs ${expected.length}` : "entry missing");

/* ── Run 2: upstream dies mid-run → fast skip + links file ──────────── */
console.log("\n── Run 2: upstream dies mid-run (502 after 2 successes) ──");
inFlight = 0; maxInFlight = 0; arrivals = 0; successes = 0;
firstArrival = 0; lastCompletion = 0;
dieAfter = 2;

const result2 = await buildBundle(
  summary,
  { includePptx: false, includeImages: false, includeMaps: true, includeFinalResults: false, session },
  () => {}
);
const zip2 = new Uint8Array(await result2.blob.arrayBuffer());
const names2 = zipEntries(zip2);
// Real bundled maps only — exclude the links file itself from the count.
const mapEntries2 = names2.filter((n) => n.startsWith("maps/") && n.endsWith(".mrc"));
const links2 = extractFile(zip2, "maps/DOWNLOAD_LINKS.txt");
const linksText = links2 ? new TextDecoder().decode(links2) : "";

console.log(`arrivals ${arrivals} · successes ${successes} · bundled maps ${mapEntries2.length} · links listed ${(linksText.match(/^maps\//gm) || []).length}`);

check("build completes (no throw) after mid-run death", true);
check("upstream hit ≤ 6 times before the flag skipped the queue (no grinding)", arrivals <= 6, `arrivals=${arrivals}`);
check("the 2 pre-death successes were still bundled", mapEntries2.length === 2, `${mapEntries2.length}: ${mapEntries2.join(", ")}`);
check("maps/DOWNLOAD_LINKS.txt records the skipped maps", !!links2 && (linksText.match(/^maps\//gm) || []).length + mapEntries2.length === 12,
  `${(linksText.match(/^maps\//gm) || []).length} links + ${mapEntries2.length} bundled`);
check("single 'became unreachable mid-download' warning", result2.warnings.filter((w) => /became unreachable mid-download/i.test(w)).length === 1,
  JSON.stringify(result2.warnings));

/* ── Cleanup: drop the auto-archived history entry ──────────────────── */
await fetch(`${APP}/api/cryosmart/history/${token}`, { method: "DELETE" }).catch(() => {});
upstream.stop(true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
