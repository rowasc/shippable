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

Two complementary surfaces inside the section. Both push to the same per-worktree, in-memory queue on the local server (see `docs/plans/push-review-comments.md` for the full design).

1. **Per-thread Send batch.** Every reviewer-authored reply (line note, block comment, reply-to-AI-note, reply-to-teammate, reply-to-hunk-summary) carries a `sentToAgentAt` flag. While at least one reply on the active changeset is unsent, the section shows a `Send N comments` button (singular when N is 1) plus a one-line "Queue is in-memory — server restart drops unpulled comments" hint. Clicking the button opens a preview sheet:
   - One row per unsent reply, grouped by file path (freeform last). Each row has a default-on checkbox and a one-line clip of the reply body.
   - A "what the agent will see" toggle reveals the rendered `<reviewer-feedback>` payload as a `<pre>` block — the same string the hook will print to stdout.
   - Confirm enqueues only the checked rows. The button's status line then reads `queued — delivers on the agent's next tool call or session start.`
   - Each thread shows a pip (`◌ queued` or `✓ delivered`) once a reply on it has been sent. The `delivered` flip happens when the App-level polling loop sees the comment id reported in `/api/agent/delivered`. Pip state survives a page reload (it lives on the Reply itself in `ReviewState`).
2. **Freeform composer.** A textarea + Send button at the bottom of the section, for messages that aren't tied to a thread. Submit enqueues a single `kind: "freeform"` comment with the textarea text as the body. The status line cycles `idle → sending → queued → delivered` (or `error`) just like the per-thread Send batch — the composer's id rides on the same App-level polling loop, so there's a single delivery signal across both surfaces. After 5 minutes without a delivery, the status flips to a "delivery timed out" error; the comment stays in the queue, and a fresh session in the worktree will still pick it up.
3. **Delivered (N) history block.** A collapsed `<details>` block above the Send button surfaces the server's delivered list (newest first, capped at 200). Each row shows `<file>:<lines> · <kind> · <relative timestamp>` and a clipped body — the answer to "did the agent see this?".

We do **not** claim mid-turn delivery. A comment lands on the next event the hook fires on (any tool call, any new session start, the next user prompt). For an idle session that does nothing, the queue waits — opening a fresh session in that worktree drains it via the `SessionStart` hook.

### Required hook recipe

The hook ships at `tools/shippable-agent-hook`. The "Install for me" button merges three matcher entries into `~/.claude/settings.local.json` (atomic write, one-shot backup at `<file>.shippable.bak`). Manual paste:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "<path-to>/shippable-agent-hook" }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "<path-to>/shippable-agent-hook" }]
    }],
    "SessionStart": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "<path-to>/shippable-agent-hook" }]
    }]
  }
}
```

The script reads the event JSON from stdin, extracts `cwd`, POSTs `{ worktreePath: cwd }` to `http://127.0.0.1:<server-port>/api/agent/pull`, and prints the response body's `payload` field to stdout (which Claude Code grafts on as `additionalContext`). The server-side install command captures the resolved port and writes a `SHIPPABLE_PORT=<port> /abs/.../shippable-agent-hook` form when the server isn't on the default port; the snippet above shows the bare form for the default-port case. On any non-zero exit (curl error, timeout, server down) the hook is a silent no-op — it must never block the agent.

Until the hook is installed (or while it's only partially installed) the panel surfaces a `set up` hint listing the missing events. The composer and Send batch still work regardless; comments accumulate on the queue until the hook drains them.

### Migration note

Users who installed the legacy `shippable-inbox-hook` before slice (e) will have a stale entry in their `~/.claude/settings.local.json` pointing at a script that no longer ships. Claude Code surfaces a missing-file error and moves on (the hook is non-blocking). Re-running "Install for me" rewrites the legacy entry in place.

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
- `server/src/agent-context.ts` — JSONL parser, `cwd` matcher, commit-boundary slicer.
- `server/src/agent-queue.ts` — in-memory per-worktree queue and delivered history.
- `server/src/index.ts` — endpoints `POST /api/worktrees/agent-context` (read), `POST /api/worktrees/sessions` (list candidates for manual pick), `POST /api/agent/enqueue`, `POST /api/agent/pull`, `GET /api/agent/delivered`.
- `tools/shippable-agent-hook` — the `UserPromptSubmit` / `PostToolUse` / `SessionStart` hook script.

## Out of scope for this feature

- Mid-turn interrupt (slice e/β). A "live mode" toggle remains a future addition; this feature ships the next-turn write path only.
- Multi-agent coordination. One worktree, one matched session at a time.
- Editing or deleting transcript content. The transcript is read-only; the inbox is write-only.
- Transcript search / cross-session queries. Out of scope; revisit if there's pull.
