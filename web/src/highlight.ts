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
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark-dimmed";

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
  themes: [githubLight, githubDarkDimmed],
  langs: SHIKI_LANGUAGES,
  engine: createJavaScriptRegexEngine(),
});

const htmlCache = new Map<string, Promise<string>>();
const lineHtmlCache = new Map<string, Promise<string[]>>();

export function normalizeHighlightLanguage(language?: string): string {
  const raw = language?.trim().toLowerCase();
  if (!raw) return "text";

  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  return SUPPORTED_LANGUAGE_SET.has(normalized) ? normalized : "text";
}

export async function highlightCode(
  code: string,
  language?: string,
): Promise<{ html: string; language: string }> {
  const normalized = normalizeHighlightLanguage(language);
  const key = `${normalized}\u0000${code}`;

  let htmlPromise = htmlCache.get(key);
  if (!htmlPromise) {
    htmlPromise = normalized === "text"
      ? Promise.resolve(renderPlainBlockHtml(code))
      : renderHtml(code, normalized);
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
): Promise<{ language: string; lines: string[] }> {
  const normalized = normalizeHighlightLanguage(language);
  const key = `${normalized}\u0000${lines.join("\n")}`;

  let linePromise = lineHtmlCache.get(key);
  if (!linePromise) {
    linePromise = normalized === "text"
      ? Promise.resolve(lines.map(renderPlainLineHtml))
      : renderLineHtml(lines, normalized);
    lineHtmlCache.set(key, linePromise);
  }

  return {
    language: normalized,
    lines: await linePromise,
  };
}

async function renderHtml(code: string, language: string): Promise<string> {
  const highlighter = await highlighterPromise;
  return highlighter.codeToHtml(code, {
    lang: language,
    themes: {
      light: THEME_LIGHT,
      dark: THEME_DARK,
    },
    defaultColor: false,
  });
}

async function renderLineHtml(lines: string[], language: string): Promise<string[]> {
  if (lines.length === 0) return [];

  const highlighter = await highlighterPromise;
  const tokens = highlighter.codeToTokens(lines.join("\n"), {
    lang: language as never,
    themes: {
      light: THEME_LIGHT,
      dark: THEME_DARK,
    },
    defaultColor: false,
  });

  return tokens.tokens.map((lineTokens, i) => {
    if (lineTokens.length === 0) {
      return renderPlainLineHtml(lines[i] ?? "");
    }
    return lineTokens.map(renderTokenSpan).join("");
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

function renderTokenSpan(token: {
  content: string;
  htmlStyle?: Record<string, string>;
}): string {
  const content = token.content === " " ? "&nbsp;" : escapeHtml(token.content);
  const styleEntries = Object.entries(token.htmlStyle ?? {});
  const style = styleEntries.length > 0
    ? ` style="${styleEntries.map(([key, value]) => `${key}:${value}`).join(";")}"`
    : "";
  return `<span class="shiki-token"${style}>${content}</span>`;
}
