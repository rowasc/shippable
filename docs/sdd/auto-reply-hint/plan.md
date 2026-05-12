# Implementation Plan: Auto-Reply Hint

Based on: docs/sdd/auto-reply-hint/spec.md

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Tasks

### Task 1: TDD the hint append in `handleCheckReviewComments`
- **Files**: `mcp-server/src/handler.ts`, `mcp-server/src/handler.test.ts`
- **Do**:
  1. In `handler.test.ts`, extend the existing happy-path test (or add a new one alongside it) to assert that when `/api/agent/pull` returns a non-empty `payload`, the tool result's `text` contains BOTH the envelope substring (e.g., `<reviewer-feedback`) AND the substrings `shippable_post_review_reply`, `report back to shippable`, `addressed`, `declined`, `noted`. Substring matches are sufficient; do not pin the entire hint string in the test — that duplicates the source of truth.
  2. Extend (or add) the empty-queue test to assert the returned `text` equals `"No pending comments."` exactly and does NOT contain `shippable_post_review_reply`.
  3. Verify both new assertions fail with the current implementation.
  4. In `handler.ts`, add a top-level `const NEXT_STEP_HINT = "Next step: call \`shippable_post_review_reply\` once per comment above. Pass the comment's \`id\` attribute as \`commentId\`, your prose as \`replyText\`, and set \`outcome\` to \`addressed\` (you fixed it), \`declined\` (you intentionally won't), or \`noted\` (you saw it, no action). The user can also trigger this explicitly with the phrase \"report back to shippable\".";` near the existing `DEFAULT_PORT` declaration.
  5. Change the existing ternary in `handleCheckReviewComments` from `text = body.payload` (on the truthy branch) to `text = \`${body.payload}\n\n${NEXT_STEP_HINT}\``. Empty branch is untouched.
  6. Run `npm run test` in `mcp-server/`. Verify the two new assertions pass and that the connection-error and HTTP-error tests still pass unchanged.
  7. Run `npm run typecheck` in `mcp-server/`. Verify clean.
  8. Commit: `feat(mcp-server): embed reply next-step hint in check-review-comments response`
- **Verify**: `npm run test` and `npm run typecheck` pass in `mcp-server/`; the new substring assertions pass; the empty-queue absence assertion passes.
- **Depends on**: none

### Task 2: Document the hint in `mcp-server/README.md`
- **Files**: `mcp-server/README.md`
- **Do**:
  1. Under `### shippable_check_review_comments`, add one sentence after the "Returns the formatted reviewer-feedback envelope…" line noting that the response also carries a short trailing next-step hint reminding the agent to call `shippable_post_review_reply` for each comment.
  2. Do NOT inline the full hint string in the README — point readers at `mcp-server/src/handler.ts` for the source of truth so the README does not drift if the wording is later tightened.
  3. Commit: `docs(mcp-server): note next-step hint in check-review-comments response`
- **Verify**: README renders; the section flows; the new sentence does not duplicate the existing magic-phrases section.
- **Depends on**: Task 1

### Task 3: Update `docs/concepts/agent-context.md`
- **Files**: `docs/concepts/agent-context.md`
- **Do**:
  1. Locate the section that describes the pull half of the round-trip (currently § Two-way, possibly renamed after the agent-reply-support landing).
  2. Add one sentence noting that the pull response now embeds the reply expectation in-band rather than relying solely on the tool description.
  3. If it makes the surrounding paragraph cleaner, cross-link this spec (`docs/sdd/auto-reply-hint/spec.md`).
  4. Commit: `docs(concepts): note reply hint embedded in pull response`
- **Verify**: doc renders; cross-link (if added) resolves; the paragraph reads coherently.
- **Depends on**: Task 1

### Task 4: End-to-end verification
- **Files**: none — verification only
- **Do**:
  1. Run `npm run typecheck`, `npm run build`, and `npm run test` in `mcp-server/`. All green.
  2. Smoke check the build output: `grep "report back to shippable" mcp-server/dist/handler.js` should print the matching line (confirming the constant landed in the compiled bundle).
  3. If a server is conveniently runnable: start `server/` (`npm run dev` in `server/`), enqueue at least one comment via the existing flow, then invoke the MCP tool locally (`node mcp-server/dist/index.js` via an MCP harness or by sending a manual stdio JSON-RPC `tools/call` for `shippable_check_review_comments`) and confirm the returned text ends with the hint paragraph. Skip if no interactive environment is available — automated checks above are sufficient to ship.
  4. Note any deviations from the spec in `docs/sdd/auto-reply-hint/implementation-notes.md` (create if needed) following the precedent in `docs/sdd/agent-reply-support/implementation-notes.md`.
- **Verify**: all automated checks pass; the bundled `dist/` contains the hint string; deviations (if any) recorded.
- **Depends on**: Tasks 1, 2, 3
