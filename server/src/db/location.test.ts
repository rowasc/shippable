import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import { resolveDbPath } from "./location.ts";

// Cleanup handles for temp dirs created during tests.
const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "shippable-loc-test-"));
  cleanup.push(dir);
  return dir;
}

describe("resolveDbPath", () => {
  describe("SHIPPABLE_DB_PATH override", () => {
    it("returns the explicit path verbatim when SHIPPABLE_DB_PATH is an absolute path", async () => {
      const result = await resolveDbPath({
        SHIPPABLE_DB_PATH: "/some/explicit/shippable.db",
      });
      expect(result).toBe("/some/explicit/shippable.db");
    });

    it("returns :memory: verbatim when SHIPPABLE_DB_PATH=:memory:", async () => {
      const result = await resolveDbPath({
        SHIPPABLE_DB_PATH: ":memory:",
      });
      expect(result).toBe(":memory:");
    });

    it("does NOT perform any mkdir or writability check when override is set", async () => {
      // A path under a guaranteed-nonexistent directory — would fail
      // writability checks if we checked. With the override, it must succeed.
      const result = await resolveDbPath({
        SHIPPABLE_DB_PATH: "/nonexistent-guaranteed-missing-dir/shippable.db",
      });
      expect(result).toBe("/nonexistent-guaranteed-missing-dir/shippable.db");
    });
  });

  describe("default resolution (no SHIPPABLE_DB_PATH)", () => {
    it("returns <appDataDir>/shippable.db and creates the directory", async () => {
      const dir = await makeTmpDir();
      // Inject a HOME that points to our temp dir; on Linux the resolved dir
      // would be <dir>/.local/share/Shippable — we just check it ends with
      // shippable.db and starts with the expected prefix.
      const result = await resolveDbPath({ HOME: dir });
      expect(result).toMatch(/shippable\.db$/);
      expect(result).toContain(dir);
      // Confirm mkdir actually ran — the parent directory must exist on disk.
      await expect(access(join(result, ".."))).resolves.toBeUndefined();
    });

    it("throws when HOME-like env vars are absent: is an Error with actionable message, no :memory: fallback", async () => {
      // Pass an env that has none of the vars appDataDir needs.
      const rejected = await resolveDbPath({}).catch((e: unknown) => e);
      // Must throw an Error (not a string — rules out silent :memory: return).
      expect(rejected).toBeInstanceOf(Error);
      // Message must name the missing env vars so the user knows what to set.
      expect((rejected as Error).message).toMatch(/no.*app.?data/i);
    });

    it("throws when the directory cannot be created (path is under a file)", async () => {
      const dir = await makeTmpDir();
      // Place a regular file where the Shippable subdir would need to exist.
      // We construct a HOME that will make appDataDir resolve to a path whose
      // parent component is an existing file — mkdir will fail with ENOTDIR.
      const blockingFile = join(dir, "blocker");
      await writeFile(blockingFile, "not a dir");

      // On Linux (current platform): appDataDir resolves to HOME/.local/share/Shippable
      // We need the "Shippable" parent path to run into a file. Easiest:
      // Set HOME to blockingFile — then HOME/.local/share/Shippable would need
      // blockingFile to be a directory, which it isn't.
      await expect(
        resolveDbPath({ HOME: blockingFile }),
      ).rejects.toThrow();
    });

  });
});
