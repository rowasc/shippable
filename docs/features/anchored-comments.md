# Anchored Comments

## What it is
The mechanism that lets review comments survive a worktree reload — agent commits or uncommitted edits — without losing their meaning.

This is slice (c) of [`docs/plans/worktree-live-reload.md`](../plans/worktree-live-reload.md). Reloads are triggered by the [live-reload poll](./worktree-live-reload.md), and detached committed entries get a "view at `<sha>`" panel from slice (e).

## What it does
- When you write a comment, captures a 10-line snippet around it (`anchorContext`) plus a short content hash of the inner 5 lines (`anchorHash`). The hash is FNV-1a-32 — a small, fast, non-cryptographic digest that's stable across runs; we just need a deterministic fingerprint of short text, not collision resistance.
- On reload, finds the same window in the new diff and re-attaches the comment there (even if the hunk has shifted).
- When the matching window is gone, moves the comment into a **Detached** group in the sidebar with the original snippet visible.
- Tags each comment with its `originSha` and `originType` (`committed` or `dirty`) so the detached caption can read either "committed at `<sha7>`" or "from uncommitted edits at hh:mm".
- For detached committed entries, a **view at `<sha7>`** button opens an inline panel that fetches the file at that historical sha and scrolls to the original anchor line. Dirty-origin entries don't get this affordance — there's no commit to fetch back.
- Round-trips through `localStorage` (snapshot v2) — close the tab, come back, your detached pile is still there.

## Boundaries
- Re-anchoring is per-thread: every reply on a thread moves together. Replies authored before this feature landed have no anchor fields and fall back to in-place hashing.
- Block-comment ranges keep their original span size when re-anchored, clamped to the new hunk.
- `hunkSummary` and `teammate` threads re-attach to the new hunk by hashing the hunk's first line; if the new diff has no summary/teammate review there, the thread stays in state but isn't shown in the inspector.

## Known leftovers
The slice-(c) debug **↻ reload** button and **dirty** toggle are still in the review topbar, marked with `TODO(slice-a): remove` in `ReviewWorkspace.tsx`. They predated the polling banner and were meant to be removed once slice (a) shipped; they're still useful during development but should come out before the feature feels final. Tracked in the plan's Findings section.
