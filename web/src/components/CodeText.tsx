import type { ReactNode } from "react";
import "./CodeText.css";

/**
 * Temporary syntax renderer for the prototype. Keep the public surface tiny so
 * a parser-backed highlighter (Shiki) can replace this file without changing
 * DiffView / Inspector call sites.
 */
type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "function"
  | "type"
  | "property"
  | "variable"
  | "tag"
  | "punctuation";

interface CodeToken {
  kind: TokenKind;
  text: string;
}

interface LanguageProfile {
  keywords: Set<string>;
  hashComments: boolean;
  dollarVariables: boolean;
  typeHints: boolean;
  tags: boolean;
}

const tokenRe =
  /\/\*.*?\*\/|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\$[A-Za-z_][A-Za-z0-9_]*|<\/?[A-Za-z][A-Za-z0-9._-]*|0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_]*|[()[\]{}.,:;<>/=+\-*%!&|^~?]+/gm;

const defaultProfile: LanguageProfile = {
  keywords: new Set(),
  hashComments: false,
  dollarVariables: false,
  typeHints: false,
  tags: false,
};

const tsLikeKeywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const",
  "continue", "default", "delete", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null",
  "return", "static", "super", "switch", "throw", "true", "try", "type",
  "typeof", "undefined", "var", "void", "while", "yield",
]);

const phpKeywords = new Set([
  "array", "as", "break", "case", "catch", "class", "const", "continue",
  "default", "echo", "else", "elseif", "extends", "false", "finally", "fn",
  "foreach", "function", "if", "implements", "include", "include_once",
  "interface", "match", "namespace", "new", "null", "private", "protected",
  "public", "require", "require_once", "return", "static", "switch", "throw",
  "trait", "true", "try", "use", "while",
]);

const pythonKeywords = new Set([
  "and", "as", "class", "def", "elif", "else", "except", "False", "finally",
  "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or",
  "pass", "raise", "return", "True", "try", "while", "with", "yield",
]);

const shellKeywords = new Set([
  "case", "do", "done", "elif", "else", "esac", "fi", "for", "function",
  "if", "in", "then", "until", "while",
]);

const rubyKeywords = new Set([
  "class", "def", "do", "else", "elsif", "end", "false", "if", "module",
  "nil", "return", "self", "true", "unless", "while", "yield",
]);

const languageProfiles: Record<string, LanguageProfile> = {
  ts: { keywords: tsLikeKeywords, hashComments: false, dollarVariables: false, typeHints: true, tags: false },
  tsx: { keywords: tsLikeKeywords, hashComments: false, dollarVariables: false, typeHints: true, tags: true },
  js: { keywords: tsLikeKeywords, hashComments: false, dollarVariables: false, typeHints: false, tags: false },
  jsx: { keywords: tsLikeKeywords, hashComments: false, dollarVariables: false, typeHints: false, tags: true },
  php: { keywords: phpKeywords, hashComments: true, dollarVariables: true, typeHints: false, tags: true },
  python: { keywords: pythonKeywords, hashComments: true, dollarVariables: false, typeHints: false, tags: false },
  py: { keywords: pythonKeywords, hashComments: true, dollarVariables: false, typeHints: false, tags: false },
  ruby: { keywords: rubyKeywords, hashComments: true, dollarVariables: false, typeHints: false, tags: false },
  shell: { keywords: shellKeywords, hashComments: true, dollarVariables: true, typeHints: false, tags: false },
  bash: { keywords: shellKeywords, hashComments: true, dollarVariables: true, typeHints: false, tags: false },
  html: { keywords: new Set(), hashComments: false, dollarVariables: false, typeHints: false, tags: true },
  xml: { keywords: new Set(), hashComments: false, dollarVariables: false, typeHints: false, tags: true },
};

const languageAliases: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  sh: "shell",
  zsh: "shell",
};

function resolveProfile(language: string): LanguageProfile {
  const lower = language.toLowerCase();
  const resolved = languageAliases[lower] ?? lower;
  return languageProfiles[resolved] ?? defaultProfile;
}

function isIdentifier(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text);
}

function isPunctuation(text: string): boolean {
  return /^[()[\]{}.,:;<>/=+\-*%!&|^~?]+$/.test(text);
}

function isTypeLike(
  text: string,
  line: string,
  start: number,
  profile: LanguageProfile,
): boolean {
  if (/^[A-Z]/.test(text)) return true;
  if (!profile.typeHints) return false;
  return /(?:type|interface|class|extends|implements|new)\s+$/.test(
    line.slice(0, start),
  );
}

function classifyToken(
  raw: string,
  line: string,
  start: number,
  profile: LanguageProfile,
): TokenKind {
  if (
    raw.startsWith("//") ||
    raw.startsWith("/*") ||
    (profile.hashComments && raw.startsWith("#"))
  ) {
    return "comment";
  }
  if (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("`")) {
    return "string";
  }
  if (profile.dollarVariables && raw.startsWith("$")) {
    return "variable";
  }
  if (profile.tags && raw.startsWith("<") && /<\/?[A-Za-z]/.test(raw)) {
    return "tag";
  }
  if (/^(?:0x[0-9a-fA-F]+|\d)/.test(raw)) {
    return "number";
  }
  if (isPunctuation(raw)) {
    return "punctuation";
  }
  if (!isIdentifier(raw)) {
    return "plain";
  }
  if (profile.keywords.has(raw)) {
    return "keyword";
  }

  if (start > 0 && line[start - 1] === ".") {
    return "property";
  }
  if (/^\s*\(/.test(line.slice(start + raw.length))) {
    return "function";
  }
  if (isTypeLike(raw, line, start, profile)) {
    return "type";
  }
  return "plain";
}

function tokenizeCode(line: string, language: string): CodeToken[] {
  const profile = resolveProfile(language);
  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(tokenRe)) {
    const start = match.index ?? 0;
    const raw = match[0];

    if (start > lastIndex) {
      tokens.push({ kind: "plain", text: line.slice(lastIndex, start) });
    }

    tokens.push({
      kind: classifyToken(raw, line, start, profile),
      text: raw,
    });
    lastIndex = start + raw.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: "plain", text: line.slice(lastIndex) });
  }

  return tokens;
}

export function CodeText({
  text,
  language,
}: {
  text: string;
  language: string;
}): ReactNode {
  const tokens = tokenizeCode(text, language);

  return tokens.map((token, index) => (
    <span
      key={`${index}:${token.text}`}
      className={token.kind === "plain" ? undefined : `code-token code-token--${token.kind}`}
    >
      {token.text}
    </span>
  ));
}
