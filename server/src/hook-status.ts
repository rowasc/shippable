import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Detection + install of the Claude Code hook that backs the reviewer→agent
// queue (see docs/plans/push-review-comments.md, slice (b)).
//
// The new hook script is `shippable-agent-hook`. It binds to three CC events:
//   - UserPromptSubmit
//   - PostToolUse
//   - SessionStart
//
// We also recognise the legacy `shippable-inbox-hook` basename so an existing
// install registers as "partially installed" rather than disappearing —
// running install rewrites the legacy entry in place.
//
// We check the two user-level settings files for detection. Project-level
// settings could also override; we don't read those because we'd need to
// walk up the worktree tree and that's brittle. Worth revisiting if false
// negatives turn out to matter.

const USER_SETTINGS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".claude", "settings.local.json"),
];

const HOOK_SCRIPT_NAME = "shippable-agent-hook";
const LEGACY_HOOK_SCRIPT_NAME = "shippable-inbox-hook";

// Server's "default" port — must match the one in src/index.ts and the
// fallback in tools/shippable-agent-hook. When the server runs on the
// default port, installHook() writes a bare absolute path so the common
// case stays minimal. When the server is bound to a non-default port
// (e.g. PORT=4179), we prefix the command with `SHIPPABLE_PORT=<port>`
// so the hook script POSTs to the right place. CC executes the command
// via `/bin/sh -c`, so an env-prefix works.
const DEFAULT_HOOK_PORT = 3001;

const REQUIRED_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "SessionStart",
] as const;
type EventName = (typeof REQUIRED_EVENTS)[number];

export interface HookStatus {
  installed: boolean;
  partial: boolean;
  missing: EventName[];
}

export async function checkHookStatus(): Promise<HookStatus> {
  // Aggregate presence across both files. A user could have one event in
  // settings.json and another in settings.local.json — that's a fine
  // partial install.
  const present = new Set<EventName>();
  for (const file of USER_SETTINGS) {
    const found = await fileEventsWithHook(file);
    for (const ev of found) present.add(ev);
  }
  const missing = REQUIRED_EVENTS.filter((ev) => !present.has(ev));
  const installed = missing.length === 0;
  const partial = !installed && present.size > 0;
  return { installed, partial, missing };
}

async function fileEventsWithHook(filePath: string): Promise<EventName[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (!hooks || typeof hooks !== "object") return [];
  const events: EventName[] = [];
  for (const ev of REQUIRED_EVENTS) {
    const arr = (hooks as Record<string, unknown>)[ev];
    if (!Array.isArray(arr)) continue;
    if (arr.some(entryReferencesHook)) events.push(ev);
  }
  return events;
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
  // Both the new name and the legacy name count toward "installed" so an
  // existing inbox-hook user doesn't suddenly look uninstalled. The migration
  // (rewriting legacy → new) happens during installHook().
  const base = extractScriptBasename(cmd);
  return base === HOOK_SCRIPT_NAME || base === LEGACY_HOOK_SCRIPT_NAME;
}

/**
 * Pull the hook-script basename out of a command string that may be either
 * a bare path ("/abs/.../shippable-agent-hook") or env-prefixed
 * ("SHIPPABLE_PORT=4179 /abs/.../shippable-agent-hook"). We scan tokens
 * for one whose basename matches a known hook script; if none matches we
 * fall back to the basename of the last token (catches odd cases like a
 * future second env var).
 */
function extractScriptBasename(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  for (const tok of tokens) {
    const b = path.basename(tok);
    if (b === HOOK_SCRIPT_NAME || b === LEGACY_HOOK_SCRIPT_NAME) return b;
  }
  return path.basename(tokens[tokens.length - 1]!);
}

// ── Install: merge our hook entry into ~/.claude/settings.local.json ──────
//
// Safety rails:
//   - Refuses if the existing settings file is unparseable JSON (no clobber).
//   - Drops a `<settings>.shippable.bak` before the first modification so
//     the user can undo (only on first run; we don't overwrite a prior
//     backup).
//   - Atomic write (temp file + rename) so a half-write can't leave the
//     settings file mid-edit.
//   - Idempotent: if our hook is already wired into all three events,
//     returns immediately with didModify=false.
//
// We edit `~/.claude/settings.local.json` rather than `settings.json`. The
// hook entry contains an absolute path to the shipped script, which is
// inherently machine-specific — settings.local.json is the right place for
// machine-only config. Detection still reads both, so users who registered
// the hook manually in settings.json continue to work.
//
// Migration: any existing entry whose command's basename matches
// `shippable-inbox-hook` is rewritten in place to point at the new script,
// rather than leaving the legacy entry alongside the new ones.

const PRIMARY_SETTINGS = path.join(
  os.homedir(),
  ".claude",
  "settings.local.json",
);

export interface InstallResult {
  installed: true;
  /** Absolute path to the hook script we registered. */
  hookPath: string;
  /** Path of the settings file we wrote (or would have, if didModify). */
  settingsPath: string;
  /** True when the file was actually modified; false when our hook was
   *  already declared on all three events. */
  didModify: boolean;
  /** Set when this run created a backup of the prior settings. */
  backupPath: string | null;
}

export async function installHook(): Promise<InstallResult> {
  const hookPath = await resolveHookScriptPath();
  const settingsPath = PRIMARY_SETTINGS;

  // Capture the port the server is currently bound to. If it's the default,
  // we leave the command as a bare path (matches the hook script's fallback
  // and keeps the common case minimal). On a non-default port we prefix the
  // command with `SHIPPABLE_PORT=<port>` so the hook script POSTs back to
  // *this* server. The port is captured at install time — if the user later
  // changes PORT they need to re-run install.
  const resolvedPort = Number(process.env.PORT ?? DEFAULT_HOOK_PORT);
  const hookCommand =
    resolvedPort === DEFAULT_HOOK_PORT
      ? hookPath
      : `SHIPPABLE_PORT=${resolvedPort} ${hookPath}`;

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

  const next: Record<string, unknown> = { ...parsed };
  const hooks: Record<string, unknown> = isPlainObject(next.hooks)
    ? { ...(next.hooks as Record<string, unknown>) }
    : {};

  // Step 1: walk every event array and rewrite any legacy command in place
  // to the new hook command (path + optional port prefix). We do this
  // before checking idempotency so a fresh install on top of a legacy
  // install always migrates. Existing new-hook entries whose command
  // string differs from the freshly-resolved one (e.g. wrong/missing port
  // prefix because the server is now on a different port) are also
  // rewritten so the user only ever has the *current* port wired up.
  let didMigrate = false;
  for (const ev of REQUIRED_EVENTS) {
    const arr = hooks[ev];
    if (!Array.isArray(arr)) continue;
    const rewritten = arr.map((entry) => {
      const { entry: out, changed } = migrateEntry(entry, hookCommand);
      if (changed) didMigrate = true;
      return out;
    });
    hooks[ev] = rewritten;
  }
  // Also migrate legacy entries on events we don't require (defensive — if
  // the user's settings have shippable-inbox-hook on an unexpected event,
  // it shouldn't survive the rewrite either).
  for (const key of Object.keys(hooks)) {
    if ((REQUIRED_EVENTS as readonly string[]).includes(key)) continue;
    const arr = hooks[key];
    if (!Array.isArray(arr)) continue;
    const rewritten = arr.map((entry) => {
      const { entry: out, changed } = migrateEntry(entry, hookCommand);
      if (changed) didMigrate = true;
      return out;
    });
    hooks[key] = rewritten;
  }

  // Step 2: ensure each required event has a matcher entry pointing at the
  // new hook. De-dup by command path so re-running install never grows the
  // arrays unboundedly.
  let didAdd = false;
  for (const ev of REQUIRED_EVENTS) {
    const arr = Array.isArray(hooks[ev])
      ? [...(hooks[ev] as unknown[])]
      : [];
    if (!arr.some(entryReferencesNewHook)) {
      arr.push({
        matcher: "",
        hooks: [{ type: "command", command: hookCommand }],
      });
      didAdd = true;
    }
    hooks[ev] = arr;
  }

  next.hooks = hooks;

  if (!didMigrate && !didAdd) {
    return {
      installed: true,
      hookPath,
      settingsPath,
      didModify: false,
      backupPath: null,
    };
  }

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

/**
 * Returns true when `entry` already references the new hook script (by
 * basename match). Used during install to avoid double-adding a matcher
 * we'd already merged in a previous run.
 */
function entryReferencesNewHook(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cmd = (entry as { command?: unknown }).command;
  if (typeof cmd === "string" && basenameMatches(cmd, HOOK_SCRIPT_NAME)) {
    return true;
  }
  const inner = (entry as { hooks?: unknown }).hooks;
  if (Array.isArray(inner)) {
    for (const h of inner) {
      if (
        h &&
        typeof h === "object" &&
        typeof (h as { command?: unknown }).command === "string" &&
        basenameMatches((h as { command: string }).command, HOOK_SCRIPT_NAME)
      ) {
        return true;
      }
    }
  }
  return false;
}

function basenameMatches(cmd: string, scriptName: string): boolean {
  // Tolerate env-prefixed commands like "SHIPPABLE_PORT=4179 /abs/.../<name>"
  // by reusing the scanner that knows what a hook-script token looks like.
  return extractScriptBasename(cmd) === scriptName;
}

/**
 * Rewrite any legacy `shippable-inbox-hook` command in `entry` to the new
 * hook command, and rewrite any existing new-hook command whose string
 * doesn't already match the freshly-resolved `newHookCommand` (e.g. when
 * the server's port changed and the prior install used a stale prefix).
 * Walks both the flat `command` shape and the matcher/hooks-array shape.
 * Returns the (possibly new) entry plus a flag indicating whether
 * anything changed.
 */
function migrateEntry(
  entry: unknown,
  newHookCommand: string,
): { entry: unknown; changed: boolean } {
  if (!entry || typeof entry !== "object") return { entry, changed: false };
  let changed = false;
  const next: Record<string, unknown> = { ...(entry as Record<string, unknown>) };

  const cmd = next.command;
  if (typeof cmd === "string" && shouldRewrite(cmd, newHookCommand)) {
    next.command = newHookCommand;
    changed = true;
  }

  const inner = next.hooks;
  if (Array.isArray(inner)) {
    const rewrittenInner = inner.map((h) => {
      if (!h || typeof h !== "object") return h;
      const innerCmd = (h as { command?: unknown }).command;
      if (typeof innerCmd === "string" && shouldRewrite(innerCmd, newHookCommand)) {
        changed = true;
        return { ...(h as Record<string, unknown>), command: newHookCommand };
      }
      return h;
    });
    next.hooks = rewrittenInner;
  }

  return { entry: changed ? next : entry, changed };
}

/**
 * Returns true if `existing` references one of our hook scripts (legacy or
 * new) AND its command string isn't already exactly `desired`. The exact-
 * string comparison covers the port-prefix case: an entry whose script
 * basename matches but whose env prefix differs (or is missing when we now
 * want one) will be rewritten.
 */
function shouldRewrite(existing: string, desired: string): boolean {
  const base = extractScriptBasename(existing);
  if (base !== HOOK_SCRIPT_NAME && base !== LEGACY_HOOK_SCRIPT_NAME) return false;
  return existing.trim() !== desired;
}

/**
 * Resolve the absolute path of the bundled `shippable-agent-hook` script.
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
