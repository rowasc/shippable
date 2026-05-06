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

Real PHP, no mocks (per the project's testing principles):

1. Fixture diff with a PHP file that calls a function defined in another PHP file in the same worktree.
2. `it.skip` if neither intelephense nor phpactor is on `PATH` — CI doesn't have one yet, and faking the LSP's responses won't catch the real failure modes (initialize hangs, didOpen ordering, capability mismatches).
3. Two real-LSP integration tests, one per server, gated on the binary being present:
   - in-diff jump (target file is also in the changeset)
   - peek (target file is in the worktree but not in the changeset)
4. A unit test for the discovery probe order — pure function, no LSP needed.

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
