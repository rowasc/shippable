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
- `GET  /api/definition/capabilities`, `POST /api/definition` — TS/JS via `typescript-language-server`, PHP via `intelephense`/`phpactor`. Per-language module shape in `server/src/languages/`; shared `LspClient` lives in `server/src/lspClient.ts`.
- `POST /api/code-graph` — derives diagram edges via real LSP `documentSymbol` + `references`, falling back to the regex builder per language. Implementation in `server/src/codeGraph.ts`; per-file LRU keyed on `(workspaceRoot, ref, language, file, contentHash)`.
- `GET  /api/health`.
- Origin allowlist with explicit handling of opaque origins (`Origin: null`) and `Sec-Fetch-Site`. The "null"-origin case has bitten us before; see comment in source.

## Credential flow

One pattern serves the Anthropic API key and per-host GitHub PATs:

- **Tauri Keychain** is the durable store. The Rust shell exposes `keychain_get/set/remove` Tauri commands with a small allowlist (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN:<host>`). The server never reads OS credential storage.
- **Server-side `auth/store.ts`** holds the runtime cache, keyed by a flat string (`anthropic` or `github:<host>`).
- **Web orchestrator (`useCredentials`)** drives a boot rehydrate: it reads Keychain via the Tauri commands and pushes hits to `POST /api/auth/set`. The same hook handles user-initiated rotate / clear from the Settings panel and the reactive GitHub-token modal.
- **Boot prompt** (Anthropic only) appears on first run if the credential is missing and the user hasn't dismissed it; the skip choice persists in `localStorage["shippable:anthropic:skip"]`.
- **Hosted-backend future** (`AGENTS.md` deployment-shape note): the same pattern degrades cleanly — without a Tauri shell, the web app simply has no Keychain hits to push, and the user enters credentials via the Settings panel.

## Core data model (`web/src/types.ts`)

- `ChangeSet` → `DiffFile[]` → `Hunk[]` → `DiffLine[]`. Hunks carry symbol metadata, expand-above/below context, AI notes, and an optional teammate review.
- `ReviewPlan` = `headline` + `intent: Claim[]` + `StructureMap` + `entryPoints` (max 3). Every claim carries `EvidenceRef[]`. The UI refuses to render a claim with no evidence.
- `ReviewState` tracks: cursor, per-hunk read lines, explicitly reviewed files (Shift+M, single verdict gesture), dismissed guides, active skills, acked notes, replies, expand levels, line selection.
- Persistence: localStorage.

## Ingest paths

A `ChangeSet` can enter the app five ways:

1. **URL** — paste a `.diff` URL; the server fetches and parses it.
2. **File upload** — drag a `.diff` or `.patch` into LoadModal; parsed client-side.
3. **Paste** — raw unified diff text; parsed client-side.
4. **Worktree** — `POST /api/worktrees/changeset` diffs HEAD against the working tree on disk.
5. **GitHub PR by URL** — paste a PR URL (`https://<host>/<owner>/<repo>/pull/<n>`); the server authenticates with a per-host PAT, fetches diff + metadata + review comments from the GitHub API, and assembles a `ChangeSet` with `prSource` provenance. Worktrees whose branch resolves to an open upstream PR surface an opt-in overlay pill that merges `prSource` and PR comments into the existing local-diff `ChangeSet` without displacing `worktreeSource` — both fields can be set simultaneously. See `docs/sdd/gh-connectivity/spec.md` for the full design.

## In-browser code runner

`web/src/runner/` runs JS/TS and PHP hunks in web workers. AI notes can hand a snippet to the runner for one-click verify.

## UI surfaces

`web/src/components/`: DiffView, Sidebar, Inspector, StatusBar, ReviewPlanView, GuidePrompt, ReplyThread, PromptPicker, PromptEditor, PromptRunsPanel, CodeRunner, CodeText, CopyButton, RichText, Reference, CredentialsPanel, SettingsModal, ServerHealthGate, GitHubTokenModal, LoadModal, HelpOverlay, ThemePicker, SyntaxBlock/Showcase, plus Gallery and Demo (internal — not part of the user-facing product).

## Other front-end modules

Beyond components, the load-bearing modules in `web/src/`:

- `promptRun.ts` + `promptStore.ts` — prompt-run state machine and persistence; what `PromptRunsPanel` renders.
- `symbols.ts` — symbol metadata attached to hunks; basis for the symbol-navigation work tracked in `docs/plan-symbols.md`.
- `feature-docs.tsx` — entry point for `/feature-docs.html`, paired with per-feature markdown under `docs/features/`.
- `parseDiff.ts`, `highlight.ts`, `tokens.ts` — diff parsing and Shiki-based highlighting feeding `DiffView`.
- `codeGraph.ts`, `codeGraphClient.ts` — regex graph builder used as the fallback path; the client wrapper that POSTs to `/api/code-graph` for the LSP-resolved version when a worktree is attached. Demo / paste-load callers stay on the regex path.
- `persist.ts` — localStorage round-trip for `ReviewState`.

## Themes

Light, dark, Dollhouse, Dollhouse Noir.
