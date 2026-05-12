# Implementation Notes — Agent Comments

## Deviations from Spec / Plan

### Web-side `AgentReply` was kept; `AgentComment` was added alongside it (not renamed)
- **Plan said**: rename web-side `AgentReply` interface to `AgentComment` with the discriminated shape mirroring the server, updating call sites.
- **Implementation does**: `AgentReply` stays as the flat shape `{ id, body, outcome, postedAt, agentLabel? }` and continues to populate `Reply.agentReplies[]`. `AgentComment` is added as a new discriminated type matching the server wire format; only top-level (`anchor`-shaped) entries land in the new `state.agentComments` slot. The polling layer translates `parent`-shaped wire entries into the flat `AgentReply` shape before dispatching `MERGE_AGENT_REPLIES`. The plan explicitly permitted "a narrower local alias of 'reply-shaped AgentComment' if it reads cleaner where `commentId` + `outcome` were flat."
- **Reason**: many existing code paths (`mergeAgentReplies` reducer, `PolledAgentReply` type, `Reply.agentReplies[]` consumers in `ReplyThread.AgentRepliesList`, all fixture files) read flat fields like `ar.outcome` and `ar.commentId`. Renaming would have forced `ar.parent.outcome` / `ar.parent.commentId` everywhere with no behavior gain on the reply-only code path. Keeping `AgentReply` flat preserves those reads; the discriminated `AgentComment` only surfaces at the wire/storage boundary and in `state.agentComments`.
- **Impact**: zero behavior change for the existing reply path. Future readers should know:
  - Server-side: one type `AgentComment` (discriminated) covers both shapes.
  - Web-side: `AgentReply` (flat) is the in-memory shape for the existing reply-nested-under-Reply path; `AgentComment` (discriminated) is the wire shape and the in-memory shape for top-level entries.
  - The translation lives in `useDeliveredPolling.ts`'s `splitAgentComments` helper.
  - The unification refactor (separate feature, owned by another teammate) will likely collapse both names.

### `ReplyThread` identity treatment for `agentComment:` is rendered by the caller, not by `ReplyThread` itself
- **Plan said**: add identity treatment to `ReplyThread.tsx` when a `Reply`'s parent key starts with `agentComment:`, showing the agent root-identity (agent label + `file:lines`) above the thread.
- **Implementation does**: `ReplyThread.tsx` is unchanged. The agent root-identity (label + anchor + body) is rendered by the parent (`AgentContextSection.AgentCommentsBlock`) above the `ReplyThread`, mirroring the existing pattern where `Inspector` renders the root identity (AI note, hunk summary, teammate) above its `ReplyThread`.
- **Reason**: the existing pattern in `Inspector.tsx` (`TeammateSection` mounts `ReplyThread`, not the other way around) makes the caller responsible for the root. Putting it inside `ReplyThread` would have required a new `parentKey` prop and special-case rendering for one prefix, departing from the established pattern.
- **Impact**: cleaner — no new prop on `ReplyThread`, the consistent "caller renders the root, `ReplyThread` renders the thread" rule holds. Plan's expected coverage for the identity treatment is covered by `AgentContextSection` tests.

### File-level top-level agent comments resolved as "disallowed for v0"
- **Spec said** (final): file-level (no `lines`) disallowed for v0 because the reviewer UI has no file-level comment slot. Pair with future file-level user-comment support.
- **Implementation does**: tool input rejects `anchor.lines` missing/empty at both the MCP boundary description ("File-level (no `lines`) is not supported yet") and the server validation (`POST /api/agent/comments` returns 400 with a clear error). The `AgentComment.anchor.lines` server type is `string` (not optional). Web-side `AgentComment.anchor.lines` is also non-optional.
- **Impact**: agents that try file-level get a fast, clear failure. Documented in `mcp-server/README.md`.

### `Comment.parentAgentCommentId` is a dedicated field, not an overload of `supersedes`
- **Decision in spec**: keep `parentAgentCommentId` distinct from `supersedes`. Reuse rejected because the dual meaning is confusing and the unification refactor would have to untangle it.
- **Implementation does**: new optional field `parentAgentCommentId?: string` on the `Comment` interface (both server and web sides). Required by `POST /api/agent/enqueue` when `kind === "reply-to-agent-comment"`; validated against the worktree's agent-comment store via `isAgentCommentId`. Surfaces in the pull envelope as the `parent-id` attribute on `<comment kind="reply-to-agent-comment" parent-id="…">`.
- **Impact**: clean semantics for the agent ("this id is the agent-comment I'm replying to"), no overloading.

## Notes

### Endpoint contract change is hard-cut (no grace window)
The legacy `/api/agent/replies` POST and GET endpoints return 404 immediately. There are no external callers of the local server today, so a sunset window wasn't worth implementing. Tests explicitly cover the 404 to lock that in.

### `formatPayload` signature change is backward-compatible
`formatPayload(comments, commitSha)` still works — the new `lookupAgentComment` argument is optional. When absent, `reply-to-agent-comment` entries are emitted with `parent-missing="true"` (the same fallback used when the parent has aged out of the cap-200 window). All existing call sites that don't deal with the new kind continue to work unchanged.

### Persist `v: 3` migration is forward-only and additive
The migration appends `agentComments: []` to v2 snapshots. No existing field is rewritten. v2 → v3 is a no-op for the agent-comments slot until the next poll of `/api/agent/comments` populates it.

### Web rendering reuses `ReplyThread`, not a new visual primitive
The `AgentCommentsBlock` in `AgentContextSection.tsx` mounts `ReplyThread` per agent comment with the standard reviewer-reply handlers. The reviewer's reply enqueue carries `kind: "reply-to-agent-comment"` and `parentAgentCommentId`; the pip system (`◌ queued` → `✓ delivered`) and the agent-replies-under-reviewer-reply nesting (`Reply.agentReplies[]`) work the same as for other root kinds.

### Manual browser smoke not run
The implementation environment is a sandboxed devcontainer without an interactive browser session. All automated checks ran green (`server/` typecheck + vitest 294 tests; `mcp-server/` typecheck + vitest 29 tests + build; `web/` typecheck + lint + vitest 449 tests + production build).

Visual treatment of the new "Agent comments (N)" block in `AgentContextSection.css` uses conventions already in use elsewhere in the file (variables `--border`, `--fg`, `--fg-dim`, `--fg-mute`; flex column layout matching `.ac__delivered-list`). The human partner should:
1. Start `server/` and `web/`.
2. Install the MCP into a chat harness (e.g. `claude mcp add shippable -- node /absolute/path/to/mcp-server/dist/index.js`).
3. Ask the agent to post a top-level comment: e.g. "post a comment to shippable on `src/foo.ts` line 42 saying X."
4. Open the worktree-loaded ChangeSet in the web UI. The panel's "Agent comments (N)" block should show the entry.
5. Click "+ reply" under the agent comment, type, hit send. The pip should flip `◌ queued` → `✓ delivered` once the agent next pulls.
6. Ask the agent to "report back to shippable" — the agent should see the reply in the envelope (with `<parent>` context) and post a structured reply via the same tool's reply mode. The nested agent reply should surface under the reviewer's reply.

### Follow-ups (not blockers)

- **File-level user + agent commenting** (paired). Adding a file-header comment affordance for users will unblock relaxing `lines` to optional on the MCP tool input. Single coordinated change avoids a one-sided UX.
- **Diff-view marker for top-level agent comments.** Today they're discoverable via the agent-context panel and the sidebar file-badge counter (which already counts agent-comment-keyed replies via `state.replies`). A gutter pip or file-header icon would surface them in the diff view directly; defer until panel-only discoverability shows real cost.
- **Sidebar file-badge counter for `state.agentComments`.** Currently the sidebar's `commentCount` only counts replies. Top-level agent comments themselves (with no reviewer reply yet) don't increment the badge. Small `view.ts` change once we know it's worth it.
- **Unification of `AgentReply` and `AgentComment` (web side).** Handled by another teammate's feature.
- **SSE / WebSocket transport.** Continued REST polling; SSE remains a tracked cross-feature follow-up.

## Post-implementation review fixes

After the initial implementation landed, five review subagents (architecture, security, reuse/patterns, bug-hunt, general) audited the branch. The fixes here addressed the actionable findings; non-actionable items are listed under "Reviews that deliberately landed no fix" below.

### `onRetryReply` was a silent no-op for agent-comment threads (Bug)
- **Issue**: `ReviewWorkspace.onRetryReply` called `deriveCommentPayload(key, cs)` without the third `state.agentComments` argument. For a reply key of `agentComment:<id>` the derivation returned `null` → the handler exited before sending the retry POST. Clicking the errored pip did nothing.
- **Fix**: pass `state.agentComments` to `deriveCommentPayload` in the retry path, mirroring the submit path.

### `state.agentComments` leaked across worktree switches (Bug)
- **Issue**: the dispatch effect early-returned when `polledAgentComments.length === 0`. On worktree switch the polling hook resets its polled list to `[]`, so the previous worktree's comments stayed in `state.agentComments` and rendered in the new worktree's panel until the new poll arrived. Reply-shaped agent entries didn't suffer the same leak because they're gated by hunk-anchored reply keys, which embed the changeset id.
- **Fix**: `mergeAgentComments` switched from merge-by-id to replace-by-polled-batch with a structural-equality short-circuit to preserve the no-rerender invariant. The `ReviewWorkspace` dispatch effect no longer early-returns on empty batches, so the worktree-switch reset propagates. Added regression tests for the evict-on-poll and clear-on-empty-batch cases.

### Envelope bodies were vulnerable to prompt-injection breakout (Security)
- **Issue**: `<comment>` and the new `<parent>` child rendered body content with only the existing `]]>` strip — no escaping of `<`, `>`, `&`. A malicious or buggy local process could post an agent comment whose body contained `</comment><comment id="forged" ...>` or `</parent>` and break out of the envelope when an agent-comment reply was pulled. The agent's parser would then see forged sibling entries that read as additional reviewer comments — a prompt-injection vector.
- **Fix**: both `<comment>` and `<parent>` bodies are now wrapped in `<![CDATA[...]]>`. The existing `sanitizeBody` strips `]]>` so the wrapper itself can't be terminated early. Tests cover both injection vectors and the existing markdown-preservation contract (backticks, angle brackets in prose round-trip verbatim through CDATA).

### Validation hardening (Security)
- `anchor.lines` (POST `/api/agent/comments`) and `comment.lines` (POST `/api/agent/enqueue`) are validated against `/^\d+(-\d+)?$/`. Catches multiline / wildcard / shell-injected anchors at the boundary.
- `isAgentCommentId` narrowed to anchor-shaped (top-level) entries only. A reviewer reply can't legitimately parent a reply-shaped agent entry; the case is now a 400 at enqueue instead of a silent `parent-missing` at pull time.
- `agentLabel` capped at 64 chars to keep the in-memory store bounded against a noisy / hostile caller.

### Polished comments and dead branches (Reuse / General)
- Stale `shippable_post_review_reply` references in `AgentContextSection.tsx` (comments) and `Demo.tsx` (fixtures) updated to `shippable_post_review_comment`.
- The `(no anchor)` fallback in `AgentCommentsBlock` removed; the reducer filters anchor-shaped entries so the branch was unreachable.
- A transient task-id reference in `view.ts` reworded to describe the current state.
- Validation order in `handleAgentPostComment` reordered (shape → body → filesystem) to match `handleAgentEnqueue`.
- `splitAgentComments` now `console.warn`s when a polled entry has neither `parent` nor `anchor` rather than silently dropping it.

### Reviews that deliberately landed no fix
- **Architecture #1** ("agent comments invisible without Claude Code session"): verified incorrect. `agentContext` is built whenever `activeWorktreeSource` is set, regardless of session match. `AgentCommentsBlock` sits outside the `slice && (...)` ternary in `AgentContextSection`, so it renders for worktree-loaded sessions with no matched Claude Code session. Tests cover the empty-slice case.
- **Reuse #1, #5** (reducer near-duplication / inline `Outcome` literal): the unification refactor (separate teammate's feature) will absorb these.
- Various subjective preferences (dropping the `rekey` defensive throw, collapsing the `postAgentComment` ternary, hoisting prefix constants) were noted as observations and left in place.
