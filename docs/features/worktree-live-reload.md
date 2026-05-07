# Worktree Live Reload

## What it is
Keeps a loaded worktree review in sync with the underlying git tree.

## What it does
- Polls the worktree every 3s for HEAD sha + dirty-tree digest. Polling is the MVP shape on purpose — push-based updates (SSE + `fs.watch`) are tracked as a follow-up slice.
- Surfaces a non-modal banner when a new commit lands or uncommitted edits change, with an explicit reload click — never auto-replaces the diff.
- Reloads via the existing changeset endpoint, honoring `dirty=true` for working-tree-only refreshes.
- On reload, runs the [anchored-comments](./anchored-comments.md) pass: replies that still have a matching window stay inline, replies whose window is gone move into the **Detached** sidebar pile with their original snippet preserved.
- Detached committed entries get a "view at `<sha7>`" affordance that fetches the file as it was when the comment was written, scrolled to the original anchor line.
- Per-worktree on/off toggle, persisted by absolute path; default-on for new worktrees.
- After three consecutive poll failures, surfaces "worktree gone" once and stops polling.

## Out of scope (for now)
- Cursor/scroll preservation beyond what `RELOAD_CHANGESET` already does (same file if it survives, else file 0).
- SSE / push updates (slice f).

See `docs/plans/worktree-live-reload.md` for the full design.
