# AI Annotations

## What it is
AI-authored review signals on the diff — questions, requests, blockers, and summaries — modelled as `Interaction`s with `authorRole: "ai"`.

## What it does
- Per-line AI notes are ordinary `Interaction`s with `target: "line"`, `authorRole: "ai"`, and ask intents (`"question" | "request" | "blocker" | "comment"`). If the annotation carries a verifier affordance, it lives in `runRecipe`.
- Replies to AI notes use the same unified reply shape as every other reply: `target: "reply"`. The parent thread's provenance comes from the `threadKey` prefix (`note:` for line AI notes, `hunkSummary:` for AI summaries), not from a special reply target enum.
- Hunk-level AI summaries are keyed by `hunkSummary:<hunkId>`, but the `Interaction.target` value is still just `"reply"` for follow-ups. The summary head itself is recovered structurally from the `threadKey` plus `authorRole: "ai"`.
- Teammate verdicts on hunks are also structural. The thread key prefix is `teammate:`, while the head interaction uses `authorRole: "user"` — `user` now covers all human actors, including imported PR reviewers and teammate-ingest.
- Every author (user, AI, agent) emits `Interaction`s into the same store, keyed by stable thread keys, so local reviewer comments, AI annotations, teammate verdict threads, and agent post-backs all live in one map. See `docs/architecture.md § Review interactions`.

## Shape constraints worth remembering

- `InteractionTarget` is topology only: `"line" | "block" | "reply"`. It does not encode provenance.
- `InteractionAuthorRole` is `"user" | "ai" | "agent"`. There is no separate `"teammate"` role in the current model.
- Provenance for AI summaries and teammate verdicts lives in the thread key family (`hunkSummary:` / `teammate:`) and in who authored the head interaction, not in extra enum members.
- Persist strips non-user interactions and rebuilds them from ingest on reload, so AI annotations are part of the live review model but not durable local reviewer state.
