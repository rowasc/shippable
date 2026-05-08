import type { FileRole, SymbolShape, SymbolSummary } from "./types";

export interface FileRoleResult {
  /** Path/extension classifier output alone — never overridden. */
  pathRole: FileRole;
  /** Final role after the LSP-shape upgrade. Equals `pathRole` when no
   *  LSP data is present. */
  fileRole: FileRole;
}

/**
 * Two-tier file-role classifier. Path-floor first (always available),
 * then an LSP-shape upgrade pass that may promote / override when
 * `documentSymbol` ran for this file. Both outputs are returned: the
 * renderer uses `fileRole`; the diagram surfaces disagreement on hover.
 *
 * `shape` and `symbols` are the LSP-side enrichment from
 * `/api/code-graph`. When absent, `fileRole === pathRole`.
 */
export function classifyFileRole(
  filePath: string,
  shape?: SymbolShape,
  symbols?: SymbolSummary[],
): FileRoleResult {
  const pathRole = classifyByPath(filePath);
  const fileRole = upgradeWithLspShape(filePath, pathRole, shape, symbols);
  return { pathRole, fileRole };
}

function classifyByPath(filePath: string): FileRole {
  const segments = filePath.split("/");
  const basename = segments[segments.length - 1] ?? filePath;
  const lower = filePath.toLowerCase();
  const lowerBase = basename.toLowerCase();
  const dirSegments = segments.slice(0, -1);

  // Tests dominate signal in this repo and the PHP fixture; check first.
  if (
    /\.test\.[jt]sx?$/i.test(lowerBase) ||
    /\.spec\.[jt]sx?$/i.test(lowerBase) ||
    /Test\.php$/i.test(basename) ||
    dirSegments.includes("__tests__") ||
    dirSegments.includes("tests") ||
    dirSegments.includes("e2e")
  ) {
    return "test";
  }

  // Test fixtures — reviewers shouldn't expect code-quality scrutiny here.
  // Matches `fixtures/`, `__fixtures__/`, and the repo-level `test-fixtures/`.
  if (dirSegments.some((seg) => /fixtures?_*$/i.test(seg))) {
    return "fixture";
  }

  // Shipped product prompts carry meaning beyond "doc".
  if (lower.startsWith("library/prompts/") && lowerBase.endsWith(".md")) {
    return "prompt";
  }

  // Markdown — placed before the route check so docs never get mis-tagged.
  if (lowerBase.endsWith(".md") || lowerBase.endsWith(".mdx")) {
    return "doc";
  }

  // Stylesheets never have meaningful symbol edges.
  if (/\.(css|scss|sass)$/i.test(lowerBase)) {
    return "style";
  }

  // SQL / migrations — reviewers care about schema-shape changes specifically.
  if (lowerBase.endsWith(".sql") || dirSegments.includes("migrations")) {
    return "migration";
  }

  // Type-only modules; `types.ts` is repo-wide convention.
  if (/\.types\.ts$/i.test(lowerBase) || lowerBase === "types.ts") {
    return "type-def";
  }

  // Request entry points — TS routes, PHP controller / route classes.
  if (
    lowerBase === "routes.ts" ||
    lowerBase === "routes.tsx" ||
    dirSegments.includes("routes") ||
    /Routes?\.php$/i.test(basename) ||
    /Controller\.php$/i.test(basename)
  ) {
    return "route";
  }

  // React component-by-convention.
  if (lowerBase.endsWith(".tsx") && dirSegments.includes("components")) {
    return "component";
  }

  // React hook-by-convention. `use*` in `hooks/` or top-level.
  if (
    /^use[A-Z]/.test(basename) &&
    /\.tsx?$/i.test(lowerBase) &&
    (dirSegments.includes("hooks") || dirSegments.length <= 1)
  ) {
    return "hook";
  }

  // Drivers of behaviour without being code — misclassifying these as code
  // hides risk in review.
  if (
    lowerBase === "package.json" ||
    /\.lock$/i.test(lowerBase) ||
    /^tsconfig.*\.json$/i.test(lowerBase) ||
    /^\.env/i.test(lowerBase) ||
    /^vite\.config\./i.test(lowerBase) ||
    lowerBase === "tauri.conf.json" ||
    (dirSegments.length === 0 && lowerBase.endsWith(".toml"))
  ) {
    return "config";
  }

  return "code";
}

function upgradeWithLspShape(
  filePath: string,
  pathRole: FileRole,
  shape?: SymbolShape,
  symbols?: SymbolSummary[],
): FileRole {
  if (!shape || !symbols || symbols.length === 0) return pathRole;

  // Tests / fixtures / migrations / docs / prompts / styles / configs —
  // the path floor is the load-bearing signal for these. Don't let LSP
  // override (a stylesheet with synthesized PostCSS symbols is still a
  // stylesheet for review purposes).
  if (
    pathRole === "test" ||
    pathRole === "fixture" ||
    pathRole === "migration" ||
    pathRole === "doc" ||
    pathRole === "prompt" ||
    pathRole === "style" ||
    pathRole === "config"
  ) {
    return pathRole;
  }

  const basename = filePath.split("/").pop() ?? filePath;
  const lowerBase = basename.toLowerCase();
  const isTsx = lowerBase.endsWith(".tsx");

  // Catch hooks defined outside `hooks/` — colocated in a feature folder.
  // Top-level export, function-shaped, name `use*`.
  const hookExport = symbols.find(
    (s) => s.kind === "Function" && /^use[A-Z]/.test(s.name),
  );
  if (hookExport) return "hook";

  // Type-only modules without a `.types.ts` suffix. `Type` is what we map
  // `TypeAlias`/`Type` to; `Interface` and `Enum` round out the family.
  const typeKinds = new Set(["Interface", "Type", "Enum"]);
  const typeyCount = symbols.filter((s) => typeKinds.has(s.kind)).length;
  if (symbols.length >= 2 && typeyCount / symbols.length >= 0.8) {
    return "type-def";
  }

  // Data classes / DTOs vs. behaviour classes. PHP single-class files
  // and TS default-exported classes whose body is mostly properties.
  // We only have flat top-level symbols here, so we approximate with the
  // overall `shape` tally — works because the data-class case has one
  // class plus its properties at the top level.
  const classCount = shape.classes ?? 0;
  if (classCount === 1) {
    const props = shape.properties ?? 0;
    const methods = shape.methods ?? 0;
    const total = props + methods;
    if (total > 0 && props / total >= 0.8 && methods / total <= 0.2) {
      return "entity";
    }
  }

  // Page-level / app-level components outside `components/`. TSX +
  // capital-letter top-level function (default export when the LSP
  // distinguishes; otherwise any exported function).
  if (isTsx) {
    const componentLike = symbols.find(
      (s) => s.kind === "Function" && /^[A-Z]/.test(s.name),
    );
    if (componentLike) return "component";
  }

  return pathRole;
}
