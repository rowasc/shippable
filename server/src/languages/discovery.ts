import fs from "node:fs";
import path from "node:path";
import type { DiscoveredBinary, DiscoverySource } from "./types.ts";

interface FindOptions {
  // When set, this env var's value is treated as an explicit binary path.
  // Empty / unset → fall through to the next strategy.
  envVar?: string;
  // Binary basename to look for on $PATH and in well-known project bins.
  binary?: string;
  // Extra args to attach to whatever path we find. Defaults to [].
  args?: readonly string[];
  // Project-local search roots, in priority order. Each is joined with the
  // binary name. Caller supplies absolute paths.
  projectBins?: readonly string[];
}

export function findExecutable(opts: FindOptions): DiscoveredBinary | null {
  const args = opts.args ? [...opts.args] : [];

  if (opts.envVar) {
    const raw = process.env[opts.envVar]?.trim();
    if (raw) {
      const candidate = path.isAbsolute(raw) ? raw : path.resolve(raw);
      if (isExecutable(candidate)) {
        return { command: candidate, args, source: "configured" };
      }
      // Explicit env var pointing at a non-executable is a misconfiguration;
      // don't silently fall through, the user wants to know.
      return null;
    }
  }

  if (opts.binary) {
    const onPath = searchPath(opts.binary);
    if (onPath) return { command: onPath, args, source: "path" };

    if (opts.projectBins) {
      for (const dir of opts.projectBins) {
        const candidate = path.join(dir, opts.binary);
        if (isExecutable(candidate)) {
          return {
            command: candidate,
            args,
            source: classifyProjectBin(dir),
          };
        }
      }
    }
  }

  return null;
}

function searchPath(binary: string): string | null {
  const searchPath = process.env.PATH ?? "";
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function classifyProjectBin(dir: string): DiscoverySource {
  if (dir.endsWith(`${path.sep}node_modules${path.sep}.bin`) ||
      dir.endsWith(`${path.sep}node_modules/.bin`)) {
    return "node_modules";
  }
  if (dir.endsWith(`${path.sep}vendor${path.sep}bin`) ||
      dir.endsWith(`${path.sep}vendor/bin`)) {
    return "vendor";
  }
  return "path";
}

export function isExecutable(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
