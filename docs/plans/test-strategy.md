# Test and refactor strategy

**Status:** Draft.

## What this is

A proposal for how Shippable gets a test suite worth running, the refactors needed to make the code testable, and the order to do it in. `docs/ROADMAP.md` (0.1.0) calls for "tests + CI"; this document is the plan to deliver that.

## TL;DR

- Four test layers (unit / integration / E2E / manual). One bar: every test must catch a bug class the type checker can't.
- Land the suite in four phases. **Phase A is load-bearing**: server integration tests, version `persist.ts`, prune dead smokes.
- Three refactors are prerequisites, not nice-to-haves: `server/src/index.ts` (extract handlers + inject deps), `persist.ts` (versioned state + migration table), `promptRun`/`promptStore` (pure reducer reachable without a mounted component).
- CI = GitHub Actions. Tiny in Phase A (lint/test/typecheck), full in Phase C (Playwright + server integration). Coverage published, never gated.

## How to read this

- **Want the plan only?** TL;DR above, then [Sequencing](#sequencing).
- **Reviewing the bar?** [Principles](#principles) and [Anti-patterns](#anti-patterns-will-reject-in-review).
- **Wondering why we're refactoring, not just adding tests?** [Redesigns we expect](#redesigns-we-expect).
- **What gets tested first?** [Risk-first plan](#risk-first-plan).

## Glossary

- **Smoke** — `web/test-smoke.mjs`, our existing CDP-driven end-to-end script. ~13 specs, ~5 currently disabled with a `blockedReason`.
- **Tier 0–4** — priority bands inside the [Risk-first plan](#risk-first-plan), not test layers. Tier 0 = clear rot; higher tiers = lower-leverage surfaces.
- **Risk-first** — order tests by the bug class they catch, not by file layout or coverage %.
- ***"Does this test do anything?"* mode** — a Shippable product feature that flags tests which still pass after the implementation under test is reverted. Our own suite must clear that bar.
- **Modules referenced below** — `parseDiff` (diff parser), `state` (review-state reducer), `persist.ts` (localStorage round-trip for review state), `promptRun`/`promptStore` (prompt-execution state machine), `symbols`/`plan`/`view`/`guide` (review-plan internals), and the UI components `ReviewPlanView` / `DiffView` / `PromptRunsPanel` / `LoadModal` / `Inspector`. Canonical map: `docs/architecture.md`.

## Principles

0. Tests help us move faster, with more confidence.
1. **Exercise real code paths.** No fixture-equals-fixture. If a test still passes after `git revert`, it's pointless.
2. **Pay for themselves.** Name the bug class a test catches that the type checker doesn't. If you can't, don't write it.
3. **Untestable code gets flagged and redesigned with a human in the loop.** Lots of mocks or reflection = wrong seam.

## Current state (2026-05-04)

| Surface | Have | Missing |
|---|---|---|
| `web/src` logic | `parseDiff`, `state`, `MarkdownView*` | `persist`, `promptRun`, `promptStore`, `symbols`, `plan`, `view`, `guide` |
| Components | `MarkdownView` | `ReviewPlanView`, `DiffView`, `PromptRunsPanel`, `LoadModal`, `Inspector` |
| Smoke (`test-smoke.mjs`) | ~13 specs, ~5 disabled with `blockedReason` | rot to triage |
| Server | `typecheck` only | every endpoint, CORS, rate limit, library-refresh auth |
| Runner workers | a few smokes; PHP broken | isolation/timeout |
| Tauri shell | nothing | parked until CI has Macs |
| CI | none | everything |

## Layers

- **Unit** — vitest + jsdom. Pure modules and components in isolation. Default.
- **Integration** — vitest, Node. Boot real `http.Server` from `server/src` in-process. Mock only at the Anthropic SDK boundary.
- **E2E** — keep `test:smoke` for now; the three golden paths move to `@playwright/test` in Phase C. Few, golden, against a real Vite build.
- **Manual** — Tauri shell, runner sandbox edges. Document, don't automate yet.

## Risk-first plan

### Tier 0 — prune the rot

- [ ] Triage blocked smokes (`coderunner-modes/php/richphp/php-worker/free`, `prompts`): fix, port, or delete. No TODO-as-test.
- [ ] Re-read existing unit tests against principle #1.

### Tier 1 — load-bearing logic

- [ ] **CORS / origin allowlist** (`server/src/index.ts`): allowed → 200; `Origin: null` → handled, not 403; disallowed → blocked; `Sec-Fetch-Site` interplay. Integration test against a real socket — only honest coverage.
- [ ] **`/api/review` rate limit:** N+1 from same IP → 429. Limit injectable.
- [ ] **`/api/plan` happy path:** stub Anthropic; assert request shape + response validates against the same Zod schema the UI consumes.
- [ ] **`/api/library/refresh` auth gate:** missing token + `SHIPPABLE_DEV_MODE` unset → 401; either set → 200.
- [ ] **`persist.ts` round-trip + migration.** Old fixture must load at current shape via documented migration. **If unversioned today, redesign first** (see below).
- [ ] **`parseDiff` edges:** binary, renames, empty hunks, no-newline-at-EOF, deletion-only files.
- [ ] **`state` reducer invariants** (not outcomes): "reviewed-count never decreases on mark-reviewed", "cursor never escapes the changeset", etc.

### Tier 2 — UI behavior tied to product invariants

- [ ] `ReviewPlanView` refuses claims without evidence (documented promise — test it).
- [ ] `DiffView` selection: click, shift-click ranges, expand-above/below cursor preservation.
- [ ] `PromptRunsPanel` + `promptRun` machine: idle / streaming / error / completed → DOM.
- [ ] `LoadModal` URL ingest, happy + error, with `fetch` mocked.

### Tier 3 — golden-path E2E (3, no more)

- [ ] Paste diff → walk hunks → mark file reviewed → refresh → restored.
- [ ] Two-branch local diff → server plan renders → every claim has evidence.
- [ ] No-server fallback degrades cleanly (no sad disabled tabs).

### Tier 4 — runner workers

Parked until Tier 0 decides what survives.

## Redesigns we expect

- **`server/src/index.ts`** — one big handler + global state (rate-limit map, env-driven config). Extract handler functions; inject SDK client + clock + rate-limit store. Keep boot path thin.
- **`persist.ts`** — needs a version field and a forward-only migration table.
- **`promptRun.ts` / `promptStore.ts`** — if the state machine is only reachable through a mounted component, extract a pure reducer.
- **`test-smoke.mjs`** — couples spec selection, dev-server boot, and CDP driving. Factor "boot dev server" out, especially if we adopt `@playwright/test`.

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
- **`@vitest/coverage-v8`** wired in Phase A. Publish the number, never set a threshold — gates push people into principle #2 violations.
- **Tauri shell** stays out of scope until CI grows Macs.

## Sequencing

- **Phase A:** Tier 0 + Tier 1 + `persist.ts` redesign + tiny CI (`web:lint`, `web:test`, `server:typecheck`, `server:test`, coverage published). Output: server has integration tests, persist is versioned, blocked smokes resolved.
- **Phase B:** Tier 2.
- **Phase C:** Tier 3 + Playwright + golden-path E2Es in CI.
- **Phase D:** Tier 4.

Each phase's PR says what bug class it locked down.
