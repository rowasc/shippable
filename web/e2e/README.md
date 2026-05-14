# e2e tests

Playwright Test conversion of the `[auto]` and `[mixed]` steps from
`docs/usability-test.md`. **Hybrid model**: the real `server/` runs behind
the suite (keyless — health, auth, worktrees, prompts, and the rule-based
plan all work without an Anthropic key), so those paths are exercised for
real. Tests `page.route()`-mock only the genuinely external boundaries —
GitHub and Anthropic — and hard-to-trigger failure modes.

## Running

From `web/`:

```sh
npm run test:e2e        # headless, list reporter
npm run test:e2e:ui     # playwright's UI mode for debugging
```

Uses **system Chrome** (`channel: "chrome"` in `playwright.config.ts`) so we
don't have to download playwright's bundled chromium on every machine.
If you don't have Chrome:

```sh
PLAYWRIGHT_CHANNEL=chromium npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:e2e
```

The `webServer` block boots two processes:

- vite dev on **:5198** (so it doesn't collide with the default :5173).
- the real `server/` (`npm start`) on **:3001**, which vite proxies
  `/api/*` to. It's started with `SHIPPABLE_ALLOWED_ORIGINS` set to the
  e2e vite host — the server origin-checks every POST, and vite forwards
  the browser's `Origin` header through the proxy, so the e2e host has to
  be on the allowlist or worktree/auth writes come back 403.

## Layout

| File | Journey | Status |
|---|---|---|
| `journey-1-first-run.spec.ts` | Onboarding, boot gate, Settings | active |
| `journey-2-worktree.spec.ts`  | Local worktree review (real server + fixture repo) | 3 active + fixmes |
| `journey-3-github-pr.spec.ts` | GitHub PR review | fixmes (needs `/api/github/*` mocks) |
| `journey-4-paste-url.spec.ts` | Paste / URL / file diff | active |
| `journey-5-ai-features.spec.ts` | Plan, prompts, runner, Inspector | 2 active + fixmes |
| `journey-6-cross-cutting.spec.ts` | Themes, palette, help, recents, standalone pages | active |
| `_lib/fixtures.ts` | `test` extension w/ default mocks; `visit()` + `topbarBtn()` helpers | — |
| `_lib/mocks.ts`    | Reusable `page.route()` handlers + sample diff | — |
| `_lib/worktree-repo.ts` | builds a throwaway git repo for the worktree journeys | — |

## Adding a test

1. Pick the journey file and decorate a `test.fixme` if you're stubbing,
   or `test(...)` if you're implementing.
2. Use the `test` and helpers from `./_lib/fixtures`. Default `visit()`
   already mocks `/api/health` healthy, an empty auth list, and seeds
   `localStorage["shippable:anthropic:skip"]=true` so you land in the
   workspace (opt out with `{ skipAnthropic: false }`).
3. Per-endpoint mocks live in `./_lib/mocks.ts` — extend it rather than
   re-rolling JSON in each test. Tests that override an already-mocked
   route should call `page.unroute("**/api/...")` first.
4. Use selectors matching `docs/usability-test.md`'s Expects (most BEM
   class names there are stable identifiers, e.g. `.boot-gate__h`,
   `.plan__headline`, `.modal__wt-row`). For topbar actions use the
   `topbarBtn()` helper — `TopbarActions` keeps a hidden measurement clone
   of every item, so a bare `.topbar__btn` locator matches two elements.
5. Endpoints the real `server/` handles hermetically (worktrees, the
   rule-based plan) are *not* mocked — let them hit the server. For
   worktree journeys, `_lib/worktree-repo.ts` builds a real throwaway git
   repo on disk; create it in `beforeAll`, clean it up in `afterAll`.

## Why not just keep extending `scripts/smoke-*.mjs`?

The smoke runner is great for ~10 ad-hoc screen probes and we keep
running it. But the usability script has ~30+ automatable expectations
across six journeys; each smoke file is a single linear script with
ad-hoc throws, no isolation between cases, and no per-failure trace.
`@playwright/test` gives us `test.describe` grouping, per-test isolated
contexts, html traces on failure, fixture composition, and parallel
execution if we eventually need it.

The two suites are complementary, not redundant:

- `npm run test:smoke` — boot gate + code-runner sandbox probes
  (the rule-based plan flow lives here historically; we may migrate it).
- `npm run test:e2e` — usability-test journeys, one file each.

## Limitations

- Folder-picker, FindBar, webview-zoom, packaged DMG behaviour are
  `[manual]` — they need a real Tauri shell and stay in
  `docs/usability-test.md`'s manual track.
- We don't currently mock `/api/github/*` endpoints; Journey 3 is fixme
  until those land. The shape of the mocks should mirror what's in
  `server/src/index.test.ts`.
- We use `channel: "chrome"` instead of playwright's bundled chromium
  to match the smokes and avoid the install step in dev environments
  that already have Chrome.
