# Diff Ingestion

## What it is
The path from raw unified diff text into the app’s internal model.

## What it does
- Parses git-style unified diffs into the `ChangeSet` tree.
- Handles file boundaries, status changes, renames, hunks, and line kinds.
- Guesses language from file path so later systems can do syntax highlighting and runner behavior.
- Tries to produce a useful partial parse instead of failing on every malformed input.
