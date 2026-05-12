# Agents guide

Shippable (name will change) is an early **prototype** of an AI-assisted code review tool. While we tell users not to trust it yet because we're prototyping quickly, the experience matters, and the architecture should not paint us into corners that we could never implement for a product. Read `IDEA.md` once for the *why* and `README.md` for the *how to run*.

## How we work

We rely heavily on **git worktrees**. Most non-trivial work happens in a separate worktree so several agents — and humans — can move in parallel without stepping on each other. The convention:

- One worktree per task. Branch named after the task (e.g. `feat/docs-automation`, `security/sandbox-php`).
- Sandbox worktrees that an agent owns live under `.claude/worktrees/<name>` (see `docs/plans/auto-mode-sandbox.md`); longer-lived ones sit next to the repo as siblings (`../shippable-<task>/`).
- `git worktree list` is the source of truth. Don't guess what's active — list it.
- Don't delete or `git worktree remove` someone else's tree. If one looks stale, ask.
- Coming back to `main`? `git status` first. Don't assume the working tree is the one you left.

Within each worktree, agents can explore, run things, make commits, test new features.

## Layout

- `web/` — React + Vite + TypeScript. The UI, the diff parser, the review state machine. Four entry points: `/`, `/gallery.html` (screen catalog for design work), `/demo.html`, `/feature-docs.html`.
- `server/` — tiny Node HTTP server. Required in every shape; the web app probes `/api/health` at boot via `ServerHealthGate` and refuses to load without it. AI features (plan, streaming review) need an Anthropic key; everything else (worktrees, prompt library, rule-based plan) works without one. Compiled into the desktop sidecar via `bun build --compile`.
- `src-tauri/` — Tauri 2 shell that wraps the web app + sidecar into a macOS `.dmg`.
- `library/prompts/` — markdown prompts shipped with the product (`explain-this-hunk`, `security-review`, etc.).
- `docs/` — architecture, roadmap, plans, per-feature notes (see "Where ideas live" below).
- `scripts/` — repo-level build glue (e.g. `build-dmg.mjs`).

`docs/architecture.md` is the canonical map of modules and data flow. Read it before non-trivial changes.

## Quality checks

- `npm run build` in `web/` must pass.
- `npm run lint` in `web/` must pass.
- `npm run test` (vitest) — run if you touched `parseDiff`, `state`, or anything with adjacent tests.
- `npm run typecheck` in `server/`.
- For UI work, open it in the browser. Don't claim a feature works because the build passed, test it end to end.

There is no CI yet.

## Code style

Prefer simple over clever. Boring solutions that work in production and can be understood beat complex ones that don't.

- **Succinct.** Deep modules, short comments, short PR descriptions. If a comment explains *what* the code does, delete it; if it explains *why*, keep it.
- **No premature abstraction.** Three similar lines is fine. Two call sites does not justify a helper.
- **No backwards-compat shims for internal code.** If nothing outside this repo imports it, change the thing and update its callers in the same commit
- **Trust the boundary.** Validate at user input / external API edges; don't re-validate internal calls.
- **Naming over commenting.** Well-named identifiers carry the load. Don't reference issue numbers, callers, or "added for X" — that rots.
- **Evidence over claims** is a product principle (`docs/concepts/evidence-model.md`) and also a code-review one. If you say "this is fine," point at the line.
- **Ask if you don't know.** When you are writing code, prefer asking the human in the loop over making assumptions.

## Where ideas and plans live

We document in the repo, not in chat. If you propose something non-trivial, write it down where the next agent will find it.

- `docs/ROADMAP.md` — what we're building, in rough order. 0.1.0 first, then 0.2.0, then "maybe."
- `docs/plans/` — design plans for bigger features (worktrees ingest, AI plan, symbol navigation, auto-mode sandbox). These are living documents; update them as the design moves.
- `docs/concepts/` — how individual subsystems work (review plan model, evidence model, theme tokens, etc.). Reach for these when you're about to touch one.
- `docs/features/` — per-feature notes paired with `/feature-docs.html`.
- `IDEA.md` — the original problem statement. Don't edit lightly.

When you finish a chunk of work that changes how something is built or used, leave a paper trail in the right `docs/` folder. The `.meta/` folder is for personal/draft notes — read but don't depend on.

## Deployment modes (don't forget these exist)

The local Node backend in `server/` is a **hard dependency** in every shape we ship — dev, the Tauri desktop sidecar, anything else. Worktree ingest, the prompt library, and the AI plan all live there. The web app probes `/api/health` at boot and shows a “server unreachable” gate if it can’t reach it; there is no browser-only fallback. Don’t reintroduce one.

What still varies, and what plans like `docs/plans/plan-symbols.md` and `docs/plans/worktrees.md` are about, is **how the server reaches the source it’s reviewing**:

- **Memory-only / can't-clone-to-disk** — a real near-term constraint, not an edge case. Some deployment contexts (finance/healthcare/defense audit) can't materialise a checkout on the host's disk; the server has to stream content over the wire and analyse in memory. Don't assume a clone is on disk.
- **No-server-side GitHub clone** — code fetched directly from the GitHub API instead of `git clone`. Same constraint, different reason (rate limits, no host permissions). The server is still in the loop; it just talks to GitHub instead of the filesystem.

Features that depend on a particular workspace mode (worktree ingest needs disk; symbol nav can do either) should hide themselves cleanly via capability flags rather than render disabled. **The flags describe workspace capabilities, not server presence — server presence is assumed.**

## Things that have bitten us

- The `Origin: null` / opaque-origin case in `server/src/index.ts` — there's a comment; read it before touching CORS.
- Shipping the Tauri DMG via the built-in step (Finder AppleScript). We use `hdiutil` instead — see `scripts/build-dmg.mjs`.
- If you change `ReviewState` or any other internal shape that will be stored, version it.

## Tauri/Wry constraints

- `window.confirm()`, `window.alert()`, and blob-URL `<a target="_blank">` downloads do NOT work in Wry/WKWebView. Use in-app modals/lightboxes instead.
- The sidecar inherits parent shell env vars (e.g., `ANTHROPIC_API_KEY`) during `tauri dev` — verify behavior in a packaged DMG, not just dev, before claiming an env-handling change works.

## Git etiquette

- Conventional-ish commit messages. Look at `git log` for the local style; match it.
- Never use co-authored-by attribution to Claude unless explicitly asked, we avoid this as a reminder that the accountable party is the human, even if most of our work is AI assisted these days. 
- Be explicit when pushing: `git push origin <branch>`, never bare `git push`. 
- Don't force-push.
- Don't `git worktree remove` what you didn't create.
- Prefer rebase.

## Pointers

- `README.md` — running it (web, server, desktop).
- `docs/overview.md` — what the product does today and what it doesn't.
- `docs/architecture.md` — module map and data model.
- `docs/ROADMAP.md` — what's next.
- `docs/plans/` — design docs for bigger features.
- `docs/concepts/` — how the existing subsystems work.
