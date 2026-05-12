# Plan Diagram

## What it is
The file-graph view in the [review plan](./review-plan.md). Each touched file is a typed node connected by typed edges, so a reviewer can see "two components and a hook" or "a route plus a migration" at a glance instead of staring at unlabelled rectangles.

Today the diagram is at its best on the languages where Shippable's LSP integration ships — JavaScript / TypeScript and PHP. Files in other languages still appear, but the LSP-driven role promotions, shape subtitles, and typed edges are mostly empty for them. This is intentional for v0; see Known limitations below.

## What it does
- Tags each file node with a **role**: `component`, `hook`, `route`, `test`, `entity`, `type-def`, `schema`, `migration`, `config`, `fixture`, `prompt`, `doc`, `style`, or `code` (honest fallback when nothing else fits).
- Subtitles the node with the LSP-derived shape when available — e.g. `1 class · 5 methods`, `12 functions, 2 types`.
- Surfaces classifier disagreement on hover when the path/extension says one thing and the LSP shape says another.
- Distinguishes edge kinds: `imports` (muted, default), `tests` (dashed), `uses-hook` (distinct accent), `uses-type`, `references`.
- Hover reveals the top-level symbol list. Click a symbol to jump to its hunk in the diff, or open the definition peek panel for symbols outside the changeset.
- Tabs for Class / State / Sequence / ER diagrams are visible but disabled — honest placeholders for capture surfaces we don't yet pay for.
- Exports as Mermaid `flowchart LR` for sharing outside the app.

## Known limitations

- **LSP enrichment is JS/TS + PHP only.** Role promotions (hook, type-def, data-class vs behaviour-class) and the richer edge kinds (`tests`, `uses-hook`, `uses-type`, `references`) all need `documentSymbol` results. Other languages get a path-based role and every edge collapses to `imports`. Adding a language slots into the same `LanguageModule` shape used by [click-through definitions](./click-through-definitions.md); see [`docs/plans/plan-symbols.md`](../plans/plan-symbols.md).
- **File-granularity only.** Status (added / modified / deleted) is per file. There is no hunk-to-symbol mapping — adding three methods to one class shows as one modified file, not three changes.
- **No class, state, sequence, or ER diagrams.** The disabled tabs are placeholders for capture surfaces we don't yet pay for; they won't render anything until that work lands.
- **No `renders` edge for JSX.** Imported components stay as `imports`. Reliable JSX-render detection needs AST inspection out of scope for v0; a flaky `renders` would lie more than `imports` does.
- **Dynamic / deferred imports aren't tracked.** `import()` calls and other runtime-resolved imports don't show as edges.
- **Mermaid export is one-way.** The exported flowchart is a serialisation target; round-tripping back into the diagram isn't supported.
- **Memory-only / no-disk deployments fall back to the regex-only path.** No shape subtitles, no typed edges, no hover symbol list — just files and `imports`.
