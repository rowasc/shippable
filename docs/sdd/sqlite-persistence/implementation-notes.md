# Implementation Notes — SQLite Persistence

Implementation matched the spec on the substantive design decisions (server-owned `interactions` table, runtime-dispatched `node:sqlite` / `bun:sqlite` adapter, client-authoritative ids, per-mutation sync, per-changeset fetch, DB-only with hard-fail boot gate). The deviations and discoveries below are recorded for future readers.

## Deviations from spec

### Web tasks decomposition restructured mid-implementation
- **Spec said**: 10 web tasks numbered 11–20 (with 11/13/14/15/16/17/18/19/20 covering different web slivers independently).
- **Implementation does**: 11, 15, 16, 18 merged into a single coherent task ("Task 11★"). 13, 14, 17, 19, 20 stayed independent.
- **Reason**: `enqueuedCommentId` and the live enqueue orchestration are woven across `state.ts`, `ReplyThread.tsx`, `ReviewWorkspace.tsx`, and `useDeliveredPolling.ts`. They cannot be edited in isolation without leaving the web build red between tasks. The merge keeps each step build-green.
- **Impact**: One bigger task instead of four small ones; same total scope.

### `agentQueueStatus` added to the web `Interaction` type
- **Spec said**: `interactionClient.fetchInteractions` drops `agentQueueStatus` as a storage-only column; `Interaction` retains `enqueueError` only.
- **Implementation does**: `interactionClient` *preserves* `agentQueueStatus`; the web `Interaction` type gains `agentQueueStatus?: "pending" | "delivered" | null`.
- **Reason**: The pip in `ReplyThread.tsx` needs a signal for "this interaction is enqueued but not yet delivered" (formerly carried by `enqueuedCommentId != null`). Without `agentQueueStatus`, the pip can't render "◌ queued" between submit and the next delivered-poll cycle.
- **Impact**: Pip precedence: `agentQueueStatus === "delivered"` OR `deliveredById[ix.id]` → ✓ delivered; `agentQueueStatus === "pending"` → ◌ queued; `enqueueError` → ⚠ retry.

### Boundary shifts between Tasks 8/9/10
- **Spec said**: Task 8 = `/api/interactions` handlers only. Task 9 = agent-queue rewrite only. Task 10 = mount routes + remove agent enqueue routes + `initDb()` in `main()` + `/api/health` `db` field.
- **Implementation does**: Task 8 also wired the routes into `createApp()` (needed for its integration test). Task 9 absorbed removal of `/api/agent/enqueue`+`/unenqueue` routes/handlers and `initDb()` in `main()` (otherwise its rewrite would break `index.test.ts`). Task 10 became just the `/api/health` `db` field addition.
- **Reason**: Keeping each task's suite green required these adjustments. The plan's decomposition didn't anticipate the cross-task dependencies.

### Per-changeset fetch does not run an anchor-resolution pass
- **Spec said**: Interactions whose anchor fails to resolve against the current changeset on load go into the derived `detachedInteractions` bucket.
- **Implementation does**: `App.tsx`'s per-changeset fetch merges fetched interactions via `LOAD_CHANGESET` without an anchor pass. The `RELOAD_CHANGESET` path (live worktree reload) still computes `detachedInteractions` for ingest-derived interactions.
- **Reason**: For the per-changeset fetch path, the stored `threadKey` is client-generated and stable while the diff content isn't changing; the gap is real only when a changeset loads against a different diff than the one its interactions were authored against (e.g. close app → worktree changes on disk → reopen). Reviewed and accepted as a known simplification for the prototype.

## Discoveries during implementation

### StrictMode race in the App.tsx per-changeset fetch effect (real product bug)
The first cut of `App.tsx`'s fetch effect kept `state.changesets` in its dependency array. Every reducer dispatch (including the debounced save's state churn) produced a fresh `state.changesets` reference, re-running the effect — and under React 19 StrictMode dev, the mount→cleanup→remount cycle would silently drop the first fetch's result (`cancelled = true` set during cleanup, "started" guard then blocking the retry). Surfaced by running the e2e suite. Fixed by reading `state.changesets` via a ref and switching the guard from "started" to "applied" (allowing a cancelled-then-retried fetch to land). Caught only because we ran e2e — both the Task 11★ spec review and code-quality review missed it.

### Server `body` validation was over-tight for ack/unack
A code-review fix during Task 8 tightened `/api/interactions`'s upsert handler to reject empty `body`. Acks and unacks legitimately have empty bodies, so this silently broke them post-Task 11★. Surfaced by the e2e suite. Fixed by making the empty-body check intent-aware: only `ack`/`unack` bypass the empty-body requirement.

### `agentCommentPayload.ts` orphaned by Task 11★
`agentContextClient.ts` removed `enqueueComment`/`unenqueueComment` (they targeted the deleted `/api/agent/enqueue` route). The payload-builder module `agentCommentPayload.ts` was its only consumer. Deleted along with its test (per AGENTS.md "no dead code").

## Environment quirks worth noting for future work

- **Intermittent `git` dubious-ownership errors** in this devcontainer (the working tree is a bind-mounted git worktree). Symptom: `fatal: detected dubious ownership in repository at '/workspace'` firing randomly on git sub-invocations. Workaround: prefix git commands with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/workspace` (per-invocation env-var config injection that propagates to child git processes).
- **Stray dev-server processes from subagents.** A subagent started a `vite` dev server for curl-testing and didn't kill it. The leftover watcher raced concurrent `git rebase` checkouts in the worktree, causing "local changes would be overwritten by merge" errors at non-deterministic rebase steps. Lesson: subagents that start long-running processes should kill them on completion.

## Test coverage outcomes

- Server: 410 tests passing.
- Web (vitest): 545 tests passing.
- Web (e2e, Playwright): 51/51 passing; e2e server uses `SHIPPABLE_DB_PATH=:memory:` for full DB isolation.
- Bun sidecar build (`bun build --compile`): succeeds.

## Out-of-scope follow-ups noted but not addressed

- Fetch errors in `App.tsx`'s per-changeset fetch don't auto-retry (the `appliedCsIds` guard only allows retry on `activeCsId` change). Acceptable for the prototype; flag for hardening if server-restart resilience matters.
- `docs/plans/typed-review-interactions.md` and `docs/plans/share-review-comments.md` are design-history artifacts that still reference the old `enqueuedCommentId` / `isPersistable` / `/api/agent/enqueue` model. Left as-is — they describe the architecture as it was when they were written.
- A real browser pass on the agent-flow Demo frames and a live worktree review is still recommended before the branch merges (e2e + integration tests cover the contract, but pip rendering in the UI was not click-tested in the sandbox).
