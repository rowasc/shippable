import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checkMcpStatus } from "./mcp-status.ts";

let tmpdir: string;
let settingsJson: string;
let settingsLocalJson: string;

beforeEach(async () => {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "shippable-mcp-status-"));
  settingsJson = path.join(tmpdir, "settings.json");
  settingsLocalJson = path.join(tmpdir, "settings.local.json");
});

afterEach(async () => {
  await fs.rm(tmpdir, { recursive: true, force: true });
});

describe("checkMcpStatus", () => {
  it("returns { installed: false } when no settings files exist", async () => {
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: false });
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
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: true });
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
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: true });
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
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: false });
  });

  it("returns { installed: false } and does not throw on malformed JSON", async () => {
    await fs.writeFile(settingsJson, "{ not really json");
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: false });
  });

  it("returns { installed: false } when settings.json is JSON but not an object", async () => {
    await fs.writeFile(settingsJson, JSON.stringify(["array", "not object"]));
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: false });
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
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: true });
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
    const status = await checkMcpStatus([settingsJson, settingsLocalJson]);
    expect(status).toEqual({ installed: false });
  });
});
