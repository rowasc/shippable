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

1. Submit POSTs to `/api/agent/enqueue` with a `freeform` comment kind. The comment lands on the local server's per-worktree queue alongside any line/block/reply comments authored on the diff. See `docs/plans/share-review-comments.md` for the queue substrate.
2. The composer status indicator returns to idle on success — there is no separate "queued" sub-state on the composer itself. The freeform comment surfaces in the panel's `Delivered (N)` block once the agent fetches via the MCP pull tool.
3. **Latency model:** the comment is **delivered when the agent calls the MCP tool, typically when prompted with `check shippable`**. We say this in the placeholder copy. We do *not* claim mid-turn delivery — pull means the agent fetches when prompted, not on a timer.

## MCP install affordance

The panel renders a prominent install section at the top when no `shippable` MCP entry is detected in the user's Claude Code config (and the user hasn't dismissed it). Two click-to-copy chips:

- **Install:** `claude mcp add shippable -- npx -y @shippable/mcp-server` (Claude Code; per-harness adaptation lands as more harnesses surface real demand). See `mcp-server/README.md` for the full per-harness install matrix (Codex CLI, Cursor / Cline / Claude Desktop / OpenCode).
- **Then say:** `check shippable` — the magic phrase that triggers the agent to call the tool. The MCP tool description is tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback") but the literal phrase is the reliable fallback.

Detection is server-side — `GET /api/worktrees/mcp-status` reads `~/.claude/settings.json` and `~/.claude/settings.local.json`, looks for an entry named `shippable` under `mcpServers` (canonical) or a permissive variant. When present, the affordance collapses to a one-line `✓ MCP installed`. For other harnesses (no programmatic detection) the affordance offers an **"I installed it"** dismiss button persisted per-machine in `localStorage` under `shippable.mcpInstallDismissed`.

**Caveat for upgraders:** users who installed the previous file-based hook (`shippable-inbox-hook` referenced from `~/.claude/settings.local.json`) keep working without action — the hook still fires, finds no `<worktree>/.shippable/inbox.md`, and no-ops. Removing the stale entry is a manual cleanup; it doesn't break anything if left.

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
- `server/src/index.ts` — endpoints `POST /api/worktrees/agent-context` (read), `POST /api/worktrees/sessions` (list candidates for manual pick), `GET /api/worktrees/mcp-status` (install detection), `POST /api/agent/enqueue|pull|delivered|unenqueue` (the queue substrate, see `docs/plans/share-review-comments.md`).
- `mcp-server/` — the standalone TypeScript MCP server exposing `shippable_check_review_comments` over stdio. Installs into Claude Code via `claude mcp add shippable -- npx -y @shippable/mcp-server`.

## Out of scope for this feature

- Mid-turn interrupt (slice e/β). A "live mode" toggle remains a future addition; this feature ships the next-turn write path only.
- Multi-agent coordination. One worktree, one matched session at a time.
- Editing or deleting transcript content. The transcript is read-only; the inbox is write-only.
- Transcript search / cross-session queries. Out of scope; revisit if there's pull.
