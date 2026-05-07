import { describe, it, expect, beforeEach } from "vitest";
import {
  setToken,
  hasToken,
  getToken,
  clearToken,
  resetForTests,
} from "./auth-store.ts";

beforeEach(() => {
  resetForTests();
});

describe("setToken / hasToken / getToken / clearToken", () => {
  it("round-trips a token", () => {
    setToken("github.com", "ghp_abc");
    expect(hasToken("github.com")).toBe(true);
    expect(getToken("github.com")).toBe("ghp_abc");
  });

  it("returns false / undefined before any set", () => {
    expect(hasToken("github.com")).toBe(false);
    expect(getToken("github.com")).toBeUndefined();
  });

  it("clearToken removes the entry", () => {
    setToken("github.com", "tok");
    clearToken("github.com");
    expect(hasToken("github.com")).toBe(false);
    expect(getToken("github.com")).toBeUndefined();
  });

  it("clearToken is a no-op on an unknown host", () => {
    expect(() => clearToken("unknown.example.com")).not.toThrow();
  });
});

describe("host normalization", () => {
  it("normalises host to lowercase", () => {
    setToken("GitHub.COM", "tok");
    expect(hasToken("github.com")).toBe(true);
    expect(getToken("GitHub.COM")).toBe("tok");
  });

  it("treats mixed-case and lowercase as the same key", () => {
    setToken("GHE.Example.Com", "tok");
    clearToken("ghe.example.com");
    expect(hasToken("GHE.Example.Com")).toBe(false);
  });
});

describe("blocked hosts (defensive)", () => {
  it("rejects localhost", () => {
    expect(() => setToken("localhost", "tok")).toThrow();
  });

  it("rejects 127.0.0.1", () => {
    expect(() => setToken("127.0.0.1", "tok")).toThrow();
  });

  it("rejects ::1", () => {
    expect(() => setToken("::1", "tok")).toThrow();
  });

  it("rejects a 10.x address", () => {
    expect(() => setToken("10.0.0.1", "tok")).toThrow();
  });

  it("rejects a 192.168.x address", () => {
    expect(() => setToken("192.168.1.1", "tok")).toThrow();
  });

  it("rejects a 172.16-31.x address", () => {
    expect(() => setToken("172.20.5.3", "tok")).toThrow();
    expect(() => setToken("172.16.0.1", "tok")).toThrow();
    expect(() => setToken("172.31.255.255", "tok")).toThrow();
  });

  it("does not reject a 172.x outside the private range", () => {
    expect(() => setToken("172.32.0.1", "tok")).not.toThrow();
  });

  it("rejects IPv4 link-local (169.254.x.x) — cloud IMDS endpoint", () => {
    expect(() => setToken("169.254.169.254", "tok")).toThrow();
    expect(() => setToken("169.254.0.1", "tok")).toThrow();
  });

  it("rejects CGNAT (100.64.0.0/10)", () => {
    expect(() => setToken("100.64.0.1", "tok")).toThrow();
    expect(() => setToken("100.127.255.255", "tok")).toThrow();
  });

  it("does not reject an address just outside CGNAT (100.63.0.1)", () => {
    expect(() => setToken("100.63.0.1", "tok")).not.toThrow();
  });

  it("rejects IPv6 link-local (fe80::)", () => {
    expect(() => setToken("fe80::1", "tok")).toThrow();
    expect(() => setToken("fe80::dead:beef", "tok")).toThrow();
  });

  it("rejects IPv6 ULA fc00::/7 (fd prefix)", () => {
    expect(() => setToken("fd00::1", "tok")).toThrow();
    expect(() => setToken("fdab::1234", "tok")).toThrow();
  });

  it("rejects IPv6 ULA fc00::/7 (fc prefix)", () => {
    expect(() => setToken("fc00::1", "tok")).toThrow();
  });
});
