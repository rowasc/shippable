# Worktree Directory Picker

## What it is
The chooser-first entry point for loading a local repo or worktrees folder into Shippable. Replaces the old paste-a-path-first textbox in both the Welcome screen and the [load changeset](./load-changeset.md) modal.

## What it does
- Primary `Choose folder…` button in Welcome and LoadModal.
- On the Tauri desktop app, opens the native folder picker and remembers the last directory the user worked from.
- In browser/dev, opens a host-native folder dialog via the local server (`POST /api/worktrees/pick-directory`) and returns the absolute path the existing git-backed endpoints already expect.
- Auto-scans the chosen directory for worktrees as soon as the picker resolves. Cancel is a no-op.
- Manual path entry stays available as a secondary `Paste path instead` affordance for users who already have the path in hand.
- Works without an Anthropic key — the desktop sidecar starts unconditionally so worktree loading isn't gated on AI config.
