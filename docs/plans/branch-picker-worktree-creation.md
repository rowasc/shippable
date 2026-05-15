# Branch picker → worktree creation

## Why this exists

The current local-review flow is checkout-first:

- Shippable scans `git worktree list`.
- The user picks a checkout path.
- Everything downstream keys off that path: diff generation, live reload, LSP/code graph, agent-context matching by `cwd`, and the MCP queue.

That works well once a branch already has a checkout, but it fails the obvious case:

- "I have a branch."
- "It is not checked out anywhere."
- "I still expect to see it in Shippable."

We should support that expectation without lying about the underlying constraint. Shippable does **not** review abstract branch names; it reviews a real checkout on disk. So the workflow needs to let the user *start from a branch*, then create the missing worktree with clear rationale and an explicit location choice.

## Goal

Enable this loop:

1. User points Shippable at a repo root.
2. Shippable shows:
   - checked-out worktrees
   - local branches that exist but are **not** checked out anywhere
3. User picks an unchecked-out branch.
4. Shippable explains why a worktree is required.
5. User chooses where to put it.
6. Shippable creates the worktree and immediately loads it for review.

Done right, this removes the "why is my branch missing?" confusion without weakening the path-based model the rest of the app depends on.

## Non-goals

- Reviewing a branch directly from refs with no checkout on disk.
- Auto-creating worktrees with no confirmation.
- Managing every Git edge case in v1 (prune stale worktrees, move worktrees, delete worktrees, rename branches).
- Replacing the existing "pick an already-existing worktree" path.

That first non-goal may become a later mode, but not this one:

- a future "review branch without checkout" setting could exist
- it would need a blunt warning that capabilities are reduced or unavailable
- not for the first pass

## Product principles

### 1. Don’t hide the model

The UI should not imply "branch review" is detached from a checkout. The user can *start from a branch*, but the system should say plainly:

> Shippable reviews a real checkout, not a branch ref.  
> We need a worktree so the reviewer, MCP tools, and agent context all point at the same files on disk.

That explanation matters because it answers the follow-up "why can't you just diff the branch?" with evidence from the product's architecture rather than Git trivia.

### 2. Fast path for existing worktrees, guided path for missing ones

If a branch is already checked out, loading it should still be one click.

If a branch is not checked out, the extra step is justified and should feel deliberate, not like an error state.

### 3. Let the user control the location

Worktree location is workflow, not just plumbing:

- some users want sibling directories next to the repo
- some want `.claude/worktrees/`
- some want a custom scratch area

We should offer a recommended default, not force one convention.

A later follow-up should also let users save a default worktree-location strategy so repeat use is not annoying.

## User-facing workflow

### Entry point

Current copy like "Open a local branch" is directionally right but technically sloppy. The entry point should become:

- **Open local code**
- subtext: "Pick an existing checkout, or choose a branch and create a worktree for it."

Terminology should be explicit in the plan and the product:

- **repo root** = an actual git checkout with a `.git` entry, where local branches live
- **worktrees folder** = a plain directory that contains several sibling checkouts

That distinction matters because only a repo root can answer "what local branches exist here?" A worktrees folder can only answer "what checkouts are already on disk?"

The row list should have two sections:

- **Checked out now**
- **Branches not checked out**

### Section A: checked out now

Exactly today's behavior:

- branch name
- path
- HEAD sha
- "pick range…"
- click row → load review

### Section B: branches not checked out

Each row shows:

- branch name
- ahead/behind or upstream info if cheap to compute; omit in MVP if not
- status badge: `not checked out`
- primary action: `create worktree…`

Clicking the row itself should not silently create anything. The explicit button matters.

This view will also need search once the list is large:

- one search field
- filters the loaded worktree rows and loaded branch rows together
- probably a follow-up slice, but the layout should leave room for it

### Create-worktree dialog

When the user clicks `create worktree…`, open a modal with:

- title: `Create worktree for <branch>`
- short explanation:

  > Shippable needs a real checkout on disk for this branch.  
  > The checkout path is how review, live reload, MCP, and agent context stay aligned.

- location choices:
  - `Use recommended location`
  - `Choose folder…`
  - `Enter path manually`

Recommended location rules:

1. If `<repo>/.claude/worktrees/` exists, default to `<repo>/.claude/worktrees/<sanitized-branch-name>`
2. Else default to a sibling directory: `../<repo-name>-<sanitized-branch-name>`
3. Show the full resolved path before confirm

Controls:

- primary: `Create and open`
- secondary: `Cancel`

Optional helper copy:

> Git will create a linked checkout for this branch. Your main repo stays where it is.

### Success path

On success:

1. create the worktree
2. refresh the worktree/branch list
3. load the new worktree immediately
4. persist it to recents as a normal `worktree` source

The user should land in the same review UI as if the worktree had already existed.

### Failure paths

#### Path already exists

Show:

> That folder already exists. Pick an empty location or use the existing checkout if it is already a git worktree.

If the path is already a valid worktree for the same branch, offer:

- `Use existing checkout`

#### Branch already checked out elsewhere

Git may reject creating a second worktree for a branch already checked out. Surface the Git message, but normalize it:

> This branch is already checked out at `<path>`.  
> Open that checkout instead, or create a new branch if you want a second working copy.

If we can resolve the existing path, show an `Open existing checkout` action.

#### Dirty/stale repo state

If the repo is in a weird state (rebase, missing refs, bad branch name), surface the real error and stop. Do not guess.

## Why the explanation is necessary

Users will reasonably ask why we cannot simply review `refs/heads/feature-x`. The answer should be embedded in the product:

- **MCP queue** is keyed by `worktreePath`
- **agent session matching** is keyed by transcript `cwd === worktreePath`
- **definition lookup / code graph** run against a checkout root
- **live reload** polls a checkout state (`HEAD`, dirty hash)

So the explanation is not "Git worktrees are neat." It is:

> The rest of Shippable is path-based. A worktree gives the branch a stable path the whole system can agree on.

## Proposed server changes

### New query: list local review targets

Current `POST /api/worktrees/list` only returns checked-out worktrees. Leave it that way for existing callers.

Do **not** make `/api/worktrees/list` suddenly become about branches too. That endpoint name already means something narrower.

Add a new endpoint instead:

`POST /api/review-targets/list`

Why this name:

- `review-targets` is specific to what the UI is actually choosing between
- `local-targets` is too vague
- `worktrees/list` is too narrow once branches are part of the result

Request:

```ts
{
  rootPath: string;
}
```

`rootPath` may be either:

- a repo root, in which case the response can include both worktrees and local branches
- a worktrees folder, in which case the response can include worktrees only

Response:

```ts
interface ReviewTargetsListResponse {
  rootKind: "repo-root" | "worktrees-folder";
  repoRoot?: string;
  worktrees: Array<{
    kind: "worktree";
    path: string;
    branch: string | null;
    head: string;
    isMain: boolean;
  }>;
  branches: Array<{
    kind: "branch";
    name: string;
    head: string;
    isCheckedOut: boolean;
    checkedOutPath?: string;
    upstream?: string | null;
  }>;
}
```

Rules:

- `worktrees` remains the source of truth for existing checkouts.
- `branches` are returned only when `rootKind === "repo-root"`.
- branch discovery comes from local branches under `git for-each-ref refs/heads`.
- branches already checked out still appear in `branches`, but flagged `isCheckedOut: true`
- the UI may choose to hide checked-out branches from the "not checked out" section

Why keep both arrays instead of inventing one merged type? Because they are not the same thing:

- a worktree is a checkout
- a branch is a ref

Merging too early is how we end up lying to ourselves again.

Why support both repo roots and worktrees folders at all?

- repo root is what unlocks branch discovery
- worktrees folder preserves the existing "show me the checkouts already on disk" workflow

The response needs to say which mode we are in so the UI can explain why the branch section may be absent.

### New mutation: create worktree

Add:

`POST /api/worktrees/create`

Request:

```ts
{
  repoRoot: string;
  branch: string;
  destinationPath: string;
}
```

Behavior:

1. validate `repoRoot` as a git repo
2. validate `branch` resolves to a local branch
3. validate `destinationPath` is absolute and allowed
4. run `git worktree add <destinationPath> <branch>`
5. return the created worktree descriptor

Response:

```ts
{
  worktree: {
    path: string;
    branch: string;
    head: string;
    isMain: false;
  };
}
```

### Recommended-location helper

Avoid pushing path-construction rules into the web app. Add:

`POST /api/worktrees/recommend-path`

Request:

```ts
{
  repoRoot: string;
  branch: string;
}
```

Response:

```ts
{
  suggestedPath: string;
  strategy: "claude-worktrees" | "repo-sibling";
}
```

Why separate endpoint? The rules are filesystem-sensitive and should stay server-side:

- whether `.claude/worktrees` exists
- what the repo basename is
- whether the path already exists

The web should render the choice, not reinvent path policy.

## Proposed frontend changes

### Welcome / LoadModal

Replace the mental model "scan for worktrees" with "scan repo for local review targets."

Concretely:

- scan input still accepts a repo root or worktrees folder
- result view groups:
  - existing checkouts
  - unchecked-out branches
- unchecked-out branch rows get `create worktree…`

If the scanned path is a worktrees folder rather than a repo root, render only the worktree section and a small note:

> Branch discovery needs a repo root. This folder only contains existing checkouts.

### Dialog state

New modal state:

- selected branch
- suggested path
- override mode: recommended / chosen / manual
- validation / create-in-flight state

### Copy changes

Current copy that says "loads the latest committed diff from the worktree you pick" is accurate but incomplete. Update it to say:

> Pick an existing checkout, or choose a branch and create a worktree for it.

The explanation modal should mention MCP and agent context only once, in plain language. No wall of text.

## Edge cases worth handling

### 1. Detached HEAD worktrees

Still valid as worktrees. They belong only in the "checked out now" section, never the branch-create section.

### 2. Remote-only branches

Out of scope for v1. Start with local branches only. If the branch does not exist locally, the user can fetch it first.

Future extension:

- list remote branches
- offer "create local branch + worktree"

That is a separate product decision and adds more ways to be surprising.

### 3. Existing path points at a plain directory

Reject unless empty. Do not let Git's raw error be the first message the user sees.

### 4. Existing path points at another repo/worktree

Reject and say what it is, if detectable.

### 5. Branch already checked out

Prefer opening the existing worktree over allowing duplicate-branch confusion.

## Recommended rollout

### Slice 1: branch discovery only

- widen scan results to show unchecked-out local branches
- UI explains why they are not directly openable yet
- no create action

This is a cheap truth-telling step and validates the information architecture.

### Slice 2: create worktree at recommended path

- `create worktree…`
- modal with explanation
- recommended path only
- `Create and open`

This gets the end-to-end loop working with minimal UI complexity.

### Slice 3: custom destination

- chooser
- manual path entry
- path recommendation endpoint

This is the right time to add location flexibility.

### Slice 4: polish

- resolve and open existing checkout when branch is already checked out
- better upstream/ahead-behind metadata
- remember preferred location strategy per repo
- add search across the loaded worktree rows and the loaded branch rows

### Slice 5: optional branch-without-checkout mode

- explicit opt-in setting
- reduced-capability warning in the UI
- no MCP / no agent-context assumptions

Only worth doing if users still ask for it after the worktree-creation flow exists.

## Open questions

- Should "recommended location" prefer `.claude/worktrees` even for human-only repos?
  - Lean: only if that directory already exists. Don't create a Claude-shaped convention uninvited.

- Do we need a per-repo "default worktree location" preference?
  - Not in the first pass. Useful later, and likely worth a real Settings entry once the branch-create flow lands.

- Should creating a worktree also auto-open a terminal/agent there?
  - No. Different workflow, different risk.

## Files likely involved

- `server/src/worktrees.ts`
- `server/src/index.ts`
- `server/src/worktree-validation.ts`
- `web/src/useWorktreeLoader.ts`
- `web/src/components/Welcome.tsx`
- `web/src/components/LoadModal.tsx`
- new modal component for worktree creation
- `docs/plans/worktrees.md`

## Relationship to the existing worktrees plan

This is an extension of `docs/plans/worktrees.md`, not a replacement.

That plan solved:

- "I have a checkout; review it."

This plan solves:

- "I have a branch; help me get to a checkout without leaving Shippable."
