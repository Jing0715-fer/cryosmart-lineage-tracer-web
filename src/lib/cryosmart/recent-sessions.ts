"use client";

import { useEffect, useState } from "react";

/**
 * Recent sessions stored in localStorage. Each session represents one
 * "load" event — a project UID + start job + source + timestamp + a
 * thumbnail of the job count. Clicking a session reloads it.
 *
 * NOTE: We do NOT store the raw jobs payload in localStorage — it can be
 * huge (10+ MB for big projects). We only store metadata so the user can
 * see "last week I traced P52 from J10" and decide to re-run the bookmarklet.
 */

export interface RecentSession {
  id: string; // `${projectUid}:${startJob}:${timestamp}`
  projectUid: string;
  startJob?: string;
  source: "upload" | "sample" | "live" | "bookmarklet";
  jobCount: number;
  cryosmartOrigin?: string;
  fileName?: string; // for upload source
  createdAt: number;
}

const STORAGE_KEY = "cryosmart.recent-sessions.v1";
const MAX_SESSIONS = 8;

function safeRead(): RecentSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is RecentSession =>
        s &&
        typeof s.id === "string" &&
        typeof s.projectUid === "string" &&
        typeof s.source === "string" &&
        typeof s.createdAt === "number"
    );
  } catch {
    return [];
  }
}

function safeWrite(sessions: RecentSession[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Quota exceeded or storage disabled — fail silently.
  }
}

/** Add (or replace) a session, keeping the list most-recent-first, deduped by projectUid+startJob. */
export function recordSession(session: Omit<RecentSession, "id" | "createdAt">): RecentSession {
  const id = `${session.projectUid}:${session.startJob || "any"}:${Date.now()}`;
  const full: RecentSession = { ...session, id, createdAt: Date.now() };
  const existing = safeRead();
  // Remove any prior session with the same projectUid+startJob (keep newest).
  const filtered = existing.filter(
    (s) => !(s.projectUid === full.projectUid && s.startJob === full.startJob)
  );
  const next = [full, ...filtered].slice(0, MAX_SESSIONS);
  safeWrite(next);
  // Dispatch a custom event so any mounted hook can refresh.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cryosmart:sessions-updated"));
  }
  return full;
}

export function clearSessions() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("cryosmart:sessions-updated"));
}

export function removeSession(id: string) {
  const next = safeRead().filter((s) => s.id !== id);
  safeWrite(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cryosmart:sessions-updated"));
  }
}

/** Subscribe to recent sessions. Re-reads on every `cryosmart:sessions-updated` event. */
export function useRecentSessions(): RecentSession[] {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  useEffect(() => {
    const refresh = () => setSessions(safeRead());
    refresh();
    window.addEventListener("cryosmart:sessions-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("cryosmart:sessions-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return sessions;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
