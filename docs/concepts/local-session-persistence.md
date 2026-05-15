# Local Session Persistence

## What it is
The app’s local snapshot model for restoring review progress.

## What it does
- Serializes review state and drafts into one schema-versioned localStorage record.
- Rehydrates Sets and filters stale ids when fixtures or loaded changesets change.
- Preserves cursor, read marks, sign-offs, dismissed guides, and drafts across reloads. Interactions (comments, replies, acks) live in the server-owned SQLite DB and are fetched per-changeset, not from this snapshot.
- Stays intentionally local instead of pretending to be sync or collaboration.
