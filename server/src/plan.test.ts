import { describe, expect, it } from "vitest";

import { elideReason } from "./plan.ts";

describe("elideReason", () => {
  it("elides known lockfiles by basename, anywhere in the tree", () => {
    expect(elideReason("package-lock.json")).toBe("auto-generated lockfile");
    expect(elideReason("apps/web/package-lock.json")).toBe(
      "auto-generated lockfile",
    );
    expect(elideReason("yarn.lock")).toBe("auto-generated lockfile");
    expect(elideReason("Cargo.lock")).toBe("auto-generated lockfile");
    expect(elideReason("go.sum")).toBe("auto-generated lockfile");
  });

  it("elides files with common binary extensions, case-insensitive", () => {
    expect(elideReason("docs/diagram.png")).toBe("binary (.png)");
    expect(elideReason("ICON.PNG")).toBe("binary (.png)");
    expect(elideReason("fonts/inter.woff2")).toBe("binary (.woff2)");
  });

  it("returns null for normal source files", () => {
    expect(elideReason("src/index.ts")).toBeNull();
    expect(elideReason("README.md")).toBeNull();
    expect(elideReason("package.json")).toBeNull();
    expect(elideReason("Cargo.toml")).toBeNull();
  });

  it("does not match lockfile-like names that aren't the exact basename", () => {
    // Guard against an over-eager substring/regex match.
    expect(elideReason("src/package-lock-utils.ts")).toBeNull();
    expect(elideReason("docs/yarn.lock.md")).toBeNull();
  });
});
