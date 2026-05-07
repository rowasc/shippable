# LSP-backed code graph

## Status: proposed

The diagram and review-plan starting points are driven by `web/src/codeGraph.ts`, which finds edges by regex-scanning `import` / `require` / `@import`. That misses every non-JS language with cross-file references. Concretely: PHP files in a worktree render as floating islands in the diagram even when `Routes.php` instantiates half a dozen sibling classes, because PHP's `use Bodega\Foo` + `new Foo()` doesn't look like an ES import.

We already run language servers per (workspace, language) for click-through definition lookup (`server/src/definitions.ts` + `server/src/languages/`). This plan reuses that plumbing to build edges with a real resolver instead of regex.

## Why this and not a PHP regex resolver

A PHP regex resolver would be ~150 lines that gets `use … as Bar` wrong, doesn't follow PSR-4 autoload, and stops at one language. The LSP path:

- handles aliases, traits, inheritance, FQN vs short-name resolution, and composer-aware paths because the LSP already does
- generalizes — Python/Go/Rust become "add a `LanguageModule` to `server/src/languages/`," not "write another regex resolver"
- slots into the existing capability-flag pattern (`requiresWorktree`, `getDefinitionCapabilities`), so memory-only and no-clone deployments fall through the same way they already do for definitions

The cost is real: the graph builder moves from pure-frontend regex to a server endpoint, edges become async, and first-call latency is bounded by the LSP's workspace index (intelephense indexes on initialize).

## Scope

In scope:

- new server endpoint that takes a list of files and returns a `CodeGraph` whose edges come from LSP queries when available
- per-language capability gating: if the LSP for a file's language isn't available, fall through to the existing regex builder for that file
- caching keyed on (workspaceRoot, ref, language) so repeat opens of the same diff don't repeat the round-trip storm
- PHP as the first non-TS consumer (intelephense already wired)

Out of scope:

- a browser-hosted PHP analyzer for memory-only deployments — covered by `plan-symbols.md` ("Memory-only PHP analysis (deferred path)")
- whole-repo cold builds beyond the existing `MAX_REPO_GRAPH_FILES` cap
- call-hierarchy / type-hierarchy edges; this is "who imports / references what," not "who calls what"
- rewriting the diagram renderer; output shape stays `CodeGraph`

## How edges are derived from LSP

For each file in the input set, when its language has an available LSP:

1. `textDocument/documentSymbol` → enumerate top-level symbols defined in the file (classes, functions, interfaces, traits, constants).
2. For each symbol, `textDocument/references` with `includeDeclaration: false` → list of locations across the workspace.
3. Bucket reference locations by file. Each bucket → one edge `defining_file → using_file`, label = the symbol name. Multiple symbols from the same defining file collapse to one edge with multiple labels (matches today's `selectEdgeLabels` shape).
4. Filter the resulting edges to the file set the caller asked about. If the caller asked about a changeset, references outside the changeset are dropped (same behaviour as `buildDiffCodeGraph` today).

The `kind` on each edge is `"symbol"` when we have at least one named reference, `"import"` otherwise — same convention as the regex builder.

When LSP is *not* available for a given file's language, that file is handed to the existing regex resolver. Edge sets are merged before being returned.

## Server endpoint

New endpoint, sibling to `/api/definition/*`:

```
POST /api/code-graph
{
  workspaceRoot: string,           // absolute path, validated as a known worktree
  ref: string,                     // git ref the caller wants the graph at
  scope: "diff" | "repo",
  files: { path: string; text?: string }[]
}
→ { graph: CodeGraph, sources: Array<{ language: string; resolver: "lsp" | "regex" }> }
```

`text` is optional. When present, the endpoint uses it as the file content (matches the diff path, where the post-state isn't on disk yet). When absent, content is read at `ref` via `git show` (matches `repoGraphFor`'s current behaviour).

`sources` is metadata only — it tells the client which resolver produced each language's edges so the diagram legend can label PHP edges as "LSP-resolved" when it matters. Not load-bearing for graph rendering.

Existing `repoGraphFor` in `server/src/worktrees.ts:709` is reimplemented in terms of this endpoint's internals (extract the analyzable-file walk into a shared helper; keep `repoGraphFor` as a convenience wrapper).

## Client wiring

Two call sites today:

- `web/src/parseDiff.ts:60` — runs `buildDiffCodeGraph` synchronously on parse. Becomes async: when a worktree is attached, POST the diff's files to `/api/code-graph`; otherwise stay on the regex path. The diff parser returning a promise touches `ReviewState` boot — handle behind the same `ServerHealthGate` we already block on.
- `server/src/worktrees.ts:725` — already server-side, swaps the direct `buildRepoCodeGraph` call for the new endpoint's internal helper.

`web/src/components/Demo.tsx` keeps calling `buildRepoCodeGraph` directly; the demo runs without a server and should stay regex-only. Document this explicitly in the demo's stub note.

## Capability gating

`getDefinitionCapabilities()` already reports per-language availability. The code-graph endpoint reads the same capability table:

- LSP for `php` available → use LSP for `.php` / `.phtml` files
- LSP for `php` unavailable → log once, fall through to regex for those files

The diagram doesn't need a new "graph capabilities" endpoint; it can read the existing definition capabilities and surface "PHP edges resolved via intelephense" in the legend if we want that polish later. Out of scope for the first cut.

## Caching

**Per-process LRU** keyed on `(workspaceRoot, ref, language, file content hash)` → resolved `documentSymbol[]` and `references[]` per file. Bounded by entry count, not bytes; LSP responses are small.

Invalidation: any worktree-mutating event (`worktree/refresh`, file watcher tick) clears the LRU entries for that workspace.

### Why per-file, not response-level

The obvious alternative is memoizing the whole endpoint response keyed on the request body. We don't, because per-file is strictly better on every axis:

- **Hit rate.** Diffs and repo-scope queries overlap heavily in files. A diff that touches 3 files reuses cached LSP results for the 30 unchanged context files. A response-level cache misses any time the file set differs by one entry.
- **Invalidation granularity.** Live-reload changes one file. Per-file cache evicts one entry. A response cache has to evict every response whose `files[]` contained the changed path — same correctness, more bookkeeping.
- **Resolver mixing.** The endpoint merges LSP results for some languages with regex output for others (capability gating, §"Capability gating"). Caching the merged graph couples those resolvers; the regex path can't be tuned independently without flushing LSP entries that didn't actually change.

Note that "HTTP-layer cache" in this deployment can only mean server-side response memoization — POST responses aren't cached by browsers, and there's no CDN between the web app and the local sidecar.

## First-call latency

Intelephense indexes the workspace on `initialize` before answering `references`. We don't have measurements yet — anecdotally sub-second on small PHP repos and on the order of 5–15s on larger ones; treat those numbers as estimates until we instrument it.

Two mitigations, neither of which actually *saves* time:

- **Move the wait to a moment the user expects.** Warm the LSP on worktree mount, not on first diagram render. The total work is identical; the user's perception isn't — "worktree opening…" is tolerated, "diagram is hanging" is not. The worktree picker already has a "ready" state — extend it to await `initialize` for any language whose extensions appear in the worktree.
- **Time-budget the first `references` round trip per language** (e.g. 8s). On timeout, fall through to regex for that language and surface a one-time toast: "PHP edges using fallback resolver — LSP still indexing." The cached LSP result populates on the next render.

### Throughput on larger file sets

For an N-file changeset, the cost after the index is warm is roughly `N` `documentSymbol` calls plus `N × M` `references` calls, where M is the average number of top-level symbols per file. At ~30ms warm RTT and an average of 5 symbols/file, 100 files comes out to ~15s **serially**. Levers:

- **Pipeline requests.** LSPs handle concurrent in-flight requests (intelephense does; phpactor's behaviour is less consistent). 8-way concurrency drops the same workload to roughly 2s wall-clock. The per-language LSP client needs to multiplex; today's `definitions.ts` flow is one-at-a-time and that has to change for graph use.
- **`workspace/symbol` as a possible bulk replacement** for per-file `documentSymbol` — noted under "Risks / open questions"; server support is uneven so it's not the default path.
- **No per-symbol `references` bulk RPC** exists in the protocol; this is the dominant cost and parallelism is the main lever. Anything cleverer (e.g. "tell me every reference in this file set") would require a custom server-side adapter, out of scope here.

We need real measurements before committing to numbers; the budget above is the working hypothesis, not a target.

## Test plan

Two explicit suites. Both are required to ship; neither silently skips.

### Unit / integration suite (`npm run test`)

Runs against a **stub LSP server** — a small fixture process that speaks the JSON-RPC framing on stdio and answers a fixed set of methods (`initialize`, `initialized`, `textDocument/didOpen`, `textDocument/documentSymbol`, `textDocument/references`, `shutdown`) with canned responses. This is consistent with the project's testing principles: we are not mocking our own modules, we are providing a controlled fixture for an external service so the test pays for itself and runs deterministically in CI.

The stub is a real subprocess with real stdio framing — that catches the wire-level failure modes (request/response correlation, didOpen ordering, initialize handshake). What it doesn't model is whatever a particular real LSP build happens to do with a given fixture; that's covered by the e2e suite.

The stub fixture is shared with `lsp-php.md` (which has been revised to use the same approach) and lives next to the tests; if we add gopls or pyright as graph contributors later, the same stub mechanism extends.

1. **Edge bucketing.** Stub returns documentSymbol for `Routes.php` and `references` results pointing at three other files. Assert the endpoint produces three `defining_file → using_file` edges with the right symbol labels.
2. **Resolver mixing.** Stub answers PHP requests; TS files run through the existing TS path. Mixed-language fixture asserts the union has no double-counted edges.
3. **Capability fallback.** Stub reports the language as unavailable on `initialize`; endpoint returns the regex-only graph and `sources` reports `resolver: "regex"` for PHP.
4. **Cache hit.** Second call with identical inputs hits the LRU and skips the stub round trip (assert via the stub's built-in request counter).
5. **Live-reload invalidation.** File watcher event drops the cache entry; next call re-queries the stub.
6. **Concurrency.** Stub introduces a 50ms response delay and asserts that an N-file request finishes well below `N × 50ms` — guards the parallelism guarantee from "Throughput on larger file sets".

### End-to-end suite (`npm run test:e2e`)

Runs against the **real LSP binaries** — same `test:e2e` entry point as `lsp-php.md`. This is the suite that catches "intelephense changed its response shape" or "phpactor's `references` returns the empty set for trait method calls now."

**Never silently skipped.** Shares the e2e suite's `beforeAll` PATH probe with `lsp-php.md`; if no PHP LSP is available, the whole suite fails with an explicit install instruction. There is no `it.skip` path.

E1. **Code-graph smoke against real LSP.** One fixture worktree with two PHP files where one references symbols defined in the other; assert the response is non-empty and the edge count is in the expected ballpark. Intentionally does not assert exact edges — intelephense / phpactor behaviour drifts between versions.
E2. **Resolver consistency.** Same fixture, run once per available server. If both intelephense and phpactor are present, assert both return the expected high-level shape (right defining-file → using-file pairs); they don't have to agree on labels. Surfaces drift in either resolver.

The existing `web/src/codeGraph.test.ts` regex tests stay; they cover the fallback path and run in the unit suite.

## Risks / open questions

- **Phpactor `references` fidelity** is weaker than intelephense's. Document expected behaviour difference; don't claim parity. If phpactor returns nothing for a symbol intelephense would resolve, the edge is silently missing — same failure mode as the current regex resolver, just for different inputs.
- **`workspace/symbol` vs per-file `documentSymbol`**: workspace-wide enumeration would cut round trips, but not all servers implement it consistently and the result needs filtering anyway. Per-file is the boring choice.
- **Open-document churn**: `references` requires `didOpen` for the file holding the symbol. Today's definition flow opens one file per request and never closes; for a graph build over N files we'd open N files. Add a `didClose` after the last reference query for a file to keep server memory bounded.
- **`includeDeclaration: false`** hides the trivial self-reference but some servers ignore the flag. Filter client-side too.
- **Memory-only deployments still get nothing for PHP.** Capability flag already says so. Don't regress: if the worktree isn't on disk, the endpoint refuses LSP for any language (the LSPs need `rootUri` pointing at a real path) and the regex path runs. Same constraint as `requiresWorktree` on definitions.
- **Composer / `vendor/`**: by default intelephense indexes `vendor/`, which inflates `references` results with library hits. Filter out targets whose path is outside the input file set before bucketing — the diagram only shows nodes the caller asked about anyway, so out-of-set references collapse to nothing.

## Relationship to other plans

- Follows on from [`lsp-php.md`](lsp-php.md) — same LanguageModule plumbing, second consumer.
- Implements the "supplemented by a repo-scoped graph from the on-disk checkout" line in [`docs/concepts/symbol-graph-and-entry-points.md`](../concepts/symbol-graph-and-entry-points.md) for non-JS languages.
- Does not block, and is not blocked by, [`plan-symbols.md`](plan-symbols.md) Step 5 (browser resolvers); they're parallel paths for the memory-only mode.
- Unblocks adding gopls / pyright / rust-analyzer as graph contributors via the same LanguageModule shape.
