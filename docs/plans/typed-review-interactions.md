# Typed review interactions

Today the review primitive is a **comment** — a reply on a thread. Intent is in the prose: "this is wrong" might be a question, a complaint, a soft suggestion, or a blocker, and the next reader (human or agent) has to guess. GitHub bolts a single intent onto the *whole* review (`approve / request changes / comment`) but never per-thread, so reviewers re-encode intent inside body text with conventions ("nit:", "blocking:", "🚧").

This plan generalizes the primitive: a thread is a **review interaction** with an explicit `kind`. A comment is one kind. Ack is another (zero-body acknowledgement). Change-request, question, and blocker are the rest of the starter set. Subtypes are mutable in an append-only way: the original framing is preserved, the current framing is rendered prominently, and the path between them is visible.

This subsumes the earlier "ack on comments" idea — ack stops being a parallel mechanism on `state.ackedNotes` and becomes one of N interaction kinds.

## Goal

What this enables:

- Authoring an interaction with explicit intent — pick a kind alongside the body, no marker syntax in the prose.
- An ack as a first-class action on any thread (AI note, user comment, teammate review). One keystroke, no body required.
- A thread can evolve: a `comment` that turns into a `change-request` after agent dialogue carries both states. Original kind ≠ current kind is a supported, visible state.
- AI agents receive `kind` as structured intent in the wire payload, so a `change-request` reads differently from a `question` without prose-parsing.
- GitHub round-trip is lossless: kinds serialize as small leading markers; re-ingest parses them back.

What this does **not** try to do (yet):

- Per-kind enforcement (e.g. "block PR until all change-requests are resolved"). Kinds are visible signal first; enforcement is a follow-up.
- Multi-author voting on a single thread (kind by majority, etc.). Single-author per kind-event for now.
- Cross-thread aggregation ("show me all open blockers"). Likely a follow-up surface; the data shape supports it.

## Starter taxonomy

Five kinds to land. The first three map cleanly to GitHub's review mental model; the last two are local concepts that serialize as plain comments with a marker.

| kind            | what it means                                          | needs body? | github serialization     |
| --------------- | ------------------------------------------------------ | ----------- | ------------------------ |
| `comment`       | observation, no expectation ("fwiw…", "this is nice") | yes         | plain comment            |
| `question`      | expects an answer                                      | yes         | `❓ <body>`              |
| `change-request`| expects a code change                                  | yes         | `🔧 <body>`              |
| `blocker`       | change-request + "won't approve until fixed"           | yes         | `🚧 <body>`              |
| `ack`           | mark-as-read, no action expected                       | no          | `✓` (or skipped on push) |

Open: whether `ack` should round-trip to GitHub at all. It's a triage signal — locally meaningful, possibly noise on a public PR. Default proposal: skip on push, retain locally.

Open: whether to add `praise` as distinct from `comment`. Reviewer.dev and Conventional Comments both call this out as worth its own affordance. Lean toward yes — emotional cost of "comment" is heavier than "praise", and praise gets under-used because of it.

## Data model

Today:

```ts
interface Reply { id; author; body; createdAt; …agent fields }
```

Add one field:

```ts
type InteractionKind = "comment" | "question" | "change-request" | "blocker" | "ack" | "praise";

interface Reply {
  // …existing fields
  kind?: InteractionKind;  // undefined on legacy replies → treated as "comment"
}
```

Why on `Reply` and not on the thread:

- Replies are already append-only inside `state.replies[key]`. Per-Reply `kind` reuses that immutability — no parallel event log.
- Thread-level "current kind" is a derivation: walk the replies, take the last one that explicitly set a kind. Original kind = first reply's kind.
- A pure kind-change (no new body) is just a `Reply` with empty body and a `kind`. UI renders as an event ("@you escalated [COMMENT → CHANGE] · 2:14pm"), not a comment card.

Inheritance rule: a new reply inherits the previous kind unless it explicitly sets one. Most replies don't change intent, so the default keeps them silent.

### Migration

Existing replies have no `kind` field. Treat `undefined` as `comment` at the read seam — no rewrite of persisted state. The migration is implicit: the next time a thread is touched, the new reply may carry a kind.

`state.ackedNotes` (the current Set keyed by `${hunkId}:${lineIdx}`) becomes legacy. Keep the read path (so persisted acks still render as acked AI notes) but stop writing to it. New acks go in as a `Reply { kind: "ack", body: "" }` on the appropriate thread. A one-shot migration on load can convert each `ackedNotes` entry into a synthetic `Reply` keyed by `note:HUNK:IDX`, then clear the Set.

## UI rendering

### Composer

When starting a new interaction (today's `c` flow), present the kind picker inline alongside the body box. Default: `comment`. Keyboard shortcuts:

- `c` — new comment (default kind)
- `q` — new question
- `x` — new change-request
- `b` — new blocker
- `a` — ack (zero-body; submit immediately)

(Mirrors today's `c` / `a` keys; widens them.)

### Thread card

Header shows current kind as a chip:

```
[CHANGE] suggestions/Pagination.tsx · L42
```

If original ≠ current, append a fade-in caption:

```
[CHANGE] · was [COMMENT] · evolved 2:14pm
```

Hover/click expands to a small timeline of kind events.

Per-reply rendering is unchanged for body-bearing replies. A body-less kind-change reply renders as an inline event row inside the thread, not as a card.

### Sidebar / status bar

Comment badge can split by kind: `❝3 ❓1 🔧2`. Or stay aggregate and let the inspector filter. (Decide on first iteration.)

The `n` / `N` walk: still steps through every interaction stop. Acked threads dim but still get visited — see open question on inbox-zero behavior.

## Wire format

### Local → agent (existing `shippable_check_review_comments` MCP envelope)

Add `kind` to the per-comment payload (`docs/plans/share-review-comments.md` § 131). The agent receives:

```json
{
  "id": "…",
  "kind": "change-request",
  "originalKind": "comment",
  "file": "…",
  "lines": "…",
  "body": "…"
}
```

`originalKind` only present when ≠ `kind`. Agents that want to behave differently for change-requests vs comments now can.

### Local ↔ GitHub

Push: prepend the kind glyph to the comment body unless `kind === "comment"`:

- `change-request` → `🔧 <body>`
- `question` → `❓ <body>`
- `blocker` → `🚧 <body>`
- `praise` → `✨ <body>` (if we add it)
- `ack` → not pushed (open question above)

Pull: regex-strip the leading glyph on re-ingest; map back to kind. Lossless across round-trips because the glyph is removed before display *and* before next-push, so re-ingested comments don't accumulate `🔧 🔧 🔧` prefixes.

Edge case: a reviewer who actually wants `🔧` as the first character of their body. Acceptable casualty for v0; revisit with a zero-width sentinel if it ever bites.

## Open questions

Pinning these before any code:

1. **Inbox-zero or visual-only?** Does ack hide a thread from `n` / `N` navigation, or just dim it in place? Today's AI-note ack hides the status-bar nudge but keeps the note visible.
2. **Praise as a distinct kind?** Reviewer.dev / Conventional Comments argue yes; the marginal UI cost is small.
3. **Who can evolve a kind?** Just the original author? Anyone on the thread? The agent (when an agent reply lands, can it implicitly promote a comment to a change-request)?
4. **Does ack serialize to GitHub?** Default no; revisit if reviewers actively want their ack visible to the PR author.
5. **Sidebar badge: aggregate or per-kind?** First version probably aggregate; per-kind once the rendering is settled.

## Slices

Roughly in order; each is independently shippable.

1. **Add `kind` to `Reply`, default `"comment"`.** Read-only — every existing reply renders identically. Type plumbing only.
2. **Composer kind picker + new keys (`q`, `x`, `b`).** Authoring carries kind; thread chip shows it. No evolution UI yet.
3. **Ack as a kind.** New `a` flow writes a body-less `Reply { kind: "ack" }`; legacy `ackedNotes` reads still work. Migration on next save converts.
4. **Kind evolution.** Body-less kind-change replies; thread card shows `was [COMMENT]`.
5. **Wire payload.** Add `kind` + `originalKind` to the MCP comment envelope.
6. **GitHub round-trip.** Push glyph prefix; re-ingest strip + parse.
7. **(Maybe)** Praise, sidebar split, kind-aware filters.

## Risks

- **Picker fatigue.** If the composer demands a kind on every comment, people will pick the default and the taxonomy collapses to "comment for everything." Mitigation: default is `comment`, picker is one keystroke away, never blocking.
- **Marker collision in re-ingested PRs.** Comments authored on GitHub by people who already use `🔧` / `🚧` in their prose will get mis-classified on ingest. Acceptable for v0; mitigate by only stripping the marker when it's the first character followed by a space.
- **Over-abstraction.** "Review interaction" is broader than today's primitive but it's still a comment thread under the hood. Resist adding non-thread interactions (reactions, votes) to this model — those are different concepts.
