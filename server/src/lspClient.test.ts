import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLspClient, disposeLspClientsForWorkspace } from "./lspClient.ts";
import { makeStubLspModule, type StubLspHandle } from "./__fixtures__/stub-lsp.ts";

let workspaceRoot: string;
const handles: StubLspHandle[] = [];

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-lsp-client-"));
  execSync("git init -q", { cwd: root });
  return root;
}

beforeEach(() => {
  workspaceRoot = makeWorkspace();
});

afterEach(async () => {
  await disposeLspClientsForWorkspace(workspaceRoot);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  while (handles.length) handles.pop()!.cleanup();
});

function makeStub(config: Parameters<typeof makeStubLspModule>[0]): StubLspHandle {
  const handle = makeStubLspModule(config);
  handles.push(handle);
  return handle;
}

describe("LspClient concurrency", () => {
  it("pipelines N references calls so wall-clock is well under N x delay", async () => {
    const filePath = path.join(workspaceRoot, "Routes.php");
    fs.writeFileSync(filePath, "<?php\nclass Routes {}\n");

    const fileUri = `file://${filePath}`;
    const references: Record<string, Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> = {};
    for (let i = 0; i < 20; i++) {
      references[`${filePath}:${i}:0`] = [
        {
          uri: `file://${workspaceRoot}/Caller${i}.php`,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
      ];
    }

    const handle = makeStub({
      responseDelayMs: 50,
      references,
      documentSymbol: { [filePath]: [] },
    });

    const client = await getLspClient(workspaceRoot, handle.module);
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        client.references(filePath, "php", "<?php\nclass Routes {}\n", { line: i, col: 0 }),
      ),
    );
    const elapsed = Date.now() - started;

    expect(results).toHaveLength(20);
    for (let i = 0; i < 20; i++) {
      expect(results[i]).toHaveLength(1);
      expect(results[i][0].uri).toBe(`file://${workspaceRoot}/Caller${i}.php`);
    }
    // Serial would be 20 * 50ms = 1000ms. Pipelined, every request is in
    // flight at the same time so wall-clock should be ~50ms plus overhead.
    // We assert << 500ms — generous for slow CI but still proves
    // multiplexing is happening.
    expect(elapsed).toBeLessThan(500);

    const stats = handle.readStats();
    expect(stats.counts["textDocument/references"]).toBe(20);
    // didOpen should fire exactly once for the file even with concurrent
    // callers — guards against re-opening already-open documents.
    expect(stats.counts["textDocument/didOpen"]).toBe(1);
  });

  it("opens each distinct file exactly once across concurrent calls", async () => {
    const files: string[] = [];
    const documentSymbol: Record<string, []> = {};
    for (let i = 0; i < 5; i++) {
      const file = path.join(workspaceRoot, `File${i}.php`);
      fs.writeFileSync(file, "<?php\n");
      files.push(file);
      documentSymbol[file] = [];
    }
    const handle = makeStub({ documentSymbol });

    const client = await getLspClient(workspaceRoot, handle.module);
    await Promise.all(
      files.flatMap((file) => [
        client.documentSymbol(file, "php", "<?php\n"),
        client.documentSymbol(file, "php", "<?php\n"),
        client.documentSymbol(file, "php", "<?php\n"),
      ]),
    );

    const stats = handle.readStats();
    expect(stats.counts["textDocument/didOpen"]).toBe(5);
    expect(stats.counts["textDocument/documentSymbol"]).toBe(15);
  });
});

describe("LspClient.references self-reference filter", () => {
  it("filters the trivial self-location even if the server ignores includeDeclaration: false", async () => {
    const filePath = path.join(workspaceRoot, "Self.php");
    fs.writeFileSync(filePath, "<?php\nclass Self_ {}\n");
    const fileUri = `file://${filePath}`;

    const handle = makeStub({
      references: {
        [`${filePath}:1:6`]: [
          {
            uri: fileUri,
            range: { start: { line: 1, character: 6 }, end: { line: 1, character: 11 } },
          },
          {
            uri: `file://${workspaceRoot}/Other.php`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
        ],
      },
    });

    const client = await getLspClient(workspaceRoot, handle.module);
    const refs = await client.references(filePath, "php", "<?php\nclass Self_ {}\n", { line: 1, col: 6 });
    expect(refs).toHaveLength(1);
    expect(refs[0].uri).toBe(`file://${workspaceRoot}/Other.php`);
  });
});

describe("LspClient capability advertisement", () => {
  it("reflects what the server announced on initialize", async () => {
    const handle = makeStub({
      advertise: { documentSymbolProvider: false, referencesProvider: true, definitionProvider: false },
    });
    const client = await getLspClient(workspaceRoot, handle.module);
    expect(client.capability("documentSymbolProvider")).toBe(false);
    expect(client.capability("referencesProvider")).toBe(true);
    expect(client.capability("definitionProvider")).toBe(false);
  });
});
