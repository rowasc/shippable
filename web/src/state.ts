import type { Cursor, PullRequest, Reply, ReviewState } from "./types";
import { noteKey } from "./types";
import { SEED_REPLIES } from "./fixtures";

export function initialState(prs: PullRequest[]): ReviewState {
  const pr = prs[0];
  const file = pr.files[0];
  const hunk = file.hunks[0];
  return {
    cursor: { prId: pr.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 },
    reviewedLines: markLine({}, hunk.id, 0),
    dismissedGuides: new Set(),
    activeSkills: new Set(),
    ackedNotes: new Set(),
    replies: { ...SEED_REPLIES },
    expandLevelAbove: {},
    expandLevelBelow: {},
    fullExpandedFiles: new Set(),
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
  | { type: "MOVE_LINE"; delta: number }
  | { type: "MOVE_HUNK"; delta: number }
  | { type: "MOVE_FILE"; delta: number }
  | { type: "SET_CURSOR"; cursor: Cursor }
  | { type: "SWITCH_PR"; prId: string }
  | { type: "TOGGLE_SKILL"; skillId: string }
  | { type: "DISMISS_GUIDE"; guideId: string }
  | { type: "TOGGLE_ACK"; hunkId: string; lineIdx: number }
  | { type: "ADD_REPLY"; targetKey: string; reply: Reply }
  | { type: "SET_EXPAND_LEVEL"; hunkId: string; dir: "above" | "below"; level: number }
  | { type: "TOGGLE_EXPAND_FILE"; fileId: string };

export function reducer(prs: PullRequest[]) {
  return function (state: ReviewState, action: Action): ReviewState {
    switch (action.type) {
      case "MOVE_LINE":
        return moveLine(state, prs, action.delta);
      case "MOVE_HUNK":
        return moveHunk(state, prs, action.delta);
      case "MOVE_FILE":
        return moveFile(state, prs, action.delta);
      case "SET_CURSOR":
        return applyCursor(state, action.cursor);
      case "SWITCH_PR": {
        const pr = prs.find((p) => p.id === action.prId);
        if (!pr) return state;
        const file = pr.files[0];
        const hunk = file.hunks[0];
        const cursor = { prId: pr.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 };
        return {
          ...state,
          cursor,
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
  };
}

function togglein(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function moveLine(state: ReviewState, prs: PullRequest[], delta: number): ReviewState {
  const pr = prs.find((p) => p.id === state.cursor.prId)!;
  const file = pr.files.find((f) => f.id === state.cursor.fileId)!;
  const hunkIdx = file.hunks.findIndex((h) => h.id === state.cursor.hunkId);
  const hunk = file.hunks[hunkIdx];
  const nextLineIdx = state.cursor.lineIdx + delta;

  if (nextLineIdx < 0) {
    if (hunkIdx === 0) return applyCursor(state, state.cursor);
    const prev = file.hunks[hunkIdx - 1];
    return applyCursor(state, {
      ...state.cursor,
      hunkId: prev.id,
      lineIdx: prev.lines.length - 1,
    });
  }
  if (nextLineIdx >= hunk.lines.length) {
    if (hunkIdx === file.hunks.length - 1) return applyCursor(state, state.cursor);
    const next = file.hunks[hunkIdx + 1];
    return applyCursor(state, { ...state.cursor, hunkId: next.id, lineIdx: 0 });
  }
  return applyCursor(state, { ...state.cursor, lineIdx: nextLineIdx });
}

function moveHunk(state: ReviewState, prs: PullRequest[], delta: number): ReviewState {
  const pr = prs.find((p) => p.id === state.cursor.prId)!;
  const file = pr.files.find((f) => f.id === state.cursor.fileId)!;
  const hunkIdx = file.hunks.findIndex((h) => h.id === state.cursor.hunkId);
  const next = Math.max(0, Math.min(file.hunks.length - 1, hunkIdx + delta));
  if (next === hunkIdx) return state;
  return applyCursor(state, {
    ...state.cursor,
    hunkId: file.hunks[next].id,
    lineIdx: 0,
  });
}

function moveFile(state: ReviewState, prs: PullRequest[], delta: number): ReviewState {
  const pr = prs.find((p) => p.id === state.cursor.prId)!;
  const fileIdx = pr.files.findIndex((f) => f.id === state.cursor.fileId);
  const next = Math.max(0, Math.min(pr.files.length - 1, fileIdx + delta));
  if (next === fileIdx) return state;
  const nextFile = pr.files[next];
  return applyCursor(state, {
    ...state.cursor,
    fileId: nextFile.id,
    hunkId: nextFile.hunks[0].id,
    lineIdx: 0,
  });
}

function applyCursor(state: ReviewState, cursor: Cursor): ReviewState {
  return {
    ...state,
    cursor,
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

export function prCoverage(
  pr: PullRequest,
  reviewed: Record<string, Set<number>>,
): number {
  let total = 0;
  let seen = 0;
  for (const f of pr.files) {
    for (const h of f.hunks) {
      total += h.lines.length;
      seen += reviewed[h.id]?.size ?? 0;
    }
  }
  return total === 0 ? 0 : seen / total;
}
