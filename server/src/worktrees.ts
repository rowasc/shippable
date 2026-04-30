import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

// PROTOTYPE: thin wrapper around `git worktree list --porcelain` and
// `git show`. Production hardening is needed before this ships outside dev:
//   - tighter path validation (symlink-following, allowed roots),
//   - per-IP rate limits,
//   - a max-output cap on `git show` (very large commits could OOM),
//   - explicit user consent / picker for the directory rather than a free-form
//     text input.

const execFileAsync = promisify(execFile);

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
    "git",
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
  // Refuses anything with shell metacharacters or whitespace.
  if (!/^[A-Za-z0-9_./~^@-]{1,200}$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }

  // Use a delimiter that's vanishingly unlikely to occur in commit metadata
  // so we can split metadata from the diff body cleanly.
  const SEP = "<<<SHIPPABLE-WT-SEP>>>";
  const fmt = `%H%n%s%n%an <%ae>%n%aI%n${SEP}`;
  const { stdout } = await execFileAsync(
    "git",
    ["show", `--format=${fmt}`, "--patch", ref],
    { cwd: worktreePath, maxBuffer: 32 * 1024 * 1024 },
  );

  const sepIdx = stdout.indexOf(SEP);
  if (sepIdx === -1) {
    throw new Error("git show output missing separator — unexpected format");
  }
  const meta = stdout.slice(0, sepIdx).split("\n");
  // Skip the newline that follows SEP.
  const diff = stdout.slice(sepIdx + SEP.length).replace(/^\n/, "");
  const [sha = "", subject = "", author = "", date = ""] = meta;

  // Resolve the branch name for the worktree (best effort; detached heads
  // return an empty string).
  let branch: string | null = null;
  try {
    const { stdout: br } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: worktreePath },
    );
    const trimmed = br.trim();
    branch = trimmed && trimmed !== "HEAD" ? trimmed : null;
  } catch {
    branch = null;
  }

  return { diff, sha, subject, author, date, branch };
}
