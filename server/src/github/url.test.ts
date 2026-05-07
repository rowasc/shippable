import { describe, it, expect } from "vitest";
import { parsePrUrl, resolveApiBase } from "./url.ts";

describe("parsePrUrl", () => {
  it("parses a bare github.com URL", () => {
    const r = parsePrUrl("https://github.com/owner/repo/pull/42");
    expect(r).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
      number: 42,
      apiBaseUrl: "https://api.github.com",
      htmlUrl: "https://github.com/owner/repo/pull/42",
    });
  });

  it("parses a GHE host", () => {
    const r = parsePrUrl("https://ghe.example.com/acme/widget/pull/7");
    expect(r).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      repo: "widget",
      number: 7,
      apiBaseUrl: "https://ghe.example.com/api/v3",
      htmlUrl: "https://ghe.example.com/acme/widget/pull/7",
    });
  });

  it("strips a trailing slash", () => {
    const r = parsePrUrl("https://github.com/owner/repo/pull/1/");
    expect(r.number).toBe(1);
    expect(r.htmlUrl).toBe("https://github.com/owner/repo/pull/1");
  });

  it("strips a query string", () => {
    const r = parsePrUrl("https://github.com/owner/repo/pull/3?diff=unified");
    expect(r.number).toBe(3);
    expect(r.htmlUrl).toBe("https://github.com/owner/repo/pull/3");
  });

  it("strips a fragment / anchor", () => {
    const r = parsePrUrl("https://github.com/owner/repo/pull/5#issuecomment-123");
    expect(r.number).toBe(5);
    expect(r.htmlUrl).toBe("https://github.com/owner/repo/pull/5");
  });

  it("tolerates extra path segments after the number (e.g. /files)", () => {
    const r = parsePrUrl("https://github.com/owner/repo/pull/9/files");
    expect(r.number).toBe(9);
    expect(r.htmlUrl).toBe("https://github.com/owner/repo/pull/9");
  });

  it("tolerates extra path segments after the number (e.g. /commits/<sha>)", () => {
    const r = parsePrUrl(
      "https://github.com/owner/repo/pull/11/commits/abc123def456",
    );
    expect(r.number).toBe(11);
  });

  it("throws on a malformed URL (no pull/<n> segment)", () => {
    expect(() => parsePrUrl("https://github.com/owner/repo")).toThrow(
      /invalid PR URL/,
    );
  });

  it("throws when the path has /issues/<n> instead of /pull/<n>", () => {
    expect(() =>
      parsePrUrl("https://github.com/owner/repo/issues/42"),
    ).toThrow(/invalid PR URL/);
  });

  it("throws when the PR number is zero", () => {
    expect(() =>
      parsePrUrl("https://github.com/owner/repo/pull/0"),
    ).toThrow(/invalid PR URL/);
  });

  it("throws when the PR number is not an integer", () => {
    expect(() =>
      parsePrUrl("https://github.com/owner/repo/pull/abc"),
    ).toThrow(/invalid PR URL/);
  });

  it("throws when owner is empty", () => {
    expect(() => parsePrUrl("https://github.com//repo/pull/1")).toThrow(
      /invalid PR URL/,
    );
  });

  it("throws when repo is empty", () => {
    expect(() => parsePrUrl("https://github.com/owner//pull/1")).toThrow(
      /invalid PR URL/,
    );
  });

  it("throws when a port is present", () => {
    expect(() =>
      parsePrUrl("https://github.com:8080/owner/repo/pull/1"),
    ).toThrow(/invalid PR URL/);
  });

  it("throws on a completely unparseable string", () => {
    expect(() => parsePrUrl("not a url at all")).toThrow(/invalid PR URL/);
  });
});

describe("resolveApiBase", () => {
  it("maps github.com to the public API", () => {
    expect(resolveApiBase("github.com")).toBe("https://api.github.com");
  });

  it("maps a GHE host to /api/v3", () => {
    expect(resolveApiBase("ghe.example.com")).toBe(
      "https://ghe.example.com/api/v3",
    );
  });
});
