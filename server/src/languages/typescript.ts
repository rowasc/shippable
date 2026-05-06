import path from "node:path";
import { findExecutable } from "./discovery.ts";
import type { LanguageModule } from "./types.ts";

const BINARY = "typescript-language-server";

export const tsLanguage: LanguageModule = {
  id: "ts",
  languageIds: ["ts", "tsx", "js", "jsx"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
  lspLanguageIdByExtension: {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
  },
  discover() {
    const explicit = findExecutable({ envVar: "SHIPPABLE_TYPESCRIPT_LSP", args: ["--stdio"] });
    if (explicit) return explicit;
    return findExecutable({
      binary: BINARY,
      args: ["--stdio"],
      projectBins: [path.resolve(process.cwd(), "node_modules", ".bin")],
    });
  },
  recommendedSetup: [
    {
      label: "npm (global)",
      command: "npm install -g typescript typescript-language-server",
      notes: "Then restart the server so it can pick up the new binary.",
    },
    {
      label: "explicit binary",
      command: "export SHIPPABLE_TYPESCRIPT_LSP=/abs/path/to/typescript-language-server",
    },
  ],
};
