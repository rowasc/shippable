import { describe, expect, it } from "vitest";
import { parseReplyKey } from "./types";

describe("parseReplyKey", () => {
  it("parses note:hunkId:lineIdx", () => {
    expect(parseReplyKey("note:h1:3")).toEqual({
      kind: "note",
      hunkId: "h1",
      lineIdx: 3,
    });
  });

  it("parses user:hunkId:lineIdx", () => {
    expect(parseReplyKey("user:h1:7")).toEqual({
      kind: "user",
      hunkId: "h1",
      lineIdx: 7,
    });
  });

  it("parses block:hunkId:lo-hi and exposes lineIdx=lo", () => {
    expect(parseReplyKey("block:h1:5-9")).toEqual({
      kind: "block",
      hunkId: "h1",
      lo: 5,
      hi: 9,
      lineIdx: 5,
    });
  });

  it("parses hunkSummary:hunkId", () => {
    expect(parseReplyKey("hunkSummary:h1")).toEqual({
      kind: "hunkSummary",
      hunkId: "h1",
      lineIdx: 0,
    });
  });

  it("parses teammate:hunkId", () => {
    expect(parseReplyKey("teammate:h1")).toEqual({
      kind: "teammate",
      hunkId: "h1",
      lineIdx: 0,
    });
  });

  it("returns null for malformed input", () => {
    expect(parseReplyKey("bogus")).toBeNull();
    expect(parseReplyKey("note:")).toBeNull();
  });

  it("preserves colons inside the hunk id (PR csIds carry them)", () => {
    expect(parseReplyKey("note:pr:github.com:foo:bar:42#h1:3")).toEqual({
      kind: "note",
      hunkId: "pr:github.com:foo:bar:42#h1",
      lineIdx: 3,
    });
  });
});
