# Anchored Comments

## What it is
The mechanism that lets review comments survive a worktree reload — agent commits or uncommitted edits — without losing their meaning.

This is slice (c) of [`docs/plans/worktree-live-reload.md`](../plans/worktree-live-reload.md). The trigger is whatever causes a worktree reload (today: the live-reload bar after polling detects drift); the anchor pass runs on every reload regardless of who fired it.

## What it does
- When you write a comment, captures a 10-line snippet around it (`anchorContext`) plus a short content hash of the inner 5 lines (`anchorHash`). The hash is FNV-1a-32 — a small, fast, non-cryptographic digest that's stable across runs; we just need a deterministic fingerprint of short text, not collision resistance.
- On reload, finds the same window in the new diff and re-attaches the comment there (even if the hunk has shifted).
- When the matching window is gone, moves the comment into a **Detached** group in the sidebar with the original snippet visible.
- Tags each comment with its `originSha` and `originType` (`committed` or `dirty`) so the detached caption can read either "committed at `<sha7>`" or "from uncommitted edits at hh:mm".
- Round-trips through `localStorage` (snapshot v2) — close the tab, come back, your detached pile is still there.

## Boundaries
- Re-anchoring is per-thread: every reply on a thread moves together. Replies authored before this feature landed have no anchor fields and fall back to in-place hashing.
- Block-comment ranges keep their original span size when re-anchored, clamped to the new hunk.
- `hunkSummary` and `teammate` threads re-attach to the new hunk by hashing the hunk's first line; if the new diff has no summary/teammate review there, the thread stays in state but isn't shown in the inspector.

