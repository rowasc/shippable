import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

// PROTOTYPE: thin wrapper around `git worktree list --porcelain` and
// `git show`. Production hardening is needed before this ships outside dev:
//   - tighter path validation (realpath + allowed-roots list),
//   - per-IP rate limits,
//   - a max-output cap on `git show` (very large commits could OOM),
//   - explicit user consent / picker for the directory rather than a free-form
//     text input.

const execFileAsync = promisify(execFile);

// Resolve `git` once at module load so a later $PATH change can't redirect us
// to a different binary. Falls back to bare "git" if the lookup fails.
const GIT = resolveGit();

function resolveGit(): string {
  const envPath = process.env.PATH ?? "";
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "git");
    try {
      const st = fsSync.statSync(candidate);
      if (!st.isFile()) continue;
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      // try next entry
    }
  }
  return "git";
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

export interface ListResult {
  worktrees: Worktree[];
}

export interface ChangesetResult {
  diff: string;
  sha: string;
  subject: string;
  author: string;
  date: string;
  branch: string | null;
  /**
   * Display label rendered in the topbar after `<branch> → `. May be a
   * short-sha (when the branch has diverged from a base ref), the literal
   * string "working tree" (when the branch is at parity with its base and
   * the diff is uncommitted-only), or null (no base ref could be resolved
   * — caller falls back to a placeholder).
   */
  parentSha: string | null;
  /**
   * Post-change content for files the frontend can render specially —
   * currently markdown files for the preview pane. Keys are repo-relative
   * paths matching the `+++ b/<path>` lines in the diff. Files deleted in
   * this commit are omitted (no post-change content exists). Files large
   * enough to fail the per-file maxBuffer are also skipped silently rather
   * than failing the whole request.
   */
  fileContents: Record<string, string>;
}

/**
 * Validate that `dir` is an absolute path that exists, is a directory, and
 * contains a `.git` entry (file for worktrees, dir for the main repo).
 * Throws a user-facing Error on failure.
 *
 * Prototype-grade: doesn't follow symlinks defensively, doesn't enforce an
 * allowed-roots list. Sufficient for a local-only dev tool; revisit before
 * exposing to untrusted callers.
 */
async function assertGitDir(dir: string): Promise<void> {
  if (typeof dir !== "string" || dir.length === 0) {
    throw new Error("dir must be a non-empty string");
  }
  if (!path.isAbsolute(dir)) {
    throw new Error(`dir must be an absolute path, got: ${dir}`);
  }
  // Quick traversal sanity check — path.isAbsolute on darwin already rejects
  // most weirdness, but explicitly bail on `..` segments anyway.
  if (dir.split(path.sep).includes("..")) {
    throw new Error("dir must not contain '..' segments");
  }
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new Error(`dir does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`dir is not a directory: ${dir}`);
  }
  // `.git` is a directory in the main repo and a file (`gitdir: …`) in
  // worktrees — accept either.
  try {
    await fs.stat(path.join(dir, ".git"));
  } catch {
    throw new Error(`dir does not look like a git repo (no .git entry): ${dir}`);
  }
}

/**
 * Run `git worktree list --porcelain` in `dir` and parse the output.
 * The porcelain format groups each worktree as a block of `key value` lines
 * separated by blank lines. Keys we care about: worktree, HEAD, branch,
 * bare, detached.
 */
export async function listWorktrees(dir: string): Promise<ListResult> {
  await assertGitDir(dir);
  const { stdout } = await execFileAsync(
    GIT,
    ["worktree", "list", "--porcelain"],
    { cwd: dir, maxBuffer: 4 * 1024 * 1024 },
  );

  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> & { detached?: boolean } = {};
  const flush = () => {
    if (current.path && current.head) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head,
        isMain: worktrees.length === 0, // git lists the main worktree first
      });
    }
    current = {};
  };

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    const sp = line.indexOf(" ");
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? "" : line.slice(sp + 1);
    if (key === "worktree") current.path = value;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") {
      // value is like `refs/heads/feature-x` — strip the prefix for display.
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "detached") current.detached = true;
  }
  flush();

  return { worktrees };
}

/**
 * Return the latest commit on `path` (default HEAD) as a unified diff plus
 * metadata. Uses `git show --format=… --patch` and parses the trailing
 * metadata block we ask for.
 */
export async function changesetFor(
  worktreePath: string,
  ref: string = "HEAD",
): Promise<ChangesetResult> {
  await assertGitDir(worktreePath);
  // Restrict ref to a conservative shape: HEAD, HEAD~N, branch names, sha.
  // Refuses anything with shell metacharacters or whitespace. The leading-`-`
  // check is a belt-and-suspenders guard against option-as-ref attacks; the
  // `--end-of-options` separator below is the primary defense.
  if (ref.startsWith("-")) {
    throw new Error(`ref must not start with '-': ${ref}`);
  }
  if (!/^[A-Za-z0-9_./~^@-]{1,200}$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }

  // Use a delimiter that's vanishingly unlikely to occur in commit metadata
  // so we can split metadata from the diff body cleanly. %P is the
  // space-separated list of parent SHAs — empty for the very first commit
  // on a branch.
  const SEP = "<<<SHIPPABLE-WT-SEP>>>";
  const fmt = `%H%n%s%n%an <%ae>%n%aI%n%P%n${SEP}`;
  const { stdout } = await execFileAsync(
    GIT,
    ["show", `--format=${fmt}`, "--patch", "--end-of-options", ref],
    { cwd: worktreePath, maxBuffer: 32 * 1024 * 1024 },
  );

  const sepIdx = stdout.indexOf(SEP);
  if (sepIdx === -1) {
    throw new Error("git show output missing separator — unexpected format");
  }
  const meta = stdout.slice(0, sepIdx).split("\n");
  // Skip the newline that follows SEP.
  const diff = stdout.slice(sepIdx + SEP.length).replace(/^\n/, "");
  const [sha = "", subject = "", author = "", date = "", parentsRaw = ""] =
    meta;
  const firstParent = parentsRaw.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const parentSha = firstParent ? firstParent.slice(0, 7) : null;

  // Resolve the branch name for the worktree (best effort; detached heads
  // return an empty string).
  let branch: string | null = null;
  try {
    const { stdout: br } = await execFileAsync(
      GIT,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: worktreePath },
    );
    const trimmed = br.trim();
    branch = trimmed && trimmed !== "HEAD" ? trimmed : null;
  } catch {
    branch = null;
  }

  // Pull post-change content for markdown files in the diff so the frontend
  // preview can render them. Best effort: a single failure (e.g. deleted file
  // or oversized blob) is logged and skipped rather than aborting the whole
  // request.
  const fileContents: Record<string, string> = {};
  for (const p of extractRenderablePaths(diff)) {
    try {
      const { stdout: content } = await execFileAsync(
        GIT,
        ["show", "--end-of-options", `${sha}:${p}`],
        { cwd: worktreePath, maxBuffer: 4 * 1024 * 1024 },
      );
      fileContents[p] = content;
    } catch {
      // File may not exist at this ref (deleted) or content exceeds buffer —
      // omit and let the frontend fall back to raw-source view.
    }
  }

  return { diff, sha, subject, author, date, branch, parentSha, fileContents };
}

/**
 * "Branch view" of a worktree: cumulative diff of *all* the work this branch
 * represents — committed since divergence from main/upstream, plus tracked
 * uncommitted changes, plus untracked-but-not-ignored files. This is the
 * default for the LoadModal because reviewers thinking "what does this
 * worktree contain?" expect everything in flight, not just the latest commit.
 *
 * Base resolution attempts in order: `@{upstream}`, `origin/main`,
 * `origin/master`, `main`, `master`. When none resolve, the diff is empty
 * (branch is at parity and has no work-in-progress).
 *
 * Untracked files are synthesised as new-file diffs because `git diff
 * --no-index` doesn't always emit the `a/`/`b/` prefixes parseDiff expects;
 * synthesising keeps the diff parser predictable. Binary detection uses a
 * NUL-byte heuristic in the first 8KB.
 */
export async function branchChangeset(
  worktreePath: string,
): Promise<ChangesetResult> {
  await assertGitDir(worktreePath);

  const headSha = (
    await execFileAsync(GIT, ["rev-parse", "HEAD"], { cwd: worktreePath })
  ).stdout.trim();

  // Pull HEAD's metadata for display. Subject/author/date describe the latest
  // commit even when most of the diff is uncommitted — best we can do without
  // a richer "many commits + dirty tree" UI.
  const SEP = "<<<SHIPPABLE-WT-SEP>>>";
  const fmt = `%s%n%an <%ae>%n%aI%n${SEP}`;
  const { stdout: metaOut } = await execFileAsync(
    GIT,
    ["log", "-1", `--format=${fmt}`, "--end-of-options", headSha],
    { cwd: worktreePath },
  );
  const sepIdx = metaOut.indexOf(SEP);
  const meta = sepIdx >= 0 ? metaOut.slice(0, sepIdx).split("\n") : [];
  const [subject = "", author = "", date = ""] = meta;

  let branch: string | null = null;
  try {
    const { stdout: br } = await execFileAsync(
      GIT,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: worktreePath },
    );
    const trimmed = br.trim();
    branch = trimmed && trimmed !== "HEAD" ? trimmed : null;
  } catch {
    branch = null;
  }

  const baseRef = await resolveBaseRef(worktreePath);
  const mergeBase = baseRef ? await resolveMergeBase(worktreePath, baseRef, headSha) : null;
  const effectiveBase = mergeBase ?? null;

  // Tracked diff: cumulative committed-since-base + uncommitted-tracked.
  // `git diff <base>` (no `..HEAD`) compares base to working tree.
  let trackedDiff = "";
  if (effectiveBase) {
    trackedDiff = await safeGitDiff(
      ["diff", "--end-of-options", effectiveBase],
      worktreePath,
    );
  }

  // Untracked: synthesise new-file diffs so parseDiff handles them uniformly.
  let untrackedDiff = "";
  try {
    const { stdout: untrackedList } = await execFileAsync(
      GIT,
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: worktreePath, maxBuffer: 4 * 1024 * 1024 },
    );
    const files = untrackedList.split("\n").filter(Boolean);
    for (const rel of files) {
      try {
        const synth = await synthesiseNewFileDiff(worktreePath, rel);
        if (synth) untrackedDiff += synth;
      } catch {
        // Unreadable / binary / vanished — skip rather than fail the request.
      }
    }
  } catch {
    // ls-files failure is non-fatal; tracked diff is still useful.
  }

  const diff = trackedDiff + untrackedDiff;

  // Post-change content for markdown previews. Read from the working tree —
  // covers committed-changed, uncommitted-modified, and untracked-new in one
  // motion. Files that vanished are silently skipped.
  const fileContents: Record<string, string> = {};
  for (const p of extractRenderablePaths(diff)) {
    try {
      const content = await fs.readFile(path.join(worktreePath, p), "utf8");
      fileContents[p] = content;
    } catch {
      // missing / unreadable — frontend falls back to in-diff content
    }
  }

  // Topbar label for `<branch> → <base>`:
  //   - "working tree" when merge-base == HEAD (branch at parity, only
  //     uncommitted/untracked are interesting)
  //   - merge-base short-sha when the branch has diverged
  //   - null when no base could be resolved at all (no upstream/main/master)
  const baseLabel: string | null = effectiveBase
    ? effectiveBase === headSha
      ? "working tree"
      : effectiveBase.slice(0, 7)
    : null;

  return {
    diff,
    sha: headSha,
    subject: subject || "(no commit subject)",
    author,
    date,
    branch,
    parentSha: baseLabel,
    fileContents,
  };
}

async function resolveBaseRef(worktreePath: string): Promise<string | null> {
  const candidates = ["@{upstream}", "origin/main", "origin/master", "main", "master"];
  for (const c of candidates) {
    try {
      const { stdout } = await execFileAsync(
        GIT,
        ["rev-parse", "--verify", "--end-of-options", `${c}^{commit}`],
        { cwd: worktreePath },
      );
      const sha = stdout.trim();
      if (sha) return sha;
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveMergeBase(
  worktreePath: string,
  base: string,
  ref: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      GIT,
      ["merge-base", "--end-of-options", base, ref],
      { cwd: worktreePath },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Run git diff and tolerate exit code 1 (which `git diff` and
 * `git diff --no-index` use to signal "differences detected" — we want the
 * stdout in that case, not a thrown error).
 */
async function safeGitDiff(
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(GIT, args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const err = e as { code?: number; stdout?: string };
    if (err.code === 1 && typeof err.stdout === "string") return err.stdout;
    throw e;
  }
}

/**
 * Build a synthetic "new file" diff entry for an untracked file. Skips
 * files that look binary (NUL byte in first 8KB) and files larger than a
 * conservative cap — both kept out of the human-reviewable diff.
 */
async function synthesiseNewFileDiff(
  worktreePath: string,
  rel: string,
): Promise<string> {
  const abs = path.join(worktreePath, rel);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) return "";
  if (stat.size > 2 * 1024 * 1024) return ""; // conservative cap on huge new files
  const buf = await fs.readFile(abs);
  // Binary heuristic: NUL byte in the first 8KB.
  const probe = buf.subarray(0, Math.min(8192, buf.length));
  if (probe.includes(0)) return "";
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  // If the file ends with a trailing newline, split leaves an empty trailing
  // entry — drop it so the line count matches what reviewers expect.
  const hasTrailingNewline = text.endsWith("\n");
  if (hasTrailingNewline && lines[lines.length - 1] === "") lines.pop();
  const body = lines.map((l) => "+" + l).join("\n");
  const header =
    `diff --git a/${rel} b/${rel}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${rel}\n` +
    `@@ -0,0 +1,${lines.length} @@\n`;
  return header + body + (body.length > 0 ? "\n" : "");
}

/**
 * Pull repo-relative paths of files we want to ship post-change content for
 * (currently any `.md` file added or modified in the diff). Skips deletions
 * by ignoring `/dev/null` on the `+++` line.
 */
function extractRenderablePaths(diff: string): string[] {
  const out = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    if (line.includes("/dev/null")) continue;
    const m = /^\+\+\+ b\/(.+?)(?:\t.*)?$/.exec(line);
    if (!m) continue;
    const path = m[1];
    if (path.endsWith(".md")) out.add(path);
  }
  return Array.from(out);
}
