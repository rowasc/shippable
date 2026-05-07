# SHA range selection for worktrees

## Context

Today, clicking a worktree in `LoadModal` immediately loads `branchChangeset(path)` — the cumulative `base..working-tree` view. There is no way to narrow that to a specific commit, a range of commits, or "everything from a SHA up to HEAD plus my uncommitted edits". This is exactly slice (b) of [`docs/plans/worktrees.md`](./worktrees.md) line 29 ("commit picker per worktree with range selector — `HEAD~N..HEAD`, or `<sha>..HEAD`"), still in backlog.

The user wants this to be **easy**: pick a SHA range (including a single commit) and optionally include uncommitted changes when the range ends at HEAD. The picker will live in **both** `LoadModal` (at load time) and the **topbar** (re-slice without reopening the modal). The default stays as today (whole branch).

## UX decisions (already confirmed)

- **Picker location**: both LoadModal and topbar.
- **Default selection**: whole branch (today's behaviour). Picker is opt-in.
- **Range UX**: two endpoints + "include uncommitted" toggle. Click a commit → set `from`. Shift-click → set `to`. Each commit row also has a "just this commit" shortcut.
- **Single-commit review**: a "just this" button on every row.

## Files to modify

- `server/src/worktrees.ts` — add `listCommits`, add `rangeChangeset`.
- `server/src/index.ts` — add `POST /api/worktrees/commits`; extend `POST /api/worktrees/changeset` body.
- `web/src/types.ts` — extend `WorktreeSource` (line 410) with optional `range`.
- `web/src/worktreeChangeset.ts` — extend `fetchWorktreeChangeset` to accept range/ref/dirty opts.
- `web/src/useWorktreeLoader.ts` — pass opts through `loadFromWorktree`; add a `fetchCommits` wrapper.
- `web/src/components/RangePicker.tsx` — **new** shared component.
- `web/src/components/LoadModal.tsx` — wire picker between worktree click and load (around lines 181–206).
- `web/src/components/ReviewWorkspace.tsx` — add a topbar button + popover near the `<branch> → <base>` block at lines 689–691.
- `docs/plans/worktrees.md` — mark slice (b) shipped; cross-link the PRs.

## Server design

### `listCommits(worktreePath, limit = 50)` in `worktrees.ts`

`git log -n <limit> --format=%H%x1f%h%x1f%s%x1f%an <%ae>%x1f%aI%x1f%P%x1e --end-of-options HEAD`. Reuse `assertGitDir`. Validate `limit ∈ [1, 500]`. Return `{ sha, shortSha, subject, author, date, parents: string[] }[]`.

### `rangeChangeset(path, fromRef, toRef, includeDirty)` in `worktrees.ts`

- `assertGitDir`; `validateRef(fromRef)`; `validateRef(toRef)` (the existing regex already accepts `HEAD`).
- Resolve `toSha`: `revParseHead()` if `toRef === "HEAD"`, else `git rev-parse <toRef>`.
- Committed body: `safeGitDiff(["diff", "--end-of-options", \`${fromRef}^\`, toRef])`. The range is **inclusive of `from`**, so the diff is against `from`'s parent. If `from` has no parent (root commit), retry against the empty-tree sha `4b825dc642cb6eb9a060e54bf8d69288fbee4904`. When `from === to`, this collapses to a single-commit `git show` body — that's the "just this commit" path.
- When `includeDirty && toRef === "HEAD"`: append `safeGitDiff(["diff", "HEAD"])` and the untracked-synthesised diff exactly as `branchChangeset` does (lines 449–464). Reuse `synthesiseNewFileDiff`.
- `fileContents` via `extractRenderablePaths`. Read from working tree (`fs.readFile`) when `includeDirty`; otherwise via `git show ${toSha}:${p}` (matches `changesetFor` lines 364–369).
- Metadata block (`subject`, `author`, `date`) via the same `git log -1 --format=…` pattern as lines 411–417, anchored on `toSha`.
- `parentSha` = short of `fromRef` (simpler than rendering `from^`'s short).
- `sha` = `dirty:${state.dirtyHash}` when `includeDirty && state.dirty` (matches the `dirtyChangesetFor` convention at line 578); else `toSha`.
- `state` via `stateFor(path)`.

**Reuse strictly**: `assertGitDir`, `validateRef`, `safeGitDiff`, `synthesiseNewFileDiff`, `extractRenderablePaths`, `revParseHead`, `stateFor`. No new helpers.

### Endpoints in `server/src/index.ts`

**New `POST /api/worktrees/commits`** mirroring `handleWorktreesState` (line 471). Body: `{ path: string, limit?: number }`. Response: `{ commits: [...] }`. Wire into the route table around line 83.

**Extend `handleWorktreesChangeset`** (lines 424–469). Parse `fromRef`, `toRef`, `includeDirty` alongside existing `ref`/`dirty`. Routing precedence (replaces lines 454–458):

1. `fromRef && toRef` → `rangeChangeset(path, fromRef, toRef, includeDirty === true)`
2. `dirty === true` → `dirtyChangesetFor(path)` *(unchanged)*
3. `ref` → `changesetFor(path, ref)` *(unchanged)*
4. else → `branchChangeset(path)` *(unchanged default)*

Existing callers (`{ path }`, `{ path, ref }`, `{ path, dirty: true }`) keep working — strict superset.

## Client design

### Types (`web/src/types.ts:410`)

Extend `WorktreeSource` with `range?: { fromRef: string; toRef: string; includeDirty: boolean }` so the loaded slice is recoverable and the topbar picker can prefill on next open.

### Fetch (`web/src/worktreeChangeset.ts`)

Extend `fetchWorktreeChangeset(wt, opts?)` with a discriminated opts param:

```ts
type LoadOpts =
  | { kind: "range"; fromRef: string; toRef: string; includeDirty: boolean }
  | { kind: "ref"; ref: string }
  | { kind: "dirty" }
  | undefined;  // default = whole branch
```

Build the request body conditionally. Stamp `cs.worktreeSource.range` on the result when `opts.kind === "range"`. Use a stable id for range loads: `wt-range-${fromShort}-${toShort}${includeDirty ? "-d" : ""}`.

### Loader (`web/src/useWorktreeLoader.ts`)

- `loadFromWorktree(wt, opts?: LoadOpts)` — forward `opts` to `fetchWorktreeChangeset`. Default callers stay on `branchChangeset` (decision: default = today's behaviour).
- `fetchCommits(path, limit?)` — thin wrapper over `POST /api/worktrees/commits`.

### `RangePicker.tsx` (new, shared)

Props: `{ worktreePath, defaultFromRef?, defaultToRef?, defaultIncludeDirty?, onApply(opts), onCancel(), onJustThis(sha) }`. Local state: `commits`, `fromRef`, `toRef`, `includeDirty`, `loading`, `err`. Renders:

- Two ref displays (clickable to focus the commit list).
- Commit list: each row a button. Plain click → set `fromRef`. Shift-click → set `toRef`. A small **"just this"** button per row → `onJustThis(commit.sha)` (parent calls `loadFromWorktree(wt, { kind: "ref", ref: sha })`).
- **"Include uncommitted changes" checkbox**, disabled when `toRef !== "HEAD"`. The `setToRef` callback must force-clear `includeDirty` whenever the new value isn't HEAD. Apply a `--disabled` class with reduced opacity and a tooltip ("uncommitted changes only available when range ends at HEAD"). **Easy to forget — flag this in code review.**
- "Apply" → `onApply({ kind: "range", fromRef, toRef, includeDirty })`.

### LoadModal (`web/src/components/LoadModal.tsx:181–206`)

Keep the existing row click → whole-branch load (preserves the chosen default UX). Add a small **"pick range…"** affordance on each row that opens `<RangePicker />` for that worktree. The picker's `onApply` calls `worktrees.loadFromWorktree(wt, opts)`; `onCancel` closes the picker; `onJustThis(sha)` calls `loadFromWorktree(wt, { kind: "ref", ref: sha })`.

### Topbar (`web/src/components/ReviewWorkspace.tsx:689–691`)

Next to `<span className="topbar__branch">{cs.branch} → {cs.base}</span>` add a `topbar__btn--range` button. Render only when `cs.worktreeSource` exists. Click opens `<RangePicker />` in a popover anchored to the button. Source `worktreePath` from `cs.worktreeSource.worktreePath`. Prefill from `cs.worktreeSource.range` when present. `onApply` calls `fetchWorktreeChangeset(wt, opts)` and forwards to the existing changeset-set path used by the workspace.

## Tests

- `server/src/worktrees.test.ts` (or extend `index.test.ts`) — temp-repo unit tests:
  - `listCommits`: 1-commit repo, N>limit, parents populated for merges.
  - `rangeChangeset`: `from === to` matches single-commit `git show` body; root-commit fallback to empty-tree sha; `includeDirty + toRef === HEAD` appends working-tree + untracked; `includeDirty` ignored when `toRef !== "HEAD"`.
- `server/src/index.test.ts` — exercise the new `/api/worktrees/commits` route and the new range branch of `/api/worktrees/changeset`. Add one regression assertion that legacy `{ path }`, `{ path, ref }`, `{ path, dirty: true }` still work.
- `web/src/parseDiff.test.ts` — untouched. `rangeChangeset` returns the same shape `parseDiff` already handles.
- `web/src/components/RangePicker.test.tsx` (new, only if a React testing harness is already wired in `web/package.json` — check first; otherwise skip and rely on manual UI verification): shift-click sets `toRef`; dirty toggle disabled when `toRef !== "HEAD"`; "just this" calls `onJustThis(sha)`.

## Shipping order — three small PRs

1. **PR 1 — Server contract.** `listCommits` + `rangeChangeset` + endpoints + server tests. No UI consumers yet. ~250 LOC.
2. **PR 2 — RangePicker + LoadModal.** Component, `fetchCommits`, `loadFromWorktree(wt, opts)` overload, `WorktreeSource.range` field, LoadModal wiring. Topbar untouched. ~400 LOC.
3. **PR 3 — Topbar re-slice.** Topbar button + popover, prefill from `cs.worktreeSource.range`. Update `docs/plans/worktrees.md` (mark slice (b) shipped). ~150 LOC.

Splitting this way validates the server contract in isolation, ships the most valuable user-visible slice (LoadModal picker) without waiting on topbar polish, and keeps each PR holdable in a reviewer's head.

## Verification

- `cd server && npm run typecheck && npm run test` — server contract passes; new tests cover `listCommits` and `rangeChangeset`.
- `cd web && npm run lint && npm run build && npm run test` — client builds, tests pass.
- Manual end-to-end: open `/`, scan a worktrees directory, click "pick range…" on a worktree row → list of recent commits appears → click a commit (sets `from`) → shift-click another (sets `to`) → toggle "include uncommitted changes" (only enabled when `to = HEAD`) → "Apply" loads the diff. Confirm the topbar shows `<branch> → <fromShort>`. Click the topbar range button → picker opens prefilled with the current range → change selection → diff updates. Try the "just this" shortcut on a single row → loads exactly that commit. Verify legacy worktree click (whole branch) still works unchanged.
