# Commit Range Picker

## What it is
Narrows a worktree's loaded diff to a specific commit, a range of commits, or "everything from a SHA up to HEAD plus my uncommitted edits." Default behaviour is unchanged — clicking a worktree still loads the whole branch.

## What it does
- Opens from both the [load changeset](./load-changeset.md) modal (`pick range…` on each worktree row) and the topbar (`⇄ range` once a worktree changeset is loaded).
- Lists the last N commits in the worktree. Click a row to set `from`, shift-click to set `to`.
- Per-row `just this` shortcut loads exactly that commit as the changeset.
- `Include uncommitted changes` toggle is enabled only when `to = HEAD` and disabled with a tooltip otherwise.
- Topbar picker prefills from the currently loaded range, so re-slicing doesn't require reopening the load modal.
- The selected range is stamped on the changeset's worktree source, so reload and persistence work the same way as the whole-branch case.
