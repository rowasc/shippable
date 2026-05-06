import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { phpLanguage } from "./php.ts";

let tmpRoot: string;
const ORIGINAL_PATH = process.env.PATH;

function makeExecutable(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return file;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-php-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.env.PATH = ORIGINAL_PATH;
  delete process.env.SHIPPABLE_PHP_LSP;
});

describe("phpLanguage", () => {
  it("declares .php and .phtml as workspace extensions", () => {
    expect(phpLanguage.extensions).toContain(".php");
    expect(phpLanguage.extensions).toContain(".phtml");
  });

  it("maps both extensions to the LSP language id 'php'", () => {
    expect(phpLanguage.lspLanguageIdByExtension[".php"]).toBe("php");
    expect(phpLanguage.lspLanguageIdByExtension[".phtml"]).toBe("php");
  });

  it("infers --stdio when SHIPPABLE_PHP_LSP looks like intelephense", () => {
    const binary = makeExecutable(tmpRoot, "intelephense");
    process.env.SHIPPABLE_PHP_LSP = binary;

    expect(phpLanguage.discover()).toEqual({
      command: binary,
      args: ["--stdio"],
      source: "configured",
    });
  });

  it("infers 'language-server' when SHIPPABLE_PHP_LSP looks like phpactor", () => {
    const binary = makeExecutable(tmpRoot, "phpactor");
    process.env.SHIPPABLE_PHP_LSP = binary;

    expect(phpLanguage.discover()).toEqual({
      command: binary,
      args: ["language-server"],
      source: "configured",
    });
  });

  it("prefers intelephense on PATH over phpactor on PATH", () => {
    const intelephenseDir = path.join(tmpRoot, "intelephense-dir");
    const phpactorDir = path.join(tmpRoot, "phpactor-dir");
    const intelephense = makeExecutable(intelephenseDir, "intelephense");
    makeExecutable(phpactorDir, "phpactor");
    // Order: phpactor first to verify intelephense wins regardless.
    process.env.PATH = `${phpactorDir}${path.delimiter}${intelephenseDir}`;

    expect(phpLanguage.discover()).toEqual({
      command: intelephense,
      args: ["--stdio"],
      source: "path",
    });
  });

  it("falls back to phpactor on PATH when intelephense is missing", () => {
    const phpactorDir = path.join(tmpRoot, "phpactor-dir");
    const phpactor = makeExecutable(phpactorDir, "phpactor");
    process.env.PATH = phpactorDir;

    expect(phpLanguage.discover()).toEqual({
      command: phpactor,
      args: ["language-server"],
      source: "path",
    });
  });

  it("returns null when neither binary is available", () => {
    process.env.PATH = "/dev/null";
    expect(phpLanguage.discover()).toBeNull();
  });

  it("ships a recommendedSetup so the UI can guide users when discovery fails", () => {
    expect(phpLanguage.recommendedSetup.length).toBeGreaterThan(0);
    const intelephense = phpLanguage.recommendedSetup.find((r) =>
      r.command.includes("intelephense"),
    );
    expect(intelephense).toBeDefined();
  });
});
