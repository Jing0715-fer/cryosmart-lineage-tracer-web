/**
 * v3.17 map-download hang hardening E2E — the user's bundle build stuck
 * FOREVER at "Fetching maps 0% — Collecting maps…". Three fixes verified
 * here against a REAL local upstream through the live dev-server proxy:
 *
 *   Run A  LIVENESS — chunked map bodies must emit throttled
 *          "N in flight · M MB received" progress lines BEFORE the first
 *          map completes (progress used to tick only on completion, so a
 *          healthy 4-way download showed an unchanged 0% for minutes —
 *          indistinguishable from the hang). All maps still byte-exact.
 *
 *   Run B  STALL-SKIP — the upstream serves headers + one chunk then goes
 *          SILENT forever (wedged CryoSmart). With mapStallMs=1500 the
 *          per-download watchdog aborts each silent body, 3 stalls flip
 *          the queue-skip flag, and the build COMPLETES in seconds with
 *          the healthy maps bundled + DOWNLOAD_LINKS.txt for the rest.
 *          Before v3.17 this burned 180s × N/4 — or hung forever when a
 *          leg never closed the socket.
 *
 *   Run C  CANCEL — aborting the options.signal mid-download rejects
 *          buildBundle with an AbortError within seconds (Stop button).
 *
 * Run: bun .harness/v317-map-stall.mjs   (dev server must be on :3000)
 */
const APP = "http://localhost:3000";
const CRYO = "http://localhost:3998"; // fake upstream, started below
const STALL_MS = 1500;                // fast watchdog for the test

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

/* ── Fake CryoSmart upstream ──────────────────────────────────────────
 * mode: "chunked" (8×32KB chunks, 80ms apart — healthy streaming),
 *       "stall"   (headers + first chunk, then SILENCE forever),
 *       "slow"    (full body after 600ms).
 * stallAfter: arrivals ≤ stallAfter get the healthy path in Run B. */
let mode = "chunked";
let stallAfter = Infinity;
let arrivals = 0;
const patternBytes = (name, size) => {
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bytes = new Uint8Array(size);
  for (let k = 0; k < bytes.length; k++) bytes[k] = (k * 7 + seed) & 0xff;
  return bytes;
};

const upstream = Bun.serve({
  port: 3998,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/favicon.ico") return new Response("ok");
    if (u.pathname.startsWith("/api/log_image/download_result_file/")) {
      const name = u.pathname.split("/").pop();
      const myIndex = ++arrivals;
      const body = patternBytes(name, 256 * 1024);
      if (mode === "stall" && myIndex > stallAfter) {
        // Wedged server: headers + one chunk, then nothing — the socket
        // stays open and the body never finishes.
        return new Response(
          new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(body.subarray(0, 4096));
              // deliberately never close() or enqueue again
            },
          }),
          { headers: { "content-type": "application/octet-stream" } }
        );
      }
      if (mode === "slow") {
        await sleep(600);
        return new Response(body, { headers: { "content-type": "application/octet-stream" } });
      }
      // chunked — healthy streaming download
      return new Response(
        new ReadableStream({
          async start(ctrl) {
            const CH = 32 * 1024;
            for (let off = 0; off < body.length; off += CH) {
              ctrl.enqueue(body.subarray(off, off + CH));
              await sleep(80);
            }
            ctrl.close();
          },
        }),
        { headers: { "content-type": "application/octet-stream" } }
      );
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  },
});

/* ── Staged session: 3 refine jobs × 4 volume blobs = 12 map items ──── */
const NOW = new Date().toISOString();
const mkJob = (uid, job_type, parents) => ({
  uid, project_uid: "PX7", job_type, title: `${uid} ${job_type}`,
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
    project_uid: "PX7", cryosmart_origin: CRYO,
    cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
    source: "sim", end_job_uid: "J4", lineage_mode: true,
  }),
})).json();
const token = created.token;
await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project_uid: "PX7", jobs }),
});
await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
const dataResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
const summary = buildSummary(dataResp.data.jobs, "PX7", "J4", CRYO);
const session = { baseUrl: CRYO, cookie: "session=sim", auth: "Bearer sim" };

/* ── ZIP helpers (STORE-only, same as v316) ─────────────────────────── */
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

try {
  /* ── Run A: liveness — MB-received lines before the first completion ─ */
  console.log("\n── Run A: byte-level liveness while maps stream ──");
  mode = "chunked"; stallAfter = Infinity; arrivals = 0;
  let firstLivenessAt = 0, firstCompletionAt = 0, livenessLines = 0;
  let sawZeroDoneLiveness = false;
  const t0 = Date.now();
  const resultA = await buildBundle(
    summary,
    { includePptx: false, includeImages: false, includeMaps: true, includeFinalResults: false, session },
    (p) => {
      if (p.phase !== "maps") return;
      const now = Date.now();
      if (/MB received/.test(p.message)) {
        livenessLines++;
        if (!firstLivenessAt) firstLivenessAt = now;
        if (p.current === 0) sawZeroDoneLiveness = true;
      }
      if (/^Map \d+\/\d+:/.test(p.message) && !firstCompletionAt) firstCompletionAt = now;
    }
  );
  console.log(`liveness lines ${livenessLines} · first at +${firstLivenessAt - t0}ms vs first completion +${firstCompletionAt - t0}ms · total ${Date.now() - t0}ms`);
  check("byte-progress lines fired mid-download", livenessLines >= 1, `lines=${livenessLines}`);
  check("a liveness line appeared BEFORE the first map completed", firstLivenessAt > 0 && (firstCompletionAt === 0 || firstLivenessAt < firstCompletionAt),
    `live=+${firstLivenessAt - t0}ms done=+${firstCompletionAt - t0}ms`);
  check("liveness visible while the bar still reads 0 (pre-first-completion)", sawZeroDoneLiveness);
  const zipA = new Uint8Array(await resultA.blob.arrayBuffer());
  const namesA = zipEntries(zipA);
  check("all 12 maps bundled on the chunked upstream", namesA.filter((n) => n.startsWith("maps/") && n.endsWith(".mrc")).length === 12);
  check("zero warnings on the healthy path", resultA.warnings.length === 0, JSON.stringify(resultA.warnings));
  const got = extractFile(zipA, "maps/J2/BJ.PX7.J2.volume.map.mrc");
  const exp = patternBytes("J2.volume.map", 256 * 1024);
  check("chunked-streamed map bytes are byte-exact", !!got && got.length === exp.length && exp.every((b, i) => got[i] === b));

  /* ── Run B: wedged upstream — stall watchdog + queue skip ──────────── */
  console.log("\n── Run B: upstream sends headers then goes silent (wedged) ──");
  mode = "stall"; stallAfter = 2; arrivals = 0;
  const tB = Date.now();
  const resultB = await buildBundle(
    summary,
    {
      includePptx: false, includeImages: false, includeMaps: true, includeFinalResults: false,
      session, mapStallMs: STALL_MS,
    },
    () => {}
  );
  const elapsedB = Date.now() - tB;
  const zipB = new Uint8Array(await resultB.blob.arrayBuffer());
  const namesB = zipEntries(zipB);
  const mapB = namesB.filter((n) => n.startsWith("maps/") && n.endsWith(".mrc"));
  const linksB = extractFile(zipB, "maps/DOWNLOAD_LINKS.txt");
  const linksTxt = linksB ? new TextDecoder().decode(linksB) : "";
  const stallWarns = resultB.warnings.filter((w) => /stalled — no data/i.test(w));
  const skipWarns = resultB.warnings.filter((w) => /stalled \d+× with no data/i.test(w));
  console.log(`${elapsedB}ms · arrivals ${arrivals} · bundled ${mapB.length} · links ${(linksTxt.match(/^maps\//gm) || []).length} · stall warns ${stallWarns.length}`);

  check("build COMPLETES instead of hanging (bounded wall time)", elapsedB < 20_000, `${elapsedB}ms`);
  check("the 2 healthy maps were bundled", mapB.length === 2, `${mapB.length}: ${mapB.join(", ")}`);
  check("DOWNLOAD_LINKS.txt lists the other 10", !!linksB && (linksTxt.match(/^maps\//gm) || []).length === 10,
    `${(linksTxt.match(/^maps\//gm) || []).length} links`);
  check("per-map stall failures were recorded (≥3)", stallWarns.length >= 3, `${stallWarns.length}`);
  check("exactly ONE queue-skip warning after 3 stalls", skipWarns.length === 1, JSON.stringify(resultB.warnings));
  // Design bound: the flag flips on the 3rd RECORDED stall, but with 4
  // concurrent workers the second wave (items 7-8) is already in flight
  // by then — arrivals = 2 healthy + up to 6 stalls. The point of the
  // check: the queue DID skip (a 12-map lineage must not grind all 12).
  check("queue skipped after the stall wave (arrivals ≤ 8, not all 12)", arrivals <= 8 && arrivals < 12, `arrivals=${arrivals}`);
  check(`wall time consistent with ONE stall window (≤ ${(STALL_MS * 4 / 1000).toFixed(0)}s), not 180s × waves`, elapsedB < STALL_MS * 4 + 8_000, `${elapsedB}ms`);

  /* ── Run C: cancel mid-download (Stop button) ─────────────────────── */
  console.log("\n── Run C: cancel the build mid-download ──");
  mode = "slow"; stallAfter = Infinity; arrivals = 0;
  const abort = new AbortController();
  let rejected = null;
  const buildPromise = buildBundle(
    summary,
    {
      includePptx: false, includeImages: false, includeMaps: true, includeFinalResults: false,
      session, signal: abort.signal,
    },
    (p) => { if (p.phase === "maps" && /Collecting/.test(p.message)) abort.abort(); }
  ).then(
    () => { rejected = false; },
    (err) => { rejected = err; }
  );
  const settle = Promise.race([buildPromise, sleep(10_000).then(() => "timeout")]);
  const tC = Date.now();
  await settle;
  const cancelMs = Date.now() - tC;
  check("build REJECTED after abort (never resolved)", rejected instanceof Error,
    String(rejected));
  check("rejection is an AbortError", rejected?.name === "AbortError", `${rejected?.name}: ${rejected?.message}`);
  check(`rejection was fast (≤ 3s, got ${cancelMs}ms)`, cancelMs <= 3_000, `${cancelMs}ms`);
} finally {
  await fetch(`${APP}/api/cryosmart/history/${token}`, { method: "DELETE" }).catch(() => {});
  upstream.stop(true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
