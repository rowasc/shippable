import { openDb, type SqliteDb } from "./adapter.ts";
import { resolveDbPath } from "./location.ts";
import { runMigrations } from "./schema.ts";

// Process-wide SQLite connection. Opened once at boot via initDb(), migrated
// to head, then cached. Any failure is captured as the DB status so the server
// can still answer /api/health with a human-readable reason instead of
// crashing at startup.

export type DbStatus =
  | { status: "ok" }
  | { status: "error"; error: string };

let handle: SqliteDb | undefined;
let status: DbStatus = { status: "error", error: "database not initialised" };

/**
 * Opens the database at the resolved location and runs migrations.
 * Never throws — any failure is stored as the DB status and surfaced via
 * getDbStatus() / /api/health. The server remains alive and can report why.
 */
export async function initDb(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Reset in case of re-init (test isolation or retry). Close the prior
  // connection first — leaving it open holds a write lock on file-backed DBs.
  handle?.close();
  handle = undefined;
  status = { status: "error", error: "database not initialised" };

  try {
    const path = await resolveDbPath(env);
    const db = openDb(path);
    runMigrations(db);
    handle = db;
    status = { status: "ok" };
  } catch (err) {
    status = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Returns the current database status. Always safe to call. */
export function getDbStatus(): DbStatus {
  return status;
}

/**
 * Returns the open database handle. Throws if called before a successful
 * initDb() — callers should gate on getDbStatus().status === "ok".
 */
export function getDb(): SqliteDb {
  if (!handle) {
    throw new Error(
      "database not initialised — call initDb() and check getDbStatus() first",
    );
  }
  return handle;
}

/** Test-only: reset the singleton so tests can re-init with different envs. */
export function resetForTests(): void {
  handle?.close();
  handle = undefined;
  status = { status: "error", error: "database not initialised" };
}
