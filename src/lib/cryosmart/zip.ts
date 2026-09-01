/**
 * Hand-rolled STORE-only ZIP writer (browser Blob output).
 *
 * Ported verbatim from `CryoSmartLineageTracer_3.0/popup.js`:
 *   - `ZIP_CRC_TABLE` / `zipCrc32`            — CRC-32 (IEEE 802.3 polynomial)
 *   - `zipU16` / `zipU32`                     — little-endian uint encoders
 *   - `concatBytes`                           — typed-array concatenation
 *   - `dosDateTime`                           — MS-DOS date/time stamp
 *   - `makeZip(files, mimeType)`              — STORE-only archive → Blob
 *
 * This is the SAME zip code that builds the PPTX package — the resulting
 * Blob opens cleanly in LibreOffice Impress and Microsoft PowerPoint.
 *
 * The module uses only browser-standard APIs (`Uint8Array`, `TextEncoder`,
 * `Blob`) so it works in:
 *   - Next.js 16 client components (browser)
 *   - Next.js 16 server components / route handlers (Node 18+ exposes the
 *     same APIs as globals; `Blob` and `TextEncoder` are both available)
 *
 * No external dependencies, no `node:buffer` import — pure Web APIs.
 */

/** A file entry to be packed into the ZIP archive. */
export interface ZipFileEntry {
  /** Path inside the archive (POSIX-style, e.g. `ppt/slides/slide1.xml`). */
  name: string;
  /** File contents. `string` is encoded as UTF-8; `Uint8Array` is used as-is. */
  data: Uint8Array | string;
}

/* ------------------------------------------------------------------ */
/* CRC-32 table (precomputed at module load)                           */
/* ------------------------------------------------------------------ */

const ZIP_CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Compute the CRC-32 of a byte sequence (IEEE 802.3 polynomial). */
export function zipCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* Little-endian integer encoders                                     */
/* ------------------------------------------------------------------ */

/** Encode a 16-bit unsigned integer as a 2-byte little-endian Uint8Array. */
export function zipU16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

/** Encode a 32-bit unsigned integer as a 4-byte little-endian Uint8Array. */
export function zipU32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

/** Encode a 64-bit unsigned integer as an 8-byte little-endian Uint8Array.
 *  Uses split hi/lo 32-bit halves so values up to 2^53 (Number.MAX_SAFE_INTEGER)
 *  stay exact — far beyond any realistic archive size. Needed by the ZIP64
 *  fields (v3.24). */
export function zipU64(value: number): Uint8Array {
  const lo = value % 0x100000000;
  const hi = Math.floor(value / 0x100000000);
  return new Uint8Array([
    lo & 0xff,
    (lo >>> 8) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 24) & 0xff,
    hi & 0xff,
    (hi >>> 8) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 24) & 0xff,
  ]);
}

/* ------------------------------------------------------------------ */
/* Byte-array helpers                                                 */
/* ------------------------------------------------------------------ */

/** Concatenate a list of `Uint8Array`s into a single `Uint8Array`. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode a UTF-8 string into a `Uint8Array`. */
function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/* ------------------------------------------------------------------ */
/* MS-DOS date/time stamp                                             */
/* ------------------------------------------------------------------ */

export interface DosDateTime {
  /** 16-bit DOS time field (hours/minutes/seconds). */
  time: number;
  /** 16-bit DOS date field (year/month/day). */
  date: number;
}

/**
 * Convert a `Date` into the 16-bit DOS time + 16-bit DOS date fields used
 * by the ZIP local/central file headers. Defaults to "now".
 */
export function dosDateTime(date: Date = new Date()): DosDateTime {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(1980, date.getFullYear()) - 1980;
  return { time, date: (year << 9) | (month << 5) | day };
}

/* ------------------------------------------------------------------ */
/* StreamingZipWriter — STORE-only archive, written entry-by-entry     */
/* ------------------------------------------------------------------ */

/**
 * Minimal structural type for a writable byte sink. `FileSystemWritableFileStream`
 * (File System Access / OPFS) satisfies this shape; so does the in-memory sink
 * below. Declared here so neither zip.ts nor bundle.ts depends on the exact
 * TypeScript DOM-lib version of the File System standard types.
 */
export interface ZipByteSink {
  /** Append a chunk to the output. Resolves when the chunk is handed off. */
  write(chunk: Uint8Array): Promise<void>;
  /** Finalize successfully (flush + release the underlying file/lock). */
  close(): Promise<void>;
  /** Tear down after a failure/cancel — best-effort discard of the output. */
  abort(): Promise<void>;
}

/** Central-directory metadata buffered per entry (tiny — names + numbers). */
interface CentralEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/**
 * Incremental STORE-only ZIP writer (v3.18).
 *
 * WHY: `makeZip` requires every file's bytes to be alive in JS memory at
 * once AND internally makes two more full concatenation passes
 * (`concatBytes([header, data])` per file, then `concatBytes(localParts)`)
 * — peak heap ≈ 3× the archive size. A 66-map lineage bundle (often
 * 10+ GB of .mrc volumes) blew the browser tab past its ~4 GB limit and
 * the page died mid-build (the "Previous build did not finish" banner
 * after reload).
 *
 * This writer emits the exact same byte layout as `makeZip`, but streams
 * each entry to a `ZipByteSink` (OPFS file on disk in the happy path) the
 * moment it is produced, so completed maps become garbage-collectable
 * immediately. Only the small central-directory metadata is buffered in
 * memory and flushed by `finish()`.
 *
 * Layout per entry (identical to makeZip — regressions can diff bytes):
 *   local file header … name … data
 * and at the end: central directory (one header per entry) + EOCD.
 * A single `dosDateTime()` stamp is computed at construction and reused
 * for every entry so output stays deterministic across the build.
 *
 * v3.24 — ZIP64 (APPNOTE 4.5.x): the v3.18 streaming sink removed the
 * memory bound that used to keep archives under ~4 GB, but every size /
 * offset field was still 32-bit, so a >4 GiB archive "succeeded" and
 * unzipped as garbage (offsets truncated modulo 2³² in the central
 * directory + EOCD). Now:
 *   - an entry whose size ≥ 0xFFFFFFFF carries its sizes in a ZIP64
 *     extended-information extra field on the LOCAL header (both fields,
 *     per APPNOTE 4.5.3) with the 32-bit slots set to 0xFFFFFFFF;
 *   - central entries with overflowing size or offset emit the matching
 *     ZIP64 extra (only the overflowed fields, in fixed order);
 *   - entry count ≥ 0xFFFF or central dir offset/size ≥ 0xFFFFFFFF
 *     triggers the ZIP64 EOCD record + locator before the classic EOCD
 *     (whose fields become 0xFFFF / 0xFFFFFFFF placeholders).
 * Small archives stay byte-identical to the v3.18 layout (no ZIP64
 * records, no extra fields, version-needed 20).
 */
export class StreamingZipWriter {
  private readonly sink: ZipByteSink;
  private readonly stamp: DosDateTime;
  private readonly entries: CentralEntry[] = [];
  private offset = 0;
  private state: "open" | "finished" | "aborted" = "open";
  /** Test-only: force every ZIP64 path on regardless of real sizes so the
   *  record layouts can be byte-verified without 4 GiB payloads. */
  private readonly forceZip64: boolean;
  /**
   * Serializes `add` calls. Download pools (maps ×4, images ×4, PPT ×4…)
   * complete out of order and their `add` calls would otherwise interleave
   * mid-entry (header from A + data from B) and corrupt the archive. A
   * promise chain is enough: adds are byte copies + CRC, i.e. fast; only
   * the sink `write` await can straddle a macrotask, and the chain keeps
   * the CRITICAL SECTION (header → data) atomic per entry.
   */
  private chain: Promise<void> = Promise.resolve();

  constructor(sink: ZipByteSink, opts?: { forceZip64?: boolean }) {
    this.sink = sink;
    this.stamp = dosDateTime();
    this.forceZip64 = opts?.forceZip64 === true;
  }

  /** Running total of archive bytes handed to the sink so far. */
  get bytesWritten(): number {
    return this.offset;
  }

  /** Number of entries added so far. */
  get entryCount(): number {
    return this.entries.length;
  }

  /**
   * Append one file. `data` is encoded (string) or written as-is (bytes);
   * after this returns, the caller may release the data — only the ~name
   * sized central metadata is retained. Safe to call from concurrent
   * download workers — calls are serialized internally.
   */
  add(name: string, data: Uint8Array | string): Promise<void> {
    const run = this.chain.then(() => this.addLocked(name, data));
    // Keep the chain alive even when one add rejects, so a later cancel
    // path can still acquire the lock and tear down cleanly.
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async addLocked(name: string, data: Uint8Array | string): Promise<void> {
    if (this.state !== "open") {
      throw new Error(`zip writer is ${this.state} — cannot add ${name}`);
    }
    const nameBytes = utf8Bytes(name);
    const bytes = data instanceof Uint8Array ? data : utf8Bytes(data);
    const crc = zipCrc32(bytes);
    const entryOffset = this.offset;
    // v3.24 ZIP64 local header: entry size ≥ 4 GiB-1 → sizes move into the
    // ZIP64 extended-information extra field (BOTH fields per APPNOTE 4.5.3
    // — the local-header variant must always carry uncompressed + compressed)
    // and the 32-bit slots become 0xFFFFFFFF. At add() time the full payload
    // is in hand, so no data descriptors are involved.
    const sizeOverflow = this.forceZip64 || bytes.length >= 0xffffffff;
    const localExtra = sizeOverflow
      ? concatBytes([
          zipU16(0x0001), // ZIP64 extended information header id
          zipU16(16), // extra payload size: uncompressed (8) + compressed (8)
          zipU64(bytes.length), // uncompressed size
          zipU64(bytes.length), // compressed size (STORE — identical)
        ])
      : null;

    // Local file header (signature 0x04034b50) — field order mirrors makeZip.
    const localHeader = concatBytes([
      zipU32(0x04034b50),
      zipU16(sizeOverflow ? 45 : 20), // version needed to extract (4.5 = ZIP64)
      zipU16(0), // general purpose bit flag (no flags)
      zipU16(0), // compression method (0 = STORE)
      zipU16(this.stamp.time),
      zipU16(this.stamp.date),
      zipU32(crc),
      zipU32(sizeOverflow ? 0xffffffff : bytes.length), // compressed size
      zipU32(sizeOverflow ? 0xffffffff : bytes.length), // uncompressed size
      zipU16(nameBytes.length),
      zipU16(localExtra ? localExtra.length : 0), // extra field length
      nameBytes,
      ...(localExtra ? [localExtra] : []),
    ]);
    await this.sink.write(localHeader);
    await this.sink.write(bytes);
    this.offset += localHeader.length + bytes.length;
    this.entries.push({ nameBytes, crc, size: bytes.length, offset: entryOffset });
  }

  /** Write the central directory + end-of-central-directory and close. */
  async finish(): Promise<void> {
    if (this.state === "finished") return;
    if (this.state === "aborted") {
      throw new Error("zip writer was aborted — archive is incomplete");
    }
    // Wait for any queued adds to drain first (they hold the lock).
    await this.chain;
    if (this.state !== "open") {
      throw new Error(`zip writer is ${this.state} — cannot finish`);
    }
    this.state = "finished";
    const centralStart = this.offset;
    for (const e of this.entries) {
      // v3.24 ZIP64 central entry: ONLY the fields whose 32-bit slot would
      // overflow are replaced by 0xFFFFFFFF and carried (in fixed order:
      // uncompressed, compressed, relative offset) in the ZIP64 extra —
      // unlike the local header, which always carries both sizes.
      const sizeOverflow = this.forceZip64 || e.size >= 0xffffffff;
      const offsetOverflow = this.forceZip64 || e.offset >= 0xffffffff;
      let centralExtra: Uint8Array | null = null;
      if (sizeOverflow || offsetOverflow) {
        const fields: Uint8Array[] = [];
        if (sizeOverflow) {
          fields.push(zipU64(e.size)); // uncompressed size
          fields.push(zipU64(e.size)); // compressed size (STORE — identical)
        }
        if (offsetOverflow) fields.push(zipU64(e.offset)); // local header offset
        centralExtra = concatBytes([
          zipU16(0x0001), // ZIP64 extended information header id
          zipU16(fields.reduce((n, f) => n + f.length, 0)),
          ...fields,
        ]);
      }
      const centralHeader = concatBytes([
        zipU32(0x02014b50),
        zipU16(20), // version made by
        zipU16(centralExtra ? 45 : 20), // version needed to extract (4.5 = ZIP64)
        zipU16(0), // general purpose bit flag
        zipU16(0), // compression method
        zipU16(this.stamp.time),
        zipU16(this.stamp.date),
        zipU32(e.crc),
        zipU32(sizeOverflow ? 0xffffffff : e.size), // compressed size
        zipU32(sizeOverflow ? 0xffffffff : e.size), // uncompressed size
        zipU16(e.nameBytes.length),
        zipU16(centralExtra ? centralExtra.length : 0), // extra field length
        zipU16(0), // file comment length
        zipU16(0), // disk number start
        zipU16(0), // internal file attributes
        zipU32(0), // external file attributes
        zipU32(offsetOverflow ? 0xffffffff : e.offset), // relative offset of local header
        e.nameBytes,
        ...(centralExtra ? [centralExtra] : []),
      ]);
      await this.sink.write(centralHeader);
      this.offset += centralHeader.length;
    }
    const centralSize = this.offset - centralStart;
    // v3.24 ZIP64 EOCD: entry count ≥ 0xFFFF or central offset/size ≥
    // 0xFFFFFFFF → emit the ZIP64 EOCD record + locator and fall back to
    // 0xFFFF / 0xFFFFFFFF placeholders in the classic EOCD (readers that
    // understand ZIP64 follow the locator; the rest refuse loudly instead
    // of silently misreading truncated offsets).
    const needZip64Eocd =
      this.forceZip64 ||
      this.entries.length >= 0xffff ||
      centralSize >= 0xffffffff ||
      centralStart >= 0xffffffff;
    if (needZip64Eocd) {
      const zip64EocdOffset = this.offset;
      const zip64Eocd = concatBytes([
        zipU32(0x06064b50), // ZIP64 end of central directory record
        zipU64(44), // size of this record AFTER the size field
        zipU16(45), // version made by (4.5)
        zipU16(45), // version needed to extract (4.5)
        zipU32(0), // number of this disk
        zipU32(0), // disk with start of central directory
        zipU64(this.entries.length), // entries on this disk
        zipU64(this.entries.length), // total entries
        zipU64(centralSize), // size of central directory
        zipU64(centralStart), // offset of central directory
      ]);
      await this.sink.write(zip64Eocd);
      this.offset += zip64Eocd.length;
      const zip64Locator = concatBytes([
        zipU32(0x07064b50), // ZIP64 end of central directory locator
        zipU32(0), // disk with the ZIP64 EOCD record
        zipU64(zip64EocdOffset), // offset of the ZIP64 EOCD record
        zipU32(1), // total number of disks
      ]);
      await this.sink.write(zip64Locator);
      this.offset += zip64Locator.length;
    }
    const end = concatBytes([
      zipU32(0x06054b50),
      zipU16(0), // number of this disk
      zipU16(0), // disk where central directory starts
      zipU16(needZip64Eocd ? 0xffff : this.entries.length), // entries on this disk
      zipU16(needZip64Eocd ? 0xffff : this.entries.length), // total entries
      zipU32(needZip64Eocd ? 0xffffffff : centralSize), // size of central directory
      zipU32(needZip64Eocd ? 0xffffffff : centralStart), // offset of central directory
      zipU16(0), // comment length
    ]);
    await this.sink.write(end);
    this.offset += end.length;
    await this.sink.close();
  }

  /** Mark the writer dead and discard the sink output (Stop button / error). */
  async abort(): Promise<void> {
    if (this.state !== "open") return;
    this.state = "aborted";
    try {
      await this.sink.abort();
    } catch {
      // best-effort — a failed teardown must not mask the original error
    }
  }
}

/* ------------------------------------------------------------------ */
/* makeZip — STORE-only archive → Blob                                */
/* ------------------------------------------------------------------ */

/**
 * Build a STORE-only (no DEFLATE compression) ZIP archive from a list of
 * file entries and return it as a `Blob` of the supplied MIME type.
 *
 * STORE-only is fine for PPTX/OOXML because the inner XML / PNG payloads
 * are already compressed (and PowerPoint refuses to DEFLATE-decode parts
 * inside an OOXML container anyway — the container itself must use STORE
 * or the file is rejected).
 *
 * @param files    List of file entries to pack.
 * @param mimeType MIME type to attach to the returned `Blob`. For OOXML
 *                 use `application/vnd.openxmlformats-officedocument
 *                 .presentationml.presentation`; otherwise defaults to
 *                 `application/zip`.
 */
export function makeZip(
  files: readonly ZipFileEntry[],
  mimeType: string = "application/zip",
): Blob {
  const now = dosDateTime();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8Bytes(file.name);
    const data =
      file.data instanceof Uint8Array ? file.data : utf8Bytes(file.data);
    const crc = zipCrc32(data);

    // Local file header (signature 0x04034b50).
    const localHeader = concatBytes([
      zipU32(0x04034b50),
      zipU16(20), // version needed to extract (2.0)
      zipU16(0), // general purpose bit flag (no flags)
      zipU16(0), // compression method (0 = STORE)
      zipU16(now.time),
      zipU16(now.date),
      zipU32(crc),
      zipU32(data.length), // compressed size
      zipU32(data.length), // uncompressed size
      zipU16(nameBytes.length),
      zipU16(0), // extra field length
      nameBytes,
    ]);
    localParts.push(localHeader, data);

    // Central directory file header (signature 0x02014b50).
    const centralHeader = concatBytes([
      zipU32(0x02014b50),
      zipU16(20), // version made by
      zipU16(20), // version needed to extract
      zipU16(0), // general purpose bit flag
      zipU16(0), // compression method
      zipU16(now.time),
      zipU16(now.date),
      zipU32(crc),
      zipU32(data.length), // compressed size
      zipU32(data.length), // uncompressed size
      zipU16(nameBytes.length),
      zipU16(0), // extra field length
      zipU16(0), // file comment length
      zipU16(0), // disk number start
      zipU16(0), // internal file attributes
      zipU32(0), // external file attributes
      zipU32(offset), // relative offset of local header
      nameBytes,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const local = concatBytes(localParts);
  const central = concatBytes(centralParts);

  // End of central directory record (signature 0x06054b50).
  const end = concatBytes([
    zipU32(0x06054b50),
    zipU16(0), // number of this disk
    zipU16(0), // disk where central directory starts
    zipU16(files.length), // entries on this disk
    zipU16(files.length), // total entries
    zipU32(central.length), // size of central directory
    zipU32(local.length), // offset of central directory
    zipU16(0), // comment length
  ]);

  // NOTE: Under TS 5.7+ with the DOM lib, `Uint8Array` became generic over
  // its backing buffer (`ArrayBufferLike`) so it no longer auto-assigns to
  // `BlobPart` (which requires `ArrayBufferView<ArrayBuffer>`). At runtime
  // the browser and Node 18+ both accept a plain `Uint8Array` in the Blob
  // constructor, so we cast the array to `BlobPart[]` to bridge the gap.
  const blobParts: BlobPart[] = [local, central, end] as unknown as BlobPart[];
  return new Blob(blobParts, { type: mimeType });
}
