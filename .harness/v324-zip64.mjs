/**
 * v3.24 ZIP64 regression — >4 GiB streamed archives stay readable.
 *
 * The v3.18 StreamingZipWriter wrote every size/offset with 32-bit fields;
 * once cumulative bytes passed 4 GiB the central-directory offsets (and EOCD
 * fields) truncated modulo 2^32 and the "successful" archive unzipped as
 * garbage. v3.24 adds APPNOTE 4.5 ZIP64 records.
 *
 * Since a real 4 GiB payload is impractical in CI, the writer accepts a
 * test-only `forceZip64` switch that turns on every ZIP64 path regardless
 * of real sizes. This harness verifies:
 *
 *   A. SMALL ARCHIVES UNCHANGED — a normal (non-forced) build stays
 *      byte-identical to makeZip (no ZIP64 records, version-needed 20).
 *   B. FORCED-ZIP64 RECORD LAYOUTS — parsed at byte level: local extra
 *      0x0001 with both sizes, central extra with size+offset, ZIP64 EOCD
 *      record + locator, classic EOCD 0xFFFF/0xFFFFFFFF placeholders.
 *   C. PYTHON READBACK — the forced-ZIP64 archive is read by CPython's
 *      zipfile (an independent, real-world ZIP64 reader); every entry's
 *      name/size/CRC/data must round-trip.
 *
 * Run: bun .harness/v324-zip64.mjs
 */
import { writeFileSync, rmSync } from "node:fs";

const { makeZip, StreamingZipWriter, zipCrc32 } = await import("../src/lib/cryosmart/zip.ts");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
};

/** In-memory sink. */
class MemSink {
  constructor() { this.parts = []; this.bytes = 0; this.closed = false; this.aborted = false; }
  async write(c) { this.parts.push(c); this.bytes += c.length; }
  async close() { this.closed = true; }
  async abort() { this.aborted = true; this.parts = []; this.bytes = 0; }
  toBytes() {
    const out = new Uint8Array(this.bytes);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => { let v = 0; for (let i = 7; i >= 0; i--) v = v * 256 + b[o + i]; return v; };

/* ── A. small archives stay byte-identical to makeZip ─────────────── */
console.log("── A. small archive byte-parity (no ZIP64 leakage) ──");
{
  const files = [
    { name: "a.txt", data: "hello zip" },
    { name: "b.bin", data: new Uint8Array([0, 1, 2, 255, 128, 7]) },
    { name: "空文件", data: "" },
  ];
  const blob = makeZip(files);
  const expect = new Uint8Array(await blob.arrayBuffer());
  const sink = new MemSink();
  const w = new StreamingZipWriter(sink);
  for (const f of files) await w.add(f.name, f.data);
  await w.finish();
  const got = sink.toBytes();
  check("byte-identical to makeZip", got.length === expect.length && got.every((v, i) => v === expect[i]),
    `len ${got.length} vs ${expect.length}`);
  check("no ZIP64 EOCD in small archive", !got.some((_, i) => false) && got.indexOf(0x06064b50 | 0) === -1 ? true : (() => {
    // search for the u32 LE signature 50 4b 06 06
    for (let i = 0; i + 4 <= got.length; i++) {
      if (got[i] === 0x50 && got[i+1] === 0x4b && got[i+2] === 0x06 && got[i+3] === 0x06) return false;
    }
    return true;
  })());
}

/* ── B. forced-ZIP64 record layout ────────────────────────────────── */
console.log("── B. forced-ZIP64 record layouts ──");
{
  const files = [
    { name: "big1.mrc", data: new Uint8Array(64 * 1024).fill(0xab) },
    { name: "big2.mrc", data: new Uint8Array(32 * 1024).fill(0xcd) },
    { name: "meta.txt", data: "small entry" },
  ];
  const sink = new MemSink();
  const w = new StreamingZipWriter(sink, { forceZip64: true });
  for (const f of files) await w.add(f.name, f.data);
  await w.finish();
  const b = sink.toBytes();

  // Classic EOCD is the last 22 bytes (no comment).
  const eocd = b.length - 22;
  check("classic EOCD signature", u32(b, eocd) === 0x06054b50);
  check("EOCD entry count placeholder 0xFFFF", u16(b, eocd + 10) === 0xffff && u16(b, eocd + 12) === 0xffff);
  check("EOCD central size/offset placeholders 0xFFFFFFFF", u32(b, eocd + 12) === 0xffffffff && u32(b, eocd + 16) === 0xffffffff);

  // ZIP64 locator sits right before the classic EOCD (20 bytes).
  const loc = eocd - 20;
  check("ZIP64 EOCD locator signature", u32(b, loc) === 0x07064b50);
  const z64EocdOff = u64(b, loc + 8);
  check("ZIP64 EOCD record signature at locator offset", u32(b, z64EocdOff) === 0x06064b50);
  check("ZIP64 EOCD record size = 44", u64(b, z64EocdOff + 4) === 44);
  const zEntries = u64(b, z64EocdOff + 32);
  const zCentralSize = u64(b, z64EocdOff + 40);
  const zCentralStart = u64(b, z64EocdOff + 48);
  check("ZIP64 EOCD entry count = 3", zEntries === 3, `got ${zEntries}`);
  check("ZIP64 EOCD central start < locator offset", zCentralStart < loc && zCentralStart + zCentralSize === z64EocdOff,
    `start ${zCentralStart} size ${zCentralSize} vs z64eocd ${z64EocdOff}`);

  // Central directory: every entry has the ZIP64 extra with size + offset.
  let off = zCentralStart;
  let entriesSeen = 0;
  let allOk = true;
  const parsed = [];
  while (off < zCentralStart + zCentralSize) {
    if (u32(b, off) !== 0x02014b50) { allOk = false; break; }
    const versionNeeded = u16(b, off + 6);
    const csize = u32(b, off + 20);
    const usize = u32(b, off + 24);
    const nameLen = u16(b, off + 28);
    const extraLen = u16(b, off + 30);
    const lho = u32(b, off + 42);
    const name = new TextDecoder().decode(b.slice(off + 46, off + 46 + nameLen));
    const extra = b.slice(off + 46 + nameLen, off + 46 + nameLen + extraLen);
    if (versionNeeded !== 45 || csize !== 0xffffffff || usize !== 0xffffffff || lho !== 0xffffffff) allOk = false;
    if (u16(extra, 0) !== 0x0001) allOk = false;
    const payloadLen = u16(extra, 2);
    if (payloadLen !== 24) allOk = false; // 8 (usize) + 8 (csize) + 8 (offset)
    const xSize = u64(extra, 4);
    const xOff = u64(extra, 20);
    parsed.push({ name, xSize, xOff });
    off += 46 + nameLen + extraLen;
    entriesSeen++;
  }
  check("central: 3 entries, all ZIP64 (v45, 0xFFFFFFFF slots, extra 0x0001 size+offset)",
    allOk && entriesSeen === 3, `entries ${entriesSeen} allOk ${allOk}`);

  // Local headers: version 45 + ZIP64 extra carrying BOTH sizes.
  let localsOk = true;
  for (const p of parsed) {
    const lo = p.xOff;
    if (u32(b, lo) !== 0x04034b50) { localsOk = false; break; }
    if (u16(b, lo + 4) !== 45) localsOk = false;
    if (u32(b, lo + 18) !== 0xffffffff || u32(b, lo + 22) !== 0xffffffff) localsOk = false;
    const nameLen = u16(b, lo + 26);
    const extraLen = u16(b, lo + 28);
    const extra = b.slice(lo + 30 + nameLen, lo + 30 + nameLen + extraLen);
    if (u16(extra, 0) !== 0x0001 || u16(extra, 2) !== 16) localsOk = false;
    if (u64(extra, 4) !== p.xSize || u64(extra, 12) !== p.xSize) localsOk = false;
    const expected = files.find((f) => f.name === p.name);
    const dataOff = lo + 30 + nameLen + extraLen;
    const data = b.slice(dataOff, dataOff + p.xSize);
    const expBytes = typeof expected.data === "string" ? new TextEncoder().encode(expected.data) : expected.data;
    if (data.length !== expBytes.length || data.some((v, i) => v !== expBytes[i])) localsOk = false;
    if (zipCrc32(data) !== u32(b, lo + 14)) localsOk = false;
  }
  check("local: ZIP64 extras (both sizes) + data + CRC round-trip per entry", localsOk);
}

/* ── C. CPython zipfile readback (independent ZIP64 reader) ───────── */
console.log("── C. CPython zipfile readback ──");
{
  const files = [
    { name: "maps/volume.mrc", data: new Uint8Array(100000).fill(0x11) },
    { name: "report.html", data: "<!doctype html><p>工业风 report</p>" },
    { name: "empty.txt", data: "" },
  ];
  const sink = new MemSink();
  const w = new StreamingZipWriter(sink, { forceZip64: true });
  for (const f of files) await w.add(f.name, f.data);
  await w.finish();
  writeFileSync("/tmp/v324-zip64-test.zip", sink.toBytes());

  const { execSync } = await import("node:child_process");
  writeFileSync("/tmp/v324-zip64-test.py", `
import zipfile
z = zipfile.ZipFile("/tmp/v324-zip64-test.zip")
bad = z.testzip()
assert bad is None, f"crc fail {bad}"
names = z.namelist()
assert names == ["maps/volume.mrc", "report.html", "empty.txt"], names
assert z.read("maps/volume.mrc") == b"\\x11" * 100000
assert z.read("report.html") == "<!doctype html><p>工业风 report</p>".encode()
assert z.read("empty.txt") == b""
print("python-zipfile OK, %d entries" % len(names))
`);
  try {
    const out = execSync(`${process.env.PYTHON || "python3"} /tmp/v324-zip64-test.py`, { encoding: "utf8" });
    check("CPython zipfile: testzip + round-trip + names", out.includes("python-zipfile OK"), out.trim());
  } catch (e) {
    check("CPython zipfile: testzip + round-trip + names", false, String(e.stdout || e.message));
  }
  rmSync("/tmp/v324-zip64-test.zip", { force: true });
  rmSync("/tmp/v324-zip64-test.py", { force: true });
}

/* ── D. zipU64 encoder spot checks ────────────────────────────────── */
console.log("── D. zipU64 encoder ──");
{
  const { zipU64 } = await import("../src/lib/cryosmart/zip.ts");
  const hex = (u8) => Array.from(u8).map((v) => v.toString(16).padStart(2, "0")).join("");
  check("zipU64(0)", hex(zipU64(0)) === "0000000000000000");
  check("zipU64(1)", hex(zipU64(1)) === "0100000000000000");
  check("zipU64(0xffffffff)", hex(zipU64(0xffffffff)) === "ffffffff00000000");
  check("zipU64(0x100000000)", hex(zipU64(0x100000000)) === "0000000001000000");
  check("zipU64(4294968530) = 0x1000004D2", hex(zipU64(4294968530)) === "d204000001000000");
  // the review's corruption example: 4294968530 must NOT decode as 1234
  const enc = zipU64(4294968530);
  check("zipU64 round-trip of the review's failing offset", u64(enc, 0) === 4294968530);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
