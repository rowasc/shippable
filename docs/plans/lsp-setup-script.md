# One-shot LSP setup

## Status: planned

A `npm run setup:lsp` (or equivalent) that installs every recommended language server in one go, so a new contributor can opt-in to the full def-nav surface without reading per-language install lines.

## Why this exists

`README.md` now has a per-language install table. That's fine for picking *one* language, but as the language list grows it'll become a chore. We already publish the same install commands in two places:

1. The README table.
2. `LanguageModule.recommendedSetup` in each `server/src/languages/*.ts`.

A script that iterates over the language modules' `recommendedSetup` and runs the first item per module is the third use of that data — and the one that turns the data into action.

## Approach

A small Node CLI under `scripts/setup-lsp.mjs` that:

1. Imports the language registry (`server/src/languages/index.ts`).
2. For each module:
   - Calls `module.discover()`. If it returns a binary, log `✓ <id>: already installed at <path>` and skip.
   - Otherwise, take the *first* entry in `recommendedSetup` and run its `command` via `execSync` with stdio inherited so the user sees real output.
   - On failure, print the remaining `recommendedSetup` entries as alternatives (so the user can fall back manually).
3. After everything: re-run `module.discover()` for each one and print a final per-language status line.

The script lives at the repo root because it's developer-environment glue, not a runtime concern. Wired into `package.json`:

```json
"setup:lsp": "node scripts/setup-lsp.mjs"
```

Two flag options worth keeping simple:

- `--only=ts,php` — install just those modules. Default: all.
- `--dry-run` — print what would be run, don't run it. Useful for first-run inspection.

## What this avoids

- **A YAML / JSON config of LSPs.** The data already lives in TypeScript with the language module. Don't duplicate it.
- **Per-OS shell scripts.** The recommended commands are deliberately picked to be cross-platform (npm and composer). PHP is the only language whose alternative install (`composer global require ...`) needs composer; the script can detect that and surface a helpful message.
- **Background daemonization / hot reload.** Install once, restart the server. Trying to make this hot is more complexity than it earns.

## Risks / open questions

- **`recommendedSetup` doesn't carry "needs sudo" information.** `npm install -g` works on most setups but trips on system Node installs. The script should detect a permission failure and re-print the recommendation without trying to escalate.
- **Pinning versions.** Today the install commands grab `@latest`. If we hit a regression in a specific intelephense version we'd want to pin — punt that until it actually happens.
- **Running on the desktop app's bundled environment.** The desktop sidecar already has a Node binary; calling `npm install -g` from inside the .app would surprise users. Leave the script as a dev-time tool. The desktop app's setup modal can show the same recommendations text without auto-running.

## Order of operations

This is one of the smallest plans on the board. Estimated cost: ~30 minutes. The blocker is just that the language registry has to exist (it does, as of `feat/lsp-definition-nav`), and `recommendedSetup` has to be the source of truth for install commands (it is).

Land it whenever someone's annoyed by the per-language install dance. Don't rush it.
