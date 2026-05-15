import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appDataDir } from "./app-data-dir.ts";

// We mock process.platform by overriding it per-test via Object.defineProperty.
// Each test saves and restores the original value.

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const desc = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", desc);
  }
}

describe("appDataDir", () => {
  describe("macOS (darwin)", () => {
    it("returns ~/Library/Application Support/Shippable when HOME is set", () => {
      const result = withPlatform("darwin", () =>
        appDataDir({ HOME: "/Users/alice" }),
      );
      expect(result).toBe(
        join("/Users/alice", "Library", "Application Support", "Shippable"),
      );
    });

    it("returns null when HOME is unset", () => {
      const result = withPlatform("darwin", () => appDataDir({}));
      expect(result).toBeNull();
    });
  });

  describe("Windows (win32)", () => {
    it("returns %LOCALAPPDATA%/Shippable when LOCALAPPDATA is set", () => {
      const base = "C:\\Users\\alice\\AppData\\Local";
      const result = withPlatform("win32", () =>
        appDataDir({ LOCALAPPDATA: base }),
      );
      expect(result).toBe(join(base, "Shippable"));
    });

    it("returns null when LOCALAPPDATA is unset", () => {
      const result = withPlatform("win32", () => appDataDir({}));
      expect(result).toBeNull();
    });
  });

  describe("Linux / other", () => {
    it("prefers XDG_DATA_HOME when set", () => {
      const result = withPlatform("linux", () =>
        appDataDir({ XDG_DATA_HOME: "/custom/data", HOME: "/home/alice" }),
      );
      expect(result).toBe(join("/custom/data", "Shippable"));
    });

    it("falls back to ~/.local/share/Shippable when XDG_DATA_HOME is unset", () => {
      const result = withPlatform("linux", () =>
        appDataDir({ HOME: "/home/alice" }),
      );
      expect(result).toBe(join("/home/alice", ".local", "share", "Shippable"));
    });

    it("returns null when neither XDG_DATA_HOME nor HOME is set", () => {
      const result = withPlatform("linux", () => appDataDir({}));
      expect(result).toBeNull();
    });
  });
});
