# Review State

## What it is
The local state model for an in-progress review session.

## What it does
- Tracks the current cursor position inside the diff tree.
- Separates read progress from explicit sign-off.
- Tracks dismissed guide suggestions, acked AI notes, replies, expand levels, and block selection.
- Keeps the current session shaped around one reviewer, one machine, and local persistence.
