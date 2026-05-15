# Usability test script

A scripted sweep of the user-facing flows. Use it before a release or after a non-trivial UI change to confirm the product still feels right end-to-end. Not a substitute for `npm run test` — this catches the things automated tests don't (feel, error copy, layout, recovery paths).

## How to run

This is a **dual-track** script. Each step is tagged:

- `[auto]` — runnable in a headless browser. Claude can drive this via Playwright against the dev server, or a human can do it.
- `[manual]` — needs a human at a real keyboard, usually because it involves the Tauri shell, native dialogs, OS Keychain, or a "did it feel right?" judgement.
- `[mixed]` — same behaviour exists in both surfaces; run on whichever you're testing.

**Expect** lines describe the observable outcome. If the outcome doesn't match, that's a finding — record it. `[auto]` Expects should be concrete enough to assert against; `[manual]` Expects are allowed to be qualitative.

### Tracks

- **Automated sweep (web)** — `cd web && npm run test:e2e`. The Playwright suite under `web/e2e/` covers the `[auto]` and `[mixed]` steps below as one spec file per journey. It runs the real `server/` with its Anthropic + GitHub calls pointed at a local fake upstream, so the browser→server→upstream path runs for real (see `web/e2e/README.md`). Coverage is partial — the suite hits the core of each journey, not every individual step — so treat it as a fast regression net, not a replacement for this script.
- **Manual pass (desktop)** — packaged DMG (`npm run tauri:build`) or `cargo tauri dev`. Run every `[manual]` and `[mixed]` step.

Don't claim a release is good on the automated sweep alone — the Keychain, sidecar, native dialogs, FindBar, and webview zoom only exist in the desktop pass. The folder picker is **macOS-only** (the server uses `osascript`); Linux/Windows runners need to fall back to the "paste path instead" affordance.

## Test data

The journeys reference these by name. Set them up once before running the script and substitute the real values in:

| Name | What it is | Notes |
|---|---|---|
| `SAMPLE_WORKTREE` | A local git checkout with uncommitted edits in ≥2 files. | Any working repo; the Shippable repo itself works. |
| `SAMPLE_PR_PUBLIC` | A public github.com PR URL. | Pick one with a handful of files and at least one review comment. |
| `SAMPLE_PR_GHE` | A GHE PR URL. | Skip the GHE-specific steps if you don't have one. |
| `SAMPLE_DIFF_URL` | A reachable `.diff` URL (e.g. a GitHub PR with `.diff` appended). | Must be CORS-permissive — the browser fetches it directly. |
| `SAMPLE_DIFF_FILE` | A local `.diff` or `.patch` file. | Save one from `SAMPLE_PR_PUBLIC` to disk. |
| `ANTHROPIC_KEY` | A working Anthropic API key. | Required for Journey 5; everything else works without it. |
| `GH_PAT` | A GitHub PAT with `repo` scope for `SAMPLE_PR_PUBLIC`'s host. | |

The app ships fixture changesets reachable via `?cs=<id>`; `/gallery.html` lists them. Several steps use these as deterministic stand-ins for real data. Valid fixture ids include `cs-01`, `cs-09`, etc. (not `cs-09-php-helpers` — that's the file name, not the id).

---

## Journey 1 — First-run setup

**Goal:** A new user, fresh install, gets the app running and either turns on AI or knowingly opts out.
**Track:** mixed, manual-heavy.
**Prerequisites:** No stored credentials. On desktop, clear the Keychain entries for `service=shippable` (or test on a fresh user account). On web, clear `localStorage` — including `shippable:anthropic:skip` — and restart the server to wipe its in-memory auth store.

### Happy path

1. `[mixed]` Launch the app. **Expect:** `ServerHealthGate` resolves; the boot CredentialsPanel renders modally before Welcome ever appears. No error banners.
2. `[mixed]` In the boot CredentialsPanel: confirm there's an Anthropic key field (placeholder `sk-ant-...`), copy explaining the key is stored in the macOS Keychain, and a **Skip — use rule-based only** button.
3. `[manual]` Paste `ANTHROPIC_KEY`, click **Save**. **Expect:** Panel closes; Welcome renders; no AI-off chip; no app restart needed.
4. `[manual]` Quit and relaunch the desktop app. **Expect:** AI features still work; no key re-entry prompt (Keychain rehydrate via the Tauri shell).
5. `[auto]` Open Settings from the workspace topbar gear (after loading any changeset), or from the `settings` link in the Welcome footer. **Expect:** Anthropic key shows as configured with lowercase **rotate** and **clear** affordances.
6. `[auto]` Click **clear**. **Expect:** Row updates to unset; the next AI-feature call (e.g. **Send to Claude** in the plan) errors clearly and the rule-based plan stays available.

### Failure branches

- **Server unreachable on boot.** Kill the server before launching. **Expect:** `ServerHealthGate` shows "Server unreachable" with a Retry button — not a blank screen, not a JS error.
- **Invalid Anthropic key.** Enter a junk key, save, then trigger **Send to Claude** in the review plan (Journey 5 step 2). **Expect:** Error surfaces clearly; rule-based plan still renders. Note: the boot CredentialsPanel does **not** re-show after `bootResolved` latches (see known bugs); the user must use Settings to correct the key.
- **Skipped onboarding.** On the boot prompt, click **Skip — use rule-based only**. **Expect:** Welcome renders with an **AI off** chip in the header; ReviewWorkspace's topbar also shows the chip. Quitting and relaunching does not re-prompt (persisted skip in `localStorage["shippable:anthropic:skip"]`). The settings path to set the key later still works.
- `[manual]` **Keychain divergence.** After saving a key on desktop, manually delete only the Keychain entry (Keychain Access app) without clearing the server cache. Relaunch. **Expect:** App detects the absence cleanly on next AI call — no zombie "key set" state.

---

## Journey 2 — Review a local worktree

**Goal:** Point the app at a local checkout, narrow to a range if needed, walk a diff, sign off, and use the worktree-only features (live reload, click-through, agent context, PR overlay).
**Track:** mixed.
**Prerequisites:** macOS host (the folder picker uses AppleScript). `SAMPLE_WORKTREE` exists with uncommitted edits in ≥2 files. Anthropic key may or may not be set — note which.

### Happy path

1. `[mixed]` From the Welcome screen, click **choose folder…**. **Expect:** A macOS folder dialog opens via the local server (`POST /api/worktrees/pick-directory`); cancelling is a no-op.
2. `[mixed]` Select `SAMPLE_WORKTREE`. **Expect:** The directory auto-scans for worktrees; even when only one is found, the worktree list renders and the user picks from it. After selection, the loaded changeset shows the branch's cumulative diff (committed work since divergence + tracked uncommitted + untracked); the file sidebar lists every changed file.
3. `[auto]` Open the commit-range picker — `pick range…` in LoadModal or `⇄ range` in the topbar. **Expect:** Picker lists commits with a "just this" per-row shortcut and an "include uncommitted changes" toggle; choosing a range narrows the diff to it; uncommitted toggle disabled if the chosen range excludes HEAD.
4. `[auto]` Press `?`. **Expect:** Keyboard help overlay opens with four main groups (navigation / review / guide / UI), plus a `testing` table and gutter-glyph legend; Escape closes.
5. `[auto]` Navigate with `j` / `k` (line) and `Shift+J` / `Shift+K` (hunk). **Expect:** Cursor highlights move; the gutter rail fills as lines are passed; the sidebar's per-file read meter advances; the status bar's overall read% updates.
6. `[auto]` Move to the next file with `]`. **Expect:** Cursor jumps to first hunk of next file.
7. `[auto]` On a hunk where context is collapsed, expand-above and expand-below. **Expect:** For markdown files, adjacent context lines render inline immediately. For non-markdown worktree files the bar renders as a placeholder (`↗ load context ↓`); the first click triggers a lazy `/api/worktrees/file-at` fetch, then the context renders. Toggle full-file view from the file header — the `↗ expand entire file` button (or, on markdown files, the `source` / `fullsource` mode toggle). **Expect:** The whole file renders with changed lines highlighted; `↙ collapse to hunks` returns to hunk view.
8. `[mixed]` Click a symbol or identifier in the diff. **Expect:** The diff toolbar shows a `def:` chip (e.g. `def: TS LSP`, `def: worktree only`, or `def: unavailable` with a hover-why). For a TS/JS or PHP worktree the click resolves through LSP; otherwise it falls back to the in-diff symbol graph (lower precision) or hides the affordance.
9. `[auto]` Press `c` on a line to start a new comment. Extend the selection (`Shift+↓` / `Shift+↑`) before pressing `c` to start a **block comment** on a range. **Expect:** Inline comment composer; saved comment renders anchored to its range; re-visiting the range re-selects it.
10. `[auto]` Press `Shift+M` to sign off the current file. **Expect:** File marked reviewed in sidebar (`row--file-reviewed`); status bar's `reviewed X/Y` count increments; toggling again clears it.
11. `[mixed]` In the Inspector, open the **Agent Context** section. **Expect:** Auto-matched session for the worktree appears (or a manual-pick dropdown if none); transcript / cost / todos render; two disclosures surface agent-authored interactions — **Comments (N)** (top-level threads the agent started, each showing location, intent, and time) and **Delivered (N)** (comments the agent has fetched, newest-first, capped at 200 with a "showing last 200" suffix at the cap); replies post back via `shippable_post_review_comment` as `reply-to-agent` interactions; MCP install chips are click-to-copy and collapse to `✓ MCP installed` once detected; dismiss button hides the section.
12. `[mixed]` If `SAMPLE_WORKTREE`'s branch matches an open upstream PR, the Inspector shows a **Matching PR: #N — title** pill. Click it. **Expect:** PR conversation and line-anchored review comments merge into the loaded changeset without replacing the local diff; both `worktreeSource` and `prSource` are set. The pill is opt-in — it does not fire automatically on worktree load.
13. `[mixed]` Reload the page / restart the app. **Expect:** Cursor position, read marks, file sign-offs, replies, and comment drafts come back intact.
14. `[manual]` Make a new edit in `SAMPLE_WORKTREE` from your editor. **Expect:** Within ~3s a banner appears in-app ("New commit on this worktree" or "Uncommitted edits in this worktree") with an explicit reload click — the diff is **not** auto-replaced.
15. `[manual]` Click the banner's reload. **Expect:** Diff refreshes; review state for unchanged files survives; the anchored-comments pass moves stale replies into the **Detached** pile in the sidebar rather than dropping them.

### Failure branches

- **Non-git directory.** Point the picker at a directory without a `.git`. **Expect:** Inline "Scan failed: dir does not look like a git repo (no .git entry): <path>"; previous loaded state isn't blown away.
- **Worktree with zero changes.** Open via `Shift+L` → LoadModal → choose folder, picking a clean checkout. **Expect:** Empty-state message inside LoadModal (the empty path doesn't surface from Welcome — go through LoadModal).
- **Non-macOS host.** On Linux/Windows, the picker errors with "directory chooser is only wired up on macOS right now"; use the **paste path instead** affordance.
- `[manual]` **Worktree disappears.** After loading, `rm -rf` the directory (or rename it). Wait three poll cycles (~9–12 s). **Expect:** Single "Worktree at <path> is no longer reachable. Live reload stopped." banner; polling stops.

---

## Journey 3 — Review a GitHub PR

**Goal:** Paste a PR URL, satisfy auth, walk the diff with review comments inline.
**Track:** mixed.
**Prerequisites:** `SAMPLE_PR_PUBLIC` available; `GH_PAT` ready; no stored token for that host in `/api/auth` or (on desktop) the Keychain entry `service=shippable, account=GITHUB_TOKEN:<host>`. For the GHE step, the host must not be in the `localStorage` trusted-hosts list.

### Happy path

1. `[auto]` Press `Shift+L` and paste `SAMPLE_PR_PUBLIC` into the URL field, submit. **Expect:** The `GitHubTokenModal` opens automatically; body copy names the host (e.g. "Shippable needs a GitHub Personal Access Token to load github.com PRs"). For `github.com` there's no "Token destination" line.
2. `[auto]` Paste `GH_PAT`, click **Save**. **Expect:** Modal closes; PR loads. The topbar shows PR title, state (open / closed / merged) as a badge, refs rendered head→base, and a `↻ refresh` button (tooltip "Refresh PR diff and comments from GitHub").
3. `[auto]` Walk through the diff. **Expect:** Line-anchored review comments render in the Inspector under their hunk, with author, timestamp, and a link out to GitHub. Multi-line comments show an `L{a}–L{b}` line-range label.
4. `[auto]` In the Inspector, expand the **PR conversation (N)** disclosure. **Expect:** Issue-level comments render in order.
5. `[auto]` Click `↻ refresh`. **Expect:** Label changes to "refreshing…" while it runs; diff and comments re-fetch; local review state (read marks, sign-offs, replies on lines that still exist) survives.
6. `[manual]` Quit and relaunch the desktop app. Reload `SAMPLE_PR_PUBLIC`. **Expect:** No token re-prompt (Keychain rehydrate).
7. `[mixed]` Repeat steps 1–5 with `SAMPLE_PR_GHE` if available. **Expect:** First load shows a host-trust stage **inside the same `GitHubTokenModal`** — copy spells out the API base (e.g. `Token destination: https://github.example.com/api/v3`), button reads `I trust {host}`. After confirming, the token field appears in the same modal and the rest of the flow matches.

### Failure branches

- **Bad PR URL.** Submit a malformed URL or a non-PR GitHub URL. **Expect:** Inline error in LoadModal; no token prompt; modal stays open.
- **Non-existent PR.** Submit a well-formed `pull/<n>` URL pointing at a PR that doesn't exist. **Expect:** "PR not found" inline error.
- **Wrong / expired token.** Submit a junk token, then try to load. **Expect:** `GitHubTokenModal` opens in `rejected` mode with "GitHub rejected the saved token... Re-enter the PAT". On Refresh, a banner appears with a **Re-enter to retry** button.
- **Private repo without scope.** Use a token without `repo` scope against a private PR. **Expect (today):** initial-load shows the rejected-token modal with a generic "Check the PAT scopes" string — same wording as wrong-token. Only the Refresh path surfaces the scope hint distinctly. This is logged as a known bug below.
- **Rate-limited host.** Trigger via test seam or repeated Refresh. **Expect (today):** rejected-token modal opens with "GitHub rejected the saved token" copy; Refresh banner appends `(rate limit hit)` parenthetically. This is logged as a known bug below.

---

## Journey 4 — Review a pasted or URL diff

**Goal:** Quick-look at a diff without local checkout or PR auth.
**Track:** auto-heavy.
**Prerequisites:** `SAMPLE_DIFF_URL` (must be CORS-permissive — the browser fetches it directly). `SAMPLE_DIFF_FILE` available.

LoadModal renders three loaders as stacked sections simultaneously (not tabs): **From URL**, **Upload a file**, **Paste diff text**.

### Happy path

1. `[auto]` Press `Shift+L` and paste `SAMPLE_DIFF_URL` into the From URL field. Submit. **Expect:** Browser fetches the diff and parses it client-side; diff renders; status bar shows file count.
2. `[auto]` In the **Upload a file** section, click to select `SAMPLE_DIFF_FILE`. (There is no drag-and-drop today — the input is a plain file picker.) **Expect:** File parses client-side; sidebar lists files.
3. `[auto]` In the **Paste diff text** section, paste the contents of `SAMPLE_DIFF_FILE`. Submit. **Expect:** Same outcome as upload.
4. `[auto]` Navigate (`j` / `k` / `]` / `[`), sign off a file (`Shift+M`), then reopen the app at the bare `/` path. **Expect:** The session resumes with cursor, read marks, and sign-offs intact. Note: an explicit `?cs=` URL always reloads the fixture *fresh* — persistence only applies when booting `/`, which resumes the last session via `peekSession`.
5. `[auto]` Navigate to `?cs=cs-09`. **Expect:** Fixture changeset loads via URL shortcut without going through LoadModal.

### Failure branches

- **CORS-blocked URL.** Paste a `.diff` URL the browser can't reach. **Expect:** Error mentions "likely a CORS rejection from the host".
- **Malformed diff text.** Paste random non-diff text into the paste section. **Expect:** Error reads "No files parsed from that diff — is it empty or malformed?"; LoadModal stays open.
- **Empty diff.** Leave the textarea empty. **Expect:** Submit button is disabled — no error, no submission. (There is no separate empty-diff rejection; the disabled affordance is the whole signal.)
- **Network failure mid-load.** Disconnect Wi-Fi after submitting a URL. **Expect (today):** error surfaces and the UI doesn't spinner-forever, but the message is misattributed to CORS — the offline `TypeError` and the CORS `TypeError` both route through the same copy.

---

## Journey 5 — AI features inside a review

**Goal:** Use the plan + plan diagram, Inspector, code runner, and prompt library on a loaded changeset.
**Track:** mixed.
**Prerequisites:** `ANTHROPIC_KEY` configured. A loaded changeset that contains at least one JS/TS or PHP hunk (use `?cs=cs-09` for determinism).

### Happy path

1. `[auto]` Press `p` to open the review plan. **Expect:** Headline + claim list + structure map + up to three entry points render. Every claim has at least one evidence reference (file / hunk / symbol); clicking the reference jumps the cursor into the diff.
2. `[auto]` In the plan, click **Send to Claude**. **Expect:** Status shows "Claude is reading the diff…", then the AI plan loads and replaces the rule-based version (single response, not SSE — `/api/plan` is JSON). Copy makes clear the diff is leaving the machine.
3. `[auto]` Open the **Plan Diagram** view. **Expect:** Class / State / Sequence / ER tabs (some may be placeholders); the active tab shows nodes derived from the diff; hovering a node lists its symbols; clicking a node jumps the cursor; a Mermaid export affordance is available.
4. `[auto]` Press `i` to toggle the Inspector. **Expect:** Inspector shows AI notes for the current hunk, with severity, summary, detail, ack state, and reply controls.
5. `[auto]` Move to a line with an AI note, press `a`. **Expect:** Note toggles between acked and un-acked; visual state changes; persists across reload.
6. `[auto]` Press `r`, type a reply, submit. **Expect:** Reply appears beside the note; persists across reload.
7. `[auto]` On a JS/TS or PHP hunk, press `e` to run the current hunk. **Expect:** Inline code runner appears with the snippet pre-filled; input slots render as a small form rather than raw rewrite; running produces an output without leaving the page. On non-supported languages, `e` is a no-op.
8. `[auto]` Press `Shift+R` to open the free runner. **Expect:** Empty editor for one-off snippets; supports JS / TS / PHP.
9. `[auto]` Press `/` to open the prompt picker. **Expect:** Lists built-in prompts (`explain-this-hunk`, `security-review`, `suggest-tests`, `summarise-for-pr`) plus any user prompts; search filters; descriptions visible.
10. `[auto]` Pick **explain-this-hunk**, run on the current selection. **Expect:** Prompt opens as a run-ready form with context auto-filled; result streams into the prompt runs panel via `/api/review` (SSE), row status moves `streaming…` → `done`. The run does **not** persist across reload today (see known bugs).
11. `[auto]` In the prompt runs panel: expand/collapse a finished run, widen the sidebar (`‹ / ›` toggle, ~520 px), dismiss a run. **Expect:** Each control behaves as labelled.
12. `[auto]` Open the prompt editor for a built-in prompt, change something, save, run it. **Expect:** Edited (user-override) version runs. Click **delete** on the user override to restore the library default. (There's no separate "restore default" button; delete on the user prompt is the restore path.)

### Failure branches

- **AI key cleared mid-session.** Clear the Anthropic key from Settings while a streaming review is mid-flight. **Expect:** Stream ends with a clear error; rule-based plan remains; no zombie streaming state.
- **AI plan fails.** Force an AI failure (junk key, network drop). **Expect:** Rule-based fallback renders automatically; UI doesn't pretend AI plan succeeded.
- **Rate limit hit.** Run prompts repeatedly until the server's per-IP rate limit on `/api/review` fires (default 30 / 60 s). Note this only fires for `/api/review`-backed actions (prompt runs and streaming review); `/api/plan` is not rate-limited. **Expect:** Clear rate-limit message; subsequent runs after the window work.
- **Runner crash.** Run a snippet that throws. **Expect:** Stack / error rendered in the runner; rest of the app keeps working.
- **PHP runner unavailable.** If the PHP WASM worker fails to initialise, trigger a PHP run. **Expect:** "Runner not available" rather than a silent no-op.

---

## Journey 6 — Cross-cutting surfaces

**Goal:** Sweep the cross-cutting UI: themes, keyboard help, settings management, command palette, comment nav, recents, gallery, feature-docs, FindBar, webview zoom, guide suggestions, server / origin failure handling.
**Track:** mixed.
**Prerequisites:** Run after one of Journeys 2–5 so there's loaded state and at least one PAT recorded.

### Happy path

1. `[mixed]` Open the theme picker (topbar). Cycle through **Light**, **Dark**, **Dollhouse**, **Dollhouse Noir**. **Expect:** Theme CSS-vars and classes flip; theme persists across reload. The chrome+code visual outcome is a manual sub-check — Playwright can verify the class flip but not the rendering.
2. `[auto]` Press `?`. **Expect:** Help overlay renders four main groups (navigation / review / guide / UI), a `testing` section, and a gutter-glyph legend. Escape closes.
3. `[auto]` Open Settings from the workspace topbar ⚙ (or the Welcome footer's `settings` link). **Expect:** Anthropic row + per-host GitHub rows, each with lowercase **rotate** and **clear**.
4. `[auto]` In Settings, use the **+ Add GitHub host** affordance. Enter a non-`github.com` host. **Expect:** Host-trust step appears in the panel (API base URL spelled out, `I trust {host}` button). After trust, the PAT field appears; saving adds the row.
5. `[auto]` Click **clear** on a GitHub PAT row. **Expect:** Row updates to unset; the next PR load for that host re-prompts.
6. `[auto]` Press `Cmd+K` (or `Ctrl+K`). **Expect:** Command palette opens; supports search; lists named actions. Run on a loaded changeset so the palette has review actions available.
7. `[auto]` Press `n` to jump to the next comment, `Shift+N` for previous. **Expect:** Cursor jumps between comment-bearing lines across files. Note: if a guide suggestion is showing, `n` dismisses the guide first (the comment-nav fall-through only fires when no guide is active).
8. `[mixed]` On Welcome, the **recents** section lists previously loaded worktrees / PRs. Click one. **Expect:** It re-loads. Dismiss another from recents. **Expect:** It disappears from the list and stays gone across reload.
9. `[mixed]` Open `/gallery.html`. **Expect:** Screen catalog renders fixtures inline within the gallery page (it does not navigate into the main app).
10. `[mixed]` Open `/feature-docs.html`. **Expect:** Per-feature viewer pairs docs in `docs/features/` with their fixtures.
11. `[manual]` On desktop, trigger **Find** via the Edit menu (Tauri menu wiring). **Expect:** FindBar opens with a search input; matches highlight (Highlight API on supported webviews, fallback otherwise); Enter cycles matches; Escape closes. On the web track, this is the browser's native Find.
12. `[manual]` On desktop, use **Cmd+=** / **Cmd+−** / **Cmd+0** to zoom the webview. **Expect:** UI scales; zoom level persists across launches (stored in `localStorage`).
13. `[auto]` Trigger a guide suggestion (use a fixture known to surface one — pick from `/gallery.html`). Dismiss with `Escape` or `n`; reload. **Expect:** Dismissed state persists; the same guide doesn't re-appear. Accept with `Enter` or `y`. **Expect:** Cursor jumps to the referenced location. The guide remains available — navigating back to the same trigger line (or reloading with the cursor in that position) re-surfaces it. Guides are persistent navigation aids; only `dismiss` makes them go away.

### Failure branches

- **Server dies mid-session.** Kill the server while the app is loaded. Trigger any server-backed action (load a worktree, run a prompt). **Expect (today):** Individual actions surface clear errors. `ServerHealthGate` does **not** re-engage mid-session — it runs only at boot. Reloading the app re-runs the gate. (See known bugs.)
- **Server returns 500.** If a backend endpoint errors, the calling UI surfaces it without crashing the app.
- **Origin handling for Tauri webview.** The Tauri webview reports origin `tauri://localhost`, not literal `null`. Verify the server's allowed-origins list includes it (otherwise `/api/health` denies and the gate trips). Literal `Origin: null` (opaque origin) is actively denied by the server — that's intentional. See comment in `server/src/index.ts`.
- `[manual]` **Packaged DMG behaviour.** Mount the DMG, drag to Applications, launch. **Expect:** Sidecar starts; no Gatekeeper-block beyond the expected unsigned-app warning; AI features and worktree loading work without `tauri dev` env vars present (verifies the sidecar isn't quietly relying on inherited shell env).

---

## Known product bugs surfaced during validation

These are real defects discovered while validating this spec against the code. They are listed here so the spec's Expects describe today's behaviour honestly; file them separately and tighten the relevant Expect when they're fixed.

1. **Token-rejected modal swallows scope and rate-limit hints (J3).** `githubPrClient.ts:36-52, 77-96` parses the server's hint into `GithubFetchError.hint`, but `useGithubPrLoad.ts:98-105, 137-147` never reads it — scope errors, invalid-token, and rate-limit all collapse into the same rejected-token modal. Users see "wrong token" for tokens that are correct but missing scope, or for hosts that are rate-limited.
2. **Prompt runs don't persist across reload (J5).** `runs` is plain `useState` in `ReviewWorkspace.tsx:163`; no persistence hook. Streaming results vanish on reload.
3. **`ServerHealthGate` doesn't re-engage mid-session (J6).** `bootResolved` latches (`ServerHealthGate.tsx:29-34, 86-88`) and the gate has no ongoing health probe; a server that dies after boot is only re-detected on app reload.

---

## Reporting findings

For each failed Expect not already in the known-bugs list, capture:

- **Journey + step number** (e.g. "J3.2").
- **What happened** vs **what was expected**, in one or two sentences.
- **Repro confidence** — happened every time, or once?
- **Screenshot or short clip** if the issue is visual or about feel.

File findings into a run output file; if a journey reveals a pattern (e.g. error copy is consistently vague), open one larger issue rather than N small ones.
