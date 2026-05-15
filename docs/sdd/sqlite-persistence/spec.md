# Spec: SQLite Persistence

## Goal

Give the **Interaction primitive** one server-owned home — a SQLite database —
so that the agent queue survives server restarts, interactions are reachable by
the server-side MCP bridge / agents, and a `localStorage` blob plus two
in-memory `Map`s collapse into one relational `interactions` table. This is a
**DB-only** design: the database is the single store for interactions, there is
no `localStorage` fallback, and a database that won't open is a hard boot
failure.

## Requirements Summary

- One server-owned `interactions` table; hot columns mirror required
  `Interaction` fields, `changeset_id` / `worktree_path` are storage-keying
  columns, `agent_queue_status` drives the channel pull lifecycle, optional
  fields ride in `payload_json`.
- Runtime-dispatched SQLite adapter — `node:sqlite` under Node, `bun:sqlite`
  under the compiled sidecar. No native addon.
- `agent-queue.ts`'s in-memory `Map`s migrate to the table; `/api/agent/enqueue`
  and `/api/agent/unenqueue` fold into `/api/interactions`; enqueue is one row,
  one write; `pullAndAck` is one transaction; supersession machinery deleted.
- Client-authoritative ids; `enqueuedCommentId` / `enqueueOptIn` /
  `PATCH_INTERACTION_ENQUEUED_ID` removed; `enqueueError` stays transient.
- **The DB is the one store — all interactions persist** (`isPersistable`
  removed). Producers already supply stable ids, so persistence is upsert-by-id.
- Upsert ON CONFLICT must not overwrite `worktree_path` / `agent_queue_status`.
- Versioned schema + forward migration runner.
- `persist.ts` keeps only review *progress*; loses interaction handling.
- DB location shares `port-file.ts`'s platform resolution; `SHIPPABLE_DB_PATH`
  override; e2e points at `:memory:`.
- `/api/health` carries a `db` status + error detail; `ServerHealthGate`
  hard-fails boot on DB-unavailable.
- Interactions fetched lazily per-changeset; no boot bulk-hydration.

## Chosen Approach

**Per-mutation writes, client-owned sync.**

The server owns the SQLite database and exposes a small `/api/interactions` CRUD
surface plus the existing `/api/agent/*` channel endpoints. The reducer remains
the in-memory source of truth *for the active session*, but every
interaction-mutating dispatch is mirrored to the server through a sync layer, so
each user mutation maps 1:1 to a database write. On changeset load the client
upserts whatever ingest-produced interactions it has (stub-fixture AI notes,
PR-imported comments) and then reads the changeset's full interaction set back
from the database — the DB is authoritative for what the review view renders.

This was chosen over a **debounced whole-changeset sync** (re-PUTs the entire
interaction set on a timer — exactly the "reviewer re-sync" pattern requirement
6 warns can reset a `delivered` row to `pending`, and it muddies the
mutation→write mapping) and over **server-side ingest** (moving stub-seeding and
PR-merge onto the server is a large refactor that fights the current
client-side ingest architecture — scope creep).

### Alternatives Considered

- **Debounced whole-changeset sync** — minimal App rewiring, single write path,
  but re-writes everything on every change and maximises the
  overwrite-the-channel-columns footgun.
- **Server-side ingest** — thinner client, but stubs/fixtures and PR ingest are
  client concepts today; relocating them is out of proportion to this feature.

## Technical Details

### Architecture

A new `server/src/db/` package owns persistence; the rest of the server and the
whole web client talk to it through HTTP only.

- **`db/adapter.ts`** — runtime-dispatched SQLite. Detects Bun vs Node and loads
  `bun:sqlite` or `node:sqlite`, normalising both behind one synchronous
  `SqliteDb` interface (`exec`, `prepare`, `transaction`, `close`).
  `transaction` is explicit `BEGIN`/`COMMIT`/`ROLLBACK` so it behaves
  identically on both runtimes. No native addon.
- **`db/location.ts`** — resolves the database path. Reuses a shared app-data-dir
  helper (see below) so `shippable.db` sits beside `port.json`. Honours
  `SHIPPABLE_DB_PATH` (absolute path or the `:memory:` sentinel) above all else.
  **No `:memory:`-on-unwritable fallback** — if the resolved on-disk path can't
  be created or written, that is surfaced as a DB-open failure (hard boot fail).
  `:memory:` is reachable *only* via an explicit `SHIPPABLE_DB_PATH=:memory:`,
  for tests.
- **`db/schema.ts`** — the `interactions` table, a `schema_meta` version row,
  and a forward migration runner (`SCHEMA_HEAD`, ordered `MIGRATIONS[]`, each
  step in its own transaction). v1 is the fresh schema.
- **`db/index.ts`** — opens the database once at server boot, runs migrations,
  holds the singleton handle, and records a **DB status** (`ok`, or `error`
  with the error message) that `/api/health` reads. A failure here does not
  crash the process — the server still answers `/api/health` so the client can
  show the reason.
- **`db/interaction-store.ts`** — the data-access layer. Prepared-statement
  functions: `upsertInteraction`, `getInteractionsByChangeset`,
  `deleteInteraction`, `enqueueToWorktree`, `unenqueueFromWorktree`,
  `pullAndAck`, `listDelivered`, `listAgentReplies`, `postAgentInteraction`.
- **`db/interaction-endpoints.ts`** — the `/api/interactions` route handlers.

A shared **`server/src/app-data-dir.ts`** (small refactor) exports the
per-platform `Shippable/` directory resolution; `port-file.ts` and
`db/location.ts` both consume it instead of duplicating the platform `switch`.

`server/src/agent-queue.ts` is rewritten on top of `interaction-store.ts`: it
keeps the wire-envelope concerns (`formatPayload`, CDATA sanitisation, XML
escaping, payload sorting) and loses the in-memory `Map`s and
`resolveSupersessions`.

### Data Flow

- **Boot.** `ServerHealthGate` probes `/api/health`. The response carries
  `db: { status: "ok" | "error", error?: string }`. `status: "error"` →
  hard-fail gate, render the `error` detail (reuses the existing
  "server unreachable" posture). `status: "ok"` → the app loads. There is no
  bulk interaction hydration at boot.
- **Changeset load.** The client assembles whatever ingest interactions it has
  (stub-fixture AI notes, PR-merged comments) and upserts them to
  `/api/interactions` (idempotent — stable producer ids). It then GETs
  `/api/interactions?changesetId=…` and seeds the reducer. Interactions whose
  anchor fails to resolve against the current changeset are sorted into the
  derived `detachedInteractions` bucket on the client, as today — "detached" is
  a computed view state, not a separate stored kind.
- **Mutation.** A user adds / deletes / acks an interaction. The reducer updates
  in-memory state *and* the sync layer issues the matching
  `POST`/`DELETE /api/interactions` call. A failed request (network-level) sets
  the transient `enqueueError` flag → the existing "⚠ retry" pip. A response
  that reports a DB-level failure flips the health state and re-engages the
  blocking gate.
- **Enqueue.** Enqueuing a review interaction to an agent is a single
  `POST /api/interactions` that sets `worktree_path` + `agent_queue_status =
  'pending'` on the interaction's existing row. `/api/agent/enqueue` and
  `/api/agent/unenqueue` are gone.
- **Agent pull.** `/api/agent/pull` runs `pullAndAck` as one SQLite transaction:
  select `pending` rows for the worktree, flip them to `delivered`, return them.
  `formatPayload` renders the wire envelope.
- **Agent reply.** `POST /api/agent/replies` writes an `author_role = "agent"`
  interaction row directly via `postAgentInteraction` — no separate table.
- **Agent reply poll.** The client's delivered/replies polling reads agent rows
  and merges them into reducer state (the existing `MERGE_AGENT_REPLIES` path,
  minus the `enqueuedCommentId` matching — agent rows now carry their own ids
  and parent ids).

### `interactions` table

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | client-authoritative UUID; GitHub/fixture id for ingest rows |
| `thread_key` | TEXT (nullable) | null for agent-started channel rows anchored by file/lines |
| `target` | TEXT NOT NULL | `line` / `block` / `reply` |
| `intent` | TEXT NOT NULL | ask or response intent |
| `author` | TEXT NOT NULL | display name |
| `author_role` | TEXT NOT NULL | `user` / `ai` / `agent` |
| `body` | TEXT NOT NULL | |
| `created_at` | TEXT NOT NULL | ISO timestamp |
| `changeset_id` | TEXT (nullable) | review-state keying column |
| `worktree_path` | TEXT (nullable) | reviewer↔agent channel keying column |
| `agent_queue_status` | TEXT (nullable) | `pending` / `delivered` for channel rows |
| `payload_json` | TEXT NOT NULL | anchor\*, `external`, `runRecipe`, and other optional `Interaction` fields |

Indexes on `(changeset_id)` and `(worktree_path, agent_queue_status)`. An
enqueued review interaction carries **both** `changeset_id` and `worktree_path`.

**Upsert contract.** `upsertInteraction`'s `ON CONFLICT(id) DO UPDATE` updates
the content columns but **must not touch `worktree_path` or
`agent_queue_status`** — those are owned by the enqueue write and the agent's
pull. A reviewer re-sync that overwrote them would reset a `delivered` row to
`pending` and cause infinite re-delivery.

### Key Components

| Component | Responsibility |
|---|---|
| `server/src/db/adapter.ts` | runtime-dispatched SQLite, one sync interface |
| `server/src/db/location.ts` | resolve DB path; `SHIPPABLE_DB_PATH` override; no memory fallback |
| `server/src/db/schema.ts` | table DDL + versioned forward migration runner |
| `server/src/db/index.ts` | open + migrate at boot; expose DB status for health |
| `server/src/db/interaction-store.ts` | prepared-statement data-access layer |
| `server/src/db/interaction-endpoints.ts` | `/api/interactions` route handlers |
| `server/src/app-data-dir.ts` | shared per-platform `Shippable/` dir resolution |
| `web/src/interactionClient.ts` | typed wrapper over `/api/interactions` |
| `web/src/` sync layer | mirror interaction-mutating dispatches to the server |

### File Changes

| File | Change Type | Description |
|---|---|---|
| `server/src/db/adapter.ts` | new | runtime-dispatched SQLite adapter |
| `server/src/db/location.ts` | new | DB path resolution + env override, no memory fallback |
| `server/src/db/schema.ts` | new | `interactions` table + migration runner |
| `server/src/db/index.ts` | new | boot open/migrate, DB status for health |
| `server/src/db/interaction-store.ts` | new | data-access layer |
| `server/src/db/interaction-endpoints.ts` | new | `/api/interactions` handlers |
| `server/src/app-data-dir.ts` | new | shared platform app-data-dir helper |
| `server/src/port-file.ts` | modify | consume `app-data-dir.ts` instead of inline platform switch |
| `server/src/agent-queue.ts` | modify | rewrite over `interaction-store`; drop in-memory `Map`s + `resolveSupersessions`; keep wire formatting |
| `server/src/index.ts` | modify | wire `/api/interactions`; remove `/api/agent/enqueue` + `/api/agent/unenqueue`; extend `/api/health` with `db` field |
| `server/src/agent-queue.test.ts` | modify | rework against the DB-backed store; drop supersession tests |
| `server/src/index.test.ts` | modify | new routes; DB-isolated via `SHIPPABLE_DB_PATH` |
| `web/src/interactionClient.ts` | new | typed `/api/interactions` client |
| `web/src/persist.ts` | modify | drop `interactions` / `detachedInteractions` / `isPersistable`; keep progress only; bump snapshot version |
| `web/src/types.ts` | modify | remove `enqueuedCommentId`, `enqueueOptIn` from `Interaction` |
| `web/src/state.ts` | modify | remove `PATCH_INTERACTION_ENQUEUED_ID`; adjust `MERGE_AGENT_REPLIES` off `enqueuedCommentId` |
| `web/src/App.tsx` | modify | drop boot interaction hydration/merge; fetch interactions per-changeset; wire the sync layer |
| `web/src/recents.ts` | modify | drop the per-recent `interactions` snapshot — fetch from DB on select |
| `web/src/components/ServerHealthGate*` | modify | check `db` status; hard-fail with error detail |
| `web/src/components/MemoryModeBanner*` | delete | mode-routing / degradation banner removed |
| `web/src/useDeliveredPolling.ts` | modify | read agent rows from the DB-backed endpoints |
| `playwright.config.ts` | modify | server `env`: `SHIPPABLE_DB_PATH=:memory:` |
| `docs/architecture.md` | modify | update "Review interactions"; remove the "Persistence asymmetry" invariant |

(Test files for new modules — `adapter`, `location`, `schema`,
`interaction-store`, `interaction-endpoints`, `interactionClient` — are added
alongside; enumerated in the plan.)

## Out of Scope

- The memory-only deployment shape — boot hard-fails there; the
  `persistence: "memory"` concept is removed entirely. `:memory:` is a
  test-only escape hatch via `SHIPPABLE_DB_PATH`.
- The pre-existing duplicate-key React warning on `main`.
- Porting the take-1 `sqlite-persistence` branch — re-implemented clean;
  take-1 is reference only.
- Multi-client / concurrent-writer correctness beyond what single-process
  SQLite gives for free.

## Open Questions Resolved

- **Where do ingest-pipeline writes happen?** Client-owned. The client upserts
  its ingest interactions (stub-fixture AI notes, PR-imported comments) to
  `/api/interactions` on changeset load. The server writes only agent rows
  (`/api/agent/*`).
- **Deterministic id scheme for AI annotations?** None needed. AI notes come
  from stub fixtures with fixed ids, PR comments carry GitHub ids, user
  interactions carry client UUIDs — every producer already supplies a stable
  id, so persistence is upsert-by-id.
- **Re-ingest short-circuit?** Not needed. Upsert-by-id makes re-loading a
  changeset naturally idempotent; no load-time short-circuit.
- **Per-mutation vs debounced writes?** Per-mutation, via the client-owned sync
  layer (chosen approach).
- **`recents.ts` interaction snapshot?** Dropped. Recents carry only the
  changeset; interactions are fetched from the DB by `changeset_id` when a
  recent is selected.
- **`thread_key` nullability?** Nullable column. Agent-started channel rows
  anchor by file/lines in `payload_json` and may have a null `thread_key`.
- **`detachedInteractions`?** No longer separately stored. All interactions are
  rows keyed by `changeset_id`; "detached" is computed on the client at load
  time when an interaction's anchor fails to resolve.
