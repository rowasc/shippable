# Typed file graph diagram

## Status: design — not yet implemented

The current diagram (`web/src/planDiagram.ts` + `web/src/components/PlanDiagramView.tsx`) renders every file as an unlabelled rectangle and edges as comma-separated symbol-name strings. Reviewers can't tell whether a diff is "two components and a hook" or "a route + a migration + the config that drives it" — every change looks the same shape. The underlying `CodeGraph` already comes from `/api/code-graph`'s LSP path (`server/src/codeGraph.ts`) but most of what LSP returns — symbol kinds, counts, which side of an edge a symbol came from — is collapsed away in `bucketEdgesFromLspResults` before it reaches the renderer.

This plan is the smallest change that uses what we already pay for: keep the file-granularity graph, but **type the nodes and edges**, so the diagram conveys the *shape* of the diff at a glance.

## Goal

Make the diagram answer "what shape of work is this diff?" reliably on every diff, not just class-heavy ones. After this lands, the diagram should:

- Show each file with a **role** (`component`, `hook`, `route`, `test`, `entity`, `type-def`, `schema`, `migration`, `config`, `fixture`, `prompt`, `doc`, `style`, `code`) — not just an unlabelled box.
- Show a **shape subtitle** when LSP ran (`1 class · 5 methods`, `12 functions, 2 types`).
- Distinguish edge **kinds**: `imports` (default), `tests`, `uses-hook`, `uses-type`, `references` (LSP-derived but doesn't fit the above).
- Be honest about classifier disagreement — when path/extension says one thing and LSP shape says another, the hover surfaces both.
- Status (added / modified / deleted) stays at file granularity. Hunk-to-symbol mapping is the honest ceiling.

## Non-goals

- **Class diagrams with method/field rows.** Most diffs in this repo aren't class-shaped; we'd be drawing empty boxes most of the time.
- **Hunk-to-symbol mapping.** Status at file granularity is the honest ceiling for this view.
- **State / sequence / ER inference.** We don't have the data and faking it would be misleading.
- **A `renders` edge kind.** Reliable JSX-render detection needs AST work we're not paying for; a flaky `renders` is worse than a generic `imports`. See "Resolved decisions" below.
- **Mermaid as a runtime dependency.** Mermaid stays as the export-only format; the renderer is hand-rolled SVG so we keep theming and click-to-definition integration.

## What changes

### 1. Types

`CodeGraphNode` and `CodeGraphEdge` in `web/src/types.ts` (mirrored in `server/src/codeGraph.ts`):

```ts
type FileRole =
  | "component" | "hook" | "route" | "test"
  | "entity" | "type-def" | "schema" | "migration"
  | "config" | "fixture" | "prompt" | "doc"
  | "style" | "code";

type EdgeKind = "imports" | "tests" | "uses-hook" | "uses-type" | "references";

interface SymbolShape {
  // counts keyed by LSP SymbolKind name we care about
  classes?: number; interfaces?: number; methods?: number;
  properties?: number; functions?: number; variables?: number;
  constants?: number; enums?: number; types?: number;
  modules?: number; namespaces?: number;
}

interface SymbolSummary {
  name: string;
  kind: "Class" | "Interface" | "Method" | "Property" | "Function"
      | "Variable" | "Constant" | "Enum" | "Module" | "Namespace" | "Type";
  line: number;
}

interface CodeGraphNode {
  path: string;
  role?: "changed" | "context";
  isTest: boolean;
  pathRole: FileRole;     // path-floor classifier alone
  fileRole: FileRole;     // final, after LSP shape upgrade (== pathRole when no LSP)
  shape?: SymbolShape;    // present when LSP ran
  symbols?: SymbolSummary[]; // top-level only; for hover
  fanIn?: number;         // post-filtered distinct using-file count
}

interface CodeGraphEdge {
  fromPath: string;
  toPath: string;
  labels: string[];
  kind: EdgeKind;         // retyped — not "import" | "symbol"
}
```

**Edge `kind` is retyped, not parallel-fielded.** Per AGENTS.md ("no backwards-compat shims for internal code"), every call site of the old `"import" | "symbol"` enum updates in the same PR. Today there are ~14 such call sites across `web/src/codeGraph.ts`, `web/src/plan.ts`, `web/src/parseDiff.test.ts`, `web/src/planDiagram.ts`, `web/src/planDiagram.test.ts`, `server/src/codeGraph.ts`, `server/src/codeGraph.test.ts`. Most of them just write `kind: "symbol"` or `kind: "import"` literally; the only consumer that branches on the value is `buildReferencedSymbolMap` in `web/src/codeGraph.ts:146`, which currently treats `"symbol"` as "edge backed by a real symbol reference" and `"import"` as "side-effect-only / require / dynamic / @import." Under the new union, `"imports"` covers what was `"import"`; everything else (`tests`, `uses-hook`, `uses-type`, `references`) covers what was `"symbol"`. Update the predicate to `edge.kind !== "imports"`.

`role: "changed" | "context"` already exists on the node and stays. The renderer uses `fileRole`; the hover surfaces the disagreement when `pathRole !== fileRole`.

### 2. The classifier (`web/src/fileRole.ts`)

Two-tier, pure, shared between server and frontend.

**Path/extension floor (always available):**

| Pattern                                                      | Role        | Why                                                                |
|--------------------------------------------------------------|-------------|--------------------------------------------------------------------|
| `.test.ts(x)?`, `.spec.ts(x)?`, `__tests__/`, `tests/`, `e2e/`, `*Test.php` | `test`      | the dominant signal in this repo and PHP fixture                    |
| `*.tsx` in `components/`                                     | `component` | React component-by-convention                                       |
| `use*.ts(x)?` in `hooks/` or top-level                       | `hook`      | React hook-by-convention                                            |
| `*.types.ts`, `types.ts`                                     | `type-def`  | type-only modules; `types.ts` is repo-wide convention               |
| `routes.ts`, `routes/`, `*Route.php`, `*Controller.php`      | `route`     | request entry points; PHP fixture uses Routes/Controller            |
| `*.css`, `*.scss`, `*.module.css`                            | `style`     | stylesheets — never have meaningful symbol edges                    |
| `*.md`, `*.mdx`                                              | `doc`       | docs (`library/prompts/*.md` upgraded to `prompt` below)            |
| files under `library/prompts/` ending `.md`                  | `prompt`    | shipped product prompts; carry meaning beyond "doc"                 |
| `*.sql`, `migrations/`                                       | `migration` | schema-shape changes; reviewers care about these specifically       |
| `package.json`, `*.lock`, `tsconfig*.json`, `.env*`, `vite.config.*`, `tauri.conf.json`, root-level `*.toml` | `config`    | drives behaviour without being code; misclassifying these as code hides risk |
| `fixtures/`, `__fixtures__/`                                 | `fixture`   | test data — reviewers shouldn't expect code-quality scrutiny here   |
| anything else                                                | `code`      | honest fallback; the LSP upgrade can promote it                     |

`schema` doesn't have a generic path heuristic in this repo — JSON schemas live next to the code that uses them. The path floor leaves them as `code` or `config`; we'd add an LSP-driven rule only if we needed it. Listed in the role union for completeness; not produced today.

**LSP shape upgrade (when `documentSymbol` ran):** runs *after* the path floor and can promote/override:

| Rule                                                                                       | Promotes to | Why                                                              |
|--------------------------------------------------------------------------------------------|-------------|------------------------------------------------------------------|
| Top-level export is a function named `use*`                                                | `hook`      | catches hooks defined outside `hooks/` (e.g. colocated)         |
| ≥80% of top-level symbols are `Interface` / `Type` / `Enum`, ≥2 declarations               | `type-def`  | catches type modules without a `.types.ts` suffix               |
| Single top-level `Class` (PHP) or default-exported `Class` (TS), ≥80% children are `Property`, ≤20% are `Method` | `entity`    | data classes / DTOs vs. behaviour classes                       |
| Default-exported function whose name starts with a capital letter (TSX)                    | `component` | catches `App.tsx` / page-level components outside `components/` |

Each rule lives behind a one-line comment in the classifier explaining *why* the heuristic exists. We don't reach for AST inspection — `documentSymbol` kinds and names are the budget.

**Unmatched files render as `code`.** Don't guess. A `code` node with no fan-in and no fan-out is a generic file node, honest about what we don't know.

**Both outputs preserved on the node:** `pathRole` (floor only) and `fileRole` (final). Renderer uses `fileRole`; hover surfaces disagreement.

### 3. Edge kinds

Default is `imports`. LSP enrichment refines, in priority order:

1. **`tests`** — importing-side path is a test (`*.test.*`, `*.spec.*`, `*Test.php`, etc.) AND defining-side symbol kind is `Class` or `Function` AND the test name corresponds to the defining file (e.g. `Foo.test.ts` ↔ `Foo.ts`, `CartTest.php` ↔ `Cart.php`).
2. **`uses-hook`** — defining-side symbol matches the hook heuristic (function, name `use*`).
3. **`uses-type`** — defining-side symbol kind is `Interface`, `Type`, or `Enum`.
4. **`references`** — LSP `references`-derived but doesn't fit 1–3 (e.g. method/property reference, class reference).
5. **`imports`** — no defining-side LSP info (regex fallback path) or no LSP at all.

There is no `renders` edge — see Resolved decisions #4.

A single `(fromPath, toPath)` pair can have multiple bucketed labels but collapses to **one edge with one `kind`**, picking the most-specific kind across all symbols on that edge (priority order above). The `labels` array still carries the symbol names so the existing edge label rendering keeps working.

### 4. Server enrichment (`/api/code-graph`)

Plumb existing `documentSymbol` + `references` results through. Concretely, in `server/src/codeGraph.ts`:

- `flattenTopLevel` already returns `{ name, line, col }`. Extend to carry `kind` (the LSP integer; map to our `SymbolSummary["kind"]` string at the boundary). Tally per-file counts into `SymbolShape` while we walk the same data.
- `bucketEdgesFromLspResults` already iterates `(definingFile, symbol, ref)`. It currently writes `kind: "symbol"` unconditionally. With the symbol kind in hand it can pick `tests` / `uses-hook` / `uses-type` / `references` per the priority ladder. The defining-side path + symbol kind + symbol name are everything the ladder needs.
- `mergeGraphs` populates `pathRole`, `fileRole`, `shape`, `symbols`, `fanIn` on each node. `fanIn` is computed from the post-filtered, post-cap edge set (the same one used for context-node selection) — counting *distinct using files* per defining file. **The number must correspond to what the rendered diagram shows**, not the raw LSP location count (Resolved decisions #2). Regex-only nodes have no `shape`, no `symbols`, and `fileRole === pathRole`.

**No new LSP RPCs in the default path.** All of the above is plumbing the existing two RPCs through.

**Optional: `prepareTypeHierarchy` + `supertypes` for added classes only.** A typical diff has 0–1 added classes. When one is present and the LSP advertises `typeHierarchyProvider`, fetch supertypes once and stash `extends Foo, implements Bar` into the node's hover. This is polish, not load-bearing — skip if it adds friction.

The capability gating + regex fallback path is unchanged: when no LSP runs, `shape` / `symbols` / `fanIn` are absent, `fileRole === pathRole`, every edge is `imports`.

### 5. Renderer (`PlanDiagramView`)

Replace the existing SVG renderer. Visual vocabulary per `fileRole`: a small icon (or symbolic glyph) plus an accent colour drawn from existing theme tokens (`docs/concepts/theme-token-system.md` — accent / blue / magenta / green / yellow / fg-mute already cover the palette). 14 roles is more than 5 tones, so multiple roles share a tone and lean on the icon for differentiation; the goal is "this row of the diagram is mostly tests and one route" being readable, not 14 unique colours.

Node body, top to bottom:
- Basename (existing).
- Directory subtitle (existing).
- Role tag (`component` / `hook` / etc.) — small chip.
- Shape subtitle when `shape` is present (`1 class · 5 methods` / `12 functions, 2 types`).
- Status glyph (existing).

Hover (`<title>` + on-hover popover):
- Full path.
- `symbols` list (top-level, name + kind + line). Each item is a click target.
- When `pathRole !== fileRole`: *"classified as **{fileRole}** by LSP shape (path looked like **{pathRole}**)"*.
- Fan-in count when present.

Click on a symbol in the hover:
- If the symbol's file is in the diff, jump to the relevant hunk (existing peek panel infrastructure).
- Otherwise hit the existing `/api/definition` peek panel.

Edges:
- `tests` — dashed.
- `uses-hook` — distinct accent (e.g. magenta).
- `uses-type` — neutral accent.
- `references` — default accent.
- `imports` — muted/grey.
- Lane routing (`positionEdges`) and directory grouping (`groupNodesByDir`) carry over unchanged.

Status (`role: "context"` dimming, added/modified status colour) carries over. Markdown toggle (`includeMarkdown`) carries over.

### 6. Diagram-type tabs

A small tab strip above the diagram. Static — there is no plug-in renderer abstraction. The disabled tabs are honest placeholders, not future plumbing.

| Tab        | State    | Tooltip                                  |
|------------|----------|------------------------------------------|
| Map        | enabled  | (the typed file graph; default)          |
| Class      | disabled | "needs symbol-level capture"             |
| State      | disabled | "needs control-flow extraction"          |
| Sequence   | disabled | "needs call-trace data"                  |
| ER         | disabled | "needs schema parsing"                   |

Disabled tabs *look* disabled (greyed, `aria-disabled`, no hover-press feedback).

### 7. Mermaid export

`buildMermaid()` today emits `uml LR` which mermaid won't parse — silently broken. Rewrite to emit a valid `flowchart LR`:

- One `classDef` per `fileRole`, with comment-anchored class assignments (`class f3 component;`).
- Edge labels carry the existing comma-separated `labels`. Edge kinds influence the arrow style (`-->` vs `-.->` for tests, `==>` for `uses-hook`) where mermaid syntax allows.
- Round-trip through mermaid.live before we declare it done.

Mermaid stays an export format only — no runtime dep, the renderer is the hand-rolled SVG above.

## Resolved decisions

1. **Edge `kind` is retyped, not parallel-fielded.** AGENTS.md → "no backwards-compat shims for internal code." Update every call site in the same PR. Old union: `"import" | "symbol"`. New union: `"imports" | "tests" | "uses-hook" | "uses-type" | "references"`.
2. **`fanIn` is post-filtered.** Apply the same `vendor/` / `node_modules/` / `dist/` / `build/` / `.git/` + outside-workspace filter we already apply for edges (`isNoisePath` + `repoRelativeIfInWorkspace` in `server/src/codeGraph.ts`), then count *distinct using files*. The number must correspond to what the rendered diagram shows; raw LSP location counts are misleading because they include filtered noise.
3. **Carry both `pathRole` and `fileRole`.** `pathRole` is the floor; `fileRole` is final. Equal when no LSP ran. The renderer uses `fileRole`; hover surfaces disagreement. Never silently override — that's the "be clear when it happens" property.
4. **No `renders` edge.** Imported components stay `imports`. Reliable JSX-render detection needs AST inspection we don't fund (e.g. distinguishing `import Foo from './Foo'; …<Foo />` from `import Foo from './Foo'; const x = Foo.metadata`). A flaky `renders` edge is worse than a generic `imports` — it lies. Document this boundary so a future contributor doesn't relitigate it.

## Migration story

- **Single PR.** No feature flag. The file-level renderer and the typed-file-graph renderer can't reasonably coexist because they share the same `CodeGraph` shape and the type changes ripple through every call site.
- **No data migration.** `CodeGraph` isn't persisted across sessions today; `parseDiff` rebuilds it on changeset load and `worktreeChangeset` overrides it from the server response. No `ReviewState` versioning bump needed.
- **Old renderer deleted in the same PR.** `PlanDiagramView.tsx`'s file-box rendering is replaced; the surrounding `ReviewPlanView` integration (markdown toggle, no-graph empty state) carries over.

## Test plan

- **Classifier unit tests** (`web/src/fileRole.test.ts`): one case per path-floor rule, one per LSP-shape upgrade rule, one for unmatched-falls-to-`code`, one or two for `pathRole !== fileRole` upgrade cases (e.g. `App.tsx` outside `components/` getting promoted to `component`; `Foo.ts` with all-interface symbols getting promoted to `type-def`).
- **Server response** (`server/src/codeGraph.test.ts`): extend the existing stub-LSP fixture to return mixed symbol kinds for one PHP file; assert `shape`, `symbols`, `fanIn`, `pathRole`, `fileRole` come back populated and the edge `kind` reflects the priority ladder. Stub returns `Class` symbol → expect `tests` edge from `*Test.php`, `references` edge from `Routes.php`. Stub returns no LSP → expect `kind: "imports"` and absent `shape` / `symbols`.
- **Renderer DOM/snapshot test** (`web/src/components/PlanDiagramView.test.tsx`): one representative graph (mixed roles + mixed edge kinds + one `pathRole !== fileRole` node + one `role: "context"` node) rendered into a JSDOM SVG; assert role chips, shape subtitles, and the disagreement tooltip render.
- **Manual browser smoke** (per AGENTS.md "Quality checks"): open the live app against `test-fixtures/php-multifile/` (PHP fixture with `Cart`/`Order`/`Routes`/`*Test`) and against this repo (TS-heavy). Confirm the diagram makes both diffs more legible end-to-end. Build passing ≠ feature works.
- **Mermaid round-trip**: paste the exported source into mermaid.live and confirm it renders. The current export emits invalid `uml LR` that mermaid silently rejects; we'd otherwise not notice.

## Pointers

- `docs/plans/lsp-code-graph.md` — what `/api/code-graph` already does. Read "What landed."
- `docs/plans/plan-symbols.md` — LSP/symbol-nav design we reuse.
- `docs/concepts/symbol-graph-and-entry-points.md` — the prior conceptual frame.
- `docs/concepts/theme-token-system.md` — the palette to draw from.
- `web/src/planDiagram.ts`, `web/src/components/PlanDiagramView.tsx` — what gets replaced.
- `server/src/codeGraph.ts` — where the enrichment lives.
- `server/src/lspClient.ts` — LSP RPC surface (we call only what's there today).
- `server/src/languages/{php,typescript}.ts` — per-language modules.
- `test-fixtures/php-multifile/` — PHP smoke fixture.
