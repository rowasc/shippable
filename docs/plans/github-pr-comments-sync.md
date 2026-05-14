---
name: GitHub PR comments sync
description: Plan for keeping a loaded PR in sync with GitHub (pull-refresh v0) and the target design for pushing locally authored comments back to GitHub.
type: project
---

# GitHub PR comments sync

## Status: planning

v0 ships **pull-refresh** only. Push back to GitHub is designed below but not implemented in this slice — the data model and UI choices are picked so that push lands cleanly later without reshaping anything.

## Why

Today, `POST /api/github/pr/load` does a one-shot fetch when you open a PR and gives you back the diff plus the review comments anchored against it (`prInteractions` + `prDetached`). After that, the PR you're looking at in Shippable is frozen. A teammate replies on GitHub, resolves a thread, or pushes a new commit — Shippable has no idea. The reviewer has to close and reopen the PR to see anything new.

Closing the loop the other direction (push) is what most reviewers will reach for first, and the longer-term win. But push carries the full conflict / dedup / write-scope design surface; pull-refresh is the lower-risk slice that unblocks the user-visible pain and forces us to put the data-model plumbing in place that push will also need.

## Scope

### v0 (this plan)

- **Manual pull-refresh** of an already-loaded PR. A "Reload from GitHub" button in the PR panel re-runs the full ingest path under the hood, but preserves UI state (scroll, expansion, drafts, selection) so it never feels like a hard reload.
- **Change detection.** The reviewer sees what changed since they last looked: per-thread badges differentiating new replies, edited bodies, and resolved/unresolved transitions. A PR-header banner separately flags new commits.
- **Surfaces:** diff-anchored review comments and replies (already pulled today), the **review summary body**, **PR-conversation (issue) comments** in a new top-of-panel section, **resolved-thread state** as metadata-only, and **suggestion blocks** with a render + apply-to-worktree affordance.
- **Author identity** rendered as @handle + avatar; self-authored remote comments render as `@you`.
- **Failure UX** as an inline banner in the PR panel — auth-expired deep-links to credential settings.
- **Anchoring policy.** Trust GitHub's `position` when the local diff matches GitHub's diff; if the worktree has diverged (local commits or uncommitted edits) re-derive locally via `contentAnchor` and flag the thread with a "may have moved due to local changes" warning.

### Explicitly out of v0

- **Push.** No comments authored in Shippable reach GitHub yet. Target design captured in § Target push design.
- **Automatic refresh** (polling, on-focus, webhooks). Manual button only. Polling is the obvious next slice once we have rate-limit and churn data.
- **Reactions, edits-with-history snapshots, mention notifications.** We render the current body and a small `edited` badge — no prior-body diff on hover.
- **Resolve/unresolve from Shippable.** v0 reads `isResolved`; toggling it is push-territory.

## Decisions log

A condensed record of the design questions we picked through. Each entry is "decision — short rationale."

- **v0 = pull-refresh only** — smaller surface than push, no write scopes, no conflict pain, and forces the sync-metadata plumbing that push needs anyway.
- **Manual button, not polling** — predictable, zero rate-limit budget, no mid-read churn. Polling can come later once we know the actual fetch cost on real PRs.
- **Refresh = full re-ingest, soft UX** — under the hood we re-run the same path as initial load (new commits, re-parsed changeset, re-anchored comments). UX preserves scroll, expansion, drafts, and selection so the reviewer never loses their place.
- **Drafts survive + "new activity since you started typing" badge** — refresh never overwrites in-flight draft text. The thread surfaces a marker so the reviewer knows to re-read before submitting.
- **Resolved threads: metadata-only** — small `Resolved` tag on the thread. No collapsing, no filter. Cheapest; future resolve-from-Shippable can build on the same field.
- **Change vocabulary: reply / edit / resolve, plus a separate PR-header banner for new commits** — precise enough that the reviewer can ignore edits if they want; commits are a different scale of change so they live outside the per-thread badge.
- **PR-conversation comments: dedicated PR overview section** — top-of-panel block with PR title/body + threaded conversation comments. Visually separate from file-anchored review threads. Matches GitHub's "Conversation" tab.
- **Suggestions: render + apply-to-worktree** — parse ```suggestion fences with diff highlighting. Apply button writes the file in disk-available workspace modes and is hidden via existing capability flags in memory-only / no-clone modes.
- **Hybrid sync storage** — identity fields (`source`, `githubId`, `githubAuthor`) live on `Interaction` and trigger a `ReviewState` version bump per AGENTS.md guidance. Volatile cache (`lastPulledAt`, `lastEtag`, `lastSeenSha`, per-thread `lastSeenReplyCount`, `isResolved`, last-known body for change detection) lives in a sibling `githubSync` map.
- **Sync cache persists across sessions** — saved alongside `ReviewState` so first refresh after reopening still surfaces "new since you last had this open."
- **Fetch strategy: full + ETag** — always re-fetch the full list with `If-None-Match`. 304s are cheap, deletes are caught naturally, reconcile logic stays simple.
- **Author render: handle + avatar** — handles disambiguate when multiple reviewers comment; avatars are already in the API payload so they're free to render.
- **Inbound edits: replace + 'edited' badge** — match GitHub's UI; no prior-body snapshot in the cache.
- **Failure UX: inline banner in panel** — persistent, dismissable, with a Retry button. Auth-expired variant deep-links to credential settings. Differentiates "must act" (auth) from "try again later" (rate limit / upstream) via copy and CTA, not via modal vs banner.
- **Anchoring: GH position when diffs match, else re-derive + warn** — Shippable-specific concern because the worktree view can diverge from the PR view; we need both modes.
- **PR closed/merged between refreshes: banner only** — authoring stays enabled, since drafts may still be useful (push design accepts comments on closed PRs at the reviewer's risk).
- **Tests: cassette fixtures, anonymized** — snapshot real GitHub API responses into `server/src/__fixtures__/`, scrubbing handles, repo names, SHAs, and any URL that could resolve to a real artifact. Replay through a fetch stub. Re-recording is occasional manual work.

## Data model

### `Interaction` extensions (versioned)

```ts
type Interaction = {
  // … existing fields
  source: "github" | "local";
  githubId?: string;          // present iff source === "github"
  githubAuthor?: {
    handle: string;           // e.g. "octocat"
    avatarUrl: string;
  };
};
```

A `ReviewState` version bump migrates existing persisted reviews: existing interactions become `source: "local"`, `githubId`/`githubAuthor` absent. Pulled comments arrive with `source: "github"` and the GitHub-side identity populated.

### `githubSync` sibling map

Keyed by `prUrl`. Not part of `ReviewState`; persisted in its own local-storage slot so its shape can evolve without forcing review-state migrations.

```ts
type GithubSync = Record<PrUrl, {
  lastPulledAt: string;       // ISO timestamp
  lastEtag?: string;          // for If-None-Match
  lastSeenSha: string;        // PR HEAD commit at last refresh
  threads: Record<ThreadKey, {
    lastSeenReplyCount: number;
    isResolved: boolean;
    lastSeenBodyByCommentId: Record<string, string>; // for edit detection
  }>;
}>;
```

The per-comment body cache exists only so the next refresh can flip the "edited" badge; it is not exposed in the UI as a diff-on-hover.

## Architecture

```
┌─ Reviewer UI (web) ────────────────────────────────────────┐
│   PrPanel                                                  │
│     ├ PrOverviewSection  (title, body, conv. comments)     │
│     ├ FileList with thread badges (reply/edit/resolve)     │
│     │   └ Threads: ◌ unsent draft   ⚠ may-have-moved       │
│     ├ HeaderBanner: "PR has N new commits — reload"        │
│     └ Reload button → POST /api/github/pr/load (refresh)   │
│   Persists: ReviewState (versioned) + githubSync (sibling) │
└────────────────────────────────┬───────────────────────────┘
                                 │  POST /api/github/pr/load
                                 │  (with If-None-Match)
                                 ▼
┌─ Local server (server/) ───────────────────────────────────┐
│   server/src/github/pr-load.ts                             │
│     ├ REST: /pulls/{n}, /pulls/{n}/comments,               │
│     │       /issues/{n}/comments, /pulls/{n}/reviews       │
│     ├ GraphQL: review-thread isResolved per node id        │
│     └ Returns: changeSet + prInteractions + prDetached     │
│                + overview (title/body/convComments)        │
│                + resolvedByThread + etag + headSha         │
│   On If-None-Match match → 304 (empty body)                │
└────────────────────────────────────────────────────────────┘
```

**One endpoint, two callers.** The Reload button hits the same `/api/github/pr/load` that initial load uses. The server response grows two new top-level shapes (`overview`, `resolvedByThread`) and starts honouring `If-None-Match`. Initial load and refresh are the same request, just with different cache headers.

**Re-anchoring policy.** Before merging refreshed `prInteractions` into the local store:

1. If the worktree's `HEAD` equals GitHub's `headSha`, accept GitHub's `position` verbatim. Comments where position is null move into `prDetached`.
2. If the two SHAs differ (or the worktree has uncommitted edits in files touched by a thread), run the existing `contentAnchor` pass over each affected thread against the local diff. If `contentAnchor` lands, render the thread at the local position with a `may have moved due to local changes` warning. If it doesn't, move to `prDetached`.

**Soft UX.** Refresh is a state transition, not a remount. The PR panel reconciles the new `ChangeSet` against the previous one by file path and line; preserved across the swap: which files are expanded, which threads are expanded, which thread is selected, draft text in any open composer, scroll position. The pieces that *do* change visibly: comments that gained replies, comments that were edited, comments that flipped resolved state — each thread renders its badge for one refresh cycle and clears on next user interaction.

## UX details

**Thread badges.**
- `N new replies` — numeric, persistent until the thread is opened or the next successful refresh confirms no further new replies.
- `edited` — applied to any comment whose body changed since last pull.
- `resolved` / `unresolved` — applied to the thread when isResolved flips.
- `may have moved` — applied when the local-vs-GitHub anchoring re-derive kicked in.
- `new activity since you started typing` — applied to a thread that has an open draft when refresh brings in any of the above.

**Header banner copy.**
- New commits: "GitHub HEAD has advanced (`<short-sha-old>` → `<short-sha-new>`). Reload re-anchors comments to the new diff." — the Reload button does the work; this banner is purely informational and dismissable.
- Auth expired: "GitHub credentials expired or invalid. [Open credentials]"
- Rate limited: "GitHub rate limit hit. Try again after `<reset-time>`."
- Upstream error: "GitHub returned an error. [Retry]"
- PR closed/merged: "This PR is `<merged|closed>`. New comments may not be accepted." — non-dismissable while state holds; authoring stays enabled.

**Author identity.** Pulled comments render `<avatar 24px> @handle` inline at the comment header. Self-authored (handle matches authenticated GitHub user's login) renders as `@you`. Local-authored (`source === "local"`) keeps current rendering — no GitHub identity attached yet.

**Suggestion blocks.** Body parser detects ```suggestion ... ``` fences and renders the block as a small diff (one removed, one added line group), inside the comment body. If the workspace exposes write capability, a small **Apply** button writes the suggestion into the local file at the suggestion's range. Disabled with tooltip in memory-only / no-clone modes.

## Slices

Each slice stands on its own.

**(1) Sync substrate.** Extend `Interaction` with `source` / `githubId` / `githubAuthor`. Bump `ReviewState` version and write the migration (existing entries become `source: "local"`). Create the `githubSync` sibling map and wire its persistence next to `ReviewState`. No UI changes; the substrate just exists. *Done when:* a fresh load populates the new fields on pulled comments, and a saved review restores them on reload.
**Tests:** ReviewState migration test (v(N) → v(N+1) populates `source: "local"` on every existing interaction; idempotent on re-load). `githubSync` persistence round-trip through the local-storage layer. Shape tests for the extended `Interaction` type.

**(2) Manual refresh action.** Server: teach `/api/github/pr/load` to honour `If-None-Match`, return ETag + `headSha` on every response, and add `overview` (title/body/conversation comments via `/issues/{n}/comments`) and `resolvedByThread` (GraphQL) to the response. Client: a Reload button in the PR panel; on click, re-run `loadGithubPr` and reconcile the result into the existing panel state preserving expansion / scroll / drafts. *Done when:* clicking Reload on an open PR fetches and reconciles without losing UI state, and a 304 short-circuits the merge.
**Tests:** Cassette infrastructure lands here — anonymization script + its own unit tests (determinism, substitution coverage, lint pass) and the "kitchen sink" PR cassette that downstream slices reuse. Server PR-load mapping (all surfaces round-trip into `PrLoadResult`), pagination across `>per_page` comments, ETag 304 short-circuit, GraphQL `resolvedByThread` keying, error translation (incl. a new `github_rate_limited` discriminator). Route-level tests for the new response fields and `If-None-Match` propagation. Client tests for `PrLoadResult` shape, the 304 sentinel, and the rate-limit discriminator. Reducer test: refresh reconcile preserves expansion / draft / selection state for unchanged threads.

**(3) Change detection + per-thread badges.** Diff the refresh response against `githubSync.threads` to emit per-thread changes. Render the four thread badges (reply, edit, resolve, may-have-moved). PR-header banner when `lastSeenSha` differs from the new `headSha`. *Done when:* a teammate's reply on GitHub renders as "1 new reply" on the next refresh; an edit renders "edited"; resolve flips the tag and badges the thread.
**Tests:** Pure-function `diff(prevSync, refreshResponse) → ThreadChange[]` with one case per change kind (new replies, edited, resolved, unresolved) plus the edge cases (resolved-then-unresolved between two refreshes; edit + new-reply combined on one thread). Reducer tests for badge application and for "new activity since you started typing" applying only to threads with an open draft *and* a change. Badge clear-on-interaction. UI component tests for badge render; PR-header new-commits banner.

**(4) PR overview section.** New top-of-panel block rendering PR title, body, and conversation comments threaded chronologically. New `target` value on `Interaction` (e.g. `pr-overview`) to host conversation comments in the same store; rendering layer routes by target. *Done when:* a PR with both review comments and conversation comments shows both, in their respective panels.
**Tests:** Mapping assertion: the kitchen-sink cassette's conversation comments land under `target: "pr-overview"` and not in the file-anchored list. UI component test: overview section renders PR title/body and threaded conversation comments in chronological order.

**(5) Resolved-thread surfacing.** Render the small `Resolved` tag on threads where `isResolved === true`. Cached in `githubSync.threads`. *Done when:* a thread resolved on GitHub renders the tag after the next refresh.
**Tests:** Mapping assertion: `resolvedByThread` from the cassette's GraphQL response is keyed by thread node id and reaches the reducer. UI: `Resolved` tag renders on resolved threads only.

**(6) Author handle + avatar.** Render `githubAuthor` on pulled comments. Resolve the authenticated user's login via `GET /user` once per credential (cached in the `githubSync` map alongside the per-PR data, keyed by host) and compare to swap to `@you`. *Done when:* multi-reviewer PRs visibly disambiguate authors, and your own remote comments render as `@you`.
**Tests:** `GET /user` resolution + per-credential caching (first call hits the network, second is a cache hit). UI render of avatar + handle for multi-reviewer cassettes; `@you` swap when the rendered handle matches the cached authenticated login; fallback to plain handle when the login lookup hasn't completed yet.

**(7) Suggestion blocks: render + apply.** Body parser for ```suggestion fences with diff highlighting. Apply button gated by workspace capability flag; writes the file through an existing worktree-write helper. *Done when:* a suggestion comment renders with the diff and the Apply button works on a disk-available worktree; the button is hidden in memory-only.
**Tests:** Body parser unit tests for ```suggestion fences (single-line, multi-line, malformed, suggestion-after-prose). UI: suggestion block renders with diff highlighting; Apply button visible on disk-available workspaces and absent on memory-only / no-clone. Apply integration: click writes through the worktree-write helper and the resulting file content matches.

**(8) Failure banner.** Inline panel banner with three variants (auth / rate limit / upstream) plus the PR-state-change banner. Auth deep-links to the credentials UI; rate-limit shows the reset time from the response headers. *Done when:* simulated 401, 403-with-rate-limit, 5xx, and a PR transitioning to merged each render their banner correctly.
**Tests:** Each banner variant renders with the documented copy and CTA. Server-error → discriminator → banner-variant mapping unit-tested. Auth banner's CTA navigates to the credentials UI.

**(9) HEAD-mismatch re-anchor.** Compare the worktree HEAD to the response `headSha`; for divergent cases, run `contentAnchor` over affected threads against the local diff. Threads that re-anchor get the warning badge; threads that don't move to `prDetached`. *Done when:* a worktree with one extra local commit on top of GitHub still renders comments correctly, with warnings on the threads that needed re-anchoring.
**Tests:** Re-anchoring matrix as fixture cases against `contentAnchor`:
- Local HEAD == GH HEAD → GitHub `position` accepted verbatim, no `contentAnchor` runs.
- Local HEAD diverges, divergent commit doesn't touch any commented file → GitHub `position` still accepted.
- Local HEAD diverges + touches a commented file, `contentAnchor` lands → thread rendered at local position with `may have moved` warning.
- Same, `contentAnchor` fails → thread moves to `prDetached`.
- Worktree with uncommitted edits → treated as a virtual ahead-commit, same logic.
- Previously-detached comment becomes anchorable again on refresh → returns to `prInteractions`.

Recommended order: **(1) → (2) → (3)** as the shippable backbone. After (3) the feature has end-to-end user value. **(4)–(9)** can land in any order behind that.

## Target push design (not v0)

Captured so we don't paint ourselves into a corner with v0 choices. None of this is built in this plan; it's the design we'll start from when push becomes the next plan.

- **Grouping: batch as a Review.** Locally authored comments accumulate as a pending review; the user clicks "Submit review" and picks an event (`APPROVE` / `REQUEST_CHANGES` / `COMMENT`). One `commit_id` per submission keeps anchoring deterministic.
- **Intent → body prefix only.** Our `intent: comment|question|request|blocker` renders as a `[Question]` / `[Request]` / `[Blocker]` tag inside the pushed comment body. The review event is a separate explicit choice at submit time. Intent does *not* mechanically pick the event.
- **Replies use the reply-to-thread endpoint immediately**, since they don't need to batch into a review.
- **Resolve / unresolve from Shippable**, when added, uses the GraphQL `resolveReviewThread` / `unresolveReviewThread` mutations and flips `isResolved` in the sync cache.
- **Suggestion authoring** writes ```suggestion fences into the pushed body. Apply-to-worktree (v0) is the *receive* side of the same primitive.
- **Identity** for pushed comments is the authenticated GitHub user. AI-authored interactions (`authorRole === "ai"`) need a separate decision before push: push with a banner-prefix, push as a comment on the user's behalf with a `[from AI]` tag, or never push. Default: never push without an explicit reviewer gesture.
- **Dedup** uses `githubId`: once a comment has a `githubId` it has been pushed and a subsequent edit becomes a PATCH, not a POST.
- **Source promotion on push.** When a `source: "local"` interaction is pushed and receives a `githubId`, it flips to `source: "github"` and gains `githubAuthor` (the authenticated user). Subsequent replies pulled from GitHub against that thread arrive as `source: "github"` naturally. There is no mixed-source thread except briefly during the in-flight push.

## Things that will bite us

- **`Origin: null` / opaque-origin** on the local server (existing concern; see comment in `server/src/index.ts`). Refresh hits the same endpoint as load, so the same handling applies — verify the refreshed response doesn't trip a different CORS path.
- **Avatar URL hot-linking.** GitHub avatars are served from `avatars.githubusercontent.com`; they're stable but rate-limited and CDN-cached. Render with `loading="lazy"` and don't proxy.
- **GraphQL vs REST split.** Resolved state is GraphQL-only; everything else is REST. Two clients, two error shapes — funnel both through the existing `GithubApiError` translation.
- **Anonymized cassette fixtures.** Easy to leak a real handle or SHA. Anonymization should be a script in `server/src/__fixtures__/` so re-recording follows the same path, not a one-off manual scrub.
- **Migration of existing reviews.** v0 bumps `ReviewState` version. The migration must set `source: "local"` on every existing interaction — anything left without `source` will fail the new invariant.
- **`enqueuedCommentId` collision.** Shippable already has an `enqueuedCommentId` on Reply for the agent queue. The GitHub `githubId` is a *separate* identifier; do not reuse the field. Two channels, two ids.

## Testing

Per-slice test work lives inline in § Slices — each slice owns the tests that ship with it. This section captures only the cross-cutting pieces.

**Test styles used.** Cassette-driven integration tests where wire-shape fidelity actually pays rent (server PR-load handler, route layer). Handwritten `fetch` mocks for the client. Pure-function unit tests for everything in the reducer and the change-detection diff — this is where most coverage lives. Fixture-driven cases against `contentAnchor` for re-anchoring. Component tests for UI. The anonymization script gets its own unit tests in slice (2) since that's where it's introduced.

**Manual smoke checklist** (paste into the PR description when slices (2) or (3) land — automation won't catch these UX qualities):
- Refresh while typing a multi-line draft — draft text unchanged, scroll position unchanged, badge appears on the thread if relevant.
- Refresh after the PR gained 50+ new comments — panel doesn't visibly judder.
- Refresh on a PR that just merged — banner appears, authoring still works.
- Refresh with no network — banner appears, prior state intact.

**Cassette fixture set.** One anonymized "kitchen sink" PR cassette (anchored review comments, replies, conversation comments, summary body, resolved thread, suggestion block) authored in slice (2) and reused by slices (3)–(6). Three small failure-case cassettes (auth, rate-limit, upstream) authored alongside slice (8). The anonymization contract is defined below.

## Cassette anonymization

A small script lives at `server/src/__fixtures__/anonymize.ts`. It reads a captured raw GitHub response (REST or GraphQL), applies deterministic substitutions, and writes the anonymized JSON. The raw capture directory is gitignored; only anonymized fixtures are committed.

**Substitution table:**
- `user.login`, `user.html_url`, `user.url` → `fake-reviewer-N` (N stable per unique login within a fixture set, via a `Map<realLogin, fakeLogin>` accumulator).
- `user.avatar_url` → `https://example.com/avatar/<sha1(login).slice(0,16)>.png`.
- `user.email` → stripped.
- `user.id`, `user.node_id` → stable hash within the fixture set.
- Repo coordinates in any URL (`/owner/repo/...`) → `/fake-org/fake-repo/...`.
- Commit SHAs → stable 40-char hex per unique SHA (first-seen → `0000…001`, `0000…002`, etc.).
- `created_at` / `updated_at` → relative ordering preserved, shifted to deterministic 2026 dates.
- Comment `body` text → kept as-is by default. Lint pass at the end of the script scans the output for any of: the real org name, the real repo name, any real login from the substitution map, anything matching `@\w+` not in the substitution map, anything matching an email regex. Lint fail blocks the recording.

**Re-record workflow:**
```
GITHUB_TOKEN=… npm run github:record-fixture -- https://github.com/<real-pr>
```
Calls real GitHub, writes raw responses to `__fixtures__/raw/<fixture-name>/` (gitignored), anonymizes into `__fixtures__/<fixture-name>/`, runs the lint pass, deletes raw. Re-running with the same fixture name overwrites. The list of real org/repo/login values fed into the lint pass comes from `.env.fixture-record` (also gitignored) so they don't leak into the script itself.

## Pointers

- `server/src/github/pr-load.ts` — existing PR-load handler. Extend here.
- `web/src/githubPrClient.ts` — existing client. The Reload button calls the same `loadGithubPr`.
- `web/src/interactions.ts` / `web/src/state.ts` — `Interaction` shape and the reducer; this is where the version bump lands.
- `docs/concepts/review-state.md` — current `ReviewState` shape and versioning history.
- `docs/concepts/diff-ingestion.md` — `contentAnchor` lives here; the re-anchor pass reuses it.
- `docs/plans/share-review-comments.md` — sibling channel (agent comments). Different transport, similar pip/badge pattern. Read for tone.
- `docs/architecture.md` — the canonical map; update once (1)–(3) ship.
