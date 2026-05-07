# Worktree Live Reload

## What it is
Keeps a loaded worktree review in sync with the underlying git tree.

## What it does
- Polls the worktree every 3s for HEAD sha + dirty-tree digest.
- Surfaces a non-modal banner when a new commit lands or uncommitted edits change, with an explicit reload click — never auto-replaces the diff.
- Reloads via the existing changeset endpoint, honoring `dirty=true` for working-tree-only refreshes.
- Per-worktree on/off toggle, persisted by absolute path; default-on for new worktrees.
- After three consecutive poll failures, surfaces "worktree gone" once and stops polling.
- On reload, hands the new diff to the [Anchored Comments](./anchored-comments.md) pass: comments re-attach inline if their content matches, otherwise move to a **Detached** pile in the sidebar — the original snippet stays visible, and committed-origin entries get a "view at `<sha7>`" affordance to fetch the file as it was.

## Out of scope (for now)
- Push-based updates (SSE + `fs.watch`). Tracked as slice (f) in the plan; deferred unless polling proves insufficient.

See `docs/plans/worktree-live-reload.md` for the full design and shipped findings.
