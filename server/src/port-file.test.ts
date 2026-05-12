import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  portFilePath,
  removePortFile,
  SCHEMA_VERSION,
  writePortFile,
  type PortFileContent,
} from "./port-file.ts";

describe("portFilePath", () => {
  it("uses ~/Library/Application Support on darwin when HOME is set", () => {
    if (process.platform !== "darwin") return;
    const path = portFilePath({ HOME: "/Users/test" });
    expect(path).toBe(
      "/Users/test/Library/Application Support/Shippable/port.json",
    );
  });

  it("returns null when no usable home directory is available", () => {
    // Strip every env var the resolver consults. We don't care about the
    // platform branch — every branch returns null when its home var is unset.
    const path = portFilePath({});
    expect(path).toBeNull();
  });
});

describe("writePortFile + removePortFile", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "shippable-port-"));
    path = join(dir, "port.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a v1 file with port, pid, and ISO startedAt", async () => {
    await writePortFile(4242, {
      path,
      pid: 12345,
      now: () => new Date("2026-05-11T20:27:00Z"),
    });

    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as PortFileContent;
    expect(parsed).toEqual({
      schemaVersion: SCHEMA_VERSION,
      port: 4242,
      pid: 12345,
      startedAt: "2026-05-11T20:27:00.000Z",
    });
  });

  it("creates the parent directory when it doesn't exist", async () => {
    const nested = join(dir, "a", "b", "port.json");
    await writePortFile(5000, { path: nested });
    const info = await stat(nested);
    expect(info.isFile()).toBe(true);
  });

  it("overwrites an existing file atomically (subsequent writes replace)", async () => {
    await writePortFile(4000, { path });
    await writePortFile(5000, { path });
    const parsed = JSON.parse(await readFile(path, "utf8")) as PortFileContent;
    expect(parsed.port).toBe(5000);
  });

  it("removePortFile is a no-op when the file is missing", async () => {
    await expect(removePortFile({ path })).resolves.toBeUndefined();
  });

  it("removePortFile deletes an existing file", async () => {
    await writePortFile(4242, { path });
    await removePortFile({ path });
    await expect(stat(path)).rejects.toThrow(/ENOENT/);
  });
});
