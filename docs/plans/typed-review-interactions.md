# Typed review interactions

Today the review primitive is a **comment** — a reply on a thread. Intent is in the prose: "this is wrong" might be an observation, a request, or a blocker, and the next reader (human or agent) has to guess. GitHub bolts a single intent onto the *whole* review (`approve / request changes / comment`) but never per-thread, so reviewers re-encode intent inside body text with conventions ("nit:", "blocking:", "🚧").

We already carry typed intent in several places, but each as its own private vocabulary:

- `Reply` (user-authored) — intent only in prose.
- `state.ackedNotes` — a parallel `Set<string>` flag, only valid for AI-note threads.
- `AiNote.severity` — `"info" | "question" | "warning"`.
- `hunk.teammateReview.verdict` — `"approve" | "comment"`.
- `AgentReply.outcome` — `"addressed" | "declined" | "noted"`.

Five vocabularies, all describing the same conceptual thing: *what does this interaction express?* This plan generalizes the primitive: every author (user, AI, teammate, agent) emits **review interactions**, each interaction carries an explicit **intent**, and the interactions stack append-only on a shared store. A comment is one intent. Ack is another. Request is the rest of the starter set.

This subsumes `ackedNotes` (ack becomes an intent), `AiNote.severity` (severity maps to intent), `teammateReview.verdict` (verdict maps to intent), and eventually `AgentReply.outcome` (outcome maps to intent). The underlying ingest shapes don't have to disappear in one go — they project into the unified store at the read seam.

## Goal

What this enables:

- Authoring an interaction with explicit intent — pick from the composer, no marker syntax in the prose.
- An ack as a first-class action on any thread (AI note, user comment, teammate review, PR-imported comment). One keystroke, no body.
- A thread can evolve: a `comment` that becomes a `request` after agent dialogue carries both states. Original intent ≠ current intent is a supported, visible state.
- AI agents receive `intent` as structured signal in the wire payload, so a `request` reads differently from a `comment` without prose-parsing.
- Cross-thread aggregation is a first-class read ("show me all open requests", "9 open / 2 acked"). The data shape supports it from slice 1 because it will be required for the inbox view.
- GitHub round-trip is lossless **for comments Shippable authored**, and *only* for those. Every Shippable push carries a mandatory HTML-comment sentinel as a soft footer (`<!-- sp:v1 intent=… id=… -->`) — the parser's source of truth, invisible in the GitHub UI. Non-default intents also get a small visible glyph at the start of the body (`🚧` blocker, `🔧` request, `❓` question, `✓` accept, `✗` reject) — nice for human readers, carries no Shippable branding. On re-ingest we read intent from the sentinel; if there's no sentinel, the comment is foreign and stored as plain `intent: "comment"`. We never inspect prose for stray glyphs, brackets, conventional-comments syntax, or any other in-body convention. PR-imported comments live in the local thread store and can be enqueued to the agent like any other interaction.

What this does **not** try to do (yet):

- Per-intent enforcement (e.g. "block PR until all requests are resolved"). Intent is visible signal first; enforcement is a follow-up.
- Multi-author voting on a single thread. Single author per intent-event for now.

## Naming: two dimensions, two words

We've been overloading `kind` for two unrelated things. We need to separate them before adding the intent axis.

**Today:** `Comment.kind` on the wire is `"line" | "block" | "reply-to-ai-note" | "reply-to-teammate" | "reply-to-hunk-summary"`. That's *where the interaction is attached* — line vs block, fresh thread vs reply to a particular note-type. It is not about intent. The five reply variants are also redundant: the existing `threadKey` prefix (`note:` / `hunkSummary:` / `teammate:` / `user:` / `block:`) already encodes parent provenance, and an interaction's `authorRole` (`user` / `ai` / `teammate` / `agent`) further discriminates. The target axis adds no information that isn't already addressable through those.

**Proposal:** rename that dimension to **`target`** — "what the interaction targets / attaches to" — and collapse it to three values: `"line"`, `"block"`, `"reply"`. `line` and `block` are fresh-thread anchors on code; `reply` is a reply to anything else. Consumers that need to discriminate "reply to what kind of parent?" read the `threadKey` prefix or the projected thread's head `authorRole` (see § Cross-thread aggregation). The minor cost of `target` is that `targetKey` already exists in the `ADD_REPLY` action; that's a small overload but actually consistent with the new field's meaning.

The umbrella name for both dimensions together is **interaction**.

**On agent-authored thread heads.** Today the agent only responds to existing threads (via the nested `agentReplies` shape). The plan future-proofs for the agent eventually starting fresh threads on its own — flagging "I noticed something during a session" without waiting to be asked. The agent can author a fresh-thread interaction with `target: "line"` or `target: "block"`; its identity rides in `author` / `authorRole: "agent"`. Replies to an agent-started thread use `target: "reply"` like any other reply; renderers that want to differentiate "the responder is talking to the agent" inspect the thread's head `authorRole`, not the target. No new target variant is needed.

So:

```ts
type InteractionTarget =
  | "line"   // fresh thread on a single line (any author)
  | "block"  // fresh thread on a line range (any author)
  | "reply"; // reply to an existing thread of any provenance

// Asks: start a thread on code, or restate the thread's ask in a reply.
type AskIntent =
  | "comment"   // observation, no expectation
  | "question"  // expects an answer, not necessarily a code change
  | "request"   // expects a code change, non-blocking ("nit", "would be nice")
  | "blocker";  // expects a code change AND won't approve until it lands

// Responses: only valid as replies to other interactions. Never attach to code.
type ResponseIntent =
  | "ack"       // saw it, no commitment either way
  | "unack"     // retracts the author's prior ack on the same thread
  | "accept"    // agreed; will do (or have done)
  | "reject";   // disagreed; explain why (body required)

type InteractionIntent = AskIntent | ResponseIntent;
```

The asks-vs-responses split is load-bearing — it constrains *where* each intent is allowed to appear (see § Validity), not just what it means. A response intent that targets a line of code is a category error, the same way an ack with no thread to ack would be.

Each split in this set is doing real work, not decorative:

- `request` vs `blocker` — without it, reviewers fall back to the prose conventions we're trying to replace (`nit:` for non-blocking, `blocking:` for blocking). Even before per-intent enforcement exists, the label tells the author what they have to do before merge versus what they can defer or ignore.
- `question` vs `comment` — a question expects an answer; a comment doesn't. Conflating them mis-cues the agent (which would otherwise treat the thread as inert) and the human author (who'd skip past the thread thinking it's resolved). It also gives us a clean mapping for `AiNote.severity = "question"` instead of squashing it into `comment` and losing fidelity at the projection seam.
- `ack` vs `accept` vs `reject` — ack is "I've seen this, no commitment." Accept is "agreed, will do or have done." Reject is "no, won't do — and here's why." Today's `AgentReply.outcome = "addressed" | "declined" | "noted"` already encodes this distinction for the agent; lifting it to a first-class human-authorable intent unifies the vocabularies. Without the split, accepting and rejecting a reviewer's request both look like "ack" in the thread, and the reviewer has to read prose to know which it was.
- `unack` is the inverse of `ack`. Replies are append-only, so toggling-off the user's prior ack cannot literally remove the earlier `Reply`. Instead we emit a `Reply { intent: "unack", body: "" }` that the *current-response* derivation reads as "this author's most recent response was to retract the ack." The thread's history preserves both events; the current state is unacked. Without this intent, ack would be one-way and "I clicked the wrong thing" has no in-model fix.

`praise` is not added. The user-visible affordance for "this is nice" is just `comment` for now. Revisit if reviewers report under-using positive signal because the same affordance carries critique.

## Starter taxonomy (v0)

Eight intents to land — four asks and four responses. They cover the live signals in the system today (severity, verdict, ack, agent outcome) and add the affordances the prose-convention workarounds tell us reviewers want (`request`/`blocker`/`question`/`accept`/`reject`), plus the inverse needed to keep the append-only model consistent (`unack`).

| intent       | category | meaning                                                       | needs body? | github serialization                       |
| ------------ | -------- | ------------------------------------------------------------- | ----------- | ------------------------------------------ |
| `comment`    | ask      | observation, no expectation                                    | yes         | body + sentinel footer (no visible marker) |
| `question`   | ask      | expects an answer                                              | yes         | `❓ <body>` + sentinel footer              |
| `request`    | ask      | expects a code change, non-blocking                            | yes         | `🔧 <body>` + sentinel footer              |
| `blocker`    | ask      | expects a code change AND won't approve until it lands         | yes         | `🚧 <body>` + sentinel footer (also flips PR verdict, see § PR-level verdict) |
| `ack`        | response | saw it, no commitment                                          | no          | skipped on push                            |
| `unack`      | response | retracts the author's prior ack on the same thread             | no          | skipped on push                            |
| `accept`     | response | agreed; will do / have done                                    | optional    | `✓ <body?>` + sentinel footer              |
| `reject`     | response | disagreed; explain why                                         | yes         | `✗ <body>` + sentinel footer               |

Mapping the existing vocabularies:

| existing signal                       | maps to intent (when projected) |
| ------------------------------------- | ------------------------------- |
| `Reply` (no kind field today)         | `comment`                       |
| `state.ackedNotes` entry              | `ack`                           |
| `AiNote.severity = "info"`            | `comment`                       |
| `AiNote.severity = "question"`        | `question`                      |
| `AiNote.severity = "warning"`         | `request` (the human can escalate to `blocker` if appropriate) |
| `teammateReview.verdict = "approve"`  | `ack`                           |
| `teammateReview.verdict = "comment"`  | `comment`                       |
| `AgentReply.outcome = "addressed"`    | `accept` (the agent committed to / made the change) |
| `AgentReply.outcome = "declined"`     | `reject`                        |
| `AgentReply.outcome = "noted"`        | `ack`                           |

`AiNote.severity = "warning"` deliberately does **not** project to `blocker`. Warnings are "this looks wrong" — they don't carry merge-gating semantics. The reviewer reading the warning is the right person to decide whether it blocks merge.

The `AgentReply.outcome` mapping is now lossless — `addressed`/`declined`/`noted` had no clean home in a 5-intent set, but accept/reject/ack restores the 1-1 correspondence.

These mappings are conventions for the projection at read time. The underlying typed fields keep working as ingest carriers; we don't have to migrate them to land the projection.

Open: whether `ack` / `unack` / `accept` / `reject` should round-trip to GitHub. They're response signals — locally meaningful, but on a public PR `accept` and `reject` are arguably useful (the PR author wants to see "did the reviewer accept my response or reject it?"), while `ack` / `unack` are pure local triage. Default proposal: push `accept` / `reject`; skip `ack` / `unack`. Revisit during slice 6.

## Data model

### Reply gains `intent` and `target`

```ts
interface Reply {
  // …existing fields (id, author, body, createdAt, anchorPath, external, …)
  intent: InteractionIntent;       // required on new replies
  target: InteractionTarget;       // moved from Comment; required on new replies
  enqueueOptIn?: boolean;          // gate for PR-imported replies; see § GitHub-comments-as-interactions
}
```

`intent` and `target` are **required on new replies**. The user feedback was explicit: every interaction states its own intent — no inheritance. A reply to a thread of `request`s does not silently become a `request`; the author picks the intent every time. Default in the composer is `comment`; one keystroke or click changes it.

`enqueueOptIn` is only used for PR-imported replies (`external?.source === "pr"`) — it's the per-reply flag the "Share PR comments with agent" gesture flips on (see § GitHub-comments-as-interactions). Local-authored replies don't carry it (or carry implicit `true`).

We have no users yet, so there is no legacy `Reply` shape to project from. See the Migration section — old persisted snapshots are wiped, not upgraded.

### Validity: which intents go where

The interaction's `target` and `intent` are not freely combinable.

| `target`         | allowed intents                                         |
| ---------------- | ------------------------------------------------------- |
| `line`, `block`  | asks only — `comment`, `question`, `request`, `blocker` |
| `reply`          | any intent — asks *and* responses                       |

In words: response intents (`ack`, `unack`, `accept`, `reject`) only ever attach to other interactions. They never start a fresh thread on a line of code, because there is nothing to respond to. The composer enforces this — pressing `c` (fresh thread) only offers ask intents in the picker; response intents are reachable only via `r` (reply) or the `a` shortcut on a focused thread (which decides between `ack` and `unack` based on the author's current state).

Validation lives at three seams:
- **Composer** — picker hides response intents in fresh-thread mode (no UI to construct an invalid pair).
- **Reducer** — `ADD_REPLY` rejects a Reply whose `(target, intent)` pair is invalid.
- **Wire ingest** — `server/src/index.ts` validation rejects malformed payloads from the agent. (The agent shouldn't be authoring fresh acks in the first place; this is belt-and-braces.)

### Body-less interactions

Two cases:

- **Response with no body** — `ack` always has empty body; `accept` may. Both render as event rows in the thread, not comment cards.
- **Intent evolution** — a body-less reply that restates the ask (e.g. `Reply { intent: "blocker", body: "" }` to escalate a request to a blocker without new prose). Same render — event row, with the transition shown.

Body-less replies do enqueue to the agent (per user direction): an ack on a teammate's note is a signal the agent should know about. The wire envelope carries `body=""` and the intent is the load-bearing piece. The agent's tool description should note that empty-body interactions are intent-only events.

### AI notes, teammate reviews, agent replies: projection, not migration

We do not flatten `DiffLine.aiNote`, `Hunk.teammateReview`, or `Reply.agentReplies` into the reply store on disk. Those stay as ingest shapes — they're easier to load and validate as typed records.

At the **render seam** (the view layer in `view.ts`), a uniform `Interaction[]` view is produced by walking all sources for the diff:

```ts
interface Interaction {
  id: string;
  author: string;
  authorRole: "user" | "ai" | "teammate" | "agent";
  intent: InteractionIntent;
  target: InteractionTarget;
  threadKey: string;        // existing reply-key
  body: string;
  createdAt: string;
  // …carries through anchor/runRecipe/htmlUrl when relevant
}
```

`originalIntent` is not a field on `Interaction`. Because every reply already carries its own `intent`, the thread's "original intent" is simply `interactions[0].intent` for that thread — derived at the read seam (the selector) rather than serialized per interaction. This avoids the per-interaction-vs-thread-level confusion that would arise from denormalizing thread metadata onto every event.

This is the surface every downstream consumer reads from — the sidebar, the inspector, the `n`/`N` walk, the agent enqueue path, the GitHub push path. It is the answer to "what does this thread say right now," derived; not stored.

Slice 1 ships the projection as a pure selector over current state — no storage changes. Subsequent slices add `intent`/`target` as authoritative on Reply for new authoring.

### Thread current intent

A thread's *current ask* is the intent of the latest reply whose intent is in the ask set (`comment` / `question` / `request` / `blocker`). Response intents (`ack` / `unack` / `accept` / `reject`) don't shift the current ask — they record where the conversation stands relative to the ask, not what the ask is.

A thread's *current response*, per author, is the intent of that author's latest response-intent reply, if any. `unack` is treated as "this author has no current response" — it cancels their prior `ack` rather than counting as a response of its own. The thread-level current response is rolled up across authors and surfaces as the status badge. This is what powers "is this thread resolved?" — a `request` followed by `accept` is resolved-positive; followed by `reject` is resolved-negative; followed by `ack` then `unack` is open again.

"Original intent" is `interactions[0].intent` — the intent of the first interaction on the thread. Always an ask (responses can't start threads). Derived from the reply array, not stored.

When original ≠ current ask, the thread card shows both. When a current response exists, the card shows that as a status badge ("✓ accepted", "✗ rejected", "👁 acked").

### Cross-thread aggregation (build for it now)

The user direction was explicit: assume this is required. The shape that makes it cheap:

```ts
// Derived, memoized by (changesetId, repliesRevision, ackedNotesRevision).
function selectInteractions(state: ReviewState): {
  all: Interaction[];
  byIntent: Record<InteractionIntent, Interaction[]>;
  byThreadKey: Record<string, Interaction[]>;
  threads: Array<{
    threadKey: string;
    headAuthorRole: "user" | "ai" | "teammate" | "agent";  // derived: interactions[0].authorRole — the discriminator that was previously baked into the target variant
    currentAsk: AskIntent;             // derived: latest ask-intent reply
    originalAsk: AskIntent;            // derived: interactions[0].intent (always an ask)
    currentResponse: Exclude<ResponseIntent, "unack"> | null;  // derived: thread-level rollup; `unack` cancels and resolves to null
    interactions: Interaction[];
  }>;
}
```

`repliesRevision` and `ackedNotesRevision` are monotonic counters added to `ReviewState` in slice 1 (the reducer increments them on every write to the corresponding slice). They are the only inputs the selector needs to invalidate its memo — `changesetId` switches with the diff, the two counters cover every interaction-relevant mutation.

This selector lives next to `view.ts` and is the single read path for every consumer that today walks `state.replies` directly. The inbox view ("all open requests across the diff", "all acked threads") is a `byIntent` lookup; the per-thread card is a `byThreadKey` lookup; the `n`/`N` walk is `threads` ordered by file position.

Doing this in slice 1 makes the rest of the slices much smaller because they read from a stable interface.

### Migration

There is none. We have no users yet, no production data, no preserved review state we owe anyone. On the first load after this lands, the persisted snapshot is wiped: any old `replies`, any `ackedNotes`, any teammate review history. The store starts empty and new authoring populates it with the new shape (`intent` and `target` required on every Reply).

Concretely:

- Bump `CURRENT_VERSION` in `web/src/persist.ts` from `2` to `3`.
- **Do not add a migration entry** for `2 → 3`. Stored snapshots whose version isn't exactly `3` are rejected at load and the store boots empty. The migration table is for forward-compatible shape changes; this isn't one.
- Slice 3 does not need to fall back to reading `state.ackedNotes` for legacy acks; the field disappears in the same commit that introduces the `ack` Reply.

If we ever ship to real users this changes. Note for future-us: anything stored on disk before that ship date is fair game to wipe.

## Workflow: authoring, replying, evolving

The user asked for an explicit workflow proposal. Here it is.

### Composer principle: body-first, classify whenever

The composer is **body-first**. The intent picker is always visible, but the cursor lands in the body on open and the user is encouraged to just start typing. Classification happens whenever — before, during, or after writing the body, and changing intent mid-draft never clears what's been typed. Three rules drop out of this:

- **No upfront commitment.** Default intent is `comment` (the most common ask) and the picker is editable until submit. The user can write a sentence, realize it's a blocker, switch, and submit — without having to restart.
- **Intent change is cheap.** A single keyboard chord (final binding TBD with the implementation; candidates: `Mod+I` to cycle forward, `Mod+Shift+I` backward, or `Mod+1`–`Mod+4` for direct selection of the four asks) flips intent without taking focus off the body. Click on the picker chip works too.
- **Body content survives intent changes**, including transitions to body-less intents. If the user types two paragraphs and then picks `ack`, the body field visually collapses but the content is preserved; if they switch back, it reappears. Submitting as `ack` from a non-empty body shows a one-tap "submit as ack and discard text?" confirm — preventing accidental data loss without nagging.

Inline marker shortcuts (`! ` for request, `?? ` for question, `!! ` for blocker — typed at the very start of the body) are a power-user convenience; they visibly switch the picker so the user sees what happened. Convention-based, undoable, never required.

### Authoring a fresh interaction

1. Cursor on a line (or block selection).
2. Press `c`. Composer opens with the body field focused and the intent picker pre-selected to `comment`.
3. Just start typing. Switch intent at any point via the picker, the intent chord, or an inline marker. Only the four **ask** intents are offered here — see § Validity.
4. `Cmd+Enter` submits. A `Reply { intent, target, body, author }` lands in `state.replies[threadKey]`; the enqueue POST runs in parallel (same as today).

### Replying to a thread

1. Cursor on a thread.
2. Press `r`. Composer opens *under that thread*, body focused. Intent picker shows the thread's current ask as default; all seven intents are offered, visually grouped as "asks" and "responses."
3. When the thread's current ask is `request` or `blocker`, the response options (`accept` / `reject` / `ack`) are surfaced first in the picker since they're the most likely choices. Otherwise (`comment` / `question` thread), responses sit second.
4. If the picked intent is `ack` or `accept`, the body field collapses to optional; `Cmd+Enter` submits immediately. `reject` requires body. Same body-survives-switching rule as above.
5. Same submit path.

### Evolving a thread's ask without a body

Two paths, both restricted to ask intents (you can't "evolve" a thread into being a response):

- **From the thread**: press `r`, change to a different ask intent, leave body empty, submit. A body-less Reply with the new ask intent lands. Renders as `@you marked as [BLOCKER] · 2:14pm` event row.
- **From the focused thread**: a keyboard escalation `>` (TBD — see § Keybindings) bumps to the next-stricter ask in `comment` → `question` → `request` → `blocker` order, emitting the body-less Reply.

Response intents (ack / unack / accept / reject) do not change the thread's current ask. They populate the thread's *current response* slot instead — the selector keeps these axes separate (see § Thread current intent).

### Who can evolve

V0: anyone with author access to the local thread (i.e. the local reviewer). The agent's reply implicitly maps to its `outcome`, which projects to intent at the read seam but does not write a "kind-change" Reply event — the agent's last reply *is* the thread's current intent on the agent's side.

PR-imported authors (other GitHub reviewers) do not get write access locally. Their replies show their author identity and original intent; the local reviewer can ack them or reply to them, but cannot rewrite their intent.

### Responding (ack / unack / accept / reject)

`a` on a focused thread toggles the author's ack state by appending one of two responses:

- If the author has no current ack on this thread, it appends `Reply { intent: "ack", body: "" }`.
- If the author's most recent response on this thread is `ack`, it appends `Reply { intent: "unack", body: "" }`.

The append-only log preserves every press; the current-response derivation reads the author's latest entry to know whether they are currently acked. This generalizes today's `ackedNotes` toggle (which only worked on AI notes) without violating the no-mutation invariant.

Accept and reject route through the reply composer rather than dedicated single-letter keys: `n` and `N` are already the interaction-walk navigation, and the obvious mnemonics (`y`/`n`) collide with that. The flow is:

1. Press `r` on the focused thread — composer opens, picker defaults to the thread's current ask.
2. Pick `accept` or `reject` from the picker (Tab cycles; the picker surfaces these first when the thread is `request`/`blocker` per § Replying).
3. Body is optional for `accept`, required for `reject` (rejection without a reason is the bug we're trying to prevent).
4. `Cmd+Enter` submits.

If usage shows accept/reject are common enough to warrant single-letter shortcuts later, candidates are `A` (Shift-A) for accept and `X` for reject. Not bound in v0 — first see how often they're used through the composer.

## GitHub comments are interactions, stored locally

The user direction: PR comments should live in local threads so the agent can review them.

Today the pieces already exist:
- `server/src/github/pr-load.ts` builds `prReplies: Record<string, Reply[]>` and `prDetached: DetachedReply[]` from `pull_request_review_comments`.
- The reducer (`MERGE_PR_REPLIES`, `state.ts:472`) merges them into `state.replies`.
- They carry `external: { source: "pr", htmlUrl }` so the persist layer skips them on save (they re-arrive on next load).
- The enqueue path filters them out: `state.ts:477,481` excludes any `external?.source === "pr"`.

**The change:**

1. Change the enqueue-time filter from "exclude PR-source" to "exclude PR-source unless flagged." Each `Reply` gains an `enqueueOptIn?: boolean` flag; the gesture in step 3 sets it to `true`. PR-source replies without the flag are still skipped by enqueue exactly as today; flagged ones flow through the existing enqueue path. No change to local-authored replies — they remain always-eligible.
2. Don't enqueue them automatically. Default: PR comments sit in the local store unsent. Auto-enqueueing every PR comment would flood the agent with stale conversation.
3. Add an explicit per-PR gesture: a `Share PR comments with agent` button in the changeset header (only visible when `prSource` is set and there are PR-imported interactions in the store). Clicking it stamps `enqueueOptIn: true` on each PR-imported reply that hasn't already been enqueued, which makes the enqueue path pick them up on the next run. Subsequent edits/acks behave like local interactions.
4. The wire payload preserves the original author (`Reply.author`) and surfaces `external.htmlUrl` so the agent can deep-link back to GitHub. The agent's tool description gets a note: "Comments may include PR-imported items from other reviewers — `author` and `external.htmlUrl` indicate provenance."
5. PR ingest applies the *same* marker-strip pass as the rest of the GitHub pull path (per § Wire format): a comment carrying a Shippable HTML sentinel (`<!-- sp:v1 intent=<intent> id=<id> -->`) is parsed into `Reply { intent: <intent>, body: <body-without-sentinel-and-glyph> }`. **Everything else stays as `intent: "comment"` with the body verbatim** — bare-emoji prose, conventional-comments syntax, `[REQUEST]` brackets, anything without the sentinel. No heuristic guessing. Same asymmetric rule as § Local ↔ GitHub; PR-ingest is just one caller of that parser.

This means the agent reviews PR comments — first-party reviewers' notes get the same treatment as local reviewers' notes. That's the whole point of the unification.

## UI rendering

### Composer

The picker sits *above* the body, not inline, so the body field gets its full width and feels like the primary affordance. Body is focused on open. Default intent: `comment`. The picker is one chord (or click) away — see § Composer principle.

```
┌──────────────────────────────────────────────┐
│  💬 comment   ❓ question   🔧 request   🚧 blocker │  ← picker row
│  ─────────────────────────────────────────── │
│  body...                                     │  ← body, auto-focused
│                                              │
│                          Cmd+Enter to submit │
└──────────────────────────────────────────────┘
```

The selected intent is visually highlighted; the others are dimmed but clickable. The intent label appears beside the submit button too (`Submit comment` / `Submit blocker`) so the user always sees what they're about to send.

When the picker switches to a body-less intent (`ack`, optionally `accept`):
- The body field collapses but its content is preserved in component state.
- The submit button label updates (`Submit ack`).
- Submitting from a non-empty preserved body shows a one-tap confirm: "Submit as ack and discard text?" — never silent data loss, never blocking.
- Switching back re-expands the field with the typed content intact.

### Thread card

Header shows current intent as a chip:

```
[REQUEST] suggestions/Pagination.tsx · L42  (was [COMMENT] · evolved 2:14pm)
```

If original = current, suppress the trailing caption. Hover/click on the chip expands a small timeline of intent events.

Per-reply rendering is unchanged for body-bearing replies. A body-less intent-change reply renders as an inline event row inside the thread, not as a card.

### Sidebar / status bar

Aggregate badge in v0 (`9 interactions`). Per-intent split (`💬3  🔧2  ✓4`) once the rendering is settled. The selector returns both shapes so flipping between is a one-line change.

`n` / `N` walk: still steps through every interaction stop. Acked threads dim but still get visited (consistent with today's AI-note ack behavior). The inbox view (a follow-up) filters this to `currentIntent === "request"` by default.

## Wire format

### Local → agent (existing `shippable_check_review_comments` MCP envelope)

Per-interaction payload picks up `intent` and `target` separately. The old `kind` attribute is renamed to `target`. The new `intent` is added, alongside `author` and `authorRole` so the agent can tell who made each interaction.

Per-element attribute set:

| attribute     | required | values                                                | notes                                                                 |
| ------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `id`          | yes      | opaque string                                          | reply-back via `shippable_post_review_comment`                        |
| `target`      | yes      | `InteractionTarget` (see Naming section)               | replaces the old `kind` attribute                                     |
| `intent`      | yes      | `InteractionIntent` (see Naming section)               | new                                                                   |
| `author`      | yes      | display name                                           | who wrote it (local reviewer, PR reviewer, teammate ingest, …)        |
| `authorRole`  | yes      | `"user" \| "ai" \| "teammate" \| "agent"`              | how the consumer should treat it; PR-imported reviewers are `user`   |
| `file`        | yes      | repo-relative path                                     | (unchanged)                                                            |
| `lines`       | when relevant | line or range as today                            | omitted for thread-level interactions where lines don't apply         |
| `htmlUrl`     | when PR-sourced | `external.htmlUrl`                                | provenance link back to GitHub                                        |

`originalIntent` is **not** a wire attribute — the agent derives it from the ordered thread of interactions if it cares. Sending it per-element would denormalize thread metadata onto every event.

```xml
<reviewer-feedback from="shippable" commit="<sha>">
  <interaction id="cmt_3f7a91" target="block" intent="request"
               author="@romina" authorRole="user"
               file="server/src/queue.ts" lines="72-79">
    The atomic-ish rename here only avoids torn reads, not concurrent
    writers…
  </interaction>
  <interaction id="cmt_b22c04" target="reply" intent="comment"
               author="@romina" authorRole="user"
               file="web/src/state.ts" lines="118">
    AI note said this branch was unreachable. It's reachable from the
    keymap handler…
  </interaction>
  <interaction id="cmt_a91e02" target="reply" intent="ack"
               author="@romina" authorRole="user"
               file="web/src/parseDiff.ts" lines="42" />
  <interaction id="cmt_d1e8f3" target="reply" intent="accept"
               author="@romina" authorRole="user"
               file="server/src/queue.ts" lines="72-79">
    Good catch — switching to a write lock in 5b8a2c1.
  </interaction>
  <interaction id="cmt_pr_99f1" target="reply" intent="request"
               author="external-reviewer" authorRole="user"
               htmlUrl="https://github.com/org/repo/pull/123#discussion_r4242"
               file="server/src/queue.ts" lines="72-79">
    Same concern from the PR — please add a smoke test before merge.
  </interaction>
  <interaction id="cmt_e7f209" target="reply" intent="reject"
               author="@romina" authorRole="user"
               file="web/src/state.ts" lines="118">
    Disagree — this branch is reachable from the keymap handler at line 240.
    See REPL transcript: <agentRunId>r_19f4</agentRunId>.
  </interaction>
</reviewer-feedback>
```

The agent gets parent provenance from the `threadKey` (carried in the envelope) and from walking the ordered thread it sees; the `target` axis itself no longer carries that information.

The outer element is also renamed: `<comment>` → `<interaction>` (since `<comment intent="ack">` is a contradiction in terms).

Wire-level renames affect: `server/src/agent-queue.ts` (`CommentKind` → `InteractionTarget`; `Comment` interface gains `intent`, `author`, `authorRole`, `htmlUrl?`), `server/src/index.ts` (`COMMENT_KINDS`, validation, payload shape), `web/src/types.ts` (`CommentKind` → `InteractionTarget`; `Comment` → `Interaction` on the wire shape — but keep the in-state `Reply` name), `web/src/agentCommentPayload.ts` (function name + field), `share-review-comments.md` (wire example).

### Local ↔ GitHub

The round-trip is **asymmetric on purpose.** Shippable-pushed comments are tagged with an HTML-comment sentinel (mandatory, invisible) and a small visible intent glyph (when the intent isn't `comment`). Non-Shippable comments stay as plain comments — we never guess intent from prose, brackets, or stray glyphs.

**Push (Shippable → GitHub).** Two layers:

1. **Visible intent glyph at the start of the body**, taken from a closed set:
   - `❓` for `question`
   - `🔧` for `request`
   - `🚧` for `blocker`
   - `✓` for `accept`
   - `✗` for `reject`
   - (nothing prepended for `comment`, `ack`, `unack` — `comment` is the default, `ack`/`unack` are skipped on push)

   Followed by a single space and the body. Nice for human PR readers; carries no Shippable branding.

2. **HTML-comment sentinel as a soft footer**, mandatory on every pushed comment regardless of intent:

   ```
   <!-- sp:v1 intent=request id=cmt_3f7a91 -->
   ```

   The sentinel is the *source of truth* for intent on parse. It also carries the Shippable comment id so future round-trip features (edits, intent evolution) can correlate. Mandatory means: every push appends one, including pushes with `intent: "comment"` where no visible glyph is added. The footer is invisible in the GitHub UI (HTML comments don't render in Markdown), so it gives us full provenance without polluting the prose.

Combined push shape:

```
🔧 <body>

<!-- sp:v1 intent=request id=cmt_3f7a91 -->
```

A blank line separates body from sentinel — keeps source-view readability in case anyone toggles "show source" on the comment.

For `comment` intent:

```
<body>

<!-- sp:v1 intent=comment id=cmt_b22c04 -->
```

No visible branding. The HTML sentinel is the entire provenance signal.

**Pull (GitHub → Shippable).** For each line comment fetched in `server/src/github/pr-load.ts`:

1. **HTML sentinel present?** If the body contains a line matching exactly `<!-- sp:v1 intent=<intent> id=<id> -->` where `<intent>` is in the closed set, take that intent. Strip the sentinel line (and the blank line preceding it) from the body. If a visible intent glyph from the closed set (`🚧 `, `🔧 `, `❓ `, `✓ `, `✗ `) leads the remaining body and matches the sentinel's intent, strip it too. This is the path every Shippable-pushed comment lands on.

2. **No sentinel? Plain comment.** Everything else — bare-emoji prose, conventional-comments syntax, `[REQUEST]` brackets — is `intent: "comment"`, body stored verbatim. **No heuristic guessing, ever.**

Round-trip stability: a Shippable-pushed `request` re-ingests as `intent: "request"`, body without the visible glyph and without the sentinel. If the user re-pushes that comment (e.g. after editing), both the visible glyph and the sentinel are re-applied fresh — the strip-on-pull + reapply-on-push pattern means re-ingested comments don't accumulate `🔧 🔧 <body>` prefixes or stacked sentinels.

**Visible-glyph collision with foreign prose.** A foreign reviewer who happens to start a comment with `🔧 ` (e.g. "🔧 fix-it instructions follow…") doesn't get misclassified — we only parse intent from the sentinel, never from the visible glyph. The glyph is purely visual; the sentinel is what the parser reads.

**Sentinel collision.** A foreign reviewer who literally types `<!-- sp:v1 intent=blocker id=cmt_xxx -->` inside their comment body could fake provenance. Acceptable casualty for v0 — the structure (correct version tag, valid intent token, id-shaped string) makes accidental collision near zero, and deliberate spoofing of an internal tooling marker is a social problem, not a parser problem.

**Response intents on GitHub.** `accept` pushes as `✓ <body?>` + sentinel; `reject` pushes as `✗ <body>` + sentinel. The PR author sees the verdict at a glance. `ack` and `unack` are local triage signal and skipped on push by default; revisit during slice 6 if reviewers want their ack state visible to PR authors.

### PR-level verdict

GitHub PR reviews carry a *review-level* verdict alongside per-thread comments: `APPROVE` / `REQUEST_CHANGES` / `COMMENT`. Shippable derives the verdict from the per-thread intents at push time:

| local state                                                | PR-level verdict   |
| ---------------------------------------------------------- | ------------------ |
| at least one open thread with `currentAsk: blocker` and no `accept` response | `REQUEST_CHANGES` |
| no open blockers, at least one push-eligible thread        | `COMMENT`          |
| nothing to push                                            | (no review submitted) |

"Open" means the thread doesn't have a `currentResponse: "accept"` from the code author (or, in the per-author-identity-ambiguity caveat from open question 3, any author). A blocker that's been accepted is no longer blocking.

`APPROVE` is reserved for an explicit reviewer action (a future affordance — single-button "approve PR" at the workspace level). The plan doesn't try to derive `APPROVE` from intent counts, because "all threads acked" and "all threads accepted" both seem to qualify but neither is necessarily a positive endorsement of the PR as a whole.

This is push-only — local `currentAsk` does not change because someone clicked Approve on GitHub. PR-level verdict ingest goes the other way: ingested PR reviews surface as their own kind of interaction with `authorRole: "user"` and `target: "reply"`, body = the review summary text, intent derived from the GitHub verdict (approve → `accept` at PR level; request_changes → `blocker`; comment → `comment`).

## Keybindings (best-practice revision)

Pattern: the composer carries the intent picker; we don't sprawl single-letter intent keys across the keymap. Industry tools (Linear, Notion, Slack) keep authoring intent inside the composer and reserve single-letter keys for high-frequency one-shot actions.

| key                                | action                                                                | when                  |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------- |
| `c`                                | open composer, body focused, default intent `comment`                 | always                |
| `r`                                | reply to focused thread; composer defaults to thread's current ask    | thread focused        |
| `a`                                | toggle ack on focused thread (generalized from AI-note-only)          | thread focused        |
| `Mod+I` (in composer)              | cycle intent forward in the picker without leaving body               | composer open         |
| `Mod+Shift+I` (in composer)        | cycle intent backward                                                 | composer open         |
| `Mod+1` … `Mod+4` (in composer)    | jump straight to ask 1–4 (`comment`, `question`, `request`, `blocker`) | composer open, ask mode |

Tab does **not** cycle intent — Tab moves focus to the picker (standard form behavior) where arrow keys then select. The intent chord is the typing-flow path; Tab is the "I want to inspect every option" path.

Not added: `q` / `x` / `b` as standalone intent keys. They were arbitrary in the original plan (`x` for "request" has no mnemonic), they would collide with future features, and they push authoring complexity out of the composer where it belongs.

Inline marker shortcuts at the very start of the body auto-select intent (the picker visibly switches): `! ` → `request`, `?? ` → `question`, `!! ` → `blocker`. Convention-based, undoable, doesn't proliferate keybindings. Helpful for muscle-memory from other tools.

`R` (Shift+R) stays bound to "open the free code runner" (existing). `Shift+M` stays "sign off on file." No collisions.

## Slices

Each slice is independently shippable. Slice 0 is a hard precondition; the rest of the slices don't start until it lands and is re-reviewed.

0. **Data-layer tests + refactor (precondition; do this first, then re-review the plan).** Before any typed-interactions code lands, build coverage and clean up the existing data-layer foundations the rest of the slices stand on. Scope:
   - **Reply, state.replies, ackedNotes, detachedReplies.** Unit tests for the reducer cases (`ADD_REPLY`, `DELETE_REPLY`, `PATCH_REPLY_ENQUEUED_ID`, `TOGGLE_ACK`, the merge paths for `MERGE_PR_REPLIES` and `MERGE_AGENT_REPLIES`), plus tests exercising the threadKey conventions (`note:` / `user:` / `block:` / `hunkSummary:` / `teammate:`) end-to-end. Today these have thin coverage and the typed-interactions slices rewrite all of them.
   - **`agentCommentPayload.deriveCommentPayload`.** Already partially covered; extend to cover every prefix branch and the failure modes (stale hunk, missing line index, etc.). This is the function that gets renamed and rewired in slice 5.
   - **`web/src/persist.ts` migration table.** Snapshot fixtures at v1 and v2; test forward migration; test the future-version null-return path. Today the migration code exists but no fixture coverage exercises it — slice 1 bumps to v3 and needs the table to be honest first.
   - **Anchor / detached-replies.** `anchor.ts` and the reload pass. These move untouched in the typed-interactions work but they're load-bearing for `external?.source === "pr"` flows the plan exercises.
   - **Refactor wherever the tests reveal awkwardness.** No new features — only: rename for consistency, extract clearer seams, simplify where the test-writing pain points say to. If a refactor would change observable behavior, hold it out.
   - **Re-review this plan after slice 0 lands.** The data-layer refactor may expose constraints or simplifications we can't see from the current code. The user's direction is explicit: ship slice 0, then re-read this doc, then start slice 1.

   Slice 0 is NOT typed-interactions work. It's the foundation. None of the type unions, no `intent`/`target`, no selector, no UI — just tests and cleanup so the rest of the work is safe.

1. **Add the `Interaction` selector + `InteractionTarget` / `InteractionIntent` types + reducer revision tokens.** Pure read-layer plus the bookkeeping the memo needs. Adds `repliesRevision` and `ackedNotesRevision` to `ReviewState`, incremented monotonically by the reducer on every write to the corresponding slice. The new `selectInteractions` selector lives in `view.ts` (or sibling) and projects from current `state.replies`, `state.ackedNotes`, `DiffLine.aiNote`, `Hunk.teammateReview`, `Reply.agentReplies`; memoized on `(changesetId, repliesRevision, ackedNotesRevision)`. Every downstream consumer that currently reads from `state.replies` switches to it. No UI changes, no wire changes; existing behavior is identical. Also bumps `CURRENT_VERSION` to `3` in `persist.ts` (see § Migration) so persisted v2 snapshots from prior dev sessions are dropped before any new state lands.

2. **Composer intent picker.** `c` opens composer with the ask-only picker; `r` opens it with the full picker (asks + responses, contextually ordered). Tab cycles within the visible group. New replies persist `intent` + `target`. Reducer enforces the (target, intent) validity rule. Wire payload unchanged.

3. **Response intents (ack / accept / reject) as interactions.** `a` on a focused thread writes `Reply { intent: "ack", body: "" }`. Accept and reject route through the reply composer (no dedicated keys in v0). Reducer stops writing to `state.ackedNotes` in the same commit; the field is dropped from the persisted snapshot (no fallback — see § Migration). Today's `AgentReply.outcome` keeps writing through its own field for now and projects via the read seam; lifting agent responses to top-level `Reply { intent: "accept" | "reject" | "ack", author: <agent> }` is the follow-up in open question 4.

4. **Ask evolution.** Body-less ask-change replies (e.g. `request` → `blocker`); thread card shows `was [REQUEST]`; selector computes original vs current ask. No new keybinding yet — evolution happens via `r` + intent change + empty body.

5. **Wire rename + intent passthrough.** Rename `CommentKind` → `InteractionTarget` (now a 3-value union: `"line" | "block" | "reply"`), `<comment>` → `<interaction>`, `kind` attribute → `target`; add `intent`, `author`, `authorRole`, and `htmlUrl` (when PR-sourced) to the per-element payload. The five old `reply-to-*` values collapse to `"reply"`; the agent derives parent provenance from the thread's head `authorRole` (and from `threadKey` prefix on the envelope) if it cares. No `originalIntent` on the wire — same derivation rule. Server validation, MCP server, tool descriptions all updated in one commit.

6. **GitHub round-trip.** Push visible glyph + mandatory HTML sentinel footer; pull reads sentinel, else stays as `comment`. PR-level verdict derived from open-blocker count (see § PR-level verdict).

7. **PR-comments-to-agent gesture.** Header button; one-shot enqueue of PR-imported interactions. Drop the `external?.source !== "pr"` enqueue filter.

8. **Cross-thread aggregation surface.** The selector already returns the shape; this is the inbox UI on top of it. (Out of scope for *this* plan but the data is ready.)

## Open questions

Pinning these before any code:

1. **Inbox-zero or visual-only?** Does an `accept`/`reject`/`ack` hide a thread from `n` / `N` navigation, or just dim it in place? Today's AI-note ack hides the status-bar nudge but keeps the note visible. Default proposal: dim-in-place for `ack`; collapse for `accept`/`reject` (the ask is settled); `unack` returns the thread to undimmed/un-collapsed (it's back to "no response"). Revisit when the inbox UI lands.
2. **Does `ack` / `unack` serialize to GitHub?** `accept`/`reject` push by default (PR author benefits); `ack` and `unack` skipped by default. Revisit if reviewers actively want their ack state visible to the PR author.
3. **Should accept/reject be restricted by author role?** Logically the *code author* accepts or rejects a reviewer's request, not another reviewer. But "code author" isn't a clean concept locally (no auth, no git identity assertion). Default v0: composer offers accept/reject to anyone; UI labels show the author so the reader can judge whose response it is. Revisit when we have a real identity story.
4. **Lift `AgentReply.outcome` to a top-level interaction?** Today `agentReplies` is nested under Reply. The unified model wants top-level Replies authored by the agent — `Reply { intent: "accept" | "reject" | "ack", author: <agent>, body: <agent's reasoning> }`. Doing this means dropping the `agentReplies` nesting and projecting agent responses to top-level Reply at the read seam. Feasible; teed up by the response-intent set but not in this plan's slices.
5. **Add `praise` later?** Conventional Comments and Reviewer.dev both call this out. Lean toward deferring until reviewer feedback says the `comment` bucket is doing too much work.

## Risks

- **Picker fatigue.** Seven intents is a lot to put in front of a reviewer who just wants to leave a note. Mitigation: the picker only ever shows the asks (4) when starting a fresh thread; responses appear only in the reply composer where they're contextually relevant. Default is `comment`, picker is one Tab away, never blocking; `a` for ack is a one-key path that bypasses the composer entirely.
- **Marker collision in re-ingested PRs.** Mitigated by design: foreign comments are never parsed for intent at all. Visible glyphs (`🔧`, `🚧`, `❓`, `✓`, `✗`) in foreign prose don't affect intent — only the HTML sentinel feeds the parser. The only spoofing risk is a foreign reviewer literally typing the sentinel inside their body; accepted as a v0 casualty (social problem, not parser problem).
- **Selector cost.** The cross-thread aggregation walks every interaction on every render. Mitigation: memoize on `(changesetId, repliesRevision, ackedNotesRevision)`, with the two revision counters maintained by the reducer (added in slice 1; see § Cross-thread aggregation). Slice 1 ships with a benchmark on a 200-thread fixture; if it regresses re-render perf, we move the selector to `useMemo` per consumer.
- **Wire rename is a breaking change for any in-flight agent session.** The MCP server is in-tree and updates atomically with the rest of the surface; existing in-memory queues are dropped on server restart anyway. The risk is small and we accept it.
- **Render code that switched on the old `reply-to-*` variants** (badges differentiating ai-note vs hunk-summary vs teammate vs user threads) must switch to the projected thread's `headAuthorRole` or the `threadKey` prefix instead. The slice-0 reducer tests of the threadKey conventions (`note:` / `hunkSummary:` / `teammate:` / `user:` / `block:`) catch any seam that's still doing the old switch.

## Docs to update when implementation lands

Touch list, not actioned yet (this is a plan):

- `docs/concepts/ai-annotations.md` — rename to "Review interactions" or absorb into a new doc that documents the unified model.
- `docs/concepts/review-state.md` — drop "acked AI notes" as a separate bullet; replace with the interaction model.
- `docs/plans/share-review-comments.md` § "Format the agent sees" — wire rename (`<comment>` → `<interaction>`, `kind` → `target`, `intent`).
- `docs/plans/share-review-comments-tasks.md` line 29 — stale: still lists `freeform` in the `CommentKind` union which has already been removed by the agent-reply work. (Not strictly part of this plan, but worth fixing on the same sweep.)
- `docs/features/line-comments-and-replies.md` — generalize the "reply to AI note" framing.
- `docs/sdd/gh-connectivity/requirements.md` § 15 — reflect that PR comments can be enqueued to the agent via the explicit gesture.
- `README.md` — if the `a` shortcut help text mentions AI-note-only, generalize.
