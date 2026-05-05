# Architecture

A snapshot of how the code is laid out, alongside `docs/overview.md`.

## Packages

- `web/` — React + Vite, Node 22, TypeScript. Four HTML entry points: `/` (live app), `/gallery.html` (screen catalog driven by canned fixtures), `/demo.html` (scripted demo route), `/feature-docs.html` (per-feature fixture viewer). The live app also accepts `?cs=<id>` to jump to a sample ChangeSet.
- `server/` — tiny Node http server, `tsx watch` in dev. **Required** in every deployment shape: hosts worktree ingest, the prompt library, the streaming review, and the AI plan. The web app refuses to load if `/api/health` doesn't respond.
- `src-tauri/` — Tauri 2 shell. Wraps the web app for the desktop build. The server is compiled to a standalone binary via `bun build --compile` and bundled as a sidecar.
- `library/prompts/` — markdown prompts (`explain-this-hunk`, `security-review`, `suggest-tests`, `summarise-for-pr`).

## Backend endpoints (`server/src/index.ts`)

- `POST /api/plan` — `{ changeset } → { plan }`. Default model `claude-sonnet-4-6`.
- `POST /api/review` — streams a review. Per-IP rate limit, default 30/60s.
- `GET  /api/library/prompts` — list prompts.
- `POST /api/library/refresh` — gated by `SHIPPABLE_ADMIN_TOKEN` (or `SHIPPABLE_DEV_MODE=1`).
- `GET  /api/health`.
- Origin allowlist with explicit handling of opaque origins (`Origin: null`) and `Sec-Fetch-Site`. The "null"-origin case has bitten us before; see comment in source.

## API key storage

macOS Keychain at `service=shippable, account=ANTHROPIC_API_KEY`. Same entry serves the dev backend and the bundled desktop app. The desktop app shows a first-run modal if the key is missing.

## Core data model (`web/src/types.ts`)

- `ChangeSet` → `DiffFile[]` → `Hunk[]` → `DiffLine[]`. Hunks carry symbol metadata, expand-above/below context, AI notes, and an optional teammate review.
- `ReviewPlan` = `headline` + `intent: Claim[]` + `StructureMap` + `entryPoints` (max 3). Every claim carries `EvidenceRef[]`. The UI refuses to render a claim with no evidence.
- `ReviewState` tracks: cursor, per-hunk read lines, explicitly reviewed files (Shift+M, single verdict gesture), dismissed guides, active skills, acked notes, replies, expand levels, line selection.
- Persistence: localStorage.

## In-browser code runner

`web/src/runner/` runs JS/TS and PHP hunks in web workers. AI notes can hand a snippet to the runner for one-click verify.

## UI surfaces

`web/src/components/`: DiffView, Sidebar, Inspector, StatusBar, ReviewPlanView, GuidePrompt, ReplyThread, PromptPicker, PromptEditor, PromptRunsPanel, CodeRunner, CodeText, CopyButton, RichText, Reference, KeySetup, LoadModal, HelpOverlay, ThemePicker, SyntaxBlock/Showcase, plus Gallery and Demo (internal — not part of the user-facing product).

## Other front-end modules

Beyond components, the load-bearing modules in `web/src/`:

- `promptRun.ts` + `promptStore.ts` — prompt-run state machine and persistence; what `PromptRunsPanel` renders.
- `symbols.ts` — symbol metadata attached to hunks; basis for the symbol-navigation work tracked in `docs/plan-symbols.md`.
- `feature-docs.tsx` — entry point for `/feature-docs.html`, paired with per-feature markdown under `docs/features/`.
- `parseDiff.ts`, `highlight.ts`, `tokens.ts` — diff parsing and Shiki-based highlighting feeding `DiffView`.
- `persist.ts` — localStorage round-trip for `ReviewState`.

## Themes

Light, dark, Dollhouse, Dollhouse Noir.
