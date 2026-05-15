# Implementation Plan: SQLite Persistence

Based on: docs/sdd/sqlite-persistence/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Re-implement clean on `sqlite-persistence-take-2`. Do not port the take-1
`sqlite-persistence` branch; its `adapter.ts` and `schema.ts` are useful
*reference* only. `MemoryModeBanner` and `interactionStore.ts` from take-1 do
not exist on this branch — nothing to delete.

Quality gates (per `AGENTS.md`): `npm run build` + `npm run lint` + `npm run
test` in `web/`; `npm run typecheck` in `server/`; relevant `npm run test` in
`server/`. Server/web tests must be DB-isolated via `SHIPPABLE_DB_PATH`.

## Tasks

### Task 1: Extract shared app-data-dir helper
- **Files**: `server/src/app-data-dir.ts`, `server/src/app-data-dir.test.ts`, `server/src/port-file.ts`, `server/src/port-file.test.ts`
- **Do**:
  1. Write a failing test for `appDataDir(env)`: returns the per-platform `Shippable/` directory (macOS `Library/Application Support`, Linux `$XDG_DATA_HOME` then `~/.local/share`, Windows `%LOCALAPPDATA%`), `null` when no home is resolvable.
  2. Verify the test fails.
  3. Implement `app-data-dir.ts` by lifting the platform `switch` out of `port-file.ts`.
  4. Refactor `portFilePath()` to call `appDataDir()` and append `port.json`; keep `port-file.test.ts` green.
  5. Verify all tests pass.
  6. Commit: `refactor(server): extract shared app-data-dir helper`
- **Verify**: `app-data-dir.test.ts` + `port-file.test.ts` pass; `npm run typecheck` clean.
- **Depends on**: none

### Task 2: Runtime-dispatched SQLite adapter
- **Files**: `server/src/db/adapter.ts`, `server/src/db/adapter.test.ts`
- **Do**:
  1. Write failing tests against an `openDb(":memory:")` handle: `exec` + `prepare`/`run`/`get`/`all` round-trip a row; `transaction` commits on success and rolls back on throw.
  2. Verify the tests fail.
  3. Implement `adapter.ts`: detect Bun vs Node, `require("bun:sqlite")` / `require("node:sqlite")`, normalise both behind a synchronous `SqliteDb` interface (`exec`, `prepare`, `transaction`, `close`). `transaction` uses explicit `BEGIN`/`COMMIT`/`ROLLBACK`.
  4. Verify the tests pass.
  5. Commit: `feat(server): add runtime-dispatched SQLite adapter`
- **Verify**: `adapter.test.ts` passes under Node; `bun build --compile` of the sidecar still succeeds.
- **Depends on**: none

### Task 3: Schema + forward migration runner
- **Files**: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`
- **Do**:
  1. Write failing tests: `runMigrations` on a fresh `:memory:` db creates the `interactions` table (columns per spec) + `schema_meta` at `SCHEMA_HEAD`; a second run is idempotent; `getSchemaVersion` reports correctly.
  2. Verify the tests fail.
  3. Implement `schema.ts`: `SCHEMA_HEAD = 1`, ordered `MIGRATIONS[]` (v0→v1 = the `interactions` table + indexes on `(changeset_id)` and `(worktree_path, agent_queue_status)`), `runMigrations` applying each step in its own transaction, `getSchemaVersion`.
  4. Verify the tests pass.
  5. Commit: `feat(server): add interactions schema + migration runner`
- **Verify**: `schema.test.ts` passes.
- **Depends on**: Task 2

### Task 4: DB location resolution
- **Files**: `server/src/db/location.ts`, `server/src/db/location.test.ts`
- **Do**:
  1. Write failing tests: `SHIPPABLE_DB_PATH` (absolute path or `:memory:`) wins over everything; otherwise resolves to `<appDataDir>/shippable.db`; an unresolvable/unwritable location is signalled as a failure (a thrown error or an error result) — **no `:memory:` fallback**.
  2. Verify the tests fail.
  3. Implement `location.ts` using `appDataDir()` from Task 1; `:memory:` is reachable only via the explicit env override.
  4. Verify the tests pass.
  5. Commit: `feat(server): resolve DB location with SHIPPABLE_DB_PATH override`
- **Verify**: `location.test.ts` passes.
- **Depends on**: Task 1

### Task 5: DB index — boot open/migrate + status
- **Files**: `server/src/db/index.ts`, `server/src/db/index.test.ts`
- **Do**:
  1. Write failing tests: a successful open exposes `getDb()` and `getDbStatus()` returning `{ status: "ok" }`; a failed open (e.g. forced bad path) returns `{ status: "error", error: <message> }` and does **not** throw out of the init function.
  2. Verify the tests fail.
  3. Implement `index.ts`: resolve location (Task 4), `openDb` (Task 2), `runMigrations` (Task 3), cache the handle, capture any failure as the DB status.
  4. Verify the tests pass.
  5. Commit: `feat(server): open + migrate the database at boot`
- **Verify**: `index.test.ts` passes.
- **Depends on**: Task 2, Task 3, Task 4

### Task 6: interaction-store — review-state CRUD
- **Files**: `server/src/db/interaction-store.ts`, `server/src/db/interaction-store.test.ts`
- **Do**:
  1. Write failing tests: `upsertInteraction` inserts a row and, on `ON CONFLICT(id)`, updates content columns **but leaves `worktree_path` and `agent_queue_status` untouched**; `getInteractionsByChangeset` returns rows for a `changeset_id`; `deleteInteraction` removes by id. Verify round-trip of `payload_json` (anchor\* / `external` / `runRecipe`).
  2. Verify the tests fail.
  3. Implement the review-state functions in `interaction-store.ts` with prepared statements.
  4. Verify the tests pass.
  5. Commit: `feat(server): add interaction-store review-state CRUD`
- **Verify**: `interaction-store.test.ts` passes; the conflict-update test proves the worktree columns are protected.
- **Depends on**: Task 3

### Task 7: interaction-store — agent channel ops
- **Files**: `server/src/db/interaction-store.ts`, `server/src/db/interaction-store.test.ts`
- **Do**:
  1. Write failing tests: `enqueueToWorktree` sets `worktree_path` + `agent_queue_status = 'pending'` on an existing row (one write, both keying columns present afterwards); `unenqueueFromWorktree` clears them; `pullAndAck` in a single transaction flips `pending`→`delivered` and returns the rows; `listDelivered` reads delivered rows; `postAgentInteraction` writes an `author_role = "agent"` row; `listAgentReplies` reads them.
  2. Verify the tests fail.
  3. Implement the channel functions in `interaction-store.ts`.
  4. Verify the tests pass.
  5. Commit: `feat(server): add interaction-store agent-channel ops`
- **Verify**: `interaction-store.test.ts` passes; `pullAndAck` proven transactional.
- **Depends on**: Task 6

### Task 8: `/api/interactions` endpoints
- **Files**: `server/src/db/interaction-endpoints.ts`, `server/src/db/interaction-endpoints.test.ts`
- **Do**:
  1. Write failing tests (integration tier — real `createApp()` per `docs/plans/test-strategy.md`, DB-isolated via `SHIPPABLE_DB_PATH=:memory:`): `GET /api/interactions?changesetId=…` returns the changeset's rows; `POST /api/interactions` upserts; `POST` with worktree-enqueue payload sets the channel columns; `DELETE` removes a row.
  2. Verify the tests fail.
  3. Implement `interaction-endpoints.ts` route handlers over `interaction-store.ts`.
  4. Verify the tests pass.
  5. Commit: `feat(server): add /api/interactions endpoints`
- **Verify**: `interaction-endpoints.test.ts` passes.
- **Depends on**: Task 7

### Task 9: Rewrite agent-queue.ts over the store
- **Files**: `server/src/agent-queue.ts`, `server/src/agent-queue.test.ts`
- **Do**:
  1. Adjust `agent-queue.test.ts`: drop the `resolveSupersessions` tests; keep `formatPayload` / CDATA / XML-escaping / sort tests; rework `enqueue`/`pullAndAck`/`listDelivered`/`postReply`/`postTopLevel`/`listReplies`/`isDeliveredInteractionId` tests against the DB-backed store (DB-isolated).
  2. Verify the reworked tests fail.
  3. Rewrite `agent-queue.ts`: delete the in-memory `Map`s and `resolveSupersessions`; back the queue functions with `interaction-store.ts`; keep the wire-envelope module (`formatPayload`, `sanitizeBody`, `escapeXmlAttr`, sort helpers).
  4. Verify the tests pass.
  5. Commit: `refactor(server): back agent-queue with the SQLite store`
- **Verify**: `agent-queue.test.ts` passes; no remaining references to the deleted `Map`s.
- **Depends on**: Task 7

### Task 10: Wire server routes + health
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Update `index.test.ts`: assert `/api/interactions` routes are reachable; assert `/api/agent/enqueue` and `/api/agent/unenqueue` are gone; assert `/api/health` returns a `db` field (`{ status, error? }`); ensure the suite sets `SHIPPABLE_DB_PATH=:memory:` for isolation.
  2. Verify the new assertions fail.
  3. In `index.ts`: call the DB init (Task 5) at boot; mount `interaction-endpoints` routes; remove the `/api/agent/enqueue` + `/api/agent/unenqueue` branches and their handlers (`handleAgentEnqueue`, `handleAgentUnenqueue`); fold enqueue into `/api/interactions`; extend `/api/health` to include `db: getDbStatus()`.
  4. Verify the tests pass.
  5. Commit: `feat(server): wire /api/interactions and DB health status`
- **Verify**: `npm run typecheck` + full `server` test suite green.
- **Depends on**: Task 5, Task 8, Task 9

### Task 11: Remove enqueue-FK fields from the Interaction model
- **Files**: `web/src/types.ts`, `web/src/state.ts`, `web/src/state.test.ts`
- **Do**:
  1. Update `state.test.ts`: drop coverage of `PATCH_INTERACTION_ENQUEUED_ID` and `enqueuedCommentId`; adjust `MERGE_AGENT_REPLIES` tests to match agent replies on interaction `id` / `parentId` instead of `enqueuedCommentId`.
  2. Verify the affected tests fail.
  3. In `types.ts`: remove `enqueuedCommentId` and `enqueueOptIn` from `Interaction` (keep `enqueueError`).
  4. In `state.ts`: remove the `PATCH_INTERACTION_ENQUEUED_ID` action + reducer case; rework `mergeAgentInteractions` to key on `id`/`parentId`.
  5. Verify the tests pass.
  6. Commit: `refactor(web): drop enqueuedCommentId FK from the Interaction model`
- **Verify**: `web` typecheck + `npm test` for `state` green.
- **Depends on**: none

### Task 12: interactionClient
- **Files**: `web/src/interactionClient.ts`, `web/src/interactionClient.test.ts`
- **Do**:
  1. Write failing tests for `fetchInteractions(changesetId)`, `upsertInteraction(ix)`, `deleteInteraction(id)`, `enqueueInteraction(id, worktreePath)` — exercised against the real server (integration tier, `:memory:` DB) per `test-strategy.md`.
  2. Verify the tests fail.
  3. Implement `interactionClient.ts` as a typed wrapper over `/api/interactions` using `apiUrl`.
  4. Verify the tests pass.
  5. Commit: `feat(web): add interactionClient over /api/interactions`
- **Verify**: `interactionClient.test.ts` passes.
- **Depends on**: Task 10

### Task 13: Strip interactions from persist.ts
- **Files**: `web/src/persist.ts`, `web/src/persist.test.ts`
- **Do**:
  1. Update `persist.test.ts`: remove interaction / `detachedInteractions` / `isPersistable` coverage; assert the snapshot now carries only progress (cursor, readLines, reviewedFiles, dismissedGuides, drafts) and that the bumped version rejects the old shape.
  2. Verify the affected tests fail.
  3. In `persist.ts`: remove `interactions` + `detachedInteractions` from `PersistedSnapshot` and `HydratedSession`; delete `isPersistable` and the interaction/detached filtering helpers; bump the snapshot version (v3→v4); update `buildSnapshot`, `loadSession`, `peekSession`, `hasProgress`, `isPersistedSnapshot`.
  4. Verify the tests pass.
  5. Commit: `refactor(web): persist only review progress, not interactions`
- **Verify**: `persist.test.ts` passes; `web` typecheck surfaces the App.tsx fallout (fixed in Task 16).
- **Depends on**: none

### Task 14: Drop the interactions snapshot from recents.ts
- **Files**: `web/src/recents.ts`, `web/src/recents.test.ts`
- **Do**:
  1. Update `recents.test.ts`: remove the per-recent `interactions` snapshot expectations.
  2. Verify the affected tests fail.
  3. In `recents.ts`: remove `interactions` from the recent-entry shape and from `pushRecent`; interactions for a selected recent come from the DB (Task 16).
  4. Verify the tests pass.
  5. Commit: `refactor(web): recents no longer snapshot interactions`
- **Verify**: `recents.test.ts` passes; `web` typecheck surfaces the App.tsx fallout (fixed in Task 16).
- **Depends on**: none

### Task 15: Client sync layer for interaction mutations
- **Files**: `web/src/useInteractionSync.ts`, `web/src/useInteractionSync.test.ts`
- **Do**:
  1. Write failing tests: an `ADD_INTERACTION` / `DELETE_INTERACTION` / `TOGGLE_ACK` / enqueue mutation triggers the matching `interactionClient` call; a failed request dispatches `SET_INTERACTION_ENQUEUE_ERROR` (the transient retry pip); success clears it.
  2. Verify the tests fail.
  3. Implement `useInteractionSync.ts` — a hook that wraps `dispatch` (or observes interaction-mutating actions) and mirrors them to `interactionClient`, mapping request failures to `enqueueError`.
  4. Verify the tests pass.
  5. Commit: `feat(web): mirror interaction mutations to the server`
- **Verify**: `useInteractionSync.test.ts` passes.
- **Depends on**: Task 12

### Task 16: App.tsx — boot + per-changeset fetch + sync wiring
- **Files**: `web/src/App.tsx`, `web/src/App.test.tsx`
- **Do**:
  1. Update `App.test.tsx`: boot no longer hydrates/merges interactions from `persist`; loading a changeset fetches its interactions via `interactionClient`; the sync layer is wired.
  2. Verify the affected tests fail.
  3. In `App.tsx`: drop `mergeInteractionMaps` of persisted interactions and the boot-time interaction overlay; `resolveBoot` stops threading `interactions` out of `persist`; on changeset load call `interactionClient.fetchInteractions(changesetId)` and seed the reducer (compute `detachedInteractions` on the client from unresolved anchors); upsert ingest interactions (stub fixtures / PR merge) via `interactionClient`; mount `useInteractionSync`.
  4. Verify the tests pass.
  5. Commit: `feat(web): fetch interactions per-changeset from the server`
- **Verify**: `web` build + lint + `npm test` green; open the app in the browser — load a changeset, add/delete/ack an interaction, reload, confirm it round-trips through the server.
- **Depends on**: Task 12, Task 13, Task 14, Task 15

### Task 17: ServerHealthGate — DB status check
- **Files**: `web/src/components/ServerHealthGate.tsx`, `web/src/components/ServerHealthGate.test.tsx`
- **Do**:
  1. Update `ServerHealthGate.test.tsx`: `/api/health` with `db.status === "error"` → the gate hard-fails and renders `db.error`; `db.status === "ok"` → falls through to children; a mid-session flip to `error` re-engages the gate.
  2. Verify the tests fail.
  3. In `ServerHealthGate.tsx`: parse the `db` field from the health response; treat `db.status === "error"` like the existing `unreachable` posture, surfacing `db.error`.
  4. Verify the tests pass.
  5. Commit: `feat(web): hard-fail boot when the database is unavailable`
- **Verify**: `ServerHealthGate.test.tsx` passes; manually point `SHIPPABLE_DB_PATH` at an unwritable path and confirm the gate shows the error.
- **Depends on**: Task 10

### Task 18: useDeliveredPolling — DB-backed endpoints
- **Files**: `web/src/useDeliveredPolling.ts`, `web/src/useDeliveredPolling.test.ts`
- **Do**:
  1. Update `useDeliveredPolling.test.ts`: polling reads agent rows from the DB-backed delivered/replies endpoints; agent replies merge by `id`/`parentId`, not `enqueuedCommentId`.
  2. Verify the affected tests fail.
  3. In `useDeliveredPolling.ts`: point polling at the current endpoints; drop `enqueuedCommentId` matching.
  4. Verify the tests pass.
  5. Commit: `refactor(web): poll agent replies from the DB-backed endpoints`
- **Verify**: `useDeliveredPolling.test.ts` passes.
- **Depends on**: Task 10, Task 11

### Task 19: e2e DB isolation
- **Files**: `web/playwright.config.ts`
- **Do**:
  1. Add `SHIPPABLE_DB_PATH: ":memory:"` to the server `env` block in `playwright.config.ts`.
  2. Run the e2e suite; confirm it passes and leaves `~/.local/share/Shippable/shippable.db` untouched.
  3. Commit: `test(web): isolate the e2e server DB to :memory:`
- **Verify**: `npm run e2e` (or the configured command) green; no real DB file written.
- **Depends on**: Task 10

### Task 20: Update architecture docs
- **Files**: `docs/architecture.md`
- **Do**:
  1. Update the "Review interactions" section: remove the "Persistence asymmetry" invariant; document the DB-only store, the `interactions` table, `/api/interactions`, the `/api/health` `db` field, and per-changeset lazy fetch. Update the "Persistence: localStorage" line in the data-model section.
  2. Commit: `docs: document SQLite interaction persistence`
- **Verify**: the doc reflects the shipped design; no stale references to `isPersistable` / `localStorage` interaction persistence.
- **Depends on**: Task 16, Task 17
