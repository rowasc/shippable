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

export interface DefinitionCapabilities {
  available: boolean;
  supportedLanguages: string[];
  requiresWorktree: boolean;
  resolver: string | null;
  reason?: string;
}

const SUPPORTED_DEFINITION_LANGUAGES = new Set(["js", "jsx", "ts", "tsx"]);

export function supportsDefinitionLanguage(language: string): boolean {
  return SUPPORTED_DEFINITION_LANGUAGES.has(language.trim().toLowerCase());
}
