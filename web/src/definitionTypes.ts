export interface DefinitionClickTarget {
  symbol: string;
  file: string;
  language: string;
  line: number;
  col: number;
}

export interface DefinitionRequest {
  file: string;
  language: string;
  line: number;
  col: number;
  workspaceRoot?: string | null;
}

export interface DefinitionLocation {
  uri: string;
  file: string;
  workspaceRelativePath: string | null;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  preview: string;
  resolver: string;
}

export type DefinitionResponse =
  | {
      status: "ok";
      definitions: DefinitionLocation[];
    }
  | {
      status: "unsupported";
      reason: string;
    }
  | {
      status: "error";
      error: string;
    };

export type DefinitionDiscoverySource =
  | "configured"
  | "path"
  | "node_modules"
  | "vendor"
  | "bundled";

export interface DefinitionRecommendedSetup {
  label: string;
  command: string;
  notes?: string;
}

export interface DefinitionLanguageCapability {
  id: string;
  // Language ids accepted in DefinitionRequest.language (matches file.language).
  languageIds: string[];
  available: boolean;
  resolver: string | null;
  source: DefinitionDiscoverySource | null;
  reason?: string;
  recommendedSetup: DefinitionRecommendedSetup[];
}

export interface DefinitionCapabilities {
  languages: DefinitionLanguageCapability[];
  requiresWorktree: true;
  // Convenience: true if any language module is currently available.
  anyAvailable: boolean;
}

export function findCapabilityForLanguage(
  caps: DefinitionCapabilities | null,
  languageId: string,
): DefinitionLanguageCapability | null {
  if (!caps) return null;
  const normalized = languageId.trim().toLowerCase();
  return caps.languages.find((c) => c.languageIds.includes(normalized)) ?? null;
}

// Languages where definition navigation could conceivably apply. Files
// whose `file.language` falls outside this list (markdown, json, yaml, plain
// text, …) should not render the def-availability chip at all — a "JS/TS
// only" badge on a markdown file implies a feature exists for that file
// when it doesn't.
const PROGRAMMING_LANGUAGE_IDS = new Set([
  "js", "jsx", "javascript",
  "ts", "tsx", "typescript",
  "php", "phtml",
  "py", "python",
  "go",
  "rs", "rust",
  "rb", "ruby",
  "java",
  "kt", "kotlin",
  "swift",
  "cs", "csharp",
  "c", "cpp", "h", "hpp",
  "vue", "svelte",
  "scala", "ex", "exs", "elixir",
  "lua", "ocaml", "ml", "fs", "fsharp",
]);

export function isProgrammingLanguage(languageId: string): boolean {
  return PROGRAMMING_LANGUAGE_IDS.has(languageId.trim().toLowerCase());
}
