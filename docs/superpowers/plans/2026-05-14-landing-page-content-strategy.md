# Landing Page Content Strategy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `landing/index.html` from a 9-section manifesto-led page into a 6-section principle-led page aimed at skeptical senior engineers, per `docs/superpowers/specs/2026-05-14-landing-page-content-strategy.md`.

**Architecture:** A single static HTML file with inline CSS. Each task edits one section's HTML (and, where needed, the matching CSS in the `<style>` block). No new files, no JS, no build step. The four existing screenshots are reused as-is. One task (Task 7) also swaps the `:root` palette from Dollhouse Noir to the light Dollhouse theme.

**Tech Stack:** Hand-written HTML5 + CSS. Dollhouse Noir `:root` tokens. Verification is visual — open in a browser; the project has no test suite for the landing page (see `AGENTS.md`).

---

## Context for the implementer

- **Worktree:** This work happens in the existing worktree at `/Users/luizreis/Development/shippable-landing` on branch `feat/landing-page`. Do not create a new worktree. All paths below are relative to that root.
- **The file:** Everything is in `landing/index.html`. Read the whole file once before starting — line numbers shift as tasks land, so every edit below is specified by exact string content, not line number.
- **Serving for verification:** From the worktree root, run `python3 -m http.server 8123` and open `http://localhost:8123/landing/`. Or open `landing/index.html` directly via `file://`.
- **Commit style:** Conventional-ish, lowercase scope, matching `git log` (e.g. `polish(landing): ...`, `feat(landing): ...`). Never co-author Claude. Never `--no-verify`.
- **What is NOT in scope:** the meta/`og:` tags, the screenshots, the footer, the hero headline/subhead/CTAs/visual. Leave them untouched. (The `:root` palette **does** change — see Task 7.)

## File structure

| File | Change | Responsibility |
|---|---|---|
| `landing/index.html` | Modify (Tasks 1–6) | The entire landing page — HTML structure + inline CSS. |

No other files change. The spec mentioned relocating two dropped caveats (PAT-for-public-repos, LSP-needs-a-worktree) to `README.md` — **on inspection both are already documented there** (`README.md:184` for the PAT/eager-auth note, `README.md:60-64` for the worktree-only click-through limits). Removing them from the landing page loses nothing; no README edit is needed.

## End-state section order

After all tasks, the `<body>` contains, top to bottom:

1. `<section class="hero">` — unchanged except the lead paragraph (Task 1)
2. `<section>` The shift — tightened (Task 2)
3. `<section>` The principles spine — **new**, replaces the old "What it does" + "In practice" sections (Task 3)
4. `<section class="pause">` Coda beat — re-copied (Task 4)
5. `<section>` Where it sits — regrouped (Task 5)
6. `<section>` Coming next — merges old "What it isn't yet" + "Coming next" (Task 6)
7. `<footer>` — unchanged

---

## Task 1: Tighten the hero lead

**Files:**
- Modify: `landing/index.html` (the `<p class="lead muted">` inside `<section class="hero">`)

- [ ] **Step 1: Replace the three-sentence lead with one sentence**

Use Edit with this exact `old_string`:

```html
      <p class="lead muted">
        Agents make diffs cheap. The human reviewing them is the bottleneck — and the one on the hook when something breaks in production.
      </p>
```

`new_string`:

```html
      <p class="lead muted">
        Agents made diffs cheap. The person who signs the merge is still on the hook when it breaks.
      </p>
```

- [ ] **Step 2: Verify the swap**

Run: `grep -c "signs the merge" landing/index.html`
Expected: `1`

Run: `grep -c "is the bottleneck" landing/index.html`
Expected: `0`

- [ ] **Step 3: Verify in browser**

Open `http://localhost:8123/landing/` (start `python3 -m http.server 8123` from the worktree root first if needed). Confirm the hero still renders: wordmark, headline "Agents help. You sign your name.", subhead, the new one-sentence lead, both CTAs, screenshot 01.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): tighten hero lead to one sentence"
```

---

## Task 2: Tighten "The shift" and fix the ambiguous pronoun

**Files:**
- Modify: `landing/index.html` (second `<p>` of `<section>` with eyebrow "The shift")

The first paragraph of this section stays as-is. Only the second paragraph changes: it currently has an ambiguous "They" (finding K1 in `docs/landing-page/review-followups.md`) and a closing line that needs to hand off to the new principles spine.

- [ ] **Step 1: Replace the second paragraph**

Use Edit with this exact `old_string`:

```html
    <p>
      Reviewer bots help with some of that. They surface real issues, shorten loops, do their work. They don't change the fact that a human still has to read the diff, decide what to trust, and put their name on the merge. Shippable is the surface for that part of the work.
    </p>
```

`new_string`:

```html
    <p>
      Reviewer bots help with some of that. They surface real issues, shorten loops, do their work. But a bot doesn't change the fact that a human still has to read the diff, decide what to trust, and put their name on the merge. So we built Shippable around a few opinions about what review should be.
    </p>
```

- [ ] **Step 2: Verify the swap**

Run: `grep -c "a few opinions about what review should be" landing/index.html`
Expected: `1`

Run: `grep -c "Shippable is the surface for that part of the work" landing/index.html`
Expected: `0`

- [ ] **Step 3: Verify in browser**

Reload `http://localhost:8123/landing/`. Confirm "The shift" section reads cleanly: two paragraphs, the second now ending on "...what review should be."

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): tighten the-shift, fix ambiguous pronoun"
```

---

## Task 3: Replace the features grid + gallery with the principles spine

**Files:**
- Modify: `landing/index.html` — CSS block (remove `.features-grid` / `.feature` / `.gallery-item` rules, add `.principles` / `.principle` rules) and the `<body>` (replace two `<section>` elements with one)

This is the largest task. It deletes two whole sections ("What it does" with its 5-card grid, and "In practice" with its 3-screenshot gallery) and replaces them with a single "principles spine" section containing four principle blocks. Screenshots 02, 03, and 04 move into the spine; screenshot 01 stays in the hero (untouched).

- [ ] **Step 1: Replace the CSS rules**

In the `<style>` block, use Edit with this exact `old_string` (note the 4-space indent on the first line — match it exactly):

```css
    .features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
  margin-top: 36px;
}
@media (max-width: 720px) {
  .features-grid { grid-template-columns: 1fr; }
}
.feature {
  padding: 24px 26px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.feature h3 { color: var(--fg); }
.feature p { color: var(--fg-dim); margin: 6px 0 0; font-size: 14.5px; }

.gallery-item {
  margin: 36px 0 0;
}
.gallery-item img {
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 10;
  display: block;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.gallery-item figcaption {
  font-family: ui-serif, Georgia, serif;
  font-size: 17px;
  line-height: 1.4;
  color: var(--fg-dim);
  margin-top: 14px;
  max-width: 62ch;
}
.gallery-item + .gallery-item { margin-top: 48px; }
```

`new_string`:

```css
    .principles { margin-top: 36px; }
.principle { margin: 0 0 64px; }
.principle:last-child { margin-bottom: 0; }
.principle h3 {
  font-size: 26px;
  line-height: 1.25;
  margin-bottom: 10px;
  color: var(--fg);
}
.principle p { color: var(--fg-dim); margin: 0; }
.principle code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--code-bg);
  padding: 1px 6px;
  border-radius: 3px;
}
.principle img {
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 10;
  display: block;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  margin-top: 22px;
}
.principle figcaption {
  font-family: ui-serif, Georgia, serif;
  font-size: 15px;
  line-height: 1.4;
  color: var(--fg-mute);
  margin-top: 12px;
  max-width: 62ch;
}
```

- [ ] **Step 2: Replace the two sections with the spine**

In the `<body>`, use Edit with this exact `old_string` (it spans the entire "What it does" section, the blank line, and the entire "In practice" section):

```html
  <section>
  <div class="container">
    <p class="eyebrow">What it does</p>
    <h2>Built for the human reading the code.</h2>
    <p class="muted">Given a git diff, Shippable:</p>

    <div class="features-grid">
      <div class="feature">
        <h3>A review plan you can argue with</h3>
        <p>Every claim in the plan points back to a file, hunk, or symbol. Click it, see the evidence, decide if you believe it. A rule-based fallback lands first so the plan is never empty while your AI thinks.</p>
      </div>
      <div class="feature">
        <h3>Line-level read tracking, separate from sign-off</h3>
        <p>The cursor records every line you've passed over. A gutter rail shows what you've read; a separate gesture says "I'm done with this file." You can't accidentally LGTM a file you haven't looked at.</p>
      </div>
      <div class="feature">
        <h3>Run snippets without leaving the diff</h3>
        <p>Select a hunk or a block. The runner detects input slots, gives you a form, and executes in a sandboxed worker. JavaScript, TypeScript, and PHP today. AI notes can hand a snippet to the runner so a concern becomes a verifier in one click.</p>
      </div>
      <div class="feature">
        <h3>Comments that survive changes</h3>
        <p>Each comment captures ten lines of context plus a content hash. When the worktree reloads — a new commit, an amend, uncommitted edits — comments re-attach to the new diff or land in a Detached pile with the original snippet preserved.</p>
      </div>
      <div class="feature">
        <h3>The agent's session, alongside the diff</h3>
        <p>Open a worktree the agent worked in. The Inspector shows the prompt that started the session, the files it touched, the plan it followed, the last few turns of the transcript, and any comments the agent has fetched from your review. Reply inline; the agent pulls your replies the next time it runs.</p>
      </div>
    </div>
  </div>
</section>

  <section>
  <div class="container">
    <p class="eyebrow">In practice</p>
    <h2>What it looks like in use.</h2>

    <figure class="gallery-item">
      <img src="screenshots/02-plan-diagram.png" alt="The review plan with an evidence-backed structure map and a typed-node diagram">
      <figcaption>Every claim points back at the code that justifies it.</figcaption>
    </figure>

    <figure class="gallery-item">
      <img src="screenshots/03-agent-context.png" alt="The Inspector showing the Claude Code session that produced this diff — task, files touched, transcript, and a back-channel comment">
      <figcaption>Read the diff alongside the session that wrote it.</figcaption>
    </figure>

    <figure class="gallery-item">
      <img src="screenshots/04-code-runner.png" alt="A PHP hunk selected with the in-browser runner showing an auto-detected input form and the executed output">
      <figcaption>Verify the AI's claim in one click, not five.</figcaption>
    </figure>
  </div>
</section>
```

`new_string`:

```html
  <section>
  <div class="container">
    <p class="eyebrow">What it's built on</p>
    <h2>Four opinions about what review is for.</h2>

    <div class="principles">
      <figure class="principle">
        <h3>Evidence over claims.</h3>
        <p>An AI summary you can't check is just a vibe. Shippable's review plan ties every claim to a file, hunk, or symbol — click it, see the code, decide if you believe it. A rule-based plan lands first, so the page is never empty while the AI thinks.</p>
        <img src="screenshots/02-plan-diagram.png" alt="Shippable's review plan with evidence-backed claims and a typed-node structure map">
        <figcaption>Every claim points back at the code that justifies it.</figcaption>
      </figure>

      <div class="principle">
        <h3>Reading is not approving.</h3>
        <p>Most tools collapse "I looked at it" and "I approve it" into one button. Those are different facts. Shippable tracks the lines your cursor has passed over — the faded lines in the shot above — separately from an explicit per-file sign-off, so you can't accidentally LGTM a file you never scrolled through. And the state is durable: each comment captures ten lines of context and a content hash, so when the agent amends or reshuffles its work, your thread re-anchors instead of vanishing.</p>
      </div>

      <figure class="principle">
        <h3>A claim you can run is a test.</h3>
        <p>When a concern is about what code <em>does</em>, the fastest way to settle it is to run it — not argue in a comment thread. Select a hunk or a block; the runner detects input slots, builds a form, and executes in a sandboxed worker — JavaScript, TypeScript, and PHP today. An AI concern can hand its snippet straight to the runner, so the concern becomes a verifier in one click.</p>
        <img src="screenshots/04-code-runner.png" alt="A PHP hunk selected with the in-browser runner showing an auto-detected input form and the executed output">
        <figcaption>Verify the AI's claim in one click, not five.</figcaption>
      </figure>

      <figure class="principle">
        <h3>AI review belongs next to the code, not in another window.</h3>
        <p>AI review shouldn't live in a chat transcript you alt-tab to. Through the <code>shippable</code> MCP integration, your agent posts review comments that land anchored to the lines they're about, right in the diff. You read them in context and reply in context; the agent pulls your replies on its next run.</p>
        <img src="screenshots/03-agent-context.png" alt="Shippable showing an AI-posted review comment anchored to a line in the diff, with the agent terminal posting through the shippable MCP server">
        <figcaption>AI review lands anchored in the diff — no jumping between a chat window and your editor.</figcaption>
      </figure>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Verify the swap**

Run: `grep -c "class=\"principle" landing/index.html`
Expected: `5` (one `.principles` container + four `.principle` blocks)

Run: `grep -c "features-grid\|gallery-item\|class=\"feature\"" landing/index.html`
Expected: `0`

Run: `grep -c "screenshots/0[234]" landing/index.html`
Expected: `3` (screenshots 02, 03, 04 each referenced once, now inside the spine)

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:8123/landing/`. Confirm the new section renders: eyebrow "What it's built on", H2 "Four opinions about what review is for.", then four principle blocks. Blocks 1, 3, 4 each show a screenshot with a caption; block 2 ("Reading is not approving.") is text-only. All three screenshots load (no broken-image icons). The `shippable` in block 4 renders as inline code.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): principles spine replaces features grid + gallery"
```

---

## Task 4: Re-copy the coda beat

**Files:**
- Modify: `landing/index.html` — CSS block (add `.coda-closer` rule) and the `<blockquote class="pull-quote">` inside `<section class="pause">`

The pull-quote currently repeats the hero headline. It must not — that line is now the hero H1. Replace it with the four principles in compressed form plus a quieter closing sentence.

- [ ] **Step 1: Add the `.coda-closer` CSS rule**

Use Edit with this exact `old_string`:

```css
.pull-quote p { margin: 0 0 2px; }
.pull-quote p:last-child { color: var(--fg-dim); font-weight: 400; }
```

`new_string`:

```css
.pull-quote p { margin: 0 0 2px; }
.pull-quote p:last-child { color: var(--fg-dim); font-weight: 400; }
.pull-quote .coda-closer {
  font-size: 18px;
  line-height: 1.5;
  letter-spacing: normal;
  margin: 20px auto 0;
}
```

- [ ] **Step 2: Replace the blockquote contents**

Use Edit with this exact `old_string`:

```html
    <blockquote class="pull-quote">
      <p>Agents help.</p>
      <p>You sign your name.</p>
      <p>Shippable is the part in between.</p>
    </blockquote>
```

`new_string`:

```html
    <blockquote class="pull-quote">
      <p>Evidence over claims.</p>
      <p>Reading is not approving.</p>
      <p>A claim you can run is a test.</p>
      <p>AI review belongs where the code is.</p>
      <p class="coda-closer">The human reads. The human signs off. Shippable makes that cheap to do well.</p>
    </blockquote>
```

- [ ] **Step 3: Verify the swap**

Run: `grep -c "coda-closer" landing/index.html`
Expected: `2` (one CSS rule, one `<p class>`)

Run: `grep -c "Shippable is the part in between" landing/index.html`
Expected: `0`

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:8123/landing/`. Confirm the coda section: four short centered lines, then a smaller, dimmer closing sentence. It should not visually overflow or look cramped.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): coda replays the four principles"
```

---

## Task 5: Regroup the comparison into three buckets

**Files:**
- Modify: `landing/index.html` — CSS block (add one `.landscape-desc strong` rule) and the "Where it sits" `<section>`

The comparison is currently a flat list of five tool names. Restructure into three groups, each led by a category so the bucket is legible even if the named example is not. The existing `.landscape-row` / `.landscape-name` / `.landscape-desc` CSS is reused unchanged — only the content changes, plus one small rule for the `<strong>` lead-ins.

- [ ] **Step 1: Add the `.landscape-desc strong` CSS rule**

Use Edit with this exact `old_string`:

```css
.landscape-desc { color: var(--fg-dim); font-size: 14.5px; max-width: 56ch; margin: 0; }
```

`new_string`:

```css
.landscape-desc { color: var(--fg-dim); font-size: 14.5px; max-width: 56ch; margin: 0; }
.landscape-desc strong { color: var(--fg); font-weight: 600; }
```

- [ ] **Step 2: Replace the H2 + landscape list**

Use Edit with this exact `old_string`:

```html
    <h2>Next to the tools you already use.</h2>

    <div class="landscape-list">
      <div class="landscape-row">
        <div class="landscape-name">Pi</div>
        <p class="landscape-desc">Composable harness. Bring it for primitives; use Shippable as the dedicated review pass inside that workflow.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">Conductor</div>
        <p class="landscape-desc">Runs agent workspaces and merges. Shippable doesn't run them; it helps you decide what came out.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">Codex</div>
        <p class="landscape-desc">Full build-and-ship platform. Shippable is the supervision layer if you want the review pass to stay deliberate.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">Claude Code Review</div>
        <p class="landscape-desc">Strong PR-comment automation; complementary. Their output is comments. Shippable's output is review state you can carry forward.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">GitHub PR review</div>
        <p class="landscape-desc">The system of record. Once Shippable has GitHub connectivity, it becomes a layer on top — pull PRs in for the heavier read, push conclusions back out as comments. User-authenticated, not another bot in the repo.</p>
      </div>
    </div>
```

`new_string`:

```html
    <h2>Next to the tools you already use.</h2>
    <p class="muted">Shippable is the review pass — not the harness, and not another bot in the repo.</p>

    <div class="landscape-list">
      <div class="landscape-row">
        <div class="landscape-name">Harnesses that run agents</div>
        <p class="landscape-desc"><strong>Pi, Conductor, Codex.</strong> Shippable doesn't run agents — it's the deliberate review pass for what they produce.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">Bots that comment</div>
        <p class="landscape-desc"><strong>Claude Code Review</strong> and similar. Their output is comments; Shippable's output is review state you can carry forward.</p>
      </div>
      <div class="landscape-row">
        <div class="landscape-name">The system of record</div>
        <p class="landscape-desc"><strong>GitHub PR review.</strong> Once Shippable has GitHub connectivity it becomes a layer on top — pull PRs in for the heavier read, push conclusions back out as comments. User-authenticated, not another bot in the repo.</p>
      </div>
    </div>
```

- [ ] **Step 3: Verify the swap**

Run: `grep -c '"landscape-row"' landing/index.html`
Expected: `3` (three `class="landscape-row"` groups in the HTML, down from five — the quotes keep this from matching the `.landscape-row` CSS selectors)

Run: `grep -c "Harnesses that run agents\|Bots that comment\|The system of record" landing/index.html`
Expected: `3`

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:8123/landing/`. Confirm "Where it sits" shows the new thesis line under the H2, then three rows. Each row's left column is a category name; each description leads with a bold tool list. Resize the window narrow (~375px) and confirm the rows stack readably.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): regroup comparison into three buckets"
```

---

## Task 6: Merge the caveats into the roadmap list

**Files:**
- Modify: `landing/index.html` — CSS block (remove the `.caveats-list` rules, add one `.coming-today` rule) and the `<body>` (replace two `<section>` elements with one)

Today there are two bottom sections: "What it isn't yet" (7 caveats) and "Coming next" (8 roadmap items). Merge into a single "Coming next" section, mockup-style — one list, where each former caveat is reframed as a forward item with the present state in a trailing parenthetical.

- [ ] **Step 1: Remove the `.caveats-list` CSS block**

Use Edit. The `old_string` is the `.caveats-list` rule block plus the blank line immediately before it (so no double blank line is left behind):

```css

.caveats-list {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  max-width: 64ch;
}
.caveats-list li {
  padding: 12px 0 12px 22px;
  position: relative;
  color: var(--fg-dim);
  font-size: 15.5px;
  line-height: 1.55;
  border-bottom: 1px dashed var(--border);
}
.caveats-list li:last-child { border-bottom: none; }
.caveats-list li::before {
  content: "·";
  color: var(--accent);
  position: absolute;
  left: 6px;
  top: 12px;
  font-weight: 700;
}
.caveats-list code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--code-bg);
  padding: 1px 6px;
  border-radius: 3px;
}
```

`new_string`: (empty — delete the block entirely)

- [ ] **Step 2: Add the `.coming-today` CSS rule**

Use Edit with this exact `old_string`:

```css
.coming-list li::before {
  content: "→";
  color: var(--accent);
  position: absolute;
  left: 0;
  top: 10px;
}
```

`new_string`:

```css
.coming-list li::before {
  content: "→";
  color: var(--accent);
  position: absolute;
  left: 0;
  top: 10px;
}
.coming-list .coming-today { color: var(--fg-mute); }
```

- [ ] **Step 3: Replace the two sections with one**

Use Edit with this exact `old_string` (it spans the entire "What it isn't yet" section, the blank line, and the entire "Coming next" section):

```html
<section>
  <div class="container">
    <p class="eyebrow">What it isn't yet</p>
    <h2>Where this is honest about being early.</h2>

    <ul class="caveats-list">
      <li>Local-first today; reviews live in <code>localStorage</code>. Shared reviews are next.</li>
      <li>GitHub: read-only. PR ingest pulls in conversations and line-anchored comments; posting back to PR threads isn't built.</li>
      <li>GitHub PR ingest needs a personal access token even for public repos.</li>
      <li>macOS only on the desktop side. The <code>.dmg</code> is unsigned — Gatekeeper bypass required on first run.</li>
      <li>Claude only on the AI side (Sonnet 4.6 by default). Bring-your-own-key for other providers is next.</li>
      <li>The PHP runner loads a ~21 MB WASM runtime on first run. Subsequent runs are fast.</li>
      <li>LSP-backed click-through needs a worktree on disk. Memory-only deployments fall back to the regex graph.</li>
    </ul>
  </div>
</section>

<section>
  <div class="container">
    <p class="eyebrow">Coming next</p>
    <h2>Roadmap.</h2>
    <p class="muted">Local-first today. Closing the obvious gaps in this order:</p>

    <ul class="coming-list">
      <li>Two-way GitHub: post review conclusions back to PR threads</li>
      <li>Reading-path suggestions with AI explainers attached</li>
      <li>Contextual skill loaders for repo and framework patterns</li>
      <li>Coverage markers combining human and AI review state</li>
      <li>Comprehension prompts that block reflex sign-off</li>
      <li>Linux and Windows builds; signed and notarized macOS</li>
      <li>GitLab and Bitbucket ingest</li>
      <li>Hosted backend with shared multi-user reviews</li>
    </ul>
  </div>
</section>
```

`new_string`:

```html
<section>
  <div class="container">
    <p class="eyebrow">Coming next</p>
    <h2>Coming next.</h2>
    <p class="muted">Local-first today. Closing the obvious gaps in this order:</p>

    <ul class="coming-list">
      <li>Two-way GitHub — pull PRs in, push review conclusions back to PR threads <span class="coming-today">(read-only today)</span></li>
      <li>Bring-your-own-key for other AI providers <span class="coming-today">(Claude / Sonnet 4.6 only today)</span></li>
      <li>Shared, multi-user reviews on a hosted backend <span class="coming-today">(local-first in localStorage today)</span></li>
      <li>Linux and Windows builds; signed and notarized macOS <span class="coming-today">(macOS-only, unsigned today)</span></li>
      <li>GitLab and Bitbucket ingest</li>
      <li>Reading-path suggestions across callers and dependencies</li>
      <li>Coverage markers combining human and AI review state</li>
    </ul>
  </div>
</section>
```

- [ ] **Step 4: Verify the swap**

Run: `grep -c "caveats-list" landing/index.html`
Expected: `0` (section and CSS both gone)

Run: `grep -c "What it isn't yet" landing/index.html`
Expected: `0`

Run: `grep -c "coming-today" landing/index.html`
Expected: `5` (one CSS rule + four `<span>`s)

Run: `grep -c "<section" landing/index.html`
Expected: `6` (hero, the shift, principles spine, coda, where it sits, coming next)

- [ ] **Step 5: Verify in browser**

Reload `http://localhost:8123/landing/`. Confirm there is now a single "Coming next" section near the bottom — seven items, the first four ending in a dimmer parenthetical. The old "What it isn't yet" section is gone. The footer still renders directly after.

- [ ] **Step 6: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): merge caveats into the roadmap list"
```

---

## Task 7: Switch the page to the light Dollhouse theme

**Files:**
- Modify: `landing/index.html` — the `:root` block and the `color-scheme` declaration in the `<style>` block

The page currently wears Dollhouse Noir (dark). Switch it to the light Dollhouse theme — same token names, light values copied from `web/src/tokens.ts`. The layout, type scale, and screenshots do not change; only the palette. Every section's CSS already references these tokens, so the whole page re-themes from this one block.

Two values need hand-attention because they aren't a straight copy from `tokens.ts`:
- `--accent-strong` is a landing-page-only token (the CTA hover shade). Dollhouse has no darker-accent token, so it gets a hand-picked darker shade of the accent: `#b30f67`.
- `--on-accent` (text on the accent-colored primary CTA) flips from near-black to near-white, because the accent now sits on a light page and the button needs light text for contrast.

- [ ] **Step 1: Replace the `:root` token block**

Use Edit with this exact `old_string` (note the 4-space indent on `:root`):

```css
    :root {
  /* Dollhouse Noir tokens — copied from web/src/tokens.ts. */
  --bg: #1b0a18;
  --bg-1: #1b0a18;
  --bg-2: #260f25;
  --bg-3: #321432;
  --fg: #ffd6ec;
  --fg-dim: #c490b0;
  --fg-mute: #8b6584;
  --accent: #ff4dca;
  --accent-strong: #c41e8e;
  --border: #4a1f44;
  --on-accent: #1b0a18;
  --surface: var(--bg-2);
  --code-bg: var(--bg-3);
}
```

`new_string`:

```css
    :root {
  /* Dollhouse tokens — copied from web/src/tokens.ts. --accent-strong and
     --on-accent are landing-page-only: a hand-picked CTA-hover shade and
     light text for the accent button. */
  --bg: #fff5f9;
  --bg-1: #fff5f9;
  --bg-2: #ffe9f2;
  --bg-3: #ffd9e8;
  --fg: #4a1530;
  --fg-dim: #7a3358;
  --fg-mute: #b07590;
  --accent: #d4127a;
  --accent-strong: #b30f67;
  --border: #f0bfd5;
  --on-accent: #fff5f9;
  --surface: var(--bg-2);
  --code-bg: var(--bg-3);
}
```

- [ ] **Step 2: Flip `color-scheme` to light**

Use Edit with this exact `old_string`:

```css
  color-scheme: dark;
```

`new_string`:

```css
  color-scheme: light;
```

- [ ] **Step 3: Verify the swap**

Run: `grep -c "Dollhouse Noir" landing/index.html`
Expected: `0`

Run: `grep -c "color-scheme: light" landing/index.html`
Expected: `1`

Run: `grep -c "#fff5f9" landing/index.html`
Expected: `3` (`--bg`, `--bg-1`, `--on-accent`)

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:8123/landing/`. The whole page should now be light — warm cream-pink background, dark plum text, pink accent. Check specifically:
- Hero: the headline accent span and the primary CTA are pink (`#d4127a`); the primary CTA has near-white text and darkens on hover.
- The four screenshots stay dark (Dollhouse Noir) — that is intentional; they should sit in their light-pink borders like framed panels.
- Text contrast is comfortable everywhere — body copy, the `.eyebrow` labels, figcaptions, and the dimmer `(… today)` parentheticals in the roadmap.
- The coda section (`.pause`, `--surface` background) is a slightly deeper pink than the page.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html
git commit -m "polish(landing): switch page to the light Dollhouse theme"
```

---

## Task 8: Full-page verification

**Files:**
- None expected. Only edit `landing/index.html` if this task surfaces a defect.

A holistic pass over the finished page. Use the Playwright MCP tools (`browser_navigate`, `browser_take_screenshot`, `browser_resize`, `browser_click`).

- [ ] **Step 1: Serve and load**

Ensure `python3 -m http.server 8123` is running from the worktree root. `browser_navigate` to `http://localhost:8123/landing/`.

- [ ] **Step 2: Full-page screenshot + section audit**

Take a full-page screenshot. Confirm all six sections render in order with no broken layout: hero → the shift → principles spine → coda → where it sits → coming next → footer. Confirm the three spine screenshots (02, 03, 04) and the hero screenshot (01) all load — no broken-image placeholders.

- [ ] **Step 3: Console check**

Run `browser_console_messages`. Expected: no errors except possibly a favicon 404 (the page has no favicon — that 404 is known and harmless).

- [ ] **Step 4: Link audit**

Confirm these links point where they should (read the `href`s; do not need to click through):
- Hero primary CTA → `https://github.com/rowasc/shippable/releases/latest/download/Shippable.dmg` (known to 404 until v0.1.0 — expected, see spec Open Items)
- Hero secondary CTA → `https://github.com/rowasc/shippable`
- Footer links → Repo / Issues / Releases / License under `github.com/rowasc/shippable`
- Footer author links → `github.com/rominasuarez` and `github.com/luizreis`

- [ ] **Step 5: Mobile width**

`browser_resize` to 375×800. Take a screenshot. Confirm everything stacks readably: hero stacks (copy above screenshot), the comparison rows stack (category name above description), the coming-next list is single-column, no horizontal scroll.

- [ ] **Step 6: Fix-and-commit only if needed**

If steps 2–5 surfaced a defect, fix it in `landing/index.html` and commit:

```bash
git add landing/index.html
git commit -m "polish(landing): fix <describe the defect>"
```

If nothing needed fixing, this task produces no commit — just confirm the page is sound.

---

## Self-review notes (for the implementer's awareness)

- **Spec coverage:** every section of the spec maps to a task — hero lead → T1; the shift → T2; principles spine (all four blocks, including the Block 4 MCP reframe) → T3; coda → T4; where it sits → T5; coming next merge + PHP-WASM drop → T6; palette swap (Dollhouse Noir → Dollhouse) → T7; the "what moves out of the page" item is a no-op (already in README, noted above). Open Items from the spec (CTA 404, screenshot 03 defensibility, screenshot staleness) are go-live decisions, not implementation tasks — T8 step 4 surfaces the 404 as expected-not-a-bug.
- **No new types or shared symbols** — this is static HTML; the only cross-task consistency requirement is CSS class names: `.principle` / `.principles` (T3), `.coda-closer` (T4), `.landscape-desc strong` (T5), `.coming-today` (T6). Each class is defined and used within the same task.
