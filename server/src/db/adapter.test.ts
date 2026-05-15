import { afterEach, describe, expect, it } from "vitest";

import { openDb, type SqliteDb } from "./adapter.ts";

describe("openDb (in-memory)", () => {
  let db: SqliteDb;

  afterEach(() => {
    db?.close();
  });

  it("exec runs DDL without throwing", () => {
    db = openDb(":memory:");
    expect(() => db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")).not.toThrow();
  });

  describe("prepare / run / get / all", () => {
    it("round-trips a single row", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
      const result = insert.run("hello");
      expect(result.changes).toBe(1);
      expect(Number(result.lastInsertRowid)).toBe(1);

      const row = db.prepare("SELECT id, name FROM items WHERE id = ?").get(1);
      expect(row).toEqual({ id: 1, name: "hello" });
    });

    it("all returns every inserted row", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

      const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
      insert.run("alpha");
      insert.run("beta");
      insert.run("gamma");

      const rows = db.prepare("SELECT name FROM items ORDER BY id").all();
      expect(rows).toEqual([{ name: "alpha" }, { name: "beta" }, { name: "gamma" }]);
    });

    it("get returns undefined when no row matches", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

      const row = db.prepare("SELECT * FROM items WHERE id = ?").get(999);
      expect(row).toBeUndefined();
    });
  });

  describe("transaction", () => {
    it("commits on success and makes rows visible", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE t (val INTEGER)");

      db.transaction(() => {
        db.prepare("INSERT INTO t VALUES (?)").run(42);
      });

      const rows = db.prepare("SELECT val FROM t").all();
      expect(rows).toEqual([{ val: 42 }]);
    });

    it("returns the value returned by fn", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE t (val INTEGER)");

      const result = db.transaction(() => {
        db.prepare("INSERT INTO t VALUES (?)").run(7);
        return "ok";
      });

      expect(result).toBe("ok");
    });

    it("rolls back on throw and leaves no rows", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE t (val INTEGER)");

      expect(() => {
        db.transaction(() => {
          db.prepare("INSERT INTO t VALUES (?)").run(99);
          throw new Error("oops");
        });
      }).toThrow("oops");

      const rows = db.prepare("SELECT val FROM t").all();
      expect(rows).toHaveLength(0);
    });

    it("re-throws the original error after rollback", () => {
      db = openDb(":memory:");
      db.exec("CREATE TABLE t (val INTEGER)");

      const sentinel = new Error("sentinel");
      let caught: unknown;
      try {
        db.transaction(() => {
          throw sentinel;
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(sentinel);
    });

    it("re-throws the original error even when ROLLBACK itself would fail", () => {
      // Simulate a broken DB by closing it inside fn(). The subsequent
      // ROLLBACK call inside the adapter will also throw, but the adapter must
      // swallow that secondary error and surface the original one.
      db = openDb(":memory:");
      db.exec("CREATE TABLE t (val INTEGER)");

      const original = new Error("original");
      let caught: unknown;
      try {
        db.transaction(() => {
          db.close(); // break the connection so ROLLBACK will throw
          throw original;
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(original);
      // Prevent afterEach from calling close() on an already-closed db.
      db = undefined as unknown as SqliteDb;
    });
  });
});
