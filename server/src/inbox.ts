import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { assertGitDir } from "./worktree-validation.ts";

// Reverse-direction half of the agent-context panel: the reviewer types a
// message, we drop it into <worktree>/.shippable/inbox.md, and a
// UserPromptSubmit hook (see tools/shippable-inbox-hook) picks it up on the
// agent's next prompt boundary. The "delivers on next prompt" honesty label
// in the UI exists precisely because of this mechanism.
//
// The first time we write to a worktree's inbox we also append `.shippable/`
// to that worktree's $(git rev-parse --git-dir)/info/exclude — per-worktree,
// invisible to commits, never pushed (it lives inside .git/). See
// docs/concepts/agent-context.md § "Why per-worktree info/exclude".

const execFileAsync = promisify(execFile);
const GIT = "git";
const INBOX_DIR = ".shippable";
const INBOX_FILE = "inbox.md";
const EXCLUDE_RULE = ".shippable/";

export interface InboxWriteResult {
  inboxPath: string;
  excludeWritten: boolean;
}

export interface InboxStatusResult {
  exists: boolean;
  /** ISO timestamp of the last write, or null when the file is absent. */
  mtime: string | null;
}

/**
 * Cheap stat-only check: does the inbox file currently exist? Polled by the
 * panel after a send to flip the status from "queued" to "delivered" once
 * the hook fires (the hook deletes the file when it consumes the message).
 */
export async function inboxStatus(
  worktreePath: string,
): Promise<InboxStatusResult> {
  await assertGitDir(worktreePath);
  const inboxPath = path.join(worktreePath, INBOX_DIR, INBOX_FILE);
  try {
    const stat = await fs.stat(inboxPath);
    return { exists: true, mtime: stat.mtime.toISOString() };
  } catch {
    return { exists: false, mtime: null };
  }
}

/**
 * Write `message` into <worktreePath>/.shippable/inbox.md, replacing whatever
 * was there. Returns the absolute path written. Refuses traversal and any
 * non-absolute path; refuses if the dir isn't a git repo (no .git entry).
 */
export async function writeInbox(
  worktreePath: string,
  message: string,
): Promise<InboxWriteResult> {
  await assertGitDir(worktreePath);
  if (typeof message !== "string") {
    throw new Error("message must be a string");
  }
  if (message.length === 0) {
    throw new Error("message must not be empty");
  }
  if (message.length > 100_000) {
    throw new Error("message too long (max 100kB)");
  }

  const dir = path.join(worktreePath, INBOX_DIR);
  await fs.mkdir(dir, { recursive: true });
  const inboxPath = path.join(dir, INBOX_FILE);
  // Atomic-ish: write to a sibling temp file then rename. Avoids the hook
  // reading a half-written file under live load.
  const tmpPath = `${inboxPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, message, { encoding: "utf8" });
  await fs.rename(tmpPath, inboxPath);

  const excludeWritten = await ensureExclude(worktreePath);
  return { inboxPath, excludeWritten };
}

/**
 * Append `.shippable/` to $(git rev-parse --git-common-dir)/info/exclude if
 * not already present. `info/` lives in the *common* gitdir (shared across
 * all worktrees of a repo) — `--git-dir` returns the per-worktree dir, but
 * git never reads that for ignore resolution. The shared exclude is what
 * actually keeps `.shippable/` out of `git status`.
 *
 * Returns true if the file was written, false when the rule was already
 * there. Idempotent.
 */
async function ensureExclude(worktreePath: string): Promise<boolean> {
  let gitCommonDir: string;
  try {
    const { stdout } = await execFileAsync(
      GIT,
      ["rev-parse", "--git-common-dir"],
      { cwd: worktreePath },
    );
    gitCommonDir = stdout.trim();
  } catch {
    // Without a resolvable common gitdir we can't write the exclude. Surface
    // as a no-op rather than failing the whole inbox write.
    return false;
  }
  if (!path.isAbsolute(gitCommonDir)) {
    gitCommonDir = path.resolve(worktreePath, gitCommonDir);
  }
  const infoDir = path.join(gitCommonDir, "info");
  const excludePath = path.join(infoDir, "exclude");
  let existing = "";
  try {
    existing = await fs.readFile(excludePath, "utf8");
  } catch {
    // The info/exclude file is created by `git init`; it should exist. If
    // it doesn't (very old git, or unusual layout), create it.
    await fs.mkdir(infoDir, { recursive: true });
  }
  if (existing.split("\n").some((l) => l.trim() === EXCLUDE_RULE)) {
    return false;
  }
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const note = "# shippable: reviewer→agent inbox\n";
  await fs.writeFile(
    excludePath,
    existing + sep + note + EXCLUDE_RULE + "\n",
    { encoding: "utf8" },
  );
  return true;
}

