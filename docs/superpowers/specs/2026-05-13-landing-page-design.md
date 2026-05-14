# Landing page — design

Date: 2026-05-13

## Goal

Ship a public-facing landing page for Shippable. Manifesto-led, evidence-backed, anchored by four real screenshots from the running app. Hosted later via GitHub Pages from a top-level `landing/` directory; v0 of this work commits files but does **not** flip the Pages switch.

The page replaces the in-tree `docs/landing-page/landing-mockup.html` as the canonical landing artifact. The mockup leaks several stale and aspirational claims; this spec corrects them.

## Decisions and rationale

Locked through brainstorm:

| Decision | Choice | Why |
|---|---|---|
| Scope | Substantive revision (not just audit fixes, not a rewrite) | The existing mockup has good copy but structural choices worth revisiting — the `grep WINDOW` example, the palette switcher, "Coming next" containing shipped items. Half-day-ish job. |
| Surface | Public hosted standalone HTML | Audience is anyone pointed at a URL via Slack/blog/Twitter. Renders without running anything. The existing mockup naturally grows into this. |
| Posture | Manifesto first, product second | Matches the AGENTS.md posture ("we tell users not to trust it yet but the experience matters"). Thesis lives in `LANDING.md`; features become evidence the thesis is being acted on. |
| Visual proof | Four real screenshots from the app | One in the hero, three in an "In practice" gallery. Real screenshots prove it's a built thing. Capture cost is paid once via Playwright MCP. |
| Theme | Dollhouse Noir | Page palette and screenshots both wear it. Distinctive against typical dev-tool blacks. Brand-coherent — visit the page, see what the app looks like. Audit calls Dollhouse / Dollhouse Noir "the brand." |
| CTAs | Primary: Download for macOS (DMG). Secondary: Read the source. | User picked DMG-primary, accepting that the link 404s until v0.1.0 is cut. |
| Hosting | GitHub Pages, source = `main`, folder = `/landing`. URL: `<owner>.github.io/shippable/`. | Cleanest: landing colocated with product, separate from `docs/`. |
| Capture mechanism | Playwright via the in-session MCP | Reproducible enough for v0. Promote to a checked-in `scripts/capture-screenshots.mjs` later if re-captures get frequent. |
| Deploy | **Deferred** | Files committed, ready to deploy. Pages config flip and v0.1.0 release happen later, not in this work. |

## What's been validated

Two adversarial subagents validated the existing `docs/landing-page/feature-audit.md` before this design. Findings:

**Audit's "not shipped" verdicts confirmed.** Linters / type checks in the runner, contextual skill loaders, comprehension prompts before sign-off, and two-way GitHub posting are all genuinely absent. Safe to delete these claims.

**Audit's "already shipped" verdicts confirmed.** Worktree ingest, URL changeset ingest, GitHub PR ingest, and the four hand-tuned themes (`light` / `dark` / `dollhouse` / `dollhouseNoir`) are all real and working end-to-end.

**Two new caveats surfaced.** Must appear on the page so the product is trustable later:

- GitHub PR ingest requires a PAT even for public repos (`server/src/index.ts:888-896` returns `github_token_required` with no credential).
- The PHP runner uses `@php-wasm/web` and cold-starts a ~21 MB WASM runtime on first run. Subsequent runs are fast.

## Page structure and content

Nine sections, top to bottom. Hero-driven: screenshot 1 is visible above the fold.

### 1. Hero

Two-column on desktop (copy on left, screenshot on right), stacked on mobile.

- Wordmark: `Shippable`
- Headline: **Agents help. You sign your name.** (`your name` in accent color)
- Subhead: *A review surface for everything you sign off on, typed or generated.*
- Lead paragraph: *Agents make diffs cheap. The human reviewing them is the bottleneck — and the one on the hook when something breaks in production.*
- Primary CTA: **Download for macOS** → `https://github.com/<owner>/shippable/releases/latest/download/Shippable.dmg` (404s until v0.1.0)
- Secondary CTA: **Read the source** → repo URL
- Visual half: screenshot 01 (diff + Inspector + AI note + read-line fade)

### 2. The shift

Manifesto core. Copy verbatim from existing mockup (audit cleared this):

- Eyebrow: `The shift`
- H2: *Most of the code you review wasn't typed by anyone you know.*
- Body: two paragraphs about agents writing diffs and reviewer bots not solving the human-on-the-hook problem. Ends with: *"Shippable is the surface for that part of the work."*

### 3. What it does — features grid

- Eyebrow: `What it does`
- H2: *Built for the human reading the code.*
- Subhead: *Given a git diff, Shippable:*
- Five cards (audit-distinctive five — explicitly drops the linter/typecheck claim from the mockup's current six):

1. **A review plan you can argue with.** Every claim in the plan points back to a file, hunk, or symbol. Click it, see the evidence, decide if you believe it. A rule-based fallback lands first so the plan is never empty while your AI thinks.
2. **Line-level read tracking, separate from sign-off.** The cursor records every line you've passed over. A gutter rail shows what you've read; a separate gesture says "I'm done with this file." You can't accidentally LGTM a file you haven't looked at.
3. **Run snippets without leaving the diff.** Select a hunk or a block. The runner detects input slots, gives you a form, and executes in a sandboxed worker. JavaScript, TypeScript, and PHP today. AI notes can hand a snippet to the runner so a concern becomes a verifier in one click.
4. **Comments that survive changes.** Each comment captures ten lines of context plus a content hash. When the worktree reloads — a new commit, an amend, uncommitted edits — comments re-attach to the new diff or land in a Detached pile with the original snippet preserved.
5. **The agent's session, alongside the diff.** Open a worktree the agent worked in. The Inspector shows the prompt that started the session, the files it touched, the plan it followed, the last few turns of the transcript, and any comments the agent has fetched from your review. Reply inline; the agent pulls your replies the next time it runs.

### 4. In practice — screenshot gallery

- Eyebrow: `In practice`
- H2: *What it looks like in use.*
- Three screenshots, one per row, large captions:
  - **Screenshot 02** — Plan with diagram. Caption: *Every claim points back at the code that justifies it.*
  - **Screenshot 03** — Agent context panel. Caption: *Read the diff alongside the session that wrote it.*
  - **Screenshot 04** — Code runner with input slots. Caption: *Verify the AI's claim in one click, not five.*

### 5. Pull-quote break

Centered, surface background:

> Agents help. You sign your name. Shippable is the part in between.

### 6. Where it sits — comparison

- Eyebrow: `Where it sits`
- H2: *Next to the tools you already use.*
- Five rows (keep existing copy; audit approved):
  - Pi
  - Conductor
  - Codex
  - Claude Code Review
  - GitHub PR review

### 7. What it isn't yet — NEW SECTION

- Eyebrow: `What it isn't yet`
- H2: *Where this is honest about being early.*
- Bulleted list framed as roadmap, not apology:
  - Local-first today; reviews live in `localStorage`. Shared reviews are next.
  - GitHub: read-only. PR ingest pulls in conversations and line-anchored comments; posting back to PR threads isn't built.
  - **GitHub PR ingest needs a PAT even for public repos.** (new caveat)
  - macOS only on the desktop side. `.dmg` is unsigned — Gatekeeper bypass required on first run.
  - Claude only on the AI side (Sonnet 4.6 by default). BYOK for other providers is next.
  - **The PHP runner loads a ~21 MB WASM runtime on first run.** Subsequent runs are fast. (new caveat)
  - LSP-backed click-through needs a worktree on disk. Memory-only deployments fall back to the regex graph.

### 8. Coming next — reduced roadmap

- Eyebrow: `Coming next`
- H2: *Roadmap.*
- List (drops items confirmed shipped: worktree ingest, URL ingest, PR-by-number, structured feedback):
  - Two-way GitHub: post review conclusions back to PR threads
  - Reading-path suggestions with AI explainers attached
  - Contextual skill loaders for repo and framework patterns
  - Coverage markers combining human and AI review state
  - Comprehension prompts that block reflex sign-off
  - Linux and Windows builds; signed and notarized macOS
  - GitLab and Bitbucket ingest
  - Hosted backend with shared multi-user reviews

### 9. Footer

*Built by [@rominasuarez](https://github.com/rominasuarez) and [@luizreis](https://github.com/luizreis). Feedback as issues, PRs, or DMs.*

Footer links: Repo · Comparison doc · Issues · Releases · License.

## File layout

```
landing/
  index.html                          single file, inline CSS
  .nojekyll                           empty, tells GH Pages not to run Jekyll
  screenshots/
    01-hero-diff-inspector.png
    02-plan-diagram.png
    03-agent-context.png
    04-code-runner.png
```

Existing files in `docs/landing-page/`:

- `LANDING.md` — kept as markdown source-of-truth for the copy.
- `feature-audit.md` — kept as design rationale.
- `landing-mockup.html` — **kept** as design history. Superseded by `landing/index.html` but preserved next to the audit it was validated against.

## CSS / style implementation

- Single theme; no palette switcher.
- Copy the `dollhouseNoir.vars` block from `web/src/tokens.ts` verbatim into `:root` as CSS custom properties (`--bg`, `--accent`, `--fg`, etc.). The landing page literally inherits the app's design language; future Dollhouse Noir tweaks propagate via copy-paste.
- Typography: ui-serif for h1–h4, ui-sans-serif for body, ui-monospace for code. Matches the mockup; reads well against the Dollhouse Noir palette.
- Layout breakpoints:
  - Hero: 2-column desktop, stack on mobile.
  - Features grid: 2-column desktop, 1-column mobile (matches mockup).
  - In-practice gallery: 1 screenshot per row at every width — three screenshots don't benefit from a grid.
  - Comparison table: 200px label / fluid description (matches mockup).
- Meta tags: standard `viewport`, `description`, `og:title`, `og:description`. **No** `og:image` for v0 — generate the social card after deploy.
- Accessibility: alt text on every screenshot, sufficient contrast (Dollhouse Noir `#ffd6ec` on `#1b0a18` passes WCAG AA), semantic HTML, no JS required for content.

## Screenshot capture plan

All captures performed in-session via the Playwright MCP tools (`browser_navigate`, `browser_evaluate`, `browser_click`, `browser_press_key`, `browser_take_screenshot`). The dev server must be running (`cd web && npm run dev` and `cd server && npm run dev`).

Theme seeded with one `localStorage` write before each capture:

```js
localStorage.setItem("shippable:theme", "dollhouseNoir");
```

Capture targets:

| # | File | Setup |
|---|---|---|
| 01 | `01-hero-diff-inspector.png` | Navigate `localhost:5173/?cs=cs-99-verify-features` → seed theme → reload → open Inspector → arrange so an AI concern with ack/reply row is visible alongside a faded read line and a `Plan · L<n>` badge. Frame ~16:10. |
| 02 | `02-plan-diagram.png` | Same load → press `p` → wait for diagram → ensure 5–8 nodes visible with typed roles; leave the disabled Class/State/Sequence/ER tabs visible (audit's "honest about what isn't done"). |
| 03 | `03-agent-context.png` | **Primary path**: load a real worktree paired with a matching Claude Code session, expand AgentContextSection with Task / Files / Transcript / Delivered visible. **Fallback path**: implement a fixture mock (decided during implementation — likely a `localStorage` seed of the relevant keys, or a `?fixture=agent-context` URL param if `useDeliveredPolling`'s shape doesn't accept localStorage seeds cleanly). |
| 04 | `04-code-runner.png` | Navigate `localhost:5173/?cs=cs-09-php-helpers` → seed theme → reload → select a hunk with a `runDemo(arg1, arg2)`-shaped function → fill the runner's input form → run → screenshot with form, code, and output visible. PHP is the audit's recommendation (uncommon on dev landing pages). |

Output: native capture at 2400px width (retina), display at ~1200px on the page. Compress with `pngcrush` or similar before commit if any single PNG exceeds 800 KB.

### Fixture mock (screenshot 03)

Sizing this is a sub-task of the plan. Investigation reads `web/src/components/AgentContextSection.tsx` and `web/src/useDeliveredPolling.ts` to determine which path is least invasive:

- **Option A — `localStorage` seed.** If the component renders from persisted state, seed the relevant keys before capture. Zero code change.
- **Option B — `?fixture=agent-context` URL param.** Add a short branch in the loader that, when the param is present, returns a baked-in payload. Tiny code change, isolated.

Decision made during implementation. If both are infeasible, hold the screenshot and ship the page without it (gallery becomes two screenshots — acceptable degradation).

## Deploy and verification

V0 commits files; does not deploy.

**Out of scope for v0**:

- Enabling GitHub Pages in repo settings.
- Cutting a v0.1.0 release with a DMG attached.
- Generating an `og:image` social card.

**Local verification before this work is done**:

1. Open `landing/index.html` directly (`file://` or simple `python -m http.server`).
2. Visual scan: every section renders, no missing assets.
3. All four screenshots load.
4. Click both CTAs. DMG link 404 (expected — link points at `releases/latest`). "Read the source" goes to the repo.
5. Click every body link (comparison doc path, footer issues, releases, license) — all hit real paths.
6. Resize browser to ~375px wide. Everything stacks readably.
7. Sanity-check in Safari (Wry/WKWebView relative) and Chrome.

## Open questions and risks

- **Repo owner for URLs.** `<owner>` placeholder used throughout. Resolved during implementation by reading the git remote.
- **Fixture mock shape.** Sized during implementation; may fall back to a two-screenshot gallery if neither option is viable.
- **`cs-99-verify-features` fixture existence.** Audit cites it as "the densest stub." Verify at implementation start; substitute a real worktree changeset if the stub is gone.
- **Playwright MCP screenshot size.** MCP screenshot defaults may not match the 2400px target; may need to set viewport explicitly via `browser_resize` before each capture.

## Out of scope

- Animation, hover states beyond basic CTA styling.
- Multi-language copy.
- Analytics, signup forms, newsletter integration.
- Comparison-doc page (`docs/plans/comparison-github-code-reviews.md`) — exists already; only link to it.
- Mobile-app version, Tauri-shell-embedded version, in-app `/landing.html` entry point.
