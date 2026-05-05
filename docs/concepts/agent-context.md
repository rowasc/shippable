# Agent context

When the reviewer loads a worktree, it shouldn't just show the diff — it should show *who made the diff and why*. If a Claude Code session produced these commits, that session's transcript, todo list, original task, and tool-call trail are already on disk and have most of the answers a reviewer asks: "what was the agent trying to do here?", "did it actually finish what was asked?", "why did it touch this file?".

"Agent context" in Shippable is: the curated, commit-aligned slice of a Claude Code session presented next to the diff that came out of it. The reviewer reads it; the reviewer can also write back into it (slice d of `docs/plans/worktrees.md`). It is a two-way pipe by design, not a one-way log viewer.

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

The same panel hosts the reverse direction. A reviewer authors per-thread replies (line notes, block comments, replies to AI notes / teammates / hunk summaries) and a freeform composer message; pressing Send batches the unsent replies onto a per-worktree, in-memory queue on the local server. A documented Claude Code hook fires on the agent's next tool call (or new session start) and pulls the queue, prepending the payload as `additionalContext` for that turn. See `docs/plans/push-review-comments.md` for the full design and `docs/features/agent-context-panel.md` for the user-facing surface.

Concretely:

- **Queue:** per-worktree, in-memory, single-process. `enqueue` appends; `pull` is atomic (a second concurrent caller sees an empty queue). Delivered comments move to a bounded history list (cap 200 per worktree) so the UI can still display "did the agent see this?" after the pull.
- **Hook events:** `UserPromptSubmit`, `PostToolUse`, `SessionStart`. Each event fires `tools/shippable-agent-hook`, which POSTs `{ worktreePath: <cwd> }` to the local server's `/api/agent/pull` and prints the returned payload to stdout — Claude Code grafts it onto that turn's context. The three events together mean a queued comment delivers on whichever happens first: the agent's next prompt, its next tool call, or a fresh session opening in the same worktree.
- **Latency model:** "delivers on the agent's next tool call or session start." We say this in the UI. The only case where it doesn't deliver is an idle session that does nothing — and even then, opening a new session in that worktree pulls the queue. We do *not* claim mid-turn interrupt; that's a separate experiment (a "live mode" toggle), tracked in `docs/plans/push-review-comments.md` § Future channels.
- **Hook installation:** the panel surfaces an "Install for me" button that idempotently merges all three matchers into `~/.claude/settings.local.json` (atomic write, one-shot backup of the prior file). Detection covers both the new basename `shippable-agent-hook` and the legacy `shippable-inbox-hook`, and the install rewrites legacy entries in place — but a user who hasn't reinstalled since slice (e) will keep a `shippable-inbox-hook` reference in their settings that now points at a deleted script. Claude Code logs the missing-file error and moves on; the next install run rewrites it. Users can also re-run install to clean it up.
- **Single-process limitation:** the queue lives in the server's memory. A server restart drops anything that hasn't been pulled. The panel surfaces this once below the Send button — surprises are the cost of the simplicity. A SQLite-backed durable queue is on the follow-ups list.
- **`commit` attribute is informational.** The `<reviewer-feedback commit="…">` envelope carries the sha the reviewer was viewing when they hit Send, not a checkout instruction. If the user reloads the worktree at a newer commit before the agent's hook fires, the agent still reads files at its own HEAD — the sha lets it reconcile line numbers in the comments against any drift, but doesn't pin the working tree. The line numbers themselves are also resilient to small upstream movement (the agent can find the same code or notice it shifted), so a stale sha here is robustness, not a footgun.

Why a hook instead of writing to `CLAUDE.md` or the session inbox directly: hooks fire deterministically on transcript boundaries we control, don't pollute the long-lived project memory, and work whether or not the original session is the one that picks the message up — a fresh session in the same worktree will also see and consume the queue. The earlier file-based mechanism (`<worktree>/.shippable/inbox.md` plus a `.shippable/` line in the shared `info/exclude`) was retired in slice (e) of `docs/plans/push-review-comments.md`; the queue subsumed it cleanly without introducing on-disk state in the worktree.

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
- **Hook detection is best-effort and informational.** The server reads `~/.claude/settings.json` and `~/.claude/settings.local.json`, looks for a `UserPromptSubmit` hook whose command's basename is `shippable-inbox-hook`. Two settings shapes are handled: the flat `[{ command }]` form and the matcher form `[{ matcher, hooks: [{ command }] }]`. Project-level settings are NOT checked — would need to walk the worktree tree, brittle. False negatives surface as a "set up" hint above the composer; the composer itself always works regardless.
- **One-click install with safety rails.** The "set up" panel offers both Copy-snippet (clipboard) and Install-for-me (`POST /api/worktrees/install-hook`). The server merges our matcher-form entry into `~/.claude/settings.json`, dropping a `settings.json.shippable.bak` *before the first modification only* (so a subsequent run won't overwrite the user's earliest known-good snapshot). Atomic write (temp file + rename). Idempotent — if our hook is already declared, returns immediately with `didModify=false`. Refuses to write if the existing file isn't valid JSON or isn't an object at root, surfacing the error with the path so the user can hand-fix. The bundled hook script is found via `import.meta.url` walking up from `server/src/hook-status.ts` to `<repo>/tools/shippable-inbox-hook`; if not found (non-standard layout, Tauri bundle without bundled tools dir), the install errors out and the user falls back to manual paste.

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
