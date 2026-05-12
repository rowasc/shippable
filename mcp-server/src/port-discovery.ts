import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Mirror of the sidecar's port-file contract. The path format is the contract
// between the two packages — see `server/src/port-file.ts`. If the location
// changes there, this file moves in lockstep.

interface PortFileContent {
  schemaVersion?: number;
  port?: number;
  pid?: number;
  startedAt?: string;
}

export function portFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const platform = process.platform;
  if (platform === "darwin") {
    const home = env.HOME;
    if (!home) return null;
    return join(home, "Library", "Application Support", "Shippable", "port.json");
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    if (!local) return null;
    return join(local, "Shippable", "port.json");
  }
  const xdg = env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "Shippable", "port.json");
  const home = env.HOME;
  if (!home) return null;
  return join(home, ".local", "share", "Shippable", "port.json");
}

export interface DiscoveryDeps {
  readFileFn?: (path: string) => Promise<string>;
  fetchFn?: typeof fetch;
  path?: string | null;
}

/**
 * Returns a port iff the port file is readable, parseable, and the sidecar at
 * that port answers `/api/health` with HTTP 2xx. Returns `null` for any
 * other state (missing file, malformed JSON, dead sidecar, network error).
 *
 * The health check is what makes a stale file safe to leave on disk: the
 * sidecar removes its file on graceful exit, but a hard kill leaves it
 * behind. Callers fall through to other resolution strategies on `null`.
 */
export async function discoverSidecarPort(
  deps: DiscoveryDeps = {},
): Promise<number | null> {
  const path = deps.path === undefined ? portFilePath() : deps.path;
  if (!path) return null;
  const readFn = deps.readFileFn ?? ((p) => readFile(p, "utf8"));
  let raw: string;
  try {
    raw = await readFn(path);
  } catch {
    return null;
  }
  let parsed: PortFileContent;
  try {
    parsed = JSON.parse(raw) as PortFileContent;
  } catch {
    return null;
  }
  const port = parsed.port;
  if (typeof port !== "number" || !Number.isFinite(port) || port <= 0) {
    return null;
  }
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/api/health`, {
      method: "GET",
    });
    if (!response.ok) return null;
  } catch {
    return null;
  }
  return port;
}
