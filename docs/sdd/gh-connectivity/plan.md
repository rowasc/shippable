# Implementation Plan: GH Connectivity

Based on: docs/sdd/gh-connectivity/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan slice-by-slice. Within each slice, follow superpowers:test-driven-development for the subtasks.

Six slices. Each slice ends in a verifiable, demonstrable state. Subtasks within a slice are TDD-shaped and can land in separate commits or be bundled per the conventional commit style in `git log`.

> **Slices 1–5 are shipped (v0).** Slice 6 is the post-v0 cleanup driven by real-world testing: PR review comments rendered as first-class `Reply` / `DetachedReply` entries (replacing the v0 line-annotation surface), HTTPS proxy support for outbound GitHub calls, and unification of the Welcome + LoadModal load surfaces. The spec has been updated in place to reflect the chosen design; this plan adds Slice 6 alongside the earlier slices for traceability.

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

## Slice 6: Replies-and-detached, proxy, unified loader (post-v0)

*Outcome: PR review comments render through the same surface as user comments and AI-note replies. Outdated PR comments use the existing detached-comments feature. The server honors `HTTPS_PROXY`. Welcome and LoadModal share a single load implementation, and the diff-URL and PR-URL inputs are merged into one.*

This slice rewrites the v0 PR-comment surface (`DiffLine.prReviewComments` + `PrReviewCommentsSection` + gutter glyph) and folds three duplicated load implementations into one. The data-on-the-wire from `pr/load` changes shape (returning a `{ changeSet, prReplies, prDetached }` triple) but the endpoint name, auth flow, and overall feature behavior are stable.

- **Files (slice):**
  - Server: `server/src/proxy.ts` (new), `server/src/proxy.test.ts` (new), `server/src/github/api-client.ts` (modify), `server/src/github/api-client.test.ts` (modify), `server/src/github/pr-load.ts` (modify), `server/src/github/pr-load.test.ts` (modify), `server/src/index.ts` (modify, response shape), `server/src/index.test.ts` (modify).
  - Web: `web/src/types.ts` (drop `PrReviewComment` + `prReviewComments`; add `Reply.external`), `web/src/loadSurface.ts` (new hook), `web/src/components/Welcome.tsx` (modify), `web/src/components/LoadModal.tsx` (modify), `web/src/components/ReviewWorkspace.tsx` (refresh path uses the hook), `web/src/components/Inspector.tsx` (drop `PrReviewCommentsSection`), `web/src/components/DiffView.tsx` (drop `line--has-pr-comment`), `web/src/components/ReplyThread.tsx` (modify, "open on GitHub" + suppress local affordances), `web/src/state.ts` (rework `MERGE_PR_OVERLAY`, add `MERGE_PR_REPLIES`, drop `prReviewComments` walks), `web/src/persist.ts` (filter `external` replies on save), `web/src/githubPrClient.ts` (modify, new response shape), `web/src/view.ts` (drop `prCommentCount`).
  - Docs: `docs/sdd/gh-connectivity/implementation-notes.md` (cross-link the rewrite), `README.md` (`HTTPS_PROXY` note), `docs/features/github-pr-ingest.md` (refresh).
- **Verify (slice end):** end-to-end on a PR with line comments, multi-line comments, and at least one outdated comment: matched comments appear under hunks via `ReplyThread` (with the "↗ open on GitHub" link and no enqueue affordance), outdated comments appear in the Sidebar "Detached" section with their original-line context, refreshing the PR doesn't accumulate duplicates. With `HTTPS_PROXY=http://…` set, the server reaches a GHE PR. Welcome and LoadModal render the same loader behavior; pasting a `pull/<n>` URL into the unified field routes through `pr/load`, pasting a `.diff` URL fetches directly. `npm run lint && npm run typecheck && npm run test && npm run build` clean.

### Subtasks

**6a. Proxy plumbing.**
1. Write tests in `server/src/proxy.test.ts`: returns `undefined` when env vars unset; returns a `ProxyAgent` for valid `HTTPS_PROXY`; case-insensitive (`https_proxy` works); malformed URL logs once and returns `undefined` (no throw).
2. Implement `server/src/proxy.ts` with `getDispatcher()` (memoized after first call). Use `undici`'s `ProxyAgent`.
3. Wire `dispatcher: getDispatcher()` into the `fetch()` call inside `server/src/github/api-client.ts`. Add a unit test in `api-client.test.ts` that asserts the dispatcher is forwarded to fetch (mock `fetch`, inspect options).
4. README: short `HTTPS_PROXY` paragraph in the PAT-setup section.
5. Commit.

**6b. `Reply.external` field + persist filter.**
1. Tests in `web/src/persist.test.ts`: a snapshot containing replies tagged `external.source === "pr"` (in both `replies` and `detachedReplies`) round-trips through save→load with those entries dropped on save; non-external replies survive.
2. Add the optional `external?: { source: "pr"; htmlUrl: string }` field to `Reply` in `web/src/types.ts`.
3. Update the persist layer's serializer to filter external replies. The `ReviewState` shape in memory can still hold them; persistence drops them.
4. Verify tests pass.
5. Commit.

**6c. `pr/load` server response shape: `{ changeSet, prReplies, prDetached }`.**
1. Update `server/src/github/pr-load.test.ts` to assert the new shape: matched single-line comment → `Reply` keyed `user:<hunkId>:<lineIdx>` with `external` set; matched multi-line → keyed `block:<hunkId>:<lo>-<hi>`; outdated comment (`line: null`) → `DetachedReply` with `anchorPath`, `anchorLineNo = original_line`, `anchorContext` from `comment.diff_hunk` (parsed into `DiffLine[]`), `originType: "committed"`, `originSha = comment.original_commit_id`. No `prReviewComments` walks; the loader does not write to `DiffLine`.
2. Reshape `loadPr` in `server/src/github/pr-load.ts` to compute `prReplies` / `prDetached` directly. Reuse the existing line-index helper for the matched bucket; skip when `comment.line === null` and route to the detached bucket. Helper to parse `diff_hunk` strings into `DiffLine[]` (the same format `parseDiff` consumes).
3. Update `server/src/index.ts` `pr/load` to return `{ changeSet, prReplies, prDetached }` instead of just `{ changeSet }`. Update `server/src/index.test.ts` accordingly.
4. Verify tests pass; smoke-test against a real PR with at least one outdated comment.
5. Commit.

**6d. Web side: `MERGE_PR_REPLIES` reducer + Inspector cleanup.**
1. Tests in `web/src/state.test.ts` for `MERGE_PR_REPLIES`: installs new external replies; preserves user replies; refresh-with-different-comments removes prior external entries and installs the new set; idempotent under double-dispatch.
2. Implement `MERGE_PR_REPLIES` in `web/src/state.ts`. Update `MERGE_PR_OVERLAY` to only carry `prSource` + `prConversation` (no reply walking).
3. Update `web/src/githubPrClient.ts` to surface `prReplies` / `prDetached` from the new `pr/load` response.
4. Update `web/src/components/Inspector.tsx` to remove the `PrReviewCommentsSection` import and the `prReviewComments` prop. Verify `prConversation` rendering survives.
5. Update `web/src/components/DiffView.tsx` to remove `line--has-pr-comment` and the count glyph; the existing `hasUserComment` glyph already lights up because PR replies live under the same line key.
6. Drop `prCommentCount` from `web/src/view.ts`.
7. Drop the `prReviewComments?: PrReviewComment[]` field on `DiffLine` and the `PrReviewComment` interface from `web/src/types.ts`.
8. Verify `npm run typecheck && npm run lint && npm run test` pass; visually confirm matched + outdated comments render correctly.
9. Commit.

**6e. `ReplyThread` "open on GitHub" + suppressed local affordances.**
1. Tests in `web/src/components/ReplyThread.test.tsx`: a reply with `external?.source === "pr"` shows an "↗ open on GitHub" link pointing at `external.htmlUrl`, suppresses the enqueue / agent-reply UI, and is non-deletable. Non-external replies are unchanged.
2. Implement the conditional in `ReplyThread.tsx`.
3. Verify tests pass; visually confirm.
4. Commit.

**6f. Unified `useLoadSurface()` hook + Welcome/LoadModal merge.**
1. Tests in `web/src/loadSurface.test.tsx`: render the hook in a probe component; cover URL detection (`pull/<n>` → `loadGithubPr`; `.diff` → direct `fetch`); GitHub-PR token-required flow (Tauri keychain rehydrate + retry; non-Tauri prompt + retry); auth-rejected re-prompt path.
2. Extract `web/src/loadSurface.ts` consolidating the load handlers + state from `Welcome.tsx`, `LoadModal.tsx`, and `ReviewWorkspace.tsx`'s PR-refresh path.
3. Replace the Welcome implementation: render the hook's affordances (URL field, file drop, paste, worktree picker, GitHub PR — but the PR input is folded into the URL field). Keep the empty-state chrome (recents, samples, hero) at the Welcome level only.
4. Replace the LoadModal implementation: same hook, modal chrome.
5. Replace `ReviewWorkspace.tsx` PR-refresh: same hook.
6. Test plan: open Welcome, paste a `pull/<n>` URL, confirm the GH flow runs; paste a `.diff` URL, confirm direct fetch runs. Open LoadModal from inside the workspace, repeat. Refresh a loaded PR, confirm it goes through the hook.
7. Commit.

**6g. Wrap-up.**
1. Update `docs/sdd/gh-connectivity/implementation-notes.md` describing the v0→Slice-6 pivot (replies-and-detached, why we replaced the annotation surface).
2. Refresh `docs/features/github-pr-ingest.md` to describe the current behavior.
3. Final `npm run lint && npm run typecheck && npm run test && npm run build` across both packages.
4. Commit.

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

  Slice 6 (post-v0, after slices 1–5 land):
    6a (proxy)            ──┐
    6b (Reply.external)   ──┤
    6c (server response)  ──┼──> 6d (web reducer + Inspector cleanup) ──> 6e (ReplyThread external)
                            │                                              │
                            └──> 6f (unified loader, depends on 6d) ───────┘
                                                  │
                                                 6g (wrap-up docs)
```

## Verification Checklist (apply at slice boundaries)

- After Slice 1: server unit tests + `index.test.ts` green.
- After Slice 2: `curl` round-trip from a real public PR (with a PAT in `auth-store`).
- After Slice 3: browser dev-mode end-to-end: paste, prompt, load, refresh, auth-rejected re-prompt.
- After Slice 4: worktree-with-PR end-to-end: pill, overlay, `worktreeSource` + `prSource` co-exist.
- After Slice 5: `npm run lint && npm run typecheck && npm run test && npm run build` in both packages.
- After Slice 6: end-to-end on a PR with matched single-line, multi-line, and outdated comments — matched threads render through `ReplyThread`, outdated entries land in the Sidebar "Detached" section, refresh is idempotent. With `HTTPS_PROXY` set, a GHE PR loads. Welcome and LoadModal present the same loader behavior; one URL field handles both `pull/<n>` and `.diff` inputs. Lint/typecheck/test/build green.
