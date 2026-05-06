# Explain-with-context: a static "context gatherer" for prompts

**Status:** Draft.

## What this is

When a reviewer runs `Explain this hunk` (or any prompt that focuses on a slice of code), the model often makes obvious mistakes because it can't see anything outside the slice. The slice is what we want it to *explain*, but the *substrate* — the function it sits in, the imports, sibling helpers it calls — is what makes the explanation correct.

This plan adds a **context gatherer**: a static-analysis step that, given the current focus (selection or hunk), produces a structured "background" payload to ship alongside the focus. It also covers the prompt-template and picker-UI changes that expose the new channel without making the prompt-author API gross.

This is (b) from the research thread on explain-this-hunk. (a) and (c) — provenance hints in the picker, renaming `hunk` → `selection` — landed separately and are prerequisites for the picker UX described below.

## TL;DR

- **One new prompt arg shape.** Add `auto: file.content` and `auto: file.context` hints. The first is the full post-change file when available; the second is the structured gatherer output (described below).
- **Context gatherer = pure function.** `gatherContext(file, hunk, selection, changeset) → FileContext`. Lives in `web/src/promptContext.ts`. No I/O, no model. Same pattern as `buildStructureMap`.
- **Graceful degrade is non-negotiable.** Memory-only and can't-clone-to-disk modes mean `fullContent`/`postChangeText` are sometimes absent. The gatherer returns whatever it has; the prompt template uses `{{#…}}…{{/…}}` blocks to omit empty sections. No disabled-tab UX.
- **Token budget is a feature, not an afterthought.** A `FileContext` has a hard char cap (configurable, defaulting somewhere around 16 KB). When over, we trim concentrically — the context gatherer is in charge of picking what survives, not the prompt.
- **The picker shows what's being sent.** The provenance line from (a) extends to file-context: "auto-filled — selection (3 lines) + file context (412 lines, 14 KB)". This is also the privacy surface — users see the size before sending.

## How to read this

- **Want the shape?** [The new prompt-arg hints](#the-new-prompt-arg-hints) and [`FileContext` schema](#filecontext-schema).
- **Want to know what the gatherer does?** [What we gather](#what-we-gather) and [What we don't](#what-we-explicitly-dont-gather).
- **Reviewing for cost?** [Token budget](#token-budget).
- **Reviewing for privacy?** [What the user sees](#what-the-user-sees-before-clicking-run).
- **Sequencing?** [Rollout](#rollout).

## Why a gatherer (and not just "ship the file")

Three reasons we don't just stuff `file.fullContent` into the prompt:

1. **Files get big.** A 4000-line file blows past any reasonable per-prompt budget. We need a policy for what to include and what to drop.
2. **The interesting context is rarely the whole file.** It's the function the hunk sits in, the imports it uses, the sibling functions it calls. A static pass can pick that out for ~5–10 % of the file's tokens.
3. **The same gatherer should serve other prompts.** `Security review`, `Suggest tests`, future `Find similar code`. The decision of "what's relevant background" belongs in one place, not duplicated per prompt.

The gatherer is the first half of the contract — "what context exists for this focus." The prompt template is the second half — "how to present it to the model." Keeping them separate means we can ship a richer gatherer (cross-file references, blame, recent commits) without touching every prompt.

## The new prompt-arg hints

Today `auto:` accepts: `selection`, `file`, `changeset.title`, `changeset.diff` (`web/src/promptStore.ts:178-195`). Add two:

| `auto:` hint | Returns | When unavailable |
|---|---|---|
| `file.content` | `file.postChangeText ?? linesToText(file.fullContent) ?? ""` | Empty string |
| `file.context` | Serialized `FileContext` (see below), trimmed to budget | Empty string |

Empty strings combine with the existing `{{#name}}…{{/name}}` block syntax (`web/src/promptStore.ts:142-148`) so prompts can author "include this section only if non-empty" without per-mode branching.

`explain-this-hunk.md` after this lands:

```yaml
---
name: Explain this hunk
description: Plain-English explanation of what the selected code does and why it might exist.
args:
  - { name: selection,    required: true,  auto: selection }
  - { name: file_context, required: false, auto: file.context }
---
Explain what this code does, in plain English. Treat `selection` as the
explanation target — `file_context` is background only, do not summarize it.

Selection (the thing to explain):

```
{{selection}}
```

{{#file_context}}
Background — the rest of the file the selection comes from:

```
{{file_context}}
```
{{/file_context}}
```

The model sees the selection as the focal point, the file context as wallpaper.

## `FileContext` schema

```ts
interface FileContext {
  /** Path of the file the focus comes from. */
  path: string;
  /** Full enclosing scope (function/class/block) at the cursor, if findable. */
  enclosing?: { kind: "function" | "class" | "block"; text: string };
  /** Imports/requires at the top of the file (verbatim, deduped). */
  imports?: string[];
  /** Sibling top-level definitions in the same file, signature only. */
  siblings?: { name: string; signature: string }[];
  /** Other hunks in the same changeset that touch the same file, summarised. */
  otherHunksInFile?: { header: string; summary: string }[];
  /** Files in the changeset that reference symbols defined in this file. */
  referencedBy?: string[];
  /** Char count of the serialized context — for the picker hint. */
  approxChars: number;
}
```

`gatherContext` returns this shape; serialization to a string for the prompt happens in a sibling `serializeFileContext` (so we can reshape the prompt format without changing the gatherer).

The shape mirrors `StructureMap` (`web/src/types.ts:188-192`) — *machine-derivable facts about the diff*, no model calls. Same testing posture as `parseDiff` and `plan.ts`: pure function, fixture-driven tests, fast.

## What we gather

Tier 0 (ship in v1 — all derivable from data we already have):

- **Enclosing scope** of the focus, found by walking back from the focus's `newStart` line in `file.postChangeText`/`fullContent` until we hit a top-level brace/`def`/`class`/`function`. Language-aware via `file.language`. Bail to "no scope" rather than guessing wrong.
- **Imports** — top-of-file lines matching language-specific patterns (`import …`, `from … import …`, `require(`, `use …`). Cheap, high-signal.
- **Sibling definitions in the file** — names + first-line signatures. Helps the model say "calls `foo` defined below" instead of guessing.
- **Other hunks in the same file** — already in `file.hunks`. Include a one-line per-hunk summary (the hunk header is enough).

Tier 1 (later, only if Tier 0 isn't enough):

- **Cross-file references** — the `StructureMap` already knows which other files in the changeset reference which symbols (`web/src/symbols.ts`). Wire it in.
- **Blame for the focus lines** — only when running in worktree mode where we have `git`. Strict opt-in (env flag).

## What we explicitly don't gather

- **Anything outside the changeset.** We don't open files the user didn't put in the diff. The product principle is "evidence over claims" (`AGENTS.md`) — context the user can't see in the UI shouldn't be sent to the model.
- **Comments mined from blame, PR descriptions, or chat.** Tempting, but it's the kind of context that rots and makes runs irreproducible.
- **Tokenizer-aware truncation.** We use chars, not tokens. Cheaper, predictable, and the model handles slightly-too-long inputs better than a naive char split would suggest. Revisit if budgets get tight.

## Token budget

One knob: `CONTEXT_CHAR_BUDGET`, default 16 000 (≈ 4 K tokens for the context section, leaving headroom for the focus, the prompt body, and the response).

Trimming order, when over budget:
1. Drop `referencedBy` (lowest signal).
2. Drop `otherHunksInFile` whose header is far from the focus.
3. Truncate `siblings` to the N nearest by line distance from the focus.
4. Truncate `enclosing.text` from the outside in (keep the lines closest to the focus).

The gatherer reports the final `approxChars` so the picker can show it.

If even after trimming we'd send more than 80 % of the budget, the picker shows a warning row above the run button: *"file context is large — consider editing it down."* The user can edit the textarea to remove parts; we don't auto-truncate harder than the algorithm above.

## What the user sees before clicking run

Building on (a)'s provenance line in `PromptForm`:

```
selection         required
auto-filled from your line selection — lines 12–14 (3 of 18)

[textarea, monospace, the slice]

file_context
auto-filled with file context (412 lines · 14 KB)  · edited

[textarea, monospace, the gatherer output, editable]
```

Two things the user can do:

1. **Edit the textarea** — same as today for `selection`. They can delete parts of the file context they don't want to send. The "edited" badge already proposed in (a) shows when the value diverges from the auto-fill.
2. **Toggle off** — for non-required args, an inline "× clear" button blanks the field, which means the prompt template's `{{#file_context}}…{{/file_context}}` block is omitted. This is the privacy escape hatch.

The size badge (`14 KB`) is the trust surface. We don't need a confirmation modal; the number on the page is enough — same approach as the diff itself, which the user can see before sending the rule-based plan.

## Capability and deployment-mode behavior

| Mode | `file.content` | `file.context` |
|---|---|---|
| Worktree ingest (server, on-disk repo) | full | full |
| Paste-a-diff in browser | empty (we don't have the post-image) | only `otherHunksInFile`; rest empty |
| Memory-only sandbox | empty | only `otherHunksInFile`; rest empty |
| Future: GitHub no-server | filled from GitHub API content endpoint | full |

The picker hint always shows what's available — never *"feature unavailable"*. If a prompt requires `file.context` and the gatherer returns empty, we just don't render that section in the prompt. The user sees an empty textarea with the auto-fill hint reading "no file context available in this mode" and can either fill it manually or run anyway.

## Sequencing

Three PRs, in order:

1. **The hint + the rename + serialize-from-diff (this PR's siblings).** (a) and (c). Foundation: provenance line, arg-name fix.
2. **`gatherContext` v1 + `auto: file.content`.** Tier-0 fields, char budget, tests. New prompt schema for `explain-this-hunk` ships behind this — test fixture coverage for both available and unavailable modes. Existing prompts left alone.
3. **Wire `auto: file.context` into `security-review` and `suggest-tests`.** Once we've watched the explain-this-hunk version for a week or two and the gatherer output looks sensible, share it. If the gatherer needs Tier-1 (`StructureMap` cross-refs), that lands as 3a.

## Open questions

- **Should `file.content` and `file.context` be one hint or two?** Current draft has two because `file.content` is dumb-and-cheap and `file.context` is structured. A consumer who really wants the whole file shouldn't have to consume the structured shape. Keeping them separate.
- **Where does the 16 KB default come from?** It's a guess; we'll calibrate after we've run the gatherer over a week of real changesets and looked at the size distribution.
- **Do we ship `enclosing` from a real parser or a regex hack?** v1 = regex per-language, deliberately loose, returns nothing rather than wrong on uncertainty. v2 = revisit if accuracy is the bottleneck. Don't pull in a parser dependency speculatively.
- **Do we want a "send full file regardless" escape hatch?** A `auto: file.full` hint that ignores the budget. Useful for prompts where the user knows the file is small. Probably yes; cheap to add. Not in v1.

## Files of interest

- `web/src/promptStore.ts` — `auto:` resolver, `AutoFillContext`, render template. The hint goes here.
- `web/src/promptContext.ts` (new) — `gatherContext`, `serializeFileContext`, the budget enforcement. Pure functions.
- `web/src/symbols.ts` / `web/src/plan.ts` — sources of cross-file/symbol info for Tier 1.
- `web/src/components/PromptPicker.tsx` — the size-and-trim UI on the form.
- `library/prompts/explain-this-hunk.md` — first prompt to use the new shape.
- `web/src/types.ts` — `DiffFile.fullContent` / `DiffFile.postChangeText` (the inputs we already have).
