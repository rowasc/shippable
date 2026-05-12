# Implementation Notes — Auto-Reply Hint

Implementation matched the spec. No behavioral deviations to record.

## Minor packaging notes

- **Hint wording shipped verbatim from the spec.** The `NEXT_STEP_HINT` constant in `mcp-server/src/handler.ts` is identical to the wording pinned in `spec.md § Chosen Approach`, broken across multiple string concatenations purely for source-file line-width. The user-facing string carries no line breaks beyond the single `\n\n` separator between the envelope and the hint.
- **README points at the constant rather than inlining the hint.** Per Task 2 do-step 2 — avoids drift if the wording is later tightened. The single source of truth is the constant in code.
- **No `TOOL_DESCRIPTION` change.** Spec explicitly kept this out; left untouched. If real-world compliance is still weak after the in-band hint lands, the smallest follow-up is to mirror the imperative phrasing into the description so both surfaces match (logged in `spec.md § Follow-ups`).

## Verification performed

- `npm run typecheck` in `mcp-server/` → clean.
- `npm run build` in `mcp-server/` → clean; `dist/handler.js` contains the hint string (`grep -c "report back to shippable" dist/handler.js` → `1`).
- `npm run test` in `mcp-server/` → 16/16 green. New assertions:
  - happy-path: `text` contains the envelope substring, `shippable_post_review_reply`, `report back to shippable`, and each of `addressed` / `declined` / `noted`; the hint appears *after* `</reviewer-feedback>`.
  - empty-queue: `text` equals `"No pending comments."` exactly and does **not** contain `shippable_post_review_reply`.
- Manual MCP smoke (start `server/` + invoke the tool over stdio) was not executed in this sandboxed devcontainer. Risk is low — the change is a pure string concatenation under unit-test coverage — but the human partner should sanity-check end-to-end before merging if a real harness is handy.

## Environment quirks (not blocking)

- `mcp-server/package.json` requires Node ≥ 22.12; this environment runs Node 20. `npm install` emitted `EBADENGINE` warnings but completed; vitest, tsc, and the build all ran cleanly. The transient `package-lock.json` drift produced by installing with the older Node was discarded before committing (`peer: true` flags shifting on optional sub-deps). Net effect on shipped code: zero.
