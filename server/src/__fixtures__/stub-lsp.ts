import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModule } from "../languages/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STUB_SCRIPT = path.resolve(__dirname, "stub-lsp.mjs");

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

export interface StubDocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  detail?: string;
  children?: StubDocumentSymbol[];
}

export interface StubLocation {
  uri: string;
  range: Range;
}

export interface StubLspConfig {
  advertise?: {
    documentSymbolProvider?: boolean;
    referencesProvider?: boolean;
    definitionProvider?: boolean;
  };
  responseDelayMs?: number;
  documentSymbol?: Record<string, StubDocumentSymbol[]>;
  references?: Record<string, StubLocation[]>;
  definition?: Record<string, StubLocation[]>;
}

export interface StubLspHandle {
  module: LanguageModule;
  configPath: string;
  statsPath: string;
  /** Path to a shell wrapper executable that spawns the stub via `node`. */
  wrapperPath: string;
  /** Total request counts per method, derived from the stats file. */
  readStats(): { counts: Record<string, number>; lines: Array<{ method: string; at: number; counts: Record<string, number> }> };
  /** Drop the temp config + stats files. Safe to call repeatedly. */
  cleanup(): void;
}

export interface MakeStubLspOptions extends StubLspConfig {
  id?: string;
  languageIds?: readonly string[];
  extensions?: readonly string[];
  lspLanguageIdByExtension?: Readonly<Record<string, string>>;
}

/**
 * Build a `LanguageModule` whose `discover()` points at the stub LSP. Use
 * this in tests to inject a controllable LSP without touching the real
 * `LANGUAGES` registry.
 */
export function makeStubLspModule(options: MakeStubLspOptions): StubLspHandle {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-stub-lsp-"));
  const configPath = path.join(tmpDir, "config.json");
  const statsPath = path.join(tmpDir, "stats.jsonl");
  const {
    id = "php",
    languageIds = ["php"],
    extensions = [".php"],
    lspLanguageIdByExtension = { ".php": "php" },
    ...config
  } = options;

  const fullConfig: StubLspConfig = {
    advertise: {
      documentSymbolProvider: true,
      referencesProvider: true,
      definitionProvider: true,
      ...config.advertise,
    },
    responseDelayMs: config.responseDelayMs ?? 0,
    documentSymbol: config.documentSymbol ?? {},
    references: config.references ?? {},
    definition: config.definition ?? {},
  };
  fs.writeFileSync(configPath, JSON.stringify(fullConfig));
  fs.writeFileSync(statsPath, "");

  // Tests that exercise the real LANGUAGES registry route through
  // `SHIPPABLE_PHP_LSP=<wrapperPath>`. The wrapper ignores whatever args
  // `phpLanguage.discover()` adds (e.g. `--stdio`) and invokes the stub
  // with the explicit `--config` / `--stats` paths it needs.
  const wrapperPath = path.join(tmpDir, "stub-php-lsp.sh");
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(STUB_SCRIPT)} --config ${shellQuote(configPath)} --stats ${shellQuote(statsPath)}\n`,
    { mode: 0o755 },
  );

  const module: LanguageModule = {
    id,
    languageIds,
    extensions,
    lspLanguageIdByExtension,
    discover() {
      return {
        command: process.execPath,
        args: [STUB_SCRIPT, "--config", configPath, "--stats", statsPath],
        source: "configured",
      };
    },
    recommendedSetup: [
      { label: "stub", command: "(test fixture)", notes: "stub LSP for tests" },
    ],
  };

  let cleaned = false;
  return {
    module,
    configPath,
    statsPath,
    wrapperPath,
    readStats() {
      const lines = fs
        .readFileSync(statsPath, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { method: string; at: number; counts: Record<string, number> });
      const counts: Record<string, number> = {};
      for (const line of lines) {
        counts[line.method] = (counts[line.method] ?? 0) + 1;
      }
      return { counts, lines };
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

function shellQuote(value: string): string {
  // Single-quote and escape any embedded single quotes. Good enough for
  // tempdir paths; tests won't put ' in them.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

