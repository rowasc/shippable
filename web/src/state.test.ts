import { beforeEach, describe, expect, it } from "vitest";
import {
  changesetCoverage,
  fileCoverage,
  hunkCoverage,
  initialState,
  reducer,
  reviewedFilesCount,
} from "./state";
import { captureAnchorContext } from "./anchor";
import type { ChangeSet, DiffFile, DiffLine, Hunk, ReviewState } from "./types";
import { noteKey } from "./types";

// ── Fixtures ───────────────────────────────────────────────────────────────
// Tiny hand-built ChangeSets keep these tests isolated from the gallery
// fixtures (which exist for design work, not behavior tests).

function makeLines(n: number, kind: DiffLine["kind"] = "context"): DiffLine[] {
  return Array.from({ length: n }, (_, i) => {
    if (kind === "context") return { kind, text: `l${i}`, oldNo: i + 1, newNo: i + 1 };
    if (kind === "add") return { kind, text: `l${i}`, newNo: i + 1 };
    return { kind, text: `l${i}`, oldNo: i + 1 };
  });
}

function makeHunk(id: string, lineCount: number): Hunk {
  return {
    id,
    header: `@@ -1,${lineCount} +1,${lineCount} @@`,
    oldStart: 1,
    oldCount: lineCount,
    newStart: 1,
    newCount: lineCount,
    lines: makeLines(lineCount),
  };
}

function makeFile(id: string, hunks: Hunk[]): DiffFile {
  return { id, path: `${id}.ts`, language: "ts", status: "modified", hunks };
}

function makeChangeset(id: string, files: DiffFile[]): ChangeSet {
  return {
    id,
    title: id,
    author: "tester",
    branch: "head",
    base: "base",
    createdAt: "2026-04-30T00:00:00.000Z",
    description: "",
    files,
  };
}

// Default fixture: one ChangeSet "cs1" with two files; file1 has two hunks of
// 3 lines each, file2 has one hunk of 2 lines. Lets us exercise within-hunk,
// cross-hunk, and cross-file movement without ceremony.
function defaultChangeset(): ChangeSet {
  return makeChangeset("cs1", [
    makeFile("cs1/f1", [makeHunk("cs1/f1#h1", 3), makeHunk("cs1/f1#h2", 3)]),
    makeFile("cs1/f2", [makeHunk("cs1/f2#h1", 2)]),
  ]);
}

let s0: ReviewState;
beforeEach(() => {
  s0 = initialState([defaultChangeset()]);
});

// ── initialState ───────────────────────────────────────────────────────────

describe("initialState", () => {
  it("places the cursor on the first changeset / file / hunk / line", () => {
    expect(s0.cursor).toEqual({
      changesetId: "cs1",
      fileId: "cs1/f1",
      hunkId: "cs1/f1#h1",
      lineIdx: 0,
    });
  });

  it("marks the first line as read in readLines", () => {
    expect(s0.readLines["cs1/f1#h1"]).toEqual(new Set([0]));
  });

  it("starts with empty review-tracking sets and zero expand levels", () => {
    expect(s0.reviewedFiles).toEqual(new Set());
    expect(s0.dismissedGuides).toEqual(new Set());
    expect(s0.ackedNotes).toEqual(new Set());
    expect(s0.fullExpandedFiles).toEqual(new Set());
    expect(s0.previewedFiles).toEqual(new Set());
    expect(s0.expandLevelAbove).toEqual({});
    expect(s0.expandLevelBelow).toEqual({});
    expect(s0.selection).toBeNull();
  });

  it("retains the seed changesets in order", () => {
    const a = makeChangeset("a", [makeFile("a/f", [makeHunk("a/f#h1", 1)])]);
    const b = makeChangeset("b", [makeFile("b/f", [makeHunk("b/f#h1", 1)])]);
    const s = initialState([a, b]);
    expect(s.changesets.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

// ── MOVE_LINE ──────────────────────────────────────────────────────────────

describe("MOVE_LINE", () => {
  it("steps within a hunk and marks the new line as read", () => {
    const s = reducer(s0, { type: "MOVE_LINE", delta: 1 });
    expect(s.cursor.lineIdx).toBe(1);
    expect(s.readLines["cs1/f1#h1"]).toEqual(new Set([0, 1]));
  });

  it("clamps backward movement at the first line of the first hunk", () => {
    const s = reducer(s0, { type: "MOVE_LINE", delta: -1 });
    expect(s.cursor.lineIdx).toBe(0);
    expect(s.cursor.hunkId).toBe("cs1/f1#h1");
  });

  it("crosses forward to the next hunk's first line when stepping past the end", () => {
    // Cursor is at line 0 of a 3-line hunk. delta=3 takes it past the end.
    const s = reducer(s0, { type: "MOVE_LINE", delta: 3 });
    expect(s.cursor.hunkId).toBe("cs1/f1#h2");
    expect(s.cursor.lineIdx).toBe(0);
  });

  it("crosses backward to the previous hunk's last line when stepping below 0", () => {
    const atH2 = reducer(s0, {
      type: "SET_CURSOR",
      cursor: { changesetId: "cs1", fileId: "cs1/f1", hunkId: "cs1/f1#h2", lineIdx: 0 },
    });
    const s = reducer(atH2, { type: "MOVE_LINE", delta: -1 });
    expect(s.cursor.hunkId).toBe("cs1/f1#h1");
    expect(s.cursor.lineIdx).toBe(2); // last line of a 3-line hunk
  });

  it("clamps forward at the last line of the last hunk in the last file", () => {
    // Walk to last file, last hunk, last line.
    const atEnd = reducer(s0, {
      type: "SET_CURSOR",
      cursor: { changesetId: "cs1", fileId: "cs1/f2", hunkId: "cs1/f2#h1", lineIdx: 1 },
    });
    const s = reducer(atEnd, { type: "MOVE_LINE", delta: 1 });
    expect(s.cursor).toEqual(atEnd.cursor);
  });

  it("extend=true within the same hunk creates a selection from the prior cursor", () => {
    const s = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    expect(s.selection).toEqual({ hunkId: "cs1/f1#h1", anchor: 0, head: 1 });
  });

  it("extend=true again grows the head while keeping the anchor", () => {
    const s1 = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s2 = reducer(s1, { type: "MOVE_LINE", delta: 1, extend: true });
    expect(s2.selection).toEqual({ hunkId: "cs1/f1#h1", anchor: 0, head: 2 });
  });

  it("crossing a hunk boundary collapses the selection even if extend=true", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "MOVE_LINE", delta: 5, extend: true });
    expect(s.cursor.hunkId).toBe("cs1/f1#h2");
    expect(s.selection).toBeNull();
  });

  it("plain delta=0 within the same hunk collapses an existing selection", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "MOVE_LINE", delta: 1 });
    expect(s.selection).toBeNull();
  });

  it("preserveSelection keeps the existing selection through a same-hunk move", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "MOVE_LINE", delta: 1, preserveSelection: true });
    expect(s.selection).toEqual({ hunkId: "cs1/f1#h1", anchor: 0, head: 1 });
    expect(s.cursor.lineIdx).toBe(2);
  });
});

// ── MOVE_HUNK ──────────────────────────────────────────────────────────────

describe("MOVE_HUNK", () => {
  it("advances to the first line of the next hunk in the same file", () => {
    const s = reducer(s0, { type: "MOVE_HUNK", delta: 1 });
    expect(s.cursor.hunkId).toBe("cs1/f1#h2");
    expect(s.cursor.lineIdx).toBe(0);
  });

  it("clamps at the first hunk", () => {
    const s = reducer(s0, { type: "MOVE_HUNK", delta: -1 });
    expect(s).toBe(s0);
  });

  it("clamps at the last hunk in the file (does not cross into the next file)", () => {
    const atH2 = reducer(s0, { type: "MOVE_HUNK", delta: 1 });
    const s = reducer(atH2, { type: "MOVE_HUNK", delta: 1 });
    expect(s).toBe(atH2);
  });

  it("collapses selection on hunk move", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "MOVE_HUNK", delta: 1 });
    expect(s.selection).toBeNull();
  });
});

// ── MOVE_FILE ──────────────────────────────────────────────────────────────

describe("MOVE_FILE", () => {
  it("lands on the first hunk's first line of the next file", () => {
    const s = reducer(s0, { type: "MOVE_FILE", delta: 1 });
    expect(s.cursor.fileId).toBe("cs1/f2");
    expect(s.cursor.hunkId).toBe("cs1/f2#h1");
    expect(s.cursor.lineIdx).toBe(0);
  });

  it("clamps at the first file", () => {
    const s = reducer(s0, { type: "MOVE_FILE", delta: -1 });
    expect(s).toBe(s0);
  });

  it("clamps at the last file", () => {
    const last = reducer(s0, { type: "MOVE_FILE", delta: 1 });
    const s = reducer(last, { type: "MOVE_FILE", delta: 1 });
    expect(s).toBe(last);
  });

  it("collapses selection on file move", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "MOVE_FILE", delta: 1 });
    expect(s.selection).toBeNull();
  });
});

// ── SET_CURSOR / COLLAPSE_SELECTION ────────────────────────────────────────

describe("SET_CURSOR", () => {
  it("sets the cursor and marks the line as read", () => {
    const s = reducer(s0, {
      type: "SET_CURSOR",
      cursor: { changesetId: "cs1", fileId: "cs1/f2", hunkId: "cs1/f2#h1", lineIdx: 1 },
    });
    expect(s.cursor.fileId).toBe("cs1/f2");
    expect(s.readLines["cs1/f2#h1"]).toEqual(new Set([1]));
  });

  it("applies an explicit selection when provided", () => {
    const sel = { hunkId: "cs1/f1#h1", anchor: 0, head: 2 } as const;
    const s = reducer(s0, {
      type: "SET_CURSOR",
      cursor: { changesetId: "cs1", fileId: "cs1/f1", hunkId: "cs1/f1#h1", lineIdx: 2 },
      selection: sel,
    });
    expect(s.selection).toEqual(sel);
  });

  it("collapses the selection when none is passed (default)", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, {
      type: "SET_CURSOR",
      cursor: { changesetId: "cs1", fileId: "cs1/f1", hunkId: "cs1/f1#h1", lineIdx: 0 },
    });
    expect(s.selection).toBeNull();
  });
});

describe("COLLAPSE_SELECTION", () => {
  it("clears an active selection", () => {
    const sel = reducer(s0, { type: "MOVE_LINE", delta: 1, extend: true });
    const s = reducer(sel, { type: "COLLAPSE_SELECTION" });
    expect(s.selection).toBeNull();
  });

  it("returns the same state reference when already collapsed", () => {
    const s = reducer(s0, { type: "COLLAPSE_SELECTION" });
    expect(s).toBe(s0);
  });
});

// ── SWITCH_CHANGESET ───────────────────────────────────────────────────────

describe("SWITCH_CHANGESET", () => {
  it("moves the cursor to the new changeset's first file/hunk/line", () => {
    const second = makeChangeset("cs2", [
      makeFile("cs2/x", [makeHunk("cs2/x#h1", 1)]),
    ]);
    const s = reducer(initialState([defaultChangeset(), second]), {
      type: "SWITCH_CHANGESET",
      changesetId: "cs2",
    });
    expect(s.cursor).toEqual({
      changesetId: "cs2",
      fileId: "cs2/x",
      hunkId: "cs2/x#h1",
      lineIdx: 0,
    });
    expect(s.selection).toBeNull();
    expect(s.readLines["cs2/x#h1"]).toEqual(new Set([0]));
  });

  it("returns the same state when the changeset id is unknown", () => {
    const s = reducer(s0, { type: "SWITCH_CHANGESET", changesetId: "missing" });
    expect(s).toBe(s0);
  });
});

// ── LOAD_CHANGESET ─────────────────────────────────────────────────────────

describe("LOAD_CHANGESET", () => {
  it("appends a fresh changeset and moves the cursor to it", () => {
    const fresh = makeChangeset("new", [makeFile("new/f", [makeHunk("new/f#h1", 1)])]);
    const s = reducer(s0, { type: "LOAD_CHANGESET", changeset: fresh });
    expect(s.changesets.map((c) => c.id)).toEqual(["cs1", "new"]);
    expect(s.cursor.changesetId).toBe("new");
  });

  it("replaces an existing changeset in place when ids collide", () => {
    const replacement = makeChangeset("cs1", [
      makeFile("cs1/replaced", [makeHunk("cs1/replaced#h1", 1)]),
    ]);
    const s = reducer(s0, { type: "LOAD_CHANGESET", changeset: replacement });
    expect(s.changesets).toHaveLength(1);
    expect(s.changesets[0].files[0].id).toBe("cs1/replaced");
  });

  it("returns the same state if the loaded changeset has no files", () => {
    const empty = makeChangeset("empty", []);
    const s = reducer(s0, { type: "LOAD_CHANGESET", changeset: empty });
    expect(s).toBe(s0);
  });

  it("returns the same state if the loaded changeset's first file has no hunks", () => {
    const noHunks = makeChangeset("nh", [makeFile("nh/f", [])]);
    const s = reducer(s0, { type: "LOAD_CHANGESET", changeset: noHunks });
    expect(s).toBe(s0);
  });
});

// ── RELOAD_CHANGESET ────────────────────────────────────────────────────────

describe("RELOAD_CHANGESET", () => {
  // The reload pass uses the anchorHash to find a 5-line window. Build hunks
  // with line text we can vary to exercise re-anchor / detach paths.
  function makeReloadFile(
    id: string,
    path: string,
    hunkId: string,
    texts: string[],
  ): DiffFile {
    return {
      id,
      path,
      language: "ts",
      status: "modified",
      hunks: [
        {
          id: hunkId,
          header: "@@",
          oldStart: 1,
          oldCount: texts.length,
          newStart: 1,
          newCount: texts.length,
          lines: texts.map((t, i) => ({
            kind: "context" as const,
            text: t,
            oldNo: i + 1,
            newNo: i + 1,
          })),
        },
      ],
    };
  }

  function startWithReply(
    csId: string,
    fileId: string,
    filePath: string,
    hunkId: string,
    texts: string[],
    lineIdx: number,
  ): { state: ReviewState; key: string } {
    const file = makeReloadFile(fileId, filePath, hunkId, texts);
    const cs = makeChangeset(csId, [file]);
    let s = initialState([cs]);
    const key = `user:${hunkId}:${lineIdx}`;
    const cap = captureAnchorContext(file.hunks[0].lines, lineIdx);
    s = reducer(s, {
      type: "ADD_REPLY",
      targetKey: key,
      reply: {
        id: "r1",
        author: "you",
        body: "yo",
        createdAt: "t",
        anchorPath: filePath,
        anchorContext: cap.context,
        anchorHash: cap.hash,
        originSha: csId,
        originType: "committed",
      },
    });
    return { state: s, key };
  }

  it("keeps the reply inline at the same logical position when the line is unchanged", () => {
    const { state } = startWithReply(
      "cs-old",
      "f1",
      "f1.ts",
      "f1#h1",
      ["a", "b", "anchor", "c", "d"],
      2,
    );
    // Reload: same content, but new ChangeSet id (sha bumped) and a new hunk id.
    const reloadFile = makeReloadFile("f1-new", "f1.ts", "f1-new#h1", [
      "a", "b", "anchor", "c", "d",
    ]);
    const reloaded = makeChangeset("cs-new", [reloadFile]);
    const s = reducer(state, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "cs-old",
      changeset: reloaded,
    });
    expect(Object.keys(s.replies)).toEqual([`user:f1-new#h1:2`]);
    expect(s.replies[`user:f1-new#h1:2`]).toHaveLength(1);
    expect(s.detachedReplies).toEqual([]);
    // Cursor moved to the new changeset (file 0 since the file path matched).
    expect(s.cursor.changesetId).toBe("cs-new");
    expect(s.cursor.fileId).toBe("f1-new");
  });

  it("re-anchors the reply when the matching window has shifted within the file", () => {
    const { state } = startWithReply(
      "cs-old",
      "f1",
      "f1.ts",
      "f1#h1",
      ["a", "b", "anchor", "c", "d"],
      2,
    );
    const reloadFile = makeReloadFile("f1-new", "f1.ts", "f1-new#h1", [
      "noise1", "noise2", "a", "b", "anchor", "c", "d",
    ]);
    const reloaded = makeChangeset("cs-new", [reloadFile]);
    const s = reducer(state, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "cs-old",
      changeset: reloaded,
    });
    expect(Object.keys(s.replies)).toEqual([`user:f1-new#h1:4`]);
    expect(s.detachedReplies).toEqual([]);
  });

  it("detaches the reply when its anchor is rewritten beyond recognition", () => {
    const { state } = startWithReply(
      "cs-old",
      "f1",
      "f1.ts",
      "f1#h1",
      ["a", "b", "anchor", "c", "d"],
      2,
    );
    const reloadFile = makeReloadFile("f1-new", "f1.ts", "f1-new#h1", [
      "totally", "different", "lines", "here", "now",
    ]);
    const reloaded = makeChangeset("cs-new", [reloadFile]);
    const s = reducer(state, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "cs-old",
      changeset: reloaded,
    });
    expect(s.replies).toEqual({});
    expect(s.detachedReplies).toHaveLength(1);
    expect(s.detachedReplies[0].reply.id).toBe("r1");
    expect(s.detachedReplies[0].threadKey).toBe(`user:f1#h1:2`);
  });

  it("detaches when the file the reply was anchored to no longer exists", () => {
    const { state } = startWithReply(
      "cs-old",
      "f1",
      "f1.ts",
      "f1#h1",
      ["a", "b", "anchor", "c", "d"],
      2,
    );
    const otherFile = makeReloadFile("f2", "f2.ts", "f2#h1", ["x", "y", "z"]);
    const reloaded = makeChangeset("cs-new", [otherFile]);
    const s = reducer(state, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "cs-old",
      changeset: reloaded,
    });
    expect(s.replies).toEqual({});
    expect(s.detachedReplies).toHaveLength(1);
  });

  it("falls back to file 0 when the cursor's previous file is gone", () => {
    const { state } = startWithReply(
      "cs-old",
      "f1",
      "f1.ts",
      "f1#h1",
      ["a", "b", "anchor", "c", "d"],
      2,
    );
    const otherFile = makeReloadFile("f2", "f2.ts", "f2#h1", ["x", "y", "z"]);
    const reloaded = makeChangeset("cs-new", [otherFile]);
    const s = reducer(state, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "cs-old",
      changeset: reloaded,
    });
    expect(s.cursor.fileId).toBe("f2");
  });

  it("is a no-op when prevChangesetId is unknown", () => {
    const reloadFile = makeReloadFile("f1-new", "f1.ts", "f1-new#h1", ["a"]);
    const reloaded = makeChangeset("cs-new", [reloadFile]);
    const s = reducer(s0, {
      type: "RELOAD_CHANGESET",
      prevChangesetId: "no-such-cs",
      changeset: reloaded,
    });
    expect(s).toBe(s0);
  });
});

// ── DISMISS_GUIDE ──────────────────────────────────────────────────────────

describe("DISMISS_GUIDE", () => {
  it("adds the guideId to dismissedGuides", () => {
    const s = reducer(s0, { type: "DISMISS_GUIDE", guideId: "g1" });
    expect(s.dismissedGuides.has("g1")).toBe(true);
  });

  it("is idempotent — dismissing twice keeps a single entry", () => {
    const s1 = reducer(s0, { type: "DISMISS_GUIDE", guideId: "g1" });
    const s2 = reducer(s1, { type: "DISMISS_GUIDE", guideId: "g1" });
    expect(s2.dismissedGuides.size).toBe(1);
  });
});

// ── TOGGLE_ACK ─────────────────────────────────────────────────────────────

describe("TOGGLE_ACK", () => {
  it("adds the noteKey when not already acked", () => {
    const s = reducer(s0, { type: "TOGGLE_ACK", hunkId: "cs1/f1#h1", lineIdx: 2 });
    expect(s.ackedNotes.has(noteKey("cs1/f1#h1", 2))).toBe(true);
  });

  it("removes the noteKey on second toggle", () => {
    const s1 = reducer(s0, { type: "TOGGLE_ACK", hunkId: "cs1/f1#h1", lineIdx: 2 });
    const s2 = reducer(s1, { type: "TOGGLE_ACK", hunkId: "cs1/f1#h1", lineIdx: 2 });
    expect(s2.ackedNotes.has(noteKey("cs1/f1#h1", 2))).toBe(false);
  });
});

// ── ADD_REPLY / DELETE_REPLY ───────────────────────────────────────────────

describe("ADD_REPLY", () => {
  it("creates a fresh thread for an unseen targetKey", () => {
    const reply = { id: "r1", author: "a", body: "hi", createdAt: "now" };
    const s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    expect(s.replies["k"]).toEqual([reply]);
  });

  it("appends to an existing thread", () => {
    const r1 = { id: "r1", author: "a", body: "hi", createdAt: "t1" };
    const r2 = { id: "r2", author: "b", body: "yo", createdAt: "t2" };
    let s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply: r1 });
    s = reducer(s, { type: "ADD_REPLY", targetKey: "k", reply: r2 });
    expect(s.replies["k"]).toEqual([r1, r2]);
  });

  it("preserves a Reply's enqueuedCommentId on add (defaults to null)", () => {
    // The App-level submit handler attaches `enqueuedCommentId: null` before
    // dispatching; the reducer just spreads the reply, so this should pass
    // verbatim. The patch action below sets the id once the server responds.
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    expect(s.replies["k"][0].enqueuedCommentId).toBeNull();
  });
});

// ── PATCH_REPLY_ENQUEUED_ID ────────────────────────────────────────────────

describe("PATCH_REPLY_ENQUEUED_ID", () => {
  it("sets the enqueuedCommentId on the matching reply", () => {
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "PATCH_REPLY_ENQUEUED_ID",
      targetKey: "k",
      replyId: "r1",
      enqueuedCommentId: "cmt_42",
    });
    expect(s2.replies["k"][0].enqueuedCommentId).toBe("cmt_42");
  });

  it("is a no-op when the targetKey is unknown", () => {
    const s = reducer(s0, {
      type: "PATCH_REPLY_ENQUEUED_ID",
      targetKey: "missing",
      replyId: "r1",
      enqueuedCommentId: "cmt_42",
    });
    expect(s).toBe(s0);
  });

  it("is a no-op when the replyId does not match", () => {
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "PATCH_REPLY_ENQUEUED_ID",
      targetKey: "k",
      replyId: "nope",
      enqueuedCommentId: "cmt_42",
    });
    expect(s2).toBe(s1);
  });

  it("leaves sibling replies untouched", () => {
    const r1 = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "t1",
      enqueuedCommentId: null,
    };
    const r2 = {
      id: "r2",
      author: "b",
      body: "yo",
      createdAt: "t2",
      enqueuedCommentId: null,
    };
    let s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply: r1 });
    s = reducer(s, { type: "ADD_REPLY", targetKey: "k", reply: r2 });
    s = reducer(s, {
      type: "PATCH_REPLY_ENQUEUED_ID",
      targetKey: "k",
      replyId: "r2",
      enqueuedCommentId: "cmt_99",
    });
    expect(s.replies["k"][0].enqueuedCommentId).toBeNull();
    expect(s.replies["k"][1].enqueuedCommentId).toBe("cmt_99");
  });
});

// ── SET_REPLY_ENQUEUE_ERROR ────────────────────────────────────────────────

describe("SET_REPLY_ENQUEUE_ERROR", () => {
  it("sets enqueueError = true on the matching reply", () => {
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "SET_REPLY_ENQUEUE_ERROR",
      targetKey: "k",
      replyId: "r1",
      error: true,
    });
    expect(s2.replies["k"][0].enqueueError).toBe(true);
  });

  it("clears enqueueError back to false on success", () => {
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
      enqueueError: true,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "SET_REPLY_ENQUEUE_ERROR",
      targetKey: "k",
      replyId: "r1",
      error: false,
    });
    expect(s2.replies["k"][0].enqueueError).toBe(false);
  });

  it("is a no-op when the targetKey is unknown", () => {
    const s = reducer(s0, {
      type: "SET_REPLY_ENQUEUE_ERROR",
      targetKey: "missing",
      replyId: "r1",
      error: true,
    });
    expect(s).toBe(s0);
  });

  it("is a no-op when the replyId does not match", () => {
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "SET_REPLY_ENQUEUE_ERROR",
      targetKey: "k",
      replyId: "nope",
      error: true,
    });
    expect(s2).toBe(s1);
  });

  it("returns the same state when the flag is already at the requested value", () => {
    // Idempotency keeps unrelated subscribers from re-rendering when nothing
    // observably changed. The reducer treats "absent" and `false` as the
    // same starting state for this comparison.
    const reply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "now",
      enqueuedCommentId: null,
    };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply });
    const s2 = reducer(s1, {
      type: "SET_REPLY_ENQUEUE_ERROR",
      targetKey: "k",
      replyId: "r1",
      error: false,
    });
    expect(s2).toBe(s1);
  });
});

describe("DELETE_REPLY", () => {
  it("removes a reply by id from the thread", () => {
    const r1 = { id: "r1", author: "a", body: "hi", createdAt: "t1" };
    const r2 = { id: "r2", author: "b", body: "yo", createdAt: "t2" };
    let s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply: r1 });
    s = reducer(s, { type: "ADD_REPLY", targetKey: "k", reply: r2 });
    s = reducer(s, { type: "DELETE_REPLY", targetKey: "k", replyId: "r1" });
    expect(s.replies["k"]).toEqual([r2]);
  });

  it("drops the targetKey entirely when the last reply is removed", () => {
    const r1 = { id: "r1", author: "a", body: "hi", createdAt: "t1" };
    let s = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply: r1 });
    s = reducer(s, { type: "DELETE_REPLY", targetKey: "k", replyId: "r1" });
    expect(Object.prototype.hasOwnProperty.call(s.replies, "k")).toBe(false);
  });

  it("returns the same state when the targetKey is unknown", () => {
    const s = reducer(s0, { type: "DELETE_REPLY", targetKey: "missing", replyId: "x" });
    expect(s).toBe(s0);
  });

  it("returns the same state when the replyId does not match", () => {
    const r1 = { id: "r1", author: "a", body: "hi", createdAt: "t1" };
    const s1 = reducer(s0, { type: "ADD_REPLY", targetKey: "k", reply: r1 });
    const s2 = reducer(s1, { type: "DELETE_REPLY", targetKey: "k", replyId: "nope" });
    expect(s2).toBe(s1);
  });
});

// ── MERGE_AGENT_REPLIES ────────────────────────────────────────────────────

describe("MERGE_AGENT_REPLIES", () => {
  function withReply(
    state: ReviewState,
    targetKey: string,
    enqueuedCommentId: string | null,
    replyId = "r1",
  ): ReviewState {
    return reducer(state, {
      type: "ADD_REPLY",
      targetKey,
      reply: {
        id: replyId,
        author: "you",
        body: "x",
        createdAt: "2026-04-30T00:00:00Z",
        enqueuedCommentId,
        agentReplies: [],
      },
    });
  }

  it("attaches a polled agent reply to the matching reviewer Reply by enqueuedCommentId", () => {
    const s1 = withReply(s0, "k", "cmt_1");
    const s2 = reducer(s1, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "ar1",
          commentId: "cmt_1",
          body: "fixed",
          outcome: "addressed",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    expect(s2.replies["k"][0].agentReplies).toEqual([
      {
        id: "ar1",
        body: "fixed",
        outcome: "addressed",
        postedAt: "2026-04-30T00:01:00Z",
      },
    ]);
  });

  it("sorts by postedAt ascending after the merge", () => {
    const s1 = withReply(s0, "k", "cmt_1");
    const s2 = reducer(s1, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "b",
          commentId: "cmt_1",
          body: "B",
          outcome: "addressed",
          postedAt: "2026-04-30T00:02:00Z",
        },
        {
          id: "a",
          commentId: "cmt_1",
          body: "A",
          outcome: "noted",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    expect(s2.replies["k"][0].agentReplies!.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("updates existing entries in place (matched by id) and appends new ones", () => {
    const s1 = withReply(s0, "k", "cmt_1");
    const s2 = reducer(s1, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "ar1",
          commentId: "cmt_1",
          body: "first",
          outcome: "noted",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    const s3 = reducer(s2, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        // Same id with updated body should overwrite.
        {
          id: "ar1",
          commentId: "cmt_1",
          body: "first (edited)",
          outcome: "addressed",
          postedAt: "2026-04-30T00:01:00Z",
        },
        {
          id: "ar2",
          commentId: "cmt_1",
          body: "second",
          outcome: "addressed",
          postedAt: "2026-04-30T00:02:00Z",
        },
      ],
    });
    const replies = s3.replies["k"][0].agentReplies!;
    expect(replies).toHaveLength(2);
    expect(replies[0].body).toBe("first (edited)");
    expect(replies[0].outcome).toBe("addressed");
    expect(replies[1].id).toBe("ar2");
  });

  it("is a no-op when no Reply matches the polled commentId", () => {
    const s1 = withReply(s0, "k", "cmt_1");
    const s2 = reducer(s1, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "ar1",
          commentId: "cmt_other",
          body: "orphan",
          outcome: "noted",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    expect(s2).toBe(s1);
  });

  it("ignores Replies with null enqueuedCommentId (defensive)", () => {
    const s1 = withReply(s0, "k", null);
    const s2 = reducer(s1, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "ar1",
          commentId: "cmt_1",
          body: "x",
          outcome: "noted",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    expect(s2).toBe(s1);
  });

  it("is idempotent — repeated merges of the same data leave state unchanged", () => {
    const s1 = withReply(s0, "k", "cmt_1");
    const polled = [
      {
        id: "ar1",
        commentId: "cmt_1",
        body: "x",
        outcome: "addressed" as const,
        postedAt: "2026-04-30T00:01:00Z",
      },
    ];
    const s2 = reducer(s1, { type: "MERGE_AGENT_REPLIES", polled });
    const s3 = reducer(s2, { type: "MERGE_AGENT_REPLIES", polled });
    expect(s3).toBe(s2);
  });

  it("groups polled entries across multiple commentIds onto distinct Replies", () => {
    let s = withReply(s0, "k1", "cmt_1", "r1");
    s = withReply(s, "k2", "cmt_2", "r2");
    const merged = reducer(s, {
      type: "MERGE_AGENT_REPLIES",
      polled: [
        {
          id: "ar_a",
          commentId: "cmt_1",
          body: "a",
          outcome: "noted",
          postedAt: "2026-04-30T00:01:00Z",
        },
        {
          id: "ar_b",
          commentId: "cmt_2",
          body: "b",
          outcome: "addressed",
          postedAt: "2026-04-30T00:01:00Z",
        },
      ],
    });
    expect(merged.replies["k1"][0].agentReplies!.map((r) => r.id)).toEqual([
      "ar_a",
    ]);
    expect(merged.replies["k2"][0].agentReplies!.map((r) => r.id)).toEqual([
      "ar_b",
    ]);
  });
});

// ── SET_EXPAND_LEVEL ───────────────────────────────────────────────────────

describe("SET_EXPAND_LEVEL", () => {
  it("sets the level under expandLevelAbove for dir=above", () => {
    const s = reducer(s0, {
      type: "SET_EXPAND_LEVEL",
      hunkId: "h",
      dir: "above",
      level: 2,
    });
    expect(s.expandLevelAbove["h"]).toBe(2);
    expect(s.expandLevelBelow["h"]).toBeUndefined();
  });

  it("sets the level under expandLevelBelow for dir=below", () => {
    const s = reducer(s0, {
      type: "SET_EXPAND_LEVEL",
      hunkId: "h",
      dir: "below",
      level: 3,
    });
    expect(s.expandLevelBelow["h"]).toBe(3);
  });

  it("clamps negative levels to 0", () => {
    const s = reducer(s0, {
      type: "SET_EXPAND_LEVEL",
      hunkId: "h",
      dir: "above",
      level: -5,
    });
    expect(s.expandLevelAbove["h"]).toBe(0);
  });
});

// ── TOGGLE_EXPAND_FILE / TOGGLE_PREVIEW_FILE ───────────────────────────────

describe("TOGGLE_EXPAND_FILE", () => {
  it("adds the fileId on first toggle and removes on second", () => {
    const s1 = reducer(s0, { type: "TOGGLE_EXPAND_FILE", fileId: "cs1/f1" });
    expect(s1.fullExpandedFiles.has("cs1/f1")).toBe(true);
    const s2 = reducer(s1, { type: "TOGGLE_EXPAND_FILE", fileId: "cs1/f1" });
    expect(s2.fullExpandedFiles.has("cs1/f1")).toBe(false);
  });

  it("turning on full-expand removes the file from previewedFiles (mutually exclusive)", () => {
    const previewing = reducer(s0, { type: "TOGGLE_PREVIEW_FILE", fileId: "cs1/f1" });
    const s = reducer(previewing, { type: "TOGGLE_EXPAND_FILE", fileId: "cs1/f1" });
    expect(s.previewedFiles.has("cs1/f1")).toBe(false);
    expect(s.fullExpandedFiles.has("cs1/f1")).toBe(true);
  });
});

describe("TOGGLE_PREVIEW_FILE", () => {
  it("adds the fileId on first toggle and removes on second", () => {
    const s1 = reducer(s0, { type: "TOGGLE_PREVIEW_FILE", fileId: "cs1/f1" });
    expect(s1.previewedFiles.has("cs1/f1")).toBe(true);
    const s2 = reducer(s1, { type: "TOGGLE_PREVIEW_FILE", fileId: "cs1/f1" });
    expect(s2.previewedFiles.has("cs1/f1")).toBe(false);
  });

  it("turning on preview removes the file from fullExpandedFiles", () => {
    const expanded = reducer(s0, { type: "TOGGLE_EXPAND_FILE", fileId: "cs1/f1" });
    const s = reducer(expanded, { type: "TOGGLE_PREVIEW_FILE", fileId: "cs1/f1" });
    expect(s.fullExpandedFiles.has("cs1/f1")).toBe(false);
    expect(s.previewedFiles.has("cs1/f1")).toBe(true);
  });
});

// ── TOGGLE_FILE_REVIEWED ───────────────────────────────────────────────────

describe("TOGGLE_FILE_REVIEWED", () => {
  it("adds the fileId on first toggle and removes on second", () => {
    const s1 = reducer(s0, { type: "TOGGLE_FILE_REVIEWED", fileId: "cs1/f1" });
    expect(s1.reviewedFiles.has("cs1/f1")).toBe(true);
    const s2 = reducer(s1, { type: "TOGGLE_FILE_REVIEWED", fileId: "cs1/f1" });
    expect(s2.reviewedFiles.has("cs1/f1")).toBe(false);
  });
});

// ── Coverage helpers ───────────────────────────────────────────────────────

describe("coverage helpers", () => {
  it("hunkCoverage returns seen / total", () => {
    const hunk = { id: "h", lines: [0, 1, 2, 3] }; // 4 lines
    const lines = { h: new Set([0, 2]) };
    expect(hunkCoverage(hunk, lines)).toBeCloseTo(0.5);
  });

  it("hunkCoverage returns 0 for an empty hunk", () => {
    expect(hunkCoverage({ id: "h", lines: [] }, {})).toBe(0);
  });

  it("hunkCoverage returns 0 when the hunk has no entry in readLines", () => {
    expect(hunkCoverage({ id: "h", lines: [0, 1] }, {})).toBe(0);
  });

  it("fileCoverage averages across all hunks weighted by line count", () => {
    const file = {
      hunks: [
        { id: "h1", lines: [0, 1] }, // 2 lines, 1 seen → 50%
        { id: "h2", lines: [0, 1, 2, 3] }, // 4 lines, 4 seen → 100%
      ],
    };
    const lines = { h1: new Set([0]), h2: new Set([0, 1, 2, 3]) };
    // 5 of 6 lines seen
    expect(fileCoverage(file, lines)).toBeCloseTo(5 / 6);
  });

  it("fileCoverage returns 0 for a file with no lines", () => {
    expect(fileCoverage({ hunks: [] }, {})).toBe(0);
  });

  it("changesetCoverage sums across all files in the changeset", () => {
    const cs = defaultChangeset(); // f1 has 2 hunks of 3 lines, f2 has 1 hunk of 2 lines = 8 lines
    const lines = {
      "cs1/f1#h1": new Set([0, 1, 2]),
      "cs1/f1#h2": new Set([0]),
      "cs1/f2#h1": new Set<number>(),
    };
    expect(changesetCoverage(cs, lines)).toBeCloseTo(4 / 8);
  });

  it("reviewedFilesCount counts files in the changeset that are in the reviewed set", () => {
    const cs = defaultChangeset();
    const reviewed = new Set(["cs1/f1", "other/file"]);
    expect(reviewedFilesCount(cs, reviewed)).toBe(1);
  });
});
