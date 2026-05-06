import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// Best-effort detection: does the user's Claude Code config declare an MCP
// server entry named `shippable`?
//
// Replaces the slice-1 hook detection. The MCP install line the panel hands
// the user (`claude mcp add shippable -- npx -y @shippable/mcp-server`) writes
// into one of the two user-level config files Claude Code reads. Detection
// failure surfaces a "set up" install affordance above the composer; it
// doesn't block authoring.
//
// We check the two user-level settings files. Project-level configs could
// also override; we don't read those because we'd need to walk up the
// worktree tree and that's brittle. Worth revisiting if false negatives
// turn out to matter.

const USER_SETTINGS = [
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".claude", "settings.local.json"),
];

const SHIPPABLE_MCP_NAME = "shippable";

export interface McpStatus {
  installed: boolean;
}

export async function checkMcpStatus(
  filesOverride?: string[],
): Promise<McpStatus> {
  const files = filesOverride ?? USER_SETTINGS;
  for (const file of files) {
    if (await fileDeclaresShippableMcp(file)) {
      return { installed: true };
    }
  }
  return { installed: false };
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
