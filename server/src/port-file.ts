import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import { appDataDir } from "./app-data-dir.ts";

// Discovery file for clients that share the box with the sidecar (today: the
// MCP server). Tauri picks an ephemeral port at boot and only tells the web
// UI via the `get_sidecar_port` command; the MCP server is a separate process
// with no IPC channel, so it can't find us without a stable on-disk pointer.

export const SCHEMA_VERSION = 1;

export interface PortFileContent {
  schemaVersion: number;
  port: number;
  pid: number;
  startedAt: string;
}

/**
 * Resolves the absolute path of the port file for the current platform.
 *
 * macOS:   `$HOME/Library/Application Support/Shippable/port.json`
 * Linux:   `$XDG_DATA_HOME/Shippable/port.json`
 *          (falls back to `$HOME/.local/share/Shippable/port.json`)
 * Windows: `%LOCALAPPDATA%/Shippable/port.json`
 *
 * Returns `null` when no usable home directory is available (e.g. running
 * with `HOME` unset). Callers should treat `null` as "no discovery file
 * available" and continue without writing.
 */
export function portFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = appDataDir(env);
  if (!dir) return null;
  return join(dir, "port.json");
}

/**
 * Writes the port file atomically (temp + rename) so a concurrent reader
 * never sees a half-written file. Errors are caught and logged — failure to
 * advertise our port should not crash the sidecar.
 */
export async function writePortFile(
  port: number,
  options: { path?: string; pid?: number; now?: () => Date } = {},
): Promise<void> {
  const path = options.path ?? portFilePath();
  if (!path) return;
  const content: PortFileContent = {
    schemaVersion: SCHEMA_VERSION,
    port,
    pid: options.pid ?? process.pid,
    startedAt: (options.now?.() ?? new Date()).toISOString(),
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(content), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] port-file write failed (${path}): ${message}`);
  }
}

/**
 * Removes the port file. Best-effort: a missing file is not an error, and any
 * other failure is logged but swallowed. Safe to call from a signal handler.
 */
export async function removePortFile(
  options: { path?: string } = {},
): Promise<void> {
  const path = options.path ?? portFilePath();
  if (!path) return;
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[server] port-file remove failed (${path}): ${message}`);
  }
}
