# Implementation Notes — Agent Reply Support

## Deviations from Spec

### `Reply.agentReplies` is optional (`agentReplies?: AgentReply[]`), not required
- **Spec said**: "Add `agentReplies: AgentReply[]` to the existing `Reply` interface (non-optional; defaults to `[]`)" (plan Task 10).
- **Implementation does**: declares `agentReplies?: AgentReply[]` — optional with no default at the type level. Renderers tolerate `undefined` via `reply.agentReplies ?? []`; the persist-rehydrate migration normalizes legacy snapshots to `[]`.
- **Reason**: making the field required forced ~30 fixture and test call-site updates across `gallery-fixtures.ts`, the `cs-XX` fixture files, `Demo.tsx`, `ReviewWorkspace.tsx`, and the state/persist test files. The optional shape matches the existing precedent set by `enqueuedCommentId?: string | null` and `enqueueError?: boolean`. Net behavior is identical: rehydrated and freshly-merged Replies always carry the field; only legacy/in-memory constructions can omit it, and the renderer treats omission as `[]`.
- **Impact**: zero behavior change for users. Future code touching `agentReplies` should use `reply.agentReplies ?? []` rather than `reply.agentReplies` directly. If we ever want to enforce the invariant in the type, a follow-up refactor can flip the field back to required and sweep the fixtures.

### Polling-error handling: per-endpoint independence (Promise.allSettled)
- **Spec said**: spec doesn't pin error-handling semantics for the joint poll loop; plan Task 14 says "call both `fetchDelivered` and `fetchAgentReplies` (in parallel via `Promise.all`)".
- **Implementation does**: uses `Promise.allSettled` so a failure in one endpoint doesn't poison the other. If `fetchDelivered` succeeds and `fetchAgentReplies` errors, the panel still updates `delivered` and surfaces `error: true`; vice versa. Last-known state is preserved on the failed side.
- **Reason**: under `Promise.all`, a single-endpoint hiccup wipes both updates and freezes the whole polling result. The two endpoints are conceptually independent — losing the agent-replies path shouldn't blank the delivered pips, and vice versa. The spec's "freeze pips in last-known state" semantics generalizes naturally to per-endpoint freezing.
- **Impact**: more resilient in the face of partial server outages or bugs in one endpoint. The error-banner UX is unchanged — `error` flips true if *either* endpoint failed, matching the spec's "agent status unavailable" wording.

### Tasks 3+6 and Tasks 4+5 each landed in single commits
- **Spec said**: plan listed them as separate tasks with separate commits.
- **Implementation does**: Tasks 3 (drop `freeform` `CommentKind` from queue) and 6 (drop freeform handling in endpoints) shipped in one `refactor(server): drop freeform CommentKind` commit. Tasks 4 (POST endpoint) and 5 (GET endpoint) shipped in one `feat(server): add POST and GET /api/agent/replies endpoints` commit.
- **Reason**: Task 3's verify step requires `npm run typecheck` to pass, which fails until Task 6's endpoint cleanup happens (the `freeform` literal in `index.ts` references the dropped enum value). Splitting them would mean an intermediate commit with broken typecheck — worse than one cohesive commit. Tasks 4 and 5 were merged because the work was naturally interleaved (router registrations, handlers, tests for both endpoints in the same module).
- **Impact**: cleaner git history; same code shipped.

### Task 22's manual browser smoke test was not run
- **Spec said**: plan Task 22 includes a manual smoke step — start `server/` and `web/`, install MCP, type `check shippable`, post replies, observe nesting.
- **Implementation does**: ran every automated check (typecheck/lint/test/build across `server/`, `mcp-server/`, `web/` — 359 tests total, all green; mcp-server build emits the new tool). Did not start the dev servers and exercise the flow in a real browser.
- **Reason**: the implementation environment is a sandboxed devcontainer without an interactive browser session.
- **Impact**: visual treatment of the nested agent-reply blocks (Task 18 styling) is unverified in a real DOM. The CSS uses standard properties (`color-mix`, flexbox, simple borders) that match conventions already in use elsewhere in `ReplyThread.css`, so the risk is low — but the human partner should open the panel, post a few replies via the new MCP tool, and confirm the visual treatment reads as intended before merging.

## Notes

- **Hook API breaking change**: `useDeliveredPolling` lost its `enqueuedIds` argument and its `IDLE_TIMEOUT_MS` export. The single in-tree caller (`ReviewWorkspace.tsx`) was updated. The hook now returns an additional `agentReplies: PolledAgentReply[]` field for the parent to dispatch into the reducer.
- **`mergeAgentReplies` reducer is idempotent and structurally stable**: re-merging the same polled batch returns the same state reference (`Object.is`), so React subscribers don't re-render on each idle poll. Tests pin this invariant in `state.test.ts`.
- **`PolledAgentReply` type lives in `web/src/state.ts`** (re-exported as needed). It's `AgentReply & { commentId: string }` — the wire shape that carries the link key the reducer needs.
- **Two magic phrases now**: `check shippable` (existing) and `report back to shippable` (new). Both render as click-to-copy chips in the install affordance, alongside the install command. Tests pin chip count = 3 and assert both phrase strings appear verbatim.
- **No SQLite, no SSE**: per the spec, persistence stays in-memory and transport stays REST polling. Both are tracked as cross-feature follow-ups.
