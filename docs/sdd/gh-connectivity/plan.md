# Implementation Plan: GH Connectivity

Based on: docs/sdd/gh-connectivity/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan slice-by-slice. Within each slice, follow superpowers:test-driven-development for the subtasks.

Five slices. Each slice ends in a verifiable, demonstrable state. Subtasks within a slice are TDD-shaped and can land in separate commits or be bundled per the conventional commit style in `git log`.

## Slice 1: GitHub URL parsing + per-host auth foundation

*Outcome: server can identify a PR from any github.com / GHE URL and remembers a token per host. No PR data fetched yet.*

- **Files (slice):** `server/src/github/url.ts`, `server/src/github/url.test.ts`, `server/src/github/auth-store.ts`, `server/src/github/auth-store.test.ts`, `server/src/index.ts`, `server/src/index.test.ts`
- **Verify (slice end):** unit + endpoint tests green; `curl -X POST localhost:<port>/api/github/auth/set -d '{"host":"github.com","token":"x"}'` round-trips through `has` and `clear`.

### Subtasks

**1a. URL parser.**
1. Write tests in `server/src/github/url.test.ts` covering: bare github.com URL, GHE host, trailing slash, query string, anchor, malformed URL (no `pull/<n>` segment), non-`pull` segment (e.g., `issues/<n>`), URL with extra path segments after `<n>`. Verify each fails with the not-yet-written `parsePrUrl`.
2. Implement `parsePrUrl(input)` in `server/src/github/url.ts` returning `{ host, owner, repo, number, apiBaseUrl, htmlUrl }`. Implement `resolveApiBase(host)` (`github.com` → `https://api.github.com`; else `https://<host>/api/v3`). Throw a structured error on malformed input.
3. Verify tests pass.
4. Commit.

**1b. Per-host token store.**
1. Write tests in `server/src/github/auth-store.test.ts`: `setToken/has/get/clear` round-trip; host normalization (lowercase); reject `localhost` / private-IP-like values defensively.
2. Implement `auth-store.ts` as an in-memory `Map<string, string>` with the four operations.
3. Verify tests pass.
4. Commit.

**1c. Auth endpoints.**
1. Add tests in `server/src/index.test.ts` for `POST /api/github/auth/{set,clear,has}` covering happy path, missing-body, opaque-origin denial.
2. Register the three endpoints in `server/src/index.ts` inside the existing origin-classification path. Body keys `{ host, token }`. `has` returns `{ has: boolean }`.
3. Verify tests pass; spot-check via `curl`.
4. Commit.

## Slice 2: PR data ingest (server end-to-end)

*Outcome: `POST /api/github/pr/load { prUrl }` returns a complete `ChangeSet` with diff, metadata, line-anchored review comments, and conversation. Browser-tested via curl.*

- **Files (slice):** `web/src/types.ts`, `server/src/github/api-client.ts`, `server/src/github/api-client.test.ts`, `server/src/github/pr-load.ts`, `server/src/github/pr-load.test.ts`, `server/src/index.ts`, `server/src/index.test.ts`
- **Verify (slice end):** with a PAT set via `auth/set`, `curl POST /api/github/pr/load { prUrl: "<a real public PR URL>" }` returns a parseable ChangeSet with hunks, line `prReviewComments`, and `prConversation`.

### Subtasks

**2a. Data-model types.**
1. Add `PrSource`, `PrConversationItem`, `PrReviewComment` to `web/src/types.ts`. Extend `ChangeSet` with optional `prSource` and `prConversation`. Extend `DiffLine` with optional `prReviewComments`.
2. Run `npm run typecheck` in both `web/` and `server/`. Fix any new type errors (ideally none — fields are all optional).
3. Verify existing tests still pass.
4. Commit.

**2b. GitHub API client wrapper.**
1. Write tests in `server/src/github/api-client.test.ts` against a mocked `fetch`: auth header injection, version + accept headers, `Link: rel="next"` pagination iterator, error normalization (`401` → `github_token_required`-shape, `403` rate-limit hint, `404` → `github_pr_not_found`, 5xx → `github_upstream`).
2. Implement `githubFetch(apiBaseUrl, path, { token, method?, body? })` and `githubFetchAll(...)` in `server/src/github/api-client.ts`.
3. Verify tests pass.
4. Commit.

**2c. Bundled PR load orchestrator.**
1. Write tests in `server/src/github/pr-load.test.ts` with `fetch` stubbed to return canned `pulls/{n}`, `pulls/{n}/files`, `pulls/{n}/comments`, `issues/{n}/comments` payloads. Cover: happy path, multi-file diff, line-comment match by `(path, line)`, multi-line comment span fallback (renders under highest line), truncation flag → `prSource.truncation`.
2. Implement `loadPr({ host, owner, repo, number }, token)` in `server/src/github/pr-load.ts`: parallel fetches, parse per-file `patch` strings into `DiffFile[]`/`Hunk[]`/`DiffLine[]` (reusing the diff parser shape — extract a server-side helper if needed), assemble `ChangeSet` with id `"pr:<host>:<owner>:<repo>:<number>"`.
3. Verify tests pass.
4. Commit.

**2d. PR load endpoint.**
1. Add tests in `server/src/index.test.ts` for `POST /api/github/pr/load { prUrl }`: token-missing returns `401 { error: "github_token_required", host }`; happy path returns `{ changeSet }`; malformed URL returns 400; upstream error pass-through preserves discriminator.
2. Register the endpoint in `server/src/index.ts`: `parsePrUrl` → `auth-store.get` → `loadPr` → respond.
3. Verify tests pass; smoke-test against a real public PR with a PAT.
4. Commit.

## Slice 3: PR ingest UI (paste → review)

*Outcome: a user can paste a PR URL into LoadModal, get prompted for a PAT on first use of a host, and see the diff with line-anchored PR comments + PR conversation rendered. Refresh + auth-rejected re-prompt work end-to-end.*

- **Files (slice):** `web/src/apiUrl.ts`, `web/src/components/GitHubTokenModal.tsx`, `web/src/components/GitHubTokenModal.test.tsx`, `web/src/components/LoadModal.tsx`, `web/src/components/LoadModal.test.tsx` (if exists; else create), `web/src/components/ChangesetHeader.tsx` (or actual file — confirm at impl), `web/src/components/Inspector.tsx`, `web/src/state.ts` (or wherever `ReviewState` reducers + actions live)
- **Verify (slice end):** in browser dev mode, paste a real public PR URL → token prompt → load → diff renders → comments threaded under hunks → refresh button reloads → revoking the PAT and refreshing surfaces the "Re-enter token" banner. `npm run lint` + `npm run typecheck` + `npm run test` clean.

### Subtasks

**3a. API helpers.**
1. Add typed wrappers in `web/src/apiUrl.ts` (or sibling module — match the existing API helper convention found in the file): `postGithubAuthSet`, `postGithubAuthClear`, `postGithubAuthHas`, `postGithubPrLoad`. Each returns either the typed success body or a structured error matching the server's discriminator.
2. Write a small unit test (mocked `fetch`) confirming a `github_token_required` 401 surfaces as a typed result rather than a thrown error — the calling UI needs to branch on it.
3. Verify tests pass.
4. Commit.

**3b. Token modal component.**
1. Write `web/src/components/GitHubTokenModal.test.tsx`: renders, masked input, submit triggers `keychain_set` (Tauri-mocked) + `postGithubAuthSet` and resolves with the entered token; cancel rejects.
2. Implement `web/src/components/GitHubTokenModal.tsx`. Tauri-vs-browser branch follows the `useApiKey.ts` precedent (browser dev: skip Keychain, just call `auth/set`).
3. Verify tests pass.
4. Commit.

**3c. LoadModal "From a GitHub PR" tab.**
1. Extend the LoadModal tests to cover: new tab renders; submit calls `postGithubPrLoad`; `github_token_required` opens `GitHubTokenModal` and retries on resolve; success dispatches `LOAD_CHANGESET`.
2. Add the tab to `web/src/components/LoadModal.tsx` with a single PR-URL input and a "Load PR" button.
3. Verify tests pass and smoke-test in the browser.
4. Commit.

**3d. Changeset header for `prSource`.**
1. Locate the actual changeset-header component (likely under `web/src/components/`). Add tests covering: `prSource` present → renders title, state badge (open/closed/merged), base→head refs, "Last fetched HH:MM", Refresh button; `prSource.truncation` present → renders banner; Refresh click triggers `postGithubPrLoad` for the same URL and dispatches the result.
2. Implement the header changes.
3. Verify tests pass; visually confirm in the browser.
4. Commit.

**3e. Inspector PR comment rendering.**
1. Add tests to `Inspector.tsx`'s test suite (or sibling): each `DiffLine.prReviewComments[]` renders a small read-only "PR review" subsection alongside any `aiNote`; `prConversation` non-empty surfaces as a "PR conversation (N)" disclosure in the header overview area.
2. Implement the rendering. Re-use existing inline-note styling where it fits — these are read-only annotations.
3. Verify tests pass; visually confirm.
4. Commit.

**3f. Auth-rejected re-prompt path.**
1. Add reducer/handler tests for the `github_auth_failed` response (after token had been working): banner appears with "Re-enter token" affordance; click re-opens `GitHubTokenModal`; success retries the in-flight `pr/load`.
2. Implement in `web/src/state.ts` (or wherever the load flow lives).
3. Verify tests pass; manual repro by `auth/clear`-ing a host's token and refreshing.
4. Commit.

## Slice 4: Worktree ↔ PR overlay

*Outcome: opening a worktree whose branch has an open upstream PR shows a "Matching PR: #N — Title" pill; clicking overlays metadata + PR comments without touching the local diff.*

- **Files (slice):** `server/src/github/branch-lookup.ts`, `server/src/github/branch-lookup.test.ts`, `server/src/index.ts`, `server/src/index.test.ts`, `web/src/state.ts`, `web/src/components/Inspector.tsx`, `web/src/apiUrl.ts`
- **Verify (slice end):** on a worktree whose `origin` remote is a GitHub repo and whose branch has an open PR, the pill appears; click overlays comments; the local diff is preserved; `worktreeSource` and `prSource` co-exist on the same `ChangeSet`.

### Subtasks

**4a. Branch lookup (server-side).**
1. Write tests in `server/src/github/branch-lookup.test.ts` against tmpdir worktree fixtures: `assertGitDir` validation; `git remote get-url origin` parsing for HTTPS and SSH remotes (`git@github.com:owner/repo.git`); first-match-wins semantics; non-GitHub remote returns `null`; no open PR returns `null`.
2. Implement `lookupPrForBranch(worktreePath, token)` in `server/src/github/branch-lookup.ts`: validate path → `execFile('git', ['remote', '-v'])` → parse → `pulls?head=<owner>:<branch>&state=open` → return first match or null.
3. Verify tests pass.
4. Commit.

**4b. Branch lookup endpoint.**
1. Add tests in `server/src/index.test.ts` for `POST /api/github/pr/branch-lookup { worktreePath }`: happy path, no-PR null, no-GitHub-remote null, token-missing path returns `github_token_required` with the inferred host.
2. Register the endpoint, mirroring the `pr/load` token handshake.
3. Verify tests pass.
4. Commit.

**4c. Overlay merge reducer.**
1. Add tests for `mergePrOverlay(prSource, conversation, lineCommentsByPathLine)`: preserves `worktreeSource` and `files[]`; sets `prSource`; sets `prConversation`; walks the comment map and attaches matching `DiffLine.prReviewComments`; silently drops comments whose `(path, line)` doesn't match a line in the local diff.
2. Implement in `web/src/state.ts`.
3. Add `postGithubPrBranchLookup` helper in `web/src/apiUrl.ts`.
4. Verify tests pass.
5. Commit.

**4d. Worktree↔PR pill UI.**
1. Add tests in `Inspector.tsx`'s test suite: on `worktreeSource` mount, fires `postGithubPrBranchLookup`; on `{ matched }` renders a pill with title + #N; click triggers `postGithubPrLoad` (same path as Slice 3) and dispatches `mergePrOverlay`. On `{ matched: null }` or error, renders nothing.
2. Implement the pill (location: existing worktree-source-aware area in `Inspector.tsx`).
3. Verify tests pass; manual repro on a real worktree with an open PR upstream.
4. Commit.

## Slice 5: Docs & wrap-up

*Outcome: feature documented in the right places. Final lint/typecheck/test pass.*

- **Files (slice):** `docs/concepts/server-api-boundary.md`, `docs/architecture.md`, `docs/ROADMAP.md`, `docs/concepts/changeset-hierarchy.md`, `docs/features/github-pr-ingest.md`, `README.md`
- **Verify (slice end):** `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all clean across `web/` and `server/`. Visual readthrough of the doc pages.

### Subtasks

**5a. Concept + architecture updates.**
1. `docs/concepts/server-api-boundary.md`: add `/api/github/*` to the surface list; cross-link the spec.
2. `docs/architecture.md`: list PRs as a fourth ingest path alongside URL/upload/paste/worktree.
3. `docs/concepts/changeset-hierarchy.md`: note that `worktreeSource` and `prSource` may co-exist on the same `ChangeSet`.
4. Commit.

**5b. ROADMAP cross-link.**
1. `docs/ROADMAP.md`: flip "GitHub ingest, prototype" to in-progress under 0.2.0 connectivity; cross-link the spec.
2. Commit.

**5c. README PAT setup.**
1. `README.md`: short section under setup or Backend describing PAT creation, scopes (`repo` for private), and the `service=shippable, account=GITHUB_TOKEN:<host>` Keychain entries.
2. Commit.

**5d. Feature doc.**
1. Add `docs/features/github-pr-ingest.md` paired with `feature-docs.html`. Include a screenshot or short walk-through, the worktree-pill behavior, and the v0 limitations (no expand-context, no posting back, manual refresh).
2. Run `npm run build` in `web/`; visually verify the feature doc renders.
3. Commit.

---

## Dependencies (DAG)

```
1a ─┐
1b ─┼──> 1c ──> 2d ──> 3a ──> 3b ──> 3c ──> 3d ──> 3e ──> 3f
2a ─┘                                       │
                                            └──> 4c ──┐
2b ──> 2c ──> 2d                                       │
                                                      4d
1a, 1c ──────> 2d                              4a ──> 4b ──┘
                              5a, 5b, 5c, 5d (after 4d)
```

## Verification Checklist (apply at slice boundaries)

- After Slice 1: server unit tests + `index.test.ts` green.
- After Slice 2: `curl` round-trip from a real public PR (with a PAT in `auth-store`).
- After Slice 3: browser dev-mode end-to-end: paste, prompt, load, refresh, auth-rejected re-prompt.
- After Slice 4: worktree-with-PR end-to-end: pill, overlay, `worktreeSource` + `prSource` co-exist.
- After Slice 5: `npm run lint && npm run typecheck && npm run test && npm run build` in both packages.
