# Click-through Definitions

## What it is
Click a symbol in a diff hunk — function, method, class, interface, trait, constant — to jump to its definition. Targets inside the changeset scroll into view in the diff; targets in files the diff doesn't touch open in a peek panel.

## What it does
- Supports JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`) and PHP (`.php`, `.phtml`).
- Uses the language server you already have installed. Discovery probes `SHIPPABLE_<lang>_LSP` first, then `PATH`, then project-local `node_modules/.bin` / `vendor/bin`.
- The `def: …` chip in the diff toolbar shows which languages are reachable in the current changeset. Hover the chip to see why a language reads as unavailable (no binary on PATH, LSP crashed, etc.).
- Markdown and other non-programming files get no chip — quietly out of scope.
- Variable lookups, find-references, rename, call-hierarchy, and framework-specific magic (Laravel facades, Symfony DI) are out of scope; the LSP returns what it can natively.

## Install

JS/TS uses [`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server). Install globally (`npm i -g typescript-language-server typescript`) or rely on the one in your project's `node_modules`.

PHP works against either:

- **Intelephense** (recommended; free tier is enough for definition lookup):
  `npm install -g intelephense`
- **Phpactor** (pure-OSS fallback):
  `composer global require phpactor/phpactor`

Or point at an explicit binary via `SHIPPABLE_PHP_LSP=/path/to/binary`.

## v0 limitations

- **Bundled LSP not yet shipped.** Today you need to install a language server yourself; the desktop app does not bundle one. Tracked in [`docs/plans/lsp-php.md`](../plans/lsp-php.md) for PHP.
- **Browser-only / memory-only deployments fall through.** When the server has no worktree on disk, click-through is unavailable; the chip reads as unsupported. Memory-only PHP analysis via `@php-wasm` is in [`docs/plans/plan-symbols.md`](../plans/plan-symbols.md).
