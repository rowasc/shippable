# PHP click-through definition — Tier 1b (bundled LSP)

The user-facing surface is documented at [click-through definitions](../features/click-through-definitions.md). Tier 1a — discovery on `PATH` with `SHIPPABLE_PHP_LSP` override and `node_modules/.bin` / `vendor/bin` fallback — shipped in `server/src/languages/php.ts`. This plan covers the remaining Tier 1b path: shipping a PHP language server inside the desktop sidecar so click-through works for users who have not installed one themselves.

## Scope

Add a fifth probe step that runs *only* in the packaged build (`bun build --compile`); skipped in dev so the dev story stays "install your own."

5. Bundled binary shipped inside the sidecar — `intelephense` (preferred) or `phpactor`.

The user's own install still wins — the four existing probe steps (env override, `PATH`, project `node_modules/.bin`, project `vendor/bin`) run first.

Out of scope:

- Memory-only / browser-hosted PHP analysis (`@php-wasm`) — its own plan in [`plan-symbols.md`](plan-symbols.md).
- Bundling for non-desktop builds. Browser-dev devs install their own LSP.

## Open questions

- **Bundled intelephense licence.** Intelephense's premium features are licensed; the free tier handles definition lookup. Confirm the licence allows redistribution inside our `.dmg` before bundling. Phpactor is OSS and easier to ship if the answer is no.
- **PHP version detection.** intelephense respects `composer.json`'s `php` constraint; phpactor needs `phpactor.config.json`. Tier 1a trusts whatever the worktree has — no Shippable-side configuration. Tier 1b inherits that and adds nothing new.
- **`.phtml` and templated PHP.** Both LSPs handle `.phtml`; mixed HTML/PHP files give weirder positions. Acceptable — fall back to peek when the position isn't navigable.
- **Framework support (Laravel, Symfony).** Definition lookup for facades / DI-resolved services depends on the LSP's framework support being configured. The bundled binary is vanilla intelephense / phpactor; framework support depends on the user's own composer setup.

## Relationship to other plans

- Slots into the `LanguageModule` shape extracted as part of the Tier 1a shipment (`server/src/languages/{types,discovery,typescript,php,index}.ts`). New languages — gopls, rust-analyzer, clangd — follow the same pattern when they land.
- Reused as a graph edge source by [`lsp-code-graph.md`](lsp-code-graph.md).
