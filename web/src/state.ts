import type {
  AgentComment,
  CharRange,
  Cursor,
  ChangeSet,
  DetachedInteraction,
  DiffFile,
  DiffLine,
  Hunk,
  Interaction,
  InteractionIntent,
  InteractionTarget,
  LineSelection,
  ParsedReplyKey,
  ReviewState,
} from "./types";
import {
  blockCommentKey,
  hunkSummaryReplyKey,
  isAskIntent,
  isValidInteractionPair,
  lineNoteReplyKey,
  parseReplyKey,
  teammateReplyKey,
  userCommentKey,
} from "./types";
import { findAnchorInFile, hashAnchorWindow } from "./anchor";

// Legacy reply-shape inputs preserved for the persist/test adapters below.
// The exported types of the same name lived in types.ts before the unified
// Interaction store; we keep these internal shapes so callers can construct
// loose Reply/AgentReply-like literals when feeding the adapters.
export interface ReplyShape {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  enqueuedCommentId?: string | null;
  enqueueError?: boolean;
  agentReplies?: AgentReplyShape[];
  originSha?: string;
  originType?: "committed" | "dirty";
  anchorPath?: string;
  anchorContext?: DiffLine[];
  anchorHash?: string;
  anchorLineNo?: number;
  external?: { source: "pr"; htmlUrl: string };
}
export interface AgentReplyShape {
  id: string;
  body: string;
  outcome: "addressed" | "declined" | "noted";
  postedAt: string;
  agentLabel?: string;
}
export interface DetachedReplyShape {
  reply: ReplyShape;
  threadKey: string;
}

/**
 * Wire shape returned by `/api/agent/replies` — an Interaction-shaped
 * payload with a `parentId` field that points at the delivered
 * Interaction id the agent is responding to. The reducer resolves
 * parentId → threadKey via state.interactions[*].enqueuedCommentId
 * and merges the entry into the matching thread with authorRole=agent.
 */
export interface PolledAgentReply {
  id: string;
  parentId: string;
  body: string;
  intent: "ack" | "accept" | "reject";
  author: string;
  authorRole: "agent";
  target: InteractionTarget;
  postedAt: string;
}

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
  seedInteractions: Record<string, Interaction[]> = {},
): ReviewState {
  if (seed.length === 0) {
    return {
      cursor: EMPTY_CURSOR,
      changesets: [],
      readLines: {},
      reviewedFiles: new Set(),
      dismissedGuides: new Set(),
      interactions: { ...seedInteractions },
      expandLevelAbove: {},
      expandLevelBelow: {},
      fullExpandedFiles: new Set(),
      previewedFiles: new Set(),
      selection: null,
      detachedInteractions: [],
      agentComments: [],
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
    interactions: { ...seedInteractions },
    expandLevelAbove: {},
    expandLevelBelow: {},
    fullExpandedFiles: new Set(),
    previewedFiles: new Set(),
    selection: null,
    detachedInteractions: [],
    agentComments: [],
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
  | { type: "MOVE_TO_COMMENT"; delta: number }
  | { type: "SET_CURSOR"; cursor: Cursor; selection?: LineSelection | null }
  | { type: "COLLAPSE_SELECTION" }
  | { type: "SWITCH_CHANGESET"; changesetId: string }
  | {
      type: "LOAD_CHANGESET";
      changeset: ChangeSet;
      interactions?: Record<string, Interaction[]>;
    }
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
  | {
      // Toggle the local user's ack on the AI note at (hunkId, lineIdx).
      // Appends an Interaction { intent: "ack" } or { intent: "unack" }
      // depending on the user's most recent response on that thread. The
      // append-only log preserves history; the seam derives current state.
      type: "TOGGLE_ACK";
      hunkId: string;
      lineIdx: number;
      /** Local-user display name. Defaults to "you" if omitted. */
      author?: string;
    }
  | { type: "ADD_INTERACTION"; targetKey: string; interaction: Interaction }
  | { type: "DELETE_INTERACTION"; targetKey: string; interactionId: string }
  | {
      // Patch the server-assigned enqueue id onto a previously-added
      // Interaction. Fired after the parallel /api/agent/enqueue POST
      // resolves. No-op if the targetKey or id is gone.
      type: "PATCH_INTERACTION_ENQUEUED_ID";
      targetKey: string;
      interactionId: string;
      enqueuedCommentId: string | null;
    }
  | {
      // Mark an Interaction's enqueue attempt as errored / cleared. Drives
      // the ⚠ errored pip in ReplyThread; toggled by the catch path of
      // `enqueueComment` and cleared before retry. Coexists with
      // `enqueuedCommentId === null` — once an id lands the delivered pip
      // wins regardless of any stale error flag.
      type: "SET_INTERACTION_ENQUEUE_ERROR";
      targetKey: string;
      interactionId: string;
      error: boolean;
    }
  | {
      // Merge a polled batch of agent responses into state.interactions,
      // resolving each entry against the user Interaction whose
      // enqueuedCommentId matches. Idempotent: existing ids update in
      // place, new ids append on the same thread, sorted by createdAt.
      type: "MERGE_AGENT_REPLIES";
      polled: PolledAgentReply[];
    }
  | {
      // Replace `state.agentComments` with the polled batch. See
      // `mergeAgentComments` for semantics — note this is replace-not-merge,
      // unlike the additive MERGE_AGENT_REPLIES above.
      type: "MERGE_AGENT_COMMENTS";
      polled: AgentComment[];
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
    }
  | {
      /**
       * Overlay PR metadata onto an existing worktree-loaded ChangeSet. The
       * diff structure (files/hunks) is untouched; only `prSource` and
       * `prConversation` are set. `worktreeSource` is preserved. PR review
       * comments arrive separately via MERGE_PR_REPLIES.
       */
      type: "MERGE_PR_OVERLAY";
      changesetId: string;
      prSource: import("./types").PrSource;
      prConversation: import("./types").PrConversationItem[];
    }
  | {
      /**
       * Install PR-sourced interactions and detached entries. Idempotent
       * across refresh: every existing entry tagged
       * `external.source === "pr"` is removed before the new entries are
       * merged in, so re-fetching the same PR doesn't accumulate
       * duplicates.
       */
      type: "MERGE_PR_INTERACTIONS";
      changesetId: string;
      prInteractions: Record<string, Interaction[]>;
      prDetached: DetachedInteraction[];
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
    case "MOVE_TO_COMMENT":
      return moveToComment(state, action.delta);
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

      // When reloading a changeset that the cursor is already on, preserve
      // the cursor position if the target file and hunk still exist in the
      // new diff. Falls back to line 0 of file 0 if the file or hunk has
      // disappeared (e.g., file removed in a PR update).
      let nextCursor: Cursor;
      if (existingIdx >= 0 && state.cursor.changesetId === cs.id) {
        const curFile = cs.files.find((f) => f.id === state.cursor.fileId);
        const curHunk = curFile?.hunks.find((h) => h.id === state.cursor.hunkId);
        if (curFile && curHunk) {
          const maxLine = curHunk.lines.length - 1;
          nextCursor = {
            changesetId: cs.id,
            fileId: curFile.id,
            hunkId: curHunk.id,
            lineIdx: Math.min(state.cursor.lineIdx, Math.max(0, maxLine)),
          };
        } else {
          nextCursor = { changesetId: cs.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 };
        }
      } else {
        nextCursor = { changesetId: cs.id, fileId: file.id, hunkId: hunk.id, lineIdx: 0 };
      }

      return {
        ...state,
        changesets: nextList,
        cursor: nextCursor,
        selection: null,
        readLines: addLine(state.readLines, nextCursor.hunkId, nextCursor.lineIdx),
        // Seed interactions merge in alongside whatever the user has
        // already authored — never overwrite. Useful for stubs and for
        // recents that round-trip the same map.
        interactions: action.interactions
          ? { ...action.interactions, ...state.interactions }
          : state.interactions,
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
      const threadKey = lineNoteReplyKey(action.hunkId, action.lineIdx);
      const author = action.author ?? "you";
      const existing = state.interactions[threadKey] ?? [];
      // Find the author's most recent response on the thread.
      let lastResponse: Interaction | undefined;
      for (let i = existing.length - 1; i >= 0; i--) {
        const ix = existing[i];
        if (ix.author !== author) continue;
        if (ix.intent === "ack" || ix.intent === "unack") {
          lastResponse = ix;
          break;
        }
      }
      const nextIntent: "ack" | "unack" =
        lastResponse?.intent === "ack" ? "unack" : "ack";
      const interaction: Interaction = {
        id: `${nextIntent}:${threadKey}:${Date.now()}`,
        threadKey,
        target: "reply-to-ai-note",
        intent: nextIntent,
        author,
        authorRole: "user",
        body: "",
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        interactions: {
          ...state.interactions,
          [threadKey]: [...existing, interaction],
        },
      };
    }
    case "ADD_INTERACTION": {
      if (!isValidInteractionPair(action.interaction.target, action.interaction.intent)) {
        return state;
      }
      const existing = state.interactions[action.targetKey] ?? [];
      return {
        ...state,
        interactions: {
          ...state.interactions,
          [action.targetKey]: [...existing, action.interaction],
        },
      };
    }
    case "DELETE_INTERACTION": {
      const existing = state.interactions[action.targetKey];
      if (!existing) return state;
      const filtered = existing.filter((ix) => ix.id !== action.interactionId);
      if (filtered.length === existing.length) return state;
      const next = { ...state.interactions };
      // Drop the key entirely when the last interaction is removed —
      // keeps the persisted snapshot tidy and lets the inspector's
      // "no comments yet" empty state appear naturally.
      if (filtered.length === 0) delete next[action.targetKey];
      else next[action.targetKey] = filtered;
      return { ...state, interactions: next };
    }
    case "PATCH_INTERACTION_ENQUEUED_ID": {
      const existing = state.interactions[action.targetKey];
      if (!existing) return state;
      const idx = existing.findIndex((ix) => ix.id === action.interactionId);
      if (idx < 0) return state;
      const patched = existing.map((ix, i) =>
        i === idx ? { ...ix, enqueuedCommentId: action.enqueuedCommentId } : ix,
      );
      return {
        ...state,
        interactions: { ...state.interactions, [action.targetKey]: patched },
      };
    }
    case "SET_INTERACTION_ENQUEUE_ERROR": {
      const existing = state.interactions[action.targetKey];
      if (!existing) return state;
      const idx = existing.findIndex((ix) => ix.id === action.interactionId);
      if (idx < 0) return state;
      const current = !!existing[idx].enqueueError;
      if (current === action.error) return state;
      const patched = existing.map((ix, i) =>
        i === idx ? { ...ix, enqueueError: action.error } : ix,
      );
      return {
        ...state,
        interactions: { ...state.interactions, [action.targetKey]: patched },
      };
    }
    case "MERGE_AGENT_REPLIES":
      return mergeAgentInteractions(state, action.polled);
    case "MERGE_AGENT_COMMENTS":
      return mergeAgentComments(state, action.polled);
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
    case "MERGE_PR_OVERLAY": {
      const csIdx = state.changesets.findIndex((c) => c.id === action.changesetId);
      if (csIdx < 0) return state;
      const cs = state.changesets[csIdx];
      const nextCs: ChangeSet = {
        ...cs,
        prSource: action.prSource,
        prConversation: action.prConversation,
      };
      const nextChangesets = state.changesets.map((c, i) =>
        i === csIdx ? nextCs : c,
      );
      return { ...state, changesets: nextChangesets };
    }
    case "MERGE_PR_INTERACTIONS": {
      // Strip prior PR-sourced entries first so refresh doesn't duplicate.
      // Other interactions (user, AI, teammate, agent) are preserved
      // untouched.
      const cleaned: Record<string, Interaction[]> = {};
      for (const [key, list] of Object.entries(state.interactions)) {
        const filtered = list.filter((ix) => ix.external?.source !== "pr");
        if (filtered.length > 0) cleaned[key] = filtered;
      }
      const cleanedDetached = state.detachedInteractions.filter(
        (d) => d.interaction.external?.source !== "pr",
      );

      // Merge in the new PR-sourced entries.
      const next: Record<string, Interaction[]> = { ...cleaned };
      for (const [key, list] of Object.entries(action.prInteractions)) {
        if (list.length === 0) continue;
        next[key] = next[key] ? [...next[key], ...list] : [...list];
      }
      const nextDetached = [...cleanedDetached, ...action.prDetached];

      return {
        ...state,
        interactions: next,
        detachedInteractions: nextDetached,
      };
    }
  }
}

/**
 * Replace the changeset with id `prevId` with `cs`, then re-route every
 * interaction targeting the old changeset's hunks via the content-anchor
 * pass:
 *   strict match → keep inline at the same logical position (with new id)
 *   re-anchor    → rewrite the key to point at where the content ended up
 *   no match     → push to detachedInteractions
 *
 * Interactions on other changesets are untouched. The cursor is best-effort:
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
  // we can re-emit thread keys against the new hunk ids.
  const newFileByPath = new Map<string, DiffFile>();
  for (const f of cs.files) newFileByPath.set(f.path, f);

  const nextInteractions: Record<string, Interaction[]> = {};
  const nextDetached: DetachedInteraction[] = [...state.detachedInteractions];

  for (const [key, list] of Object.entries(state.interactions)) {
    const parsed = parseReplyKey(key);
    if (!parsed) {
      // Not a key we understand — leave it untouched.
      nextInteractions[key] = list;
      continue;
    }
    // Agent-comment threads aren't hunk-anchored — their key carries the
    // server-minted AgentComment id directly. Pass them through unchanged;
    // the reload pass only re-emits hunk-anchored keys.
    if (parsed.kind === "agentComment") {
      nextInteractions[key] = list;
      continue;
    }
    const oldRef = oldHunkInfo.get(parsed.hunkId);
    if (!oldRef) {
      // This interaction belongs to a different changeset; pass through.
      nextInteractions[key] = list;
      continue;
    }

    // For block keys we anchor on the lo line; the original span size is
    // preserved when we know the new lineIdx.
    const anchorLineIdx =
      parsed.kind === "block" ? parsed.lo : parsed.lineIdx;
    const oldLineCount = oldRef.hunk.lines.length;
    const safeOldIdx = Math.max(0, Math.min(oldLineCount - 1, anchorLineIdx));

    // Each interaction may carry its own anchorHash. Entries authored before
    // anchoring shipped won't have one — fall back to hashing the old hunk
    // in place so we still get a best-effort match.
    const fallbackPath = oldRef.file.path;
    const fallbackHash = hashAnchorWindow(oldRef.hunk.lines, safeOldIdx);

    // Resolve the *thread's* destination from the first interaction that
    // has a hash; if every entry lacks one we use the in-place fallback.
    // Keeps a thread together rather than scattering entries one-by-one.
    const threadHash =
      list.find((ix) => ix.anchorHash)?.anchorHash ?? fallbackHash;
    const threadPath =
      list.find((ix) => ix.anchorPath)?.anchorPath ?? fallbackPath;

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
      const merged = nextInteractions[newKey] ?? [];
      nextInteractions[newKey] = [...merged, ...list];
      continue;
    }

    for (const ix of list) {
      nextDetached.push({ interaction: ix, threadKey: key });
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
    interactions: nextInteractions,
    detachedInteractions: nextDetached,
  };
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
    case "agentComment":
      // Agent-comment threads aren't hunk-anchored and never reach this
      // function — the reload loop above passes them through. Guard
      // defensively so a future caller can't silently drop the key.
      throw new Error(
        "rekey called for an agentComment thread; agent-comment threads aren't hunk-anchored",
      );
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

/** A line in the changeset that something is anchored to: an AI note, a
 *  user line comment, or the start of a user block comment. The badge
 *  click and the n / N navigation walk this list. */
export interface CommentStop {
  fileId: string;
  hunkId: string;
  lineIdx: number;
}

/**
 * Order: changeset file order → hunk order → line index. Reply-derived stops
 * come only from `user:` and `block:` keys; `parseReplyKey` handles the
 * colon-bearing hunk ids that PR csIds introduce.
 */
export function buildCommentStops(
  cs: ChangeSet,
  interactions: Record<string, Interaction[]>,
): CommentStop[] {
  const userIdxByHunk = new Map<string, Set<number>>();
  const addIdx = (hunkId: string, idx: number) => {
    let s = userIdxByHunk.get(hunkId);
    if (!s) userIdxByHunk.set(hunkId, (s = new Set()));
    s.add(idx);
  };
  for (const [key, list] of Object.entries(interactions)) {
    if (list.length === 0) continue;
    const parsed = parseReplyKey(key);
    if (!parsed) continue;
    if (parsed.kind === "user") {
      addIdx(parsed.hunkId, parsed.lineIdx);
    } else if (parsed.kind === "block") {
      addIdx(parsed.hunkId, parsed.lo);
    }
  }

  // AI note stops come from the interactions store too — every
  // `note:hunkId:lineIdx` thread is an AI annotation (or its replies). Same
  // key shape as user comments, just a different prefix.
  for (const key of Object.keys(interactions)) {
    if (!key.startsWith("note:")) continue;
    const tail = key.slice("note:".length);
    const cut = tail.lastIndexOf(":");
    if (cut < 0) continue;
    const idx = Number(tail.slice(cut + 1));
    if (Number.isNaN(idx)) continue;
    addIdx(tail.slice(0, cut), idx);
  }

  const stops: CommentStop[] = [];
  for (const f of cs.files) {
    for (const h of f.hunks) {
      const idxs = userIdxByHunk.get(h.id);
      if (!idxs) continue;
      [...idxs]
        .sort((a, b) => a - b)
        .forEach((idx) => stops.push({ fileId: f.id, hunkId: h.id, lineIdx: idx }));
    }
  }
  return stops;
}

function moveToComment(state: ReviewState, delta: number): ReviewState {
  const cs = state.changesets.find((c) => c.id === state.cursor.changesetId)!;
  const stops = buildCommentStops(cs, state.interactions);
  if (stops.length === 0) return state;

  const cur = state.cursor;
  const fileOrder = new Map(cs.files.map((f, i) => [f.id, i]));
  const hunkOrder = new Map<string, Map<string, number>>();
  for (const f of cs.files) {
    hunkOrder.set(f.id, new Map(f.hunks.map((h, i) => [h.id, i])));
  }
  const cmpToCursor = (s: CommentStop): number => {
    const fi = fileOrder.get(s.fileId)!;
    const fc = fileOrder.get(cur.fileId)!;
    if (fi !== fc) return fi - fc;
    const hi = hunkOrder.get(s.fileId)!.get(s.hunkId)!;
    const hc = hunkOrder.get(cur.fileId)!.get(cur.hunkId) ?? -1;
    if (hi !== hc) return hi - hc;
    return s.lineIdx - cur.lineIdx;
  };

  let target: CommentStop | undefined;
  if (delta > 0) {
    target = stops.find((s) => cmpToCursor(s) > 0);
  } else {
    for (let i = stops.length - 1; i >= 0; i--) {
      if (cmpToCursor(stops[i]) < 0) {
        target = stops[i];
        break;
      }
    }
  }
  if (!target) return state;

  return applyCursor(
    state,
    {
      changesetId: cur.changesetId,
      fileId: target.fileId,
      hunkId: target.hunkId,
      lineIdx: target.lineIdx,
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

/**
 * Translate polled agent responses into top-level Interactions with
 * `authorRole: "agent"`, keyed against the user Interaction whose
 * `enqueuedCommentId` matches `commentId`. Idempotent: existing agent
 * Interactions update in place; new ids append on the same thread.
 */
function mergeAgentInteractions(
  state: ReviewState,
  polled: PolledAgentReply[],
): ReviewState {
  if (polled.length === 0) return state;

  // Group polled entries by commentId.
  const byCommentId = new Map<string, PolledAgentReply[]>();
  for (const p of polled) {
    let bucket = byCommentId.get(p.parentId);
    if (!bucket) {
      bucket = [];
      byCommentId.set(p.parentId, bucket);
    }
    bucket.push(p);
  }

  // Find each commentId's thread by scanning all interactions for a user
  // entry whose enqueuedCommentId matches. Threads carrying no matching
  // entry are silently skipped (the user may have deleted the parent
  // before the poll round-tripped).
  const threadKeyByCommentId = new Map<string, string>();
  for (const [key, list] of Object.entries(state.interactions)) {
    for (const ix of list) {
      const cid = ix.enqueuedCommentId;
      if (cid != null && byCommentId.has(cid)) {
        threadKeyByCommentId.set(cid, key);
      }
    }
  }
  if (threadKeyByCommentId.size === 0) return state;

  // Walk each thread that's gaining/updating agent entries.
  let touched = false;
  const nextInteractions: Record<string, Interaction[]> = { ...state.interactions };
  for (const [commentId, incoming] of byCommentId) {
    const threadKey = threadKeyByCommentId.get(commentId);
    if (!threadKey) continue;
    const existing = nextInteractions[threadKey] ?? [];
    const incomingInteractions = incoming.map((p) =>
      polledToInteraction(p, threadKey),
    );
    const merged = reconcileAgentInteractions(existing, incomingInteractions);
    if (merged !== existing) {
      nextInteractions[threadKey] = merged;
      touched = true;
    }
  }
  if (!touched) return state;
  return { ...state, interactions: nextInteractions };
}

/** Map the legacy AgentReply.outcome surface onto the new response-intent
 *  vocabulary. Used by `agentReplyToInteraction` for the legacy persistence
 *  bridge; the wire-side translation lives in `polledToInteraction` and uses
 *  the new `intent` field directly. */
function agentOutcomeToIntent(
  outcome: "addressed" | "declined" | "noted",
): InteractionIntent {
  if (outcome === "addressed") return "accept";
  if (outcome === "declined") return "reject";
  return "ack";
}

function polledToInteraction(
  p: PolledAgentReply,
  threadKey: string,
): Interaction {
  return {
    id: p.id,
    threadKey,
    // Trust the server's resolved target when it matches a reply-to-* role;
    // fall back to the threadKey-derived target for safety.
    target: p.target.startsWith("reply-to-")
      ? p.target
      : replyTargetForKey(threadKey),
    intent: p.intent,
    author: p.author,
    authorRole: "agent",
    body: p.body,
    createdAt: p.postedAt,
  };
}

/**
 * Target for a *reply* on the given thread (i.e. an interaction added
 * after the thread head). For the thread head itself, use
 * `firstTargetForKey`.
 */
export function replyTargetForKey(threadKey: string): InteractionTarget {
  if (threadKey.startsWith("note:")) return "reply-to-ai-note";
  if (threadKey.startsWith("user:")) return "reply-to-user";
  if (threadKey.startsWith("block:")) return "reply-to-user";
  if (threadKey.startsWith("hunkSummary:")) return "reply-to-hunk-summary";
  if (threadKey.startsWith("teammate:")) return "reply-to-teammate";
  return "reply-to-user";
}

/**
 * Target for the *head* of a thread (the first user-authored
 * Interaction on a `user:`/`block:` key). For `note:`/`hunkSummary:`/
 * `teammate:` keys the head is supplied by ingest carriers, so any
 * user-stored entry is by definition a reply — those routes return
 * `replyTargetForKey` semantics.
 */
export function firstTargetForKey(threadKey: string): InteractionTarget {
  if (threadKey.startsWith("user:")) return "line";
  if (threadKey.startsWith("block:")) return "block";
  return replyTargetForKey(threadKey);
}

function reconcileAgentInteractions(
  existing: Interaction[],
  incoming: Interaction[],
): Interaction[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, Interaction>();
  for (const e of existing) byId.set(e.id, e);
  let changed = false;
  for (const inc of incoming) {
    const prev = byId.get(inc.id);
    if (!prev) {
      byId.set(inc.id, inc);
      changed = true;
      continue;
    }
    if (!shallowEqualAgentInteraction(prev, inc)) {
      byId.set(inc.id, inc);
      changed = true;
    }
  }
  if (!changed) return existing;
  // Preserve non-agent interactions in original order; sort agent entries
  // by createdAt to keep the polled batch deterministic.
  const agents = Array.from(byId.values())
    .filter((ix) => ix.authorRole === "agent")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const nonAgents = existing.filter((ix) => ix.authorRole !== "agent");
  return [...nonAgents, ...agents];
}

function shallowEqualAgentInteraction(a: Interaction, b: Interaction): boolean {
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.intent === b.intent &&
    a.createdAt === b.createdAt &&
    a.author === b.author
  );
}

/**
 * Replace the `state.agentComments` slot with the polled batch — the
 * server returns the worktree's full authoritative list (capped at 200)
 * on every poll, so additive merging would let evicted entries persist
 * stale and would leak across worktree switches (the hook resets its
 * polled state to `[]` on worktree change; the reducer must honour that).
 *
 * Reply-shaped (parent-set) entries are filtered out defensively; the
 * polling-split in `useDeliveredPolling.ts` should never dispatch them
 * here, but the guard means a future caller can't silently corrupt the
 * slot.
 *
 * Idempotent under structural equality: re-dispatching the same batch
 * returns the same state reference so React subscribers don't re-render
 * on idle polls.
 */
function mergeAgentComments(
  state: ReviewState,
  polled: AgentComment[],
): ReviewState {
  const incoming = polled
    .filter((c) => c.anchor !== undefined)
    .slice()
    .sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  if (sameAgentCommentsList(state.agentComments, incoming)) return state;
  return { ...state, agentComments: incoming };
}

/** Order-sensitive structural equality — both lists are sorted by `postedAt`. */
function sameAgentCommentsList(
  a: AgentComment[],
  b: AgentComment[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!shallowEqualAgentComment(a[i], b[i])) return false;
  }
  return true;
}

function shallowEqualAgentComment(a: AgentComment, b: AgentComment): boolean {
  if (
    a.id !== b.id ||
    a.body !== b.body ||
    a.postedAt !== b.postedAt ||
    a.agentLabel !== b.agentLabel
  ) {
    return false;
  }
  // Anchor-shaped comparison — reply-shaped entries don't reach this slot,
  // but mirror the same defensive check.
  if (a.anchor && b.anchor) {
    return a.anchor.file === b.anchor.file && a.anchor.lines === b.anchor.lines;
  }
  return a.anchor === undefined && b.anchor === undefined;
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

// ── Migration / consumer helpers ─────────────────────────────────────────
// These bridge the unified Interaction store to consumers that still think
// in legacy Reply / ackedNotes terms. Two roles:
//   - Read side: derive Set<string> / boolean ack views for components that
//     still take the legacy shape.
//   - Write side: translate persisted Reply[] / ackedNotes[] snapshots into
//     Interactions during load.

/**
 * True when the local user's latest response on the AI-note thread at
 * (hunkId, lineIdx) is `ack`. Replaces direct lookups of the deprecated
 * `state.ackedNotes` Set.
 */
export function isAckedByMe(
  state: ReviewState,
  hunkId: string,
  lineIdx: number,
  user: string = "you",
): boolean {
  const threadKey = lineNoteReplyKey(hunkId, lineIdx);
  const list = state.interactions[threadKey];
  if (!list) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    const ix = list[i];
    if (ix.author !== user) continue;
    if (ix.intent === "ack") return true;
    if (ix.intent === "unack") return false;
  }
  return false;
}

/**
 * Drop-in for the deprecated `state.ackedNotes` Set. Returns the set of
 * `${hunkId}:${lineIdx}` keys where the local user's latest response on
 * the AI-note thread is `ack`. Use this when handing off to view-model
 * builders that still take `acked: Set<string>`.
 */
export function selectAckedNotes(
  state: ReviewState,
  user: string = "you",
): Set<string> {
  const out = new Set<string>();
  for (const [threadKey, list] of Object.entries(state.interactions)) {
    if (!threadKey.startsWith("note:")) continue;
    let latest: "ack" | "unack" | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const ix = list[i];
      if (ix.author !== user) continue;
      if (ix.intent === "ack" || ix.intent === "unack") {
        latest = ix.intent;
        break;
      }
    }
    if (latest === "ack") out.add(threadKey.slice("note:".length));
  }
  return out;
}

/**
 * Translate a single persisted/legacy Reply into a user Interaction on
 * the given thread. `isFirst` decides whether the target is the thread
 * head (`line`/`block`) or a reply (`reply-to-user`).
 */
export function userReplyToInteraction(
  reply: ReplyShape,
  threadKey: string,
  isFirst: boolean,
): Interaction {
  return {
    id: reply.id,
    threadKey,
    target: isFirst ? firstTargetForKey(threadKey) : replyTargetForKey(threadKey),
    intent: "comment",
    author: reply.author,
    authorRole: "user",
    body: reply.body,
    createdAt: reply.createdAt,
    enqueuedCommentId: reply.enqueuedCommentId,
    enqueueError: reply.enqueueError,
    anchorPath: reply.anchorPath,
    anchorHash: reply.anchorHash,
    anchorContext: reply.anchorContext,
    anchorLineNo: reply.anchorLineNo,
    originSha: reply.originSha,
    originType: reply.originType,
    external: reply.external,
  };
}

/**
 * Translate a single persisted/legacy AgentReply into a top-level agent
 * Interaction on the same thread as its parent. (Agents are no longer
 * nested under a user reply — they live as top-level Interactions
 * sharing the parent's threadKey.)
 */
export function agentReplyToInteraction(
  a: AgentReplyShape,
  threadKey: string,
): Interaction {
  return {
    id: a.id,
    threadKey,
    target: replyTargetForKey(threadKey),
    intent: agentOutcomeToIntent(a.outcome),
    author: a.agentLabel ?? "agent",
    authorRole: "agent",
    body: a.body,
    createdAt: a.postedAt,
  };
}

/**
 * Concatenate Interaction maps, preserving per-thread arrays. `a` entries
 * come first; `b` entries append. Used at boot/load when ingest-derived
 * Interactions (AI / teammate) need to be merged with user-authored ones.
 */
export function mergeInteractionMaps(
  a: Record<string, Interaction[]>,
  b: Record<string, Interaction[]>,
): Record<string, Interaction[]> {
  const out: Record<string, Interaction[]> = { ...a };
  for (const [key, list] of Object.entries(b)) {
    if (list.length === 0) continue;
    out[key] = out[key] ? [...out[key], ...list] : [...list];
  }
  return out;
}

/**
 * Bulk-translate a `Record<string, Reply[]>` (legacy snapshot or test
 * fixture) into the unified Interaction store. Each Reply's nested
 * `agentReplies` are flattened to top-level agent Interactions on the
 * same thread, ordered by their `postedAt`.
 */
export function repliesToInteractions(
  replies: Record<string, ReplyShape[]>,
): Record<string, Interaction[]> {
  const out: Record<string, Interaction[]> = {};
  for (const [key, list] of Object.entries(replies)) {
    const ixs: Interaction[] = [];
    list.forEach((r, i) => {
      ixs.push(userReplyToInteraction(r, key, i === 0));
      for (const a of r.agentReplies ?? []) {
        ixs.push(agentReplyToInteraction(a, key));
      }
    });
    out[key] = ixs;
  }
  return out;
}

/**
 * Translate a legacy `ackedNotes` Set (`${hunkId}:${lineIdx}` keys) into
 * ack Interactions merged into the given map. Used during persist load
 * to fold the deprecated field into `state.interactions`. The ack entries
 * are attributed to `user` and stamped with the sentinel timestamp so
 * they sort before any real activity but after ingest carriers.
 */
export function ackedNotesToInteractions(
  acked: ReadonlySet<string>,
  existing: Record<string, Interaction[]>,
  user: string = "you",
): Record<string, Interaction[]> {
  if (acked.size === 0) return existing;
  const out: Record<string, Interaction[]> = { ...existing };
  for (const noteKey of acked) {
    const colon = noteKey.lastIndexOf(":");
    if (colon < 0) continue;
    const hunkId = noteKey.slice(0, colon);
    const lineIdx = Number(noteKey.slice(colon + 1));
    if (!Number.isFinite(lineIdx)) continue;
    const threadKey = lineNoteReplyKey(hunkId, lineIdx);
    const ack: Interaction = {
      id: `acked:${threadKey}:${user}`,
      threadKey,
      target: "reply-to-ai-note",
      intent: "ack",
      author: user,
      authorRole: "user",
      body: "",
      createdAt: PERSIST_ACK_TIMESTAMP,
    };
    out[threadKey] = out[threadKey] ? [...out[threadKey], ack] : [ack];
  }
  return out;
}

/**
 * Sentinel timestamp used for ack Interactions reconstituted from the
 * legacy `ackedNotes` Set. Slightly after the seam's INGEST_TIMESTAMP so
 * the ack sorts after the AI note it responds to, but before any real
 * user activity that has an actual timestamp.
 */
const PERSIST_ACK_TIMESTAMP = "0001-01-02T00:00:00.000Z";

/**
 * Translate a legacy `DetachedReply` array into the unified
 * `DetachedInteraction[]` shape.
 */
export function detachedRepliesToDetachedInteractions(
  detached: DetachedReplyShape[],
): DetachedInteraction[] {
  return detached.map(({ reply, threadKey }) => ({
    interaction: userReplyToInteraction(reply, threadKey, true),
    threadKey,
  }));
}

/**
 * Down-project the unified Interaction store back to the legacy
 * `Record<string, Reply[]>` shape. Used by persist.ts to keep the v2
 * snapshot format unchanged while in-memory state runs on Interactions.
 *
 * Drops AI/teammate Interactions — those re-arrive from ingest on
 * reload. Drops response intents (ack/unack/accept/reject) on user
 * authorship — acks travel via the legacy `ackedNotes` field. Agent
 * Interactions are nested back under the first user Reply in the thread
 * via `agentReplies` so they round-trip through localStorage.
 *
 * This is the same projection as `interactionsToRepliesForView`, just
 * filtered for what persist needs to round-trip. Kept as a separate
 * entry point so the persist intent stays explicit at call sites.
 */
export function interactionsToReplies(
  interactions: Record<string, Interaction[]>,
): Record<string, ReplyShape[]> {
  return interactionsToRepliesForView(interactions);
}

function interactionToReply(ix: Interaction): ReplyShape {
  return {
    id: ix.id,
    author: ix.author,
    body: ix.body,
    createdAt: ix.createdAt,
    enqueuedCommentId: ix.enqueuedCommentId,
    enqueueError: ix.enqueueError,
    anchorPath: ix.anchorPath,
    anchorHash: ix.anchorHash,
    anchorContext: ix.anchorContext,
    anchorLineNo: ix.anchorLineNo,
    originSha: ix.originSha,
    originType: ix.originType,
    external: ix.external,
  };
}

/**
 * Down-project detached Interactions back to the legacy `DetachedReply[]`
 * shape. Mirror of `detachedRepliesToDetachedInteractions`. Non-user
 * entries are dropped (same reasoning as `interactionsToReplies`).
 */
export function detachedInteractionsToDetachedReplies(
  detached: DetachedInteraction[],
): DetachedReplyShape[] {
  const out: DetachedReplyShape[] = [];
  for (const d of detached) {
    if (d.interaction.authorRole !== "user") continue;
    if (!isAskIntent(d.interaction.intent)) continue;
    out.push({ reply: interactionToReply(d.interaction), threadKey: d.threadKey });
  }
  return out;
}

/**
 * View-layer projection of `state.interactions` back to the legacy
 * `Record<string, Reply[]>` shape with agent Interactions re-nested as
 * `agentReplies` on the FIRST user Reply in each thread. Used by view-
 * model builders (Sidebar, DiffView, Inspector) that still consume the
 * legacy shape — they'll move to consume Interactions directly in a
 * later slice. Differs from `interactionsToReplies` (which drops agents,
 * because that one is used by persist where agents re-arrive from
 * polling).
 *
 * Nesting on the first user reply is a best-effort restoration of the
 * legacy "agent reply belongs to the user reply whose enqueuedCommentId
 * matched"; the linking commentId isn't preserved in storage, and
 * threads typically have a single user-initiated entry that all agent
 * responses come back against.
 */
export function interactionsToRepliesForView(
  interactions: Record<string, Interaction[]>,
): Record<string, ReplyShape[]> {
  const out: Record<string, ReplyShape[]> = {};
  for (const [key, list] of Object.entries(interactions)) {
    const replies: ReplyShape[] = [];
    const agentReplies: AgentReplyShape[] = [];
    for (const ix of list) {
      if (ix.authorRole === "user" && isAskIntent(ix.intent)) {
        replies.push(interactionToReply(ix));
      } else if (ix.authorRole === "agent") {
        agentReplies.push(interactionToAgentReply(ix));
      }
    }
    if (replies.length === 0 && agentReplies.length === 0) continue;
    if (replies.length > 0 && agentReplies.length > 0) {
      replies[0] = { ...replies[0], agentReplies };
    }
    out[key] = replies;
  }
  return out;
}

function interactionToAgentReply(ix: Interaction): AgentReplyShape {
  const reply: AgentReplyShape = {
    id: ix.id,
    body: ix.body,
    outcome: agentIntentToOutcome(ix.intent),
    postedAt: ix.createdAt,
  };
  // Only surface agentLabel when it was set explicitly. polledToInteraction
  // defaults missing labels to "agent" so a round-trip through the store
  // wouldn't otherwise distinguish "no label" from "label is literally agent".
  if (ix.author && ix.author !== "agent") reply.agentLabel = ix.author;
  return reply;
}

function agentIntentToOutcome(
  intent: InteractionIntent,
): "addressed" | "declined" | "noted" {
  if (intent === "accept") return "addressed";
  if (intent === "reject") return "declined";
  return "noted";
}
