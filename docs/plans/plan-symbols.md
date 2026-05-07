# Click-through symbol navigation — design plan

## Status: partially implemented first slice

The broad architecture here is still a draft. The first end-to-end slice exists with deliberate limits:

- deployment shape: local dev server or desktop sidecar with a real checkout on disk
- changeset source: worktree-loaded diffs first; `SHIPPABLE_WORKSPACE_ROOT` is only a fallback for non-worktree diffs
- language coverage: per-language modules (`server/src/languages/`). JS/TS and PHP are wired up; adding the next language (Go, Rust, Python) is a single new module file
- resolvers:
  - JS/TS via `typescript-language-server` on `PATH` or `SHIPPABLE_TYPESCRIPT_LSP`
  - PHP via `intelephense` (preferred) or `phpactor` on `PATH`, or `SHIPPABLE_PHP_LSP`
- UI signals:
  - pasted/url/file-loaded diffs show `def: worktree only` (the diff didn't come from a checkout)
  - missing LSP binary shows `def: <LANG> unavailable` with the reason in the tooltip
  - files in a *programming* language no module handles show `def: <available list> only` (e.g. `def: TS only` when only TS is set up)
  - files in a non-programming language (markdown, json, yaml, plain text — anything where definition nav doesn't apply at all) show no chip. A "JS/TS only" badge on a markdown file is worse than nothing — it implies a feature exists for that file when it doesn't

## Goal

When reviewing a diff, you should be able to click any identifier in the rendered code and jump (or peek) to its definition. The feature must work:

- **Locally** — when a workspace root is configured (the desktop app's sidecar, or a dev server pointed at a checkout) definitions resolve against the on-disk project.
- **Remotely** — when reviewing a GitHub PR, definitions resolve against the repo at that SHA. With or without a server in the loop.
- **Across many languages** — the architecture should make adding a new language a small, self-contained change rather than a refactor.
- **Across deployment shapes that don't all give us the same affordances.** Some users have everything (a local checkout, a clone, an installed LSP); some have only a browser pointed at a GitHub PR; some can't even clone the source to disk due to security posture. v0.1.0 ships the dominant shape; the architecture should not paint itself into a corner on the others.

We accept that each language will need a small per-language module. The architecture's job is to make that module small.

## Non-goals (for v1)

- Find-references / call-hierarchy / rename. Definition only.
- Background project-wide indexing. Resolve on demand, cache results.
- Editing inline (this is a review surface, not an editor).

## Deployment modes

Two orthogonal properties of the user's environment determine which Tier-1 options are even viable. They live on the `Workspace` (see "The contracts" below) so resolvers branch on them, not on guesses about deployment.

- **Read posture** — `unbounded` (local disk, our server, sidecar) vs. `rate-limited` (GitHub API direct from the browser, where every read counts against a budget).
- **Materialization** — `disk-allowed` (we can shallow-clone and point an LSP at a temp dir) vs. `memory-only` (security posture forbids source on disk; analysis happens against in-memory file contents only).

The cross product:

|                    | disk-allowed                                                       | memory-only                                                          |
|--------------------|--------------------------------------------------------------------|----------------------------------------------------------------------|
| **unbounded**      | **v0.1.0 primary.** Local checkout via sidecar/server. User's LSP or bundled LSP, free reads. | Deferred. Rare but possible (e.g. internal source-streaming service). In-memory analyzer. |
| **rate-limited**   | **v0.1.0 best-effort.** GitHub PR review where we *can* clone server-side or sidecar-side. Shallow-clone, run LSP. | Deferred. GitHub PR review under tight security posture — can't clone, can't write source to disk. Browser-hosted in-memory analyzer is the only legal option. See "Memory-only PHP analysis (deferred path)" below for the PHP version. |

What v0.1.0 ships: the top row (disk-allowed). What v0.1.0 must *not* preclude: the bottom row, which is why the contracts carry these properties from day one.

## Architecture overview

Resolvers can run on the user's machine (in the desktop sidecar, in a dev server, or in the browser) or on a hosted backend. They all implement the same `DefinitionResolver` contract. The frontend dispatcher tries them in order and takes the first answer.

```
┌─ Frontend ──────────────────────────────────────────────────┐
│   Shiki tokens annotated with {file, line, col}             │
│   Single delegated click handler                            │
│   Peek panel + jump UI (language-agnostic)                  │
│                                                             │
│   ┌─ Dispatcher ─────────────────────────────────────────┐  │
│   │  1. browser resolver for this language (if any)      │  │
│   │  2. POST /api/definition  (server resolver chain)    │  │
│   │  3. nothing — show "no resolver available"           │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────┬──────────────────┘
                                           │
       ┌───────────────────────────────────┴─────────────────┐
       │                                                     │
┌──────▼───────────────────────────┐    ┌────────────────────▼──────────────┐
│   Browser resolvers (Web Worker) │    │   Server resolver chain           │
│   - TS via @typescript/vfs       │    │   tier-1a user's installed LSP    │
│   - PHP via @php-wasm/web        │    │   tier-1b bundled LSP (sidecar)   │
│   - others as available          │    │   tier-2  tree-sitter             │
│                                  │    │   tier-3  grep (always answers)   │
└──────────────────┬───────────────┘    └───────────────────┬───────────────┘
                   │                                        │
       ┌───────────▼────────────────┐         ┌─────────────▼──────────────┐
       │   Browser Workspace        │         │   Server Workspace         │
       │   - reads via /api/file    │         │   - LocalWorkspace (fs)    │
       │   - or GitHub API direct   │         │   - GitHubWorkspace (api)  │
       └────────────────────────────┘         └────────────────────────────┘
```

The "server" in the diagram is the same code in both deployments: a Node process running locally (Tauri sidecar in desktop, dev server otherwise) or hosted. The dispatcher doesn't care which.

The frontend doesn't know which resolver answered. The resolvers don't know which deployment mode they're in — they ask the workspace. The workspace doesn't know what's being asked of the files it serves.

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
  resolvedBy: string;           // "intelephense" | "tree-sitter" | "grep" — for debugging + UI degradation
}
```

### Workspace

The same shape on both sides. Browser implementations satisfy the same interface; only `ensureMaterialized` is server-only since the browser can't materialize a tree on disk.

```ts
interface Workspace {
  kind: "local" | "github";
  id: string;                                       // stable cache key
  readFile(path: string): Promise<string>;

  // What this workspace can promise.
  readPosture: "unbounded" | "rate-limited";
  materialization: "disk-allowed" | "memory-only";

  // For rate-limited workspaces, optional hooks the resolver can use:
  listFiles?(glob: string): Promise<string[]>;     // cheap one-shot enumeration if available
  searchByName?(name: string): Promise<Hit[]>;      // e.g. GitHub Code Search; the name-floor
  remainingBudget?(): { reads: number };             // soft signal to the resolver

  // Server-only, and only callable when materialization === "disk-allowed".
  // Resolvers that need the whole tree on disk (LSP subprocess) call this.
  ensureMaterialized?(): Promise<{ rootDir: string }>;
}
```

Server implementations:

- `LocalWorkspace` reads from a configured root, declares `unbounded` + `disk-allowed`. `ensureMaterialized` returns that root unchanged.
- `GitHubWorkspace` reads via the GitHub API and (when permitted) does a shallow clone at the SHA into a temp dir keyed by `(owner/repo, sha)`, reused across requests. The clone behavior is configurable per deployment — if a repository's source isn't allowed to be local, the workspace declares `memory-only` and `ensureMaterialized` is unavailable, so only resolvers that take file content over the wire can answer.

Browser implementations:

- `BrowserLocalWorkspace` reads via a server endpoint (`GET /api/file?path=…`), or from an in-memory map for fixtures. Posture inherits from the server side.
- `BrowserGitHubWorkspace` reads directly via the GitHub API (no server roundtrip needed). Declares `rate-limited` + `memory-only` — there's no disk to materialize to.

### Language module

The full per-language footprint. Each resolver factory is conditional on the workspace properties; the dispatcher only considers resolvers that can run in the workspace's mode.

```ts
// languages/typescript.ts
export default defineLanguage({
  id: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  shikiId: "tsx",
  resolvers: {
    // Browser-hosted: TS Compiler API in a Web Worker. Works in every workspace mode.
    browser: () => import("./resolvers/ts-vfs").then(m => new m.TsVfsResolver()),
    // Server-hosted: also works without a sidecar binary; pure JS LSP.
    server:  (ws) => new TsCompilerApiResolver(ws),
  },
});

// languages/php.ts
export default defineLanguage({
  id: "php",
  extensions: [".php", ".phtml"],
  shikiId: "php",
  resolvers: {
    server: {
      // Tier 1a: user's installed LSP, if discovered/configured.
      discover: () => discoverIntelephense() ?? discoverPhpactor(),
      // Tier 1b: bundled LSP shipped with the sidecar. Disk-allowed only.
      bundled: { command: "intelephense", args: ["--stdio"], requires: "disk-allowed" },
    },
    // Memory-only fallback; details in "Memory-only PHP analysis" below.
    browser: () => import("./resolvers/php-wasm").then(m => new m.PhpWasmResolver()),
  },
});

// languages/go.ts
export default defineLanguage({
  id: "go",
  extensions: [".go"],
  shikiId: "go",
  resolvers: {
    server: {
      discover: () => discoverGopls(),
      bundled: { command: "gopls", args: ["serve"], requires: "disk-allowed" },
    },
    // No browser-hosted Go resolver. In memory-only mode, falls through to Tier 2/3.
  },
});
```

Languages register via a directory scan of `languages/*.ts` at boot. Adding a language with an existing LSP is meant to be simple. Browser resolvers are imported lazily — see "Lazy loading" below.

## Coverage strategy: precision → fuzzy fallback

Resolvers are layered in tiers; the dispatcher walks them in order; first non-empty answer wins. The `precision` field tells the UI to degrade gracefully on fuzzy hits.

| Tier  | Tech                                                                          | Languages covered                                | Precision                              | Per-language cost                            |
|-------|-------------------------------------------------------------------------------|--------------------------------------------------|----------------------------------------|----------------------------------------------|
| 1a    | **User's installed LSP** (intelephense, gopls, rust-analyzer, …) via sidecar  | Whatever the user has set up                     | Exact (their PHP version, their vendor) | Per-language discovery probe + ~5 lines of config |
| 1b    | **Bundled LSP** (server-side subprocess shipped with sidecar / hosted server) | Anything we ship a binary for                    | Exact                                  | Binary discovery + ~5 lines of config        |
| 1c    | **Browser-hosted analyzer** (TS Compiler API, php-wasm-based PHP analyzer)    | Anything we have a JS/WASM build for             | Exact for some constructs              | Per-language module + bundle weight          |
| 2     | tree-sitter + `tags.scm` queries                                              | ~50 languages with parsers                       | Scope-aware, name-based                | Parser package + tags query                  |
| 3     | grep-by-symbol-name                                                           | Anything textual                                 | Fuzzy (ambiguous on overloads)         | None                                         |

**Why the sub-tiers within Tier 1 matter:** The user's installed LSP is the highest fidelity *and* zero shipping cost — it knows their PHP version, their `composer install`'d vendor, their custom config. The bundled LSP is the fallback for users without one configured. The browser-hosted analyzer is the only Tier-1 option when materialization is `memory-only` (no disk to point an LSP at) — for most languages, there is no browser-hosted option and the dispatcher falls to Tier 2.

Tier 2 picks up everything tree-sitter parses but where no Tier-1 resolver applies. Tier 3 ensures the feature *never* feels broken — clicking always does something, even if it's "here are 4 candidates by name."

### Browser-hosted Tier-1c availability

Whether a language has a browser-hosted resolver affects the `memory-only` row of the deployment matrix.

| Language                | Browser-hosted Tier-1c                                                                                   |
|-------------------------|----------------------------------------------------------------------------------------------------------|
| TypeScript / JavaScript | Yes. `typescript` + `@typescript/vfs`. Pure JS, no WASM. Lazy-loaded.                                    |
| PHP                     | Yes. `@php-wasm/web` is already in the bundle for the runner; details in "Memory-only PHP analysis (deferred path)" below. |
| Python                  | Possible (pyright is JS). Server-first.                                                                  |
| Rust                    | Possible (rust-analyzer has a WASM build). Server-first.                                                 |
| C / C++                 | Possible (clangd WASM builds exist). Server-first.                                                       |
| Go, Java, Ruby, Swift, …| No. In `memory-only` mode these fall through to Tier 2.                                                  |

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
2. **No browser resolver declared for this language** (Go, Java, etc.): go straight to the server. The server picks Tier 1a (user's LSP), 1b (bundled), 2, or 3 based on what's available *and* what's legal in the workspace's mode.
3. **Server unreachable and no browser answer:** show "no resolver available" in the peek panel. The feature is honest about its limits rather than pretending to work.

Two preferences this design intentionally locks in:
- **Once warm, browser wins** — even if the server could also answer. No "race for the better answer" in steady state.
- **Cold-start races are short-lived** — they exist only on the very first click in a language per session. After that, browser is the only path.

## Component map

Generic, server-side (written once):

- `LspResolver` — JSON-RPC over stdio, manages `initialize` / `didOpen` / `definition` / shutdown, normalizes `Location` and `LocationLink` results, handles file URIs. Used by both Tier 1a (user's LSP) and Tier 1b (bundled).
- `LspDiscovery` — per-language probes for the user's installed LSP (`which`, common npm/composer/cargo install paths, VS Code extension dirs, project-local `vendor/bin`/`node_modules/.bin`). Config-only fallback for users who'd rather declare the path explicitly.
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
- Some combination of `resolvers.server.discover`, `resolvers.server.bundled`, `resolvers.browser`. Each is conditional on the workspace's `materialization` and `readPosture`.

## Decisions to confirm before any code lands

These are cheap to set now and annoying to back out later:

1. **Chain of resolvers, not single-resolver-per-language.** Lets the grep floor always answer. Language modules declare which resolvers exist; the dispatcher walks them.
2. **Workspace declares `readPosture` and `materialization`; resolvers branch on them.** Resolvers never ask "am I on GitHub?" or "is this the desktop app?" — they ask the workspace what it can promise. v0.1.0 only exercises the disk-allowed cells; the contract is shaped to allow the memory-only cells later without rework.
3. **User's installed LSP first, bundled LSP second.** When the user already has intelephense / gopls / rust-analyzer set up, we use it — best fidelity, zero shipping cost, respects their config and their PHP/Go/Rust toolchain. Bundled LSP is the fallback for users with nothing configured. Discovery is config-first (a settings field with a path); auto-probing is a follow-up.
4. **Single language registry, shared shape across browser and server.** Both sides need it: the frontend for `shikiId` and clickable-scope rules, the server for resolver factories. To avoid drift, the registry definitions live in one shared `languages/` directory; both bundles import the relevant fields. Where shared isn't possible, the server exposes `GET /api/languages` and the frontend hydrates from it at startup.
5. **Token annotation carries the file path.** `highlightLines(lines, language)` at `web/src/highlight.ts:114` currently doesn't know what file it's rendering. The call site must pass the workspace-relative path through, baked into a `data-file` attribute on the line container.
6. **Resolvers are per-workspace, not global.** LSPs want a `rootUri` and watch files; one resolver per (language × workspace). Factory shapes already encode this — browser resolvers are typically per-tab anyway. Server keeps `WeakMap<Workspace, Map<languageId, Resolver>>` and tears down on workspace close.
7. **Lazy loading is important.** Two flavors:
   - **Browser resolver bundles:** `import()` the resolver factory only when a click in that language arrives. Otherwise the TS compiler, php-wasm, etc. all land in the initial bundle and we ship multi-MB of dead weight on every page load.
   - **Server LSP startup:** boot LSP subprocesses on first click in their language, not at server boot. Cache the warming promise to collapse concurrent boots.
   In both cases, the grep floor on the server can answer immediately while the precise resolver loads, so cold-start latency stays out of the UI.
8. **`precision: "exact" | "fuzzy"` in the response.** Without it, grep and LSP results look identical and users will trust both equally. Worth shipping in v1 even if the UI just adds a subtle marker.

## Implementation order

Each step is independently shippable and proves out one assumption. The important correction: the first useful product slice is **not** "hook up LSP." It's "make highlighted identifiers navigable when the diff already tells us where the definition lives."

### Step 1 — Frontend: clickable tokens + in-diff symbol jumps
Annotate Shiki tokens with scope metadata and symbol names, then wire clicks on identifiers that match the existing diff `StructureMap` / `SymbolIndex`. A click jumps to the defining hunk **within the current changeset only**. No server, no LSP, no fake precision claim. This proves the UX, validates the token plumbing, and gives reviewers an immediately useful feature on top of data we already compute.

### Step 2 — Server resolver chain + grep floor
Backend: `Workspace`, `LocalWorkspace` (declaring `unbounded` + `disk-allowed`), `Resolver`/`ResolverChain` types, `GrepResolver`, `POST /api/definition`. Workspace root configured via `SHIPPABLE_WORKSPACE_ROOT` env var. Frontend: dispatcher (server-only for now) plus a peek panel for results that are **not** already satisfiable from the in-diff symbol graph. End-to-end working for any language, fuzzy precision.

What actually landed first, because it was the smallest non-fake slice:

- `GET /api/definition/capabilities` + `POST /api/definition`
- workspace root resolved from the loaded worktree path, falling back to `SHIPPABLE_WORKSPACE_ROOT`
- generic clickable identifier tokens for JS/TS files only when the server says the LSP path is available
- real `typescript-language-server` subprocess for definition lookup
- direct jump when the returned definition is already inside the loaded diff; otherwise a peek card with file path + preview

### Step 3 — Server-side `LspResolver` + bundled LSPs (Tier 1b)
Adds the generic LSP host. Pick two languages with mature LSPs to validate the abstraction — a proven path is intelephense (PHP) and gopls (Go). Each new language is one module file. The sidecar (in desktop) and dev server both run the LSP subprocess; same code path.

**Status:** PHP landed via `server/src/languages/php.ts` (intelephense + phpactor). Generic per-language module shape is in `server/src/languages/types.ts`; capabilities response carries one entry per module with `available`, `resolver`, `source`, and `recommendedSetup` for missing tools. The bundled-LSP variant of Tier 1b (shipping a binary inside the sidecar) is not yet wired up — discovery on `PATH` covers the common case. Go (gopls), Rust (rust-analyzer), and the bundled sidecar variant are the open follow-ups.

### Step 4 — User's LSP discovery (Tier 1a)
Add `LspDiscovery` and a settings field per language ("path to PHP language server"). Probe order: explicit config → project-local `vendor/bin/` or `node_modules/.bin/` → common global install locations → fall through to bundled. The probe is still the same `LspResolver`; only the binary path differs.

### Step 5 — Browser resolver dispatcher + TypeScript via `@typescript/vfs`
First browser resolver. Web Worker, lazy-imported on first TS click. TS clicks become exact, locally, with no server roundtrip. Adds the `browser → server` dispatcher walk. Validates that the `Workspace` shape works on both sides.

### Step 6 — Tree-sitter Tier-2 resolver (server)
Fills the long tail for languages without a configured LSP. Most useful for the remote GitHub path where we won't always have a relevant LSP available.

### Step 7 — `GitHubWorkspace` (both sides), disk-allowed
Same resolver layer, different file-system implementation. Server: shallow clone at SHA on `ensureMaterialized()` for resolvers that need a tree; direct API reads for the others. Browser: `BrowserGitHubWorkspace` reads via the GitHub API directly so TS clicks on a remote PR work without the server. Workspace declares `rate-limited` + `disk-allowed`.

### Step 8 — Memory-only mode (deferred)
The bottom row of the deployment matrix. Server-side `GitHubWorkspace` honors a deployment flag that disables `ensureMaterialized` (the workspace then declares `memory-only`). Resolvers that require disk become unavailable in this mode and the dispatcher falls through. Browser-hosted Tier-1c is the only Tier-1 option here; for PHP, see "Memory-only PHP analysis (deferred path)" below. For other languages, the user gets Tier 2/3.

## Memory-only PHP analysis (deferred path)

The bottom-right cell of the deployment matrix — GitHub PR review with `memory-only` materialization — is the only place where browser-hosted Tier-1c is the *only* viable Tier-1 option for PHP. This section sketches what we'd build there. It's deferred; nothing in v0.1.0 depends on it.

### Why this path exists at all

The existing `@php-wasm/web-8-3` runtime in `web/src/runner/php-worker.ts:91` already runs PHP in a Web Worker for the code-runner feature. That gives us a sunk-cost PHP environment we can drive for definition resolution at no extra binary-shipping cost — provided we accept its constraints: one-shot `php.run` calls (no native stdio), Web Worker memory limits, no `pcntl_*` / `posix_*`. These constraints rule out hosting a real PHP LSP (intelephense, phpactor) inside the worker; they don't rule out an analyzer that takes file content as input and returns positions.

### Approach: nikic/php-parser as a thin analyzer

A small PHP entrypoint (`analyzer.php`) bundled with the runtime:

1. Loads `nikic/php-parser` from a phar/static asset written to the VFS at worker boot.
2. Parses each requested file into an AST, builds a per-file symbol index keyed by `{namespace, fqn, kind}` for class/interface/trait/function/method/const declarations.
3. Resolves the click against the local file's symbols, then `use`-imported names, then a workspace-wide map populated lazily.
4. Returns `Definition[]` with `precision: "exact"` when uniquely resolved, `"fuzzy"` when only the name matches.

Coverage: function calls, class/interface/trait references, static calls, constants, `use`-imported names. Variable lookups, dynamic dispatch, magic methods, trait merging fall through to Tier 2 / Tier 3.

### The persistent-runtime trick

`@php-wasm/web` exposes `PHP#run({code})` as a one-shot, but the `PHP` instance itself persists across calls — class definitions, opcache, statically-cached PHP-level state all survive. Boot the parser + analyzer *once* (`require 'phar://php-parser.phar/autoload.php'`, `require 'analyzer.php'`); subsequent calls just look up the cached index and resolve. This avoids needing a long-lived stdio loop the runtime can't provide.

### Workspace bridge

The `memory-only` constraint means files never touch disk at all — the worker mounts them in its in-memory VFS. Two-phase fetch: the worker replies `{ status: "needs", files: [...] }` if the analyzer hits a file not yet in the VFS; the main thread fulfils via `Workspace.readFile` and re-issues with the file set attached. Cache lives in the worker keyed by content hash (which, for `rate-limited` workspaces, is effectively SHA-pinned).

The diff files are special: they're already on the page (it's what the user is reviewing). The resolver indexes those for free on every request. **In-diff resolution is therefore the contract floor for this path** — even if every other read fails or the budget is exhausted, clicks within the diff still resolve when the target is also in the diff.

### One worker, separate from the runner

The runner's worker (`web/src/runner/php-worker.ts`) is killable on user-code crashes; the analyzer's worker shouldn't be (rebuilding the symbol index is expensive). They have different mount needs and trust boundaries. Two workers; the analyzer one is lazy-spawned on first PHP click in this mode.

### When this lands

Sub-steps for when the deferred path becomes work:

1. A worker that boots the runtime and proves PHP-level state persists across `php.run` calls.
2. Bundle `nikic/php-parser` as a phar; prove it parses inside the worker.
3. In-diff resolution end-to-end (the contract floor).
4. Cross-file lookup with two-phase fetch and content-hashed cache.
5. Language-module wiring; dispatcher integration for the `memory-only` cell.

The hard parts (workspace bridge, cache, cold-start UX) are exercised at sub-step 3-4, not later. If real-LSP-grade fidelity becomes interesting eventually, phpactor's RPC mode (request/response JSON, no event loop) can help us deal with the persistent-process limitation.

## Open questions to revisit

- **Peek-in-place vs. jump-to-file as the default UX.** Lean peek; revisit after step 2 when the multi-result case is real.
- **How to handle definitions in `node_modules` / external deps.** LSPs return them naturally; tree-sitter and grep don't. Probably fine in v1 — show the result, let the user click through.
- **Cross-language jumps** (e.g., `.tsx` → `.css` module, `.ts` → generated `.graphql` types). Falls out of the contract for free when the LSP knows the mapping; otherwise out of scope for v1.
- **Generated files / source maps.** Out of scope for v1.
- **When to invalidate resolver caches on local file changes.** LSPs handle their own watches; the chain just needs to forward `didChange`. Build the watcher with step 4.
- **Trust model for spawning the user's LSP binary.** We're executing a binary the user pointed us at — not worse than VS Code does, but worth being explicit about. v0.1.0 stance: config-only (no auto-spawn from probed paths until the user confirms once).
- **How `memory-only` is triggered.** Deployment flag? Per-repository config? User toggle? Probably some combination, but the workspace contract doesn't care — only the place that constructs the workspace does.

## Related

- [`lsp-code-graph.md`](lsp-code-graph.md) — reuses the LanguageModule resolver chain to derive diagram edges (`documentSymbol` + `references`) instead of regex, so non-JS files stop rendering as floating islands.
