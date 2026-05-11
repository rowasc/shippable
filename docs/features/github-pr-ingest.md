# GitHub PR Ingest

## What it is

Load a GitHub (or GitHub Enterprise) pull request directly into Shippable by pasting its URL. The diff, PR metadata, line-anchored review comments, and PR conversation all load together — no local checkout required. Per-PR `ReviewState` persists across reloads the same way worktree review state does.

## Try it

Open LoadModal → **From URL**, paste a URL like:

```
https://github.com/wordpress/gutenberg/pull/12345
```

Submit. Shippable accepts HTTPS PR URLs only, prompts for a Personal Access Token if one isn't already stored for that host, then loads the PR. For GitHub Enterprise hosts, Shippable first asks you to confirm that the host is trusted and shows the exact API base URL the token will be sent to. The changeset header shows the PR title, state (open / closed / merged), base→head refs, and a **Refresh** button to re-fetch on demand.

## Worktree↔PR overlay

When a worktree is loaded and its current branch resolves to an open upstream PR, a pill appears in the Inspector:

> Matching PR: #N — <Title>

Clicking the pill calls `POST /api/github/pr/branch-lookup`, then `POST /api/github/pr/load`, and merges the result into the live ChangeSet: `prSource` is set, PR conversation is attached at the changeset level, and line-anchored review comments appear inline in the diff under the affected lines. The local diff is not modified — the overlay only adds metadata and comments. Both `worktreeSource` and `prSource` are set simultaneously on the same ChangeSet.

The pill is opt-in. It does not fire on worktree load automatically; it only appears when a match is found.

## PR review comments

Line-anchored review comments render in the Inspector alongside AI notes, under the hunk that contains the commented line. Each comment shows author, timestamp, and a link to the comment on GitHub. Multi-line comments include a "(spans X–Y)" hint. Issue-level PR conversation items appear in a "PR conversation (N)" disclosure in the changeset header.

All PR comments are read-only and re-fetched with every Refresh — they are not part of `ReviewState` and do not need rehydration.

## v0 limitations

- **No expand-context for remote PR files.** The expand-context affordance is hidden for files that don't have an on-disk presence; it requires a local worktree or workspace root.
- **No posting back to GitHub.** v0 is read-only. Sending review comments back as PR comments is a later SDD that pairs with the hosted backend.
- **Manual refresh.** No background polling. Hit the Refresh button in the changeset header to re-fetch.
- **Single PAT per host.** One token covers all repos on a given host. Multi-account on the same host is not supported.
- **Paste-only.** There is no "My PRs" list or saved-recents drawer; paste the PR URL each time.
- **No rate-limit visualization.** If the GitHub API rate limit is exceeded, an error banner appears; a remaining-requests indicator is a follow-up.

## Token setup

The token modal opens automatically the first time you load a PR from a new host. Enter a PAT with `repo` scope (for private repos; any valid token works for public PRs).

GitHub Enterprise hosts require a one-time local trust confirmation before the token field appears. `github.com` skips this extra step.

- **Desktop app:** token is written to macOS Keychain (`service=shippable, account=GITHUB_TOKEN:<host>`) and survives restarts.
- **Browser dev mode:** token is held in server memory only; re-enter it whenever the server restarts.

If GitHub rejects the token (expired, revoked, wrong scope), Shippable shows an auth-rejected banner with a "Re-enter token" affordance that re-opens the token modal.

See `README.md` § "GitHub Personal Access Token" for the full setup reference and how to remove a stored token.

## Design notes

Full rationale — endpoint design, token model, PR comment storage strategy, worktree overlay data flow — is in `docs/sdd/gh-connectivity/spec.md`.
