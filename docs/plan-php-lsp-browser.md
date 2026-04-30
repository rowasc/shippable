# Browser-hosted PHP definition resolver — design plan

This is the PHP side of the "Browser-hosted resolver availability" row in [plan-symbols.md](./plan-symbols.md). It plugs into the same `Dispatcher` and satisfies the same `DefinitionResolver` and `Workspace` contracts. Read that doc first; this one only covers what's PHP-specific.

## Goal

Resolve PHP definitions in the browser, without a server roundtrip, by running PHP-native analysis code inside the `@php-wasm/web` runtime that's already in the bundle (`web/src/runner/php-worker.ts:91`). The user clicks an identifier in a `.php` token, we hand it to a browser resolver, and we return a `Definition` with `precision: "exact"` for resolvable cases and fall back through the chain otherwise.

This sits in the Tier-1 row of the coverage table — same precision target as a server-side LSP — but reached without leaving the page.

## Non-goals (for v1)

- Full LSP feature set. Definition only. No diagnostics, completions, hover, references, rename.
- A long-lived LSP daemon over JSON-RPC. The PHP-wasm `run` model is request/response (see "The persistent-process problem" below).
- Variable-level / chain-expression resolution. We start with name-resolvable symbols (functions, classes, methods, constants, namespaces with `use` resolution); typed `$obj->method()` resolution is a stretch goal.
- Composer-aware vendor traversal. We index the workspace's own PHP files. `vendor/` is opt-in if it's part of the workspace; we don't recursively pull from Packagist.

## Why bother doing this in the browser at all

The plan-symbols dispatcher walks browser → server. Putting PHP in the browser:

- **Removes a round trip** from every PHP click — same property the TS browser resolver gets via `@typescript/vfs`.
- **Reuses sunk cost.** The `@php-wasm/web-8-3` runtime is already in the bundle for the code-runner feature. Cold start (~21MB WASM fetch + instantiate) is paid once per tab, then amortized.
- **Survives the no-server case.** The GitHub-PR review path (plan-symbols.md step 6) reads files via the GitHub API directly from the browser; a browser-hosted resolver means PHP works there with no server-side PHP toolchain at all.
- **Matches the security model of the existing worker** — the same-origin lockdown in `php-worker.ts:12` already constrains what the runtime can reach, and that constraint also fits a definition resolver.

## Workspace contexts and read budgets

A reviewer is going to point this resolver at code in three very different settings, and the *cost of reading a file* — not the analyzer — is what dictates strategy in each one. The resolver needs to behave well in all three; "behave well" looks different in each row.

| Context | Where files live | Read cost | Enumeration cost | Strategy |
|---|---|---|---|---|
| **Local + our server** | Disk under `SHIPPABLE_WORKSPACE_ROOT`, served by the app's own backend | Cheap | Cheap | Eager workspace-wide indexing on first PHP click. Full PSR-4 / cross-file. |
| **Hosted + our server** | Code on a remote host the app's server can reach (filesystem, S3, internal monorepo proxy) | Moderate | Moderate | Same as local from the resolver's POV; treat the server as the read budget. The server itself can cache aggressively keyed by `(repo, sha, path)`. |
| **GitHub direct** | GitHub API, called from the browser, no server in the loop | Expensive (network + rate limit) | Expensive (one tree call gets everything but counts) | Diff-first; lazy-expand only as the analyzer asks; never index `vendor/`; degrade to GitHub Code Search for the name-floor when we can't fetch. |

The contract guarantee, from weakest to strongest, is:

1. **In-diff resolution always works.** Whatever context we're in, the diff files are already on the page (they're what the user is reviewing). The resolver indexes those for free and answers in-diff clicks without needing any extra reads. This is the floor; if the workspace gives us nothing else, we still get this.
2. **Cross-file resolution within the workspace works in the local + hosted cases.** Cheap reads + eager indexing = exact, full coverage.
3. **Cross-file resolution in GitHub direct works on a best-effort basis.** Lazy-expand from `use` statements; honor the rate limit; fall back to "name-only" floors when expansion is denied or budget is exhausted. The UI sees `precision: "fuzzy"` and the existing multi-result disambiguator handles it.

This split is load-bearing for the architecture: the resolver doesn't *know* which context it's in, but the `Workspace` it's handed declares its read posture, and the analyzer's indexing strategy switches based on that declaration.

### `Workspace` extension for read posture

Extend the `Workspace` contract from plan-symbols.md with a single field:

```ts
interface Workspace {
  // ... existing fields ...
  readPosture: {
    kind: "unbounded" | "rate-limited";
    // For rate-limited workspaces, optional hooks the resolver can use:
    listFiles?(glob: string): Promise<string[]>;     // cheap if available (e.g. one-shot tree call)
    searchByName?(name: string): Promise<Hit[]>;     // e.g. GitHub Code Search; the name-floor
    remainingBudget?(): { reads: number };            // soft signal to the resolver
  };
}
```

`BrowserLocalWorkspace` (server-fronted) sets `kind: "unbounded"`. `BrowserGitHubWorkspace` sets `kind: "rate-limited"` and implements the optional hooks against the GitHub Trees API and Code Search API.

The PHP resolver's behavior diverges at exactly one place — the indexing entrypoint:

```
unbounded   → enumerate *.php, parse all, build full symbol index, resolve.
rate-limited → parse diff files only; on cross-file miss, lazy-fetch via
               readFile(); if that fails or budget is low, call searchByName()
               to surface candidates with precision: "fuzzy".
```

Everything else (the analyzer code, the worker plumbing, the dispatcher integration) is identical across contexts.

## Two paths, in increasing fidelity

We propose shipping **B first, A as a stretch**. Both use the same worker, the same VFS materialization, and the same dispatcher integration — the only difference is the PHP-side analyzer.

### Path B — `nikic/php-parser`-based custom resolver (v1)

A small PHP entrypoint (`analyzer.php`) that:

1. Loads `nikic/php-parser` from a phar/static asset written to the VFS at worker boot.
2. Parses each requested file into an AST, builds a per-file symbol index keyed by `{namespace, fqn, kind}` for class/interface/trait/function/method/const declarations.
3. On a definition request, parses the click file (if not cached), resolves the identifier under cursor against:
   - The local file's symbol table, then
   - Imports from `use` statements (namespace-qualified), then
   - Workspace-wide symbol map (cross-file), then
   - PSR-4 autoload roots if a `composer.json` is provided.
4. Returns `Definition[]` with `precision: "exact"` when uniquely resolved, `"fuzzy"` when only the name matches multiple symbols.

Coverage this gets us: function calls, class instantiations, static calls, constants, `use`-imported names. Roughly 80% of the value of a real LSP for definition-jumping, with a few hundred lines of PHP and one runtime dependency.

What it doesn't do: scope-sensitive variable resolution, dynamic method dispatch on inferred types, traits-as-mixins resolution. Those clicks fall through to Tier 2 (tree-sitter) or Tier 3 (grep) on the server.

### Path A — Real PHP LSP (stretch, v2)

Phpactor or a similar PHP-native analyzer driven from inside `@php-wasm/web`. The honest version of this section is the risk list:

- **The persistent-process problem.** Phpactor's LSP mode runs an Amp event loop that expects `stream_select` over real stdio. PHP-wasm exposes a synchronous `php.run(code)` boundary; there's no native stdio for the LSP to read from. The realistic shapes are (a) drive phpactor's RPC mode, which is request/response JSON and doesn't need a loop, or (b) bypass the LSP layer entirely and call `Phpactor\WorseReflection` directly as a library.
- **Bundle size.** Phpactor + dependencies is ~10 MB of PHP source. Lazy-loaded on first `.php` click, cached in the runtime, but still a meaningful add to first-PHP-click latency.
- **Process control.** Phpactor occasionally reaches for `pcntl_*` / `posix_*` for child-process spawning (e.g., its own subprocess workers). PHP-wasm does not implement these. Whatever subset we can drive in single-process mode is what we get; verify on a smoke before committing.
- **Memory.** A real workspace indexed by phpactor's reflector can comfortably use 200-500 MB. Web Worker memory limits vary; large monorepos may not fit.

This is why B is the proposal for v1. The hard architectural pieces (workspace materialization, dispatcher wiring, cache invalidation, cold-start UX) are identical between B and A — building B first lets us solve them on a smaller surface, then A becomes "swap the analyzer entrypoint."

## Architecture

```
┌─ Frontend (main thread) ────────────────────────────────────┐
│  Dispatcher (plan-symbols.md) — walks browser → server      │
│  PhpBrowserResolver: implements DefinitionResolver          │
└──────────────────────────┬──────────────────────────────────┘
                           │ postMessage(req)
┌──────────────────────────▼──────────────────────────────────┐
│  web/src/symbols/php-lsp-worker.ts                          │
│  (sibling to web/src/runner/php-worker.ts; see "One worker  │
│   or two?" below)                                           │
│                                                             │
│  ┌─ PHP-wasm runtime (warm, persists across requests) ──┐   │
│  │  Boot:  require 'phar://php-parser.phar/autoload'    │   │
│  │         require 'analyzer.php'                       │   │
│  │  Per request:  Analyzer::resolve($file,$line,$col)   │   │
│  │  Cache: in-PHP symbol index, keyed by content hash   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Workspace bridge (main ↔ worker):                          │
│   - main posts {file, line, col, fileSet:{path:contents}}   │
│   - worker writes fileSet to VFS, runs analyzer             │
│   - worker may reply NEEDS_FILES → main fetches, re-issues  │
└─────────────────────────────────────────────────────────────┘
```

The frontend `PhpBrowserResolver` satisfies the existing contract (plan-symbols.md "The contracts"). Internally it owns the worker, the request queue, and the file-fetch loop.

## The persistent-process problem (and our way around it)

`@php-wasm/web` exposes `PHP#run({ code })` as a one-shot. No long-lived stdin/stdout. This blocks the textbook "boot phpactor LSP, send `initialize`, send `definition`, parse JSON-RPC stream" pattern.

But: the **`PHP` instance itself persists across `run` calls**. Class definitions, opcache, statically-cached PHP-level state — all survive. So we can do this on first request:

```php
require 'phar:///app/php-parser.phar/autoload.php';
require '/app/analyzer.php';
\Shippable\Analyzer\State::boot();
```

…and on every subsequent request:

```php
echo \Shippable\Analyzer\Resolver::handle(json_decode(file_get_contents('php://stdin'), true));
```

The analyzer is effectively a long-lived service even though each `php.run` is a fresh script — the `State::boot()` work is one-shot, and the per-request handler reads input, looks up the cached index, returns JSON. This is the model B uses.

For path A, the same trick works for phpactor's RPC mode (which is request/response JSON, not a streaming loop). For LSP-protocol mode it does not, which is why we don't propose path A as v1.

## Workspace materialization into the VFS

Resolvers need file contents. The browser worker has its own virtual filesystem; the workspace lives on the main thread. The bridge mechanism is the same across all three contexts above; only *what* we choose to materialize differs.

Three mechanisms, picking one:

1. **Bulk pre-load.** Frontend enumerates every `.php` file at session start, ships them into the VFS once. Simple, but only viable in `unbounded` workspaces. Allowed there as a perf optimization; never used for `rate-limited`.
2. **Synchronous demand-fetch via SharedArrayBuffer + `Atomics.wait`.** PHP code calls `file_get_contents`, the worker blocks the PHP thread, the main thread fulfils via `Workspace.readFile`, the worker wakes up. Clean from PHP's perspective; requires cross-origin isolation (COOP/COEP). The existing `php-worker.ts` doesn't currently require this — adopting it for the LSP worker is a deployment-level change worth flagging early.
3. **Two-phase request.** Worker replies `{ status: "needs", files: [...] }` if the analyzer hits a file not in the VFS; main thread fetches them and re-issues with the full set attached. No COOP/COEP requirement. One extra round trip on cold cache, none after.

**Proposal: option 3 for v1, option 2 if cold-cache latency turns out to dominate.** Two-phase fits both `unbounded` and `rate-limited` postures cleanly — the only difference is whether the main-thread fetcher gates on `Workspace.readPosture.remainingBudget()` before issuing the read.

What gets materialized, by context:

- **Local + hosted (unbounded).** First PHP click triggers enumeration via `Workspace.listFiles?.("**/*.php")`; the worker bulk-indexes. Subsequent clicks are zero round trips.
- **GitHub direct (rate-limited).** First PHP click materializes only the diff files (already on the page; zero API calls). Cross-file resolution issues `Workspace.readFile()` for files referenced via `use`; if `searchByName()` is available, the resolver may prefer it over an unbounded read for fuzzy fallbacks. `vendor/` is not crawled.

## One worker or two?

The existing `web/src/runner/php-worker.ts` is the user-code execution worker. The LSP worker is a separate concern.

**Two workers.** Reasons:
- The runner worker can be killed and reset on user-code crashes (`worker.terminate()` in `executePhp.ts:49`). The LSP worker shouldn't be — its symbol index is expensive to rebuild.
- Trust boundary: the runner runs arbitrary user code. The LSP worker only runs our bundled analyzer. Mixing them widens the runner's attack surface and complicates the same-origin lockdown reasoning.
- They have different mount needs (runner: empty FS; LSP: workspace files).

The cost is a second WASM cold start. Mitigation: lazy-spawn the LSP worker on first PHP click, not at page load. A user who never clicks a PHP token never pays for it.

## Coverage strategy: where this slots in

Path B answers exact for: function calls, class/interface/trait names, static calls, constants, `use`-imported references, namespace-qualified names. It answers fuzzy or empty for: variable lookups, dynamic dispatch, magic methods, trait method resolution.

The dispatcher chain (plan-symbols.md "Dispatcher: where the click goes") handles the rest:

1. PHP browser resolver answers if it can (most clicks).
2. Server resolver chain takes over for the long tail — tree-sitter (Tier 2) or grep (Tier 3).

For path A this hierarchy doesn't change; the browser tier just gets more accurate.

## Component map

What's PHP-specific (this plan):

- `web/src/symbols/php-lsp-worker.ts` — the worker entrypoint. Boots the runtime, mounts the analyzer, owns the request queue.
- `web/src/symbols/PhpBrowserResolver.ts` — `DefinitionResolver` impl. Owns the worker handle and the file-fetch loop.
- `web/src/symbols/php/analyzer.php` — the PHP-side entrypoint. Parses, indexes, resolves.
- `web/src/symbols/php/php-parser.phar` (build artifact) — `nikic/php-parser` packed as a phar, written to the VFS at worker boot.
- `languages/php.ts` — language module declaration. Registers extensions (`.php`, `.phtml`), Shiki id, browser resolver factory.

What's reused from plan-symbols.md infrastructure:

- `Dispatcher`, `DefinitionResolver`, `Workspace`, `BrowserLocalWorkspace`, `BrowserGitHubWorkspace`, peek panel, click delegate, scope-based token annotator.

## Decisions to confirm before any code lands

1. **B before A.** Ship the `nikic/php-parser` resolver first; treat phpactor as v2 contingent on B's hard parts (materialization, cache, cold start) being de-risked.
2. **Two PHP workers, not one.** Runner stays in `runner/php-worker.ts`. The LSP gets its own worker so termination semantics, mounts, and trust boundaries don't collide.
3. **Two-phase fetch over SharedArrayBuffer for v1.** Avoids the cross-origin-isolation deployment requirement. Revisit if cold-cache latency is bad enough that users notice.
4. **Lazy worker spawn on first PHP click.** Pages with no PHP shouldn't pay the cost.
5. **Symbol index cache lives PHP-side, keyed by content hash.** The JS side is a thin RPC client. The PHP runtime is the cache; tearing down the worker invalidates it, which is the desired semantics.
6. **`precision: "fuzzy"` is honest.** When path B can only narrow to "this name matches N symbols," return all of them with `precision: "fuzzy"`; the existing UI already shows the multi-result disambiguator.
7. **The same-origin lockdown from `php-worker.ts` applies to the LSP worker too.** The LSP worker doesn't need network at all — workspace files come in via `postMessage`, not `fetch` — so the lockdown can actually be tighter (block same-origin fetch as well, allow only the WASM bootstrap).
8. **Workspace declares its read posture; resolver branches on it.** The analyzer is identical across contexts; only the indexing entrypoint differs (`unbounded` → eager, `rate-limited` → diff-first + lazy). The resolver never asks "am I on GitHub?" — it asks the workspace what kind of reads it can afford.
9. **In-diff resolution is a contract guarantee, not a best effort.** The diff files are on the page already; indexing them is free in every context. Whatever else fails — server down, GitHub rate-limited, network flaky — clicks within the diff must still resolve when the target is also in the diff.

## Implementation order

Each step is independently shippable.

### Step 1 — Spawn the worker, prove the runtime is reusable
New `web/src/symbols/php-lsp-worker.ts` (copy the `php-worker.ts` lockdown verbatim, drop the runner glue). Add a smoke that boots the runtime, runs `<?php echo "ok";`, then runs `<?php echo "still ok";` against the *same* PHP instance, and confirms PHP-level state persisted between calls. This is the load-bearing assumption for the whole plan.

### Step 2 — Bundle `nikic/php-parser` and prove it parses inside the worker
Build step: produce `php-parser.phar` from `nikic/php-parser`, ship as static asset. Worker boot writes it to `/app/`, `require`s the autoloader. Smoke parses a small PHP fixture and confirms the AST round-trips out as JSON.

### Step 3 — In-diff resolution (the contract floor)
Worker accepts `{ file, contents, line, col, diffFiles: {path: contents}[] }` — the diff files are always sent, since the frontend has them on the page. Parses, indexes, returns definitions when both click and target are in the diff. Frontend `PhpBrowserResolver` wraps it. This is the guaranteed-floor capability and works identically in all three workspace contexts.

### Step 4 — Workspace read posture + cross-file lookup (unbounded)
Add `Workspace.readPosture` to the contract. `BrowserLocalWorkspace` declares `unbounded` and implements `listFiles`. Resolver eagerly enumerates `*.php`, materializes via two-phase fetch (analyzer asks for files it doesn't have, frontend ships them, retry). Symbol index spans the workspace; cache by content hash. End-to-end exact resolution for the local + hosted contexts.

### Step 5 — Language registration + dispatcher integration
Add `languages/php.ts`. The dispatcher (built by step 3 of plan-symbols.md) picks up the browser resolver and uses it for `.php` clicks ahead of the server chain. PHP clicks now resolve in-browser with no server roundtrip in unbounded contexts.

### Step 6 — Rate-limited workspace strategy (GitHub direct)
`BrowserGitHubWorkspace` declares `rate-limited` and implements `listFiles` against the `git/trees?recursive=1` endpoint, `readFile` against the Contents API, and `searchByName` against the Code Search API. Resolver branches on the posture: skips the eager-enumerate step, lazy-fetches on `use` resolution, surfaces Code Search hits as `precision: "fuzzy"` when reads are denied or budget is low. `vendor/` is never crawled in this mode. Validates that the in-diff floor + lazy-expand + name-floor combination feels good in a real PR review.

### Step 7 — Path A spike (optional, after B has run for a while)
Pick one of: phpactor RPC mode, `Phpactor\WorseReflection` as a library, or psalm's analyzer subset. Verify it boots in php-wasm and produces a `definition` answer for a typed `$obj->method()` click. This is a feasibility check, not a commitment to ship.

## Open questions to revisit

- **PSR-4 / autoload resolution.** Path B can read `composer.json` for autoload roots, but we don't actually need Composer installed — just the autoload map. Worth confirming the workspace always exposes `composer.json` when present. In the GitHub context, fetching `composer.json` is one read we should always spend.
- **`vendor/` indexing.** If the user clicks into a Symfony class, do we want the resolver to follow into `vendor/`? In `unbounded`, yes if present. In `rate-limited`, never automatically — but maybe behind a per-click "expand into vendor" affordance, since fetching one file is cheap and the user has signalled intent.
- **Cache invalidation across workspace contexts.** Three different answers:
  - `unbounded` (local on disk): the PHP-side cache is keyed by content hash but the *check* is per-file; need an `If-None-Match`-style read or `mtime` check, otherwise stale results.
  - `unbounded` (hosted): server can stamp `(repo, sha, path)` and the cache key includes the SHA — never invalidates within a session.
  - `rate-limited` (GitHub): SHA-pinned, never invalidates.
  Local-disk is the only hard case; hosted and GitHub both get content-addressed cache for free.
- **GitHub auth.** Code Search and Contents API rate limits jump from 60/hr unauthenticated to 5000/hr with a token. We probably need a token plumb-through for the GitHub direct case to be useful. Where the token lives (user-supplied via the existing review UI? an OAuth flow?) is a question for the broader plan, not just this resolver.
- **What "best effort" looks like in the UI.** When the GitHub direct context can't fully resolve (no fetch budget, Code Search returned 4 candidates), the existing multi-result disambiguator handles the data, but the user should know *why* — "showing name matches; cross-file resolution unavailable" or similar. Surfacing this without being noisy is a UX question.
- **Cold-start UX on first PHP click.** Worker spawn + WASM fetch + parser-phar boot + first-file parse is several seconds. The plan-symbols dispatcher already supports "send to server in parallel during browser warm-up, take whichever returns first." Wire that up specifically for the first PHP click of a session.
- **Worker memory ceiling.** Large monorepos may exhaust the worker. Need a soft cap: at N MB of indexed AST, evict least-recently-used file entries. Not v1 unless smokes hit it. More likely to bite in the `unbounded` context than the `rate-limited` one (GitHub direct never indexes the whole repo).
- **Multi-tab.** Each tab boots its own worker and its own index. This is fine and probably desirable (no shared mutable state); flagged here so we don't accidentally rely on cross-tab sharing later.
