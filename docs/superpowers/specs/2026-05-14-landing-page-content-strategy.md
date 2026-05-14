# Landing page — content strategy revision

Date: 2026-05-14

## Goal

Revise the content strategy of `landing/index.html` for a specific audience: **skeptical senior engineers** — people in or near the agent-tooling space who will judge the project hard and respond to evidence, not hype. The job of the page is to prove Shippable is real and thoughtfully built.

This is a **re-structure + re-copy** with one palette change. The page switches from the dark Dollhouse Noir theme to its light sibling, Dollhouse — Dollhouse Noir reads heavy for a public web page. The single-file static HTML, the GitHub Pages hosting model, and the four existing screenshots all stay. The screenshots stay in Dollhouse Noir (dark) even though the page goes light — dark app screenshots framed in a light page is a deliberate, common pattern, and both are real app themes; re-capturing them is out of scope. What changes is the page's *spine*, its section order, its copy, and the `:root` palette.

Supersedes the content strategy in `docs/superpowers/specs/2026-05-13-landing-page-design.md` (that spec's structural and capture decisions still describe how the page was built; this spec changes what it says). The four screenshots are reused as-is.

## Why this revision

The current page is manifesto-led. A copy review found it overcorrects:

- **Thesis-heavy, product-light.** ~4 restatements of "agents make diffs cheap, the human is on the hook" bracket the product. The visitor is sold on the *problem* fast but is starved of *what this is and what I do with it*.
- **The defining noun is vague.** "Review surface" never resolves into "macOS desktop app."
- **No "how it works" beat.** A Download CTA, but nothing orienting what happens after.
- **The bottom third is upside down.** 7 caveats + 8 roadmap items = 15 negative-leaning bullets, versus 5 feature cards. Honesty tips into self-deprecation.
- **The comparison is insider baseball.** A flat list naming Pi / Conductor / Codex assumes the reader knows the landscape.
- **The core line is overused.** "Agents help. You sign your name." appears 4× (og:title, og:description variant, hero H1, pull-quote).

## Strategy: principle-led ("Approach C")

The page is organized around **opinions about what review is for**. Each opinion is stated, then immediately demonstrated by the shipped feature that encodes it, anchored to a real screenshot. Features stop being a grid of mechanisms — they arrive as *proof of a principle*. This is what makes it skeptic-proof: the page sells judgment and taste (which a senior engineer can't dismiss as "another AI wrapper"), and every claim is grounded in something shown.

The manifesto DNA stays — it is just re-expressed as principles rather than a problem essay.

## Page structure — 6 content sections + footer

Down from 8 content sections + footer. New order, top to bottom:

| # | Section | Job |
|---|---|---|
| 1 | Hero | State the stance; name the form factor; one sentence of problem; screenshot 01. |
| 2 | The shift | Ground *why* this stance exists — the world changed, agents write the diffs now. Tightened. |
| 3 | The principles spine | 4 principle blocks: opinion + the feature that encodes it + screenshot. Replaces the 5-card features grid. |
| 4 | Coda beat | One quiet centered beat that replays the four principles so the spine clicks in retrospect. |
| 5 | Where it sits | The comparison, restructured into a 3-part argument. |
| 6 | Coming next | One simple roadmap list, mockup-style. Caveats are framed as forward-looking items. |
| — | Footer | Unchanged. |

## Section detail

### 1. Hero

- **Wordmark:** `Shippable` (unchanged).
- **Headline:** *Agents help. You sign your name.* — **kept.** It is the strongest line on the page and it is itself a stance. (Considered and rejected a fresh POV headline; the existing one stays.)
- **Subhead:** *A review surface for everything you sign off on, typed or generated.* — **kept** (unchanged).
- **Lead:** replaced with a single sentence of problem framing (today's lead is three sentences saying the same thing): *"Agents made diffs cheap. The person who signs the merge is still on the hook when it breaks."*
- **CTAs:** unchanged — Download for macOS (primary), Read the source (secondary). See Open Items re: the 404.
- **Visual:** screenshot 01 (`01-hero-diff-inspector.png`).

Note: the subhead keeps "review surface." The copy review flagged this as abstract, but the user chose to keep the existing subhead. The form factor is named in the spine and the roadmap instead ("macOS" appears in section 6).

### 2. The shift

Kept, tightened.

- Eyebrow: `The shift`
- H2: *Most of the code you review wasn't typed by anyone you know.* (kept)
- Body: cut to two tight paragraphs. Fix the ambiguous "They" in the second paragraph (the K1 finding in `docs/landing-page/review-followups.md`) — give the pivot sentence an explicit subject.
- Closing line: change from *"Shippable is the surface for that part of the work"* to a handoff that sets up the spine, e.g. *"So we built Shippable around a few opinions about what review should be."*

### 3. The principles spine

Replaces the "What it does" 5-card features grid. Four principle blocks. Each block: the opinion (a short opinionated heading + 1–2 sentences), then the feature that encodes it (2–3 sentences), then a screenshot where one is assigned. All five of today's feature cards are absorbed here.

**Block 1 — Evidence over claims** → screenshot 02 (`02-plan-diagram.png`)
- Opinion: an AI summary you can't check is just a vibe; a plan is only worth reading if every claim points back at the code.
- Proof: the review plan — every claim carries an evidence ref to a file, hunk, or symbol. Click it, see the code, decide if you believe it. A rule-based fallback lands first so the plan is never empty while the AI thinks.
- Caption: *Every claim points back at the code that justifies it.*

**Block 2 — Reading is not approving** → copy-only; calls back to the hero shot
- Opinion: most tools collapse "I looked at it" and "I approve it" into one button; those are different facts.
- Proof: line-level read tracking (the faded lines in the hero shot) is separate state from an explicit per-file sign-off — you can't accidentally LGTM a file you never scrolled. And it is durable: comments capture ten lines of context plus a content hash, so when the agent amends or reshuffles, your thread re-anchors instead of vanishing. (This absorbs today's "Comments that survive changes" card.)

**Block 3 — A claim you can run is a test** → screenshot 04 (`04-code-runner.png`)
- Opinion: when a concern is about what code *does*, the fastest way to settle it is to run it — not argue in a comment thread.
- Proof: select a hunk or block; the runner detects input slots, builds a form, and executes in a sandboxed worker. JavaScript, TypeScript, and PHP today. An AI concern can hand its snippet straight to the runner — the concern becomes a verifier in one click.
- Caption: *Verify the AI's claim in one click, not five.*

**Block 4 — AI review belongs next to the code, not in another window** → screenshot 03 (`03-agent-context.png`)
- Opinion: AI review shouldn't live in a chat transcript you alt-tab to; it belongs in the same surface where you read the diff.
- Proof: the `shippable` MCP integration — your agent posts review comments through the MCP server and they land anchored to the lines they're about, right in the diff. You read them in context, reply in context; the agent pulls your replies on its next run. No jumping between a chat window and your editor.
- Caption: reframed around the MCP back-channel (not the agent context panel). Replaces today's caption *"Read the diff alongside the session that wrote it."*
- **Rationale for the reframe:** the agent context panel (task / files / transcript view) is shaky ground — not reliably working right now. The MCP back-channel is real and shipped, and was recently hardened (`mcp-server` — `shippable_check_review_comments` + `shippable_post_review_comment`). Principle #4 claims only the defensible thing.

### 4. Coda beat

Repurposes the pull-quote slot. It must NOT repeat "Agents help / You sign your name" — that is now the headline. Instead, a quiet centered beat replaying the four principles:

> Evidence over claims.
> Reading is not approving.
> A claim you can run is a test.
> AI review belongs where the code is.

…with a quieter closer: *"The human reads. The human signs off. Shippable makes that cheap to do well."*

### 5. Where it sits

The comparison, restructured from a flat 5-row list into a 3-part argument. Each group is led by the distinction, so the bucket is legible even if the named example is not.

- Section opens with the thesis line: *"Shippable is the review pass — not the harness, and not another bot in the repo."*
- **Harnesses that run agents** — *Pi, Conductor, Codex.* Shippable doesn't run agents; it's the deliberate review pass for what they produce.
- **Bots that comment** — *Claude Code Review and similar.* Their output is comments; Shippable's output is review *state* you carry forward.
- **The system of record** — *GitHub PR review.* Once connectivity lands, Shippable is a layer on top — user-authenticated, not another bot in the repo.

Existing per-tool copy can be reused where it still fits; the change is the grouping and the lead-with-the-distinction framing.

### 6. Coming next

Collapses today's two bottom sections ("What it isn't yet" + "Coming next") into one simple roadmap list, matching the shape of `docs/landing-page/landing-mockup.html`. There is no separate caveats section. Honesty is carried *inside* the roadmap items: each item that was a caveat now leads forward, with the present state in a trailing parenthetical.

- Eyebrow: `Coming next` · H2: *Coming next.*
- Intro: *Local-first today. Closing the obvious gaps in this order:*
- Single list:
  - Two-way GitHub — pull PRs in, push review conclusions back to PR threads *(read-only today)*
  - Bring-your-own-key for other AI providers *(Claude / Sonnet 4.6 only today)*
  - Shared, multi-user reviews on a hosted backend *(local-first in localStorage today)*
  - Linux and Windows builds; signed and notarized macOS *(macOS-only, unsigned today)*
  - GitLab and Bitbucket ingest
  - Reading-path suggestions across callers and dependencies
  - Coverage markers combining human and AI review state

The PHP runner WASM cold-start caveat is **dropped entirely**.

### Footer

Unchanged — both authors, Repo · Issues · Releases · License.

## What moves out of the page

The current page's deep-weeds caveats are not carried into the new "Coming next" list. To avoid losing them, relocate to `README.md` (or the relevant `docs/`):

- GitHub PR ingest needs a PAT even for public repos.
- LSP-backed click-through needs a worktree on disk; memory-only deployments fall back to the regex graph.

## Open items (decisions needed before go-live)

1. **Hero CTA 404.** "Download for macOS" points at `releases/latest`, which 404s until v0.1.0 is cut. Decide before the page goes public: cut the release, or temporarily make "Read the source" the primary CTA.
2. **Screenshot 03 defensibility.** The shot is kept and its caption reframed around the MCP back-channel. Before the page goes public, do a quick check that what the shot actually shows is defensible under the reframed claim (it was captured as the agent context panel with a simulated-agent terminal overlay; the overlay does showcase the real MCP comment flow).
3. **Screenshots 01 / 02 / 04 staleness.** Mildly stale after recent `main` changes (expand-context bars now appear in the diff view; diagram click now opens a lightbox). Reused as-is per scope; recorded here so a future re-capture picks them up.

## Out of scope

- Layout-system or typography redesign — only the `:root` palette changes (Dollhouse Noir → Dollhouse); the layout and type scale stay.
- Re-capturing screenshots.
- New visual assets (flow diagrams, og:image).
- Deploy — enabling GitHub Pages, cutting v0.1.0.
- Animation, analytics, signup forms.

## Constraints carried forward from the v0 spec

- Single `landing/index.html`, inline CSS, no JS required for content.
- Dollhouse `:root` tokens copied from `web/src/tokens.ts` (the light theme; switched from Dollhouse Noir). `--accent-strong` and `--on-accent` are landing-page-only — a hand-picked CTA-hover shade and light text for the accent button.
- Hosted later via GitHub Pages from `landing/`; this work commits files only.
