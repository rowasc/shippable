# AI Annotations

## What it is
AI-authored review signals on the diff — questions, requests, blockers, and summaries — modelled as `Interaction`s with `authorRole: "ai"`.

## What it does
- Per-line AI notes ride as Interactions with `target: "line"` (or `"reply-to-ai-note"` for follow-ups in the same thread) and `intent: "question" | "request" | "blocker" | "comment"`. The optional `runRecipe` carries the verification snippet.
- Hunk-level AI summaries ride as Interactions with `target: "hunkSummary"`.
- Teammate verdicts on hunks ride as Interactions with `target: "teammate"` and `authorRole: "teammate"`.
- Every author (user, AI, teammate, agent) emits Interactions into the same store, keyed by stable thread keys, so a reply-to-AI-note, a reply-to-teammate, a fresh line comment, and a block comment all live in one map. See `docs/architecture.md § Review interactions`.
