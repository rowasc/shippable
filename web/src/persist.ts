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

import type {
  ChangeSet,
  Cursor,
  DetachedReply,
  Reply,
  ReviewState,
} from "./types";

const STORAGE_KEY = "shippable:review:v1";

/**
 * Per-worktree live-reload toggle. Keyed by absolute worktree path so
 * pausing on one tree doesn't pause others. Default-on for first encounter
 * (a missing key returns true). Stored in its own JSON object rather than
 * folded into the review snapshot — toggle state outlives any single review
 * and shouldn't get reset by `clearSession()`.
 */
const LIVE_RELOAD_TOGGLE_KEY = "shippable:liveReload:v1";

function readLiveReloadMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LIVE_RELOAD_TOGGLE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function getLiveReloadEnabled(worktreePath: string): boolean {
  const map = readLiveReloadMap();
  return map[worktreePath] ?? true;
}

export function setLiveReloadEnabled(
  worktreePath: string,
  enabled: boolean,
): void {
  try {
    const map = readLiveReloadMap();
    map[worktreePath] = enabled;
    localStorage.setItem(LIVE_RELOAD_TOGGLE_KEY, JSON.stringify(map));
  } catch {
    // ignore — toggle persistence is a nice-to-have
  }
}

/**
 * Head schema version. To bump it: add a `migrations[N]` entry below in
 * the same change. Old blobs in users' localStorage are migrated forward
 * on load; we never write old shapes back.
 */
const CURRENT_VERSION = 2;

/** What we actually serialize — Sets become arrays, ephemeral fields drop. */
interface PersistedSnapshot {
  v: 2;
  cursor: Cursor;
  /** Set<number> → number[] per hunk id. */
  readLines: Record<string, number[]>;
  reviewedFiles: string[];
  dismissedGuides: string[];
  ackedNotes: string[];
  replies: Record<string, Reply[]>;
  drafts: Record<string, string>;
  /**
   * Replies that detached during a reload pass. Carry their original
   * threadKey so the persisted shape stays interpretable. New in v2.
   */
  detachedReplies: DetachedReply[];
}

/**
 * Forward-only migration table. `migrations[N]` takes a snapshot at version
 * N-1 and returns one at version N. The loader walks from the stored
 * snapshot's `v` up to `CURRENT_VERSION`; a missing step (gap in the table
 * or unknown future version) is the fail-closed signal.
 *
 * Keys must be contiguous and end at `CURRENT_VERSION`. To bump to v: 2:
 *   2: (v1) => ({ ...(v1 as PersistedSnapshot), v: 2, /* new fields *\/ }),
 *
 * No backwards migrations — once written, `v: N` blobs only travel forward.
 */
const migrations: Record<number, (prev: unknown) => unknown> = {
  // v: 2 added the detachedReplies array and per-reply anchor fields. Old
  // replies have no anchor info; the reload pass falls back to in-place
  // hashing for them, so they degrade rather than break.
  2: (v1) => ({
    ...(v1 as PersistedSnapshot),
    v: 2,
    detachedReplies: [],
  }),
};

/**
 * Walk the migration table from the parsed blob's `v` up to CURRENT_VERSION.
 * Returns null if the blob isn't a versioned object, the version is unknown
 * (future, or a gap in the table), or any migration throws. Callers treat
 * null as "no useful snapshot" — the existing failure mode for malformed
 * data — so old clients seeing a future version skip rather than corrupt.
 */
function migrateToHead(parsed: unknown): unknown | null {
  if (!parsed || typeof parsed !== "object") return null;
  const v = (parsed as { v?: unknown }).v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return null;
  if (v > CURRENT_VERSION) return null;
  let cur: unknown = parsed;
  for (let target = v + 1; target <= CURRENT_VERSION; target++) {
    const step = migrations[target];
    if (!step) return null;
    try {
      cur = step(cur);
    } catch {
      return null;
    }
  }
  return cur;
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
    | "detachedReplies"
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
  // Externally-sourced replies (today: GitHub PR comments) are never persisted —
  // they re-arrive with the next pr/load. Persisting them would accumulate stale
  // upstream state and create rehydration ordering questions.
  const replies: Record<string, typeof state.replies[string]> = {};
  for (const [key, list] of Object.entries(state.replies)) {
    const filtered = list.filter((r) => !r.external);
    if (filtered.length > 0) replies[key] = filtered;
  }
  const detachedReplies = state.detachedReplies.filter(
    (d) => !d.reply.external,
  );
  return {
    v: 2,
    cursor: state.cursor,
    readLines,
    reviewedFiles: Array.from(state.reviewedFiles).sort(),
    dismissedGuides: Array.from(state.dismissedGuides).sort(),
    ackedNotes: Array.from(state.ackedNotes).sort(),
    replies,
    drafts,
    detachedReplies,
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
 * Raw snapshot read without changeset validation. Used at boot to decide
 * which changeset to hydrate (the snapshot's cursor.changesetId tells us
 * what to look up in stubs/recents), before we have a changesets array
 * to pass to loadSession. Returns null if the storage entry is missing
 * or malformed.
 */
export function peekSession(): PersistedSnapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const migrated = migrateToHead(parsed);
  return isPersistedSnapshot(migrated) ? migrated : null;
}

/**
 * Heuristic for "the user actually did something." Just visiting the app
 * triggers a debounced save of the seeded state (cursor on line 0, one
 * read line), so existence-of-snapshot alone isn't a useful signal — we
 * need to look at what's *in* it.
 */
export function hasProgress(s: PersistedSnapshot): boolean {
  if (s.reviewedFiles.length > 0) return true;
  if (s.ackedNotes.length > 0) return true;
  for (const arr of Object.values(s.readLines)) {
    if (arr.length > 1) return true;
  }
  for (const v of Object.values(s.drafts)) {
    if (v && v.trim()) return true;
  }
  // Replies: any reply whose author isn't a seeded teammate. Hard to
  // detect precisely from this layer, but presence of replies on a
  // userCommentKey-prefixed key is a strong "user did this" signal.
  for (const key of Object.keys(s.replies)) {
    if (key.startsWith("user:") || key.startsWith("block:")) return true;
  }
  return false;
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
  const snapshot = migrateToHead(parsed);
  if (!isPersistedSnapshot(snapshot)) return empty;

  // Validate the cursor against current changesets — fixtures change
  // between runs (or the user loaded an entirely different set).
  const cursor = validateCursor(snapshot.cursor, changesets);

  // Rehydrate Sets and Maps. Drop entries whose hunk/file ids don't
  // exist in the current changesets — stale data from older fixtures
  // shouldn't poison the current session. (We don't drop them on save —
  // user might switch back to the older changeset later.)
  const validHunkIds = collectHunkIds(changesets);
  const validFileIds = collectFileIds(changesets);

  const readLines: Record<string, Set<number>> = {};
  for (const [hunkId, arr] of Object.entries(snapshot.readLines)) {
    if (!validHunkIds.has(hunkId)) continue;
    readLines[hunkId] = new Set(arr.filter((n) => Number.isFinite(n)));
  }

  // When changesets is empty (welcome boot), there's no fallback cursor to
  // resolve — return null state so the caller knows nothing to overlay.
  if (!cursor && changesets.length === 0) return empty;

  return {
    state: {
      cursor: cursor ?? defaultCursor(changesets),
      readLines,
      reviewedFiles: new Set(snapshot.reviewedFiles.filter((id) => validFileIds.has(id))),
      dismissedGuides: new Set(snapshot.dismissedGuides),
      ackedNotes: new Set(snapshot.ackedNotes),
      replies: filterRepliesByHunk(snapshot.replies, validHunkIds),
      // Detached entries don't reference live hunk ids — they survive even
      // when the originating hunk is gone, by definition. Keep them all.
      detachedReplies: snapshot.detachedReplies,
    },
    drafts: filterDraftsByHunk(snapshot.drafts, validHunkIds),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function isPersistedSnapshot(x: unknown): x is PersistedSnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 2 &&
    typeof o.cursor === "object" &&
    typeof o.readLines === "object" &&
    Array.isArray(o.reviewedFiles) &&
    Array.isArray(o.dismissedGuides) &&
    Array.isArray(o.ackedNotes) &&
    typeof o.replies === "object" &&
    typeof o.drafts === "object" &&
    Array.isArray(o.detachedReplies)
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
      // Same forward-fill for `agentReplies` — added by the agent-reply
      // feature; legacy snapshots default to `[]`.
      out[key] = list.map((r) => {
        const next: Reply =
          r.enqueuedCommentId === undefined
            ? { ...r, enqueuedCommentId: null }
            : r;
        return next.agentReplies === undefined
          ? { ...next, agentReplies: [] }
          : next;
      });
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
