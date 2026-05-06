# Worktree live reload

When you point Shippable at a worktree, the changeset you see is a snapshot of `HEAD` at the moment you loaded it. If an agent commits five seconds later, or starts editing files without committing, the reviewer doesn't notice. You have to reopen the modal, find the worktree again, and reload — every time. For the "review-while-they-work" loop in `worktrees.md` to feel like an inbox rather than a stale pull, the reviewer has to follow the worktree on its own.

This plan adds **live reload**: while a worktree is loaded, the reviewer watches it for *any change* — new commits and uncommitted edits — and offers to surface them. The user always chooses when to absorb a new state; we don't yank the diff out from under them. On by default, with a clear toggle to turn it off — some users will want a stable view while they work through a review without the floor moving under them.

This folds in two items `worktrees.md` set aside as "deliberately out of scope": real-time file watching, and reviewing uncommitted working-tree changes. It also pairs with slice (c) of that plan — once we have a per-worktree review cursor, "live reload" and "what's new since I last reviewed" become the same loop expressed two ways.

## Goal

What this enables:

- Load a worktree, walk away, come back: the reviewer is showing the latest state — last commit if the tree is clean, or last commit *plus* whatever the agent has been editing since.
- Agent commits or edits while you're scrolling: a non-disruptive notification offers the new state, you click to load it.
- Reviewing dirty, uncommitted work feels normal — that's a primary use case, not a bonus.
- Comments survive the reload. Threads attached to lines that still exist stay inline. Threads whose lines moved or vanished show in a "Detached" pile in the sidebar with enough context to remain meaningful.
- One toggle per worktree, remembered across sessions and ON by default.

What it explicitly does *not* try to do:

- Live cursor / scroll preservation across reload. Best effort: same file if it still exists, otherwise file 0.
- Pushing updates to anyone but the user who loaded the worktree. Single-tab feature.
- Working in deployment modes without a server. Same gating as the parent feature.
- Per-keystroke updates. Polling cadence is the debounce.

## What "the diff" means

The existing worktree loader uses `HEAD~1..HEAD` — the last commit. With uncommitted changes in the picture, we need a rule that doesn't double-count when the agent commits work that was previously sitting uncommitted.

**Rule:**

- **Clean tree** → `HEAD~1..HEAD`. The last commit, same as today.
- **Dirty tree** → `HEAD..working-tree`. Everything not yet in `HEAD`: uncommitted edits, staged or unstaged.

When an agent finishes their uncommitted edits and commits them, the view transitions cleanly: dirty hash goes away, HEAD advances by one, and the diff we show is `HEAD~1..HEAD` — which is *the same content* the user was just reviewing as uncommitted. No duplication, just a baseline shift.

The dirty-state changeset doesn't have a real commit sha. We synthesize one — `dirty:<dirtyHash>` — so the rest of the review machinery still has a stable id that changes when the underlying state changes.

## Comment anchoring

This is the part that's new versus the rest of the live-reload work. The existing reply keys are positional (`<csId>/<path>#h<n>:<lineIdx>`), which silently mis-attaches as soon as a hunk shifts. To reload without losing review progress, we anchor on **content** instead.

Each `Reply` is extended with:

```ts
{
  // existing fields…
  originSha: string;           // worktree HEAD at write time
  originType: "committed" | "dirty";
  anchorPath: string;
  anchorContext: DiffLine[];   // 10 lines centered on the anchor (≈5 above, anchor, ~4 below)
  anchorHash: string;          // hash of the inner 5 lines (anchor ± 2)
}
```

`anchorContext` is the wide window we keep for **display**. `anchorHash` is the narrow window we use for **matching**. We store both because the wide window is fragile as a match key (any nearby edit breaks it) but useful as an "is this what you commented on?" reminder. Storing the snippet alongside the hash means the unattached-dirty UX can show context without us having to chase the rapidly-mutating dirty diff.

**On reload, for each reply:**

1. Compute the candidate hash from the new diff at `(anchorPath, lineIdx)`. If it matches → keep inline at that location.
2. If not, scan the file's lines for any 5-line window with the same hash. Match → re-anchor (`lineIdx` updates). Cheap; one pass per reply per file.
3. No match → **detached**. Move the reply into a parallel `state.detachedReplies: DetachedReply[]` collection.

The same rule covers committed and dirty origins. The asymmetry is only in what the detached view offers:

- **Committed origin:** show body + `anchorContext` snippet + a "view at `<sha7>`" link that fetches the historical file content (slice (e)). Git is the source of truth; the snippet is just a hint.
- **Dirty origin:** show body + `anchorContext` snippet, captioned "from uncommitted edits at hh:mm." No "view at" link — there's no commit to fetch.

**Dirty → committed transition.** A comment authored against `dirty:<hash>` whose anchor hash matches the now-committed view re-attaches inline as if it had always been a committed comment. The `originSha` stays as it was at write time (the parent at that moment); we don't rewrite it. We're matching on content, not provenance.

## The slices

**(a) MVP — polling + notify banner, both commits and uncommitted.** Client polls `/api/worktrees/state?path=…` every few seconds. Endpoint returns `{ sha, dirty, dirtyHash }` where `dirtyHash` is a digest of `git status --porcelain=v2 -z` (or `null` when clean). If `sha` differs *or* `dirtyHash` differs from what's loaded, render a non-modal banner ("Worktree changed — reload") that the user clicks to refetch. Toggle in the review header turns polling off. *Done when:* you can leave the page open, an agent commits *or* edits, and within ~5 seconds you see the banner. Reload with no anchoring yet — comments still get displaced. The next slice fixes that.

**(b) Per-worktree toggle persistence.** localStorage key keyed by worktree identity (path for now, see open questions). The toggle remembers the last choice across sessions. Default-on for first encounter; respects the saved value after that. *Done when:* turning live reload off on one worktree doesn't affect another; reload sticks.

**(c) Content-anchored comments + detached sidebar.** Add `originSha`, `originType`, `anchorPath`, `anchorContext`, `anchorHash` to `Reply` at write time. New `RELOAD_CHANGESET` reducer action runs the anchoring pass (inline / re-anchor / detach) instead of `LOAD_CHANGESET` resetting the world. Sidebar gains a "Detached" group with per-file subgroups, only visible when non-empty. Each entry shows the body and the snippet; committed entries get a placeholder "view at `<sha7>`" affordance that's wired up in slice (e). *Done when:* you write a comment, the agent edits the file unrelatedly, you reload — your comment is still inline. You write another, the agent edits the line you commented on, you reload — your comment is detached with the original snippet visible.

**(d) Stop polling when the worktree is gone.** If the server reports the worktree path no longer exists or is no longer a git repo, surface that state once and stop polling. Don't loop on errors. *Done when:* `git worktree remove` while loaded shows a clean "this worktree is gone" state, not failure spam.

**(e) "View at `<sha>`" for outdated committed comments.** New endpoint `POST /api/worktrees/file-at` returning the file's content (or just a slice) at a given sha. Detached committed entries' "view at" link opens an inline panel that renders the historical file around the comment. Dirty entries don't get this affordance. *Done when:* clicking "view at" on an outdated committed comment shows the file as it was at that sha, scrolled to the anchor.

**(f) Server-pushed updates (optional, deferred).** Replace polling with SSE backed by `fs.watch`. Worth doing only if (a) is meaningfully insufficient. *Done when:* there's evidence polling is too slow or too chatty in real use.

Slices (a)–(d) are the feature. (e) is the next-most-useful follow-up. (f) is an "if we need it."

## Architecture sketch

```
┌─ Reviewer UI (web) ────────────────────────────────────────┐
│  ReviewHeader: live-reload toggle pill                     │
│  Banner ("worktree changed — reload") on stale state       │
│  Sidebar: "Detached" group when non-empty                  │
│  Polling hook owned by the loaded-worktree state           │
└──────────────────────────┬─────────────────────────────────┘
                           │  POST /api/worktrees/state    (cheap probe)
                           │  POST /api/worktrees/changeset  (existing,
                           │       extended to honor dirty=true)
                           │  POST /api/worktrees/file-at    (slice e)
                           ▼
┌─ Local server (server/) ───────────────────────────────────┐
│  New: POST /api/worktrees/state                            │
│       → { sha, dirty, dirtyHash: string|null }             │
│  changesetFor(path, { includeDirty }):                     │
│       clean → git show HEAD                                │
│       dirty → git diff HEAD                                │
│  New (slice e): file-at({ path, sha, file })               │
│       → { content }                                        │
│  Same path validation as the existing endpoints            │
└────────────────────────────────────────────────────────────┘
```

The `state` endpoint exists so the poll is two cheap git calls (`rev-parse HEAD` + `status --porcelain=v2 -z`) rather than re-running `git show`/`git diff` every interval. The expensive `changeset` call only fires when the user clicks reload.

## Deployment-mode matrix

Same as the parent worktrees feature — only modes that already support worktree ingest support live reload. In any mode where the worktree tab is hidden, this toggle never appears.

| Mode                              | Supported? |
|-----------------------------------|------------|
| Browser + local server (dev)      | Yes        |
| Tauri desktop (bundled sidecar)   | Yes        |
| Browser only, no server           | No         |
| Can't-clone-to-disk (memory-only) | No         |

## Open questions

- **Polling cadence.** 5s feels right for an agent-watching loop. With uncommitted edits in the picture, faster (3s) is more tempting. Lean: **3 seconds, hard-coded.** Revisit if request volume is noticeable.

- **Edit debounce.** Agent typing produces a different `dirtyHash` every keystroke. Since the user gates the actual reload via the banner, we don't need to debounce — the banner can update freely until the user clicks. Lean: **no debounce.** The user-click is the debounce.

- **Anchor hash window.** 5 lines (anchor ± 2) is the lean. Narrower (3) is twitchier but rarer to false-match. Wider (7+) shifts more comments to detached for unrelated nearby edits. Lean: **5.**

- **Anchor context window for display.** 10 lines (5 up, 4 down, plus anchor) is the lean — enough to make a snippet self-explanatory without bloating storage. Comments are typically authored against a single line or short range, so 10 lines almost always covers the surrounding scope. Lean: **10.**

- **Storage budget.** A few KB per comment in localStorage. Not a worry at prototype scale, but flag when persisted state hits the localStorage quota (~5MB) — most likely from a long thread on a long-lived worktree. Lean: **don't pre-optimize; surface a warning if persist write fails.**

- **Worktree identity for the toggle key.** Path is what we have. If the worktree gets renamed mid-session the toggle resets. Lean: **start with path; revisit when (c) lands and we need a real identity scheme for cursors anyway.**

- **What about banner UX when the user has the toggle off?** Off means off — no surprise banner. Lean: **stop polling entirely when toggled off.**

- **Cursor preservation on reload.** Best effort. If `cursor.fileId` exists in the new diff, keep the file and pick its first hunk. Otherwise file 0. Don't try to preserve hunk + lineIdx — too fragile, and the user has to scroll a bit anyway when content changes. Lean: **same file if available, else file 0.**

- **Failure surfacing during polling.** Network errors are common (sleep, server restart). Spamming a banner per failure is bad. Lean: **silent retry with a small ceiling (3 consecutive failures), then surface "worktree gone" once and stop. (Slice d.)**

- **Re-anchor performance.** The anchoring pass is O(replies × lines-in-changed-files) in the worst case. For prototype scale (≪100 comments × ≪10K lines) this is fine. If it ever becomes hot, build a single hash → location index per file once per reload and look replies up against it. Lean: **naive scan, optimize when measured.**

- **Merges / detached HEAD / interactive rebases.** A worktree being rewritten under us will produce wild dirty hashes and HEAD jumps. The model should handle it — comments either content-match into the new state or detach. Worth confirming once we test against a real agent loop. No action needed in MVP.

## What's deliberately out of scope (for now)

- Cross-tab coordination (multiple Shippable tabs on the same worktree). One tab polls, the others don't.
- Notifications outside the page (system notifications, sound). Quiet UI updates only.
- Manual re-attach for detached comments ("drag this comment back onto a line"). Detached is a one-way state in this slice.
- Reviewing arbitrary commit ranges that include uncommitted state. Live reload only refreshes the *current* loaded view.
- Moving threads between files. If a file gets renamed, anchored comments will detach; that's acceptable for the prototype.

## Files of interest

- `web/src/App.tsx` — owns the loaded `ChangeSet` + worktree provenance; the polling hook lives at this level so it can swap the changeset.
- `web/src/components/LoadModal.tsx` — already loads worktrees; provenance (path + sha + dirtyHash) needs to flow into the loaded state so the reviewer knows what to poll.
- `web/src/components/Sidebar.tsx` — new "Detached" section.
- `web/src/components/LiveReloadBar.tsx` — new banner component.
- `web/src/useWorktreeLiveReload.ts` — new polling hook.
- `web/src/persist.ts` — extend to remember the live-reload toggle per worktree identity, and to round-trip detached replies.
- `web/src/types.ts` — `WorktreeState`, `WorktreeProvenance`, anchor fields on `Reply`, `DetachedReply`.
- `web/src/state.ts` — new `RELOAD_CHANGESET` action with the anchoring pass; `state.detachedReplies`.
- `web/src/anchor.ts` — new helper: hash a 5-line window, find a matching window in a file, capture the 10-line context at write time.
- `server/src/worktrees.ts` — new `stateFor(path)` (rev-parse + status hash); extend `changesetFor` to handle the dirty case; new `fileAt(path, sha, file)` (slice e).
- `server/src/index.ts` — new `POST /api/worktrees/state`; new `POST /api/worktrees/file-at` (slice e).
- `docs/plans/worktrees.md` — cross-link this plan; the "Real-time file watching" and "Reviewing uncommitted working-tree changes" out-of-scope bullets should point here.
