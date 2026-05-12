import { describe, it, expect, beforeEach } from "vitest";
import {
  setCredential,
  hasCredential,
  getCredential,
  clearCredential,
  listCredentials,
  resetForTests,
} from "./store.ts";

beforeEach(() => {
  resetForTests();
});

describe("auth/store roundtrip", () => {
  it("roundtrips an anthropic credential", () => {
    setCredential({ kind: "anthropic" }, "sk-foo");
    expect(hasCredential({ kind: "anthropic" })).toBe(true);
    expect(getCredential({ kind: "anthropic" })).toBe("sk-foo");
    clearCredential({ kind: "anthropic" });
    expect(hasCredential({ kind: "anthropic" })).toBe(false);
    expect(getCredential({ kind: "anthropic" })).toBeUndefined();
  });

  it("roundtrips a github credential", () => {
    setCredential({ kind: "github", host: "github.com" }, "ghp_x");
    expect(hasCredential({ kind: "github", host: "github.com" })).toBe(true);
    expect(getCredential({ kind: "github", host: "github.com" })).toBe("ghp_x");
    clearCredential({ kind: "github", host: "github.com" });
    expect(hasCredential({ kind: "github", host: "github.com" })).toBe(false);
  });

  it("normalises github host on read and write", () => {
    setCredential({ kind: "github", host: "GitHub.COM" }, "ghp_x");
    expect(hasCredential({ kind: "github", host: "github.com" })).toBe(true);
    expect(getCredential({ kind: "github", host: "GitHub.Com" })).toBe("ghp_x");
  });
});

describe("listCredentials", () => {
  it("returns an empty array initially", () => {
    expect(listCredentials()).toEqual([]);
  });

  it("returns all configured credentials in a stable order", () => {
    setCredential({ kind: "github", host: "ghe.b" }, "t");
    setCredential({ kind: "anthropic" }, "sk");
    setCredential({ kind: "github", host: "ghe.a" }, "t");
    const list = listCredentials();
    expect(list).toEqual([
      { kind: "anthropic" },
      { kind: "github", host: "ghe.a" },
      { kind: "github", host: "ghe.b" },
    ]);
  });

  it("never includes secret values", () => {
    setCredential({ kind: "anthropic" }, "sk-secret");
    expect(JSON.stringify(listCredentials())).not.toContain("sk-secret");
  });
});

describe("github host blocklist", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "fe80::1",
    "fd00::1",
  ])("rejects blocked host %s", (host) => {
    expect(() => setCredential({ kind: "github", host }, "tok")).toThrow();
  });

  it("does not apply the host blocklist to anthropic credentials", () => {
    // Anthropic has no host concept — the blocklist must not run.
    expect(() => setCredential({ kind: "anthropic" }, "sk")).not.toThrow();
  });
});

describe("resetForTests", () => {
  it("clears all entries", () => {
    setCredential({ kind: "anthropic" }, "sk");
    setCredential({ kind: "github", host: "github.com" }, "ghp");
    resetForTests();
    expect(listCredentials()).toEqual([]);
  });
});
