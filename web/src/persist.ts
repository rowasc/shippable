/**
 * persist.ts — single-key, schema-versioned localStorage persistence
 * for the review session. Hydrates on boot, debounced-saves on change.
 *
 * Why a single key (`shippable:review:v1`) and not a key-per-changeset:
 * the data already namespaces by hunkId / fileId (those embed the cs id),
 * so a single blob loads everything the user has touched. Cheap to clear
 * and trivial to inspect with devtools.
 *
 * Why not Zustand / React Query / etc: this is throwaway prototype glue.
 * If/when the tool moves to a real backend, this whole module becomes
 * a sync queue and the shape stays roughly the same.
 */

import type { ChangeSet, Cursor, Reply, ReviewState } from "./types";

const STORAGE_KEY = "shippable:review:v1";

/** What we actually serialize — Sets become arrays, ephemeral fields drop. */
interface PersistedSnapshot {
  v: 1;
  cursor: Cursor;
  /** Set<number> → number[] per hunk id. */
  readLines: Record<string, number[]>;
  reviewedFiles: string[];
  dismissedGuides: string[];
  ackedNotes: string[];
  replies: Record<string, Reply[]>;
  drafts: Record<string, string>;
}

/** What hydration returns after validation. Both fields default to "no
 *  change from blank slate" when the snapshot is missing or invalid. */
export interface HydratedSession {
  /** Partial state to overlay onto initialState, or null if no useful data. */
  state: Pick<
    ReviewState,
    | "cursor"
    | "readLines"
    | "reviewedFiles"
    | "dismissedGuides"
    | "ackedNotes"
    | "replies"
  > | null;
  drafts: Record<string, string>;
}

/**
 * Build the JSON-safe snapshot. Caller decides when to write — typically
 * a debounced effect on state/drafts change.
 */
export function buildSnapshot(
  state: ReviewState,
  drafts: Record<string, string>,
): PersistedSnapshot {
  const readLines: Record<string, number[]> = {};
  for (const [hunkId, set] of Object.entries(state.readLines)) {
    if (set.size === 0) continue;
    readLines[hunkId] = Array.from(set).sort((a, b) => a - b);
  }
  return {
    v: 1,
    cursor: state.cursor,
    readLines,
    reviewedFiles: Array.from(state.reviewedFiles).sort(),
    dismissedGuides: Array.from(state.dismissedGuides).sort(),
    ackedNotes: Array.from(state.ackedNotes).sort(),
    replies: state.replies,
    drafts,
  };
}

/** Best-effort save. Swallows storage errors (private mode, quota) silently. */
export function saveSession(
  state: ReviewState,
  drafts: Record<string, string>,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot(state, drafts)));
  } catch {
    // ignore — persistence is a nice-to-have, not load-bearing
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Read + validate the persisted snapshot. Returns hydrated state shaped
 * to overlay onto initialState. Cursor is validated against the loaded
 * changesets — if the persisted file/hunk no longer exists, we fall back
 * to the default cursor (caller passes null).
 */
export function loadSession(changesets: ChangeSet[]): HydratedSession {
  const empty: HydratedSession = { state: null, drafts: {} };
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!isPersistedSnapshot(parsed)) return empty;

  // Validate the cursor against current changesets — fixtures change
  // between runs (or the user loaded an entirely different set).
  const cursor = validateCursor(parsed.cursor, changesets);

  // Rehydrate Sets and Maps. Drop entries whose hunk/file ids don't
  // exist in the current changesets — stale data from older fixtures
  // shouldn't poison the current session. (We don't drop them on save —
  // user might switch back to the older changeset later.)
  const validHunkIds = collectHunkIds(changesets);
  const validFileIds = collectFileIds(changesets);

  const readLines: Record<string, Set<number>> = {};
  for (const [hunkId, arr] of Object.entries(parsed.readLines)) {
    if (!validHunkIds.has(hunkId)) continue;
    readLines[hunkId] = new Set(arr.filter((n) => Number.isFinite(n)));
  }

  return {
    state: {
      cursor: cursor ?? defaultCursor(changesets),
      readLines,
      reviewedFiles: new Set(parsed.reviewedFiles.filter((id) => validFileIds.has(id))),
      dismissedGuides: new Set(parsed.dismissedGuides),
      ackedNotes: new Set(parsed.ackedNotes),
      replies: filterRepliesByHunk(parsed.replies, validHunkIds),
    },
    drafts: filterDraftsByHunk(parsed.drafts, validHunkIds),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function isPersistedSnapshot(x: unknown): x is PersistedSnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.cursor === "object" &&
    typeof o.readLines === "object" &&
    Array.isArray(o.reviewedFiles) &&
    Array.isArray(o.dismissedGuides) &&
    Array.isArray(o.ackedNotes) &&
    typeof o.replies === "object" &&
    typeof o.drafts === "object"
  );
}

function validateCursor(
  cursor: Cursor,
  changesets: ChangeSet[],
): Cursor | null {
  const cs = changesets.find((c) => c.id === cursor.changesetId);
  if (!cs) return null;
  const file = cs.files.find((f) => f.id === cursor.fileId);
  if (!file) return null;
  const hunk = file.hunks.find((h) => h.id === cursor.hunkId);
  if (!hunk) return null;
  if (cursor.lineIdx < 0 || cursor.lineIdx >= hunk.lines.length) return null;
  return cursor;
}

function defaultCursor(changesets: ChangeSet[]): Cursor {
  const cs = changesets[0];
  const file = cs.files[0];
  const hunk = file.hunks[0];
  return {
    changesetId: cs.id,
    fileId: file.id,
    hunkId: hunk.id,
    lineIdx: 0,
  };
}

function collectHunkIds(changesets: ChangeSet[]): Set<string> {
  const out = new Set<string>();
  for (const cs of changesets) {
    for (const f of cs.files) {
      for (const h of f.hunks) out.add(h.id);
    }
  }
  return out;
}

function collectFileIds(changesets: ChangeSet[]): Set<string> {
  const out = new Set<string>();
  for (const cs of changesets) {
    for (const f of cs.files) out.add(f.id);
  }
  return out;
}

/** Reply keys embed a hunkId — drop ones whose hunk no longer exists. */
function filterRepliesByHunk(
  replies: Record<string, Reply[]>,
  validHunkIds: Set<string>,
): Record<string, Reply[]> {
  const out: Record<string, Reply[]> = {};
  for (const [key, list] of Object.entries(replies)) {
    if (!list || list.length === 0) continue;
    if (replyKeyTargetsValidHunk(key, validHunkIds)) {
      // Normalize legacy/pre-queue replies missing the enqueuedCommentId
      // field — slice 2 added it; older snapshots rehydrate to `null`.
      out[key] = list.map((r) =>
        r.enqueuedCommentId === undefined
          ? { ...r, enqueuedCommentId: null }
          : r,
      );
    }
  }
  return out;
}

function filterDraftsByHunk(
  drafts: Record<string, string>,
  validHunkIds: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, body] of Object.entries(drafts)) {
    if (!body) continue;
    if (replyKeyTargetsValidHunk(key, validHunkIds)) out[key] = body;
  }
  return out;
}

/**
 * Reply-key shapes (see types.ts):
 *   note:hunkId:lineIdx · user:hunkId:lineIdx · block:hunkId:lo-hi
 *   hunkSummary:hunkId  · teammate:hunkId
 * The hunkId can contain `/` and `#`, so we split on the first colon to
 * get the prefix and treat the remainder accordingly.
 */
function replyKeyTargetsValidHunk(
  key: string,
  validHunkIds: Set<string>,
): boolean {
  const colon = key.indexOf(":");
  if (colon < 0) return false;
  const prefix = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  switch (prefix) {
    case "hunkSummary":
    case "teammate":
      return validHunkIds.has(rest);
    case "note":
    case "user": {
      const last = rest.lastIndexOf(":");
      if (last < 0) return false;
      return validHunkIds.has(rest.slice(0, last));
    }
    case "block": {
      const last = rest.lastIndexOf(":");
      if (last < 0) return false;
      return validHunkIds.has(rest.slice(0, last));
    }
    default:
      return false;
  }
}
