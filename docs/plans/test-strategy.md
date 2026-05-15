# Test and refactor strategy

**Status:** Draft.

## What this is

A proposal for having a full test suite for Shippable. This includes any refactors needed to make the code more testable, and the order to do it in.

## TL;DR

- Four test layers (unit / integration / E2E / manual). Every test must catch a problem or class of bug that the previous level of tests can't.
- The refactors are prerequisites, not nice-to-haves: `server/src/index.ts` (extract handlers + inject deps), `persist.ts` (add a forward-only migration table — the version field already exists), `promptRun`/`promptStore` (pure reducer reachable without a mounted component).
- No CI on GitHub yet, however we should have pre-push hooks. On Phase A, have lint/test/typecheck hooks on pre-commit.  For Phase C (Playwright + server integration), run the full test suite on pre-push.
- The ideal is that as a whole the automated tests can catch most bugs, and that manual tests can be done with agents before humans have to run them.

## Glossary

- **Smoke** — `web/scripts/test-smoke.mjs`, our existing e2e script.
- **Tier 0–4** — priority bands inside the [Risk-first plan](#risk-first-plan), not test-layers. A lower number means the risk is more serious.
- **Risk-first** — order tests by the bug class they catch, not by file layout or coverage %.
- ***"Does this test do anything?"* mode** — a Shippable product feature that flags tests which still pass after the implementation under test is reverted. Our own suite must clear that bar.
- **Modules referenced below** — `parseDiff` (diff parser), `state` (review-state reducer), `persist.ts` (localStorage round-trip for review state), `promptRun`/`promptStore` (prompt-execution state machine), `symbols`/`plan`/`view`/`guide` (review-plan internals), and the UI components `ReviewPlanView` / `DiffView` / `PromptRunsPanel` / `LoadModal` / `Inspector`. Canonical map: `docs/architecture.md`.

## Principles

1. Tests help us move faster, with more confidence.
2. **Exercise real code paths.** No fixture-equals-fixture. If a test still passes after `git revert`, it's pointless.
3. **Pay for themselves.** Name the bug class a test catches that the type checker doesn't. If you can't, don't write it.
4. **Untestable code gets flagged and redesigned with a human in the loop.** Lots of mocks or reflection may indicate issues with the abstraction chosen, abstraction level we're getting into, or other architecture concerns.
5. **Never build the expected value by calling the system under test.** A test where production code and the assertion flow through the same helper is a mirror — a regression in the helper passes both sides silently. Inline literal expectations (`"line"`, `"block"`, `"reply"`) rather than computing them through a helper the production code also uses. This is the function-call cousin of #2's static fixture-equals-fixture rule.

## Current state (2026-05-14)

| Surface | Have | Missing |
|---|---|---|
| `web/src` logic | `parseDiff` (+`.edges`, `expandContext`), `state` (+`.invariants`), `persist`, `interactions`, `view`, `anchor`, `agentCommentPayload`, `apiClient`, `recents`, `highlight`, `types`, `useDeliveredPolling`, `planDiagram`, `fileRole`, `promptStore`, `githubPrClient` | `promptRun`, `symbols`, `guide` |
| Components | 20 component tests incl. `DiffView`, `Inspector`, `LoadModal`, `ReviewWorkspace`, `MarkdownView*`, `PlanDiagramView`, `CommandPalette`, `ServerHealthGate`, `Welcome`, `SettingsModal`, `StatusBar`, `ReplyThread`, `HelpOverlay`, `LineContextMenu`, `AgentContextSection`, `CredentialsPanel`, `GitHubTokenModal`, `useCredentials`, `App` | `ReviewPlanView`, `PromptRunsPanel`; not yet deep-audited (see 2026-05-14 notes) |
| Smoke (`scripts/test-smoke.mjs`) | 13 specs, some still disabled with `blockedReason` | triage pass still owed |
| Server | `port-file`, `proxy`, `mcp-status`, in-process `index.test.ts` covering 12+ route groups against real `createApp()`, `worktrees`, `agent-queue`, `codeGraph` (+`.e2e`), `definitions`, `lspClient`, `plan`, `auth/{store,credential,endpoints}`, `languages/{discovery,php}`, `github/{url,api-client,pr-load,branch-lookup}` | `/api/review` SSE event framing, `/api/plan` end-to-end with `PlanResponseSchema` validation, `/api/library/refresh` auth gate, `/api/review` rate-limit 429, CORS allowlist beyond `Origin: null` (allowed → echo, disallowed → 403, `Sec-Fetch-Site`, OPTIONS preflight) |
| Runner workers | a few smoke tests; PHP broken | isolation/timeout (unchanged) |
| Tauri shell | nothing | dmg packaging, sidecar boot, file-system perms (parked: needs macOS CI) |
| CI | none | everything (unchanged) |

## Layers

- **Unit** — vitest + jsdom. Pure modules and components in isolation. Default.
- **Integration** — vitest, Node. Boot real `http.Server` from `server/src` in-process. Mock only at the Anthropic SDK boundary.
- **E2E** — keep `test:smoke` for now; the three golden paths move to `@playwright/test` in Phase C. Few, golden, against a real Vite build.
- **Manual** — Tauri shell, runner sandbox edges. Document, don't automate yet.

## Risk-first plan

For each stage of the plan, make **at least** one commit. Commits should be atomic and allow us to easily understand what has changed, as well as easily revert if there are issues. 

### Tier 0 — cleanup and assess

- [ ] Triage blocked smoke tests (`coderunner-modes/php/richphp/php-worker/free`, `prompts`, `md-preview-theme`): fix, port, or delete. No TODO-as-test.
- [x] Re-read existing unit tests against principle #1 and #2 — see [Audit notes (2026-05-05)](#audit-notes-2026-05-05) below.

#### Audit notes (2026-05-05)

Method: read every assertion against principles #1 and #2; spot-check by mutating the implementation and confirming a test fails.

Per-file verdict:

- **`parseDiff.test.ts` (46 tests) — keep all.** Black-box tests with concrete unified-diff input and assertions on the resulting `ChangeSet`. Verified by mutation: removing `.toLowerCase()` in `guessLanguage` → "matches case-insensitively" fails; deleting the `rename from / rename to` branches → "treats rename as renamed" fails; dropping `oldNo++` on `-` lines → "increments oldNo/newNo across mixed line kinds" fails. No theater. One follow-up flagged below.
- **`state.test.ts` (58 tests) — keep all.** Drives the public `reducer(state, action)` API; no private helpers tested directly (`addLine`, `applyCursor`, `togglein`, `removeFrom` reached only through actions). Verified by mutation: removing `Math.max(0, action.level)` → "clamps negative levels to 0" fails; dropping the `removeFrom(state.previewedFiles, …)` mutual-exclusion in `TOGGLE_EXPAND_FILE` → "turning on full-expand removes the file from previewedFiles" fails. The `expect(s).toBe(s0)` reference-equality assertions (clamps in `MOVE_HUNK` / `MOVE_FILE`, no-op `DELETE_REPLY`, etc.) pin a load-bearing optimization for React render-skipping — keep. The `initialState` field-shape tests and "DISMISS_GUIDE is idempotent" pass for trivial reasons but would catch real refactors (changing `Set` to array, dropping a field initialization).
- **`MarkdownView.test.tsx` (6 tests) — keep all.** Mix of pure-function tests for `resolveImageSrc` and SSR snapshots via `renderToStaticMarkup` that assert on substrings (e.g., `'<img src="data:image/png;base64,LOCAL"'`), not on full HTML — survives ReactMarkdown internal markup churn.
- **`MarkdownView.gate.test.tsx` (2 tests) — keep all.** Verified by mutation: removing the `key={key}` prop on `ResolvedImgGate` → "resets the gate when src changes on the same component instance" fails. This is exactly the kind of test that catches a hidden invariant the type checker can't.

Anti-patterns scan: no DOM snapshots used as input, no `parseDiff` mocked inside `state` tests, no fixture-equals-fixture, no inflation tests.

**Net: 0 deletions, 0 rewrites.** All 112 unit tests earn their keep.

Follow-up done as a separate cleanup commit:

- Removed dead empty-line skip in `parseDiff.parseHunk`: the `if (l.length === 0)` branch was unreachable — the `else { break }` for unknown prefixes already terminates the hunk loop on an empty trailing line. The "skips empty trailing lines inside a hunk" assertion stays (the parser must not emit a phantom blank line); it just no longer differentiates two implementations.

#### Audit notes (2026-05-14)

Method: read every test file in `server/src` and `web/src` (40+ files; component suite listed but deferred). Judged each against principles #1–#5. Mutation verification deferred to a follow-up pass. Broader than the 2026-05-05 audit; less deep.

Subsystem verdicts:

- **Diff parsing** (`parseDiff.test.ts`, `parseDiff.edges.test.ts`, `expandContext.test.ts`) — **solid.** Real input strings, real outputs, regressions for documented bug classes (binaries, renames, no-newline, deleted files). New tests in this area need to justify themselves against existing coverage.
- **Review state machine** (`state.test.ts`, `state.invariants.test.ts`) — **solid.** `state.invariants.test.ts` is the highest-leverage test in the repo: seeded PRNG random walks across the action surface checking 7 structural invariants. **Use it as the worked example** when writing new state-machine / reducer tests.
- **Persistence** (`persist.test.ts`) — **solid.** v3 round-trip, strip-on-save (AI/agent/PR), hunk-validity filtering, empty-changeset boot-crash regression. The planned migration table never landed and is **closed by design decision** — see Redesigns.
- **GitHub adapter chain** (`server/src/github/{url,api-client,pr-load,branch-lookup}.test.ts`, `web/src/githubPrClient.test.ts`) — **solid layering.** Each layer mocks `fetch` upstream and tests its own slice; integration closes via `index.test.ts`'s `makeSelectiveFetch`.
- **Code graph / LSP** (`codeGraph.test.ts` + `.e2e`, `lspClient.test.ts`, `definitions.test.ts`, `languages/*`) — **solid.** Stub LSP for unit; real intelephense/phpactor for e2e. Capability fallback, vendor exclusion, ranking, cache, mixed resolvers covered.
- **Server route surface** (`index.test.ts`) — **solid integration pattern.** Real `createApp()` on `127.0.0.1`, `vi.stubGlobal("fetch")` only at the upstream-GitHub seam. **This is the integration tier the Layers section names** — bless this pattern and reuse for new endpoints. Gaps: `/api/review` SSE framing, `/api/plan` schema validation end-to-end, `/api/library/refresh` auth, rate-limit 429.
- **AI prompt builders** (`server/src/plan.test.ts`) — **okay; the pattern to copy.** Test prompt assembly and response parsing as pure functions; never test the SDK call itself. The byte-count inline snapshot on line 134 is the one anti-pattern to avoid replicating (see Anti-patterns below).
- **Interactions projection** (`web/src/interactions.test.ts`) — **okay.** Principle #5 violation flagged below.
- **Components** (`web/src/components/*.test.tsx`, 19 files including the `DiffView`, `Inspector`, `LoadModal`, `ReviewWorkspace` cases the 2026-05-04 table called "Missing") — **not deep-reviewed this pass.** Triage candidates for the next audit. Treat coverage as present-but-unverified until then.

Net: suite is in better shape than the 2026-05-04 table suggested. No bulk deletions recommended. Two specific fixes called out in Anti-patterns.

### Tier 1 - key logic

- [~] **CORS / origin allowlist** (`server/src/index.ts`): **partial** — `Origin: null` → 403 covered at `index.test.ts:737, 1132, 1261`. Still missing: allowed → 200 with echoed `Access-Control-Allow-Origin`; disallowed origin → 403; absent `Origin` + `Sec-Fetch-Site: cross-site` → 403; `Sec-Fetch-Site` never broadens the allowlist when `Origin` is present; OPTIONS preflight. Integration test against a real socket.
- [ ] **`/api/review` rate limit:** N+1 from same IP → 429. Limit injectable. (Note: the existing `429` reference at `index.test.ts:1062` is an upstream-GitHub rate-limit assertion, not the local limiter.)
- [~] **`/api/plan` happy path:** **partial** — 503 branches when key missing/present are covered (`index.test.ts:829, 837`) but the generator is spied out. Still owed: stub Anthropic at the SDK boundary; assert request shape + response validates against `PlanResponseSchema` from `server/src/plan.ts`. The UI currently casts (`as Promise<{ plan: ReviewPlan }>`) without runtime validation — a follow-up should either share the schema or have the UI re-validate; flag this if the test surfaces a mismatch.
- [ ] **`/api/library/refresh` auth gate:** missing token + `SHIPPABLE_DEV_MODE` unset → 403; wrong token → 403; correct token *or* `SHIPPABLE_DEV_MODE=1` → 200.
- [x] **`persist.ts` round-trip** — `persist.test.ts` covers v3 round-trip, strip-on-save, hunk-validity filtering, empty-changeset boot-crash regression. The migration-table item is closed by design decision (see Redesigns).
- [x] **`parseDiff` edges** — `parseDiff.edges.test.ts` covers binary, renames, no-newline-at-EOF, deletion-only, plus the bug-class regressions.
- [x] **`state` reducer invariants** — `state.invariants.test.ts` runs seeded random walks checking 7 structural invariants (reviewed-count monotonicity, cursor containment, etc.).

### Tier 2 — UI behavior tied to product invariants

- [ ] `ReviewPlanView` refuses claims without evidence (documented promise — test it).
- [ ] `DiffView` selection: click, shift-click ranges, expand-above/below cursor preservation. Pointer dispatch (focus, shift-extend flag, right-click menu) is covered by `DiffView.test.tsx`; range correctness and expand-above/below cursor preservation still need cases.
- [ ] `PromptRunsPanel` + `promptRun` machine: idle / streaming / error / completed → DOM.
- [ ] `LoadModal` URL ingest, happy + error, with `fetch` mocked.

### Tier 3 — E2E (3, no more)

- [ ] Paste diff → walk hunks → mark file reviewed → refresh → restored.
- [ ] Two-branch local diff → server plan renders → every claim has evidence.
- [ ] No-server fallback degrades cleanly (no sad disabled tabs).

### Tier 4 — runner workers

Parked until Tier 0 decides what survives.

## Redesigns we expect

- **`server/src/index.ts`** — one big handler + global state (rate-limit map, env-driven config). Extract handler functions; inject SDK client + clock + rate-limit store. Keep boot path thin.
- **`persist.ts`** — **closed by design (2026-05-14):** head schema is v3 and snapshots from older versions are wiped on load rather than migrated. The prototype has no users to migrate (see `persist.ts:68-70`). The version field still gates load so future-shape blobs don't poison older code.
- **`promptRun.ts` / `promptStore.ts`** — if the state machine is only reachable through a mounted component, extract a pure reducer.
- **`scripts/test-smoke.mjs`** — couples spec selection, dev-server boot, and CDP driving. Factor "boot dev server" out, especially if we adopt `@playwright/test`.

## Anti-patterns (will reject in review)

- DOM snapshots used as test input.
- Mocking the thing under test (e.g., `parseDiff` in a `state` test).
- Asserting on private helpers — drive through the public API.
- One trivial test per source file to inflate coverage.
- Mocking first-party internal modules (`vi.mock("./apiUrl")`, `vi.mock("./somelocal")`). Mock at the boundary: `fetch`, the Anthropic SDK, child processes. If you need to mock an internal module, the seam is wrong — redesign per principle #4.
- Helper-built expectations (principle #5): computing the expected value via a function the production code also calls.
- Byte-count or full-text inline snapshots of generated prompts/markup. Allowed only when paired with a structural assertion that already catches the relevant failure modes — at which point the byte count is redundant anyway. The structural matcher is what earns its keep; the count is a tripwire that fires on every prompt edit.
- Real wall-clock `setTimeout` waits or `Date.now()` comparisons in assertions. Inject a clock or use `vi.useFakeTimers()`.
- Real network calls in unit/integration. The only allowed network seams are the `fetch` stubs and the LSP-binary `.e2e.test.ts` tier.

**Concrete examples flagged in the 2026-05-14 audit** (use these as worked examples when writing or reviewing tests):

- **Helper-built expectation (principle #5)** — `web/src/interactions.test.ts:62` builds expected `Interaction.target` values via `firstTargetForKey(...)`, the same helper the production projector calls. Literal `toBe("line"/"block"/"reply")` assertions on lines 319, 388, 451 save it from full circularity, but anywhere expectations only flow through the helper, a helper regression passes both sides silently. Fix: inline literal expectations.
- **Real wall-clock sleep** — `server/src/agent-queue.test.ts:194`: `await new Promise(r => setTimeout(r, 5))` to force a `Date.now()` gap for ascending-timestamp assertions. Inject a clock, or assert non-decreasing rather than strictly-increasing.
- **Byte-count inline snapshot** — `server/src/plan.test.ts:134`: `expect(message.length).toMatchInlineSnapshot('2219')`. Fails on any prompt edit and tells you nothing about correctness. Keep the structural assertion on line 137 ("drops non-exported zero-ref symbols") and replace the byte-count with `expect(message).toMatch(/## StructureMap[\s\S]+## Diff/)` or equivalent.
- **Redundant surface** — `server/src/auth/endpoints.test.ts` re-tests every assertion already covered by `index.test.ts:684-805` against the production `createApp()`. Delete-candidate; the integration-tier version is higher-fidelity.
- **Tokenizer-internal column index** — `web/src/highlight.test.ts:46`: `expect(html).toContain('data-token-col="7"')`. Pins to shiki internals; the symbol-tagging assertion above it is load-bearing, the column index is not.

## Coverage rule

"Every feature has a suite" is checkable, not vibes. The unit of "feature" is layer-specific:

- Every workflow in `docs/features/` has at least one happy-path E2E.
- Every server endpoint has at least one integration test.
- Every module's public API has unit tests.

That inventory is what we run against before calling Phase D done.

## Tooling

- **Vitest + Testing Library** for unit and integration. Kept.
- **Anthropic SDK** — hand-written stubs at the boundary, validated against the same Zod schema the UI consumes. No recorded-response replay until drift bites us.
- **`@playwright/test`** adopted in Phase C. `playwright-core` already in deps is incidental — `test-smoke.mjs` drives Chrome via CDP directly. Port only the three golden-path E2Es; don't migrate the rest of the smoke suite.
- **`@vitest/coverage-v8`** wired in Phase A. Publish the number, never set a threshold.
- **Tauri shell** stays out of scope until CI grows Macs.

## Sequencing

- **Phase A:** Tier 0 + Tier 1 + `persist.ts` redesign + tiny CI (`web:lint`, `web:test`, `server:typecheck`, `server:test`, coverage published). Output: server has integration tests, persist is versioned, blocked smoke tests resolved.
- **Phase B:** Tier 2.
- **Phase C:** Tier 3 + Playwright + golden-path E2Es in CI.
- **Phase D:** Tier 4.

Each phase's commit says what bug class it locked down.
