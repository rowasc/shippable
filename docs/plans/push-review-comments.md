# Pushing review comments to a Claude Code session

The reviewer already lets you write structured comments on a diff — line comments, block comments, replies to AI notes, replies to teammate notes, replies to hunk summaries. Those comments live in `ReviewState` and never leave the browser. The agent that produced the diff has no idea the reviewer said anything.

This plan closes that loop. When the reviewer is done writing comments, one click pushes the batch into the matched Claude Code session — without the user having to type a prompt — and the agent picks them up on its next activity.

This is the structured-comment counterpart to the free-form composer that already ships in the agent-context panel. The composer was always meant for "write the agent a sentence." This is for "send the agent the N comments I just wrote on the diff." The format and the channel are different; the panel and the onboarding are shared. As part of this work the free-form composer migrates onto the same channel so we can delete the file-based inbox (`<worktree>/.shippable/inbox.md` and the `info/exclude` machinery that backs it) — see § Folding in the free-form composer.

This sits in the slice (d) lane of `docs/plans/worktrees.md` and supersedes the file-based half of that plan with a server-queue + hook channel.

## Goal

What v1 enables:

- A "Send N comments" affordance in the agent-context panel that batches every unsent structured comment and ships it.
- Delivery on the agent's next *tool boundary* or *session start*, not the next *user prompt*. While the agent is working, comments land within seconds.
- Free-form composer messages travel the same path. The on-disk `inbox.md` and the `info/exclude` workaround go away.

What v1 explicitly does not try to do:

- Per-comment "Send" buttons (deferred — see § Follow-ups).
- Re-send after edit, or detecting an agent reply and threading it back into the comment (deferred).
- Push to an idle Claude Code session (no hook fires when nothing's happening — see § Latency model).
- Other harnesses (Codex CLI, Cursor IDE, OpenCode, etc.). Architecture supports them; v1 ships Claude Code only — see § Future channels.

## Slices

Staged. Each one stands on its own and unblocks the next.

**(a) Server queue + pull endpoint.** Per-worktree comment queue with a delivered cursor. `POST /api/agent/pull?worktree=<path>` atomically returns and acks pending comments for that worktree. Empty payload when nothing's queued. *Done when:* the endpoint round-trips and survives concurrent pulls without double-delivering.

**(b) Claude Code hook script v2.** A single bundled script handles `UserPromptSubmit`, `PostToolUse`, and `SessionStart`. All three pull from `/api/agent/pull` and emit any payload as `additionalContext` for the next model call. Replaces `tools/shippable-inbox-hook` from the existing implementation. The script is intentionally thin (read JSON from stdin → extract cwd → POST → print stdout) so the same shape ports to other harnesses' hooks later. *Done when:* installing the hook covers both the existing free-form composer and the new comment batch flow with one settings entry.

**(c) UI: send button + preview sheet + sent pips.** Send button in the agent-context panel surfaces an unsent count. Click opens a sheet listing every unsent comment with a default-on checkbox and a one-line "what the agent will see." Confirm enqueues. Each sent comment shows a small pip on its thread. Pips flip when the hook actually pulled the queue, not on enqueue. *Done when:* you can write 5 comments across 3 files, send them, and watch them arrive in the agent's next tool boundary.

**(d) Delivered history.** Small "Delivered (N)" collapsed block inside the agent-context section listing what the agent already received, with timestamps. Read-only. *Done when:* you can confirm "did the agent see this?" from the panel.

**(e) Free-form composer migration.** Composer messages become a `freeform` comment kind, enqueued via the same `/api/agent/enqueue` path and pulled by the same hook. The `inbox.md` writer, the inbox-status poller, and the `info/exclude` machinery delete. *Done when:* the composer no longer touches the worktree filesystem and `tools/shippable-inbox-hook` is gone.

## Architecture

```
┌─ Reviewer UI (web) ───────────────────────────────────────┐
│   AgentContextSection                                     │
│     ├ free-form composer (now: enqueues a freeform)       │
│     └ "Send N comments" → preview sheet → enqueue         │
│   ReviewState.replies + sentToAgentAt per comment         │
└───────────────────────────────┬───────────────────────────┘
                                │  POST /api/agent/enqueue
                                ▼
┌─ Local server (server/) ──────────────────────────────────┐
│   In-memory queue keyed by worktreePath (agent-agnostic)  │
│   Delivered cursor advances on each pull                  │
│   Endpoints (the main contract):                  │
│     POST /api/agent/enqueue   ← reviewer                  │
│     POST /api/agent/pull      ← agent shim                │
│     GET  /api/agent/delivered ← reviewer (history)        │
└──────────────────────────────────┬────────────────────────┘
                                   │
                                   ▼
                ┌─ Agent shim (v1: Claude Code hook) ─┐
                │ stdin → extract cwd → pull → stdout │
                │ thin enough to clone per-harness    │
                └─────────────────────────────────────┘
```

The HTTP endpoint is the main contract. The Claude Code hook is a thin shim over it. The same shape ports to other channels: a Codex hook, a Cursor IDE hook, an MCP `pull_review_comments` tool, a Channels plugin — each is ~50 lines of glue over the same `/api/agent/pull` call. The queue and format are agent-agnostic by construction; the only Claude-Code-specific code in v1 lives in the hook script and the install logic.

## Channel: hooks for Claude Code (v1)

Three Claude Code hook events, all routed through one bundled script:

- **`PostToolUse`** — fires after every successful tool call. Stdout becomes `additionalContext` for the next model call. This is the workhorse: while the agent is actively working, comments land within seconds of being queued.
- **`SessionStart`** — fires when a session opens or resumes. Catches the case where the user reviewed a worktree, queued comments, and then opens a fresh `claude` session in that worktree.
- **`UserPromptSubmit`** — fires when the user types. Backstop for the case where the user typed something while comments were queued (without this we'd wait for the next tool call to deliver, which feels worse than "hey, deliver alongside what I just typed").

The hook is the same script for all three. It reads the event JSON from stdin, extracts `cwd`, POSTs `cwd` to `/api/agent/pull`, and emits the response body to stdout (wrapped in the existing `<reviewer-feedback from="shippable">` envelope so the agent can tell where it came from). Empty payload → empty stdout, no context injection.

Pull-and-ack is atomic on the server side. A turn that fires `PostToolUse` ten times only delivers once; subsequent pulls return empty until something new is enqueued.

## Format the agent sees

A `<reviewer-feedback>` envelope wrapping one `<comment>` block per item. Markdown body, XML wrapper for unambiguous boundaries.

```
<reviewer-feedback from="shippable" commit="<sha>">
  <comment file="server/src/inbox.ts" lines="72-79" kind="block">
    The atomic-ish rename here only avoids torn reads, not concurrent
    writers. If two reviewer sessions send at the same moment we still
    race. Worth a lockfile or a single-writer queue.
  </comment>
  <comment file="web/src/state.ts" lines="118" kind="reply-to-ai-note">
    AI note said this branch was unreachable. It's reachable from the
    keymap handler — see Cmd+Shift+R. The note is wrong; please leave
    the code.
  </comment>
  <comment kind="freeform">
    When you're done with these, run the typecheck before committing.
  </comment>
</reviewer-feedback>
```

Per-comment fields: `file` (repo-relative path), `lines` (single line or range), `kind` (`line` | `block` | `reply-to-ai-note` | `reply-to-teammate` | `reply-to-hunk-summary` | `freeform`). For the reply kinds, the comment body is the reviewer's reply text; the original AI/teammate text isn't included — the agent has the diff and can read it. For `freeform`, no `file` or `lines` — it's the same shape the existing composer ships today.

We send file:line refs, not code excerpts. The agent has the codebase open; sending stale snippets is worse than letting the agent read the file at HEAD. Comments are anchored to the commit sha they were written against (the envelope's `commit` attribute) so the agent can disambiguate if HEAD has moved between send and pull.

Sort order in the payload: by file path, then by line number ascending; freeform comments at the end in send order. The preview sheet shows them the same way; the user can deselect but not reorder.

## Latency model

Honest version, since this is what distinguishes hooks from "true push":

| Agent state                          | Latency to delivery                          | Why |
|--------------------------------------|----------------------------------------------|-----|
| Actively running tools               | seconds (next tool call)                     | `PostToolUse` fires per tool; hook pulls. |
| Just finished a turn, terminal idle  | until next user prompt or session restart    | No hook fires on idle. |
| Closed `claude` entirely             | next `claude` invocation in this worktree    | `SessionStart` covers this. |
| No CC session in this worktree yet   | first `claude` invocation                    | Same as above. |

The thing this does *not* solve: an idle session whose user has stepped away. None of Claude Code's hooks fire on "nothing's happening." Real push-to-idle requires Channels (see § Future channels) or a sidecar that types into the running CLI's stdin (slice (e) of `worktrees.md`, still research-grade).

We surface this in the UI: when a comment is enqueued, the status line reads "queued — delivers on the agent's next tool call or session start." We do not promise mid-turn interrupt or push-to-idle.

## State

- **Per-comment `sentToAgentAt: string | null` in `ReviewState`.** Persisted in localStorage alongside the rest of `ReviewState`. The send button counts comments where this is null. The pip on each thread reads this. The pip flips from "queued" to "delivered" when the hook pulls — UI polls `/api/agent/delivered` while there are queued comments, same shape as the existing composer's inbox-status poll.
- **Server queue: in-memory.** `Map<worktreePath, { pending: Comment[]; delivered: DeliveredComment[] }>`. Survives the lifetime of the server process; restarts drop unpulled comments. Surfaced explicitly: the panel shows a small "(server in-memory — restart drops queue)" hint near the send button.
- **Unsent comments persist per worktree.** Switching to a different worktree/changeset and back does not lose unsent comments — they're keyed in `ReviewState.replies` as today, and `sentToAgentAt: null` is the source of truth for "still unsent."

The in-memory queue is a deliberate v1 limitation. It's a candidate for the SQLite-backed local-storage migration listed under 0.1.0 basics in `docs/ROADMAP.md`. We do not introduce a new persistence mechanism for one queue.

## Onboarding

The existing "Inbox hook not detected" banner stays in shape. What changes is what's behind it:

- The bundled hook script (`tools/shippable-agent-hook` — renamed from `shippable-inbox-hook`) handles all three events.
- The one-click install merges three matcher entries into `~/.claude/settings.json`: `UserPromptSubmit`, `PostToolUse`, `SessionStart`. Idempotent. Same atomic-write + first-modification-only backup discipline as the existing install path.
- Detection: server reads `~/.claude/settings.json` and looks for our hook in *any* of the three event arrays. Banner shows until all three are present (partial install is a real state — surface it as "partially installed").

## Folding in the free-form composer

The existing composer writes to `<worktree>/.shippable/inbox.md` and depends on a `UserPromptSubmit` hook to consume the file. As part of slice (e) the composer migrates to the same enqueue path:

- `POST /api/agent/enqueue` accepts a `freeform` comment kind with no `file`/`lines` and a body string.
- The hook payload format stays the same (`<reviewer-feedback>` envelope wrapping `<comment kind="freeform">…</comment>`).
- `server/src/inbox.ts`, `tools/shippable-inbox-hook`, the `ensureExclude` logic, and the `info/exclude` documentation in `docs/concepts/agent-context.md` § "Why shared `info/exclude`" all delete.
- `agent-context.md` § "Two-way: feedback back to the agent" rewrites to describe the new channel.

This is the right time to do it. The file mechanism's downsides — last-writer-wins, requires `UserPromptSubmit` (which requires the user to type), every send dirties the worktree filesystem — go away when both flows use the server queue. Keeping two channels in parallel doubles the surface area for no benefit.

## Future channels

Researched but explicitly deferred. Documented here so we don't relitigate when the topic comes back.

### Claude Code Channels (research preview, v2.1.80+)

Channels (`code.claude.com/docs/en/channels`) is an MCP-based push protocol that lets a server push messages directly into a running Claude Code session. Events arrive as `<channel source="...">` blocks the model sees mid-conversation. This is the only mechanism that delivers to an idle Claude Code session without the user typing.

Why not in v1:
- Requires the user to launch with `claude --channels plugin:shippable@…` rather than plain `claude`. Per-session opt-in friction.
- During preview the plugin must either be on Anthropic's official allowlist or invoked with `--dangerously-load-development-channels`.
- Requires claude.ai login — API-key-only setups are excluded.
- Default-off for Team/Enterprise organizations.
- Research preview — protocol contract may change.

When it makes sense to add: once Channels leaves preview, the plugin is on the allowlist, and the friction of `--channels` is acceptable for users who want push-to-idle. The MCP server that exposes Channels would also expose the standard MCP tool below, so this is one slice not two.

### Universal MCP pull-tool

Expose `/api/agent/pull` as an MCP tool (`shippable.pull_review_comments`) so any MCP-speaking agent (Cursor, Cline, Codex, Aider, generic SDK agents) can fetch pending comments.

Why not in v1:
- MCP tools are a *weaker primitive than hooks* for this use case. Pull means the model has to decide to call. For "review comments arrive while you work," the agent generally won't think to check unless prompted — and once we're prompting, hooks are the cleaner mechanism.
- Coverage of agents that *only* support MCP (no hooks) is Cursor CLI, Cline, Aider — small audience compared to the hook-supporting set.
- One server, multiple tools is straightforward to add later — the same MCP server that exposes Channels can expose this tool. Building it before there's a need is premature.

When it makes sense to add: when there's actual user demand from a Cursor-CLI/Cline/Aider user. Until then, hooks cover the realistic install base.

### Hooks for other harnesses

Codex CLI, Cursor IDE (1.7+), and OpenCode all support hook systems with similar "stdout becomes context" semantics. Same hook script — different one-click-install logic per harness's settings file shape.

Why not in v1:
- Each harness's settings file has a slightly different schema. Detection + idempotent merge has to be implemented per-harness.
- We don't have user demand yet; ship Claude Code, see who asks.

When it makes sense to add: as user demand surfaces. The hook script itself is portable as-is; only the install + detection logic needs per-harness work.

### Sidecar / PTY-level injection (rejected)

PTY-level injection (TIOCSTI, `/proc/PID/fd/0`) is effectively dead — Linux gates TIOCSTI behind `CAP_SYS_ADMIN`, and `/proc/PID/fd/0` bypasses the line discipline. tmux `send-keys` works in practice but requires the user to run `claude` inside tmux and has known multi-line-Enter gotchas. Not product-grade for a feature we ask normal users to install.

### Claude Agent SDK `streamInput` (not applicable)

The Claude Agent SDK exposes `streamInput()` and `query.interrupt()` for first-class mid-session injection — clean primitive, but only useful when Shippable hosts the agent itself. We don't, so this isn't a path for us. Worth noting because if Shippable ever runs its own agent (e.g., for AI Inspector autonomy), `streamInput` becomes the obvious mechanism.

## Open questions

- **Comment in a file that isn't in the loaded diff.** Shouldn't happen — the reviewer can only comment on hunks in the loaded ChangeSet — but if the user pulls a fresh changeset in the same worktree before sending, the file may no longer be in the diff. We send the file:line anyway; the agent can read the file at HEAD.

- **Cross-session disambiguation.** If two Claude Code sessions are open in the same worktree (rare, but possible), both will pull from the queue. First one wins; the second sees an empty payload. Accept for v1; document.

- **Hook frequency.** `PostToolUse` fires on every tool. For a 50-tool turn, the hook hits the server 50 times. The endpoint is cheap and atomic, but if it ever gets slow, the per-tool fire-and-forget pattern needs a debounce. Not a v1 concern; flag for the perf pass.

- **Server-restart durability.** In-memory queue means a server restart loses unpulled comments. Acknowledged as a v1 limitation; pairs with the planned SQLite migration listed in `docs/ROADMAP.md`.

## Follow-ups (explicitly out of scope for v1)

- **Per-comment Send button.** The batch is the v1 shape; per-comment send is a UX refinement that fits cleanly on top.
- **Re-send after edit.** Editing a sent comment marks it dirty; user can choose to re-send. Needs a "supersedes" link in the payload so the agent knows to disregard the prior version.
- **Agent-reply detection.** When the agent's next assistant message addresses a sent comment, link it back to the comment thread in the UI. Heuristic; needs the symbol/file-mention parser the agent-context panel already has.
- **Push to idle session.** Requires Channels (see § Future channels) or a stdin sidecar.
- **Other harnesses.** Codex CLI, Cursor IDE, OpenCode hook integrations; MCP pull-tool for Cursor CLI / Cline / Aider. Same server, additional shims.
- **Durable queue.** SQLite-backed, paired with the broader local-storage migration.

## Files of interest

- `server/src/agent-queue.ts` (new) — the per-worktree queue + pull/enqueue logic.
- `server/src/index.ts` — endpoints `POST /api/agent/enqueue`, `POST /api/agent/pull`, `GET /api/agent/delivered`.
- `server/src/hook-status.ts` — extended to detect the new event entries; partial-install state.
- `server/src/inbox.ts` — deletes in slice (e) once the composer has migrated.
- `tools/shippable-agent-hook` (new, replaces `shippable-inbox-hook`) — handles all three events.
- `web/src/components/AgentContextSection.tsx` — adds the Send button, preview sheet, sent pips, delivered-history block.
- `web/src/types.ts` — extends `Reply` with `sentToAgentAt: string | null`.
- `web/src/agentContextClient.ts` — `enqueueComments`, `fetchDelivered`; loses `fetchInboxStatus` after slice (e).
- `docs/concepts/agent-context.md` — § Two-way rewritten to describe the new channel; § Why shared `info/exclude` deletes after slice (e).
- `docs/features/agent-context-panel.md` — Send-to-agent affordance section grows a "Send comments" subsection; hook recipe updates to the three-event form.
