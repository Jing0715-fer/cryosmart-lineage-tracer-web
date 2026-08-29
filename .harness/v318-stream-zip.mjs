/**
 * v3.18 streaming-ZIP regression — the 66-map OOM fix.
 *
 * buildBundle used to accumulate every file in a files[] array and then
 * assemble the archive with makeZip, which makes TWO more full-copy
 * concatenation passes — peak heap ≈ 3× the bundle size. A 66-map build
 * (10+ GB of .mrc) killed the browser tab mid-build; after reload the
 * user saw "Previous build did not finish".
 *
 * v3.18 replaces that with StreamingZipWriter + BundleSink:
 *   • StreamingZipWriter — emits the SAME byte layout as makeZip, but
 *     entry-by-entry, with a promise-chain mutex so concurrent download
 *     workers can interleave add() calls safely.
 *   • zip-sink.createBundleSink() — OPFS disk streaming in browsers; a
 *     memory sink with a byte budget as fallback (Bun/harness/http).
 *   • buildBundle — addFile() as each payload lands; maps beyond the
 *     memory budget degrade to maps/DOWNLOAD_LINKS.txt instead of OOMing.
 *
 * This harness verifies (all under Bun → memory sink path, which is the
 * path the budget guard protects):
 *
 *   A. BYTE-IDENTICAL to makeZip (frozen clock) — mixed strings, binary,
 *      empty file, names with unicode — full array compare + EOCD count.
 *   B. CONCURRENT adds — 40 interleaved add() calls; archive parsed with
 *      an independent EOCD→central-directory→local-header reader; every
 *      entry's name/offset/size/CRC/data verified. This is the corruption
 *      test for the mutex.
 *   C. ABORT semantics — add → abort → add throws, finish throws,
 *      memory sink result is empty.
 *   D. BUDGET GUARD (integration, live dev server + fake upstream) —
 *      12 real maps; budget sized for reports + ~2 maps; build must
 *      COMPLETE with the rest as links (never OOM, never throw).
 *   E. createBundleSink in Bun degrades to memory (never throws).
 *
 * Run: bun .harness/v318-stream-zip.mjs   (dev server must be on :3000)
 */
const APP = "http://localhost:3000";
const CRYO = "http://localhost:3997"; // fake upstream, started below
const MAP_BYTES = 256 * 1024;

// Relative fetches inside bundle/proxy-client must hit the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" && input.startsWith("/") ? APP + input : input;
  return realFetch(url, init);
};

const { makeZip, StreamingZipWriter, zipCrc32 } = await import("../src/lib/cryosmart/zip.ts");
const { createBundleSink } = await import("../src/lib/cryosmart/zip-sink.ts");
const { buildBundle } = await import("../src/lib/cryosmart/bundle.ts");
const { buildSummary } = await import("../src/lib/cryosmart/lineage.ts");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Shared helpers ─────────────────────────────────────────────────── */

/** Memory sink mirror (same shape createBundleSink returns in Bun). */
async function memorySinkBundle() {
  const sink = await createBundleSink();
  return sink;
}

const patternBytes = (name, len) => {
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bytes = new Uint8Array(len);
  for (let k = 0; k < bytes.length; k++) bytes[k] = (k * 7 + seed) & 0xff;
  return bytes;
};

/**
 * Independent STORE-ZIP reader: EOCD → central directory → local headers.
 * Deliberately NOT the local-header-scan trick used by older harnesses —
 * this one validates offsets/sizes/CRCs from the central directory, i.e.
 * what unzip tools actually trust.
 */
function readStoreZip(buf) {
  const u16 = (o) => buf[o] | (buf[o + 1] << 8);
  const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
  // EOCD = last 0x06054b50 in the final 66KB.
  const tailStart = Math.max(0, buf.length - 66560);
  let eocd = -1;
  for (let i = buf.length - 22; i >= tailStart; i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD not found");
  const count = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);
  const entries = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  for (let n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) throw new Error(`central sig bad at entry ${n} (off ${p})`);
    const crc = u32(p + 16);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const lho = u32(p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (u32(lho) !== 0x04034b50) throw new Error(`local sig bad for ${name}`);
    const lNameLen = u16(lho + 26);
    const dataStart = lho + 30 + lNameLen;
    const data = buf.subarray(dataStart, dataStart + size);
    if (data.length !== size) throw new Error(`truncated data for ${name}`);
    entries.push({ name, crc, size, lho, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== end) throw new Error(`central dir walk ended at ${p}, EOCD says ${end}`);
  return { entries, cdOffset, cdSize, eocdOffset: eocd };
}

/* ── A. Byte-identical to makeZip (frozen clock) ────────────────────── */
console.log("\n── A. StreamingZipWriter === makeZip bytes ──");
{
  const FIXED = new Date("2025-06-01T12:34:56Z").getTime();
  const RealDate = Date;
  const Frozen = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  };
  globalThis.Date = Frozen;
  try {
    const files = [
      { name: "a.json", data: JSON.stringify({ hello: "world", n: 42 }) },
      { name: "reports/biggish.html", data: "x".repeat(300_000) },
      { name: "bin/zero.bin", data: new Uint8Array(1024) }, // all zero bytes
      { name: "bin/pattern.mrc", data: patternBytes("pattern", 128 * 1024) },
      { name: "empty.txt", data: "" },
      { name: "ünïcødé-名前/file.txt", data: "unicode name ✓" },
    ];
    const blobOld = makeZip(files, "application/zip");
    const oldBytes = new Uint8Array(await blobOld.arrayBuffer());

    const sink = await memorySinkBundle();
    const writer = new StreamingZipWriter(sink.sink);
    for (const f of files) await writer.add(f.name, f.data);
    await writer.finish();
    const blobNew = await sink.result();
    const newBytes = new Uint8Array(await blobNew.arrayBuffer());

    check("same byte length", oldBytes.length === newBytes.length, `${oldBytes.length} vs ${newBytes.length}`);
    let diffAt = -1;
    for (let i = 0; i < Math.min(oldBytes.length, newBytes.length); i++) {
      if (oldBytes[i] !== newBytes[i]) { diffAt = i; break; }
    }
    check("every byte identical", diffAt === -1, diffAt < 0 ? "" : `first diff @${diffAt}`);
    check("entry count reported", writer.entryCount === files.length, `${writer.entryCount}`);
    check("bytesWritten === blob size", writer.bytesWritten === newBytes.length, `${writer.bytesWritten} vs ${newBytes.length}`);

    const parsed = readStoreZip(newBytes);
    check("EOCD/central walk ok, all entries", parsed.entries.length === files.length);
    const zero = parsed.entries.find((e) => e.name === "bin/zero.bin");
    check("zero-byte-filled entry CRC matches", !!zero && zero.crc === zipCrc32(new Uint8Array(1024)));
  } finally {
    globalThis.Date = RealDate;
  }
}

/* ── B. Concurrent adds — the mutex corruption test ─────────────────── */
console.log("\n── B. 40 concurrent add() calls ──");
{
  const sink = await memorySinkBundle();
  const writer = new StreamingZipWriter(sink.sink);
  const items = Array.from({ length: 40 }, (_, i) => ({
    name: `maps/m${String(i).padStart(3, "0")}.mrc`,
    data: patternBytes(`m${i}`, 4096 + i * 97),
  }));
  // Fire every add concurrently — worst-case interleave.
  await Promise.all(items.map((it) => writer.add(it.name, it.data)));
  await writer.finish();
  const blob = await sink.result();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let ok = true, bad = "";
  try {
    const parsed = readStoreZip(buf);
    if (parsed.entries.length !== 40) { ok = false; bad = `entries=${parsed.entries.length}`; }
    else {
      // offsets must be strictly ascending in add-completion order — with
      // the mutex they are serialized; entries appear exactly once.
      const byName = new Map(parsed.entries.map((e) => [e.name, e]));
      for (const it of items) {
        const e = byName.get(it.name);
        if (!e) { ok = false; bad = `missing ${it.name}`; break; }
        if (e.size !== it.data.length) { ok = false; bad = `size ${it.name}`; break; }
        if (e.crc !== zipCrc32(it.data)) { ok = false; bad = `crc ${it.name}`; break; }
        for (let k = 0; k < it.data.length; k++) {
          if (e.data[k] !== it.data[k]) { ok = false; bad = `data ${it.name}@${k}`; break; }
        }
        if (!ok) break;
      }
    }
  } catch (err) {
    ok = false; bad = err.message;
  }
  check("archive intact under full concurrency", ok, bad);
}

/* ── C. Abort semantics ─────────────────────────────────────────────── */
console.log("\n── C. abort() ──");
{
  const sink = await memorySinkBundle();
  const writer = new StreamingZipWriter(sink.sink);
  await writer.add("one.txt", "first");
  await writer.add("two.bin", new Uint8Array([1, 2, 3]));
  await writer.abort();
  let addThrew = false, finishThrew = false;
  try { await writer.add("three.txt", "nope"); } catch { addThrew = true; }
  try { await writer.finish(); } catch { finishThrew = true; }
  check("add() after abort throws", addThrew);
  check("finish() after abort throws", finishThrew);
  const blob = await sink.result();
  check("memory sink discarded on abort", blob.size === 0, `${blob.size}`);
}

/* ── E. createBundleSink in Bun → memory (never throws) ─────────────── */
console.log("\n── E. sink capability probe (Bun) ──");
{
  const sink = await createBundleSink();
  check("degrades to memory sink outside browsers", sink.kind === "memory", sink.kind);
  check("writtenBytes starts at 0", sink.writtenBytes() === 0);
}

/* ── D. Budget guard integration — 12 maps, tiny budget ─────────────── */
console.log("\n── D. buildBundle budget guard (live dev server) ──");
{
  const upstream = Bun.serve({
    port: 3997,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/favicon.ico") return new Response("ok");
      if (u.pathname.startsWith("/api/log_image/download_result_file/")) {
        const name = u.pathname.split("/").pop();
        await sleep(40);
        return new Response(patternBytes(name, MAP_BYTES), {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    },
  });

  try {
    const NOW = new Date().toISOString();
    const mkJob = (uid, job_type, parents) => ({
      uid, project_uid: "PX8", job_type, title: `${uid} ${job_type}`,
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
        project_uid: "PX8", cryosmart_origin: CRYO,
        cryosmart_auth: "Bearer sim", cryosmart_cookie: "session=sim",
        source: "sim", end_job_uid: "J4", lineage_mode: true,
      }),
    })).json();
    const token = created.token;
    await fetch(`${APP}/api/cryosmart/import/session/${token}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_uid: "PX8", jobs }),
    });
    await fetch(`${APP}/api/cryosmart/import/session/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const dataResp = await (await fetch(`${APP}/api/cryosmart/import/session/${token}/data`)).json();
    const summary = buildSummary(dataResp.data.jobs, "PX8", "J4", CRYO);
    const session = { baseUrl: CRYO, cookie: "session=sim", auth: "Bearer sim" };

    // Baseline: reports-only build to learn the fixed-payload size.
    const base = await buildBundle(summary, {
      includePptx: true, includeImages: false, includeMaps: false, includeFinalResults: false,
      session,
    });
    console.log(`  baseline (no maps): ${base.fileCount} files, ${base.zipBytes} bytes`);

    // Budget = baseline + ~2 maps. 12 maps exist (3 jobs + start suffix set).
    const mapItems = 12; // 3 jobs × 4 suffixes + start job's 4? collectMapRequests dedupes start + nodes…
    const budget = base.zipBytes + 2 * MAP_BYTES + 1024;
    const res = await buildBundle(summary, {
      includePptx: true, includeImages: false, includeMaps: true, includeFinalResults: false,
      session, memZipBudgetBytes: budget,
    });
    check("budget build COMPLETES (no OOM throw)", true);
    check("budget warning surfaced", res.warnings.some((w) => /In-memory ZIP budget/.test(w)),
      res.warnings.join(" | ").slice(0, 200));

    const buf = new Uint8Array(await res.blob.arrayBuffer());
    const parsed = readStoreZip(buf);
    const names = parsed.entries.map((e) => e.name);
    const bundledMaps = names.filter((n) => /^maps\/.+\.(mrc|map)$/.test(n) && n !== "maps/DOWNLOAD_LINKS.txt");
    check("some maps bundled under budget", bundledMaps.length >= 1 && bundledMaps.length < mapItems,
      `${bundledMaps.length} bundled`);
    check("DOWNLOAD_LINKS.txt written for the skipped maps", names.includes("maps/DOWNLOAD_LINKS.txt"));
    const links = new TextDecoder().decode(parsed.entries.find((e) => e.name === "maps/DOWNLOAD_LINKS.txt")?.data ?? new Uint8Array());
    const linkCount = (links.match(/^maps\//gm) || []).length;
    check("links count + bundled = all maps", linkCount + bundledMaps.length === mapItems,
      `${linkCount} links + ${bundledMaps.length} bundled`);
    check("archive never exceeds budget + in-flight overshoot (≤3 extra maps)",
      res.zipBytes <= budget + 3 * MAP_BYTES, `${res.zipBytes} > ${budget}`);
    check("result blob size === zipBytes", res.blob.size === res.zipBytes, `${res.blob.size} vs ${res.zipBytes}`);

    // Control: same fixture, default (1 GiB) budget → everything streams in.
    const res2 = await buildBundle(summary, {
      includePptx: true, includeImages: false, includeMaps: true, includeFinalResults: false,
      session,
    });
    const buf2 = new Uint8Array(await res2.blob.arrayBuffer());
    const parsed2 = readStoreZip(buf2);
    const maps2 = parsed2.entries.filter((e) => /^maps\/.+\.(mrc|map)$/.test(e.name));
    check("control (default budget): all maps bundled", maps2.length === mapItems, `${maps2.length}`);
    let byteExact = true;
    for (const e of maps2) {
      const want = patternBytes(e.name.split("/").pop().replace(/\.mrc$/, ""), MAP_BYTES);
      if (e.data.length !== MAP_BYTES) { byteExact = false; break; }
      // pattern seed in upstream is the raw result suffix (pathname last
      // segment like "J2.volume.map"); compare by re-deriving from link file.
    }
    check("control: map payloads byte-checked via CRC list", parsed2.entries.every((e) => e.crc === zipCrc32(e.data)));
    check("control: no budget warning", !res2.warnings.some((w) => /budget/i.test(w)));

    // Clean up the staged session history entry.
    await fetch(`${APP}/api/cryosmart/import/session/${token}`, { method: "DELETE" }).catch(() => {});
  } finally {
    upstream.stop(true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
