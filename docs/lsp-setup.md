# LSP setup for symbol navigation

Shippable can resolve go-to-definition against a local checkout per language. Each language module discovers its own LSP independently, so installing one is enough — others can come later. Today: JS/TS via `typescript-language-server`, and PHP via `intelephense` (or `phpactor` as a fallback).

## Install at least one LSP

Pick the languages you actually review.

| Language | Recommended (one-line install)                       | Alternative                                  | Explicit-path env var       |
|----------|------------------------------------------------------|----------------------------------------------|-----------------------------|
| JS / TS  | `npm install -g typescript typescript-language-server` | —                                          | `SHIPPABLE_TYPESCRIPT_LSP`  |
| PHP      | `npm install -g intelephense`                        | `composer global require phpactor/phpactor`  | `SHIPPABLE_PHP_LSP`         |

A one-shot `npm run setup:lsp` is planned — see [`plans/lsp-setup-script.md`](plans/lsp-setup-script.md). Until that lands, run the install lines you want and restart the server.

## Load the diff from a worktree

Open the worktree picker and pick a checkout — the frontend passes its path to the server. For diffs that don't come from a worktree (pasted, URL-loaded, fixture), set `SHIPPABLE_WORKSPACE_ROOT=/abs/path/to/checkout` before starting the server as a fallback root.

## Verify it's working

Hit `GET http://127.0.0.1:3001/api/definition/capabilities` — each entry in `languages[]` reports `available`, `resolver` (binary basename), `source` (where we found it), and `recommendedSetup` if it's missing. The diff toolbar shows a per-language chip: `def: TS LSP` / `def: PHP LSP` when ready, `def: TS, PHP only` for a programming language we don't yet support, or no chip at all on non-programming files (markdown, json, yaml).

## Current limits

See [`plans/plan-symbols.md`](plans/plan-symbols.md) for the roadmap.

- Worktree-backed diffs only (or the `SHIPPABLE_WORKSPACE_ROOT` fallback).
- Adding a new language is a single file in `server/src/languages/`; tracked in [`plans/lsp-php.md`](plans/lsp-php.md).
- No browser-only fallback yet — every click goes through the server.

The bundled desktop app reads from the same workspace, so this one setup serves both surfaces.
