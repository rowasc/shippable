# Bug triage — 2026-05-15

Triage of ten bug reports forwarded by another agent and user against the
`bugfixes-05-15` branch. Most of these were already catalogued in
`docs/usability-test.md` during validation; this document is the action plan.

`J{n}` tags reference user journeys defined in both `docs/usability-test.md`
and the matching `web/e2e/journey-{n}-*.spec.ts` Playwright suites.

## Summary

| # | Title | Verdict | Disposition |
|---|-------|---------|-------------|
| B9 | AI-off chip doesn't return after clearing key | Real bug | Fix |
| B5 | Token-rejected modal swallows scope/rate-limit hints | Real bug | Fix |
| B2 | Interaction IDs collide on same-ms creation | Real bug | Fix |
| B3 | Tauri external links don't open | Real bug | Fix |
| B8 | ServerHealthGate doesn't re-engage on mid-session server failure | Real bug | Fix |
| B1 | PIP queued display + agent-delivery flow lacks e2e | Coverage gap | Add e2e |
| B6 | Prompt runs don't persist | Acknowledged limitation | Document; defer |
| B7 | "Accepted" guides don't persist | Not a bug | Close |
| B10 | Worktree sign-offs lost on reload | Fixed on `main` (commit `866e8bc`) before this branch landed | Resolved upstream |
| B4 | Merge LoadModal into Welcome | Refactor not worth it | Decline |

Shipping order (smallest blast radius first): B9 → B5 → B2 → B3 → B8 → B1.
Items 1–5 are independent enough to land as separate small PRs or one
bundled bug-fix PR. B1's assertions naturally cover regressions from B2 and
B8.

Each fix should also remove its entry from the "Known product bugs"
section of `docs/usability-test.md`.

---

## B9 — AI-off chip doesn't return after clearing key (J1)

**Symptom**: A user with a configured Anthropic key clears it via Settings;
the "AI off" header chip stays hidden until the next reload.

**Root cause**: The chip's predicate is
`!hasAnthropicCredential && credentials.anthropicSkipped`. The skip flag
flips `true → false` when the user sets a key
(`web/src/auth/useCredentials.tsx:121-123`), but `clear()` at lines 130-153
never restores it. After `set → clear`, the flag is stale.

**Fix**: in `useCredentials.clear()`, when the cleared credential is
`anthropic`, call `writeSkip(true)` + `setAnthropicSkipped(true)`. Mirrors
the existing `skipAnthropic()` helper in the same file.

Add a regression test to `useCredentials.test.tsx:169-183`'s clear flow
asserting the skip flag is restored.

---

## B5 — Token-rejected modal swallows scope/rate-limit hints (J3)

**Symptom**: GitHub PR loads that fail for distinct reasons — invalid PAT,
missing scope, rate limit — all render the same "Token rejected. Check the
PAT scopes" modal. Users following the advice may regenerate a perfectly
valid token instead of waiting out a rate limit.

**Root cause**: The server distinguishes the cases server-side
(`server/src/github/api-client.ts:79-90`): 401 → `hint: "invalid-token"`,
403 with `X-RateLimit-Remaining: 0` → `hint: "rate-limit"`, other 403 →
`hint: "scope"`. The hint reaches `GithubFetchError.hint` in
`web/src/githubPrClient.ts:82,98-103`. But `useGithubPrLoad.ts:98-105`
ignores it when setting `TokenModalState` (which has no hint slot anyway),
and lines 137-147 throw a hard-coded scope message on retry-after-submit.

**Fix**: widen `TokenModalState` with optional
`hint?: "rate-limit" | "scope" | "invalid-token"`. Plumb the hint through
both branches. Render hint-specific copy in `GitHubTokenModal`. Format the
retry-after-submit throw off the hint too.

Edge cases the fix must handle:

- 403 without `X-RateLimit-Remaining` falls through to `"scope"` server-side
  — emit `hint: undefined` instead so the modal renders generic copy.
- `Retry-After` headers aren't extracted today; rate-limit copy can't say
  "try again at HH:MM" without piping that through. Acceptable to ship
  without; revisit if users ask.
- `github_token_required`, `github_network`, `github_upstream` carry no
  hint. The modal must render safely when `hint` is undefined.

Unit tests: a hook-level test asserting each hint produces the right
`TokenModalState`; a modal component test for the three rendered copies.

---

## B2 — Interaction IDs collide on same-ms creation

**Symptom**: Two interactions authored in the same millisecond produce
identical IDs. The DB `interactions` table primary-keys on `id`; the UPSERT
at `server/src/db/interaction-store.ts:76-91` silently overwrites
`thread_key, target, intent, author, body, created_at, payload_json` on
conflict. The user sees one comment "disappear" or "change content"
without an error.

**Root cause**: Three ID generators with weak or no entropy:

- `web/src/components/ReviewWorkspace.tsx:1361` — `r-${createdAt.getTime()}`,
  pure millisecond timestamp.
- `web/src/state.ts:389` (TOGGLE_ACK) —
  `` `${nextIntent}:${threadKey}:${Date.now()}` ``; two acks on the same
  thread in the same ms collide.
- `server/src/agent-queue.ts:196,227` uses `randomUUID()` — safe, but
  inconsistent with the client convention.

**Fix**: unify on the prefix-as-author-tag convention the codebase already
uses (`run-`, `wt-`, `pr-comment:`). Format:
`` `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` ``.

- `ReviewWorkspace.tsx:1361` → `` `r-${ts}-${rand}` `` (reviewer-authored).
- `state.ts:389` → `` `r-${ts}-${rand}` `` (also reviewer-authored).
- `agent-queue.ts:196,227` → `` `a-${ts}-${rand}` `` (agent-authored).
  Drop the now-unused `crypto.randomUUID` import.

Existing DB rows with UUID-shaped IDs from older agent comments stay valid
— still unique strings. No migration needed.

Hand-authored fixture IDs in `web/src/fixtures/cs-{99,31,21,09}-*.ts` and
`ReplyThread.test.tsx`'s `r-bad` don't go through the generator and stay
as-is.

Regression tests: a client-side hook test creating two interactions in the
same simulated tick and asserting distinct IDs; a server-side agent-queue
test asserting two back-to-back enqueues both land in the DB.

---

## B3 — Tauri external links don't open

**Symptom**: Clicking any external link in the desktop build does nothing.
AGENTS.md notes that `<a target="_blank">` doesn't work in Wry/WKWebView;
four user-facing links missed that constraint.

**Root cause**: Four surfaces use plain `<a target="_blank">` to external
HTTPS URLs:

- `web/src/components/GitHubTokenModal.tsx:125` — "create a PAT" link.
- `web/src/components/Inspector.tsx:953-961` — `↗` link on AI-note items.
- `web/src/components/ReplyThread.tsx:121-129` — `↗` link on agent replies.
- `web/src/components/CredentialsPanel.tsx:167-173` — Anthropic Console link.

`@tauri-apps/plugin-shell` isn't installed; `src-tauri/capabilities/default.json`
permits `shell:allow-execute` (for the sidecar) but not `shell:allow-open`.

**Fix**:

1. Add `@tauri-apps/plugin-shell` to `web/package.json` and the matching
   `tauri-plugin-shell` crate to `src-tauri/Cargo.toml`. Register the
   plugin in `src-tauri/src/lib.rs`.
2. Add `shell:allow-open` to `src-tauri/capabilities/default.json`, scoped
   to `https://**` only.
3. Add an `openExternal(url)` helper in `web/src/`:

   ```ts
   export async function openExternal(url: string): Promise<void> {
     if (isTauri()) {
       const { open } = await import("@tauri-apps/plugin-shell");
       await open(url);
     } else {
       window.open(url, "_blank", "noreferrer");
     }
   }
   ```

   `isTauri()` already lives in `web/src/keychain.ts`. Dynamic import keeps
   the plugin out of the browser bundle.

4. Swap the four surfaces to `<a>` with
   `onClick={(e) => { e.preventDefault(); openExternal(href); }}` (keeps
   the URL visible on hover and "Copy link" working in the browser build).

Manual verification: build the packaged `.dmg`, install it, click each of
the four surfaces, confirm the OS browser opens. Don't trust `tauri dev`
alone — Wry behavior can differ between dev and the bundled app.

---

## B8 — ServerHealthGate doesn't re-engage on mid-session server failure (J6)

**Symptom**: If the local Node sidecar dies after the boot gate falls
through, the user sees scattered, feature-level errors (worktree reload
fails, prompt streams blow up, interaction sync 500s) instead of a single
"Server unreachable" panel. Most painful on the desktop build.

**Root cause**: `web/src/components/ServerHealthGate.tsx:42-80` is a
`useEffect` with `[attempt]` dependency. It fires at mount and on Retry
clicks; nothing else triggers a re-probe. No `setInterval`, no heartbeat
hook.

The `bootResolved` latch at lines 29-34 is *intentional* and narrow: it
keeps the credentials panel from re-mounting if the user clears their key
from Settings. The latch only gates the credentials-panel branch in the
render logic at lines 86-95; the "server unreachable" and "database
unavailable" branches both react to `state` directly, so a state flip
back to `"unreachable"` will surface the unreachable panel regardless of
`bootResolved`.

`/api/health` returns `{ ok, db }` only — no credential state — so a
health probe can never drag credentials into question.

**Fix**: add a heartbeat in `ServerHealthGate.tsx` that runs while
`state === "ready"`:

```ts
useEffect(() => {
  if (state !== "ready") return;
  let consecutiveFailures = 0;
  const interval = setInterval(async () => {
    try {
      const res = await fetch(await apiUrl("/api/health"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => ({}));
      if (body?.db?.status === "error") {
        setState("db-error");
        setError(body.db.error ?? "database unavailable");
        return;
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) {
        setState("unreachable");
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, 30_000);
  return () => clearInterval(interval);
}, [state]);
```

Key design points:

- 30s cadence — fast enough to surface a crash within half a minute, slow
  enough to be invisible noise on a healthy server.
- N-consecutive-failures gate (N=2) — a single transient blip (laptop
  sleeping, OS network hiccup) shouldn't unmount the workspace.
- Re-engages the unreachable panel via the existing render branches; no
  new UI.
- The `bootResolved` latch stays untouched.

Tighten the comment at lines 29-34 to make the scope of the latch
explicit:

```ts
// Once the gate has fallen through to `children` once, never re-show the
// credentials panel: in-session credential changes (clearing or rotating
// from Settings) would otherwise unmount the workspace and lose its state.
// This does NOT gate the "server unreachable" / "database unavailable"
// branches — those react to live `state` and re-engage mid-session via
// the heartbeat below.
```

Regression test in `ServerHealthGate.test.tsx`: mock `/api/health` to
succeed at mount, advance fake timers past the heartbeat interval, mock
two consecutive failures, assert the unreachable panel renders.

---

## B1 — Add e2e for pip-comment → agent-delivery flow (J2)

**Coverage gap.** Commit `3d448ed` fixed the optimistic-queued-badge bug
(`web/src/components/ReviewWorkspace.tsx:1376` for the optimistic insert;
`web/src/components/ReplyThread.tsx:359-378` for error-over-queued
precedence; unit coverage in `ReplyThread.test.tsx:298-325`). But the full
lifecycle has no e2e:

- `web/e2e/journey-2-worktree.spec.ts` has a comment-authoring test that
  stops at "comment renders" — no assertion on the queued badge, the
  delivery transition, or the error path.
- Coverage matters because this is the most active seam in the codebase
  (SQLite interaction store, agent queue, B2's ID generator) and silent
  regressions here look like UI flicker or lost comments rather than
  attributable bugs.

**Approach**: drive the queued → delivered transition by calling the real
server endpoints the agent worker would call, not by mocking. Keeps the
test honest about the storage round-trip without spinning up the agent
subprocess. The two endpoints involved:

- `POST /api/agent/pull` (`server/src/index.ts:161` → `agentQueue.pullAndAck`)
  — what the agent calls to claim queued work. Marks entries delivered
  server-side and returns them.
- `POST /api/agent/replies` (`server/src/index.ts:171` → `postReply` /
  `postTopLevel`) — what the agent calls to post its response.

The enqueue-error path stays mocked at the HTTP edge — there's no
server-side knob that makes `POST /api/interactions` fail naturally;
synthesizing the failure on the client edge via `page.route()` is the
honest test.

```ts
test("pip lifecycle: queued → delivered", async ({ visit, page, request }) => {
  // Submit a pip; assert ◌ queued; capture the new interaction id.
  // POST /api/agent/pull { worktreePath }   — claims the pip.
  // POST /api/agent/replies { worktreePath, parentId, body, ... } — replies.
  // Wait for useInteractionSync's next poll cycle.
  // Assert badge gone, reply renders in thread.
});

test("pip lifecycle: enqueue error → retry", async ({ visit, page }) => {
  // page.route() POST /api/interactions to return 500 once.
  // Submit a pip; assert ⚠ retry.
  // Unroute; click retry; assert ◌ queued.
});
```

Add a `mockEnqueueRejects(page, status?)` helper to `web/e2e/_lib/mocks.ts`
to keep the test file clean.

Lands after the fixes so the assertions exercise the corrected seams.

---

## B6 — Prompt runs don't persist (J5) — documented limitation

**Disposition**: not fixing now.

A prompt run is a working surface, not a record. The user runs
`explain-this-hunk` to understand the diff *right now*, reads it,
internalizes it, moves on. The body is non-deterministic — re-running
gives a different but equivalent answer — so it functions more like a
cache than an archive. The annoyance window (reload between read and
"glance back") is narrow and infrequent.

Persisting them carries real costs we haven't earned yet: indefinite
sidebar clutter from stale runs, localStorage cap pressure (streamed
bodies can be 50KB+), schema migration risk, and a product question we
haven't actually asked users.

If this becomes a real complaint, the lightest fix is bounded persistence
(last N runs per changeset, or runs from the last hour) — not unbounded.
Revisit then.

The entry stays in `docs/usability-test.md:215` as a known limitation;
the Expect copy at `:165` already describes today's behavior accurately.

---

## B7 — "Accepted" guides don't persist (J6) — not a bug

**Disposition**: not a bug. Closed.

Guides are persistent navigation aids attached to a trigger line. Accept
(Enter/y) jumps the cursor; the guide remains available so the user can
jump again next time they return to the trigger. Only `dismiss` (Esc/n)
takes the guide out of rotation. The code matches this exactly —
`ACCEPT_GUIDE` at `web/src/components/ReviewWorkspace.tsx:560-572`
dispatches `SET_CURSOR` and nothing else; `dismissedGuides` is the only
filter at `web/src/guide.ts:43`.

What the usability test interpreted as a defect ("the guide came back
after reload") is just cursor persistence working as intended — the
cursor restores to the trigger line, the trigger condition still holds,
the guide renders. Treating accept as dismiss would forecloses a
legitimate "jump again" use case.

The usability test has been updated: `docs/usability-test.md:199` now
describes the current behavior as intended, and the entry has been
removed from the Known Bugs list.

---

## B10 — Worktree sign-offs lost on reload (J2) — resolved upstream

**Disposition**: fixed on `main` before this branch was rebased.

Commit `866e8bc` ("test: cover worktree sign-off persistence") on `main`
landed both an implementation fix and an e2e (now passing in J2 as
"worktree sign-off persists across reload"). The Known Bugs entry in
`docs/usability-test.md` was removed in that same commit and a separate
plan was added at `docs/plans/reviewed-targets.md`.

No further action needed here. Earlier theories (file-id divergence,
live-reload re-parse, csId mismatch) are moot; the actual fix lives in
that commit and its surrounding work.

---

## B4 — Merge LoadModal into Welcome — declined

**Disposition**: not a refactor worth doing.

Welcome (`web/src/components/Welcome.tsx`) is page 1: rendered by
`App.tsx:363` when `state.changesets.length === 0`. LoadModal
(`web/src/components/LoadModal.tsx`) is a mid-session overlay triggered
from the workspace topbar (`ReviewWorkspace.tsx:1708`) to re-load without
dropping current state. They overlap in the URL/file/paste loaders but
serve different scopes. A merger would require either always-mounting
Welcome in ReviewWorkspace or threading a "modal mode" prop — both add
complexity for no user-facing gain.

A middle path exists if a third loader surface ever appears: extract a
shared `<LoadForm>` subcomponent (~150 lines of overlapping state and
form handling) that both Welcome and LoadModal compose. Not worth doing
preemptively for the prototype.
