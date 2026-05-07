# GH Connectivity — Requirements

## Goal

Open a GitHub PR by URL, review it locally with the existing PR review comments visible inline, and persist the review across reloads. Read-only on this pass — the push-back direction (post review threads as PR comments) is a separate later SDD that pairs with the hosted backend.

## Requirements

1. **PR URL paste ingest.** A LoadModal affordance accepts `https://<host>/<owner>/<repo>/pull/<n>` and resolves it into a `ChangeSet`. The result carries a new `PrSource` provenance (sibling of the planned `WorktreeSource`) so downstream UI can branch behavior when needed.
2. **Eager per-host PAT auth.** Before any GitHub API request for a host, a token must be configured. The first time a URL for a new host is pasted, the user is prompted for a Personal Access Token. There is no anonymous fallback.
3. **Per-host token storage.** Tokens live in macOS Keychain alongside the Anthropic key, one entry per host (e.g., `service=shippable, account=GITHUB_TOKEN:<host>`). Re-entering a token replaces the existing entry. The web app never holds the PAT — every GitHub call is proxied through the local server.
4. **GHE host auto-detection.** Host parsed from the PR URL. `github.com` resolves to `https://api.github.com`; any other host is treated as GHE-style and uses `https://<host>/api/v3`.
5. **Loaded PR data — diff.** Server fetches the unified diff for the PR (e.g., `application/vnd.github.v3.diff` representation, or JSON `pulls/{n}/files` reassembled). The existing `parseDiff` path renders it.
6. **Loaded PR data — metadata.** Title, body (markdown), state (`open` / `closed` / `merged`), base sha, head sha, author, and target branch surfaced in the changeset header.
7. **Loaded PR data — review comments.** Existing line-anchored PR review comments fetched and rendered using the same in-app surface as user comments and AI notes (the existing `replies` map and `ReplyThread` rendering). PR comments are first-class threads keyed off `(file, line)` — not a separate annotation channel. Outdated PR comments (GitHub returns `line: null` because the line moved or vanished) are rendered as **detached comments** using the existing `DetachedReply` surface, so the user sees their original-line context and snippet without the in-diff anchor pretending to still match. General PR conversation comments (issue-level, not line-anchored) render in the changeset header / overview area.
8. **Closed/merged PRs are loadable.** The same flow accepts any PR regardless of state. State is shown in metadata; no behavior gate.
9. **Per-PR review-state persistence.** `ReviewState` for a PR is keyed by `(host, owner, repo, number)` and persisted in `localStorage` via the existing `persist.ts` round-trip. Reopening a previously-loaded PR rehydrates cursor, marks, dismissed guides, replies, etc.
10. **Refresh model.** Reopening a PR URL (or hitting a "Refresh" button in the changeset header) re-fetches diff + metadata + review comments. No background polling. The header surfaces "last fetched HH:MM" so the user knows their snapshot age.
11. **Worktree ↔ PR overlay (opt-in).** When a worktree is loaded and its current branch maps to an open PR upstream — looked up via `GET /repos/.../pulls?head=<owner>:<branch>&state=open` against the host inferred from the worktree's `origin` remote — surface a *"Matching PR: #N — <Title>"* pill. Click overlays the PR's title/description and review comments onto the worktree's local-diff `ChangeSet`. The local diff remains the source of truth (the user's checkout may be ahead of the upstream head).
12. **Capability surface.** PR ingest is API-only with no disk dependency, so it works in every server deployment mode. It does not gate on any `disk-allowed` capability flag. The worktree↔PR overlay UI rides on worktree ingest, which is itself disk-gated; the overlay naturally hides where the worktree tab itself is hidden.
13. **HTTPS proxy support.** The server's outbound calls to GitHub / GHE must honor a corporate proxy when one is configured via the standard `HTTPS_PROXY` / `https_proxy` env var (and `NO_PROXY` for exclusions). Many GHE deployments sit behind a network egress proxy; without proxy support the integration is unusable in those environments. Direct `fetch()` in Node does not honor these env vars by default; the implementation must wire a proxy dispatcher explicitly.
14. **Single load surface.** Welcome (the empty-state screen) and `LoadModal` (the in-workspace loader) must share a single ingest implementation — same affordances, same code path. Today they're parallel forks that already drifted (three near-duplicate copies of the GitHub-PR + token flow). Either component can wrap presentation chrome, but the load logic is one. New ingest paths land in one place.
15. **One URL field.** The "From a URL" and "From a GitHub PR" inputs collapse into a single URL field with server-side detection: `*/pull/<n>` HTML URLs route through `/api/github/pr/load`; raw `*.diff` / `*.patch` URLs (or any other URL) fall through to the existing direct-fetch path. The user pastes one URL; the loader figures out what it is.

## Constraints

- **Read-only.** v0 does not write anything to GitHub. No PR-comment posting, no PR review submission, no status checks.
- **Local server binds `127.0.0.1`.** Same posture as today; PATs travel only between server and GitHub.
- **Validation at the server boundary.** PR URL parsing, host normalization, and token presence are checked server-side before any outbound request (per AGENTS.md "trust the boundary").
- **Memory-only deployments must keep working.** Because v0 is API-only with no clone/checkout, PR ingest is compatible with the memory-only deployment mode AGENTS.md flags as a real near-term constraint.
- **Single PAT per host.** No multi-account on the same host in v0. Re-entering the token replaces it.
- **No background work.** No polling loops, no live updates. Refresh is user-driven.

## Out of Scope (logged as follow-ups)

- **Push-back (GitHub two-way).** Posting reviews / per-comment replies back as PR comments. Separate SDD; pairs with the hosted backend per the roadmap.
- **Expand-context above/below for remote PR files.** Either via on-demand `GET /repos/.../contents/{path}?ref=<sha>` or via a worktree-backed clone path. Out of v0; PRs simply omit the affordance for files that aren't on disk.
- **Worktree-backed PR ingest.** Cloning the PR's head into a managed cache + worktree to enable expand-context, symbol nav, runners, etc. Future feature; would need repo cache lifecycle, `git`-level auth wiring, and a `disk-allowed` capability gate.
- **"My PRs" / search list.** Browse PRs you authored or are requested as reviewer on. Cheaper alternative: a localStorage recents drawer of previously-loaded PRs. Both deferred.
- **GitHub App / OAuth auth.** PAT only in v0.
- **Check runs / CI status surface.** Deferred.
- **Auto-overlay on matched worktrees (option C).** v0 ships the opt-in pill; auto-overlay can be revisited if real users find the click annoying.
- **Background polling / live mode.** Romina is working on a live mode for the worktree/PR experience separately; v0 of gh-connectivity stays manual-refresh.
- **Multi-account on the same host.** Single PAT per host. If a real need surfaces, lift later.
- **Force-push reconciliation UX.** If the PR head sha moves between loads, v0 just re-fetches against the new head; we do not currently surface a "the PR moved under you" affordance.

## Open Questions

(For sdd-spec to resolve.)

- **Server-side cache shape.** Does the server hold an in-memory `Map<(host,owner,repo,number), PrSnapshot>` (mirroring the agent-queue pattern) so reloads within a single server session are cheap? Or is the server stateless and the web app drives every fetch? Probably the latter for v0 — simpler, and the localStorage layer already covers cross-reload identity.
- **PR review comments — surface choice.** Reuse the existing teammate-review rendering path under hunks (semantically closest), or introduce a new `kind: 'pr-review-comment'` discriminator and a sibling renderer? Reuse is the lighter answer; the discriminator question becomes meaningful only if we later need to distinguish "from-GitHub" replies from teammate replies in the UI.
- **Diff truncation.** GitHub may truncate very large PRs. What does the UI show — a banner, a partial ChangeSet with a "diff truncated" sentinel, or a hard error? Lean: render the partial ChangeSet with a header banner, but confirm in spec.
- **Token error UX after configuration.** PAT revoked, scope changed, or expired → what does refresh look like? Re-prompt inline? Surface a "token rejected" error in the changeset header with a "Re-enter token" button?
- **Endpoint naming consistency.** New endpoints (e.g., `POST /api/github/pr/load`, `POST /api/github/pr/branch-lookup`, `POST /api/github/auth/{set,clear,test}`) should align with the body-key conventions called out in `docs/concepts/server-api-boundary.md` (`worktreePath` vs `path` discrepancy). Standardize on `worktreePath` style for any path-bearing fields and confirm in spec.
- **Origin / Sec-Fetch-Site handling for the new endpoints.** Existing endpoints already enforce origin allowlist + opaque-origin denial; the new endpoints should plug into the same `classifyRequestOrigin` path without exception.
- **Identity cleanup if a PR is renamed.** PR number is stable, repo can be renamed/transferred. v0 keys off `(host, owner, repo, number)`; if a repo is renamed the cached state is "lost." Acceptable; flag for later.

## Related Code / Patterns Found

- `web/src/components/LoadModal.tsx` — existing URL / upload / paste tabs; new affordance slots in next to (or extends) the URL tab.
- `web/src/types.ts` — `ChangeSet` and surrounding types; will gain a `PrSource` provenance discriminator (alongside the planned `WorktreeSource` referenced in `docs/plans/worktrees.md`).
- `web/src/parseDiff.ts` — already parses unified diffs in the format GitHub returns; PR diffs should drop straight in.
- `web/src/persist.ts` — `ReviewState` localStorage round-trip; per-PR key fits the same shape.
- `web/src/components/Inspector.tsx` and the existing teammate-review rendering (referenced in `docs/architecture.md`) — natural home for overlaying PR review comments under matching hunks.
- `server/src/index.ts` — REST surface; new `/api/github/*` endpoints; existing `classifyRequestOrigin` / opaque-origin enforcement applies.
- `server/src/agent-queue.ts` — pattern for in-memory, key-scoped server state (relevant if v0 ends up holding a PR snapshot map server-side).
- macOS Keychain `service=shippable` (per `docs/architecture.md` § API key storage) — existing account model extends to per-host GitHub PATs.
- `docs/concepts/server-api-boundary.md` — open consistency note (`worktreePath` vs `path`); new endpoints should standardize.
- `docs/plans/share-review-comments.md` — sets the precedent for `commit="<sha>"` anchoring; PRs should use the head sha consistently when the post-back direction lands.
- `docs/plans/worktrees.md` — slice (a) shipped; slice (c) per-worktree review cursor is the same persistence shape we extend per-PR; slice (e) live mode is the parallel work that will eventually replace the manual-refresh UX.
- `docs/sdd/agent-reply-support/spec.md` — reference architecture for the "MCP + REST + reviewer UI" pattern that the eventual GitHub two-way SDD will mirror.
- `docs/ROADMAP.md` — locates this work under 0.2.0 connectivity; the GitHub-ingest-prototype line is the direct predecessor of v0.
