# Spec: Agent Comments

## Goal

Repurpose the existing `shippable_post_review_reply` MCP tool so the agent can post **top-level** comments anchored to the diff in addition to threading **replies** under reviewer comments. Both shapes are stored as a single `AgentComment` entity server-side. Top-level entries surface in the reviewer's panel as a new root kind that the reviewer can reply to via the standard composer. Enables a pre-review-by-agent workflow ("agent, review my diff and post comments to Shippable") without any new UI affordance.

This feature is deliberately narrow. It follows the patterns the predecessor `agent-reply-support` established (parallel store, REST polling, in-memory persistence) and stops there. The broader comment-system unification — collapsing `Comment` / `Reply` / `AgentComment` into one entity, replacing `CommentKind` with structural fields, supporting replies-to-replies — is being handled by a teammate and is intentionally not pre-empted here.

## Requirements Summary

- **MCP tool** `shippable_post_review_reply` renames to `shippable_post_review_comment` and accepts two input shapes through one schema: **reply** (`parentId` + `replyText` + `outcome`) or **top-level** (`file` + `lines` + `replyText`).
- **Server-side** consolidates `replyStore` into `agentCommentStore: Map<worktreePath, AgentComment[]>`. The unified entity carries either `parent` (reply) or `anchor` (top-level) — never both, never neither.
- **One new `CommentKind` value** `reply-to-agent-comment`, plus a new field `Comment.parentAgentCommentId` to link a reviewer's reply to the agent comment it's anchored under. The rest of the `CommentKind` enum is untouched (the unification will collapse it later).
- **Reviewer UI** gains a new root kind for top-level `AgentComment`s; a new reply-key prefix `agentComment:<id>` flows through `state.replies`, `parseReplyKey`, `agentCommentPayload`, and the persist whitelist.
- **Polling** consolidates: `/api/agent/replies` is replaced by `/api/agent/comments`; the client splits the polled array by discriminator (`parent` → existing `mergeAgentReplies`, `anchor` → new `mergeAgentComments`).
- **Pull envelope** inlines the parent agent comment's id + body when a queued reviewer reply has kind `reply-to-agent-comment`, so the agent has context to thread its response.
- **Persist** bumps `v: 2` → `v: 3` for the new `state.agentComments` slot and the new reply-key prefix.

Full detail in `requirements.md`.

## Chosen Approach

**Parallel-store, single-entity at the agent boundary, narrow surface area on the reviewer side.**

The agent-authored storage is **unified** into a single `AgentComment` entity because both top-level comments and replies are agent-authored, polled by the reviewer the same way, capped the same way, and rendered by closely related code paths. Discriminating by which optional field is set (`parent` vs `anchor`) is a small, local pattern that costs nothing.

The reviewer side follows **existing patterns** without modification: top-level agent comments are a new root with a new reply-key prefix (mirroring `teammate:` / `hunkSummary:`), reply-shaped agent comments still nest under `Reply.agentReplies[]` (the predecessor's model), and the persist migration is a straight slot-and-whitelist addition. No reviewer-side data-model collapse, no `CommentKind` removal, no replies-to-replies surgery — all of those land in the teammate's separate unification feature.

The single new `CommentKind` value `reply-to-agent-comment` is the smallest possible change to the existing union to express the new link. It pairs with a dedicated `Comment.parentAgentCommentId?: string` field rather than overloading `supersedes`, because overloading would change the meaning of an existing field in a way the unification refactor would then have to disentangle.

### Alternatives Considered

- **Two parallel stores** (separate `agentReplyStore` and `agentCommentStore`). Mirrors the predecessor exactly: zero refactor to `replyStore`, add a fresh store next to it. Rejected because the two shapes share more than they differ (id, body, postedAt, agentLabel, polling, capping), and merging them now removes a piece of bookkeeping that the unification refactor would have to merge anyway. The user explicitly flagged this as the natural collapse.
- **Full data-model unification** (the original brainstorm output). Collapses `Comment` / `Reply` / `AgentComment` into one entity, drops `CommentKind`, uses `parentId` + `anchor` everywhere, supports replies-to-replies with depth-1-flatten render. Rejected for this feature: it's the teammate's separate work. Pre-empting it would step on toes and force a coordinated landing.
- **Overload `Comment.supersedes` to carry the parent-agent-comment-id** for `reply-to-agent-comment` entries. Rejected because the dual meaning ("this comment replaces an older one" vs "this comment is a reply to an agent comment") is confusing and the unification would have to untangle it anyway. A dedicated `parentAgentCommentId` field is one line of type definition and is unambiguous.
- **One-way agent comments** (agent posts, reviewer reads but cannot reply through the panel). Rejected — the brainstorm pinned full two-way as the requirement.
- **File-level top-level comments via `lines` omitted**. The tool input schema would allow it, but the reviewer UI has no file-level comment rendering today — users can only comment on lines (`+ comment on L${lineNo}` is the only affordance; reply-key prefixes are all hunk-anchored). There's no existing pattern to reuse. Resolution: **disallow `lines` omitted on top-level mode for v0** (tool input validation). File-level support waits for a future change that adds file-level commenting for both users and agents in one step.

## Technical Details

### Architecture

```
┌─ Reviewer UI (web) ──────────────────────────────────────────────────┐
│  Roots in panel:                                                     │
│    existing: AI notes, teammates, hunk summaries, user line/block    │
│    NEW:      top-level AgentComments (anchor.file + anchor.lines)    │
│                                                                      │
│  ReviewState                                                         │
│    replies[key]: Reply[]                                             │
│      keys: note:* · user:* · block:* · hunkSummary:* · teammate:*    │
│            NEW: agentComment:<id>                                    │
│      each Reply still has agentReplies[]  (unchanged)                │
│    NEW slot: agentComments: AgentComment[]  (top-level only)         │
│                                                                      │
│  Polling: GET /api/agent/delivered + GET /api/agent/comments         │
│           (the second replaces /api/agent/replies)                   │
│  Reducer split by discriminator: parent → existing mergeAgentReplies │
│                                  anchor → new mergeAgentComments     │
└──────────────────┬───────────────────────┬───────────────────────────┘
                   │ POST /api/agent/enqueue │ GET /api/agent/comments
                   ▼                         ▼
┌─ Local server (server/) ─────────────────────────────────────────────┐
│  Comment queue (existing): pending + delivered                       │
│    CommentKind ⨁ "reply-to-agent-comment"                            │
│    Comment.parentAgentCommentId?: string  (NEW; required when         │
│                                            kind === reply-to-…)      │
│                                                                      │
│  agentCommentStore: Map<worktreePath, AgentComment[]>                 │
│    (replaces replyStore — same Map, broader element shape)            │
│                                                                      │
│  Endpoints (delta):                                                  │
│    REPLACED: /api/agent/replies → /api/agent/comments (POST + GET)    │
│    OTHERS:   enqueue / pull / delivered / unenqueue unchanged         │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ POST /api/agent/comments
                   ▼
┌─ MCP server (mcp-server/) ─────────────────────────────────────────┐
│  existing: shippable_check_review_comments (unchanged behavior;    │
│            envelope grows a <parent> child for reply-to-agent-     │
│            comment entries — see § Pull envelope)                  │
│  RENAMED + BROADENED:                                              │
│    shippable_post_review_comment                                    │
│      reply mode:  { parentId, replyText, outcome, worktreePath? }  │
│      top-level:   { file, lines, replyText, worktreePath? }        │
└────────────────────────────────────────────────────────────────────┘
```

Localhost-bound, no auth. Existing 1 MiB request-body cap and per-worktree 200-entry cap stay.

### Data Flow

**Posting a top-level agent comment (agent → reviewer).**

1. Agent calls `shippable_post_review_comment` with `{ file, lines, replyText, worktreePath? }`. No `parentId`, no `outcome`. `lines` required (file-level disallowed in v0 — see Out of Scope).
2. MCP handler maps `replyText → body`, packages as `{ anchor: { file, lines }, body }`, and POSTs to `http://127.0.0.1:<port>/api/agent/comments`.
3. Local server validates: `worktreePath` (`assertGitDir`), exactly one of `parent` / `anchor` present (here: `anchor`), `anchor.file` non-empty, `anchor.lines` non-empty and matches the `"42"` / `"40-58"` shape. On success, mints `id` + `postedAt`, appends to the worktree's `agentCommentStore` list (cap 200, oldest dropped on overflow).
4. Tool result returns success: `Posted agent comment <id> for <file>:<lines>.`
5. Reviewer UI picks up the comment on its next poll of `GET /api/agent/comments` and merges into `state.agentComments`.

**Posting an agent reply (agent → reviewer). Existing flow, unchanged.**

1. Agent calls `shippable_post_review_comment` with `{ parentId, replyText, outcome, worktreePath? }`.
2. MCP handler packages as `{ parent: { commentId: parentId, outcome }, body: replyText }` and POSTs to `/api/agent/comments`.
3. Server validates `parent.commentId` against the existing `isDeliveredCommentId` check, validates `outcome`, mints id + timestamp, appends to `agentCommentStore`.
4. Reviewer UI picks up on the next poll; the `parent`-set entry is translated to the existing `PolledAgentReply` shape and merged under the matching reviewer `Reply.agentReplies[]` via the existing `mergeAgentReplies` reducer.

**Reviewer replying to a top-level agent comment.**

1. Reviewer opens the panel, sees a top-level `AgentComment` rendered as a new root, clicks "+ reply", types, hits send.
2. Submit handler creates a `Reply` under `state.replies["agentComment:<id>"]` and immediately calls `enqueueComment({ kind: 'reply-to-agent-comment', file: <agentComment.anchor.file>, lines: <agentComment.anchor.lines>, body, parentAgentCommentId: <id> })` — same existing submit path as other reply kinds (no new "save vs send" affordance is introduced or removed).
3. Server's `/api/agent/enqueue` validates the new kind: `parentAgentCommentId` must be present and resolve to an `AgentComment` in this worktree's `agentCommentStore`. Validates `file` / `lines` shape as today.
4. Server mints `Comment.id`, returns it; reviewer-side `Reply.enqueuedCommentId` is set, pip flips to `◌ queued`.
5. Agent pulls via `shippable_check_review_comments`. The envelope's `<comment kind="reply-to-agent-comment" parent-id="…">` element carries a `<parent id="…" file="…" lines="…">...body...</parent>` child with the inlined parent agent comment so the agent has context.
6. Agent reads the parent, formulates a response, posts via `shippable_post_review_comment` with `{ parentId: <Comment.id of the reviewer's reply>, replyText, outcome }`. This threads the agent's response under the reviewer's reply via the existing reply path — no special-case logic for "the parent of this reply was an agent comment."
7. Reviewer UI polls, merges the new agent reply under the matching `Reply.agentReplies[]` exactly as today. The threading shape in the UI is: top-level `AgentComment` → reviewer `Reply` (in `state.replies["agentComment:<id>"]`) → agent's `agentReplies[]` nested inside.

**Polling lifecycle.** Unchanged from predecessor: poll loop runs every 2s while the panel is mounted AND the tab is visible. `Promise.allSettled` over `fetchDelivered` + `fetchAgentComments` (new) — same per-endpoint independence as today's `fetchDelivered` + `fetchAgentReplies` pair.

### Key Components

**`server/src/agent-queue.ts`**

- Rename `AgentReply` → `AgentComment`. Shape:
  ```ts
  export interface AgentComment {
    id: string;
    body: string;
    postedAt: string;
    agentLabel?: string;
    // exactly one of:
    parent?: { commentId: string; outcome: Outcome };
    anchor?: { file: string; lines: string };
  }
  ```
  `anchor.lines` is required in v0 (file-level disallowed; see Out of Scope). Typed as `string`, not `string | undefined`.
- Rename `replyStore: Map<string, AgentReply[]>` → `agentCommentStore: Map<string, AgentComment[]>`. Rename `REPLY_HISTORY_CAP` → `AGENT_COMMENT_HISTORY_CAP` (keep value `200`).
- Rename `postReply` → `postAgentComment`. Signature:
  ```ts
  postAgentComment(
    worktreePath: string,
    payload:
      | { parent: { commentId: string; outcome: Outcome }; body: string; agentLabel?: string }
      | { anchor: { file: string; lines: string }; body: string; agentLabel?: string },
  ): string;
  ```
  Mints id + postedAt, appends, returns id. Same cap behavior.
- Rename `listReplies` → `listAgentComments`. Returns the worktree's full list.
- Add a small helper `isAgentCommentId(worktreePath, id): boolean` mirroring `isDeliveredCommentId` — used by the enqueue validator for `reply-to-agent-comment` kind.
- Extend `CommentKind` union with `reply-to-agent-comment`. Extend the `Comment` interface with `parentAgentCommentId?: string` (only set when `kind === "reply-to-agent-comment"`).
- Extend `formatPayload` / `renderComment`: for `kind === "reply-to-agent-comment"`, look up the parent in `agentCommentStore`, emit `<comment kind="…" parent-id="…">body<parent id="…" file="…" lines="…">parentBody</parent></comment>`. If the parent is no longer present (capped out), emit the `parent-id` attribute but omit the `<parent>` child and add `parent-missing="true"` so the agent can degrade gracefully.

**`server/src/index.ts`**

- Replace `POST /api/agent/replies` with `POST /api/agent/comments`. Body shape validated by structural discriminator. Returns `{ id }`.
- Replace `GET /api/agent/replies` with `GET /api/agent/comments`. Returns `{ comments: AgentComment[] }`.
- Settle the query-param naming carry-over from the predecessor's follow-up: the new endpoints take `?worktreePath=…` consistently (matching the POST bodies).
- Add `reply-to-agent-comment` to `COMMENT_KINDS` whitelist. Update the enqueue handler: when `kind === "reply-to-agent-comment"`, `parentAgentCommentId` is required, must be a non-empty string, and must resolve via `isAgentCommentId` for this worktree. `400` on any failure.
- The enqueue path stamps `parentAgentCommentId` into the queued `Comment` so the pull-time `formatPayload` can find the parent.

**`mcp-server/src/handler.ts`**

- Rename `handlePostReviewReply` → `handlePostReviewComment`. New input type discriminated by which fields are present:
  ```ts
  type PostReviewCommentInput =
    | { worktreePath?: string; parentId: string; replyText: string; outcome: Outcome }
    | { worktreePath?: string; file: string; lines: string; replyText: string };
  ```
- Map the discriminated input to the HTTP body:
  - Reply: `{ worktreePath, parent: { commentId: parentId, outcome }, body: replyText }`
  - Top-level: `{ worktreePath, anchor: { file, lines }, body: replyText }`
- POST to `/api/agent/comments`. Same error-handling shape as today (returns `errorResult` on transport/JSON/HTTP failures).
- Success tool result: `"Posted agent comment <id> for <file>:<lines>."` for top-level; `"Posted reply <id> for comment <parentId>."` for reply (preserves the existing predecessor wording on the reply path).

**`mcp-server/src/index.ts`**

- Register `shippable_post_review_comment` with a unified input schema using `z.union` over the two shapes (or a single schema with all-optional fields plus a refinement that exactly one of `{parentId, outcome}` / `{file, lines}` is set — `z.union` is cleaner). Tool description per requirements §1.4.

**`web/src/types.ts`**

- Rename the web-side `AgentReply` interface → `AgentComment` with the discriminated shape mirroring the server type. Add a temporary alias `export type AgentReply = AgentComment & { parent: NonNullable<AgentComment["parent"]> }` if call sites benefit, or do a direct rename and let the unification refactor pick the final name.
- Add `CommentKind` value `"reply-to-agent-comment"`.
- Add `Comment.parentAgentCommentId?: string`.
- Add reply-key helper `agentCommentReplyKey(id): string` returning `"agentComment:" + id`. Extend `ParsedReplyKey` union and `parseReplyKey` with the new prefix:
  ```ts
  | { kind: "agentComment"; agentCommentId: string }
  ```
  The id is the UUID after the prefix; no further `:` parsing.

**`web/src/agentCommentPayload.ts`**

- Extend `deriveCommentPayload` with the new `"agentComment"` case: returns `{ kind: "reply-to-agent-comment", file, lines, parentAgentCommentId: agentCommentId }`. The `file` and `lines` come from the corresponding top-level `AgentComment` in `state.agentComments`. The function gains a second argument or a lookup-by-id closure for `state.agentComments` so it can resolve the anchor.

**`web/src/agentContextClient.ts`**

- Rename `fetchAgentReplies` → `fetchAgentComments`. New return type `{ comments: AgentComment[] }` (replaces `{ replies: PolledAgentReply[] }`).
- Extend `enqueueComment` payload type to allow `parentAgentCommentId?: string` and the new kind.
- Drop the now-unused `replies` shape; if existing callers exist outside the polling reducer, fold them into a thin shim or update them directly.

**`web/src/state.ts`**

- Add `state.agentComments: AgentComment[]` to `ReviewState` (initialized to `[]` in `initialState`).
- Add reducer `mergeAgentComments`: idempotent merge of polled `AgentComment[]` (filtered to `anchor`-set entries) into `state.agentComments` by id, sorted ascending by `postedAt`. Mirrors `mergeAgentReplies` invariant — re-merging the same batch returns the same state reference.
- In the polling loop, on a `GET /api/agent/comments` success, split the array client-side:
  - `parent`-set entries → translate to existing `PolledAgentReply` shape (`{ id, commentId: parent.commentId, body, outcome: parent.outcome, postedAt, agentLabel? }`) and dispatch to existing `mergeAgentReplies`. No reducer change.
  - `anchor`-set entries → dispatch to `mergeAgentComments`.
- Update `useDeliveredPolling` (or wherever the existing hook lives) to call the renamed `fetchAgentComments` and to return both `agentReplies` and `agentComments` to its parent.

**`web/src/persist.ts`**

- `CURRENT_VERSION = 3`. Add `migrations[3]`:
  ```ts
  3: (v2) => ({
    ...(v2 as PersistedSnapshot),
    v: 3,
    agentComments: [],
  }),
  ```
- Extend `PersistedSnapshot` with `agentComments: AgentComment[]`.
- Persist `state.agentComments` in `buildSnapshot`. Filter out anything `external`-flagged (none today, but defensive).
- Add `agentComment:` prefix to `replyKeyTargetsValidHunk`: special-case to validate against the persisted `agentComments` slot's ids instead of the hunk-id set. Since persist runs before `state.agentComments` is fully merged at boot, validation defers to "id appears in either the snapshot's `agentComments` array or in the live polled set" — the safer move is to accept any `agentComment:<uuid>` key during rehydrate and let the next poll reconcile (the same forgiveness `filterRepliesByHunk` already applies to legacy entries).
- Update `isPersistedSnapshot` to require `Array.isArray(o.agentComments)`.

**`web/src/components/ReplyThread.tsx`**

- Add identity treatment: when a `Reply`'s parent key starts with `agentComment:`, the reply renders normally (same Reply shape) but the *root* identity above it shows the agent's "agent" label + the anchor (`src/foo.ts:42-58`). The Reply composer behaves exactly as on other roots — no separate "save vs send" affordance, so submit-as-enqueue is just the existing path.
- The agent-replies-nested-under-reviewer-reply path (`AgentRepliesList`) is unchanged.

**`web/src/components/AgentContextSection.tsx`**

- Render the new root kind in the panel: iterate `state.agentComments` and emit one root entry per agent comment with its anchor (`file:lines`) and a `ReplyThread` for replies under `agentComment:<id>`. Slot in alongside existing roots, sorted by `postedAt` (other roots' sorting is unchanged — only the new section has a sort key).
- **Identity differs from user comments; rendering pattern matches them.** Top-level `AgentComment`s render using the same Reply-style bubble + composer interaction as user line/block roots — only the author label differs (`agentLabel ?? "agent"` instead of `"you"`). No new visual primitive is introduced.
- No new chip / magic phrase — pre-review trigger is out of scope.

**Docs**

- `docs/concepts/agent-context.md` — extend § Two-way with the new top-level path; clarify that "agent comment" now means either flavor.
- `docs/plans/share-review-comments.md` — note the endpoint rename and the new envelope `<parent>` child.
- `docs/features/agent-context-panel.md` — describe the new root kind and the agent-initiated pre-review flow.
- `mcp-server/README.md` — rename tool name, document the new top-level input shape.

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/agent-queue.ts` | modify | Rename `AgentReply` → `AgentComment` with discriminated `parent` / `anchor`; rename `replyStore` → `agentCommentStore`; rename `postReply` / `listReplies`; add `isAgentCommentId`; extend `CommentKind`; add `Comment.parentAgentCommentId`; extend `renderComment` to inline `<parent>` child. |
| `server/src/agent-queue.test.ts` | modify | Update fixtures for the rename; add cases for both shapes; add `<parent>`-envelope cases including the missing-parent fallback. |
| `server/src/index.ts` | modify | Replace `/api/agent/replies` with `/api/agent/comments` (POST + GET); validate the new kind + `parentAgentCommentId` on `/api/agent/enqueue`; settle `?worktreePath=` for the new endpoints. |
| `server/src/index.test.ts` | modify | Endpoint coverage: both POST shapes, GET, enqueue with the new kind, validation failures. |
| `mcp-server/src/handler.ts` | modify | Rename + broaden: `handlePostReviewComment` with discriminated input → maps to the unified HTTP body. |
| `mcp-server/src/handler.test.ts` | modify | Test both shapes happy-path + failure cases. |
| `mcp-server/src/index.ts` | modify | Register `shippable_post_review_comment` with the unified input schema. |
| `mcp-server/README.md` | modify | Rename tool, document both shapes. |
| `web/src/types.ts` | modify | Rename `AgentReply` → `AgentComment` with discriminated shape; extend `CommentKind`; add `Comment.parentAgentCommentId`; add `agentCommentReplyKey`; extend `ParsedReplyKey` + `parseReplyKey`. |
| `web/src/agentCommentPayload.ts` | modify | Add `"agentComment"` case → returns `{ kind: "reply-to-agent-comment", file, lines, parentAgentCommentId }` resolved from `state.agentComments`. |
| `web/src/agentContextClient.ts` | modify | Rename `fetchAgentReplies` → `fetchAgentComments`; new return shape; extend `enqueueComment` payload. |
| `web/src/state.ts` | modify | Add `state.agentComments` slot; add `mergeAgentComments` reducer; split polled array by discriminator; rename hook outputs. |
| `web/src/state.test.ts` | modify | Add cases for the new reducer; verify split-and-merge round-trips both shapes. |
| `web/src/persist.ts` | modify | `v: 3` migration; extend `PersistedSnapshot`; whitelist `agentComment:` prefix; persist `state.agentComments`. |
| `web/src/persist.test.ts` | modify | Add a `v: 2 → v: 3` migration test; round-trip the new slot and prefix. |
| `web/src/components/ReplyThread.tsx` | modify | Identity treatment for the new root; otherwise reuses existing reply rendering. |
| `web/src/components/ReplyThread.test.tsx` | modify | Add cases for an `agentComment:<id>`-keyed thread. |
| `web/src/components/AgentContextSection.tsx` | modify | Render new top-level `AgentComment` roots in the panel. |
| `docs/concepts/agent-context.md` | modify | Extend § Two-way for the top-level path; clarify terminology. |
| `docs/plans/share-review-comments.md` | modify | Endpoint rename + envelope `<parent>` child. |
| `docs/features/agent-context-panel.md` | modify | Describe the new root kind. |

## Out of Scope

**Deferred to the comment-system unification (handled separately):**

- Collapsing `Comment` / `Reply` / `AgentComment` into one entity end-to-end.
- Dropping the `CommentKind` enum.
- Structural `parentId` chains, replies-to-replies, depth-1-flatten render across all roots.
- Auto-enqueue for every reviewer reply kind (this feature only touches the new `agentComment:` prefix's submit path; existing prefixes' submit behavior is unchanged).
- Whole-thread envelope on every `shippable_check_review_comments` pull.

**Out for this feature regardless:**

- Any UI affordance to trigger an agent pre-review (button, magic phrase / chip, install hint). The agent is invoked via the user's normal chat.
- File-level top-level agent comments (`lines` omitted). The reviewer UI has no file-level commenting today — neither users nor agents can comment at the file level. Tool input validation rejects with a clear error. Follow-up bundles file-level commenting for users and agents in one change.
- Edit / supersede / delete of `AgentComment`s. Reviewer-side delete of a reply under `agentComment:<id>` follows the existing per-reply UX (pre-enqueue → unenqueue; post-enqueue → local-only with the "agent already saw this" tooltip).
- Per-harness agent identity (`agentLabel?` is reserved and rendered if present, but not surfaced beyond that).
- SSE / WebSocket transport.
- Multi-tab sync.
- Durable persistence beyond in-memory (SQLite remains a tracked follow-up).

## Open Questions Resolved

- **Endpoint shape.** Replace `/api/agent/replies` with `/api/agent/comments` (POST + GET). One endpoint pair, both shapes, single store. The query-param `?worktreePath=` (settled name from the predecessor's follow-up) applies.
- **Envelope shape for parent context.** Nested `<parent id="…" file="…" lines="…">parentBody</parent>` child under the `<comment kind="reply-to-agent-comment" parent-id="…">` element. Body content is sanitized the same way as comment bodies (`]]>` escape). If the parent is no longer in the cap-200 list, emit `parent-id` + `parent-missing="true"` and omit the `<parent>` child.
- **File-level agent comments.** Disallowed in v0. Tool input requires `lines` in top-level mode. The reviewer UI has no file-level commenting affordance today (users can only comment on lines), so there's no existing rendering pattern to reuse. Follow-up: bundle file-level commenting for users and agents into one future change.
- **`parseReplyKey` for `agentComment:<id>`.** Added as a new `ParsedReplyKey` variant. The id is the everything-after-the-prefix string; no further `:` parsing.
- **`replyKeyTargetsValidHunk` for the new prefix.** Special-cased: any `agentComment:<uuid>` key is treated as valid during rehydrate; the next poll reconciles against the live `state.agentComments` list. Same forgiveness as existing legacy-entry handling.
- **Polling consolidation.** Single endpoint `/api/agent/comments`; client splits by discriminator. `fetchAgentComments` replaces `fetchAgentReplies`. `mergeAgentReplies` reducer is reused via a wire-shape translation; new `mergeAgentComments` handles the top-level slot.
- **Validation of `reply-to-agent-comment` enqueue.** Dedicated `Comment.parentAgentCommentId` field, required when `kind === "reply-to-agent-comment"`, validated against `isAgentCommentId` server-side.
- **Reviewer-side delete semantics for the new prefix.** Matches existing reply prefixes: pre-enqueue hits `/api/agent/unenqueue`; post-enqueue is local-only.
- **Outcome on reply path.** Unchanged from predecessor: required, three values (`addressed`, `declined`, `noted`), rendered as outcome chip. Top-level mode carries no outcome and renders no chip.
- **Agent reply to a reviewer's reply-to-agent-comment.** The agent posts via the same `shippable_post_review_comment` reply mode with `parentId` = the queued reviewer-reply's `Comment.id`. No special-case logic — threading is uniform.

## Follow-ups (not blockers)

- **File-level commenting (users + agents).** Add a file-header comment affordance for users and, in the same change, relax `lines` to optional on the agent-comments tool input. Single coordinated change avoids file-level having a different UX for the two authors.
- **Endpoint deprecation grace.** Local server only — no external callers — so the `/api/agent/replies` removal is immediate. If future remote deployments emerge, add a sunset window.
- **`AgentComment` ↔ `AgentReply` naming.** This feature renames the web-side `AgentReply` → `AgentComment` to align with the server. The unification refactor will likely collapse both with `Reply` into a single entity name; whatever it picks will sweep the web side anyway.
- **Per-worktree cap reconciliation.** With both shapes sharing one 200-cap list, a chatty agent posting top-level comments can evict its earlier replies (and vice versa). Acceptable in v0; revisit if real workflows hit it. The unification will need to settle the cap-policy question anyway.
- **`parent-missing` UX.** When the agent receives a `parent-missing="true"` envelope entry, the recommended behavior is "respond to the reviewer's reply as-is; the parent context was evicted." Document in the MCP tool description if it becomes a real problem.
