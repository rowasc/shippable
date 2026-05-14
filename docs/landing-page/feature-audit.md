# Feature audit · 2026-05-13

Verified against `main` at `60435c8`. Every classification is grounded in a file I opened in this session, not in what the docs say.

## 1. Feature inventory

| # | Feature | Class | Evidence | Note |
|---|---|---|---|---|
| 1 | Diff view (hunked, cursor visible, visited-line marks, inline AI/comment glyphs, hunk-level coverage/symbol/teammate badges) | Shipped | `web/src/components/DiffView.tsx:96-403`, `:475-497`, `:677-725` | AI body lives in Inspector, not inline. Glyphs in-gutter are real. |
| 2 | File sidebar (A/M/D/R, read meter, sign-off check, jump-to-file, detached pile) | Shipped | `web/src/components/Sidebar.tsx:50-120`, `:288-294` | |
| 3 | Review progress (per-line visit tracking → per-file %, sign-off separate, status-bar count) | Shipped | `web/src/state.ts:54-55`, `:88-96`, `:906`, `:1046-1066`; `web/src/components/StatusBar.tsx:18-26` | Visits and sign-off are genuinely separate state. |
| 4 | Full file view (toggle to full file, signs preserved, markdown gets a third Preview tab) | Shipped | `web/src/components/DiffView.tsx:345-367`, `:624-675`, `:436-441` | |
| 5 | Context expansion (ordered blocks above/below, remaining count, "all blocks revealed" terminal state) | Shipped | `web/src/components/DiffView.tsx:554-591`; `web/src/state.ts:166`, `:394-400` | |
| 6 | Block comments (multi-line range via keyboard or mouse, persisted, re-selected on revisit) | Shipped | `web/src/state.ts:444-470`, `:893-901`; `web/src/components/DiffView.tsx:222-244`; `Inspector.tsx:632-642`; `persist.ts:457-489` | |
| 7 | Line comments + replies (reply to AI note, own threads, draft persistence) | Shipped | `web/src/components/ReplyThread.tsx:40-178`; `Inspector.tsx:803-805`; `persist.ts:437-447` | "↻ resume draft" affordance is real. |
| 8 | Anchored comments (10-line `anchorContext`, FNV-1a-32 `anchorHash`, detached pile on reload) | Shipped | `web/src/anchor.ts:22-29`, `:36-47`, `:59-69`, `:126-185`; `state.ts:615-625`; `Sidebar.tsx:92-120` | Numbers in the doc match the code. |
| 9 | AI Inspector (aggregates per-hunk concerns, severity, ack, teammate verdict beside reviewer state) | Shipped | `web/src/components/Inspector.tsx:434-484`, `:807-812`, `:510-528` | |
| 10 | Review plan (headline, evidence-backed claims, structure map, ≤3 entry points, Send to Claude, rule-based fallback) | Shipped | `web/src/components/ReviewPlanView.tsx:63-119`, `:347-367`, `:508-555`; `web/src/usePlan.ts:29-85`; `server/src/plan.ts:38-202` | `ClaimRow` enforces `evidence.length > 0` invariant. |
| 11 | Plan diagram (typed roles, LSP-derived shape subtitles, typed edges, disabled Class/State/Sequence/ER tabs, Mermaid export) | Shipped | `web/src/planDiagram.ts:32`, `:42`, `:284-313`; `web/src/components/PlanDiagramView.tsx:155`, `:173-178`, `:183-237`, `:260-278` | |
| 12 | Code runner (JS/TS/PHP in browser worker, hunk or block selection, free runner, guided/raw, auto-detected input slots → form) | Shipped, with caveat | `web/src/components/CodeRunner.tsx:54-371`; `web/src/runner/ts-worker.ts:1-72`, `php-worker.ts`, `executeJs.ts`, `executePhp.ts`, `parseInputs.ts:32-39`, `:47-75`, `:81-217` | Input-slot detection is regex-based, not an AST parser; will mis-classify in messier code. |
| 13 | Prompt library picker (built-in + user prompts, search, descriptions, autofill, run-ready form) | Shipped | `web/src/components/PromptPicker.tsx:158-244`, `:258-261`, `:352-374`; `web/src/promptStore.ts:27-34`, `:40-54`, `:221-238` | |
| 14 | Custom prompts (new from scratch, fork without mutating library, args/required/auto-fill, live preview) | Shipped | `web/src/components/PromptEditor.tsx:33-287`, `:126-130`, `:163-203`, `:219-220`; `promptStore.ts:20`, `:30-33`, `:72-83` | |
| 15 | Prompt results panel (per-run row, streaming, expand inline, stack independently, `×` dismiss, widen to 520px) | Shipped | `web/src/components/PromptRunsPanel.tsx:23-67`, `:46-52`, `:76-134`; `web/src/promptRun.ts:31-91` | Real SSE under the hood. |
| 16 | Guide suggestions (cross-hunk symbol dependency, 80% read threshold, accept/dismiss) | Shipped | `web/src/guide.ts:21-60`; `web/src/components/GuidePrompt.tsx:10-26`; `keymap.ts:103-106` | Needs a changeset with cross-hunk refs to demo. |
| 17 | Click-through definitions (in-changeset scrolls, out-of-changeset opens peek, `def:` chip with 5 states) | Shipped | `web/src/components/DiffView.tsx:830-844`; `web/src/definitionNav.ts:1-40`; `web/src/components/ReviewWorkspace.tsx:1092-1095`, `:1640-1736`, `:1738-1789`; `server/src/definitions.ts:34-64`, `:160`; `server/src/languages/{typescript,php}.ts`; `server/src/lspClient.ts:53-74` | Language-agnostic at the web layer; today TS/JS + PHP are wired. |
| 18 | Keyboard help overlay (groups, gutter glyph legend, context-rows) | Shipped | `web/src/components/HelpOverlay.tsx:50-69`, `:82-193`, `:139-163`; `web/src/keymap.ts:70-130` | |
| 19 | Session persistence (cursor, read marks, sign-offs, dismissed guides, replies, drafts, detached pile, agent comments — versioned, currently v3) | Shipped | `web/src/persist.ts:78-99`, `:112-129`, `:213-222`, `:287-345` | |
| 20 | Themes (4 hand-tuned: Light, Dark, Dollhouse, Dollhouse Noir; 10 Shiki-adapted) | Shipped, with note | `web/src/tokens.ts:13`, `:50`, `:87`, `:124`, `:163-177`; `web/src/shikiThemes.ts:33-44`; `web/src/useTheme.ts:1-20`; `web/src/components/ThemePicker.tsx:9-31` | Picker actually exposes 14 themes total. The hand-tuned four are what carry the brand. |
| 21 | Worktree directory picker (primary "choose folder", server-driven native dialog, auto-scan, paste-path fallback) | Shipped | `web/src/useWorktreeLoader.ts:83-102`; `web/src/components/Welcome.tsx:188-194`; `LoadModal.tsx:189-195`; `server/src/worktrees.ts:189` | Both browser and Tauri funnel through the local server's `/api/worktrees/pick-directory`. |
| 22 | Worktree live reload (3s poll, banner, explicit reload, per-worktree toggle, "worktree gone" stop, anchor pass on reload) | Shipped | `web/src/useWorktreeLiveReload.ts:5-7`, `:64-71`; `web/src/components/LiveReloadBar.tsx:22-96`; `web/src/persist.ts:51-67`; `App.tsx:241-253` | |
| 23 | Commit range picker (from/to, just-this, uncommitted toggle gated on `to=HEAD`, stamps range on changeset) | Shipped | `web/src/components/RangePicker.tsx:19-194`, `:60-71`, `:99-117`, `:158-166`; `LoadModal.tsx:283-306` | |
| 24 | Agent context panel (above AI concerns, Task/Files/Plan-todos/Transcript/Cost/Delivered, session match dropdown, symbol click-throughs in transcript, agent↔reviewer back-channel, MCP install affordance) | Shipped | `web/src/components/AgentContextSection.tsx:128-223`, `:381-417`, `:493-549`, `:237-321`, `:642-720`; `Inspector.tsx:374-401`; `web/src/useDeliveredPolling.ts:26`; `server/src/agent-context.ts`; `server/src/index.ts:751-825`, `:1096-1565` | The panel exists end-to-end. Demoing it needs a worktree paired with a real Claude Code session. |
| 25 | GitHub PR ingest (paste URL, fetches diff + metadata + line-anchored comments + PR conversation, per-host PAT, GHE confirm step, matching-PR overlay pill on worktrees) | Shipped, with caveats | `web/src/useGithubPrLoad.ts:34-99`; `web/src/githubPrClient.ts`; `web/src/githubHostTrust.ts:18-52`; `web/src/components/GitHubTokenModal.tsx:71-93`; `Inspector.tsx:266-322`, `:403-418`; `server/src/github/{url,auth-store,pr-load,branch-lookup,api-client,proxy}.ts`; `server/src/index.ts:108-122`, `:978-986` | GHE host trust is a client-side UX gate stored in `localStorage`, not a server allowlist — the server accepts any HTTPS host. RFC1918/loopback writes are blocked in `auth-store`. |
| 26 | Load changeset (URL, file upload, paste; CORS-aware error pointing at the file/paste fallback) | Shipped | `web/src/components/LoadModal.tsx:107-114`, `:314-386`; `Welcome.tsx:75-101` | |
| 27 | API key setup (first-run modal in Tauri, skippable, Keychain storage, post-save state, shell-env mode in browser dev) | Shipped | `web/src/components/KeySetup.tsx:20-173`; `web/src/keychain.ts:20-26`; `web/src/useApiKey.ts:31-69`; `src-tauri/src/lib.rs:45-205`, `:214-216` | |
| 28 | Command palette | Shipped | `web/src/components/CommandPalette.tsx:46-191`; `keymap.ts:123-124` | |
| 29 | Find bar (CSS Custom Highlight API, TreeWalker, prev/next + count) | Shipped | `web/src/components/FindBar.tsx:16-58`, `:79-183`; `App.tsx:94`, `:286`, `:304` | |
| 30 | Four entry points + `?cs=<id>` | Shipped | `web/index.html`, `gallery.html`, `demo.html`, `feature-docs.html`; `App.tsx:52-65` | A screen catalog (`gallery.html`) is unusual for a project this size. |
| 31 | `/api/health` + boot gate | Shipped | `server/src/index.ts:149-159`; `web/src/components/ServerHealthGate.tsx:51-87`, `:130-176` | Also waits for `shippable:sidecar-ready` Tauri event. |
| 32 | Streaming review (SSE, per-IP rate limit, configurable via `SHIPPABLE_REVIEW_RATE_LIMIT`) | Shipped | `server/src/index.ts:234-282`; `server/src/review.ts:14`, `:43-119` | Sets `X-Accel-Buffering: no` for proxy passthrough. |
| 33 | Library prompts on disk + admin-gated refresh + customer-managed source paths | Shipped | `server/src/index.ts:72-77`, `:371-387`; `server/src/library.ts:49-98`; `server/src/prompts.ts:32-58`; `library/prompts/*.md` | 4 bundled prompts: explain-this-hunk, security-review, suggest-tests, summarise-for-pr. |
| 34 | Code-graph endpoint with LSP + regex fallback + per-file LRU | Shipped | `server/src/codeGraph.ts:41`, `:159-204`, `:233-249`, `:285`, `:299-306` | |
| 35 | `mcp-status` detection (`~/.claude/settings.json`, `.local.json`, `~/.claude.json`, per-project) | Shipped | `server/src/mcp-status.ts:20-23`, `:61-80`, `:82-200` | Broader scope than the docs claim. |
| 36 | Agent queue (enqueue / pull-ack / delivered / unenqueue / unified comments endpoint for replies + top-level) | Shipped | `server/src/index.ts:123-148`, `:1096-1565`; `server/src/agent-queue.ts:81-82`, `:93-110` | Storage is in-memory. No `/replies` route; comments are unified. |
| 37 | CORS / `Origin: null` / `Sec-Fetch-Site` handling + env allowlist | Shipped | `server/src/index.ts:1612-1701` | Carries the "things that have bitten us" comment. |
| 38 | Tauri 2 desktop wrapper, sidecar via `bun build --compile`, DMG via `hdiutil` | Shipped | `src-tauri/tauri.conf.json`; `src-tauri/src/lib.rs:45-205`; `server/package.json:18-19`; `scripts/build-dmg.mjs:54-114` | |
| 39 | MCP server (`@shippable/mcp-server`, two tools: `check_review_comments` + `post_review_comment`) | Shipped | `mcp-server/package.json`; `mcp-server/src/index.ts:25-41`, `:43-132` | Tool name is singular: `post_review_comment`. |
| 40 | Vitest, no CI | Shipped | `web/package.json:15`; `server/package.json:11`, `:13`; `mcp-server/package.json`; no `.github/` | ~31 web, 17 server, 2 mcp-server test files. |
| 41 | `npm run build` = `tsc -b && vite build` | Shipped | `web/package.json:12` | |
| 42 | `npm run build:dmg` | Shipped | root `package.json`; `scripts/build-dmg.mjs` | |
| 43 | Worktree path validation (rejects non-git, blocks `..`, requires absolute) | Partial | `server/src/worktree-validation.ts:11-37` | No allowlist; any local git checkout is accepted. |
| 44 | Linter / typecheck integration in the runner | Planned (not implemented) | grep of `web/src/runner/`, `web/src/components/CodeRunner.tsx` returns no eslint/tsc/typecheck wiring | Marketing copy claims it; the code doesn't have it. |
| 45 | Comprehension prompts before sign-off | Planned | No such gating in `state.ts` reducers; sign-off is a single `r` / `Shift+M` action | Listed as aspirational in one-pager-team. |
| 46 | Contextual skill loaders (Gutenberg / Rails / plugin-config rules pulled from diff scope) | Planned | No skill-matcher in the repo | Listed as aspirational in one-pager-team and in `docs/ROADMAP.md`. |
| 47 | GitLab ingest, post-back to GitHub, multi-machine sync, shared reviews | Planned | Not in code | All called out in `docs/overview.md` as not-yet. |

## 2. Screenshot-worthy surfaces

Pick the four that carry the most weight on a landing page.

1. **Diff view, mid-review, with the Inspector open** — sidebar with read meters, the diff with read-line shading and a `Plan · L<n>` AI note, Inspector showing the AI concern, an ack/reply affordance, and the def chip in the toolbar. Load `?cs=cs-99-verify-features` (the densest stub) or a small worktree changeset. This is the screen the rest of the app exists to support.

2. **Review plan with the structure map open** — headline, claims with evidence pills, structure map graph, and a "Start here" entry point. Load any worktree changeset, press `p`. `web/src/components/ReviewPlanView.tsx` + `PlanDiagramView.tsx`. Distinctive: the typed nodes and the disabled-tab honesty both signal care.

3. **Agent context panel docked in the Inspector** — Task expanded, Files touched, Plan/todos visible, the matched-session subhead, and one comment in the Delivered (N) section. Needs a real worktree with a Claude Code session that matches. Without that, fall back to a fixture mock for the screenshot. `AgentContextSection.tsx`.

4. **Code runner with input slots auto-detected** — a JS or PHP hunk with `runDemo(arg1, arg2)` selected, the runner panel showing the input form and the run output. This is the screen that proves "verify in place" is a real action, not a slogan. Load `cs-09-php-helpers` for PHP or `cs-91-agent-flow` for TS.

Honourable mention: **Worktree live-reload banner during a reload** — proof that the diff stays in sync with the working tree. Hard to capture statically; if there's room, capture the stale state.

## 3. Distinctive vs commodity

**Distinctive — the features that justify the tool existing:**

- Review plan with evidence-linked claims and a structure map you can navigate
- Plan diagram with typed file roles and LSP-derived shape subtitles
- Anchored comments that survive amends and force-pushes via FNV-1a anchors
- Line-level read tracking, separate from explicit file sign-off
- Worktree ingest with live-reload polling + anchor pass on every reload
- Commit range picker with the uncommitted-toggle gate
- Click-through to definitions with a peek panel for out-of-changeset targets, language-agnostic at the web layer
- In-browser code runner for JS/TS/PHP with auto-detected input slots
- Agent context panel surfacing the Claude Code session that produced the commit, plus the reviewer↔agent back-channel
- Prompt library with fork-without-mutating-library and live preview against current selection
- AI Inspector that holds AI concerns, teammate verdicts, and reviewer replies in one column
- Guide suggestions that follow cross-hunk symbol references
- Dollhouse / Dollhouse Noir themes (the brand)
- `gallery.html` and `feature-docs.html` as first-class entry points

**Commodity — list quietly or assume:**

- Diff viewer, hunked rendering, syntax highlighting
- File sidebar with A/M/D/R
- Full-file toggle
- Context expansion above/below
- Line comments and replies as a concept (the draft persistence is the polish)
- Keyboard shortcuts and a help overlay
- Find bar
- Command palette
- localStorage persistence
- Theme switcher (as a feature; the actual themes are distinctive)
- Load by URL / file / paste with helpful errors
- Per-host PAT entry modal

## 4. Recommended presentation

### Hero claim

Shippable reads a diff with you. It builds a plan you can interrogate, tracks the lines you've actually looked at, and lets you run the code under the cursor without leaving the review.

### Top features to lead with

Five — all shipped and all distinctive. Each described in the voice the marketing copy will carry.

1. **A review plan you can argue with.** Every claim in the plan points back to a file, hunk, or symbol. Click it, see the evidence, decide if you believe it. A rule-based fallback lands first so the plan is never empty while your AI thinks.
2. **Line-level read tracking that's separate from sign-off.** The cursor records every line you've actually passed over. A gutter rail shows what you've read; a separate gesture says "I'm done with this file." The status bar shows both — you can't accidentally LGTM a file you haven't looked at.
3. **Unsure of what some regex does? Run snippets without leaving the diff.** Select a hunk or a block. The runner detects input slots, gives you a form to fill, and executes the snippet in a sandboxed worker. JavaScript, TypeScript, and PHP today. AI notes can hand a snippet to the runner so a concern becomes a verifier in one click.
4. **Comments that survive changes.** Each comment captures the ten lines around it and a content hash. When the worktree reloads — a new commit, an amend, uncommitted edits — comments re-attach to the new diff or move into a Detached pile with the original snippet preserved. You don't lose your thread when the agent reshuffles its work.
5. **The agent's session, alongside the diff that came out of it.** Open a worktree the agent worked in. The Inspector shows the prompt that started the session, the files it touched, the plan it followed, the last few turns of the transcript, and any comments the agent has fetched from your review. Reply inline; the agent pulls your replies the next time it runs.

### Features to demote

Move these out of the front page into a "Coming next" section or drop them entirely from copy:

- **"Run linters or type checks in place."** Not implemented. The runner executes code; it does not call ESLint, tsc, or any other static analyzer. Either build it or remove it from the one-pagers and the landing mockup.
- **"Suggests what to read next across callers and dependencies, with an AI pass already attached."** Guide Suggestions is real, but it nudges you toward an unread *hunk in the same diff* that defines a symbol the current hunk uses. The richer "AI explainer already attached" variant isn't there. Already labeled "Partly there today" in the team one-pager — keep that posture; don't promote it.
- **"Surfaces the right checks for what's in the diff — Gutenberg block, plugin config, Rails migration, React state change."** Skill loaders aren't built. Already labeled aspirational; do not lift the label.
- **"Asks if you understood. Short comprehension prompts before sign-off."** Not built. Already labeled aspirational; keep it there.
- **"Coverage markers" / "A section is covered when both you and an AI have looked at it."** Tracked in the roadmap, not the product. Don't put it on the landing page yet.
- **GitHub two-way (posting comments back).** Read-only today. The pill that overlays an open PR onto a local worktree is the *good* thing to lead with on this front; "post back" belongs in "Coming next."

### Screenshots to capture

Repeat from §2, prescriptive form:

1. **Hero shot.** `web/index.html?cs=cs-99-verify-features` (or a small real worktree), Inspector open on the right, one AI concern visible with the `ack / reply` row, a `Plan · L<n>` badge near a faded read line in the diff. Dollhouse Noir or Dark theme — Light reads as a competitor screenshot. Caption: "What the line-level read state and inline concerns look like together."
2. **Plan with diagram.** Same load; press `p`. The diagram with 5–8 nodes, typed roles visible (one `hook`, one `component`, a `test` dashed-edge), one entry point selected. Caption: "Every claim points back at the code that justifies it."
3. **Agent context panel.** Inspector open with the AgentContextSection expanded — Task, Files touched, Transcript tail with 3 turns, and one entry in Delivered (N). Caption: "Read the diff alongside the session that wrote it."
4. **Code runner with input slots.** PHP or TS hunk selected, the form rendered with two slots filled in, output panel showing the result. Caption: "Verify the AI's claim in one click, not five."

### What it isn't yet

State these on the landing page so the tool can be trusted later. Frame them as roadmap, not apology.

- Local-first today. Reviews live in localStorage. Hosted backend and team-shared reviews are on the list.
- Read-only on GitHub. The PR overlay surfaces remote review comments inline; posting replies back through GitHub is next on the connectivity work.
- Claude only. The server defaults to `claude-sonnet-4-6`; bring-your-own-key for other providers is next.
- macOS only on the desktop side, and the `.dmg` is unsigned. Linux and Windows builds, and a signed/notarized macOS build, follow.
- GitLab and Bitbucket aren't here. The shape is in place — adding a host fits the same per-host PAT model GitHub uses.
- LSP-backed click-through needs a worktree on disk. Memory-only deployments fall back to the regex graph; richer support is in `docs/plans/plan-symbols.md`.

### 30-second pitch

I review 20x more code than I write now. Most of it was written by an agent forty minutes ago, and the version I'm reading is the one that has to make it into production.

Shippable is a code-review surface for that workflow. You point it at a worktree or paste a diff. It builds a plan — a one-line headline, an evidence-backed structure map of what changed, and a few starting points so you don't have to guess where to look. It tracks every line you've passed over, separate from your explicit sign-off, so a long session can't quietly turn into an LGTM party. AI concerns land on the lines they're about; reply to them, ack them, or hand them to the in-browser runner and verify the claim in one click for JavaScript, TypeScript, or PHP.

If the worktree was produced by a Claude Code session, you can see the prompt the agent ran with, the files it touched, the last few turns of the transcript, and any comments it has fetched from your earlier review. Your replies go back to the agent through MCP.

The human reads. The human signs off. The tool lowers the cost of doing that carefully.

## 5. Copy reconciliation

Backing column uses **Backed** (the claim matches a shipped feature), **Partial** (something close exists but the claim oversells), **Aspirational** (no implementation; only roadmap).

### one-pager.md

| Claim | Status | Evidence in Shippable |
|---|---|---|
| Review plan with summaries linked to file/hunk/symbol | Backed | `ReviewPlanView.tsx:347-367` ClaimRow invariant; `server/src/plan.ts:142-202` validates `EvidenceRef[]` |
| Plan as orientation for unfamiliar territory | Backed | Entry-point list capped at 3, `ReviewPlanView.tsx:508-555` |
| Line-level reading progress | Backed | `web/src/state.ts:88-96`, `:1046-1066`; `StatusBar.tsx:18-26` |
| Sessions persist when you step away | Backed | `persist.ts:78-99`, `:287-345`; cursor restored on boot via `App.tsx:101-115` |
| "Verifies claims inline. Run code, **query LSP**, **run linters or type checks**, **follow a symbol** — without leaving the review" | Partial | Run code: Backed (`CodeRunner.tsx:54-371`). Follow a symbol: Backed (`definitionNav.ts`, `def:` chip). Query LSP for symbol resolution: Backed (`server/src/lspClient.ts`). Run linters / type checks: **Not implemented** — no eslint/tsc wiring in `web/src/runner/` |
| AI + human passes accumulate locally | Backed | `persist.ts` snapshot v3 includes acked notes, replies, drafts, agent comments |
| Hands feedback to next agent run | Backed | Agent queue at `server/src/agent-queue.ts`; MCP tools at `mcp-server/src/index.ts:25-132` |
| Local-first today | Backed | localStorage persistence; sidecar-bundled desktop |

### one-pager-team.md

| Claim | Status | Evidence |
|---|---|---|
| Review plan, evidence-linked | Backed | as above |
| "Surfaces the right checks for what's in the diff. Gutenberg block, plugin config, Rails migration, React state change" | Aspirational (and labeled so) | No skill matcher in code; called out as such in `docs/ROADMAP.md` |
| "Suggests what to read next" with AI explainer already attached | Partial (and labeled "Partly there today") | Guide Suggestions ships (`web/src/guide.ts:21-60`); the explainer-already-attached part is the missing half |
| Line-level reading | Backed | as above |
| Session progress is always tracked / visible | Backed | StatusBar + meters + sidebar |
| Verify with run code / LSP / linters / typecheck / follow a symbol | Partial | Same split as one-pager.md — linters and typechecks are the unbacked pieces |
| "Asks if you understood. Comprehension prompts before sign-off." | Aspirational (and labeled so) | Not implemented; no comprehension-gate in reducers |
| Persists locally; review pre-push | Backed | localStorage; worktree ingest doesn't require an upstream |
| Feedback to next agent run | Backed | as above |
| Local-first today | Backed | as above |

### landing-mockup.html

| Claim | Status | Evidence |
|---|---|---|
| "Builds a review plan you can inspect" — claims linked to file/hunk/symbol | Backed | as above |
| "Tracks reading at the line level" + resumable sessions | Backed | as above |
| "Verifies claims inline" — run code, query LSP, run linters or type checks, follow a symbol | Partial | Same split — linters/typechecks unbacked |
| "Persists locally" — AI + reading accumulate | Backed | as above |
| "Hands feedback to the next run — structured follow-up, not a chat log" | Backed | Agent queue carries kind-tagged enqueue payloads (`server/src/index.ts:1096-1238`); not freeform chat |
| "Works before there's a PR. Local diffs today. Worktrees, URLs, and a PR by number next" | Partial (under-sells) | Local diffs: Backed. Worktrees: **already Backed** (`useWorktreeLoader.ts`). URLs: **already Backed** (`Welcome.tsx:75-101`). PR by URL: **already Backed** (`useGithubPrLoad.ts:34-99`). All three currently in code; copy says "next." Update the page. |
| "shippable · review session #84" + "42 / 187 lines reviewed" toolbar | Backed in concept | StatusBar shows read-line + reviewed-file counts; the specific session-number labeling is a mockup styling choice, not a code element |
| Diff header `services/auth/session.ts · @@ -118,7 +118,12 @@` | Backed | Diff toolbar renders file path + hunk anchor (`DiffView.tsx:475-497`) |
| Read lines fade visually | Backed | `.line--read` class (`DiffView.tsx:677-725`) |
| `Plan · L121` badge anchored to a line in the diff | Backed | Plan claims carry `EvidenceRef`s with line ranges; AI-note row in `Inspector.tsx:434-484` |
| "→ Run: grep WINDOW services/auth/config.ts" — a verifier action attached to a plan note | Partial | The runner is real and the AI-note → runner handoff exists (`CodeRunner.tsx` + `runRequest`), but **the verifier is for executing the hunk's code**, not for running `grep` or arbitrary shell commands. The mockup's command shape is closer to a code-snippet run than a CLI shell. Re-cast the mockup line as something the in-browser runner actually runs, or this reads as a feature we don't have. |
| Palette switcher with "Pastel Rose / Persimmon / Inkwell / Editorial Fuchsia" | Partial (names don't match shipped themes) | The four hand-tuned themes are **Light / Dark / Dollhouse / Dollhouse Noir** (`tokens.ts`). The mockup's names are positioning experiments, not shipped IDs. Either ship the new names or restore the shipped ones in the mockup. |
| Local-first today | Backed | as above |

### LANDING.md

| Claim | Status | Evidence |
|---|---|---|
| Evidence-linked plan | Backed | as above |
| Line-level + resumable sessions | Backed | as above |
| Verify inline (run code, LSP, **linters, typecheck**, follow a symbol) | Partial | Same: linters/typecheck unbacked |
| Persists locally with accumulating AI + human passes | Backed | as above |
| Structured feedback to next agent run | Backed | as above |
| "Local diffs today; worktrees, URLs, and PR-by-number next" | Partial (under-sells) | All three currently Backed; copy says "next" |
| Persimmon theme as render hint | Note | Persimmon isn't a shipped theme name. The closest shipped equivalents are Dollhouse (warm pink) or Dollhouse Noir. Worth picking a side. |

### README.md (main-repo draft)

| Claim | Status | Evidence |
|---|---|---|
| Plan = headline + structure map + suggested entry points | Backed | `ReviewPlanView.tsx:63-119`, structure map `:369-449`, entry points `:508-555` |
| Every claim points back to file/hunk/symbol | Backed | as above |
| Line-level cursor tracking + gutter rail | Backed | `state.ts:88-96` cursor visits; `DiffView.tsx:677-725` `.line--read` class drives the gutter |
| Explicit per-file done gesture | Backed | `state.ts:54-55` `reviewedFiles` Set; `Shift+M` keymap |
| In-review runner for JS / TS / PHP | Backed | `CodeRunner.tsx:54-371`; `runner/ts-worker.ts`, `php-worker.ts`, `executeJs.ts`, `executePhp.ts` |
| Auto-detected input slots | Backed, with caveat | `parseInputs.ts:32-217`. Regex-based; will mis-classify in messier code. Worth caveating in the README. |
| Guided mode + scratchpad | Backed | `CodeRunner.tsx:74` `Mode = "guided" | "edit"`; `:55-56` free runner |
| AI notes anchored to the lines they're about | Backed | `Inspector.tsx:434-484` per-hunk filtering by line range |
| Ack / reply / hand-to-runner | Backed | `Inspector.tsx:803-812`; `ReplyThread.tsx:40-178`; runner handoff via `runRequest` |
| Prompt library: 4 named prompts, editable, hunk-scoped | Backed | `library/prompts/{explain-this-hunk,security-review,suggest-tests,summarise-for-pr}.md`; `PromptEditor.tsx`; selection-scoped via `resolveAuto` |
| Reviews survive reloads | Backed | `persist.ts:213-222`, `:287-345`; `state.ts` v3 schema |
| Nothing sent off the machine unless you trigger a Claude action | Backed | `server/src/index.ts:183-282` only fires Anthropic on `/api/plan` and `/api/review`; both gated by an explicit user action in the UI |
| Vite-served web app in dev | Backed | `web/package.json:12` |
| Tauri 2 desktop with sidecar in `.dmg` | Backed | `src-tauri/tauri.conf.json`; `lib.rs:45-205`; `bun build --compile` in `server/package.json:18-19` |
| Unsigned DMG | Backed | No signing step in `scripts/build-dmg.mjs` |
| "Diff ingest is paste or file upload. No URL ingest, no GitHub/GitLab integration" | **Out of date** | URL ingest Backed (`Welcome.tsx:75-101`); GitHub PR ingest Backed end-to-end (§25 above). README needs an update. |
| Reviews in localStorage, no sync, no multi-user | Backed | as above |
| Claude-only backend, Sonnet 4.6 server-side | Backed | `server/src/plan.ts:14`, `review.ts:14`; both default to `claude-sonnet-4-6`, override via `CLAUDE_MODEL` |
| "No tests, no CI yet. `npm run build` is the typecheck" | **Out of date on tests** | ~50 vitest files across web/server/mcp-server (web 31, server 17, mcp-server 2). No CI is still accurate. Update the README. |
| npm-based dev workflow | Backed | as above |
| Distribution via `.dmg` release artifact | Backed | `npm run build:dmg`; `scripts/release.mjs` exists |

---

## Quick fixes the marketing drafts need before they ship

1. **Drop "run linters or type checks."** Replace with "run a hunk in a sandboxed worker" or "execute the snippet under the cursor." Two of the four marketing drafts repeat this exact phrase.
2. **Stop saying "worktrees, URLs, and PR-by-number are next."** All three are shipped. Move them into the "what it does today" list.
3. **Fix the README's "no URL ingest, no GitHub integration" line.** Both exist. The PR-overlay-on-worktree pill is genuinely distinctive — promote it.
4. **Fix the README's "no tests" line.** 50 vitest files. "No CI yet" still holds.
5. **Reconcile theme names.** Either ship Pastel Rose / Persimmon / Inkwell / Editorial Fuchsia or restore Dollhouse / Dollhouse Noir / Light / Dark in the mockup.
6. **The mockup's `→ Run: grep WINDOW …` line implies a shell-running verifier.** What ships is an in-browser code runner for JS/TS/PHP. Pick a verifier example the runner can actually execute.
7. **Caveat input-slot detection** in the README if you want to keep that bullet. The detector is regex-based and will miss-classify in messier code; the prototype is honest about this elsewhere.
