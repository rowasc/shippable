# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `landing/index.html` in Dollhouse Noir with four real screenshots from the running app, committed and ready to deploy via GitHub Pages later.

**Architecture:** Single static HTML file with inline CSS using the app's Dollhouse Noir theme tokens (`web/src/tokens.ts`). Four PNG screenshots captured via the Playwright MCP. No build step. Hosted later from `<repo>/landing/` once GitHub Pages is enabled — not in this plan.

**Tech Stack:** HTML5, CSS custom properties, Playwright MCP (`browser_navigate`, `browser_evaluate`, `browser_click`, `browser_press_key`, `browser_take_screenshot`, `browser_resize`). The web/server dev stack (Vite + Node) only runs during screenshot capture.

**Resolved decisions baked into this plan:**
- Repo owner is `rowasc` (from `git remote get-url origin`).
- `docs/plans/comparison-github-code-reviews.md` does **not** exist; the plan omits its link from the body and footer. If you want that link, create the doc as separate work.
- `.gitignore` currently has `screenshots/` (unanchored). Task 1 anchors it to `/screenshots/` so `landing/screenshots/` can be tracked.

---

## Task 1: Bootstrap `landing/` and adjust gitignore

**Files:**
- Modify: `/Users/luizreis/Development/shippable/.gitignore`
- Create: `/Users/luizreis/Development/shippable/landing/.nojekyll`
- Create: `/Users/luizreis/Development/shippable/landing/screenshots/.gitkeep`
- Create: `/Users/luizreis/Development/shippable/landing/index.html`

- [ ] **Step 1: Anchor the existing `screenshots/` rule in `.gitignore` to the repo root**

The current rule `screenshots/` (no leading slash) matches at any depth, which would block `landing/screenshots/`. Anchor it.

Edit `.gitignore` — find the line:

```
screenshots/
```

Change to:

```
/screenshots/
```

The surrounding comment ("Playwright MCP browser profile + screenshot output dir.") confirms the intent is the root-level ad-hoc capture dir, so this restores intent rather than changing behaviour.

- [ ] **Step 2: Create `landing/.nojekyll`**

Empty file. Tells GitHub Pages not to run Jekyll over our static HTML.

```bash
touch landing/.nojekyll
```

- [ ] **Step 3: Create `landing/screenshots/.gitkeep`**

Tracks the empty directory until screenshots arrive in Tasks 7–10.

```bash
mkdir -p landing/screenshots
touch landing/screenshots/.gitkeep
```

- [ ] **Step 4: Create `landing/index.html` with the skeleton**

Full file content:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shippable — A review surface for code you sign off on</title>
  <meta name="description" content="Shippable is a review surface for everything you sign off on, typed or generated. Agents make diffs cheap; the human reviewing them is the bottleneck.">
  <meta property="og:title" content="Shippable — A review surface for code you sign off on">
  <meta property="og:description" content="Agents help. You sign your name. Shippable is the part in between.">
  <meta property="og:type" content="website">
  <style>
    /* === Task 2 — CSS foundation goes here === */

    /* === Task 3 — Hero CSS === */

    /* === Task 4 — The shift CSS === */

    /* === Task 5 — Features grid CSS === */

    /* === Task 6 — Gallery CSS === */

    /* === Task 7 — Pull-quote CSS === */

    /* === Task 8 — Comparison CSS === */

    /* === Task 9 — Caveats CSS === */

    /* === Task 10 — Coming next CSS === */

    /* === Task 11 — Footer CSS === */
  </style>
</head>
<body>

  <!-- SECTION: hero (Task 3) -->

  <!-- SECTION: shift (Task 4) -->

  <!-- SECTION: features (Task 5) -->

  <!-- SECTION: gallery (Task 6) -->

  <!-- SECTION: pull-quote (Task 7) -->

  <!-- SECTION: comparison (Task 8) -->

  <!-- SECTION: caveats (Task 9) -->

  <!-- SECTION: coming-next (Task 10) -->

  <!-- SECTION: footer (Task 11) -->

</body>
</html>
```

- [ ] **Step 5: Verify**

Open `landing/index.html` in a browser (`file:///<repo>/landing/index.html`). You should see a blank page with the title "Shippable — A review surface for code you sign off on" in the tab. No console errors.

- [ ] **Step 6: Commit**

```bash
git add .gitignore landing/.nojekyll landing/screenshots/.gitkeep landing/index.html
git commit -m "chore(landing): scaffold + anchor screenshots gitignore"
```

---

## Task 2: CSS foundation — Dollhouse Noir tokens, reset, typography, container

**Files:**
- Modify: `landing/index.html` (the `=== Task 2 ===` marker in the `<style>` block)

This task adds the `:root` Dollhouse Noir tokens (copied verbatim from `web/src/tokens.ts`), a minimal reset, base body/link styles, the page container, and shared typography. Every later section relies on these tokens.

- [ ] **Step 1: Replace the `/* === Task 2 — CSS foundation goes here === */` marker with this block**

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

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.6;
  font-size: 16px;
}
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: var(--accent); }

.container { max-width: 980px; margin: 0 auto; padding: 0 36px; }

h1, h2, h3, h4 {
  font-family: ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif;
  font-weight: 700;
  letter-spacing: -0.022em;
  color: var(--fg);
  margin: 0;
}
h1 { font-size: 64px; line-height: 1.05; }
h2 { font-size: 32px; line-height: 1.2; margin-bottom: 18px; }
h3 { font-size: 17px; line-height: 1.3; margin-bottom: 6px; letter-spacing: -0.01em; }
p { margin: 0 0 1em; max-width: 62ch; }
p.lead { font-size: 19px; line-height: 1.55; }

.eyebrow {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-mute);
  margin: 0 0 14px;
  font-weight: 600;
}
.muted { color: var(--fg-dim); }
.subtitle { color: var(--fg-dim); }

section { padding: 96px 0; }
section + section { border-top: 1px solid var(--border); }
```

- [ ] **Step 2: Verify foundation renders**

Temporarily add `<h1>Foundation test</h1>` inside `<body>`. Open the page. You should see warm-pink (#ffd6ec) serif text on a dark plum background (#1b0a18). The `<h1>` should be ~64px. Remove the test `<h1>` before committing.

- [ ] **Step 3: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): CSS foundation with Dollhouse Noir tokens"
```

---

## Task 3: Hero section

**Files:**
- Modify: `landing/index.html` (the `<!-- SECTION: hero -->` marker; the `/* === Task 3 — Hero CSS === */` marker)

Two-column on desktop (copy on left, hero screenshot on right). Stacks on mobile. CTAs: Download for macOS (primary) and Read the source (secondary).

- [ ] **Step 1: Replace `<!-- SECTION: hero (Task 3) -->` with**

```html
<section class="hero">
  <div class="container hero-grid">
    <div class="hero-copy">
      <div class="wordmark">Shippable</div>
      <h1>Agents help.<br>You sign <span class="accent">your name.</span></h1>
      <p class="tagline">A review surface for everything you sign off on, typed or generated.</p>
      <p class="lead muted">
        Agents make diffs cheap. The human reviewing them is the bottleneck — and the one on the hook when something breaks in production.
      </p>
      <div class="cta-row">
        <a class="cta primary" href="https://github.com/rowasc/shippable/releases/latest/download/Shippable.dmg">Download for macOS</a>
        <a class="cta secondary" href="https://github.com/rowasc/shippable">Read the source</a>
      </div>
    </div>
    <div class="hero-visual">
      <img src="screenshots/01-hero-diff-inspector.png" alt="Shippable diff view with the Inspector open and an AI concern anchored to a line">
    </div>
  </div>
</section>
```

- [ ] **Step 2: Replace `/* === Task 3 — Hero CSS === */` with**

```css
.hero { padding-top: 132px; padding-bottom: 112px; }
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 56px;
  align-items: center;
}
@media (max-width: 860px) {
  .hero-grid { grid-template-columns: 1fr; gap: 36px; }
}
.wordmark {
  font-family: ui-serif, Georgia, serif;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 48px;
  color: var(--fg);
}
.hero h1 .accent { color: var(--accent); }
.tagline {
  font-size: 22px;
  line-height: 1.45;
  color: var(--fg-dim);
  margin: 28px 0 36px;
  max-width: 30ch;
}
.cta-row { margin-top: 8px; }
.cta {
  display: inline-block;
  padding: 12px 22px;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 500;
  margin-right: 10px;
  letter-spacing: 0.005em;
  border: 1px solid transparent;
  transition: background 0.15s ease;
}
.cta.primary { background: var(--accent); color: var(--on-accent); }
.cta.primary:hover { background: var(--accent-strong); border-bottom-color: transparent; }
.cta.secondary {
  background: transparent;
  border-color: var(--fg-mute);
  color: var(--fg);
}
.cta.secondary:hover { background: var(--bg-2); border-bottom-color: transparent; }
.hero-visual img {
  width: 100%;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  display: block;
}
```

- [ ] **Step 3: Verify**

Open the page. You should see the headline "Agents help. You sign your name." with "your name." in bright pink. CTAs visible: pink "Download for macOS" + outlined "Read the source." The hero screenshot is a broken-image placeholder (expected; screenshot captured later).

Resize to ~600px wide — copy should stack above the (broken) image.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): hero section with CTAs and screenshot slot"
```

---

## Task 4: "The shift" — manifesto core

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: shift (Task 4) -->`; no new CSS — uses foundation)

Copy verbatim from `docs/landing-page/landing-mockup.html`. Audit cleared this section.

- [ ] **Step 1: Replace `<!-- SECTION: shift (Task 4) -->` with**

```html
<section>
  <div class="container">
    <p class="eyebrow">The shift</p>
    <h2>Most of the code you review wasn't typed by anyone you know.</h2>
    <p class="lead">
      Some of it was written by your team. More of it was written by their agents. A growing share was written by your <em>own</em> agent — code you specced and never typed, now sitting in a 1,500-line diff you have to read like a stranger's.
    </p>
    <p>
      Reviewer bots help with some of that. They surface real issues, shorten loops, do their work. They don't change the fact that a human still has to read the diff, decide what to trust, and put their name on the merge. Shippable is the surface for that part of the work.
    </p>
  </div>
</section>
```

- [ ] **Step 2: Verify**

Open the page. You should see "The shift" eyebrow, an H2 in serif, and two paragraphs. Section sits below the hero with a thin border-top.

- [ ] **Step 3: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): the shift section"
```

---

## Task 5: "What it does" — five-card features grid

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: features (Task 5) -->`; the `/* === Task 5 — Features grid CSS === */` marker)

Five cards. **Deliberately drops** the linter/typecheck claim from the original six (adversarial agents confirmed not implemented). Drops "Persists locally" and "Works before there's a PR" as standalone cards — they're now subsumed by the five distinctive ones from the audit's recommendation.

- [ ] **Step 1: Replace `<!-- SECTION: features (Task 5) -->` with**

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
```

- [ ] **Step 2: Replace `/* === Task 5 — Features grid CSS === */` with**

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
```

- [ ] **Step 3: Verify**

Five cards in a 2-column grid on desktop. Each card has a serif H3 title and dim body text. Resize to ~600px — cards stack into one column. The card backgrounds (`#260f25`) sit slightly above the page background.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): features grid with five distinctive cards"
```

---

## Task 6: "In practice" — three-screenshot gallery (placeholders)

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: gallery (Task 6) -->`; `/* === Task 6 — Gallery CSS === */`)

Three captioned screenshot blocks. Images are broken until captures land in Tasks 8–10.

- [ ] **Step 1: Replace `<!-- SECTION: gallery (Task 6) -->` with**

```html
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

- [ ] **Step 2: Replace `/* === Task 6 — Gallery CSS === */` with**

```css
.gallery-item {
  margin: 36px 0 0;
}
.gallery-item img {
  width: 100%;
  height: auto;
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

- [ ] **Step 3: Verify**

Three figure blocks, each with a broken-image rectangle and a serif caption below. Captions read in order: "Every claim points back…", "Read the diff alongside…", "Verify the AI's claim…". Spacing between figures is comfortable, not crammed.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): in-practice gallery with three captioned slots"
```

---

## Task 7: Pull-quote break

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: pull-quote (Task 7) -->`; `/* === Task 7 — Pull-quote CSS === */`)

Centered serif quote on a lifted-surface background. Breaks the eyebrow/h2 rhythm.

- [ ] **Step 1: Replace `<!-- SECTION: pull-quote (Task 7) -->` with**

```html
<section class="pause">
  <div class="container">
    <blockquote class="pull-quote">
      <p>Agents help.</p>
      <p>You sign your name.</p>
      <p>Shippable is the part in between.</p>
    </blockquote>
  </div>
</section>
```

- [ ] **Step 2: Replace `/* === Task 7 — Pull-quote CSS === */` with**

```css
section.pause {
  padding: 84px 0;
  background: var(--surface);
}
section + section.pause,
section.pause + section { border-top: none; }
.pull-quote {
  margin: 0 auto;
  text-align: center;
  max-width: 26ch;
  font-family: ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif;
  font-size: 34px;
  line-height: 1.3;
  letter-spacing: -0.018em;
  font-weight: 700;
  color: var(--fg);
}
.pull-quote p { margin: 0 0 2px; }
.pull-quote p:last-child { color: var(--fg-dim); font-weight: 400; }
```

- [ ] **Step 3: Verify**

Centered three-line quote, last line dimmer than the first two. Surrounding background is the lifted plum (`#260f25`). No top or bottom border on this section (it's a visual break).

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): pull-quote break"
```

---

## Task 8: "Where it sits" comparison

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: comparison (Task 8) -->`; `/* === Task 8 — Comparison CSS === */`)

Five-row landscape list (name → description). Copy verbatim from the existing mockup; audit approved.

- [ ] **Step 1: Replace `<!-- SECTION: comparison (Task 8) -->` with**

```html
<section>
  <div class="container">
    <p class="eyebrow">Where it sits</p>
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
  </div>
</section>
```

- [ ] **Step 2: Replace `/* === Task 8 — Comparison CSS === */` with**

```css
.landscape-list { margin-top: 28px; }
.landscape-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 28px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border);
}
.landscape-row:last-child { border-bottom: none; }
.landscape-name {
  font-weight: 600;
  color: var(--fg);
  font-size: 15px;
}
.landscape-desc { color: var(--fg-dim); font-size: 14.5px; max-width: 56ch; margin: 0; }
@media (max-width: 600px) {
  .landscape-row { grid-template-columns: 1fr; gap: 6px; }
}
```

- [ ] **Step 3: Verify**

Five rows, name on the left (200px column), description on the right. Hairline between rows. On narrow screens (≤600px) name stacks above description.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): where-it-sits comparison"
```

---

## Task 9: "What it isn't yet" — caveats section

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: caveats (Task 9) -->`; `/* === Task 9 — Caveats CSS === */`)

Seven bullets, including the two new caveats the adversarial agents found (PAT for public-repo PR ingest; ~21 MB PHP WASM cold start). Frame as roadmap, not apology.

- [ ] **Step 1: Replace `<!-- SECTION: caveats (Task 9) -->` with**

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
```

- [ ] **Step 2: Replace `/* === Task 9 — Caveats CSS === */` with**

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

- [ ] **Step 3: Verify**

Seven bulleted lines, each preceded by a small pink dot. Dashed underlines between items. `localStorage` and `.dmg` render in monospace with a small surface background.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): what-it-isnt-yet caveats"
```

---

## Task 10: "Coming next" roadmap

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: coming-next (Task 10) -->`; `/* === Task 10 — Coming next CSS === */`)

Eight items. **Drops** worktree ingest, URL changeset ingest, PR-by-number ingest, and structured one-way feedback — all four confirmed shipped by adversarial agents.

- [ ] **Step 1: Replace `<!-- SECTION: coming-next (Task 10) -->` with**

```html
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

- [ ] **Step 2: Replace `/* === Task 10 — Coming next CSS === */` with**

```css
.coming-list {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  columns: 2;
  column-gap: 36px;
}
@media (max-width: 720px) { .coming-list { columns: 1; } }
.coming-list li {
  padding: 10px 0 10px 22px;
  position: relative;
  font-size: 15px;
  color: var(--fg);
  break-inside: avoid;
}
.coming-list li::before {
  content: "→";
  color: var(--accent);
  position: absolute;
  left: 0;
  top: 10px;
}
```

- [ ] **Step 3: Verify**

Eight items laid out in a 2-column grid on desktop, each prefixed with a pink arrow. Stack to 1 column on narrow screens. Items don't break across columns.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): coming-next roadmap"
```

---

## Task 11: Footer + pre-screenshot verification

**Files:**
- Modify: `landing/index.html` (`<!-- SECTION: footer (Task 11) -->`; `/* === Task 11 — Footer CSS === */`)

Credit line names both authors (`@rominasuarez` and `@luizreis`). Footer link row drops the comparison-doc link — that doc doesn't exist.

- [ ] **Step 1: Replace `<!-- SECTION: footer (Task 11) -->` with**

```html
<footer>
  <div class="container">
    <div class="footer-row">
      <div>
        Built by <a href="https://github.com/rominasuarez">@rominasuarez</a> and <a href="https://github.com/luizreis">@luizreis</a>. Feedback as issues, PRs, or DMs.
      </div>
      <div class="footer-links">
        <a href="https://github.com/rowasc/shippable">Repo</a>
        &nbsp;·&nbsp;
        <a href="https://github.com/rowasc/shippable/issues">Issues</a>
        &nbsp;·&nbsp;
        <a href="https://github.com/rowasc/shippable/releases">Releases</a>
        &nbsp;·&nbsp;
        <a href="https://github.com/rowasc/shippable/blob/main/LICENSE">License</a>
      </div>
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Replace `/* === Task 11 — Footer CSS === */` with**

```css
footer {
  border-top: 1px solid var(--border);
  padding: 36px 0 60px;
  font-size: 14px;
  color: var(--fg-dim);
}
footer .footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
}
footer .footer-links a { color: var(--fg-dim); border-bottom: 1px solid transparent; }
footer .footer-links a:hover { color: var(--accent); border-bottom-color: var(--accent); }
```

- [ ] **Step 3: Pre-screenshot verification — walk the whole page**

Open `landing/index.html` in Chrome and Safari. Confirm:

1. Hero renders with headline, CTAs, broken hero image.
2. "The shift" section sits below with the manifesto paragraphs.
3. Five feature cards in a 2-column grid.
4. Three broken-image gallery figures with captions.
5. Pull-quote on lifted surface.
6. Five-row comparison list.
7. Seven-bullet caveats list, monospace code chips render.
8. Eight-item roadmap in two columns.
9. Footer with both author handles + 4 link row.

Click every link except the DMG one (DMG is expected to 404). All other links must open the right GitHub URL.

Resize to ~375px. Page stacks readably; the hero copy lands above (broken) image; features go to 1 column; comparison rows stack.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html
git commit -m "feat(landing): footer and pre-screenshot verification"
```

---

## Task 12: Start the dev stack for screenshot captures

The next four tasks need the web app running.

- [ ] **Step 1: Start the local server (background)**

```bash
cd /Users/luizreis/Development/shippable/server && npm run dev
```

Run with `run_in_background: true`. Wait for "Server listening on http://localhost:3001" (or similar) to appear.

- [ ] **Step 2: Start the web dev server (background)**

```bash
cd /Users/luizreis/Development/shippable/web && npm run dev
```

Run with `run_in_background: true`. Wait for Vite's "Local: http://localhost:5173/" line.

- [ ] **Step 3: Confirm the app loads**

In the Playwright MCP:

```
browser_navigate("http://localhost:5173/")
browser_snapshot()
```

You should see the Shippable Welcome screen. If you see a "server unreachable" gate, the local server didn't start — check the logs of the first background process.

No commit for this task — it's just setup. Servers stay running across Tasks 13–16.

---

## Task 13: Capture screenshot 01 — Hero (diff + Inspector + AI note)

**Files:**
- Create: `landing/screenshots/01-hero-diff-inspector.png`

Audit recommends the stub fixture `cs-99-verify-features` ("the densest stub"). Verify it loads; if not, substitute another stub or a small worktree.

- [ ] **Step 1: Navigate to the densest stub**

```
browser_navigate("http://localhost:5173/?cs=cs-99-verify-features")
```

If this lands on the Welcome screen instead of a diff, the stub may not exist — fall back to any `cs-*` fixture that exists (check `web/src/*.ts` for `cs-` definitions). Confirm a real diff renders before continuing.

- [ ] **Step 2: Seed the Dollhouse Noir theme + reload**

```
browser_evaluate(() => localStorage.setItem("shippable:theme", "dollhouseNoir"))
browser_navigate("http://localhost:5173/?cs=cs-99-verify-features")
```

(Reload to pick up the theme. After this, the diff view should be on the dark plum / hot-pink palette.)

- [ ] **Step 3: Resize the viewport**

```
browser_resize(2400, 1500)
```

Native 2400×1500 captures retina-quality. Aspect ratio 16:10.

- [ ] **Step 4: Open the Inspector**

Find the Inspector toggle in the app's keymap — `i` typically, or the gutter glyph for an AI concern. Use `browser_snapshot()` to find the right control if unsure.

```
browser_press_key("i")
```

You want a state where:
- A faded "read" line is visible.
- An AI concern is visible inline with `Plan · L<n>` badge.
- The Inspector shows the concern with the ack/reply row visible.

If the Inspector doesn't auto-target an interesting concern, click on a hunk that has one (visible via the in-gutter glyph).

- [ ] **Step 5: Capture**

```
browser_take_screenshot({
  filename: "/Users/luizreis/Development/shippable/landing/screenshots/01-hero-diff-inspector.png",
  fullPage: false
})
```

If the MCP doesn't accept absolute paths, capture to its default screenshot dir and move:

```bash
mv <captured-path>.png landing/screenshots/01-hero-diff-inspector.png
```

- [ ] **Step 6: Verify**

Open `landing/index.html`. The hero now shows the captured screenshot. If the framing is wrong (concern not visible, too much chrome, theme drift), repeat Steps 1–5 and re-capture.

- [ ] **Step 7: Commit**

```bash
git add landing/screenshots/01-hero-diff-inspector.png
git commit -m "feat(landing): hero screenshot"
```

---

## Task 14: Capture screenshot 02 — Plan with diagram

**Files:**
- Create: `landing/screenshots/02-plan-diagram.png`

Same load as Task 13. Press `p` to enter the review plan. Diagram should auto-render with 5–8 nodes.

- [ ] **Step 1: With the previous load still active, press `p`**

```
browser_press_key("p")
```

- [ ] **Step 2: Wait for the diagram to render**

```
browser_wait_for({ text: "structure" })   // or another marker present in PlanDiagramView
```

If `browser_wait_for` doesn't accept a text matcher, fall back to a 2-second sleep:

```
browser_evaluate(() => new Promise(r => setTimeout(r, 2000)))
```

- [ ] **Step 3: Confirm the disabled tabs are visible**

The audit notes that the disabled Class / State / Sequence / ER tabs add honesty to the screenshot. Confirm via `browser_snapshot()` that they're present.

- [ ] **Step 4: Capture**

```
browser_take_screenshot({
  filename: "/Users/luizreis/Development/shippable/landing/screenshots/02-plan-diagram.png",
  fullPage: false
})
```

- [ ] **Step 5: Verify and commit**

Open `landing/index.html`. The second gallery slot now shows the diagram. If the diagram is empty or has only 2 nodes, switch to a larger fixture and re-capture.

```bash
git add landing/screenshots/02-plan-diagram.png
git commit -m "feat(landing): plan-with-diagram screenshot"
```

---

## Task 15: Capture screenshot 03 — Agent context panel (with fixture investigation)

**Files:**
- Create: `landing/screenshots/03-agent-context.png`
- Possibly create: a small change to enable a fixture mode (decided during this task)

**Two paths.** Primary: real worktree + Claude Code session. Fallback: implement a tiny fixture mock.

- [ ] **Step 1: Try the primary path first**

If you have a worktree under `.claude/worktrees/` paired with a recent Claude Code session, load it via the Welcome screen:

```
browser_navigate("http://localhost:5173/")
browser_click("button: Open a worktree")   // adjust label as needed via browser_snapshot()
```

Pick the worktree. If the Inspector's AgentContextSection populates with Task / Files / Plan / Transcript / Delivered, go to Step 4.

- [ ] **Step 2: If primary fails, investigate the fixture path**

Read these to decide which is least invasive:

```bash
sed -n '1,80p' web/src/components/AgentContextSection.tsx
sed -n '1,80p' web/src/useDeliveredPolling.ts
```

Look for:
- Where the agent context state comes from (server endpoint, polling hook, or props).
- Whether it accepts a fixture override (URL param, env var, localStorage seed).

Decide between:
- **Option A — `localStorage` seed.** If the component reads from a single persisted key, write a synthetic payload to that key and reload.
- **Option B — `?fixture=agent-context` URL param.** Add a small branch in the polling hook or its server endpoint that returns a baked-in payload when this param is present.

If neither is viable in under 30 minutes of work, **skip the screenshot**: remove the third `<figure class="gallery-item">…</figure>` block from `landing/index.html` and ship the gallery with two screenshots. Document the skip in the commit message.

- [ ] **Step 3: Implement the chosen fixture path**

For Option A, write code that looks like:

```js
browser_evaluate(() => {
  localStorage.setItem("<key from investigation>", JSON.stringify({
    task: "Lift the read-meter into the sidebar overflow",
    filesTouched: ["web/src/components/Sidebar.tsx", "web/src/state.ts"],
    plan: ["Move metric into existing overflow region", "Re-anchor cursor on resize"],
    transcript: [/* 3 turns */],
    delivered: [{ id: 1, text: "Done — check anchor pass on reload." }]
  }));
});
```

For Option B, add a small branch (under 20 lines) in the relevant hook/endpoint and commit it as a separate change:

```bash
git add web/src/<file>
git commit -m "feat(web): allow ?fixture=agent-context for screenshot capture"
```

- [ ] **Step 4: Navigate, seed theme, expand the panel, capture**

```
browser_navigate("http://localhost:5173/?cs=<worktree-cs-id>")   // or ?fixture=agent-context
browser_evaluate(() => localStorage.setItem("shippable:theme", "dollhouseNoir"))
browser_navigate("<same URL>")
// expand the AgentContextSection — click the section header or its expansion control
browser_resize(2400, 1500)
browser_take_screenshot({
  filename: "/Users/luizreis/Development/shippable/landing/screenshots/03-agent-context.png",
  fullPage: false
})
```

- [ ] **Step 5: Verify and commit**

Open `landing/index.html`. The third gallery slot now shows the agent context panel. Confirm: Task expanded, Files touched, Transcript with at least 3 turns, Delivered with at least 1 entry.

```bash
git add landing/screenshots/03-agent-context.png
git commit -m "feat(landing): agent-context screenshot"
```

(If the fixture-code path was needed, that's already committed separately in Step 3.)

---

## Task 16: Capture screenshot 04 — Code runner with input slots

**Files:**
- Create: `landing/screenshots/04-code-runner.png`

PHP is the audit's recommendation — uncommon on dev landing pages and visually distinctive.

- [ ] **Step 1: Navigate to a PHP fixture**

```
browser_navigate("http://localhost:5173/?cs=cs-09-php-helpers")
browser_evaluate(() => localStorage.setItem("shippable:theme", "dollhouseNoir"))
browser_navigate("http://localhost:5173/?cs=cs-09-php-helpers")
```

If `cs-09-php-helpers` doesn't exist, look for any other PHP fixture. TS fallback: `cs-91-agent-flow`.

- [ ] **Step 2: Select a hunk with an input-slot-friendly function**

Find a function with signature like `runDemo(arg1, arg2)`. Click into the line range to select the hunk. Open the runner panel (keymap label "open runner" — likely `r` or the gutter affordance; confirm via `browser_snapshot()` of the keyboard help overlay).

The PHP runner will cold-start a ~21 MB WASM runtime on first use. Wait for it. Confirm the input form renders with two input fields.

- [ ] **Step 3: Fill the input form and run**

```
browser_fill_form([
  { selector: "input[name='arg1']", value: "<plausible value>" },
  { selector: "input[name='arg2']", value: "<plausible value>" }
])
browser_click("button: Run")   // adjust label via browser_snapshot()
```

Wait for the output panel to populate.

- [ ] **Step 4: Resize and capture**

```
browser_resize(2400, 1500)
browser_take_screenshot({
  filename: "/Users/luizreis/Development/shippable/landing/screenshots/04-code-runner.png",
  fullPage: false
})
```

Frame the capture so the code, the input form, and the output panel are all visible.

- [ ] **Step 5: Verify and commit**

Open `landing/index.html`. The fourth gallery slot now shows the runner.

```bash
git add landing/screenshots/04-code-runner.png
git commit -m "feat(landing): code-runner screenshot"
```

---

## Task 17: Final local verification + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Stop the dev servers**

Kill the background Vite and Node processes from Task 12.

- [ ] **Step 2: Open the page from scratch**

```bash
open landing/index.html
```

Or use `python3 -m http.server` from `landing/` and visit `http://localhost:8000/` — closer to how GitHub Pages will serve it.

- [ ] **Step 3: Walk every section**

Confirm:

1. Hero: headline, CTAs (Download for macOS, Read the source), screenshot 01 visible.
2. The shift: two paragraphs render.
3. Features: five cards in 2-column grid (desktop) / 1 column (mobile).
4. Gallery: screenshots 02, 03, 04 visible with captions. If screenshot 03 was skipped, gallery has two figures.
5. Pull-quote: three lines centered on the lifted surface.
6. Comparison: five rows, name + description.
7. Caveats: seven bullets including the two new ones (PAT requirement, PHP WASM cold start).
8. Coming next: eight items in 2 columns.
9. Footer: both author handles, four links (Repo, Issues, Releases, License).

- [ ] **Step 4: Click every link**

DMG link: expect a 404 from GitHub (no release yet). All other links must open the right GitHub URL. Both author handles must point at `github.com/<handle>`.

- [ ] **Step 5: Resize tests**

Drag the window down to ~375px. Everything stacks readably. The hero copy lands above the screenshot. The features and coming-next grids drop to single column. The comparison name/description stack.

- [ ] **Step 6: Cross-browser sanity check**

Open the same page in Safari (Wry/WKWebView relative — same engine as the desktop shell). Then Chrome. Both should render identically.

- [ ] **Step 7: Check screenshot file sizes**

```bash
ls -lh landing/screenshots/
```

If any PNG is larger than 800 KB, run it through `pngcrush` or `oxipng`:

```bash
oxipng -o 4 landing/screenshots/01-hero-diff-inspector.png
```

If any compression is meaningful, commit:

```bash
git add landing/screenshots/
git commit -m "polish(landing): compress screenshots"
```

- [ ] **Step 8: Done**

The page is committed and ready to deploy. To go live: repo → Settings → Pages → Source = Deploy from a branch → Branch = `main` → Folder = `/landing` → Save. URL appears at `<org>.github.io/shippable/`. **Not part of this plan** — you flip the switch when you're ready to ship.

---

## Self-review

**Spec coverage:** Every section of the spec is mapped to a task. Hero (Task 3), shift (Task 4), features (Task 5), gallery (Task 6), pull-quote (Task 7), comparison (Task 8), caveats (Task 9), coming-next (Task 10), footer (Task 11). Screenshots 01–04 are Tasks 13–16. CSS foundation is Task 2. Bootstrap + gitignore is Task 1. Final verification is Task 17. ✓

**Placeholder scan:** Fixture-mock investigation in Task 15 has a concrete decision tree (Options A/B, 30-minute time-box, skip-screenshot fallback). No "TODO" / "TBD" / "implement appropriate" language elsewhere. ✓

**Type consistency:** CSS class names referenced in HTML chunks (`.hero-grid`, `.feature`, `.gallery-item`, `.landscape-row`, `.caveats-list`, `.coming-list`, `.footer-row`, etc.) all match their corresponding CSS rules in the same task. Marker comments (`<!-- SECTION: hero (Task 3) -->`) match Task 1's skeleton. ✓

**Notable adaptations:**
- TDD doesn't apply to static HTML/CSS. Each task substitutes "visual verification in a browser" for the test step. Each task still ends in a commit.
- Screenshots aren't reproducible without the running dev stack — Task 12 sets that up before Tasks 13–16.
- The comparison-doc link from the spec is omitted in Task 11 because that doc doesn't exist; flagged in the plan header.

---

## What this plan does NOT cover (deferred)

- Enabling GitHub Pages in repo settings.
- Cutting a v0.1.0 release with a signed/notarized DMG attached.
- Generating an `og:image` social card.
- Building a checked-in Playwright capture script (`scripts/capture-screenshots.mjs`). Promote from the in-session MCP captures only if re-captures get frequent.
- Creating `docs/plans/comparison-github-code-reviews.md`.
