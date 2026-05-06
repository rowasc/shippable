import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { buildRepoCodeGraph, isGraphAnalyzablePath } from "../../web/src/codeGraph.ts";
import type { CodeGraph } from "../../web/src/types.ts";

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
   * Post-change content for files the frontend can render specially —
   * currently markdown files for the preview pane. Keys are repo-relative
   * paths matching the `+++ b/<path>` lines in the diff. Files deleted in
   * this commit are omitted (no post-change content exists). Files large
   * enough to fail the per-file maxBuffer are also skipped silently rather
   * than failing the whole request.
   */
  fileContents: Record<string, string>;
}

const MAX_REPO_GRAPH_FILES = 400;
const MAX_REPO_GRAPH_FILE_BYTES = 256 * 1024;

export type PickDirectoryResult =
  | { path: string }
  | { cancelled: true };

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

async function normalizeDefaultDirectory(
  startPath: string | undefined,
): Promise<string | null> {
  if (!startPath || !path.isAbsolute(startPath)) return null;
  try {
    const stat = await fs.stat(startPath);
    if (!stat.isDirectory()) return null;
    return startPath;
  } catch {
    return null;
  }
}

function toAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function pickDirectory(
  startPath?: string,
): Promise<PickDirectoryResult> {
  if (process.platform !== "darwin") {
    throw new Error("directory chooser is only wired up on macOS right now");
  }

  const defaultDir = await normalizeDefaultDirectory(startPath);
  const args: string[] = [];
  if (defaultDir) {
    args.push(
      "-e",
      `set chosenFolder to choose folder with prompt "Choose a local repo or worktrees folder" default location POSIX file "${toAppleScriptString(defaultDir)}"`,
    );
  } else {
    args.push(
      "-e",
      'set chosenFolder to choose folder with prompt "Choose a local repo or worktrees folder"',
    );
  }
  args.push("-e", "return POSIX path of chosenFolder");

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", args, {
      maxBuffer: 128 * 1024,
    });
    const chosen = stdout.trim();
    if (!chosen) {
      throw new Error("folder chooser returned an empty path");
    }
    return { path: chosen };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("User canceled") ||
      message.includes("User cancelled") ||
      message.includes("(-128)")
    ) {
      return { cancelled: true };
    }
    throw err;
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
  validateRef(ref);

  // Use a delimiter that's vanishingly unlikely to occur in commit metadata
  // so we can split metadata from the diff body cleanly.
  const SEP = "<<<SHIPPABLE-WT-SEP>>>";
  const fmt = `%H%n%s%n%an <%ae>%n%aI%n${SEP}`;
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
  const [sha = "", subject = "", author = "", date = ""] = meta;

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

  return { diff, sha, subject, author, date, branch, fileContents };
}

export async function repoGraphFor(
  worktreePath: string,
  ref: string = "HEAD",
): Promise<CodeGraph> {
  await assertGitDir(worktreePath);
  validateRef(ref);

  const { stdout } = await execFileAsync(
    GIT,
    ["ls-tree", "-r", "-z", "--name-only", "--full-tree", "--end-of-options", ref],
    { cwd: worktreePath, maxBuffer: 8 * 1024 * 1024 },
  );

  const paths = stdout
    .split("\0")
    .filter((value) => value.length > 0)
    .filter(isGraphAnalyzablePath)
    .slice(0, MAX_REPO_GRAPH_FILES);

  const sources: Array<{ path: string; text: string }> = [];
  for (const filePath of paths) {
    try {
      const { stdout: content } = await execFileAsync(
        GIT,
        ["show", "--end-of-options", `${ref}:${filePath}`],
        { cwd: worktreePath, maxBuffer: MAX_REPO_GRAPH_FILE_BYTES },
      );
      sources.push({ path: filePath, text: content });
    } catch {
      // Skip files that are too large or unreadable at this ref.
    }
  }

  return buildRepoCodeGraph(sources);
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

function validateRef(ref: string): void {
  if (ref.startsWith("-")) {
    throw new Error(`ref must not start with '-': ${ref}`);
  }
  if (!/^[A-Za-z0-9_./~^@-]{1,200}$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }
}
