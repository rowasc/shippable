import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Best-effort detection: does the user's Claude Code config declare an MCP
// server entry named `shippable`?
//
// Replaces the slice-1 hook detection. The MCP install line the panel hands
// the user (`claude mcp add shippable -- …`) writes into one of three places
// depending on which command + scope the user picked:
//   - `~/.claude/settings.json` / `~/.claude/settings.local.json` — older
//     hook-based config; some harnesses also dropped MCP entries here.
//   - `~/.claude.json` (top-level `mcpServers`) — written by
//     `claude mcp add --scope user shippable …`.
//   - `~/.claude.json` (`projects.<absolute-path>.mcpServers`) — written by
//     a default `claude mcp add` invoked from inside a repo (project scope).
// Any one match anywhere collapses the install affordance to the ✓ line.

const USER_SETTINGS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".claude", "settings.local.json"),
];
const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

const SHIPPABLE_MCP_NAME = "shippable";

export interface McpStatus {
  installed: boolean;
  /**
   * The exact `claude mcp add …` command the install affordance should
   * display + copy. Resolved at request time:
   *   - if `mcp-server/dist/index.js` exists relative to this source file's
   *     location (i.e. the user has built the local checkout), we hand back
   *     the absolute-path form: `claude mcp add shippable -- node <abs>/...`.
   *   - otherwise we fall back to the npx form. Documented even if not yet
   *     functional (the npm publish in §7 of the punch-list flips this).
   * Single source of truth for both the panel chip and the README primary
   * line (slice-3 follow-up: switch to local-build install line).
   */
  installCommand: string;
}

const NPX_INSTALL_LINE = "claude mcp add shippable -- npx -y @shippable/mcp-server";
let warnedFallback = false;

/**
 * Resolve the install line the panel chip should display. Public for tests;
 * production callers go through `checkMcpStatus`.
 *
 * The resolver walks up from this file's directory: in source mode that's
 * `server/src/mcp-status.ts` → `server/src` → `server` → repo root → into
 * `mcp-server/dist/index.js`. In compiled mode (`server/dist/...`) the same
 * three-level walk lands at the right place — `dist/` mirrors `src/` depth.
 *
 * Falls back to the npx form if the local build isn't present (user hasn't
 * run `npm run build` in `mcp-server/` yet, or the layout has shifted).
 * Emits a one-time `console.warn` on the fallback path so the operator
 * notices during dev. Tests can override the source-file URL.
 */
export async function resolveInstallCommand(
  sourceFileUrl: string = import.meta.url,
): Promise<string> {
  try {
    const here = fileURLToPath(sourceFileUrl);
    // mcp-status.ts → ../.. = server/ root → ../mcp-server/dist/index.js
    const repoRoot = path.resolve(path.dirname(here), "..", "..");
    const dist = path.join(repoRoot, "mcp-server", "dist", "index.js");
    await fs.access(dist);
    return `claude mcp add shippable -- node ${dist}`;
  } catch {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        "[shippable] mcp-server/dist/index.js not found — install affordance will surface the npx form. Run `npm run build` in mcp-server/ to switch to the local-build line.",
      );
    }
    return NPX_INSTALL_LINE;
  }
}

export async function checkMcpStatus(
  filesOverride?: string[],
  claudeJsonOverride?: string,
): Promise<McpStatus> {
  const installCommand = await resolveInstallCommand();
  const files = filesOverride ?? USER_SETTINGS;
  for (const file of files) {
    if (await fileDeclaresShippableMcp(file)) {
      return { installed: true, installCommand };
    }
  }
  const claudeJson = claudeJsonOverride ?? CLAUDE_JSON;
  if (await claudeJsonDeclaresShippableMcp(claudeJson)) {
    return { installed: true, installCommand };
  }
  return { installed: false, installCommand };
}

async function fileDeclaresShippableMcp(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    // Missing file → treat as "no entry". Do not throw.
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON → treat as "no entry". Do not throw.
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  return objectDeclaresShippableMcp(parsed as Record<string, unknown>);
}

/**
 * Permissive scan: accept either the canonical `mcpServers.shippable` shape
 * (https://docs.anthropic.com/en/docs/claude-code/mcp) or any plausible
 * MCP-related top-level key whose value is an object that contains a
 * `shippable` entry. Prefer false positives over false negatives — a stale
 * "MCP installed ✓" line is harmless; a false "set up" prompt nags the user
 * forever after they've done the install.
 */
function objectDeclaresShippableMcp(obj: Record<string, unknown>): boolean {
  // Canonical shape.
  if (containsShippableKey(obj.mcpServers)) return true;
  // Legacy / harness variations: any top-level key that names an MCP
  // container and is an object containing a `shippable` key.
  for (const [key, value] of Object.entries(obj)) {
    if (!isMcpContainerKey(key)) continue;
    if (containsShippableKey(value)) return true;
  }
  return false;
}

function isMcpContainerKey(key: string): boolean {
  // `mcpServers` is the documented one. Accept variants we've seen in
  // adjacent harnesses' configs, conservatively. Lowercased compare so we
  // catch `MCP_servers`, `mcp_servers`, etc.
  const k = key.toLowerCase();
  return k === "mcpservers" || k === "mcp_servers" || k === "mcp";
}

function containsShippableKey(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, SHIPPABLE_MCP_NAME);
}

/**
 * Project-aware variant for `~/.claude.json`. `claude mcp add shippable …`
 * writes either to the top-level `mcpServers` (when invoked with
 * `--scope user`) or to `projects["<abs-cwd>"].mcpServers` (default). Walk
 * both. Missing file / malformed JSON / non-object root → false (never
 * throws).
 */
async function claudeJsonDeclaresShippableMcp(
  filePath: string,
): Promise<boolean> {
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;

  // Top-level `mcpServers.shippable` — `--scope user` installs.
  if (containsShippableKey(obj.mcpServers)) return true;

  // Project-scoped installs: `projects["<abs-cwd>"].mcpServers.shippable`.
  // Walk every project entry; a hit anywhere is enough. Defensively check
  // `mcp_servers` and `mcp` per the same permissive policy as the settings
  // files — better a false positive (stale ✓) than a false negative
  // (perma-nag after install).
  const projects = obj.projects;
  if (projects && typeof projects === "object" && !Array.isArray(projects)) {
    for (const value of Object.values(projects as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const project = value as Record<string, unknown>;
      if (containsShippableKey(project.mcpServers)) return true;
      if (containsShippableKey(project.mcp_servers)) return true;
      if (containsShippableKey(project.mcp)) return true;
    }
  }
  return false;
}
