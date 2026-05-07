# Worktree Live Reload

## What it is
Keeps a loaded worktree review in sync with the underlying git tree.

## What it does
- Polls the worktree every 3s for HEAD sha + dirty-tree digest. Polling is the MVP shape on purpose — push-based updates (SSE + `fs.watch`) are tracked as a follow-up slice.
- Surfaces a non-modal banner when a new commit lands or uncommitted edits change, with an explicit reload click — never auto-replaces the diff.
- Reloads via the existing changeset endpoint, honoring `dirty=true` for working-tree-only refreshes.
- Per-worktree on/off toggle, persisted by absolute path; default-on for new worktrees.
- After three consecutive poll failures, surfaces "worktree gone" once and stops polling.

## Out of scope (for now)
- Comment anchoring across reloads — comments displace until slice (c) lands.
- Cursor/scroll preservation beyond the existing LOAD_CHANGESET defaults.
- "View at sha" for outdated comments (slice e).
- SSE / push updates (slice f).

See `docs/plans/worktree-live-reload.md` for the full design.
