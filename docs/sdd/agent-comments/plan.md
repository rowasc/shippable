# Implementation Plan: Agent Comments

Based on: docs/sdd/agent-comments/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Tasks

### Task 1: Rename `AgentReply` → `AgentComment` with discriminated shape
- **Files**: `server/src/agent-queue.ts`
- **Do**:
  1. Write a failing test in `agent-queue.test.ts` exercising the new shape: an `AgentComment` with `parent: { commentId, outcome }` (reply form) and an `AgentComment` with `anchor: { file, lines }` (top-level form). Use a typecheck-only assertion or a runtime construction that distinguishes both.
  2. Verify the test fails (or fails to compile against the old type).
  3. In `agent-queue.ts`, replace the `AgentReply` interface with `AgentComment` carrying `id`, `body`, `postedAt`, `agentLabel?`, plus optional `parent: { commentId: string; outcome: Outcome }` and optional `anchor: { file: string; lines: string }`. `anchor.lines` is required (file-level disallowed in v0). At least and at most one of `parent` / `anchor` must be set at the type level (use a discriminated union if helpful).
  4. Update the existing tests to use the new shape on the reply path (`parent: { commentId, outcome }` instead of flat `commentId` + `outcome`). Keep the same coverage.
  5. Verify all tests pass and typecheck is clean.
  6. Commit: `refactor(server): rename AgentReply to AgentComment with discriminated shape`
- **Verify**: vitest in `server/` passes; `npm run typecheck` in `server/` passes.
- **Depends on**: none

### Task 2: Rename `replyStore` → `agentCommentStore` + history cap
- **Files**: `server/src/agent-queue.ts`
- **Do**:
  1. Rename `replyStore: Map<string, AgentReply[]>` to `agentCommentStore: Map<string, AgentComment[]>`.
  2. Rename `REPLY_HISTORY_CAP` to `AGENT_COMMENT_HISTORY_CAP` (keep value `200`).
  3. Update `resetForTests` to clear the renamed map.
  4. Sweep internal references in the file.
  5. Run vitest and typecheck.
  6. Commit: `refactor(server): rename replyStore to agentCommentStore`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 1

### Task 3: Rename `postReply` → `postAgentComment` with discriminated payload
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Write failing tests: (a) `postAgentComment` with a reply payload (`{ parent: { commentId, outcome }, body }`) appends and returns the new id; (b) `postAgentComment` with a top-level payload (`{ anchor: { file, lines }, body }`) appends and returns the new id; (c) the cap behavior is preserved (oldest dropped on overflow); (d) re-posting under the same `parent.commentId` appends rather than overwrites.
  2. Verify tests fail.
  3. Rename `postReply` to `postAgentComment`. Update the parameter type to accept either shape via a discriminated payload. Mint `id` + `postedAt` exactly as before. Cap behavior unchanged.
  4. Verify tests pass.
  5. Commit: `feat(server): generalize postReply to postAgentComment (both shapes)`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 2

### Task 4: Rename `listReplies` → `listAgentComments`
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Rename `listReplies` to `listAgentComments`; return type is `AgentComment[]`. No behavior change.
  2. Update existing tests to use the new name; assert both reply-shaped and top-level-shaped entries are returned in order.
  3. Run vitest.
  4. Commit: `refactor(server): rename listReplies to listAgentComments`
- **Verify**: vitest passes.
- **Depends on**: Task 3

### Task 5: Add `isAgentCommentId` helper
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Write failing tests: (a) `isAgentCommentId(worktreePath, id)` returns true when an `AgentComment` with that id exists in the worktree's store; (b) returns false for an unknown id; (c) returns false for an unknown worktreePath.
  2. Verify tests fail.
  3. Implement `isAgentCommentId(worktreePath, id): boolean` — mirrors `isDeliveredCommentId` but searches `agentCommentStore`. Linear scan is fine (capped at 200).
  4. Verify tests pass.
  5. Commit: `feat(server): add isAgentCommentId helper for cross-store validation`
- **Verify**: vitest passes.
- **Depends on**: Task 4

### Task 6: Extend `CommentKind` and add `Comment.parentAgentCommentId`
- **Files**: `server/src/agent-queue.ts`
- **Do**:
  1. Add `"reply-to-agent-comment"` to the `CommentKind` union.
  2. Add an optional `parentAgentCommentId?: string` field to the `Comment` interface, with a JSDoc note that it's required when `kind === "reply-to-agent-comment"` and links the queued comment to its parent `AgentComment`.
  3. No behavior change yet — `renderComment` / endpoint validation come in Tasks 7 / 10. Just types.
  4. Run typecheck.
  5. Commit: `feat(server): extend CommentKind and Comment.parentAgentCommentId for agent-comment replies`
- **Verify**: typecheck clean.
- **Depends on**: Task 5

### Task 7: Render `<parent>` child in envelope for `reply-to-agent-comment`
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Write failing tests for `formatPayload` / `renderComment`:
     - (a) A `Comment` with `kind === "reply-to-agent-comment"` and `parentAgentCommentId` pointing at an existing `AgentComment` emits `<comment kind="reply-to-agent-comment" parent-id="…" file="…" lines="…">body<parent id="…" file="…" lines="…">parentBody</parent></comment>`. Parent body and attrs are escaped/sanitized the same way as comment bodies.
     - (b) When `parentAgentCommentId` doesn't resolve in `agentCommentStore` (e.g., capped out), the envelope emits `<comment kind="reply-to-agent-comment" parent-id="…" parent-missing="true" …>body</comment>` and omits the `<parent>` child.
     - (c) Non-`reply-to-agent-comment` kinds are unchanged.
  2. Verify tests fail.
  3. Extend `formatPayload` to accept a parent-lookup (either pass the `agentCommentStore` map slice for the worktree, or pass a callback). Extend `renderComment` to emit the `<parent>` child or the `parent-missing` attribute as described. Reuse `escapeXmlAttr` and `sanitizeBody`.
  4. Verify tests pass.
  5. Commit: `feat(server): inline parent agent comment in reviewer-feedback envelope`
- **Verify**: vitest passes.
- **Depends on**: Task 6

### Task 8: Replace `POST /api/agent/replies` with `POST /api/agent/comments`
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Write failing tests for `POST /api/agent/comments`:
     - (a) Reply-shape body (`{ worktreePath, parent: { commentId, outcome }, body }`) returns `{ id }` and `listAgentComments` includes the entry. `parent.commentId` validated via `isDeliveredCommentId`; bad id returns 400.
     - (b) Top-level body (`{ worktreePath, anchor: { file, lines }, body }`) returns `{ id }` and `listAgentComments` includes the entry. `anchor.file` empty/missing → 400. `anchor.lines` empty/missing → 400 (file-level disallowed).
     - (c) Body with both `parent` and `anchor` → 400. Body with neither → 400.
     - (d) Invalid `outcome` value → 400.
     - (e) Bad `worktreePath` (not a git dir) returns the same error shape as enqueue.
     - (f) The legacy `POST /api/agent/replies` route is gone (404).
  2. Verify tests fail.
  3. Remove the existing `POST /api/agent/replies` handler. Register `POST /api/agent/comments`. Discriminate the body shape; validate; call `postAgentComment`. Return `{ id }`.
  4. Verify tests pass.
  5. Commit: `feat(server): replace /api/agent/replies with /api/agent/comments (POST)`
- **Verify**: vitest passes.
- **Depends on**: Task 7

### Task 9: Replace `GET /api/agent/replies` with `GET /api/agent/comments`
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Write failing tests: (a) `GET /api/agent/comments?worktreePath=…` returns `{ comments: AgentComment[] }` mixing both reply-shaped and top-level entries; (b) returns `{ comments: [] }` for an unknown worktree; (c) bad `worktreePath` returns the same error shape as `delivered`; (d) the legacy `GET /api/agent/replies` route is gone (404).
  2. Verify tests fail.
  3. Remove `GET /api/agent/replies`. Register `GET /api/agent/comments` calling `listAgentComments`. Use `?worktreePath=…` (settle the predecessor's query-param follow-up).
  4. Verify tests pass.
  5. Commit: `feat(server): replace /api/agent/replies with /api/agent/comments (GET)`
- **Verify**: vitest passes.
- **Depends on**: Task 8

### Task 10: Enqueue validation for `reply-to-agent-comment` kind
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Write failing tests for `POST /api/agent/enqueue`:
     - (a) Enqueueing `{ kind: "reply-to-agent-comment", file, lines, body, parentAgentCommentId }` with a valid `parentAgentCommentId` succeeds, returns `{ id }`, and the persisted `Comment` carries the field.
     - (b) Missing `parentAgentCommentId` on that kind → 400.
     - (c) Unknown `parentAgentCommentId` (no matching `AgentComment` in the worktree's store) → 400 via `isAgentCommentId`.
     - (d) Other kinds still accept the same payloads they did before — no regressions.
  2. Verify tests fail.
  3. Add `"reply-to-agent-comment"` to `COMMENT_KINDS`. In the enqueue handler, when the kind is the new one, require `parentAgentCommentId` (non-empty string) and validate via `isAgentCommentId`. Stamp it onto the queued `Comment`.
  4. Verify tests pass.
  5. Commit: `feat(server): accept reply-to-agent-comment kind on /api/agent/enqueue`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 9

### Task 11: Rename `handlePostReviewReply` → `handlePostReviewComment` with discriminated input
- **Files**: `mcp-server/src/handler.ts`, `mcp-server/src/handler.test.ts`
- **Do**:
  1. Write failing tests:
     - (a) Reply input `{ parentId, replyText, outcome, worktreePath? }` POSTs to `/api/agent/comments` with body `{ worktreePath, parent: { commentId: parentId, outcome }, body: replyText }`, returns a success ToolResult with the assigned id.
     - (b) Top-level input `{ file, lines, replyText, worktreePath? }` POSTs with body `{ worktreePath, anchor: { file, lines }, body: replyText }`, returns success.
     - (c) Connection / non-OK HTTP errors return `isError: true` ToolResults.
     - (d) Missing `worktreePath` falls back to `cwd()` for both shapes.
     - (e) Tool result text reads sensibly for each shape (`Posted reply <id> for comment <parentId>.` vs `Posted agent comment <id> for <file>:<lines>.`).
  2. Verify tests fail.
  3. Rename `handlePostReviewReply` to `handlePostReviewComment`. Replace `PostReplyInput` with a discriminated input union. Map to the unified HTTP body shape. Reuse `resolvePort`, `resolveWorktreePath`, `errorResult`.
  4. Update any in-tree callers (likely just `mcp-server/src/index.ts`).
  5. Verify tests pass.
  6. Commit: `feat(mcp-server): broaden handlePostReviewReply to handlePostReviewComment`
- **Verify**: vitest in `mcp-server/` passes; typecheck clean.
- **Depends on**: Task 9 (relies on the new `/api/agent/comments` POST endpoint)

### Task 12: Register `shippable_post_review_comment` tool with z.union schema
- **Files**: `mcp-server/src/index.ts`
- **Do**:
  1. Remove the existing `shippable_post_review_reply` registration.
  2. Register `shippable_post_review_comment` with a z.union input schema: one branch `{ parentId: z.string(), replyText: z.string(), outcome: z.enum([...]), worktreePath: z.string().optional() }`; other branch `{ file: z.string(), lines: z.string(), replyText: z.string(), worktreePath: z.string().optional() }`. Tool description per spec § Requirements Summary §1.4.
  3. Wire to `handlePostReviewComment`.
  4. Run typecheck and the MCP server's build (`bun build` if applicable) to confirm registration shape is acceptable.
  5. Commit: `feat(mcp-server): register shippable_post_review_comment`
- **Verify**: typecheck clean; build emits the new tool name.
- **Depends on**: Task 11

### Task 13: Update mcp-server README for the new tool
- **Files**: `mcp-server/README.md`
- **Do**:
  1. Rename the documented tool, document both input shapes (reply and top-level) and the `replyText` boundary rename. Note that the wire-level field on `/api/agent/comments` is `body`.
  2. Commit: `docs(mcp-server): document shippable_post_review_comment`
- **Verify**: README renders cleanly; tool name and shapes match the registration.
- **Depends on**: Task 12

### Task 14: Rename web-side `AgentReply` → `AgentComment`; extend `CommentKind`; add `Comment.parentAgentCommentId`
- **Files**: `web/src/types.ts`
- **Do**:
  1. Rename the `AgentReply` interface in `web/src/types.ts` to `AgentComment` and update its shape to mirror the server type: `id`, `body`, `postedAt`, `agentLabel?`, plus optional `parent: { commentId: string; outcome: "addressed" | "declined" | "noted" }` and optional `anchor: { file: string; lines: string }` (at-most-one).
  2. Sweep call sites in `web/src/` (importers of the old type, fixture files, `Reply.agentReplies?: AgentReply[]` field). Migrate to `AgentComment` (or to a narrower local alias of "reply-shaped AgentComment" if it reads cleaner where `commentId` + `outcome` were flat).
  3. Add `"reply-to-agent-comment"` to the `CommentKind` union in `types.ts`.
  4. Add `parentAgentCommentId?: string` to the `Comment` interface (web mirror of the server type).
  5. Run typecheck across `web/`; fix any compile errors.
  6. Commit: `refactor(web): rename AgentReply to AgentComment and extend wire types`
- **Verify**: `npm run typecheck` and `npm run lint` in `web/` pass.
- **Depends on**: Task 6

### Task 15: Add `agentCommentReplyKey` + extend `ParsedReplyKey` / `parseReplyKey`
- **Files**: `web/src/types.ts`, `web/src/types.test.ts` (if it exists; otherwise alongside the relevant existing test)
- **Do**:
  1. Write failing tests for `parseReplyKey`:
     - (a) `parseReplyKey("agentComment:01HZ…")` returns `{ kind: "agentComment", agentCommentId: "01HZ…" }`.
     - (b) `parseReplyKey("agentComment:")` (empty id) returns `null`.
     - (c) `parseReplyKey("agentComment:foo:bar")` returns `{ kind: "agentComment", agentCommentId: "foo:bar" }` (no `:` parsing past the prefix; UUIDs don't contain `:`, but tolerate exotic ids).
     - (d) Existing kinds still parse as before.
  2. Verify tests fail.
  3. Add helper `agentCommentReplyKey(id: string): string` returning `"agentComment:" + id`. Extend `ParsedReplyKey` with `{ kind: "agentComment"; agentCommentId: string }`. Extend `parseReplyKey` to recognize the new prefix.
  4. Verify tests pass.
  5. Commit: `feat(web): add agentComment reply-key prefix and parser case`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 14

### Task 16: Update `agentCommentPayload.ts` for the new prefix
- **Files**: `web/src/agentCommentPayload.ts`, `web/src/agentCommentPayload.test.ts` (if present)
- **Do**:
  1. Write failing tests: for a parsed `{ kind: "agentComment", agentCommentId }` and a state slot containing the corresponding `AgentComment`, `deriveCommentPayload` returns `{ kind: "reply-to-agent-comment", file, lines, parentAgentCommentId: agentCommentId }`. For a parsed `agentComment` whose id has no matching state entry, returns `null`.
  2. Verify tests fail.
  3. Extend `deriveCommentPayload` (and its surrounding `DerivedCommentPayload` type if needed) to accept the slot of `state.agentComments` (or a lookup callback). Add the new case.
  4. Verify tests pass.
  5. Commit: `feat(web): map agentComment reply key to reply-to-agent-comment payload`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 15

### Task 17: Rename `fetchAgentReplies` → `fetchAgentComments`; extend `enqueueComment`
- **Files**: `web/src/agentContextClient.ts`
- **Do**:
  1. Rename `fetchAgentReplies` to `fetchAgentComments`. Update path to `/api/agent/comments`. Update return type to `{ comments: AgentComment[] }`.
  2. Extend the `enqueueComment` payload type to accept `parentAgentCommentId?: string` (only meaningful with `kind === "reply-to-agent-comment"`).
  3. Sweep call sites in `web/src/` (state.ts polling, ReviewWorkspace, etc.).
  4. Run typecheck.
  5. Commit: `refactor(web): rename fetchAgentReplies and extend enqueueComment for new kind`
- **Verify**: typecheck clean.
- **Depends on**: Task 16

### Task 18: Add `state.agentComments` slot + `mergeAgentComments` reducer
- **Files**: `web/src/state.ts`, `web/src/state.test.ts`
- **Do**:
  1. Write failing tests for `mergeAgentComments`:
     - (a) Merging a fresh polled batch of top-level-shaped `AgentComment`s into an empty `state.agentComments` produces an array sorted by `postedAt` ascending.
     - (b) Merging the same batch twice is a structural no-op — `Object.is` on the slot returns true. Mirrors the existing `mergeAgentReplies` invariant.
     - (c) Late-arriving entries append in `postedAt` order; existing ids update in place when `body` changes.
     - (d) Reply-shaped entries (with `parent`) are ignored by `mergeAgentComments` — the reducer only handles `anchor`-set entries.
  2. Verify tests fail.
  3. Add `agentComments: AgentComment[]` to `ReviewState` (default `[]` in `initialState`). Add `mergeAgentComments` reducer mirroring `mergeAgentReplies`. Wire a new action type.
  4. Verify tests pass.
  5. Commit: `feat(web): add agentComments state slot and merge reducer`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 14

### Task 19: Polling split by discriminator
- **Files**: `web/src/state.ts`, `web/src/state.test.ts`
- **Do**:
  1. Write failing tests for the polling reducer / hook:
     - (a) Given a `GET /api/agent/comments` response mixing both shapes, the reducer dispatches reply-shaped entries to `mergeAgentReplies` (translated to the existing `PolledAgentReply` shape via `parent.commentId` + `parent.outcome`) and anchor-shaped entries to `mergeAgentComments`.
     - (b) `Promise.allSettled` independence is preserved: if `fetchAgentComments` fails, `delivered` still updates and `error: true` flips on the agent side.
     - (c) Re-poll of the same batch is structurally stable for both slots.
  2. Verify tests fail.
  3. Update `useDeliveredPolling` (or wherever the loop lives) to call `fetchAgentComments` and split the response client-side. Translate `parent`-set entries to the existing `PolledAgentReply` shape so the existing `mergeAgentReplies` reducer keeps working unchanged. Dispatch `anchor`-set entries to `mergeAgentComments`. Return both `agentReplies` and `agentComments` to consumers.
  4. Update the single in-tree caller (likely `ReviewWorkspace.tsx`) for the new return shape.
  5. Verify tests pass.
  6. Commit: `feat(web): poll /api/agent/comments and split by discriminator`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 17, Task 18

### Task 20: Persist `v: 3` migration; whitelist `agentComment:` prefix
- **Files**: `web/src/persist.ts`, `web/src/persist.test.ts`
- **Do**:
  1. Write failing tests:
     - (a) `migrations[3]` lifts a `v: 2` snapshot to `v: 3` by adding an empty `agentComments: []` slot. Existing fields are preserved.
     - (b) `buildSnapshot` includes `state.agentComments`. Round-trip preserves the slot.
     - (c) `replyKeyTargetsValidHunk` returns `true` for `agentComment:<uuid>` keys (no hunk-id involvement). `filterRepliesByHunk` keeps those entries on rehydrate.
     - (d) `loadSession` rehydrates `agentComments` from the snapshot into the returned state.
  2. Verify tests fail.
  3. Bump `CURRENT_VERSION = 3`. Add `migrations[3]`. Extend `PersistedSnapshot` with `agentComments: AgentComment[]`. Update `buildSnapshot` / `loadSession` / `HydratedSession` / `isPersistedSnapshot` to include the new slot. Update `replyKeyTargetsValidHunk` to special-case the `agentComment:` prefix as always-valid (the live poll reconciles the id).
  4. Verify tests pass.
  5. Commit: `feat(web): persist v3 with agentComments slot and agentComment reply-key prefix`
- **Verify**: vitest passes; typecheck clean.
- **Depends on**: Task 18

### Task 21: ReplyThread identity treatment for `agentComment:` parent key
- **Files**: `web/src/components/ReplyThread.tsx`, `web/src/components/ReplyThread.test.tsx`
- **Do**:
  1. Write failing tests:
     - (a) Rendering a `ReplyThread` with a `parentKey` starting with `agentComment:` shows the agent root-identity (agent label + `file:lines` anchor) above the thread.
     - (b) Composer interaction (open / submit) behaves identically to other reply kinds — submit triggers `onSubmitReply`.
     - (c) Agent replies nested under a reviewer Reply (`AgentRepliesList`) still render unchanged.
  2. Verify tests fail.
  3. Extend `ReplyThread.tsx` with the new identity treatment. Pass the necessary context (the parent agent comment from `state.agentComments`) via props or a small lookup. Reuse the existing reply-bubble visual primitive — no new visual component.
  4. Verify tests pass.
  5. Commit: `feat(web): identity treatment for agent-comment-rooted threads in ReplyThread`
- **Verify**: vitest passes; lint clean.
- **Depends on**: Task 20

### Task 22: Render new root kind in AgentContextSection
- **Files**: `web/src/components/AgentContextSection.tsx`, `web/src/components/AgentContextSection.test.tsx` (if present; else a new test file)
- **Do**:
  1. Write failing tests:
     - (a) Given `state.agentComments` containing two top-level entries, the panel renders both as root entries, sorted by `postedAt` ascending.
     - (b) Each agent-comment root mounts a `ReplyThread` keyed by `agentCommentReplyKey(id)` and threads replies through the normal submit path (which enqueues with `kind: "reply-to-agent-comment"`).
     - (c) No new chip / magic phrase is introduced.
  2. Verify tests fail.
  3. Iterate `state.agentComments` in the panel render. Emit one root entry per `AgentComment` with the file:lines anchor, the agent identity, and a `ReplyThread` underneath. Sort by `postedAt`.
  4. Verify tests pass.
  5. Commit: `feat(web): render top-level agent comments as roots in AgentContextSection`
- **Verify**: vitest passes; lint clean.
- **Depends on**: Task 21

### Task 23: Update concept / plan / feature docs
- **Files**: `docs/concepts/agent-context.md`, `docs/plans/share-review-comments.md`, `docs/features/agent-context-panel.md`
- **Do**:
  1. `agent-context.md` — extend § Two-way with the new top-level path; clarify that "agent comment" now means either flavor; note the new reply-key prefix and the `reply-to-agent-comment` kind.
  2. `share-review-comments.md` — record the endpoint rename (`/api/agent/replies` → `/api/agent/comments`) and the new envelope `<parent>` child / `parent-missing` attribute.
  3. `agent-context-panel.md` — describe the new root kind, the agent-initiated pre-review flow (no UI changes), and the file-level deferral.
  4. Commit: `docs: agent comments back-channel and endpoint rename`
- **Verify**: docs render; cross-links are valid.
- **Depends on**: Task 22

### Task 24: Full-stack check + manual smoke
- **Files**: none (verification only)
- **Do**:
  1. Run in order: `npm run typecheck` and `npm run test` in `server/`; `npm run build` and `npm run test` (vitest) in `mcp-server/`; `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` in `web/`. Fix anything that surfaces.
  2. If feasible, manual browser smoke: start `server/` and `web/`; install the MCP into a chat harness; have the agent post a top-level comment via the new tool; observe the new root in the panel; reply through the composer; observe the agent's response threaded under the reviewer Reply. Confirm pip flow (`◌ queued` → `✓ delivered`) on the reviewer reply.
  3. If a sandboxed environment makes the manual smoke infeasible, record that in `implementation-notes.md` under "Deviations from Plan" (mirroring the predecessor's Task 22 note).
  4. Commit: `chore(agent-comments): verify build / lint / tests across all packages`
- **Verify**: all suites green; manual smoke confirms the end-to-end loop (or the deferral is documented).
- **Depends on**: Task 23
