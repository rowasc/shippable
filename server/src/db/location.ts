import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { appDataDir } from "../app-data-dir.ts";

/**
 * Resolves the absolute path of the SQLite database file.
 *
 * Resolution order:
 *  1. `SHIPPABLE_DB_PATH` env var — returned verbatim. Accepts any filesystem
 *     path or the `:memory:` sentinel. No mkdir/writability check: the caller
 *     owns the path they set.
 *  2. `<appDataDir(env)>/shippable.db` — the directory is created (recursive)
 *     if needed. Throws when the directory cannot be resolved or created; there
 *     is no `:memory:` fallback.
 *
 * Throws an `Error` with a human-readable message on failure so the caller
 * (db/index.ts) can surface it via /api/health without losing the reason.
 */
export async function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const override = env.SHIPPABLE_DB_PATH;
  if (override !== undefined) return override;

  const dir = appDataDir(env);
  if (!dir) {
    throw new Error(
      "no app-data directory available: set HOME (or XDG_DATA_HOME on Linux, LOCALAPPDATA on Windows) and retry",
    );
  }

  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `could not create app-data directory ${dir}: ${message}`,
    );
  }

  return join(dir, "shippable.db");
}
