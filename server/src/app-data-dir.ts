import { join } from "node:path";
import process from "node:process";

/**
 * Resolves the per-platform application-data directory for Shippable.
 *
 * macOS:   `$HOME/Library/Application Support/Shippable`
 * Linux:   `$XDG_DATA_HOME/Shippable`
 *          (falls back to `$HOME/.local/share/Shippable`)
 * Windows: `%LOCALAPPDATA%/Shippable`
 *
 * Returns `null` when no usable home directory is available (e.g. running
 * with `HOME` unset). Callers should treat `null` as "no stable location
 * available" and skip any writes that depend on it.
 *
 * Note: `env` is injected for testability but `process.platform` is read
 * directly (consistent with the pattern in `port-file.ts`).
 */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const platform = process.platform;
  if (platform === "darwin") {
    const home = env.HOME;
    if (!home) return null;
    return join(home, "Library", "Application Support", "Shippable");
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (!local) return null;
    return join(local, "Shippable");
  }
  const xdg = env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "Shippable");
  const home = env.HOME;
  if (!home) return null;
  return join(home, ".local", "share", "Shippable");
}
