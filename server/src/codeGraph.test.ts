import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveCodeGraph,
  invalidateCodeGraphForWorkspace,
  _resetCodeGraphCacheForTests,
} from "./codeGraph.ts";
import { makeStubLspModule, type StubLspHandle } from "./__fixtures__/stub-lsp.ts";

const ORIGINAL_PHP_LSP = process.env.SHIPPABLE_PHP_LSP;
const ORIGINAL_TS_LSP = process.env.SHIPPABLE_TYPESCRIPT_LSP;
const ORIGINAL_PATH = process.env.PATH;

let workspaceRoot: string;
const handles: StubLspHandle[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-cg-"));
  execSync("git init -q", { cwd: root });
  return root;
}

function writeFile(rel: string, body: string): string {
  const abs = path.join(workspaceRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

function range(line: number, col: number, endCol = col + 1) {
  return { start: { line, character: col }, end: { line, character: endCol } };
}

beforeEach(() => {
  workspaceRoot = makeWorkspace();
  _resetCodeGraphCacheForTests();
  // Force-disable real LSP discovery for languages we're not stubbing.
  process.env.PATH = "/dev/null";
  delete process.env.SHIPPABLE_TYPESCRIPT_LSP;
  delete process.env.SHIPPABLE_PHP_LSP;
});

afterEach(async () => {
  await invalidateCodeGraphForWorkspace(workspaceRoot);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  while (handles.length) handles.pop()!.cleanup();
  process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_PHP_LSP === undefined) delete process.env.SHIPPABLE_PHP_LSP;
  else process.env.SHIPPABLE_PHP_LSP = ORIGINAL_PHP_LSP;
  if (ORIGINAL_TS_LSP === undefined) delete process.env.SHIPPABLE_TYPESCRIPT_LSP;
  else process.env.SHIPPABLE_TYPESCRIPT_LSP = ORIGINAL_TS_LSP;
});

function installStubAsPhpLsp(handle: StubLspHandle): void {
  process.env.SHIPPABLE_PHP_LSP = handle.wrapperPath;
}

function makeStub(config: Parameters<typeof makeStubLspModule>[0]): StubLspHandle {
  const handle = makeStubLspModule(config);
  handles.push(handle);
  return handle;
}

describe("resolveCodeGraph (LSP-derived edges)", () => {
  it("buckets references into one edge per defining_file → using_file pair, with symbol labels", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const orderPath = writeFile("Order.php", "<?php\nclass Order {}\n");
    const repoPath = writeFile("OrderRepository.php", "<?php\nclass OrderRepository {}\n");
    const routesPath = writeFile("Routes.php", "<?php\nuse Cart; use Order; use OrderRepository;\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [{ name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) }],
        [orderPath]: [{ name: "Order", kind: 5, range: range(1, 6, 11), selectionRange: range(1, 6, 11) }],
        [repoPath]: [{ name: "OrderRepository", kind: 5, range: range(1, 6, 21), selectionRange: range(1, 6, 21) }],
        [routesPath]: [{ name: "Routes", kind: 5, range: range(0, 0, 6), selectionRange: range(0, 0, 6) }],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 4, 8) }],
        [`${orderPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 14, 19) }],
        [`${repoPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 25, 40) }],
        [`${routesPath}:0:0`]: [],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "Order.php", text: "<?php\nclass Order {}\n" },
        { path: "OrderRepository.php", text: "<?php\nclass OrderRepository {}\n" },
        { path: "Routes.php", text: "<?php\nuse Cart; use Order; use OrderRepository;\n" },
      ],
    });

    expect(result.sources).toEqual([{ language: "php", resolver: "lsp" }]);
    const edges = result.graph.edges
      .map((e) => ({ from: e.fromPath, to: e.toPath, labels: e.labels, kind: e.kind }))
      .sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
    expect(edges).toEqual([
      { from: "Cart.php", to: "Routes.php", labels: ["Cart"], kind: "symbol" },
      { from: "Order.php", to: "Routes.php", labels: ["Order"], kind: "symbol" },
      { from: "OrderRepository.php", to: "Routes.php", labels: ["OrderRepository"], kind: "symbol" },
    ]);
  });

  it("collapses multiple symbols from one defining file into one edge with multiple labels", async () => {
    const utilsPath = writeFile("Utils.php", "<?php\nclass Helper {}\nclass Builder {}\n");
    const callerPath = writeFile("Caller.php", "<?php\nuse Helper; use Builder;\n");

    const stub = makeStub({
      documentSymbol: {
        [utilsPath]: [
          { name: "Helper", kind: 5, range: range(1, 6, 12), selectionRange: range(1, 6, 12) },
          { name: "Builder", kind: 5, range: range(2, 6, 13), selectionRange: range(2, 6, 13) },
        ],
        [callerPath]: [],
      },
      references: {
        [`${utilsPath}:1:6`]: [{ uri: `file://${callerPath}`, range: range(1, 4, 10) }],
        [`${utilsPath}:2:6`]: [{ uri: `file://${callerPath}`, range: range(1, 16, 23) }],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "Utils.php", text: "<?php\nclass Helper {}\nclass Builder {}\n" },
        { path: "Caller.php", text: "<?php\nuse Helper; use Builder;\n" },
      ],
    });

    expect(result.graph.edges).toEqual([
      { fromPath: "Utils.php", toPath: "Caller.php", labels: ["Builder", "Helper"], kind: "symbol" },
    ]);
  });

  it("drops references that point outside the requested file set", async () => {
    const aPath = writeFile("A.php", "<?php\nclass A {}\n");
    const inSetCaller = writeFile("InSet.php", "<?php\nuse A;\n");
    writeFile("OutOfSet.php", "<?php\nuse A;\n");

    const stub = makeStub({
      documentSymbol: {
        [aPath]: [{ name: "A", kind: 5, range: range(1, 6, 7), selectionRange: range(1, 6, 7) }],
        [inSetCaller]: [],
      },
      references: {
        [`${aPath}:1:6`]: [
          { uri: `file://${inSetCaller}`, range: range(1, 4, 5) },
          { uri: `file://${workspaceRoot}/OutOfSet.php`, range: range(1, 4, 5) },
        ],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "A.php", text: "<?php\nclass A {}\n" },
        { path: "InSet.php", text: "<?php\nuse A;\n" },
      ],
    });

    expect(result.graph.edges.map((e) => `${e.fromPath}->${e.toPath}`)).toEqual([
      "A.php->InSet.php",
    ]);
  });
});

describe("resolveCodeGraph (resolver mixing)", () => {
  it("uses LSP for PHP and regex for TS in the same request without double-counting edges", async () => {
    // Put a TS pair that have a regex-resolvable import, plus a PHP pair
    // that depends on stub LSP to bucket.
    writeFile("a.ts", `import { used } from "./b";\nused();\n`);
    writeFile("b.ts", `export function used() {}\n`);
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const routesPath = writeFile("Routes.php", "<?php\nuse Cart;\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [{ name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) }],
        [routesPath]: [],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 4, 8) }],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "a.ts", text: `import { used } from "./b";\nused();\n` },
        { path: "b.ts", text: `export function used() {}\n` },
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "Routes.php", text: "<?php\nuse Cart;\n" },
      ],
    });

    expect(result.sources).toContainEqual({ language: "php", resolver: "lsp" });
    expect(result.sources).toContainEqual({ language: "ts", resolver: "regex" });

    const edgePairs = result.graph.edges.map((e) => `${e.fromPath}->${e.toPath}`).sort();
    expect(edgePairs).toContain("Cart.php->Routes.php"); // LSP-derived
    expect(edgePairs).toContain("b.ts->a.ts"); // regex-derived
    expect(new Set(edgePairs).size).toBe(edgePairs.length); // no duplicates
  });
});

describe("resolveCodeGraph (capability fallback)", () => {
  it("falls back to regex when the LSP server doesn't advertise documentSymbol/references", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");

    const stub = makeStub({
      advertise: { documentSymbolProvider: false, referencesProvider: false, definitionProvider: true },
      // No canned LSP responses — should never be queried.
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "Cart.php", text: "<?php\nclass Cart {}\n" }],
    });

    expect(result.sources).toEqual([{ language: "php", resolver: "lsp" }]);
    // Regex builder doesn't understand PHP imports — no edges, but also no
    // crash; the regex-resolver branch ran without LSP queries.
    expect(result.graph.edges).toEqual([]);
    const stats = stub.readStats();
    expect(stats.counts["textDocument/documentSymbol"]).toBeUndefined();
    expect(stats.counts["textDocument/references"]).toBeUndefined();
  });
});

describe("resolveCodeGraph (cache)", () => {
  it("does not re-query the LSP on a second identical call", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const routesPath = writeFile("Routes.php", "<?php\nuse Cart;\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [{ name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) }],
        [routesPath]: [],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 4, 8) }],
      },
    });
    installStubAsPhpLsp(stub);

    const request = {
      workspaceRoot,
      ref: "HEAD",
      scope: "diff" as const,
      files: [
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "Routes.php", text: "<?php\nuse Cart;\n" },
      ],
    };

    const first = await resolveCodeGraph(request);
    const firstStats = stub.readStats();

    const second = await resolveCodeGraph(request);
    const secondStats = stub.readStats();

    expect(second.graph).toEqual(first.graph);
    expect(secondStats.counts["textDocument/documentSymbol"]).toBe(
      firstStats.counts["textDocument/documentSymbol"],
    );
    expect(secondStats.counts["textDocument/references"]).toBe(
      firstStats.counts["textDocument/references"],
    );
  });

  it("re-queries after invalidateCodeGraphForWorkspace", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const routesPath = writeFile("Routes.php", "<?php\nuse Cart;\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [{ name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) }],
        [routesPath]: [],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 4, 8) }],
      },
    });
    installStubAsPhpLsp(stub);

    const request = {
      workspaceRoot,
      ref: "HEAD",
      scope: "diff" as const,
      files: [
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "Routes.php", text: "<?php\nuse Cart;\n" },
      ],
    };

    await resolveCodeGraph(request);
    await invalidateCodeGraphForWorkspace(workspaceRoot);
    await resolveCodeGraph(request);

    // After invalidation the LSP client is also disposed, so the second
    // call respawns the stub. Check that documentSymbol fired across at
    // least two distinct subprocess lifetimes by counting `initialize`.
    const stats = stub.readStats();
    expect(stats.counts["initialize"]).toBeGreaterThanOrEqual(2);
  });

  it("re-queries when file content changes (content-hash key)", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [{ name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) }],
      },
      references: {
        [`${cartPath}:1:6`]: [],
      },
    });
    installStubAsPhpLsp(stub);

    const before = stub.readStats();
    await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "Cart.php", text: "<?php\nclass Cart {}\n" }],
    });
    const afterFirst = stub.readStats();
    expect(afterFirst.counts["textDocument/documentSymbol"]).toBe(1);

    await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "Cart.php", text: "<?php\nclass Cart { public function x() {} }\n" }],
    });
    const afterSecond = stub.readStats();
    expect(afterSecond.counts["textDocument/documentSymbol"]).toBe(2);
  });
});

describe("resolveCodeGraph (validation)", () => {
  it("rejects relative workspaceRoot", async () => {
    await expect(
      resolveCodeGraph({ workspaceRoot: "rel/path", ref: "HEAD", scope: "diff", files: [] }),
    ).rejects.toThrow(/absolute/);
  });

  it("rejects path traversal in file entries", async () => {
    await expect(
      resolveCodeGraph({
        workspaceRoot,
        ref: "HEAD",
        scope: "diff",
        files: [{ path: "../escape.php", text: "" }],
      }),
    ).rejects.toThrow(/'\.\.'/);
  });

  it("rejects a ref that starts with '-'", async () => {
    await expect(
      resolveCodeGraph({ workspaceRoot, ref: "--upload-pack=bad", scope: "diff", files: [] }),
    ).rejects.toThrow(/ref must not start/);
  });
});
