# Agent Reply Support — Requirements

## Goal

Close the agent → reviewer half of the share-review-comments loop. After fetching a batch of reviewer comments via the existing `shippable_check_review_comments` MCP tool, the agent posts a structured per-comment reply that surfaces threaded under the reviewer's original comment. This turns Shippable from a one-way drop-off into a workspace where the reviewer can see what the agent did with each note without leaving the panel.

## Requirements

1. **Agent posts per-comment replies via a new MCP tool.** The reply payload is `{ commentId, body, outcome }`, where `outcome ∈ { addressed, declined, noted }` and `body` is free-form prose explaining the fix or reason for skipping.
2. **Implicit trigger via tool description.** The new tool's description instructs the agent to call it after addressing each comment. We rely on the agent obeying the description (same prompt-drift posture as the existing pull tool).
3. **Explicit trigger as a fallback.** If the agent doesn't post replies on its own, the user can ask explicitly (e.g. `report back to shippable`). Same MCP tool is invoked; the difference is just user prompting. Spec pins the exact phrase and how prominently it's surfaced.
4. **Replies surface threaded under the reviewer's original comment** in the reviewer UI, alongside any teammate/reviewer replies in that thread. Each agent reply renders with a distinct visual treatment showing the `outcome` (icon/color) and a generic "agent" identity label.
5. **Polling continues while a reply might still arrive.** Replace the current "while at least one queued pip exists" rule with: poll while the agent-context panel is mounted AND the tab is visible AND any comment is **outstanding** — outstanding = queued (◌) OR delivered-without-reply. Plus a giveup timeout (spec pins, ~30 min) per comment after delivery so we don't burn requests forever on a comment the agent never addresses.
6. **Free-form composer is removed as part of this work.** The `freeform` `CommentKind` and all paths that handle freeform-without-file/line collapse out: composer UI, server kind handling, sort-branch logic, test fixtures, and references in `share-review-comments.md` and `agent-context.md`. Reply support is therefore comment-anchored only — there is no "agent reply to a freeform note" to design.
7. **Pip glyph set stays at the existing two states** (◌ queued / ✓ delivered) for v0. A follow-up captures the broader rework — see Out of Scope.
8. **Server endpoints follow the existing REST shape.** New endpoints to post and list replies live next to `/api/agent/enqueue` / `/api/agent/pull` / `/api/agent/delivered`. In-memory storage on the server matches the existing queue's persistence model (the SQLite migration is already a tracked follow-up for the whole subsystem).
9. **Replies persist on the reviewer's side via the same localStorage round-trip** that already carries `ReviewState.replies`. A reload re-renders the agent's replies under their parent comments.
10. **Reply post failures surface to the agent, not the reviewer.** If the MCP server can't reach the local server, the tool returns an error to the agent's tool call; the agent decides whether to retry or report to its user. The reviewer's UI is not involved in agent-side post failures.

## Constraints

- **MCP-only transport for the agent side.** The reply tool ships in the existing `mcp-server/` package. No new transports (hooks, Channels, PTY) — same posture as the original pull design.
- **Localhost-bound server.** All new endpoints inherit the existing `127.0.0.1`-only bind; no token auth in v0. The MCP server already encodes the port via `SHIPPABLE_PORT`.
- **Worktree isolation matches the existing queue.** Replies key by `worktreePath` like the queue does. The MCP server resolves `worktreePath` from `cwd` if the agent doesn't pass it, same as today.
- **No new persistence mechanism.** Reuse the in-memory map shape from `agent-queue.ts`. Durable storage migrates with the rest of the subsystem when the SQLite follow-up lands.
- **Backwards-compat shim is unnecessary.** Free-form composer removal happens in-place; nothing outside this repo depends on the `freeform` comment kind. Update `share-review-comments.md` and `agent-context.md` in the same change.
- **Agent identity defaults to a generic "agent" label.** MCP doesn't reliably expose harness identity (Claude Code vs Codex vs Cursor vs …). Spec may add an optional reporter field if it's cheap, but per-harness attribution is out of scope.

## Out of Scope

- **Edit/supersede of comments or agent replies.** No edit support exists yet to stress-test against; defer to the same iteration that introduces comment editing.
- **Threaded back-and-forth between reviewer and agent.** Clarification questions stay in the user-agent chat, not in the Shippable thread. Reviewer pushback on a `declined` reply happens out-of-band.
- **Pip state-machine rework.** Today queued/delivered are visible glyphs; "enqueue failed" and "server unreachable" are real states surfaced via other affordances (Save Again button, panel banner). When we revisit, do all of `{queued, delivered, replied, error}` together as one cohesive state machine — not piecemeal. v0 leaves the visible glyph set unchanged.
- **SSE / WebSocket transport for live updates.** Polling stays. SSE is the most natural future upgrade (one-way push, simpler than WS) and is motivated by request volume rather than latency. Logged as a follow-up.
- **Per-harness agent identity.** A single generic "agent" label for v0; no detection or display of Claude Code / Codex / Cursor / etc.
- **Multi-tab sync.** Pre-existing limitation in the codebase; not specific to this feature.
- **Durable persistence beyond in-memory.** Pairs with the existing SQLite migration follow-up that already covers the queue.

## Open Questions

- **Tool name and shape.** Likely `shippable_post_review_reply` or `shippable_post_review_replies` (batch). Spec decides single-reply-per-call vs batch — the agent already has the whole batch in hand after a pull, so batch is plausibly cleaner; per-reply may be more reliable under prompt drift. (Per-reply also means partial-success is naturally handled: each call independently succeeds or fails.)
- **Exact magic phrase for the explicit fallback.** Candidates: `report back to shippable`, `update shippable`, `tell shippable`. Spec pins.
- **Outcome enum cardinality.** Are `noted` and `declined` distinct enough to keep separate, or is `addressed` / `not addressed` (two values) enough? Three lets the UI differentiate "declined with reason" from "FYI received, no action needed", but adds one more decision the model must make correctly.
- **Polling giveup timeout.** ~30 min after a comment is delivered without a reply seems reasonable; spec pins.
- **Reply fan-out.** Can the agent post multiple replies to the same `commentId`? (E.g., revisits the same note after later context.) v0 default proposal: yes, append-only; reviewer sees all of them in order. Spec confirms.

## Related Code / Patterns Found

- `server/src/agent-queue.ts` — in-memory per-worktree queue with `pending` / `delivered` lists, `enqueue` / `pullAndAck` / `listDelivered` / `unenqueue` / `formatPayload`. Reply support extends this module: new `postReply` / `listReplies` plus the `freeform`-kind removal sweep (drop `CommentKind` member, simplify `sortForPayload`, drop fixtures).
- `server/src/index.ts` — existing endpoints `POST /api/agent/enqueue`, `POST /api/agent/pull`, `GET /api/agent/delivered`, `POST /api/agent/unenqueue`. New endpoints `POST /api/agent/replies`, `GET /api/agent/replies` slot in alongside.
- `mcp-server/src/handler.ts` — existing fetch-and-format handler for the pull tool; reply handler mirrors the shape (POSTs to `/api/agent/replies`, returns success/error result).
- `mcp-server/src/index.ts` — registers the existing `shippable_check_review_comments` tool; new tool registers next to it with a tuned description.
- `web/src/types.ts` — `Reply` shape currently carries `enqueuedCommentId`. Extend the data model to attach agent replies under their parent (either as a new `Reply` kind, e.g. `from-agent`, or a sibling `agentReplies` list per parent — spec decides).
- `web/src/components/AgentContextSection.tsx` — currently hosts the install affordance, magic-phrase chip, free-form composer, and Delivered (N) block. Drop the free-form composer; surface received agent replies (likely via the existing thread-render pipeline rather than a new top-level block).
- `web/src/components/ReplyThread.tsx` — pip rendering driven by `enqueuedCommentId` + `deliveredIds`. Add render branch for agent replies.
- `web/src/state.ts` (or wherever `/api/agent/delivered` polling lives) — relax the active-polling rule to the new "outstanding = queued OR delivered-without-reply, plus per-comment giveup timeout" formulation; add visibility-aware pause.
- `docs/concepts/agent-context.md` — § Two-way must be updated to describe the back-channel and the freeform removal.
- `docs/plans/share-review-comments.md` — existing design doc; update to reflect freeform removal and link to this spec for the back-channel.
- `docs/features/agent-context-panel.md` — onboarding/install section; verify references to freeform are removed.
