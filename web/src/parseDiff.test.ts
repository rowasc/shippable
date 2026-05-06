import { describe, expect, it } from "vitest";
import { parseDiff } from "./parseDiff";

// Tests are derived from docs/concepts/diff-ingestion.md and the JSDoc on
// parseDiff. Each `describe` is one section of the spec; each `it` is one
// observable behavior with concrete I/O.

describe("parseDiff — file boundary detection", () => {
  it("treats a `diff --git a/x b/y` header as a new file", () => {
    const text = [
      "diff --git a/foo.ts b/foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].path).toBe("foo.ts");
  });

  it("accepts a bare `--- / +++` pair with no `diff --git` line", () => {
    const text = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].path).toBe("foo.ts");
  });

  it("accepts an `Index: x` header as a file boundary", () => {
    const text = [
      "Index: foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].path).toBe("foo.ts");
  });

  it("splits a multi-file diff into one DiffFile per header", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");
    const cs = parseDiff(text);
    expect(cs.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("parseDiff — path extraction", () => {
  it("strips the `a/` prefix from `--- a/foo/bar.ts`", () => {
    const cs = parseDiff(
      [
        "--- a/foo/bar.ts",
        "+++ b/foo/bar.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].path).toBe("foo/bar.ts");
  });

  it("strips a trailing `\\t<timestamp>` from a path", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts\t2026-04-22 10:00:00.000",
        "+++ b/foo.ts\t2026-04-22 10:00:01.000",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].path).toBe("foo.ts");
  });

  it("falls back to `diff --git` paths when `---/+++` are absent", () => {
    // Some diff tools emit pure-mode-change blocks; we still want a file
    // entry if a hunk is present.
    const cs = parseDiff(
      [
        "diff --git a/foo.ts b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0].path).toBe("foo.ts");
  });

  it("prefers the new path when --- and +++ disagree", () => {
    const cs = parseDiff(
      [
        "--- a/old-name.ts",
        "+++ b/new-name.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].path).toBe("new-name.ts");
  });
});

describe("parseDiff — file status", () => {
  it("marks `new file mode` as added", () => {
    const cs = parseDiff(
      [
        "diff --git a/foo.ts b/foo.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/foo.ts",
        "@@ -0,0 +1,1 @@",
        "+hello",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("added");
  });

  it("marks `deleted file mode` as deleted", () => {
    const cs = parseDiff(
      [
        "diff --git a/foo.ts b/foo.ts",
        "deleted file mode 100644",
        "--- a/foo.ts",
        "+++ /dev/null",
        "@@ -1,1 +0,0 @@",
        "-hello",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("deleted");
  });

  it("marks `--- /dev/null` as added even without a mode line", () => {
    const cs = parseDiff(
      [
        "--- /dev/null",
        "+++ b/foo.ts",
        "@@ -0,0 +1,1 @@",
        "+hello",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("added");
  });

  it("marks `+++ /dev/null` as deleted", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ /dev/null",
        "@@ -1,1 +0,0 @@",
        "-hello",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("deleted");
  });

  it("treats `rename from / rename to` as a renamed file", () => {
    const cs = parseDiff(
      [
        "diff --git a/old.ts b/new.ts",
        "similarity index 90%",
        "rename from old.ts",
        "rename to new.ts",
        "--- a/old.ts",
        "+++ b/new.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("renamed");
    expect(cs.files[0].path).toBe("new.ts");
  });

  it("defaults to `modified` when no add/delete/rename markers are present", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].status).toBe("modified");
  });
});

describe("parseDiff — hunk header parsing", () => {
  it("parses `@@ -10,5 +12,7 @@` into oldStart/oldCount/newStart/newCount", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -10,5 +12,7 @@ inSomeFn",
        " a",
        " b",
        " c",
        " d",
        " e",
        "+f",
        "+g",
      ].join("\n"),
    );
    const h = cs.files[0].hunks[0];
    expect(h.oldStart).toBe(10);
    expect(h.oldCount).toBe(5);
    expect(h.newStart).toBe(12);
    expect(h.newCount).toBe(7);
  });

  it("defaults old/new counts to 1 when the header omits them", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -10 +12 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    const h = cs.files[0].hunks[0];
    expect(h.oldCount).toBe(1);
    expect(h.newCount).toBe(1);
  });

  it("preserves the hunk header line verbatim", () => {
    const header = "@@ -10,5 +12,7 @@ function foo()";
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        header,
        " a",
        " b",
        " c",
        " d",
        " e",
        "+f",
        "+g",
      ].join("\n"),
    );
    expect(cs.files[0].hunks[0].header).toBe(header);
  });

  it("collects multiple hunks per file in order with incrementing ids", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-a",
        "+A",
        "@@ -10,1 +10,1 @@",
        "-b",
        "+B",
      ].join("\n"),
      { id: "cs1" },
    );
    const hunks = cs.files[0].hunks;
    expect(hunks).toHaveLength(2);
    expect(hunks[0].id).toBe("cs1/foo.ts#h1");
    expect(hunks[1].id).toBe("cs1/foo.ts#h2");
  });
});

describe("parseDiff — line kinds and numbering", () => {
  it("marks ` ` (space) lines as context with both oldNo and newNo", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -10,1 +20,1 @@",
        " ctx",
      ].join("\n"),
    );
    const line = cs.files[0].hunks[0].lines[0];
    expect(line).toEqual({ kind: "context", text: "ctx", oldNo: 10, newNo: 20 });
  });

  it("marks `+` lines as add with newNo only", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -0,0 +5,1 @@",
        "+added",
      ].join("\n"),
    );
    const line = cs.files[0].hunks[0].lines[0];
    expect(line).toEqual({ kind: "add", text: "added", newNo: 5 });
    expect(line.oldNo).toBeUndefined();
  });

  it("marks `-` lines as del with oldNo only", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -7,1 +0,0 @@",
        "-removed",
      ].join("\n"),
    );
    const line = cs.files[0].hunks[0].lines[0];
    expect(line).toEqual({ kind: "del", text: "removed", oldNo: 7 });
    expect(line.newNo).toBeUndefined();
  });

  it("increments oldNo/newNo correctly across mixed line kinds", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -10,3 +20,3 @@",
        " a", // ctx: old=10 new=20
        "-b", // del: old=11
        "+B", // add: new=21
        " c", // ctx: old=12 new=22
      ].join("\n"),
    );
    const lines = cs.files[0].hunks[0].lines;
    expect(lines[0]).toMatchObject({ kind: "context", oldNo: 10, newNo: 20 });
    expect(lines[1]).toMatchObject({ kind: "del", oldNo: 11 });
    expect(lines[2]).toMatchObject({ kind: "add", newNo: 21 });
    expect(lines[3]).toMatchObject({ kind: "context", oldNo: 12, newNo: 22 });
  });

  it("skips `\\ No newline at end of file` pseudo-lines", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
      ].join("\n"),
    );
    const kinds = cs.files[0].hunks[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(["del", "add"]);
  });

  it("skips empty trailing lines inside a hunk", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    );
    expect(cs.files[0].hunks[0].lines).toHaveLength(2);
  });
});

describe("parseDiff — language guessing", () => {
  it.each([
    ["foo.ts", "ts"],
    ["foo.tsx", "tsx"],
    ["foo.js", "js"],
    ["foo.py", "python"],
    ["foo.rs", "rust"],
    ["foo.md", "markdown"],
    ["foo.php", "php"],
  ])("maps %s to language %s", (path, lang) => {
    const cs = parseDiff(
      [
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].language).toBe(lang);
  });

  it("falls back to `text` for unknown extensions", () => {
    const cs = parseDiff(
      [
        "--- a/notes.xyz",
        "+++ b/notes.xyz",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].language).toBe("text");
  });

  it("falls back to `text` for files with no extension", () => {
    const cs = parseDiff(
      [
        "--- a/Makefile",
        "+++ b/Makefile",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].language).toBe("text");
  });

  it("matches case-insensitively (FOO.TS → ts)", () => {
    const cs = parseDiff(
      [
        "--- a/FOO.TS",
        "+++ b/FOO.TS",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.files[0].language).toBe("ts");
  });
});

describe("parseDiff — diff-scoped graph extraction", () => {
  it("derives symbol metadata and file edges from local imports", () => {
    const cs = parseDiff(
      [
        "diff --git a/src/utils.ts b/src/utils.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/utils.ts",
        "@@ -0,0 +1,3 @@",
        "+export function buildPlanDiagram() {",
        "+  return 'ok';",
        "+}",
        "diff --git a/src/view.ts b/src/view.ts",
        "--- a/src/view.ts",
        "+++ b/src/view.ts",
        "@@ -1,1 +1,3 @@",
        "+import { buildPlanDiagram } from './utils';",
        " export function render() {",
        "+  return buildPlanDiagram();",
        " }",
      ].join("\n"),
      { id: "cs-graph" },
    );

    expect(cs.graph?.scope).toBe("diff");
    expect(cs.graph?.edges).toContainEqual({
      fromPath: "src/utils.ts",
      toPath: "src/view.ts",
      labels: ["buildPlanDiagram"],
      kind: "symbol",
    });
    expect(cs.files[0].hunks[0].definesSymbols).toEqual(["buildPlanDiagram"]);
    expect(cs.files[1].hunks[0].referencesSymbols).toEqual(["buildPlanDiagram"]);
  });

  it("creates file-level import edges when the target has no named symbol match", () => {
    const cs = parseDiff(
      [
        "diff --git a/src/theme.css b/src/theme.css",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/theme.css",
        "@@ -0,0 +1,1 @@",
        "+:root { color-scheme: light; }",
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,1 +1,2 @@",
        "+import './theme.css';",
        " export const app = true;",
      ].join("\n"),
      { id: "cs-css" },
    );

    expect(cs.graph?.edges).toContainEqual({
      fromPath: "src/theme.css",
      toPath: "src/app.ts",
      labels: ["theme"],
      kind: "import",
    });
  });
});

describe("parseDiff — ChangeSet shape and meta", () => {
  it("preserves meta.id, meta.title, meta.author, meta.head/base", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
      { id: "abc", title: "My change", author: "alice", base: "main", head: "feat" },
    );
    expect(cs.id).toBe("abc");
    expect(cs.title).toBe("My change");
    expect(cs.author).toBe("alice");
    expect(cs.base).toBe("main");
    expect(cs.branch).toBe("feat");
  });

  it("infers title `empty changeset` when no files parsed", () => {
    const cs = parseDiff("");
    expect(cs.title).toBe("empty changeset");
  });

  it("infers title to the single file path when only one file", () => {
    const cs = parseDiff(
      [
        "--- a/only.ts",
        "+++ b/only.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.title).toBe("only.ts");
  });

  it("infers title `<first> and N other(s)` for multi-file diffs", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/c.ts b/c.ts",
      "--- a/c.ts",
      "+++ b/c.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");
    expect(parseDiff(text).title).toBe("a.ts and 2 others");
  });

  it("uses singular `other` for exactly two files", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");
    expect(parseDiff(text).title).toBe("a.ts and 1 other");
  });

  it("defaults author to `unknown` and base/head to `base`/`head`", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
    );
    expect(cs.author).toBe("unknown");
    expect(cs.base).toBe("base");
    expect(cs.branch).toBe("head");
  });

  it("emits an ISO-8601 createdAt timestamp", () => {
    const cs = parseDiff("");
    expect(cs.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(cs.createdAt).toISOString()).not.toThrow();
  });

  it("scopes file ids with the changeset id", () => {
    const cs = parseDiff(
      [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,1 +1,1 @@",
        "-x",
        "+y",
      ].join("\n"),
      { id: "cs42" },
    );
    expect(cs.files[0].id).toBe("cs42/foo.ts");
  });
});

describe("parseDiff — robustness / partial parse", () => {
  it("returns an empty ChangeSet for empty input without throwing", () => {
    const cs = parseDiff("");
    expect(cs.files).toEqual([]);
  });

  it("returns an empty ChangeSet for non-diff garbage without throwing", () => {
    const cs = parseDiff("hello world\nthis is not a diff\n");
    expect(cs.files).toEqual([]);
  });

  it("skips a header-only entry with no hunks (e.g. mode-change-only)", () => {
    // diff --git block exists but no `@@` follows — should be dropped, not
    // emitted as an empty file.
    const cs = parseDiff(
      [
        "diff --git a/foo.ts b/foo.ts",
        "old mode 100644",
        "new mode 100755",
      ].join("\n"),
    );
    expect(cs.files).toEqual([]);
  });

  it("accepts CRLF line endings", () => {
    const text = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\r\n");
    const cs = parseDiff(text);
    expect(cs.files[0].hunks[0].lines.map((l) => l.kind)).toEqual(["del", "add"]);
  });
});
