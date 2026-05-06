export type DiscoverySource =
  | "configured"
  | "path"
  | "node_modules"
  | "vendor"
  | "bundled";

export interface DiscoveredBinary {
  command: string;
  args: string[];
  source: DiscoverySource;
}

export interface RecommendedSetup {
  label: string;
  command: string;
  notes?: string;
}

export interface LanguageModule {
  id: string;
  // The `language` values accepted in DefinitionRequest. The frontend's
  // `file.language` (a Shiki-ish id) is matched against these.
  languageIds: readonly string[];
  // Workspace file extensions (lowercase, leading dot). Used when a request
  // arrives without a language id — we infer from the extension.
  extensions: readonly string[];
  // LSP language id used in `textDocument/didOpen` per file extension.
  // Falls back to `id` when the extension isn't listed.
  lspLanguageIdByExtension: Readonly<Record<string, string>>;
  discover(): DiscoveredBinary | null;
  recommendedSetup: readonly RecommendedSetup[];
}
