/**
 * Bundle output sinks (v3.18).
 *
 * The ZIP used to be assembled as one in-memory Blob (see
 * StreamingZipWriter for the 66-map OOM story). buildBundle now writes
 * entries incrementally into a sink chosen here:
 *
 *   1. OPFS  — the browser's Origin Private File System. The archive is
 *      streamed to a real file on DISK; peak JS heap stays at "a few
 *      concurrent download buffers" no matter how many GB the bundle is.
 *      After `close()`, the sink hands back a File that is BACKED BY the
 *      OPFS file (the browser pages it to disk — it is not loaded into
 *      the JS heap), which `downloadBlob` then streams out as a normal
 *      anchor download.
 *      Available in every modern browser (Chrome/Edge 86+, Safari 15.2+,
 *      Firefox 111+), but ONLY in secure contexts (https / localhost).
 *
 *   2. Memory — chunks buffered in a JS array, `Blob(chunks)` at the end.
 *      Used where OPFS is unavailable (plain-http intranet deployments,
 *      non-browser harness runs). ONE copy total (vs three in the old
 *      makeZip path), and bundle.ts enforces a byte BUDGET against this
 *      sink so the fallback path can never OOM the tab either — maps
 *      beyond the budget degrade to maps/DOWNLOAD_LINKS.txt entries.
 */

import type { ZipByteSink } from "./zip";

export type BundleSinkKind = "opfs" | "memory";

export interface BundleSink {
  kind: BundleSinkKind;
  /** The byte sink handed to StreamingZipWriter. */
  sink: ZipByteSink;
  /** Bytes successfully handed to the sink so far (for the budget guard). */
  writtenBytes(): number;
  /**
   * AFTER a successful writer.finish(): a Blob over the archive.
   * OPFS → a File backed by the on-disk OPFS file; memory → Blob(chunks).
   */
  result(): Promise<Blob>;
}

/* ------------------------------------------------------------------ */
/* OPFS (structural types — immune to DOM-lib version drift)           */
/* ------------------------------------------------------------------ */

interface OpfsWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

interface OpfsFileHandle {
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritable>;
  getFile(): Promise<File>;
}

interface OpfsDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
}

/** Fixed OPFS file name — every build overwrites the previous staging
 *  file, so repeated builds never accumulate OPFS quota usage. */
const OPFS_BUNDLE_NAME = "cryosmart_bundle.zip";

/**
 * Open the best available bundle sink. NEVER throws — any failure probing
 * OPFS (unsupported, insecure context, quota/lock error, private mode…)
 * silently degrades to the memory sink, which is guarded by a byte budget
 * inside buildBundle.
 */
export async function createBundleSink(): Promise<BundleSink> {
  // ── OPFS attempt ────────────────────────────────────────────────────
  try {
    const storage = (
      navigator as { storage?: { getDirectory?: () => Promise<OpfsDirHandle> } }
    ).storage;
    const root = await storage?.getDirectory?.();
    if (root) {
      const handle = await root.getFileHandle(OPFS_BUNDLE_NAME, { create: true });
      // keepExistingData:false → truncate: a leftover staging file from an
      // aborted build must not prepend garbage to the new archive.
      const writable = await handle.createWritable({ keepExistingData: false });
      let written = 0;
      return {
        kind: "opfs",
        sink: {
          write: async (chunk) => {
            await writable.write(chunk);
            written += chunk.length;
          },
          close: () => writable.close(),
          // writable.abort() discards everything written this stream —
          // exactly the semantics the Stop button wants. (Do NOT fall
          // back to close() here: closing COMMITS the partial archive.)
          abort: async () => {
            if (typeof writable.abort === "function") await writable.abort();
          },
        },
        writtenBytes: () => written,
        // File backed by the OPFS file on disk — NOT a heap copy.
        result: () => handle.getFile(),
      };
    }
  } catch {
    // fall through to memory
  }

  // ── Memory fallback ─────────────────────────────────────────────────
  const chunks: Uint8Array[] = [];
  let total = 0;
  return {
    kind: "memory",
    sink: {
      write: async (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
      },
      close: async () => {
        /* nothing to flush — chunks are handed over by result() */
      },
      abort: async () => {
        chunks.length = 0;
        total = 0;
      },
    },
    writtenBytes: () => total,
    result: async () => {
      // Same TS 5.7 Uint8Array/BlobPart note as makeZip — runtime-wise a
      // plain Uint8Array is a valid BlobPart in browsers and Node 18+.
      const parts = chunks as unknown as BlobPart[];
      return new Blob(parts, { type: "application/zip" });
    },
  };
}
