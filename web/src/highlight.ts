import { createHighlighter } from "shiki";
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

const highlighterPromise = createHighlighter({
  themes: [THEME_LIGHT, THEME_DARK],
  langs: [...SUPPORTED_LANGUAGES],
  engine: createJavaScriptRegexEngine(),
});

const htmlCache = new Map<string, Promise<string>>();

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
    htmlPromise = renderHtml(code, normalized);
    htmlCache.set(key, htmlPromise);
  }

  return {
    html: await htmlPromise,
    language: normalized,
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
