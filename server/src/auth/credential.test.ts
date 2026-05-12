import { describe, it, expect } from "vitest";
import { encodeStoreKey, decodeStoreKey } from "./credential.ts";

describe("encodeStoreKey", () => {
  it("encodes anthropic to 'anthropic'", () => {
    expect(encodeStoreKey({ kind: "anthropic" })).toBe("anthropic");
  });

  it("encodes a github credential to 'github:<host>' with lowercased host", () => {
    expect(encodeStoreKey({ kind: "github", host: "GitHub.Com" })).toBe(
      "github:github.com",
    );
  });

  it("trims whitespace from the github host", () => {
    expect(encodeStoreKey({ kind: "github", host: "  github.com  " })).toBe(
      "github:github.com",
    );
  });

  it("throws on an empty github host", () => {
    expect(() => encodeStoreKey({ kind: "github", host: "" })).toThrow();
  });

  it("throws on a whitespace-only github host", () => {
    expect(() => encodeStoreKey({ kind: "github", host: "   " })).toThrow();
  });
});

describe("decodeStoreKey", () => {
  it("decodes 'anthropic'", () => {
    expect(decodeStoreKey("anthropic")).toEqual({ kind: "anthropic" });
  });

  it("decodes 'github:<host>'", () => {
    expect(decodeStoreKey("github:ghe.foo")).toEqual({
      kind: "github",
      host: "ghe.foo",
    });
  });

  it("throws on an unknown prefix", () => {
    expect(() => decodeStoreKey("slack:foo")).toThrow();
  });

  it("throws on an empty github host", () => {
    expect(() => decodeStoreKey("github:")).toThrow();
  });
});
