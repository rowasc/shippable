import path from "node:path";
import fs from "node:fs/promises";

/**
 * Reject anything that isn't an absolute, traversal-free path to a directory
 * containing a `.git` entry. Shared by every endpoint that mutates or reads
 * worktree-scoped state — the assumption that `worktreePath` came from our own
 * UI is not enough; the server is bound to localhost but still does file I/O
 * on whatever the caller hands us.
 */
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
