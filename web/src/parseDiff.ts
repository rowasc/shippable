import { buildDiffCodeGraph } from "./codeGraph";
import { enrichWithFileContent } from "./expandContext";
import type { ChangeSet, CodeGraph, DiffFile, DiffLine, FileStatus, Hunk } from "./types";

/**
 * Parse a unified-diff text (git-style or plain) into a ChangeSet.
 *
 * Handles:
 *  - `diff --git a/x b/y` file boundaries, or bare `--- / +++` pairs
 *  - `new file mode` / `deleted file mode` / rename detection
 *  - One or more `@@ -a,b +c,d @@ …` hunks per file
 *  - context / add / del lines
 *
 * Does not yet handle: binary diffs, combined-merge diffs, copy detection.
 * Unknown lines are skipped rather than throwing, so malformed-ish input
 * still produces a partial result useful for review.
 */
export function parseDiff(
  text: string,
  meta: {
    id: string;
    title?: string;
    author?: string;
    base?: string;
    head?: string;
    /**
     * Optional repo-relative path → post-change file content. When a parsed
     * DiffFile's path matches a key here, the content is attached as
     * `postChangeText` so surfaces like the markdown preview can render the
     * full file. Files not in the map are unaffected.
     */
    fileContents?: Record<string, string>;
    /** Optional pre-computed graph, usually from a worktree-backed endpoint. */
    graph?: CodeGraph;
  } = {
    id: "loaded",
  },
): ChangeSet {
  const parsedFiles: DiffFile[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("Index: ")
    ) {
      const { file, next } = parseFile(lines, i, meta.id);
      if (file) {
        const extra = meta.fileContents?.[file.path];
        const withText = extra ? { ...file, postChangeText: extra } : file;
        parsedFiles.push(extra ? enrichWithFileContent(withText, extra) : withText);
      }
      i = next;
    } else {
      i++;
    }
  }

  const enriched = buildDiffCodeGraph(parsedFiles);
  const files = enriched.files;
  const graph = meta.graph ?? enriched.graph;

  return {
    id: meta.id,
    title: meta.title ?? inferTitle(files),
    author: meta.author ?? "unknown",
    branch: meta.head ?? "head",
    base: meta.base ?? "base",
    createdAt: new Date().toISOString(),
    description: "",
    files,
    graph,
  };
}

function inferTitle(files: DiffFile[]): string {
  if (files.length === 0) return "empty changeset";
  if (files.length === 1) return files[0].path;
  return `${files[0].path} and ${files.length - 1} other${
    files.length - 1 === 1 ? "" : "s"
  }`;
}

function parseFile(
  lines: string[],
  start: number,
  csId: string,
): { file: DiffFile | null; next: number } {
  let i = start;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let status: FileStatus = "modified";

  // Walk the file header until we hit the first hunk (@@) or a new file
  // boundary.
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("@@ ")) break;
    if (
      i > start &&
      (l.startsWith("diff --git ") || l.startsWith("Index: "))
    )
      break;

    if (l.startsWith("diff --git ")) {
      // "diff --git a/foo b/bar" — use as fallback paths
      const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) {
        oldPath = m[1];
        newPath = m[2];
      }
    } else if (l.startsWith("--- ")) {
      const p = stripPath(l.slice(4));
      if (p !== "/dev/null") oldPath = p;
      else {
        oldPath = null;
        status = "added";
      }
    } else if (l.startsWith("+++ ")) {
      const p = stripPath(l.slice(4));
      if (p !== "/dev/null") newPath = p;
      else {
        newPath = null;
        status = "deleted";
      }
    } else if (l.startsWith("new file mode")) {
      status = "added";
    } else if (l.startsWith("deleted file mode")) {
      status = "deleted";
    } else if (l.startsWith("rename from ")) {
      status = "renamed";
      oldPath = l.slice("rename from ".length);
    } else if (l.startsWith("rename to ")) {
      newPath = l.slice("rename to ".length);
    }
    i++;
  }

  const path = newPath ?? oldPath;
  if (!path) return { file: null, next: i };

  const hunks: Hunk[] = [];
  while (i < lines.length && lines[i].startsWith("@@ ")) {
    const { hunk, next } = parseHunk(lines, i, csId, path, hunks.length);
    if (hunk) hunks.push(hunk);
    i = next;
  }

  if (hunks.length === 0 && status === "modified") {
    // Header-only entries (mode changes etc.) — skip.
    return { file: null, next: i };
  }

  return {
    file: {
      id: `${csId}/${path}`,
      path,
      language: guessLanguage(path),
      status,
      hunks,
    },
    next: i,
  };
}

function stripPath(raw: string): string {
  // " a/foo/bar.ts\t2026-04-22" → "foo/bar.ts"
  const untabbed = raw.split("\t")[0].trim();
  if (untabbed.startsWith("a/") || untabbed.startsWith("b/")) {
    return untabbed.slice(2);
  }
  return untabbed;
}

function parseHunk(
  lines: string[],
  start: number,
  csId: string,
  path: string,
  hunkIdx: number,
): { hunk: Hunk | null; next: number } {
  const header = lines[start];
  const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!m) return { hunk: null, next: start + 1 };

  const oldStart = +m[1];
  const oldCount = m[2] ? +m[2] : 1;
  const newStart = +m[3];
  const newCount = m[4] ? +m[4] : 1;

  let i = start + 1;
  const body: DiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;

  while (i < lines.length) {
    const l = lines[i];
    if (
      l.startsWith("@@ ") ||
      l.startsWith("diff --git ") ||
      l.startsWith("--- ") ||
      l.startsWith("Index: ")
    )
      break;

    if (l.startsWith("\\ ")) {
      // "\ No newline at end of file" — skip the pseudo-line.
      i++;
      continue;
    }

    const ch = l[0];
    const text = l.slice(1);

    if (ch === "+") {
      body.push({ kind: "add", text, newNo });
      newNo++;
    } else if (ch === "-") {
      body.push({ kind: "del", text, oldNo });
      oldNo++;
    } else if (ch === " ") {
      body.push({ kind: "context", text, oldNo, newNo });
      oldNo++;
      newNo++;
    } else {
      // Unknown prefix — treat as end-of-hunk.
      break;
    }
    i++;
  }

  return {
    hunk: {
      id: `${csId}/${path}#h${hunkIdx + 1}`,
      header,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: body,
    },
    next: i,
  };
}

export function guessLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    py: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    html: "html",
    css: "css",
    php: "php",
  };
  return map[ext] ?? "text";
}
