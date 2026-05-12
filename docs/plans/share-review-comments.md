# Sharing review comments with the agent — pending work

v0 shipped: reviewer comments enqueue locally when authored; the agent calls `shippable_check_review_comments` (MCP) to fetch them and posts structured per-comment replies via `shippable_post_review_reply`. The user-facing surface — install affordance, magic phrases, pip semantics, Delivered (N) block, threaded agent replies — is documented at [agent context panel](../features/agent-context-panel.md). This file tracks what's still open.

## Pending

- **Push to idle session.** Pull means the agent only sees comments when the user prompts it. Real-time delivery needs Channels (when it leaves research preview) or a sidecar that types into the running CLI's stdin. Re-evaluate when Channels stabilises.
- **Belt-and-suspenders hooks for Claude Code.** A user who really wants mid-turn delivery can add a hook that hits `/api/agent/pull` directly. The `worktree-agent-context-panel` branch is the reference implementation, preserved as a record of the hook-based design.
- **Multi-channel pip generalization.** When additional delivery channels arrive (GitHub PR comment, Linear issue, etc.), the pip generalises from "agent-fetched" to "seen by N channels" with a per-channel tooltip. The `Reply` data model needs to switch from a single `enqueuedCommentId` to a per-channel id map; that's a localStorage migration when it lands.
- **Server-side install verification for non-CC harnesses.** Today only Claude Code's MCP config is parseable from disk; other harnesses rely on a manual "I installed it" dismiss. Tracking `lastPullAt` per worktree would let the panel auto-hide the install affordance after the first real pull.
- **Durable queue.** SQLite-backed. Retires the in-memory restart-drops-queue limitation. Paired with the broader local-storage migration in [`docs/ROADMAP.md`](../ROADMAP.md).
- **Per-thread send control.** If a reviewer wants only a subset of their comments fetched, today they delete the rest. A stage / unstage toggle is worth adding if real users surface the need.

## Cross-references

- Agent-reply back-channel — landed via [`docs/sdd/agent-reply-support/spec.md`](../sdd/agent-reply-support/spec.md). The agent posts structured `{ commentId, body, outcome }` replies, no heuristic parsing.
- Typed review interactions — the renaming work in [`typed-review-interactions.md`](typed-review-interactions.md) reshapes the queue's wire format (`Comment` → `Interaction`); pending follow-ups above will need to ride that rename when it ships.
- Per-task shipping ledger — [`share-review-comments-tasks.md`](share-review-comments-tasks.md) carries the slice-by-slice record of what landed.
