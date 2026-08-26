/**
 * Server-side, in-memory store for CryoSmart metadata imports.
 * Supports both bookmarklet captures (with cookies) and console captures
 * (with auth tokens).
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
    // CryoSmart session info for map/image downloads
    cryosmart_origin?: string;
    cryosmart_auth?: string;
    cryosmart_cookie?: string;
    // Log images force-loaded from the SPA's lazy jobLogs state:
    // { [jobUid]: [{ fileid, name }, ...] }
    job_log_images?: Record<string, unknown>;
  };
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

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
  if (store.size > MAX_ENTRIES) {
    let i = 0;
    for (const k of store.keys()) {
      store.delete(k);
      if (++i >= store.size - MAX_ENTRIES) break;
    }
  }
}

function newToken(): string {
  seq += 1;
  globalRef.__cryoPendingSeq = seq;
  const entropy = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
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

/** Build a CryoSmartSession from stored import data. */
export function buildSessionFromPending(data: PendingImport["data"]) {
  if (!data) return null;
  const baseUrl = data.cryosmart_origin;
  if (!baseUrl) return null;
  return {
    baseUrl,
    auth: data.cryosmart_auth || undefined,
    cookie: data.cryosmart_cookie || undefined,
  };
}
