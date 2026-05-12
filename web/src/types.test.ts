import { describe, expect, it } from "vitest";
import { agentCommentReplyKey, parseReplyKey } from "./types";

describe("agentCommentReplyKey + parseReplyKey", () => {
  it("agentCommentReplyKey returns the prefixed key", () => {
    expect(agentCommentReplyKey("ac-1")).toBe("agentComment:ac-1");
  });

  it("parses agentComment:<id>", () => {
    const parsed = parseReplyKey("agentComment:01HZABCD");
    expect(parsed).toEqual({
      kind: "agentComment",
      agentCommentId: "01HZABCD",
    });
  });

  it("returns null for agentComment: with empty id", () => {
    expect(parseReplyKey("agentComment:")).toBeNull();
  });

  it("treats colons inside the id as part of the id (no further parsing)", () => {
    // Agent-comment ids are opaque server-minted strings; tolerate exotic
    // values rather than rejecting them.
    const parsed = parseReplyKey("agentComment:foo:bar");
    expect(parsed).toEqual({
      kind: "agentComment",
      agentCommentId: "foo:bar",
    });
  });

  it("leaves the existing kinds parsing unchanged", () => {
    expect(parseReplyKey("note:h1:3")).toEqual({
      kind: "note",
      hunkId: "h1",
      lineIdx: 3,
    });
    expect(parseReplyKey("block:h1:5-9")).toEqual({
      kind: "block",
      hunkId: "h1",
      lo: 5,
      hi: 9,
      lineIdx: 5,
    });
    expect(parseReplyKey("teammate:h1")).toEqual({
      kind: "teammate",
      hunkId: "h1",
      lineIdx: 0,
    });
  });
});
