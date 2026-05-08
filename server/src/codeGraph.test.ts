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
import {
  makeStubLspModule,
  type StubDocumentSymbol,
  type StubLocation,
  type StubLspHandle,
} from "./__fixtures__/stub-lsp.ts";

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
      { from: "Cart.php", to: "Routes.php", labels: ["Cart"], kind: "references" },
      { from: "Order.php", to: "Routes.php", labels: ["Order"], kind: "references" },
      { from: "OrderRepository.php", to: "Routes.php", labels: ["OrderRepository"], kind: "references" },
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
      { fromPath: "Utils.php", toPath: "Caller.php", labels: ["Builder", "Helper"], kind: "references" },
    ]);
  });

  it("diff scope keeps edges whose target is an unchanged repo file (context node)", async () => {
    const aPath = writeFile("A.php", "<?php\nclass A {}\n");
    const inSetCaller = writeFile("InSet.php", "<?php\nuse A;\n");
    // OutOfSet.php exists in the workspace but isn't part of the diff.
    // Its edge should still surface in the graph as a context node.
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

    const edgePairs = result.graph.edges
      .map((e) => `${e.fromPath}->${e.toPath}`)
      .sort();
    expect(edgePairs).toEqual(["A.php->InSet.php", "A.php->OutOfSet.php"]);

    const nodesByPath = new Map(result.graph.nodes.map((n) => [n.path, n]));
    expect(nodesByPath.get("A.php")?.role).toBe("changed");
    expect(nodesByPath.get("InSet.php")?.role).toBe("changed");
    expect(nodesByPath.get("OutOfSet.php")?.role).toBe("context");
  });

  it("diff scope drops edges to vendor/ and node_modules/", async () => {
    const aPath = writeFile("A.php", "<?php\nclass A {}\n");
    const vendorPath = writeFile("vendor/lib/Helper.php", "<?php\nuse A;\n");
    const nodeModulesPath = writeFile(
      "node_modules/pkg/Stub.php",
      "<?php\nuse A;\n",
    );
    const distPath = writeFile("dist/built.php", "<?php\nuse A;\n");

    const stub = makeStub({
      documentSymbol: {
        [aPath]: [{ name: "A", kind: 5, range: range(1, 6, 7), selectionRange: range(1, 6, 7) }],
      },
      references: {
        [`${aPath}:1:6`]: [
          { uri: `file://${vendorPath}`, range: range(1, 4, 5) },
          { uri: `file://${nodeModulesPath}`, range: range(1, 4, 5) },
          { uri: `file://${distPath}`, range: range(1, 4, 5) },
        ],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "A.php", text: "<?php\nclass A {}\n" }],
    });

    expect(result.graph.edges).toEqual([]);
    expect(result.graph.nodes.map((n) => n.path)).toEqual(["A.php"]);
  });

  it("diff scope drops edges to targets outside the workspace root", async () => {
    const aPath = writeFile("A.php", "<?php\nclass A {}\n");

    const stub = makeStub({
      documentSymbol: {
        [aPath]: [{ name: "A", kind: 5, range: range(1, 6, 7), selectionRange: range(1, 6, 7) }],
      },
      references: {
        [`${aPath}:1:6`]: [
          // Some other absolute path on the host. Sometimes intelephense's
          // global cache spits these out for stub bundles.
          { uri: `file:///tmp/elsewhere/Other.php`, range: range(1, 4, 5) },
        ],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "A.php", text: "<?php\nclass A {}\n" }],
    });

    expect(result.graph.edges).toEqual([]);
    expect(result.graph.nodes.map((n) => n.path)).toEqual(["A.php"]);
  });

  it("caps context nodes at 25, picking targets with the most incoming edges", async () => {
    // 30 unchanged repo files + 1 changed file (Routes.php) that references
    // every one of them. Targets ranked alphabetically (all tied at one
    // incoming edge each) — only the first 25 should appear as context.
    const totalContextFiles = 30;
    const contextPaths: string[] = [];
    for (let i = 0; i < totalContextFiles; i++) {
      const name = `Sibling${i.toString().padStart(2, "0")}.php`;
      writeFile(name, `<?php\nclass Sibling${i} {}\n`);
      contextPaths.push(name);
    }
    const routesPath = writeFile("Routes.php", "<?php\n// uses everything\n");

    const documentSymbol: Record<string, StubDocumentSymbol[]> = {
      [routesPath]: [
        { name: "Routes", kind: 5, range: range(1, 6, 12), selectionRange: range(1, 6, 12) },
      ],
    };
    // All siblings reference Routes (one incoming edge each into Routes.php)
    // would be the wrong shape. We want Routes' symbol to *be referenced
    // by* siblings, but we want Routes' refs to flow OUT from siblings to
    // Routes. The cleaner shape: Routes.php defines `Routes`, every
    // sibling references it. Then incoming on each sibling is 0; we need
    // edges going *out of* the changed file. So: each Sibling defines
    // its own class, and Routes.php references all of them — yielding
    // 30 edges Sibling*.php -> Routes.php. But the *target* of each
    // edge is Routes.php (in-set), which gives zero context edges.
    //
    // To get context targets, we need defining files in the request set
    // and using files outside it. So: Routes.php is the request file;
    // it defines a symbol `Routes`; each sibling references `Routes`.
    // That yields 30 edges Routes.php -> Sibling*.php with each sibling
    // as a context target. Each context node has one incoming edge — the
    // tie-breaker is alphabetical, so Sibling00..Sibling24 win.
    const allReferences: StubLocation[] = [];
    for (const sibling of contextPaths) {
      allReferences.push({
        uri: `file://${workspaceRoot}/${sibling}`,
        range: range(1, 4, 10),
      });
    }
    const references: Record<string, StubLocation[]> = {
      [`${routesPath}:1:6`]: allReferences,
    };

    const stub = makeStub({ documentSymbol, references });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [{ path: "Routes.php", text: "<?php\n// uses everything\n" }],
    });

    const contextNodes = result.graph.nodes.filter((n) => n.role === "context");
    expect(contextNodes.length).toBe(25);
    // Tie-broken alphabetically; first 25 of "Sibling00".."Sibling29" win.
    const expected = contextPaths.slice(0, 25).sort();
    expect(contextNodes.map((n) => n.path).sort()).toEqual(expected);
  });

  it("ranks context-node candidates by incoming-edge count", async () => {
    const heavyPath = writeFile("Heavy.php", "<?php\nclass Heavy {}\n");
    const lightPath = writeFile("Light.php", "<?php\nclass Light {}\n");
    // Three changed files all reference Heavy.php; only one references
    // Light.php. With cap=25 (well above 2), both should appear, but the
    // test asserts the ranker actually counts incoming edges.
    const callerPaths = ["A.php", "B.php", "C.php"].map((name) => {
      return writeFile(name, `<?php\nclass ${name.replace(".php", "")} {}\n`);
    });

    const documentSymbol: Record<string, StubDocumentSymbol[]> = {};
    const references: Record<string, StubLocation[]> = {};
    for (const callerAbs of callerPaths) {
      const baseName = path.basename(callerAbs).replace(".php", "");
      documentSymbol[callerAbs] = [
        { name: baseName, kind: 5, range: range(1, 6, 6 + baseName.length), selectionRange: range(1, 6, 6 + baseName.length) },
      ];
      references[`${callerAbs}:1:6`] = [
        { uri: `file://${heavyPath}`, range: range(1, 4, 9) },
      ];
    }
    // Only one caller also references Light.
    references[`${callerPaths[0]}:1:6`].push(
      { uri: `file://${lightPath}`, range: range(1, 4, 9) },
    );

    const stub = makeStub({ documentSymbol, references });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "A.php", text: "<?php\nclass A {}\n" },
        { path: "B.php", text: "<?php\nclass B {}\n" },
        { path: "C.php", text: "<?php\nclass C {}\n" },
      ],
    });

    const contextNodes = result.graph.nodes
      .filter((n) => n.role === "context")
      .map((n) => n.path)
      .sort();
    expect(contextNodes).toEqual(["Heavy.php", "Light.php"]);
    const heavyIncoming = result.graph.edges.filter((e) => e.toPath === "Heavy.php").length;
    const lightIncoming = result.graph.edges.filter((e) => e.toPath === "Light.php").length;
    expect(heavyIncoming).toBeGreaterThan(lightIncoming);
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

describe("resolveCodeGraph (node enrichment)", () => {
  it("populates pathRole, fileRole, shape, symbols, fanIn from LSP results", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const repoPath = writeFile(
      "OrderRepository.php",
      "<?php\nclass OrderRepository {}\n",
    );
    const routesPath = writeFile(
      "Routes.php",
      "<?php\nuse Cart; use OrderRepository;\n",
    );

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [
          { name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) },
          { name: "id", kind: 7, range: range(2, 4, 6), selectionRange: range(2, 4, 6) },
          { name: "name", kind: 7, range: range(3, 4, 8), selectionRange: range(3, 4, 8) },
          { name: "price", kind: 7, range: range(4, 4, 9), selectionRange: range(4, 4, 9) },
          { name: "qty", kind: 7, range: range(5, 4, 7), selectionRange: range(5, 4, 7) },
          { name: "save", kind: 6, range: range(6, 4, 8), selectionRange: range(6, 4, 8) },
        ],
        [repoPath]: [
          { name: "OrderRepository", kind: 5, range: range(1, 6, 21), selectionRange: range(1, 6, 21) },
        ],
        [routesPath]: [],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 4, 8) }],
        [`${cartPath}:2:4`]: [],
        [`${cartPath}:3:4`]: [],
        [`${cartPath}:4:4`]: [],
        [`${cartPath}:5:4`]: [],
        [`${cartPath}:6:4`]: [],
        [`${repoPath}:1:6`]: [{ uri: `file://${routesPath}`, range: range(1, 14, 30) }],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "OrderRepository.php", text: "<?php\nclass OrderRepository {}\n" },
        { path: "Routes.php", text: "<?php\nuse Cart; use OrderRepository;\n" },
      ],
    });

    const cart = result.graph.nodes.find((n) => n.path === "Cart.php")!;
    expect(cart.pathRole).toBe("code");
    expect(cart.fileRole).toBe("entity"); // 1 class, 4 properties, 1 method → upgraded
    expect(cart.shape).toEqual({ classes: 1, methods: 1, properties: 4 });
    expect(cart.symbols).toEqual([
      { name: "Cart", kind: "Class", line: 1 },
      { name: "id", kind: "Property", line: 2 },
      { name: "name", kind: "Property", line: 3 },
      { name: "price", kind: "Property", line: 4 },
      { name: "qty", kind: "Property", line: 5 },
      { name: "save", kind: "Method", line: 6 },
    ]);
    expect(cart.fanIn).toBe(1);

    const routes = result.graph.nodes.find((n) => n.path === "Routes.php")!;
    expect(routes.pathRole).toBe("route");
    expect(routes.fileRole).toBe("route");
    expect(routes.fanIn).toBeUndefined(); // no outgoing edges from Routes.php
  });

  it("picks 'tests' edge kind when test path corresponds to a class definer", async () => {
    const cartPath = writeFile("Cart.php", "<?php\nclass Cart {}\n");
    const testPath = writeFile("CartTest.php", "<?php\nuse Cart;\n");

    const stub = makeStub({
      documentSymbol: {
        [cartPath]: [
          { name: "Cart", kind: 5, range: range(1, 6, 10), selectionRange: range(1, 6, 10) },
        ],
        [testPath]: [],
      },
      references: {
        [`${cartPath}:1:6`]: [{ uri: `file://${testPath}`, range: range(1, 4, 8) }],
      },
    });
    installStubAsPhpLsp(stub);

    const result = await resolveCodeGraph({
      workspaceRoot,
      ref: "HEAD",
      scope: "diff",
      files: [
        { path: "Cart.php", text: "<?php\nclass Cart {}\n" },
        { path: "CartTest.php", text: "<?php\nuse Cart;\n" },
      ],
    });

    expect(result.graph.edges).toEqual([
      {
        fromPath: "Cart.php",
        toPath: "CartTest.php",
        labels: ["Cart"],
        kind: "tests",
      },
    ]);
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
