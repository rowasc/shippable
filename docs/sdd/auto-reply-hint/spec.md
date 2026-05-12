# Spec: Auto-Reply Hint

## Goal

After the agent calls `shippable_check_review_comments`, the response payload itself carries a short next-step instruction telling the agent to call `shippable_post_review_reply` for each comment it just read. The tool description already says this at registration time, but description text fades from a model's working focus once the tool has returned; the response text does not. Putting the hint where the model is looking is the cheap, surgical fix to prompt drift between the pull and the reply.

## Requirements Summary

- Append a hint to the `shippable_check_review_comments` tool result whenever the response carries at least one comment.
- Skip the hint when the queue is empty (response stays `"No pending comments."`).
- Hint names `shippable_post_review_reply`, the three `outcome` values, the `id`-attribute source for `commentId`, and the `report back to shippable` magic phrase.
- Added at the MCP-server layer (`mcp-server/src/handler.ts`) — the local server's wire payload from `POST /api/agent/pull` stays unchanged.
- Single `content[0].text` block, separated from the envelope by a blank line. No new tools, endpoints, or content blocks.
- Existing `TOOL_DESCRIPTION` is untouched.

Full detail in `requirements.md`.

## Chosen Approach

**Plain-text trailing block, MCP-handler layer.**

The handler currently returns `text = body.payload` on the happy path and `text = "No pending comments."` on the empty path (`mcp-server/src/handler.ts:88-93`). Same conditional, two changes:

1. Extract a constant `NEXT_STEP_HINT` next to `DEFAULT_PORT` — a single string, no template variables. Co-located with other handler constants so future tweaks happen in one place.
2. On the non-empty branch, return `text = \`${body.payload}\n\n${NEXT_STEP_HINT}\``. Empty branch is untouched.

**Wording (pinned by this spec):**

```
Next step: call `shippable_post_review_reply` once per comment above. Pass the comment's `id` attribute as `commentId`, your prose as `replyText`, and set `outcome` to `addressed` (you fixed it), `declined` (you intentionally won't), or `noted` (you saw it, no action). The user can also trigger this explicitly with the phrase "report back to shippable".
```

Properties of the chosen shape:

- **Plain text, not a wrapped tag.** The envelope above the hint is XML; the hint deliberately is not. The visual break tells the model "the data ended; this is a directive about what to do with that data."
- **No example call embedded.** The MCP tool registration already supplies the schema the harness shows the model. Re-pasting an example in the response payload would inflate every pull response without lifting compliance — the schema is already in the model's context.
- **Imperative, terse, one paragraph.** Mirrors the phrasing of `POST_REPLY_DESCRIPTION` (`mcp-server/src/index.ts:13`) so the agent doesn't see two conflicting renderings of the same instruction.
- **Magic-phrase recovery is in the same sentence.** If the model ignores the implicit nudge in this turn, the user's next prompt ("report back to shippable") is the documented recovery — and now the model has seen that string in-band rather than only in the README.

### Alternatives Considered

- **Structured `<next-step>` tag inside or after the envelope.** Easier to programmatically strip downstream, but no current consumer needs that capability — the only thing reading this string is the agent. Adds another XML structure the model could conflate with the data it just received. Rejected for noise without payoff.
- **Server-side hint inside `formatPayload`.** Already ruled out in requirements. Mixing agent-facing instructions into the local server's wire payload couples a transport concern to an MCP-tool concern and complicates any future non-MCP consumer of `/api/agent/pull`.
- **Description-only rewrite.** Tightening `TOOL_DESCRIPTION` was considered as a no-code-change alternative, but the whole point of this work is that the description fades after the tool fires. Description and response-payload hint are different surfaces with different staying power; this spec changes the surface that actually matters mid-loop. Description tweaks remain a follow-up if even the in-payload hint proves insufficient.
- **Append an example call (rejected variant of plain-text).** Considered embedding a placeholder call (`shippable_post_review_reply({ commentId: "…", replyText: "…", outcome: "addressed" })`). Costs ~5 extra lines per pull, duplicates the registered schema, and risks the model treating the placeholder values as canonical. Rejected unless real-world compliance data ever calls for it.

## Technical Details

### Architecture

```
┌─ Agent ─────────────────────────────────────────────────┐
│   calls shippable_check_review_comments                 │
└────────────────────────────┬───────────────────────────┘
                             │
                             ▼
┌─ MCP server (mcp-server/src/handler.ts) ───────────────┐
│   handleCheckReviewComments                            │
│     POST /api/agent/pull                               │
│     if body.payload non-empty:                         │
│       text = body.payload + "\n\n" + NEXT_STEP_HINT  ← │
│     else:                                              │
│       text = "No pending comments."                    │
│   returns { content: [{ type: 'text', text }] }        │
└────────────────────────────┬───────────────────────────┘
                             │ (wire payload unchanged)
                             ▼
┌─ Local server (server/) ────────────────────────────────┐
│   POST /api/agent/pull → { payload, ids }              │
│   formatPayload(comments, sha) — untouched              │
└────────────────────────────────────────────────────────┘
```

The arrow marks the only behavior change. Every other layer is bystander.

### Data Flow

1. Agent calls `shippable_check_review_comments` (no input, or `worktreePath`).
2. MCP handler POSTs to `http://127.0.0.1:<port>/api/agent/pull` and reads `{ payload, ids }`. **(unchanged)**
3. **(new)** If `payload` is a non-empty string, the returned `ToolResult` text is `${payload}\n\n${NEXT_STEP_HINT}`. If `payload` is empty/missing, the returned text is the existing `"No pending comments."` string verbatim — no hint appended.
4. Tool result returns to the agent. The model sees the `<reviewer-feedback>` envelope, a blank line, and then the next-step instruction.
5. Subsequent calls to `shippable_post_review_reply` use the `id` attributes the agent captured from the envelope. **(unchanged)**

### Key Components

**Modified handler module**

- `mcp-server/src/handler.ts`
  - Add a top-level `const NEXT_STEP_HINT = "Next step: call \`shippable_post_review_reply\` once per comment above. Pass the comment's \`id\` attribute as \`commentId\`, your prose as \`replyText\`, and set \`outcome\` to \`addressed\` (you fixed it), \`declined\` (you intentionally won't), or \`noted\` (you saw it, no action). The user can also trigger this explicitly with the phrase \"report back to shippable\".";` co-located with `DEFAULT_PORT`.
  - In `handleCheckReviewComments`, change the existing branch:
    ```ts
    const text = typeof body.payload === "string" && body.payload.length > 0
      ? `${body.payload}\n\n${NEXT_STEP_HINT}`
      : "No pending comments.";
    ```
    Everything else in the handler is untouched.

**Tests**

- `mcp-server/src/handler.test.ts`
  - Extend the happy-path test to assert the returned `text` includes both the envelope substring AND the hint substring (a substring match on `shippable_post_review_reply` and on `report back to shippable` is sufficient — no need to pin the full hint string in two places).
  - Extend the empty-queue test to assert the returned `text` does **not** contain `shippable_post_review_reply` (i.e., hint is suppressed).
  - Connection-error and HTTP-error paths are unchanged; existing tests cover them.

**Docs**

- `mcp-server/README.md`
  - Under `### shippable_check_review_comments`, add one sentence: the response also carries a short next-step hint reminding the agent to call `shippable_post_review_reply` for each comment.
- `docs/concepts/agent-context.md`
  - In the section that describes the pull half of the round-trip (currently § Two-way after the agent-reply-support landing), add a sentence noting that the pull response now embeds the reply expectation rather than relying solely on the tool description.

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `mcp-server/src/handler.ts` | modify | Add `NEXT_STEP_HINT` constant; append it to the non-empty-payload branch in `handleCheckReviewComments`. |
| `mcp-server/src/handler.test.ts` | modify | Assert hint presence on non-empty payload and absence on empty queue. |
| `mcp-server/README.md` | modify | Mention the trailing next-step hint in the `shippable_check_review_comments` section. |
| `docs/concepts/agent-context.md` | modify | One sentence in the pull-half description noting the embedded next-step hint. |

## Out of Scope

- Editing `TOOL_DESCRIPTION` in `mcp-server/src/index.ts`.
- Per-call hint customization, opt-out flags, or worktree-specific hints.
- Changing the `"No pending comments."` empty-queue response.
- Adding the hint inside `formatPayload` (server-side) or anywhere the local server emits the envelope.
- Adding a hint on the post-reply tool.
- Reviewer UI changes — the UI never receives the MCP tool result.
- Quoting an example `shippable_post_review_reply` call inside the hint.

## Open Questions Resolved

- **Plain text vs structured tag** → plain text, with a leading "Next step:" marker. Wrapping in XML adds shape the model can confuse with envelope data and gains no downstream consumer that needs to strip the hint.
- **Where the hint is added** → MCP handler (`mcp-server/src/handler.ts`). The local server's `/api/agent/pull` wire payload remains the bare envelope.
- **Exact wording** → pinned above in § Chosen Approach. Re-uses the outcome phrasing from `POST_REPLY_DESCRIPTION` so the agent sees one consistent rendering of the enum semantics across the two tools.
- **Whether to include an example call** → no. The registered tool schema already supplies it; embedding an example in every pull response inflates payload weight without a compliance signal that warrants it.
- **Whether the hint appears on the empty branch** → no. With nothing to reply to, the hint would just train the agent to ignore it next time around.
- **Whether `TOOL_DESCRIPTION` needs a tweak** → not part of this spec. If real-world compliance is still weak after the in-payload hint lands, revisit the description as a tiny follow-up.

## Follow-ups (surfaced by spec, not blockers for v0)

- **Compliance telemetry.** There is no current way to measure "agent pulled comments AND posted at least one reply within the same conversation turn." If we ever want to know whether this hint moved the needle, the cheapest signal would be a per-worktree counter on the local server: `pullsServed` vs `repliesPosted`. Logged here so the next iteration on this loop knows the gap.
- **Description-side tightening.** If the in-payload hint proves insufficient in real usage, the next small step is to mirror its imperative phrasing into `TOOL_DESCRIPTION` so both surfaces match.
- **Hint localization / per-harness variants.** Not on the table now — single English string, every harness. If a non-English-prompted harness ever needs a translated hint, that's a configuration concern for a different day.
