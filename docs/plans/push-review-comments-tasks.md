# Push review comments — task breakdown

Companion to [push-review-comments.md](./push-review-comments.md) and the slice-(d)/(e) lane of [worktrees.md](./worktrees.md). This file is the implementer's punch list. Each task names files, acceptance criteria, and the caveats worth knowing before you touch the code.

Legend: `[x]` done · `[ ]` not done · `[~]` partially done (replaced or migrated by a v1 task below)

---

## 0. Foundations already in place

These already shipped and the v1 work layers on top. Listed so the implementer knows what to leave alone vs. what to migrate in slice (e).

- [x] **Worktrees ingest (slice a of `worktrees.md`).** `POST /api/worktrees/list` and `POST /api/worktrees/changeset` (`server/src/worktrees.ts`, wired in `server/src/index.ts`). Loads a worktree's HEAD as a `ChangeSet` carrying `WorktreeSource` (`web/src/types.ts:271-275`).
- [x] **Agent-context read side.** `POST /api/worktrees/sessions` and `POST /api/worktrees/agent-context` (`server/src/agent-context.ts`). UI in `web/src/components/AgentContextSection.tsx` renders task / files-touched / todos / transcript-tail / footer.
- [x] **Free-form composer (file-based — to be migrated).** `POST /api/worktrees/inbox` writes `<worktree>/.shippable/inbox.md`; `POST /api/worktrees/inbox-status` polls. Backed by `server/src/inbox.ts` (incl. `ensureExclude` against `git rev-parse --git-common-dir`/info/exclude). Composer in `AgentContextSection.tsx` `SendToAgent` polls every 2s with a 5-min timeout.
- [x] **Claude Code hook (UserPromptSubmit only).** `tools/shippable-inbox-hook` reads CC's stdin event JSON, extracts `cwd`, prepends `<reviewer-feedback from="shippable">…</reviewer-feedback>` wrapping `inbox.md`, deletes the file.
- [x] **One-click install + detection.** `server/src/hook-status.ts` (`installHook`, `checkHookStatus`); `GET /api/worktrees/hook-status`, `POST /api/worktrees/install-hook`. Writes to `~/.claude/settings.local.json`, drops `<file>.shippable.bak` once on first modification, atomic write.
- [~] **Detection covers `UserPromptSubmit` only.** Will extend to three events in slice (b) below.
- [~] **Detection only matches by basename `shippable-inbox-hook`.** Will need to recognise the renamed `shippable-agent-hook` in slice (b), with a backwards-compatible fallback or migration step.

---

## 1. Slice (a) — Server queue + pull endpoint

The HTTP endpoint is the main contract; everything else is glue over it. Keep the queue agent-agnostic.

- [x] **Create `server/src/agent-queue.ts`.**
  - In-memory `Map<worktreePath, { pending: Comment[]; delivered: DeliveredComment[] }>`.
  - `Comment` shape: `{ id: string; kind: "line"|"block"|"reply-to-ai-note"|"reply-to-teammate"|"reply-to-hunk-summary"|"freeform"; file?: string; lines?: string; body: string; commitSha: string; enqueuedAt: string }`. (`lines` is a string so `"118"` and `"72-79"` both fit.)
  - `DeliveredComment = Comment & { deliveredAt: string }`.
  - Functions: `enqueue(worktreePath, comments[])`, `pullAndAck(worktreePath): Comment[]` (atomic — empty after first call), `listDelivered(worktreePath): DeliveredComment[]`.
  - **Caveat:** atomicity is per Node event-loop tick; that's enough for the single-process server. Document that two concurrent `pull` calls land "first wins" (see Open Questions in the plan, cross-session disambiguation).
  - **Caveat:** queue grows unbounded if nobody pulls. Cap `delivered` history at e.g. 200 per worktree (drop oldest); pending has no realistic upper bound but is small in practice.

- [x] **`POST /api/agent/enqueue` in `server/src/index.ts`.**
  - Body: `{ worktreePath: string; commitSha: string; comments: Array<Omit<Comment, "id"|"enqueuedAt"|"commitSha">> }`.
  - Validation: `worktreePath` absolute, no `..` segments, `.git` entry resolves (reuse the `assertGitDir`-style check from `inbox.ts` — extract to a shared helper).
  - Returns `{ enqueued: number; ids: string[] }`.

- [x] **`POST /api/agent/pull` in `server/src/index.ts`.**
  - Body: `{ worktreePath: string }`.
  - Returns `{ payload: string; ids: string[] }` where `payload` is the `<reviewer-feedback>`-wrapped string the hook prints to stdout (empty string when nothing pending).
  - Marks pulled comments as delivered before returning. **Atomic** in the sense that a second concurrent caller sees an empty queue.
  - **Caveat:** the hook fires per-tool — make sure `pull` is cheap (no disk reads, no `git` invocations).

- [x] **`GET /api/agent/delivered?path=<worktreePath>` in `server/src/index.ts`.**
  - Returns `{ delivered: DeliveredComment[] }` ordered newest first.
  - Used by the UI to flip pips and render the Delivered (N) block.

- [x] **Payload formatter.** Renders the `<reviewer-feedback from="shippable" commit="<sha>">…</reviewer-feedback>` envelope wrapping one `<comment file="…" lines="…" kind="…">…</comment>` per item, sorted by `(file path, line number ascending)` with `freeform` comments at the end in send order.
  - **Caveat:** comment bodies are markdown — they may contain backticks, angle brackets, etc. Don't HTML-escape them; the model handles raw text fine. Do strip CDATA-breaking sequences (`]]>`) defensively. Keep the format identical to the existing `shippable-inbox-hook` envelope so prior hook installs still produce a parseable shape.

**Acceptance:** unit test (or smoke script) shows enqueue → pull returns the payload, second pull is empty, `delivered` lists the pulled item.

---

## 2. Slice (b) — Claude Code hook script v2

Replaces `tools/shippable-inbox-hook`. The script must stay thin enough to clone for other harnesses later.

- [x] **Write `tools/shippable-agent-hook`.**
  - Same shape as the existing script: read JSON from stdin, extract `cwd`, POST `{ worktreePath: cwd }` to `http://127.0.0.1:<server-port>/api/agent/pull`, print response body's `payload` to stdout.
  - The server port: today the existing script reads no env or config — it just deletes a file at a known path. For HTTP we need the port. Options: hard-coded `4179` (current dev port — check `server/src/index.ts`), `SHIPPABLE_PORT` env var with the hard-coded fallback. Pick the env-var-with-fallback shape so the install logic can write the port in if it ever varies.
  - Use `curl -fsS --max-time 2` (curl is on every macOS install; we already require Python). On non-zero exit code or timeout, exit 0 — the hook must never block the agent.
  - **Caveat:** stdout from a `PostToolUse` hook is *not* automatically additionalContext on every CC version. Verify against the version we target. If `PostToolUse` stdout doesn't inject context cleanly, fall back to the documented JSON output shape (`{"hookSpecificOutput": {"additionalContext": "..."}}`) — see Claude Code hook docs. **This needs to be confirmed before wiring (a) is shipped.**

- [x] **Extend `server/src/hook-status.ts`.**
  - Look for the hook script (basename match) across three event arrays: `UserPromptSubmit`, `PostToolUse`, `SessionStart`. Both legacy basename `shippable-inbox-hook` and new `shippable-agent-hook` count, so an existing install still detects.
  - Return shape grows: `{ installed: boolean; partial: boolean; missing: ("UserPromptSubmit"|"PostToolUse"|"SessionStart")[] }`. `installed: true` only when all three are present.

- [x] **Extend `installHook()` in `server/src/hook-status.ts`.**
  - Idempotently merges three matcher entries into `~/.claude/settings.local.json` `hooks.{UserPromptSubmit,PostToolUse,SessionStart}`. Keep the same atomic-write + first-modification-only backup discipline.
  - Resolve to `tools/shippable-agent-hook` (rename — the old basename stops being shipped).
  - **Caveat:** users with the old hook installed will end up with both `shippable-inbox-hook` (in `UserPromptSubmit`) and `shippable-agent-hook` (in all three) until they manually remove the legacy entry. Either (a) detect and rewrite the legacy entry in-place, or (b) ship the rename in a separate doc/migration note. (a) is friendlier.

- [x] **Update `HookHint` in `AgentContextSection.tsx`.**
  - "Inbox hook not detected" → split into "not installed" and "partially installed (missing: PostToolUse, SessionStart)".
  - The static snippet shown for manual paste also grows to three events.

**Acceptance:** fresh `~/.claude/settings.local.json` + click Install → all three event arrays gain our matcher; running CC in a worktree, queueing a comment, then doing one tool call delivers the comment within seconds.

---

## 3. Slice (c) — UI: Send button + preview sheet + sent pips

The user-facing change. Ships behind the queue from slice (a) — slice (b) is what lets it actually reach the agent in CC.

- [x] **Extend `Reply` in `web/src/types.ts`.**
  - Add `sentToAgentAt: string | null` (ISO timestamp; null = unsent).
  - Add to all reply-key categories: `lineNoteReplyKey`, `hunkSummaryReplyKey`, `teammateReplyKey`, `userCommentKey`, `blockCommentKey`. Whatever serialises through `ReviewState.replies` keeps the field across reload.
  - Migration on read of older localStorage: missing `sentToAgentAt` → `null`. Single line; the persistence layer in `web/src/persist.ts` should already tolerate field additions but verify.

- [x] **Add `enqueueComments` and `fetchDelivered` to `web/src/agentContextClient.ts`.**
  - `enqueueComments({ worktreePath, commitSha, comments }): Promise<{ enqueued: number; ids: string[] }>`.
  - `fetchDelivered(worktreePath): Promise<DeliveredComment[]>`.
  - Type definitions live in `web/src/types.ts` next to `Reply`.

- [x] **Send-batch button in `AgentContextSection.tsx`.**
  - Visible whenever there's at least one comment with `sentToAgentAt: null` for the current changeset's worktree.
  - Label: `Send N comment{N!==1?"s":""}` with the count.
  - Disabled when N === 0 or while the preview sheet is open.

- [x] **Preview sheet.**
  - Lists every unsent comment grouped by file (freeform at the end).
  - Default-on checkbox per row; one-line preview = the comment body trimmed/clipped to ~80 chars.
  - "What the agent will see" toggle exposes the rendered `<reviewer-feedback>` payload as a `<pre>` block — same string the hook will emit.
  - Confirm button enqueues only the checked rows. On success, sets `sentToAgentAt = new Date().toISOString()` for those replies in `ReviewState.replies` and closes the sheet.
  - **Caveat:** the user can deselect rows but cannot reorder — sort order is fixed by the server (file/line, freeform last). Document this in the sheet's footer text.

- [x] **Pips on threads.**
  - On every thread (line note, block, reply-to-ai-note, reply-to-teammate, reply-to-hunk-summary), display a pip when at least one reply has `sentToAgentAt != null`.
  - Pip states: `◌ queued` (sent but not yet delivered) → `✓ delivered` (server confirmed via `/api/agent/delivered`).
  - Title attribute carries the timestamp.
  - Lives wherever each thread renders today — likely `ReplyThread.tsx` and the AI-note inline UI. Find the render seams; don't fork a separate component.

- [x] **Delivered-state polling.**
  - When any thread in the active changeset has a `queued`-state reply, poll `GET /api/agent/delivered?path=<worktreePath>` every 2s (mirror the existing `fetchInboxStatus` cadence). Stop after 5 min idle (mirror existing timeout).
  - On match (delivered comment id → enqueued reply id), flip the pip and stop polling that one.
  - **Caveat:** the comment id needs to round-trip. `enqueueComments` returns server-assigned ids; the UI stores them on the Reply alongside `sentToAgentAt`. Add `sentToAgentId: string | null` to `Reply` in the same migration as `sentToAgentAt`.

- [x] **"Server in-memory" hint.**
  - Small dim text below the Send button: `Queue is in-memory — server restart drops unpulled comments.` Once. Don't repeat per-thread.

- [x] **Latency-model copy.**
  - The Send button's status line after a send reads: `queued — delivers on the agent's next tool call or session start.` Honest about not pushing to idle.

**Acceptance:** write 5 comments across 3 files, hit Send, deselect one in the preview, confirm. Four pips flip to `◌ queued`. Run any tool in a CC session in that worktree; pips flip to `✓ delivered`. Reload the page; pips persist (they're in `ReviewState`).

---

## 4. Slice (d) — Delivered history block

Small read-only block answering "did the agent see this?"

- [x] **`Delivered (N)` collapsed `<details>` block in `AgentContextSection.tsx`.**
  - Sits below the existing transcript tail / above the composer-and-send block.
  - Expands to a list of delivered comments newest first: `<file>:<lines> · <kind> · <relative timestamp>` and the body clipped.
  - Reads from `fetchDelivered(worktreePath)`; refreshed alongside the polling loop from slice (c).
  - **Caveat:** delivered list is bounded (slice a). Show "(showing last 200)" when the cap is hit.

**Acceptance:** sending and delivering 3 comments produces a Delivered (3) block with all three; reload preserves the visibility (it's a server fetch, not a localStorage thing).

---

## 5. Slice (e) — Free-form composer migration

The cleanup. Replaces the file-based mechanism with the new queue. Ship after (a)–(d) are stable so we can fall back if the new channel surfaces a regression.

- [ ] **Composer enqueues via `enqueueComments`.**
  - The `SendToAgent` component's `submit()` builds a single `kind: "freeform"` comment (no `file`/`lines`, body = the textarea text) and posts to `/api/agent/enqueue`.
  - Status flow stays identical from the user's perspective: `idle → sending → queued → delivered/error`.
  - The `delivered` flip uses the same `/api/agent/delivered` polling as slice (c) instead of `/api/worktrees/inbox-status`.

- [ ] **Delete file-based mechanism.**
  - Remove `server/src/inbox.ts` (incl. `ensureExclude`, `inboxStatus`, `writeInbox`).
  - Remove the `/api/worktrees/inbox` and `/api/worktrees/inbox-status` endpoints from `server/src/index.ts`.
  - Remove `tools/shippable-inbox-hook`.
  - Remove `fetchInboxStatus` and `sendInboxMessage` from `web/src/agentContextClient.ts`.
  - Remove the inbox-status polling in `AgentContextSection.tsx` `SendToAgent`.
  - **Caveat:** any user with a previously-installed `shippable-inbox-hook` reference in their `settings.local.json` will keep working until they remove it manually — but the file it tries to read (`<worktree>/.shippable/inbox.md`) will no longer be created, so it's a benign no-op. Note this in the changelog. The slice (b) install logic is the right place to rewrite legacy entries to the new hook script in-place.

- [ ] **Delete the worktree's stale `.shippable/` dir on next composer send.**
  - Optional. The `info/exclude` line is fine to leave (cheap, invisible). The `.shippable/` dir is empty after the file deletion. If we want the worktree fully clean, the new enqueue endpoint can `rm -rf <worktree>/.shippable/inbox.md` once. Don't touch `info/exclude` — could be edited by the user.

- [ ] **Doc updates.**
  - `docs/concepts/agent-context.md`: rewrite § "Two-way: feedback back to the agent" to describe the queue/hook channel; delete § "Why shared `info/exclude`".
  - `docs/features/agent-context-panel.md`: update Send-to-agent affordance section, hook recipe section (3 events), latency model copy.
  - `docs/plans/worktrees.md` § Findings: add a note that slice (d)'s file-based approach was superseded — link to `push-review-comments.md`.
  - `docs/ROADMAP.md`: cross-link this plan from the 0.1.0 row, if not already.

**Acceptance:** the composer works end-to-end with `inbox.md` absent from the codebase; `git grep -i inbox` returns only doc/changelog references.

---

## 6. Cross-cutting

Concerns that don't fit a single slice — verify on the way through.

- [ ] **Sort order in the payload formatter.** File path ascending, then line number ascending (parse `lines` like `"72-79"` → take the lower bound), freeform last in send order. Document with a unit test against a small fixture so the rule is enforceable, not "we'll get it right."

- [ ] **`commit` attribute in the envelope.** The `WorktreeSource.commitSha` from the active changeset travels through `enqueueComments` → server → payload. If a changeset is reloaded between send and pull and the commit changed, the agent still sees the original `commit=` it was reviewed at. Confirm this isn't a footgun (it isn't — the agent has the file at HEAD; the sha is informational).

- [ ] **Hook-frequency sanity check.** A 50-tool turn fires `PostToolUse` 50 times. The endpoint is cheap, but log volume on the server is real. Drop the per-pull log to debug-level, keep enqueue and first-non-empty-pull at info.

- [ ] **Reload behaviour.** After a full page reload while comments are queued: `sentToAgentAt`/`sentToAgentId` are in localStorage; the polling loop restarts from `fetchDelivered`. Verify no double-send, no duplicate pip flips.

- [ ] **Empty-state polish.** "Send 0 comments" never renders — the button is hidden when nothing's unsent. The Delivered block hides at N=0.

---

## 7. Out of v1 — captured here so we don't lose them

These are documented as Future channels / Follow-ups in `push-review-comments.md`. Listed here only so the implementer doesn't accidentally pull them in.

- [ ] *(deferred)* Per-comment Send button.
- [ ] *(deferred)* Re-send after edit (needs `supersedes` link).
- [ ] *(deferred)* Agent-reply detection back into the comment thread.
- [ ] *(deferred)* Push to idle session — Channels plugin or stdin sidecar.
- [ ] *(deferred)* Other harnesses (Codex CLI, Cursor IDE, OpenCode hooks; MCP pull-tool).
- [ ] *(deferred)* SQLite-backed durable queue.

---

## Files of interest (cheat sheet)

- `server/src/agent-queue.ts` — **new**, slice (a).
- `server/src/index.ts` — endpoint wiring (a, b, e).
- `server/src/hook-status.ts` — detect + install across 3 events (b).
- `server/src/inbox.ts` — **delete**, slice (e).
- `tools/shippable-agent-hook` — **new**, replaces `shippable-inbox-hook` (b).
- `tools/shippable-inbox-hook` — **delete**, slice (e).
- `web/src/types.ts` — `Reply` extension, `Comment` / `DeliveredComment` types.
- `web/src/agentContextClient.ts` — `enqueueComments`, `fetchDelivered`; loses `fetchInboxStatus` / `sendInboxMessage` after (e).
- `web/src/components/AgentContextSection.tsx` — Send button, preview sheet, Delivered block, hook hint partial-state.
- `web/src/components/ReplyThread.tsx` (and AI-note rendering surfaces) — pip rendering.
- `docs/concepts/agent-context.md`, `docs/features/agent-context-panel.md` — doc updates in slice (e).
