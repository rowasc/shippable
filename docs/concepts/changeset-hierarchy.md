# Changeset Hierarchy

## What it is
The core domain model for everything the app reviews.

## What it does
- Models a reviewable unit as `ChangeSet -> DiffFile -> Hunk -> DiffLine`.
- Carries both raw diff structure and review metadata in the same tree.
- Gives every file and hunk a stable id so state, comments, and navigation can point at them.
- Lets higher-level systems reason about files, symbols, line numbers, and snippets without parsing raw diff text repeatedly.
