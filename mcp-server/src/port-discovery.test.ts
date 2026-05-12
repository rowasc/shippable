import { describe, expect, it } from "vitest";

import { discoverSidecarPort, portFilePath } from "./port-discovery.js";

function makeFetchOk(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

function makeFetchFail(status = 503): typeof fetch {
  return (async () => new Response("", { status })) as typeof fetch;
}

function makeFetchThrow(err: Error): typeof fetch {
  return (async () => {
    throw err;
  }) as typeof fetch;
}

describe("portFilePath (mcp-server mirror)", () => {
  it("matches the server-side path on darwin", () => {
    if (process.platform !== "darwin") return;
    expect(portFilePath({ HOME: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/Shippable/port.json",
    );
  });
});

describe("discoverSidecarPort", () => {
  it("returns null when the path resolver returns null", async () => {
    const port = await discoverSidecarPort({ path: null });
    expect(port).toBeNull();
  });

  it("returns null when the file read fails", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(port).toBeNull();
  });

  it("returns null when the file is not JSON", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () => "not-json",
    });
    expect(port).toBeNull();
  });

  it("returns null when the port is missing or non-numeric", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () => JSON.stringify({ schemaVersion: 1 }),
    });
    expect(port).toBeNull();
  });

  it("returns null when health check fails (5xx)", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () =>
        JSON.stringify({ schemaVersion: 1, port: 4242 }),
      fetchFn: makeFetchFail(),
    });
    expect(port).toBeNull();
  });

  it("returns null when health check throws (stale port file, sidecar dead)", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () =>
        JSON.stringify({ schemaVersion: 1, port: 4242 }),
      fetchFn: makeFetchThrow(new Error("ECONNREFUSED")),
    });
    expect(port).toBeNull();
  });

  it("returns the port when the file is valid and health check is OK", async () => {
    const port = await discoverSidecarPort({
      path: "/whatever",
      readFileFn: async () =>
        JSON.stringify({ schemaVersion: 1, port: 52613, pid: 1, startedAt: "x" }),
      fetchFn: makeFetchOk(),
    });
    expect(port).toBe(52613);
  });
});
