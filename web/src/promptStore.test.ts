import { describe, expect, it } from "vitest";
import { buildAutoFillContext } from "./promptStore";
import type { ChangeSet, DiffFile, Hunk, LineSelection } from "./types";

function makeFixture(): { cs: ChangeSet; file: DiffFile; hunk: Hunk } {
  const hunk: Hunk = {
    id: "cs1/f1#h1",
    header: "@@ -1,3 +1,3 @@",
    oldStart: 1,
    oldCount: 3,
    newStart: 1,
    newCount: 3,
    lines: [
      { kind: "context", text: "first line", oldNo: 1, newNo: 1 },
      { kind: "add", text: "fn helloWorld() {}", newNo: 2 },
      { kind: "context", text: "third line", oldNo: 3, newNo: 3 },
    ],
  };
  const file: DiffFile = {
    id: "cs1/f1",
    path: "src/helloWorld.ts",
    language: "ts",
    status: "modified",
    hunks: [hunk],
  };
  const cs: ChangeSet = {
    id: "cs1",
    title: "test",
    author: "tester",
    branch: "head",
    base: "base",
    createdAt: "2026-01-01T00:00:00.000Z",
    description: "",
    files: [file],
  };
  return { cs, file, hunk };
}

describe("buildAutoFillContext (charRange)", () => {
  it("uses the substring inside a single line when charRange is set", () => {
    const { cs, file, hunk } = makeFixture();
    const selection: LineSelection = {
      hunkId: hunk.id,
      anchor: 1,
      head: 1,
      charRange: { lineIdx: 1, fromCol: 3, toCol: 13 }, // "helloWorld"
    };
    const ctx = buildAutoFillContext(cs, file, hunk, selection);
    expect(ctx.selection).toBe("helloWorld");
    expect(ctx.selectionInfo).toEqual({
      kind: "lines",
      lo: 2,
      hi: 2,
      hunkLines: 3,
    });
  });

  it("falls back to line-range diff when no charRange is set", () => {
    const { cs, file, hunk } = makeFixture();
    const selection: LineSelection = { hunkId: hunk.id, anchor: 0, head: 1 };
    const ctx = buildAutoFillContext(cs, file, hunk, selection);
    expect(ctx.selection).toContain("first line");
    expect(ctx.selection).toContain("fn helloWorld() {}");
    expect(ctx.selectionInfo.kind).toBe("lines");
  });

  it("falls back to whole hunk when selection is null", () => {
    const { cs, file, hunk } = makeFixture();
    const ctx = buildAutoFillContext(cs, file, hunk, null);
    expect(ctx.selectionInfo).toEqual({ kind: "hunk", hunkLines: 3 });
  });

  it("ignores charRange that targets a different hunk", () => {
    const { cs, file, hunk } = makeFixture();
    const selection: LineSelection = {
      hunkId: "other-hunk",
      anchor: 1,
      head: 1,
      charRange: { lineIdx: 1, fromCol: 0, toCol: 5 },
    };
    const ctx = buildAutoFillContext(cs, file, hunk, selection);
    expect(ctx.selectionInfo).toEqual({ kind: "hunk", hunkLines: 3 });
  });
});
