# Language Server Protocol

## What it is

LSP is a JSON-RPC protocol between an **editor** (client) and a **language server** (e.g. `typescript-language-server`, `intelephense`, `gopls`). The editor handles UI; the server handles language smarts. They communicate over stdio or sockets with messages like `textDocument/hover`, `textDocument/definition`, `textDocument/completion`, `textDocument/references`.

The point of the protocol is decoupling: any editor that speaks LSP gets language smarts for any language with a server, without per-editor or per-language glue. We use it the same way — as a way to add languages without rewriting the resolver layer.

## How a click resolves to a definition

What happens when you hover or click an identifier — say, an `import` from a `node_modules` package:

1. **Open notification.** When the file was opened, the client sent `textDocument/didOpen` with the URI and contents. The server now tracks it.
2. **Project resolution.** The server walked up the directory tree to find `tsconfig.json` / `package.json` / `composer.json`, built a module graph, and resolved imports using the language's own resolution rules (Node's algorithm for JS/TS, Composer autoload for PHP, etc.). For `import x from "lodash"`, it followed `node_modules/lodash/package.json` → `main`/`exports` → `.d.ts` files (or `@types/lodash` for plain JS packages).
3. **Type-check pass.** The server parsed all reachable files into ASTs and ran type inference, building a symbol table that maps each identifier position to a declaration.
4. **Definition request.** The client sends `textDocument/definition` with `{ uri, position: { line, character } }`.
5. **Server lookup.** Server finds the AST node at that position, looks up its symbol, returns the declaration's location.
6. **Response.** `Location { uri, range }` pointing at the `.d.ts` inside `node_modules`. `Hover` is the same flow with `textDocument/hover`, returning a markdown blob with the type signature and JSDoc.

The server keeps a live, incrementally-updated model of the whole project. `didChange` notifications keep it in sync as the user types, so requests are answered from memory in milliseconds rather than re-parsing on demand.

## How we use LSP

We host language servers on the **server side** (the local Node backend in `server/`, which runs as the desktop sidecar in production). The server spawns the LSP as a subprocess, drives the JSON-RPC dance, and exposes the result through `POST /api/definition`. The frontend never speaks LSP directly.

Per-language wiring lives in `server/src/languages/*.ts`. Each module declares its file extensions, its LSP language id, and a discovery probe that finds the binary on `PATH` (or via env var, or via project-local install). Adding a language with an existing LSP is intended to be a single new module file. The generic LSP host that does the JSON-RPC plumbing is shared.

Today: `typescript` and `php` (intelephense / phpactor) are wired up. The shape is documented in `docs/plans/plan-symbols.md`; the PHP module specifically in `docs/plans/lsp-php.md`.

## Why this is more than "just call the LSP"

Two constraints from `AGENTS.md` shape the architecture:

- **Memory-only deployments.** Some users (finance, healthcare, defense) cannot materialize source on disk. A real LSP needs a `rootUri` pointing at files on a filesystem — so in this mode, an LSP subprocess is *not* a legal option. We have to fall back to either a browser-hosted analyzer (TS Compiler API in a Web Worker, php-wasm + nikic/php-parser) or a coarser technique like tree-sitter + `tags.scm`.
- **No server-side clone.** GitHub PR review where the host can't `git clone` (rate limits, no permissions). The server is still in the loop, but it talks to the GitHub API instead of the filesystem.

So our resolver layer is tiered, not LSP-only:

| Tier | Tech                        | Precision | Available in memory-only? |
|------|-----------------------------|-----------|----------------------------|
| 1a   | User's installed LSP        | Exact     | No (needs disk)            |
| 1b   | Bundled LSP (sidecar)       | Exact     | No (needs disk)            |
| 1c   | Browser-hosted analyzer     | Exact-ish | Yes                        |
| 2    | tree-sitter + tags queries  | Scope-aware, name-based | Yes |
| 3    | grep by symbol name         | Fuzzy     | Yes (always answers)       |

The `Workspace` contract carries `materialization: "disk-allowed" | "memory-only"` and `readPosture: "unbounded" | "rate-limited"` so resolvers branch on workspace capability instead of guessing about deployment mode. v0.1.0 only exercises the disk-allowed cells, but the contracts are shaped so the memory-only ones can land later without rework.

The implication for LSP specifically: it is the **highest-fidelity Tier-1 option**, but it is **not** the floor. Every resolver returns a `precision: "exact" | "fuzzy"` field so the UI can degrade honestly when a click lands on a language with no LSP available, or in a workspace where no LSP is legal.

## What we do *not* do

- **Run an LSP in the browser.** Real LSPs assume a process with stdio and a filesystem; the browser has neither. The browser-hosted analyzers are a different shape — they parse files we hand them and return positions, with no long-lived server process. Same `DefinitionResolver` interface, very different internals.
- **Forward the full LSP surface to the frontend.** Only definition lookup is wired up today. Find-references, rename, call-hierarchy are out of scope for v1 (`docs/plans/plan-symbols.md` → "Non-goals").
- **Rely on auto-discovery without confirmation.** Spawning a binary the user pointed us at is a trust decision. Discovery is config-first; auto-probing common install paths is a follow-up. The threat model is no worse than VS Code's, but it's worth being explicit.

## Pointers

- `docs/plans/plan-symbols.md` — the full symbol-navigation design, including the tier system, the deployment matrix, and the deferred memory-only path.
- `docs/plans/lsp-php.md` — the PHP module as the second-language case study.
- `docs/plans/lsp-setup-script.md` — planned `npm run setup:lsp` that installs the recommended LSP per language.
- `docs/concepts/symbol-graph-and-entry-points.md` — the in-diff symbol graph, which is what answers clicks *before* we ever call an LSP (Step 1 in `plan-symbols.md`).
- `server/src/languages/` — per-language modules.
- `server/src/index.ts` — `POST /api/definition` and `GET /api/definition/capabilities`.
