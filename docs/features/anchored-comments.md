# Anchored Comments

## What it is
The mechanism that lets review comments survive a worktree reload — agent commits or uncommitted edits — without losing their meaning.

## What it does
- When you write a comment, captures a 10-line snippet around it (`anchorContext`) plus the FNV-1a hash of the inner 5 lines (`anchorHash`).
- On reload, finds the same window in the new diff and re-attaches the comment there (even if the hunk has shifted).
- When the matching window is gone, moves the comment into a **Detached** group in the sidebar with the original snippet visible.
- Tags each comment with its `originSha` and `originType` (`committed` or `dirty`) so the detached caption can read either "committed at `<sha7>`" or "from uncommitted edits at hh:mm".
- Round-trips through `localStorage` (snapshot v2) — close the tab, come back, your detached pile is still there.

## Boundaries
- Slice (c) of [`docs/plans/worktree-live-reload.md`](../plans/worktree-live-reload.md). The polling banner that fires the reload (slice a) and the "view at `<sha>`" panel (slice e) are separate slices.
- Re-anchoring is per-thread: every reply on a thread moves together. Replies authored before this feature landed have no anchor fields and fall back to in-place hashing.
- Block-comment ranges keep their original span size when re-anchored, clamped to the new hunk.
- `hunkSummary` and `teammate` threads re-attach to the new hunk by hashing the hunk's first line; if the new diff has no summary/teammate review there, the thread stays in state but isn't shown in the inspector.

## Manual reload (debug)
While the polling banner doesn't exist yet, the review topbar shows a **↻ reload** button next to a **dirty** toggle for any worktree-loaded changeset. Reload re-fetches the changeset and runs the anchor pass. The dirty toggle stamps `originType: "dirty"` on subsequent comments so the dirty-origin caption is reachable from this slice alone.
