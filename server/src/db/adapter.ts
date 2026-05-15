import { createRequire } from "node:module";

// Runtime-dispatched SQLite. The server runs under Node (`tsx`, dev — uses
// `node:sqlite`) and under Bun (the `bun build --compile` sidecar — uses
// `bun:sqlite`). Both expose near-identical synchronous prepared-statement
// APIs; this adapter normalises the two behind one interface so the rest of
// `db/` is runtime-agnostic. No native addon.

const require = createRequire(import.meta.url);

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** Runs `fn` inside BEGIN/COMMIT, rolling back on throw. Returns fn's result. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface NativeDb {
  exec(sql: string): unknown; // Bun's exec() returns an object; void would be a lie
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * Wraps a native prepared statement so `get()` returns `undefined` instead of
 * `null` when no row matches. `bun:sqlite` returns null; `node:sqlite` returns
 * undefined. Callers should not have to know which runtime they're on.
 */
function wrapStatement(stmt: SqliteStatement): SqliteStatement {
  return {
    run: (...p) => stmt.run(...p),
    get: (...p) => stmt.get(...p) ?? undefined,
    all: (...p) => stmt.all(...p),
  };
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

function openNative(location: string): NativeDb {
  if (isBun) {
    const { Database } = require("bun:sqlite") as {
      Database: new (loc: string) => NativeDb;
    };
    return new Database(location);
  }
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (loc: string) => NativeDb;
  };
  return new DatabaseSync(location);
}

/**
 * Opens a SQLite database. `location` is a filesystem path or the `:memory:`
 * sentinel. `transaction` uses explicit `BEGIN`/`COMMIT`/`ROLLBACK` so it
 * behaves identically on both runtimes (Bun has a native transaction helper,
 * Node does not).
 */
export function openDb(location: string): SqliteDb {
  const native = openNative(location);
  return {
    exec: (sql) => { native.exec(sql); },
    prepare: (sql) => wrapStatement(native.prepare(sql)),
    transaction<T>(fn: () => T): T {
      native.exec("BEGIN");
      try {
        const result = fn();
        native.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          // Best-effort rollback. If the DB was closed (or otherwise broken)
          // inside fn(), this will also throw — swallow it so the original
          // root-cause error isn't masked.
          native.exec("ROLLBACK");
        } catch {
          // intentionally swallowed
        }
        throw err;
      }
    },
    close: () => native.close(),
  };
}
