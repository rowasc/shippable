# PHP click-through definition support

## Status: shipped (Tier 1a, discovery-on-PATH)

PHP definition lookup is wired up end-to-end via `server/src/languages/php.ts`. Intelephense is the recommended LSP (free tier handles definition lookup); phpactor is a pure-OSS fallback. Discovery probes `SHIPPABLE_PHP_LSP` → `intelephense` on `PATH` → `phpactor` on `PATH` → `vendor/bin/phpactor`. The bundled-LSP Tier 1b path (shipping a binary inside the sidecar) is not wired up yet.

The remainder of this doc is the original plan; the `Refactor before adding PHP` section landed as `server/src/languages/{types,discovery,typescript,php,index}.ts`. Open follow-ups are at the bottom.

This is the second language module after JS/TS. It exists to prove out the "small per-language module" claim in [`plan-symbols.md`](plan-symbols.md) — adding a language with a mature LSP should be a small, contained change, not a refactor of the resolver layer.

## Why now

PHP is the highest-leverage second target:

- a8c reviewers spend most of their day in PHP. JS/TS-only is a hard limit on how useful Shippable feels in real reviews here.
- there are two production-grade LSPs (intelephense, phpactor) that already work the way TS-LSP does — discover binary on `PATH`, speak LSP over stdio, return `Location`/`LocationLink`.
- we already pull `@php-wasm/web` for the runner, so the deferred memory-only path (browser-hosted analyzer) has a sunk-cost runtime to lean on later — see plan-symbols.md → "Memory-only PHP analysis (deferred path)".

JS/TS shipped as a hardcoded `typescript-language-server` invocation. To add PHP without copy-pasting that wiring, generalize the resolver layer first, then add PHP as data.

## What's in scope for v0.1

Tier 1a (user's installed LSP) and Tier 1b (bundled LSP) on the *server* path only. No browser-hosted PHP resolver in this iteration; `memory-only` deployments fall through to Tier 2/3 as documented in plan-symbols.md.

In scope:

- click on a function/method/class/interface/trait/constant in a `.php` or `.phtml` diff hunk
- definition resolved inside the same worktree the diff was loaded from
- jump-in-diff when the target is inside the changeset; peek panel otherwise
- the `def: …` chip in the diff toolbar reflects PHP availability the same way it reflects TS today
- `GET /api/definition/capabilities` reports `"php"` alongside `"ts"`/`"tsx"`/`"js"`/`"jsx"`

Out of scope:

- variable lookups, dynamic dispatch, magic methods, `__call` / `__get` indirection (these need real type inference)
- find-references, rename, call-hierarchy
- composer-aware "go to vendor source" beyond what the LSP returns natively
- the browser-hosted `@php-wasm` analyzer — covered separately in plan-symbols.md
- PHP-specific scope refinements in the Shiki tokenizer beyond what the default allowlist already gives us

## Refactor before adding PHP

`server/src/definitions.ts` currently hardcodes `typescript-language-server` as the only resolver, the only command, and the only language id mapping. The first commit of this work is a *refactor* with zero behaviour change:

1. Extract a `LanguageModule` shape:
   ```ts
   interface LanguageModule {
     id: "ts" | "php" | …;
     extensions: string[];
     // LSP language ids per extension (".tsx" → "typescriptreact", ".phtml" → "php")
     lspLanguageId: (ext: string) => string;
     // Tier 1a/1b discovery — first hit wins.
     discover: () => { command: string; args: string[]; source: "configured" | "path" | "node_modules" | "vendor" | "bundled" } | null;
   }
   ```
2. Move `resolveTypescriptLanguageServer` into a `tsLanguage` module that implements this shape.
3. Replace `clientCache` with `Map<string /* workspaceRoot */, Map<languageId, LspClient>>`.
4. Drive resolution from `(file extension → LanguageModule)` instead of the hard branch on `SUPPORTED_LANGUAGES`.
5. `getDefinitionCapabilities()` becomes "for each registered module, report availability and reason"; the response shape needs a small extension — tracked in [`api-review.md`](api-review.md).

Acceptance test for the refactor: existing `/api/definition` requests for TS files behave identically; the only test diff is the shape of `/api/definition/capabilities`.

## Then: add the PHP module

`server/src/languages/php.ts`:

- extensions: `.php`, `.phtml`
- LSP language id: always `"php"`
- discovery probe order:
  1. `SHIPPABLE_PHP_LSP` if set (explicit binary path; same shape as `SHIPPABLE_TYPESCRIPT_LSP`)
  2. `intelephense` on `PATH`
  3. `phpactor` on `PATH`
  4. project-local `vendor/bin/phpactor` and `node_modules/.bin/intelephense`
  5. *(Tier 1b)* bundled `intelephense` shipped inside the sidecar binary — only when packaged via `bun build --compile`, not in dev. Treat this as a follow-up; the v0.1 cut is fine with discovery only.

For both, the spawn args are:

- intelephense: `["--stdio"]`
- phpactor: `["language-server"]`

Initialization is the same `initialize` / `initialized` / `textDocument/didOpen` / `textDocument/definition` dance. Both servers want a `rootUri`; we already pass that. intelephense additionally asks for `initializationOptions.licenceKey` — leave it unset (it gracefully degrades to the free tier).

PHP's `Location` shape is identical to TS's. The existing `normalizeLocation` works unchanged.

## UI changes

Almost none, by design. The `def: JS/TS only` chip already reads from `getDefinitionCapabilities().supportedLanguages`; once PHP is in that list, a PHP file with the LSP installed shows `def: PHP LSP` (or just `def: LSP`, see [`api-review.md`](api-review.md) for the chip-label question). The "non-programming language → no chip" behaviour from plan-symbols.md L11 means markdown is still quiet.

The discovery error message needs a small change so it points at the right binary:

> "intelephense / phpactor not found. Install one (`composer global require intelephense/intelephense` or `composer global require phpactor/phpactor`) or set `SHIPPABLE_PHP_LSP`."

## Test plan

Two explicit suites. Both are required to ship; neither silently skips.

### Unit / integration suite (`npm run test`)

Runs against a **stub LSP server** — a small fixture subprocess that speaks the JSON-RPC framing on stdio and answers the methods we use (`initialize`, `initialized`, `textDocument/didOpen`, `textDocument/definition`, `shutdown`) with canned responses. Real subprocess + real framing means the wire-level failure modes (initialize handshake, didOpen ordering, request/response correlation) *are* exercised — what's controlled is the LSP's *answer*, not the protocol. This is consistent with the project's testing principles: we are not mocking our own modules, we are providing a controlled fixture for an external service so the test pays for itself and runs deterministically in CI.

This is a deliberate revision of an earlier "real PHP, no mocks" framing. The deterministic things our code owns — capability gating, fallback when no LSP is available, the `Location` → file/line translation, the discovery probe order — don't need a real PHP indexer to test. They need controlled inputs.

Tests:

1. **In-diff jump.** Stub returns a `Location` pointing at another file in the changeset. Assert the definition endpoint resolves the target and the diff reader scrolls to it.
2. **Peek (out-of-diff target).** Stub returns a `Location` pointing at a file present in the worktree but not the changeset. Assert the peek payload has the right path and content.
3. **Capability gating.** Stub reports the language as unavailable on `initialize`; endpoint surfaces the right error and the chip reads `def: JS/TS only`.
4. **didOpen sequencing.** Stub asserts `didOpen` arrives before `definition` for any file we ask about, and counts duplicates — guards against re-opening already-open documents.
5. **Discovery probe order.** Pure unit test, no subprocess needed.

### End-to-end suite (`npm run test:e2e`)

Runs against the **real LSP binaries**. This is the suite that catches "intelephense changed its response shape in 1.10.4" — the stub can't model that.

**Never silently skipped.** The suite has a single `beforeAll` that probes for `intelephense` and `phpactor` on `PATH` (or `SHIPPABLE_PHP_LSP`); if neither is found, it **fails the suite** with an explicit message:

> `e2e: no PHP LSP found on PATH. Install one (`composer global require intelephense/intelephense` or `composer global require phpactor/phpactor`) or set SHIPPABLE_PHP_LSP. To run only the unit/integration suite, use `npm run test`.`

There is no `it.skip` path. CI installs at least one binary as a setup step; local devs do too, or run the unit suite. The dev-facing trade-off is explicit: you can run `test` without PHP installed, but `test:e2e` will fail loudly until you install it.

Tests, **once per available server** (intelephense, phpactor), so a regression in either is visible:

E1. One fixture worktree with a PHP function-call diff; assert the response is non-empty and points at a plausible target. Intentionally does not assert exact line numbers — LSP behaviour drifts between versions.
E2. The same in-diff and peek shapes as the unit suite, but against a real index. Confirms our wiring works against an actual server, not just our stub's idea of one.

If only one of the two binaries is on `PATH`, that one runs; the other reports "binary not present" as a *failure* unless explicitly waived via `SHIPPABLE_E2E_PHP_LSPS=intelephense` (or similar) — silent partial coverage is what we're trying to avoid.

The stub fixture is shared with `lsp-code-graph.md` and any future LSP-backed feature.

## Risks / open questions

- **Bundled intelephense licence**. Intelephense's premium features are licensed; the free tier is fine for definition lookup. Confirm before bundling. Phpactor is OSS and easier to ship.
- **PHP version detection**. intelephense respects `composer.json`'s `php` constraint; phpactor needs `phpactor.config.json`. v0.1 trusts whatever the worktree already has — no Shippable-side configuration.
- **Frameworks (Laravel, Symfony)**. Definition lookup for facades / DI-resolved services depends on the LSP's framework support being installed. Out of scope for us; document it as "use what your editor uses."
- **`.phtml` and templated PHP**. Both LSPs handle `.phtml`; mixed HTML/PHP files might give weirder positions. Acceptable for v0.1 — fall back to peek when the position isn't navigable.
- **Capability response shape**. Reporting "PHP unavailable because no binary found" alongside "TS available" needs the per-language capability shape change in `api-review.md`. Don't ship PHP without that.

## Relationship to other plans

- Builds on the LSP plumbing already in place from plan-symbols.md Step 2.
- Does *not* require Step 5 (browser resolvers) or Step 8 (memory-only).
- Unblocks adding gopls / rust-analyzer / clangd — same LanguageModule shape, different binaries.
- Reused as a graph edge source by [`lsp-code-graph.md`](lsp-code-graph.md) — second consumer of the same LanguageModule, this time for diagram edges instead of click-through.
