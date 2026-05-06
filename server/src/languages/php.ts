import path from "node:path";
import { findExecutable } from "./discovery.ts";
import type { DiscoveredBinary, LanguageModule } from "./types.ts";

const INTELEPHENSE = "intelephense";
const PHPACTOR = "phpactor";

export const phpLanguage: LanguageModule = {
  id: "php",
  languageIds: ["php"],
  extensions: [".php", ".phtml"],
  lspLanguageIdByExtension: {
    ".php": "php",
    ".phtml": "php",
  },
  discover() {
    const explicit = findFromEnv();
    if (explicit) return explicit;

    const intelephense = findExecutable({
      binary: INTELEPHENSE,
      args: ["--stdio"],
      projectBins: [path.resolve(process.cwd(), "node_modules", ".bin")],
    });
    if (intelephense) return intelephense;

    return findExecutable({
      binary: PHPACTOR,
      args: ["language-server"],
      projectBins: [path.resolve(process.cwd(), "vendor", "bin")],
    });
  },
  recommendedSetup: [
    {
      label: "intelephense (npm)",
      command: "npm install -g intelephense",
      notes: "Recommended. Free tier handles definition lookup; premium features need a separate licence.",
    },
    {
      label: "phpactor (composer)",
      command: "composer global require phpactor/phpactor",
      notes: "Pure-OSS alternative to intelephense.",
    },
    {
      label: "explicit binary",
      command: "export SHIPPABLE_PHP_LSP=/abs/path/to/intelephense-or-phpactor",
      notes: "Args are inferred from the binary basename.",
    },
  ],
};

// SHIPPABLE_PHP_LSP takes a full path. We infer args from the basename so
// either intelephense or phpactor can be plugged in via the same env var.
function findFromEnv(): DiscoveredBinary | null {
  const explicit = findExecutable({ envVar: "SHIPPABLE_PHP_LSP" });
  if (!explicit) return null;
  const base = path.basename(explicit.command).toLowerCase();
  if (base.startsWith(PHPACTOR)) {
    return { ...explicit, args: ["language-server"] };
  }
  // Default to intelephense args. If the user pointed us at something else,
  // they can wrap it in a shell script that translates.
  return { ...explicit, args: ["--stdio"] };
}
