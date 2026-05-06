import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { checkMcpStatus, resolveInstallCommand } from "./mcp-status.ts";

let tmpdir: string;
let settingsJson: string;
let settingsLocalJson: string;
let claudeJson: string;

beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-mcp-status-"));
  settingsJson = path.join(tmpdir, "settings.json");
  settingsLocalJson = path.join(tmpdir, "settings.local.json");
  claudeJson = path.join(tmpdir, ".claude.json");
});

afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true });
});

describe("checkMcpStatus", () => {
  it("returns { installed: false } when no settings files exist", async () => {
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("returns { installed: true } when mcpServers.shippable is set in settings.json", async () => {
    await fs.writeFile(
      settingsJson,
      JSON.stringify({
        mcpServers: {
          shippable: {
            command: "npx",
            args: ["-y", "@shippable/mcp-server"],
          },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });

  it("returns { installed: true } when mcpServers.shippable is set in settings.local.json only", async () => {
    await fs.writeFile(
      settingsLocalJson,
      JSON.stringify({
        mcpServers: {
          shippable: { command: "node", args: ["/abs/path/dist/index.js"] },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });

  it("returns { installed: false } when mcpServers exists but has no shippable entry", async () => {
    await fs.writeFile(
      settingsJson,
      JSON.stringify({
        mcpServers: {
          someOtherTool: { command: "x" },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("returns { installed: false } and does not throw on malformed JSON", async () => {
    await fs.writeFile(settingsJson, "{ not really json");
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("returns { installed: false } when settings.json is JSON but not an object", async () => {
    await fs.writeFile(settingsJson, JSON.stringify(["array", "not object"]));
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("accepts permissive variants like `mcp.shippable`", async () => {
    // Some harnesses use `mcp` as the top-level key. We accept it permissively
    // so we don't false-negative users who configured via a sibling tool.
    await fs.writeFile(
      settingsJson,
      JSON.stringify({
        mcp: {
          shippable: { command: "npx" },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });

  it("returns false when shippable lives under an unrelated top-level key", async () => {
    await fs.writeFile(
      settingsJson,
      JSON.stringify({
        permissions: {
          shippable: "some other thing",
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });
});

describe("checkMcpStatus — ~/.claude.json (user + project scope)", () => {
  // `claude mcp add shippable …` writes to ~/.claude.json, not the
  // ~/.claude/settings*.json files. Two scopes:
  //   - --scope user → top-level `mcpServers.shippable`
  //   - default (project) → `projects["<abs-cwd>"].mcpServers.shippable`
  // Either path should flip the affordance to ✓.

  it("detects user-scope installs at top-level mcpServers.shippable", async () => {
    await fs.writeFile(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          shippable: {
            command: "node",
            args: ["/abs/path/to/mcp-server/dist/index.js"],
          },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });

  it("detects project-scope installs at projects.<abs-path>.mcpServers.shippable", async () => {
    // Mirrors the live smoke-test layout: the user ran `claude mcp add` from
    // inside a repo and the entry landed under that repo's absolute path.
    await fs.writeFile(
      claudeJson,
      JSON.stringify({
        projects: {
          "/Users/someone/Development/shippable": {
            mcpServers: {
              shippable: {
                command: "node",
                args: ["/abs/path/dist/index.js"],
              },
            },
          },
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });

  it("returns { installed: false } when ~/.claude.json is missing", async () => {
    // No file written; resolver should treat it the same as the settings
    // files (silent, no throw).
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("returns { installed: false } and does not throw on malformed ~/.claude.json", async () => {
    await fs.writeFile(claudeJson, "{ truncated json…");
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("returns { installed: false } when projects exist but none declare shippable", async () => {
    await fs.writeFile(
      claudeJson,
      JSON.stringify({
        projects: {
          "/some/repo": { mcpServers: { unrelated: { command: "x" } } },
          "/another/repo": {},
        },
      }),
    );
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(false);
  });

  it("settings.json hit short-circuits before ~/.claude.json is consulted", async () => {
    // Sanity: if the legacy settings file already has the entry, we never
    // need to fall through to ~/.claude.json. Using a malformed claudeJson
    // ensures we'd notice if the helper read it anyway.
    await fs.writeFile(
      settingsJson,
      JSON.stringify({ mcpServers: { shippable: { command: "x" } } }),
    );
    await fs.writeFile(claudeJson, "{ not json");
    const status = await checkMcpStatus(
      [settingsJson, settingsLocalJson],
      claudeJson,
    );
    expect(status.installed).toBe(true);
  });
});

describe("resolveInstallCommand", () => {
  // Slice-3 follow-up: until @shippable/mcp-server lands on npm, the panel
  // chip and README primary install line use the local-build form. The
  // resolver detects whether `mcp-server/dist/index.js` exists relative to
  // its own source location; if so → local-build line, else → npx fallback.
  // Tests use a temp tree shaped like the real repo so we can exercise both
  // paths without polluting the real checkout.
  const NPX_FORM = "claude mcp add shippable -- npx -y @shippable/mcp-server";

  let layoutDir: string;
  let fakeServerSrc: string;

  beforeEach(async () => {
    layoutDir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-installcmd-"));
    // Mirror the real layout: <layoutDir>/server/src/mcp-status.ts (fake
    // source) and <layoutDir>/mcp-server/dist/index.js. The resolver walks
    // up two dirs from its source-file path, then into mcp-server/dist.
    fakeServerSrc = path.join(layoutDir, "server", "src", "mcp-status.ts");
    await fs.mkdir(path.dirname(fakeServerSrc), { recursive: true });
    await fs.writeFile(fakeServerSrc, "// stub");
  });

  afterEach(async () => {
    await fs.rm(layoutDir, { recursive: true, force: true });
  });

  it("returns the local-build form when mcp-server/dist/index.js exists", async () => {
    const distFile = path.join(layoutDir, "mcp-server", "dist", "index.js");
    await fs.mkdir(path.dirname(distFile), { recursive: true });
    await fs.writeFile(distFile, "// fake mcp build");
    const cmd = await resolveInstallCommand(pathToFileURL(fakeServerSrc).href);
    expect(cmd).toBe(`claude mcp add shippable -- node ${distFile}`);
    // Sanity: the command embeds an absolute path the user can copy + run.
    expect(path.isAbsolute(distFile)).toBe(true);
  });

  it("falls back to the npx form when mcp-server/dist/index.js is missing", async () => {
    // No mcp-server directory created in this test — fs.access throws and
    // the resolver short-circuits to the documented npx line.
    const cmd = await resolveInstallCommand(pathToFileURL(fakeServerSrc).href);
    expect(cmd).toBe(NPX_FORM);
  });
});
