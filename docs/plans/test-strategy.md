# Test and refactor strategy

**Status:** Draft. Open questions at the bottom.

ROADMAP 0.1.0 wants tests + CI. The product itself ships a *"Does this test do anything?"* mode — we should hold our suite to that bar.

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
- **E2E** — keep `test:smoke` for now; new specs via `@playwright/test` if we adopt it. Few, golden, against a real Vite build.
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

## Tooling

Vitest + Testing Library kept. Anthropic SDK mocked at boundary only. `@playwright/test` is an open question. CI = GitHub Actions running `web:lint`, `web:test`, `server:typecheck`, `web:test:smoke` (default specs); add `server:test` once Tier 1 lands. Coverage collected, never gated — gates push people into principle #2 violations.

## Sequencing

- **Phase A:** Tier 0 + Tier 1 + persist redesign. Output: server has integration tests, persist is versioned, blocked smokes resolved.
- **Phase B:** Tier 2.
- **Phase C:** Tier 3 + CI.
- **Phase D:** Tier 4.

Each phase's PR says what bug class it locked down.

## Open questions

1. Stub the Anthropic SDK or replay recorded responses? (lean stub.)
2. Adopt `@playwright/test`, or stay on `test:smoke`? `playwright-core` is already a dep — deliberate?
3. CI in Phase A or after?
4. Tauri shell out of scope for now — confirm.
5. `@vitest/coverage-v8` now or in Phase B?
6. Unit of "feature" for *"every feature has a suite"*: workflow for E2E, module for unit, endpoint for integration — agree?
