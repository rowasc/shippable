import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findExecutable } from "./discovery.ts";

let tmpRoot: string;
const ORIGINAL_PATH = process.env.PATH;

function makeExecutable(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return file;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-discover-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.env.PATH = ORIGINAL_PATH;
  delete process.env.SHIPPABLE_TEST_LSP;
});

describe("findExecutable", () => {
  it("returns the env-var binary when configured", () => {
    const binary = makeExecutable(tmpRoot, "fake-lsp");
    process.env.SHIPPABLE_TEST_LSP = binary;

    const result = findExecutable({
      envVar: "SHIPPABLE_TEST_LSP",
      args: ["--stdio"],
    });

    expect(result).toEqual({
      command: binary,
      args: ["--stdio"],
      source: "configured",
    });
  });

  it("returns null when the env var points at a non-executable", () => {
    const file = path.join(tmpRoot, "not-executable");
    fs.writeFileSync(file, "");
    process.env.SHIPPABLE_TEST_LSP = file;

    expect(findExecutable({ envVar: "SHIPPABLE_TEST_LSP" })).toBeNull();
  });

  it("does not fall through to PATH when the env var points at a missing binary", () => {
    // Misconfiguration should be loud, not silent.
    process.env.SHIPPABLE_TEST_LSP = path.join(tmpRoot, "missing");
    process.env.PATH = "/usr/bin";

    expect(
      findExecutable({ envVar: "SHIPPABLE_TEST_LSP", binary: "ls" }),
    ).toBeNull();
  });

  it("finds a binary on PATH", () => {
    const dir = path.join(tmpRoot, "bin");
    const binary = makeExecutable(dir, "fake-lsp");
    process.env.PATH = dir;

    const result = findExecutable({ binary: "fake-lsp", args: ["--stdio"] });

    expect(result).toEqual({
      command: binary,
      args: ["--stdio"],
      source: "path",
    });
  });

  it("falls back to project bins when not on PATH", () => {
    const projectBin = path.join(tmpRoot, "node_modules", ".bin");
    const binary = makeExecutable(projectBin, "fake-lsp");
    process.env.PATH = "/dev/null"; // ensure not on PATH

    const result = findExecutable({
      binary: "fake-lsp",
      projectBins: [projectBin],
    });

    expect(result).toEqual({
      command: binary,
      args: [],
      source: "node_modules",
    });
  });

  it("classifies a vendor/bin discovery source", () => {
    const vendorBin = path.join(tmpRoot, "vendor", "bin");
    makeExecutable(vendorBin, "phpactor");
    process.env.PATH = "/dev/null";

    const result = findExecutable({
      binary: "phpactor",
      projectBins: [vendorBin],
    });

    expect(result?.source).toBe("vendor");
  });

  it("returns null when no binary is found anywhere", () => {
    process.env.PATH = "/dev/null";
    expect(findExecutable({ binary: "definitely-missing" })).toBeNull();
  });
});
