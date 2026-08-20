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
