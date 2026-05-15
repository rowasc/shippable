# SQLite Persistence — Requirements

## Goal

Give the **Interaction primitive** one server-owned home: a SQLite database. The
motivation is not durability for its own sake — it is to (1) fix agent-queue
data loss (the in-memory `Map`s in `server/src/agent-queue.ts` are dropped on
every server restart), (2) make interactions reachable by the server-side MCP
bridge / agents (today user interactions live in the browser's `localStorage`,
invisible to the server), and (3) consolidate a `localStorage` blob + two
in-memory `Map`s into one relational `interactions` table.

This is a **DB-only** design — there is no `localStorage` fallback for
interactions. The DB is the single store.

## Requirements

1. **One server-owned `interactions` table.** Hot columns mirror the required
   fields of `web/src/types.ts#Interaction` (`id`, `thread_key`, `target`,
   `intent`, `author`, `author_role`, `body`, `created_at`). Two storage-level
   keying columns: `changeset_id` (review-state interactions) and
   `worktree_path` (the reviewer↔agent channel — what was the in-memory queue).
   `agent_queue_status` (`pending` / `delivered`) for the channel pull
   lifecycle. Optional / contextual fields ride in a `payload_json` column. No
   `scope` discriminator, no separate agent-queue / reply tables.

2. **Runtime-dispatched adapter.** `node:sqlite` under Node (dev), `bun:sqlite`
   under the `bun build --compile` sidecar. No native addon (rules out
   `better-sqlite3`). Both expose near-identical sync prepared-statement APIs;
   the adapter is a thin normalization layer.

3. **`agent-queue.ts` migrates to the table.** `/api/agent/enqueue` and
   `/api/agent/unenqueue` are removed — folded into `/api/interactions`.
   Enqueuing a review interaction is **one row, one write**: it sets
   `worktree_path` + `agent_queue_status` on the interaction's existing row
   (so an enqueued review interaction carries *both* keying columns).
   `pullAndAck` is a single SQLite transaction.

4. **Client-authoritative ids.** The client generates the interaction id (UUID);
   it is the queue id end-to-end. Remove `enqueuedCommentId` (the old FK),
   the unused `enqueueOptIn`, and the `PATCH_INTERACTION_ENQUEUED_ID` reducer
   action. `enqueueError` stays as transient client state (see requirement 12).

5. **Agent replies are ordinary interactions** — `author_role = "agent"`, no
   separate table. They are written server-side by the agent endpoints.
   The supersession machinery (`resolveSupersessions` and its tests) is
   **deleted** — the one-row model removes the reason it existed.

6. **`upsert` ON CONFLICT must not overwrite `worktree_path` /
   `agent_queue_status`.** Those columns are owned by the enqueue write and the
   agent's pull respectively; a reviewer re-sync that overwrote them would reset
   a `delivered` row to `pending` and cause infinite re-delivery. (This was a
   real bug caught in verification of the prior attempt.)

7. **The DB is the one store — all interactions persist.** The `isPersistable`
   filter is **removed**. User-authored, AI-annotation, PR-imported, and agent
   interactions all live in the DB. This requires:
   - **Deterministic ids for AI annotations** so re-running the annotation
     pipeline on changeset load upserts the same rows rather than duplicating.
   - **GitHub-id keying for PR-imported interactions** so a re-pull upserts.
   - **Ingest pipelines upsert, not append** — re-ingest of an already-seen
     changeset must be idempotent.

8. **Versioned schema + forward migration runner** (per `AGENTS.md`: "If you
   change `ReviewState` or any other internal shape that will be stored,
   version it.").

9. **`persist.ts` keeps only review *progress*** — cursor, readLines,
   reviewedFiles, dismissedGuides, drafts. It loses interaction handling
   entirely (not "keeps it as a fallback"). Delete the `interactionStore`
   durable/memory mode-routing and the `MemoryModeBanner`-as-degradation.

10. **DB location.** `db/location.ts` shares the platform-data-dir resolution
    with `port-file.ts#portFilePath()` — extract a shared helper so
    `shippable.db` sits next to `port.json` in the per-platform `Shippable/`
    directory (macOS `Library/Application Support`, Linux `$XDG_DATA_HOME` /
    `~/.local/share`, Windows `%LOCALAPPDATA%`). An explicit
    `SHIPPABLE_DB_PATH` env override is a first-class requirement for test
    isolation. `playwright.config.ts`'s server `env` block must set
    `SHIPPABLE_DB_PATH=:memory:` so e2e runs don't pollute the real data dir.

11. **`/api/health` reports DB status.** It returns a `db` field carrying both
    a status (`ok` / `error`) and, on error, the error detail. `ServerHealthGate`
    checks it: a DB-unavailable boot **hard-fails** (reuse the existing "server
    unreachable" posture — the app refuses to load, no `localStorage`
    degradation) and displays the error detail so the user sees *what* went
    wrong. The health check is also the surface for DB failures detected
    mid-session — the gate re-engages.

12. **Interactions are fetched lazily per-changeset**, from `/api/interactions`,
    when a changeset is loaded into the review view (agent-channel rows fetched
    when that surface needs them). There is **no** bulk hydration at boot — the
    old `HYDRATE_INTERACTIONS`-at-boot effect is dropped. Mid-session API
    *request* failures (network-level) keep the transient `enqueueError`-style
    retry pip; DB-*level* failures surface through the blocking health-check
    error surface (requirement 11).

## Constraints

- `node:sqlite` needs Node ≥ 22.12 and is relatively new. The devcontainer was
  already bumped (`javascript-node:22` + `bun` + Playwright Chromium); the
  repo's `.nvmrc` files already declare 22.
- **Network-restricted devcontainer** — only the npm registry is reachable.
  Anything needing a download (Node, bun, Playwright browsers) must be
  installed at *image build time* via the Dockerfile, not at runtime.
- Written against the **current** interaction model: `InteractionTarget` is
  `line | block | reply`; `InteractionAuthorRole` is `user | ai | agent`;
  agent payload bodies are CDATA-wrapped in the `/api/agent/*` envelope;
  `(target, intent)` pair validity is enforced.
- The server is a hard dependency in every deployment shape; this feature does
  not change that. What it adds is a hard dependency on the DB being openable.

## Out of Scope

- **The memory-only deployment shape.** When the server can't write a DB to
  disk, boot **hard-fails** (it resolves a real on-disk path; failing to open
  or write it trips requirement 11). The `persistence: "memory"` *concept goes
  away entirely* — no mode-routing, no banner. `:memory:` SQLite is used only
  for tests via `SHIPPABLE_DB_PATH`, never as a deployment mode. Supporting
  memory-only deployments for interactions is deferred.
- The pre-existing duplicate-key React warning seen in e2e output (`key "r1"`,
  `key ""`) — it is on `main`, not introduced by this work.
- Porting the prior `sqlite-persistence` (take-1) branch. The decision is to
  re-spec and **re-implement clean** on `sqlite-persistence-take-2`; take-1 is
  reference only.

## Open Questions

- **Where do ingest-pipeline writes happen** — server-side, or via a client
  POST? The AI annotation pipeline, PR ingest, and teammate ingest all now need
  to land rows in the DB (requirement 7). sdd-spec should pin this.
- **Deterministic id scheme for AI annotations** — what derives a stable id
  (e.g. `changesetId` + `hunkId` + `lineIdx` + pipeline version)?
- **Re-ingest short-circuit** — when a changeset that already has persisted
  interactions is reloaded, does the AI pipeline re-run (and upsert), or does
  the DB short-circuit it? Affects load latency and the upsert contract.
- **Per-mutation writes vs. the debounced whole-state model.** With no
  `localStorage` mirror to keep in sync, per-mutation writes at the dispatch
  sites may be cleaner than a debounced re-PUT of all of a changeset's
  interactions.
- **`recents.ts` interaction snapshot** — `recents.ts` snapshots interactions
  per recent entry. With the DB authoritative, is that snapshot now redundant,
  or does it still matter?
- **`thread_key` nullability** — the `/api/agent/*` wire format anchors
  agent-started interactions by `file` / `lines`, not `threadKey`; channel rows
  can legitimately have a null `thread_key`.

## Related Code / Patterns Found

- `server/src/agent-queue.ts` — the in-memory `Map`s (`queues`, `replyStore`)
  that this feature migrates into the table; also the wire-envelope formatting
  (`formatPayload`, CDATA sanitization) that stays.
- `server/src/port-file.ts` — `portFilePath()`'s per-platform data-dir
  resolution; extract a shared helper for `db/location.ts` (requirement 10).
- `server/src/index.ts` — `/api/agent/*` routes (enqueue, pull, delivered,
  unenqueue, replies) and `/api/health`; the routing this feature reshapes.
- `web/src/persist.ts` — the `localStorage` round-trip and the `isPersistable`
  filter being removed; the schema-versioned snapshot pattern to keep for
  review *progress*.
- `web/src/types.ts` — the `Interaction` shape, the `enqueuedCommentId` /
  `enqueueError` / `enqueueOptIn` fields (first two stay/removed per req 4),
  thread-key helpers.
- `web/src/state.ts` — the `PATCH_INTERACTION_ENQUEUED_ID` reducer action to
  remove, and the agent-reply merge logic keyed on `enqueuedCommentId`.
- `web/src/components/ServerHealthGate` — the boot gate to extend with the
  `db` status check (requirement 11).
- `docs/architecture.md` — the "Review interactions" section, including the
  **"Persistence asymmetry"** invariant, which decision B (requirement 7)
  removes; update it alongside the implementation.
- `docs/plans/typed-review-interactions.md` — the interaction-primitive design
  this builds on.
