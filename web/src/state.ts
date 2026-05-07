import type {
  AgentReply,
  CharRange,
  Cursor,
  ChangeSet,
  DetachedReply,
  DiffFile,
  Hunk,
  LineSelection,
  Reply,
  ReviewState,
} from "./types";
import {
  blockCommentKey,
  hunkSummaryReplyKey,
  lineNoteReplyKey,
  noteKey,
  teammateReplyKey,
  userCommentKey,
} from "./types";
import { findAnchorInFile, hashAnchorWindow } from "./anchor";

/**
 * Wire shape of a polled agent reply: same as `AgentReply` plus the
 * `commentId` link that keys it back to the reviewer Reply whose
 * `enqueuedCommentId` matches.
 */
export type PolledAgentReply = AgentReply & { commentId: string };

/**
 * Sentinel cursor used while no changeset is loaded (welcome screen).
 * Reading any field on it before LOAD_CHANGESET is a bug — render code
 * must check `state.changesets.length === 0` first.
 */
export const EMPTY_CURSOR: Cursor = {
  changesetId: "",
  fileId: "",
  hunkId: "",
  lineIdx: 0,
};

export function initialState(
  seed: ChangeSet[],
  seedReplies: Record<string, Reply[]> = {},
): ReviewState {
  if (seed.length === 0) {
    return {
      cursor: EMPTY_CURSOR,
      changesets: [],
      readLines: {},
      reviewedFiles: new Set(),
      dismissedGuides: new Set(),
      ackedNotes: new Set(),
      replies: { ...seedReplies },
      expandLevelAbove: {},
      expandLevelBelow: {},
      fullExpandedFiles: new Set(),
      previewedFiles: new Set(),
      selection: null,
      detachedReplies: [],
    };
  }
  const cs = seed[0];
  const file = cs.files[0];
  const hunk = file.hunks[0];
  return {
    cursor: { changesetId: cs.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 },
    changesets: seed,
    readLines: addLine({}, hunk.id, 0),
    reviewedFiles: new Set(),
    dismissedGuides: new Set(),
    ackedNotes: new Set(),
    replies: { ...seedReplies },
    expandLevelAbove: {},
    expandLevelBelow: {},
    fullExpandedFiles: new Set(),
    previewedFiles: new Set(),
    selection: null,
    detachedReplies: [],
  };
}

function addLine(
  existing: Record<string, Set<number>>,
  hunkId: string,
  lineIdx: number,
): Record<string, Set<number>> {
  const set = new Set(existing[hunkId] ?? []);
  set.add(lineIdx);
  return { ...existing, [hunkId]: set };
}

export type Action =
  | {
      type: "MOVE_LINE";
      delta: number;
      extend?: boolean;
      /**
       * When true, a same-hunk move preserves the existing selection
       * instead of collapsing it. Used while a block-comment draft is
       * open so the reviewer can scroll back through the range they're
       * commenting on without losing the visual cue.
       */
      preserveSelection?: boolean;
    }
  | { type: "MOVE_HUNK"; delta: number }
  | { type: "MOVE_FILE"; delta: number }
  | { type: "SET_CURSOR"; cursor: Cursor; selection?: LineSelection | null }
  | { type: "COLLAPSE_SELECTION" }
  | { type: "SWITCH_CHANGESET"; changesetId: string }
  | { type: "LOAD_CHANGESET"; changeset: ChangeSet; replies?: Record<string, Reply[]> }
  | {
      // Reload a changeset that's already in state with a fresh snapshot,
      // preserving comments via the content-anchor pass. The new ChangeSet
      // typically carries a different id (sha changed); `prevChangesetId`
      // tells the reducer which entry to replace.
      type: "RELOAD_CHANGESET";
      prevChangesetId: string;
      changeset: ChangeSet;
    }
  | { type: "DISMISS_GUIDE"; guideId: string }
  | { type: "TOGGLE_ACK"; hunkId: string; lineIdx: number }
  | { type: "ADD_REPLY"; targetKey: string; reply: Reply }
  | { type: "DELETE_REPLY"; targetKey: string; replyId: string }
  | {
      // Patch the server-assigned enqueue id onto a previously-added Reply.
      // Fired by the App after the parallel /api/agent/enqueue POST resolves.
      // No-op if the targetKey or replyId is gone (the user deleted the
      // reply before the network round-trip finished).
      type: "PATCH_REPLY_ENQUEUED_ID";
      targetKey: string;
      replyId: string;
      enqueuedCommentId: string | null;
    }
  | {
      // Mark a Reply's enqueue attempt as errored / cleared. Drives the ⚠
      // errored pip in ReplyThread; the parent toggles it on the catch path
      // of `enqueueComment` and clears it before retrying. Coexists with
      // `enqueuedCommentId === null` — once an id lands the delivered pip
      // wins regardless of any stale error flag.
      type: "SET_REPLY_ENQUEUE_ERROR";
      targetKey: string;
      replyId: string;
      error: boolean;
    }
  | {
      // Merge a polled batch of agent replies into the reviewer Replies they
      // answer, keyed by commentId ↔ enqueuedCommentId. Idempotent: existing
      // ids update in place, new ids append, sorted by postedAt ascending.
      type: "MERGE_AGENT_REPLIES";
      polled: PolledAgentReply[];
    }
  | { type: "SET_EXPAND_LEVEL"; hunkId: string; dir: "above" | "below"; level: number }
  | { type: "TOGGLE_EXPAND_FILE"; fileId: string }
  | { type: "TOGGLE_PREVIEW_FILE"; fileId: string }
  | { type: "TOGGLE_FILE_REVIEWED"; fileId: string }
  | {
      // Set the line-range selection directly without moving the cursor.
      // Used by the DiffView drag pipeline once per pointermove tick. Drops
      // any prior charRange when anchor !== head; ignored if hunkId differs
      // from the cursor's current hunk.
      type: "SET_SELECTION_RANGE";
      hunkId: string;
      anchor: number;
      head: number;
      charRange?: CharRange;
    }
  | {
      // Set a single-line char-range selection from native text-selection
      // mouseup. No-op when fromCol >= toCol.
      type: "SET_LINE_CHAR_RANGE";
      hunkId: string;
      lineIdx: number;
      fromCol: number;
      toCol: number;
    }
  | {
      // Mark every lineIdx in [loLineIdx, hiLineIdx] as read for `hunkId`.
      // Leaves cursor + selection untouched. Driven by the right-click
      // "Mark as read" menu item.
      type: "MARK_LINES_READ";
      hunkId: string;
      loLineIdx: number;
      hiLineIdx: number;
    }
  | {
      type: "MARK_LINES_UNREAD";
      hunkId: string;
      loLineIdx: number;
      hiLineIdx: number;
    };

export function reducer(state: ReviewState, action: Action): ReviewState {
  // Welcome mode (no changesets) — only LOAD_CHANGESET is meaningful.
  // Everything else assumes a current changeset/file/hunk and would
  // crash on the sentinel cursor. The UI also blocks these dispatches,
  // so this is a defensive belt to the suspenders above.
  if (state.changesets.length === 0 && action.type !== "LOAD_CHANGESET") {
    return state;
  }
  switch (action.type) {
    case "MOVE_LINE":
      return moveLine(
        state,
        action.delta,
        action.extend ?? false,
        action.preserveSelection ?? false,
      );
    case "COLLAPSE_SELECTION":
      return state.selection === null ? state : { ...state, selection: null };
    case "MOVE_HUNK":
      return moveHunk(state, action.delta);
    case "MOVE_FILE":
      return moveFile(state, action.delta);
    case "SET_CURSOR": {
      const applied = applyCursor(state, action.cursor, false);
      if (action.selection === undefined) return applied;
      return { ...applied, selection: action.selection };
    }
    case "SWITCH_CHANGESET": {
      const cs = state.changesets.find((c) => c.id === action.changesetId);
      if (!cs) return state;
      const file = cs.files[0];
      const hunk = file.hunks[0];
      const cursor = {
        changesetId: cs.id,
        fileId: file.id,
        hunkId: hunk.id,
        lineIdx: 0,
      };
      return {
        ...state,
        cursor,
        selection: null,
        readLines: addLine(state.readLines, hunk.id, 0),
      };
    }
    case "LOAD_CHANGESET": {
      const cs = action.changeset;
      const file = cs.files[0];
      const hunk = file?.hunks[0];
      if (!file || !hunk) return state;
      const existingIdx = state.changesets.findIndex((c) => c.id === cs.id);
      const nextList =
        existingIdx >= 0
          ? state.changesets.map((c, i) => (i === existingIdx ? cs : c))
          : [...state.changesets, cs];
      return {
        ...state,
        changesets: nextList,
        cursor: {
          changesetId: cs.id,
          fileId: file.id,
          hunkId: hunk.id,
          lineIdx: 0,
        },
        selection: null,
        readLines: addLine(state.readLines, hunk.id, 0),
        // Seed replies merge in alongside whatever the user has already
        // authored — never overwrite. Useful for stubs that ship with
        // canned threads, and for recents that round-trip the same map.
        replies: action.replies
          ? { ...action.replies, ...state.replies }
          : state.replies,
      };
    }
    case "RELOAD_CHANGESET":
      return reloadChangeset(state, action.prevChangesetId, action.changeset);
    case "DISMISS_GUIDE": {
      const next = new Set(state.dismissedGuides);
      next.add(action.guideId);
      return { ...state, dismissedGuides: next };
    }
    case "TOGGLE_ACK": {
      const key = noteKey(action.hunkId, action.lineIdx);
      const next = new Set(state.ackedNotes);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...state, ackedNotes: next };
    }
    case "ADD_REPLY": {
      const existing = state.replies[action.targetKey] ?? [];
      return {
        ...state,
        replies: {
          ...state.replies,
          [action.targetKey]: [...existing, action.reply],
        },
      };
    }
    case "DELETE_REPLY": {
      const existing = state.replies[action.targetKey];
      if (!existing) return state;
      const filtered = existing.filter((r) => r.id !== action.replyId);
      if (filtered.length === existing.length) return state;
      const next = { ...state.replies };
      // Drop the key entirely when the last reply on a thread is removed
      // — keeps the persisted snapshot tidy and lets the inspector's
      // "no comments yet" empty state appear naturally.
      if (filtered.length === 0) delete next[action.targetKey];
      else next[action.targetKey] = filtered;
      return { ...state, replies: next };
    }
    case "PATCH_REPLY_ENQUEUED_ID": {
      const existing = state.replies[action.targetKey];
      if (!existing) return state;
      const idx = existing.findIndex((r) => r.id === action.replyId);
      if (idx < 0) return state;
      const patched = existing.map((r, i) =>
        i === idx ? { ...r, enqueuedCommentId: action.enqueuedCommentId } : r,
      );
      return {
        ...state,
        replies: { ...state.replies, [action.targetKey]: patched },
      };
    }
    case "SET_REPLY_ENQUEUE_ERROR": {
      const existing = state.replies[action.targetKey];
      if (!existing) return state;
      const idx = existing.findIndex((r) => r.id === action.replyId);
      if (idx < 0) return state;
      const current = !!existing[idx].enqueueError;
      if (current === action.error) return state;
      const patched = existing.map((r, i) =>
        i === idx ? { ...r, enqueueError: action.error } : r,
      );
      return {
        ...state,
        replies: { ...state.replies, [action.targetKey]: patched },
      };
    }
    case "MERGE_AGENT_REPLIES":
      return mergeAgentReplies(state, action.polled);
    case "SET_EXPAND_LEVEL": {
      const field = action.dir === "above" ? "expandLevelAbove" : "expandLevelBelow";
      return {
        ...state,
        [field]: { ...state[field], [action.hunkId]: Math.max(0, action.level) },
      };
    }
    case "TOGGLE_EXPAND_FILE": {
      const next = togglein(state.fullExpandedFiles, action.fileId);
      const turningOn = next.has(action.fileId);
      return {
        ...state,
        fullExpandedFiles: next,
        previewedFiles: turningOn ? removeFrom(state.previewedFiles, action.fileId) : state.previewedFiles,
      };
    }
    case "TOGGLE_PREVIEW_FILE": {
      const next = togglein(state.previewedFiles, action.fileId);
      const turningOn = next.has(action.fileId);
      return {
        ...state,
        previewedFiles: next,
        fullExpandedFiles: turningOn ? removeFrom(state.fullExpandedFiles, action.fileId) : state.fullExpandedFiles,
      };
    }
    case "TOGGLE_FILE_REVIEWED":
      return { ...state, reviewedFiles: togglein(state.reviewedFiles, action.fileId) };
    case "SET_SELECTION_RANGE": {
      // Drag is per-hunk; ignore moves that drift to a different hunk.
      if (action.hunkId !== state.cursor.hunkId) return state;
      const charRange = action.anchor === action.head ? action.charRange : undefined;
      const next: LineSelection = charRange
        ? { hunkId: action.hunkId, anchor: action.anchor, head: action.head, charRange }
        : { hunkId: action.hunkId, anchor: action.anchor, head: action.head };
      return { ...state, selection: next };
    }
    case "SET_LINE_CHAR_RANGE": {
      if (action.fromCol >= action.toCol) return state;
      if (action.hunkId !== state.cursor.hunkId) return state;
      return {
        ...state,
        selection: {
          hunkId: action.hunkId,
          anchor: action.lineIdx,
          head: action.lineIdx,
          charRange: {
            lineIdx: action.lineIdx,
            fromCol: action.fromCol,
            toCol: action.toCol,
          },
        },
      };
    }
    case "MARK_LINES_READ": {
      const lo = Math.min(action.loLineIdx, action.hiLineIdx);
      const hi = Math.max(action.loLineIdx, action.hiLineIdx);
      const set = new Set(state.readLines[action.hunkId] ?? []);
      const before = set.size;
      for (let i = lo; i <= hi; i++) set.add(i);
      if (set.size === before) return state;
      return { ...state, readLines: { ...state.readLines, [action.hunkId]: set } };
    }
    case "MARK_LINES_UNREAD": {
      const existing = state.readLines[action.hunkId];
      if (!existing || existing.size === 0) return state;
      const lo = Math.min(action.loLineIdx, action.hiLineIdx);
      const hi = Math.max(action.loLineIdx, action.hiLineIdx);
      const set = new Set(existing);
      let changed = false;
      for (let i = lo; i <= hi; i++) {
        if (set.delete(i)) changed = true;
      }
      if (!changed) return state;
      const next = { ...state.readLines };
      if (set.size === 0) delete next[action.hunkId];
      else next[action.hunkId] = set;
      return { ...state, readLines: next };
    }
  }
}

/**
 * Replace the changeset with id `prevId` with `cs`, then re-route every
 * reply targeting the old changeset's hunks via the content-anchor pass:
 *   strict match → keep inline at the same logical position (with new id)
 *   re-anchor    → rewrite the key to point at where the content ended up
 *   no match     → push to detachedReplies
 *
 * Replies on other changesets are untouched. The cursor is best-effort:
 * same file if it still exists in the new diff, else file 0.
 */
function reloadChangeset(
  state: ReviewState,
  prevId: string,
  cs: ChangeSet,
): ReviewState {
  const oldIdx = state.changesets.findIndex((c) => c.id === prevId);
  if (oldIdx < 0) return state;
  const oldCs = state.changesets[oldIdx];
  const firstFile = cs.files[0];
  const firstHunk = firstFile?.hunks[0];
  if (!firstFile || !firstHunk) return state;

  const nextChangesets = state.changesets.map((c, i) =>
    i === oldIdx ? cs : c,
  );

  // Pre-index old hunks so we can pull anchorPath / hunkIdx out of any reply
  // key whose hunkId belongs to this changeset.
  const oldHunkInfo = new Map<
    string,
    { file: DiffFile; fileIdx: number; hunkIdx: number; hunk: Hunk }
  >();
  for (let fi = 0; fi < oldCs.files.length; fi++) {
    const f = oldCs.files[fi];
    for (let hi = 0; hi < f.hunks.length; hi++) {
      const h = f.hunks[hi];
      oldHunkInfo.set(h.id, { file: f, fileIdx: fi, hunkIdx: hi, hunk: h });
    }
  }

  // New file lookup by path, and a parallel hunk-id-by-path-and-index map so
  // we can re-emit reply keys against the new hunk ids.
  const newFileByPath = new Map<string, DiffFile>();
  for (const f of cs.files) newFileByPath.set(f.path, f);

  const nextReplies: Record<string, Reply[]> = {};
  const nextDetached: DetachedReply[] = [...state.detachedReplies];

  for (const [key, list] of Object.entries(state.replies)) {
    const parsed = parseReplyKey(key);
    if (!parsed) {
      // Not a key we understand — leave it untouched.
      nextReplies[key] = list;
      continue;
    }
    const oldRef = oldHunkInfo.get(parsed.hunkId);
    if (!oldRef) {
      // This reply belongs to a different changeset; pass through.
      nextReplies[key] = list;
      continue;
    }

    // For block keys we anchor on the lo line; the original span size is
    // preserved when we know the new lineIdx.
    const anchorLineIdx =
      parsed.kind === "block" ? parsed.lo : parsed.lineIdx;
    const oldLineCount = oldRef.hunk.lines.length;
    const safeOldIdx = Math.max(0, Math.min(oldLineCount - 1, anchorLineIdx));

    // Each reply may carry its own anchorHash. Replies authored before slice
    // (c) won't have one — fall back to hashing the old hunk in place so we
    // still get a best-effort match.
    const fallbackPath = oldRef.file.path;
    const fallbackHash = hashAnchorWindow(oldRef.hunk.lines, safeOldIdx);

    // We resolve the *thread's* destination from the first reply that has a
    // hash; if every reply lacks one we use the in-place fallback. This
    // keeps a thread together rather than scattering replies one-by-one.
    const threadHash =
      list.find((r) => r.anchorHash)?.anchorHash ?? fallbackHash;
    const threadPath =
      list.find((r) => r.anchorPath)?.anchorPath ?? fallbackPath;

    const targetFile = newFileByPath.get(threadPath);
    const match = targetFile
      ? findAnchorInFile(targetFile.hunks, threadHash, {
          hunkIdx: oldRef.hunkIdx,
          lineIdx: safeOldIdx,
        })
      : null;

    if (targetFile && match) {
      const matchedHunk = targetFile.hunks[match.hunkIdx];
      const newKey = rekey(parsed, matchedHunk.id, match.lineIdx, matchedHunk.lines.length);
      const merged = nextReplies[newKey] ?? [];
      nextReplies[newKey] = [...merged, ...list];
      continue;
    }

    for (const r of list) {
      nextDetached.push({ reply: r, threadKey: key });
    }
  }

  // Cursor: same file if it still exists in the new cs, else file 0.
  const wasOnReloadedCs = state.cursor.changesetId === prevId;
  let nextCursor: Cursor;
  if (wasOnReloadedCs) {
    const oldCursorFile = oldCs.files.find((f) => f.id === state.cursor.fileId);
    const cursorFile =
      (oldCursorFile && cs.files.find((f) => f.path === oldCursorFile.path)) ??
      firstFile;
    const cursorHunk = cursorFile.hunks[0];
    nextCursor = {
      changesetId: cs.id,
      fileId: cursorFile.id,
      hunkId: cursorHunk.id,
      lineIdx: 0,
    };
  } else {
    nextCursor = state.cursor;
  }

  return {
    ...state,
    changesets: nextChangesets,
    cursor: nextCursor,
    selection: null,
    readLines: addLine(state.readLines, nextCursor.hunkId, nextCursor.lineIdx),
    replies: nextReplies,
    detachedReplies: nextDetached,
  };
}

type ParsedReplyKey =
  | { kind: "note"; hunkId: string; lineIdx: number }
  | { kind: "user"; hunkId: string; lineIdx: number }
  | { kind: "block"; hunkId: string; lo: number; hi: number; lineIdx: number }
  | { kind: "hunkSummary"; hunkId: string; lineIdx: 0 }
  | { kind: "teammate"; hunkId: string; lineIdx: 0 };

/**
 * Reply keys embed a hunkId that can itself contain `:` and `/` (see
 * types.ts). Split off the prefix first; for hunk-line keys, the line
 * (or lo-hi range) is the trailing component after the LAST colon.
 */
function parseReplyKey(key: string): ParsedReplyKey | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const prefix = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  switch (prefix) {
    case "note":
    case "user": {
      const last = rest.lastIndexOf(":");
      if (last < 0) return null;
      const hunkId = rest.slice(0, last);
      const lineIdx = parseInt(rest.slice(last + 1), 10);
      if (!Number.isFinite(lineIdx)) return null;
      return prefix === "note"
        ? { kind: "note", hunkId, lineIdx }
        : { kind: "user", hunkId, lineIdx };
    }
    case "block": {
      const last = rest.lastIndexOf(":");
      if (last < 0) return null;
      const hunkId = rest.slice(0, last);
      const range = rest.slice(last + 1);
      const dash = range.indexOf("-");
      if (dash < 0) return null;
      const lo = parseInt(range.slice(0, dash), 10);
      const hi = parseInt(range.slice(dash + 1), 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return { kind: "block", hunkId, lo, hi, lineIdx: lo };
    }
    case "hunkSummary":
      return { kind: "hunkSummary", hunkId: rest, lineIdx: 0 };
    case "teammate":
      return { kind: "teammate", hunkId: rest, lineIdx: 0 };
    default:
      return null;
  }
}

/** Re-emit a reply key against `newHunkId` at `newLineIdx`. Block ranges
 *  preserve their original size, clamped to the new hunk's line count. */
function rekey(
  parsed: ParsedReplyKey,
  newHunkId: string,
  newLineIdx: number,
  newHunkLineCount: number,
): string {
  switch (parsed.kind) {
    case "note":
      return lineNoteReplyKey(newHunkId, newLineIdx);
    case "user":
      return userCommentKey(newHunkId, newLineIdx);
    case "block": {
      const span = parsed.hi - parsed.lo;
      const newHi = Math.min(newHunkLineCount - 1, newLineIdx + span);
      return blockCommentKey(newHunkId, newLineIdx, newHi);
    }
    case "hunkSummary":
      return hunkSummaryReplyKey(newHunkId);
    case "teammate":
      return teammateReplyKey(newHunkId);
  }
}

function togglein(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function removeFrom(set: Set<string>, key: string): Set<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}

function moveLine(
  state: ReviewState,
  delta: number,
  extend: boolean,
  preserveSelection: boolean,
): ReviewState {
  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunkIdx = file.hunks.findIndex((h) => h.id === state.cursor.hunkId);
  const hunk = file.hunks[hunkIdx];
  const nextLineIdx = state.cursor.lineIdx + delta;

  if (nextLineIdx < 0) {
    if (hunkIdx === 0)
      return applyCursor(state, state.cursor, extend, preserveSelection);
    const prev = file.hunks[hunkIdx - 1];
    // Crossing a hunk boundary always collapses selection — the range no
    // longer applies once the cursor is in a different hunk.
    return applyCursor(
      state,
      { ...state.cursor, hunkId: prev.id, lineIdx: prev.lines.length - 1 },
      false,
      false,
    );
  }
  if (nextLineIdx >= hunk.lines.length) {
    if (hunkIdx === file.hunks.length - 1)
      return applyCursor(state, state.cursor, extend, preserveSelection);
    const next = file.hunks[hunkIdx + 1];
    return applyCursor(
      state,
      { ...state.cursor, hunkId: next.id, lineIdx: 0 },
      false,
      false,
    );
  }
  return applyCursor(
    state,
    { ...state.cursor, lineIdx: nextLineIdx },
    extend,
    preserveSelection,
  );
}

function moveHunk(state: ReviewState, delta: number): ReviewState {
  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunkIdx = file.hunks.findIndex((h) => h.id === state.cursor.hunkId);
  const next = Math.max(0, Math.min(file.hunks.length - 1, hunkIdx + delta));
  if (next === hunkIdx) return state;
  return applyCursor(
    state,
    { ...state.cursor, hunkId: file.hunks[next].id, lineIdx: 0 },
    false,
  );
}

function moveFile(state: ReviewState, delta: number): ReviewState {
  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const fileIdx = cs.files.findIndex((f) => f.id === state.cursor.fileId);
  const next = Math.max(0, Math.min(cs.files.length - 1, fileIdx + delta));
  if (next === fileIdx) return state;
  const nextFile = cs.files[next];
  return applyCursor(
    state,
    {
      ...state.cursor,
      fileId: nextFile.id,
      hunkId: nextFile.hunks[0].id,
      lineIdx: 0,
    },
    false,
  );
}

/**
 * Apply a new cursor. Always extends the read track. Selection lifetime:
 *   - extend (Shift+arrow): grows the head within the same hunk
 *   - preserveSelection: keeps the existing selection unchanged within
 *     the same hunk; used while drafting a block comment
 *   - otherwise: collapses
 *   - crossing a hunk boundary: always collapses
 */
function applyCursor(
  state: ReviewState,
  cursor: Cursor,
  extend: boolean,
  preserveSelection: boolean = false,
): ReviewState {
  const sameHunk = cursor.hunkId === state.cursor.hunkId;
  let selection = state.selection;
  if (extend && sameHunk) {
    const anchor =
      selection && selection.hunkId === cursor.hunkId
        ? selection.anchor
        : state.cursor.lineIdx;
    selection = { hunkId: cursor.hunkId, anchor, head: cursor.lineIdx };
  } else if (preserveSelection && sameHunk && selection) {
    // keep selection unchanged
  } else {
    selection = null;
  }
  return {
    ...state,
    cursor,
    selection,
    readLines: addLine(state.readLines, cursor.hunkId, cursor.lineIdx),
  };
}

function mergeAgentReplies(
  state: ReviewState,
  polled: PolledAgentReply[],
): ReviewState {
  if (polled.length === 0) return state;

  // Group polled entries by commentId.
  const byCommentId = new Map<string, AgentReply[]>();
  for (const p of polled) {
    const { commentId, ...rest } = p;
    let bucket = byCommentId.get(commentId);
    if (!bucket) {
      bucket = [];
      byCommentId.set(commentId, bucket);
    }
    bucket.push(rest);
  }

  let touched = false;
  const nextReplies: Record<string, Reply[]> = {};
  for (const [key, list] of Object.entries(state.replies)) {
    let listChanged = false;
    const nextList = list.map((reply) => {
      const cid = reply.enqueuedCommentId;
      if (cid == null) return reply;
      const incoming = byCommentId.get(cid);
      if (!incoming) return reply;
      const reconciled = reconcileAgentReplies(
        reply.agentReplies ?? [],
        incoming,
      );
      if (reconciled === reply.agentReplies) return reply;
      listChanged = true;
      return { ...reply, agentReplies: reconciled };
    });
    nextReplies[key] = listChanged ? nextList : list;
    if (listChanged) touched = true;
  }
  if (!touched) return state;
  return { ...state, replies: nextReplies };
}

function reconcileAgentReplies(
  existing: AgentReply[],
  incoming: AgentReply[],
): AgentReply[] {
  if (existing.length === 0 && incoming.length === 0) return existing;
  const byId = new Map<string, AgentReply>();
  for (const e of existing) byId.set(e.id, e);
  let changed = false;
  for (const inc of incoming) {
    const prev = byId.get(inc.id);
    if (!prev) {
      byId.set(inc.id, inc);
      changed = true;
      continue;
    }
    if (!shallowEqualAgentReply(prev, inc)) {
      byId.set(inc.id, inc);
      changed = true;
    }
  }
  if (!changed) return existing;
  const merged = Array.from(byId.values()).sort((a, b) =>
    a.postedAt.localeCompare(b.postedAt),
  );
  return merged;
}

function shallowEqualAgentReply(a: AgentReply, b: AgentReply): boolean {
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.outcome === b.outcome &&
    a.postedAt === b.postedAt &&
    a.agentLabel === b.agentLabel
  );
}

export function hunkCoverage(
  hunk: { id: string; lines: unknown[] },
  lines: Record<string, Set<number>>,
): number {
  const total = hunk.lines.length;
  const seen = lines[hunk.id]?.size ?? 0;
  return total === 0 ? 0 : seen / total;
}

export function fileCoverage(
  file: { hunks: { id: string; lines: unknown[] }[] },
  lines: Record<string, Set<number>>,
): number {
  let total = 0;
  let seen = 0;
  for (const h of file.hunks) {
    total += h.lines.length;
    seen += lines[h.id]?.size ?? 0;
  }
  return total === 0 ? 0 : seen / total;
}

export function changesetCoverage(
  cs: ChangeSet,
  lines: Record<string, Set<number>>,
): number {
  let total = 0;
  let seen = 0;
  for (const f of cs.files) {
    for (const h of f.hunks) {
      total += h.lines.length;
      seen += lines[h.id]?.size ?? 0;
    }
  }
  return total === 0 ? 0 : seen / total;
}

/** Returns the count of reviewed files within the given changeset. */
export function reviewedFilesCount(
  cs: ChangeSet,
  reviewedFiles: Set<string>,
): number {
  let n = 0;
  for (const f of cs.files) if (reviewedFiles.has(f.id)) n++;
  return n;
}
