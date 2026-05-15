# Changeset Hierarchy

## What it is
The core domain model for everything the app reviews.

## What it does
- Models a reviewable unit as `ChangeSet -> DiffFile -> Hunk -> DiffLine`.
- Carries the raw diff structure and stable provenance ids; review metadata now lives alongside it in `ReviewState.interactions` and related view projections rather than inline on `DiffLine` / `Hunk`.
- Gives every file and hunk a stable id so state, comments, and navigation can point at them.
- Lets higher-level systems reason about files, symbols, line numbers, and snippets without parsing raw diff text repeatedly.
- May carry both `worktreeSource` and `prSource` simultaneously when the worktree↔PR overlay is active — the diff came from the worktree, the PR metadata and line-anchored review comments came from GitHub.
