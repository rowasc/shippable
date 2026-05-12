# Plan Diagram

## What it is
The file-graph view in the [review plan](./review-plan.md). Each touched file is a typed node connected by typed edges, so a reviewer can see "two components and a hook" or "a route plus a migration" at a glance instead of staring at unlabelled rectangles.

## What it does
- Tags each file node with a **role**: `component`, `hook`, `route`, `test`, `entity`, `type-def`, `schema`, `migration`, `config`, `fixture`, `prompt`, `doc`, `style`, or `code` (honest fallback when nothing else fits).
- Subtitles the node with the LSP-derived shape when available — e.g. `1 class · 5 methods`, `12 functions, 2 types`.
- Surfaces classifier disagreement on hover when the path/extension says one thing and the LSP shape says another.
- Distinguishes edge kinds: `imports` (muted, default), `tests` (dashed), `uses-hook` (distinct accent), `uses-type`, `references`.
- Hover reveals the top-level symbol list. Click a symbol to jump to its hunk in the diff, or open the definition peek panel for symbols outside the changeset.
- Tabs for Class / State / Sequence / ER diagrams are visible but disabled — honest placeholders for capture surfaces we don't yet pay for.
- Exports as Mermaid `flowchart LR` for sharing outside the app.
