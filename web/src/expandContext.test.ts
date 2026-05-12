import { describe, expect, it } from "vitest";
import { parseDiff } from "./parseDiff";

const FILE_TEXT = [
  "// header",
  "",
  "function alpha() {",
  "  return 1;",
  "}",
  "",
  "function beta() {",
  "  return 2;",
  "}",
  "",
  "function gamma() {",
  "  return 3;",
  "}",
  "",
  "// footer",
].join("\n");

const DIFF = [
  "diff --git a/src/x.ts b/src/x.ts",
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -7,3 +7,3 @@",
  "-function beta() {",
  "+function beta() { // updated",
  "   return 2;",
  " }",
].join("\n");

describe("enrichWithFileContent — expandAbove/Below derivation", () => {
  it("populates expandAbove and expandBelow when fileContents is provided", () => {
    const cs = parseDiff(DIFF, {
      id: "cs",
      fileContents: { "src/x.ts": FILE_TEXT },
    });
    const file = cs.files[0];
    const hunk = file.hunks[0];

    expect(hunk.expandAbove).toBeDefined();
    expect(hunk.expandBelow).toBeDefined();
    expect(hunk.expandAbove!.length).toBeGreaterThan(0);
    expect(hunk.expandBelow!.length).toBeGreaterThan(0);
  });

  it("orders expandAbove blocks nearest-first", () => {
    const cs = parseDiff(DIFF, {
      id: "cs",
      fileContents: { "src/x.ts": FILE_TEXT },
    });
    const above = cs.files[0].hunks[0].expandAbove!;

    // Nearest block (index 0) should contain the line directly above the hunk.
    const nearestTexts = above[0].map((l) => l.text);
    expect(nearestTexts).toContain("");
    // The block immediately above includes the blank line at line 6 and any
    // non-blank line just above it.
    const nearestNewNos = above[0].map((l) => l.newNo);
    expect(Math.max(...(nearestNewNos as number[]))).toBe(6);
  });

  it("breaks blocks at blank lines", () => {
    const cs = parseDiff(DIFF, {
      id: "cs",
      fileContents: { "src/x.ts": FILE_TEXT },
    });
    const below = cs.files[0].hunks[0].expandBelow!;

    // First below-block should end on the next blank line (line 10), which
    // means the block's last text is "" and following lines live in the next
    // block.
    const firstBlockLast = below[0][below[0].length - 1];
    expect(firstBlockLast.text).toBe("");
    expect(below.length).toBeGreaterThan(1);
  });

  it("populates fullContent splicing hunk lines into post-change file", () => {
    const cs = parseDiff(DIFF, {
      id: "cs",
      fileContents: { "src/x.ts": FILE_TEXT },
    });
    const full = cs.files[0].fullContent!;

    // Should contain the deletion line from the hunk.
    const dels = full.filter((l) => l.kind === "del").map((l) => l.text);
    expect(dels).toContain("function beta() {");

    // Should contain the addition line from the hunk.
    const adds = full.filter((l) => l.kind === "add").map((l) => l.text);
    expect(adds).toContain("function beta() { // updated");

    // Surrounding context lines from the file should appear unchanged.
    const contextTexts = full
      .filter((l) => l.kind === "context")
      .map((l) => l.text);
    expect(contextTexts).toContain("// header");
    expect(contextTexts).toContain("function alpha() {");
    expect(contextTexts).toContain("// footer");
  });

  it("does not derive context for files without postChangeText", () => {
    const cs = parseDiff(DIFF, { id: "cs" });
    const hunk = cs.files[0].hunks[0];
    expect(hunk.expandAbove).toBeUndefined();
    expect(hunk.expandBelow).toBeUndefined();
    expect(cs.files[0].fullContent).toBeUndefined();
  });

  it("skips deleted files", () => {
    const deletedDiff = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-removed",
    ].join("\n");
    const cs = parseDiff(deletedDiff, {
      id: "cs",
      fileContents: { "src/gone.ts": "removed\n" },
    });
    const file = cs.files[0];
    expect(file.status).toBe("deleted");
    expect(file.fullContent).toBeUndefined();
    expect(file.hunks[0].expandAbove).toBeUndefined();
  });

  it("emits no expand blocks when the hunk covers the whole file", () => {
    const tinyDiff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const cs = parseDiff(tinyDiff, {
      id: "cs",
      fileContents: { "x.ts": "new\n" },
    });
    const hunk = cs.files[0].hunks[0];
    expect(hunk.expandAbove).toEqual([]);
    expect(hunk.expandBelow).toEqual([]);
  });
});
