# Agent context

When the reviewer loads a worktree, it shouldn't just show the diff — it should show *who made the diff and why*. If a Claude Code session produced these commits, that session's transcript, todo list, original task, and tool-call trail are already on disk and have most of the answers a reviewer asks: "what was the agent trying to do here?", "did it actually finish what was asked?", "why did it touch this file?".

"Agent context" in Shippable is: the curated, commit-aligned slice of a Claude Code session presented next to the diff that came out of it. The reviewer reads it; the reviewer can also write back into it via the MCP pull channel (`docs/plans/share-review-comments.md` supersedes the file-based half of `docs/plans/worktrees.md` slice (d)). It is a two-way pipe by design, not a one-way log viewer.

## Where it comes from

The local source of truth is the Claude Code CLI's own transcript files:

```
~/.claude/projects/<project-path-hash>/<session-id>.jsonl
```

These are append-only JSONL records — one event per turn (user message, assistant message, tool call, tool result). They are written live as the session runs, so we get "live" for free by tailing the file. Each record carries a `cwd` field, which is how we map a transcript back to a worktree on disk.

We deliberately **do not** ask the agent to write a sidecar metadata file into the worktree. The transcript already exists; duplicating it would mean two sources of truth and a coordination bug waiting to happen. The richer `.claude/worktrees/index.json` registry described in `docs/plans/worktrees.md:93-96` remains a future option — additive, not load-bearing.

## How a worktree maps to a session

The match is fuzzy on purpose. A worktree's path is matched against the `cwd` field of recent transcript files. Three cases:

1. **One match.** Use it. This is the common case.
2. **Multiple matches** (the user ran several Claude Code sessions in the same worktree). Show a session picker — most recent first, with task summary and time range — and remember the choice per worktree.
3. **No match.** Show the panel in an empty state with "pick a session manually" — don't pretend there's no agent context if the user wants to attach one anyway.

The choice is durable per `(repo-root, branch)` so renaming the worktree directory doesn't lose the link.

## Commit-aligned slicing

A live session can have hundreds of turns. Reviewers don't want a chat replay; they want "what did the agent do *for the commit I'm looking at*?".

The reviewer slices the transcript by **commit boundary**: the events between the previous commit's timestamp and the current commit's timestamp on this worktree's branch. That window is the agent context for *this* changeset. When a new commit lands the slice advances; the previous slice doesn't disappear, it becomes browsable history.

This is the small but important conceptual move: the unit of agent context is *a commit*, not *a session*. A session can produce many commits and a reviewer reviews them one at a time.

## What's in a slice

Everything we have, layered for progressive disclosure:

- **Task** — the original user prompt that started the session, plus any follow-up user messages within this slice.
- **Plan / todos** — the agent's todo list state at the end of the slice (Claude Code's `TodoWrite` events are in the transcript).
- **Files touched** — every file path that appears in tool calls within the slice, mapped to the diff hunks that file owns. This is the load-bearing connector between the chat and the diff.
- **Transcript tail** — the last N assistant messages, with collapsible expansion for the full slice.
- **Symbols mentioned** — identifiers in backtick spans that match the loaded ChangeSet's symbol graph become click-throughs into the diff. Hooks into the existing symbol-graph work in `docs/concepts/symbol-graph-and-entry-points.md`.
- **Cost / duration / model** — quick "how expensive was this commit" read.
- **Final summary** — the agent's last assistant message before the commit, if it reads as a summary.

The panel is collapsed-by-default for everything except Task and Files-touched, since those are the two pieces a reviewer almost always wants and the rest is on demand.

## Two-way: feedback back to the agent

The same panel hosts the reverse direction, but the channel is a **pull**: the reviewer authors structured comments (line, block, replies, freeform) on the diff; each authoring gesture stages the comment on the local server's queue keyed by `worktreePath`. The agent fetches by calling the `shippable_check_review_comments` MCP tool — typically when prompted with the magic phrase `check shippable` — and the tool returns a `<reviewer-feedback>` envelope wrapping every pending comment. See `docs/plans/share-review-comments.md` for the full design and § Why pull, not push for the comparison with the earlier hook-based push channel.

Concretely:

- **Transport:** `POST /api/agent/pull` (server) ← `mcp-server/` shim ← agent's MCP client. The local server binds 127.0.0.1; no LAN exposure, no token in v0.
- **Latency model:** comments arrive when the agent calls the tool — typically when the user says `check shippable`. We surface that exact phrase in the install affordance. Mid-turn delivery is deliberately not in scope.
- **Install affordance:** the panel renders the per-harness install line (Claude Code default: `claude mcp add shippable -- npx -y @shippable/mcp-server`) and the magic phrase as click-to-copy chips. The server detects a configured `shippable` MCP entry in `~/.claude/settings.json` / `~/.claude/settings.local.json` and collapses the install affordance to a one-line ✓ when present.

Why pull instead of writing to `CLAUDE.md` or a hook: pull collapses the explicit "Send" gesture into the user's natural next prompt, covers every MCP-speaking harness with one transport, and aligns with Shippable as a passive workspace rather than a tool that wedges itself into the build loop. The earlier hook-based file inbox at `<worktree>/.shippable/inbox.md` was built once on `worktree-agent-context-panel`, kept as a record, and replaced.

## Refresh model

When a new commit lands on the worktree's branch, the slice advances. The reviewer detects this by polling `/api/worktrees/changeset` for the worktree's HEAD on a low cadence (every few seconds while the panel is open). When HEAD changes, we re-fetch the changeset and the agent context together so they stay in lockstep.

We deliberately do not file-watch the JSONL transcripts themselves. The reviewer is interested in *commits*, not *agent keystrokes*. Streaming every tool call into the UI would be noisy, and once we have it the temptation to build "live agent feed" creeps the surface area. Commit-boundary refresh keeps the interface aligned with what reviewers actually do.

## What this is not

- **Not a chat client.** No threading, no message reactions, no multi-room. The send-to-agent composer is a single-shot inbox drop.
- **Not a session manager.** The Claude Code CLI manages sessions; we read what it writes.
- **Not load-bearing on a sandbox.** It works for any worktree where Claude Code ran with `cwd` inside it — agentic sandbox or hand-driven branch.
- **Not a substitute for reading the diff.** The agent's narrative is one signal. The diff is the source of truth.

## Findings from implementation (frontend wiring)

- **State lives outside `ReviewState`.** The reviewer's `ReviewState` is persisted to localStorage and reflects review work-in-progress; agent context is async-fetched, transient, and per-changeset. Putting it in `ReviewState` would either pollute the persisted snapshot or require a denylist of "don't save these fields." We keep it as plain `useState` at the App level instead.
- **Worktree provenance lives on the ChangeSet itself** (`cs.worktreeSource?: WorktreeSource`), set by `LoadModal` when constructing the cs. *Initial design held it as separate App state and threaded it through `onLoad(cs, source?)`; that broke under page reload (App state was lost while the cs survived in localStorage) and under changeset switching (only one source was tracked at a time).* Stamping it on the cs means the provenance is automatically persisted, automatically per-cs, and survives the same things the cs does. Render gate is just `cs.worktreeSource ?? null`.
- **Inspector takes one `agentContext?: AgentContextProps` bundle**, not a flat list of seven props. Optional — passing `undefined` keeps the section out of the DOM entirely. Means non-worktree-loaded changesets see the original Inspector unchanged.
- **Refresh model is on-demand for v1.** A manual refresh button bumps a `refreshTick` that re-runs the fetch effect. Per-commit polling (the design's "live" mode) is deferred to a follow-up — once the picker UX feels right, polling is a `setInterval` on the same effect.
- **Session-pick state lives in App.** A single `pinnedSessionFilePath` overrides the "most recent matching session" default. It clears when the user loads a different worktree (so picker selections don't carry across).
- **The fetch effect is keyed on `worktreePath + commitSha + pinnedSession + refreshTick`.** Same shape as the existing `usePlan` flow in this codebase — keeps cancellation simple via a `cancelled` flag in the closure.
- **Sync `setState` stays out of effect bodies.** The repo's lint config (`react-hooks/set-state-in-effect`) forbids it, and `usePlan.ts` shows the right pattern: derive a fetch key, use the adjusting-state-during-render trick (`if (lastKey !== wantedKey) { setLastKey(...); setLoading(true); ... }`) for the sync transitions, and keep the effect body itself pure-async — only `.then()` / `.catch()` / `.finally()` callbacks setState. The `cancelled` flag in the closure closes over the in-flight fetch so a stale result can't overwrite a fresher one.
- **Symbol linking is backtick-only, not bare-identifier.** The existing `RichText` component links bare identifiers too — right call for AI plan output, wrong call for chat content (the agent says "loop" or "cursor" all the time and those would all link). We inline a small backtick-only tokenizer in `AgentContextSection` instead. The false-positive guard ("only link if the symbol is in a file the diff touches") falls out for free because `buildSymbolIndex` only emits symbols defined in the loaded ChangeSet.
- **MCP-install detection is best-effort and informational.** The server reads `~/.claude/settings.json` and `~/.claude/settings.local.json`, looks for a `shippable` entry under `mcpServers` (the canonical Claude Code shape) — and accepts a few permissive variants (`mcp.shippable`, `mcp_servers.shippable`) so we don't false-negative users who configured via a sibling tool. Malformed or missing files return `{ installed: false }` without throwing. Project-level configs are NOT checked — would need to walk the worktree tree, brittle. False negatives surface as a "set up" install affordance at the top of the panel; the composer itself always works regardless. For non-Claude-Code harnesses we have no programmatic detection — the affordance offers an "I installed it" dismiss button persisted per-machine in `localStorage` under `shippable.mcpInstallDismissed`.
- **No automated config writer.** The earlier slice's one-click hook installer (`POST /api/worktrees/install-hook`) was removed alongside the inbox channel. MCP servers don't have a clean unattended-install path on most harnesses; the user copies the install line and runs it. The Findings on the previous mechanism are preserved in the `worktree-agent-context-panel` branch as a record.

## Findings from implementation (server-side reader)

Things that surfaced once the JSONL parser hit real transcripts:

- **Sessions cross cwds.** A single transcript file can have entries with multiple `cwd` values — confirmed in our own dogfood session, which spanned three. Implication: matching uses *any* entry's `cwd`, not the first one's. The fast-path lookup by encoded project-dir name (`/foo/bar` → `-foo-bar`) is a hint, not a substitute for scanning entries.
- **Strict cwd filter for slicing.** When a session crosses cwds, we drop events where `cwd !== worktreePath` from the slice. The right call for the production flow (sessions that start with cwd already in the worktree); it does cost one UX wart in cross-cwd dogfooding, where the original framing message is filtered out and `task` ends up being whatever the user typed *after* the cwd switch. Acceptable.
- **Timestamps need epoch-ms comparison.** Git's `%aI` and Claude Code's JSONL `timestamp` use different ISO 8601 offset conventions (`-03:00` vs `Z`). String compare is wrong. Always parse via `Date.parse` before windowing.
- **`TodoWrite` is the right hook for the plan list.** It's the Claude Code tool name in the transcript. The reviewer's own `TaskCreate` (a Claude Code harness tool, not in transcripts) is a separate thing — empty `todos` in dogfood doesn't mean the extractor is broken.
- **Tool inputs are unstable.** File paths can live in `file_path`, `path`, `filePath`, or `filename` depending on the tool. Defensive lookup over an allowlist of keys is the only sane move.
- **Append-only files have torn tails.** Live JSONL reads can hit a half-written line. The parser silently skips malformed lines; one bad tail-line shouldn't kill the read.

## Open questions tracked here

- **Symbol-link false positives.** Backtick-quoted spans that *happen* to match an unrelated symbol. Mitigation: only link when the symbol is also in a file the diff touches. Revisit if false positives are still annoying.
- **Multi-session-per-commit.** If two Claude Code sessions interleaved on the same worktree, the slice could mix transcripts. v1 picks the most recent session that touched the files in the diff; we record this in the slice metadata so the user can switch.
- **Transcript privacy.** Transcripts can contain pasted secrets. We never upload them; we render in the local app only. Document this prominently in the feature doc.
- **Empty slices.** A commit with no transcript events (e.g., the user committed by hand). The panel falls back to a "no agent context for this commit" empty state — explicit, not a broken-looking empty section.
