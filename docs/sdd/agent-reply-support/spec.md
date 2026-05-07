# Spec: Agent Reply Support

## Goal

Close the agent → reviewer half of the share-review-comments loop. After the agent fetches a batch of reviewer comments via the existing `shippable_check_review_comments` MCP tool, it posts a structured per-comment reply that surfaces threaded under the original comment in the reviewer's UI. The reviewer can scan a long review and see what the agent did with each note — addressed, declined, or noted — without leaving Shippable. The same change retires the freeform composer, simplifying the surrounding queue and rendering paths.

## Requirements Summary

- New MCP tool lets the agent post per-comment replies with `{ commentId, body, outcome }` where `outcome ∈ { addressed, declined, noted }`.
- Trigger is implicit (tool description tells the agent to call after addressing each comment); explicit fallback magic phrase exists for prompt drift.
- Replies render threaded under the original reviewer comment with a generic "agent" identity and an outcome icon.
- Polling runs while the agent-context panel is mounted AND the tab is visible. No per-comment outstanding check or timeout — multi-reply makes any "is the agent done?" gate unsound.
- Freeform composer and `freeform` `CommentKind` are removed in the same change.
- Pip glyph set unchanged (◌ / ✓); a broader pip state-machine rework is logged as a follow-up.
- Server endpoints stay localhost, in-memory, REST-shaped — no new transport.
- Replies persist on the reviewer side via the existing `ReviewState` localStorage round-trip.

Full detail in `requirements.md`.

## Chosen Approach

**Slot into existing patterns.**

Each new piece mirrors something already in the codebase:

- **Tool:** a second MCP tool `shippable_post_review_reply` next to the existing `shippable_check_review_comments`. Called once per comment in the batch. Single-reply-per-call (not batch) so partial-success is naturally per-call and so the model handles "call after each" more reliably than constructing a list.
- **Server storage:** in-memory `Map<worktreePath, AgentReply[]>` next to the existing queue map in `agent-queue.ts`. Same persistence posture (lost on restart). Migrates with the rest of the subsystem when the SQLite follow-up lands.
- **Server endpoints:** `POST /api/agent/replies` (post one reply) and `GET /api/agent/replies` (list, polled by the UI), shaped like the existing `enqueue` / `delivered` pair.
- **Reviewer-side data model:** the agent's replies attach as an array field on the specific reviewer `Reply` they answer. Concretely, `Reply` gains an `agentReplies: AgentReply[]` field (defaults to `[]`); `AgentReply` is a new shape carrying `{ id, body, outcome, postedAt, agentLabel? }`. The match key is the reviewer Reply's `enqueuedCommentId` ↔ the wire `commentId` the agent posts. Multiple agent replies to the same Reply append; the merge step is idempotent on re-poll (existing ids update in place; new ids append).
- **Threading shape:** one level of nested threading. Top level keeps the existing flat array of human Replies under each parent key (AI note / teammate review / hunk summary / line / block / fresh-user-comment). Second level is the new `agentReplies` array under each Reply. Users cannot reply *to* an agent reply — pushback or clarification flows out-of-band into the user-agent chat, which is consistent with the rest of the design (clarifications never travel through Shippable).
- **Polling:** the existing delivered-poll loop is kept; the "active" predicate simplifies to **panel mounted AND tab visible**. No per-comment outstanding check, no timeout. With multi-reply, the server can't distinguish "agent is done" from "agent will post more later", so any predicate that tries to encode "is the agent done?" is unsound. Localhost cost is ~30 req/min — near-zero — and Page Visibility kills polling the moment the user switches away.

This is the path of least architectural change. There are no new transports, no new persistence mechanisms, no localStorage migrations beyond the one new array field, no second polling loop.

> **Threading limitation.** This design adds exactly one level of nested threading (human Reply → agent replies); it does not introduce general nested threading (no replies-to-replies, no multi-author conversations under any node). If a future product need calls for that, `agentReplies` should fold into a unified `children: ThreadEntry[]` model with an author discriminator. Logged as a follow-up under § Out of Scope.

### Alternatives Considered

- **Batch reply tool.** Same as chosen except the tool accepts an array of replies in one call. Saves N round-trips on localhost (negligible) but introduces fiddly partial-success handling and increases prompt-engineering risk — the model must construct a correct list rather than reacting per-comment.
- **Discriminated `Reply` union with a `from-agent` kind in the existing `replies[key]` array.** Treats agent replies as siblings of human replies under the parent's reply key. Loses the 1:1 anchoring to a specific reviewer Reply (when the reviewer wrote multiple replies under the same parent, which one did the agent address?), since siblinghood under the parent key doesn't carry that link. Field-on-Reply makes the relationship structural.
- **Sibling `agentReplies` map keyed by `enqueuedCommentId`.** Two persisted maps to merge at render time; localStorage migration on existing `ReviewState`. Marginal cleanliness gain over field-on-Reply for noticeable extra code.
- **Add nested threading (give `Reply` its own `children`).** The "right" general model but pulls a lot of unrelated surgery into this feature: discriminator design, fixture migrations, render-tree work, and product decisions about whether AI notes / teammate reviews / hunk summaries also fold in. Right-sized only when there's a real product call for nested threads.

## Technical Details

### Architecture

```
┌─ Reviewer UI (web) ───────────────────────────────────────┐
│   AgentContextSection                                     │
│     ├─ install affordance + magic phrases                 │
│     ├─ thread comments (save = enqueue)                   │
│     └─ (free-form composer REMOVED)                       │
│   ReviewState.replies — each Reply gains agentReplies[]    │
│   Polling: GET /api/agent/delivered + GET /api/agent/replies│
│            while panel mounted ∧ tab visible               │
└──────────────────┬───────────────────────┬───────────────┘
                   │ POST /api/agent/enqueue│ GET /api/agent/replies
                   ▼                       ▼
┌─ Local server (server/) ──────────────────────────────────┐
│   Comment queue (existing): pending + delivered           │
│   Reply store (NEW):    Map<worktreePath, AgentReply[]>   │
│   Endpoints:                                              │
│     existing: enqueue / pull / delivered / unenqueue      │
│     NEW:      POST /api/agent/replies                     │
│               GET  /api/agent/replies                     │
│   `freeform` CommentKind REMOVED                          │
└──────────────────┬───────────────────────────────────────┘
                   │ POST /api/agent/replies
                   ▼
┌─ MCP server (mcp-server/) ───────────────────────────────┐
│   existing: shippable_check_review_comments              │
│   NEW: shippable_post_review_reply                       │
│        inputs: { commentId, body, outcome,               │
│                  worktreePath? }                         │
│        outputs: success/error tool result                │
└──────────────────────────────────────────────────────────┘
```

Localhost-bound, no auth, same security posture as today.

### Data Flow

**Posting a reply (agent → reviewer).**
1. Agent processes a comment fetched via `shippable_check_review_comments`. Each `<comment>` in the returned envelope carries an `id="…"` attribute — the agent must capture it on first read because pull-and-ack drains the queue.
2. Agent calls `shippable_post_review_reply` with `{ commentId, body, outcome }` where `commentId` is the captured `id` attribute (worktreePath inferred from `cwd` if absent).
3. MCP server POSTs to `http://127.0.0.1:<port>/api/agent/replies`.
4. Local server validates `worktreePath` (existing `assertGitDir`), validates the `commentId` belongs to a delivered comment for that worktree (defensive), validates `outcome ∈ { addressed, declined, noted }`, appends to the worktree's reply list.
5. Tool result returns success (or a clear error if validation failed).
6. The reviewer's UI picks up the reply on its next poll of `GET /api/agent/replies`.

**Rendering on the reviewer side.**
1. `ReviewState.replies` keeps the existing flat-per-parent shape. The reviewer's outgoing replies live in `replies[parentKey]: Reply[]` exactly as today.
2. Polled `GET /api/agent/replies` returns the agent's replies grouped by `commentId` (= the matching reviewer Reply's `enqueuedCommentId`). The merge step walks every Reply whose `enqueuedCommentId` matches and reconciles `reply.agentReplies` with the incoming list: existing entries (matched by `id`) update in place, new ids append, order follows server-side `postedAt` ascending.
3. `ReplyThread.tsx` renders each Reply as today; for each entry in `reply.agentReplies` it drops a child block underneath showing outcome icon (addressed ✅ / declined ⊘ / noted ℹ︎ — exact glyphs TBD), generic "agent" label, body prose, timestamp. Child blocks stack in `postedAt` order. Visually nested (indent + treatment) — no structural change to the `replies` map shape; only one new level of nesting, and only via this field.

**Polling lifecycle.**
- Poll loop runs every 2s while the panel is mounted AND the tab is visible. Both gates required; either one false stops polling.
- Tab visibility transitions: hide → pause; show → one immediate catch-up poll, then resume.
- No per-comment outstanding check, no timeout. With multi-reply, "all comments have a reply" no longer implies "agent is done", so any predicate that tries to encode that is unsound. The simpler rule covers every late-arriving reply for free.
- If "user has the panel open but walked away" turns into a real cost in production, add tab-idle detection (no scroll/input for N min) — generic, not specific to comment state.

### Key Components

**New / modified server modules**

- `server/src/agent-queue.ts`
  - Add `AgentReply` type: `{ id, commentId, body, outcome: 'addressed' | 'declined' | 'noted', postedAt, worktreePath? (only for context) }`.
  - Add `postReply(worktreePath, payload)` → assigns id + timestamp, appends.
  - Add `listReplies(worktreePath)` → returns the worktree's reply array.
  - Remove `freeform` from `CommentKind` union.
  - Simplify `sortForPayload` — drop the `aFree`/`bFree` branch; all remaining kinds have a `file`.
  - Update tests: remove freeform fixtures, add reply-post / reply-list / outcome-validation cases.

- `server/src/index.ts`
  - Register `POST /api/agent/replies` (validates body shape + worktreePath, calls `postReply`, returns `{ id }`).
  - Register `GET /api/agent/replies?worktreePath=…` (calls `listReplies`).
  - Drop any handling that referenced the freeform kind.

**MCP server**

- `mcp-server/src/handler.ts`
  - Add `handlePostReviewReply(input, deps)`: posts to `/api/agent/replies`, returns success/error `ToolResult`. Mirrors the existing handler shape.

- `mcp-server/src/index.ts`
  - Register `shippable_post_review_reply` with input schema `{ commentId: string, body: string, outcome: enum, worktreePath?: string }` and a description tuned for the implicit-trigger flow ("after addressing each comment in the most recent shippable batch, call this tool to report what you did").

  > **Implementation note.** The `body` parameter ships under the name `replyText` at the MCP boundary — see `docs/sdd/agent-reply-support/implementation-notes.md`. Some model serializers conflate the parameter name `body` with HTML's `<body>` element and emit stray close tags into the value. Renaming the MCP boundary fixes the leakage. The HTTP wire field on `POST /api/agent/replies` and the storage shape (`AgentReply.body`) keep the spec name `body`.

- `mcp-server/README.md`
  - Document the new tool, the magic-phrase fallback `report back to shippable`, and the `outcome` values.

**Reviewer UI (web)**

- `web/src/types.ts`
  - Add new `AgentReply` interface: `{ id, body, outcome, postedAt, agentLabel? }`.
  - Extend existing `Reply` interface with `agentReplies: AgentReply[]`. Defaults to `[]` on existing fixtures and persist-rehydrated entries via the persist-layer migration (mirrors how `enqueuedCommentId` was added previously, see `Reply` JSDoc at `web/src/types.ts:139-145`).

- `web/src/state.ts` (or wherever `ReviewState` reducers + polling live)
  - Add reducer / merge path: for each polled `(commentId, AgentReply[])` group, find the Reply in `replies[*]` whose `enqueuedCommentId` matches and reconcile its `agentReplies` array — existing ids update in place, new ids append, sorted by `postedAt` ascending. No-op if no matching Reply exists (defensive — agent reply may arrive before persist rehydrates, or the Reply may have been deleted locally).
  - Replace polling-active predicate with: `panelMounted && tabVisible`. Drop any per-comment outstanding/timeout logic.
  - Add Page Visibility integration so the loop pauses on hidden tabs.

- `web/src/components/AgentContextSection.tsx`
  - Remove the freeform composer (markup, draft persistence, submit handler, related state).
  - Surface install affordance + the two magic phrases (existing `check shippable`, new `report back to shippable`).
  - Remove any "freeform pending" or freeform-history affordances.

- `web/src/components/ReplyThread.tsx`
  - When rendering each Reply, iterate `reply.agentReplies` and render each as a nested child block underneath: outcome icon + generic "agent" label + body + timestamp; visually distinct (indent + subtle background tint + identity chip). Stack in `postedAt` order.
  - Verify pip rendering still keys off `enqueuedCommentId` + `deliveredIds` (unchanged).

**Docs**

- `docs/concepts/agent-context.md`
  - Rewrite § Two-way: pull half (existing) + new push-back-via-tool half. Note the freeform removal.
- `docs/plans/share-review-comments.md`
  - Update slice list / state / behavior to reflect freeform removal. Cross-link this spec for the back-channel.
- `docs/features/agent-context-panel.md`
  - Update install/onboarding wording: two magic phrases now (`check shippable`, `report back to shippable`).

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/agent-queue.ts` | modify | Add `AgentReply` type, `postReply`, `listReplies`. Remove `freeform` `CommentKind` and freeform-specific sort branch. |
| `server/src/agent-queue.test.ts` | modify | Drop freeform fixtures; add reply post/list/validation cases. |
| `server/src/index.ts` | modify | Register `POST /api/agent/replies` and `GET /api/agent/replies`. |
| `server/src/index.test.ts` | modify | Add endpoint coverage for replies. |
| `mcp-server/src/handler.ts` | modify | Add `handlePostReviewReply`. |
| `mcp-server/src/handler.test.ts` | modify | Test the new handler against happy-path + failure cases. |
| `mcp-server/src/index.ts` | modify | Register `shippable_post_review_reply` with tuned description. |
| `mcp-server/README.md` | modify | Document new tool + magic-phrase fallback. |
| `web/src/types.ts` | modify | Add `AgentReply` interface; extend `Reply` with `agentReplies: AgentReply[]` field; add persist-layer migration defaulting to `[]`. |
| `web/src/state.ts` | modify | Merge polled agent replies; revise polling-active predicate; add visibility pause. |
| `web/src/components/AgentContextSection.tsx` | modify | Remove freeform composer; surface new magic phrase. |
| `web/src/components/ReplyThread.tsx` | modify | Render each entry of `reply.agentReplies` as a nested child block under its parent Reply with outcome icon, stacked in `postedAt` order. |
| `docs/concepts/agent-context.md` | modify | Rewrite § Two-way for new back-channel + freeform removal. |
| `docs/plans/share-review-comments.md` | modify | Reflect freeform removal; cross-link this spec. |
| `docs/features/agent-context-panel.md` | modify | Update onboarding for two magic phrases. |

## Out of Scope

- Edit/supersede of comments or agent replies.
- Threaded back-and-forth between reviewer and agent (clarifications stay in the user-agent chat).
- Pip state-machine rework — when revisited, do `{queued, delivered, replied, error}` together as one cohesive state machine, not piecemeal.
- **General nested threading.** This spec uses a single optional `agentReply` field on `Reply` rather than introducing arbitrary `Reply.children`. If the product later wants replies-to-replies, multi-author threads under any node, or AI notes / teammate reviews / hunk summaries to fold into the same structure, that's a separate refactor — collapse `agentReply` into a unified `children: ThreadEntry[]` with an author discriminator at that point. The data we store now is forward-compatible.
- SSE / WebSocket transport. Polling remains; SSE goes on the follow-up list, motivated by request volume.
- Per-harness agent identity (Claude Code vs Codex vs Cursor). Generic "agent" label only.
- Multi-tab sync (pre-existing limitation).
- Durable persistence beyond in-memory (covered by the existing SQLite migration follow-up for the queue).

## Follow-ups (surfaced by review, not blockers for v0)

- **Idempotency-on-post.** The MCP tool has no client-supplied id; the server mints a fresh `AgentReply.id` on every call. An agent that retries on a transient failure will create duplicate replies the reviewer sees as twins. Fix: accept an optional client-supplied `clientReplyId` on `POST /api/agent/replies` and treat it as an idempotency key (return the existing reply if the same id appears twice). Cheap when we get a real report of a duplicate.
- **Persist schema bump.** `agentReplies` was added to `ReviewState.replies[*]` via a forward-fill in `filterRepliesByHunk` rather than a `v: 2` migration. Fine for one optional field; the *next* persist-shape addition should bump to `v: 2` so future migrations can tell pre/post agent-reply blobs apart. AGENTS.md "things that have bitten us" calls out versioning internal shapes.
- **Query-param naming.** `GET /api/agent/delivered` takes `?path=…`; the new `GET /api/agent/replies` takes `?worktreePath=…`. Both mean the same thing. Pick one (`worktreePath` is the better name — matches the POST bodies and the rest of the agent-queue endpoints) and update the other in a follow-up.
- **`assertGitDir` realpath.** The validator blocks `..` and verifies a `.git` entry but doesn't `fs.realpath` the path. A symlink from `/tmp/evil` → `/home/victim/private-repo` passes today. Acceptable under "localhost is the boundary" — any local process can `fs.symlink` anyway — but worth tightening if the trust boundary changes.
- **Late reply against an aged-out comment id.** The delivered list is capped at `DELIVERED_HISTORY_CAP = 200`. A worktree that delivers >200 comments before the agent posts replies will see the oldest ids fall off the back of the list, and the reply endpoint's defensive `commentId` check will then 400 a legitimate late reply. Acceptable in practice — agents reply within a single batch — but worth surfacing if real workflows hit it. Fix is either to lift the cap, to retain a shadow set of "ever-delivered" ids, or to relax the check to a known-id-shaped string.

## Open Questions Resolved

- **Tool API shape** → single-reply-per-call. Tool name `shippable_post_review_reply`.
- **Magic phrase** → `report back to shippable`, surfaced alongside the existing `check shippable` chip.
- **Outcome enum** → keep three values (`addressed`, `declined`, `noted`). Three states are cheap to model and let the UI render distinct icons; spec can revisit if real usage shows `noted` is unused.
- **Polling-active predicate** → `panelMounted && tabVisible`. No per-comment outstanding check, no timeout. With multi-reply the agent may post additional replies at any time, so any "is the agent done?" predicate is unsound. Per-comment timeouts (30 min was considered) drop on the same logic — fires too late to be useful; tab visibility is the real gate. If "panel open, user away" becomes a real cost, add tab-idle detection (no scroll/input for N min) rather than per-comment timers.
- **Reply fan-out** → multiple agent replies to the same `commentId` are allowed. Stored as an `agentReplies: AgentReply[]` array on each Reply, append-only on the server, idempotent merge on the client. This restores honest "reply" semantics (multi-turn possible) and makes the rename question moot — see below.
- **Naming (tool / type / endpoint)** → keep `shippable_post_review_reply` / `AgentReply` / `/api/agent/replies`. The earlier worry that "reply" implies multi-turn while we modeled 1:1 dissolved when we moved to arrays.
- **Agent identity** → generic `agent` label in v0; harness identity deferred. Optional `agentLabel?` field on the type leaves room for a future surface without forcing a migration.
