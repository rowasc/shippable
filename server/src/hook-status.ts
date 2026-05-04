import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Best-effort detection: does the user's Claude Code settings declare a
// UserPromptSubmit hook that points at our shippable-inbox-hook script?
//
// This is informational only — sending to the inbox always works; the hook
// is what makes the agent see it on its next prompt. Detection failure
// surfaces a "set up" hint above the composer; it doesn't block sending.
//
// We check the two user-level settings files. Project-level settings could
// also override; we don't read those because we'd need to walk up the
// worktree tree and that's brittle. Worth revisiting if false negatives
// turn out to matter.

const USER_SETTINGS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".claude", "settings.local.json"),
];

const HOOK_SCRIPT_NAME = "shippable-inbox-hook";

export interface HookStatus {
  installed: boolean;
}

export async function checkHookStatus(): Promise<HookStatus> {
  for (const file of USER_SETTINGS) {
    if (await fileDeclaresHook(file)) {
      return { installed: true };
    }
  }
  return { installed: false };
}

async function fileDeclaresHook(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (!hooks || typeof hooks !== "object") return false;
  const ups = (hooks as { UserPromptSubmit?: unknown }).UserPromptSubmit;
  if (!Array.isArray(ups)) return false;
  for (const entry of ups) {
    // Each entry can be either { command } or a hook config object that
    // wraps `hooks: [{ command }]`. Cover both shapes for robustness.
    if (entryReferencesHook(entry)) return true;
  }
  return false;
}

function entryReferencesHook(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = (entry as { command?: unknown }).command;
  if (typeof cmd === "string" && commandIsOurs(cmd)) return true;
  // Newer Claude Code shape: matcher + hooks array.
  const inner = (entry as { hooks?: unknown }).hooks;
  if (Array.isArray(inner)) {
    for (const h of inner) {
      if (
        h &&
        typeof h === "object" &&
        typeof (h as { command?: unknown }).command === "string" &&
        commandIsOurs((h as { command: string }).command)
      ) {
        return true;
      }
    }
  }
  return false;
}

function commandIsOurs(cmd: string): boolean {
  // Match by basename — the user can place the hook script anywhere on $PATH.
  // We accept both the bare basename invocation and absolute paths ending in
  // the script name.
  const base = path.basename(cmd.trim().split(/\s+/)[0] ?? "");
  return base === HOOK_SCRIPT_NAME;
}

// ── Install: merge our hook entry into ~/.claude/settings.json ────────────
//
// Safety rails:
//   - Refuses if the existing settings file is unparseable JSON (no clobber).
//   - Drops a `<settings>.shippable.bak` before the first modification so
//     the user can undo (only on first run; we don't overwrite a prior backup).
//   - Atomic write (temp file + rename) so a half-write can't leave the
//     settings file mid-edit.
//   - Idempotent: if our hook is already declared, returns immediately
//     with installed=true and didModify=false.
//
// We always edit the canonical `~/.claude/settings.json`. settings.local.json
// is a user-private override and we don't presume to write there.

const PRIMARY_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

export interface InstallResult {
  installed: true;
  /** Absolute path to the hook script we registered. */
  hookPath: string;
  /** Path of the settings file we wrote (or would have, if didModify). */
  settingsPath: string;
  /** True when the file was actually modified; false when our hook was
   *  already declared. */
  didModify: boolean;
  /** Set when this run created a backup of the prior settings. */
  backupPath: string | null;
}

export async function installHook(): Promise<InstallResult> {
  const hookPath = await resolveHookScriptPath();
  const settingsPath = PRIMARY_SETTINGS;

  // Read current settings (or treat missing as empty).
  let raw: string | null = null;
  let parsed: Record<string, unknown> = {};
  let fileExists = true;
  try {
    raw = await fs.readFile(settingsPath, "utf8");
  } catch {
    fileExists = false;
  }
  if (raw !== null) {
    try {
      const json = JSON.parse(raw);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>;
      } else {
        throw new Error(
          `${settingsPath} is JSON but not an object — refusing to overwrite`,
        );
      }
    } catch (e) {
      throw new Error(
        `${settingsPath} is not valid JSON — refusing to overwrite. Original error: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // Check if our hook is already there.
  if (settingsContainHook(parsed)) {
    return {
      installed: true,
      hookPath,
      settingsPath,
      didModify: false,
      backupPath: null,
    };
  }

  // Mutate: append our entry to hooks.UserPromptSubmit (creating intermediate
  // objects/arrays as needed). We use the matcher form, which is what current
  // Claude Code expects and is most forward-compatible.
  const next = { ...parsed };
  const hooks =
    isPlainObject(next.hooks) ? { ...(next.hooks as Record<string, unknown>) } : {};
  const ups = Array.isArray(hooks.UserPromptSubmit)
    ? [...(hooks.UserPromptSubmit as unknown[])]
    : [];
  ups.push({
    matcher: "",
    hooks: [{ type: "command", command: hookPath }],
  });
  hooks.UserPromptSubmit = ups;
  next.hooks = hooks;

  // Backup before writing, only if there was something to back up and we
  // haven't already left a backup behind on a previous run.
  let backupPath: string | null = null;
  if (fileExists && raw !== null) {
    const candidate = `${settingsPath}.shippable.bak`;
    try {
      await fs.access(candidate);
      // Backup already exists — leave it alone (don't overwrite the user's
      // earliest known-good state with a possibly-already-modified version).
    } catch {
      await fs.writeFile(candidate, raw, { encoding: "utf8" });
      backupPath = candidate;
    }
  }

  // Atomic write. mkdir in case ~/.claude doesn't exist yet (very fresh
  // install — the directory normally exists once Claude Code has run once).
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(next, null, 2) + "\n", {
    encoding: "utf8",
  });
  await fs.rename(tmpPath, settingsPath);

  return {
    installed: true,
    hookPath,
    settingsPath,
    didModify: true,
    backupPath,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function settingsContainHook(parsed: Record<string, unknown>): boolean {
  const hooks = parsed.hooks;
  if (!isPlainObject(hooks)) return false;
  const ups = (hooks as { UserPromptSubmit?: unknown }).UserPromptSubmit;
  if (!Array.isArray(ups)) return false;
  return ups.some(entryReferencesHook);
}

/**
 * Resolve the absolute path of the bundled `shippable-inbox-hook` script.
 * In dev (server run via tsx), this walks up from `server/src/` to the repo
 * root and into `tools/`. If the resolved file is missing we surface a
 * clear error rather than writing a path that won't run.
 */
async function resolveHookScriptPath(): Promise<string> {
  const here = fileURLToPath(import.meta.url); // <repo>/server/src/hook-status.ts
  const candidate = path.resolve(here, "../../..", "tools", HOOK_SCRIPT_NAME);
  try {
    await fs.access(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    throw new Error(
      `couldn't locate the bundled ${HOOK_SCRIPT_NAME} script at ${candidate}. If you're running a non-standard layout, install the hook manually.`,
    );
  }
}
