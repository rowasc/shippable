/**
 * recents.ts — LRU history of changesets the reviewer has loaded.
 *
 * Distinct from `persist.ts` (which holds in-progress review state).
 * Recents survive across sessions and power the welcome screen's
 * "pick up where you left off" strip; clicking one re-hydrates the
 * changeset into state via LOAD_CHANGESET.
 *
 * Cap is small (5) so localStorage doesn't grow unbounded — large
 * diffs are bytes-expensive. Quota errors are swallowed; recents are
 * a nice-to-have, never load-bearing.
 */

import type { ChangeSet, Reply } from "./types";

const STORAGE_KEY = "shippable:recents:v1";
const MAX_RECENTS = 5;

export type RecentSource =
  | { kind: "url"; url: string }
  | { kind: "file"; filename: string }
  | { kind: "paste" }
  | { kind: "worktree"; path: string; branch: string | null }
  | { kind: "stub"; code: string }
  | { kind: "pr"; prUrl: string };

export interface RecentEntry {
  /** Same as changeset.id — used to dedupe and to match persisted cursor. */
  id: string;
  title: string;
  /** ms since epoch. */
  addedAt: number;
  source: RecentSource;
  changeset: ChangeSet;
  replies: Record<string, Reply[]>;
}

interface PersistedRecents {
  v: 1;
  entries: RecentEntry[];
}

export function loadRecents(): RecentEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isPersistedRecents(parsed)) return [];
  return parsed.entries.filter(isRecentEntry);
}

export function pushRecent(
  changeset: ChangeSet,
  replies: Record<string, Reply[]>,
  source: RecentSource,
): RecentEntry[] {
  const existing = loadRecents().filter((r) => r.id !== changeset.id);
  const entry: RecentEntry = {
    id: changeset.id,
    title: changeset.title,
    addedAt: Date.now(),
    source,
    changeset,
    replies,
  };
  const next = [entry, ...existing].slice(0, MAX_RECENTS);
  save(next);
  return next;
}

export function removeRecent(id: string): RecentEntry[] {
  const next = loadRecents().filter((r) => r.id !== id);
  save(next);
  return next;
}

function save(entries: RecentEntry[]): void {
  try {
    const payload: PersistedRecents = { v: 1, entries };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore — quota or private mode
  }
}

function isPersistedRecents(x: unknown): x is PersistedRecents {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.v === 1 && Array.isArray(o.entries);
}

function isRecentEntry(x: unknown): x is RecentEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.addedAt === "number" &&
    !!o.changeset &&
    typeof o.changeset === "object" &&
    !!o.source &&
    typeof o.source === "object"
  );
}
