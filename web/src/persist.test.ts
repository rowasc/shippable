// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSession, peekSession, saveSession } from "./persist";
import { initialState } from "./state";
import type { ChangeSet, DiffFile, DiffLine, Hunk, Reply } from "./types";
import { lineNoteReplyKey } from "./types";

const STORAGE_KEY = "shippable:review:v1";

function makeLines(n: number): DiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "context" as const,
    text: `l${i}`,
    oldNo: i + 1,
    newNo: i + 1,
  }));
}
function makeHunk(id: string, n = 3): Hunk {
  return {
    id,
    header: `@@ -1,${n} +1,${n} @@`,
    oldStart: 1,
    oldCount: n,
    newStart: 1,
    newCount: n,
    lines: makeLines(n),
  };
}
function makeFile(id: string, hunks: Hunk[]): DiffFile {
  return { id, path: `${id}.ts`, language: "ts", status: "modified", hunks };
}
function makeChangeset(): ChangeSet {
  return {
    id: "cs1",
    title: "cs1",
    author: "tester",
    branch: "head",
    base: "base",
    createdAt: "2026-04-30T00:00:00.000Z",
    description: "",
    files: [makeFile("cs1/f1", [makeHunk("cs1/f1#h1")])],
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("persist — Reply.enqueuedCommentId migration", () => {
  it("rehydrates a persisted Reply missing enqueuedCommentId as null", () => {
    // Hand-craft a snapshot that pre-dates slice 2 — the Reply has no
    // `enqueuedCommentId` key at all. loadSession should fill it in.
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const legacyReply = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "2026-04-30T00:00:00Z",
    };
    const snapshot = {
      v: 1,
      cursor: { changesetId: "cs1", fileId: "cs1/f1", hunkId: "cs1/f1#h1", lineIdx: 0 },
      readLines: {},
      reviewedFiles: [],
      dismissedGuides: [],
      ackedNotes: [],
      replies: { [key]: [legacyReply] },
      drafts: {},
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

    const hydrated = loadSession([cs]);
    expect(hydrated.state).not.toBeNull();
    const replies = hydrated.state!.replies[key];
    expect(replies).toHaveLength(1);
    // Field is present and explicitly null after migration.
    expect(replies[0].enqueuedCommentId).toBeNull();
    expect("enqueuedCommentId" in replies[0]).toBe(true);
  });

  it("normalizes an explicitly-undefined enqueuedCommentId the same as a missing one", () => {
    // Older snapshots could carry the field in two shapes:
    //   (a) the property is absent from the JSON object entirely, or
    //   (b) the property is present in code but holds `undefined` (common
    //       when a reviver/middleware sets it before re-serialization).
    // JSON.stringify drops `undefined`-valued keys, so both shapes hit disk
    // identically — but we still want a regression guard that the migration
    // path (`r.enqueuedCommentId === undefined ? ... : r`) treats them as
    // equivalent and produces an explicit `null` either way.
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);

    // Shape (b): present-but-undefined. We assert the in-memory shape first
    // so the test name isn't a lie about what we're exercising.
    const legacyReply: Record<string, unknown> = {
      id: "r1",
      author: "a",
      body: "hi",
      createdAt: "2026-04-30T00:00:00Z",
      enqueuedCommentId: undefined,
    };
    expect("enqueuedCommentId" in legacyReply).toBe(true);
    expect(legacyReply.enqueuedCommentId).toBeUndefined();

    const snapshot = {
      v: 1,
      cursor: { changesetId: "cs1", fileId: "cs1/f1", hunkId: "cs1/f1#h1", lineIdx: 0 },
      readLines: {},
      reviewedFiles: [],
      dismissedGuides: [],
      ackedNotes: [],
      replies: { [key]: [legacyReply] },
      drafts: {},
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

    const hydrated = loadSession([cs]);
    const replies = hydrated.state!.replies[key];
    expect(replies[0].enqueuedCommentId).toBeNull();
    expect("enqueuedCommentId" in replies[0]).toBe(true);
  });

  it("preserves a non-null enqueuedCommentId across a save/load round-trip", () => {
    const cs = makeChangeset();
    const key = lineNoteReplyKey("cs1/f1#h1", 0);
    const reply: Reply = {
      id: "r1",
      author: "you",
      body: "queued",
      createdAt: "2026-04-30T00:00:00Z",
      enqueuedCommentId: "cmt_42",
    };
    const state = {
      ...initialState([cs]),
      replies: { [key]: [reply] },
    };
    saveSession(state, {});

    const hydrated = loadSession([cs]);
    expect(hydrated.state!.replies[key][0].enqueuedCommentId).toBe("cmt_42");
  });
});

// Bug class: an older client encountering a snapshot written by a newer
// version of the app must not pretend to load it. The migration table is
// forward-only, so a v: 999 blob has no path back to the head we know about.
// Failing closed = same behavior as a malformed blob: peek → null,
// load → empty hydration. Anything else risks corrupt state on disk.
describe("persist — unknown future version fails closed", () => {
  it("peekSession returns null for v greater than CURRENT_VERSION", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 999,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        ackedNotes: [],
        replies: {},
        drafts: {},
      }),
    );
    expect(peekSession()).toBeNull();
  });

  it("loadSession returns empty hydration for v greater than CURRENT_VERSION", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 999,
        cursor: { changesetId: "cs", fileId: "f", hunkId: "h", lineIdx: 0 },
        readLines: {},
        reviewedFiles: [],
        dismissedGuides: [],
        ackedNotes: [],
        replies: {},
        drafts: {},
      }),
    );
    expect(loadSession([])).toEqual({ state: null, drafts: {} });
  });
});
