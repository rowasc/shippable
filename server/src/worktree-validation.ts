import path from "node:path";
import fs from "node:fs/promises";

// Shared validation for endpoints that take a `worktreePath` from the
// browser. Refuses non-strings, relative paths, and `..` traversal; verifies
// the directory exists and looks like a git repo (has a `.git` entry — file
// for linked worktrees, dir for the primary). Used by the `agent-queue.ts`
// endpoints; extracted here so callers share one implementation rather than
// drifting. (The original second caller was the now-deleted `inbox.ts`.)

export async function assertGitDir(dir: string): Promise<void> {
  if (typeof dir !== "string" || dir.length === 0) {
    throw new Error("worktreePath must be a non-empty string");
  }
  if (!path.isAbsolute(dir)) {
    throw new Error(`worktreePath must be absolute, got: ${dir}`);
  }
  if (dir.split(path.sep).includes("..")) {
    throw new Error("worktreePath must not contain '..' segments");
  }
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new Error(`worktreePath does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`worktreePath is not a directory: ${dir}`);
  }
  try {
    await fs.stat(path.join(dir, ".git"));
  } catch {
    throw new Error(
      `worktreePath does not look like a git repo (no .git entry): ${dir}`,
    );
  }
}
