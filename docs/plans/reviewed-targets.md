# `reviewedTargets` — design plan stub

## Status: not started

This is a note for future-us. Not a commitment, not scheduled. Written down so the next person touching review state doesn't have to rediscover the shape.

## The idea

Today `ReviewState` has two parallel fields for sign-off:

- `reviewedFiles: Set<string>` — fileId → reviewed
- `reviewedChangesets: Record<string, string>` — changesetId → at-token (see `docs/concepts/review-state.md`)

They share a shape: "a target was signed off at a point in time." The first one happens to not need the at-token today because file content within a changeset is implicit to the changeset's at-token, but the asymmetry is incidental.

The generalization:

```ts
type TargetKind = "file" | "changeset" | "description" | "hunk" | "symbol";
reviewedTargets: Record<TargetKind, Record<string, string>>;
// kind → (targetId → at-token)
```

Each `(kind, targetId)` pair maps to an at-token. Lookup, set, unset, and stale-drop on load all work uniformly across kinds.

## Why we might want it

- **Description sign-off.** Reviewing the PR description / changeset prose is a real part of a review, especially for changesets where the prose carries the design rationale. Today there's no way to mark it reviewed.
- **Hunk sign-off.** For long files, "I've signed off on this hunk but not the file" is plausible. Today the only level below file is line-level read tracking (`readLines`), which is implicit and not a claim.
- **Symbol sign-off.** Once symbol navigation lands (`docs/plans/plan-symbols.md`), reviewing "the new behavior of `foo()`" across its uses is a sign-off shape that doesn't fit file/hunk.
- **Uniform persist / migration.** One field to serialize, one stale-drop rule, one shape to extend.

## Why we haven't done it yet

- Two fields is not enough to justify the abstraction (the AGENTS.md "no premature abstraction" rule applies). The cost of refactoring later is small: rename, fold into the new shape, bump persist version, migration is "drop unknown kinds."
- We don't know which target kinds matter yet. Description sign-off has the most pull; hunk and symbol are speculative.
- The UI question — how to surface multiple target kinds without overwhelming the reviewer — is harder than the data question.

## What would trigger doing it

Any one of:
- A third sign-off level lands (most likely description).
- A consumer of review state needs to iterate over "everything signed off in this changeset" and the current per-field iteration becomes annoying.
- Persist schema bumps for an unrelated reason and we can fold the rename in cheaply.

## Open questions

- Should `TargetKind` be open (string) or closed (union)? Closed is safer; open lets plugins extend.
- Are the at-tokens for different kinds comparable, or kind-specific? File at-token would presumably be the parent changeset's at-token; description at-token is the description text hash or the changeset's at-token; symbol at-token is the symbol definition hash. Some of these are derivable; some need to be stored.
- Does this replace `reviewedFiles` and `reviewedChangesets`, or wrap them? Replacing is cleaner; wrapping is one persist-version safer.

## Non-goals

- Multi-reviewer sign-off. The current model is one reviewer, one machine. Multi-reviewer is a different design and doesn't depend on this generalization.
- Cross-changeset rollups ("this symbol was reviewed in PR #123 so don't ask me again in PR #124"). Out of scope for the local-state model.
