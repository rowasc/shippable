# Spec: GH Connectivity

## Goal

Open a GitHub (and GHE) PR by URL and review it locally inside Shippable. The loaded PR carries diff, metadata, line-anchored review comments, and PR conversation, persisted as a per-PR `ReviewState`. From a worktree whose branch has an open upstream PR, an opt-in pill overlays the same data onto the local-diff `ChangeSet`. v0 is read-only — push-back lands in a separate later SDD that pairs with the hosted backend.

## Requirements Summary

- **Read-only PR ingest, paste-only.** New affordance in `LoadModal` accepts `https://<host>/<owner>/<repo>/pull/<n>` and resolves it to a `ChangeSet` with a new `PrSource` provenance.
- **Per-host PAT, eager.** Token required before any GitHub API call for a host. Stored in macOS Keychain (Tauri) and held in server memory (active store). Web app never persists the token in localStorage and never re-uses it across renders — Keychain is durable, server-memory is active, and the web app orchestrates.
- **GHE auto-detection** from the PR URL — `github.com` → `https://api.github.com`, anything else → `https://<host>/api/v3`.
- **Closed/merged PRs loadable** with state shown in metadata; no behavior gate.
- **Per-PR `ReviewState`** keyed by `(host, owner, repo, number)`; rehydrated from `localStorage` via `persist.ts`.
- **Manual refresh model.** Re-fetch on (re)load + a header Refresh button. No background polling.
- **Worktree↔PR overlay.** When the loaded worktree's branch resolves to an open upstream PR, surface a *"Matching PR: #N — &lt;Title&gt;"* pill; click overlays PR metadata + review comments onto the existing local-diff ChangeSet.
- **Memory-only deployments stay supported.** API-only ingest path with no disk dependency; works in every server deployment mode. Worktree↔PR overlay is naturally hidden in memory-only mode because worktree ingest is.
- **Local server binds 127.0.0.1**; existing origin enforcement applies to the new endpoints unchanged.

Full detail in `requirements.md`.

## Chosen Approach

**Slot into existing patterns.**

Each new piece mirrors something already in the codebase:

- **Endpoints:** a small `/api/github/*` REST surface added to `server/src/index.ts`, wired into the same origin-classification path everything else uses. One bundled `pr/load` endpoint produces a complete ChangeSet from a single request. A separate `pr/branch-lookup` endpoint serves the worktree↔PR pill. A small auth trio (`auth/set`, `auth/clear`, `auth/has`) manages the server-memory token store.
- **Token model:** **two-tier active/durable** — Tauri Keychain holds tokens persistently (one entry per host), the server holds them in process memory (`Map<host, token>`) for the lifetime of the process. The web app moves tokens between the two: on first need it tries `auth/has`; if absent, it `keychain_get`s and `auth/set`s, then retries; if not in Keychain either, it prompts the user, writes both, and retries. Dev mode (browser, no Tauri) skips the Keychain leg — tokens live only in server memory and are re-prompted on server restart. This mirrors how the Anthropic key relates to the sidecar today (Keychain durable, env active) but adapts to per-host dynamism.
- **Server state:** an in-memory `Map<host, token>` next to the existing per-worktree maps in `server/src/`. Same persistence posture (lost on restart). No PR-data caching server-side — every load re-fetches from GitHub; the web app's `ReviewState`/`changesets` already handles cross-reload identity.
- **PR comments — first-class Replies (matched) + DetachedReplies (outdated).** Line-anchored PR review comments are merged into the existing `ReviewState.replies` map under the same reply-key namespace user comments use:
  - **Single-line** PR review comment → `Reply` under `userCommentKey(hunkId, lineIdx)` (or, if a thread already exists at the line, appended to it).
  - **Multi-line** PR review comment (has `start_line`/`line`) → `Reply` under `blockCommentKey(hunkId, lo, hi)`.
  - **Outdated** PR review comment (GitHub returns `line: null`) → `DetachedReply` in `ReviewState.detachedReplies`. The reply carries `originType: "committed"`, `anchorPath = comment.path`, `anchorLineNo = comment.original_line`, and `anchorContext` derived from `comment.diff_hunk` (already in the GitHub payload, currently discarded). The Sidebar's "Detached" section renders these the same as our own detached replies — same "view at <sha7>" affordance.
  - Each external `Reply` has a deterministic id derived from `comment.id` so dedupe across reloads / refreshes is automatic. A new optional `external?: { source: "pr"; htmlUrl: string }` field on `Reply` marks them as upstream — drives the small "↗ open on GitHub" link, suppresses the local enqueue / agent-reply affordances, and lets the persist layer skip them on save (they re-arrive with the next `pr/load`). All other fields (`author`, `body`, `createdAt`) match what the existing `ReplyThread` already renders.
  - Issue-level conversation comments still attach as a new `prConversation?: PrConversationItem[]` field on `ChangeSet`, surfaced in the changeset-header overview disclosure.
  - The PR-load reducer step (`MERGE_PR_REPLIES`, called from both `LOAD_CHANGESET` for PR-source loads and from `MERGE_PR_OVERLAY` for the worktree overlay) is responsible for:
    1. Removing all prior `external.source === "pr"` entries from `replies` and `detachedReplies` for the target ChangeSet (so refreshes reconcile cleanly).
    2. Bucketing the new PR comments by anchor: matched → `replies`, outdated → `detachedReplies`.
  - This replaces the v0 design's `prReviewComments?: PrReviewComment[]` field on `DiffLine`. That field, the corresponding `PrReviewCommentsSection` Inspector component, and the `line--has-pr-comment` gutter glyph in `DiffView` are removed — the regular reply-thread rendering and the existing user-comment glyph cover the same UX without parallel surfaces.
- **Provenance:** `ChangeSet` gains a `prSource?: PrSource` field alongside the existing `worktreeSource?`. Both can co-exist on a worktree↔PR overlay — the diff still came from the worktree (so `worktreeSource` is set), but the metadata + PR comments came from upstream (so `prSource` is set too).
- **Data flow into UI:** the existing `Inspector.tsx` rendering for line-anchored notes is the natural shape for `prReviewComments`. Changeset header gains a small "PR" surface (title, state, last-fetched, Refresh, conversation comments) gated on `prSource`.
- **Worktree↔PR pill:** opt-in. The server's `branch-lookup` endpoint reads the worktree's `origin` remote (and any other GitHub-shaped remote) via the existing `worktree-validation.ts` helpers, parses host/owner/repo, then `GET /repos/<owner>/<repo>/pulls?head=<owner>:<branch>&state=open` against the host. UI surfaces a pill on first match; click triggers `pr/load` and merges the response into the live ChangeSet (writes `prSource`, `prConversation`, and per-line `prReviewComments`; leaves the diff untouched).

This is the path of least architectural change. There are no new transports (REST only), no new persistence mechanisms (Keychain on Tauri + server-memory + the existing `localStorage` round-trip — all already in use), no new MCP server (the post-back direction owns that scope), and no localStorage migrations beyond two new optional fields on `ChangeSet` (and one optional field on `DiffLine`) that default cleanly to absence.

### Alternatives Considered

- **Stateless server, web reads Keychain just-in-time per request (Approach B).** Each `pr/load` carries the token in an `Authorization` header. Simpler on the server side (no auth state machine, no `auth/*` endpoints). Two reasons we passed: (1) it pushes the token through the JS layer on every request rather than once during onboarding, which is a softer reading of "the web app never holds the PAT"; (2) dev mode without Keychain has nowhere clean to keep the token across calls — either localStorage (worse than server memory) or per-call user prompt (unworkable). The chosen approach asks the server to hold one extra map; the cost is small, the boundary is sharper.
- **Server-side bare-clone PR cache (worktree-backed ingest).** Server `git fetch`es the PR head into a managed cache and serves expand-context, symbol nav, runners. Out of v0 — would need repo lifecycle, `git`-level auth wiring, and a `disk-allowed` capability gate that contradicts the memory-only deployment posture. Logged as a follow-up.
- **Generalized integrations layer (`integrations/<provider>.ts`).** Abstracts GitHub into a provider-pluggable module. Premature with one implementer (AGENTS.md: "two call sites does not justify a helper"); near-guaranteed wrong shape until GitLab/Bitbucket are in play. Re-evaluate when a real second provider lands.
- **PR review comments as a new `Reply` kind in `ReviewState.replies`.** Treats GitHub comments as siblings of teammate / AI / user replies in the existing reply map. Loses the "external context" framing — these are not the reviewer's state, they're upstream artifacts that re-fetch with the diff. Forces a rehydration migration on `ReviewState` for data that doesn't need to be persisted at all. Field-on-`DiffLine` keeps the relationship structural and the persistence layer alone.
- **Granular endpoints (web orchestrates `meta` + `diff` + `comments`).** More HTTP traffic between web and the local server; tests get smaller; failure modes split across calls. Bundled `pr/load` is the cleaner cut for v0 because the three GitHub fetches are co-dependent (the diff needs the head sha from `meta`, the line-comment merge needs file paths from `diff`); the bundle resolves them once on the server. Split later if real friction appears.

## Technical Details

### Architecture

```
┌─ Reviewer UI (web) ─────────────────────────────────────────┐
│   LoadModal: new "From a GitHub PR" tab                     │
│     paste URL → POST /api/github/pr/load                    │
│   GitHubTokenModal (opens on auth/has → false)              │
│     prompt → keychain_set + POST /api/github/auth/set       │
│   Changeset header: PR title / state / last-fetched / refresh│
│   Inspector: prReviewComments under hunks; prConversation   │
│     in header overview                                      │
│   ReviewState — keyed (host, owner, repo, number) per PR    │
│   Worktree↔PR pill: POST /api/github/pr/branch-lookup       │
│     match → click → pr/load → merge into live ChangeSet     │
└──────────────┬──────────────────────────┬──────────────────┘
               │ POST /api/github/pr/load │ POST /api/github/pr/branch-lookup
               │ POST /api/github/auth/*  │
               ▼                          ▼
┌─ Local server (server/) ────────────────────────────────────┐
│   server/src/github/                                        │
│     auth-store.ts   — Map<host, token>; in-memory           │
│     url.ts          — parse PR URL → { host, owner, repo,   │
│                       number }; resolve API base URL        │
│     api-client.ts   — fetch wrapper; PAT injection;         │
│                       error normalization                   │
│     pr-load.ts      — orchestrates meta + diff +            │
│                       review-comments + issue-comments;     │
│                       assembles ChangeSet                   │
│     branch-lookup.ts — reads worktree git remote/branch;    │
│                       queries pulls?head=…&state=open       │
│   Endpoints (registered in server/src/index.ts):            │
│     POST /api/github/auth/set       (web → server)          │
│     POST /api/github/auth/clear     (web → server)          │
│     POST /api/github/auth/has       (web → server)          │
│     POST /api/github/pr/load        (web → server → GitHub) │
│     POST /api/github/pr/branch-lookup (web → server → GitHub)│
│   Origin allowlist + opaque-origin denial: same as today    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS
                               ▼
                    ┌─ GitHub.com / GHE ──────────────┐
                    │ /repos/{o}/{r}/pulls/{n}        │
                    │ /repos/{o}/{r}/pulls/{n}/files  │
                    │ /repos/{o}/{r}/pulls/{n}/comments│
                    │ /repos/{o}/{r}/issues/{n}/comments│
                    │ /repos/{o}/{r}/pulls?head=…     │
                    └─────────────────────────────────┘
```

Localhost-bound, same security posture as today; tokens travel only on the localhost loopback (web ↔ server) and over TLS to GitHub.

### Data Flow

**Loading a PR by URL.**

1. User pastes `https://<host>/<owner>/<repo>/pull/<n>` in LoadModal and submits.
2. Web calls `POST /api/github/pr/load { prUrl }`.
3. Server parses the URL → `{ host, owner, repo, number, apiBaseUrl }`. Validates shape; rejects malformed URLs at the boundary.
4. Server checks `auth-store` for `host`. If missing, returns `401` with `{ error: "github_token_required", host }`.
5. Web receives `github_token_required`:
   - Tauri: `keychain_get('GITHUB_TOKEN:<host>')`. If present, `POST /api/github/auth/set { host, token }`, retry the load. If absent, open `GitHubTokenModal` → user enters → `keychain_set` + `auth/set` → retry.
   - Dev mode (no Tauri): open the modal directly; `auth/set` on submit; retry.
6. Server (with token) issues four GitHub API requests (parallel where possible):
   - `GET /repos/{o}/{r}/pulls/{n}` → meta (title, body, state, base sha, head sha, html_url, user.login, base.ref).
   - `GET /repos/{o}/{r}/pulls/{n}/files` (paginated) → file list + per-file `patch` strings.
   - `GET /repos/{o}/{r}/pulls/{n}/comments` (paginated) → line-anchored review comments.
   - `GET /repos/{o}/{r}/issues/{n}/comments` (paginated) → issue-level discussion.
7. Server normalizes errors: `401`/`403` → `{ error: "github_auth_failed", host, hint: "invalid-token" | "rate-limit" | "scope" }`; `404` → `{ error: "github_pr_not_found" }`; others → `{ error: "github_upstream", status, message }`.
8. Server assembles a `ChangeSet`: derives `id = "pr:<host>:<owner>:<repo>:<number>"`; copies title/body/state/base/head/htmlUrl into `prSource`; reuses the existing diff parser to turn the per-file `patch` strings into `DiffFile[]` with `Hunk[]`/`DiffLine[]`; merges line-comments onto matching `DiffLine.prReviewComments`; attaches issue comments as `prConversation`.
9. Server returns `{ changeSet }`. Web app dispatches the existing `loadChangeSet` reducer; `ReviewState` rehydrates from `localStorage` keyed off `changeSet.id`.
10. Refresh: same `pr/load` call. The reducer replaces the prior ChangeSet at the same id, preserving any local `ReviewState` (cursor, marks, replies) that was keyed off the id.

**Worktree↔PR overlay.**

1. Worktree loads as today; `ChangeSet` has `worktreeSource` set.
2. Inspector mounts, observes `worktreeSource`, calls `POST /api/github/pr/branch-lookup { worktreePath }`.
3. Server reads the worktree's `origin` remote URL (`git remote get-url origin` via `execFile`); also enumerates other remotes for any GitHub-shaped match. Parses host/owner/repo. If no GitHub remote: returns `{ matched: null }`.
4. Server resolves token for `host`. Same `github_token_required` handshake as above (web prompts only when the user clicks the affordance — see step 6 — to avoid a token gate on every worktree load).
5. Server queries `GET /repos/<owner>/<repo>/pulls?head=<owner>:<branch>&state=open` (head ref = the worktree's current branch). Returns `{ matched: { host, owner, repo, number, title, state, htmlUrl } | null }` taking the first match (multi-PR case is exotic; punt to follow-up).
6. UI surfaces the pill. Click → `pr/load` → merges the response into the live ChangeSet: sets `prSource`, sets `prConversation`, walks the response's per-line PR review comments, and matches them to `DiffLine` instances by `(file path, line number)`. Lines that the local diff lacks (e.g., the user has changes the upstream PR doesn't) are silently dropped — the PR view is overlay, not source of truth.

**Pre-fetch token rehydrate (lazy, Tauri).**

1. App boot: web app does **not** eagerly enumerate Keychain. No work happens until the user touches a host.
2. First `pr/load` for `host` → `auth/has` → false → web does `keychain_get('GITHUB_TOKEN:<host>')`. Hit: `auth/set`, retry. Miss: prompt.
3. After the first successful retrieval per session per host, the server's `auth-store` carries the token until restart.

### Key Components

**New / modified server modules**

- `server/src/github/auth-store.ts` (new)
  - `setToken(host, token)`, `clearToken(host)`, `hasToken(host)`, `getToken(host)`. In-memory `Map<string, string>`.
  - Host normalization (lowercase, strip port if absent, deny `localhost`/private IPs at the boundary — defensive, since the URL parser shouldn't produce them).
- `server/src/github/url.ts` (new)
  - `parsePrUrl(input: string): { host, owner, repo, number, apiBaseUrl, htmlUrl }`. Throws a structured error on malformed inputs.
  - `resolveApiBase(host)`: `github.com` → `https://api.github.com`; otherwise `https://<host>/api/v3`.
- `server/src/github/api-client.ts` (new)
  - `githubFetch(apiBaseUrl, path, { token, method?, body? })`. Sets `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Handles pagination (`Link: rel="next"`) for list endpoints. Normalizes errors into the discriminator shape used by the endpoints.
- `server/src/github/pr-load.ts` (new)
  - `loadPr({ host, owner, repo, number }, token)`: the four-fetch fan-out + assembly. Uses the existing diff parser via the `web/src/parseDiff.ts` shape — server-side. Returns `{ changeSet, prReplies, prDetached }` — the changeset carries `prSource` + `prConversation`; the two reply collections feed the merge step on the web side. Single-line and multi-line PR comments that match a `(file, line)` in the parsed diff become `Reply` entries in `prReplies` keyed by their would-be reply key (`user:<hunkId>:<lineIdx>` or `block:<hunkId>:<lo>-<hi>`); outdated comments (`line: null`) become `DetachedReply` entries in `prDetached` with `anchorPath`, `anchorLineNo = original_line`, `anchorContext` derived from `comment.diff_hunk`, and `originType: "committed"`.
  - Truncation: when GitHub flags the diff as truncated (response `incomplete_results: true` on `/files`, or files-list shorter than the response total), the assembled `ChangeSet` carries a new `prSource.truncation: { kind: "files" | "patch", reason: string }` field; the UI renders a banner.
- `server/src/proxy.ts` (new)
  - `getDispatcher()`: reads `HTTPS_PROXY` / `https_proxy` (and `NO_PROXY` for exclusions) once on first call; returns an `undici.ProxyAgent` configured for the resolved URL, or `undefined` when no proxy env var is set. The api-client passes `dispatcher: getDispatcher()` on every `fetch()` call to GitHub. Node's built-in `fetch` (undici) does not consult these env vars by default; this module is the fix. Errors during dispatcher construction (malformed URL) log once and fall through to direct `fetch` rather than blocking the call.
- `server/src/github/branch-lookup.ts` (new)
  - `lookupPrForBranch(worktreePath)`: validates path via `worktree-validation.ts` `assertGitDir`; runs `git remote get-url origin` (and other remotes if needed) via `execFile`; identifies a GitHub-shaped remote; runs the `pulls?head=…` query; returns the first open match.
- `server/src/index.ts`
  - Register the five new endpoints (`auth/set`, `auth/clear`, `auth/has`, `pr/load`, `pr/branch-lookup`) inside the existing origin-classification path.
  - Body keys follow the established convention (`worktreePath`, `host`, `prUrl`, `token`). No URL-path-encoded paths.
  - Reuse the existing structured-error response helper.
- `server/src/github/*.test.ts`
  - URL parsing edge cases (trailing slash, anchor, multiple `pull/<n>` segments).
  - Auth-store get/set/clear roundtrip.
  - PR-load happy path with a fixture HTTP layer (mock `fetch`); error normalization (401/403/404/5xx).
  - Branch-lookup against a tmpdir worktree fixture.

**Reviewer UI (web)**

- `web/src/types.ts`
  - Add `PrSource` interface: `{ host, owner, repo, number, htmlUrl, headSha, baseSha, state: "open" | "closed" | "merged", title, body, baseRef, headRef, lastFetchedAt, truncation?: { kind, reason } }`.
  - Extend `ChangeSet` with `prSource?: PrSource` and `prConversation?: PrConversationItem[]`.
  - Add `PrConversationItem`: `{ id, author, createdAt, body, htmlUrl }`.
  - Extend `Reply` with an optional `external?: { source: "pr"; htmlUrl: string }` field. Drives the "open on GitHub" affordance, suppresses the local enqueue/agent-reply paths, and tells the persist layer to skip these on save (they re-arrive with the next `pr/load`).
  - **Removed from earlier v0:** the `PrReviewComment` interface and the `prReviewComments?: PrReviewComment[]` field on `DiffLine`. PR comments now travel through the existing `Reply` shape.
  - All new/changed fields are optional; existing fixtures and persisted ReviewState rehydrate cleanly without migration.
- `web/src/persist.ts`
  - On save: filter out any `Reply` with `external?.source === "pr"` from `replies` and from `detachedReplies` before serializing. PR-sourced replies live entirely in memory; they re-arrive on next `pr/load`. This keeps localStorage from accumulating stale upstream copies and avoids any rehydration ordering question (PR fetch may not have completed by the time the persisted state hydrates).
  - No schema bump required for the changeset side (all additions are optional, on the immutable fetched-from-server side of the boundary).
- **Unified load surface (`web/src/loadSurface.ts` or co-located hook).**
  - Today the GitHub-PR load flow exists in three near-duplicate copies (`Welcome.tsx`, `LoadModal.tsx`, `ReviewWorkspace.tsx`'s refresh path), and the URL/file/paste flows are duplicated across `Welcome` and `LoadModal`. Extract a single hook (`useLoadSurface()`) returning the load handlers + state (`onPasteUrl`, `onPasteDiff`, `onFile`, `onWorktree`, `onGithubPr`, `tokenModalProps`, `error`, `busy`). Both `Welcome.tsx` and `LoadModal.tsx` consume it; presentation chrome differs, behavior is identical.
  - The "From a URL" and "From a GitHub PR" inputs collapse into one URL input. Detection: a regex against `(/.*/(pulls?|pull)/\d+(/.*)?$)` routes through `loadGithubPr`; otherwise the existing direct-`fetch` path applies. Single text field, single submit; the loader picks the route.
  - This refactor lands in the new slice (Slice 6) — the v0 implementation kept three copies for ship-speed; the slice is the cleanup.
- `web/src/components/LoadModal.tsx`
  - Consumes `useLoadSurface()`. Renders the unified URL field (no separate "From a GitHub PR" tab).
  - Handles the `github_token_required` error path: triggers `GitHubTokenModal`, then retries.
- `web/src/components/GitHubTokenModal.tsx` (new)
  - Captures token; on submit calls `keychain_set` (Tauri only) and `auth/set`.
  - Doc/help link about creating a PAT (the README addition handles the canonical reference).
- `web/src/components/Inspector.tsx`
  - **No PR-specific rendering.** PR review comments arrive as regular `Reply` entries in `replies` and render through the existing `ReplyThread`. The only PR-specific affordance is the small "↗ open on GitHub" link gated on `reply.external?.source === "pr"` (and suppressing the enqueue / agent-reply UI for the same condition) — both inside `ReplyThread`, not in Inspector itself.
  - When `prConversation` is present, surface a "PR conversation (N)" disclosure in the existing changeset-header overview area, expanding to a chronological list of comment items.
  - **Removed from earlier v0:** the standalone `PrReviewCommentsSection` component. Its job is covered by the existing reply-thread rendering.
- `web/src/components/DiffView.tsx`
  - **Removed from earlier v0:** the `line--has-pr-comment` class + count glyph in the gutter. The existing `hasUserComment` glyph already lights up because PR replies live in `replies` under the same line key — no new gutter affordance is needed.
- `web/src/components/ChangesetHeader.tsx` (or wherever the header lives — confirm at impl time)
  - When `prSource` present: show title, state badge, base→head ref, "Last fetched HH:MM", `Refresh` button. Refresh re-runs `pr/load`.
  - When `prSource.truncation` present: render a banner ("Diff truncated by GitHub at N files. Some changes are not shown.").
- Worktree↔PR pill (location TBD at implementation time — likely `Inspector.tsx`'s existing worktree-source surface)
  - On worktree-source mount: `POST /api/github/pr/branch-lookup { worktreePath }`. On `{ matched }`: render the pill. Click → `pr/load` → reducer merges (`prSource`, `prConversation`, plus the new `prReplies`/`prDetached` collections). The diff/files arrays are not touched.
- `web/src/apiUrl.ts` / state reducers
  - `loadGithubPr(prUrl)` async thunk / handler: makes the `pr/load` call, dispatches `LOAD_CHANGESET` with the response, then dispatches `MERGE_PR_REPLIES` to install the PR-sourced `Reply` / `DetachedReply` entries. On `github_token_required`, opens the modal and chains a retry.
  - `mergePrOverlay(matched)`: applied when the worktree-source path resolves a matching PR; calls `pr/load`, dispatches `MERGE_PR_OVERLAY` (sets `prSource` + `prConversation` on the worktree ChangeSet) and `MERGE_PR_REPLIES` (installs replies/detached) without dropping `worktreeSource`.
  - `MERGE_PR_REPLIES` reducer contract: (a) remove every existing `Reply` with `external?.source === "pr"` from `state.replies` and every `DetachedReply` whose nested `reply.external?.source === "pr"` from `state.detachedReplies` for the target ChangeSet; (b) merge the new entries in. Idempotent across refresh / overlay re-clicks.

**Auth flow plumbing (Tauri shell)**

- The existing `keychain_get` / `keychain_set` Tauri commands work for arbitrary `account` values; no new Tauri-side code required beyond using account names of the form `GITHUB_TOKEN:<host>`.
- The existing first-run modal pattern in `useApiKey.ts` is the closest precedent. The PAT modal is more dynamic (shown on token-required errors, not at boot) — implemented as a standalone component invoked by the API error handler.

**Docs**

- `docs/concepts/server-api-boundary.md` — add `/api/github/*` to the surface list; cross-link this spec.
- `docs/architecture.md` — note that PRs are a fourth ingest path alongside URL/upload/paste/worktree.
- `docs/ROADMAP.md` — flip the "GitHub ingest, prototype" line over to v0.2.0 in-progress; cross-link this spec.
- `docs/concepts/changeset-hierarchy.md` — note that `ChangeSet` may now carry both `worktreeSource` and `prSource` simultaneously (the overlay case).
- `README.md` — document PAT setup ("Create a PAT with `repo` scope at https://github.com/settings/tokens; paste it when Shippable prompts on first PR load") and the `service=shippable, account=GITHUB_TOKEN:<host>` Keychain entries.
- `docs/features/` — add `github-pr-ingest.md` paired with the `feature-docs.html` viewer.

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/github/auth-store.ts` | new | In-memory per-host token map; get/set/clear/has. |
| `server/src/github/auth-store.test.ts` | new | Roundtrip + host normalization. |
| `server/src/github/url.ts` | new | `parsePrUrl`, `resolveApiBase`. |
| `server/src/github/url.test.ts` | new | Parsing edge cases. |
| `server/src/github/api-client.ts` | new | `githubFetch` wrapper, pagination, error normalization. |
| `server/src/github/api-client.test.ts` | new | Auth header injection, error mapping. |
| `server/src/github/pr-load.ts` | new | Bundled fan-out + ChangeSet assembly. |
| `server/src/github/pr-load.test.ts` | new | Happy path + error paths against a mock fetch. |
| `server/src/github/branch-lookup.ts` | new | Worktree → matching PR. |
| `server/src/github/branch-lookup.test.ts` | new | Tmpdir worktree fixtures. |
| `server/src/index.ts` | modify | Register the five new endpoints in the existing origin-classification path. |
| `server/src/index.test.ts` | modify | Endpoint coverage for `auth/*`, `pr/load`, `pr/branch-lookup`. |
| `web/src/types.ts` | modify | Add `PrSource`, `PrConversationItem`; extend `ChangeSet`; add optional `external` field on `Reply`. (No `PrReviewComment` / no `prReviewComments` on `DiffLine` — those land in v0 and are removed in Slice 6.) |
| `web/src/components/LoadModal.tsx` | modify | Consume `useLoadSurface()`; render unified URL field (PR + diff URL detection on the server). |
| `web/src/components/Welcome.tsx` | modify | Consume the same `useLoadSurface()`; remove duplicate load logic. |
| `web/src/loadSurface.ts` | new | Shared `useLoadSurface()` hook used by Welcome + LoadModal + ReviewWorkspace refresh path. |
| `web/src/components/GitHubTokenModal.tsx` | new | PAT capture; `keychain_set` + `auth/set` on submit. |
| `web/src/components/Inspector.tsx` | modify | Render `prConversation` in the header overview; render the worktree↔PR pill when `branch-lookup` matches. (No PR-specific reply rendering — `ReplyThread` covers it.) |
| `web/src/components/ReplyThread.tsx` | modify | Render the small "↗ open on GitHub" link when `reply.external?.source === "pr"`; suppress local enqueue / agent-reply affordances for the same condition. |
| `web/src/components/ChangesetHeader.tsx` | modify | PR title/state/refresh/last-fetched/truncation banner when `prSource`. (Confirm exact file at impl time.) |
| `web/src/state.ts` (or wherever `ReviewState` reducers live) | modify | `loadGithubPr` action; `MERGE_PR_OVERLAY` reducer (overlay metadata only); `MERGE_PR_REPLIES` reducer (installs PR-sourced replies + detached, idempotent on refresh). |
| `web/src/apiUrl.ts` (or sibling network helper) | modify | Wrappers for the five new endpoints. |
| `web/src/persist.ts` | modify | On save, filter out `Reply.external?.source === "pr"` from `replies` and `detachedReplies`. No schema bump. |
| `server/src/proxy.ts` | new | `getDispatcher()` returning a `ProxyAgent` from `HTTPS_PROXY` / `https_proxy` (with `NO_PROXY` exclusions), or `undefined` when unset. |
| `docs/concepts/server-api-boundary.md` | modify | List `/api/github/*`. |
| `docs/architecture.md` | modify | PRs as a fourth ingest path. |
| `docs/ROADMAP.md` | modify | Flip GitHub-ingest-prototype to v0.2.0 in-progress; cross-link. |
| `docs/concepts/changeset-hierarchy.md` | modify | `worktreeSource` + `prSource` co-exist for the overlay case. |
| `docs/features/github-pr-ingest.md` | new | Feature doc paired with `feature-docs.html`. |
| `README.md` | modify | PAT setup; Keychain entries. |

## Out of Scope

- **Push-back to GitHub.** Posting reviews/replies as PR comments. Separate later SDD; pairs with the hosted backend.
- **Expand-context for remote PR files.** Either via on-demand `GET /repos/.../contents/{path}?ref=<sha>` or via worktree-backed clone. UI should hide / no-op the affordance for files lacking on-disk presence.
- **Worktree-backed (clone + checkout) PR ingest.** Server `git fetch` + worktree, repo cache lifecycle, `git`-level auth wiring, `disk-allowed` capability gate. Future feature.
- **"My PRs" / search list / saved-recents drawer.** v0 is paste-only.
- **GitHub App / OAuth.** PAT only.
- **Check runs / CI status surface.**
- **Auto-overlay (without click) on matched worktrees.** v0 is opt-in pill.
- **Background polling / live mode.** Romina's parallel work will retire the manual-refresh hint.
- **Multi-account on the same host.** Single PAT per host.
- **Force-push reconciliation UX.** v0 just refetches; no "the PR moved under you" affordance.
- **Multi-PR match for one branch.** Branch-lookup returns the first match; multi-match is exotic and deferred.
- **Aliasing across repo renames/transfers.** Per-PR `ReviewState` is keyed by `(host, owner, repo, number)`; renames lose the cached state.
- **PR review submission summaries (`pulls/{n}/reviews`).** Not surfaced in v0.
- **Rate-limit visualization.** A "rate limit: 4321/5000" pill is a follow-up.

## Open Questions Resolved

- **Server-side cache shape** → no server-side PR-data cache; every load is a fresh fetch. Web app's existing `ReviewState.changesets[]` and `localStorage` round-trip are sufficient. The only server state is the per-host token map.
- **PR review comment surface choice** → **revised after v0.** Render PR review comments through the existing `Reply` / `ReplyThread` path — same surface as user comments and AI-note replies — keyed under `userCommentKey`/`blockCommentKey`. Outdated PR comments (`line: null`) become `DetachedReply` entries with their original-line `anchorContext` derived from `comment.diff_hunk`, rendered in the existing Sidebar "Detached" section. PR-sourced replies are tagged via `Reply.external = { source: "pr", htmlUrl }`; the persist layer drops them on save (they re-arrive with the next `pr/load`). Issue-level conversation still lives at `ChangeSet.prConversation`. The earlier "new line-level annotation on `DiffLine`" choice (`prReviewComments` field, `PrReviewCommentsSection`, gutter glyph) is retired in Slice 6 — it forced parallel rendering surfaces that the existing reply system already covers, and it had no good answer for outdated comments. The "external context" framing concern from the original alternatives is preserved by the `external` flag (drives the "open on GitHub" affordance + persistence skip) without forking a parallel surface.
- **Diff truncation handling** → `ChangeSet.prSource.truncation` carrier; UI shows a banner; partial ChangeSet still renders. No fancy fallback in v0.
- **Token error UX after configuration** → server returns a discriminator (`github_auth_failed` / `github_token_required` / `github_pr_not_found` / `github_upstream`); UI shows a banner with a "Re-enter token" affordance for auth-class errors that re-opens the token modal.
- **Endpoint naming** → body keys standardize on `host`, `prUrl`, `worktreePath`, `token`. No `path` (per the existing `worktreePath` convention in `/api/agent/*`). Endpoint paths are `/api/github/{auth/set, auth/clear, auth/has, pr/load, pr/branch-lookup}`.
- **Origin handling** → new endpoints plug into the existing `classifyRequestOrigin` + opaque-origin denial path; no exception. No new browser-only fallback.
- **Identity-after-rename** → keys remain `(host, owner, repo, number)`. Renames lose cached state. Acceptable for v0; alias map is a follow-up if a real workflow hits it.
- **Token model — eager vs. lazy rehydrate from Keychain** → lazy, per-host, on first need. Avoids enumerating Keychain at boot and avoids any "load all tokens" round-trip.
- **PR comment line-anchoring across multi-line GH comments** → store `lineSpan: { lo, hi }` on the comment; render under the highest-numbered line with a "(spans X-Y)" hint. Multi-line comments are uncommon enough that v0 doesn't need richer span rendering.
- **`prSource` + `worktreeSource` co-existence** → both fields are independent; both can be set on the same ChangeSet. The diff is whatever was loaded first; the overlay only adds metadata + comments.
- **HTTPS proxy support** → wired via `server/src/proxy.ts` building an `undici.ProxyAgent` from the standard env vars (`HTTPS_PROXY` / `https_proxy` + `NO_PROXY`), passed as `dispatcher` on every GitHub `fetch()`. No env var → no dispatcher → direct fetch (today's behavior). Documented in the README's PAT setup section.
- **Welcome ⊆ LoadModal unification** → both surfaces consume a single `useLoadSurface()` hook; load logic lives in one place. Welcome wraps it in empty-state chrome (recents, samples, hero); LoadModal wraps it in the modal frame. The "From a URL" and "From a GitHub PR" inputs collapse into one URL field with detection (`pull/<n>` HTML URL → `/api/github/pr/load`; everything else → existing direct-fetch path). The third copy in `ReviewWorkspace.tsx` (the PR-refresh path) is folded into the same hook.
