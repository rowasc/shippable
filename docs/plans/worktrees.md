# Worktrees in the reviewer

The reviewer today is fed by URL, file upload, or paste. None of those match the actual shape of how you work when an agent is running on your machine: you have a directory full of worktrees, agents are committing into them, and what you want to do is *review what just landed*. This plan adds a fourth ingest path — point Shippable at a directory, list the git worktrees in it, pick one, and load its latest committed changeset as a `ChangeSet`. That's the MVP. The longer arc is "review-while-they-work": as your agents work, the reviewer follows them, surfaces what's new since you last looked, and gives you a path to feed your review back into the agent's session — live if we can swing it, async if we can't.

This pairs with `auto-mode-sandbox.md`. The sandbox is where agents *do* the work (`.claude/worktrees/<name>` is its convention). This is where you *review* the work. They meet at the worktree boundary.

Directory selection is now split into a focused follow-up plan: see [worktree-directory-picker.md](./worktree-directory-picker.md). The short version: the current path textbox needs to become a chooser-first flow in both Tauri and browser-dev, with the browser chooser opened through the local server so the existing git-backed path API stays intact.

## Goal

What this enables:

- Open a local directory and see its worktrees as first-class entries in the reviewer.
- Load the latest committed change of any worktree as a `ChangeSet` without leaving the UI.
- Steady-state loop: agent commits → reviewer notices → you review → feedback flows back to the agent.

What it explicitly does *not* try to do, at least not yet:

- Multi-repo workspaces, GitHub PR ingest, real-time file watching.
- Anything outside `disk-allowed` deployment modes (see the matrix below).
- Replacing the existing URL / upload / paste flows. This is a fourth source, not a replacement.

## The slices

Staged. Each one stands on its own and unblocks the next.

**(a) MVP — list worktrees, load HEAD.** You give the reviewer a directory path; the server runs `git worktree list --porcelain` (or scans for nested `.git` files) and returns `{ path, branch, head }` per worktree. Pick one, the server diffs `HEAD~1..HEAD` for that worktree, returns a `ChangeSet`, and the existing review UI takes it from there. *Done when:* you can open a directory, click a worktree, and end up in the diff view. *Blocking next:* the worktree concept needs a stable identity (path? branch?) so we can remember things about it.

**(b) Per-worktree commit picker.** HEAD is fine for "what just landed" but not for "let me review the last three commits." Add a small commit list per worktree with a range selector — `HEAD~N..HEAD`, or `<sha>..HEAD`. *Done when:* you can scroll back through a worktree's recent history and load any range. *Blocking next:* once you can pick ranges, you need to remember where you stopped.

**(c) "What's new since I last reviewed."** Track a per-worktree review cursor (a sha) in localStorage, same shape as the existing `ReviewState`. When you reopen a worktree, the default range is `<last-reviewed-sha>..HEAD` and there's a "you reviewed up to here" marker. *Done when:* coming back to a worktree feels like coming back to an inbox, not a stale view. *Blocking next:* now that you have a cursor, "send feedback to the agent that did this work" becomes a meaningful gesture.

**(d) Agent-feedback loop (async).** Once you've reviewed a worktree's last commit, surface a "send feedback to the agent" affordance. v1 is async: write the feedback into a file the agent will pick up next time it's invoked (or into its `CLAUDE.md` / a queue). This is the easy half of the vision — no live-session plumbing, just a handoff file. *Done when:* you can review, hit "send feedback," and the next `claude-auto` run on that worktree sees it.

**(e) Live-session steering.** a big deal in terms of usability and speed when you are still needing to check the code closely. Plausible mechanisms: writing into the agent's session inbox, an MCP tool the agent polls, or a sidecar that injects a user message into the running CLI. All of these need testing before we commit. *Done when:* there's an experiment that demonstrates one of these reliably steering an in-flight session. May not happen in 0.1.0 but we are trying to make it fit as much of this feature into the core of 0.1.0 due to its importance.

**(f) AI Inspector inline comments.** Connection point with the broader "AI Inspector" roadmap item. Once a worktree's latest changeset is loaded, the same prompt-library / select-to-review machinery that already exists in the product applies — but anchored to a real-on-disk worktree, with paths the agent can actually act on. *Done when:* the inspector's comments and the worktree's commits are addressing the same files, and "fix this" can hand the fix back to an agent in that worktree.

## Architecture sketch

```
┌─ Reviewer UI (web) ────────────────────────────────────────┐
│   LoadModal: new "From a directory" tab                    │
│   Worktree list, commit picker, review cursor              │
│   Existing DiffView / Inspector / prompt library on top    │
└──────────────────────────┬─────────────────────────────────┘
                           │  /api/worktrees?dir=...
                           │  /api/worktrees/diff?path=...&range=...
                           ▼
┌─ Local server (server/) ───────────────────────────────────┐
│   git worktree list --porcelain                            │
│   git log / git diff for the chosen range                  │
│   Path validation (no traversal, no symlinks out of dir)   │
│   Returns ChangeSet (existing shape)                       │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
                ┌─ on-disk directory ──────────┐
                │  worktrees/                  │
                │   ├ feature-a/ (.git → ...)  │
                │   ├ bugfix-b/ (.git → ...)   │
                │   └ .claude/worktrees/...    │  ← auto-mode-sandbox lives here
                └──────────────────────────────┘
```

Tauri shell could later replace `/api/worktrees*` with native FS / `git` calls inside the Rust shell, removing the Node server from the loop entirely. The UI doesn't need to care which one answered — same shape as the symbol-resolver story in `plan-symbols.md`.

## Deployment-mode matrix

Honest version: most modes don't support this.

| Mode                              | Supported?            | Why                                                                 |
|-----------------------------------|-----------------------|---------------------------------------------------------------------|
| Browser + local server (dev)      | Yes                   | Server runs `git`, reads disk. The primary target.                  |
| Tauri desktop (bundled sidecar)   | Yes                   | Sidecar = same server, same path. Could later go fully native.      |
| Browser only, no server           | No                    | No way to reach disk. The "From a directory" tab should be hidden.  |
| Can't-clone-to-disk (memory-only) | No                    | Worktrees *are* disk by definition. The tab should be hidden.       |

Concretely: the modal tab is gated by a capability flag the server (or its absence) advertises. In a no-server / memory-only build, the tab doesn't render at all. We don't show a disabled tab with a sad explanation — we just don't pretend the feature exists.

## Open questions

The shape of these will probably move as we build (a) and (b).

- **Worktree identity.** Path is what `git worktree list` gives us, but paths move. Branch name is more durable but multiple worktrees can target the same branch over time. Probably `(repo-root, branch)` for the cursor key, with path as display? Open. The localStorage shape needs to survive worktree renames without dropping review state on the floor.

- **What does "latest changeset" mean?** Options: (1) `HEAD~1..HEAD` — last commit. (2) Last *pushed* commit, ignoring local in-progress work. (3) Everything since I last reviewed. (4) Working-tree-uncommitted-changes. MVP is going with (1). (3) is slice (c). (4) is interesting — when an agent is mid-task, the diff that matters might not be committed yet. Worth testing.

- **Live-session steering.** Quoted above. Genuinely don't know if this is a thin shim or a research project. The "live vs non-live mode" toggle the user mentioned is probably the right shape regardless — let people opt in.

- **Composition with the rest of the product.** The prompt library, AI Inspector, per-hunk skills, code runner — all of these already operate on a `ChangeSet`. The intended answer is "loading a worktree just produces a `ChangeSet`, everything else falls out." If that turns out to be a lie, the lie will probably be around file paths (the runner needs to mount real paths; the inspector wants to write fixes back). Watch this seam.

- **Path validation.** The user types a directory path; we hand it to `git`. Surface area: traversal, symlinks pointing outside the chosen dir, very long paths, paths with shell metacharacters. Not a deep dive here, but the server endpoint must (a) refuse paths outside an allowlist or a user-confirmed root, (b) use `execFile` not `exec`, (c) reject symlinks. Worth wiring this carefully even for the MVP — `git` is happy to follow a symlink into `/`.

- **Relationship to the auto-mode sandbox.** The sandbox manages worktrees at `.claude/worktrees/<name>`. Two design choices:
  - *Convention.* Reviewer defaults the directory picker to `.claude/worktrees/` if it exists in the chosen project root. Cheap and obvious.
  - *Coordination.* The sandbox writes a small registry file the reviewer reads (`.claude/worktrees/index.json` or similar) so it gets richer metadata: what agent created the worktree, what task, what the budget cap was, last commit timestamp. Worth doing eventually because it's exactly the "agent context" the reviewer wants for slice (d).
  Lean: ship the convention now, design the registry when we get to slice (d).

- **What about commits from the user, not from agents?** The whole framing has been agent-centric. But a worktree is a worktree — the same UI works for "I committed to my feature branch and want to look at what I just did." Probably fine; flag it if the agent-centric copy in the UI ever feels weird for human-only worktrees.

## What's deliberately out of scope (for now)

- GitHub PRs. That's a separate ingest path, on the roadmap, not this plan.
- Multi-repo workspaces. One directory, the worktrees inside it, period.
- Real-time file watching / inotify / FSEvents. The reviewer pulls when you ask it to. Auto-refresh is a nice-to-have, not table stakes.
- Reviewing uncommitted working-tree changes. Maybe slice (b.5) eventually; not MVP.
- Posting reviews to GitHub. 0.2.0 territory.

## Files of interest

- `web/src/components/LoadModal.tsx` — adds a "From a directory" tab next to URL / upload / paste.
- `web/src/types.ts` — possibly extends `ChangeSet` or adds a sibling `WorktreeSource` for provenance.
- `web/src/persist.ts` — per-worktree review cursor in localStorage.
- `server/src/index.ts` — new endpoints `GET /api/worktrees`, `GET /api/worktrees/diff`. Origin allowlist + path validation belong here.
- `server/src/` (new) — a `git` wrapper module. `execFile`-based, narrowly scoped commands.
- `src-tauri/` — eventually a native equivalent so desktop doesn't need the Node sidecar for this.
- `docs/plans/auto-mode-sandbox.md` — touch up to mention the reviewer integration once slice (d) is real.
- `docs/ROADMAP.md` — already lists "Review-while-they-work workflows" under 0.1.0; cross-link this plan once it stabilises.
