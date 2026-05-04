# Agent context panel

A right-column subsection in the review UI that shows the Claude Code session that produced the commit you're reviewing, and lets you talk back to the agent. Concept lives in `docs/concepts/agent-context.md`; this doc is the feature surface — what the user sees, where it sits, and how it behaves.

## Where it lives

Inside the existing Inspector column (`web/src/components/Inspector.tsx`), as a new `<section className="inspector__sec">` slotted **above the AI concerns section** — first substantive block under the sticky header. Reviewers form their first impression of the diff there, and that's where "this is what the agent was trying to do" lands hardest.

We do **not** add a new tab, new column, or a modal. The Inspector's vertical-stack-of-collapsibles pattern is already the right shape for this content; forking the layout would cost more than the section itself.

## Sections, in order

1. **Task** (always expanded). One-paragraph render of the original user prompt that started the session, plus any user follow-ups inside this commit's slice. If there are multiple follow-ups, the latest is shown with a "+ N earlier" toggle.
2. **Files touched** (always expanded). A compact list of paths the agent touched in this slice, each link-jumping to the corresponding file in the diff. Files in this slice that *aren't* in the diff are shown with a muted style — useful signal, since "agent touched a file but didn't end up changing it" is itself information.
3. **Plan / todos** (collapsed). The agent's todo state at the end of the slice. Done items struck through, in-progress highlighted, pending plain.
4. **Transcript tail** (collapsed). Last 3 assistant messages by default; expand to see the full slice. Tool calls render as one-line summaries (`Read web/src/state.ts`, `Edit server/src/worktrees.ts (3 changes)`); click to expand the call's full arguments.
5. **Cost & duration** (collapsed). One-line: `4 turns · 12.4k input · 1.8k output · 38s · sonnet-4-6`. Pulled from transcript metadata.
6. **Send to agent** (always at the bottom of the section). Composer + button. See "Send-to-agent affordance" below.

Each section's collapsed/expanded state persists in localStorage per worktree, same shape as the existing review state.

## Symbol links in chat

Backtick-quoted identifiers in the transcript that match the loaded ChangeSet's symbol graph become click-throughs into the diff (jump to definition / first occurrence). Implementation hooks into the same machinery as `docs/concepts/symbol-graph-and-entry-points.md`. False-positive guard: only link if the symbol exists in a file the current diff touches. A symbol mentioned in chat but absent from the diff stays unstyled — no broken-looking dead link.

## Refresh: per-commit, not per-keystroke

The panel polls `/api/worktrees/changeset` at a low cadence (default ~3s, only while the panel is mounted and the tab is active) for the worktree's current HEAD. When HEAD changes, both the changeset and the agent-context slice are re-fetched. This keeps the diff and the narrative in lockstep — you never see "this is the agent context for the commit you were just looking at."

We deliberately do not stream individual transcript turns into the panel. See `docs/concepts/agent-context.md` § Refresh model for the rationale.

A "live" badge appears in the panel header when the matched session has produced a transcript event in the last 60s. It's an indicator, not a real-time pipe.

## Session matching & manual override

By default, the panel auto-matches the worktree to a Claude Code session by comparing the worktree path against `cwd` fields in `~/.claude/projects/<hash>/*.jsonl`. The match outcome shows up in a small subhead under the section title:

- **Matched:** `from session "fix symbol resolution" · started 12m ago`
- **Multiple matches:** `2 sessions ran here — pick one ▾` (dropdown)
- **No match:** `no Claude Code session detected · attach manually ▾`

The dropdown is the recovery path. Users who want to view the panel against a different session, or who ran their session in a sibling directory, can pick from a list of recent sessions. The choice persists per `(repo-root, branch)`.

## Send-to-agent affordance

A composer at the bottom of the section. One textarea, one "Send to agent" button. Optionally, a "+ attach: this hunk / this file / this comment" picker that prepends a quoted snippet to the message. Behavior:

1. Submit writes to `<worktree>/.shippable/inbox.md` via `/api/worktrees/inbox`. Last writer wins for v1. On first write the server also appends `.shippable/` to `$(git rev-parse --git-common-dir)/info/exclude` (the *shared* exclude across all worktrees of the repo) so the file is git-ignored *without* touching the tracked `.gitignore` (see `docs/concepts/agent-context.md` § Why shared `info/exclude`).
2. The UI shows a dismissable "queued — will deliver on the agent's next prompt" line. We do **not** claim mid-turn delivery.
3. When the next assistant turn arrives in the transcript and the inbox file has been consumed (file deleted by the hook), the queued message becomes a "delivered" entry in the transcript tail and is removed from the inbox.

### Required hook recipe

For the inbox to be picked up, users add this to their Claude Code `settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "command": "<path-to>/shippable-inbox-hook"
    }]
  }
}
```

The hook script reads `<cwd>/.shippable/inbox.md`, prepends its contents to the user prompt as `<reviewer-feedback>...</reviewer-feedback>`, and deletes the file. We ship the hook script with Shippable and surface a one-click "copy hook recipe" in the panel's onboarding state.

Until the hook is installed, the composer still works but flags `hook not detected — feedback will sit in inbox until next session reads it`. We detect the hook by looking for the recipe in the user's Claude Code settings (best-effort; can be wrong).

## Empty / error states

- **No agent context for this commit.** Empty section with one line: `no Claude Code session matched this commit`. Section collapses to a thin bar; doesn't take up vertical space.
- **Server can't reach `~/.claude/projects/`.** Error toast + the panel hides itself. The reviewer flow continues to work without it.
- **Deployment mode without disk access** (browser-only / can't-clone-to-disk). Panel doesn't render at all — same gating as the worktrees feature in `docs/plans/worktrees.md` § Deployment-mode matrix.

## Files of interest

- `web/src/components/Inspector.tsx` — adds `<AgentContextSection>` between the sticky header and the AI concerns section.
- `web/src/components/AgentContextSection.tsx` (new) — the section UI itself.
- `web/src/types.ts` — adds `AgentContextSlice`, `AgentSessionRef`, `AgentMessage`, `ToolCallSummary`.
- `web/src/state.ts` — adds `agentContext?: AgentContextSlice` to `ReviewState` + actions `SET_AGENT_CONTEXT`, `SET_AGENT_SESSION`.
- `web/src/view.ts` — extends `InspectorViewModel` with the rendered slice.
- `server/src/agent-context.ts` (new) — JSONL parser, `cwd` matcher, commit-boundary slicer.
- `server/src/index.ts` — endpoints `POST /api/worktrees/agent-context` (read), `POST /api/worktrees/inbox` (write), `POST /api/worktrees/sessions` (list candidates for manual pick).
- `tools/shippable-inbox-hook` (new) — the `UserPromptSubmit` hook script.

## Out of scope for this feature

- Mid-turn interrupt (slice e/β). A "live mode" toggle remains a future addition; this feature ships the next-turn write path only.
- Multi-agent coordination. One worktree, one matched session at a time.
- Editing or deleting transcript content. The transcript is read-only; the inbox is write-only.
- Transcript search / cross-session queries. Out of scope; revisit if there's pull.
