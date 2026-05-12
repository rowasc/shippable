import { describe, it, expect } from "vitest";
import { keychainAccountFor } from "./credential";

describe("keychainAccountFor", () => {
  it("returns ANTHROPIC_API_KEY for an anthropic credential", () => {
    expect(keychainAccountFor({ kind: "anthropic" })).toBe(
      "ANTHROPIC_API_KEY",
    );
  });

  it("returns GITHUB_TOKEN:<host> for a github credential", () => {
    expect(
      keychainAccountFor({ kind: "github", host: "github.com" }),
    ).toBe("GITHUB_TOKEN:github.com");
  });

  it("normalises the github host (lowercase + trim)", () => {
    expect(keychainAccountFor({ kind: "github", host: "GHE.Foo" })).toBe(
      "GITHUB_TOKEN:ghe.foo",
    );
    expect(
      keychainAccountFor({ kind: "github", host: "  GHE.foo  " }),
    ).toBe("GITHUB_TOKEN:ghe.foo");
  });
});
