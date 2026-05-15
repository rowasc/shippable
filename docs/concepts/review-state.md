# Review State

## What it is
The local state model for an in-progress review session.

## What it does
- Tracks the current cursor position inside the diff tree.
- Separates read progress from explicit sign-off.
- Tracks dismissed guide suggestions, expand levels, and block selection.
- Stores every per-author signal — user replies, AI notes, teammate verdicts, agent responses, acks — as `Interaction`s in `state.interactions: Record<threadKey, Interaction[]>`. See `docs/architecture.md § Review interactions`.
- Keeps the current session shaped around one reviewer, one machine, and local persistence.

## Sign-off levels

Sign-off has two independent levels, each tracked in its own field on `ReviewState`:

- `reviewedFiles: Set<string>` — per-file sign-off, keyed by `fileId`. Toggled by Shift+M on a file.
- `reviewedChangesets: Record<string, string>` — per-changeset sign-off, keyed by `changesetId`, valued by an **at-token** captured at the moment of sign-off (see below).

The two are **independent**. Marking a changeset as reviewed does **not** mark its files as reviewed, and marking every file as reviewed does **not** mark the changeset as reviewed. Either can be set or unset without touching the other.

### Why independent and not cascading

Cascading "mark changeset reviewed → mark every file reviewed" would feel natural for the bulk-sign-off case, but it would destroy a signal we may want later: which files the reviewer *actually* ticked off versus which got swept under a top-level mark. A reviewer who skims a 50-file PR, ticks the three files they cared about, and then signs off the whole changeset carries different information than a reviewer who ticked every file individually. Cascading collapses those two cases into one.

We're keeping the granularity even though we don't surface it in the UI today. The UI can compute and display whatever roll-up is useful ("3 of 7 files reviewed, changeset signed off") from the two fields independently. We don't yet know which roll-ups will matter, and the cheap thing is to preserve the underlying data.

The same logic applies in the other direction: marking every file reviewed should not auto-sign-off the changeset, because per-file ticks and "I've looked at this as a whole" are different claims.

## At-tokens and stale sign-off

A changeset's content can change after sign-off — new commits, a force-push, a dirty working tree. `reviewedChangesets` stores an **at-token** alongside each id so we can detect divergence.

The at-token is "what state of the changeset was reviewed." Per kind:

- Worktree branch — the `headSha` from `worktreeSource`. (The changeset id itself already encodes this, so the comparison is trivial.)
- Worktree range — `fromSha + toSha`.
- Worktree dirty — the dirty hash (already in the id).
- GitHub PR — `prSource.headSha`.

On `loadSession`, for each entry in `reviewedChangesets`, find the corresponding loaded `ChangeSet`, compute its current at-token, and drop the entry if it differs. This mirrors the existing "drop stale ids" rule the persist layer already applies to `reviewedFiles` and hunk ids.

### Why this matters mostly for PRs

Three of the four changeset kinds (worktree branch, range, dirty) already encode their content state into the changeset id itself — a new commit produces a new id, so the persist layer's existing stale-id drop already handles it. The PR id is the exception: `pr:<host>:<owner>:<repo>:<number>` is stable across force-pushes by design, because we want interactions and other state to reattach to the same PR after a push. The at-token is what makes the PR case correct without breaking that identity.

### Future: surface staleness instead of dropping

Today we drop stale entries silently. The data we'd need to do better is right there — we could keep the entry and surface "reviewed at SHA abc, current is SHA def" in the UI, optionally letting the reviewer one-click confirm the new state is fine. That's a UI decision, not a data decision; the at-token mechanism is what enables it.

## Generalization

`reviewedFiles` and `reviewedChangesets` are parallel fields with the same shape. A future generalization to `reviewedTargets: Record<TargetKind, Record<string, string>>` covering files, changesets, and possibly descriptions, hunks, or symbols is sketched in `docs/plans/reviewed-targets.md`. Not a commitment — a note for future-us.
