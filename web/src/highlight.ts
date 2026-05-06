import bash from "@shikijs/langs/bash";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import html from "@shikijs/langs/html";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import php from "@shikijs/langs/php";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import githubDarkDimmed from "@shikijs/themes/github-dark-dimmed";
import githubLight from "@shikijs/themes/github-light";
import { createHighlighterCore, type ThemeInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { SHIKI_THEME_MODULES } from "./shikiThemes";
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from "./tokens";

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark-dimmed";

const SHIKI_THEME_BY_ID: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(SHIKI_THEME_MODULES).map(([id, theme]) => [id, getThemeName(theme)]),
  ),
  dark: THEME_DARK,
  light: THEME_LIGHT,
  dollhouse: THEME_LIGHT,
  dollhouseNoir: THEME_DARK,
};

function getThemeName(theme: { name?: string }): string {
  return theme.name ?? "";
}

function shikiThemeNameFor(themeId: ThemeId): string {
  const mapped = SHIKI_THEME_BY_ID[themeId];
  if (mapped) return mapped;
  return THEMES[themeId]?.colorScheme === "light" ? THEME_LIGHT : THEME_DARK;
}

let activeThemeId: ThemeId = DEFAULT_THEME_ID;

export function setHighlightTheme(themeId: ThemeId): void {
  activeThemeId = themeId;
}

type ColorMode = "light" | "dark";

function shikiThemeFor(themeId: ThemeId, colorMode: ColorMode | undefined): string {
  if (!colorMode) return shikiThemeNameFor(themeId);
  const activeScheme = THEMES[themeId]?.colorScheme;
  if (activeScheme === colorMode) return shikiThemeNameFor(themeId);
  return colorMode === "light" ? THEME_LIGHT : THEME_DARK;
}

const SUPPORTED_LANGUAGES = [
  "text",
  "bash",
  "css",
  "diff",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "php",
  "tsx",
  "typescript",
] as const;

const SHIKI_LANGUAGES = [
  ...bash,
  ...css,
  ...diff,
  ...html,
  ...javascript,
  ...json,
  ...jsx,
  ...markdown,
  ...php,
  ...tsx,
  ...typescript,
];

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES);

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  css: "css",
  diff: "diff",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  patch: "diff",
  php: "php",
  plain: "text",
  plaintext: "text",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  txt: "text",
  zsh: "bash",
};

const highlighterPromise = createHighlighterCore({
  themes: [githubLight, githubDarkDimmed, ...(Object.values(SHIKI_THEME_MODULES) as ThemeInput[])],
  langs: SHIKI_LANGUAGES,
  engine: createJavaScriptRegexEngine(),
});

const htmlCache = new Map<string, Promise<string>>();
const lineHtmlCache = new Map<string, Promise<string[]>>();
const CLICKABLE_SCOPE_PREFIXES = [
  "variable",
  "entity.name",
  "support.function",
  "support.class",
  "support.type",
  "meta.function-call",
] as const;
const NON_CLICKABLE_SCOPE_PREFIXES = [
  "variable.language",
  "variable.parameter",
] as const;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

interface TokenScope {
  scopeName?: string;
}

interface TokenExplanation {
  scopes?: TokenScope[];
}

interface HighlightToken {
  content: string;
  color?: string;
  bgColor?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
  explanation?: TokenExplanation[];
}

export interface HighlightLineOptions {
  clickableSymbols?: Iterable<string>;
  allowAnyIdentifier?: boolean;
}

export function normalizeHighlightLanguage(language?: string): string {
  const raw = language?.trim().toLowerCase();
  if (!raw) return "text";

  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  return SUPPORTED_LANGUAGE_SET.has(normalized) ? normalized : "text";
}

export async function highlightCode(
  code: string,
  language?: string,
  colorMode?: ColorMode,
): Promise<{ html: string; language: string }> {
  const normalized = normalizeHighlightLanguage(language);
  const themeName = shikiThemeFor(activeThemeId, colorMode);
  const key = `${themeName}::${normalized}\u0000${code}`;

  let htmlPromise = htmlCache.get(key);
  if (!htmlPromise) {
    htmlPromise = normalized === "text"
      ? Promise.resolve(renderPlainBlockHtml(code))
      : renderHtml(code, normalized, themeName);
    htmlCache.set(key, htmlPromise);
  }

  return {
    html: await htmlPromise,
    language: normalized,
  };
}

export async function highlightLines(
  lines: string[],
  language?: string,
  colorMode?: ColorMode,
  options?: HighlightLineOptions,
): Promise<{ language: string; lines: string[] }> {
  const normalized = normalizeHighlightLanguage(language);
  const themeName = shikiThemeFor(activeThemeId, colorMode);
  const key = `${themeName}::${normalized}::${clickableSymbolsCacheKey(options?.clickableSymbols)}::${options?.allowAnyIdentifier ? "any" : "known"}\u0000${lines.join("\n")}`;

  let linePromise = lineHtmlCache.get(key);
  if (!linePromise) {
    linePromise = normalized === "text"
      ? Promise.resolve(lines.map(renderPlainLineHtml))
      : renderLineHtml(lines, normalized, themeName, options);
    lineHtmlCache.set(key, linePromise);
  }

  return {
    language: normalized,
    lines: await linePromise,
  };
}

async function renderHtml(code: string, language: string, themeName: string): Promise<string> {
  const highlighter = await highlighterPromise;
  return highlighter.codeToHtml(code, {
    lang: language,
    theme: themeName,
  });
}

async function renderLineHtml(
  lines: string[],
  language: string,
  themeName: string,
  options?: HighlightLineOptions,
): Promise<string[]> {
  if (lines.length === 0) return [];

  const highlighter = await highlighterPromise;
  const tokens = highlighter.codeToTokens(lines.join("\n"), {
    lang: language as never,
    theme: themeName,
    includeExplanation: "scopeName",
  });

  const clickableSymbols = options?.clickableSymbols
    ? new Set(options.clickableSymbols)
    : null;

  return tokens.tokens.map((lineTokens, i) => {
    if (lineTokens.length === 0) {
      return renderPlainLineHtml(lines[i] ?? "");
    }
    let col = 0;
    return lineTokens.map((token) => {
      const html = renderTokenSpan(token as HighlightToken, {
        line: i,
        col,
        clickableSymbols,
        allowAnyIdentifier: options?.allowAnyIdentifier ?? false,
      });
      col += token.content.length;
      return html;
    }).join("");
  });
}

function renderPlainBlockHtml(code: string): string {
  const lines = code.split("\n");
  return `<pre class="shiki" tabindex="0"><code>${lines.length > 0
    ? lines.map((line) => `<span class="line">${renderPlainLineHtml(line)}</span>`).join("\n")
    : '<span class="line">&nbsp;</span>'}</code></pre>`;
}

function renderPlainLineHtml(text: string): string {
  return text === "" ? "&nbsp;" : escapeHtml(text);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replaceAll('"', "&quot;");
}

function renderTokenSpan(
  token: HighlightToken,
  meta: {
    line: number;
    col: number;
    clickableSymbols: ReadonlySet<string> | null;
    allowAnyIdentifier: boolean;
  },
): string {
  const content = token.content === " " ? "&nbsp;" : escapeHtml(token.content);
  const styleParts: string[] = [];
  if (token.color) styleParts.push(`color:${token.color}`);
  if (token.bgColor) styleParts.push(`background-color:${token.bgColor}`);
  if (token.htmlStyle) {
    for (const [key, value] of Object.entries(token.htmlStyle)) {
      styleParts.push(`${key}:${value}`);
    }
  }
  const style = styleParts.length > 0 ? ` style="${styleParts.join(";")}"` : "";
  const scopeNames = extractScopeNames(token);
  const symbol = resolveClickableSymbol(
    token,
    scopeNames,
    meta.clickableSymbols,
    meta.allowAnyIdentifier,
  );
  const classes = ["shiki-token"];
  if (symbol) classes.push("shiki-token--symbol");
  const attrs = [
    `class="${classes.join(" ")}"`,
    `data-token-line="${meta.line}"`,
    `data-token-col="${meta.col}"`,
  ];
  if (scopeNames.length > 0) {
    attrs.push(`data-token-scopes="${escapeHtmlAttr(scopeNames.join(" "))}"`);
  }
  if (symbol) {
    attrs.push(`data-symbol="${escapeHtmlAttr(symbol)}"`);
    attrs.push('role="button"');
    attrs.push('tabindex="0"');
    attrs.push(`title="jump to ${escapeHtmlAttr(symbol)}"`);
  }
  return `<span ${attrs.join(" ")}${style}>${content}</span>`;
}

function clickableSymbolsCacheKey(clickableSymbols?: Iterable<string>): string {
  if (!clickableSymbols) return "";
  return [...clickableSymbols].sort().join(",");
}

function extractScopeNames(token: HighlightToken): string[] {
  const names = token.explanation
    ?.flatMap((step) => step.scopes ?? [])
    .map((scope) => scope.scopeName?.trim() ?? "")
    .filter(Boolean) ?? [];
  return [...new Set(names)];
}

function resolveClickableSymbol(
  token: HighlightToken,
  scopeNames: string[],
  clickableSymbols: ReadonlySet<string> | null,
  allowAnyIdentifier: boolean,
): string | null {
  const symbol = token.content.trim();
  if (!IDENTIFIER_RE.test(symbol)) return null;
  if (!allowAnyIdentifier && (!clickableSymbols || !clickableSymbols.has(symbol))) {
    return null;
  }
  if (scopeNames.length === 0) return null;
  if (scopeNames.some((scope) => matchesScopePrefix(scope, NON_CLICKABLE_SCOPE_PREFIXES))) {
    return null;
  }
  if (!scopeNames.some((scope) => matchesScopePrefix(scope, CLICKABLE_SCOPE_PREFIXES))) {
    return null;
  }
  return symbol;
}

function matchesScopePrefix(scope: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => scope === prefix || scope.startsWith(`${prefix}.`));
}
