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

## Current state (2026-05-04)

| Surface | Have | Missing |
|---|---|---|
| `web/src` logic | `parseDiff`, `state`, `MarkdownView*` | `persist`, `promptRun`, `promptStore`, `symbols`, `plan`, `view`, `guide` |
| Components | `MarkdownView` | `ReviewPlanView`, `DiffView`, `PromptRunsPanel`, `LoadModal`, `Inspector` |
| Smoke (`scripts/test-smoke.mjs`) | 13 specs, 7 disabled with `blockedReason` | rot to triage |
| Server | `typecheck` only | every endpoint, CORS, rate limit, library-refresh auth |
| Runner workers | a few smoke tests; PHP broken | isolation/timeout |
| Tauri shell | nothing | dmg packaging, sidecar boot, file-system perms (parked: needs macOS CI) |
| CI | none | everything |

## Layers

- **Unit** — vitest + jsdom. Pure modules and components in isolation. Default.
- **Integration** — vitest, Node. Boot real `http.Server` from `server/src` in-process. Mock only at the Anthropic SDK boundary.
- **E2E** — keep `test:smoke` for now; the three golden paths move to `@playwright/test` in Phase C. Few, golden, against a real Vite build.
- **Manual** — Tauri shell, runner sandbox edges. Document, don't automate yet.

## Risk-first plan

For each stage of the plan, make **at least** one commit. Commits should be atomic and allow us to easily understand what has changed, as well as easily revert if there are issues. 

### Tier 0 — cleanup and assess

- [ ] Triage blocked smoke tests (`coderunner-modes/php/richphp/php-worker/free`, `prompts`, `md-preview-theme`): fix, port, or delete. No TODO-as-test.
- [ ] Re-read existing unit tests against principle #1 and #2.

### Tier 1 - key logic

- [ ] **CORS / origin allowlist** (`server/src/index.ts`): allowed → 200 with echoed `Access-Control-Allow-Origin`; `Origin: null` → 403 (opaque origins are a CSRF hole if treated as absent — see comment in `classifyRequestOrigin`); disallowed origin → 403; absent `Origin` + `Sec-Fetch-Site: cross-site` → 403; `Sec-Fetch-Site` never broadens the allowlist when `Origin` is present. Cover OPTIONS preflight. Integration test against a real socket.
- [ ] **`/api/review` rate limit:** N+1 from same IP → 429. Limit injectable.
- [ ] **`/api/plan` happy path:** stub Anthropic; assert request shape + response validates against `PlanResponseSchema` from `server/src/plan.ts`. The UI currently casts (`as Promise<{ plan: ReviewPlan }>`) without runtime validation — a follow-up should either share the schema or have the UI re-validate; flag this if the test surfaces a mismatch.
- [ ] **`/api/library/refresh` auth gate:** missing token + `SHIPPABLE_DEV_MODE` unset → 403; wrong token → 403; correct token *or* `SHIPPABLE_DEV_MODE=1` → 200.
- [ ] **`persist.ts` round-trip + migration.** Snapshot already carries `v: 1` and an `isPersistedSnapshot` validator; missing piece is a forward-only migration table so a future `v: 2` can load `v: 1` blobs. Redesign before writing the migration test (see below).
- [ ] **`parseDiff` edges:** binary, renames, empty hunks, no-newline-at-EOF, deletion-only files.
- [ ] **`state` reducer invariants** (not outcomes): "reviewed-count never decreases on mark-reviewed", "cursor never escapes the changeset", etc.

### Tier 2 — UI behavior tied to product invariants

- [ ] `ReviewPlanView` refuses claims without evidence (documented promise — test it).
- [ ] `DiffView` selection: click, shift-click ranges, expand-above/below cursor preservation.
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
- **`persist.ts`** — has a `v: 1` field already; needs a forward-only migration table so the version field actually does something when it bumps.
- **`promptRun.ts` / `promptStore.ts`** — if the state machine is only reachable through a mounted component, extract a pure reducer.
- **`scripts/test-smoke.mjs`** — couples spec selection, dev-server boot, and CDP driving. Factor "boot dev server" out, especially if we adopt `@playwright/test`.

## Anti-patterns (will reject in review)

- DOM snapshots used as test input.
- Mocking the thing under test (e.g., `parseDiff` in a `state` test).
- Asserting on private helpers — drive through the public API.
- One trivial test per source file to inflate coverage.

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
