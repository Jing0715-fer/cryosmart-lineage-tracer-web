/**
 * Server-side, in-memory store for bookmarklet-imported CryoSmart metadata.
 *
 * Lifecycle:
 *   1. Bookmarklet (running inside the CryoSmart tab, same-origin, cookies auto-attached)
 *      fetches /api/projects/{pid}/jobs etc. on CryoSmart, then POSTs the JSON
 *      to /api/cryosmart/import — receives a token.
 *   2. Bookmarklet opens the web app with ?imported=<token>.
 *   3. Web app polls /api/cryosmart/pending?token=<token>, gets the data,
 *      loads it directly into the lineage workflow.
 *
 * The store is in-memory + TTL-bounded (10 minutes). It does NOT touch disk.
 * Each token is single-use (deleted on first successful read).
 */

interface PendingImport {
  data: {
    project_uid?: string;
    experiment_uid?: string;
    jobs?: unknown[];
    raw?: unknown;
    source_url?: string;
    captured_at?: string;
    discovered_job_count?: number;
  };
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 200;

// Persist across HMR reloads in dev.
const globalRef = globalThis as unknown as {
  __cryoPendingStore?: Map<string, PendingImport>;
  __cryoPendingSeq?: number;
};

if (!globalRef.__cryoPendingStore) {
  globalRef.__cryoPendingStore = new Map<string, PendingImport>();
  globalRef.__cryoPendingSeq = 0;
}

const store: Map<string, PendingImport> = globalRef.__cryoPendingStore;
let seq: number = globalRef.__cryoPendingSeq || 0;

function gc() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
  // Hard cap
  if (store.size > MAX_ENTRIES) {
    const toDelete = store.size - MAX_ENTRIES;
    let i = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++i >= toDelete) break;
    }
  }
}

function newToken(): string {
  // Short, opaque, unguessable-enough for an in-memory 10-min single-use token.
  // Format: <seq>-<8 hex chars of entropy>
  seq += 1;
  globalRef.__cryoPendingSeq = seq;
  const entropy = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `${seq}-${entropy}`;
}

export function putPending(data: PendingImport["data"]): string {
  gc();
  const token = newToken();
  const now = Date.now();
  store.set(token, {
    data,
    createdAt: now,
    expiresAt: now + TTL_MS,
  });
  return token;
}

export function takePending(token: string): PendingImport | null {
  if (!token) return null;
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  // Single-use: delete on read (regardless of success).
  store.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

export function peekPending(token: string): {
  exists: boolean;
  expired: boolean;
  createdAt?: number;
  expiresAt?: number;
} {
  if (!token) return { exists: false, expired: false };
  gc();
  const entry = store.get(token);
  if (!entry) return { exists: false, expired: false };
  return {
    exists: true,
    expired: entry.expiresAt < Date.now(),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}
