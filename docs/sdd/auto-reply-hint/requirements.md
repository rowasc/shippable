# Auto-Reply Hint — Requirements

## Goal

Reinforce the round-trip discipline of [[agent-reply-support]] by embedding a short, in-payload nudge in the response of `shippable_check_review_comments` that tells the agent to call `shippable_post_review_reply` after addressing each comment. Tool descriptions fade from a model's working focus once the tool has been called; the response body does not — that is where the next-step instruction needs to live.

## Requirements

1. **Hint is part of the `shippable_check_review_comments` tool result.** It travels back to the agent as text appended to the existing `<reviewer-feedback>` envelope, in the same single `content[0].text` block, separated by a blank line. No protocol changes; no new content block.
2. **Hint is conditional on having pending comments.** When the queue is empty (current response: `"No pending comments."`), no hint is appended — there is nothing to reply to and the noise would dilute the signal next time.
3. **Hint references `shippable_post_review_reply` by name, names the three outcomes, and reminds the agent that the `id` attribute on each `<comment>` is what `commentId` expects.** Exact wording is the spec's call; this requirement pins the content, not the prose.
4. **Hint includes the fallback magic phrase `report back to shippable`** so the agent has a recoverable trigger if it ignores the implicit one and the user later prompts it.
5. **Hint is added at the MCP-server layer**, not in `server/src/agent-queue.ts:formatPayload`. The wire payload from the local server (`POST /api/agent/pull`) stays unchanged — it remains just the envelope. The MCP handler is the agent-facing boundary and is the only consumer that needs the hint.
6. **Existing `TOOL_DESCRIPTION` stays as-is.** This change is additive in the response payload; it does not touch the registration-time description. (A description tweak may be considered out-of-scope follow-up if the hint proves insufficient.)
7. **Handler tests cover both branches.** With comments → hint appears, references the tool name, the outcome enum, and the magic phrase. Without comments → hint does not appear.

## Constraints

- **No new MCP tools, endpoints, or storage.** Pure handler-layer change in `mcp-server/`.
- **No changes to `Comment` / `AgentReply` shapes** or to the local server's HTTP surface.
- **Single text content block.** The MCP `ToolResult` shape stays `{ content: [{ type: 'text', text }] }`; the hint is concatenated into that same text.
- **Hint must not break XML parseability of the envelope.** Appended outside `</reviewer-feedback>`, separated by a blank line. Agents that parse the envelope strictly are unaffected; agents that read the whole text see both.
- **Localhost-only, no auth, in-memory** posture from the surrounding subsystem is unchanged.

## Out of Scope

- **Editing `TOOL_DESCRIPTION`.** Description and response-payload hint are different surfaces with different staying power in the model's context; this work is about the latter. If the spec discovers the description also needs tightening, that is a follow-up note, not a requirement here.
- **Per-call hint customization or an opt-out flag.** One hint, every non-empty response, same wording for every agent. Adds complexity without a real driver.
- **Changing the empty-queue response.** `"No pending comments."` stays exactly as it is.
- **Server-side rendering of the hint** (i.e., adding it inside `formatPayload`). The local server's wire payload is consumed only by the MCP handler today; mixing the hint into the envelope would leak agent-facing instructions into a transport surface that has other potential consumers.
- **A second hint on the post-reply tool** ("now reply to the next comment"). Out of scope — that tool already runs per-comment and the model has the loop in hand by then.
- **UI changes.** The reviewer UI is unaffected — it never sees the MCP tool result; it polls `/api/agent/replies` and `/api/agent/delivered` for state.

## Open Questions

- **Exact hint wording.** Short and imperative; references `shippable_post_review_reply`, the `commentId` source (the `id` attribute), the three outcomes (`addressed` / `declined` / `noted`), and the `report back to shippable` magic phrase. Spec pins the final string.
- **Structured wrapping?** Plain trailing text vs. a structured tag like `<next-step tool="shippable_post_review_reply">…</next-step>`. Plain text is simpler and matches how the model reads instructions in the same context; structured tag is easier for downstream tooling to strip. Spec picks one; default leaning is plain text + a leading marker line ("Next step:") for scannability.
- **Should the hint quote one example call?** A single illustrative call (with placeholder values) inside a code block could lift compliance rates, at the cost of payload length. Spec decides.

## Related Code / Patterns Found

- `mcp-server/src/handler.ts:48` — `handleCheckReviewComments`. The hint gets appended to `text` here, on the non-empty branch only.
- `mcp-server/src/handler.ts:88` — current "non-empty body vs `No pending comments.`" branch; the hint plugs into this same conditional.
- `mcp-server/src/handler.test.ts` — existing happy-path / empty-queue / connection-error tests; extend with hint-present and hint-absent assertions.
- `mcp-server/src/index.ts:10` — `TOOL_DESCRIPTION`. Stays put; cross-reference from spec for context on what the description already says.
- `mcp-server/src/index.ts:13` — `POST_REPLY_DESCRIPTION`. Source-of-truth wording for the `outcome` enum semantics; mirror its phrasing in the hint to avoid drift.
- `mcp-server/README.md` — update the `shippable_check_review_comments` § to mention the response now carries a trailing next-step hint.
- `server/src/agent-queue.ts:225` — `formatPayload`. Deliberately untouched; the hint is not added here.
- `docs/sdd/agent-reply-support/spec.md` — the parent feature; § "Open Questions Resolved" already pins the magic phrase and outcome enum used by this hint.
- `docs/concepts/agent-context.md` § Two-way — when this lands, add a sentence noting that the pull payload now reinforces the reply expectation.
