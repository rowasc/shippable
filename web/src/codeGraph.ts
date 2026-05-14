import { classifyFileRole } from "./fileRole";
import type {
  CodeGraph,
  DiffFile,
  Hunk,
} from "./types";

export interface GraphSourceFile {
  path: string;
  text: string;
}

interface Definition {
  name: string;
  exported: boolean;
}

interface ImportReference {
  specifier: string;
  importedNames: string[];
}

interface FileAnalysis {
  definitions: Definition[];
  imports: ImportReference[];
}

const ANALYZABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".php",
  ".css",
  ".scss",
  ".sass",
] as const;

const TEST_PATH = /(^|\/)__tests__\/|\.test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$/i;

export function isGraphAnalyzablePath(path: string): boolean {
  return ANALYZABLE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

export function buildDiffCodeGraph(files: DiffFile[]): {
  files: DiffFile[];
  graph: CodeGraph;
} {
  const sources = files.map((file) => ({
    path: file.path,
    text: buildDiffSource(file),
  }));
  const analysis = analyzeGraphSources(sources, "diff");
  const fileReferences = buildReferencedSymbolMap(analysis);

  return {
    files: files.map((file) => {
      const fileDefs = analysis.byPath.get(file.path)?.definitions ?? [];
      const definitions = new Set(fileDefs.map((def) => def.name));
      const exportedDefinitions = new Set(
        fileDefs.filter((def) => def.exported).map((def) => def.name),
      );
      const references = fileReferences.get(file.path) ?? new Set<string>();
      return {
        ...file,
        hunks: file.hunks.map((hunk) =>
          annotateHunk(hunk, definitions, exportedDefinitions, references),
        ),
      };
    }),
    graph: analysis.graph,
  };
}

export function buildRepoCodeGraph(files: GraphSourceFile[]): CodeGraph {
  return analyzeGraphSources(files, "repo").graph;
}

function analyzeGraphSources(
  files: GraphSourceFile[],
  scope: CodeGraph["scope"],
): {
  graph: CodeGraph;
  byPath: Map<string, FileAnalysis>;
} {
  const uniqueFiles = dedupeFiles(files);
  const pathSet = new Set(uniqueFiles.map((file) => file.path));
  const byPath = new Map<string, FileAnalysis>();

  for (const file of uniqueFiles) {
    byPath.set(file.path, {
      definitions: extractDefinitions(file.text),
      imports: extractImports(file.text),
    });
  }

  const edgeBuckets = new Map<string, { fromPath: string; toPath: string; labels: Set<string> }>();

  for (const file of uniqueFiles) {
    const analysis = byPath.get(file.path)!;
    for (const reference of analysis.imports) {
      const targetPath = resolveModulePath(file.path, reference.specifier, pathSet);
      if (!targetPath || targetPath === file.path) continue;
      const labelSet = selectEdgeLabels(reference, byPath.get(targetPath)?.definitions ?? []);
      const key = `${targetPath}\u0000${file.path}`;
      const bucket = edgeBuckets.get(key) ?? {
        fromPath: targetPath,
        toPath: file.path,
        labels: new Set<string>(),
      };
      for (const label of labelSet) bucket.labels.add(label);
      edgeBuckets.set(key, bucket);
    }
  }

  const graph: CodeGraph = {
    scope,
    nodes: uniqueFiles
      .map((file) => {
        const { pathRole, fileRole } = classifyFileRole(file.path);
        return {
          path: file.path,
          isTest: isTestPath(file.path),
          pathRole,
          fileRole,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
    edges: [...edgeBuckets.values()]
      .map((bucket) => ({
        fromPath: bucket.fromPath,
        toPath: bucket.toPath,
        labels: [...bucket.labels].sort(),
        kind: "imports" as const,
      }))
      .sort((a, b) =>
        a.fromPath === b.fromPath
          ? a.toPath.localeCompare(b.toPath)
          : a.fromPath.localeCompare(b.fromPath),
      ),
  };

  return { graph, byPath };
}

function buildReferencedSymbolMap(analysis: {
  graph: CodeGraph;
  byPath: Map<string, FileAnalysis>;
}): Map<string, Set<string>> {
  // Side-effect imports synthesize a path-derived guess via labelFromSpecifier
  // that won't match a real definition; filter labels against the source
  // file's definitions so we don't pollute hunk `referencesSymbols`.
  const refs = new Map<string, Set<string>>();
  for (const edge of analysis.graph.edges) {
    const definedNames = new Set(
      analysis.byPath.get(edge.fromPath)?.definitions.map((d) => d.name) ?? [],
    );
    const realLabels = edge.labels.filter((label) => definedNames.has(label));
    if (realLabels.length === 0) continue;
    const bucket = refs.get(edge.toPath) ?? new Set<string>();
    for (const label of realLabels) bucket.add(label);
    refs.set(edge.toPath, bucket);
  }
  return refs;
}

function annotateHunk(
  hunk: Hunk,
  fileDefinitions: Set<string>,
  fileExportedDefinitions: Set<string>,
  fileReferences: Set<string>,
): Hunk {
  const text = hunk.lines
    .filter((line) => line.kind !== "del")
    .map((line) => line.text)
    .join("\n");
  const definedHere = extractDefinitions(text)
    .map((def) => def.name)
    .filter((name, index, list) => list.indexOf(name) === index && fileDefinitions.has(name));
  const exportedHere = definedHere.filter((name) => fileExportedDefinitions.has(name));
  const referencedHere = [...fileReferences].filter((name) => containsWord(text, name));

  return {
    ...hunk,
    definesSymbols: mergeUnique(hunk.definesSymbols, definedHere),
    exportedSymbols: mergeUnique(hunk.exportedSymbols, exportedHere),
    referencesSymbols: mergeUnique(hunk.referencesSymbols, referencedHere),
  };
}

function dedupeFiles(files: GraphSourceFile[]): GraphSourceFile[] {
  const seen = new Set<string>();
  const out: GraphSourceFile[] = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    if (!isGraphAnalyzablePath(file.path)) continue;
    seen.add(file.path);
    out.push(file);
  }
  return out;
}

function buildDiffSource(file: DiffFile): string {
  return file.hunks
    .map((hunk) =>
      hunk.lines
        .filter((line) => line.kind !== "del")
        .map((line) => line.text)
        .join("\n"),
    )
    .join("\n");
}

function extractDefinitions(text: string): Definition[] {
  const definitions: Definition[] = [];
  const lines = text.split("\n");

  const patterns: Array<{ re: RegExp; nameIndex: number }> = [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][\w$]*)\s*\(/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_][\w$]*)\s*=/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?let\s+([A-Za-z_][\w$]*)\s*=/, nameIndex: 1 },
    { re: /^\s*(?:export\s+)?var\s+([A-Za-z_][\w$]*)\s*=/, nameIndex: 1 },
    { re: /^\s*function\s+([A-Za-z_][\w$]*)\s*\(/, nameIndex: 1 },
    { re: /^\s*class\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
    { re: /^\s*(?:final\s+)?class\s+([A-Za-z_][\w$]*)\b/, nameIndex: 1 },
  ];

  lines.forEach((line) => {
    for (const pattern of patterns) {
      const match = pattern.re.exec(line);
      if (!match) continue;
      const exported = /^\s*export\b/.test(line);
      definitions.push({ name: match[pattern.nameIndex], exported });
      break;
    }
  });

  // Deduplicate by name; if any occurrence was exported, the result is exported.
  const byName = new Map<string, Definition>();
  for (const def of definitions) {
    const existing = byName.get(def.name);
    if (!existing) byName.set(def.name, def);
    else if (def.exported && !existing.exported) byName.set(def.name, def);
  }
  return [...byName.values()];
}

function extractImports(text: string): ImportReference[] {
  const imports: ImportReference[] = [];
  const lines = text.split("\n");

  lines.forEach((line) => {
    const staticImport = /^\s*import\s+(.+?)\s+from\s+["']([^"']+)["']/.exec(line);
    if (staticImport) {
      imports.push({
        specifier: staticImport[2],
        importedNames: parseImportedNames(staticImport[1]),
      });
      return;
    }

    const sideEffectImport = /^\s*import\s+["']([^"']+)["']/.exec(line);
    if (sideEffectImport) {
      imports.push({
        specifier: sideEffectImport[1],
        importedNames: [],
      });
      return;
    }

    const exportFrom = /^\s*export\s+.+?\s+from\s+["']([^"']+)["']/.exec(line);
    if (exportFrom) {
      imports.push({
        specifier: exportFrom[1],
        importedNames: parseExportedNames(line),
      });
      return;
    }

    const requireImport = /require\(\s*["']([^"']+)["']\s*\)/.exec(line);
    if (requireImport) {
      imports.push({
        specifier: requireImport[1],
        importedNames: [],
      });
      return;
    }

    const dynamicImport = /import\(\s*["']([^"']+)["']\s*\)/.exec(line);
    if (dynamicImport) {
      imports.push({
        specifier: dynamicImport[1],
        importedNames: [],
      });
      return;
    }

    const cssImport = /^\s*@import\s+["']([^"']+)["']/.exec(line);
    if (cssImport) {
      imports.push({
        specifier: cssImport[1],
        importedNames: [],
      });
    }
  });

  return imports;
}

function parseImportedNames(raw: string): string[] {
  const names = new Set<string>();
  const trimmed = raw.trim();

  const namespace = /\*\s+as\s+([A-Za-z_][\w$]*)/.exec(trimmed);
  if (namespace) names.add(namespace[1]);

  const braceMatch = /\{([^}]+)\}/.exec(trimmed);
  if (braceMatch) {
    for (const part of braceMatch[1].split(",")) {
      const value = part.trim();
      if (!value) continue;
      const alias = /\bas\s+([A-Za-z_][\w$]*)$/.exec(value);
      names.add(alias ? alias[1] : value);
    }
  }

  const defaultPart = trimmed.split(",")[0]?.trim();
  if (
    defaultPart &&
    !defaultPart.startsWith("{") &&
    !defaultPart.startsWith("*") &&
    /^[A-Za-z_][\w$]*$/.test(defaultPart)
  ) {
    names.add(defaultPart);
  }

  return [...names];
}

function parseExportedNames(line: string): string[] {
  const braceMatch = /\{([^}]+)\}/.exec(line);
  if (!braceMatch) return [];
  const names = new Set<string>();
  for (const part of braceMatch[1].split(",")) {
    const value = part.trim();
    if (!value) continue;
    const alias = /\bas\s+([A-Za-z_][\w$]*)$/.exec(value);
    const source = value.split(/\s+as\s+/)[0]?.trim();
    if (alias) names.add(alias[1]);
    else if (source) names.add(source);
  }
  return [...names];
}

function selectEdgeLabels(reference: ImportReference, definitions: Definition[]): string[] {
  if (reference.importedNames.length > 0) {
    const definedNames = new Set(definitions.map((definition) => definition.name));
    const matching = reference.importedNames.filter((name) => definedNames.has(name));
    if (matching.length > 0) return matching;
    return reference.importedNames;
  }
  return [labelFromSpecifier(reference.specifier)];
}

function resolveModulePath(
  importerPath: string,
  specifier: string,
  paths: Set<string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(joinPath(dirname(importerPath), specifier));
  const candidates = new Set<string>([base]);

  if (!hasExtension(base)) {
    for (const ext of ANALYZABLE_EXTENSIONS) {
      candidates.add(`${base}${ext}`);
      candidates.add(`${base}/index${ext}`);
    }
  }

  for (const candidate of candidates) {
    if (paths.has(candidate)) return candidate;
  }
  return null;
}

function labelFromSpecifier(specifier: string): string {
  const cleaned = specifier.replace(/\/index$/, "");
  const tail = cleaned.split("/").filter(Boolean).pop() ?? specifier;
  return tail.replace(/\.[A-Za-z0-9]+$/, "");
}

function hasExtension(path: string): boolean {
  const segment = path.split("/").pop() ?? path;
  return /\.[A-Za-z0-9]+$/.test(segment);
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function joinPath(base: string, relative: string): string {
  return base ? `${base}/${relative}` : relative;
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeUnique(existing: string[] | undefined, next: string[]): string[] | undefined {
  const merged = [...new Set([...(existing ?? []), ...next])];
  return merged.length > 0 ? merged : undefined;
}
