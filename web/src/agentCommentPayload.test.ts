import { describe, expect, it } from "vitest";
import { deriveCommentPayload } from "./agentCommentPayload";
import type { ChangeSet, DiffFile, DiffLine, Hunk } from "./types";
import {
  blockCommentKey,
  hunkSummaryReplyKey,
  lineNoteReplyKey,
  teammateReplyKey,
  userCommentKey,
} from "./types";

// Hand-built changeset with line numbers chosen so the test assertions read
// as "the file says lines 100..104" — easier to verify by eye than indices.
function makeLines(start: number, n: number): DiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "context" as const,
    text: `l${i}`,
    oldNo: start + i,
    newNo: start + i,
  }));
}
function makeHunk(id: string, startNo: number, n: number): Hunk {
  return {
    id,
    header: `@@ -${startNo},${n} +${startNo},${n} @@`,
    oldStart: startNo,
    oldCount: n,
    newStart: startNo,
    newCount: n,
    lines: makeLines(startNo, n),
  };
}
function makeFile(id: string, path: string, hunks: Hunk[]): DiffFile {
  return { id, path, language: "ts", status: "modified", hunks };
}

const HUNK_ID = "cs1/web/src/state.ts#h1";
const FILE_PATH = "web/src/state.ts";
const cs: ChangeSet = {
  id: "cs1",
  title: "test",
  author: "t",
  branch: "h",
  base: "b",
  createdAt: "2026-04-30T00:00:00Z",
  description: "",
  files: [makeFile("cs1/state", FILE_PATH, [makeHunk(HUNK_ID, 100, 5)])],
};

describe("deriveCommentPayload", () => {
  it("note: → reply-to-ai-note + file:line", () => {
    const out = deriveCommentPayload(lineNoteReplyKey(HUNK_ID, 2), cs);
    expect(out).toEqual({
      kind: "reply-to-ai-note",
      file: FILE_PATH,
      lines: "102",
    });
  });

  it("user: → line + file:line", () => {
    const out = deriveCommentPayload(userCommentKey(HUNK_ID, 0), cs);
    expect(out).toEqual({ kind: "line", file: FILE_PATH, lines: "100" });
  });

  it("block: → block + file:lo-hi (file line numbers, not indices)", () => {
    const out = deriveCommentPayload(blockCommentKey(HUNK_ID, 1, 3), cs);
    expect(out).toEqual({
      kind: "block",
      file: FILE_PATH,
      lines: "101-103",
    });
  });

  it("block: collapses lo===hi to a single line number", () => {
    const out = deriveCommentPayload(blockCommentKey(HUNK_ID, 2, 2), cs);
    expect(out).toEqual({ kind: "block", file: FILE_PATH, lines: "102" });
  });

  it("hunkSummary: → reply-to-hunk-summary, no lines", () => {
    const out = deriveCommentPayload(hunkSummaryReplyKey(HUNK_ID), cs);
    expect(out).toEqual({
      kind: "reply-to-hunk-summary",
      file: FILE_PATH,
    });
    expect(out?.lines).toBeUndefined();
  });

  it("teammate: → reply-to-teammate, no lines", () => {
    const out = deriveCommentPayload(teammateReplyKey(HUNK_ID), cs);
    expect(out).toEqual({ kind: "reply-to-teammate", file: FILE_PATH });
    expect(out?.lines).toBeUndefined();
  });

  it("returns null for an unknown hunk id (stale changeset)", () => {
    expect(
      deriveCommentPayload(lineNoteReplyKey("missing-hunk", 0), cs),
    ).toBeNull();
  });

  it("returns null for malformed keys", () => {
    expect(deriveCommentPayload("bogus", cs)).toBeNull();
    expect(deriveCommentPayload("user:", cs)).toBeNull();
  });
});
