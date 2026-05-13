# Review State

## What it is
The local state model for an in-progress review session.

## What it does
- Tracks the current cursor position inside the diff tree.
- Separates read progress from explicit sign-off.
- Tracks dismissed guide suggestions, expand levels, and block selection.
- Stores every per-author signal — user replies, AI notes, teammate verdicts, agent responses, acks — as `Interaction`s in `state.interactions: Record<threadKey, Interaction[]>`. See `docs/architecture.md § Review interactions`.
- Keeps the current session shaped around one reviewer, one machine, and local persistence.
