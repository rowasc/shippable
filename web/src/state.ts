import type { Cursor, ChangeSet, LineSelection, Reply, ReviewState } from "./types";
import { noteKey } from "./types";

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
  | { type: "SET_EXPAND_LEVEL"; hunkId: string; dir: "above" | "below"; level: number }
  | { type: "TOGGLE_EXPAND_FILE"; fileId: string }
  | { type: "TOGGLE_PREVIEW_FILE"; fileId: string }
  | { type: "TOGGLE_FILE_REVIEWED"; fileId: string };

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
