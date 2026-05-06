import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefinitionCapabilities, resolveDefinition } from "./definitions.ts";

let tmpRoot: string;
const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_WORKSPACE_ROOT = process.env.SHIPPABLE_WORKSPACE_ROOT;

function makeFakeBinary(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return file;
}

function makeGitWorktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-defs-"));
  execSync("git init -q", { cwd: root });
  return root;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-defs-bin-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_WORKSPACE_ROOT === undefined) {
    delete process.env.SHIPPABLE_WORKSPACE_ROOT;
  } else {
    process.env.SHIPPABLE_WORKSPACE_ROOT = ORIGINAL_WORKSPACE_ROOT;
  }
  delete process.env.SHIPPABLE_TYPESCRIPT_LSP;
  delete process.env.SHIPPABLE_PHP_LSP;
});

describe("getDefinitionCapabilities", () => {
  it("reports per-language availability with recommendedSetup attached", () => {
    process.env.PATH = "/dev/null";

    const caps = getDefinitionCapabilities();

    expect(caps.requiresWorktree).toBe(true);
    expect(caps.anyAvailable).toBe(false);
    const ts = caps.languages.find((l) => l.id === "ts");
    const php = caps.languages.find((l) => l.id === "php");
    expect(ts).toBeDefined();
    expect(php).toBeDefined();
    expect(ts!.languageIds).toEqual(expect.arrayContaining(["ts", "tsx", "js", "jsx"]));
    expect(php!.languageIds).toEqual(["php"]);
    expect(ts!.available).toBe(false);
    expect(php!.available).toBe(false);
    expect(ts!.recommendedSetup.length).toBeGreaterThan(0);
    expect(php!.recommendedSetup.length).toBeGreaterThan(0);
  });

  it("reports a configured TS LSP with source=configured", () => {
    const binary = makeFakeBinary(tmpRoot, "typescript-language-server");
    process.env.SHIPPABLE_TYPESCRIPT_LSP = binary;
    process.env.PATH = "/dev/null";

    const caps = getDefinitionCapabilities();

    const ts = caps.languages.find((l) => l.id === "ts")!;
    expect(ts.available).toBe(true);
    expect(ts.source).toBe("configured");
    expect(ts.resolver).toBe("typescript-language-server");
    expect(caps.anyAvailable).toBe(true);
  });

  it("reports a PATH-discovered intelephense as the PHP resolver", () => {
    const binDir = path.join(tmpRoot, "bin");
    makeFakeBinary(binDir, "intelephense");
    process.env.PATH = binDir;

    const caps = getDefinitionCapabilities();

    const php = caps.languages.find((l) => l.id === "php")!;
    expect(php.available).toBe(true);
    expect(php.resolver).toBe("intelephense");
    expect(php.source).toBe("path");
  });
});

describe("resolveDefinition (validation)", () => {
  it("returns unsupported when language is unrecognized", async () => {
    const root = makeGitWorktree();
    fs.writeFileSync(path.join(root, "main.py"), "print('hi')\n");

    const result = await resolveDefinition({
      file: "main.py",
      language: "python",
      line: 0,
      col: 0,
      workspaceRoot: root,
    });

    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toMatch(/doesn't support/);
      expect(result.reason).toMatch(/Supported:/);
    }
  });

  it("rejects non-absolute workspace roots", async () => {
    const result = await resolveDefinition({
      file: "x.ts",
      language: "ts",
      line: 0,
      col: 0,
      workspaceRoot: "relative/path",
    });

    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toMatch(/absolute path/);
    }
  });

  it("rejects requests escaping the workspace root", async () => {
    const root = makeGitWorktree();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-outside-"));
    fs.writeFileSync(path.join(outside, "secret.ts"), "");

    try {
      const result = await resolveDefinition({
        file: `${path.relative(root, path.join(outside, "secret.ts"))}`,
        language: "ts",
        line: 0,
        col: 0,
        workspaceRoot: root,
      });

      expect(result.status).toBe("unsupported");
      if (result.status === "unsupported") {
        expect(result.reason).toMatch(/escapes workspace root|file not found/);
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects negative line/col integers", async () => {
    const root = makeGitWorktree();
    fs.writeFileSync(path.join(root, "x.ts"), "");

    const result = await resolveDefinition({
      file: "x.ts",
      language: "ts",
      line: -1,
      col: 0,
      workspaceRoot: root,
    });

    expect(result.status).toBe("unsupported");
  });

  it("returns unsupported when no PHP LSP is installed even for a real .php file", async () => {
    const root = makeGitWorktree();
    fs.writeFileSync(path.join(root, "x.php"), "<?php echo 1;\n");
    process.env.PATH = "/dev/null";

    const result = await resolveDefinition({
      file: "x.php",
      language: "php",
      line: 0,
      col: 0,
      workspaceRoot: root,
    });

    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toMatch(/PHP language server/);
    }
  });
});
