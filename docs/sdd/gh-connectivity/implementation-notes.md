# Implementation Notes — gh-connectivity v0

Implementation followed the spec closely. A handful of small deviations and surprises worth recording for future readers and for the eventual push-back SDD.

## Deviations from spec

### Web API helper names

- **Spec said:** `postGithubAuthSet`, `postGithubAuthClear`, `postGithubAuthHas`, `postGithubPrLoad`.
- **Implementation does:** `setGithubToken`, `clearGithubToken`, `hasGithubToken`, `loadGithubPr`, `lookupPrForBranch`. Plus the discriminated `GithubFetchError` class.
- **Reason:** the action-oriented names (`setGithubToken`) read more naturally at call sites than the verb-prefixed `postGithubAuthSet`. Spec compliance review confirmed the rename is an improvement.
- **Impact:** none — internal API only. The wire endpoints (`POST /api/github/auth/set` etc.) match the spec exactly.

### `clearGithubToken` and `hasGithubToken` not exported

- **Spec said:** all four wrappers (`set`, `clear`, `has`, `load`) exported.
- **Implementation does:** only `setGithubToken` and `loadGithubPr` are exported. `clearGithubToken` and `hasGithubToken` were removed during slice-3 review (no callers; AGENTS.md "no premature abstraction").
- **Reason:** the Tauri Keychain rehydrate flow uses `keychainGet` from `web/src/keychain.ts` (the Keychain primitives), not `hasGithubToken`. The web app never asks the server "do you have a token?" because the server tells it via the `github_token_required` discriminator on `pr/load`.
- **Impact:** when the push-back SDD or a future settings UI needs `clearGithubToken`, it can be re-exported then. The server endpoints `POST /api/github/auth/clear` and `POST /api/github/auth/has` exist and work.

### `ChangesetHeader.tsx` does not exist

- **Spec said:** `web/src/components/ChangesetHeader.tsx` (or actual file — confirm at impl).
- **Implementation does:** the PR title / state badge / refresh button / truncation banner / auth-rejected banner all live in `web/src/components/ReviewWorkspace.tsx`'s existing `<header className="topbar">` (a new `PrTopbarMeta` component covers the prSource branch).
- **Reason:** there's no separate header component in the codebase; the topbar in `ReviewWorkspace.tsx` is where `cs.title`, `cs.branch`, `cs.author` already render.
- **Impact:** none — the spec explicitly anticipated this.

### Truncation detection method

- **Spec said:** "When GitHub flags the diff as truncated (response `incomplete_results: true` on `/files`, or files-list shorter than the response total)".
- **Implementation does:** compares `meta.changed_files` (from the PR metadata response) against the count of files actually returned from the paginated `/files` endpoint. Sets `prSource.truncation = { kind: "files", reason }` when they disagree.
- **Reason:** GitHub's `pulls/{n}/files` response is a bare array — `incomplete_results` doesn't exist on this endpoint (it lives on the search APIs). `meta.changed_files` is the authoritative count and is already being fetched.
- **Impact:** matches the spirit of the spec (file-count truncation is detected); the `kind: "patch"` form (per-file patch text truncation) is logged as a follow-up in the spec's Out of Scope.

### `tsconfig.json` change

- **Spec said:** the server reuses `parseDiff` from `web/src/parseDiff.ts`.
- **Implementation does:** the server's `tsconfig.json` was extended to `include` `web/src/parseDiff.ts` and `web/src/codeGraph.ts` so `tsc --noEmit` accepts the cross-package import.
- **Reason:** the existing `tsconfig.json` already includes `web/src/types.ts` and other web TS files for the same kind of cross-package consumption. Adding two more is consistent with the established pattern. The alternative (a shared `types/` package or a published library) is premature for one consumer.
- **Impact:** none for runtime; minor for tooling (server typecheck now reads two more files). No new install / build steps.

### `web/src/keychain.ts` extracted

- **Spec said:** Tauri-vs-browser branch follows `useApiKey.ts` precedent.
- **Implementation does:** new `web/src/keychain.ts` exports `isTauri`, `keychainGet`, `keychainSet`. The slice-3 sites (`LoadModal.tsx`, `ReviewWorkspace.tsx`) use this module rather than redefining `isTauri` locally.
- **Reason:** the new sites would otherwise duplicate the three-line `isTauri` helper a third and fourth time. Code-quality review flagged this as a real concern. Pre-existing copies in `apiUrl.ts` and `useApiKey.ts` were left alone (out of scope per AGENTS.md "don't restructure things outside your task").
- **Impact:** small follow-up exists to migrate `apiUrl.ts` and `useApiKey.ts` to the shared module — not required for v0.

### Slice-1 commit count

- **User preference said:** one commit per slice.
- **Implementation does:** slices 2–5 are each one commit. Slice 1 is four commits (three subtask commits + a review-fix commit) because the per-slice grouping preference came in *after* slice 1 had landed with subtask commits, and rewriting history retroactively was unnecessarily destructive.
- **Reason:** user explicitly said "Perhaps we could group them in a single commit though" as forward-looking guidance, not a directive to rewrite slice 1.
- **Impact:** slightly noisier `git log` for slice 1; everything else is clean. The aggregate work on this branch is 8 commits; rebasing to 5 before opening a PR is a one-command operation if cleanliness matters at that boundary. (After the rebase the branch ended up at 5 slice commits + 2 follow-up fix commits.)

### Welcome.tsx — missed sibling load surface

- **Spec said:** "PR URL paste ingest. A LoadModal affordance accepts `https://<host>/<owner>/<repo>/pull/<n>`…"
- **Implementation does:** slice 3 added the section to `LoadModal.tsx` only. `web/src/components/Welcome.tsx` is a *separate* load surface — the empty-state landing page shown before any changeset is loaded — and was missed. Fresh-launch users had no way to reach the GH PR ingest path until they loaded some other diff first. Fixed in a follow-up commit (`fix(web): add GitHub PR section to Welcome`).
- **Reason:** the plan listed file paths under slice 3 but didn't enumerate every load surface; the spec said "LoadModal" and the implementer matched it literally; all six final reviewers (architecture / design / UX / security / spec compliance / codebase synergy) verified against `LoadModal.tsx` and missed Welcome too.
- **Impact:** caught during user testing, fixed before merge. Lesson for future ingest-path additions: grep the codebase for *all* `loadFromUrl`-style entry points (Welcome, LoadModal, anywhere else that lets a user start a review), not just the canonical modal.

## Notes worth recording

- **Web testing in this devcontainer.** The `web/` workspace's `vitest` requires the native `@rolldown/binding-linux-arm64-gnu` package. It was missing on first run; `npm i --no-save @rolldown/binding-linux-arm64-gnu` from `/workspace/web` recovers it. Permanent fix is to add it to `optionalDependencies`, but that's a devcontainer concern, not a feature change.
- **`web/` has no `typecheck` script** in `package.json`. TypeScript is checked at build time (`vite` runs `tsc -b`), but there's no standalone `npm run typecheck`. Subagents discovered this when trying to verify slice 5. Not a blocker — `tsc -b` works directly — but worth knowing. Adding a `"typecheck": "tsc -b"` line is a separate trivial change.
- **`web/` build fails on `lightningcss`** in this devcontainer for the same `linux-arm64-gnu.node` reason as `rolldown`. Tests and lint are unaffected. The bundled Tauri build will hit the same issue if it runs from this container; production / Mac builds are fine.
- **No `Co-Authored-By` trailers** anywhere — AGENTS.md says no.
- **`PrCoords` exists in two places.** `server/src/github/url.ts` and `server/src/github/pr-load.ts` both originally exported one; slice-2 review consolidated them into a single shared definition (`url.ts` is now the source). Watch for accidental re-introduction.
- **`PrMatch` is duplicated across server (`branch-lookup.ts`) and web (`githubPrClient.ts`)** because the monorepo doesn't share types from `server/` to `web/` — it only goes the other way (`web/src/types.ts` → `server/`). The two definitions are structurally identical; a future shared-types refactor could absorb both, but that's not slice-bound work.
- **Pill-click auth-error path reuses the slice-3 token modal** via a new `onAuthError` prop on `Inspector.tsx`. The existing `prRefreshTokenModal` state in `ReviewWorkspace.tsx` was generalized with an optional `pendingAction: () => Promise<void>` so the topbar refresh and the pill click share one modal.

## Test coverage at end of branch

- Server: 205 passing (was 144 before the feature; +61 net). Five new test files (`url.test.ts`, `auth-store.test.ts`, `api-client.test.ts`, `pr-load.test.ts`, `branch-lookup.test.ts`) plus integration coverage in `index.test.ts`.
- Web: 309 passing (was 269 before the feature; +40 net). New test files: `githubPrClient.test.ts`, `GitHubTokenModal.test.tsx`, `LoadModal.test.tsx`, `Inspector.test.tsx` (PR-pill specific cases), `Welcome.test.tsx` (PR section), plus additions to `state.test.ts` for `MERGE_PR_OVERLAY` / cursor-preserve and to `ReviewWorkspace.test.tsx` for the topbar / banners / refresh flow.

## Open follow-ups (not v0)

These are documented in the spec § Out of Scope and / or surfaced by reviewers during implementation. They do **not** block v0 shipping.

- **Migrate `apiUrl.ts` and `useApiKey.ts` to `web/src/keychain.ts` helpers.** Removes two more `isTauri()` definitions.
- **Strip credentials from HTTPS remote `tokenRequiredForHost` responses.** Already stripped at parse time (slice-4 fix); confirm no other code path leaks `user:pass@host`.
- **Idempotency on `setToken`.** Re-entering the same token issues a second `auth/set`; not user-visible, but a cheap no-op short-circuit on equal values would tidy the wire.
- **Patch-level truncation** (`prSource.truncation.kind === "patch"`). A PR may have all files but a single-file patch may be truncated. v0 doesn't surface this.
- **Multi-PR match for one branch.** Branch-lookup returns the first open PR; if a worktree's branch backs multiple open PRs (unusual), only one renders. Document or pick the most-recent.
- **HTTPS remotes with embedded credentials.** Slice 4 strips `user:pass@` from the parsed host. Worth a security-review pass if private-repo deployments pick up steam.
- **Settings UI for token management.** `clearGithubToken` and `hasGithubToken` server endpoints exist and are tested; the UI to invoke them does not. Lands when a real workflow needs it.
- **Shared `humanAgo` / `timeAgo`.** Now duplicated in `Inspector.tsx`, `AgentContextSection.tsx`, and `ReplyThread.tsx`. Cleanup target.
- **Rate-limit visualization.** A "rate limit: 4321/5000" pill is on the spec's follow-up list.
- **`onLoad` signature drift between Welcome and LoadModal.** `Welcome.tsx` calls `onLoad(cs, replies, source)` (3 args); `LoadModal.tsx` calls `onLoad(cs, source)` (2 args). The Welcome PR-ingest fix matched the existing Welcome shape correctly, but the inconsistency is real and worth aligning when next touching either file.
