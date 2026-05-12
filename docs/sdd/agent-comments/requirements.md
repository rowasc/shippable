# Agent Comments — Requirements

## Goal

Repurpose the existing `shippable_post_review_reply` MCP tool so an agent can post not only threaded replies but also **proactive comments** anchored to the diff (file + optional line/block). Enables a pre-review workflow ("agent, review my diff and post comments to Shippable") without any new UI affordance.

This feature is **deliberately narrow**: it follows the same patterns the predecessor `agent-reply-support` already established (parallel store, REST polling, in-memory persistence). The broader comment-system unification — collapsing `Comment` / `Reply` / `AgentReply` into one entity, replacing `CommentKind` with structural `parentId` + `anchor` fields, supporting replies-to-replies with depth-1-flattened render — is **out of scope here and is being handled separately**. This feature is sized to land cleanly and not pre-empt that refactor.

## Requirements

### MCP tool

1. Rename `shippable_post_review_reply` → `shippable_post_review_comment`. The tool posts an `AgentComment` in one of two shapes through a single schema:
   - **Reply** (existing behavior): `parentId` + `replyText` + `outcome ∈ {addressed, declined, noted}`. Posts an `AgentComment` with `parent` set; server lifecycle and reviewer-UI rendering are unchanged from today.
   - **Top-level** (new): `file` + `lines` (single `"42"` or range `"40-58"`) + `replyText`. No `outcome`, no `parentId`. Posts an `AgentComment` with `anchor` set. `lines` is required — file-level (line-less) agent comments are out of scope for v0 (see Out of Scope).
2. Server-side validation:
   - Exactly one of (`parentId` + `outcome`) or (`file`, optional `lines`) must be present.
   - `parentId`, when present, must resolve to a previously-delivered comment for this worktree (existing `isDeliveredCommentId` check).
   - `file` validation matches the existing enqueue-path checks (string, non-empty).
3. `body` stays exposed as `replyText` at the MCP boundary. (The HTML-`<body>` serializer issue from the prior feature still applies.) Internal/server/UI field name remains `body`.
4. Tool description: "Post a comment to Shippable. With `parentId`, threads a reply under that reviewer comment (existing behavior). With `file` + optional `lines`, posts a proactive comment anchored to the diff that the reviewer sees as a new root entry in the panel."

### Server-side agent-comment storage

5. Consolidate the agent-authored storage in `server/src/agent-queue.ts`. The existing `replyStore: Map<worktreePath, AgentReply[]>` becomes a single `agentCommentStore: Map<worktreePath, AgentComment[]>`; both reply-shaped and top-level-shaped entries land in the same list — top-level comments and replies are both `AgentComment`s, distinguished only by which optional field is set. Suggested shape:
   ```
   AgentComment {
     id: string;                         // server-minted
     body: string;
     postedAt: string;                   // ISO
     agentLabel?: string;                // reserved for per-harness identity
     // exactly one of:
     parent?: { commentId; outcome };    // reply
     anchor?: { file; lines };           // top-level (lines required in v0)
   }
   ```
6. One unified GET endpoint returns the worktree's agent comments (replace the existing `GET /api/agent/replies` payload shape with `GET /api/agent/comments`, or extend in place — spec to decide). One POST endpoint handles both shapes via the discriminated payload (`POST /api/agent/comments`, or keep `/api/agent/replies` and accept both shapes — spec to decide).
7. Existing security and resource caps unchanged: localhost-only, `assertGitDir` worktree validation, 1 MiB request-body cap, per-worktree comment cap (200, mirrors the current `REPLY_HISTORY_CAP`).

### Reviewer UI — new root kind

8. Top-level `AgentComment`s (the ones with `anchor` set) render as a **new root kind** in the reviewer panel, alongside the existing roots (AI notes, teammates, hunk summaries, user line/block comments). Anchored to `file` + optional `lines`. Identity surfaces as a generic "agent" label with optional `agentLabel?` override.
9. Reviewer can post a reply under a top-level agent comment using the standard reply composer. Uses a **new reply-key prefix** `agentComment:<id>` in `state.replies`, mirroring the existing `teammate:hunkId` / `hunkSummary:hunkId` prefixes. Threading depth stays at one level (replies under the root, with `Reply.agentReplies[]` nested inside each reviewer reply — the predecessor's model).
10. Reply-shaped `AgentComment`s (the ones with `parent` set) continue to attach under reviewer Replies via `Reply.agentReplies[]` (unchanged from the predecessor). The reviewer side never sees those as roots.

### Reviewer reply enqueue

11. When the reviewer submits a reply under an agent comment (key prefix `agentComment:<id>`), the reply enqueues to the server via the existing `/api/agent/enqueue` path. **Auto-enqueue applies only to this new prefix** — replies under existing kinds (note/user/block/hunkSummary/teammate) keep their current submit-then-enqueue behavior. Auto-enqueue for every reply kind belongs to the unification refactor.
12. The enqueued comment carries a new `CommentKind` value `reply-to-agent-comment`. (Adding one value matches the existing pattern; dropping the enum belongs to the unification refactor.)
13. Server-side validation in `server/src/index.ts` accepts the new `kind` and, when the kind is `reply-to-agent-comment`, requires the `parentId` (or equivalent linking attribute) to resolve to an existing agent comment for this worktree.

### Envelope context for `reply-to-agent-comment`

14. When the agent pulls reviewer comments via `shippable_check_review_comments` and the batch contains a `reply-to-agent-comment` entry, the XML envelope inlines the **parent agent comment's id + body** as context so the agent can thread its response sensibly. Concretely: each `<comment kind="reply-to-agent-comment" parent-id="…">` element carries a `<parent>…body…</parent>` child (or equivalent attribute — spec to pick a shape).
15. No broader "whole thread on every pull" behavior — that's the unification's job. This is only the minimal context the agent needs to thread a reply.

### Polling + persistence

16. Reviewer UI polls the unified endpoint (replacing or extending `GET /api/agent/replies` per §6) to fetch the worktree's `AgentComment`s. Split client-side by discriminator:
    - With `parent` (reply-shaped) → merged under reviewer `Reply.agentReplies[]` (existing `mergeAgentReplies` reducer).
    - With `anchor` (top-level) → merged into a new `state.agentComments` slot (new reducer, mirrors `mergeAgentReplies` — idempotent by id, sorted by `postedAt`).
17. The new `state.agentComments: AgentComment[]` (or keyed by id) renders as roots in the panel.
18. Persist `v: 2` → `v: 3`. Migration adds the empty `agentComments` slot and the `agentComment:` reply-key prefix to the whitelist. The new prefix is *not* hunk-anchored, so `replyKeyTargetsValidHunk` updates to either special-case it or validate against the agent-comments slot instead.
19. In-memory persistence remains. SQLite migration tracked separately.

### Identity & rendering

20. Top-level `AgentComment`s render with a generic "agent" identity treatment matching the existing agent-reply nested treatment. `agentLabel?` rendered if present.
21. Outcome chip applies only to reply-shaped `AgentComment`s (unchanged from the predecessor). Top-level ones don't carry one.

## Constraints

- No new transport — REST polling continues.
- Localhost-only, no auth, in-memory. Same security posture as the predecessor.
- Existing caps stay (1 MiB body, 200 entries per worktree).
- No coordinated change to the `Reply` shape beyond what's strictly needed for the new prefix to flow through persist / `parseReplyKey` / `agentCommentPayload`.
- Tests update narrowly under `server/src/agent-queue.test.ts`, `server/src/index.test.ts`, `mcp-server/src/handler.test.ts`, the relevant `web/src/state.test.ts` / `web/src/persist.test.ts` cases, and the `ReplyThread` / `AgentContextSection` component tests.

## Out of Scope

**Deferred to the comment-system unification (handled separately):**
- Collapsing `Comment` / `Reply` / `AgentReply` into one entity.
- Dropping the `CommentKind` enum.
- `parentId` chains, replies-to-replies, depth-1-flatten rendering across all roots.
- Auto-enqueue for every reviewer reply kind.
- Whole-thread envelope on every `shippable_check_review_comments` pull.

**Out for v0 of this feature regardless:**
- Any UI affordance to trigger an agent pre-review (button, magic phrase, install chip). The agent is invoked via the user's normal chat.
- Edit / supersede / delete of `AgentComment`s (top-level or reply).
- Per-harness agent identity beyond optional `agentLabel?`.
- Un-anchored top-level `AgentComment`s (every top-level one must carry an `anchor.file`).
- File-level top-level agent comments (`lines` omitted). The reviewer UI has no file-level commenting affordance today (users can only comment on lines via `+ comment on L${lineNo}`; reply-key prefixes are all hunk-anchored). Adding file-level for agents alone would create a one-sided UX. Future change: bundle file-level commenting for users and agents in one step.
- SSE / WebSocket transport.
- Multi-tab sync.
- Durable persistence beyond in-memory.

## Open Questions

- **Endpoint shape.** Replace the existing `/api/agent/replies` endpoints with a single `/api/agent/comments` pair that handles both shapes (both shapes are just `AgentComment`s), vs. keep `/api/agent/replies` for reply-shaped entries and add a sibling `/api/agent/comments` for top-level ones. Spec to pick; leaning consolidate, since the underlying store is one list anyway.
- **Envelope shape for parent context.** XML structure for the inlined parent agent comment body: nested `<parent>…</parent>` element vs `parent-body="…"` attribute vs separate parent block at the top of the envelope. Spec to pick the shape that's both readable for the agent and unambiguous to escape.
- ~~**File-level agent comments.**~~ Resolved in spec.md: disallowed for v0. The reviewer UI has no file-level commenting today; adding it for agents alone would create a one-sided UX. Tool input requires `lines` in top-level mode.
- **`parseReplyKey` for `agentComment:<id>`.** The id is a UUID with no `:` so parsing is unambiguous, but the existing `replyKeyTargetsValidHunk` path looks up hunk ids — for the new prefix it needs to validate against the persisted agent-comments slot. Spec to pin the validation logic.
- **Polling consolidation.** Add a third poll endpoint vs extend the existing `/api/agent/replies` response with a discriminator. Spec to choose; the existing `Promise.allSettled` pattern accommodates either.
- **Validation of `reply-to-agent-comment` enqueue.** The reviewer's reply enqueue must reference its parent agent-comment id. Decide whether to repurpose an existing field on `enqueueComment` (e.g., overload `supersedes`) or add a dedicated `parentAgentCommentId` field on the `Comment` shape. Spec to pick; leaning dedicated field for clarity.
- **Reviewer-side "delete" semantics for the new prefix.** Existing reply prefixes support delete (with the pre-/post-delivered distinction). Confirm whether agent-comment-replies follow the same UX or are immutable after enqueue.

## Related Code / Patterns Found

- `docs/sdd/agent-reply-support/spec.md` — immediate predecessor. Establishes the `AgentReply` shape, parallel store pattern, polling with visibility gating, MCP boundary rename to `replyText`, request-body cap, reply-history cap, in-memory persistence posture. **This feature follows the same patterns deliberately.**
- `docs/sdd/agent-reply-support/implementation-notes.md` — calls out the persist-shape version bump as the next change. This feature lands `v: 3`.
- `server/src/agent-queue.ts` — current `Comment`, `AgentReply`, `replyStore`. Refactor target: `AgentReply` renames to `AgentComment` with the discriminated shape; `replyStore` becomes `agentCommentStore`; one `postAgentComment` (or two thin helpers) replaces `postReply`. `CommentKind` gets one new value `reply-to-agent-comment`.
- `server/src/index.ts:826-1078` — `COMMENT_KINDS` whitelist, `isCommentKind`, comment enqueue handler. Add the new kind, add validation for the parent-agent-comment-id linking.
- `mcp-server/src/index.ts:40-77` — current `shippable_post_review_reply` registration. Rename + broaden input schema.
- `mcp-server/src/handler.ts:96-167` — current `handlePostReviewReply`. Generalize to dispatch by input shape.
- `web/src/types.ts:239-308` — `Reply` interface. Untouched except for any field needed for the new prefix's enqueue flow.
- `web/src/types.ts:600-682` — reply-key helpers and `parseReplyKey`. Add `agentComment:<id>` prefix.
- `web/src/types.ts:689-714` — `CommentKind` and `Comment`. Add the new kind value; add the parent-agent-comment-id field if a dedicated field is chosen.
- `web/src/agentCommentPayload.ts` — `deriveCommentPayload`. Add the new prefix's mapping (no `file`/`lines` derivation since the parent already carries the anchor; the new kind passes through the parent id).
- `web/src/agentContextClient.ts` — `enqueueComment`, `fetchAgentReplies`. Extend to fetch agent comments and to thread the new kind through enqueue.
- `web/src/state.ts:884-950` — `mergeAgentReplies` reducer. Add sibling `mergeAgentComments` for the new root slot.
- `web/src/persist.ts` — `v: 2` → `v: 3` migration; whitelist update for `agentComment:` prefix; `state.agentComments` slot.
- `web/src/components/ReplyThread.tsx` — current renderer. Render the new root kind (likely a thin wrapper around the existing root render path) and surface auto-enqueue for the new prefix.
- `web/src/components/AgentContextSection.tsx` — render hook for the new roots in the panel. No new chip / magic phrase.
- `docs/concepts/agent-context.md` — section to update with the new agent-comment back-channel.
- `docs/plans/share-review-comments.md` — model + envelope updates.
- `docs/ROADMAP.md` — fits under "AI-enabled review UX / Review-while-they-work" in 0.1.0.
