import type { Cursor, ChangeSet, LineSelection, Reply, ReviewState } from "./types";
import { noteKey } from "./types";
import { SEED_REPLIES } from "./fixtures";

export function initialState(seed: ChangeSet[]): ReviewState {
  const cs = seed[0];
  const file = cs.files[0];
  const hunk = file.hunks[0];
  return {
    cursor: { changesetId: cs.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 },
    changesets: seed,
    reviewedLines: markLine({}, hunk.id, 0),
    dismissedGuides: new Set(),
    activeSkills: new Set(),
    ackedNotes: new Set(),
    replies: { ...SEED_REPLIES },
    expandLevelAbove: {},
    expandLevelBelow: {},
    fullExpandedFiles: new Set(),
    selection: null,
  };
}

function markLine(
  existing: Record<string, Set<number>>,
  hunkId: string,
  lineIdx: number,
): Record<string, Set<number>> {
  const set = new Set(existing[hunkId] ?? []);
  set.add(lineIdx);
  return { ...existing, [hunkId]: set };
}

export type Action =
  | { type: "MOVE_LINE"; delta: number; extend?: boolean }
  | { type: "MOVE_HUNK"; delta: number }
  | { type: "MOVE_FILE"; delta: number }
  | { type: "SET_CURSOR"; cursor: Cursor; selection?: LineSelection | null }
  | { type: "COLLAPSE_SELECTION" }
  | { type: "SWITCH_CHANGESET"; changesetId: string }
  | { type: "LOAD_CHANGESET"; changeset: ChangeSet }
  | { type: "TOGGLE_SKILL"; skillId: string }
  | { type: "DISMISS_GUIDE"; guideId: string }
  | { type: "TOGGLE_ACK"; hunkId: string; lineIdx: number }
  | { type: "ADD_REPLY"; targetKey: string; reply: Reply }
  | { type: "SET_EXPAND_LEVEL"; hunkId: string; dir: "above" | "below"; level: number }
  | { type: "TOGGLE_EXPAND_FILE"; fileId: string };

export function reducer(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case "MOVE_LINE":
      return moveLine(state, action.delta, action.extend ?? false);
    case "COLLAPSE_SELECTION":
      return state.selection === null ? state : { ...state, selection: null };
    case "MOVE_HUNK":
      return moveHunk(state, action.delta);
    case "MOVE_FILE":
      return moveFile(state, action.delta);
    case "SET_CURSOR": {
      // applyCursor always collapses; if the caller wants to restore a
      // selection (e.g. clicking a block comment should re-select its range),
      // overlay it after.
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
        reviewedLines: markLine(state.reviewedLines, hunk.id, 0),
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
        reviewedLines: markLine(state.reviewedLines, hunk.id, 0),
      };
    }
    case "TOGGLE_SKILL": {
      const next = new Set(state.activeSkills);
      if (next.has(action.skillId)) next.delete(action.skillId);
      else next.add(action.skillId);
      return { ...state, activeSkills: next };
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
    case "SET_EXPAND_LEVEL": {
      const field = action.dir === "above" ? "expandLevelAbove" : "expandLevelBelow";
      return {
        ...state,
        [field]: { ...state[field], [action.hunkId]: Math.max(0, action.level) },
      };
    }
    case "TOGGLE_EXPAND_FILE":
      return { ...state, fullExpandedFiles: togglein(state.fullExpandedFiles, action.fileId) };
  }
}

function togglein(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function moveLine(
  state: ReviewState,
  delta: number,
  extend: boolean,
): ReviewState {
  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const file = cs.files.find((f) => f.id === state.cursor.fileId)!;
  const hunkIdx = file.hunks.findIndex((h) => h.id === state.cursor.hunkId);
  const hunk = file.hunks[hunkIdx];
  const nextLineIdx = state.cursor.lineIdx + delta;

  if (nextLineIdx < 0) {
    if (hunkIdx === 0) return applyCursor(state, state.cursor, extend);
    // Crossing a hunk boundary while extending would leave an orphan
    // selection; we collapse instead and let the cursor move normally.
    const prev = file.hunks[hunkIdx - 1];
    return applyCursor(
      state,
      { ...state.cursor, hunkId: prev.id, lineIdx: prev.lines.length - 1 },
      false,
    );
  }
  if (nextLineIdx >= hunk.lines.length) {
    if (hunkIdx === file.hunks.length - 1)
      return applyCursor(state, state.cursor, extend);
    const next = file.hunks[hunkIdx + 1];
    return applyCursor(
      state,
      { ...state.cursor, hunkId: next.id, lineIdx: 0 },
      false,
    );
  }
  return applyCursor(state, { ...state.cursor, lineIdx: nextLineIdx }, extend);
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
 * Apply a new cursor. When `extend` is true and the new cursor stays within
 * the same hunk, the selection's head moves with it (anchor is set to the
 * previous cursor if no selection existed). Any other case collapses the
 * selection to null — crossing hunks while extending would produce an
 * orphaned selection, and plain moves should clear a stale selection.
 */
function applyCursor(
  state: ReviewState,
  cursor: Cursor,
  extend: boolean,
): ReviewState {
  const sameHunk = cursor.hunkId === state.cursor.hunkId;
  let selection = state.selection;
  if (extend && sameHunk) {
    const anchor =
      selection && selection.hunkId === cursor.hunkId
        ? selection.anchor
        : state.cursor.lineIdx;
    selection = { hunkId: cursor.hunkId, anchor, head: cursor.lineIdx };
  } else {
    selection = null;
  }
  return {
    ...state,
    cursor,
    selection,
    reviewedLines: markLine(state.reviewedLines, cursor.hunkId, cursor.lineIdx),
  };
}

export function hunkCoverage(
  hunk: { id: string; lines: unknown[] },
  reviewed: Record<string, Set<number>>,
): number {
  const total = hunk.lines.length;
  const seen = reviewed[hunk.id]?.size ?? 0;
  return total === 0 ? 0 : seen / total;
}

export function fileCoverage(
  file: { hunks: { id: string; lines: unknown[] }[] },
  reviewed: Record<string, Set<number>>,
): number {
  let total = 0;
  let seen = 0;
  for (const h of file.hunks) {
    total += h.lines.length;
    seen += reviewed[h.id]?.size ?? 0;
  }
  return total === 0 ? 0 : seen / total;
}

export function changesetCoverage(
  cs: ChangeSet,
  reviewed: Record<string, Set<number>>,
): number {
  let total = 0;
  let seen = 0;
  for (const f of cs.files) {
    for (const h of f.hunks) {
      total += h.lines.length;
      seen += reviewed[h.id]?.size ?? 0;
    }
  }
  return total === 0 ? 0 : seen / total;
}
