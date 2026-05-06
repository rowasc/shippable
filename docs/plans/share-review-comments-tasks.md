# Sharing review comments — task breakdown

Companion to [share-review-comments.md](./share-review-comments.md) and the slice-(d) lane of [worktrees.md](./worktrees.md). The plan is the *why* and the user-facing decisions; this file is the implementer's punch list. Each task names files, acceptance criteria, and the caveats worth knowing before you touch the code.

Legend: `[x]` done · `[ ]` not done · `[~]` partially done — replaced or migrated by a v0 task below.

---

## 0. Foundations already in place

These already shipped on `worktree-agent-context-panel` and the v0 work either layers on top or supersedes them. Listed so the implementer knows what to leave alone vs. what to migrate.

- [x] **Worktrees ingest (slice a of `worktrees.md`).** `POST /api/worktrees/list` and `POST /api/worktrees/changeset` (`server/src/worktrees.ts`, wired in `server/src/index.ts`). Loads a worktree's HEAD as a `ChangeSet` carrying `WorktreeSource` (`web/src/types.ts:271-275`).
- [x] **Agent-context read side.** `POST /api/worktrees/sessions` and `POST /api/worktrees/agent-context` (`server/src/agent-context.ts`). UI in `web/src/components/AgentContextSection.tsx` renders task / files-touched / todos / transcript-tail / footer.
- [~] **File-based free-form composer.** `POST /api/worktrees/inbox` writes `<worktree>/.shippable/inbox.md`; `POST /api/worktrees/inbox-status` polls. Backed by `server/src/inbox.ts` (incl. `ensureExclude` against `git rev-parse --git-common-dir`/info/exclude). Composer in `AgentContextSection.tsx` `SendToAgent` polls every 2s with a 5-min timeout. **Replaced by slice 2:** the composer's "post" gesture moves to `/api/agent/enqueue`. **Deleted in slice 5 cleanup.**
- [~] **Claude Code hook (`shippable-inbox-hook`).** `tools/shippable-inbox-hook` reads CC's stdin event JSON, extracts `cwd`, prepends `<reviewer-feedback from="shippable">…</reviewer-feedback>` wrapping `inbox.md`, deletes the file. **Deleted in slice 5 cleanup** — the MCP server takes its place.
- [~] **Hook detection + one-click install.** `server/src/hook-status.ts` (`installHook`, `checkHookStatus`); `GET /api/worktrees/hook-status`, `POST /api/worktrees/install-hook`. Writes to `~/.claude/settings.local.json`. **Replaced by slice 5** — MCP servers don't have an equivalent unattended-install path on most harnesses; the user copies a command. The hook-status code is deleted in slice 5 cleanup.

---

## 1. Slice 1 — Queue substrate

The HTTP endpoint is the main contract; everything else is glue over it. Keep the queue agent-agnostic.

- [x] **Extract `assertGitDir` to `server/src/worktree-validation.ts`.** Today the validation lives inline in `server/src/inbox.ts` (called via `ensureExclude` and friends). Lift it so `agent-queue.ts` and the new `/api/agent/*` endpoints can reuse it without depending on `inbox.ts`. Validation: absolute path, no `..`, `.git` resolves.

- [x] **Create `server/src/agent-queue.ts`.**
  - In-memory `Map<worktreePath, { pending: Comment[]; delivered: DeliveredComment[] }>`.
  - `Comment` shape: `{ id: string; kind: "line"|"block"|"reply-to-ai-note"|"reply-to-teammate"|"reply-to-hunk-summary"|"freeform"; file?: string; lines?: string; body: string; commitSha: string; supersedes: string | null; enqueuedAt: string }`. (`lines` is a string so `"118"` and `"72-79"` both fit.)
  - `DeliveredComment = Comment & { deliveredAt: string }`.
  - Functions: `enqueue(worktreePath, comments[])`, `pullAndAck(worktreePath): Comment[]` (atomic — empty after first call), `listDelivered(worktreePath): DeliveredComment[]`, `unenqueue(worktreePath, id)` (used by the delete flow in slice 2).
  - **Supersession resolution at pull time.** Before generating the payload, walk the pending list: if a comment's `supersedes` points at another comment that is *also* still pending, drop the predecessor. Chained edits collapse to the latest. If `supersedes` points at a delivered id, leave the new comment alone — it goes out with the `supersedes="<old_id>"` attribute so the agent knows it replaces an earlier note. Unknown `supersedes` ids (server restart, etc.) pass through with the attribute set defensively.
  - **Caveat:** atomicity is per Node event-loop tick; that's enough for the single-process server. Document that two concurrent `pull` calls land "first wins" (cross-session disambiguation in the plan's open questions).
  - **Caveat:** queue grows unbounded if nobody pulls. Cap `delivered` history at e.g. 200 per worktree (drop oldest); pending has no realistic upper bound but is small in practice.

- [x] **`POST /api/agent/enqueue` in `server/src/index.ts`.**
  - Body: `{ worktreePath: string; commitSha: string; comment: Omit<Comment, "id"|"enqueuedAt"|"commitSha"> & { supersedes?: string | null } }`. Single-comment shape — matches the client function (one Reply at a time) and the plan's § Architecture wording.
  - Validation: `worktreePath` via `assertGitDir`. The server binds only on `127.0.0.1` (no LAN exposure — § Transport security in the plan).
  - Returns `{ id: string }`.

- [x] **`POST /api/agent/pull` in `server/src/index.ts`.**
  - Body: `{ worktreePath: string }`.
  - Returns `{ payload: string; ids: string[] }` where `payload` is the `<reviewer-feedback>`-wrapped string (empty string when nothing pending).
  - Marks pulled comments as delivered before returning. **Atomic** in the sense that a second concurrent caller sees an empty queue.
  - **Caveat:** the MCP tool fires once per `check shippable` prompt — not hot. No need for special micro-optimization beyond keeping it disk-free.

- [x] **`GET /api/agent/delivered?path=<worktreePath>` in `server/src/index.ts`.**
  - Query param: `path` is the URL-encoded `worktreePath`. GET (not POST) — read-only history fetch, cacheable, easy to curl.
  - Returns `{ delivered: DeliveredComment[] }` ordered newest first.
  - Used by the UI to flip pips and render the Delivered (N) block (slice 4).

- [x] **`POST /api/agent/unenqueue` in `server/src/index.ts`.**
  - Body: `{ worktreePath: string; id: string }`.
  - Drops a *pending* comment by id (delete-before-delivered flow, motivated by § Edit & delete in the plan). No-op if the id is already delivered.
  - Returns `{ unenqueued: boolean }`.
  - **Note:** the plan's § Architecture diagram lists three endpoints; this is the fourth, motivated by § Behavior § Edit & delete. Update the plan's diagram in slice 5's doc-updates pass.

- [x] **Payload formatter.** Renders the `<reviewer-feedback from="shippable" commit="<sha>">…</reviewer-feedback>` envelope wrapping one `<comment file="…" lines="…" kind="…" supersedes="…">…</comment>` per item, sorted by `(file path ascending, line number ascending)` with `freeform` comments at the end in send order. `supersedes` attribute is omitted when null.
  - **Caveat:** comment bodies are markdown — they may contain backticks, angle brackets, etc. Don't HTML-escape them; the model handles raw text fine. Do strip CDATA-breaking sequences (`]]>`) defensively.

- [x] **Tests — `server/src/agent-queue.test.ts` (vitest).** Cover:
  - enqueue → pull round-trip; second pull is empty.
  - sort order: `(file path asc, lines asc)`, freeform last in send order.
  - `supersedes` resolution — predecessor still pending → dropped; predecessor already delivered → predecessor preserved + new comment carries the attribute; unknown predecessor → attribute survives.
  - chained edits collapse to latest in a single pull.
  - `unenqueue` removes a pending id; no-op when the id is already delivered.
  - delivered history cap (drop oldest beyond 200).
  - `assertGitDir` rejects absolute-but-not-a-git-dir, relative paths, and `..`-laced paths.
  - payload formatter strips `]]>` from bodies; preserves backticks/angle brackets in markdown bodies untouched.

- [x] **Tests — `server/src/index.test.ts` integration tier (vitest).** Spin up the express app and exercise the endpoints end-to-end:
  - `POST /api/agent/enqueue` validates body and `worktreePath`; returns `{ id }`.
  - `POST /api/agent/pull` returns the formatted envelope; second concurrent call sees an empty queue ("first wins").
  - `GET /api/agent/delivered?path=…` returns newest-first; rejects requests without the `path` query param.
  - `POST /api/agent/unenqueue` drops pending; no-op on delivered.

**Acceptance:** the vitest suites pass; manual smoke-test (curl against a running dev server) shows enqueue → pull → delivered.

---

## 2. Slice 2 — Author = enqueue

Authoring a thread comment or composer message posts immediately. No Send button, no preview sheet, no `sentToAgentAt` lifecycle.

- [x] **Extend `Reply` in `web/src/types.ts`.**
  - Add `enqueuedCommentId: string | null`. Set when the server returns the id; null until then (also null on enqueue failure — § Failure modes).
  - Migration on read of older localStorage: missing field → `null`. Single line; `web/src/persist.ts` should already tolerate field additions, but verify.

- [x] **Add queue client functions to `web/src/agentContextClient.ts`.**
  - `enqueueComment({ worktreePath, commitSha, comment }): Promise<{ id: string }>` — single-comment shape; the panel only ever enqueues one at a time.
  - `unenqueueComment({ worktreePath, id }): Promise<{ unenqueued: boolean }>` — for delete-before-delivered.
  - `fetchDelivered(worktreePath): Promise<DeliveredComment[]>` — used by slice 4.
  - Type definitions live in `web/src/types.ts` next to `Reply`.

- [~] **Author flow: thread comments.**
  - On submit (Cmd/Ctrl+Enter or click): add the new `Reply` to `ReviewState.replies` with `enqueuedCommentId: null`, then POST `/api/agent/enqueue` in parallel. On success, dispatch a small reducer action that patches the id onto that Reply. On failure, leave the id null and surface a "Save again" affordance on the thread.
  - Skip the enqueue POST entirely when the active `ChangeSet.worktreeSource` is null (URL-ingest, paste, file upload). Reply still saves locally; pip never appears.
  - Touch points: wherever each thread renders its composer today — `ReplyThread.tsx` and the AI-note inline UI. Plain Enter still inserts a newline; the existing send button stays.
  - **Follow-up:**
    - [ ] **Save-again affordance.** When a Reply has `enqueuedCommentId === null` *and* its parent ChangeSet has a `worktreeSource` (i.e. enqueue should have happened but didn't), render a "save again" button on the reply that re-POSTs `/api/agent/enqueue` without `supersedes`. Discriminator: replies authored on a non-worktree changeset never had a chance to enqueue and don't show the affordance; failed enqueues do. Today only a `console.error` runs on failure (`web/src/App.tsx:703`). Touch points: `ReplyThread.tsx` (render the button next to the pip slot), `App.tsx` (the retry handler — same shape as `onSubmitReply`'s enqueue path, minus the local-add).

- [x] **Author flow: free-form composer.**
  - The `SendToAgent` component's `submit()` builds a single `kind: "freeform"` comment (no `file`/`lines`, body = the textarea text) and posts to `/api/agent/enqueue`.
  - Status flow simplifies to `idle → enqueuing → done/error`. The previous file-based polling on the composer disappears; freeform comments get pips alongside everything else (or, if we don't visualize freeform pips in v0, the composer just clears on success — decide during implementation).
  - Keep the per-worktree draft persistence that exists today.

- [ ] **Edit flow.**
  - When the user edits a Reply that has a non-null `enqueuedCommentId`, save POSTs a fresh enqueue with `supersedes: <previous enqueuedCommentId>`. The new server id replaces `Reply.enqueuedCommentId`; pip resets to ◌.
  - Editing a Reply with `enqueuedCommentId === null` (failed enqueue, or pre-MCP record) just retries the enqueue without `supersedes`.
  - **Subtasks:** *(Replies are immutable today — the only affordance on a saved Reply is the delete button at `web/src/components/ReplyThread.tsx:67-77`. Types and the queue API already support `supersedes`; no caller wires it up.)*
    - [ ] **Edit-reply UI.** Add an "edit" button on user-authored replies that swaps the body into a composer pre-filled with the current text. Cancel restores; save dispatches the new reducer action below. Same composer component as the "+ reply" path; it can take an optional `initialBody`.
    - [ ] **Reducer action `EDIT_REPLY`.** Mutates `state.replies[key][i].body` and resets `enqueuedCommentId` to `null` synchronously, so the pip flips back to "no pip" until the new id arrives. Add the test alongside the existing reply reducer tests in `web/src/state.test.ts`.
    - [ ] **Wire `enqueueComment` with `supersedes`.** In an `App.tsx` `onEditReply` handler, POST `enqueueComment` with `supersedes: <previous enqueuedCommentId>` and patch the new id onto the Reply via the existing `PATCH_REPLY_ENQUEUED_ID`. If the previous `enqueuedCommentId` was null (no predecessor — failed enqueue or pre-MCP record), retry without `supersedes`.
    - [ ] **Component test.** Edit on an enqueued Reply → `enqueueComment` called with `supersedes` set to the prior id; pip resets to ◌ then flips to ✓ when delivery lands. Lives in `ReplyThread.test.tsx` next to the existing pip-state tests.

- [~] **Delete flow.**
  - Reply has `enqueuedCommentId` and *not* in `deliveredIds`: POST `/api/agent/unenqueue`, then remove the local Reply.
  - Reply is in `deliveredIds`: local-only. Confirm dialog or tooltip: "the agent already saw this; deleting only removes it from your view."
  - Reply has `enqueuedCommentId === null`: local-only, no server call.
  - **Follow-up:**
    - [ ] **Delivered-delete tooltip.** When a Reply's `enqueuedCommentId` is in the delivered set, the delete button's `title` should read exactly `the agent already saw this; deleting only removes it from your view.`. Today the title is the generic `delete reply` (`web/src/components/ReplyThread.tsx:75`). The button already lives in a render path that has access to `deliveredById` (threaded in for pip rendering), so this is a small conditional title swap, no new prop plumbing.

- [x] **Tests — reducer (vitest, no DOM).** Whichever reducer file owns `ReviewState.replies` mutations gets:
  - new-reply action stores `enqueuedCommentId: null`; the patch-id action sets it.
  - edit on a Reply with a non-null id flips the in-memory state cleanly (no duplication, no orphan); the new id replaces the old.
  - delete preserves Replies that are already in `deliveredIds` until the local-delete action runs.
  - localStorage migration: a persisted `Reply` without `enqueuedCommentId` rehydrates to `null`.

- [~] **Tests — component (vitest + Testing Library).** `ReplyThread.test.tsx`, `SendToAgent.test.tsx`, and `AgentContextSection.test.tsx`:
  - **Pending sub-bullets that block on the UI work above:**
    - [ ] submit failure → "Save again" affordance renders; second click retries the enqueue *without* `supersedes`. Blocked on Author-flow Save-again follow-up.
    - [ ] edit on an enqueued Reply → enqueue called again with `supersedes` set to the prior id. Blocked on Edit-flow subtasks.
    - [ ] delete on a delivered Reply → no network call; tooltip reads exactly `the agent already saw this; deleting only removes it from your view.`. Blocked on Delete-flow follow-up.
  - submit on thread composer with worktree loaded → `enqueueComment` called once with the right shape (incl. `commitSha` from the active `WorktreeSource`); reply renders without a pip until the resolved id lands.
  - submit on thread composer with no worktree loaded → no network call; Reply still appears in the thread.
  - **agent-feedback panel is hidden entirely when `ChangeSet.worktreeSource` is null** (composer, install affordance, delivered block all absent — § Authoring "Panel renders only when a worktree is loaded").
  - submit failure → "Save again" affordance renders; the failed Reply's `enqueuedCommentId` stays null; second click retries the enqueue *without* `supersedes` (no predecessor — the original POST never landed an id).
  - edit on an enqueued Reply → enqueue called again with `supersedes` set to the prior id.
  - delete on an undelivered Reply → `unenqueueComment` called; delete on a delivered Reply → no network call; tooltip on the delete affordance reads exactly: "the agent already saw this; deleting only removes it from your view."
  - **draft persistence across worktree switches:** half-typed composer text in worktree A survives a switch to worktree B and back to A (the existing per-worktree-draft mechanism continues to apply under the new submit path).

**Acceptance:** test suites pass; manual end-to-end — writing 5 thread comments produces 5 server queue entries with ids round-tripped onto the local Replies. Editing one produces a 6th queue entry with `supersedes` set. Deleting an undelivered comment shrinks the queue. Reload preserves `enqueuedCommentId` via localStorage. Authoring in a non-worktree changeset never hits the network.

---

## 3. Slice 3 — MCP server

A tiny TypeScript MCP server. Lives in its own package so users install it via the harness's `mcp add`-style command.

- [x] **New package `mcp-server/`.**
  - `package.json` with `bin` pointing at the entrypoint, an `npm`-publishable name (e.g. `@shippable/mcp-server`), workspace-independent (does not depend on `web/` or `server/`). The README spells out per-harness install (Claude Code, Codex, Cursor, …).
  - Standard MCP TypeScript SDK setup. Standalone publish target.

- [x] **Tool `shippable_check_review_comments`.**
  - Description tuned aggressively for prompt drift: "Check Shippable for pending reviewer comments. Call this tool when the user mentions reviewing code, pulling reviewer feedback, checking shippable, or asks about review comments."
  - Input schema: `{ worktreePath?: string }`. When absent, resolve from `process.cwd()`.
  - Body: POST `/api/agent/pull` with the resolved `worktreePath` to `http://127.0.0.1:<port>`. Port resolution: `SHIPPABLE_PORT` env var if set, else the dev-server default. The `mcp add` install line surfaced in slice 5 always passes `SHIPPABLE_PORT` explicitly so the user has one source of truth; the env-var fallback is the authoritative path. Confirm the dev-server default matches `server/src/index.ts` at implementation time and pin it as a constant in both the server and `mcp-server`.
  - Output: the `payload` string from `/api/agent/pull` as the tool result text. If empty, return a short "No pending comments." string so the model doesn't hallucinate.

- [~] **Install line.** Documented in the README and surfaced by slice 5's onboarding affordance:
  - Claude Code: `claude mcp add shippable -- npx -y @shippable/mcp-server` (final shape lands during slice 3 implementation; verify against the version of CC we target).
  - Codex CLI: equivalent `codex mcp add` form.
  - Cursor / Cline / others: their respective config-snippet form.

  **Caveat:** the install line must encode the port if it's not the default. § Transport security in the plan calls this out — if the user changes `PORT` later they re-run `mcp add` with the new port.

  **Follow-up:**
  - [ ] **Switch the affordance + README to the local-build install line.** Until `@shippable/mcp-server` ships on npm, the `npx -y @shippable/mcp-server` form 404s. The panel's install chip and the README's primary install line should be `claude mcp add shippable -- node <absolute-path>/mcp-server/dist/index.js`. The affordance can't hard-code an absolute path, so `server/src/mcp-status.ts` resolves it from `mcp-server/dist/index.js` relative to its own source location (`import.meta.url`) and the endpoint returns it alongside `{ installed }` (e.g. `{ installed, installCommand }`); the affordance copies whatever the server returns. README keeps both forms but leads with the local-build one and labels the npx line as "once published". Switching back happens automatically when the npm publish (§7) lands and the resolver short-circuits to the npx form.

- [x] **Tests — `mcp-server/src/tool.test.ts` (vitest).** *(landed as `mcp-server/src/handler.test.ts` — same scope, renamed during implementation)*
  - Tool handler with a mocked `fetch` against `/api/agent/pull` returns the upstream payload as the tool result.
  - Empty payload → "No pending comments." string.
  - `worktreePath` absent → resolves to `process.cwd()`.
  - `worktreePath` present → wins over `process.cwd()` (explicit input overrides cwd).
  - Upstream HTTP error → tool returns a structured error result, doesn't throw out of the handler.

- [x] **Smoke test (manual checklist in the slice's PR).** From a fresh repo: `claude mcp add shippable …`, prompt `check shippable` in a worktree with one queued comment, assert the agent emits the envelope as a tool result. *(Walked through manually 2026-05-06 with the local-build install line; pip flipped, envelope emitted.)*

**Acceptance:** vitest passes; manual smoke `claude mcp add shippable …` succeeds; prompting `check shippable` makes the agent call the tool and emit the `<reviewer-feedback>` envelope as the tool result.

---

## 4. Slice 4 — Delivered (N) block + pips

Reuses `/api/agent/delivered`. The slice that closes the loop visually. **Depends on slice 2** for `Reply.enqueuedCommentId` and the enqueue-on-submit flow.

- [x] **Pips on threads.**
  - Render on every thread that has at least one Reply with `enqueuedCommentId` set. Three states: no pip (id null), `◌ queued` (set, not in `deliveredIds`), `✓ delivered` (in `deliveredIds`). Tooltips per § Pip semantics in the plan ("Sent to your agent's queue at HH:MM:SS." → "Fetched by your agent at HH:MM:SS.").
  - Lives wherever each thread renders today — likely `ReplyThread.tsx` and the AI-note inline UI. Find the render seams; don't fork a separate component.
  - Brief animation when a pip flips. No toast.

- [x] **Delivered-state polling.**
  - When any thread in the active changeset has a queued (◌) Reply, poll `GET /api/agent/delivered?path=<worktreePath>` every 2s (mirror the existing `fetchInboxStatus` cadence). Reset a 5-min idle timeout each time a new delivery flips a pip. Stop when no pending ids remain.
  - On match (delivered comment id → `enqueuedCommentId`), flip the pip locally and stop watching that one.
  - **Caveat:** ids round-trip via `enqueuedCommentId` on the Reply. Reload restores both the id and the polling loop from `ReviewState.replies` + `fetchDelivered`.

- [x] **`Delivered (N)` collapsed `<details>` block in `AgentContextSection.tsx`.**
  - Sits below the existing transcript tail / above the composer.
  - Expands to a list of delivered comments newest first: `<file>:<lines> · <kind> · <relative timestamp>` and the body clipped.
  - Reads from `fetchDelivered(worktreePath)` on the same poll cadence.
  - **Caveat:** delivered list is bounded server-side (slice 1). Show "(showing last 200)" when the cap is hit.

- [x] **Server-restart hint.** Small dim text near the panel header: `Queue is in-memory — server restart drops unpulled comments.` Only when a worktree is loaded; once.

- [x] **Failure-mode banner.** If `/api/agent/delivered` errors (server unreachable), surface a panel-level banner: "Agent status unavailable — last checked X min ago." Pips freeze in last-known state. No third glyph.

- [x] **Tests — component (vitest + Testing Library + fake timers).**
  - polling kicks off only when at least one Reply has a pending `enqueuedCommentId`; stops cleanly when none remain.
  - pip transitions: no pip → ◌ when id arrives → ✓ when delivered set contains it.
  - **pip tooltip copy** matches the plan exactly: ◌ → "Sent to your agent's queue at HH:MM:SS." and ✓ → "Fetched by your agent at HH:MM:SS." (assert against the rendered `title`/aria attribute, regex-tolerant on the timestamp).
  - 5-min idle timeout fires; new delivery resets it.
  - delivered fetch error renders the banner with copy "Agent status unavailable — last checked X min ago." (regex-tolerant on the relative time); pips freeze in last-known state.
  - **server-restart hint** renders with copy "Queue is in-memory — server restart drops unpulled comments." once, when a worktree is loaded; absent when no worktree is loaded.
  - Delivered (N) block: hides at N=0; renders newest-first; "(showing last 200)" suffix surfaces when the server caps.

**Acceptance:** test suites pass; manual end-to-end — authoring 3 thread comments shows 3 `◌ queued` pips; running `check shippable` in a CC session in that worktree flips them to `✓ delivered` within 2s and produces a Delivered (3) block. Reload preserves pip state (it's in `ReviewState`, refetched from the server on mount).

---

## 5. Slice 5 — Onboarding affordance + cleanup of legacy push channel

Replaces the hook-install affordance and deletes the file-based mechanism.

- [x] **Install affordance in `AgentContextSection.tsx`.**
  - Renders prominently at the panel top when not detected (or not dismissed).
  - Per-harness install line: copy-to-clipboard. Default to whichever we detect (Claude Code if `~/.claude/...` exists, else generic).
  - Magic-phrase copy box: `check shippable`.
  - Both the install line and the magic phrase are click-to-copy with a small "copied ✓" feedback.
  - Hides entirely when `ChangeSet.worktreeSource` is null (panel-level rule from § Authoring).

- [~] **Detection.**
  - Claude Code: parse the relevant CC config (whatever lives next to `~/.claude/settings.local.json` for MCP entries — verify against the current CC version when implementing). If a `shippable` MCP entry is found, collapse the install section to a small "MCP installed ✓" line.
  - Other harnesses: no programmatic detection — render an **"I installed it"** dismiss button that hides the section. The dismiss state is persisted in localStorage per-machine (one flag), not per-worktree, not per-account.
  - **Follow-up (caught during smoke-test):**
    - [ ] **Read `~/.claude.json` too.** `claude mcp add shippable …` writes to `~/.claude.json` (top-level `mcpServers` for `--scope user`, or `projects.<absolute-path>.mcpServers` for project-scoped installs), *not* `~/.claude/settings.json` / `~/.claude/settings.local.json`. The current detection in `server/src/mcp-status.ts` reads only the latter two and so misses installed entries. Extend the helper to also load `~/.claude.json` and look for a `shippable` key in both the top-level `mcpServers` and (defensively) under `projects.*.mcpServers`. Malformed/missing → still `{ installed: false }`. Surfaced when smoke-testing slice 5: the panel kept showing the install affordance after a successful `claude mcp add`.

- [x] **Delete file-based push mechanism.**
  - Remove `server/src/inbox.ts` (incl. `ensureExclude`, `inboxStatus`, `writeInbox`).
  - Remove `/api/worktrees/inbox`, `/api/worktrees/inbox-status` from `server/src/index.ts`.
  - Remove `tools/shippable-inbox-hook`.
  - Remove `fetchInboxStatus` and `sendInboxMessage` from `web/src/agentContextClient.ts`.
  - Remove the inbox-status polling loop in `AgentContextSection.tsx` `SendToAgent` (already gone after slice 2's composer migration; double-check).
  - **Caveat:** users with a stale `shippable-inbox-hook` reference in their `settings.local.json` will keep working until they remove it manually — but the file it tries to read (`<worktree>/.shippable/inbox.md`) no longer exists, so it's a benign no-op. Note in the changelog.

- [x] **Delete hook-install machinery.**
  - Remove `server/src/hook-status.ts` (`installHook`, `checkHookStatus`).
  - Remove `GET /api/worktrees/hook-status`, `POST /api/worktrees/install-hook` from `server/src/index.ts`.
  - Remove `fetchHookStatus`, `installHook`, `InstallHookResult` from `web/src/agentContextClient.ts`.
  - Remove the `HookHint` component and any callers in `AgentContextSection.tsx`.

- [x] **Tests — detection + dismiss.**
  - Detection helper: synthetic CC config with a `shippable` entry → returns `{ installed: true }`; absent → `{ installed: false }`; malformed JSON → `{ installed: false }` (no throw).
  - Component: install section renders unless detected or dismissed; "I installed it" click sets the localStorage flag and hides; flag persists across remount.
  - Integration: `GET /api/worktrees/hook-status`, `POST /api/worktrees/install-hook`, `POST /api/worktrees/inbox`, and `POST /api/worktrees/inbox-status` all return 404 (or are absent from the express router) after deletion.
  - Delete the now-stale tests for `inbox.ts` / `hook-status.ts` / `HookHint` as part of the cleanup. `git grep -i 'shippable-inbox-hook\\|hook-status\\|inbox.md'` returns only changelog references after this slice.

- [x] **Doc updates.**
  - `docs/plans/share-review-comments.md` § Architecture: add `POST /api/agent/unenqueue` to the endpoint list in the diagram (motivated by § Edit & delete; the v0 task list adds it as a fourth endpoint).
  - `docs/concepts/agent-context.md`: rewrite § "Two-way: feedback back to the agent" to describe the MCP pull channel; delete § "Why shared `info/exclude`".
  - `docs/features/agent-context-panel.md`: replace the Send-to-agent / hook-install section with the install affordance + magic phrase. Update the latency-model copy.
  - `docs/plans/worktrees.md` § Findings: note that the file-based slice (d) approach was superseded — link to `share-review-comments.md`.
  - `docs/ROADMAP.md`: cross-link this plan from the 0.1.0 row, if not already.

**Acceptance:** test suites pass; the panel shows the install line + magic phrase on a fresh machine; after `claude mcp add shippable …` the section collapses to "MCP installed ✓". `git grep -i 'shippable-inbox-hook'` returns only changelog references. The composer works end-to-end against the queue endpoints.

---

## 6. Cross-cutting

Concerns that don't fit a single slice — verify on the way through.

- [x] **Sort order in the payload formatter.** Locked in by `server/src/agent-queue.test.ts` § "sort order" — file path asc, then line lower-bound asc, freeform last in send order. `lowerLineBound` parses `"72-79"` → 72.

- [x] **`commit` attribute in the envelope.** `WorktreeSource.commitSha` rides on each `Comment` and `formatPayload` emits it on the `<reviewer-feedback commit="…">` envelope. Not a footgun: the agent has the file at HEAD; the sha is informational.

- [x] **`assertGitDir` shared.** Lives in `server/src/worktree-validation.ts`; the queue endpoints (`server/src/index.ts`) and the agent-context worktree validators all import from there.

- [x] **Reload behaviour.** `web/src/persist.ts` rehydrates `Reply.enqueuedCommentId` (covered by `web/src/persist.test.ts` § "Reply.enqueuedCommentId migration"). The polling hook restarts when pending ids exist on mount (covered by `web/src/useDeliveredPolling.test.ts`). Enqueue happens in `App.tsx` `onSubmitReply`, never in a `useEffect` — so a reload cannot double-enqueue.

- [x] **Multi-tab.** Untouched on purpose; pre-existing localStorage limitation.

- [x] **Empty-state polish.** Delivered block hides at N=0 (`AgentContextSection.tsx`). Install affordance hides when `mcpStatus.installed` or the per-machine dismiss flag is set. Pips render only when `enqueuedCommentId` is set (`ReplyThread.tsx`). The whole panel hides when `cs.worktreeSource` is null — Inspector passes `agentContext` only then.

- [x] **CI wiring.** Each package owns its own `npm test` (`web/`, `server/`, `mcp-server/`). README updated to surface the test commands. There is no workspace orchestrator yet — running `npm test` in each directory is the contract.

---

## 7. Out of v0 — captured here so we don't lose them

These are documented as Follow-ups in `share-review-comments.md`. Listed here only so the implementer doesn't accidentally pull them in.

- [ ] *(deferred)* Belt-and-suspenders hooks for users who want mid-turn delivery on Claude Code. The legacy push branch is the reference implementation.
- [ ] *(deferred)* Agent-reply detection back into the comment thread.
- [ ] *(deferred)* Push to idle session — Channels (when GA) or stdin sidecar.
- [ ] *(deferred)* Multi-channel pip generalization (GitHub, Linear, …) — replaces scalar `enqueuedCommentId` with a per-channel id map. Will require a localStorage migration when it lands.
- [ ] *(deferred)* Server-side install verification (`lastPullAt` per worktree → auto-hide install affordance for non-CC harnesses).
- [ ] *(deferred)* SQLite-backed durable queue.
- [ ] *(deferred)* Per-thread send control (stage / unstage toggle).
- [ ] *(deferred)* **Publish `@shippable/mcp-server` to npm.** The package is standalone-publishable (no workspace deps). Once it ships, the install line in the panel affordance and the README flips back to `claude mcp add shippable -- npx -y @shippable/mcp-server` and the local-build path-resolution in `mcp-status.ts` retires. Until then the in-place affordance uses the local-build line (slice 3 follow-up).

---

## Files of interest (cheat sheet)

- `server/src/agent-queue.ts` — **new**, slice 1.
- `server/src/agent-queue.test.ts` — **new**, slice 1.
- `server/src/worktree-validation.ts` — **new**, `assertGitDir` extracted, slice 1.
- `server/src/index.ts` — endpoint wiring (1, 5).
- `server/src/index.test.ts` — endpoint integration tests, slice 1.
- `server/src/inbox.ts` — **delete**, slice 5.
- `server/src/hook-status.ts` — **delete**, slice 5.
- `tools/shippable-inbox-hook` — **delete**, slice 5.
- `mcp-server/` — **new** package, slice 3. Standalone npm-publish target. Includes `src/tool.test.ts`.
- `web/src/types.ts` — `Reply.enqueuedCommentId`, `Comment` / `DeliveredComment` types.
- `web/src/agentContextClient.ts` — `enqueueComment`, `unenqueueComment`, `fetchDelivered`; loses `fetchInboxStatus` / `sendInboxMessage` / `fetchHookStatus` / `installHook` after slice 5.
- `web/src/components/AgentContextSection.tsx` — install affordance, magic-phrase box, Delivered block, server-restart hint.
- `web/src/components/AgentContextSection.test.tsx` — onboarding/dismiss/delivered tests, slices 4–5.
- `web/src/components/ReplyThread.tsx` (and AI-note rendering surfaces) — pip rendering.
- `web/src/components/ReplyThread.test.tsx` — author/edit/delete/pip tests, slices 2 & 4.
- `docs/concepts/agent-context.md`, `docs/features/agent-context-panel.md`, `docs/plans/worktrees.md`, `docs/ROADMAP.md` — doc updates in slice 5.
