# Implementation Plan: Agent Reply Support

Based on: docs/sdd/agent-reply-support/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Tasks

### ✅ Task 1: Add `AgentReply` type and `Outcome` union to server queue module
- **Files**: `server/src/agent-queue.ts`
- **Do**:
  1. Add `Outcome` union: `'addressed' | 'declined' | 'noted'`.
  2. Add `AgentReply` interface: `{ id: string; commentId: string; body: string; outcome: Outcome; postedAt: string; agentLabel?: string }`.
  3. No behavior yet — just exported types.
  4. Run `npm run typecheck` in `server/` to confirm types compile.
  5. Commit: `feat(server): add AgentReply type and Outcome union`
- **Verify**: types compile, no test changes required.
- **Depends on**: none

### ✅ Task 2: Add reply store + `postReply` / `listReplies` with tests
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Write failing tests in `agent-queue.test.ts`: (a) `postReply` appends to the worktree's reply list and returns the assigned id; (b) repeated `postReply` to the same `commentId` appends rather than overwrites; (c) `listReplies` returns entries sorted by `postedAt` ascending; (d) `listReplies` for an unknown worktree returns `[]`; (e) `resetForTests` clears replies.
  2. Verify the tests fail.
  3. Add a second `Map<string, AgentReply[]>` next to the existing queue map. Implement `postReply(worktreePath, payload)` (assigns `randomUUID` + `new Date().toISOString()`) and `listReplies(worktreePath)`. Wire into `resetForTests`.
  4. Verify tests pass.
  5. Commit: `feat(server): add reply store with postReply and listReplies`
- **Verify**: vitest passes; existing queue tests still pass.
- **Depends on**: Task 1

### ✅ Task 3: Remove `freeform` `CommentKind` and simplify queue
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Delete `'freeform'` from the `CommentKind` union.
  2. Simplify `sortForPayload` — drop the `aFree`/`bFree` branch; all kinds now have a `file`. Update `renderComment` to remove the freeform-conditional attribute branch.
  3. In `agent-queue.test.ts`, drop any freeform fixtures and any tests that exercise the freeform sort/render path.
  4. Run vitest; fix anything that compiled against the freeform kind.
  5. Commit: `refactor(server): drop freeform CommentKind`
- **Verify**: vitest passes; `npm run typecheck` passes in `server/`.
- **Depends on**: Task 2

### ✅ Task 4: Add `POST /api/agent/replies` endpoint with tests
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Write failing tests in `index.test.ts`: (a) happy-path `POST /api/agent/replies` with `{ worktreePath, commentId, body, outcome }` returns `{ id }` and persists via `listReplies`; (b) invalid `outcome` returns 400; (c) missing `worktreePath` returns 400 (or whichever shape `assertGitDir` already imposes — match the existing `enqueue` endpoint's behavior); (d) bad `worktreePath` (not a git dir) returns the same error shape as enqueue.
  2. Verify tests fail.
  3. Register `POST /api/agent/replies`. Validate body with the same idiom as `POST /api/agent/enqueue`. Call `postReply`. Return `{ id }`.
  4. Verify tests pass.
  5. Commit: `feat(server): add POST /api/agent/replies endpoint`
- **Verify**: vitest passes; existing endpoint tests still pass.
- **Depends on**: Task 3

### ✅ Task 5: Add `GET /api/agent/replies` endpoint with tests
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Write failing tests: (a) `GET /api/agent/replies?worktreePath=...` returns `{ replies: AgentReply[] }` for a worktree with replies; (b) returns `{ replies: [] }` for an unknown worktree; (c) bad `worktreePath` returns the same error shape as the `delivered` endpoint.
  2. Verify tests fail.
  3. Register the GET endpoint mirroring the `GET /api/agent/delivered` shape. Call `listReplies`.
  4. Verify tests pass.
  5. Commit: `feat(server): add GET /api/agent/replies endpoint`
- **Verify**: vitest passes.
- **Depends on**: Task 4

### ✅ Task 6: Drop freeform-specific handling in server endpoints
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Search `server/src/index.ts` for any references to the freeform comment kind in request validation, payload formatting, or fixtures. Remove them.
  2. Drop any test cases in `index.test.ts` that send a freeform comment.
  3. Run vitest + typecheck.
  4. Commit: `refactor(server): drop freeform comment handling in endpoints`
- **Verify**: vitest passes, typecheck passes.
- **Depends on**: Task 5

### ✅ Task 7: Add `handlePostReviewReply` to MCP server with tests
- **Files**: `mcp-server/src/handler.ts`, `mcp-server/src/handler.test.ts`
- **Do**:
  1. Write failing tests: (a) happy-path: handler POSTs to `/api/agent/replies` with the input `{ commentId, body, outcome, worktreePath }`, returns a success `ToolResult` containing the assigned id; (b) connection error returns an `isError: true` ToolResult with a clear message; (c) non-OK HTTP response returns `isError: true`; (d) missing `worktreePath` falls back to `cwd()`.
  2. Verify tests fail.
  3. Implement `handlePostReviewReply(input, deps)` mirroring `handleCheckReviewComments`'s shape — same `resolvePort`, `resolveWorktreePath`, fetch + error handling.
  4. Verify tests pass.
  5. Commit: `feat(mcp-server): add handlePostReviewReply`
- **Verify**: vitest passes in `mcp-server/`.
- **Depends on**: Task 5

### ✅ Task 8: Register `shippable_post_review_reply` MCP tool
- **Files**: `mcp-server/src/index.ts`
- **Do**:
  1. Register the new tool next to the existing `shippable_check_review_comments`. Input schema: `{ commentId: string, body: string, outcome: enum('addressed', 'declined', 'noted'), worktreePath?: string }`.
  2. Tool description: tuned for the implicit-trigger flow. Suggested wording: `"Post a structured reply to a Shippable reviewer comment after addressing it. Call this tool once per comment in the most recent shippable batch — addressed (you fixed it), declined (you intentionally won't), or noted (you saw it but no action). Also call when the user asks you to 'report back to shippable' or similar."`
  3. Build `mcp-server/`: `npm run build`. Confirm `dist/index.js` includes the new tool registration.
  4. Commit: `feat(mcp-server): register shippable_post_review_reply tool`
- **Verify**: `npm run build` and `npm run typecheck` both pass in `mcp-server/`.
- **Depends on**: Task 7

### ✅ Task 9: Update `mcp-server/README.md`
- **Files**: `mcp-server/README.md`
- **Do**:
  1. Add a section documenting `shippable_post_review_reply`: input shape, the three outcome values, when the agent should call it.
  2. Update the magic-phrase section: now two phrases — `check shippable` (existing) and `report back to shippable` (new fallback for the reply flow).
  3. Commit: `docs(mcp-server): document shippable_post_review_reply`
- **Verify**: README renders correctly.
- **Depends on**: Task 8

### ✅ Task 10: Add `AgentReply` interface and `agentReplies` field to `Reply`
- **Files**: `web/src/types.ts`
- **Do**:
  1. Add `AgentReply` interface (mirror of the server shape, sans `commentId` since the parent `Reply.enqueuedCommentId` already carries that link): `{ id: string; body: string; outcome: 'addressed' | 'declined' | 'noted'; postedAt: string; agentLabel?: string }`.
  2. Add `agentReplies: AgentReply[]` to the existing `Reply` interface (non-optional; defaults to `[]`).
  3. Run `npm run typecheck` in `web/`. Existing call sites that construct `Reply` will fail to compile until they default `agentReplies: []`.
  4. Update fixture/test/factory call sites to include `agentReplies: []`. (The persist-rehydrate migration in Task 11 handles legacy localStorage state — but in-memory constructors need updating now.)
  5. Run `npm run build` in `web/` to confirm.
  6. Commit: `feat(web): add AgentReply type and Reply.agentReplies field`
- **Verify**: typecheck passes; build passes.
- **Depends on**: Task 1

### ✅ Task 11: Add persist-rehydrate migration for `agentReplies`
- **Files**: persist module under `web/src/` (likely `state.ts` or `persist.ts` — locate via existing `enqueuedCommentId` migration)
- **Do**:
  1. Locate the existing `Reply` migration logic (the `enqueuedCommentId` JSDoc at `web/src/types.ts:139-145` references a persist-layer migration for replies that pre-date the queue).
  2. Write a failing test: rehydrate a `ReviewState` whose persisted replies lack `agentReplies`; verify the resulting `Reply` objects have `agentReplies: []`.
  3. Verify the test fails.
  4. Extend the migration to default `agentReplies` to `[]` when absent.
  5. Verify the test passes.
  6. Commit: `feat(web): default agentReplies to [] in persist migration`
- **Verify**: vitest passes; existing persist tests still pass.
- **Depends on**: Task 10

### ✅ Task 12: Add `mergeAgentReplies` reducer with tests
- **Files**: `web/src/state.ts` (or wherever `ReviewState` reducers live; same module that owns the existing `delivered` merge), corresponding test file
- **Do**:
  1. Write failing tests for `mergeAgentReplies(state, polled)`: (a) for a polled `(commentId, AgentReply[])` group, find the Reply in `replies[*]` whose `enqueuedCommentId === commentId` and reconcile its `agentReplies` array — existing ids update in place, new ids append; (b) entries are sorted by `postedAt` ascending after the merge; (c) no-op when no Reply matches the `commentId`; (d) repeated polls of the same data are idempotent (state shape unchanged after the second merge).
  2. Verify tests fail.
  3. Implement `mergeAgentReplies`. Walk all `replies[*]` arrays, build a lookup by `enqueuedCommentId`, apply the reconciliation per group.
  4. Verify tests pass.
  5. Commit: `feat(web): add mergeAgentReplies reducer`
- **Verify**: vitest passes.
- **Depends on**: Task 11

### ✅ Task 13: Replace polling-active predicate with `panelMounted && tabVisible`
- **Files**: `web/src/state.ts` (or wherever the existing `delivered` polling loop lives), corresponding test file
- **Do**:
  1. Locate the current polling loop and its active predicate (which checks for queued/delivered pip state).
  2. Write failing tests for the new predicate: polling runs when both `panelMounted && tabVisible`; pauses when either is false; resumes with one immediate catch-up poll when transitioning hidden→visible.
  3. Verify tests fail.
  4. Replace the predicate. Drop any per-comment outstanding/timeout logic. Add a `document.visibilityState` listener (or use the existing visibility hook if one already exists in the codebase).
  5. Verify tests pass.
  6. Commit: `refactor(web): simplify polling predicate to panel+visibility`
- **Verify**: vitest passes; existing polling tests still pass (or are updated alongside).
- **Depends on**: Task 12

### ✅ Task 14: Add `fetchAgentReplies` to the poll loop
- **Files**: `web/src/state.ts` (or wherever `fetchDelivered` lives)
- **Do**:
  1. Add `fetchAgentReplies(worktreePath)` calling `GET /api/agent/replies?worktreePath=...`. Returns the parsed array of agent replies grouped by `commentId`.
  2. In the poll-tick handler, call both `fetchDelivered` and `fetchAgentReplies` (in parallel via `Promise.all`). Dispatch `mergeAgentReplies` with the result.
  3. Write a test that simulates a polled response containing one agent reply for a known `commentId`; verify it appears on the matching Reply via `mergeAgentReplies`.
  4. Commit: `feat(web): fetch and merge agent replies in poll loop`
- **Verify**: vitest passes; the polled reply appears in state.
- **Depends on**: Task 13

### ✅ Task 15: Remove free-form composer from `AgentContextSection`
- **Files**: `web/src/components/AgentContextSection.tsx`, any related test/fixture file
- **Do**:
  1. Locate the free-form composer JSX, its draft-persistence hook(s), submit handler, and any related state.
  2. Delete them. Remove imports that become unused.
  3. Drop any tests that exercised the freeform path.
  4. Run `npm run lint` and `npm run typecheck` in `web/`. Fix unused-import / unused-state warnings introduced by the deletion.
  5. Commit: `refactor(web): remove free-form composer from AgentContextSection`
- **Verify**: lint + typecheck + build all clean.
- **Depends on**: Task 14

### ✅ Task 16: Surface install affordance + both magic phrases
- **Files**: `web/src/components/AgentContextSection.tsx`
- **Do**:
  1. Verify the existing install affordance still renders correctly (untouched by the freeform removal).
  2. Add a second magic-phrase chip: `report back to shippable`, with copy-to-clipboard (mirroring the existing `check shippable` chip). Adjust labels to clarify which phrase triggers what (one for fetching, one for reporting back).
  3. Snapshot or render-test the section to confirm both chips appear.
  4. Commit: `feat(web): surface "report back to shippable" magic phrase`
- **Verify**: panel renders with both chips; copy-to-clipboard works (manual smoke OK).
- **Depends on**: Task 15

### ✅ Task 17: Render `agentReplies` in `ReplyThread`
- **Files**: `web/src/components/ReplyThread.tsx`, corresponding test/snapshot file
- **Do**:
  1. Write a failing rendering test: a Reply with one `AgentReply` of each `outcome` value renders three nested child blocks below the parent Reply, each with the corresponding outcome icon, the body text, the timestamp, and the generic "agent" label.
  2. Verify the test fails.
  3. Add the render branch: iterate `reply.agentReplies` after the existing Reply markup; for each, render a child block. Stack in `postedAt` order (already sorted by Task 12, but defensive sort here is fine).
  4. Verify the test passes.
  5. Commit: `feat(web): render agentReplies under parent Reply`
- **Verify**: vitest passes.
- **Depends on**: Task 14

### ✅ Task 18: Apply visual treatment to nested agent replies
- **Files**: `web/src/components/ReplyThread.tsx`, the relevant CSS/theme file (locate via existing reply styling)
- **Do**:
  1. Add styling for the nested agent-reply block: indent (matches existing nested-content indent in the codebase if there is one), subtle background tint, identity chip with "agent" label, outcome icons (✅ addressed / ⊘ declined / ℹ︎ noted — or whatever fits the existing icon set; check `web/src/` for an existing icon component).
  2. Smoke-test in the browser: open `/`, ensure rendered nested replies look distinct from human replies and clearly anchored to their parent.
  3. Commit: `feat(web): style nested agent replies in ReplyThread`
- **Verify**: build + lint clean; visual smoke looks right.
- **Depends on**: Task 17

### ✅ Task 19: Update `docs/concepts/agent-context.md`
- **Files**: `docs/concepts/agent-context.md`
- **Do**:
  1. Rewrite § Two-way (or whichever section currently describes the pull channel) to cover the new back-channel: agent → reviewer via `shippable_post_review_reply`, structured with `outcome`, threaded under the matching reviewer Reply.
  2. Note the freeform removal: the kind no longer exists.
  3. Cross-link this spec.
  4. Commit: `docs(concepts): document agent reply back-channel`
- **Verify**: docs render; cross-links resolve.
- **Depends on**: Task 18

### ✅ Task 20: Update `docs/plans/share-review-comments.md`
- **Files**: `docs/plans/share-review-comments.md`
- **Do**:
  1. Update the slice list, behavior section, and state section to reflect the freeform removal (composer gone, `freeform` `CommentKind` gone).
  2. Cross-link this spec under the back-channel discussion.
  3. Move "Agent-reply detection" out of the Follow-ups section if this work supersedes it; otherwise note that the post-by-tool flow is what landed.
  4. Commit: `docs(plans): reflect freeform removal and link reply spec`
- **Verify**: docs render; cross-links resolve.
- **Depends on**: Task 19

### ✅ Task 21: Update `docs/features/agent-context-panel.md`
- **Files**: `docs/features/agent-context-panel.md`
- **Do**:
  1. Update the install/onboarding section: surface both magic phrases (`check shippable`, `report back to shippable`).
  2. Remove any reference to the free-form composer in the panel description.
  3. Commit: `docs(features): document two magic phrases in agent-context-panel`
- **Verify**: docs render.
- **Depends on**: Task 20

### ✅ Task 22: End-to-end verification
- **Files**: none — verification only
- **Do**:
  1. Run `npm run build`, `npm run lint`, `npm run test` in `web/`.
  2. Run `npm run typecheck` and `npm run test` in `server/`.
  3. Run `npm run typecheck`, `npm run build`, and `npm run test` in `mcp-server/`.
  4. Manual smoke (browser):
     - Start `server/` and `web/`. Open the app.
     - Load a worktree with a diff (or use a fixture path that the agent-context panel accepts).
     - Author a thread comment; verify it enqueues (◌ pip).
     - Confirm the free-form composer is gone.
     - Run `claude mcp add shippable -- node <abs-path-to>/mcp-server/dist/index.js` in a fresh Claude Code session pointed at the worktree.
     - Type `check shippable`. Verify the agent fetches the comment (✓ pip flips).
     - Have the agent post a reply via the new tool (or invoke the tool manually if needed). Verify it appears nested under the original comment in the panel.
     - Have the agent post a *second* reply to the same comment. Verify both appear stacked in `postedAt` order.
  5. Note any deviations from the spec for follow-up.
- **Verify**: all checks pass; manual smoke confirms end-to-end flow.
- **Depends on**: Task 21
