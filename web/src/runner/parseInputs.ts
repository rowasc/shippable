// Input-slot extractor for the CodeRunner prototype.
//
// Given a blob of selected code and its language, return the list of named
// input slots the user can fill, plus a "shape" hint telling the executor how
// to wrap the code:
//   - "anon-fn": an anonymous function expression/closure; executor calls it.
//   - "named-fn": a named function declaration; executor defines it, then calls.
//   - "free": free statements/expressions; executor binds vars and runs.

export type Lang = "js" | "ts" | "php";

export type RunnerShape =
  | { kind: "anon-fn"; params: string[] }
  | { kind: "named-fn"; name: string; params: string[] }
  | { kind: "free"; vars: string[] };

export interface ParsedSelection {
  lang: Lang;
  source: string;
  shape: RunnerShape;
  slots: string[];
}

export function detectLang(path: string): Lang | null {
  const p = path.toLowerCase();
  if (p.endsWith(".php")) return "php";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "ts";
  if (p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs")) return "js";
  return null;
}

export function parseSelection(source: string, lang: Lang): ParsedSelection {
  const trimmed = source.trim();
  const shape =
    lang === "php" ? parsePhp(trimmed) : parseJsLike(trimmed);
  const slots =
    shape.kind === "free" ? shape.vars : shape.params;
  return { lang, source, shape, slots };
}

/**
 * Best-effort placeholder for an input slot, derived from the slot's name.
 * Used by the runner panel's "guided" mode so cells like `cents` or `name`
 * come pre-loaded with a representative example. Heuristic only — `e.g. 42`
 * is just a label, not a default value.
 */
export function placeholderFor(slotName: string): string {
  const n = slotName.toLowerCase();
  // boolean-ish
  if (
    /^(is|has|can|should|did)[A-Z_]/.test(slotName) ||
    /^(flag|enabled|disabled|active)$/.test(n)
  ) {
    return "e.g. true";
  }
  // numeric-ish
  if (
    /^(n|i|j|k|count|len|length|size|width|height|min|max|value|amount|cents|price|qty|index|num|total|delta|x|y|z|a|b|t)$/.test(n) ||
    /(count|index|length|size|num|amount)$/i.test(n)
  ) {
    return "e.g. 42";
  }
  // string-ish
  if (
    /^(name|text|s|str|path|url|email|slug|title|msg|message|key|label|input|content)$/.test(n) ||
    /(name|text|path|url|key|label|message)$/i.test(n)
  ) {
    return 'e.g. "hello"';
  }
  // array-ish
  if (/^(items|list|arr|array|values|rows|tokens)$/.test(n) || /(s|list)$/.test(n)) {
    return "e.g. [1,2,3]";
  }
  return 'e.g. 1 or "hi"';
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

function parseJsLike(src: string): RunnerShape {
  // Optional `: ReturnType` between `)` and `{` or `=>`. Bounded by `[^={]`
  // so we don't swallow the function body or the arrow.
  const RETTYPE = "(?::\\s*[^={]+?)?";

  // function (a, b) { ... }  /  function (a, b): T { ... } — anonymous
  const anon = new RegExp(
    `^function\\s*\\*?\\s*\\(([^)]*)\\)\\s*${RETTYPE}\\s*\\{[\\s\\S]*\\}$`,
  ).exec(src);
  if (anon) return { kind: "anon-fn", params: splitParams(anon[1]) };

  // function foo<T>(a, b): T { ... } — named, optional generics + return type
  const named = new RegExp(
    `^function\\s*\\*?\\s*([A-Za-z_$][\\w$]*)\\s*(?:<[^<>]*>\\s*)?\\(([^)]*)\\)\\s*${RETTYPE}\\s*\\{[\\s\\S]*\\}$`,
  ).exec(src);
  if (named) return { kind: "named-fn", name: named[1], params: splitParams(named[2]) };

  // (a, b) => ...  /  (a, b): T => ...  /  a => ...
  const arrowParens = new RegExp(`^\\(([^)]*)\\)\\s*${RETTYPE}\\s*=>`).exec(src);
  if (arrowParens) return { kind: "anon-fn", params: splitParams(arrowParens[1]) };
  const arrowBare = /^([A-Za-z_$][\w$]*)\s*=>/.exec(src);
  if (arrowBare) return { kind: "anon-fn", params: [arrowBare[1]] };

  // Free statements — gather bare identifiers that aren't keywords or
  // declared locals. Keeps it dumb: good enough for a prototype.
  return { kind: "free", vars: collectFreeIdentifiersJs(src) };
}

function splitParams(raw: string): string[] {
  // Strip TS type annotations per param: `a: number = 1` -> `a`.
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/[:=][\s\S]*$/, "").trim())
    // Destructuring/rest — for the prototype, pass-through raw name if weird.
    .map((p) => p.replace(/^\.\.\./, "").trim())
    .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
}

const JS_KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "of", "return", "super", "switch", "this", "throw", "true",
  "try", "typeof", "var", "void", "while", "with", "yield", "async", "await",
  "static", "as", "from", "interface", "type", "implements", "any", "number",
  "string", "boolean", "undefined", "never", "unknown", "readonly", "public",
  "private", "protected",
]);

const JS_GLOBALS = new Set([
  "console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean",
  "Promise", "Date", "Map", "Set", "RegExp", "Error", "parseInt", "parseFloat",
  "isNaN", "isFinite", "globalThis",
]);

function collectFreeIdentifiersJs(src: string): string[] {
  // Strip strings + comments so identifiers inside them don't leak in.
  const cleaned = src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  const declared = new Set<string>();
  for (const m of cleaned.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  for (const m of cleaned.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of cleaned.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = m[0];
    // Skip property access: preceded by "."
    const before = cleaned[m.index! - 1];
    if (before === ".") continue;
    if (JS_KEYWORDS.has(name)) continue;
    if (JS_GLOBALS.has(name)) continue;
    if (declared.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

function parsePhp(src: string): RunnerShape {
  // function ($a, $b) { ... }  — anonymous
  const anon = /^function\s*\(([^)]*)\)\s*\{[\s\S]*\}$/.exec(src);
  if (anon) return { kind: "anon-fn", params: splitPhpParams(anon[1]) };

  // function foo($a, $b) { ... } — named
  const named = /^function\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*\{[\s\S]*\}$/.exec(src);
  if (named) return { kind: "named-fn", name: named[1], params: splitPhpParams(named[2]) };

  // Free statements — collect $var refs.
  return { kind: "free", vars: collectPhpVars(src) };
}

function splitPhpParams(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      // Strip type hint: "int $a = 1" -> "$a = 1"
      const m = /\$([A-Za-z_][\w]*)/.exec(p);
      return m ? m[1] : "";
    })
    .filter(Boolean);
}

function collectPhpVars(src: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const cleaned = src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of cleaned.matchAll(/\$([A-Za-z_][\w]*)/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
