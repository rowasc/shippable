import { describe, expect, it } from "vitest";
import { renderPreviewPayload } from "./sendBatch";
import type { DraftComment } from "./types";

// These tests pin the contract of the `<reviewer-feedback>` envelope
// formatter. `renderPreviewPayload` (here, in `web/src/sendBatch.ts`) and
// `formatPayload` (in `server/src/agent-queue.ts`) are required to be
// byte-for-byte identical — slice (c) left a "keep in sync" comment in
// `sendBatch.ts`, and `agent-queue.ts` points back at this test file. If
// the server changes the envelope shape, run this test against the new
// rules and update both implementations together.
//
// Spec: docs/plans/push-review-comments-tasks.md § 6 — "Sort order in the
// payload formatter": file path ascending, then line lower-bound ascending,
// freeform last in send order.

describe("renderPreviewPayload — empty input", () => {
  it("returns the empty string for an empty array", () => {
    expect(renderPreviewPayload("abc123", [])).toBe("");
  });
});

describe("renderPreviewPayload — envelope shape", () => {
  it("wraps a single line note in a <reviewer-feedback> envelope with the commit sha", () => {
    const comments: DraftComment[] = [
      { kind: "line", file: "foo.ts", lines: "10", body: "small note" },
    ];
    const out = renderPreviewPayload("abc123", comments);
    expect(out).toBe(
      [
        '<reviewer-feedback from="shippable" commit="abc123">',
        '<comment file="foo.ts" lines="10" kind="line">',
        "small note",
        "</comment>",
        "</reviewer-feedback>",
      ].join("\n"),
    );
  });

  it("emits a <comment> element with no file/lines attrs for freeform", () => {
    const comments: DraftComment[] = [
      { kind: "freeform", body: "general thought" },
    ];
    const out = renderPreviewPayload("abc123", comments);
    expect(out).toBe(
      [
        '<reviewer-feedback from="shippable" commit="abc123">',
        '<comment kind="freeform">',
        "general thought",
        "</comment>",
        "</reviewer-feedback>",
      ].join("\n"),
    );
  });
});

describe("renderPreviewPayload — sort order", () => {
  it("sorts by (file path asc, line lower-bound asc) with freeform last", () => {
    // Input is intentionally jumbled. The expected output is:
    //   a:5, a:10-20, a:50-60, b:1, then freeform at the end.
    const comments: DraftComment[] = [
      { kind: "line", file: "b", lines: "1", body: "B-1" },
      { kind: "block", file: "a", lines: "50-60", body: "A-50-60" },
      { kind: "line", file: "a", lines: "5", body: "A-5" },
      { kind: "freeform", body: "FREE" },
      { kind: "block", file: "a", lines: "10-20", body: "A-10-20" },
    ];
    const out = renderPreviewPayload("c0ffee", comments);
    // Pull just the body lines, in order, to assert ordering succinctly.
    const bodies = out
      .split("\n")
      .filter((l) => /^[A-Z]/.test(l));
    expect(bodies).toEqual(["A-5", "A-10-20", "A-50-60", "B-1", "FREE"]);
  });

  it("preserves send order for two freeform comments at the end", () => {
    const comments: DraftComment[] = [
      { kind: "line", file: "a.ts", lines: "1", body: "FIRST_LINE" },
      { kind: "freeform", body: "FREE_ONE" },
      { kind: "freeform", body: "FREE_TWO" },
    ];
    const out = renderPreviewPayload("abc", comments);
    const bodies = out.split("\n").filter((l) => l.startsWith("FREE_") || l.startsWith("FIRST_"));
    expect(bodies).toEqual(["FIRST_LINE", "FREE_ONE", "FREE_TWO"]);
  });
});

describe("renderPreviewPayload — body sanitization", () => {
  it("disambiguates a literal </comment> appearing inside a body", () => {
    const comments: DraftComment[] = [
      {
        kind: "line",
        file: "x.ts",
        lines: "1",
        body: "before </comment> after",
      },
    ];
    const out = renderPreviewPayload("c0ffee", comments);
    expect(out).toContain("before </ comment> after");
    // The genuine closing tag for THIS comment is still present. We add 1
    // because the body inserts one more (the "</ comment>" sanitized form
    // doesn't count). Verify there's exactly one real close.
    const realCloses = out.split("</comment>").length - 1;
    expect(realCloses).toBe(1);
  });

  it("strips ]]> CDATA-breaking sequences from the body", () => {
    const comments: DraftComment[] = [
      {
        kind: "line",
        file: "x.ts",
        lines: "1",
        body: "edge case ]]> in text",
      },
    ];
    const out = renderPreviewPayload("c0ffee", comments);
    expect(out).not.toContain("]]>");
    expect(out).toContain("]]&gt;");
  });
});
