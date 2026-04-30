# Click-through symbol navigation — design plan

## Goal

When reviewing a diff, you should be able to click any identifier in the rendered code and jump (or peek) to its definition. The feature must work:

- **Locally** — when a workspace root is configured on the server, definitions resolve against the on-disk project.
- **Remotely** — when reviewing a GitHub PR, definitions resolve against the repo at that SHA.
- **Across many languages** — the architecture should make adding a new language a small, self-contained change rather than a refactor.

We accept that each language will need a small per-language module. The architecture's job is to make that module small.

## Non-goals (for v1)

- Find-references / call-hierarchy / rename. Definition only.
- Background project-wide indexing. Resolve on demand, cache results.
- Editing inline (this is a review surface, not an editor).

## Architecture overview

Resolvers can run in the browser *or* on the server. The frontend dispatcher tries them in order and takes the first answer. Both sides implement the same `DefinitionResolver` contract.

```
┌─ Frontend ──────────────────────────────────────────────────┐
│   Shiki tokens annotated with {file, line, col}             │
│   Single delegated click handler                            │
│   Peek panel + jump UI (language-agnostic)                  │
│                                                             │
│   ┌─ Dispatcher ─────────────────────────────────────────┐  │
│   │  1. browser resolver for this language (if any)      │  │
│   │  2. POST /api/definition  (server resolver chain)    │  │
│   │  3. server grep floor                                │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────┬──────────────────┘
                                           │
       ┌───────────────────────────────────┴─────────────────┐
       │                                                     │
┌──────▼───────────────────────────┐    ┌────────────────────▼──────────────┐
│   Browser resolvers (Web Worker) │    │   Server resolver chain           │
│   - TS via @typescript/vfs       │    │   tier-1 LSP / custom             │
│   - others as available          │    │   tier-2 tree-sitter              │
│                                  │    │   tier-3 grep (always answers)    │
└──────────────────┬───────────────┘    └───────────────────┬───────────────┘
                   │                                        │
       ┌───────────▼────────────────┐         ┌─────────────▼──────────────┐
       │   Browser Workspace        │         │   Server Workspace         │
       │   - reads via /api/file    │         │   - LocalWorkspace (fs)    │
       │   - or GitHub API direct   │         │   - GitHubWorkspace (api)  │
       └────────────────────────────┘         └────────────────────────────┘
```

The frontend doesn't know which resolver answered. The resolvers don't know whether the workspace is local or remote. The workspace doesn't know what's being asked of the files it serves.

## The contracts

### Resolver

```ts
interface DefinitionResolver {
  // by file extension or content sniff — never by display name
  canHandle(file: WorkspaceFile): boolean;

  resolveDefinition(args: {
    workspace: Workspace;
    file: string;       // workspace-relative path
    line: number;       // 0-indexed
    col: number;        // 0-indexed character offset (not byte)
  }): Promise<Definition[]>;
}

interface Definition {
  file: string;
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  preview?: string;             // few lines of context for peek view
  precision: "exact" | "fuzzy"; // honest signal for the UI
  resolvedBy: string;           // "tsserver" | "tree-sitter" | "grep" — for debugging + UI degradation
}
```

### Workspace

The same shape on both sides. Browser implementations satisfy the same interface; only `ensureMaterialized` is server-only since the browser can't materialize a tree on disk.

```ts
interface Workspace {
  kind: "local" | "github";
  id: string;                                       // stable cache key
  readFile(path: string): Promise<string>;
  // Server-only. Resolvers that need the whole tree on disk (LSP subprocess) call this.
  ensureMaterialized?(): Promise<{ rootDir: string }>;
}
```

Server implementations: `LocalWorkspace` reads from a configured root, `ensureMaterialized` returns that root unchanged. `GitHubWorkspace` reads via the GitHub API and `ensureMaterialized` does a shallow clone at the SHA into a temp dir keyed by `(owner/repo, sha)`, reused across requests.

Browser implementations: `BrowserLocalWorkspace` reads via a server endpoint (`GET /api/file?path=…`), or from an in-memory map for fixtures. `BrowserGitHubWorkspace` reads directly via the GitHub API (no server roundtrip needed).

### Language module

The full per-language footprint. A language can declare a browser-side resolver, a server-side resolver, or both. The dispatcher walks browser → server.

```ts
// languages/typescript.ts
export default defineLanguage({
  id: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  shikiId: "tsx",
  resolvers: {
    browser: () => import("./resolvers/ts-vfs").then(m => new m.TsVfsResolver()),
    server:  (ws) => new TsCompilerApiResolver(ws),
  },
});

// languages/python.ts
export default defineLanguage({
  id: "python",
  extensions: [".py", ".pyi"],
  shikiId: "python",
  clickableScopes: { deny: ["variable.language.self"] },
  resolvers: {
    server: (ws) => new LspResolver(ws, { command: "pyright-langserver", args: ["--stdio"] }),
  },
});

// languages/go.ts
export default defineLanguage({
  id: "go",
  extensions: [".go"],
  shikiId: "go",
  resolvers: {
    server: (ws) => new LspResolver(ws, { command: "gopls", args: ["serve"] }),
  },
});
```

Languages register via a directory scan of `languages/*.ts` at boot. Adding a language with an existing LSP is ~10 lines. Browser resolvers are imported lazily — see "Lazy loading" below.

## Coverage strategy: precision → fuzzy fallback

Three resolver tiers, layered. The dispatcher walks them in order; first non-empty answer wins. The `precision` field tells the UI to degrade gracefully on fuzzy hits.

| Tier | Tech | Languages covered | Precision | Per-language cost |
|------|------|-------------------|-----------|-------------------|
| 1 | LSP (server-side subprocess, or browser-side if a JS/WASM build exists) | Anything with an LSP | Exact (type-aware, import-aware) | Binary discovery + ~5 lines of config |
| 2 | tree-sitter + `tags.scm` queries | ~50 languages with parsers | Scope-aware, name-based | Parser package + tags query |
| 3 | grep-by-symbol-name | Anything textual | Fuzzy (ambiguous on overloads/shadowing) | None |

**Why all three:** Tier 1 covers languages we've configured. Tier 2 picks up everything tree-sitter parses but where no LSP is set up. Tier 3 ensures the feature *never* feels broken — clicking always does something, even if it's "here are 4 candidates by name." This matters for the GitHub remote case where we may not have an LSP configured for the repo's language.

### Browser-hosted resolver availability

For Tier 1 specifically, "where the LSP runs" varies by language. This affects bundle size and whether the feature works without a server.

| Language | Browser-hosted | Notes |
|---|---|---|
| TypeScript / JavaScript | Yes | `typescript` + `@typescript/vfs`. The TS compiler is plain JS — no WASM. Lazy-loaded; ~few MB on first click. |
| Python | Possible | Pyright is JS. Sizeable but feasible. Server-first in v1. |
| Rust | Possible | rust-analyzer has a WASM build (Rust Playground). Server-first in v1. |
| C / C++ | Possible | clangd WASM builds exist. Server-first in v1. |
| PHP | Being explored separately | No off-the-shelf browser LSP today, but `@php-wasm/web` is already in the bundle and a PHP-native LSP could plausibly run inside it. Tracked as a separate exploration. |
| Go, Java, Ruby, Swift, … | No | Server-only via subprocess LSP. |

## Frontend: cross-language identifier detection

Shiki's tokenizer already produces TextMate scopes; the current renderer at `web/src/highlight.ts:147` discards them. To make tokens clickable across languages without per-language frontend code, keep the scope and mark anything matching a small allowlist:

```
variable.*
entity.name.*
support.function
support.class
support.type
meta.function-call
```

Per-language modules can contribute deny-list refinements (e.g., Python `variable.language.self`) when defaults misfire.

Rendered output for a clickable token:

```html
<span class="shiki-token" data-clickable
      data-line="42" data-col="14"
      style="...">classifyRequestOrigin</span>
```

A single delegated click handler on the diff container reads `data-line` / `data-col` (plus the file path from a parent container's `data-file`), hands them to the dispatcher, and shows the peek/jump UI.

## Dispatcher: where the click goes

The dispatcher prefers browser resolvers over server resolvers — not as a fallback ordering, but as a deliberate choice. When a browser resolver exists for the file's language and is warm, the click stays in the browser and the server is not contacted at all.

This matters because:

- The server is optional in this project (consistent with the existing AI-plan fallback), and symbol navigation should preserve that.
- For private code, the browser-only path means files don't leave the user's machine.
- For warm browser resolvers, latency is measured in milliseconds with no server CPU consumed per click.

Concrete behavior:

1. **Look up the file's language.** If the language module declares a browser resolver:
   - **Warm:** answer locally. Done. No server request.
   - **Cold:** start lazy-loading the browser resolver *and* fire a server request in parallel. Use whichever returns first; cancel the other. This keeps the multi-MB initial download out of the visible click latency. Once the browser resolver is warm, future clicks in that language stay browser-only.
   - **Failed to load** (worker error, network issue): fall through to the server.
2. **No browser resolver declared for this language** (Go, Java, etc.): go straight to the server.
3. **Server unreachable and no browser answer:** show "no resolver available" in the peek panel. The feature is honest about its limits rather than pretending to work.

The server, when called, walks its own internal chain (Tier-1 LSP/custom → Tier-2 tree-sitter → Tier-3 grep) and returns the best answer it has. The dispatcher just sees a single response.

Two preferences this design intentionally locks in:
- **Once warm, browser wins** — even if the server could also answer. No "race for the better answer" in steady state.
- **Cold-start races are short-lived** — they exist only on the very first click in a language per session. After that, browser is the only path.

## Component map

Generic, server-side (written once):

- `LspResolver` — JSON-RPC over stdio, manages `initialize` / `didOpen` / `definition` / shutdown, normalizes `Location` and `LocationLink` results, handles file URIs.
- `TreeSitterResolver` — parameterized by `(parserPackage, tagsQueryPath)`.
- `GrepResolver` — language-agnostic floor.
- `ResolverChain` — walks tiers on the server, returns first non-empty.
- `LocalWorkspace` / `GitHubWorkspace` — server-side `Workspace` implementations.
- `WorkspaceCache` — keyed by workspace id; holds per-language resolver instances.

Generic, browser-side (written once):

- `BrowserLspClient` — JSON-RPC inside a Web Worker, same protocol as the server-side `LspResolver` but speaking to a JS/WASM language server.
- `BrowserLocalWorkspace` / `BrowserGitHubWorkspace` — `Workspace` implementations.
- `Dispatcher` — browser resolver → server → no-op, with parallel-on-warm-up.
- Token annotator (Shiki scope mapping), click delegate, peek panel, multi-result disambiguator.

Per-language module:

- Extensions, Shiki id, optional scope refinements.
- One or both resolver factories: `resolvers.browser` and/or `resolvers.server`.

## Decisions to confirm before any code lands

These are cheap to set now and annoying to back out later:

1. **Chain of resolvers, not single-resolver-per-language.** Lets the grep floor always answer. Language modules declare which resolvers exist; the dispatcher walks them.
2. **Single language registry, shared shape across browser and server.** Both sides need it: the frontend for `shikiId` and clickable-scope rules, the server for resolver factories. To avoid drift, the registry definitions live in one shared `languages/` directory; both bundles import the relevant fields. Where shared isn't possible, the server exposes `GET /api/languages` and the frontend hydrates from it at startup.
3. **Token annotation carries the file path.** `highlightLines(lines, language)` at `web/src/highlight.ts:114` currently doesn't know what file it's rendering. The call site must pass the workspace-relative path through, baked into a `data-file` attribute on the line container.
4. **Resolvers are per-workspace, not global.** LSPs want a `rootUri` and watch files; one resolver per (language × workspace). Factory shapes `resolvers.server(workspace)` and `resolvers.browser()` already encode this — browser resolvers are typically per-tab anyway. Server keeps `WeakMap<Workspace, Map<languageId, Resolver>>` and tears down on workspace close.
5. **Lazy loading is important.** Two flavors:
   - **Browser resolver bundles:** `import()` the resolver factory only when a click in that language arrives. Otherwise the TS compiler, pyright, etc. all land in the initial bundle and we ship multi-MB of dead weight on every page load.
   - **Server LSP startup:** boot LSP subprocesses on first click in their language, not at server boot. Cache the warming promise to collapse concurrent boots.
   In both cases, the grep floor on the server can answer immediately while the precise resolver loads, so cold-start latency stays out of the UI.
6. **`precision: "exact" | "fuzzy"` in the response.** Without it, grep and LSP results look identical and users will trust both equally. Worth shipping in v1 even if the UI just adds a subtle marker.

## Implementation order

Each step is independently shippable and proves out one assumption.

### Step 1 — Frontend: clickable tokens, no resolution
Annotate Shiki tokens with line/col + scope, add `data-file` on line containers, add a delegated click handler that `console.log`s `{file, line, col, identifier}`. Validates the cross-language identifier-detection approach and the token plumbing before any resolver work.

### Step 2 — Server resolver chain + grep floor
Backend: `Workspace`, `LocalWorkspace`, `Resolver`/`ResolverChain` types, `GrepResolver`, `POST /api/definition`. Workspace root configured via `SHIPPABLE_WORKSPACE_ROOT` env var. Frontend: dispatcher (server-only for now), peek panel that opens on click, shows results, handles multi-result. End-to-end working for any language, fuzzy precision.

### Step 3 — Browser resolver dispatcher + TypeScript via `@typescript/vfs`
First browser resolver. Web Worker, lazy-imported on first TS click. TS clicks become exact, locally, with no server roundtrip. Adds the `browser → server` dispatcher walk. Validates that the Workspace shape works on both sides.

### Step 4 — Server-side `LspResolver` + Python (pyright) + Go (gopls)
Adds the generic LSP host on the server. Python and Go added as proof the abstraction holds — each new language is one module file. Proves the architecture handles languages with no browser-hosted option.

### Step 5 — Tree-sitter Tier-2 resolver (server)
Fills the long tail for languages without a configured LSP. Most useful for the remote GitHub path where we won't always have a relevant LSP available.

### Step 6 — `GitHubWorkspace` (both sides)
Same resolver layer, different file-system implementation. Server: shallow clone at SHA on `ensureMaterialized()` for resolvers that need a tree; direct API reads for the others. Browser: `BrowserGitHubWorkspace` reads via the GitHub API directly so TS clicks on a remote PR work without the server.

## Open questions to revisit

- **Peek-in-place vs. jump-to-file as the default UX.** Lean peek; revisit after step 2 when the multi-result case is real.
- **How to handle definitions in `node_modules` / external deps.** LSPs return them naturally; tree-sitter and grep don't. Probably fine in v1 — show the result, let the user click through.
- **Cross-language jumps** (e.g., `.tsx` → `.css` module, `.ts` → generated `.graphql` types). Falls out of the contract for free when the LSP knows the mapping; otherwise out of scope for v1.
- **Generated files / source maps.** Out of scope for v1.
- **When to invalidate resolver caches on local file changes.** LSPs handle their own watches; the chain just needs to forward `didChange`. Build the watcher with step 4.
