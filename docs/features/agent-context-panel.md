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
6. **Delivered (N)** (collapsed). Newest-first list of comments the agent has fetched, with timestamps. Drives the macro view of the queue substrate.

Each section's collapsed/expanded state persists in localStorage per worktree, same shape as the existing review state.

> **Free-form composer is gone.** The earlier "Send to agent" composer was removed by the agent-reply work — see `docs/sdd/agent-reply-support/spec.md`. Reviewer → agent freeform messaging now flows out-of-band into the user-agent chat. Comment-anchored replies (line / block / reply-to-AI etc.) and the new agent → reviewer back-channel cover the structured flow.

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

## Agent → reviewer back-channel

After the agent fetches comments via `shippable_check_review_comments`, it posts back via the unified `shippable_post_review_comment` tool. Two modes through one schema:

- **Reply mode** — `{ parentId, replyText, outcome }` where `outcome ∈ { addressed, declined, noted }`. Threads under the matching reviewer comment with an outcome icon and a generic "agent" label.
- **Top-level mode** — `{ file, lines, replyText }`. Posts a fresh, agent-authored comment anchored to the diff. Renders as a new root in the panel under an **Agent comments (N)** block — anchor (`file:lines`), agent label, body, and a standard reply composer. The reviewer can respond inline; the response enqueues with kind `reply-to-agent-comment` and the pull envelope inlines the parent's body as a `<parent>` child so the agent has context.

The reviewer UI polls `GET /api/agent/comments` while the panel is mounted AND the tab is visible; new entries (both shapes) surface within a poll cycle. Multiple replies to the same parent append; multiple top-level comments on the same anchor also append.

File-level top-level comments (`lines` omitted) are not supported in v0 — the reviewer UI has no file-level comment slot yet. The MCP tool input rejects them with a clear error. Follow-up: bundle file-level commenting for users and agents in one future change. See `docs/sdd/agent-comments/spec.md` for the full design.

Pushback / clarification on a `declined` reply does **not** flow back through Shippable — that conversation belongs in the user-agent chat. Shippable's role is to surface what the agent did, not to host a multi-turn debate.

See `docs/sdd/agent-reply-support/spec.md` for the original reply-only design and `docs/sdd/agent-comments/spec.md` for the top-level extension.

## MCP install affordance

The panel renders a prominent install section at the top when no `shippable` MCP entry is detected in the user's Claude Code config (and the user hasn't dismissed it). Three click-to-copy chips:

- **Install:** `claude mcp add shippable -- npx -y @shippable/mcp-server` (Claude Code; per-harness adaptation lands as more harnesses surface real demand). See `mcp-server/README.md` for the full per-harness install matrix (Codex CLI, Cursor / Cline / Claude Desktop / OpenCode).
- **Pull comments:** `check shippable` — the magic phrase that triggers the agent to call `shippable_check_review_comments`.
- **Report back:** `report back to shippable` — the fallback phrase that nudges the agent to post per-comment replies or fresh top-level comments via `shippable_post_review_comment`.

Both tool descriptions are tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback", "let shippable know what you did"), but the literal phrases are the reliable fallback.

Detection is server-side — `GET /api/worktrees/mcp-status` reads `~/.claude/settings.json` and `~/.claude/settings.local.json`, looks for an entry named `shippable` under `mcpServers` (canonical) or a permissive variant. When present, the affordance collapses to a one-line `✓ MCP installed`. For other harnesses (no programmatic detection) the affordance offers an **"I installed it"** dismiss button persisted per-machine in `localStorage` under `shippable.mcpInstallDismissed`.

**Caveat for upgraders:** users who installed the previous file-based hook (`shippable-inbox-hook` referenced from `~/.claude/settings.local.json`) keep working without action — the hook still fires, finds no `<worktree>/.shippable/inbox.md`, and no-ops. Removing the stale entry is a manual cleanup; it doesn't break anything if left.

## Empty / error states

- **No agent context for this commit.** Empty section with one line: `no Claude Code session matched this commit`. Section collapses to a thin bar; doesn't take up vertical space.
- **Server can't reach `~/.claude/projects/`.** Error toast + the panel hides itself. The reviewer flow continues to work without it.
- **Deployment mode without disk access** (browser-only / can't-clone-to-disk). Panel doesn't render at all — same gating as the worktrees feature in `docs/plans/worktrees.md` § Deployment-mode matrix.

## Files of interest

- `web/src/components/Inspector.tsx` — adds `<AgentContextSection>` between the sticky header and the AI concerns section.
- `web/src/components/AgentContextSection.tsx` — the section UI itself.
- `web/src/components/ReviewWorkspace.tsx` — holds the agent-context state as plain `useState` at the App level rather than in `ReviewState`. See [`docs/concepts/agent-context.md`](../concepts/agent-context.md) § "State lives outside `ReviewState`" for the rationale (transient, async-fetched, per-changeset — we deliberately don't persist it).
- `web/src/types.ts` — `AgentContextSlice`, `AgentSessionRef`, `AgentMessage`, `ToolCallSummary`.
- `web/src/state.ts` — `agentComments` slot, `agentComment:<id>` reply-key prefix, and v2→v3 persist migration.
- `web/src/agentContextClient.ts` — the fetch helpers; `useDeliveredPolling.ts` drives pip refresh.
- `server/src/agent-context.ts` — JSONL parser, `cwd` matcher, commit-boundary slicer.
- `server/src/index.ts` — endpoints `POST /api/worktrees/agent-context` (read), `POST /api/worktrees/sessions` (list candidates for manual pick), `GET /api/worktrees/mcp-status` (install detection), `POST /api/agent/enqueue|pull|unenqueue`, `GET /api/agent/delivered` (the queue substrate, see `docs/plans/share-review-comments.md`), `POST /api/agent/comments` and `GET /api/agent/comments` (the agent → reviewer back-channel — both reply-shaped and top-level agent comments share one store; see `docs/sdd/agent-reply-support/spec.md` and `docs/sdd/agent-comments/spec.md`).
- `mcp-server/` — the standalone TypeScript MCP server exposing `shippable_check_review_comments` (pull pending comments) and `shippable_post_review_comment` (post per-comment replies or fresh top-level comments). Installs into Claude Code via `claude mcp add shippable -- npx -y @shippable/mcp-server`.

## Out of scope for this feature

- Mid-turn interrupt (slice e/β). A "live mode" toggle remains a future addition; this feature ships the next-turn write path only.
- Multi-agent coordination. One worktree, one matched session at a time.
- Editing or deleting transcript content. The transcript is read-only; the inbox is write-only.
- Transcript search / cross-session queries. Out of scope; revisit if there's pull.
