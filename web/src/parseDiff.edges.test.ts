import { describe, expect, it } from "vitest";
import { parseDiff } from "./parseDiff";

// Real-world diff shapes captured with `git diff` against a scratch repo.
// Each test names the bug class it guards against on the `it` line.

describe("parseDiff — edge inputs from real `git diff`", () => {
  // Bug class: parser crashes on a binary diff, or surfaces a phantom file
  // with empty hunks that would render as an empty pane in the UI.
  it("drops a binary diff (no `@@` lines) without throwing or emitting a phantom file", () => {
    const text = [
      "diff --git a/image.png b/image.png",
      "index e5d1ed1..cd60896 100644",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toEqual([]);
  });

  // Bug class: a pure `git mv` (rename, no content change) is silently
  // dropped because the "no hunks" guard was widened past `modified`.
  it("emits a pure rename as a `renamed` file with the new path and zero hunks", () => {
    const text = [
      "diff --git a/stable.txt b/renamed.txt",
      "similarity index 100%",
      "rename from stable.txt",
      "rename to renamed.txt",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0]).toMatchObject({
      path: "renamed.txt",
      status: "renamed",
      hunks: [],
    });
  });

  // Bug class: rename-with-edit headers (`similarity index`, `index abc..def`,
  // `rename from/to`) confuse the header walker, dropping the new path or
  // resetting hunk line numbers that don't start at 1.
  it("preserves the new path, status, and hunk line numbers for a rename + edit", () => {
    const text = [
      "diff --git a/big.txt b/big_renamed.txt",
      "similarity index 89%",
      "rename from big.txt",
      "rename to big_renamed.txt",
      "index 4083766..fa74a28 100644",
      "--- a/big.txt",
      "+++ b/big_renamed.txt",
      "@@ -8,3 +8,4 @@ line7",
      " line8",
      " line9",
      " line10",
      "+line11",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files[0]).toMatchObject({
      path: "big_renamed.txt",
      status: "renamed",
    });
    const h = cs.files[0].hunks[0];
    expect(h.oldStart).toBe(8);
    expect(h.newStart).toBe(8);
    expect(h.lines.at(-1)).toMatchObject({
      kind: "add",
      text: "line11",
      newNo: 11,
    });
  });

  // Bug class: a `new file mode` entry with no `@@` (an empty file added) is
  // silently dropped, so reviewers never learn the file appeared.
  it("emits an empty-file addition as `added` with zero hunks", () => {
    const text = [
      "diff --git a/empty.txt b/empty.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0]).toMatchObject({
      path: "empty.txt",
      status: "added",
      hunks: [],
    });
  });

  // Bug class: the `\ No newline at end of file` pseudo-line stops being
  // skipped — the parser either treats it as content (phantom line in the
  // hunk body) or breaks the hunk loop early and loses the `+` line that
  // follows it.
  it("skips a mid-hunk `\\ No newline` marker and still parses the line that follows", () => {
    const text = [
      "diff --git a/nonl.txt b/nonl.txt",
      "--- a/nonl.txt",
      "+++ b/nonl.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      " two",
      "-three",
      "\\ No newline at end of file",
      "+three",
    ].join("\n");
    const cs = parseDiff(text);
    const lines = cs.files[0].hunks[0].lines;
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatchObject({ kind: "del", text: "three", oldNo: 3 });
    expect(lines[3]).toMatchObject({ kind: "add", text: "three", newNo: 3 });
    expect(lines.some((l) => l.text.includes("No newline"))).toBe(false);
  });

  // Bug class: in a fully deleted file, `-` lines lose their oldNo
  // numbering or pick up a stray newNo (regressions invisible in the
  // existing one-line `+++ /dev/null` test).
  it("numbers every line of a fully-deleted file as `del` with oldNo only", () => {
    const text = [
      "diff --git a/tobedeleted.txt b/tobedeleted.txt",
      "deleted file mode 100644",
      "index 2063a38..0000000",
      "--- a/tobedeleted.txt",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-keep1",
      "-keep2",
      "-keep3",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files[0].status).toBe("deleted");
    const lines = cs.files[0].hunks[0].lines;
    expect(lines).toEqual([
      { kind: "del", text: "keep1", oldNo: 1 },
      { kind: "del", text: "keep2", oldNo: 2 },
      { kind: "del", text: "keep3", oldNo: 3 },
    ]);
  });
});
